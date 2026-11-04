import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/dorian-16bars.json';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { humanizeHeadTicks } from '../src/orchestrator/expression/timing';
import { barKindOf, PHRASE_BARS } from '../src/orchestrator/expression/cc';
import {
  INTERLOCK_CELL_IDS, OSTINATO_CELL_WEIGHTS,
  sectionTypeKeyOf, textureForType,
} from '../src/orchestrator/conductor/layers';
import { ACCENT_VELOCITY, cellGrid, ostinatoNotes, subdivisionTicks, type OstinatoInput } from '../src/orchestrator/lines/ostinato';
import { barTicks, beatTicks, projectBars } from '../src/shared/schema/meter';
import { chordSpans, sectionMap, energyCurve } from '../src/orchestrator/spine';
import { measureEnergy } from '../src/orchestrator/energy';
import { sanitizeNotes } from '../src/engine/generate';
import { resolveTemplate } from '../src/config/ensembles';
import { projectFromFixture, type Project } from '../src/shared/schema';

/**
 * Phase 4.8 — ostinato variety: per take and section type the texture draws
 * a whole ostinato STYLE from the D8 seed (named weights):
 *   - a rhythm CELL — meter-aware onsets over the felt beats (straight 8ths,
 *     3+3+2, gallop, off-beat only, sparse 2-per-beat-group); the default
 *     stays calm, the 16th grid stays trailer-only (the gallop's two 16th
 *     pickups are its shape, not a rate);
 *   - a CONTOUR — ascending / descending / ping-pong / pedal + moving upper
 *     note, all on chord tones minus the leading tone, under the lead;
 *   - an ACCENT shape — cell downbeat, off-beat, or flat, under the cap;
 *   - a DENSITY curve — thin (one track) ↔ full (two) tracking the arc;
 *   - a PAIRING for the two-track texture — interlock or across-bar
 *     call/response (hocket).
 * CC and humanize read the notes, so they follow the cells automatically —
 * pinned here: onset slots, CC74 spike placement, tick-0 CC baseline,
 * determinism, and the 4.6 gating/calm-down contracts.
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

interface Run {
  take: number;
  tex: Record<string, string>;
  styles: Record<string, ReturnType<typeof textureForType>['style']>;
  project: Project;
  result: ReturnType<typeof composeAllTracks>;
  ctx: ReturnType<typeof textureCtx>;
}

const runBattery = (mk: () => Project): Run[] =>
  Array.from({ length: 40 }, (_, t) => {
    const { project, result } = composeTake(mk(), 'ensemble.cinematic', t);
    const tex = texturesOf(result);
    const ctx = textureCtx(project);
    const styles = Object.fromEntries(
      Object.entries(tex)
        .filter(([, id]) => OST_TEXTURES.has(id))
        .map(([type]) => [type, textureForType(ctx, type).style]),
    );
    return { take: result.orchestration.take, tex, styles, project, result, ctx };
  });

const isOstNote = (a: string | undefined): boolean => a === 'spiccato' || a === 'pizz';
const OST_TEXTURES = new Set(['singleOstinato', 'interlockingOstinato', 'pizzPulse', 'trailer']);
const ostNotesOf = (project: Project, role: string, from?: number, to?: number) =>
  project.tracks.find((t) => t.role === role)!.notes.filter((n) => isOstNote(n.articulation) && (from === undefined || n.startTick >= from) && (to === undefined || n.startTick < to));

const runs = runBattery(THREE);
const dorianRuns = runBattery(BASE);

/** Every ostinato onset of one drawn (take, type) sits on its cell's slots
 *  (within the humanize head) — which IS the felt-beat lattice. */
