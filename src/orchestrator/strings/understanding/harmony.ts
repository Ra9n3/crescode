/**
 * Harmonic map (Strings V1, Stage 1) — a read-only analysis of the chord
 * progression the project already holds. It never changes the harmony.
 *
 * Every chord and every join between chords carries two parts:
 *   `fact`     copied from the project's resolved chord spans;
 *   `reading`  an interpretation computed here by the stated rule.
 * Readings are heuristics for later planning, not statements about the music.
 *
 * No randomness: the same chord spans give the same map.
 */
import { barTicks } from '../../../shared/schema/meter';
import { scalePitchClasses } from '../../../shared/schema/modes';
import type { Project } from '../../../shared/schema/types';
import type { ResolvedChord } from '../../spine';

const mod12 = (n: number): number => ((n % 12) + 12) % 12;
const round = (value: number): number => Math.round(value * 1000) / 1000;

export type ChordToneRole = 'root' | 'third' | 'fifth' | 'seventh' | 'extension';

/** The role of a pitch class in a chord, by its interval above the root. */
export function chordToneRole(rootPc: number, pc: number): ChordToneRole {
  const interval = mod12(pc - rootPc);
  if (interval === 0) return 'root';
  if (interval === 3 || interval === 4) return 'third';
  if (interval === 6 || interval === 7 || interval === 8) return 'fifth';
  if (interval === 10 || interval === 11) return 'seventh';
  return 'extension';
}

export interface HarmonicChord {
  readonly fact: {
    readonly index: number;
    readonly id: string;
    readonly symbol: string;
    readonly startTick: number;
    readonly endTick: number;
    readonly durationTicks: number;
    /** 1-indexed bar the chord starts in. */
    readonly startBar: number;
    readonly rootPc: number;
    /** The slash bass when the symbol has one, else the root. */
    readonly bassPc: number;
    readonly quality: string;
    readonly pitchClasses: readonly number[];
  };
  readonly reading: {
    /** 0-indexed scale degree of the root in the project's key and mode; null when the root is outside the scale. */
    readonly rootDegree: number | null;
    readonly pitchClassesOutsideScale: readonly number[];
    readonly isTonicRoot: boolean;
    /** 0..1, the sum of the named sources below, capped at 1. */
    readonly tension: number;
    /** 1 − tension. */
    readonly stability: number;
    readonly tensionSources: readonly string[];
  };
}

export type RootMotion = 'same' | 'fifth-down' | 'fifth-up' | 'step-up' | 'step-down' | 'third-up' | 'third-down' | 'tritone';
export type ArrivalKind = 'dominant-to-tonic' | 'plagal' | 'step-to-tonic' | 'return-to-tonic' | 'fifth-fall' | 'onto-fifth-degree';

export interface HarmonicJoin {
  readonly fact: {
    readonly fromIndex: number;
    readonly toIndex: number;
    /** Where the second chord starts. */
    readonly tick: number;
    /** Ticks without a chord between the two (0 when they touch). */
    readonly gapTicks: number;
  };
  readonly reading: {
    readonly rootMotion: RootMotion;
    /** Smallest signed semitone move of the bass pitch class (−5..6). */
    readonly bassMoveSemitones: number;
    readonly bassMovesByStep: boolean;
    readonly bassHeld: boolean;
    /** Pitch classes present in both chords. */
    readonly commonTones: readonly number[];
    /** Where the first chord's third and seventh can go by the smallest move. */
    readonly guideTones: readonly { readonly pc: number; readonly role: 'third' | 'seventh'; readonly toPc: number; readonly moveSemitones: number }[];
    /** Tones of the first chord, absent from the second, that could be held over and fall by step into it. */
    readonly suspensions: readonly { readonly heldPc: number; readonly resolvesToPc: number; readonly stepSemitones: 1 | 2; readonly resolutionRole: ChordToneRole }[];
    readonly tensionChange: number;
    /** A possible arrival on the second chord; null when no rule below applies. */
    readonly arrival: { readonly kind: ArrivalKind; readonly strength: number; readonly rule: string } | null;
  };
}

export interface PedalOpportunity {
  readonly pc: number;
  readonly role: 'tonic' | 'fifth-degree' | 'held-bass';
  readonly fromIndex: number;
  readonly toIndex: number;
  readonly startTick: number;
  readonly endTick: number;
}

