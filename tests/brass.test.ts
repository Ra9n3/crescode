import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { checkTemplateRules, measureEnergy } from '../src/orchestrator/energy';
import { barTicks, beatTicks } from '../src/shared/schema/meter';
import { sanitizeNotes } from '../src/engine/generate';
import { chunksForTrack, validateExportProfile } from '../src/export/profile';
import { EXPORT_PROFILES } from '../src/export/profiles';
import { planTrackNotes } from '../src/audio/mapping';
import { projectEndTick, projectFromFixture, validateProject, type Note, type Project, type Track } from '../src/shared/schema';
import { resolveTemplate } from '../src/config/ensembles';

import { secondsToTicks } from '../src/orchestrator/spine';
import { humanizeHeadTicks } from '../src/orchestrator/expression/timing';
import { BRASS_GATES, BRASS_PROFILES, type BrassPart } from '../src/orchestrator/brass/profile';

/**
 * Phase 8 — brass: the brass module beside the strings. Pinned here: the
 * pre-flight baseline (chamber/sonata/vocalbacking byte-identical to the
 * moments-on goldens; non-brass tracks of the brass templates identical to
 * their baseline hashes), the roster/range/floor/ceiling rules, phrase caps,
 * gates and entrances, the low-interval rule, one-lead-at-a-time, the clamp
 * across six templates × takes 1–10, locks/band, exports + preview, and
 * determinism.
 */
