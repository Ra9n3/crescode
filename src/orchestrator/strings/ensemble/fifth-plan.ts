/**
 * The plan for a fifth voice (Strings V1, Stage 6) — what the Double Bass
 * is asked to do in every stretch, decided BEFORE any Double Bass note
 * exists.
 *
 * It reads the four voices as they stand: the first voice's phrases, what
 * the Cello was asked to do in every stretch and whether it played, what
 * the Viola did, and the energy of the piece there. Those voices are
 * finished; this plan never changes them.
 *
 * The rules, in order. Each stretch records the rule that decided it.
 *   1. The theme heard for the first time: the Double Bass is held back, so
 *      that its entry later means something — unless the piece opens loud,
 *      where the floor needs its lowest octave: long tones.
 *   2. A later statement of the theme: the Double Bass does what the Cello
 *      is not doing. Under a plucked Cello it bows long tones; under a
 *      Cello that holds, it gives root and fifth in separate bows; where
 *      the Cello has left, it plucks (in a loud passage) or stays out.
 *   3. A restatement: where the Cello's bass moves, the Double Bass stands
 *      (long tones). Once the Cello has had the theme, the Double Bass may
 *      answer here instead — the theme's head in notes twice as long, under
 *      the restated theme — once in a piece. Where the Cello is silent the
 *      Double Bass moves.
 *   4. The drive to the phrase's goal: where the Cello leaves the bass for
 *      the theme, the Double Bass takes the bass line over and moves.
 *      Otherwise it supports: root and fifth in a loud passage, long tones
 *      in a quiet one.
 *   5. The ending: a Double Bass that was bowing arrives on the bass of the
 *      goal; at the last cadence of the piece it joins the Cello's arrival
 *      even from silence; otherwise it stays out.
 */
import { DOUBLE_BASS, type DoubleBassRole } from '../characters/double-bass';
import type { SegmentKind } from '../phrases/plan';
import type { EnsemblePlan } from './plan';

export interface FifthSpan {
  readonly index: number;
  readonly phrase: number;
  readonly startTick: number;
  readonly endTick: number;
  readonly mustEndBy: number;
  readonly role: DoubleBassRole;
  /** Mean energy (0..1) of the bars the stretch covers. */
  readonly energy: number;
  /** What the first voice and the Cello do in this stretch. */
  readonly firstVoice: string;
  readonly cello: string;
  /** What the Double Bass is asked to do, in words; the writer decides how. */
  readonly intention: string;
  /** The rule that asked for this role, and the facts it read. */
  readonly reason: string;
}

export interface FifthPlan {
  readonly doubleBass: { readonly trackId: string; readonly name: string };
  readonly spans: readonly FifthSpan[];
}

export interface FifthPlanInput {
  readonly barTicks: number;
  readonly duo: EnsemblePlan;
  /** Per stretch: what the Cello was asked to do and whether it wrote anything. */
  readonly cello: readonly { readonly span: number; readonly role: string; readonly played: boolean }[];
  /** Energy 0..1 per bar (index bar − 1). */
  readonly energyByBar: readonly number[];
  readonly doubleBass: { readonly trackId: string; readonly name: string };
  /** Length of the theme's head in notes twice as long. */
  readonly responseTicks: number;
  /** What the instrument can trigger with a keyswitch of its own. */
  readonly triggerable: readonly string[];
}

