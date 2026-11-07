import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { checkTemplateRules, measureEnergy } from '../src/orchestrator/energy';
import { barTicks, projectBars } from '../src/shared/schema/meter';
import { sanitizeNotes } from '../src/engine/generate';
import { projectEndTick, projectFromFixture, validateProject, type Note, type Project } from '../src/shared/schema';
import { resolveTemplate } from '../src/config/ensembles';
import { inVocalZone } from '../src/orchestrator/profiles/strings';
import { momentForBar } from '../src/orchestrator/conductor/moments';
import { chunksForTrack } from '../src/export/profile';
import { EXPORT_PROFILES } from '../src/export/profiles';
import { buildMergedMidi } from '../src/export/midi';
import {
  HARP_FIGURE_MENU, PIANO_DRIVE_MENU, VB_LOW, VB_SPARKLE,
  type HarpFigure, type PianoPattern,
} from '../src/orchestrator/keys/profile';

/**
 * Phase 11.5 — keys figuration and harp variety (spec §16.5, §16.6). The
 * chorus is no longer only quarter-note block strikes: six rhythmic
 * figures rotate per chorus phrase (the block slots keep the relief
 * drive's own variants at the 25% cap), chord notes sustain to their
 * harmonic span or the bar line (pedal emulation by length, re-taken at
 * the half-bar line), the harp realises a per-section figure menu
 * (the balanced rotation offset from the piano's, the hash-phased two-bar
 * units), and the low register obeys the fifth-or-wider rule. Pinned
 * here: the byte-identity of every non-keys track against golden104, the
 * cinematic/hybridstudio piano pins, the vocal zone (piano AND harp), the
 * low-interval rule, the harp ergonomics, the figure coverage and the
 * caps, the note lengths and the ring boundaries, the clamp with zero
 * aboveMax and hard findings 0, the chorus-mean floor against golden104
 * (the 11.4 live value, the safety-pass rounding bound carried), the
 * determinism, sanitize/validate and the export passthrough.
 */
