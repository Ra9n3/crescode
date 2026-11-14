/**
 * Note-derived Piano measurements (Performance Styles, Stage 2).
 *
 * The Stage 1 fingerprints read the composer's own labels (which note is
 * melody, which hand plays it, which phrase role a bar has). This module
 * measures the same things from the written notes alone - pitch, start,
 * length and velocity, exactly what ends up in the MIDI file - so the
 * diagnostics can be checked against what was actually written.
 *
 * It also measures how much of a composition identity survives orchestral
 * adaptation. Measurement only: nothing here feeds back into composition.
 */
import type { FingerprintBar, FingerprintEvent } from './piano-fingerprint';

export interface AnalysisNote {
  readonly pitch: number;
  readonly startTick: number;
  readonly durationTicks: number;
  readonly velocity: number;
}

export interface NoteAnalysisInput {
  readonly notes: readonly AnalysisNote[];
  readonly bars: readonly FingerprintBar[];
  readonly beatTicks: number;
  readonly tonicPitchClass: number;
  readonly scalePitchClasses: readonly number[];
}

/** Everything below is derived from notes only. Pitch is expressed relative to the tonic, so it is key-independent. */
export interface PianoNoteProfile {
  readonly bars: number;
  readonly notes: number;
  /** Top line as "scale steps moved / grid units since the previous note"; a bar line is "|". */
  readonly topLine: readonly string[];
  /** Per bar: attack positions of the top line. */
  readonly topRhythm: readonly string[];
  /** Per bar: every attack position. */
  readonly onsets: readonly string[];
  /** Per bar: attack positions below middle C. */
  readonly lowOnsets: readonly string[];
  /** Per bar: scale degree (0..6) of the lowest note on the first attack; -1 when the bar is empty. */
  readonly bass: readonly number[];
  /** Per bar: mean pitch relative to the tonic octave, mean velocity, attack count. */
  readonly register: readonly number[];
  readonly loudness: readonly number[];
  readonly density: readonly number[];
  readonly subdivision: { readonly beat: number; readonly eighth: number; readonly sixteenth: number; readonly other: number };
  readonly offbeatShare: number;
  /** Share of attacks off the beat that are held across the next beat. */
  readonly syncopation: number;
  readonly distinctBarRhythms: number;
  readonly distinctLowRhythms: number;
}

const GRID = 40;
const mod = (value: number, size: number): number => ((value % size) + size) % size;
const round3 = (value: number): number => Math.round(value * 1000) / 1000;

function diatonic(pitch: number, tonic: number, scale: readonly number[]): number {
  const relative = pitch - tonic;
  const octave = Math.floor(relative / 12);
  const tone = mod(relative, 12);
  const offsets = scale.length ? scale.map((value) => mod(value - tonic, 12)).sort((a, b) => a - b) : [0, 2, 4, 5, 7, 9, 11];
  let index = 0;
  let best = Infinity;
  offsets.forEach((offset, i) => { if (Math.abs(offset - tone) < best) { best = Math.abs(offset - tone); index = i; } });
  return octave * offsets.length + index;
}

/**
 * The top line: at each attack the highest starting note, kept only when no
 * higher note is still sounding from before. This is what a listener follows
 * as the melody, whatever the composer called it.
 */
export function topLineOf(notes: readonly AnalysisNote[]): AnalysisNote[] {
  const byStart = new Map<number, AnalysisNote>();
  for (const note of notes) {
    const current = byStart.get(note.startTick);
    if (!current || note.pitch > current.pitch) byStart.set(note.startTick, note);
  }
  const ordered = [...notes].sort((a, b) => a.startTick - b.startTick);
  return [...byStart.values()].sort((a, b) => a.startTick - b.startTick).filter((candidate) =>
    !ordered.some((other) => other.startTick < candidate.startTick && other.startTick + other.durationTicks > candidate.startTick + GRID
      && other.pitch > candidate.pitch));
}

