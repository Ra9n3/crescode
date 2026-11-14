/**
 * Ensemble planning for two voices (Strings V1, Stage 3) — what the second
 * voice is FOR, stretch by stretch, decided before any of its notes exist.
 *
 * The plan is read from the first voice's own plan (its phrases, segments,
 * goal and ending) and from nothing else. For every stretch it states a
 * RELATIONSHIP between the two voices, who is in the foreground, and the
 * reason. The second voice's writer then makes its own decisions inside
 * each stretch — which material, where exactly to enter, which register,
 * or not to play after all.
 *
 * The relationships (only those a rule below asks for appear in a plan):
 *
 *   listening      the second voice is silent and the first is heard alone;
 *   imitation      the second voice enters late with the theme's head while
 *                  the first is already in the theme's tail;
 *   countermelody  an independent line against a theme that is already
 *                  known: slower, moving where the theme holds;
 *   support        a few held chord tones away from the first voice, while
 *                  it drives to its high point;
 *   response       the second voice answers after the first has arrived,
 *                  and is in the foreground for that moment.
 *
 * The rules, in the order they are read for each segment of a phrase:
 *
 *   1. The first statement of the theme in the piece is heard alone.
 *   2. A later statement: the second voice waits for the theme's head, then
 *      imitates it over the tail (a delayed entrance).
 *   3. A restatement: a countermelody.
 *   4. The drive to the goal (development and approach): if the phrase ends
 *      open and leaves room for an answer, the second voice withdraws so
 *      that its answer is an entrance; otherwise it supports.
 *   5. The ending: an open ending with room is answered (a response that
 *      begins once the arrival has sounded for a beat); otherwise a second
 *      voice that was supporting stays to close with the first, and one
 *      that was silent stays silent.
 *
 * Nothing here fixes which instrument is the first voice: the plan speaks
 * of 'primary' and 'companion' and is given their tracks by the caller.
 */
import type { TonalFrame } from '../material/line';
import type { Theme } from '../material/theme';
import type { PhrasePlan, SegmentKind } from '../phrases/plan';

export type Relationship = 'listening' | 'imitation' | 'countermelody' | 'support' | 'response';

export interface RelationshipSpan {
  readonly index: number;
  readonly phrase: number;
  readonly startTick: number;
  readonly endTick: number;
  readonly relationship: Relationship;
  /** Who is in the foreground during this stretch. */
  readonly foreground: 'primary' | 'companion';
  /** What the first voice does here (the segment kinds this stretch covers). */
  readonly primaryActivity: readonly SegmentKind[];
  readonly primaryDescription: string;
  /** What the second voice is asked to do, in words; the writer decides how. */
  readonly intention: string;
  /** The rule that asked for this relationship, and the facts it read. */
  readonly reason: string;
  /** The second voice must be silent again by this tick (a breath, a window's end). */
  readonly mustEndBy: number;
  /** True when the second voice was silent in the stretch before: whatever it plays here is an entrance. */
  readonly entrance: boolean;
  /** True when this stretch closes the phrase together with the first voice. */
  readonly closesPhrase: boolean;
}

export interface EnsemblePlan {
  readonly primary: { readonly trackId: string; readonly name: string };
  readonly companion: { readonly trackId: string; readonly name: string };
  readonly spans: readonly RelationshipSpan[];
  /** Per phrase: whether an answer was possible and why. */
  readonly phraseNotes: readonly string[];
}

export interface EnsemblePlanInput {
  readonly frame: TonalFrame;
  readonly theme: Theme;
  readonly phrases: readonly PhrasePlan[];
  readonly primary: { readonly trackId: string; readonly name: string };
  readonly companion: { readonly trackId: string; readonly name: string };
}

/** The shortest answer: the theme's opening through the note after its leap, the last note at least a beat long. */
export function shortestResponseTicks(frame: TonalFrame, theme: Theme): number {
  const head = theme.notes.slice(0, theme.headCount);
  const upTo = Math.min(head.length - 1, theme.identity.leap.fromIndex + 2);
  return head[upTo].tick + frame.beatTicks;
}

