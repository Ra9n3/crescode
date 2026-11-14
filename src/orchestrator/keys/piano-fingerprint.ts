/**
 * Piano composition fingerprints — measurement only.
 *
 * Nothing in the production Compose All path imports this module. It reads a
 * finished Piano draft (events + the composer's own diagnostics) and reduces
 * it to a compact, deterministic, key-independent description along four
 * musical dimensions: theme, rhythm, accompaniment and development.
 *
 * Two fingerprints can be compared dimension by dimension. Distances are
 * structural facts: they say how much two drafts differ on paper, never how
 * either of them sounds.
 */
import type { PianoScoreEvent } from './piano-score';
import type { PianoCompositionDiagnostics, PianoLayer } from './piano-texture-theme';
import {
  analyzePianoNotes, measureIdentitySurvival, melodyLabelAgreement, type IdentitySurvival, type PianoNoteProfile,
} from './piano-note-analysis';

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

export interface FingerprintEvent {
  readonly t: number;
  readonly d: number;
  readonly p: number;
  readonly v: number;
  readonly layer: PianoLayer;
  readonly technique: string;
}

export interface FingerprintBar {
  readonly bar: number;
  readonly startTick: number;
  readonly endTick: number;
}

export interface FingerprintPhrase {
  readonly role: string;
  readonly themeOperation: string;
  readonly startBar: number;
  readonly endBar: number;
}

export interface FingerprintThemePlan {
  /** Per theme bar: [position, duration, diatonic step] with positions and durations in ticks. */
  readonly bars: readonly (readonly (readonly [number, number, number])[])[];
}

export interface FingerprintInput {
  readonly events: readonly FingerprintEvent[];
  readonly bars: readonly FingerprintBar[];
  /** Ticks per felt beat (960 in simple quarter-note meters). */
  readonly beatTicks: number;
  readonly tonicPitchClass: number;
  /** Absolute pitch classes of the scale. */
  readonly scalePitchClasses: readonly number[];
  readonly theme: FingerprintThemePlan | null;
  readonly phrases: readonly FingerprintPhrase[];
  /** Texture level per bar, parallel to `bars`. */
  readonly levels: readonly number[];
}

/* ------------------------------------------------------------------ */
/* Fingerprint                                                         */
/* ------------------------------------------------------------------ */

export type MotifRelation = 'exact' | 'inverted' | 'rhythmOnly' | 'varied' | 'free';

export interface PianoFingerprint {
  readonly version: 1;
  readonly bars: number;
  readonly events: number;
  readonly tonic: number;
  /** Identity of the literal notes (time, length, pitch, velocity). */
  readonly exactDigest: string;
  /** Identity of the notes with pitch taken relative to the lowest note: equal for an exact transposition. */
  readonly shapeDigest: string;
  readonly theme: {
    /** Diatonic step movement of the planned theme, one array per theme bar. */
    readonly contour: readonly (readonly number[])[];
    /** Planned theme rhythm per bar as "position:duration" tokens in grid units. */
    readonly rhythm: readonly string[];
    /** Realized melody as "diatonic interval/inter-onset" tokens; a phrase break is "|". */
    readonly melody: readonly string[];
    /** Per bar: how the realized melody bar relates to the theme ('' when the bar has no melody). */
    readonly relations: readonly (MotifRelation | '')[];
    readonly relationShare: Readonly<Record<MotifRelation, number>>;
    /** Share of melody bars that restate or transform a theme bar. */
    readonly recurrence: number;
    /** Per phrase: relation counts, e.g. "E3I1". */
    readonly phraseTransformations: readonly string[];
  };
  readonly rhythm: {
    /** Per bar: every attack position (all layers) in grid units, e.g. "0.12.24". */
    readonly onsets: readonly string[];
    /** Per bar: melody attack positions. */
    readonly melodyOnsets: readonly string[];
    /** Share of attacks at each position of the bar (grid units). */
    readonly positions: Readonly<Record<string, number>>;
    readonly subdivision: { readonly beat: number; readonly eighth: number; readonly sixteenth: number; readonly triplet: number; readonly other: number };
    readonly offbeatShare: number;
    /** Share of attacks off the beat with no attack on the following beat. */
    readonly syncopation: number;
    /** Share of beats in which nothing sounds. */
    readonly silentBeatShare: number;
    /** Share of beats without melody, inside bars that have melody. */
    readonly melodyRestShare: number;
    /** Melody notes that begin within half a beat of a bar line and are held across it. */
    readonly anticipations: number;
    /** The most frequent melody bar rhythm. */
    readonly motif: string;
    /** Number of distinct bar rhythms (all layers). */
    readonly distinctCells: number;
  };
  readonly accompaniment: {
    /** Per bar: left-hand figure as "position:rank" tokens (rank of the pitch among the bar's left-hand pitches). */
    readonly left: readonly string[];
    /** Per bar: right-hand accompaniment as "position x chord-size" tokens. */
    readonly right: readonly string[];
    /** Bars in which the melody lies below the accompaniment (left-hand theme). */
    readonly exchangeBars: readonly number[];
    /** Per bar: direction of successive bass notes (u/d/r). */
    readonly bassMotion: readonly string[];
    /** Per bar: number of inner-voice attacks. */
    readonly innerActivity: readonly number[];
    readonly distinctLeft: number;
    readonly distinctRight: number;
  };
  readonly development: {
    readonly roles: readonly string[];
    readonly operations: readonly string[];
    readonly texture: readonly number[];
    /** Mean attack velocity per bar (0 for a silent bar). */
    readonly dynamics: readonly number[];
    /** Per bar: sorted technique names. */
    readonly techniques: readonly string[];
    /** Position (0..1) of the first bar of the climax phrase, or -1. */
    readonly climaxAt: number;
    /** Position (0..1) of the loudest bar. */
    readonly peakAt: number;
    readonly hasRelease: boolean;
    readonly arrival: { readonly level: number; readonly velocity: number };
  };
}