export function analyzePianoNotes(input: NoteAnalysisInput): PianoNoteProfile {
  const bars = [...input.bars].sort((a, b) => a.startTick - b.startTick);
  const notes = [...input.notes].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
  const inBar = (list: readonly AnalysisNote[], bar: FingerprintBar) => list.filter((note) => note.startTick >= bar.startTick && note.startTick < bar.endTick);
  const cell = (list: readonly AnalysisNote[], bar: FingerprintBar): string =>
    [...new Set(list.map((note) => Math.round((note.startTick - bar.startTick) / GRID)))].sort((a, b) => a - b).join('.');
  const top = topLineOf(notes);
  const degree = (pitch: number) => diatonic(pitch, input.tonicPitchClass, input.scalePitchClasses);

  const topLine: string[] = [];
  let previous: AnalysisNote | null = null;
  for (const bar of bars) {
    const line = inBar(top, bar);
    if (topLine.length && topLine[topLine.length - 1] !== '|') topLine.push('|');
    for (const note of line) {
      if (previous) topLine.push(`${degree(note.pitch) - degree(previous.pitch)}/${Math.round((note.startTick - previous.startTick) / GRID)}`);
      previous = note;
    }
  }

  let beat = 0; let eighth = 0; let sixteenth = 0; let other = 0; let offbeat = 0; let syncopated = 0;
  const attackTicks = new Map<number, number>();
  for (const note of notes) attackTicks.set(note.startTick, Math.max(attackTicks.get(note.startTick) ?? 0, note.durationTicks));
  for (const bar of bars) {
    for (const [tick, longest] of attackTicks) {
      if (tick < bar.startTick || tick >= bar.endTick) continue;
      const position = tick - bar.startTick;
      const inBeat = position % input.beatTicks;
      if (inBeat === 0) beat++;
      else if (inBeat * 2 === input.beatTicks) eighth++;
      else if (inBeat * 4 % input.beatTicks === 0) sixteenth++;
      else other++;
      if (inBeat !== 0) {
        offbeat++;
        const nextBeat = tick - inBeat + input.beatTicks;
        if (tick + longest > nextBeat + GRID && !attackTicks.has(nextBeat)) syncopated++;
      }
    }
  }
  const attacks = Math.max(1, beat + eighth + sixteenth + other);
  const onsets = bars.map((bar) => cell(inBar(notes, bar), bar));
  const lowOnsets = bars.map((bar) => cell(inBar(notes, bar).filter((note) => note.pitch < 60), bar));
  const mean = (values: readonly number[]): number => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
  return {
    bars: bars.length,
    notes: notes.length,
    topLine,
    topRhythm: bars.map((bar) => cell(inBar(top, bar), bar)),
    onsets,
    lowOnsets,
    bass: bars.map((bar) => {
      const list = inBar(notes, bar);
      if (!list.length) return -1;
      const first = list[0].startTick;
      return mod(degree(Math.min(...list.filter((note) => note.startTick === first).map((note) => note.pitch))), 7);
    }),
    register: bars.map((bar) => {
      const list = inBar(notes, bar);
      return list.length ? round3(mean(list.map((note) => note.pitch - input.tonicPitchClass))) : 0;
    }),
    loudness: bars.map((bar) => round3(mean(inBar(notes, bar).map((note) => note.velocity)))),
    density: bars.map((bar) => new Set(inBar(notes, bar).map((note) => note.startTick)).size),
    subdivision: { beat: round3(beat / attacks), eighth: round3(eighth / attacks), sixteenth: round3(sixteenth / attacks), other: round3(other / attacks) },
    offbeatShare: round3(offbeat / attacks),
    syncopation: round3(syncopated / attacks),
    distinctBarRhythms: new Set(onsets.filter(Boolean)).size,
    distinctLowRhythms: new Set(lowOnsets.filter(Boolean)).size,
  };
}

/* ------------------------------------------------------------------ */
/* Comparison                                                          */
/* ------------------------------------------------------------------ */

export interface NoteProfileComparison {
  /** How differently the two top lines move (interval and timing habits). */
  readonly melody: number;
  /** How different the attack patterns are, bar against bar. */
  readonly rhythm: number;
  /** The same for everything below middle C: the left-hand figure. */
  readonly lowRhythm: number;
  /** How differently the bass moves from bar to bar. */
  readonly bass: number;
  /** Register, loudness and density curves, with each piece's own average removed. */
  readonly shape: number;
  readonly overall: number;
}

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

function cellDistance(a: readonly string[], b: readonly string[]): number {
  const length = Math.max(a.length, b.length);
  if (!length) return 0;
  let sum = 0;
  for (let index = 0; index < length; index++) {
    const left = new Set((a[index] ?? '').split('.').filter(Boolean));
    const right = new Set((b[index] ?? '').split('.').filter(Boolean));
    const union = new Set([...left, ...right]);
    if (!union.size) continue;
    let common = 0;
    for (const value of left) if (right.has(value)) common++;
    sum += 1 - common / union.size;
  }
  return sum / length;
}

