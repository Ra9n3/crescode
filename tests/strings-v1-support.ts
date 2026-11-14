/**
 * Shared support for the Strings V1 isolation harness (Stage 1).
 *
 * Runs the ordinary production `composeAllTracks` path and
 *   - fingerprints the string output of the CLASSIC mode (the regression
 *     baseline in tests/strings-classic-fingerprints.json), and
 *   - compares classic against V1 for the downstream comparison report.
 *
 * Measurement only: nothing here feeds back into composition, and nothing
 * here is imported by production code.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { composeAllTracks, type ComposeOptions, type ComposeResult } from '../src/orchestrator/compose';
import { buildPerTrackMidi } from '../src/export/midi';
import { EXPORT_PROFILES } from '../src/export/profiles';
import { isInstrumentTrack, projectFromFixture, type CcLane, type Note, type Project, type Track } from '../src/shared/schema';
import { barTicks } from '../src/shared/schema/meter';

const here = path.dirname(fileURLToPath(import.meta.url));

export const STRING_TEMPLATES = ['chamber', 'sonata', 'vocalbacking', 'cinematic', 'hybridstudio', 'symphony'] as const;
export type StringTemplateKey = typeof STRING_TEMPLATES[number];
export const STRING_FIXTURES = ['dorian-16bars', 'multi-chorus-16bars', 'three-chorus-40bars'] as const;
export type StringFixtureKey = typeof STRING_FIXTURES[number];

/** One deterministic composition request. */
export interface StringCell {
  readonly template: StringTemplateKey;
  readonly fixture: StringFixtureKey;
  readonly seed: number;
  /** Take stored on the project before composing (Compose All increments it). */
  readonly take: number;
  /** Omitted = the engine default. */
  readonly density?: number;
  readonly humanize?: boolean;
  readonly moments?: boolean;
}

export const stringCellId = (cell: StringCell): string =>
  [
    cell.template, cell.fixture, `seed${cell.seed}`, `take${cell.take}`,
    ...(cell.density !== undefined ? [`d${cell.density}`] : []),
    ...(cell.humanize !== undefined ? [`humanize-${cell.humanize}`] : []),
    ...(cell.moments !== undefined ? [`moments-${cell.moments}`] : []),
  ].join('__');

/**
 * The documented fingerprint matrix.
 *  - base: six templates x three fixtures x two takes (seed 1, engine defaults);
 *  - configurations: per template on dorian-16bars — another seed, a higher
 *    density, humanize off, and moments off.
 */
export function fingerprintCells(): StringCell[] {
  const cells: StringCell[] = [];
  for (const template of STRING_TEMPLATES) {
    for (const fixture of STRING_FIXTURES) {
      for (const take of [0, 3]) cells.push({ template, fixture, seed: 1, take });
    }
    cells.push({ template, fixture: 'dorian-16bars', seed: 7, take: 1 });
    cells.push({ template, fixture: 'dorian-16bars', seed: 1, take: 0, density: 0.9 });
    cells.push({ template, fixture: 'dorian-16bars', seed: 1, take: 0, humanize: false });
    cells.push({ template, fixture: 'dorian-16bars', seed: 1, take: 0, moments: false });
  }
  return cells;
}

export function projectForStringCell(cell: StringCell): Project {
  const doc = JSON.parse(readFileSync(path.join(here, '..', 'fixtures', `${cell.fixture}.json`), 'utf8')) as Partial<Project>;
  const project = projectFromFixture(doc);
  project.ensemble = { templateId: `ensemble.${cell.template}`, overrides: {}, pins: {} };
  project.orchestration = { take: cell.take };
  return project;
}

export type StringsModeOption = 'classic' | 'v1' | undefined;

export function composeOptionsFor(cell: StringCell, stringsComposition: StringsModeOption): ComposeOptions {
  return {
    seed: cell.seed,
    ...(cell.density !== undefined ? { density: cell.density } : {}),
    ...(cell.humanize !== undefined ? { humanize: cell.humanize } : {}),
    ...(cell.moments !== undefined ? { moments: cell.moments } : {}),
    ...(stringsComposition !== undefined ? { stringsComposition } : {}),
  };
}