/** Grid unit used inside fingerprints: 40 ticks holds 32nd notes and both triplet levels at 960 PPQ. */
export const FINGERPRINT_GRID_TICKS = 40;

function digest(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul((b + code) ^ (b >>> 13), 0x85ebca6b) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

const round3 = (value: number): number => Math.round(value * 1000) / 1000;
const unit = (ticks: number): string => (ticks % FINGERPRINT_GRID_TICKS === 0 ? String(ticks / FINGERPRINT_GRID_TICKS) : `t${ticks}`);
const mod = (value: number, size: number): number => ((value % size) + size) % size;

/** Diatonic index of a pitch (scale steps above the tonic at MIDI 0); a chromatic pitch takes the scale tone below it. */
export function diatonicIndex(pitch: number, tonic: number, scale: readonly number[]): number {
  const relative = [...new Set(scale.map((tone) => mod(tone - tonic, 12)))].sort((x, y) => x - y);
  if (!relative.length) return pitch;
  const offset = pitch - tonic;
  const octave = Math.floor(offset / 12);
  const within = mod(offset, 12);
  let index = 0;
  for (let i = 0; i < relative.length; i++) if (relative[i] <= within) index = i;
  return octave * relative.length + index;
}

export function fingerprintPiano(input: FingerprintInput): PianoFingerprint {
  const events = [...input.events].sort((x, y) => x.t - y.t || x.p - y.p || x.d - y.d);
  const bars = [...input.bars].sort((x, y) => x.startTick - y.startTick);
  const beat = Math.max(1, input.beatTicks);
  const barIndexOf = (tick: number): number => bars.findIndex((bar) => tick >= bar.startTick && tick < bar.endTick);
  const perBar: FingerprintEvent[][] = bars.map(() => []);
  for (const event of events) {
    const index = barIndexOf(event.t);
    if (index >= 0) perBar[index].push(event);
  }
  const lowest = events.length ? Math.min(...events.map((event) => event.p)) : 0;

  /* ---------------- rhythm ---------------- */
  const cell = (list: readonly FingerprintEvent[], start: number): string =>
    [...new Set(list.map((event) => event.t - start))].sort((x, y) => x - y).map(unit).join('.');
  const onsets = bars.map((bar, index) => cell(perBar[index], bar.startTick));
  const melodyOnsets = bars.map((bar, index) => cell(perBar[index].filter((event) => event.layer === 'melody'), bar.startTick));
  const positions: Record<string, number> = {};
  const subdivision = { beat: 0, eighth: 0, sixteenth: 0, triplet: 0, other: 0 };
  let attackCount = 0;
  let offbeat = 0;
  let syncopated = 0;
  bars.forEach((bar, index) => {
    const ticks = [...new Set(perBar[index].map((event) => event.t - bar.startTick))].sort((x, y) => x - y);
    const next = bars[index + 1];
    const nextDownbeat = next ? perBar[index + 1].some((event) => event.t === next.startTick) : false;
    for (const tick of ticks) {
      attackCount++;
      positions[unit(tick)] = (positions[unit(tick)] ?? 0) + 1;
      const inBeat = tick % beat;
      if (inBeat === 0) subdivision.beat++;
      else if (inBeat * 2 === beat) subdivision.eighth++;
      else if ((inBeat * 4) % beat === 0) subdivision.sixteenth++;
      else if ((inBeat * 3) % beat === 0 || (inBeat * 6) % beat === 0) subdivision.triplet++;
      else subdivision.other++;
      if (inBeat !== 0) {
        offbeat++;
        const following = tick - inBeat + beat;
        const present = bar.startTick + following < bar.endTick ? ticks.includes(following) : nextDownbeat;
        if (!present) syncopated++;
      }
    }
  });
  for (const key of Object.keys(positions)) positions[key] = round3(positions[key] / Math.max(1, attackCount));
  for (const key of Object.keys(subdivision) as (keyof typeof subdivision)[]) subdivision[key] = round3(subdivision[key] / Math.max(1, attackCount));

  let beats = 0;
  let silentBeats = 0;
  let melodyBeats = 0;
  let melodyRestBeats = 0;
  bars.forEach((bar, index) => {
    const hasMelody = perBar[index].some((event) => event.layer === 'melody');
    for (let start = bar.startTick; start < bar.endTick; start += beat) {
      const end = Math.min(bar.endTick, start + beat);
      beats++;
      const sounding = events.filter((event) => event.t < end && event.t + event.d > start);
      if (!sounding.length) silentBeats++;
      if (hasMelody) {
        melodyBeats++;
        if (!sounding.some((event) => event.layer === 'melody')) melodyRestBeats++;
      }
    }
  });
  let anticipations = 0;
  for (const event of events) {
    if (event.layer !== 'melody') continue;
    const index = barIndexOf(event.t);
    if (index < 0) continue;
    const end = bars[index].endTick;
    if (event.t > bars[index].startTick && end - event.t <= beat / 2 && event.t + event.d >= end + beat / 4) anticipations++;
  }
  const counts = new Map<string, number>();
  for (const value of melodyOnsets) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  const motif = [...counts.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]?.[0] ?? '';

  /* ---------------- theme ---------------- */
  const degree = (pitch: number): number => diatonicIndex(pitch, input.tonicPitchClass, input.scalePitchClasses);
  const phraseOfBar = (barNumber: number): number => input.phrases.findIndex((phrase) => barNumber >= phrase.startBar && barNumber <= phrase.endBar);
  /** The melody as one line: the highest melody note at each attack. */
  const line = (list: readonly FingerprintEvent[]): FingerprintEvent[] => {
    const top = new Map<number, FingerprintEvent>();
    for (const event of list) {
      if (event.layer !== 'melody') continue;
      const current = top.get(event.t);
      if (!current || event.p > current.p) top.set(event.t, event);
    }
    return [...top.values()].sort((x, y) => x.t - y.t);
  };
  const melody: string[] = [];
  let previous: FingerprintEvent | null = null;
  let previousPhrase = -1;
  bars.forEach((bar, index) => {
    const phrase = phraseOfBar(bar.bar);
    for (const event of line(perBar[index])) {
      if (previous && phrase !== previousPhrase) melody.push('|');
      if (previous && phrase === previousPhrase) melody.push(`${degree(event.p) - degree(previous.p)}/${unit(event.t - previous.t)}`);
      previous = event;
      previousPhrase = phrase;
    }
  });

  const sign = (value: number): number => (value > 0 ? 1 : value < 0 ? -1 : 0);
  interface Cell { readonly positions: readonly number[]; readonly directions: readonly number[] }
  const realizedCell = (index: number): Cell | null => {
    const notes = line(perBar[index]);
    if (!notes.length) return null;
    return {
      positions: notes.map((event) => event.t - bars[index].startTick),
      directions: notes.slice(1).map((event, i) => sign(degree(event.p) - degree(notes[i].p))),
    };
  };
  const planned: Cell[] = input.theme
    ? input.theme.bars.map((bar) => ({
      positions: bar.map(([position]) => position),
      directions: bar.slice(1).map(([, , step], i) => sign(step - bar[i][2])),
    }))
    : [];
  const references: Cell[] = planned.length ? planned : (() => {
    const seen = new Set<string>();
    const first: Cell[] = [];
    for (let index = 0; index < bars.length && first.length < 4; index++) {
      const value = realizedCell(index);
      if (!value) continue;
      const key = `${value.positions.join('.')}/${value.directions.join('')}`;
      if (!seen.has(key)) { seen.add(key); first.push(value); }
    }
    return first;
  })();
  const same = (x: readonly number[], y: readonly number[]): boolean => x.length === y.length && x.every((value, i) => value === y[i]);
  const subset = (x: readonly number[], y: readonly number[]): boolean => x.every((value) => y.includes(value));
  const relate = (value: Cell): MotifRelation => {
    let best: MotifRelation = 'free';
    const rank: Record<MotifRelation, number> = { exact: 4, inverted: 3, rhythmOnly: 2, varied: 1, free: 0 };
    for (const reference of references) {
      let relation: MotifRelation = 'free';
      if (same(value.positions, reference.positions)) {
        const moving = reference.directions.some((direction) => direction !== 0);
        if (same(value.directions, reference.directions)) relation = 'exact';
        else if (moving && same(value.directions, reference.directions.map((direction) => -direction))) relation = 'inverted';
        else relation = 'rhythmOnly';
      } else if (value.positions.length >= 2 && (subset(value.positions, reference.positions) || subset(reference.positions, value.positions))) {
        relation = 'varied';
      }
      if (rank[relation] > rank[best]) best = relation;
    }
    return best;
  };
  const relations: (MotifRelation | '')[] = bars.map((_, index) => {
    const value = realizedCell(index);
    return value ? relate(value) : '';
  });
  const relationCount: Record<MotifRelation, number> = { exact: 0, inverted: 0, rhythmOnly: 0, varied: 0, free: 0 };
  for (const relation of relations) if (relation) relationCount[relation]++;
  const melodyBars = relations.filter(Boolean).length;
  const relationShare = Object.fromEntries((Object.keys(relationCount) as MotifRelation[])
    .map((key) => [key, round3(relationCount[key] / Math.max(1, melodyBars))])) as Record<MotifRelation, number>;
  const letter: Record<MotifRelation, string> = { exact: 'E', inverted: 'I', rhythmOnly: 'R', varied: 'V', free: 'F' };
  const phraseTransformations = input.phrases.map((phrase) => {
    const tally = new Map<string, number>();
    bars.forEach((bar, index) => {
      const relation = relations[index];
      if (relation && bar.bar >= phrase.startBar && bar.bar <= phrase.endBar) tally.set(letter[relation], (tally.get(letter[relation]) ?? 0) + 1);
    });
    return [...tally.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([key, count]) => `${key}${count}`).join('');
  });

  /* ---------------- accompaniment ---------------- */
  const tokens = (list: readonly FingerprintEvent[], start: number, describe: (group: FingerprintEvent[], position: number) => string): string => {
    const groups = new Map<number, FingerprintEvent[]>();
    for (const event of list) groups.set(event.t - start, [...(groups.get(event.t - start) ?? []), event]);
    return [...groups.entries()].sort((x, y) => x[0] - y[0]).map(([position, group]) => describe(group, position)).join(' ');
  };
  const left = bars.map((bar, index) => {
    const hand = perBar[index].filter((event) => event.layer === 'bass' || event.layer === 'accompaniment');
    const pitches = [...new Set(hand.map((event) => event.p))].sort((x, y) => x - y);
    return tokens(hand, bar.startTick, (group, position) => {
      const low = Math.min(...group.map((event) => event.p));
      return `${unit(position)}:${pitches.indexOf(low)}${group.length > 1 ? `+${group.length}` : ''}`;
    });
  });
  const right = bars.map((bar, index) => tokens(perBar[index].filter((event) => event.layer === 'inner'), bar.startTick,
    (group, position) => `${unit(position)}x${group.length}`));
  const exchangeBars: number[] = [];
  bars.forEach((bar, index) => {
    const melodyNotes = perBar[index].filter((event) => event.layer === 'melody');
    if (!melodyNotes.length) return;
    const inner = perBar[index].filter((event) => event.layer === 'inner');
    const top = Math.max(...melodyNotes.map((event) => event.p));
    const below = inner.length ? top < Math.min(...inner.map((event) => event.p)) : top < 60;
    if (below) exchangeBars.push(bar.bar);
  });
  const bassMotion = bars.map((_, index) => {
    const bass = perBar[index].filter((event) => event.layer === 'bass').sort((x, y) => x.t - y.t || x.p - y.p);
    return bass.slice(1).map((event, i) => (event.p > bass[i].p ? 'u' : event.p < bass[i].p ? 'd' : 'r')).join('');
  });
  const innerActivity = bars.map((_, index) => new Set(perBar[index].filter((event) => event.layer === 'inner').map((event) => event.t)).size);

  /* ---------------- development ---------------- */
  const dynamics = perBar.map((list) => (list.length ? Math.round(list.reduce((sum, event) => sum + event.v, 0) / list.length) : 0));
  const techniques = perBar.map((list) => [...new Set(list.map((event) => event.technique))].sort().join(','));
  const climax = input.phrases.find((phrase) => phrase.role === 'climax');
  const span = Math.max(1, bars.length - 1);
  const climaxIndex = climax ? bars.findIndex((bar) => bar.bar === climax.startBar) : -1;
  const peak = dynamics.length ? dynamics.indexOf(Math.max(...dynamics)) : 0;
  const lastSounding = [...perBar.keys()].reverse().find((index) => perBar[index].length > 0) ?? -1;

  const note = (event: FingerprintEvent, base: number): string => `${event.t},${event.d},${event.p - base}`;
  return {
    version: 1,
    bars: bars.length,
    events: events.length,
    tonic: mod(input.tonicPitchClass, 12),
    exactDigest: digest(events.map((event) => `${note(event, 0)},${event.v}`).join(';')),
    shapeDigest: digest(events.map((event) => note(event, lowest)).join(';')),
    theme: {
      contour: input.theme ? input.theme.bars.map((bar) => bar.slice(1).map(([, , step], i) => step - bar[i][2])) : [],
      rhythm: input.theme ? input.theme.bars.map((bar) => bar.map(([position, duration]) => `${unit(position)}:${unit(duration)}`).join(' ')) : [],
      melody,
      relations,
      relationShare,
      recurrence: round3((melodyBars - relationCount.free) / Math.max(1, melodyBars)),
      phraseTransformations,
    },
    rhythm: {
      onsets,
      melodyOnsets,
      positions,
      subdivision,
      offbeatShare: round3(offbeat / Math.max(1, attackCount)),
      syncopation: round3(syncopated / Math.max(1, attackCount)),
      silentBeatShare: round3(silentBeats / Math.max(1, beats)),
      melodyRestShare: round3(melodyRestBeats / Math.max(1, melodyBeats)),
      anticipations,
      motif,
      distinctCells: new Set(onsets.filter(Boolean)).size,
    },
    accompaniment: {
      left,
      right,
      exchangeBars,
      bassMotion,
      innerActivity,
      distinctLeft: new Set(left.filter(Boolean)).size,
      distinctRight: new Set(right.filter(Boolean)).size,
    },
    development: {
      roles: input.phrases.map((phrase) => phrase.role),
      operations: input.phrases.map((phrase) => phrase.themeOperation),
      texture: [...input.levels],
      dynamics,
      techniques,
      climaxAt: climaxIndex >= 0 ? round3(climaxIndex / span) : -1,
      peakAt: round3(peak / span),
      hasRelease: input.phrases.some((phrase) => phrase.role === 'release'),
      arrival: {
        level: input.levels[lastSounding] ?? 0,
        velocity: lastSounding >= 0 ? dynamics[lastSounding] : 0,
      },
    },
  };
}

/** A short identity of a whole fingerprint, for baseline protection. */
export function fingerprintDigest(fingerprint: PianoFingerprint): string {
  return digest(JSON.stringify(fingerprint));
}

/* ------------------------------------------------------------------ */
/* Comparison                                                          */
/* ------------------------------------------------------------------ */

export type FingerprintDimension = 'theme' | 'rhythm' | 'accompaniment' | 'development';

export interface FingerprintComparison {
  readonly exact: boolean;
  /** The notes are identical apart from one constant pitch offset. */
  readonly exactTransposition: boolean;
  readonly sameTonic: boolean;
  readonly dimensions: Readonly<Record<FingerprintDimension, number>>;
  /** Component distances, each 0 (identical) to 1 (nothing in common). */
  readonly components: Readonly<Record<string, number>>;
  readonly overall: number;
}

function sequenceDistance<T>(a: readonly T[], b: readonly T[]): number {
  if (!a.length && !b.length) return 0;
  let row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next.push(Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
    }
    row = next;
  }
  return row[b.length] / Math.max(a.length, b.length);
}

