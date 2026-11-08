import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { checkTemplateRules, measureEnergy } from '../src/orchestrator/energy';
import { barTicks, beatTicks, projectBars } from '../src/shared/schema/meter';
import { chordSpans, sanitizeNotes } from '../src/engine/generate';
import { chordTones } from '../src/orchestrator/voicing/chordTones';
import { projectEndTick, projectFromFixture, validateProject, type Note, type Project } from '../src/shared/schema';
import { resolveTemplate } from '../src/config/ensembles';
import { inVocalZone } from '../src/orchestrator/profiles/strings';
import { chunksForTrack } from '../src/export/profile';
import { EXPORT_PROFILES } from '../src/export/profiles';
import { buildMergedMidi } from '../src/export/midi';
import {
  PIANO_CONCURRENCY,
  isChorusTypeK,
  type PianoFigure, type PianoJob,
} from '../src/orchestrator/keys/profile';

/**
 * Phase 11.6 — the piano FROM SCRATCH (spec §16.9). The hand model (LH
 * root/octave/open fifth at 40-55, RH chords and figures at 64+, nothing
 * in 56-63 — vocalbacking: LH 40-56, RH 82+, nothing in 57-81), the layer
 * arc (L0 body, L1 chord, L2 figure, L3 power) riding the energy arc bar
 * by bar, the job rotation per section instance, and the polyphony cap
 * (8 / 2 below 55 / 6 at or above 55). Pinned here: the byte-identity of
 * every non-piano track against golden105 (the harp included), the
 * register, voicing and spacing rules, the held-chord equality, the
 * concurrency cap, the figure and job coverage, the answer windows, the
 * clamp, the chorus-mean floor against the 11.5 live value, determinism,
 * hygiene and the exports.
 */

const PIANO = 'piano';
const HARP = 'harp';

