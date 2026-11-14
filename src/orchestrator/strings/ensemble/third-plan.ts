/**
 * The plan for a third voice (Strings V1, Stage 4) — what the Viola is asked
 * to do in every stretch, decided BEFORE any Viola note exists.
 *
 * It reads the two violins as they stand: the first voice's phrases, the
 * relationship planned for the second voice in every stretch, and what the
 * second voice actually wrote there (whether it played, on which side, how
 * low it went). The violins are finished; this plan never changes them.
 *
 * The rules, in order. Each stretch records the rule that decided it.
 *   1. The theme's first statement is heard alone: tacet.
 *   2. A later statement of the theme is known material: the Viola may
 *      accompany it with a plucked figure (a different colour from the bowed
 *      melody) — if the instrument has a pizzicato of its own.
 *   3. A restatement with the second voice moving below the theme, inside
 *      the Viola's own register: tacet. The inner register is taken; a third
 *      moving line there would crowd it. With the second voice above, the
 *      plucked figure goes on (or begins).
 *   4. The drive to the phrase's goal: where the second voice is silent or
 *      only holds, the Viola is the voice that moves — a bowed line of its
 *      own under the theme. Where there is no room under the violins: tacet.
 *   5. The ending: a Viola that was moving arrives with the first voice and
 *      holds under whatever follows; a Viola that was silent or plucking
 *      stays out of it. An answer the second voice declined may be taken by
 *      the Viola instead.
 */
import { VIOLA, type ViolaRole } from '../characters/viola';
import type { TonalFrame } from '../material/line';
import type { SegmentKind } from '../phrases/plan';
import { soundingPitch, type SoundingNote } from './counterpoint';
import type { EnsemblePlan, Relationship } from './plan';

export interface ThirdSpan {
  readonly index: number;
  readonly phrase: number;
  readonly startTick: number;
  readonly endTick: number;
  readonly mustEndBy: number;
  readonly role: ViolaRole;
  /** What the two violins do in this stretch. */
  readonly firstVoice: string;
  readonly secondVoice: string;
  /** What the Viola is asked to do, in words; the writer decides how. */
  readonly intention: string;
  /** The rule that asked for this role, and the facts it read. */
  readonly reason: string;
  /** Highest sounding pitch the Viola may use here (below the violins), and the room that leaves. Null when no violin sounds. */
  readonly ceiling: number | null;
  /** True when no lower string (the classic Cello) sounds in the stretch: the Viola is the lowest string voice. */
  readonly lowestString: boolean;
}

export interface ThirdPlan {
  readonly viola: { readonly trackId: string; readonly name: string };
  readonly spans: readonly ThirdSpan[];
}

export interface ThirdPlanInput {
  readonly frame: TonalFrame;
  readonly duo: EnsemblePlan;
  /** Per stretch of the two-violin plan: what the second voice did. */
  readonly secondVoice: readonly { readonly span: number; readonly relationship: Relationship; readonly played: boolean; readonly side: 'above' | 'below' | null }[];
  readonly first: readonly SoundingNote[];
  readonly second: readonly SoundingNote[];
  readonly viola: { readonly trackId: string; readonly name: string; readonly range: readonly [number, number]; readonly singing: readonly [number, number] };
  /** What the instrument can trigger with a keyswitch of its own. */
  readonly triggerable: readonly string[];
  /** Does a lower string sound between two ticks? */
  readonly lowerStringsSoundIn: (from: number, to: number) => boolean;
}