function setDistance(a: readonly string[], b: readonly string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  if (!left.size && !right.size) return 0;
  let shared = 0;
  for (const value of left) if (right.has(value)) shared++;
  return 1 - shared / (left.size + right.size - shared);
}

/** Bar-by-bar token overlap; a bar present in only one draft counts as fully different. */
function alignedTokenDistance(a: readonly string[], b: readonly string[], separator: string): number {
  const length = Math.max(a.length, b.length);
  let total = 0;
  let counted = 0;
  for (let index = 0; index < length; index++) {
    const left = (a[index] ?? '').split(separator).filter(Boolean);
    const right = (b[index] ?? '').split(separator).filter(Boolean);
    if (!left.length && !right.length) continue;
    total += setDistance(left, right);
    counted++;
  }
  return counted ? total / counted : 0;
}

function alignedNumberDistance(a: readonly number[], b: readonly number[], scale: number): number {
  const length = Math.max(a.length, b.length);
  if (!length) return 0;
  let total = 0;
  for (let index = 0; index < length; index++) {
    total += index < a.length && index < b.length ? Math.min(1, Math.abs(a[index] - b[index]) / scale) : 1;
  }
  return total / length;
}

function histogramDistance(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): number {
  let total = 0;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) total += Math.abs((a[key] ?? 0) - (b[key] ?? 0));
  return Math.min(1, total / 2);
}

