/**
 * Strings V1 bridge (Stage 1) — the single place where the V1 path meets
 * the existing string pipeline.
 *
 * THE PREPARED LINES PASS THROUGH. `prepareStringsForMode` hands the classic
 * prepared lines back unchanged in both modes: the classic strings, the
 * conductor and every other family read exactly what they always read.
 * Stage 2 adds ONE composed voice, written after the classic pipeline has
 * finished (`../composition`); it replaces one track's classic part and is
 * recorded on the context here. The classic branch and the classic string
 * code are never edited.
 *
 * Ensemble orchestration V1 adds `orchestration`: its accepted note/CC maps
 * are the final handoff. In that path `composition` is a thematic-source
 * preview and the four historical sequential output fields stay null.
 *
 * What the bridge owns:
 *   - the V1 context attached to the compose run (`StringsV1Context`);
 *   - the routing of the prepared lines by mode;
 *   - the summary of the string information other families consume
 *     (`consumedStringInformation`), read by the comparison harness;
 *   - the documented hand-off points for the Double Bass
 *     (`BASS_HAND_OFF_POINTS`) and, since Stage 6, the composed Double
 *     Bass that replaces the desk's classic notes (`independentBassHandOff`).
 */
import type { Note } from '../../../shared/schema/types';
import type { OrchestratorContext } from '../../module';
import type { StringLines } from '../../render';
import type { StringsCompositionMode } from '../mode';
import type { StringsUnderstanding } from '../understanding';
import type { StringsV1Composition } from '../composition';
import type { StringsV1Ensemble } from '../ensemble/compose';
import type { StringsV1ThirdVoice } from '../ensemble/third';
import type { StringsV1FourthVoice } from '../ensemble/fourth';
import type { StringsV1FifthVoice } from '../ensemble/fifth';
import type { EnsembleRealization } from '../orchestration/realize';

/** The V1 annotation of one compose run. In memory only; never persisted. */
export interface StringsV1Context {
  readonly mode: 'v1';
  /** The stage describes itself, so tests and reports can tell what V1 does. */
  readonly stage: 6;
  /** True while no V1 voice has replaced a classic part (then V1 output equals classic output). */
  readonly passThrough: boolean;
  readonly understanding: StringsUnderstanding;
  /** Stage 2: the first composed voice; null until the compose run reaches the V1 voice step. */
  readonly composition: StringsV1Composition | null;
  /** Stage 3: the second voice, its plan and the review; null until the compose run reaches that step. */
  readonly ensemble: StringsV1Ensemble | null;
  /** Stage 4: the Viola as a third voice, its plan and the three-voice review; null until the compose run reaches that step. */
  readonly viola: StringsV1ThirdVoice | null;
  /** Stage 5: the Cello as a fourth voice, its plan and the four-voice review; null until the compose run reaches that step. */
  readonly cello: StringsV1FourthVoice | null;
  /** Stage 6: the Double Bass as a fifth voice, its plan and the five-voice review; null until the compose run reaches that step. */
  readonly doubleBass: StringsV1FifthVoice | null;
  /** Coordinated ensemble path. When present the sequential fields above
   * remain null: they must not be mistaken for accepted final parts. */
  readonly orchestration?: EnsembleRealization;
}

export function createStringsV1Context(understanding: StringsUnderstanding): StringsV1Context {
  return { mode: 'v1', stage: 6, passThrough: true, understanding, composition: null, ensemble: null, viola: null, cello: null, doubleBass: null };
}

/** The context after the second-voice step. A second voice never ends the pass-through by itself: it exists only beside a written first voice. */
export function withStringsV1Ensemble(context: StringsV1Context, ensemble: StringsV1Ensemble): StringsV1Context {
  return { ...context, ensemble };
}

/** The context after the Viola step. Like the second voice, it exists only beside a written first voice. */
export function withStringsV1Viola(context: StringsV1Context, viola: StringsV1ThirdVoice): StringsV1Context {
  return { ...context, viola };
}

/** The context after the Cello step. Like the other added voices, it exists only beside a written first voice. */
export function withStringsV1Cello(context: StringsV1Context, cello: StringsV1FourthVoice): StringsV1Context {
  return { ...context, cello };
}

/** The context after the Double Bass step. Like the other added voices, it exists only beside a written first voice. */
export function withStringsV1DoubleBass(context: StringsV1Context, doubleBass: StringsV1FifthVoice): StringsV1Context {
  return { ...context, doubleBass };
}

/** The context after the V1 voice step: a written voice ends the pass-through. */
export function withStringsV1Composition(context: StringsV1Context, composition: StringsV1Composition): StringsV1Context {
  return { ...context, passThrough: !composition.written, composition };
}

/**
 * The prepared string lines for the selected mode.
 * Classic: exactly `prepareClassic(ctx, take)`.
 * V1, Stage 1: the same call — a pass-through.
 */
export function prepareStringsForMode(
  mode: StringsCompositionMode,
  ctx: OrchestratorContext,
  take: number,
  prepareClassic: (ctx: OrchestratorContext, take: number) => StringLines,
): StringLines {
  if (mode !== 'v1') return prepareClassic(ctx, take);
  return prepareStringsV1(ctx, take, prepareClassic);
}