export function composeStringCell(cell: StringCell, stringsComposition: StringsModeOption): { project: Project; result: ComposeResult } {
  const project = projectForStringCell(cell);
  return { project, result: composeAllTracks(project, composeOptionsFor(cell, stringsComposition)) };
}

/* ------------------------------------------------------------------ */
/* canonical forms                                                     */
/* ------------------------------------------------------------------ */

const sha = (text: string | Uint8Array): string => createHash('sha256').update(text).digest('hex').slice(0, 20);

/** Everything musical about one note: timing, pitch, velocity, articulation, bow and layer marks. */
export const noteKey = (n: Note): string =>
  `${n.startTick}:${n.durationTicks}:${n.pitch}:${n.velocity}:${n.articulation ?? ''}:${n.bow ?? ''}:${n.layer ?? ''}:${n.roleTag ?? ''}`;

const sortedNoteKeys = (notes: readonly Note[]): string[] => notes.map(noteKey).sort();

const laneKey = (lane: CcLane): string => `cc${lane.cc}=${lane.points.map((p) => `${p.tick}:${p.value}`).join(',')}`;
const sortedLaneKeys = (lanes: readonly CcLane[] | undefined): string[] => (lanes ?? []).map(laneKey).sort();

export const isStringTrack = (t: Track): boolean => t.family === 'Strings' && isInstrumentTrack(t);

export interface TrackFingerprint {
  readonly role: string;
  readonly notes: number;
  readonly noteHash: string;
  readonly ccLanes: number[];
  readonly ccPoints: number;
  readonly ccHash: string;
  readonly pitchLow: number | null;
  readonly pitchHigh: number | null;
  readonly velocitySum: number;
  readonly durationSum: number;
  readonly articulations: Record<string, number>;
  /** Hash of the track's exported MIDI file under the shipped export profile. */
  readonly exportHash: string | null;
}

export interface CellFingerprint {
  readonly strings: Record<string, TrackFingerprint>;
  /** Notes and controller lanes of every non-string instrument track, in one hash. */
  readonly otherFamiliesHash: string;
  /** The conductor's per-bar layers and moments, in one hash. */
  readonly conductorHash: string;
}

function trackFingerprint(track: Track, exportHash: string | null): TrackFingerprint {
  const articulations: Record<string, number> = {};
  for (const n of track.notes) articulations[n.articulation ?? 'none'] = (articulations[n.articulation ?? 'none'] ?? 0) + 1;
  const pitches = track.notes.map((n) => n.pitch);
  return {
    role: track.role,
    notes: track.notes.length,
    noteHash: sha(sortedNoteKeys(track.notes).join(';')),
    ccLanes: (track.cc ?? []).map((l) => l.cc).sort((a, b) => a - b),
    ccPoints: (track.cc ?? []).reduce((sum, l) => sum + l.points.length, 0),
    ccHash: sha(sortedLaneKeys(track.cc).join(';')),
    pitchLow: pitches.length ? Math.min(...pitches) : null,
    pitchHigh: pitches.length ? Math.max(...pitches) : null,
    velocitySum: track.notes.reduce((sum, n) => sum + n.velocity, 0),
    durationSum: track.notes.reduce((sum, n) => sum + n.durationTicks, 0),
    articulations: Object.fromEntries(Object.entries(articulations).sort(([a], [b]) => a.localeCompare(b))),
    exportHash,
  };
}

const conductorKey = (result: ComposeResult): string =>
  JSON.stringify({
    bars: result.plan.bars.map((b) => [b.bar, b.layers.map((l) => [l.layer, [...l.trackIds].sort()]), b.moment ? [b.moment.kind, b.moment.startBar, b.moment.endBar] : null]),
    moments: result.plan.moments.map((m) => [m.kind, m.startBar, m.endBar]),
  });