const verifyOnsets = (r: Run, type: string, label: string) => {
  const style = r.styles[type];
  const ts = r.project.timeSignature;
  const grid = cellGrid(ts, style.cell, style.rate);
  const beat = beatTicks(ts);
  const barT = barTicks(ts);
  const slot = Math.floor(beat / grid.perBeat);
  const totalSlots = grid.perBeat * (barT / beat);
  const secs = sectionMap(r.project).filter((s) => sectionTypeKeyOf(s.name) === type);
  for (const sec of secs) {
    for (const role of ['violins2', 'violas']) {
      const half = style.interlock && style.pairing === 'interlock' && role === 'violas' ? Math.floor(slot / 2) : 0;
      for (const n of ostNotesOf(r.project, role, sec.startTick, sec.endTick)) {
        const local = n.startTick - half;
        const inBar = local - Math.floor(local / barT) * barT;
        const idx = Math.round(inBar / slot);
        expect(Math.abs(inBar - idx * slot), `${label}: onset ${n.startTick} off the ${style.cell} ${style.rate} grid`)
          .toBeLessThanOrEqual(humanizeHeadTicks(r.project.tempoMap, n.startTick));
        expect(grid.slots.includes(((idx % totalSlots) + totalSlots) % totalSlots),
          `${label}: onset ${n.startTick} not on the ${style.cell} cell (take ${r.take} ${type} ${role})`).toBe(true);
      }
    }
  }
};

/* ---------------- unit level: the vocabulary is exact ---------------- */

const TONES = [
  { pc: 0, tier: 'root' as const, rank: 1 },
  { pc: 4, tier: 'third' as const, rank: 2 },
  { pc: 7, tier: 'fifth' as const, rank: 3 },
];
const unitInput = (over: Partial<OstinatoInput>): OstinatoInput => ({
  ts: { numerator: 4, denominator: 4 },
  tempoMap: [{ tick: 0, bpm: 100 }],
  startTick: 0,
  endTick: 3840,
  tones: [{ pc: 0, tier: 'root', rank: 1 }], // one tone: the drawn pc is known (C)
  project: BASE(),
  spanIndex: 0,
  tracks: [{ low: 48, high: 84, comfortable: [55, 72] }],
  velocity: 64,
  velocityCap: 90,
  rate: 'eighths',
  cell: 'straight',
  contour: 'ascending',
  accent: 'flat',
  shape: 'repeat',
  interlock: false,
  clipShort: false,
  articulation: 'spiccato',
  ceilingPitch: null,
  ...over,
});

