import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/dorian-16bars.json';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { humanizeHeadTicks } from '../src/orchestrator/expression/timing';
import { barKindOf, PHRASE_BARS } from '../src/orchestrator/expression/cc';
import { OSTINATO_CELLS, sectionTypeKeyOf, textureForType, type OstinatoCellId } from '../src/orchestrator/conductor/layers';
import { rateTicks } from '../src/orchestrator/lines/ostinato';
import { chordSpans, sectionMap, energyCurve } from '../src/orchestrator/spine';
import { resolveTemplate } from '../src/config/ensembles';
import { projectFromFixture, type Project } from '../src/shared/schema';

/**
 * Phase 4.8 — ostinato variants: the texture draws a RHYTHM CELL (a 4-step
 * mask over the rate grid, tiled through the bar) per take and section type,
 * alongside the existing shape/enterAfter/ost-track draws. The trailer pins
 * 'straight' (it IS the full 16th grid). The cells only remove onsets, so
 * the 4.6 gating and calm-down contracts keep holding; CC and humanize read
 * the notes, so they follow the new cells — pinned here:
 *   - cell onsets sit on their mask positions within the humanize head;
 *   - CC74's first-onset spikes land on the cells' first onset per bar;
 *   - the CC1/CC11 baseline (5.1.1) still covers the texture bars.
 */
const BT = 3840;
const BASE = (): Project => projectFromFixture(JSON.parse(JSON.stringify(fixture)));
const THREE = (): Project => projectFromFixture(JSON.parse(JSON.stringify(threeChorus)));

const composeTake = (project: Project, templateId: string, take: number) => {
  project.ensemble = { templateId, overrides: {}, pins: {} };
  project.orchestration = { take };
  const result = composeAllTracks(project, { seed: 11 });
  return { project: { ...project, tracks: result.tracks, orchestration: result.orchestration } as Project, result };
};

const texturesOf = (result: ReturnType<typeof composeAllTracks>): Record<string, string> => {
  const line = result.reports.find((r) => r.startsWith('textures'))!;
  expect(line).toBeTruthy();
  return Object.fromEntries(line.split(': ')[1].split(', ').map((kv) => kv.split('=')));
};

/** The take's texture objects (for style reads) — rebuilt deterministically. */
const textureCtx = (project: Project) => {
  const template = resolveTemplate(project.ensemble)!;
  const arc = energyCurve(project, sectionMap(project), project.orchestration!.take, template, true);
  return { project, template, ensemble: project.ensemble!, spans: chordSpans(project), sections: sectionMap(project), arc };
};

const isOstNote = (a: string | undefined): boolean => a === 'spiccato' || a === 'pizz';
const OST_TEXTURES = new Set(['singleOstinato', 'interlockingOstinato', 'pizzPulse', 'trailer']);