const TEMPLATES = ['ensemble.symphony', 'ensemble.chamber', 'ensemble.cinematic', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.hybridstudio'];
const MENU_TEMPLATES = ['ensemble.chamber', 'ensemble.sonata', 'ensemble.vocalbacking'];
const HARP_TEMPLATES = ['ensemble.symphony', 'ensemble.cinematic', 'ensemble.vocalbacking', 'ensemble.hybridstudio'];
const PIANO = 'piano';
const HARP = 'harp';
const KEYS_ROLES = new Set([PIANO, HARP]);

const THREE = (): Project => projectFromFixture(JSON.parse(JSON.stringify(threeChorus)));
const DORIAN = (): Project => projectFromFixture(JSON.parse(JSON.stringify(dorian)));

interface Run { templateId: string; take: number; fixture: string; project: Project; result: ReturnType<typeof composeAllTracks> }
const SURVEY: Run[] = [];
const composeTake = (fixture: 'three' | 'dorian', templateId: string, take: number, record = true) => {
  const p = fixture === 'three' ? THREE() : DORIAN();
  p.ensemble = { templateId, overrides: {}, pins: {} };
  p.orchestration = { take };
  const result = composeAllTracks(p, { seed: 11 });
  const project = { ...p, tracks: result.tracks, orchestration: result.orchestration } as Project;
  const run: Run = { templateId, take, fixture, project, result };
  if (record) SURVEY.push(run);
  return run;
};
for (const templateId of TEMPLATES) {
  for (let take = 1; take <= 10; take++) composeTake('three', templateId, take);
  for (let take = 1; take <= 10; take++) composeTake('dorian', templateId, take);
}

const sectionsOf = (doc: unknown): { name: string; startBar: number; lengthBars: number }[] =>
  (doc as { sections: { name: string; startBar: number; lengthBars: number }[] }).sections;
const isChorusName = (name: string): boolean => /chorus|refrain|hook|drop/.test(name.trim().toLowerCase());
const stableTrack = (t: { id: string; role: string; notes: unknown; cc?: unknown }) =>
  JSON.stringify({ id: t.id, role: t.role, notes: t.notes, ...(t.cc !== undefined ? { cc: t.cc } : {}) });

/* ---------------- 1. the byte pins ----------------------------------------- */

describe('Phase 11.5: the byte pins', () => {
  it('every non-keys track in all six templates is byte-identical to golden104 (the harp and the piano are the phase\u2019s own movers)', () => {
    for (const templateId of TEMPLATES) {
      const short = templateId.replace('ensemble.', '');
      for (const [fixTag, fixture] of [['three', 'three'], ['dorian', 'dorian']] as const) {
        for (let take = 1; take <= 10; take++) {
          const golden = JSON.parse(readFileSync(new URL(`./golden104/${short}-${fixTag}-t${take}.json`, import.meta.url), 'utf8'));
          const run = composeTake(fixture, templateId, take, false);
          const goldenTracks = golden.tracks.filter((t: { role: string }) => !KEYS_ROLES.has(t.role));
          const current = run.project.tracks.filter((t) => !KEYS_ROLES.has(t.role));
          expect(current.map(stableTrack), `${short} ${fixTag} t${take} moved a non-keys track against golden104`)
            .toEqual(goldenTracks.map(stableTrack));
        }
      }
    }
  }, 900000);

  it('cinematic and hybridstudio piano stay byte-identical to golden104 (no pattern change was requested; the measured velocity delta is zero)', () => {
    let velN = 0;
    for (const templateId of ['ensemble.cinematic', 'ensemble.hybridstudio']) {
      const short = templateId.replace('ensemble.', '');
      for (const [fixTag, fixture] of [['three', 'three'], ['dorian', 'dorian']] as const) {
        for (let take = 1; take <= 10; take++) {
          const golden = JSON.parse(readFileSync(new URL(`./golden104/${short}-${fixTag}-t${take}.json`, import.meta.url), 'utf8'));
          const run = composeTake(fixture, templateId, take, false);
          const goldPiano = golden.tracks.find((t: { role: string }) => t.role === PIANO);
          const piano = run.project.tracks.find((t) => t.role === PIANO);
          expect(stableTrack(piano!), `${short} ${fixTag} t${take}: the piano moved`).toBe(stableTrack(goldPiano));
          velN++;
        }
      }
    }
    console.log(`PHASE115 cinematic/hybridstudio piano pin: ${velN} runs byte-identical to golden104 (velocity delta 0)`);
  }, 900000);
});

/* ---------------- 2. the vocal zone and the low-interval rule --------------- */

describe('Phase 11.5: the vocal zone and the low register', () => {
  it('vocalbacking keeps ZERO piano AND harp notes inside 57-81 across all 20 runs (the figures live in the low band and the sparkle band)', () => {
    for (const run of SURVEY) {
      if (run.templateId !== 'ensemble.vocalbacking') continue;
      for (const role of [PIANO, HARP]) {
        const t = run.project.tracks.find((x) => x.role === role);
        for (const n of t?.notes ?? []) {
          expect(inVocalZone(n.pitch), `${run.fixture} t${run.take}: ${role} note ${n.pitch} inside the vocal zone`).toBe(false);
        }
      }
    }
  }, 900000);

  it('below MIDI 48 the piano and the harp use only fifth-or-wider intervals or single notes (no simultaneous pair with BOTH ends under 48 closer than a fifth, all six templates)', () => {
    let checked = 0;
    for (const run of SURVEY) {
      for (const role of [PIANO, HARP]) {
        const t = run.project.tracks.find((x) => x.role === role);
        if (!t || !t.notes.length) continue;
        checked++;
        const sorted = [...t.notes].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
        for (let i = 0; i < sorted.length; i++) {
          for (let j = i + 1; j < sorted.length; j++) {
            const A = sorted[i];
            const B = sorted[j];
            if (B.startTick >= A.startTick + A.durationTicks) break;
            if (B.startTick + B.durationTicks <= A.startTick) continue;
            const lo = Math.min(A.pitch, B.pitch);
            const hi = Math.max(A.pitch, B.pitch);
            expect(
              hi >= 48 || hi - lo >= 7,
              `${run.templateId} ${run.fixture} t${run.take}: ${role} pair ${lo}/${hi} gap ${hi - lo} both below 48`,
            ).toBe(true);
          }
        }
      }
    }
    expect(checked, 'no keys notes scanned').toBeGreaterThan(60);
  }, 900000);

  it('vocalbacking\u2019s piano low-band share (below 57) stays at or above 25% of its notes and the sparkle band no longer dominates', () => {
    let sparkle = 0;
    let low = 0;
    let total = 0;
    for (const run of SURVEY) {
      if (run.templateId !== 'ensemble.vocalbacking') continue;
      const piano = run.project.tracks.find((t) => t.role === PIANO);
      for (const n of piano?.notes ?? []) {
        total++;
        if (n.pitch >= 82) sparkle++;
        if (n.pitch < 57) low++;
      }
    }
    expect(total, 'no vocalbacking piano notes').toBeGreaterThan(0);
    expect(low / total, `the low band holds ${(100 * low / total).toFixed(1)}% of ${total} notes`).toBeGreaterThanOrEqual(0.25);
    console.log(`PHASE115 vocalbacking piano split (20 runs): sparkle(82+) ${(100 * sparkle / total).toFixed(1)}%, low(<57) ${(100 * low / total).toFixed(1)}%`);
  }, 900000);
});

/* ---------------- 3. the harp ergonomics ------------------------------------ */

describe('Phase 11.5: the harp ergonomics', () => {
  it('the harp sounds at most 8 simultaneous notes and never repeats a pitch inside a beat', () => {
    for (const run of SURVEY) {
      const harp = run.project.tracks.find((t) => t.role === HARP);
      if (!harp || !harp.notes.length) continue;
      const bt = barTicks(run.project.timeSignature);
      const beat = bt / 4;
      const sorted = [...harp.notes].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
      const onsets = [...new Set(sorted.map((n) => n.startTick))];
      for (const o of onsets) {
        let count = 0;
        for (const n of sorted) {
          if (n.startTick > o) break;
          if (n.startTick + n.durationTicks > o) count++;
        }
        expect(count, `${run.templateId} ${run.fixture} t${run.take}: ${count} simultaneous harp notes at tick ${o}`).toBeLessThanOrEqual(8);
      }
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const A = sorted[i];
          const B = sorted[j];
          if (B.pitch !== A.pitch) continue;
          if (B.startTick >= A.startTick + A.durationTicks) break;
          if (B.startTick + B.durationTicks <= A.startTick) continue;
          const sameBeat = Math.floor(A.startTick / beat) === Math.floor(B.startTick / beat)
            && Math.floor(A.startTick / bt) === Math.floor(B.startTick / bt);
          expect(sameBeat, `${run.templateId} ${run.fixture} t${run.take}: the harp pitch ${A.pitch} twice inside one beat`).toBe(false);
        }
      }
    }
  }, 900000);
});