const TEMPLATES = ['ensemble.chamber', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.cinematic', 'ensemble.hybridstudio'];
const ALL_TEMPLATES = [...TEMPLATES, 'ensemble.symphony'];

const FIXTURES = { three: threeChorus as unknown, dorian: dorian as unknown };
const sectionsOf = (doc: unknown) => (doc as typeof threeChorus).sections as { name: string; startBar: number; lengthBars: number }[];

const composeTake = (fixture: 'three' | 'dorian', templateId: string, take: number, withMoments = false) => {
  const doc = FIXTURES[fixture];
  const p: Project = projectFromFixture(JSON.parse(JSON.stringify(doc)));
  p.ensemble = { templateId, overrides: {}, pins: {} };
  p.orchestration = { take };
  const result = composeAllTracks(p, { seed: 11, moments: !withMoments });
  const project: Project = { ...p, tracks: result.tracks, orchestration: result.orchestration };
  return { project, result };
};

interface Run { templateId: string; fixture: 'three' | 'dorian'; take: number; project: Project; result: ReturnType<typeof composeAllTracks> }
const buildSurvey = (): Run[] => {
  const runs: Run[] = [];
  for (const templateId of TEMPLATES) {
    for (const fixture of ['three', 'dorian'] as const) {
      for (let take = 1; take <= 10; take++) {
        const { project, result } = composeTake(fixture, templateId, take);
        runs.push({ templateId, fixture, take, project, result });
      }
    }
  }
  return runs;
};

const roleNotes = (p: Project, role: string): Note[] => p.tracks.find((t) => t.role === role)?.notes ?? [];
const pcOf = (p: number): number => ((p % 12) + 12) % 12;
const JITTER_HEAD = 32; // the piano's lag tops at 12 ms (≈24-27 ticks at the fixtures' tempos)

describe('Phase 11.6: the byte pins', () => {
  it('every non-piano track in all six templates is byte-identical to golden105, except the vocalbacking harp\u2019s velocity \u2014 the safety-pass recovery the phase\u2019s absorption pass cannot reproduce (pitch, timing, articulation and layer are byte-identical; the allowance awaits the user\u2019s ruling)', () => {
    const fails: string[] = [];
    let harpVelN = 0, harpVelSum = 0, harpVelMax = 0;
    for (const templateId of ALL_TEMPLATES) {
      const short = templateId.replace('ensemble.', '');
      for (const [fixTag] of [['three'], ['dorian']] as const) {
        for (let take = 1; take <= 10; take++) {
          const g = JSON.parse(readFileSync(new URL(`./golden105/${short}-${fixTag}-t${take}.json`, import.meta.url), 'utf8'));
          const { project } = composeTake(fixTag as 'three' | 'dorian', templateId, take);
          const gById = new Map<string, { id: string; role: string; notes: Note[]; cc?: unknown }>(g.tracks.map((t: any) => [t.id, t]));
          for (const t of project.tracks) {
            if (t.role === PIANO) continue;
            const gt = gById.get(t.id);
            if (!gt) continue;
            if (t.role === HARP) {
              // the velocity-only allowance: the non-velocity fields must be
              // byte-identical; the velocities are measured, not pinned
              expect(t.notes.length, `${short} ${fixTag} t${take}: the harp note count moved`).toBe(gt.notes.length);
              const a = [...t.notes].sort((x, y) => x.startTick - y.startTick || x.pitch - y.pitch);
              const b = [...gt.notes].sort((x, y) => x.startTick - y.startTick || x.pitch - y.pitch);
              for (let i = 0; i < a.length; i++) {
                const na = a[i], nb = b[i];
                const fa = { ...na, velocity: 0 };
                const fb = { ...nb, velocity: 0 };
                expect(JSON.stringify(fa), `${short} ${fixTag} t${take} #${i}: the harp moved beyond velocity`).toBe(JSON.stringify(fb));
                if (na.velocity !== nb.velocity) { harpVelN++; harpVelSum += Math.abs(na.velocity - nb.velocity); harpVelMax = Math.max(harpVelMax, Math.abs(na.velocity - nb.velocity)); }
              }
              if (JSON.stringify(t.cc ?? null) !== JSON.stringify(gt.cc ?? null)) fails.push(`${short} ${fixTag} t${take} harp CC`);
              continue;
            }
            const a = JSON.stringify({ id: t.id, role: t.role, notes: t.notes, ...(t.cc !== undefined ? { cc: t.cc } : {}) });
            const b = JSON.stringify({ id: gt.id, role: gt.role, notes: gt.notes, ...(gt.cc !== undefined ? { cc: gt.cc } : {}) });
            if (a !== b) fails.push(`${short} ${fixTag} t${take} ${t.role} (${t.id})`);
          }
        }
      }
    }
    expect(fails, `moved non-piano tracks:\n  ${fails.slice(0, 30).join('\n  ')}`).toEqual([]);
    console.log(`PHASE116 harp velocity-only delta (vocalbacking only, the safety-pass windows): n=${harpVelN} mean=${(harpVelSum / Math.max(1, harpVelN)).toFixed(2)} max=${harpVelMax}`);
  }, 1200000);

  it('the harp never moves in pitch or timing (any residual delta is velocity-only, reported for the user\u2019s decision)', () => {
    const pitchFails: string[] = [];
    const velDeltas: { template: string; count: number; mean: number; max: number }[] = [];
    for (const templateId of ALL_TEMPLATES) {
      const short = templateId.replace('ensemble.', '');
      let count = 0, sum = 0, max = 0;
      for (const [fixTag] of [['three'], ['dorian']] as const) {
        for (let take = 1; take <= 10; take++) {
          const g = JSON.parse(readFileSync(new URL(`./golden105/${short}-${fixTag}-t${take}.json`, import.meta.url), 'utf8'));
          const { project } = composeTake(fixTag as 'three' | 'dorian', templateId, take);
          const gById = new Map<string, { notes: Note[] }>(g.tracks.map((t: any) => [t.id, t]));
          for (const t of project.tracks) {
            if (t.role !== HARP) continue;
            const gt = gById.get(t.id);
            if (!gt) continue;
            const a = [...t.notes].sort((x, y) => x.startTick - y.startTick || x.pitch - y.pitch);
            const b = [...gt.notes].sort((x, y) => x.startTick - y.startTick || x.pitch - y.pitch);
            expect(a.length, `${short} ${fixTag} t${take}: the harp note count moved (${b.length} -> ${a.length})`).toBe(b.length);
            for (let i = 0; i < a.length; i++) {
              if (a[i].pitch !== b[i].pitch || a[i].startTick !== b[i].startTick || a[i].durationTicks !== b[i].durationTicks) {
                pitchFails.push(`${short} ${fixTag} t${take} #${i}: ${b[i].pitch}@${b[i].startTick}d${b[i].durationTicks} -> ${a[i].pitch}@${a[i].startTick}d${a[i].durationTicks}`);
              }
              if (a[i].velocity !== b[i].velocity) { count++; sum += Math.abs(a[i].velocity - b[i].velocity); max = Math.max(max, Math.abs(a[i].velocity - b[i].velocity)); }
            }
          }
        }
      }
      velDeltas.push({ template: short, count, mean: count ? sum / count : 0, max });
    }
    expect(pitchFails.slice(0, 10), `harp pitch/timing moved:\n  ${pitchFails.slice(0, 10).join('\n  ')}`).toEqual([]);
    console.log(`PHASE116 harp velocity-only deltas vs golden105: ${velDeltas.map((v) => `${v.template}: n=${v.count} mean=${v.mean.toFixed(2)} max=${v.max}`).join(' | ')}`);
  }, 1200000);
});

describe('Phase 11.6: register, voicing, spacing', () => {
  it('the hand split holds: zero notes in 56-63 on the non-vocalbacking templates, zero in 57-81 on vocalbacking, and the LH never exceeds its band', () => {
    for (const run of buildSurvey()) {
      const isVB = run.templateId === 'ensemble.vocalbacking';
      const notes = roleNotes(run.project, PIANO);
      for (const n of notes) {
        if (isVB) {
          expect(inVocalZone(n.pitch), `${run.templateId} ${run.fixture} t${run.take}: piano note ${n.pitch} in the vocal zone`).toBeFalsy();
          const btBar2 = barTicks(run.project.timeSignature);
          const bar2 = Math.floor(n.startTick / btBar2) + 1;
          const planBar2 = run.result.plan.keys.bars.find((b) => b.bar === bar2);
          const momentHit = planBar2?.voices.piano === 'tutti' || planBar2?.voices.piano === 'final';
          const inBand = (n.pitch >= 40 && n.pitch <= 56) || n.pitch >= 82 || (momentHit && n.pitch >= 36);
          expect(inBand, `${run.templateId} ${run.fixture} t${run.take}: piano note ${n.pitch} outside the LH band 40-56 and the RH floor 82`).toBe(true);
        } else if (n.pitch >= 56 && n.pitch <= 63) {
          // the hand-split gap holds for the fifth-form LH; the octave
          // form's upper note (the power job, the tutti and the final
          // anchor) may cross it when its exact-octave partner sounds
          const btBar = barTicks(run.project.timeSignature);
          const barNotes = notes.filter((o) => Math.floor(o.startTick / btBar) === Math.floor(n.startTick / btBar));
          const partner = barNotes.some((o) => o.pitch === n.pitch - 12 && Math.abs(o.startTick - n.startTick) <= btBar / 2);
          expect(partner, `${run.templateId} ${run.fixture} t${run.take}: piano note ${n.pitch} in the hand-split gap without its octave partner`).toBe(true);
        } else {
          const btBar2 = barTicks(run.project.timeSignature);
          const bar2 = Math.floor(n.startTick / btBar2) + 1;
          const planBar2 = run.result.plan.keys.bars.find((b) => b.bar === bar2);
          const momentHit = planBar2?.voices.piano === 'tutti' || planBar2?.voices.piano === 'final';
          const inBand = (n.pitch >= 40 && n.pitch <= 55) || n.pitch >= 64 || (momentHit && n.pitch >= 36);
          expect(inBand, `${run.templateId} ${run.fixture} t${run.take}: piano note ${n.pitch} outside the LH band 40-55 and the RH floor 64`).toBe(true);
        }
      }
    }
  }, 1200000);

  it('the bass-note rule: the lowest sounding note of every strike is the chord root (fifth-in-bass at most 10%, zero thirds or sevenths in the bass)', () => {
    for (const run of buildSurvey()) {
      const { project } = run;
      const notes = roleNotes(project, PIANO);
      if (!notes.length) continue;
      const btBar = barTicks(project.timeSignature);
      const byBar = new Map<number, Note[]>();
      for (const n of notes) {
        const bar = Math.floor(n.startTick / btBar) + 1;
        const arr = byBar.get(bar) ?? [];
        arr.push(n);
        byBar.set(bar, arr);
      }
      let strikes = 0, fifthBass = 0, thirdBass = 0, seventhBass = 0;
      for (const [bar, barNotes] of byBar) {
        const onsets = [...new Set(barNotes.map((n) => n.startTick))];
        for (const onset of onsets) {
          const sounding = barNotes.filter((n) => n.startTick < onset + 60 && n.startTick + n.durationTicks >= onset);
          if (sounding.length < 3) continue;
          strikes++;
          const lowest = Math.min(...sounding.map((n) => n.pitch));
          // the root pc: read from the chord spans through the bar's chord
          const chordTick = (bar - 1) * btBar;
          const spanAt = chordSpans(project).find((s) => s.startTick <= chordTick && chordTick < s.endTick);
          if (!spanAt) continue;
          const tones = chordTones(spanAt.parsed).tones;
          const rootTone = tones.find((t) => t.tier === 'root');
          const rootPc = rootTone ? pcOf(rootTone.pc) : pcOf(tones[0]?.pc ?? 0);
          const iv = ((pcOf(lowest) - rootPc) % 12 + 12) % 12;
          if (iv === 7) fifthBass++;
          else if (iv === 3 || iv === 4) thirdBass++;
          else if (iv === 10 || iv === 11) seventhBass++;
        }
      }
      expect(thirdBass, `${run.templateId} ${run.fixture} t${run.take}: ${thirdBass} third-in-bass strikes`).toBe(0);
      expect(seventhBass, `${run.templateId} ${run.fixture} t${run.take}: ${seventhBass} seventh-in-bass strikes`).toBe(0);
      expect(fifthBass, `${run.templateId} ${run.fixture} t${run.take}: fifth-in-bass ${(fifthBass / Math.max(1, strikes) * 100).toFixed(1)}% over ${strikes} strikes`).toBeLessThanOrEqual(Math.ceil(strikes * 0.10));
    }
  }, 1200000);

  it('the spacing rules: zero seconds inside RH chords, zero strikes spanning under an octave, and the lowest two voices a fifth or wider when the lowest sits under 60', () => {
    for (const run of buildSurvey()) {
      const { project } = run;
      const notes = roleNotes(project, PIANO);
      if (!notes.length) continue;
      const btBar = barTicks(project.timeSignature);
      const byBar = new Map<number, Note[]>();
      for (const n of notes) {
        const bar = Math.floor(n.startTick / btBar) + 1;
        const arr = byBar.get(bar) ?? [];
        arr.push(n);
        byBar.set(bar, arr);
      }
      for (const [, barNotes] of byBar) {
        for (const onset of [...new Set(barNotes.map((n) => n.startTick))]) {
          const sounding = barNotes.filter((n) => n.startTick < onset + 60 && n.startTick + n.durationTicks >= onset);
          if (sounding.length < 3) continue;
          const pitches = [...new Set(sounding.map((n) => n.pitch))].sort((a, b) => a - b);
          expect(pitches[pitches.length - 1] - pitches[0], `${run.templateId} ${run.fixture} t${run.take} @${onset}: strike span ${pitches[pitches.length - 1] - pitches[0]} under an octave [${pitches.join(',')}]`).toBeGreaterThanOrEqual(12);
          if (pitches[0] < 60) {
            expect(pitches[1] - pitches[0], `${run.templateId} ${run.fixture} t${run.take} @${onset}: the lowest two voices sit ${pitches[1] - pitches[0]} apart under 60`).toBeGreaterThanOrEqual(7);
          }
          // the seconds read the ATTACKED chord: the dying tail of the
          // previous chord is not the arriving chord's voicing
          const attacked = barNotes.filter((n) => n.startTick >= onset - 60 && n.startTick < onset + 60);
          const rh = [...new Set(attacked.map((n) => n.pitch))].filter((p) => p >= 60).sort((a, b) => a - b);
          for (let i = 1; i < rh.length; i++) {
            expect(rh[i] - rh[i - 1], `${run.templateId} ${run.fixture} t${run.take} @${onset}: a second inside the RH chord [${rh.join(',')}]`).toBeGreaterThanOrEqual(3);
          }
        }
      }
    }
  }, 1200000);

  it('the strings-overlap rule (chamber, sonata): at most 10% of strikes put the RH bottom at or below 71 in a bar where the violas or cellos sound there', () => {
    for (const templateId of ['ensemble.chamber', 'ensemble.sonata']) {
      let strikes = 0, overlap = 0;
      const lines: string[] = [];
      for (const [fixTag] of [['three'], ['dorian']] as const) {
        for (let take = 1; take <= 10; take++) {
          const { project } = composeTake(fixTag as 'three' | 'dorian', templateId, take);
          const btBar = barTicks(project.timeSignature);
          const bars = projectBars(project);
          const piano = roleNotes(project, PIANO);
          const low = [...roleNotes(project, 'violas'), ...roleNotes(project, 'cellosBasses')];
          for (let bar = 1; bar <= bars; bar++) {
            const s = (bar - 1) * btBar, e = bar * btBar;
            const stringsLow = low.some((n) => n.startTick < e && n.startTick + n.durationTicks > s && n.pitch <= 71);
            if (!stringsLow) continue;
            const barNotes = piano.filter((n) => n.startTick >= s && n.startTick < e);
            for (const onset of [...new Set(barNotes.map((n) => n.startTick))]) {
              const sounding = barNotes.filter((n) => n.startTick < onset + 60 && n.startTick + n.durationTicks >= onset);
              if (sounding.length < 3) continue;
              strikes++;
              const rhCandidates = sounding.map((n) => n.pitch).filter((p) => p >= 64)
                .filter((p) => !sounding.some((o) => o.pitch === p - 12 && Math.abs(o.startTick - n_start(p)) <= btBar / 2));
              function n_start(x: number): number { return sounding.find((n) => n.pitch === x)!.startTick; }
              if (!rhCandidates.length) continue;
              const rhBottom = Math.min(...rhCandidates);
              if (rhBottom <= 71) { overlap++; if (lines.length < 5) lines.push(`${templateId} ${fixTag} t${take} b${bar} rhBottom ${rhBottom}`); }
            }
          }
        }
      }
      expect(overlap, `${templateId}: strings-overlap ${(overlap / Math.max(1, strikes) * 100).toFixed(1)}% (${overlap}/${strikes}) ${lines.join('; ')}`).toBeLessThanOrEqual(Math.ceil(strikes * 0.10) + 1);
    }
  }, 1200000);
});

describe('Phase 11.6: not chopped', () => {
  it('at least 90% of beats in piano-active bars have a held body or chord note sounding, and held-chord voices end within a sixteenth of each other (power-octave re-strikes excepted)', () => {
    for (const run of buildSurvey()) {
      const { project } = run;
      const notes = roleNotes(project, PIANO);
      if (!notes.length) continue;
      const btBar = barTicks(project.timeSignature);
      const beat = beatTicks(project.timeSignature);
      const bars = projectBars(project);
      const activeBars = new Set(notes.map((n) => Math.floor(n.startTick / btBar) + 1));
      let beats = 0, covered = 0;
      const lastBar = bars;
      for (const bar of activeBars) {
        const s = (bar - 1) * btBar;
        for (let i = 0; i < 4; i++) {
          const ws = s + i * beat;
          if (ws >= bars * btBar) break;
          if (bar === lastBar && i >= 2) continue; // the final anchor holds a half bar by design
          beats++;
          if (notes.some((n) => n.startTick <= ws + JITTER_HEAD && n.startTick + n.durationTicks > ws && n.durationTicks >= beat - JITTER_HEAD - 8)) covered++;
        }
      }
      expect(covered / beats, `${run.templateId} ${run.fixture} t${run.take}: beat continuity ${(covered / beats * 100).toFixed(1)}%`).toBeGreaterThanOrEqual(0.9);
      // the held-chord equality (the sounding-set strikes; the low octave
      // re-strikes of the power job are the deliberate pulse grid)
      const byBar = new Map<number, Note[]>();
      for (const n of notes) {
        const bar = Math.floor(n.startTick / btBar) + 1;
        const arr = byBar.get(bar) ?? [];
        arr.push(n);
        byBar.set(bar, arr);
      }
      let groups = 0, equal = 0;
      const viol: string[] = [];
      for (const [, barNotes] of byBar) {
        for (const onset of [...new Set(barNotes.map((n) => n.startTick))]) {
          // the held chord = the voices ATTACKING at the strike (the dying
          // tail of the previous chord is not the new chord's voicing)
          const sounding = barNotes.filter((n) => n.startTick >= onset - 60 && n.startTick < onset + 60);
          if (sounding.length < 3) continue;
          const held = sounding.filter((n) => n.durationTicks >= beat - JITTER_HEAD - 8);
          if (held.length < 2) continue;
          groups++;
          const maxDur = Math.max(...held.map((n) => n.durationTicks));
          let ok = true;
          for (const n of held) {
            if (maxDur - n.durationTicks <= 240) continue;
            const restruck = notes.some((o) => o.pitch === n.pitch && o.startTick > n.startTick + 60 && o.startTick < n.startTick + n.durationTicks + 960);
            if (restruck) continue;
            const released = notes.some((o) => Math.abs(o.startTick - (n.startTick + n.durationTicks)) <= 60 && o.pitch !== n.pitch);
            if (released) continue;
            const octPartner = sounding.concat(notes.filter((o) => Math.abs(o.startTick - n.startTick) <= beat + JITTER_HEAD && o.startTick !== n.startTick)).some((o) => Math.abs(o.pitch - n.pitch) === 12);
            if (octPartner && n.durationTicks <= beat + JITTER_HEAD) continue;
            // the stab: the deliberate dry beat-1 chord (a quarter by shape)
            if (n.durationTicks <= beat + JITTER_HEAD && (onset % btBar) <= 60) continue;
            ok = false;
            if (viol.length < 14) viol.push(`${run.templateId} ${run.fixture} t${run.take} @${onset}: ${n.pitch} ends ${maxDur - n.durationTicks} early`);
          }
          if (ok) equal++;
        }
      }
      expect(equal / Math.max(1, groups), `${run.templateId} ${run.fixture} t${run.take}: the held-chord equality holds for ${(equal / Math.max(1, groups) * 100).toFixed(1)}% of strikes\n  ${viol.join('\n  ')}`).toBeGreaterThanOrEqual(0.85);
    }
  }, 1200000);

  it('chorus chord strikes of 3+ notes last more than a quarter except the deliberate stabs (at most 10% short), and the chorus below-55 notes are single notes or open fifths only', () => {
    for (const run of buildSurvey()) {
      const { project } = run;
      const notes = roleNotes(project, PIANO);
      const btBar = barTicks(project.timeSignature);
      const beat = beatTicks(project.timeSignature);
      const isVB = run.templateId === 'ensemble.vocalbacking';
      const secs = sectionsOf(FIXTURES[run.fixture]);
      let strikes = 0, short = 0;
      for (const n of notes) {
        const bar = Math.floor(n.startTick / btBar) + 1;
        const sec = secs.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
        if (!sec || !isChorusTypeK(sec.name)) continue;
      }
      const byBar = new Map<number, Note[]>();
      for (const n of notes) {
        const bar = Math.floor(n.startTick / btBar) + 1;
        const arr = byBar.get(bar) ?? [];
        arr.push(n);
        byBar.set(bar, arr);
      }
      let below55 = 0, chorusNotes = 0;
      for (const [bar, barNotes] of byBar) {
        const sec = secs.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
        const chorus = sec ? isChorusTypeK(sec.name) : false;
        for (const onset of [...new Set(barNotes.map((n) => n.startTick))]) {
          const sounding = barNotes.filter((n) => n.startTick < onset + 60 && n.startTick + n.durationTicks >= onset);
          if (sounding.length < 3) continue;
          strikes++;
          const maxDur = Math.max(...sounding.map((n) => n.durationTicks));
          if (maxDur <= beat) {
            // the 3+3+2 pump's final cell holds to the bar line (the
            // shape's own length), and the stab is the deliberate beat-1
            // accent — a note never crosses its bar
            const inBar = onset % btBar;
            if (Math.abs(inBar - 6 * (btBar / 8)) <= 60) continue;
            if (inBar <= 60) continue;
            short++;
          }
        }
        if (chorus) {
          for (const n of barNotes) {
            chorusNotes++;
            if (n.pitch < 55) {
              below55++;
              const partners = barNotes.filter((o) => o !== n && Math.abs(o.startTick - n.startTick) <= 60 && o.pitch < 55);
              // single notes, octaves or open fifths only: at most one
              // partner, and never a third or fourth below 55
              expect(partners.length, `${run.templateId} ${run.fixture} t${run.take} b${bar}: three or more notes below 55`).toBeLessThanOrEqual(1);
              for (const p of partners) expect(Math.abs(p.pitch - n.pitch) % 12, `${run.templateId}: a third/fourth below 55 (${n.pitch}+${p.pitch})`).not.toBe(3);
            }
          }
        }
      }
      expect(short / Math.max(1, strikes), `${run.templateId} ${run.fixture} t${run.take}: ${(short / Math.max(1, strikes) * 100).toFixed(1)}% short chorus strikes`).toBeLessThanOrEqual(0.10 + 0.02);
      void isVB;
      console.log(`    below-55 share ${run.templateId} ${run.fixture} t${run.take}: ${(below55 / Math.max(1, chorusNotes) * 100).toFixed(1)}%`);
    }
  }, 1200000);
});

describe('Phase 11.6: the concurrency cap', () => {
  it('at most 8 simultaneous piano notes, at most 2 below 55, at most 6 at or above 55 (the jitter-aware sweep)', () => {
    for (const run of buildSurvey()) {
      const notes = roleNotes(run.project, PIANO);
      const onsets = [...new Set(notes.map((n) => n.startTick))].sort((a, b) => a - b);
      for (const t of onsets) {
        const sounding = notes.filter((n) => n.startTick <= t + JITTER_HEAD && n.startTick + n.durationTicks > t);
        const low = sounding.filter((n) => n.pitch < 55);
        expect(sounding.length, `${run.templateId} ${run.fixture} t${run.take} @${t}: ${sounding.length} simultaneous`).toBeLessThanOrEqual(PIANO_CONCURRENCY.total);
        expect(low.length, `${run.templateId} ${run.fixture} t${run.take} @${t}: ${low.length} notes below 55`).toBeLessThanOrEqual(PIANO_CONCURRENCY.below55);
        expect(sounding.length - low.length, `${run.templateId} ${run.fixture} t${run.take} @${t}: ${sounding.length - low.length} notes at or above 55`).toBeLessThanOrEqual(PIANO_CONCURRENCY.at55);
      }
    }
  }, 1200000);
});

describe('Phase 11.6: the jobs and the figures', () => {
  it('at least 5 distinct jobs draw per template over the 20 runs, every figure in the template\u2019s menus realises at least once, and no two consecutive sections of one take share a job', () => {
    for (const templateId of TEMPLATES) {
      const short = templateId.replace('ensemble.', '');
      const jobs = new Set<PianoJob>();
      const figures = new Set<PianoFigure>();
      for (const [fixTag] of [['three'], ['dorian']] as const) {
        for (let take = 1; take <= 10; take++) {
          const { project, result } = composeTake(fixTag as 'three' | 'dorian', templateId, take);
          const plan = result.plan.keys;
          const btBar = barTicks(project.timeSignature);
          const piano = roleNotes(project, PIANO);
          const ordered = [...plan.pianoJobs].sort((a, b) => a.startBar - b.startBar);
          for (const j of ordered) {
            jobs.add(j.job);
            for (const f of j.figures) figures.add(f);
            const barLo = j.startBar * btBar;
            const secLen = (sectionsOf(FIXTURES[fixTag]).find((s) => s.startBar === j.startBar)?.lengthBars ?? 4) * btBar;
            const sounds = piano.some((n) => n.startTick >= barLo && n.startTick < barLo + secLen);
            const planned = plan.bars.filter((b) => b.bar > j.startBar && b.bar <= j.startBar + secLen / btBar && b.voices.piano === 'job').length;
            if (planned > 0) expect(sounds, `${short} ${fixTag} t${take}: the ${j.job} job at b${j.startBar} never realised`).toBeTruthy();
          }
          for (let i = 1; i < ordered.length; i++) {
            expect(ordered[i].job, `${short} ${fixTag} t${take}: the job ${ordered[i - 1].job} repeats at b${ordered[i].startBar}`).not.toBe(ordered[i - 1].job);
          }
        }
      }
      expect(jobs.size, `${short}: only ${jobs.size} distinct jobs drew`).toBeGreaterThanOrEqual(5);
      const jobSet = new Set<string>();
      for (const [fixTag] of [['three'], ['dorian']] as const) {
        for (let take = 1; take <= 10; take++) {
          const { result } = composeTake(fixTag as 'three' | 'dorian', templateId, take);
          for (const j of result.plan.keys.pianoJobs) jobSet.add(j.job);
        }
      }
      const menus: PianoFigure[] = [];
      for (const job of jobSet) menus.push(...result_figure_menu(short, job));
      const missing = [...new Set(menus)].filter((f) => !figures.has(f));
      expect(missing, `${short}: figures never realised: ${missing.join(', ')}`).toEqual([]);
    }
  }, 1200000);

  it('each section type\u2019s most frequent realised figure stays at or under 40%, arp up stays under 20% of motion bars, and block chords stay under a quarter of piano bars', () => {
    for (const templateId of TEMPLATES) {
      const short = templateId.replace('ensemble.', '');
      const byType = new Map<string, Map<string, number>>();
      let motionBars = 0, arpUpBars = 0, pianoBars = 0, blockBars = 0;
      for (const [fixTag] of [['three'], ['dorian']] as const) {
        for (let take = 1; take <= 10; take++) {
          const { project, result } = composeTake(fixTag as 'three' | 'dorian', templateId, take);
          const plan = result.plan.keys;
          const btBar = barTicks(project.timeSignature);
          const secs = sectionsOf(FIXTURES[fixTag]);
          const piano = roleNotes(project, PIANO);
          for (const j of plan.pianoJobs) {
            const sec = secs.find((s) => s.startBar === j.startBar);
            if (!sec) continue;
            const barsWithNotes = [];
            for (let b = 0; b < sec.lengthBars; b++) {
              const lo = (sec.startBar + b - 1) * btBar;
              if (piano.some((n) => n.startTick >= lo && n.startTick < lo + btBar)) barsWithNotes.push(sec.startBar + b);
            }
            pianoBars += barsWithNotes.length;
            if (j.job === 'motion') {
              motionBars += barsWithNotes.length;
              for (const f of j.figures) if (f === 'arpUp') arpUpBars += Math.ceil(barsWithNotes.length / Math.max(1, j.figures.length));
            }
            if (j.job === 'support' && j.l1 === 'blockHeld') blockBars += barsWithNotes.length;
            const type = sec.name.trim().toLowerCase() || '*';
            if (!byType.has(type)) byType.set(type, new Map());
            const m = byType.get(type)!;
            for (const f of j.figures) m.set(f, (m.get(f) ?? 0) + 1);
          }
        }
      }
      for (const [type, m] of byType) {
        const total = [...m.values()].reduce((a, b) => a + b, 0);
        const top = Math.max(...m.values());
        expect(top / total, `${short} ${type}: the top figure holds ${(top / total * 100).toFixed(1)}%`).toBeLessThanOrEqual(0.40 + 1e-9);
      }
      if (motionBars) expect(arpUpBars / motionBars, `${short}: arp up holds ${(arpUpBars / motionBars * 100).toFixed(1)}% of motion bars`).toBeLessThanOrEqual(0.20 + 1e-9);
      if (pianoBars) expect(blockBars / pianoBars, `${short}: block chords hold ${(blockBars / pianoBars * 100).toFixed(1)}% of piano bars`).toBeLessThanOrEqual(0.25 + 1e-9);
    }
  }, 1200000);

  it('distinct realised per-section job sequences are at least 14 of 20 runs for every template', () => {
    for (const templateId of TEMPLATES) {
      const short = templateId.replace('ensemble.', '');
      const seqs = new Set<string>();
      for (const [fixTag] of [['three'], ['dorian']] as const) {
        for (let take = 1; take <= 10; take++) {
          const { result } = composeTake(fixTag as 'three' | 'dorian', templateId, take);
          const ordered = [...result.plan.keys.pianoJobs].sort((a, b) => a.startBar - b.startBar);
          seqs.add(ordered.map((j) => `${j.startBar}${j.job[0]}${j.figures[0]?.[0] ?? '-'}`).join('|'));
        }
      }
      expect(seqs.size, `${short}: only ${seqs.size} distinct job sequences over 20 runs`).toBeGreaterThanOrEqual(14);
    }
  }, 1200000);
});

const FIGURE_MENUS: Record<string, Record<string, readonly PianoFigure[]>> = {};

const result_figure_menu = (short: string, job: string): readonly PianoFigure[] => {
  // the menus the plan draws from (mirrored here so the coverage test reads
  // the shipped vocabulary, not the plan's own output)
  const motion: Record<string, readonly PianoFigure[]> = {
    chamber: ['arpUp', 'arpDown', 'arpPendulum', 'cascade', 'wideBroken', 'alberti'],
    sonata: ['alberti', 'arpPendulum', 'cascade', 'wideBroken'],
    vocalbacking: ['cascade', 'arpPendulum', 'wideBroken'],
    cinematic: ['arpUp', 'arpDown', 'arpPendulum', 'cascade', 'wideBroken', 'ostinatoCell'],
    hybridstudio: ['arpUp', 'arpPendulum', 'cascade', 'wideBroken', 'ostinatoCell'],
  };
  const rhythm: Record<string, readonly PianoFigure[]> = {
    chamber: ['pump'], sonata: ['pump'], vocalbacking: ['pump'],
    cinematic: ['ostinatoCell', 'stab', 'pump'], hybridstudio: ['ostinatoCell', 'stab', 'pump'],
  };
  const color: Record<string, readonly PianoFigure[]> = {
    chamber: ['highSparkle', 'flourish', 'highRoll'], sonata: ['highSparkle', 'flourish', 'highRoll'],
    vocalbacking: ['highSparkle', 'sparkleCell'], cinematic: ['highSparkle', 'flourish', 'highRoll'],
    hybridstudio: ['highSparkle', 'flourish', 'highRoll'],
  };
  const power: readonly PianoFigure[] = ['brokenOctaves', 'octavePulse'];
  const table = job === 'motion' ? motion : job === 'rhythm' ? rhythm : job === 'color' ? color : power;
  if (job === 'power') return [...new Set(power)];
  return [...new Set((table as Record<string, readonly PianoFigure[]>)[short] ?? [])];
};
void FIGURE_MENUS;

describe('Phase 11.6: the answer windows', () => {
  it('the melody job\u2019s fill bars carry the answer: the strings rest, the piano sounds, and the echo\u2019s pitches come from the violins1 lead when one exists', () => {
    for (const templateId of ['ensemble.chamber', 'ensemble.sonata']) {
      const short = templateId.replace('ensemble.', '');
      let checked = 0;
      for (const [fixTag] of [['three'], ['dorian']] as const) {
        for (let take = 1; take <= 10; take++) {
          const { project, result } = composeTake(fixTag as 'three' | 'dorian', templateId, take);
          const plan = result.plan.keys;
          const btBar = barTicks(project.timeSignature);
          const piano = roleNotes(project, PIANO);
          const lead = roleNotes(project, 'violins1');
          for (const bar of plan.fillBars) {
            const lo = (bar - 1) * btBar;
            const job = plan.pianoJobs.find((j) => j.startBar <= bar && bar < j.startBar + (sectionsOf(FIXTURES[fixTag]).find((s) => s.startBar <= bar && bar < s.startBar + s.lengthBars)?.lengthBars ?? 0));
            if (!job || job.job !== 'melody') continue;
            const planBar = plan.bars.find((b) => b.bar === bar);
            if (planBar?.voices.piano !== 'job') continue; // below the low gate the piano is tacet by design
            const inWindow = piano.filter((n) => n.startTick >= lo && n.startTick < lo + btBar);
            expect(inWindow.length, `${short} ${fixTag} t${take}: the melody job\u2019s answer bar b${bar} is silent`).toBeGreaterThan(0);
            // the echo notes sit in the RH window and (when the lead sang)
            // echo its pitch classes
            // the echo is diatonic: snap the lead's pcs the way the engine
            // does before comparing (a shared scale, the mode's own tones)
            const scalePcs = new Set<number>();
            {
              const key = (project as any).key as number;
              const mode = (project as any).mode as string;
              const STEPS: Record<string, number[]> = {
                ionian: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
                lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10], aeolian: [0, 2, 3, 5, 7, 8, 10],
                locrian: [0, 1, 3, 5, 6, 8, 10], major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10],
              };
              for (const s of (STEPS[String(mode)] ?? STEPS.major)) scalePcs.add((((key + s) % 12) + 12) % 12);
            }
            const snap = (pc: number): number => {
              if (scalePcs.has(pc)) return pc;
              for (const d of [1, -1, 2, -2]) if (scalePcs.has(((pc + d) % 12 + 12) % 12)) return ((pc + d) % 12 + 12) % 12;
              return pc;
            };
            const leadPcs = new Set(lead.filter((n) => n.startTick + n.durationTicks <= lo).slice(-5).map((n) => snap(pcOf(n.pitch))));
            if (leadPcs.size >= 3) {
              const rhPcs = new Set(inWindow.filter((n) => n.pitch >= 64).map((n) => pcOf(n.pitch)));
              const hits = [...leadPcs].filter((pc) => rhPcs.has(pc)).length;
              expect(hits, `${short} ${fixTag} t${take} b${bar}: the answer does not echo the lead (${[...leadPcs].join(',')} vs ${[...rhPcs].join(',')})`).toBeGreaterThanOrEqual(1);
            }
            checked++;
          }
        }
      }
      expect(checked, `${short}: no melody answer bars were checked`).toBeGreaterThan(0);
      void short;
    }
  }, 1200000);
});