describe('Phase 4.8: the rhythm cells are drawn and real (three-chorus cinematic, takes 0..39)', () => {
  const runs = Array.from({ length: 40 }, (_, t) => {
    const { project, result } = composeTake(THREE(), 'ensemble.cinematic', t);
    const tex = texturesOf(result);
    const ctx = textureCtx(project);
    const cells: Record<string, OstinatoCellId> = {};
    for (const [type, id] of Object.entries(tex)) {
      if (OST_TEXTURES.has(id)) cells[type] = textureForType(ctx, type).style.cell;
    }
    return { take: result.orchestration.take, tex, cells, project, result };
  });

  it('ostinato-carrying takes drew real cells: >= 2 distinct cells across the 40 takes, always a known id', () => {
    const all = runs.flatMap((r) => Object.values(r.cells));
    expect(all.length).toBeGreaterThan(0);
    for (const c of all) expect(OSTINATO_CELLS[c]).toBeTruthy();
    const distinct = new Set(all);
    console.log(`4.8 cell distribution (${all.length} drawn cells): ${[...distinct].map((c) => `${c}=${all.filter((x) => x === c).length}`).join(', ')}`);
    expect(distinct.size).toBeGreaterThanOrEqual(2);
  });

  it('the same take redraws the same cells (the draw rides the texture seed)', () => {
    for (const t of [0, 7, 23]) {
      const again = composeTake(THREE(), 'ensemble.cinematic', t - 1 < 0 ? 39 : t - 1);
      void again;
    }
    // determinism is pinned per take by the 4.6/5e batteries; here: the cell
    // is a pure function of (inputs, take, type) — rebuild and compare
    for (const r of runs.slice(0, 8)) {
      const ctx = textureCtx(r.project);
      for (const [type, cell] of Object.entries(r.cells)) {
        expect(textureForType(ctx, type).style.cell).toBe(cell);
      }
    }
  });

  it('the trailer stays the full grid: cell straight, every onset on the 16th subdivision within the head', () => {
    const trailer = runs.find((r) => r.tex.chorus === 'trailer');
    expect(trailer).toBeTruthy();
    const ctx = textureCtx(trailer!.project);
    const style = textureForType(ctx, 'chorus').style;
    expect(style.cell).toBe('straight');
    expect(style.rate).toBe('sixteenths');
    const step = rateTicks({ numerator: 4, denominator: 4 }, 'sixteenths');
    const CHORUS_FROM = 5 * BT; // chorus 1 starts at bar 5 (enters 1-2 bars in)
    const head = humanizeHeadTicks(trailer!.project.tempoMap, CHORUS_FROM);
    for (const role of ['violins2', 'violas']) {
      const notes = trailer!.project.tracks.find((t) => t.role === role)!.notes.filter((n) => n.startTick >= CHORUS_FROM && isOstNote(n.articulation));
      expect(notes.length).toBeGreaterThan(50); // the full grid really runs
      for (const n of notes) expect(n.startTick % step).toBeLessThanOrEqual(head);
    }
  });

  it('non-trailer ostinato onsets sit on their cell mask (within the humanize head), both tracks', () => {
    let checked = 0;
    for (const r of runs) {
      const ostTypes = Object.entries(r.tex).filter(([, id]) => OST_TEXTURES.has(id) && id !== 'trailer');
      if (!ostTypes.length) continue;
      const ctx = textureCtx(r.project);
      for (const [type] of ostTypes) {
        const tex = textureForType(ctx, type);
        const mask = OSTINATO_CELLS[tex.style.cell];
        const step = rateTicks({ numerator: 4, denominator: 4 }, tex.style.rate);
        // the section type's bars
        const secs = sectionMap(r.project).filter((s) => sectionTypeKeyOf(s.name) === type);
        for (const sec of secs) {
          for (const role of ['violins2', 'violas']) {
            const track = r.project.tracks.find((t) => t.role === role)!;
            const notes = track.notes.filter((n) => isOstNote(n.articulation) && n.startTick >= sec.startTick && n.startTick < sec.endTick);
            if (!notes.length) continue;
            const half = tex.style.interlock && role === 'violas' ? step / 2 : 0;
            for (const n of notes) {
              const inBar = n.startTick - Math.floor(n.startTick / BT) * BT - half;
              const stepFloat = inBar / step;
              const idx = Math.round(stepFloat);
              expect(Math.abs(stepFloat - idx) * step, `onset ${n.startTick} off the ${tex.style.cell} grid (${r.take} ${type} ${role})`).toBeLessThanOrEqual(humanizeHeadTicks(r.project.tempoMap, n.startTick));
              expect(mask[((idx % mask.length) + mask.length) % mask.length], `onset ${n.startTick} on a masked-off step of ${tex.style.cell} (${r.take} ${type} ${role})`).toBe(1);
            }
          }
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
    console.log(`4.8 cell-mask verified over ${checked} (take, section type) draws`);
  });

  it('CC and humanize follow the cells: CC74 first-onset spikes land on the actual first onset per bar', () => {
    let checked = 0;
    for (const r of runs) {
      if (!Object.values(r.tex).some((id) => OST_TEXTURES.has(id))) continue;
      const bars = r.result.plan.bars.length;
      for (const role of ['violins2', 'violas']) {
        const track = r.project.tracks.find((t) => t.role === role)!;
        const lane = track.cc?.find((l) => l.cc === 74);
        if (!lane) continue;
        const attackNotes = track.notes.filter((n) => isOstNote(n.articulation) || n.articulation === 'tremolo');
        if (!attackNotes.length) continue;
        // expected spikes: phrase-start downbeats the track sounds on + the
        // first ostinato onset of every bar the track plays as texture
        const expected = new Set<number>();
        const secs = sectionMap(r.project);
        for (const sec of secs) {
          for (let b = sec.startBar; b < sec.startBar + sec.lengthBars; b += PHRASE_BARS) {
            if (b > bars) continue;
            if (barKindOf(track.notes, (b - 1) * BT, b * BT) !== null) expected.add((b - 1) * BT);
          }
        }
        for (let b = 1; b <= bars; b++) {
          const kind = barKindOf(track.notes, (b - 1) * BT, b * BT);
          if (kind !== 'ostinato' && kind !== 'tremolo') continue;
          const first = attackNotes.filter((n) => n.startTick >= (b - 1) * BT && n.startTick < b * BT).sort((x, y) => x.startTick - y.startTick)[0];
          if (first) expected.add(first.startTick);
        }
        const highTicks = lane.points.filter((p) => p.value > 0).map((p) => p.tick);
        expect(new Set(highTicks), `${r.take} ${role} CC74 spikes follow the cells`).toEqual(expected);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
    console.log(`4.8 CC74 spike placement verified on ${checked} ostinato track(s)`);
  });

  it('the cells keep the calm-down shape: no onset in a chorus first bar, the dip bar, or the last beat of every 4th bar', () => {
    const CHORUSES = [5, 17, 29];
    for (const r of runs) {
      if (r.tex.chorus !== 'trailer' && !OST_TEXTURES.has(r.tex.chorus)) continue;
      const perBar = new Map<number, number>();
      for (const role of ['violins2', 'violas']) {
        for (const n of r.project.tracks.find((t) => t.role === role)!.notes.filter((x) => isOstNote(x.articulation))) {
          const bar = Math.floor(n.startTick / BT) + 1;
          perBar.set(bar, (perBar.get(bar) ?? 0) + 1);
        }
      }
      for (const c of CHORUSES) {
        expect(perBar.get(c) ?? 0).toBe(0); // enters after the first bar
        expect(perBar.get(c + 7) ?? 0).toBe(0); // the dip bar rests
        const fourth = c + 3;
        for (const role of ['violins2', 'violas']) {
          for (const n of r.project.tracks.find((t) => t.role === role)!.notes.filter((x) => isOstNote(x.articulation))) {
            if (n.startTick >= (fourth - 1) * BT && n.startTick < fourth * BT) {
              expect(n.startTick).toBeLessThan(fourth * BT - 960); // the last beat rests
            }
          }
        }
      }
    }
  });
});

describe('Phase 4.8: the dorian fixture too (cells + determinism)', () => {
  it('the same take composes byte-identically with the cells in the stream', () => {
    for (const take of [0, 3]) {
      const a = composeTake(BASE(), 'ensemble.cinematic', take);
      const b = composeTake(BASE(), 'ensemble.cinematic', take);
      expect(JSON.stringify(a.project.tracks)).toBe(JSON.stringify(b.project.tracks));
    }
  });

  it('a cell-thinned take still reports its texture and passes the CC tick-0 contract', () => {
    const { project, result } = composeTake(BASE(), 'ensemble.cinematic', 1);
    expect(texturesOf(result)).toBeTruthy();
    for (const t of project.tracks.filter((x) => x.family === 'Strings' && x.notes.length)) {
      for (const cc of [1, 11, 7]) {
        const lane = t.cc!.find((l) => l.cc === cc)!;
        expect(lane).toBeTruthy();
        expect(lane.points[0].tick).toBe(0);
      }
    }
  });
});