export function planThirdVoice(input: ThirdPlanInput): ThirdPlan {
  const { frame, duo, viola } = input;
  const can = (role: Exclude<ViolaRole, 'tacet'>): boolean => input.triggerable.includes(VIOLA.articulation[role]);
  const inside = (line: readonly SoundingNote[], from: number, to: number): SoundingNote[] => line.filter((n) => n.tick < to && n.tick + n.duration > from);
  const spans: ThirdSpan[] = [];
  let themeHeard = false;
  let previous: ViolaRole = 'tacet';
  let previousEnd = -1;
  let previousPhrase = -1;

  for (const s of duo.spans) {
    if (s.phrase !== previousPhrase) { previous = 'tacet'; previousPhrase = s.phrase; }
    const adjacent = previousEnd === s.startTick;
    const was: ViolaRole = adjacent ? previous : 'tacet';
    const second = input.secondVoice.find((w) => w.span === s.index);
    const secondNotes = inside(input.second, s.startTick, s.endTick);
    const firstNotes = inside(input.first, s.startTick, s.endTick);
    const pitches = [...firstNotes, ...secondNotes].map((n) => soundingPitch(frame, n));
    const ceiling = pitches.length ? Math.min(viola.range[1], Math.min(...pitches) - VIOLA.clearance) : null;
    const room = ceiling === null ? viola.range[1] - viola.range[0] : ceiling - viola.range[0];
    const kinds: readonly SegmentKind[] = s.primaryActivity;
    const secondPlays = !!second?.played && secondNotes.length > 0;
    const secondLow = secondPlays && second!.side === 'below' && secondNotes.some((n) => soundingPitch(frame, n) <= viola.singing[1]);
    const lowestString = !input.lowerStringsSoundIn(s.startTick, s.endTick);
    const secondVoice = !secondPlays ? `${duo.companion.name} is silent`
      : `${duo.companion.name}: ${s.relationship}, ${second!.side} the first voice`;
    const noRoom = `only ${room} semitones lie between the Viola's floor and ${VIOLA.clearance} semitones under the lowest violin note; a part needs ${VIOLA.minRoom}`;

    let role: ViolaRole = 'tacet';
    let intention = 'silence';
    let reason = '';
    if (kinds.includes('statement')) {
      if (!themeHeard && s.relationship === 'listening') {
        reason = 'rule 1 — the theme is heard for the first time: nothing is set against it';
      } else if (!can('pulse')) {
        reason = 'rule 2 — a plucked figure would suit a known theme, but the instrument has no pizzicato keyswitch of its own: declined rather than approximated with the bow';
      } else if (room < VIOLA.minRoom) {
        reason = `rule 2 — ${noRoom}`;
      } else {
        role = 'pulse';
        intention = 'a plucked broken-chord figure under the theme, attacking where the violins do not';
        reason = `rule 2 — the theme is known; ${secondPlays ? 'the second voice imitates it above' : 'the second voice waits'}: the Viola accompanies in a different colour${lowestString ? ' and, with no lower string sounding, grounds the harmony' : ''}`;
      }
      themeHeard = true;
    } else if (kinds.includes('restatement')) {
      if (secondLow) {
        reason = 'rule 3 — the second voice has a moving line below the theme, in the Viola\'s own register: a third line there would crowd it';
      } else if (!can('pulse')) {
        reason = 'rule 3 — the instrument has no pizzicato keyswitch of its own: declined';
      } else if (room < VIOLA.minRoom) {
        reason = `rule 3 — ${noRoom}`;
      } else {
        role = 'pulse';
        intention = 'a plucked broken-chord figure under the two melodic voices';
        reason = `rule 3 — ${secondPlays ? 'two melodic voices sound above' : 'the theme is restated alone'}: a third melody would be one too many, a plucked figure ${was === 'pulse' ? 'goes on' : 'gives them a floor'}`;
      }
    } else if (kinds.includes('development') || kinds.includes('approach')) {
      const holding = secondPlays && s.relationship === 'support';
      if (secondPlays && !holding) {
        reason = `rule 4 — the second voice is already moving against the first (${s.relationship})`;
      } else if (!can('inner-line')) {
        reason = 'rule 4 — the instrument has no legato keyswitch of its own: declined';
      } else if (room < VIOLA.minRoom) {
        reason = `rule 4 — ${noRoom}`;
      } else {
        role = 'inner-line';
        intention = 'a bowed line of its own under the theme: moving where the violins hold, in its own rhythm, not shadowing either';
        reason = `rule 4 — ${holding ? 'the second voice only holds: the Viola is the voice that moves' : 'the second voice is silent: the Viola is the only other voice'} on the way to the phrase's goal`;
      }
    } else if (kinds.includes('ending')) {
      if (was === 'inner-line' || was === 'arrival') {
        if (can('arrival') && room >= 0) {
          role = 'arrival';
          intention = was === 'arrival' ? 'the arrival note goes on sounding' : 'land on a chord tone together with the first voice and hold it';
          reason = `rule 5 — the Viola was moving towards this goal and arrives with the first voice${secondPlays && s.relationship === 'response' ? '; it holds under the answer' : ''}`;
        } else {
          reason = 'rule 5 — no sustained stroke of its own, or no room under the arrival: the line stops before it';
        }
      } else if (s.relationship === 'response' && !secondPlays && can('reply') && s.endTick - s.startTick >= 2 * frame.beatTicks) {
        role = 'reply';
        intention = 'answer the phrase with the theme\'s closing gesture, in the foreground';
        reason = 'rule 5 — the phrase ends open and the second voice did not answer it: the Viola takes the answer';
      } else {
        reason = `rule 5 — the Viola was ${was === 'pulse' ? 'plucking' : 'silent'} before the ending: it does not enter for the last note`;
      }
    } else {
      reason = 'no rule applies to this stretch';
    }

    spans.push({
      index: s.index, phrase: s.phrase, startTick: s.startTick, endTick: s.endTick, mustEndBy: s.mustEndBy, role,
      firstVoice: s.primaryDescription, secondVoice, intention, reason, ceiling, lowestString,
    });
    previous = role;
    previousEnd = s.endTick;
  }
  return { viola: { trackId: viola.trackId, name: viola.name }, spans };
}