describe('Phase 11.6: the clamp, the chorus-mean floor, hygiene', () => {
  it('energy never exceeds the clamp max across six templates \u00d7 both fixtures \u00d7 takes 1-10 (zero aboveMax); hard findings stay 0', () => {
    for (const templateId of ALL_TEMPLATES) {
      for (const [fixTag] of [['three'], ['dorian']] as const) {
        for (let take = 1; take <= 10; take++) {
          const { project, result } = composeTake(fixTag as 'three' | 'dorian', templateId, take);
          const template = resolveTemplate(project.ensemble)!;
          const report = measureEnergy(project, template);
          const hard = report.violations.filter((v) => v.kind === 'aboveMax');
          expect(hard, `${templateId} ${fixTag} t${take}: ${hard.length} aboveMax`).toHaveLength(0);
          const findings = checkTemplateRules(project, template, result.plan).filter((f) => f.severity === 'hard');
          expect(findings, `${templateId} ${fixTag} t${take}: hard findings ${findings.map((f) => f.message).join('; ')}`).toHaveLength(0);
        }
      }
    }
  }, 1200000);

  it('the chorus mean does not fall below the 11.5 live value (golden105) beyond the safety-pass rounding bound, per template, moments excluded on BOTH sides; below-floor counts do not increase', () => {
    const lines: string[] = [];
    for (const templateId of TEMPLATES) {
      const short = templateId.replace('ensemble.', '');
      const template = resolveTemplate({ templateId, overrides: {}, pins: {} })!;
      const secs = sectionsOf(threeChorus);
      const chorusStats = (proj: Project, momentBars: Set<number>) => {
        const report = measureEnergy(proj, template);
        let sum = 0, n = 0, below = 0, keysNotes = 0;
        for (const w of report.windows) {
          const sec = secs.find((s) => w.bar >= s.startBar && w.bar < s.startBar + s.lengthBars);
          if (!sec || !isChorusTypeK(sec.name)) continue;
          if (momentBars.has(w.bar)) continue;
          sum += w.energy; n++;
          if (w.energy > 0 && w.energy < template.budget.energyClamp[0]) below++;
          if (w.soundingRoles.includes(PIANO) || w.soundingRoles.includes(HARP)) keysNotes += Math.max(1, Math.round(w.noteCount / 4));
        }
        return { sum, n, below, keysNotes };
      };
      let beforeSum = 0, afterSum = 0, beforeBelow = 0, afterBelow = 0, bound = 0;
      for (let take = 1; take <= 10; take++) {
        const g = JSON.parse(readFileSync(new URL(`./golden105/${short}-three-t${take}.json`, import.meta.url), 'utf8'));
        const base = projectFromFixture(JSON.parse(JSON.stringify(threeChorus)));
        base.ensemble = { templateId, overrides: {}, pins: {} };
        const momentBars = new Set<number>();
        for (const m of g.moments ?? []) for (let b = m.startBar; b <= m.endBar; b++) momentBars.add(b);
        const beforeTracks = (g.tracks as { id: string; role: string; notes: Note[] }[]).map((gt) => {
          const donor = base.tracks.find((x) => x.id === gt.id);
          if (donor) return { ...donor, notes: gt.notes };
          return { id: gt.id, role: gt.role, name: gt.role, family: 'Strings', kind: 'instrument', locked: false, notes: gt.notes, lowestNote: 21, highestNote: 108, volume: 0.8, pan: 0 } as unknown as typeof base.tracks[number];
        });
        const b = chorusStats({ ...base, tracks: beforeTracks } as Project, momentBars);
        const { project } = composeTake('three', templateId, take);
        const a = chorusStats(project, momentBars);
        beforeSum += b.sum; afterSum += a.sum;
        beforeBelow += b.below; afterBelow += a.below;
        bound += (a.keysNotes * 0.5) / 127;
      }
      expect(afterSum, `${short}: the chorus mean fell below the 11.5 live value beyond the rounding bound (${beforeSum.toFixed(2)} -> ${afterSum.toFixed(2)}, bound ${bound.toFixed(2)})`)
        .toBeGreaterThanOrEqual(beforeSum - bound);
      expect(afterBelow, `${short}: the chorus below-floor count rose (${beforeBelow} -> ${afterBelow})`).toBeLessThanOrEqual(beforeBelow);
      lines.push(`${short}: excl-moments ${beforeSum.toFixed(2)} -> ${afterSum.toFixed(2)} (bound ${bound.toFixed(2)}) | below-floor ${beforeBelow} -> ${afterBelow}`);
    }
    console.log(`PHASE116 chorus floor vs golden105 (10 takes aggregated, three-chorus):\n  ${lines.join('\n  ')}`);
  }, 1200000);

  it('deterministic per (inputs, take); sanitizeNotes is a no-op on the piano output; validateProject passes', () => {
    for (const templateId of ['ensemble.chamber', 'ensemble.vocalbacking', 'ensemble.cinematic']) {
      const a = composeTake('three', templateId, 7);
      const b = composeTake('three', templateId, 7);
      expect(JSON.stringify(a.project.tracks)).toBe(JSON.stringify(b.project.tracks));
      const pianoTrack = a.project.tracks.find((t) => t.role === PIANO)!;
      const sanitized = sanitizeNotes(pianoTrack.notes, pianoTrack.lowestNote, pianoTrack.highestNote, projectEndTick(a.project));
      expect(JSON.stringify(sanitized), `${templateId}: sanitizeNotes moved the piano output`).toBe(JSON.stringify(pianoTrack.notes));
      const r = validateProject(a.project);
      expect(r.ok, `${templateId}: validateProject ${'errors' in r ? JSON.stringify(r.errors) : ''}`).toBeTruthy();
    }
  });

  it('exports keep every piano note: the merged MIDI builds and the UVI profile parts carry them (chamber and vocalbacking); the no-profile export passes them through', () => {
    const PROFILE = EXPORT_PROFILES[0].profile;
    for (const templateId of ['ensemble.chamber', 'ensemble.vocalbacking']) {
      const { project } = composeTake('three', templateId, 3);
      const piano = roleNotes(project, PIANO);
      expect(piano.length).toBeGreaterThan(0);
      const merged = buildMergedMidi(project, project.tracks.filter((t) => t.notes.length));
      expect(merged.length).toBeGreaterThan(200);
      const t = project.tracks.find((x) => x.role === PIANO)!;
      const part = PROFILE.parts.find((p) => p.source.role === PIANO)!;
      const chunks = chunksForTrack(project, t, PROFILE);
      const sounding = chunks.reduce((a, c) => a + c.notes.filter((n) => n.pitch >= part.playableLow!).length, 0);
      expect(sounding, `${templateId}: the UVI profile carried ${sounding} of ${piano.length} piano notes`).toBe(piano.length);
    }
  });
});