/** The V1 branch. Stage 1: no V1 composition exists, so the classic lines pass through unchanged. */
function prepareStringsV1(
  ctx: OrchestratorContext,
  take: number,
  prepareClassic: (ctx: OrchestratorContext, take: number) => StringLines,
): StringLines {
  return prepareClassic(ctx, take);
}

/** The string information other families read from the prepared lines. */
export interface ConsumedStringInformation {
  /** The tune carrier per bar (index bar − 1); read by brass, winds and the controller lanes. */
  readonly carrierByBar: readonly (string | null)[];
  /** Every lead line; brass and winds double them. */
  readonly leads: readonly { readonly trackId: string; readonly notes: readonly Note[] }[];
  /** The counter line; winds read it. */
  readonly counter: { readonly trackId: string; readonly notes: readonly Note[] } | null;
  /** Soli lines per track; brass and winds read them. */
  readonly soliLineByTrackId: Readonly<Record<string, readonly Note[]>>;
}

const copyNotes = (notes: readonly Note[]): Note[] => notes.map((n) => ({ ...n }));

/** A detached copy, so a diagnostic reader can never alter the compose run. */
export function consumedStringInformation(lines: StringLines): ConsumedStringInformation {
  return {
    carrierByBar: [...lines.carrierByBar],
    leads: lines.leads.map((l) => ({ trackId: l.trackId, notes: copyNotes(l.notes) })),
    counter: lines.counter ? { trackId: lines.counter.trackId, notes: copyNotes(lines.counter.notes) } : null,
    soliLineByTrackId: Object.fromEntries(Object.entries(lines.soliLineByTrackId).map(([id, notes]) => [id, copyNotes(notes)])),
  };
}

/** Ephemeral diagnostics attached (non-enumerable) to the compose result in both modes. */
export interface StringsCompositionDiagnostics {
  readonly mode: StringsCompositionMode;
  readonly consumed: ConsumedStringInformation;
  /** Null in classic mode. */
  readonly v1: StringsV1Context | null;
}

export function stringsDiagnosticsOf(mode: StringsCompositionMode, lines: StringLines, v1: StringsV1Context | null): StringsCompositionDiagnostics {
  return { mode, consumed: consumedStringInformation(lines), v1 };
}

/* ------------------------------------------------------------------ */
/* Double Bass hand-off                                                */
/* ------------------------------------------------------------------ */

/**
 * How the Double Bass reaches its track today (classic), in compose order.
 * Each entry names a call in `compose.ts`; a test checks that every anchor
 * still exists there, so this description cannot silently go stale.
 *
 * Today the bass is never composed. Its notes are cello notes marked 'cb':
 *   1. `maybeLayerCellosBasses` adds an octave-lower copy of cello notes,
 *      marked 'cb', inside the cello track (where the template's octave
 *      doubling policy allows it).
 *   2. `splitCelloLine` (only when `splitEngaged(template)`: Symphony,
 *      Cinematic, Hybrid Studio) marks the notes that belong to the bass
 *      desk and writes the cello's octave-up answers.
 *   3. `materializeBasses` removes the marked notes from the cello list and
 *      returns them as the Double Basses notes; they go to the project's own
 *      'basses' track when one exists, else to a new `trk_basses` track.
 *
 * STAGE 6. The three classic steps still run in V1, on classic notes only:
 * every other family is written against the classic strings, and changing
 * what the split sees would change those families. The composed Double
 * Bass (`../ensemble/fifth`) is written after everything else and REPLACES
 * the notes and controller lanes of the desk that step 3 produced. The
 * split therefore never runs on a V1 note, and the desk holds either the
 * split's notes (classic; or V1 when no Double Bass could be written) or
 * the composed part — never both. The `v1` field of each entry says what
 * happens to that step's result in V1.
 */
export const BASS_HAND_OFF_POINTS = [
  { step: 1, anchor: 'maybeLayerCellosBasses(ctx, notesByTrackId, stringsTrackIds)', role: 'adds the octave-lower cb copies inside the cello track', v1: 'runs on classic notes; its result is replaced on both desks when the V1 voices are written' },
  { step: 2, anchor: 'splitCelloLine(plan.moments,', role: 'marks the bass-desk notes and writes cello octave-up answers', v1: 'runs on classic notes only; never sees a V1 note' },
  { step: 3, anchor: 'materializeBasses(notesByTrackId[cbTrack.id], endTick)', role: 'turns marked notes into the Double Basses track', v1: 'creates the desk; the composed Double Bass replaces its notes at the end of the run' },
] as const;

/** Independently composed Double Bass notes for the hand-off at step 3. */
export interface IndependentBassHandOff {
  readonly notes: readonly Note[];
}

/**
 * The independently composed bass of a V1 run, or null when there is none
 * (classic mode; a band without a Double Basses desk; a Double Bass that
 * could not be written — then the desk keeps the classic split's notes).
 * A report of what the run did; the compose run itself does not call this.
 */
export function independentBassHandOff(v1: StringsV1Context | null): IndependentBassHandOff | null {
  if (v1?.orchestration) {
    const ensemble = v1.orchestration;
    const desk = ensemble.plan?.capabilities.find((c) => c.role === 'basses');
    if (!ensemble.accepted || !desk) return null;
    return { notes: (ensemble.notesByTrackId[desk.trackId] ?? []).map((n) => ({ ...n })) };
  }
  const bass = v1?.doubleBass;
  if (!bass || !bass.written) return null;
  return { notes: bass.notes.map((n) => ({ ...n })) };
}