export function fingerprintResult(project: Project, result: ComposeResult): CellFingerprint {
  const composed: Project = { ...project, tracks: result.tracks, orchestration: result.orchestration };
  const stringTracks = result.tracks.filter(isStringTrack);
  const profile = EXPORT_PROFILES[0]?.profile ?? null;
  const files = buildPerTrackMidi(composed, stringTracks, profile);
  const strings: Record<string, TrackFingerprint> = {};
  stringTracks.forEach((track, i) => {
    strings[track.id] = trackFingerprint(track, files[i] ? sha(files[i].data) : null);
  });
  const others = result.tracks.filter((t) => isInstrumentTrack(t) && t.family !== 'Strings');
  return {
    strings: Object.fromEntries(Object.entries(strings).sort(([a], [b]) => a.localeCompare(b))),
    otherFamiliesHash: sha(others.map((t) => `${t.id}|${sortedNoteKeys(t.notes).join(';')}|${sortedLaneKeys(t.cc).join(';')}`).join('\n')),
    conductorHash: sha(conductorKey(result)),
  };
}

export const FINGERPRINT_FILE = path.join(here, 'strings-classic-fingerprints.json');

export interface FingerprintDocument {
  readonly description: string;
  readonly stringsComposition: 'classic';
  readonly cells: Record<string, CellFingerprint>;
}

export function loadFingerprintDocument(): FingerprintDocument {
  return JSON.parse(readFileSync(FINGERPRINT_FILE, 'utf8')) as FingerprintDocument;
}

/* ------------------------------------------------------------------ */
/* classic versus V1 comparison (diagnostic only)                      */
/* ------------------------------------------------------------------ */

export interface TrackDifference {
  readonly trackId: string;
  readonly role: string;
  readonly family: string;
  readonly noteCount: { classic: number; v1: number; delta: number };
  /** 1-indexed bars whose note content differs. */
  readonly changedBars: number[];
  readonly register: { classic: [number, number] | null; v1: [number, number] | null };
  readonly meanPitchDelta: number;
  readonly meanVelocity: { classic: number; v1: number; delta: number };
  /** Controller numbers whose lane differs. */
  readonly changedControllers: number[];
  readonly presentIn: 'both' | 'classic-only' | 'v1-only';
}

export interface ConsumedDifference {
  /** Bars where the tune carrier the other families read differs. */
  readonly carrierBars: number[];
  /** Tracks whose lead line the other families read differs. */
  readonly leadLineTracks: string[];
  readonly counterLineChanged: boolean;
  readonly soliLineTracks: string[];
  /** Bars where the conductor's layer slots differ, by layer name. */
  readonly conductorLayerBars: Record<string, number[]>;
  readonly momentsChanged: boolean;
}

export interface ModeComparison {
  readonly cell: string;
  /** 1. Direct string differences. */
  readonly strings: TrackDifference[];
  /** 2. Differences in the string information other families consume. */
  readonly consumed: ConsumedDifference;
  /** 3. Downstream behavioural differences, per family. */
  readonly downstream: Record<string, TrackDifference[]>;
  readonly totals: { stringTracksChanged: number; consumedChanged: boolean; downstreamTracksChanged: number; identical: boolean };
}

const mean = (values: number[]): number => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const rangeOf = (notes: readonly Note[]): [number, number] | null =>
  notes.length ? [Math.min(...notes.map((n) => n.pitch)), Math.max(...notes.map((n) => n.pitch))] : null;

function barsThatDiffer(a: readonly Note[], b: readonly Note[], barLength: number): number[] {
  const byBar = (notes: readonly Note[]): Map<number, string> => {
    const groups = new Map<number, string[]>();
    for (const n of notes) {
      const bar = Math.floor(n.startTick / barLength) + 1;
      groups.set(bar, [...(groups.get(bar) ?? []), noteKey(n)]);
    }
    return new Map([...groups].map(([bar, keys]) => [bar, keys.sort().join(';')]));
  };
  const left = byBar(a);
  const right = byBar(b);
  return [...new Set([...left.keys(), ...right.keys()])].filter((bar) => left.get(bar) !== right.get(bar)).sort((x, y) => x - y);
}