/** Weights of the components inside each dimension. They sum to 1 per dimension. */
/**
 * Half the L1 distance between the relative frequencies of two token lists.
 * Used for the realized melody: the set of three-note cells shared by two
 * drafts is almost always empty in the baseline (distance 0.99 for every
 * kind of pair), so it cannot separate anything; the frequency profile of
 * "interval and time to the next note" moves does (0.05 for one draft at two
 * densities, 0.55 for two seeds).
 */
function profileDistance(a: readonly string[], b: readonly string[]): number {
  if (!a.length && !b.length) return 0;
  const count = (tokens: readonly string[]): Map<string, number> => {
    const out = new Map<string, number>();
    for (const token of tokens) out.set(token, (out.get(token) ?? 0) + 1 / Math.max(1, tokens.length));
    return out;
  };
  const left = count(a);
  const right = count(b);
  let sum = 0;
  for (const key of new Set([...left.keys(), ...right.keys()])) sum += Math.abs((left.get(key) ?? 0) - (right.get(key) ?? 0));
  return sum / 2;
}

export const FINGERPRINT_WEIGHTS = Object.freeze({
  theme: { contour: 0.3, themeRhythm: 0.3, melody: 0.3, recurrence: 0.1 },
  rhythm: { onsets: 0.4, melodyOnsets: 0.3, positions: 0.2, profile: 0.1 },
  accompaniment: { left: 0.45, right: 0.25, exchange: 0.1, bassMotion: 0.1, inner: 0.1 },
  development: { roles: 0.25, operations: 0.2, texture: 0.2, dynamics: 0.2, techniques: 0.15 },
});

