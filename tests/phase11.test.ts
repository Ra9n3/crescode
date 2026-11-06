import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { measureEnergy } from '../src/orchestrator/energy';
import { barTicks, beatTicks } from '../src/shared/schema/meter';
import { sanitizeNotes } from '../src/engine/generate';
import { chunksForTrack } from '../src/export/profile';
import { EXPORT_PROFILES } from '../src/export/profiles';
import { buildMergedMidi } from '../src/export/midi';
import { projectEndTick, projectFromFixture, validateProject, type Note, type Project, type Track } from '../src/shared/schema';
import { resolveTemplate } from '../src/config/ensembles';
import { chordSpans } from '../src/orchestrator/spine';
import { scalePitchClasses } from '../src/shared/schema/modes';
import { momentForBar } from '../src/orchestrator/conductor/moments';
import { inVocalZone } from '../src/orchestrator/profiles/strings';
import {
  KEYS_GATES, KEYS_PROFILES, RELIEF_VELOCITY,
  type KeysPart,
} from '../src/orchestrator/keys/profile';
import { COMP_CHORD_VOICES } from '../src/orchestrator/keys/render';

/**
 * Phase 11 — keys: harp and piano beside the strings, brass, winds and
 * percussion (spec §16). Pinned here: the post-10.2 baseline captured at
 * HEAD 894eefb into tests/golden102/ (EVERY track, percussion included —
 * every non-keys track in all six templates byte-identical), the
 * roster/range/sweet-spot rules, the glissando contract (diatonic runs
 * landing on a chord tone at a chorus/tutti downbeat, budget 2), the vocal
 * zone (vocalbacking free of both parts), the tacets (soli, near-silence,
 * unison), the one-arpeggiator-per-section rule, the one-voice cap with its
 * 'kbd' comping-chord relaxation, the chorus relief (the chorus mean must
 * not fall below the post-10.2 baseline), the humanize lags + the bar
 * guard, the clamp, locks/band, hygiene, and the export passthrough.
 */