/* ---------------- 4. the chorus piano figures ------------------------------- */

describe('Phase 11.5: the chorus piano figures', () => {
  it('at least 3 distinct rhythmic figures realise per template, and the block drive stays at most 25% of the chorus bars (realized)', () => {
    const FIGURES: PianoPattern[] = ['figRoll', 'figBroken', 'figAlberti', 'figSyncopate', 'figTopVoice', 'figOctavePulse'];
    for (const templateId of MENU_TEMPLATES) {
      const short = templateId.replace('ensemble.', '');
      const byFigure = new Map<string, number>();
      let blockBars = 0;
      let totalBars = 0;
      for (const run of SURVEY) {
        if (run.templateId !== templateId) continue;
        const bt = barTicks(run.project.timeSignature);
        const bars = run.result.plan.keys.bars.length;
        const piano = run.project.tracks.find((t) => t.role === PIANO);
        const secs = sectionsOf(run.fixture === 'three' ? threeChorus : dorian);
        for (const sec of secs) {
          if (!isChorusName(sec.name)) continue;
          const figs = run.result.plan.keys.chorusFigures.find((e) => e.startBar === sec.startBar)?.figures ?? [];
          const nPhrases = Math.max(1, Math.ceil(sec.lengthBars / 4));
          for (let ph = 0; ph < nPhrases; ph++) {
            const fig = figs[ph] ?? '?';
            const b0 = sec.startBar + ph * 4;
            const b1 = Math.min(b0 + 4, sec.startBar + sec.lengthBars);
            let sounded = false;
            for (const n of piano?.notes ?? []) {
              const bar = Math.floor(n.startTick / bt) + 1;
              if (bar >= b0 && bar < b1 && bar <= bars) { sounded = true; break; }
            }
            if (!sounded) continue;
            byFigure.set(fig, (byFigure.get(fig) ?? 0) + (b1 - b0));
            totalBars += b1 - b0;
            if (!FIGURES.includes(fig as PianoPattern)) blockBars += b1 - b0;
          }
        }
      }
      const distinct = [...byFigure.keys()].filter((f) => FIGURES.includes(f as PianoPattern)).length;
      expect(distinct, `${templateId}: only ${distinct} distinct rhythmic figures realised (${[...byFigure.entries()].map(([k, v]) => `${k} ${v}`).join(', ')})`).toBeGreaterThanOrEqual(3);
      const share = blockBars / Math.max(1, totalBars);
      expect(share, `${templateId}: the block drive holds ${(100 * share).toFixed(1)}% of the chorus bars`).toBeLessThanOrEqual(0.25);
      console.log(`PHASE115 ${short} chorus figures: ${[...byFigure.entries()].sort().map(([k, v]) => `${k} ${v}`).join(', ')} | block ${(100 * share).toFixed(1)}%`);
    }
  }, 900000);

  it('the chorus figure rotation changes at phrase level: consecutive phrases never repeat, and a multi-phrase chorus always uses two or more figures', () => {
    for (const run of SURVEY) {
      if (!MENU_TEMPLATES.includes(run.templateId)) continue;
      const secs = sectionsOf(run.fixture === 'three' ? threeChorus : dorian);
      for (const sec of secs) {
        if (!isChorusName(sec.name)) continue;
        const figs = run.result.plan.keys.chorusFigures.find((e) => e.startBar === sec.startBar)?.figures ?? [];
        for (let ph = 1; ph < figs.length; ph++) {
          expect(figs[ph], `${run.templateId} ${run.fixture} t${run.take}: chorus at b${sec.startBar} repeats ${figs[ph]} across phrases ${ph - 1}/${ph}`).not.toBe(figs[ph - 1]);
        }
        if (sec.lengthBars >= 4 && figs.length >= 2) {
          expect(new Set(figs).size, `${run.templateId} ${run.fixture} t${run.take}: a ${sec.lengthBars}-bar chorus uses one figure`).toBeGreaterThanOrEqual(2);
        }
      }
    }
  }, 900000);
});