export function compareFingerprints(a: PianoFingerprint, b: PianoFingerprint): FingerprintComparison {
  const components: Record<string, number> = {
    contour: sequenceDistance(a.theme.contour.flatMap((bar) => [...bar, 99]), b.theme.contour.flatMap((bar) => [...bar, 99])),
    themeRhythm: sequenceDistance(a.theme.rhythm.flatMap((bar) => [...bar.split(' '), '|']), b.theme.rhythm.flatMap((bar) => [...bar.split(' '), '|'])),
    melody: profileDistance(a.theme.melody.filter((token) => token !== '|'), b.theme.melody.filter((token) => token !== '|')),
    recurrence: histogramDistance(a.theme.relationShare, b.theme.relationShare),
    onsets: alignedTokenDistance(a.rhythm.onsets, b.rhythm.onsets, '.'),
    melodyOnsets: alignedTokenDistance(a.rhythm.melodyOnsets, b.rhythm.melodyOnsets, '.'),
    positions: histogramDistance(a.rhythm.positions, b.rhythm.positions),
    profile: (Math.abs(a.rhythm.offbeatShare - b.rhythm.offbeatShare) + Math.abs(a.rhythm.syncopation - b.rhythm.syncopation)
      + Math.abs(a.rhythm.silentBeatShare - b.rhythm.silentBeatShare) + Math.abs(a.rhythm.melodyRestShare - b.rhythm.melodyRestShare)) / 4,
    left: alignedTokenDistance(a.accompaniment.left, b.accompaniment.left, ' '),
    right: alignedTokenDistance(a.accompaniment.right, b.accompaniment.right, ' '),
    exchange: setDistance(a.accompaniment.exchangeBars.map(String), b.accompaniment.exchangeBars.map(String)),
    bassMotion: alignedTokenDistance(a.accompaniment.bassMotion.map((value) => (value ? `m${value}` : '')), b.accompaniment.bassMotion.map((value) => (value ? `m${value}` : '')), ' '),
    inner: alignedNumberDistance(a.accompaniment.innerActivity, b.accompaniment.innerActivity, 4),
    roles: sequenceDistance(a.development.roles, b.development.roles),
    operations: sequenceDistance(a.development.operations, b.development.operations),
    texture: alignedNumberDistance(a.development.texture, b.development.texture, 3),
    dynamics: alignedNumberDistance(a.development.dynamics, b.development.dynamics, 40),
    techniques: alignedTokenDistance(a.development.techniques, b.development.techniques, ','),
  };
  const dimensions = {} as Record<FingerprintDimension, number>;
  for (const dimension of Object.keys(FINGERPRINT_WEIGHTS) as FingerprintDimension[]) {
    const weights = FINGERPRINT_WEIGHTS[dimension] as Record<string, number>;
    dimensions[dimension] = round3(Object.entries(weights).reduce((sum, [key, weight]) => sum + weight * components[key], 0));
  }
  for (const key of Object.keys(components)) components[key] = round3(components[key]);
  const exact = a.exactDigest === b.exactDigest;
  return {
    exact,
    exactTransposition: !exact && a.shapeDigest === b.shapeDigest,
    sameTonic: a.tonic === b.tonic,
    dimensions,
    components,
    overall: round3((dimensions.theme + dimensions.rhythm + dimensions.accompaniment + dimensions.development) / 4),
  };
}

