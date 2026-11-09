import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/dorian-16bars.json';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import { ENSEMBLE_BY_ID, resolveTemplate } from '../src/config/ensembles';
import { composeAllTracks } from '../src/orchestrator/compose';
import { measureEnergy } from '../src/orchestrator/energy';
import { BASS_TIMING_MS, CB_FOLLOW_MAX_MS, VIOLIN_TIMING_MS } from '../src/orchestrator/expression/humanize';
import { stringsModule, stringVoiceTracks, prepareStrings, maybeLayerCellosBasses } from '../src/orchestrator/render';
import { conduct } from '../src/orchestrator/conductor';
import { chordSpans, sectionMap, energyCurve, orchestrationSeedFor, ticksToMs } from '../src/orchestrator/spine';
import { sanitizeNotes } from '../src/engine/generate';
import { buildMergedMidi, parseMidiFile } from '../src/export/midi';
import { MAX_CC_POINTS_PER_LANE, type CcLane, type Note, type Project, type Track } from '../src/shared/schema/types';
import { projectEndTick, projectFromFixture, validateProject } from '../src/shared/schema';
import type { OrchestratorContext } from '../src/orchestrator/module';

/**
 * Phase 5e — the full expression matrix: 6 templates × key/mode combos ×
 * takes, asserting the whole Phase-5 contract on every cell:
 *   - determinism (the same inputs + take compose byte-identically);
 *   - every humanize offset sits in its ms range through the tempo map, and
 *     no humanized start is ever before its written (grid) start;
 *   - sanitizeNotes is still a no-op, validateProject passes;
 *   - CC lanes are valid (sorted, in [0, end], capped), CC7 static, CC68
 *     high only over legato notes, no CC on locked tracks;
 *   - MIDI export round-trips the new CC;
 *   - measureEnergy stays <= the clamp.
 * The report prints offset min/max per track and CC point counts per track
 * per template (the lane cap is never approached on the 40-bar fixture).
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

/**
 * Matches each humanized note back to its pre-humanize origin: same pitch,
 * same (kept) end, and among those the nearest start that is not later —
 * the offsets are small, so the nearest-earlier candidate is the origin.
 */
const matchBefore = (pool: Map<string, Note[]>, a: Note): Note | undefined => {
  const cands = pool.get(`${a.pitch}:${a.startTick + a.durationTicks}`);
  if (!cands || !cands.length) return undefined;
  let best = 0;
  for (let i = 1; i < cands.length; i++) {
    if (cands[i].startTick <= a.startTick
      && (cands[best].startTick > a.startTick || Math.abs(cands[i].startTick - a.startTick) < Math.abs(cands[best].startTick - a.startTick))) best = i;
  }
  if (cands[best].startTick > a.startTick) return undefined; // no earlier candidate: not a match
  if (a.startTick - cands[best].startTick > 120) return undefined; // beyond any humanize head: a merge hybrid, not the origin
  const b = cands.splice(best, 1)[0];
  if (!cands.length) pool.delete(`${a.pitch}:${a.startTick + a.durationTicks}`);
  return b;
};

/** The exact pre-humanize strings notes (the compose pipeline's own steps).
 *  composeAllTracks INCREMENTS the take internally — mirror that here. */
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