function trackDifference(classic: Track | undefined, v1: Track | undefined, barLength: number): TrackDifference | null {
  const a = classic?.notes ?? [];
  const b = v1?.notes ?? [];
  const lanesA = new Map((classic?.cc ?? []).map((l) => [l.cc, laneKey(l)]));
  const lanesB = new Map((v1?.cc ?? []).map((l) => [l.cc, laneKey(l)]));
  const changedControllers = [...new Set([...lanesA.keys(), ...lanesB.keys()])].filter((cc) => lanesA.get(cc) !== lanesB.get(cc)).sort((x, y) => x - y);
  const changedBars = barsThatDiffer(a, b, barLength);
  if (classic && v1 && !changedBars.length && !changedControllers.length) return null;
  const ref = (classic ?? v1)!;
  return {
    trackId: ref.id,
    role: ref.role,
    family: ref.family,
    noteCount: { classic: a.length, v1: b.length, delta: b.length - a.length },
    changedBars,
    register: { classic: rangeOf(a), v1: rangeOf(b) },
    meanPitchDelta: mean(b.map((n) => n.pitch)) - mean(a.map((n) => n.pitch)),
    meanVelocity: { classic: mean(a.map((n) => n.velocity)), v1: mean(b.map((n) => n.velocity)), delta: mean(b.map((n) => n.velocity)) - mean(a.map((n) => n.velocity)) },
    changedControllers,
    presentIn: classic && v1 ? 'both' : classic ? 'classic-only' : 'v1-only',
  };
}

interface ConsumedView {
  carrierByBar: (string | null)[];
  leads: { trackId: string; notes: Note[] }[];
  counter: { trackId: string; notes: Note[] } | null;
  soliLineByTrackId: Record<string, Note[]>;
}

/** The string information other families read, as exposed by the compose diagnostics. */
function consumedView(result: ComposeResult): ConsumedView {
  const consumed = (result as ComposeResult & { stringsDiagnostics?: { consumed: ConsumedView } }).stringsDiagnostics?.consumed;
  if (!consumed) throw new Error('compose result carries no stringsDiagnostics.consumed');
  return consumed;
}

function consumedDifference(classic: ComposeResult, v1: ComposeResult): ConsumedDifference {
  const a = consumedView(classic);
  const b = consumedView(v1);
  const lineKey = (notes: readonly Note[] | undefined): string => sortedNoteKeys(notes ?? []).join(';');
  const bars = Math.max(a.carrierByBar.length, b.carrierByBar.length);
  const carrierBars = Array.from({ length: bars }, (_, i) => i + 1).filter((bar) => (a.carrierByBar[bar - 1] ?? null) !== (b.carrierByBar[bar - 1] ?? null));
  const leadIds = [...new Set([...a.leads, ...b.leads].map((l) => l.trackId))].sort();
  const soliIds = [...new Set([...Object.keys(a.soliLineByTrackId), ...Object.keys(b.soliLineByTrackId)])].sort();
  const layerBars: Record<string, number[]> = {};
  const slots = (result: ComposeResult, bar: number): Map<string, string> =>
    new Map((result.plan.bars[bar - 1]?.layers ?? []).map((l) => [l.layer, [...l.trackIds].sort().join(',')]));
  for (let bar = 1; bar <= Math.max(classic.plan.bars.length, v1.plan.bars.length); bar++) {
    const left = slots(classic, bar);
    const right = slots(v1, bar);
    for (const layer of new Set([...left.keys(), ...right.keys()])) {
      if (left.get(layer) !== right.get(layer)) layerBars[layer] = [...(layerBars[layer] ?? []), bar];
    }
  }
  const momentKey = (r: ComposeResult): string => JSON.stringify(r.plan.moments);
  return {
    carrierBars,
    leadLineTracks: leadIds.filter((id) => lineKey(a.leads.find((l) => l.trackId === id)?.notes) !== lineKey(b.leads.find((l) => l.trackId === id)?.notes)),
    counterLineChanged: (a.counter?.trackId ?? null) !== (b.counter?.trackId ?? null) || lineKey(a.counter?.notes) !== lineKey(b.counter?.notes),
    soliLineTracks: soliIds.filter((id) => lineKey(a.soliLineByTrackId[id]) !== lineKey(b.soliLineByTrackId[id])),
    conductorLayerBars: Object.fromEntries(Object.entries(layerBars).sort(([x], [y]) => x.localeCompare(y))),
    momentsChanged: momentKey(classic) !== momentKey(v1),
  };
}

