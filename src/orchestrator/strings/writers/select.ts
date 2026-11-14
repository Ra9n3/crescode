/**
 * Instrument selection (Strings V1, Stage 2) — which existing string track
 * should carry the composed voice.
 *
 * Nothing here names an instrument in advance. Every unlocked string track
 * of the band is examined against the line that was actually composed and
 * against what the rest of the ensemble plays around it:
 *
 *   capability   the line needs a connected (legato) sound the export can
 *                trigger for this instrument;
 *   foundation   a track that carries the bass in most bars is not taken:
 *                the ensemble would lose its ground;
 *   register     the whole line, at one octave, must lie inside the
 *                instrument's writing window; the score is the share of the
 *                line's sounding time inside its singing register;
 *   competition  the share of the line's bars in which ANOTHER track would
 *                still carry the classic tune against it;
 *   masking      the share of the line's sounding time in which another
 *                string voice sounds within a third of it.
 *
 * The three scored parts are combined with stated weights (judgements, not
 * measurements). The ranking is deterministic; an exact tie goes to the
 * track whose singing register is centred nearest the line.
 */
import type { Note } from '../../../shared/schema/types';

export interface SelectionCandidate {
  readonly trackId: string;
  readonly role: string;
  readonly name: string;
  /** Writing window (sounding MIDI). */
  readonly comfortable: readonly [number, number];
  /** Lowest key the patch plays; null when unknown. */
  readonly playableLow: number | null;
  readonly singing: readonly [number, number];
  readonly character: string;
  /** Articulations the export can trigger with a keyswitch of this instrument's own. */
  readonly triggerable: readonly string[];
  /** The classic layer of this track per bar (index bar − 1). */
  readonly classicLayers: readonly string[];
}

/** The composed line, before an octave is chosen: semitones above the tonic's octave-4 pitch. */
export interface LineForSelection {
  readonly notes: readonly { readonly tick: number; readonly duration: number; readonly pitchAtOctave0: number }[];
  /** Bars (1-indexed) in which the line sounds. */
  readonly bars: readonly number[];
}

export interface SelectionEvaluation {
  readonly trackId: string;
  readonly role: string;
  readonly name: string;
  readonly suitable: boolean;
  /** Why the track cannot take the line; empty when suitable. */
  readonly unsuitable: readonly string[];
  /** Octave transposition (in octaves) at which the line sits best; null when it fits nowhere. */
  readonly octave: number | null;
  readonly range: readonly [number, number] | null;
  readonly registerFit: number;
  readonly competition: number;
  readonly masking: number;
  readonly score: number;
  /** What the ensemble gives up when this track's classic part is replaced. */
  readonly replaces: string;
  readonly character: string;
}

export interface SelectionInput {
  readonly candidates: readonly SelectionCandidate[];
  readonly line: LineForSelection;
  /** The classic tune carrier per bar (index bar − 1). */
  readonly carrierByBar: readonly (string | null)[];
  /** The classic notes of every string track (final, as they will sound). */
  readonly classicNotesByTrackId: Readonly<Record<string, readonly Note[]>>;
}

export interface Selection {
  readonly chosen: SelectionEvaluation | null;
  readonly evaluations: readonly SelectionEvaluation[];
  readonly reason: string;
}

export const SELECTION_WEIGHTS = { registerFit: 2, competition: 2, masking: 1 } as const;
const round = (n: number): number => Math.round(n * 1000) / 1000;