export interface HarmonicRhythmBar {
  /** 1-indexed bar. */
  readonly bar: number;
  /** Chords that start in this bar. */
  readonly chordStarts: number;
  /** Indexes of the chords sounding at any point of the bar. */
  readonly chordIndexes: readonly number[];
}

export interface HarmonicMap {
  readonly version: 1;
  readonly facts: {
    readonly key: number;
    readonly mode: string;
    readonly barTicks: number;
    readonly endTick: number;
    readonly chordCount: number;
    /** Stretches of the project with no chord. */
    readonly uncoveredSpans: readonly { readonly startTick: number; readonly endTick: number }[];
  };
  readonly chords: readonly HarmonicChord[];
  readonly joins: readonly HarmonicJoin[];
  readonly rhythm: {
    readonly bars: readonly HarmonicRhythmBar[];
    /** Bars whose number of chord starts differs from the bar before. */
    readonly changes: readonly { readonly bar: number; readonly from: number; readonly to: number }[];
    readonly medianChordTicks: number | null;
  };
  readonly pedals: readonly PedalOpportunity[];
  readonly notDerived: readonly string[];
}

/** Tension weights: a reading, kept in one place so it can be reviewed and tuned by listening. */
export const TENSION_WEIGHTS = {
  tritone: 0.35,
  seventh: 0.15,
  extension: 0.1,
  outsideScale: 0.15,
  bassNotRoot: 0.1,
  rootNotTonic: 0.15,
} as const;

function readChord(chord: ResolvedChord, key: number, scale: readonly number[]): HarmonicChord['reading'] {
  const root = mod12(chord.parsed.root);
  const pcs = [...new Set(chord.parsed.pitchClasses.map(mod12))];
  const bass = chord.parsed.bass === null ? root : mod12(chord.parsed.bass);
  const sources: string[] = [];
  let tension = 0;
  const hasTritone = pcs.some((a) => pcs.includes(mod12(a + 6)));
  if (hasTritone) { tension += TENSION_WEIGHTS.tritone; sources.push('contains a tritone'); }
  if (pcs.some((pc) => chordToneRole(root, pc) === 'seventh')) { tension += TENSION_WEIGHTS.seventh; sources.push('contains a seventh'); }
  if (chord.parsed.intervals.some((i) => i > 12)) { tension += TENSION_WEIGHTS.extension; sources.push('contains an extension above the octave'); }
  const outside = pcs.filter((pc) => !scale.includes(pc)).sort((a, b) => a - b);
  if (outside.length) { tension += TENSION_WEIGHTS.outsideScale; sources.push('contains a pitch class outside the scale'); }
  if (bass !== root) { tension += TENSION_WEIGHTS.bassNotRoot; sources.push('bass is not the root'); }
  if (root !== mod12(key)) { tension += TENSION_WEIGHTS.rootNotTonic; sources.push('root is not the tonic'); }
  tension = round(Math.min(1, tension));
  const degree = scale.indexOf(root);
  return {
    rootDegree: degree >= 0 ? degree : null,
    pitchClassesOutsideScale: outside,
    isTonicRoot: root === mod12(key),
    tension,
    stability: round(1 - tension),
    tensionSources: sources,
  };
}

function rootMotionOf(from: number, to: number): RootMotion {
  const up = mod12(to - from);
  if (up === 0) return 'same';
  if (up === 5) return 'fifth-down';
  if (up === 7) return 'fifth-up';
  if (up === 1 || up === 2) return 'step-up';
  if (up === 10 || up === 11) return 'step-down';
  if (up === 3 || up === 4) return 'third-up';
  if (up === 8 || up === 9) return 'third-down';
  return 'tritone';
}

/** Smallest signed move from one pitch class to another; a tie (six semitones) reads as +6. */
const signedMove = (from: number, to: number): number => {
  const up = mod12(to - from);
  return up > 6 ? up - 12 : up;
};

/** Nearest pitch class of `targets` to `pc`; equal distances prefer the downward move. */
function nearestPc(pc: number, targets: readonly number[]): { toPc: number; move: number } {
  let best = { toPc: targets[0], move: signedMove(pc, targets[0]) };
  for (const target of targets) {
    const move = signedMove(pc, target);
    if (Math.abs(move) < Math.abs(best.move) || (Math.abs(move) === Math.abs(best.move) && move < best.move)) best = { toPc: target, move };
  }
  return best;
}