describe('Phase 4.8 (unit): the rhythm cells are meter-aware and land on felt beats', () => {
  it('cellGrid slots are exact in 4/4, 3/4 and 6/8 (simple beats: 2 or 4 slots; compound: 3)', () => {
    const q: Project['timeSignature'] = { numerator: 4, denominator: 4 };
    const three: Project['timeSignature'] = { numerator: 3, denominator: 4 };
    const compound: Project['timeSignature'] = { numerator: 6, denominator: 8 };
    expect(cellGrid(q, 'straight', 'eighths').slots).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(cellGrid(q, 'straight', 'sixteenths').slots).toEqual([...Array(16).keys()]); // the trailer grid
    expect(cellGrid(q, 'syncopated', 'eighths').slots).toEqual([0, 3, 6]); // 3+3+2
    expect(cellGrid(q, 'gallop', 'eighths').slots).toEqual([0, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15]);
    expect(cellGrid(q, 'offBeat', 'eighths').slots).toEqual([1, 3, 5, 7]);
    expect(cellGrid(q, 'sparse', 'eighths').slots).toEqual([0, 3, 4, 7]); // 2 per beat group with rests
    expect(cellGrid(three, 'straight', 'eighths').slots).toEqual([0, 1, 2, 3, 4, 5]);
    expect(cellGrid(three, 'syncopated', 'eighths').slots).toEqual([0, 3]); // 3+3
    expect(cellGrid(three, 'gallop', 'eighths').slots).toEqual([0, 2, 3, 4, 6, 7, 8, 10, 11]);
    expect(cellGrid(three, 'offBeat', 'eighths').slots).toEqual([1, 3, 5]);
    expect(cellGrid(three, 'sparse', 'eighths').slots).toEqual([0, 3, 4]); // group + the lone last beat downbeat
    expect(cellGrid(compound, 'straight', 'eighths').slots).toEqual([0, 1, 2, 3, 4, 5]);
    expect(cellGrid(compound, 'straight', 'sixteenths').slots).toEqual([0, 1, 2, 3, 4, 5]); // compound "16th" = the 8th grid
    expect(cellGrid(compound, 'syncopated', 'eighths').slots).toEqual([0, 3]); // the dotted-beat downbeats
    expect(cellGrid(compound, 'gallop', 'eighths').slots).toEqual([0, 2, 3, 5]); // 8th-rest-8th lilt
    expect(cellGrid(compound, 'offBeat', 'eighths').slots).toEqual([1, 4]); // the middle 8th of each dotted beat
    expect(cellGrid(compound, 'sparse', 'eighths').slots).toEqual([0, 5]); // downbeat + the pickup back
  });

  it('every cell lands its onsets on felt-beat subdivisions in 6/8 (the compound meter)', () => {
    const ts: Project['timeSignature'] = { numerator: 6, denominator: 8 };
    const beat = beatTicks(ts); // the dotted quarter
    for (const cell of ['straight', 'syncopated', 'gallop', 'offBeat', 'sparse'] as const) {
      const notes = ostinatoNotes(unitInput({ ts, cell, endTick: barTicks(ts) }))[0];
      expect(notes.length).toBeGreaterThan(0);
      for (const n of notes) {
        const inBeat = n.startTick % beat;
        expect(inBeat % Math.floor(beat / 3)).toBe(0); // an 8th of the dotted beat, never between
      }
    }
  });

  it('3/4: the sparse cell puts its lone last beat on the downbeat, never an offbeat', () => {
    const ts: Project['timeSignature'] = { numerator: 3, denominator: 4 };
    const notes = ostinatoNotes(unitInput({ ts, cell: 'sparse', endTick: barTicks(ts) }))[0];
    const ticks = notes.map((n) => n.startTick).sort((a, b) => a - b);
    expect(ticks).toEqual([0, 1440, 1920]); // beat 1, the "and" of 2, the lone beat 3 downbeat
  });
});

describe('Phase 4.8 (unit): the contours walk the register, the accents ride the cap', () => {
  it('ascending climbs and wraps; descending falls and wraps', () => {
    const asc = ostinatoNotes(unitInput({ contour: 'ascending' }))[0].map((n) => n.pitch);
    expect(asc).toEqual([48, 60, 72, 84, 48, 60, 72, 84]); // the C walk in 48..84
    const desc = ostinatoNotes(unitInput({ contour: 'descending' }))[0].map((n) => n.pitch);
    expect(desc).toEqual([84, 72, 60, 48, 84, 72, 60, 48]);
  });

  it('ping-pong zigzags and bounces off the window edge', () => {
    const pitches = ostinatoNotes(unitInput({ contour: 'pingPong' }))[0].map((n) => n.pitch);
    expect(pitches).toEqual([48, 60, 72, 60, 72, 60, 72, 60]); // up, down, up, ... bouncing off the bottom
  });

  it('pedal holds a fixed low note under moving upper tones', () => {
    const notes = ostinatoNotes(unitInput({ contour: 'pedal', shape: 'arpeggio', tones: TONES }))[0];
    expect(notes.length).toBe(8);
    const pedal = notes[0].pitch;
    expect(pedal).toBe(48); // the lowest chord tone (C) in the window
    for (let i = 0; i < notes.length; i++) {
      if (i % 2 === 0) expect(notes[i].pitch).toBe(pedal);
      else expect(notes[i].pitch).toBeGreaterThan(pedal); // the moving upper note
    }
  });

  it('all contours stay on chord tones, in range, and never overlap themselves', () => {
    for (const contour of ['ascending', 'descending', 'pingPong', 'pedal'] as const) {
      for (const cell of ['straight', 'syncopated', 'gallop', 'offBeat', 'sparse'] as const) {
        const notes = ostinatoNotes(unitInput({ contour, cell, shape: 'arpeggio', tones: TONES }))[0].sort((a, b) => a.startTick - b.startTick);
        for (const n of notes) {
          expect(n.pitch).toBeGreaterThanOrEqual(48);
          expect(n.pitch).toBeLessThanOrEqual(84);
          expect(TONES.some((t) => ((n.pitch % 12) + 12) % 12 === t.pc)).toBe(true);
        }
        for (let i = 1; i < notes.length; i++) {
          expect(notes[i].startTick).toBeGreaterThanOrEqual(notes[i - 1].startTick + notes[i - 1].durationTicks);
        }
      }
    }
  });

  it('downbeat accent lifts the bar first onset; offBeat accent lifts slot 1; the cap holds', () => {
    const down = ostinatoNotes(unitInput({ accent: 'downbeat' }))[0];
    expect(down[0].velocity).toBe(64 + ACCENT_VELOCITY);
    for (let i = 1; i < down.length; i++) expect(down[i].velocity).toBe(64);
    const off = ostinatoNotes(unitInput({ accent: 'offBeat' }))[0];
    for (const n of off) expect(n.velocity).toBe(n.startTick % 960 === 480 ? 64 + ACCENT_VELOCITY : 64);
    const capped = ostinatoNotes(unitInput({ accent: 'downbeat', velocityCap: 70 }))[0];
    for (const n of capped) expect(n.velocity).toBeLessThanOrEqual(70);
    expect(capped[0].velocity).toBe(70); // clamped, never past the governor cap
    const flat = ostinatoNotes(unitInput({ accent: 'flat' }))[0];
    for (const n of flat) expect(n.velocity).toBe(64);
  });
});