export function selectInstrument(input: SelectionInput): Selection {
  const { line } = input;
  const total = line.notes.reduce((sum, n) => sum + n.duration, 0);
  const evaluations = input.candidates.map((c): SelectionEvaluation => {
    const unsuitable: string[] = [];
    if (!c.triggerable.includes('legato')) unsuitable.push('the export has no legato keyswitch for this instrument');
    const soundingBars = c.classicLayers.filter((l) => l !== 'tacet').length;
    const bassBars = c.classicLayers.filter((l) => l === 'bass').length;
    if (bassBars > 0 && bassBars * 2 >= soundingBars) unsuitable.push(`carries the bass in ${bassBars} of its ${soundingBars} sounding bars: the ensemble would lose its foundation`);

    // register: one octave for the whole line
    const low = Math.max(c.comfortable[0], c.playableLow ?? c.comfortable[0]);
    let best: { octave: number; fit: number; centre: number; range: [number, number] } | null = null;
    for (let octave = -3; octave <= 3; octave++) {
      const pitches = line.notes.map((n) => n.pitchAtOctave0 + 12 * octave);
      const range: [number, number] = [Math.min(...pitches), Math.max(...pitches)];
      if (range[0] < low || range[1] > c.comfortable[1]) continue;
      const inside = line.notes.reduce((sum, n, i) => sum + (pitches[i] >= c.singing[0] && pitches[i] <= c.singing[1] ? n.duration : 0), 0);
      const fit = total > 0 ? inside / total : 0;
      const weighted = line.notes.reduce((sum, n, i) => sum + pitches[i] * n.duration, 0) / Math.max(1, total);
      const centre = Math.abs(weighted - (c.singing[0] + c.singing[1]) / 2);
      if (!best || fit > best.fit + 1e-9 || (Math.abs(fit - best.fit) <= 1e-9 && centre < best.centre)) best = { octave, fit, centre, range };
    }
    if (!best) unsuitable.push(`the line does not fit the writing window ${low}–${c.comfortable[1]} at any octave`);

    // context: what the others play while the line sounds
    const competingBars = line.bars.filter((bar) => { const carrier = input.carrierByBar[bar - 1]; return carrier !== null && carrier !== undefined && carrier !== c.trackId; }).length;
    const competition = line.bars.length ? competingBars / line.bars.length : 0;
    let masked = 0;
    if (best) {
      const others = Object.entries(input.classicNotesByTrackId).filter(([id]) => id !== c.trackId).flatMap(([, notes]) => notes);
      for (const n of line.notes) {
        const pitch = n.pitchAtOctave0 + 12 * best.octave;
        const near = others.some((o) => o.startTick < n.tick + n.duration && o.startTick + o.durationTicks > n.tick && Math.abs(o.pitch - pitch) <= 4);
        if (near) masked += n.duration;
      }
    }
    const masking = total > 0 ? masked / total : 0;
    const registerFit = best?.fit ?? 0;
    const score = SELECTION_WEIGHTS.registerFit * registerFit - SELECTION_WEIGHTS.competition * competition - SELECTION_WEIGHTS.masking * masking;
    const layers = [...new Set(c.classicLayers)].map((l) => `${l} ×${c.classicLayers.filter((x) => x === l).length}`).join(', ');
    return {
      trackId: c.trackId, role: c.role, name: c.name, suitable: unsuitable.length === 0, unsuitable,
      octave: best?.octave ?? null, range: best?.range ?? null,
      registerFit: round(registerFit), competition: round(competition), masking: round(masking), score: round(score),
      replaces: `classic layers by bar: ${layers || 'none'}`, character: c.character,
    };
  });
  const suitable = evaluations.filter((e) => e.suitable).sort((a, b) => b.score - a.score || a.trackId.localeCompare(b.trackId));
  const chosen = suitable[0] ?? null;
  const reason = chosen
    ? `${chosen.name}: ${Math.round(chosen.registerFit * 100)}% of the line inside its singing register, a competing classic tune in ${Math.round(chosen.competition * 100)}% of the line's bars, another string voice within a third for ${Math.round(chosen.masking * 100)}% of its sounding time (score ${chosen.score}${suitable[1] ? `; next: ${suitable[1].name} ${suitable[1].score}` : ''})`
    : `no string track can take the line: ${evaluations.map((e) => `${e.name}: ${e.unsuitable.join('; ')}`).join(' | ') || 'no unlocked string track in the band'}`;
  return { chosen, evaluations, reason };
}