/* ------------------------------------------------------------------ */
/* Classification                                                      */
/* ------------------------------------------------------------------ */

export type SimilarityClass = 'same' | 'transposed' | 'variation' | 'different';

export interface SimilarityThresholds {
  /** At or below this overall distance two drafts are the same composition. */
  readonly sameOverall: number;
  /** A dimension at or above its value counts as meaningfully different. */
  readonly different: Readonly<Record<FingerprintDimension, number>>;
  /** Number of dimensions that must be meaningfully different. */
  readonly dimensionsRequired: number;
}

/**
 * Calibrated on the Stage 1 baseline matrix
 * (evaluation/piano-variation-stage1-20261112/baseline/summary.md, 600
 * generations, 1680 pairs). Three anchors were used:
 *
 * - "must be the same": identical inputs composed twice (distance 0) and the
 *   same notes moved to another key (overall at most 0.03).
 * - "a variation by construction": one generation at two densities.
 * - "different by design": two templates on the same song and seed.
 *
 * sameOverall 0.05  between the transposition control (max 0.03) and the
 *                   smallest density pair (0.07).
 * theme 0.30        density pairs reach 0.24 at most; template pairs start at
 *                   0.30. The only dimension the baseline separates cleanly.
 * rhythm 0.35       just above the 95th percentile of density pairs (0.33).
 *                   Template pairs have a median of 0.31, so the baseline
 *                   contains no population that is rhythmically "different";
 *                   this number is an upper edge of sameness, not a midpoint.
 * accompaniment 0.55 between the density median (0.39) and the template
 *                   median (0.58); the two populations overlap.
 * development 0.20  just above the 95th percentile of density pairs (0.19).
 * dimensionsRequired 3, one of them theme or rhythm: a new tune over the same
 *                   rhythm, figures and form is a variation, not a new piece.
 *
 * Structural measurements only. Whether two generations sound different is
 * for a listener to decide; revise these numbers when the baseline changes.
 */
export const STAGE1_THRESHOLDS: SimilarityThresholds = Object.freeze({
  sameOverall: 0.05,
  different: Object.freeze({ theme: 0.3, rhythm: 0.35, accompaniment: 0.55, development: 0.2 }),
  dimensionsRequired: 3,
});

export interface SimilarityVerdict {
  readonly classification: SimilarityClass;
  readonly differentDimensions: readonly FingerprintDimension[];
}

/**
 * - same: identical notes, or no dimension differs beyond noise, in the same key.
 * - transposed: the same, at another pitch level.
 * - different: at least `dimensionsRequired` dimensions differ meaningfully, one of them theme or rhythm.
 * - variation: everything in between.
 */