export function planEnsemble(input: EnsemblePlanInput): EnsemblePlan {
  const { frame, theme, phrases } = input;
  const beat = frame.beatTicks;
  const headTicks = theme.headCount < theme.notes.length ? theme.notes[theme.headCount].tick : theme.lengthTicks;
  const spans: RelationshipSpan[] = [];
  const phraseNotes: string[] = [];
  let themeHeard = false;
  const barOf = (tick: number): string => {
    const bar = Math.floor(tick / frame.barTicks) + 1;
    const inBar = (tick % frame.barTicks) / beat + 1;
    return inBar === 1 ? `bar ${bar}` : `bar ${bar} beat ${Math.round(inBar * 100) / 100}`;
  };

  phrases.forEach((phrase, order) => {
    const next = phrases[order + 1];
    const limit = Math.min(phrase.window.endTick, next ? next.startTick : Number.POSITIVE_INFINITY);
    const ending = phrase.segments.find((s) => s.kind === 'ending');
    const responseStart = ending ? ending.startTick + beat : phrase.endTick;
    const room = limit - responseStart;
    const needed = shortestResponseTicks(frame, theme);
    const open = phrase.goal.ending === 'open';
    const answered = !!ending && open && room >= needed;
    phraseNotes.push(
      `phrase ${order + 1}: ${open ? 'ends open' : 'ends closed'} on ${phrase.goal.chord} at ${barOf(phrase.goal.tick)}; `
      + `${room / beat} beat(s) lie between one beat after the arrival and ${next && next.startTick <= phrase.window.endTick ? 'the next phrase' : 'the end of the stretch the strings may sound in'}; `
      + (answered ? `an answer needs ${needed / beat}: the ending is answered`
        : !open ? 'a closed ending is complete and is not answered'
          : `an answer needs ${needed / beat}: there is no room for one`),
    );

    let previousSilent = true;
    let supporting = false;
    const push = (span: Omit<RelationshipSpan, 'index' | 'phrase' | 'entrance'>): void => {
      if (span.endTick <= span.startTick) return;
      const silent = span.relationship === 'listening';
      spans.push({ ...span, index: spans.length, phrase: phrase.index, entrance: !silent && previousSilent });
      previousSilent = silent;
    };
    const describe = (kinds: readonly SegmentKind[], text: string): string => `${kinds.join(' + ')}: ${text}`;

    for (let i = 0; i < phrase.segments.length; i++) {
      const segment = phrase.segments[i];
      if (segment.kind === 'statement') {
        if (!themeHeard) {
          themeHeard = true;
          push({
            startTick: segment.startTick, endTick: segment.endTick, relationship: 'listening', foreground: 'primary',
            primaryActivity: ['statement'], primaryDescription: describe(['statement'], segment.description),
            intention: 'silence: nothing is set against the theme', mustEndBy: segment.endTick, closesPhrase: false,
            reason: 'rule 1 — this is the first time the theme is heard in the piece',
          });
        } else {
          const split = Math.min(segment.endTick, segment.startTick + (segment.thematicHeadTicks ?? headTicks));
          push({
            startTick: segment.startTick, endTick: split, relationship: 'listening', foreground: 'primary',
            primaryActivity: ['statement'], primaryDescription: describe(['statement'], `${segment.description} — the head`),
            intention: 'silence while the head is stated: the entrance is delayed', mustEndBy: split, closesPhrase: false,
            reason: 'rule 2 — the theme is known; the second voice waits for its head before answering it',
          });
          push({
            startTick: split, endTick: segment.endTick, relationship: 'imitation', foreground: 'primary',
            primaryActivity: ['statement'], primaryDescription: describe(['statement'], `${segment.description} — the tail`),
            intention: 'enter with the theme\'s head, one head-length after the first voice, against its tail', mustEndBy: segment.endTick, closesPhrase: false,
            reason: `rule 2 — the first voice is in the theme's tail from ${barOf(split)}; the head can be heard again against it`,
          });
        }
      } else if (segment.kind === 'restatement') {
        push({
          startTick: segment.startTick, endTick: segment.endTick, relationship: 'countermelody', foreground: 'primary',
          primaryActivity: ['restatement'], primaryDescription: describe(['restatement'], segment.description),
          intention: 'an independent line against the theme: slower than it, moving where it holds, derived from the theme\'s own shape', mustEndBy: segment.endTick, closesPhrase: false,
          reason: 'rule 3 — the theme is restated and already known: a second line can be set against it without hiding it',
        });
      } else if (segment.kind === 'development' || segment.kind === 'approach') {
        // the whole drive to the goal is one stretch
        let last = i;
        while (phrase.segments[last + 1] && (phrase.segments[last + 1].kind === 'development' || phrase.segments[last + 1].kind === 'approach')) last++;
        const kinds = [...new Set(phrase.segments.slice(i, last + 1).map((s) => s.kind))];
        const endTick = phrase.segments[last].endTick;
        const text = `${last - i + 1} segment(s) climbing to the high point at ${barOf(phrase.climax.tick)}`;
        if (answered) {
          push({
            startTick: segment.startTick, endTick, relationship: 'listening', foreground: 'primary',
            primaryActivity: kinds, primaryDescription: describe(kinds, text),
            intention: 'silence: the first voice reaches its high point alone', mustEndBy: endTick, closesPhrase: false,
            reason: 'rule 4 — the phrase ends open with room for an answer: the second voice withdraws so that the answer is an entrance',
          });
        } else {
          supporting = true;
          push({
            startTick: segment.startTick, endTick, relationship: 'support', foreground: 'primary',
            primaryActivity: kinds, primaryDescription: describe(kinds, text),
            intention: 'a few held chord tones away from the first voice; no high point of its own', mustEndBy: endTick, closesPhrase: false,
            reason: `rule 4 — ${open ? 'the ending leaves no room for an answer' : 'the phrase closes and is not answered'}: the second voice stays and supports the drive to the goal`,
          });
        }
        i = last;
      } else if (segment.kind === 'ending') {
        if (answered) {
          push({
            startTick: segment.startTick, endTick: responseStart, relationship: 'listening', foreground: 'primary',
            primaryActivity: ['ending'], primaryDescription: describe(['ending'], `${segment.description} — the arrival`),
            intention: 'silence for one beat: the arrival is heard first', mustEndBy: responseStart, closesPhrase: false,
            reason: 'rule 5 — an answer follows the arrival, it does not cover it',
          });
          push({
            startTick: responseStart, endTick: limit, relationship: 'response', foreground: 'companion',
            primaryActivity: ['ending'], primaryDescription: describe(['ending'], `${segment.description} — held, then silent`),
            intention: 'answer the phrase with a fragment of the theme while the first voice holds its last note and rests', mustEndBy: limit, closesPhrase: true,
            reason: `rule 5 — the phrase ends open and ${room / beat} beat(s) are free after the arrival`,
          });
        } else if (supporting) {
          push({
            startTick: segment.startTick, endTick: segment.endTick, relationship: 'support', foreground: 'primary',
            primaryActivity: ['ending'], primaryDescription: describe(['ending'], segment.description),
            intention: 'one chord tone under or over the last note, released together with it', mustEndBy: segment.endTick, closesPhrase: true,
            reason: 'rule 5 — the second voice was supporting and closes the phrase with the first',
          });
        } else {
          push({
            startTick: segment.startTick, endTick: segment.endTick, relationship: 'listening', foreground: 'primary',
            primaryActivity: ['ending'], primaryDescription: describe(['ending'], segment.description),
            intention: 'silence: the first voice ends alone', mustEndBy: segment.endTick, closesPhrase: false,
            reason: 'rule 5 — no answer is possible and the second voice was already silent',
          });
        }
      }
    }
  });
  return { primary: input.primary, companion: input.companion, spans, phraseNotes };
}