function arrivalOf(from: HarmonicChord, to: HarmonicChord, key: number): HarmonicJoin['reading']['arrival'] {
  const tonic = mod12(key);
  const motion = rootMotionOf(from.fact.rootPc, to.fact.rootPc);
  if (to.fact.rootPc === tonic && from.fact.rootPc !== tonic) {
    if (motion === 'fifth-down') {
      const leadingTone = from.fact.pitchClasses.includes(mod12(tonic + 11));
      return leadingTone
        ? { kind: 'dominant-to-tonic', strength: 1, rule: 'root falls a fifth onto the tonic and the first chord holds the leading tone' }
        : { kind: 'dominant-to-tonic', strength: 0.8, rule: 'root falls a fifth onto the tonic; the first chord has no leading tone' };
    }
    if (motion === 'fifth-up') return { kind: 'plagal', strength: 0.6, rule: 'root rises a fifth (falls a fourth) onto the tonic' };
    if (motion === 'step-up' || motion === 'step-down') return { kind: 'step-to-tonic', strength: 0.5, rule: 'root moves by step onto the tonic' };
    return { kind: 'return-to-tonic', strength: 0.4, rule: 'root returns to the tonic by another interval' };
  }
  if (motion === 'fifth-down') return { kind: 'fifth-fall', strength: 0.3, rule: 'root falls a fifth onto a chord that is not the tonic' };
  if (to.fact.rootPc === mod12(tonic + 7) && from.fact.rootPc !== to.fact.rootPc) {
    return { kind: 'onto-fifth-degree', strength: 0.3, rule: 'root moves onto the fifth degree; open if a boundary follows' };
  }
  return null;
}

function pedalsOf(chords: readonly HarmonicChord[], key: number): PedalOpportunity[] {
  const out: PedalOpportunity[] = [];
  const runs = (holds: (c: HarmonicChord) => boolean, pcOf: (c: HarmonicChord) => number, role: PedalOpportunity['role'], sameKey?: (c: HarmonicChord) => number): void => {
    let start = -1;
    for (let i = 0; i <= chords.length; i++) {
      const inRun = i < chords.length && holds(chords[i]) && (start < 0 || !sameKey || sameKey(chords[i]) === sameKey(chords[start]));
      if (inRun && start < 0) start = i;
      if (!inRun && start >= 0) {
        // a pedal needs harmony to move over it: at least two different chords
        const distinct = new Set(chords.slice(start, i).map((c) => c.fact.symbol)).size;
        if (i - start >= 2 && distinct >= 2) {
          out.push({ pc: pcOf(chords[start]), role, fromIndex: start, toIndex: i - 1, startTick: chords[start].fact.startTick, endTick: chords[i - 1].fact.endTick });
        }
        start = i < chords.length && holds(chords[i]) ? i : -1;
      }
    }
  };
  const tonic = mod12(key);
  const fifth = mod12(key + 7);
  runs((c) => c.fact.pitchClasses.includes(tonic), () => tonic, 'tonic');
  runs((c) => c.fact.pitchClasses.includes(fifth), () => fifth, 'fifth-degree');
  runs(() => true, (c) => c.fact.bassPc, 'held-bass', (c) => c.fact.bassPc);
  return out.sort((a, b) => a.startTick - b.startTick || a.role.localeCompare(b.role));
}

export interface HarmonyInput {
  readonly project: Pick<Project, 'key' | 'mode' | 'timeSignature'>;
  /** The project's normalized, non-overlapping chord spans. */
  readonly spans: readonly ResolvedChord[];
  readonly endTick: number;
}

