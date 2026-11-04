import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/dorian-16bars.json';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import { ENSEMBLE_BY_ID, resolveTemplate } from '../src/config/ensembles';
import { composeAllTracks } from '../src/orchestrator/compose';
import { measureEnergy } from '../src/orchestrator/energy';
import { BASS_TIMING_MS, CB_FOLLOW_MAX_MS, VIOLIN_TIMING_MS } from '../src/orchestrator/expression/humanize';
import { humanizeHeadTicks } from '../src/orchestrator/expression/timing';
import { CC_BASELINE_LIFT, CC1_ARC_RANGE } from '../src/orchestrator/expression/cc';
import { stringsModule, stringVoiceTracks, prepareStrings, maybeLayerCellosBasses } from '../src/orchestrator/render';
import { conduct } from '../src/orchestrator/conductor';
import { chordSpans, sectionMap, energyCurve, orchestrationSeedFor, ticksToMs } from '../src/orchestrator/spine';
import { sanitizeNotes } from '../src/engine/generate';
import { MAX_CC_POINTS_PER_LANE, type CcLane, type Note, type Project, type Track } from '../src/shared/schema/types';
import { projectEndTick, projectFromFixture, validateProject } from '../src/shared/schema';
import type { OrchestratorContext } from '../src/orchestrator/module';

/**
 * Phase 5.1 — expression hardening before 4.8.
 *
 * 5.1.3 (this battery): the humanize head comes from the tempo map (not a
 * 60-tick constant); the 5e matrix re-runs at 60 and 180 BPM with the
 * offset min/max reported in ms AND ticks per track.
 */