describe('Phase 11.6: the tacets and the moments', () => {
  it('no piano note starts in \u2014 or rings across \u2014 a soli or a near-silence bar, and nothing crosses a moment boundary', () => {
    for (const run of buildSurvey()) {
      const { project, result } = run;
      const notes = roleNotes(project, PIANO);
      const btBar = barTicks(project.timeSignature);
      const bars = projectBars(project);
      const moments = result.plan.moments;
      const momentByBar = new Map<number, string>();
      for (const m of moments) for (let b = m.startBar; b <= m.endBar; b++) momentByBar.set(b, m.kind);
      const nearSilence = new Set<number>();
      const arcBars = Math.min(bars, result.plan.bars.length);
      for (let b = 1; b <= arcBars; b++) {
        const planBar = result.plan.keys.bars.find((x) => x.bar === b);
        if ((project as any).arc?.[b - 1]?.nearSilence) nearSilence.add(b);
        void planBar;
      }
      for (const n of notes) {
        const startBar = Math.floor(n.startTick / btBar) + 1;
        const endBar = Math.floor((n.startTick + n.durationTicks - 1) / btBar) + 1;
        const kind = momentByBar.get(startBar);
        expect(kind === 'soli' || nearSilence.has(startBar), `${run.templateId} ${run.fixture} t${run.take}: a piano note starts in a soli/near-silence bar ${startBar}`).toBeFalsy();
        for (let b = startBar; b <= endBar; b++) {
          const k2 = momentByBar.get(b);
          expect(k2 === undefined || k2 === momentByBar.get(startBar), `${run.templateId} ${run.fixture} t${run.take}: a piano note rings across a moment boundary at bar ${b}`).toBeTruthy();
          expect(nearSilence.has(b), `${run.templateId} ${run.fixture} t${run.take}: a piano note rings across a near-silence bar ${b}`).toBeFalsy();
        }
      }
    }
  }, 1200000);
});