export function classifySimilarity(comparison: FingerprintComparison, thresholds: SimilarityThresholds = STAGE1_THRESHOLDS): SimilarityVerdict {
  const differentDimensions = (Object.keys(comparison.dimensions) as FingerprintDimension[])
    .filter((dimension) => comparison.dimensions[dimension] >= thresholds.different[dimension]);
  let classification: SimilarityClass;
  if (comparison.exact) classification = 'same';
  else if (comparison.exactTransposition) classification = 'transposed';
  else if (comparison.overall <= thresholds.sameOverall) classification = comparison.sameTonic ? 'same' : 'transposed';
  else if (differentDimensions.length >= thresholds.dimensionsRequired
    && (differentDimensions.includes('theme') || differentDimensions.includes('rhythm'))) classification = 'different';
  else classification = 'variation';
  return { classification, differentDimensions };
}

/* ------------------------------------------------------------------ */
/* Adaptation retention                                                */
/* ------------------------------------------------------------------ */

export interface AdaptationRetention {
  /** Share of independent events still present at the same time and pitch. */
  readonly events: number;
  /** Share of independent theme notes still present at the same time, in any octave. */
  readonly themeNotes: number;
  /** Share of independent melody attack times that still carry a melody attack. */
  readonly rhythmicMotif: number;
  /** Share of bars whose left-hand figure is unchanged. */
  readonly leftPattern: number;
  /** Share of bars whose right-hand accompaniment is unchanged. */
  readonly rightPattern: number;
  /** Share of bars whose texture level changed. */
  readonly textureChanged: number;
  /** Bars whose hand roles changed (theme moved to or from the left hand). */
  readonly handRoleChanges: number;
  /** Events present only after adaptation, relative to the independent draft. */
  readonly added: number;
}

export function measureAdaptationRetention(
  independent: readonly FingerprintEvent[],
  adapted: readonly FingerprintEvent[],
  before: PianoFingerprint,
  after: PianoFingerprint,
): AdaptationRetention {
  const share = (kept: number, total: number): number => round3(total ? kept / total : 1);
  const adaptedKeys = new Set(adapted.map((event) => `${event.t}|${event.p}`));
  const independentKeys = new Set(independent.map((event) => `${event.t}|${event.p}`));
  const independentMelody = independent.filter((event) => event.layer === 'melody');
  const adaptedMelody = adapted.filter((event) => event.layer === 'melody');
  const melodyClass = new Set(adaptedMelody.map((event) => `${event.t}|${mod(event.p, 12)}`));
  const melodyTimes = new Set(adaptedMelody.map((event) => event.t));
  const independentTimes = [...new Set(independentMelody.map((event) => event.t))];
  const unchanged = (a: readonly string[], b: readonly string[]): number => {
    const filled = a.map((value, index) => ({ value, index })).filter((entry) => entry.value);
    return share(filled.filter((entry) => b[entry.index] === entry.value).length, filled.length);
  };
  const exchangeBefore = new Set(before.accompaniment.exchangeBars);
  const exchangeAfter = new Set(after.accompaniment.exchangeBars);
  return {
    events: share(independent.filter((event) => adaptedKeys.has(`${event.t}|${event.p}`)).length, independent.length),
    themeNotes: share(independentMelody.filter((event) => melodyClass.has(`${event.t}|${mod(event.p, 12)}`)).length, independentMelody.length),
    rhythmicMotif: share(independentTimes.filter((tick) => melodyTimes.has(tick)).length, independentTimes.length),
    leftPattern: unchanged(before.accompaniment.left, after.accompaniment.left),
    rightPattern: unchanged(before.accompaniment.right, after.accompaniment.right),
    textureChanged: round3(before.development.texture.filter((level, index) => level !== after.development.texture[index]).length
      / Math.max(1, before.development.texture.length)),
    handRoleChanges: [...new Set([...exchangeBefore, ...exchangeAfter])].filter((bar) => exchangeBefore.has(bar) !== exchangeAfter.has(bar)).length,
    added: round3(independent.length ? adapted.filter((event) => !independentKeys.has(`${event.t}|${event.p}`)).length / independent.length : 0),
  };
}

/* ------------------------------------------------------------------ */
/* Adapters for the Texture-and-Theme Composer                         */
/* ------------------------------------------------------------------ */

const LAYER_OF_ROLE: Readonly<Record<string, PianoLayer>> = {
  melody: 'melody', suspension: 'melody', octave: 'melody', cadence: 'melody', bass: 'bass', support: 'accompaniment', inner: 'inner',
};

/** Final (adapted) score events in the fingerprint's event shape. */
export function fingerprintEventsFromScore(events: readonly PianoScoreEvent[]): FingerprintEvent[] {
  return events.map((event) => ({
    t: event.startTick,
    d: event.durationTicks,
    p: event.pitch,
    v: event.dynamicIntent.velocity,
    layer: LAYER_OF_ROLE[event.musicalRole] ?? 'inner',
    technique: event.techniqueIntent,
  }));
}

/** The composer's independent draft, as recorded in its diagnostics. */
export function fingerprintEventsFromIndependentDraft(diagnostics: PianoCompositionDiagnostics): FingerprintEvent[] {
  return diagnostics.independentDraft.notes.map((note) => ({ t: note.t, d: note.d, p: note.p, v: note.v, layer: note.l, technique: note.k }));
}

export interface TextureThemeFingerprintContext {
  readonly diagnostics: PianoCompositionDiagnostics;
  readonly scoreEvents: readonly PianoScoreEvent[];
  readonly barWindows: readonly FingerprintBar[];
  readonly beatTicks: number;
  readonly tonicPitchClass: number;
}