function curveDistance(a: readonly number[], b: readonly number[], scale: number): number {
  const length = Math.min(a.length, b.length);
  if (!length) return 0;
  const mean = (values: readonly number[]) => values.slice(0, length).reduce((sum, value) => sum + value, 0) / length;
  const meanA = mean(a);
  const meanB = mean(b);
  let sum = 0;
  for (let index = 0; index < length; index++) sum += Math.min(1, Math.abs((a[index] - meanA) - (b[index] - meanB)) / scale);
  return sum / length;
}

export function compareNoteProfiles(a: PianoNoteProfile, b: PianoNoteProfile): NoteProfileComparison {
  const moves = (profile: PianoNoteProfile) => profile.topLine.filter((token) => token !== '|');
  const motion = (profile: PianoNoteProfile) => profile.bass.slice(1).map((value, index) =>
    (value < 0 || profile.bass[index] < 0 ? 'x' : String(mod(value - profile.bass[index], 7))));
  const melody = profileDistance(moves(a), moves(b));
  const rhythm = cellDistance(a.onsets, b.onsets);
  const lowRhythm = cellDistance(a.lowOnsets, b.lowOnsets);
  const bass = profileDistance(motion(a), motion(b));
  const shape = (curveDistance(a.register, b.register, 12) + curveDistance(a.loudness, b.loudness, 30) + curveDistance(a.density, b.density, 8)) / 3;
  return {
    melody: round3(melody), rhythm: round3(rhythm), lowRhythm: round3(lowRhythm), bass: round3(bass), shape: round3(shape),
    overall: round3((melody + rhythm + lowRhythm + bass + shape) / 5),
  };
}

/** Share of the notes the composer labelled as melody that a listener would also hear as the top line. */
export function melodyLabelAgreement(notes: readonly AnalysisNote[], labelledMelody: readonly { startTick: number; pitch: number }[]): number {
  if (!labelledMelody.length) return 1;
  const top = new Set(topLineOf(notes).map((note) => `${note.startTick}:${note.pitch}`));
  return round3(labelledMelody.filter((note) => top.has(`${note.startTick}:${note.pitch}`)).length / labelledMelody.length);
}

/* ------------------------------------------------------------------ */
/* Identity survival under adaptation                                  */
/* ------------------------------------------------------------------ */

export interface IdentitySurvivalInput {
  readonly independent: readonly FingerprintEvent[];
  readonly adapted: readonly FingerprintEvent[];
  readonly bars: readonly FingerprintBar[];
  /** Per bar: which theme bar the plan places there (null: none). */
  readonly themeBarByBar: ReadonlyMap<number, number | null>;
  /** Eighth-note slots of the piece's rhythmic cell (the theme head's attacks). */
  readonly cell: readonly number[];
  readonly eighthTicks: number;
  /** Which part repeats the cell besides the theme. */
  readonly carrier: 'theme' | 'left-hand' | 'right-hand';
}

export interface IdentitySurvival {
  /** Theme bars that keep every attack position and the direction of every step (any octave, any key level). */
  readonly themeExact: number;
  /** Theme bars that survive in changed form: the rhythm with other steps, or a fragment of at least two of its notes. */
  readonly themeTransformed: number;
  /** Theme bars with no recognisable trace left. */
  readonly themeLost: number;
  /** The same three figures for the head of the theme only. */
  readonly headExact: number;
  readonly headTransformed: number;
  readonly headLost: number;
  /** Bars that sounded the full rhythmic cell in the independent draft and still do. */
  readonly rhythmExact: number;
  /** Bars that keep at least half of the cell's attacks. */
  readonly rhythmPartial: number;
  /** Bars whose first bass note has the same pitch class as before. */
  readonly bassMotion: number;
  /** Share of independent events still present at the same time and pitch. */
  readonly events: number;
  readonly themeBars: number;
  readonly headBars: number;
  readonly cellBars: number;
}

