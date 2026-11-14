/**
 * The plan for a fourth voice (Strings V1, Stage 5) — what the Cello is
 * asked to do in every stretch, decided BEFORE any Cello note exists.
 *
 * It reads the three upper voices as they stand: the first voice's phrases,
 * what the second voice and the Viola were asked to do in every stretch and
 * what they actually wrote there, and whether a Double Bass desk (still the
 * classic one) sounds underneath. Those voices are finished; this plan
 * never changes them.
 *
 * The rules, in order. Each stretch records the rule that decided it.
 *   1. The theme's first statement is heard over a floor of long bass tones
 *      and nothing else: `foundation`.
 *   2. A later statement of the theme. Where the Viola plucks the bass
 *      itself, the Cello rests — that is the lightest texture of the piece
 *      and a bowed bass would thicken it. Otherwise the Cello plucks the
 *      bass (if the instrument has a pizzicato of its own) or holds it.
 *   3. A restatement: the bass begins to move — `bass-line`.
 *   4. The drive to the phrase's goal, once the theme has been stated and
 *      restated above: the Cello takes thematic material itself, in its own
 *      register — the first time the theme's head as a fragment, later the
 *      whole theme. Where that cannot be asked (no room, no legato), the
 *      bass goes on moving.
 *   5. The ending: a Cello that was bowing arrives on the bass of the goal
 *      and holds it; a Cello that was silent or plucking stays out.
 *   Everywhere: with less than a seventh of room under the upper voices the
 *   Cello rests.
 */
import { CELLO, type CelloRole } from '../characters/cello';
import type { TonalFrame } from '../material/line';
import type { SegmentKind } from '../phrases/plan';
import { soundingPitch, type SoundingNote } from './counterpoint';
import type { EnsemblePlan } from './plan';

export type CelloThematic = 'fragment' | 'statement';

export interface FourthSpan {
  readonly index: number;
  readonly phrase: number;
  readonly startTick: number;
  readonly endTick: number;
  readonly mustEndBy: number;
  readonly role: CelloRole;
  /** For the role 'theme': the head alone, or the whole theme. */
  readonly thematic: CelloThematic | null;
  /** What the three upper voices do in this stretch. */
  readonly firstVoice: string;
  readonly secondVoice: string;
  readonly viola: string;
  /** What the Cello is asked to do, in words; the writer decides how. */
  readonly intention: string;
  /** The rule that asked for this role, and the facts it read. */
  readonly reason: string;
  /** Highest sounding pitch a bass role may use here; null when no upper voice sounds. */
  readonly ceiling: number | null;
  /** True when no Double Bass sounds in the stretch: the Cello is the floor of the harmony. */
  readonly isFloor: boolean;
}

export interface FourthPlan {
  readonly cello: { readonly trackId: string; readonly name: string };
  readonly spans: readonly FourthSpan[];
}

export interface FourthPlanInput {
  readonly frame: TonalFrame;
  readonly duo: EnsemblePlan;
  /** Per stretch of the two-violin plan: what the second voice and the Viola did. */
  readonly upper: readonly { readonly span: number; readonly secondPlayed: boolean; readonly violaRole: string; readonly violaPlayed: boolean; readonly violaIsFloor: boolean }[];
  readonly first: readonly SoundingNote[];
  readonly second: readonly SoundingNote[];
  readonly viola: readonly SoundingNote[];
  readonly cello: { readonly trackId: string; readonly name: string; readonly range: readonly [number, number] };
  readonly themeTicks: number;
  readonly headTicks: number;
  /** What the instrument can trigger with a keyswitch of its own. */
  readonly triggerable: readonly string[];
  readonly doubleBassSoundsIn: (from: number, to: number) => boolean;
}

