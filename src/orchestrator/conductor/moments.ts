/**
 * Moment vocabulary.
 *
 * Moments were the rare designed gestures (unison phrase, tutti hit, soli,
 * divisi, imitation) planned by the old conductor and rendered by the string /
 * brass / wind generators. Those generators are gone; only the Piano reads
 * moments, and it reads them as CONTEXT — the kinds of gesture the piece was
 * meant to contain — from a plan it is handed. What remains here is exactly
 * that surface: the kind, the plan shape, and the per-bar lookup.
 */

export type MomentKind = 'unison' | 'tutti' | 'soli' | 'divisi' | 'imitation';

export interface MomentSpanPitch { startTick: number; endTick: number; pitch: number }

/** One planned moment. Bars are inclusive; ticks are clipped to the bars. */
export interface MomentPlan {
  kind: MomentKind;
  startBar: number;
  endBar: number;
  startTick: number;
  endTick: number;
  /** unison: the drawn spread and the texture's lead (the line everyone plays). */
  spread?: 'tight' | 'wide';
  carrierTrackId?: string;
  /** unison: pitch offset per ROLE (resolved from the track at render time). */
  offsetByRole?: Record<string, number>;
  /** tutti: the ROSTER roles that hit together (strings are the first participants). */
  participantRoles?: string[];
  /** tutti: what follows the marcato hit inside the bar. */
  shape?: 'hold' | 'breath' | 'decay';
  /** soli: the carrier plays the motif ('lead') or the bass holds alone ('bass'). */
  flavor?: 'lead' | 'bass';
  /** divisi: the track that splits, and its second line per chord span. */
  divTrackId?: string;
  divSpans?: MomentSpanPitch[];
  /** imitation: the answering voice, its delay and transposition mode. */
  answerTrackId?: string;
  leadTrackId?: string;
  delayTicks?: number;
  transpose?: 'chordTone' | 'diatonic3' | 'diatonic5';
}

/** The moment covering one bar, or null. */
export const momentForBar = (moments: MomentPlan[] | undefined, bar: number): MomentPlan | null =>
  moments?.find((m) => bar >= m.startBar && bar <= m.endBar) ?? null;