export function measureIdentitySurvival(input: IdentitySurvivalInput): IdentitySurvival {
  const bars = [...input.bars].sort((a, b) => a.startTick - b.startTick);
  const within = (list: readonly FingerprintEvent[], bar: FingerprintBar) => list.filter((event) => event.t >= bar.startTick && event.t < bar.endTick);
  const line = (list: readonly FingerprintEvent[], bar: FingerprintBar): FingerprintEvent[] => {
    const byTick = new Map<number, FingerprintEvent>();
    for (const event of within(list, bar)) {
      if (event.layer !== 'melody') continue;
      const current = byTick.get(event.t);
      if (!current || event.p > current.p) byTick.set(event.t, event);
    }
    return [...byTick.values()].sort((a, b) => a.t - b.t);
  };
  const sign = (value: number) => (value > 0 ? 1 : value < 0 ? -1 : 0);
  const shape = (notes: readonly FingerprintEvent[], bar: FingerprintBar) => ({
    positions: notes.map((note) => note.t - bar.startTick),
    directions: notes.slice(1).map((note, index) => sign(note.p - notes[index].p)),
  });
  const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((value, index) => value === b[index]);

  let themeBars = 0; let themeExact = 0; let themeTransformed = 0;
  let headBars = 0; let headExact = 0; let headTransformed = 0;
  let cellBars = 0; let rhythmExact = 0; let rhythmPartial = 0;
  let bassBars = 0; let bassSame = 0;
  const cellTicks = input.cell.map((slot) => slot * input.eighthTicks);
  const carrierEvents = (list: readonly FingerprintEvent[], bar: FingerprintBar): FingerprintEvent[] => within(list, bar).filter((event) =>
    (input.carrier === 'left-hand' ? event.layer !== 'melody' && event.p < 60
      : input.carrier === 'right-hand' ? event.layer !== 'melody' && event.p >= 60
        : event.layer === 'melody'));

  for (const bar of bars) {
    const before = line(input.independent, bar);
    const after = line(input.adapted, bar);
    const planned = input.themeBarByBar.get(bar.bar);
    if (planned !== null && planned !== undefined && before.length) {
      // Compare on the attacks of the original bar: notes added on top (a run, an ornament, a cadence chord) do not erase the theme.
      const original = new Set(before.map((note) => note.t));
      const kept = after.filter((note) => original.has(note.t));
      const a = shape(before, bar);
      const b = shape(kept, bar);
      let verdict: 'exact' | 'transformed' | 'lost' = 'lost';
      if (same(a.positions, b.positions) && same(a.directions, b.directions)) verdict = 'exact';
      else if (b.positions.length >= Math.min(2, a.positions.length)) verdict = 'transformed';
      themeBars++;
      if (verdict === 'exact') themeExact++; else if (verdict === 'transformed') themeTransformed++;
      if (planned === 0) {
        headBars++;
        if (verdict === 'exact') headExact++; else if (verdict === 'transformed') headTransformed++;
      }
    }
    if (cellTicks.length) {
      const had = new Set(carrierEvents(input.independent, bar).map((event) => event.t - bar.startTick));
      if (cellTicks.every((tick) => had.has(tick))) {
        cellBars++;
        const has = new Set(carrierEvents(input.adapted, bar).map((event) => event.t - bar.startTick));
        const kept = cellTicks.filter((tick) => has.has(tick)).length;
        if (kept === cellTicks.length) rhythmExact++;
        else if (kept * 2 >= cellTicks.length) rhythmPartial++;
      }
    }
    const lowest = (list: readonly FingerprintEvent[]): number | null => {
      const events = within(list, bar);
      if (!events.length) return null;
      const first = Math.min(...events.map((event) => event.t));
      return mod(Math.min(...events.filter((event) => event.t === first).map((event) => event.p)), 12);
    };
    const bassBefore = lowest(input.independent);
    if (bassBefore !== null) {
      bassBars++;
      if (lowest(input.adapted) === bassBefore) bassSame++;
    }
  }
  const present = new Set(input.adapted.map((event) => `${event.t}:${event.p}`));
  const share = (count: number, total: number) => (total ? round3(count / total) : 1);
  return {
    themeExact: share(themeExact, themeBars),
    themeTransformed: share(themeTransformed, themeBars),
    themeLost: share(themeBars - themeExact - themeTransformed, themeBars),
    headExact: share(headExact, headBars),
    headTransformed: share(headTransformed, headBars),
    headLost: share(headBars - headExact - headTransformed, headBars),
    rhythmExact: share(rhythmExact, cellBars),
    rhythmPartial: cellBars ? round3(rhythmPartial / cellBars) : 0,
    bassMotion: share(bassSame, bassBars),
    events: share(input.independent.filter((event) => present.has(`${event.t}:${event.p}`)).length, input.independent.length),
    themeBars, headBars, cellBars,
  };
}