export function planFourthVoice(input: FourthPlanInput): FourthPlan {
  const { frame, duo, cello } = input;
  const can = (role: Exclude<CelloRole, 'tacet'>): boolean => input.triggerable.includes(CELLO.articulation[role]);
  const inside = (line: readonly SoundingNote[], from: number, to: number): SoundingNote[] => line.filter((n) => n.tick < to && n.tick + n.duration > from);
  const spans: FourthSpan[] = [];
  let themeHeard = false;
  let thematicEntries = 0;
  let previous: CelloRole = 'tacet';
  let previousEnd = -1;
  let previousPhrase = -1;
  let statedInPhrase = 0;
  let thematicInPhrase = false;

  for (const s of duo.spans) {
    if (s.phrase !== previousPhrase) { previous = 'tacet'; previousPhrase = s.phrase; statedInPhrase = 0; thematicInPhrase = false; }
    const was: CelloRole = previousEnd === s.startTick ? previous : 'tacet';
    const up = input.upper.find((u) => u.span === s.index);
    const sounding = [...inside(input.first, s.startTick, s.endTick), ...inside(input.second, s.startTick, s.endTick), ...inside(input.viola, s.startTick, s.endTick)];
    const lowest = sounding.length ? Math.min(...sounding.map((n) => soundingPitch(frame, n))) : null;
    const ceiling = lowest === null ? null : Math.min(CELLO.bassCeiling, lowest - CELLO.clearance);
    const room = ceiling === null ? CELLO.bassCeiling - cello.range[0] : ceiling - cello.range[0];
    const kinds: readonly SegmentKind[] = s.primaryActivity;
    const isFloor = !input.doubleBassSoundsIn(s.startTick, s.endTick);
    const violaPlucks = !!up?.violaPlayed && up.violaRole === 'pulse';
    const secondVoice = up?.secondPlayed ? `${duo.companion.name}: ${s.relationship}` : `${duo.companion.name} is silent`;
    const viola = !up?.violaPlayed ? 'the Viola is silent' : `the Viola: ${up.violaRole}${up.violaIsFloor ? ', carrying the bass' : ''}`;
    const noRoom = `only ${room} semitones lie between the Cello's lowest note and ${CELLO.clearance} semitones under the lowest note above; a part needs ${CELLO.minRoom}`;
    const floorText = isFloor ? 'no Double Bass sounds: the Cello is the floor of the harmony' : 'the Double Bass sounds underneath: the Cello is free of the bass note';
    const length = s.endTick - s.startTick;

    let role: CelloRole = 'tacet';
    let thematic: CelloThematic | null = null;
    let intention = 'silence';
    let reason = '';
    if (kinds.includes('statement')) {
      if (!themeHeard) {
        if (!can('foundation')) reason = 'rule 1 — the instrument has no legato keyswitch of its own: declined';
        else if (room < CELLO.minRoom) reason = `rule 1 — ${noRoom}`;
        else {
          role = 'foundation';
          intention = 'long bass tones under the theme, led by step where the harmony allows; nothing that moves against it';
          reason = `rule 1 — the theme is heard for the first time: it is given a floor and nothing else (${floorText})`;
        }
      } else if (violaPlucks && up!.violaIsFloor) {
        reason = 'rule 2 — the Viola plucks the bass under a theme that is already known: the lightest texture of the piece; a bowed bass would thicken it, so the Cello rests';
      } else if (room < CELLO.minRoom) {
        reason = `rule 2 — ${noRoom}`;
      } else if (can('plucked-bass') && !violaPlucks) {
        role = 'plucked-bass';
        intention = 'the bass, plucked and sparse, under a theme that is already known';
        reason = `rule 2 — the theme is known and nobody plucks: the Cello marks the bass in a different colour from the bowed melody (${floorText})`;
      } else if (can('foundation')) {
        role = 'foundation';
        intention = 'long bass tones under the theme';
        reason = `rule 2 — ${violaPlucks ? 'the Viola already plucks above' : 'the instrument has no pizzicato keyswitch of its own'}: the Cello holds the bass with the bow (${floorText})`;
      } else {
        reason = 'rule 2 — neither a pizzicato nor a legato keyswitch of its own: declined';
      }
      themeHeard = true;
      statedInPhrase++;
    } else if (kinds.includes('restatement')) {
      statedInPhrase++;
      if (!can('bass-line')) reason = 'rule 3 — the instrument has no legato keyswitch of its own: declined';
      else if (room < CELLO.minRoom) reason = `rule 3 — ${noRoom}`;
      else {
        role = 'bass-line';
        intention = 'a bass that moves in its own rhythm: the downbeats stand, the rest of the bar walks or runs towards the next';
        reason = `rule 3 — the theme is restated${up?.secondPlayed ? ' with a second melodic voice' : ''}${violaPlucks ? ' and the Viola plucks above' : ''}: the bass ${was === 'tacet' ? 'enters, moving' : 'begins to move'} (${floorText})`;
      }
    } else if (kinds.includes('development') || kinds.includes('approach')) {
      const continuing = was === 'theme' || (was === 'bass-line' && thematicInPhrase);
      if (!can('bass-line')) reason = 'rule 4 — the instrument has no legato keyswitch of its own: declined';
      else if (!continuing && statedInPhrase >= 2 && length >= input.headTicks) {
        role = 'theme';
        thematic = thematicEntries === 0 || length < input.themeTicks ? 'fragment' : 'statement';
        intention = thematic === 'fragment'
          ? 'the theme\'s head — its opening leap and the descent that answers it — in the Cello\'s own register, then on as a bass'
          : 'the whole theme in the Cello, then on as a bass towards the goal';
        reason = `rule 4 — the theme has been stated and restated above; on the way to the phrase's goal the Cello takes it up itself (${thematicEntries === 0 ? 'its first thematic entry: the head only' : length < input.themeTicks ? 'the stretch is shorter than the theme: the head only' : 'it has had the head before: now the whole theme'})`;
        thematicEntries++;
        thematicInPhrase = true;
      } else if (room < CELLO.minRoom) reason = `rule 4 — ${noRoom}`;
      else {
        role = 'bass-line';
        intention = 'a moving bass towards the phrase\'s goal';
        reason = `rule 4 — ${continuing ? 'the Cello has had its thematic entry in this phrase' : 'the theme has not been stated twice in this phrase'}: the bass moves on (${floorText})`;
      }
    } else if (kinds.includes('ending')) {
      if (was === 'bass-line' || was === 'theme' || was === 'foundation' || was === 'arrival') {
        if (can('arrival') && room >= 0) {
          role = 'arrival';
          intention = was === 'arrival' ? 'the arrival note goes on sounding' : 'the bass of the goal chord, reached together with the first voice and held';
          reason = `rule 5 — the Cello was bowing towards this goal and arrives with the first voice (${floorText})`;
        } else reason = 'rule 5 — no sustained stroke of its own, or no room under the arrival: the line stops before it';
      } else reason = `rule 5 — the Cello was ${was === 'plucked-bass' ? 'plucking' : 'silent'} before the ending: it does not enter for the last note`;
    } else {
      reason = 'no rule applies to this stretch';
    }

    spans.push({ index: s.index, phrase: s.phrase, startTick: s.startTick, endTick: s.endTick, mustEndBy: s.mustEndBy, role, thematic, firstVoice: s.primaryDescription, secondVoice, viola, intention, reason, ceiling, isFloor });
    previous = role;
    previousEnd = s.endTick;
  }
  return { cello: { trackId: cello.trackId, name: cello.name }, spans };
}