/** Compare two finished compositions of the same project. Diagnostic only: neither result is altered. */
export function compareResults(cell: string, project: Project, classic: ComposeResult, v1: ComposeResult): ModeComparison {
  const barLength = barTicks(project.timeSignature);
  const ids = [...new Set([...classic.tracks, ...v1.tracks].filter(isInstrumentTrack).map((t) => t.id))];
  const strings: TrackDifference[] = [];
  const downstream: Record<string, TrackDifference[]> = {};
  for (const id of ids) {
    const a = classic.tracks.find((t) => t.id === id);
    const b = v1.tracks.find((t) => t.id === id);
    const diff = trackDifference(a, b, barLength);
    if (!diff) continue;
    if (diff.family === 'Strings') strings.push(diff);
    else downstream[diff.family] = [...(downstream[diff.family] ?? []), diff];
  }
  const consumed = consumedDifference(classic, v1);
  const consumedChanged = consumed.carrierBars.length > 0 || consumed.leadLineTracks.length > 0 || consumed.counterLineChanged
    || consumed.soliLineTracks.length > 0 || Object.keys(consumed.conductorLayerBars).length > 0 || consumed.momentsChanged;
  const downstreamTracksChanged = Object.values(downstream).reduce((sum, list) => sum + list.length, 0);
  return {
    cell,
    strings,
    consumed,
    downstream,
    totals: { stringTracksChanged: strings.length, consumedChanged, downstreamTracksChanged, identical: !strings.length && !consumedChanged && !downstreamTracksChanged },
  };
}

export function compareStringModes(cell: StringCell): ModeComparison {
  const classic = composeStringCell(cell, 'classic');
  const v1 = composeStringCell(cell, 'v1');
  return compareResults(stringCellId(cell), classic.project, classic.result, v1.result);
}

/** A plain-text rendering of comparison reports for the development script. */
export function formatComparisons(reports: readonly ModeComparison[]): string {
  const lines: string[] = [];
  for (const r of reports) {
    lines.push(`${r.cell}: ${r.totals.identical ? 'identical' : 'DIFFERENT'}`);
    lines.push(`  1. direct string differences: ${r.strings.length} track(s)`);
    for (const d of r.strings) lines.push(`     ${d.role} (${d.trackId}): notes ${d.noteCount.classic} -> ${d.noteCount.v1}, ${d.changedBars.length} changed bar(s), mean pitch ${d.meanPitchDelta.toFixed(2)}, mean velocity ${d.meanVelocity.delta.toFixed(2)}, controllers [${d.changedControllers.join(', ')}]`);
    lines.push(`  2. consumed by other families: carrier bars ${r.consumed.carrierBars.length}, lead lines ${r.consumed.leadLineTracks.length}, counter line ${r.consumed.counterLineChanged ? 'changed' : 'same'}, soli lines ${r.consumed.soliLineTracks.length}, conductor layers ${Object.entries(r.consumed.conductorLayerBars).map(([layer, bars]) => `${layer}:${bars.length}`).join(' ') || 'same'}, moments ${r.consumed.momentsChanged ? 'changed' : 'same'}`);
    lines.push(`  3. downstream behaviour: ${r.totals.downstreamTracksChanged} track(s)`);
    for (const [family, list] of Object.entries(r.downstream)) {
      for (const d of list) lines.push(`     ${family} ${d.role}: notes ${d.noteCount.classic} -> ${d.noteCount.v1}, ${d.changedBars.length} changed bar(s), mean velocity ${d.meanVelocity.delta.toFixed(2)}, controllers [${d.changedControllers.join(', ')}]`);
    }
  }
  return lines.join('\n');
}