/* ---------------- end to end: cinematic, takes 0..39, both fixtures ---------------- */

describe('Phase 4.8: the drawn style is real (three-chorus + dorian cinematic, takes 0..39)', () => {
  it('at least 6 distinct ostinato onset patterns across the ostinato takes — every onset on its drawn cell', () => {
    const patterns = new Map<string, number>();
    let draws = 0;
    for (const r of [...runs, ...dorianRuns]) {
      for (const type of Object.keys(r.styles)) {
        verifyOnsets(r, type, `take ${r.take}`);
        const style = r.styles[type];
        patterns.set(`${style.cell}:${style.rate}`, (patterns.get(`${style.cell}:${style.rate}`) ?? 0) + 1);
        draws++;
      }
    }
    console.log(`4.8 onset patterns (${draws} verified draws): ${[...patterns.entries()].map(([k, v]) => `${k}x${v}`).join(', ')}`);
    expect(patterns.size).toBeGreaterThanOrEqual(6);
  });

  it('two ostinato takes never share both cell and contour more than ~25% of the time', () => {
    const combos = new Map<string, number>();
    let n = 0;
    for (const r of [...runs, ...dorianRuns]) {
      for (const style of Object.values(r.styles)) {
        const key = `${style.cell}|${style.contour}`;
        combos.set(key, (combos.get(key) ?? 0) + 1);
        n++;
      }
    }
    const worst = [...combos.entries()].sort((a, b) => b[1] - a[1])[0];
    console.log(`4.8 (cell,contour) draws: ${n}, worst share ${worst[0]} = ${((worst[1] / n) * 100).toFixed(1)}% over ${combos.size} combos`);
    for (const [, count] of combos) expect(count / n).toBeLessThanOrEqual(0.26);
    expect(combos.size).toBeGreaterThanOrEqual(12); // real variety, not a degenerate draw
  });

  it('the style dimensions are genuinely drawn: contours, accents, densities, hocket all appear', () => {
    const contours = new Set<string>();
    const accents = new Set<string>();
    const densities = new Set<string>();
    const pairings = new Set<string>();
    for (const r of [...runs, ...dorianRuns]) {
      for (const style of Object.values(r.styles)) {
        contours.add(style.contour);
        accents.add(style.accent);
        densities.add(style.density);
        pairings.add(style.pairing);
      }
    }
    expect(contours.size).toBeGreaterThanOrEqual(3);
    expect(accents.size).toBe(3);
    expect(densities.size).toBe(2);
    expect(pairings.has('hocket')).toBe(true);
    expect(pairings.has('interlock')).toBe(true);
    console.log(`4.8 drawn styles: contours ${[...contours].join('/')}, accents ${[...accents].join('/')}, densities ${[...densities].join('/')}, pairings ${[...pairings].join('/')}`);
  });

  it('the interlocking texture only draws calm cells (no gallop: two gallop tracks break the calm-down bound)', () => {
    let checked = 0;
    for (const r of [...runs, ...dorianRuns]) {
      for (const [type, style] of Object.entries(r.styles)) {
        if (r.tex[type] !== 'interlockingOstinato') continue;
        expect(INTERLOCK_CELL_IDS).toContain(style.cell);
        checked++;
      }
    }
    expect(Object.keys(OSTINATO_CELL_WEIGHTS)).toContain('gallop');
    expect(checked).toBeGreaterThanOrEqual(1);
    console.log(`4.8 interlock cells verified on ${checked} draws: only calm cells`);
  });

  it('hocket takes answer across bars: exactly one track per bar, V2 on even section bars', () => {
    let checked = 0;
    for (const r of runs) {
      for (const [type, style] of Object.entries(r.styles)) {
        if (r.tex[type] !== 'interlockingOstinato' || style.pairing !== 'hocket') continue;
        for (const sec of sectionMap(r.project).filter((s) => sectionTypeKeyOf(s.name) === type)) {
          for (let b = sec.startBar; b < sec.startBar + sec.lengthBars; b++) {
            const v2 = ostNotesOf(r.project, 'violins2', (b - 1) * BT, b * BT).length;
            const vla = ostNotesOf(r.project, 'violas', (b - 1) * BT, b * BT).length;
            if (v2 === 0 && vla === 0) continue; // gated bar (enterAfter / dip)
            expect(v2 === 0 || vla === 0, `take ${r.take} bar ${b}: the hocket never doubles`).toBe(true);
            if ((b - sec.startBar) % 2 === 0) expect(v2).toBeGreaterThan(0);
            else expect(vla).toBeGreaterThan(0);
          }
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(1);
    console.log(`4.8 hocket alternation verified on ${checked} (take, type) draws`);
  });

  it('density-curve takes thin to one track on their arc half and fill to two on the other', () => {
    let checked = 0;
    let thinBars = 0;
    let fullBars = 0;
    let bothSound = 0;
    let squeezed = 0;
    for (const r of runs) {
      for (const [type, style] of Object.entries(r.styles)) {
        if (r.tex[type] !== 'interlockingOstinato' || style.pairing !== 'interlock') continue;
        for (const sec of sectionMap(r.project).filter((s) => sectionTypeKeyOf(s.name) === type)) {
          let lo = Infinity;
          let hi = -Infinity;
          for (let b = sec.startBar; b < sec.startBar + sec.lengthBars; b++) {
            const t = r.ctx.arc[b - 1]?.target ?? 0;
            lo = Math.min(lo, t);
            hi = Math.max(hi, t);
          }
          const thr = (lo + hi) / 2;
          for (let b = sec.startBar; b < sec.startBar + sec.lengthBars; b++) {
            const target = r.ctx.arc[b - 1]?.target ?? 0;
            const full = style.density === 'rise' ? target >= thr : target <= thr;
            const v2 = ostNotesOf(r.project, 'violins2', (b - 1) * BT, b * BT).length;
            const vla = ostNotesOf(r.project, 'violas', (b - 1) * BT, b * BT).length;
            if (v2 === 0 && vla === 0) continue; // gated bar
            if (full) {
              // full bars are never gated by the curve: the upper track runs
              // the cell; the viola sounds too unless the under-lead ceiling
              // squeezed its only candidates out (pre-existing pitch physics,
              // not a density gate — the same squeeze can empty any
              // interlocked bar)
              expect(v2, `take ${r.take} bar ${b}: full bars keep the upper track`).toBeGreaterThan(0);
              fullBars++;
              if (vla > 0) bothSound++;
              else squeezed++;
            } else {
              expect(vla, `take ${r.take} bar ${b}: thin bars leave the viola out`).toBe(0);
              expect(v2, `take ${r.take} bar ${b}: thin bars keep the upper track`).toBeGreaterThan(0);
              thinBars++;
            }
          }
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(1);
    expect(thinBars).toBeGreaterThan(0);
    expect(fullBars).toBeGreaterThan(0); // the curve really moves — never a fixed on/off
    expect(bothSound).toBeGreaterThan(0); // the two-track sound really occurs on full bars
    console.log(`4.8 density curve verified on ${checked} draws: ${thinBars} thin bars, ${fullBars} full bars (${bothSound} with both tracks, ${squeezed} ceiling-squeezed)`);
  });

  it('downbeat accents stay audible above the same bar other onsets (humanize jitter averaged out)', () => {
    // very high-energy bars sit at the governor cap where the accent cannot
    // rise (by design: it never passes the cap) — so the assertion is the
    // AGGREGATE over all downbeat-accented draws, plus at least one clearly
    // accented draw
    const aggFirst: number[] = [];
    const aggOthers: number[] = [];
    let checked = 0;
    let clear = 0;
    for (const r of runs) {
      for (const [, style] of Object.entries(r.styles)) {
        if (style.accent !== 'downbeat') continue;
        const firsts: number[] = [];
        const others: number[] = [];
        for (const role of ['violins2', 'violas']) {
          const notes = ostNotesOf(r.project, role).sort((a, b) => a.startTick - b.startTick);
          for (let i = 0; i < notes.length; i++) {
            const bar = Math.floor(notes[i].startTick / BT);
            const isFirst = i === 0 || Math.floor(notes[i - 1].startTick / BT) !== bar;
            (isFirst ? firsts : others).push(notes[i].velocity);
          }
        }
        if (firsts.length < 5 || others.length < 5) continue;
        const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
        aggFirst.push(...firsts);
        aggOthers.push(...others);
        if (mean(firsts) > mean(others) + 4) clear++;
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(1);
    expect(clear, 'at least one draw must show a clearly audible accent').toBeGreaterThanOrEqual(1);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(aggFirst), `aggregate over ${checked} accent draws`).toBeGreaterThan(mean(aggOthers));
    console.log(`4.8 downbeat accent verified over ${checked} draws (${clear} clearly accented): aggregate firsts ${mean(aggFirst).toFixed(1)} vs others ${mean(aggOthers).toFixed(1)}`);
  });

  it('hygiene: ostinato notes stay in range, never self-overlap, sanitize stays a no-op, energy <= clamp', () => {
    for (const r of [...runs.slice(0, 8), ...dorianRuns.slice(0, 8)]) {
      const end = projectBars(r.project) * barTicks(r.project.timeSignature);
      for (const role of ['violins2', 'violas']) {
        const track = r.project.tracks.find((t) => t.role === role)!;
        const notes = ostNotesOf(r.project, role).sort((a, b) => a.startTick - b.startTick);
        for (const n of notes) {
          expect(n.pitch).toBeGreaterThanOrEqual(track.lowestNote);
          expect(n.pitch).toBeLessThanOrEqual(track.highestNote);
          expect(n.velocity).toBeLessThanOrEqual(127);
        }
        for (let i = 1; i < notes.length; i++) {
          expect(notes[i].startTick).toBeGreaterThanOrEqual(notes[i - 1].startTick + notes[i - 1].durationTicks);
        }
        expect(JSON.stringify(sanitizeNotes(track.notes, track.lowestNote, track.highestNote, end)))
          .toBe(JSON.stringify(track.notes)); // sanitize is a no-op on the composed score
      }
    }
    for (const r of [runs[0], runs[7], dorianRuns[3]]) {
      const report = measureEnergy(r.project, r.ctx.template);
      expect(report.violations.filter((v) => v.severity === 'hard')).toEqual([]);
      expect(report.max).toBeLessThanOrEqual(r.ctx.template.budget.energyClamp[1] + 1e-9);
    }
  });
});

/* ---------------- kept contracts: the trailer, CC74, gating ---------------- */

describe('Phase 4.8: the trailer stays the pinned full 16th grid (kept contracts)', () => {
  const trailer = runs.find((r) => r.tex.chorus === 'trailer');
  it('cell straight, rate sixteenths, every onset on the subdivision within the head', () => {
    expect(trailer).toBeTruthy();
    const style = trailer!.styles.chorus;
    expect(style.cell).toBe('straight');
    expect(style.rate).toBe('sixteenths');
    const step = subdivisionTicks({ numerator: 4, denominator: 4 });
    const CHORUS_FROM = 5 * BT;
    const head = humanizeHeadTicks(trailer!.project.tempoMap, CHORUS_FROM);
    for (const role of ['violins2', 'violas']) {
      const notes = ostNotesOf(trailer!.project, role, CHORUS_FROM);
      expect(notes.length).toBeGreaterThan(50);
      for (const n of notes) expect(n.startTick % step).toBeLessThanOrEqual(head);
    }
  });

  it('the 4.6 gating shape survives the cells: first bar, dip bar, 4th-bar last beat', () => {
    const CHORUSES = [5, 17, 29];
    for (const r of runs) {
      if (!OST_TEXTURES.has(r.tex.chorus)) continue;
      const perBar = new Map<number, number>();
      for (const role of ['violins2', 'violas']) {
        for (const n of ostNotesOf(r.project, role)) {
          const bar = Math.floor(n.startTick / BT) + 1;
          perBar.set(bar, (perBar.get(bar) ?? 0) + 1);
        }
      }
      for (const c of CHORUSES) {
        expect(perBar.get(c) ?? 0).toBe(0); // enters after the first bar
        expect(perBar.get(c + 7) ?? 0).toBe(0); // the dip bar rests
        const fourth = c + 3;
        for (const role of ['violins2', 'violas']) {
          for (const n of ostNotesOf(r.project, role, (fourth - 1) * BT, fourth * BT)) {
            expect(n.startTick).toBeLessThan(fourth * BT - 960); // the last beat rests
          }
        }
      }
    }
  });

  it('CC and humanize follow the cells: CC74 first-onset spikes land on the actual first onset per bar', () => {
    let checked = 0;
    for (const r of runs) {
      if (!Object.keys(r.styles).length) continue;
      const bars = r.result.plan.bars.length;
      for (const role of ['violins2', 'violas']) {
        const track = r.project.tracks.find((t) => t.role === role)!;
        const lane = track.cc?.find((l) => l.cc === 74);
        if (!lane) continue;
        const attackNotes = track.notes.filter((n) => isOstNote(n.articulation) || n.articulation === 'tremolo');
        if (!attackNotes.length) continue;
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
  });
});

describe('Phase 4.8: determinism + the 5.1.1 baseline on styled takes', () => {
  it('the same take composes byte-identically with the full style in the stream', () => {
    for (const take of [0, 3]) {
      const a = composeTake(BASE(), 'ensemble.cinematic', take);
      const b = composeTake(BASE(), 'ensemble.cinematic', take);
      expect(JSON.stringify(a.project.tracks)).toBe(JSON.stringify(b.project.tracks));
    }
  });

  it('a styled take still reports its texture and passes the CC tick-0 contract', () => {
    const { project, result } = composeTake(BASE(), 'ensemble.cinematic', 1);
    expect(result.reports.some((r) => r.startsWith('ostinato style'))).toBe(true);
    for (const t of project.tracks.filter((x) => x.family === 'Strings' && x.notes.length)) {
      for (const cc of [1, 11, 7]) {
        const lane = t.cc!.find((l) => l.cc === cc)!;
        expect(lane).toBeTruthy();
        expect(lane.points[0].tick).toBe(0);
      }
    }
  });
});

/* ---------------- meter fixtures: 3/4 and 6/8 ---------------- */

describe('Phase 4.8: 3/4 and 6/8 fixtures — cells land on felt beats', () => {
  const meterFixture = (numerator: number, denominator: number): Project => {
    const raw = JSON.parse(JSON.stringify(fixture));
    const ts = { numerator, denominator };
    const bt = barTicks(ts);
    raw.timeSignature = ts;
    raw.chords = Array.from({ length: 16 }, (_, b) => ({
      id: `m${b + 1}`,
      symbol: ['Dm7', 'G7', 'Dm7', 'Am7'][b % 4],
      startTick: b * bt,
      durationTicks: bt,
    }));
    raw.sections = [
      { id: 'mv', name: 'Verse', startBar: 1, lengthBars: 8 },
      { id: 'mc', name: 'Chorus', startBar: 9, lengthBars: 8 },
    ];
    return projectFromFixture(raw);
  };

  const verifyMeter = (numerator: number, denominator: number, meter: string) => {
    const runsMeter = Array.from({ length: 24 }, (_, t) => composeTake(meterFixture(numerator, denominator), 'ensemble.cinematic', t));
    const cells = new Set<string>();
    let draws = 0;
    for (const { project } of runsMeter) {
      const ctx = textureCtx(project);
      for (const type of ['verse', 'chorus']) {
        const tex = textureForType(ctx, type);
        if (!OST_TEXTURES.has(tex.id)) continue;
        const style = tex.style;
        const grid = cellGrid(project.timeSignature, style.cell, style.rate);
        const beat = beatTicks(project.timeSignature);
        const barT = barTicks(project.timeSignature);
        const slot = Math.floor(beat / grid.perBeat);
        const totalSlots = grid.perBeat * (barT / beat);
        const secs = sectionMap(project).filter((s) => sectionTypeKeyOf(s.name) === type);
        let saw = false;
        for (const sec of secs) {
          for (const role of ['violins2', 'violas']) {
            const half = style.interlock && style.pairing === 'interlock' && role === 'violas' ? Math.floor(slot / 2) : 0;
            for (const n of ostNotesOf(project, role, sec.startTick, sec.endTick)) {
              const local = n.startTick - half;
              const inBar = local - Math.floor(local / barT) * barT;
              const idx = Math.round(inBar / slot);
              expect(Math.abs(inBar - idx * slot), `${meter}: onset off the ${style.cell} grid`).toBeLessThanOrEqual(humanizeHeadTicks(project.tempoMap, n.startTick));
              expect(grid.slots.includes(((idx % totalSlots) + totalSlots) % totalSlots), `${meter}: onset not on the ${style.cell} cell`).toBe(true);
              const beatIdx = Math.floor(inBar / beat);
              const inBeat = inBar - beatIdx * beat;
              expect(inBeat % slot, `${meter}: onset between felt-beat subdivisions`).toBeLessThanOrEqual(humanizeHeadTicks(project.tempoMap, n.startTick));
              saw = true;
            }
          }
        }
        if (saw) {
          cells.add(style.cell);
          draws++;
        }
      }
    }
    expect(draws).toBeGreaterThanOrEqual(2);
    expect(cells.size).toBeGreaterThanOrEqual(3); // more than one cell really occurs in this meter
    console.log(`4.8 ${meter} cells observed: ${[...cells].join(', ')} over ${draws} draws`);
  };

  it('3/4: every ostinato onset of every drawn style sits on its felt-beat slots', () => {
    verifyMeter(3, 4, '3/4');
  });

  it('6/8: every ostinato onset of every drawn style sits on its felt-beat slots', () => {
    verifyMeter(6, 8, '6/8');
  });
});