export interface TextureThemeFingerprints {
  readonly independent: PianoFingerprint;
  readonly adapted: PianoFingerprint;
  readonly retention: AdaptationRetention;
}

/** The two fingerprint inputs (independent draft, final adapted score) of one Compose All run. */
export function textureThemeFingerprintInputs(context: TextureThemeFingerprintContext): { independent: FingerprintInput; adapted: FingerprintInput } {
  const { diagnostics } = context;
  const bars = [...context.barWindows].sort((a, b) => a.startTick - b.startTick);
  const eighth = context.beatTicks / 2;
  const theme: FingerprintThemePlan | null = diagnostics.theme
    ? { bars: diagnostics.theme.bars.map((bar) => bar.map((note) => [note.pos * eighth, note.dur * eighth, note.step] as const)) }
    : null;
  const byBar = new Map(diagnostics.bars.map((bar) => [bar.bar, bar]));
  const shared = {
    bars,
    beatTicks: context.beatTicks,
    tonicPitchClass: context.tonicPitchClass,
    scalePitchClasses: diagnostics.theme?.scalePitchClasses ?? [],
    theme,
    phrases: diagnostics.phrases.map((phrase) => ({
      role: phrase.role, themeOperation: phrase.themeOperation, startBar: phrase.startBar, endBar: phrase.endBar,
    })),
  };
  return {
    independent: { ...shared, events: fingerprintEventsFromIndependentDraft(diagnostics), levels: bars.map((bar) => byBar.get(bar.bar)?.independentLevel ?? 0) },
    adapted: { ...shared, events: fingerprintEventsFromScore(context.scoreEvents), levels: bars.map((bar) => byBar.get(bar.bar)?.adaptedLevel ?? 0) },
  };
}

/** The same draft moved by a number of semitones: a control for transposition invariance. */
export function transposeFingerprintInput(input: FingerprintInput, semitones: number): FingerprintInput {
  return {
    ...input,
    events: input.events.map((event) => ({ ...event, p: event.p + semitones })),
    tonicPitchClass: mod(input.tonicPitchClass + semitones, 12),
    scalePitchClasses: input.scalePitchClasses.map((tone) => mod(tone + semitones, 12)),
  };
}

/** Fingerprints of both drafts of one Compose All run, plus what adaptation kept. */
export function fingerprintTextureTheme(context: TextureThemeFingerprintContext): TextureThemeFingerprints {
  const inputs = textureThemeFingerprintInputs(context);
  const independent = fingerprintPiano(inputs.independent);
  const adapted = fingerprintPiano(inputs.adapted);
  return { independent, adapted, retention: measureAdaptationRetention(inputs.independent.events, inputs.adapted.events, independent, adapted) };
}

/* ------------------------------------------------------------------ */
/* Stage 2 additions: identity survival and note-derived profiles      */
/* ------------------------------------------------------------------ */

/**
 * How much of the piece's identity (theme, theme head, rhythmic cell, bass
 * motion) survives orchestral adaptation. Works for both composers: without a
 * composition identity the cell is the theme head's own rhythm.
 */
export function measureTextureThemeIdentitySurvival(context: TextureThemeFingerprintContext): IdentitySurvival {
  const { diagnostics } = context;
  const identity = diagnostics.identity;
  const head = diagnostics.theme?.bars[0] ?? [];
  const carrier = identity?.rhythm.carrier ?? 'theme';
  return measureIdentitySurvival({
    independent: fingerprintEventsFromIndependentDraft(diagnostics),
    adapted: fingerprintEventsFromScore(context.scoreEvents),
    bars: context.barWindows,
    themeBarByBar: new Map(diagnostics.bars.map((bar) => [bar.bar, bar.themeBar])),
    cell: identity ? identity.rhythm.cell : head.map((note) => note.pos),
    eighthTicks: context.beatTicks / 2,
    carrier,
  });
}

/** Note-only profiles (no composer labels) of the independent draft and the final score. */
export function noteProfilesOfTextureTheme(context: TextureThemeFingerprintContext): { independent: PianoNoteProfile; adapted: PianoNoteProfile; melodyLabelAgreement: number } {
  const shared = {
    bars: context.barWindows,
    beatTicks: context.beatTicks,
    tonicPitchClass: context.tonicPitchClass,
    scalePitchClasses: context.diagnostics.theme?.scalePitchClasses ?? [],
  };
  const toNotes = (events: readonly FingerprintEvent[]) => events.map((event) => ({ pitch: event.p, startTick: event.t, durationTicks: event.d, velocity: event.v }));
  const adaptedEvents = fingerprintEventsFromScore(context.scoreEvents);
  const adaptedNotes = toNotes(adaptedEvents);
  return {
    independent: analyzePianoNotes({ ...shared, notes: toNotes(fingerprintEventsFromIndependentDraft(context.diagnostics)) }),
    adapted: analyzePianoNotes({ ...shared, notes: adaptedNotes }),
    melodyLabelAgreement: melodyLabelAgreement(adaptedNotes,
      adaptedEvents.filter((event) => event.layer === 'melody').map((event) => ({ startTick: event.t, pitch: event.p }))),
  };
}