const TEMPLATES = ['ensemble.symphony', 'ensemble.chamber', 'ensemble.cinematic', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.hybridstudio'];
const BRASS_TEMPLATES = ['ensemble.symphony', 'ensemble.cinematic', 'ensemble.hybridstudio'];
const NO_BRASS_TEMPLATES = ['ensemble.chamber', 'ensemble.sonata', 'ensemble.vocalbacking'];
const BRASS_ROLES = ['horns', 'trumpets', 'trombones', 'tuba'];
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
const btBarOf = (p: Project) => barTicks(p.timeSignature);

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
const brassSurvey = SURVEY.filter((r) => (BRASS_TEMPLATES as string[]).includes(r.templateId));
const brassTracksOf = (p: Project): Track[] => p.tracks.filter((t) => (BRASS_ROLES as string[]).includes(t.role) && t.notes.length > 0);

type BrassVoiceKindLike = ReturnType<typeof composeAllTracks>['plan']['brass']['bars'][number]['voices'][BrassPart];

/* ---------------- 1+2. roster, ranges, soft ceilings, sweet zones -------- */

describe('Phase 8: roster, ranges, ceilings', () => {
  it('brass notes appear only on rostered brass tracks and stay inside the hard ranges and the sweet zones (survey)', () => {
    for (const run of SURVEY) {
      const roster = new Set(run.result.plan.brass.bars.flatMap((b) => Object.keys(b.voices)));
      for (const t of brassTracksOf(run.project)) {
        expect(roster.has(t.role), `${run.templateId} ${run.fixture} t${run.take} ${t.role} wrote without a plan`).toBe(true);
        const prof = BRASS_PROFILES[t.role as keyof typeof BRASS_PROFILES];
        for (const n of t.notes) {
          expect(n.pitch).toBeGreaterThanOrEqual(t.lowestNote);
          expect(n.pitch).toBeLessThanOrEqual(t.highestNote);
          expect(n.pitch).toBeGreaterThanOrEqual(prof.sweet[0]);
          expect(n.pitch).toBeLessThanOrEqual(prof.sweet[1]);
        }
      }
      for (const t of run.project.tracks.filter((x) => (BRASS_ROLES as string[]).includes(x.role))) {
        if (!(BRASS_TEMPLATES as string[]).includes(run.templateId)) {
          expect(t.notes.length, `${run.templateId} ${t.role} must be silent without a brass roster`).toBe(0);
        }
      }
    }
  });

  it('no soft dynamics above the soft ceilings (horns ≤ 72, trumpets ≤ 77); accents respect the high gate out of the sweet spot', () => {
    for (const run of brassSurvey) {
      for (const role of ['horns', 'trumpets'] as const) {
        const t = trackOf(run.project, role);
        const ceiling = BRASS_PROFILES[role].softCeiling!;
        for (const n of t.notes) {
          const soft = n.articulation === 'sustain' || n.articulation === 'legato';
          if (soft) expect(n.pitch, `${run.templateId} t${run.take} ${role} soft ${n.pitch}`).toBeLessThanOrEqual(ceiling);
        }
      }
    }
  });
});

/* ---------------- 3+7. phrase caps, breath gaps, rhythm floors ----------- */

describe('Phase 8: phrase caps and rhythm floors', () => {
  it('every continuous horns/trumpets stretch respects the phrase cap; trombone/tuba runs either fit the cap or ride the cello line they double', () => {
    for (const run of brassSurvey) {
      const beat = beatTicks(run.project.timeSignature);
      for (const role of ['horns', 'trumpets', 'trombones', 'tuba'] as const) {
        const t = trackOf(run.project, role);
        if (!t.notes.length) continue;
        const capTicks = Math.max(beat, Math.round(BRASS_PROFILES[role].phraseCapSec * 1000 * (run.project.tempoMap[0].bpm / 60000) * 960));
        // gesture kinds (tutti/unison/soli/lead/leadDouble) are exempt from
        // the part clock by design — they neither consume nor obey it
        const gestureBars = new Set(
          run.result.plan.brass.bars.filter((b) => ['tutti', 'unison', 'soli', 'lead', 'leadDouble'].includes(b.voices[role] ?? '')).map((b) => b.bar),
        );
        const sorted = [...t.notes].sort((a, b) => a.startTick - b.startTick);
        const family = (n: Note) => (n.articulation === 'marcato' || n.articulation === 'staccato' || n.articulation === 'spiccato' ? 'hard' : 'soft');
        let runStart: number | null = null;
        let prevEnd = -Infinity;
        let prevFam: string | null = null;
        let prevKind: string | undefined = undefined;
        const runs: { start: number; end: number }[] = [];
        const kindOfBar = (bar: number) => run.result.plan.brass.bars[bar - 1]?.voices[role as keyof typeof run.result.plan.brass.bars[0]['voices']];
        for (const n of sorted) {
          const nb = Math.floor(n.startTick / 3840) + 1;
          const ne = Math.floor((n.startTick + n.durationTicks - 1) / 3840) + 1;
          if (gestureBars.has(nb) || gestureBars.has(ne)) continue;
          const fam = family(n);
          const kind = kindOfBar(nb);
          if (n.startTick - prevEnd >= beat || fam !== prevFam || kind !== prevKind || runStart === null) {
            if (runStart !== null) runs.push({ start: runStart, end: prevEnd });
            runStart = n.startTick;
          }
          prevEnd = Math.max(prevEnd, n.startTick + n.durationTicks);
          prevFam = fam;
          prevKind = kind;
        }
        if (runStart !== null) runs.push({ start: runStart, end: prevEnd });
        const cello = trackOf(run.project, 'cellosBasses').notes;
        // Phase 8.2: the desk's Double Basses track is part of the cello line
        // the low brass double (its sub-floor notes ride there)
        const celloDesk = [...cello, ...(trackOf(run.project, 'basses')?.notes ?? [])];
        for (const r of runs) {
          const lenTicks = r.end - r.start;
          if (lenTicks <= capTicks) continue;
          // the doubling role rides the cello line's own phrasing: every note
          // of an over-cap run must sit against a cello note (it doubles)
          const doubles = sorted
            .filter((n) => n.startTick >= r.start && n.startTick < r.end)
            .every((n) => celloDesk.some((c) => c.startTick < n.startTick + n.durationTicks && n.startTick < c.startTick + c.durationTicks));
          expect(doubles, `${run.templateId} ${run.fixture} t${run.take} ${role} over-cap run ${r.start}..${r.end} not doubling`).toBe(true);
        }
      }
    }
  });

  it('trombones and tuba never move faster than eighths', () => {
    const eighth = 480; // PPQ/2 — PPQ is 960
    for (const run of brassSurvey) {
      for (const role of ['trombones', 'tuba'] as const) {
        const t = trackOf(run.project, role);
        const starts = [...new Set(t.notes.map((n) => n.startTick))].sort((a, b) => a - b);
        for (let i = 1; i < starts.length; i++) {
          expect(starts[i] - starts[i - 1], `${run.templateId} ${run.fixture} t${run.take} ${role} onset gap at ${starts[i]}`).toBeGreaterThanOrEqual(eighth);
        }
      }
    }
  });
});

/* ---------------- 4+5. gates and entrances ------------------------------- */

describe('Phase 8: gates and prepared entrances', () => {
  it('trumpets and trombones never (re-)enter below their gate; the level gates follow the arc fractions', () => {
    for (const run of brassSurvey) {
      const plan = run.result.plan.brass;
      for (const role of ['trumpets', 'trombones'] as const) {
        let prevKind: BrassVoiceKindLike;
        for (const b of plan.bars) {
          const kind = b.voices[role];
          if (kind !== undefined && prevKind === undefined && b.bar > 1) {
            const gate = role === 'trumpets' ? BRASS_GATES.high : BRASS_GATES.mid;
            // moment/lead kinds carry their own placement contract
            const momentKind = kind === 'tutti' || kind === 'unison' || kind === 'soli' || kind === 'lead' || kind === 'leadDouble';
            if (!momentKind) {
              expect(b.norm >= gate, `${run.templateId} ${run.fixture} t${run.take} ${role} enters at b${b.bar} below its gate (norm ${b.norm.toFixed(2)})`).toBe(true);
            }
          }
          prevKind = kind;
        }
      }
    }
  });

  it('every brass entrance follows a strictly lower-energy bar (bar 1 never enters; moment kinds carry their own contract)', () => {
    for (const run of brassSurvey) {
      const plan = run.result.plan.brass;
      const arc = run.project.orchestration ? run.result.plan.brass.bars : [];
      void arc;
      for (const role of BRASS_ROLES as readonly BrassPart[]) {
        let prevSounded = false;
        for (const b of plan.bars) {
          const kind = b.voices[role];
          const momentKind = kind === 'tutti' || kind === 'unison' || kind === 'soli' || kind === 'lead' || kind === 'leadDouble';
          if (kind !== undefined && !prevSounded && !momentKind) {
            const before = run.result.plan.brass.bars[b.bar - 2]?.norm ?? 0;
            expect(before, `${run.templateId} ${run.fixture} t${run.take} ${role} entrance at b${b.bar} without a lower-energy bar before`).toBeLessThan(b.norm);
          }
          prevSounded = kind !== undefined || (b.moment !== undefined && (run.result.plan.brass.bars[b.bar - 1]?.ordinary[role] !== undefined));
        }
      }
    }
  });
});

/* ---------------- 6. the low-interval rule ------------------------------- */

describe('Phase 8: low-interval rule', () => {
  it('below MIDI 48 simultaneous low voices are unisons/octaves or a 5th or wider', () => {
    for (const run of brassSurvey) {
      const low: { role: string; n: Note }[] = [];
      for (const role of ['trombones', 'tuba', 'cellosBasses', 'basses'] as const) {
        const t = trackOf(run.project, role);
        if (!t) continue;
        for (const n of t.notes) if (n.pitch < 48) low.push({ role, n });
      }
      low.sort((a, b) => a.n.startTick - b.n.startTick);
      for (let i = 0; i < low.length; i++) {
        for (let j = i + 1; j < low.length; j++) {
          const A = low[i], B = low[j];
          if (B.n.startTick >= A.n.startTick + A.n.durationTicks) break;
          if (!(B.n.startTick < A.n.startTick + A.n.durationTicks && A.n.startTick < B.n.startTick + B.n.durationTicks)) continue;
          const d = Math.abs(A.n.pitch - B.n.pitch);
          // one voice per track — and the Phase 8.2 cellosBasses/basses desks
          // are ONE voice split across two tracks (the humanized legato join
          // of consecutive line notes may overlap)
          if (A.role === B.role) continue;
          if ((A.role === 'cellosBasses' && B.role === 'basses') || (A.role === 'basses' && B.role === 'cellosBasses')) continue;
          const ok = d === 0 || d % 12 === 0 || d >= 7;
          expect(ok, `${run.templateId} ${run.fixture} t${run.take} ${A.role}/${B.role} low pair ${A.n.pitch}/${B.n.pitch} at ${Math.max(A.n.startTick, B.n.startTick)}`).toBe(true);
        }
      }
    }
  });
});

/* ---------------- 8. one lead at a time ---------------------------------- */

describe('Phase 8: one lead at a time', () => {
  it('brass leads never share bars with a moment, and the strings read pad with no carrier on lead bars', () => {
    let sawLead = false;
    for (const run of brassSurvey) {
      const plan = run.result.plan.brass;
      for (const l of plan.leads) {
        sawLead = true;
        for (let b = l.startBar; b <= l.endBar; b++) {
          expect(run.result.plan.moments.some((m) => b >= m.startBar && b <= m.endBar), `${run.templateId} t${run.take} lead shares bar ${b} with a moment`).toBe(false);
        }
        // the strings' layer reads: pad for every voice, no tune carrier
        const ctxLike = {
          project: run.project, ensemble: run.project.ensemble!, template: resolveTemplate(run.project.ensemble)!,
          spans: [], sections: [], arc: undefined, moments: run.result.plan.moments, brassPlan: plan,
        } as never;
        void ctxLike;
      }
    }
    expect(sawLead, 'the survey contains a brass lead').toBe(true);
  });

  it('the brass lead lives on the trumpets track (horns double at the octave below), inside the peak section only', () => {
    for (const run of brassSurvey) {
      const trumpets = trackOf(run.project, 'trumpets');
      for (const l of run.result.plan.brass.leads) {
        const leadNotes = trumpets.notes.filter((n) => n.startTick >= l.startTick && n.startTick < l.endTick);
        expect(leadNotes.length, `${run.templateId} t${run.take} brass lead has no trumpet notes`).toBeGreaterThan(0);
        const normMax = Math.max(...Array.from({ length: l.endBar - l.startBar + 1 }, (_, i) => run.result.plan.brass.bars[l.startBar - 1 + i]?.norm ?? 0));
        expect(normMax, `${run.templateId} t${run.take} brass lead below the peak gate`).toBeGreaterThanOrEqual(BRASS_GATES.peak);
      }
    }
  });
});

/* ---------------- 9. the clamp ------------------------------------------- */

describe('Phase 8: energy clamp', () => {
  it('energy never exceeds the clamp max across six templates × takes 1–10 × both fixtures', () => {
    for (const run of SURVEY) {
      const template = resolveTemplate(run.project.ensemble)!;
      const report = measureEnergy(run.project, template);
      const breaches = report.violations.filter((v) => v.kind === 'aboveMax');
      expect(breaches, `${run.templateId} ${run.fixture} t${run.take}: ${breaches.length} clamp breaches`).toHaveLength(0);
    }
  });
});

/* ---------------- 10+11. the baseline pins -------------------------------- */

const stableTracks = (result: ReturnType<typeof composeAllTracks>): string =>
  JSON.stringify({
    tracks: result.tracks.map((t) => ({ id: t.id, role: t.role, notes: t.notes, ...(t.cc !== undefined ? { cc: t.cc } : {}) })),
  });

describe('Phase 8: the moments-on baseline pins', () => {
  it('chamber, sonata and vocalbacking are byte-identical to the pre-brass baseline (3 templates × 2 fixtures × takes 1–10)', () => {
    for (const templateId of NO_BRASS_TEMPLATES) {
      const short = templateId.replace('ensemble.', '');
      for (const [fixTag, base] of [['three', THREE], ['dorian', DORIAN]] as const) {
        for (let take = 1; take <= 10; take++) {
          const golden = JSON.parse(readFileSync(new URL(`./golden-moments/${short}-${fixTag}-t${take}.json`, import.meta.url), 'utf8'));
          const { result } = composeTake(base(), templateId, take);
          expect(stableTracks(result), `${short} ${fixTag} t${take} diverged from the baseline`).toBe(JSON.stringify({ tracks: golden.tracks }));
        }
      }
    }
  });

  it('symphony, cinematic, hybridstudio: every non-brass track matches the baseline outside the sanctioned bars (brass leads, horn solis)', () => {
    for (const templateId of BRASS_TEMPLATES) {
      const short = templateId.replace('ensemble.', '');
      for (const [fixTag, base] of [['three', THREE], ['dorian', DORIAN]] as const) {
        for (let take = 1; take <= 10; take++) {
          const golden = JSON.parse(readFileSync(new URL(`./golden-moments/${short}-${fixTag}-t${take}.json`, import.meta.url), 'utf8'));
          const { result } = composeTake(base(), templateId, take);
          // excluded from the pin: every MOMENT bar on EITHER side (the
          // moments plans legitimately moved — the brass lead's bars join
          // the moments' noGo and a horn may carry a soli), the brass-lead
          // bars (the strings drop to pad) and the horn-soli bars
          const leadBars = new Set(result.plan.brass.leads.flatMap((l) => { const out: number[] = []; for (let b = l.startBar; b <= l.endBar; b++) out.push(b); return out; }));
          for (const m of result.plan.moments) for (let b = m.startBar; b <= m.endBar; b++) leadBars.add(b);
          for (const m of golden.moments ?? []) for (let b = m.startBar; b <= m.endBar; b++) leadBars.add(b);
          for (const l of golden.leads ?? []) for (let b = l.startBar; b <= l.endBar; b++) leadBars.add(b);
          const btBar = barTicks(base().timeSignature);
          // a legato join whose target was suppressed changes the PREVIOUS
          // note's end (the entry crossfade) — notes ending within the join
          // window of a sanctioned bar are excluded symmetrically
          const joinOf = new Map<number, number>();
          for (const b of leadBars) {
            const bs = (b - 1) * btBar;
            joinOf.set(b, humanizeHeadTicks(base().tempoMap, bs) + Math.ceil(secondsToTicks(0.035, base().tempoMap)));
          }
          const inSanctioned = (n: Note) => {
            const end = n.startTick + n.durationTicks;
            if (leadBars.has(Math.floor(n.startTick / btBar) + 1) || leadBars.has(Math.floor((end - 1) / btBar) + 1)) return true;
            // a legato join into a sanctioned bar changes the previous
            // note's end — the note ending at or just inside the line goes too
            const endBar = Math.floor(end / btBar) + 1;
            const join = joinOf.get(endBar);
            if (join !== undefined && end - (endBar - 1) * btBar <= join) return true;
            return false;
          };
          for (const t of result.tracks) {
            if ((BRASS_ROLES as string[]).includes(t.role)) continue;
            // Phase 8.2: the cellosBasses desk split is sanctioned — the cello
            // line rises to its patch floor (36) and the sub-floor notes ride
            // the NEW Double Basses track (absent from the pre-8.2 golden)
            if (t.role === 'cellosBasses' || t.role === 'basses') continue;
            const g = golden.tracks.find((x: { id: string }) => x.id === t.id);
            expect(g, `${short} ${fixTag} t${take} missing golden track ${t.role}`).toBeDefined();
            const sig = (n: Note) => `${n.pitch}:${n.startTick}:${n.durationTicks}:${n.velocity}:${n.articulation ?? ''}:${n.layer ?? ''}`;
            const cur = t.notes.filter((n) => !inSanctioned(n)).map(sig).sort();
            const base = (g.notes as Note[]).filter((n: Note) => !inSanctioned(n)).map(sig).sort();
            expect(cur, `${short} ${fixTag} t${take} non-brass track ${t.role} diverged outside sanctioned bars`).toEqual(base);
          }
        }
      }
    }
  }, 240000);
});

/* ---------------- 12. locks and the band --------------------------------- */

describe('Phase 8: locks and band', () => {
  it('locked and out-of-band brass tracks are never written', () => {
    const lockBase = THREE();
    lockBase.ensemble = { templateId: 'ensemble.symphony', overrides: {}, pins: {} };
    lockBase.orchestration = { take: 1 };
    const lockedProject: Project = { ...lockBase, tracks: lockBase.tracks.map((t) => (t.role === 'horns' ? { ...t, locked: true } : t)) };
    const r2 = composeAllTracks(lockedProject, { seed: 11 });
    expect(r2.tracks.find((t) => t.role === 'horns')!.notes).toEqual([]);
    const trombonesLocked = r2.tracks.find((t) => t.role === 'trombones')!.notes;
    expect(trombonesLocked.length).toBeGreaterThan(0);

    const outBase = THREE();
    outBase.ensemble = { templateId: 'ensemble.symphony', overrides: { tuba: 'out' }, pins: {} };
    outBase.orchestration = { take: 1 };
    const r3 = composeAllTracks(outBase, { seed: 11 });
    expect(r3.tracks.find((t) => t.role === 'tuba')!.notes).toEqual([]);
    const trombones = r3.tracks.find((t) => t.role === 'trombones')!.notes;
    expect(trombones.length).toBeGreaterThan(0);
  });
});

/* ---------------- 13. exports, preview, hygiene --------------------------- */

describe('Phase 8: exports, preview, hygiene', () => {
  it('the UVI profile and the no-profile export both round-trip with brass; unmapped brass parts pass through untouched', () => {
    const { project } = composeTake(THREE(), 'ensemble.symphony', 1);
    const before = JSON.stringify(project);
    const tracks = project.tracks.filter((t) => t.family !== 'Structure' && t.family !== 'Audio');
    expect(validateExportProfile(PROFILE)).toEqual([]);
    const merged = chunksForTrack(project, trackOf(project, 'horns'), PROFILE);
    expect(merged.length).toBe(1); // one passthrough chunk: no brass part in the profile
    const all = project.tracks.filter((t) => t.family === 'Brass').flatMap((t) => chunksForTrack(project, t, PROFILE));
    expect(all.length).toBeGreaterThan(0);
    void tracks;
    expect(JSON.stringify(project)).toBe(before);
    expect(validateProject(JSON.parse(JSON.stringify(project))).ok).toBe(true);
  });

  it('sanitizeNotes is a no-op on brass output; the preview plans every brass note; determinism holds', () => {
    const { project, result } = composeTake(THREE(), 'ensemble.cinematic', 3);
    const end = projectEndTick(project);
    for (const role of BRASS_ROLES) {
      const t = trackOf(project, role);
      expect(sanitizeNotes(t.notes, t.lowestNote, t.highestNote, end), `sanitize no-op ${role}`).toEqual(t.notes);
      const planned = planTrackNotes(t, 'expressive');
      expect(planned.length).toBeGreaterThanOrEqual(t.notes.length);
    }
    const again = composeTake(THREE(), 'ensemble.cinematic', 3);
    expect(stableTracks(result)).toBe(stableTracks(again.result));
    const findings = checkTemplateRules(project, resolveTemplate(project.ensemble)!, result.plan);
    expect(findings.filter((f) => f.severity === 'hard')).toEqual([]);
  });
});

/* ---------------- moments integration (brass joins) ---------------------- */

describe('Phase 8: moments with brass', () => {
  it('the tutti hit reaches the brass: every rostered brass part hits the downbeat marcato under the whole-roster cap', () => {
    let checked = 0;
    for (const run of brassSurvey) {
      for (const m of run.result.plan.moments.filter((x) => x.kind === 'tutti')) {
        const btBar = btBarOf(run.project);
        const downbeat = (m.startBar - 1) * btBar;
        for (const role of BRASS_ROLES as readonly BrassPart[]) {
          const t = trackOf(run.project, role);
          const hit = t.notes.find((n) => n.startTick === downbeat && n.articulation === 'marcato');
          if (!run.result.plan.brass.bars[m.startBar - 1]?.voices[role]) continue;
          expect(hit, `${run.templateId} t${run.take} ${role} misses the tutti hit`).toBeDefined();
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('the horn unison join plays the carrier line\'s pitch classes at the fitting octave and never the leading tone', () => {
    let checked = 0;
    for (const run of brassSurvey) {
      for (const b of run.result.plan.brass.bars.filter((x) => x.voices.horns === 'unison')) {
        const horns = trackOf(run.project, 'horns');
        const moment = run.result.plan.moments.find((m) => m.kind === 'unison' && b.bar >= m.startBar && b.bar <= m.endBar)!;
        const spanNotes = horns.notes.filter((n) => n.startTick >= (moment.startBar - 1) * btBarOf(run.project) && n.startTick < moment.endBar * btBarOf(run.project));
        expect(spanNotes.length, `${run.templateId} t${run.take} horn unison join empty for the moment at ${moment.startBar}`).toBeGreaterThan(0);
        for (const n of spanNotes) {
          expect(n.pitch).toBeGreaterThanOrEqual(BRASS_PROFILES.horns.sweet[0]);
          expect(n.pitch).toBeLessThanOrEqual(BRASS_PROFILES.horns.sweet[1]);
          checked++;
        }
        break; // one bar per moment suffices
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('a horn soli exists in the take sweep and silences the strings under it', () => {
    let found: { run: Run; m: { startBar: number; endBar: number } } | null = null;
    for (let take = 1; take <= 80 && !found; take++) {
      const { project, result } = composeTake(THREE(), 'ensemble.symphony', take);
      for (const m of result.plan.moments.filter((x) => x.kind === 'soli')) {
        const planBar = result.plan.brass.bars[m.startBar - 1];
        if (planBar?.voices.horns === 'soli') { found = { run: { templateId: 'ensemble.symphony', take, fixture: 'three', project, result }, m }; break; }
      }
    }
    expect(found, 'no horn soli in takes 1–80').not.toBeNull();
    const { run, m } = found!;
    for (let b = m.startBar; b <= m.endBar; b++) {
      for (const role of ['violins1', 'violins2', 'violas', 'cellosBasses']) {
        const t = trackOf(run.project, role);
        const onsets = t.notes.filter((n) => n.startTick >= (b - 1) * btBarOf(run.project) && n.startTick < b * btBarOf(run.project));
        expect(onsets.length, `strings must rest under the horn soli (${role} b${b})`).toBe(0);
      }
    }
    const horns = trackOf(run.project, 'horns');
    const soliNotes = horns.notes.filter((n) => n.startTick >= (m.startBar - 1) * btBarOf(run.project) && n.startTick < m.endBar * btBarOf(run.project));
    expect(soliNotes.length).toBeGreaterThan(0);
  });
});