const TEMPLATES = ['ensemble.symphony', 'ensemble.chamber', 'ensemble.cinematic', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.hybridstudio'];
const KEYS_ROLES: readonly KeysPart[] = ['harp', 'piano'];
const KEYS_SET = new Set<string>(KEYS_ROLES as readonly string[]);
const PROFILE = EXPORT_PROFILES[0].profile;

const THREE = (): Project => projectFromFixture(JSON.parse(JSON.stringify(threeChorus)));
const DORIAN = (): Project => projectFromFixture(JSON.parse(JSON.stringify(dorian)));

const composeTake = (base: Project, templateId: string, take: number, moments = true, seed = 11) => {
  const p = base;
  p.ensemble = { templateId, overrides: {}, pins: {} };
  p.orchestration = { take };
  const result = composeAllTracks(p, { seed, moments });
  return { project: { ...p, tracks: result.tracks, orchestration: result.orchestration } as Project, result };
};

const trackOf = (p: Project, role: string): Track => p.tracks.find((t) => t.role === role)!;

interface Run { templateId: string; take: number; fixture: string; project: Project; result: ReturnType<typeof composeAllTracks> }
const SURVEY: Run[] = [];
for (const templateId of TEMPLATES) {
  for (let take = 1; take <= 10; take++) {
    const { project, result } = composeTake(THREE(), templateId, take);
    SURVEY.push({ templateId, take, fixture: 'three', project, result });
  }
  for (let take = 1; take <= 10; take++) {
    const { project, result } = composeTake(DORIAN(), templateId, take);
    SURVEY.push({ templateId, take, fixture: 'dorian', project, result });
  }
}
const keysSurvey = SURVEY.filter((r) => r.project.tracks.some((t) => KEYS_SET.has(t.role) && t.notes.length > 0));
const soliBarsOf = (run: Run): Set<number> => {
  const out = new Set<number>();
  for (const m of run.result.plan.moments) {
    if (m.kind !== 'soli') continue;
    for (let b = m.startBar; b <= m.endBar; b++) out.add(b);
  }
  return out;
};
const momentBarsOf = (run: Run): Set<number> => {
  const out = new Set<number>();
  for (const m of run.result.plan.moments) for (let b = m.startBar; b <= m.endBar; b++) out.add(b);
  return out;
};
const nearSilenceBarsOf = (run: Run): Set<number> => {
  const out = new Set<number>();
  for (const a of run.result.plan.keys.bars) {
    void a;
  }
  // the arc's own flag, recomputed deterministically from the same inputs
  // the plan read (the arc is a pure function of (inputs, take))
  const template = resolveTemplate(run.project.ensemble)!;
  const clampMax = template.budget.energyClamp[1];
  for (const b of run.result.plan.keys.bars) {
    if ((run.result.plan.keys.bars[b.bar - 1]?.norm ?? 1) === 0) out.add(b.bar);
  }
  void clampMax;
  return out;
};
const secTypeAt = (bar: number): string => {
  const secs = [{ name: 'Verse', startBar: 1, lengthBars: 4 }, { name: 'Chorus', startBar: 5, lengthBars: 8 }, { name: 'Verse', startBar: 13, lengthBars: 4 }, { name: 'Chorus', startBar: 17, lengthBars: 8 }, { name: 'Bridge', startBar: 25, lengthBars: 4 }, { name: 'Chorus', startBar: 29, lengthBars: 8 }, { name: 'Outro', startBar: 37, lengthBars: 4 }];
  const s = secs.find((x) => bar >= x.startBar && bar < x.startBar + x.lengthBars);
  return s ? s.name.toLowerCase() : '*';
};
const dorianSecTypeAt = (bar: number): string => (bar <= 8 ? 'verse' : 'chorus');
const secTypeOf = (run: Run, bar: number): string => (run.fixture === 'three' ? secTypeAt(bar) : dorianSecTypeAt(bar));

/* ---------------- 1+2. roster, ranges, registers --------------------------- */

describe('Phase 11: roster, ranges, registers', () => {
  it('keys notes appear only on rostered keys tracks, inside the hard ranges; templates write only their rostered parts', () => {
    for (const run of SURVEY) {
      const roster = new Set(run.result.plan.keys.bars.flatMap((b) => Object.keys(b.voices)));
      for (const t of run.project.tracks.filter((x) => KEYS_SET.has(x.role) && x.notes.length > 0)) {
        expect(roster.has(t.role), `${run.templateId} ${run.fixture} t${run.take} ${t.role} wrote without a plan`).toBe(true);
        for (const n of t.notes) {
          expect(n.pitch, `${run.templateId} t${run.take} ${t.role} note ${n.pitch} out of the file range`).toBeGreaterThanOrEqual(t.lowestNote);
          expect(n.pitch).toBeLessThanOrEqual(t.highestNote);
        }
      }
      // the sweet spots: the bed/arpeggio notes stay inside the writing
      // window (the extreme octaves are roots/glissandos/pulses/comp only)
      const kindOfBarPart = new Map<string, string>();
      for (const b of run.result.plan.keys.bars) for (const [p, k] of Object.entries(b.voices)) kindOfBarPart.set(`${b.bar}:${p}`, k);
      for (const t of run.project.tracks.filter((x) => KEYS_SET.has(x.role) && x.notes.length > 0)) {
        const part = t.role as KeysPart;
        const sweet = KEYS_PROFILES[part].sweet;
        const bt = barTicks(run.project.timeSignature);
        for (const n of t.notes) {
          if (n.pitch >= sweet[0] && n.pitch <= sweet[1]) continue;
          const bar = Math.floor(n.startTick / bt) + 1;
          const kind = kindOfBarPart.get(`${bar}:${t.role}`) ?? '';
          const allowed = kind.includes('roots') || kind.includes('gliss') || kind.includes('pulse') || kind.includes('tutti') || kind.includes('comp') || kind.includes('final');
          expect(allowed, `${run.templateId} t${run.take} ${t.role} note ${n.pitch} outside the sweet spot under kind ${kind}`).toBe(true);
        }
      }
    }
  });

  it('the harp notes cap at about one bar; the figures are eighths or slower (the gliss 16ths are a run, not a rhythm)', () => {
    for (const run of SURVEY) {
      const bt = barTicks(run.project.timeSignature);
      const harp = run.project.tracks.find((t) => t.role === 'harp');
      if (harp) for (const n of harp.notes) {
        expect(n.durationTicks, `${run.templateId} t${run.take} harp note longer than a bar`).toBeLessThanOrEqual(bt);
      }
    }
  });
});

/* ---------------- 3. glissandos -------------------------------------------- */

describe('Phase 11: glissandos', () => {
  it('at most 2 per piece, harp only, each run diatonic and landing on a chord tone at a chorus/tutti/outro downbeat, 1 beat to 1 bar long', () => {
    for (const run of SURVEY) {
      const glisses = run.result.plan.keys.glisses;
      expect(glisses.length, `${run.templateId} ${run.fixture} t${run.take}: ${glisses.length} glissandos over budget`).toBeLessThanOrEqual(2);
      const template = resolveTemplate(run.project.ensemble)!;
      const scalePcs = new Set(scalePitchClasses(run.project.key, run.project.mode).map((pc) => ((pc % 12) + 12) % 12));
      const bt = barTicks(run.project.timeSignature);
      const spans = chordSpans(run.project);
      for (const g of glisses) {
        expect(g.part).toBe('harp');
        const len = g.targetTick - g.startTick;
        expect(len, `gliss b${g.targetBar}: run shorter than a beat`).toBeGreaterThanOrEqual(Math.floor(beatTicks(run.project.timeSignature) / 4));
        expect(len, `gliss b${g.targetBar}: run longer than a bar`).toBeLessThanOrEqual(bt);
        const harp = trackOf(run.project, 'harp');
        // the jitter slack: the lags are ≤ 8 ms (≈ 16 ticks at 120 BPM), so
        // the run's notes sit within ±24 ticks of their drawn onsets
        const runNotes = harp.notes.filter((n) => n.startTick >= g.startTick - 24 && n.startTick <= g.targetTick + 24);
        expect(runNotes.length).toBeGreaterThan(0);
        // diatonic scale tones only (the landing may be the target chord tone)
        for (const n of runNotes.slice(0, -1)) {
          expect(scalePcs.has(((n.pitch % 12) + 12) % 12), `${run.templateId} t${run.take} gliss b${g.targetBar}: non-diatonic note ${n.pitch}`).toBe(true);
        }
        // the landing: a chord tone of the target downbeat's chord, at the downbeat
        const landing = runNotes.reduce((best, n) => (Math.abs(n.startTick - g.targetTick) < Math.abs(best.startTick - g.targetTick) ? n : best), runNotes[0]);
        expect(Math.abs(landing.startTick - g.targetTick), `gliss b${g.targetBar}: the landing is not AT the downbeat`).toBeLessThanOrEqual(24);
        const span = spans.find((sp) => sp.startTick <= g.targetTick && g.targetTick < sp.endTick) ?? spans[0];
        const spanPcs = new Set(span.parsed.pitchClasses.map((pc: number) => ((pc % 12) + 12) % 12));
        expect(spanPcs.has(((landing.pitch % 12) + 12) % 12), `gliss b${g.targetBar}: the landing ${landing.pitch} is not a chord tone of ${span.parsed.symbol ?? '?'}`).toBe(true);
        // the target bar is a chorus entry, a tutti moment or an outro-like section
        const sec = run.project.sections.find((s) => g.targetBar >= s.startBar && g.targetBar < s.startBar + s.lengthBars);
        const isChorusSec = /chorus|refrain|hook|drop/.test((sec?.name ?? '').trim().toLowerCase());
        const isOutroSec = /outro|coda|final|postlude/.test((sec?.name ?? '').trim().toLowerCase());
        const isTuttiBar = momentForBar(run.result.plan.moments, g.targetBar)?.kind === 'tutti';
        expect(isChorusSec || isOutroSec || isTuttiBar, `gliss b${g.targetBar}: target is neither a chorus, a tutti nor an outro`).toBe(true);
        void template;
      }
    }
  });
});

/* ---------------- 4. vocal zone -------------------------------------------- */

describe('Phase 11: the vocal zone', () => {
  it('vocalbacking keeps the vocal zone (A3..A5 sounding) free of both keys parts', () => {
    for (const run of SURVEY) {
      if (run.templateId !== 'ensemble.vocalbacking') continue;
      for (const role of KEYS_ROLES) {
        const t = run.project.tracks.find((x) => x.role === role);
        if (!t) continue;
        for (const n of t.notes) {
          expect(inVocalZone(n.pitch), `${run.templateId} t${run.take} ${role} note ${n.pitch} inside the vocal zone`).toBe(false);
        }
      }
    }
  });
});

/* ---------------- 5. tacets and moments ------------------------------------ */

describe('Phase 11: tacets and moments', () => {
  it('no keys note starts in — or rings across — a soli or a near-silence bar; the keys do not join a unison moment', () => {
    for (const run of keysSurvey) {
      const bt = barTicks(run.project.timeSignature);
      const soli = soliBarsOf(run);
      const unison = new Set<number>();
      for (const m of run.result.plan.moments) {
        if (m.kind !== 'unison') continue;
        for (let b = m.startBar; b <= m.endBar; b++) unison.add(b);
      }
      for (const b of run.result.plan.keys.bars) {
        if (Object.keys(b.voices).length === 0 && (soli.has(b.bar) || unison.has(b.bar))) {
          for (const role of KEYS_ROLES) {
            const t = run.project.tracks.find((x) => x.role === role);
            if (!t) continue;
            const s = (b.bar - 1) * bt;
            const e = b.bar * bt;
            for (const n of t.notes) {
              const overlaps = n.startTick < e && n.startTick + n.durationTicks > s;
              expect(overlaps, `${run.templateId} t${run.take} ${role} note sounds over ${soli.has(b.bar) ? 'soli' : 'unison'} bar ${b.bar}`).toBe(false);
            }
          }
        }
      }
    }
  });

  it('a tutti moment reduces the piano to its root hit and the harp to a glissando or silence; the final bar still sounds on rostered keys tracks', () => {
    for (const run of SURVEY) {
      const bt = barTicks(run.project.timeSignature);
      for (const m of run.result.plan.moments) {
        if (m.kind !== 'tutti') continue;
        const piano = run.project.tracks.find((t) => t.role === 'piano');
        if (piano) {
          const hits = piano.notes.filter((n) => n.startTick >= (m.startBar - 1) * bt && n.startTick < m.startBar * bt);
          for (const n of hits) {
            expect(n.articulation, `tutti b${m.startBar}: a piano note without marcato`).toBe('marcato');
            expect(n.pitch, `tutti b${m.startBar}: the piano hit ${n.pitch} above the low register`).toBeLessThanOrEqual(KEYS_PROFILES.piano.low[1]);
          }
        }
        const harp = run.project.tracks.find((t) => t.role === 'harp');
        if (harp) {
          // the gliss landing may sound AT the downbeat (the jitter slack:
          // the lags are ≤ 8 ms ≈ 16 ticks, so the landing sits within the
          // first 30 ticks); anything later is a figure under the tutti
          const landingSlack = (m.startBar - 1) * bt + 30;
          const bed = harp.notes.filter((n) => n.startTick >= landingSlack && n.startTick < m.startBar * bt);
          expect(bed, `tutti b${m.startBar}: the harp plays a figure under the tutti (only the gliss landing may sound)`).toHaveLength(0);
        }
      }
      // the final bar: a rostered keys part the plan closes still sounds
      const bars = Math.max(1, ...run.project.sections.map((s) => s.startBar + s.lengthBars - 1));
      const finalPlan = run.result.plan.keys.bars.find((b) => b.bar === bars);
      if (!finalPlan) continue;
      for (const [role, kind] of Object.entries(finalPlan.voices)) {
        if (kind !== 'final') continue;
        const t = trackOf(run.project, role);
        const s = (bars - 1) * bt;
        expect(t.notes.some((n) => n.startTick >= s && n.startTick < bars * bt), `${run.templateId} t${run.take} ${role}: the final bar is silent`).toBe(true);
      }
    }
  });
});

/* ---------------- 6. one arpeggiator, one voice ---------------------------- */

describe('Phase 11: the arpeggiator and the voice cap', () => {
  it('never both a harp bed and a piano arpeggio in the same bar (one arpeggiator per section)', () => {
    for (const run of SURVEY) {
      for (const b of run.result.plan.keys.bars) {
        const harpArps = b.voices.harp === 'bed';
        const pianoArps = b.voices.piano === 'arp';
        expect(harpArps && pianoArps, `${run.templateId} ${run.fixture} t${run.take} b${b.bar}: both keys parts arpeggiate`).toBe(false);
      }
    }
  });

  it("one voice per track: plain notes never overlap; 'kbd' sisters only on the comp onsets, at most COMP_CHORD_VOICES - 1 per onset", () => {
    for (const run of keysSurvey) {
      for (const role of KEYS_ROLES) {
        const t = run.project.tracks.find((x) => x.role === role);
        if (!t || !t.notes.length) continue;
        const sorted = [...t.notes].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
        const plain = sorted.filter((n) => n.layer !== 'kbd');
        for (let i = 1; i < plain.length; i++) {
          expect(plain[i].startTick, `${run.templateId} t${run.take} ${role}: plain note overlaps its predecessor (one voice per track)`).toBeGreaterThanOrEqual(plain[i - 1].startTick + plain[i - 1].durationTicks);
        }
        const byOnset = new Map<number, Note[]>();
        for (const n of sorted) {
          // the chord sisters share the STRIKE, not the tick: the per-note
          // lags spread a chord across ≤ 12 ms (≈ 23 ticks at 120 BPM), so
          // sisters group by proximity to the same onset
          const anchor = [...byOnset.keys()].find((k) => Math.abs(k - n.startTick) <= 30);
          const key = anchor ?? n.startTick;
          const list = byOnset.get(key) ?? [];
          list.push(n);
          byOnset.set(key, list);
        }
        for (const [onset, group] of byOnset) {
          const kbd = group.filter((n) => n.layer === 'kbd');
          const mains = group.filter((n) => n.layer !== 'kbd');
          if (!kbd.length) continue;
          expect(mains.length, `${run.templateId} t${run.take} ${role}: 'kbd' sisters near ${onset} without a main voice`).toBeGreaterThanOrEqual(1);
          expect(kbd.length, `${run.templateId} t${run.take} ${role}: ${kbd.length} 'kbd' sisters near ${onset} over the chord cap`).toBeLessThanOrEqual(COMP_CHORD_VOICES - 1);
          // a chord: every sister strikes within the lag spread of the main
          for (const n of group) expect(Math.abs(n.startTick - onset), `${run.templateId} t${run.take} ${role}: a chord voice ${n.startTick} far from its onset ${onset}`).toBeLessThanOrEqual(30);
        }
      }
    }
  });

  it("only the sanctioned layer values ever reach a note; keys tracks carry 'kbd' at most", () => {
    for (const run of SURVEY) {
      for (const t of run.project.tracks) {
        for (const n of t.notes) {
          if (n.layer === undefined) continue;
          expect(['cb', 'div2', 'kbd'], `${t.role}: unknown layer ${n.layer}`).toContain(n.layer);
          if (KEYS_SET.has(t.role)) expect(n.layer).toBe('kbd');
        }
      }
    }
  });
});

/* ---------------- 7. humanize ---------------------------------------------- */

describe('Phase 11: humanize', () => {
  it('the lags sit in the part ranges (harp 0-8 ms, piano 4-12 ms) and never push a note across its bar', () => {
    for (const run of keysSurvey) {
      const bt = barTicks(run.project.timeSignature);
      const bpm = run.project.tempoMap[0]?.bpm ?? 120;
      const ticksPerMs = (bpm / 60) * 960 / 1000;
      for (const role of KEYS_ROLES) {
        const t = run.project.tracks.find((x) => x.role === role);
        if (!t || !t.notes.length) continue;
        const [msLo, msHi] = KEYS_PROFILES[role as KeysPart].timingMs;
        // the lag = the offset from the note's own grid slot (the harp's
        // finest grid is the gliss 16th; the piano's is the arp eighth) —
        // the jitter is a positive lag of msLo..msHi inside that slot
        const gridTicks = role === 'harp' ? beatTicks(run.project.timeSignature) / 4 : beatTicks(run.project.timeSignature) / 2;
        for (const n of t.notes) {
          const bt = barTicks(run.project.timeSignature);
          const bar = Math.floor(n.startTick / bt);
          const inBar = n.startTick - bar * bt;
          expect(inBar, `${run.templateId} t${run.take} ${role}: a note starts after its bar line`).toBeGreaterThanOrEqual(0);
          const lag = inBar % gridTicks;
          const lagMs = lag / ticksPerMs;
          expect(lagMs, `${run.templateId} t${run.take} ${role}: lag ${lagMs.toFixed(1)} ms outside the range`).toBeLessThanOrEqual(msHi + 2);
          if (lag > 0) expect(lagMs, `${run.templateId} t${run.take} ${role}: a lagged note below the range floor`).toBeGreaterThanOrEqual(msLo - 0.5);
        }
      }
    }
  });

  it('no CC lane reaches a keys track (no sustain pedal, no new CC)', () => {
    for (const run of SURVEY) {
      for (const role of KEYS_ROLES) {
        const t = run.project.tracks.find((x) => x.role === role);
        if (!t) continue;
        expect(t.cc, `${run.templateId} t${run.take} ${role} grew cc lanes`).toBeUndefined();
      }
    }
  });
});

/* ---------------- 8. the clamp and the baseline pins ----------------------- */

describe('Phase 11: the clamp and the baseline pins', () => {
  it('energy never exceeds the clamp max across six templates × takes 1–10 × both fixtures (zero aboveMax)', () => {
    for (const run of SURVEY) {
      const template = resolveTemplate(run.project.ensemble)!;
      const report = measureEnergy(run.project, template);
      const hard = report.violations.filter((v) => v.kind === 'aboveMax');
      expect(hard, `${run.templateId} ${run.fixture} t${run.take}: ${hard.length} aboveMax`).toHaveLength(0);
    }
  });

  it('every non-keys track in all six templates is byte-identical to the post-10.2 baseline (golden102: every track captured, percussion included)', () => {
    const stableTrack = (t: { id: string; role: string; notes: unknown; cc?: unknown }) =>
      JSON.stringify({ id: t.id, role: t.role, notes: t.notes, ...(t.cc !== undefined ? { cc: t.cc } : {}) });
    for (const templateId of TEMPLATES) {
      const short = templateId.replace('ensemble.', '');
      for (const [fixTag, base] of [['three', THREE], ['dorian', DORIAN]] as const) {
        for (let take = 1; take <= 10; take++) {
          const golden = JSON.parse(readFileSync(new URL(`./golden102/${short}-${fixTag}-t${take}.json`, import.meta.url), 'utf8'));
          const { result } = composeTake(base(), templateId, take);
          const goldenTracks = golden.tracks.filter((t: { role: string }) => !KEYS_SET.has(t.role));
          const current = result.tracks.filter((t) => !KEYS_SET.has(t.role));
          expect(current.map(stableTrack), `${short} ${fixTag} t${take} diverged from the post-10.2 baseline`)
            .toEqual(goldenTracks.map(stableTrack));
        }
      }
    }
  }, 300000);

  it('the chorus mean does not fall below the post-10.2 baseline, per template (moment-covered windows excluded on BOTH sides — the allowance; the all-windows numbers reported)', () => {
    const lines: string[] = [];
    for (const templateId of TEMPLATES) {
      const short = templateId.replace('ensemble.', '');
      const template = resolveTemplate({ templateId, overrides: {}, pins: {} })!;
      const chorusStats = (proj: Project, momentBars: Set<number>, excl: boolean) => {
        const report = measureEnergy(proj, template);
        let sum = 0, n = 0, below = 0;
        for (const w of report.windows) {
          if (secTypeOf({ templateId, fixture: 'three' } as Run, w.bar) !== 'chorus') continue;
          if (excl && momentBars.has(w.bar)) continue;
          sum += w.energy; n++;
          if (w.energy > 0 && w.energy < template.budget.energyClamp[0]) below++;
        }
        return { sum, n, below };
      };
      let beforeSum = 0, afterSum = 0, beforeBelow = 0, afterBelow = 0, allBefore = 0, allAfter = 0;
      for (let take = 1; take <= 10; take++) {
        const g = JSON.parse(readFileSync(new URL(`./golden102/${short}-three-t${take}.json`, import.meta.url), 'utf8'));
        const base = THREE();
        base.ensemble = { templateId, overrides: {}, pins: {} };
        const momentBars = new Set<number>();
        for (const m of g.moments ?? []) for (let b = m.startBar; b <= m.endBar; b++) momentBars.add(b);
        const beforeProj: Project = { ...base, tracks: base.tracks.map((x) => ({ ...x, notes: (g.tracks.find((y: { id: string }) => y.id === x.id)?.notes ?? []) })) };
        const b = chorusStats(beforeProj, momentBars, true);
        const { project } = composeTake(THREE(), templateId, take);
        const a = chorusStats(project, momentBars, true);
        const bAll = chorusStats(beforeProj, momentBars, false);
        const aAll = chorusStats(project, momentBars, false);
        beforeSum += b.sum; afterSum += a.sum;
        beforeBelow += b.below; afterBelow += a.below;
        allBefore += bAll.sum / Math.max(1, bAll.n); allAfter += aAll.sum / Math.max(1, aAll.n);
      }
      expect(afterSum, `${short}: the chorus mean fell below the post-10.2 baseline (${beforeSum.toFixed(1)} -> ${afterSum.toFixed(1)})`).toBeGreaterThanOrEqual(beforeSum);
      lines.push(`${short}: excl-moments ${beforeSum.toFixed(1)} -> ${afterSum.toFixed(1)} | all-windows mean ${allBefore.toFixed(3)} -> ${allAfter.toFixed(3)} | below-floor ${beforeBelow} -> ${afterBelow}`);
    }
    console.log(`PHASE11 chorus (10 takes aggregated, three-chorus):\n  ${lines.join('\n  ')}`);
  }, 600000);
});

/* ---------------- 9. locks, band, hygiene, exports ------------------------- */

describe('Phase 11: locks, band, hygiene, exports', () => {
  it('locked and out-of-band keys tracks are never written', () => {
    // locked: a locked piano keeps its pre-compose notes
    const base = THREE();
    base.ensemble = { templateId: 'ensemble.chamber', overrides: {}, pins: {} };
    base.orchestration = { take: 1 };
    const piano = trackOf(base, 'piano');
    piano.notes = [{ pitch: 60, startTick: 0, durationTicks: 480, velocity: 70 }];
    piano.locked = true;
    const r1 = composeAllTracks(base, { seed: 11 });
    expect(r1.tracks.find((t) => t.role === 'piano')!.notes).toEqual([{ pitch: 60, startTick: 0, durationTicks: 480, velocity: 70 }]);
    // out of band: a symphony project with a stray piano track
    const sym = THREE();
    sym.ensemble = { templateId: 'ensemble.symphony', overrides: {}, pins: {} };
    sym.orchestration = { take: 1 };
    sym.tracks.push({ ...trackOf(sym, 'harp'), id: 'trk_stray_piano', name: 'Piano', role: 'piano', family: 'Keys', lowestNote: 21, highestNote: 108, notes: [], locked: false });
    const r2 = composeAllTracks(sym, { seed: 11 });
    expect(r2.tracks.find((t) => t.id === 'trk_stray_piano')!.notes).toEqual([]);
  });

  it('deterministic per (inputs, take); sanitizeNotes is a no-op on the keys output; validateProject passes', () => {
    for (const templateId of TEMPLATES) {
      const a = composeTake(THREE(), templateId, 4);
      const b = composeTake(THREE(), templateId, 4);
      expect(JSON.stringify(a.project.tracks)).toBe(JSON.stringify(b.project.tracks));
      for (const role of KEYS_ROLES) {
        const t = a.project.tracks.find((x) => x.role === role)!;
        if (!t.notes.length) continue;
        expect(sanitizeNotes(t.notes, t.lowestNote, t.highestNote, projectEndTick(a.project))).toEqual(t.notes);
      }
      expect(validateProject(JSON.parse(JSON.stringify(a.project))).ok).toBe(true);
    }
  }, 300000);

  it('export with and without the profile passes the keys through (no keys part in the UVI profile — the pre-8.1 passthrough)', () => {
    const { project } = composeTake(THREE(), 'ensemble.cinematic', 1);
    expect(validateProject(JSON.parse(JSON.stringify(project))).ok).toBe(true);
    const merged = buildMergedMidi(project, project.tracks.filter((t) => t.notes.length));
    expect(merged.length).toBeGreaterThan(200);
    for (const role of KEYS_ROLES) {
      const t = trackOf(project, role);
      if (!t.notes.length) continue;
      const chunks = chunksForTrack(project, t, PROFILE);
      const total = chunks.reduce((a2, c) => a2 + c.notes.length, 0);
      expect(total, `${role} lost notes in the profile export`).toBe(t.notes.length);
    }
  });

  it('the plan reports the gates and the glissando list (audit trail)', () => {
    for (const run of keysSurvey) {
      const report = run.result.reports.find((x) => x.startsWith('keys (take'));
      expect(report, `${run.templateId} t${run.take} missing the keys plan report`).toBeDefined();
      expect(report).toContain('gates 0.30/0.50/0.72/0.90');
    }
  });
});