/* ---------------- 5. the harp figures --------------------------------------- */

describe('Phase 11.5: the harp figures', () => {
  interface UnitRead { type: string; figure: HarpFigure | '?'; sounded: boolean }
  const harpUnits = (run: Run): UnitRead[] => {
    const bt = barTicks(run.project.timeSignature);
    const bars = run.result.plan.keys.bars.length;
    const harp = run.project.tracks.find((t) => t.role === HARP);
    const secs = sectionsOf(run.fixture === 'three' ? threeChorus : dorian);
    const out: UnitRead[] = [];
    for (const sec of secs) {
      const figs = run.result.plan.keys.harpFigures.find((e) => e.startBar === sec.startBar)?.figures ?? [];
      const nUnits = Math.max(1, Math.ceil(sec.lengthBars / 2));
      for (let u = 0; u < nUnits; u++) {
        const b0 = sec.startBar + u * 2;
        const b1 = Math.min(b0 + 2, sec.startBar + sec.lengthBars);
        let sounded = false;
        for (const n of harp?.notes ?? []) {
          const bar = Math.floor(n.startTick / bt) + 1;
          if (bar >= b0 && bar < b1 && bar <= bars) { sounded = true; break; }
        }
        out.push({ type: sec.name.trim().toLowerCase(), figure: figs[u] ?? '?', sounded });
      }
    }
    return out;
  };

  it('every menu figure realises at least once per harp template over the 20 runs', () => {
    for (const templateId of HARP_TEMPLATES) {
      const realized = new Set<string>();
      for (const run of SURVEY) {
        if (run.templateId !== templateId) continue;
        for (const u of harpUnits(run)) if (u.sounded) realized.add(u.figure);
      }
      const missing = HARP_FIGURE_MENU.filter((f) => !realized.has(f));
      expect(missing, `${templateId}: unrealised harp figures ${missing.join(', ')} (realized: ${[...realized].sort().join(', ')})`).toEqual([]);
    }
  }, 900000);

  it('each section type\u2019s most frequent realised harp figure stays at or under 40%', () => {
    for (const templateId of HARP_TEMPLATES) {
      const byType = new Map<string, Map<string, number>>();
      for (const run of SURVEY) {
        if (run.templateId !== templateId) continue;
        for (const u of harpUnits(run)) {
          if (!u.sounded) continue;
          if (!byType.has(u.type)) byType.set(u.type, new Map());
          const m = byType.get(u.type)!;
          m.set(u.figure, (m.get(u.figure) ?? 0) + 1);
        }
      }
      for (const [type, m] of [...byType.entries()].sort()) {
        const total = [...m.values()].reduce((a, b) => a + b, 0);
        const [top, topN] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
        expect(topN / total, `${templateId} ${type}: ${top} realises ${topN}/${total} (over the 40% cap)`).toBeLessThanOrEqual(0.4);
        console.log(`PHASE115 harp ${templateId.replace('ensemble.', '')} ${type}: top ${top} ${topN}/${total}, distinct ${m.size}/9`);
      }
    }
  }, 900000);

  it('distinct realised harp sequences are at least 12 of 20 runs per harp template', () => {
    for (const templateId of HARP_TEMPLATES) {
      const sequences = new Set<string>();
      for (const run of SURVEY) {
        if (run.templateId !== templateId) continue;
        const seq = harpUnits(run).filter((u) => u.sounded).map((u) => `${u.type}:${u.figure}`).join(' ');
        if (seq) sequences.add(seq);
      }
      expect(sequences.size, `${templateId}: only ${sequences.size} distinct realised harp sequences over 20 runs`).toBeGreaterThanOrEqual(12);
      console.log(`PHASE115 ${templateId.replace('ensemble.', '')}: ${sequences.size}/20 distinct realised harp sequences`);
    }
  }, 900000);

  it('in the chorus the harp uses a different figure from the verse in the same take, and a chorus of at least 4 bars realises at least 2 figures', () => {
    let checked = 0;
    for (const run of SURVEY) {
      if (!HARP_TEMPLATES.includes(run.templateId)) continue;
      const bt = barTicks(run.project.timeSignature);
      const harp = run.project.tracks.find((t) => t.role === HARP);
      const soundedBars = new Set<number>((harp?.notes ?? []).map((n) => Math.min(run.result.plan.keys.bars.length, Math.floor(n.startTick / bt) + 1)));
      const secs = sectionsOf(run.fixture === 'three' ? threeChorus : dorian);
      const verseFig = run.result.plan.keys.harpFigures.find((e) => secs.some((s) => s.startBar === e.startBar && !isChorusName(s.name)))?.figures?.[0];
      for (const sec of secs) {
        if (!isChorusName(sec.name) || sec.lengthBars < 4) continue;
        const figs = run.result.plan.keys.harpFigures.find((e) => e.startBar === sec.startBar)?.figures ?? [];
        const units = harpUnits(run).filter((u) => u.type === sec.name.trim().toLowerCase());
        const soundedFigures = new Set(units.filter((u) => u.sounded).map((u) => u.figure));
        if (soundedBars.size && soundedFigures.size) {
          expect(soundedFigures.has(verseFig as HarpFigure) && soundedFigures.size === 1 && verseFig === figs[0],
            `${run.templateId} ${run.fixture} t${run.take}: the chorus repeats the verse's figure only`).toBe(false);
          checked++;
        }
        if (figs.length >= 2) {
          expect(new Set(figs).size, `${run.templateId} ${run.fixture} t${run.take}: a ${sec.lengthBars}-bar chorus draws one figure`).toBeGreaterThanOrEqual(2);
        }
      }
    }
    expect(checked, 'no chorus harp figure pairs checked').toBeGreaterThan(0);
  }, 900000);
});