const BASE = (): Project => projectFromFixture(JSON.parse(JSON.stringify(fixture)));
const THREE = (): Project => projectFromFixture(JSON.parse(JSON.stringify(threeChorus)));
const TEMPLATES = ['ensemble.symphony', 'ensemble.chamber', 'ensemble.cinematic', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.hybridstudio'];
const KEYS: { key: number; mode: string; name: string }[] = [
  { key: 2, mode: 'Dorian', name: 'D dorian' },
  { key: 0, mode: 'Ionian', name: 'C Ionian' },
  { key: 9, mode: 'Aeolian', name: 'A aeolian' },
];

const composeTake = (project: Project, templateId: string, take: number) => {
  project.ensemble = { templateId, overrides: {}, pins: {} };
  project.orchestration = { take };
  const result = composeAllTracks(project, { seed: 11 });
  return { project: { ...project, tracks: result.tracks } as Project, result };
};

/** A constant-tempo variant of the fixture (validateProject allows exactly one entry at tick 0). */
const atTempo = (project: Project, bpm: number): Project => ({ ...project, bpm, tempoMap: [{ tick: 0, bpm }] });

/** Matches each humanized note back to its pre-humanize origin (same pitch,
 *  same end as written; nearest earlier start). Overlap-extended legato notes
 *  have no origin under their (new) end key and are skipped. */
const matchBefore = (pool: Map<string, Note[]>, a: Note): Note | undefined => {
  const cands = pool.get(`${a.pitch}:${a.startTick + a.durationTicks}`);
  if (!cands || !cands.length) return undefined;
  let best = 0;
  for (let i = 1; i < cands.length; i++) {
    if (cands[i].startTick <= a.startTick
      && (cands[best].startTick > a.startTick || Math.abs(cands[i].startTick - a.startTick) < Math.abs(cands[best].startTick - a.startTick))) best = i;
  }
  if (cands[best].startTick > a.startTick) return undefined;
  if (a.startTick - cands[best].startTick > 200) return undefined; // beyond any humanize head: not the origin
  const b = cands.splice(best, 1)[0];
  if (!cands.length) pool.delete(`${a.pitch}:${a.startTick + a.durationTicks}`);
  return b;
};

/** The exact pre-humanize strings notes (the compose pipeline's own steps;
 *  composeAllTracks INCREMENTS the take internally — mirrored here). */
const preHumanizeStrings = (project: Project, templateId: string, take: number) => {
  project.ensemble = { templateId, overrides: {}, pins: {} };
  const orchestration = { take: take + 1 };
  const template = resolveTemplate(project.ensemble)!;
  const ctx: OrchestratorContext = {
    project: { ...project, orchestration }, template, ensemble: project.ensemble!,
    spans: chordSpans(project), sections: sectionMap(project),
  };
  const seed = orchestrationSeedFor(project, orchestration);
  const voiceTracks = stringVoiceTracks(ctx);
  const arc = energyCurve(project, ctx.sections, orchestration.take, template, true);
  ctx.arc = arc;
  const plan = conduct(ctx, arc);
  ctx.lines = prepareStrings(ctx, orchestration.take);
  const plans = stringsModule.roles(ctx).map((pl) => ({
    ...pl,
    breathByTrack: Object.fromEntries(
      pl.voiceTrackIds.map((id) => [id, plan.breaths.filter((b) => b.trackIds.includes(id)).map((b) => [b.startTick, b.endTick] as [number, number])]),
    ),
  }));
  const notesByTrackId: Record<string, Note[]> = {};
  for (const t of voiceTracks) notesByTrackId[t.id] = [];
  for (const pl of plans) {
    const patch = stringsModule.render(ctx, pl, seed);
    for (const [id, notes] of Object.entries(patch.notesByTrackId)) {
      notesByTrackId[id] = [...(notesByTrackId[id] ?? []), ...notes];
    }
  }
  maybeLayerCellosBasses(ctx, notesByTrackId, voiceTracks.map((t) => t.id));
  return { notesByTrackId, voiceTrackIds: voiceTracks.map((t) => t.id) };
};

const laneOf = (t: Track, cc: number): CcLane | undefined => t.cc?.find((l) => l.cc === cc);

/* ------------------------------------------------------------------ */
/* 5.1.3 — the humanize head through the tempo map; the matrix at 60/180 */
/* ------------------------------------------------------------------ */

describe('Phase 5.1.3: the 5e matrix re-run at 60 and 180 BPM (6 templates × 3 key/modes × takes 0..2)', () => {
  const TEMPOS = [60, 180];
  const combos: { templateId: string; key: number; mode: string; name: string; take: number; bpm: number }[] = [];
  for (const bpm of TEMPOS) for (const templateId of TEMPLATES) for (const k of KEYS) for (const take of [0, 1, 2]) {
    combos.push({ templateId, key: k.key, mode: k.mode, name: k.name, take, bpm });
  }

  const cell = (c: { templateId: string; key: number; mode: string; take: number; bpm: number }) => {
    const p = atTempo(BASE(), c.bpm);
    p.key = c.key as Project['key'];
    p.mode = c.mode as Project['mode'];
    return composeTake(p, c.templateId, c.take);
  };

  it(`every cell (${combos.length}): validate + sanitize no-op + CC validity + CC7 static + CC68 over legato + energy clamp + non-negative starts`, () => {
    let cells = 0;
    for (const c of combos) {
      const { project } = cell(c);
      cells++;
      const label = `${c.bpm} BPM ${c.templateId} ${c.name} take ${c.take}`;
      expect(validateProject(project).ok, label).toBe(true);
      const end = projectEndTick(project);
      for (const t of project.tracks.filter((x) => x.family === 'Strings' && x.notes.length)) {
        expect(sanitizeNotes(t.notes, t.lowestNote, t.highestNote, end), label).toEqual(t.notes);
        for (const n of t.notes) {
          expect(n.startTick).toBeGreaterThanOrEqual(0); // never before the grid start
          expect(n.startTick + n.durationTicks).toBeLessThanOrEqual(end);
        }
        const ccs = t.cc!.map((l) => l.cc);
        expect(new Set(ccs).size, label).toBe(ccs.length);
        for (const lane of t.cc!) {
          expect(lane.points.length).toBeLessThanOrEqual(MAX_CC_POINTS_PER_LANE);
          for (const [i, pt] of lane.points.entries()) {
            expect(pt.tick).toBeGreaterThanOrEqual(0);
            expect(pt.tick).toBeLessThanOrEqual(end);
            expect(pt.value).toBeGreaterThanOrEqual(0);
            expect(pt.value).toBeLessThanOrEqual(127);
            if (i > 0) expect(pt.tick).toBeGreaterThanOrEqual(lane.points[i - 1].tick);
          }
        }
        expect(laneOf(t, 7)!.points, label).toEqual([{ tick: 0, value: 90 }]);
        const l68 = laneOf(t, 68);
        if (l68) {
          for (let i = 0; i < l68.points.length; i++) {
            if (l68.points[i].value !== 127) continue;
            const lo = l68.points[i].tick;
            const hi = l68.points[i + 1]?.tick ?? Number.POSITIVE_INFINITY;
            const legatoInside = t.notes.some((n) => n.articulation === 'legato' && n.startTick < hi && n.startTick + n.durationTicks > lo);
            expect(legatoInside, `CC68 127 without legato at [${lo},${hi}) on ${t.name} (${label})`).toBe(true);
          }
        }
      }
      const template = ENSEMBLE_BY_ID.get(c.templateId)!;
      const energy = measureEnergy(project, template);
      expect(energy.max, label).toBeLessThanOrEqual(template.budget.energyClamp[1] + 1e-9);
      expect(energy.violations.filter((v) => v.kind === 'aboveMax'), label).toHaveLength(0);
    }
    expect(cells).toBe(108);
    console.log(`5.1.3 matrix: ${cells} cells (6 templates × 3 key/modes × takes 0..2 × {60, 180} BPM) all green`);
  });

  it('every cell: determinism — the same take composes byte-identically at both tempos', () => {
    for (const c of combos.filter((x) => x.take === 0)) {
      const a = cell(c);
      const b = cell(c);
      expect(JSON.stringify(a.project.tracks.map((t) => ({ n: t.notes, c: t.cc }))))
        .toBe(JSON.stringify(b.project.tracks.map((t) => ({ n: t.notes, c: t.cc }))));
    }
  });

  it('every cell: each offset is in its ms range through THAT tempo map and never negative', () => {
    for (const c of combos) {
      const { project } = cell(c);
      const preP = atTempo(BASE(), c.bpm);
      preP.key = c.key as Project['key']; // the rebuild must read the same musical inputs (the seed rides on them)
      preP.mode = c.mode as Project['mode'];
      const pre = preHumanizeStrings(preP, c.templateId, c.take);
      const roleOf = new Map(project.tracks.map((t) => [t.id, t.role]));
      for (const id of pre.voiceTrackIds) {
        const role = roleOf.get(id)!;
        const range = role === 'cellosBasses' ? BASS_TIMING_MS : VIOLIN_TIMING_MS;
        const pool = new Map<string, Note[]>();
        for (const b of pre.notesByTrackId[id]) {
          const k = `${b.pitch}:${b.startTick + b.durationTicks}`;
          (pool.get(k) ?? pool.set(k, []).get(k)!).push(b);
        }
        const after = project.tracks.find((t) => t.id === id)!.notes;
        const isDouble = (b: Note) => role === 'cellosBasses'
          && pre.notesByTrackId[id].some((m) => m !== b && m.pitch === b.pitch + 12 && m.startTick === b.startTick);
        for (const a of after) {
          const b = matchBefore(pool, a);
          if (!b) continue; // overlap-extended or deduped — starts only compared when matched
          const ms = ticksToMs(a.startTick, project.tempoMap) - ticksToMs(b.startTick, project.tempoMap);
          const q = ticksToMs(1, project.tempoMap);
          const top = range[1] + (isDouble(b) ? CB_FOLLOW_MAX_MS : 0);
          expect(ms, `${c.bpm} BPM ${c.templateId} ${c.name} take ${c.take} ${role}`).toBeGreaterThanOrEqual(range[0] - q - 1e-6);
          expect(ms).toBeLessThanOrEqual(top + q + 1e-6);
          expect(a.startTick).toBeGreaterThanOrEqual(b.startTick); // positive only
        }
      }
    }
  }, 180000);

  it('the head really follows the tempo map: ~31 ms lands as ~31, ~52 and ~93 ticks at 60/100/180 BPM', () => {
    for (const [bpm, lo, hi] of [[60, 29, 32], [100, 50, 53], [180, 91, 95]] as [number, number, number][]) {
      const head = humanizeHeadTicks([{ tick: 0, bpm }], 480);
      expect(head, `${bpm} BPM`).toBeGreaterThanOrEqual(lo);
      expect(head).toBeLessThanOrEqual(hi);
    }
  });

  it('report: offset min/max per track in ms AND ticks, at each tempo (three-chorus fixture, take 1)', () => {
    const lines: string[] = [];
    for (const bpm of TEMPOS) {
      for (const templateId of TEMPLATES) {
        const p = atTempo(THREE(), bpm);
        const { project } = composeTake(p, templateId, 0);
        const pre = preHumanizeStrings(atTempo(THREE(), bpm), templateId, 0);
        for (const id of pre.voiceTrackIds) {
          const pool = new Map<string, Note[]>();
          for (const b of pre.notesByTrackId[id]) {
            const k = `${b.pitch}:${b.startTick + b.durationTicks}`;
            (pool.get(k) ?? pool.set(k, []).get(k)!).push(b);
          }
          const after = project.tracks.find((t) => t.id === id)!.notes;
          const msArr: number[] = [];
          const tickArr: number[] = [];
          for (const a of after) {
            const b = matchBefore(pool, a);
            if (!b) continue;
            msArr.push(ticksToMs(a.startTick, project.tempoMap) - ticksToMs(b.startTick, project.tempoMap));
            tickArr.push(a.startTick - b.startTick);
          }
          if (!msArr.length) continue;
          const track = project.tracks.find((t) => t.id === id)!;
          lines.push(`  ${String(bpm).padStart(3)} BPM ${templateId.slice(9).padEnd(13)} ${track.name.padEnd(15)} ms ${Math.min(...msArr).toFixed(1)}..${Math.max(...msArr).toFixed(1)}  ticks ${Math.min(...tickArr)}..${Math.max(...tickArr)}`);
        }
      }
    }
    console.log(`5.1.3 offsets per track through each tempo map (ms | ticks):\n${lines.join('\n')}`);
    expect(lines.length).toBeGreaterThan(40);
  });
});

/* ------------------------------------------------------------------ */
/* 5.1.1 — baseline CC: the lanes cover the whole piece                 */
/* ------------------------------------------------------------------ */

describe('Phase 5.1.1: baseline CC coverage (both fixtures, all six templates)', () => {
  const fixtures: [string, () => Project][] = [['dorian 16-bar', BASE], ['three-chorus 40-bar', THREE]];

  it('CC1/CC11/CC7 start at tick 0 and CC1/CC11 close at the project end, on every composed track', () => {
    for (const [fxName, mk] of fixtures) {
      for (const templateId of TEMPLATES) {
        const { project } = composeTake(mk(), templateId, 0);
        const end = projectEndTick(project);
        for (const t of project.tracks.filter((x) => x.family === 'Strings' && x.notes.length)) {
          for (const cc of [1, 11, 7]) {
            const lane = laneOf(t, cc);
            expect(lane, `${fxName} ${templateId} ${t.name} CC${cc}`).toBeTruthy();
            expect(lane!.points[0].tick, `${fxName} ${templateId} ${t.name} CC${cc} first tick`).toBe(0);
          }
          expect(laneOf(t, 1)!.points[laneOf(t, 1)!.points.length - 1].tick, `${fxName} ${templateId} ${t.name} CC1 last tick`).toBe(end);
          expect(laneOf(t, 11)!.points[laneOf(t, 11)!.points.length - 1].tick, `${fxName} ${templateId} ${t.name} CC11 last tick`).toBe(end);
        }
      }
    }
  });

  it('no undefined stretch: the CC1/CC11 value is defined at every bar tick, and the baseline keeps CC11 >= CC1 over texture bars', () => {
    for (const [fxName, mk] of fixtures) {
      for (const templateId of TEMPLATES) {
        const { project, result } = composeTake(mk(), templateId, 0);
        const end = projectEndTick(project);
        const btBar = end / Math.max(1, result.plan.bars.length);
        const clampMax = ENSEMBLE_BY_ID.get(templateId)!.budget.energyClamp[1];
        for (const t of project.tracks.filter((x) => x.family === 'Strings' && x.notes.length)) {
          const l1 = laneOf(t, 1)!;
          const l11 = laneOf(t, 11)!;
          const valueAt = (lane: CcLane, tick: number): number => {
            let v = lane.points[0].value;
            for (const p of lane.points) { if (p.tick <= tick) v = p.value; else break; }
            return v;
          };
          for (const bar of result.plan.bars) {
            const tick = (bar.bar - 1) * btBar;
            expect(Number.isFinite(valueAt(l1, tick)), `${fxName} ${templateId} ${t.name} bar ${bar.bar} CC1 defined`).toBe(true);
            expect(Number.isFinite(valueAt(l11, tick)), `${fxName} ${templateId} ${t.name} bar ${bar.bar} CC11 defined`).toBe(true);
          }
          // wherever the track plays no line content (ostinato/pizz/tremolo
          // bars and rests) the baseline holds and CC11 sits above CC1 there
          const floor1 = CC1_ARC_RANGE[0] + (CC1_ARC_RANGE[1] - CC1_ARC_RANGE[0]) * 0.5 * 0.5; // the calmest baseline point
          for (const bar of result.plan.bars) {
            const tick = (bar.bar - 1) * btBar;
            const kindHasLine = t.notes.some((n) => n.startTick < bar.endTick && n.startTick + n.durationTicks > tick
              && n.articulation !== 'spiccato' && n.articulation !== 'pizz' && n.articulation !== 'tremolo');
            if (kindHasLine) continue;
            expect(valueAt(l1, tick), `${fxName} ${templateId} ${t.name} bar ${bar.bar} baseline band`).toBeGreaterThanOrEqual(floor1 - 1);
            expect(valueAt(l11, tick), `${fxName} ${templateId} ${t.name} bar ${bar.bar} CC11 above CC1`).toBeGreaterThanOrEqual(valueAt(l1, tick));
          }
          void clampMax;
        }
      }
    }
  });

  it('the baseline lift constant keeps CC11 above CC1 across the whole baseline energy band', () => {
    // CC11 - CC1 on the baseline = (30 - 38) + (66 - 46) * level + lift; with
    // level in [0.25, 0.5] the lift of 6 keeps the gap in [3, 8] — strictly above
    for (const level of [0.25, 0.35, 0.5]) {
      const gap = (30 - 38) + (66 - 46) * level + CC_BASELINE_LIFT;
      expect(gap).toBeGreaterThan(0);
    }
  });
});