describe('Phase 5e: the expression matrix (6 templates × 3 key/modes × takes 0..2)', () => {
  const combos: { templateId: string; key: number; mode: string; name: string; take: number }[] = [];
  for (const templateId of TEMPLATES) for (const k of KEYS) for (const take of [0, 1, 2]) {
    combos.push({ templateId, key: k.key, mode: k.mode, name: k.name, take });
  }

  it('every cell: validate + sanitize no-op + determinism + CC validity + energy clamp + non-negative starts', () => {
    let cells = 0;
    for (const c of combos) {
      const p = BASE();
      p.key = c.key as Project['key'];
      p.mode = c.mode as Project['mode'];
      const { project } = composeTake(p, c.templateId, c.take);
      cells++;
      expect(validateProject(project).ok, `${c.templateId} ${c.name} take ${c.take}`).toBe(true);
      const end = projectEndTick(project);
      for (const t of project.tracks.filter((x) => x.family === 'Strings' && x.notes.length)) {
        expect(sanitizeNotes(t.notes, t.lowestNote, t.highestNote, end)).toEqual(t.notes);
        for (const n of t.notes) {
          expect(n.startTick).toBeGreaterThanOrEqual(0); // never before the grid start
          expect(n.startTick + n.durationTicks).toBeLessThanOrEqual(end);
        }
      }
      // CC lanes valid + CC7 static
      for (const t of project.tracks.filter((x) => x.family === 'Strings' && x.notes.length)) {
        const ccs = t.cc!.map((l) => l.cc);
        expect(new Set(ccs).size).toBe(ccs.length);
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
        expect(laneOf(t, 7)!.points).toEqual([{ tick: 0, value: 90 }]);
        // CC68 high only over legato notes
        const l68 = laneOf(t, 68);
        if (l68) {
          for (let i = 0; i < l68.points.length; i++) {
            if (l68.points[i].value !== 127) continue;
            const lo = l68.points[i].tick;
            const hi = l68.points[i + 1]?.tick ?? Number.POSITIVE_INFINITY;
            const legatoInside = t.notes.some((n) => n.articulation === 'legato' && n.startTick < hi && n.startTick + n.durationTicks > lo);
            expect(legatoInside, `CC68 127 without legato at [${lo},${hi}) on ${t.name}`).toBe(true);
          }
        }
      }
      // energy clamp on the full mix
      const template = ENSEMBLE_BY_ID.get(c.templateId)!;
      const energy = measureEnergy(project, template);
      expect(energy.max).toBeLessThanOrEqual(template.budget.energyClamp[1] + 1e-9);
      expect(energy.violations.filter((v) => v.kind === 'aboveMax')).toHaveLength(0);
    }
    expect(cells).toBe(54);
    console.log(`5e matrix: ${cells} cells (6 templates × 3 key/modes × takes 0..2) all green`);
  });

  it('every cell: determinism (the same take composes byte-identically, notes and CC)', () => {
    for (const c of combos.filter((x) => x.take === 0)) {
      const p = BASE();
      p.key = c.key as Project['key'];
      p.mode = c.mode as Project['mode'];
      const a = composeTake(p, c.templateId, 0);
      const b = composeTake(BASE(), c.templateId, 0);
      (b.project as Project).key = c.key as Project['key'];
      (b.project as Project).mode = c.mode as Project['mode'];
      const b2 = composeTake(b.project, c.templateId, 0);
      expect(JSON.stringify(a.project.tracks.map((t) => ({ n: t.notes, c: t.cc }))))
        .toBe(JSON.stringify(b2.project.tracks.map((t) => ({ n: t.notes, c: t.cc }))));
    }
  });

  it('every cell: each offset is in its ms range through the tempo map and never negative', () => {
    for (const c of combos) {
      const p = BASE();
      p.key = c.key as Project['key'];
      p.mode = c.mode as Project['mode'];
      const { project } = composeTake(p, c.templateId, c.take);
      const pre = preHumanizeStrings(p, c.templateId, c.take); // same mutated key/mode
      const roleOf = new Map(p.tracks.map((t) => [t.id, t.role]));
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
          if (!b) continue; // deduped duplicate — starts only compared when matched
          const ms = ticksToMs(a.startTick, project.tempoMap) - ticksToMs(b.startTick, project.tempoMap);
          const q = ticksToMs(1, project.tempoMap);
          const top = range[1] + (isDouble(b) ? CB_FOLLOW_MAX_MS : 0);
          expect(ms, `${c.templateId} ${c.name} take ${c.take} ${role}`).toBeGreaterThanOrEqual(range[0] - q - 1e-6);
          expect(ms).toBeLessThanOrEqual(top + q + 1e-6);
          expect(a.startTick).toBeGreaterThanOrEqual(b.startTick); // positive only
        }
      }
    }
  }, 120000);

  it('no CC on locked tracks (locked lanes come back untouched)', () => {
    const p = BASE();
    const vla = p.tracks.find((t) => t.role === 'violas')!;
    vla.locked = true;
    vla.notes = [{ pitch: 60, startTick: 0, durationTicks: 1920, velocity: 70 }];
    const { project } = composeTake(p, 'ensemble.cinematic', 0);
    const after = project.tracks.find((t) => t.id === vla.id)!;
    expect(after.cc).toBeUndefined();
    expect(after.notes).toEqual(vla.notes);
  });

  it('MIDI export round-trips the new CC lanes', () => {
    for (const templateId of TEMPLATES) {
      const { project } = composeTake(THREE(), templateId, 0);
      const bytes = buildMergedMidi(project, project.tracks.filter((t) => t.family === 'Strings'));
      const parsed = parseMidiFile(bytes);
      for (const t of project.tracks.filter((x) => x.family === 'Strings' && x.notes.length)) {
        const pt = parsed.tracks.find((x) => x.name === t.name);
        expect(pt, t.name).toBeTruthy();
        // the written CC events must equal the lane points, per controller
        const byLane = new Map<number, { tick: number; value: number }[]>();
        for (const e of pt!.cc) (byLane.get(e.cc) ?? byLane.set(e.cc, []).get(e.cc)!).push({ tick: e.tick, value: e.value });
        for (const lane of t.cc ?? []) {
          const got = (byLane.get(lane.cc) ?? []).sort((a, b) => a.tick - b.tick);
          expect(got, `${t.name} CC${lane.cc}`).toEqual([...lane.points].sort((a, b) => a.tick - b.tick));
          byLane.delete(lane.cc);
        }
        expect([...byLane.keys()], `${t.name} extra lanes`).toEqual([]);
      }
    }
  });

  it('report: offset min/max per track and CC point counts per track per template (cap never approached)', () => {
    const lines: string[] = [];
    let worstLane = 0;
    for (const templateId of TEMPLATES) {
      const { project } = composeTake(THREE(), templateId, 0);
      const pre = preHumanizeStrings(THREE(), templateId, 0);
      for (const id of pre.voiceTrackIds) {
        const pool = new Map<string, Note[]>();
        for (const b of pre.notesByTrackId[id]) {
          const k = `${b.pitch}:${b.startTick + b.durationTicks}`;
          (pool.get(k) ?? pool.set(k, []).get(k)!).push(b);
        }
        const after = project.tracks.find((t) => t.id === id)!.notes;
        const offs: number[] = [];
        for (const a of after) {
          const b = matchBefore(pool, a);
          if (b) offs.push(ticksToMs(a.startTick, project.tempoMap) - ticksToMs(b.startTick, project.tempoMap));
        }
        const track = project.tracks.find((t) => t.id === id)!;
        const laneCounts = (track.cc ?? []).map((l) => l.points.length);
        worstLane = Math.max(worstLane, ...(laneCounts.length ? laneCounts : [0]));
        lines.push(`  ${templateId.slice(9).padEnd(13)} ${track.name.padEnd(15)} offset ${offs.length ? `${Math.min(...offs).toFixed(1)}..${Math.max(...offs).toFixed(1)} ms` : '—'}  cc lanes ${(track.cc ?? []).length} points ${laneCounts.join('/')}`);
      }
    }
    console.log(`5e report (three-chorus 40-bar fixture, take 1; lane cap ${MAX_CC_POINTS_PER_LANE}, worst lane ${worstLane}):\n${lines.join('\n')}`);
    expect(worstLane).toBeLessThan(300);
  });
});