/* ---------------- 6. the note lengths and the ring boundaries ---------------- */

describe('Phase 11.5: the note lengths and the ring boundaries', () => {
  it('no keys note rings longer than one bar, none rings across a tacet, soli or near-silence bar, and nothing crosses a moment boundary', () => {
    for (const run of SURVEY) {
      const template = resolveTemplate(run.project.ensemble)!;
      const bt = barTicks(run.project.timeSignature);
      const bars = projectBars(run.project);
      const moments = run.result.plan.moments ?? [];
      for (const role of [PIANO, HARP]) {
        const t = run.project.tracks.find((x) => x.role === role);
        for (const n of t?.notes ?? []) {
          expect(n.durationTicks, `${run.templateId} ${run.fixture} t${run.take}: ${role} note ${n.pitch} rings ${n.durationTicks} > 1 bar`).toBeLessThanOrEqual(bt);
          const startBar = Math.floor(n.startTick / bt) + 1;
          const endTick = n.startTick + n.durationTicks;
          for (let b = startBar + 1; b <= bars; b++) {
            if ((b - 1) * bt >= endTick) break;
            const m = momentForBar(moments, b);
            // the arc's near-silence bar rides the conductor plan as a
            // whole-section breath marked nearSilence
            const near = run.result.plan.breaths.some((br) => br.nearSilence && br.startTick <= (b - 1) * bt && br.endTick >= b * bt);
            expect(
              m === null && !near,
              `${run.templateId} ${run.fixture} t${run.take}: ${role} note ${n.pitch} rings into bar ${b} (${m?.kind ?? 'near-silence'})`,
            ).toBe(true);
          }
        }
      }
      void template;
    }
  }, 900000);
});