export function planFifthVoice(input: FifthPlanInput): FifthPlan {
  const { duo, barTicks } = input;
  const can = (role: Exclude<DoubleBassRole, 'tacet'>): boolean => input.triggerable.includes(DOUBLE_BASS.articulation[role]);
  const lastPhrase = duo.spans.length ? Math.max(...duo.spans.map((s) => s.phrase)) : -1;
  const spans: FifthSpan[] = [];
  let themeHeard = false;
  let celloHadTheme = false;
  let responded = false;
  let previous: DoubleBassRole = 'tacet';
  let previousEnd = -1;
  let previousPhrase = -1;

  for (const s of duo.spans) {
    if (s.phrase !== previousPhrase) { previous = 'tacet'; previousPhrase = s.phrase; }
    const was: DoubleBassRole = previousEnd === s.startTick ? previous : 'tacet';
    const c = input.cello.find((x) => x.span === s.index);
    const celloRole = c?.played ? c.role : 'tacet';
    const firstBar = Math.floor(s.startTick / barTicks);
    const lastBar = Math.max(firstBar, Math.ceil(s.endTick / barTicks) - 1);
    let sum = 0;
    for (let b = firstBar; b <= lastBar; b++) sum += Math.max(0, Math.min(1, input.energyByBar[Math.min(b, input.energyByBar.length - 1)] ?? 0.5));
    const energy = Math.round((sum / (lastBar - firstBar + 1)) * 100) / 100;
    const kinds: readonly SegmentKind[] = s.primaryActivity;
    const celloText = celloRole === 'tacet' ? 'the Cello is silent' : `the Cello: ${celloRole}`;
    const at = `energy ${energy}`;

    let role: DoubleBassRole = 'tacet';
    let intention = 'silence';
    let reason = '';
    if (kinds.includes('statement')) {
      if (!themeHeard) {
        if (energy >= DOUBLE_BASS.openingEnergy && can('foundation')) {
          role = 'foundation';
          intention = 'long tones on the bass of the harmony, an octave under the floor the Cello gives';
          reason = `rule 1 — the theme is heard for the first time in a loud opening (${at}, at or above ${DOUBLE_BASS.openingEnergy}): the floor is given its lowest octave`;
        } else reason = `rule 1 — the theme is heard for the first time (${at}, under ${DOUBLE_BASS.openingEnergy}): the Double Bass is held back so that its entry means something`;
      } else if (celloRole === 'plucked-bass') {
        if (can('foundation')) {
          role = 'foundation';
          intention = 'long bowed tones under the Cello\'s plucked bass';
          reason = 'rule 2 — the Cello plucks the bass under a known theme: the Double Bass bows it, a second colour on the same harmony';
        } else reason = 'rule 2 — no sustained stroke of its own: declined';
      } else if (celloRole === 'tacet') {
        if (energy >= DOUBLE_BASS.pluckEnergy && can('plucked')) {
          role = 'plucked';
          intention = 'the bass of the harmony, plucked, where the Cello has left it';
          reason = `rule 2 — the Cello has left the bass in a loud passage (${at}, at or above ${DOUBLE_BASS.pluckEnergy}): the Double Bass marks it, plucked`;
        } else reason = `rule 2 — the Cello rests under a known theme (${at}): the texture is meant to be light and the Double Bass stays out of it`;
      } else if (can('root-fifth')) {
        role = 'root-fifth';
        intention = 'the bass of the harmony on the bar and its fifth in the middle of it, in separate bows, under the Cello\'s held tones';
        reason = 'rule 2 — the Cello holds the bass under a known theme: the Double Bass gives the bar its pulse instead of holding with it';
      } else reason = 'rule 2 — no sustained stroke of its own: declined';
      themeHeard = true;
    } else if (kinds.includes('restatement')) {
      const length = s.endTick - s.startTick;
      if (celloHadTheme && !responded && celloRole !== 'theme' && can('response') && length >= input.responseTicks) {
        role = 'response';
        intention = 'the theme\'s head in notes twice as long, under the restated theme; long tones before and after it';
        reason = 'rule 3 — the Cello has had the theme and the theme is being restated above: the Double Bass answers with its head in augmentation, once in the piece';
        responded = true;
      } else if (celloRole === 'tacet') {
        if (can('moving')) {
          role = 'moving';
          intention = 'a bass line of its own: the harmony\'s bass where a chord begins, passing and connecting notes between';
          reason = 'rule 3 — the theme is restated and the Cello is silent: the bass line is the Double Bass\'s';
        } else reason = 'rule 3 — no legato stroke of its own: declined';
      } else if (can('foundation')) {
        role = 'foundation';
        intention = 'long tones on the bass of the harmony while the Cello moves above';
        reason = `rule 3 — the theme is restated (${celloText}): the Double Bass stands under the Cello, so that one bass moves and one holds`;
      } else reason = 'rule 3 — no sustained stroke of its own: declined';
    } else if (kinds.includes('development') || kinds.includes('approach')) {
      if (celloRole === 'theme') {
        celloHadTheme = true;
        if (can('moving')) {
          role = 'moving';
          intention = 'the bass line, taken over from the Cello: the harmony\'s bass where a chord begins, passing and connecting notes towards the next';
          reason = 'rule 4 — the Cello leaves the bass for the theme: the Double Bass takes the bass line over';
        } else if (can('foundation')) {
          role = 'foundation';
          intention = 'long tones on the bass of the harmony';
          reason = 'rule 4 — the Cello leaves the bass for the theme, and the Double Bass has no legato stroke: it holds the bass';
        } else reason = 'rule 4 — no stroke of its own for a bass: declined';
      } else if (energy >= DOUBLE_BASS.pulseEnergy && can('root-fifth')) {
        role = 'root-fifth';
        intention = 'the bass of the harmony on the bar and its fifth in the middle of it, in separate bows, towards the goal';
        reason = `rule 4 — on the way to the goal with ${celloText} (${at}, at or above ${DOUBLE_BASS.pulseEnergy}): the Double Bass gives the bar its pulse`;
      } else if (can('foundation')) {
        role = 'foundation';
        intention = 'long tones on the bass of the harmony';
        reason = `rule 4 — on the way to the goal in a quiet passage (${at}): long tones`;
      } else reason = 'rule 4 — no sustained stroke of its own: declined';
    } else if (kinds.includes('ending')) {
      const bowing = was !== 'tacet' && was !== 'plucked';
      if (bowing && can('arrival')) {
        role = 'arrival';
        intention = was === 'arrival' ? 'the arrival tone goes on' : 'the bass of the goal chord, struck with the arrival and let go';
        reason = 'rule 5 — the Double Bass was bowing towards this goal: it arrives on the bass of the goal chord';
      } else if (s.phrase === lastPhrase && celloRole === 'arrival' && can('arrival')) {
        role = 'arrival';
        intention = 'the bass of the last chord, under the Cello\'s arrival';
        reason = 'rule 5 — the last cadence of the piece: the Double Bass joins the Cello\'s arrival, even from silence';
      } else reason = `rule 5 — the Double Bass was ${was === 'plucked' ? 'plucking' : 'silent'} before this ending and it is not the last cadence: it does not enter for one note`;
    } else {
      reason = 'no rule applies to this stretch';
    }

    spans.push({ index: s.index, phrase: s.phrase, startTick: s.startTick, endTick: s.endTick, mustEndBy: s.mustEndBy, role, energy, firstVoice: s.primaryDescription, cello: celloText, intention, reason });
    previous = role;
    previousEnd = s.endTick;
  }
  return { doubleBass: input.doubleBass, spans };
}