export function buildHarmonicMap(input: HarmonyInput): HarmonicMap {
  const { project, spans, endTick } = input;
  const key = mod12(project.key);
  const scale = scalePitchClasses(project.key, project.mode).map(mod12);
  const bar = barTicks(project.timeSignature);
  const ordered = [...spans].sort((a, b) => a.startTick - b.startTick);

  const chords: HarmonicChord[] = ordered.map((chord, index) => {
    const root = mod12(chord.parsed.root);
    return {
      fact: {
        index,
        id: chord.id,
        symbol: chord.symbol,
        startTick: chord.startTick,
        endTick: chord.endTick,
        durationTicks: chord.endTick - chord.startTick,
        startBar: Math.floor(chord.startTick / bar) + 1,
        rootPc: root,
        bassPc: chord.parsed.bass === null ? root : mod12(chord.parsed.bass),
        quality: chord.parsed.quality,
        pitchClasses: [...new Set(chord.parsed.pitchClasses.map(mod12))],
      },
      reading: readChord(chord, key, scale),
    };
  });

  const joins: HarmonicJoin[] = [];
  for (let i = 0; i + 1 < chords.length; i++) {
    const from = chords[i];
    const to = chords[i + 1];
    const toPcs = to.fact.pitchClasses;
    const bassMove = signedMove(from.fact.bassPc, to.fact.bassPc);
    const guideTones = from.fact.pitchClasses
      .filter((pc) => chordToneRole(from.fact.rootPc, pc) === 'third' || chordToneRole(from.fact.rootPc, pc) === 'seventh')
      .map((pc) => {
        const target = nearestPc(pc, toPcs);
        return { pc, role: chordToneRole(from.fact.rootPc, pc) as 'third' | 'seventh', toPc: target.toPc, moveSemitones: target.move };
      });
    const suspensions = from.fact.pitchClasses
      .filter((pc) => !toPcs.includes(pc))
      .flatMap((pc) => ([1, 2] as const)
        .filter((step) => toPcs.includes(mod12(pc - step)))
        .map((step) => ({ heldPc: pc, resolvesToPc: mod12(pc - step), stepSemitones: step, resolutionRole: chordToneRole(to.fact.rootPc, mod12(pc - step)) })));
    joins.push({
      fact: { fromIndex: i, toIndex: i + 1, tick: to.fact.startTick, gapTicks: Math.max(0, to.fact.startTick - from.fact.endTick) },
      reading: {
        rootMotion: rootMotionOf(from.fact.rootPc, to.fact.rootPc),
        bassMoveSemitones: bassMove,
        bassMovesByStep: Math.abs(bassMove) === 1 || Math.abs(bassMove) === 2,
        bassHeld: bassMove === 0,
        commonTones: from.fact.pitchClasses.filter((pc) => toPcs.includes(pc)),
        guideTones,
        suspensions,
        tensionChange: round(to.reading.tension - from.reading.tension),
        arrival: arrivalOf(from, to, key),
      },
    });
  }

  const barCount = Math.max(1, Math.ceil(endTick / bar));
  const rhythmBars: HarmonicRhythmBar[] = Array.from({ length: barCount }, (_, i) => {
    const start = i * bar;
    const end = start + bar;
    return {
      bar: i + 1,
      chordStarts: chords.filter((c) => c.fact.startTick >= start && c.fact.startTick < end).length,
      chordIndexes: chords.filter((c) => c.fact.startTick < end && c.fact.endTick > start).map((c) => c.fact.index),
    };
  });
  const changes = rhythmBars
    .slice(1)
    .map((b, i) => ({ bar: b.bar, from: rhythmBars[i].chordStarts, to: b.chordStarts }))
    .filter((c) => c.from !== c.to);
  const durations = chords.map((c) => c.fact.durationTicks).sort((a, b) => a - b);

  const uncovered: { startTick: number; endTick: number }[] = [];
  let cursor = 0;
  for (const c of chords) {
    if (c.fact.startTick > cursor) uncovered.push({ startTick: cursor, endTick: c.fact.startTick });
    cursor = Math.max(cursor, c.fact.endTick);
  }
  if (cursor < endTick) uncovered.push({ startTick: cursor, endTick });

  return {
    version: 1,
    facts: { key, mode: project.mode, barTicks: bar, endTick, chordCount: chords.length, uncoveredSpans: uncovered },
    chords,
    joins,
    rhythm: { bars: rhythmBars, changes, medianChordTicks: durations.length ? durations[Math.floor((durations.length - 1) / 2)] : null },
    pedals: pedalsOf(chords, key),
    notDerived: [
      'modulation and local keys: every reading is relative to the single project key and mode',
      'functional labels (Roman numerals, secondary dominants): not analysed',
      'voicing, register and octave of any tone: the map holds pitch classes only',
      'which opportunity a voice should take: decided in later stages',
    ],
  };
}