/* ---------------- 7. the clamp, the chorus-mean floor, hygiene --------------- */

describe('Phase 11.5: the clamp, the chorus-mean floor, hygiene', () => {
  it('energy never exceeds the clamp max across six templates \u00d7 both fixtures \u00d7 takes 1-10 (zero aboveMax); hard findings stay 0', () => {
    for (const run of SURVEY) {
      const template = resolveTemplate(run.project.ensemble)!;
      const report = measureEnergy(run.project, template);
      const hard = report.violations.filter((v) => v.kind === 'aboveMax');
      expect(hard, `${run.templateId} ${run.fixture} t${run.take}: ${hard.length} aboveMax`).toHaveLength(0);
      const findings = checkTemplateRules(run.project, template, run.result.plan).filter((f) => f.severity === 'hard');
      expect(findings, `${run.templateId} ${run.fixture} t${run.take}: hard findings ${findings.map((f) => f.message).join('; ')}`).toHaveLength(0);
    }
  }, 900000);

  it('the chorus mean does not fall below the 11.4 live value (golden104) beyond the safety-pass rounding bound, per template, moments excluded on BOTH sides; below-floor counts do not increase', () => {
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
          if (!sec || !isChorusName(sec.name)) continue;
          if (momentBars.has(w.bar)) continue;
          sum += w.energy; n++;
          if (w.energy > 0 && w.energy < template.budget.energyClamp[0]) below++;
          if (w.soundingRoles.includes(PIANO) || w.soundingRoles.includes(HARP)) keysNotes += Math.max(1, Math.round(w.noteCount / 4));
        }
        return { sum, n, below, keysNotes };
      };
      let beforeSum = 0, afterSum = 0, beforeBelow = 0, afterBelow = 0, bound = 0;
      for (let take = 1; take <= 10; take++) {
        const g = JSON.parse(readFileSync(new URL(`./golden104/${short}-three-t${take}.json`, import.meta.url), 'utf8'));
        const base = THREE();
        base.ensemble = { templateId, overrides: {}, pins: {} };
        const momentBars = new Set<number>();
        for (const m of g.moments ?? []) for (let b = m.startBar; b <= m.endBar; b++) momentBars.add(b);
        const beforeTracks = (g.tracks as { id: string; role: string; notes: Note[] }[]).map((gt) => {
          const donor = base.tracks.find((x) => x.id === gt.id);
          if (donor) return { ...donor, notes: gt.notes };
          return {
            id: gt.id, role: gt.role, name: gt.role, family: 'Strings',
            kind: 'instrument', locked: false, notes: gt.notes,
            lowestNote: 21, highestNote: 108, volume: 0.8, pan: 0,
          } as unknown as typeof base.tracks[number];
        });
        const b = chorusStats({ ...base, tracks: beforeTracks } as Project, momentBars);
        const { project } = composeTake('three', templateId, take, false);
        const a = chorusStats(project, momentBars);
        beforeSum += b.sum; afterSum += a.sum;
        beforeBelow += b.below; afterBelow += a.below;
        bound += (a.keysNotes * 0.5) / 127;
      }
      expect(afterSum, `${short}: the chorus mean fell below the 11.4 live value beyond the safety-pass rounding bound (${beforeSum.toFixed(2)} -> ${afterSum.toFixed(2)}, bound ${bound.toFixed(2)})`)
        .toBeGreaterThanOrEqual(beforeSum - bound);
      expect(afterBelow, `${short}: the chorus below-floor count rose (${beforeBelow} -> ${afterBelow})`).toBeLessThanOrEqual(beforeBelow);
      lines.push(`${short}: excl-moments ${beforeSum.toFixed(2)} -> ${afterSum.toFixed(2)} (bound ${bound.toFixed(2)}) | below-floor ${beforeBelow} -> ${afterBelow}`);
    }
    console.log(`PHASE115 chorus floor vs golden104 (10 takes aggregated, three-chorus):\n  ${lines.join('\n  ')}`);
  }, 900000);

  it('deterministic per (inputs, take); sanitizeNotes is a no-op on the keys output; validateProject passes', () => {
    for (const templateId of ['ensemble.chamber', 'ensemble.vocalbacking', 'ensemble.symphony']) {
      const a = composeTake('three', templateId, 7, false);
      const b = composeTake('three', templateId, 7, false);
      expect(JSON.stringify(a.project.tracks)).toBe(JSON.stringify(b.project.tracks));
      for (const role of [PIANO, HARP]) {
        const t = a.project.tracks.find((x) => x.role === role);
        if (t && t.notes.length) {
          expect(sanitizeNotes(t.notes, t.lowestNote, t.highestNote, projectEndTick(a.project))).toEqual(t.notes);
        }
      }
      expect(validateProject(JSON.parse(JSON.stringify(a.project))).ok).toBe(true);
    }
  }, 600000);

  it('exports keep every keys note: the merged MIDI builds and the UVI profile drop nothing on chamber and vocalbacking', () => {
    const PROFILE = EXPORT_PROFILES[0].profile;
    for (const templateId of ['ensemble.chamber', 'ensemble.vocalbacking']) {
      const { project } = composeTake('three', templateId, 3, false);
      expect(validateProject(JSON.parse(JSON.stringify(project))).ok).toBe(true);
      const merged = buildMergedMidi(project, project.tracks.filter((t) => t.notes.length));
      expect(merged.length).toBeGreaterThan(200);
      for (const role of [PIANO, HARP]) {
        const t = project.tracks.find((x) => x.role === role);
        if (!t || !t.notes.length) continue;
        const total = chunksForTrack(project, t, PROFILE).reduce((a2, c) => a2 + c.notes.length, 0);
        expect(total, `${templateId}: ${role} lost notes in the profile export`).toBe(t.notes.length);
      }
    }
  }, 600000);
});

void PIANO_DRIVE_MENU;
void VB_SPARKLE;
void VB_LOW;
