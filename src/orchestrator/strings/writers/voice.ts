/**
 * The voice writer (Strings V1, Stage 2) — turns planned phrases into the
 * notes one instrument plays. It decides, and nothing else does:
 *
 *   register      one octave for the whole voice (handed in by the
 *                 selection, which measured it against the instrument);
 *   connection    notes inside a gesture are slurred (legato): each sounds
 *                 until the next begins;
 *   silence       after a statement the bow lifts: the last note is cut
 *                 short and a rest is written; after the ending the voice
 *                 is silent until its next phrase;
 *   weight        loudness follows the bar's place in the song's energy and
 *                 the note's place in the phrase (toward the high point and
 *                 away from it);
 *   leaning       an accented dissonance is leaned on and its resolution
 *                 released — the pair is shaped as one gesture;
 *   ending        the held last note is the softest of its phrase.
 *
 * Only articulations the export can trigger for the chosen instrument are
 * written. Deterministic: no random draw is made here.
 */
import type { Articulation, Note } from '../../../shared/schema/types';
import { semitonesOf, type TonalFrame } from '../material/line';
import type { PhraseNote, PhrasePlan } from '../phrases/plan';

export interface VoiceInput {
  readonly frame: TonalFrame;
  readonly phrases: readonly PhrasePlan[];
  /** Octaves above/below the octave-4 tonic position. */
  readonly octave: number;
  /** Energy 0..1 per bar (index bar − 1). */
  readonly energyByBar: readonly number[];
  readonly triggerable: readonly string[];
}

export interface WrittenNote {
  readonly note: Note;
  readonly phrase: number;
  readonly source: PhraseNote;
  /** What the writer did to this note, in words. */
  readonly shaping: readonly string[];
}

export interface VoiceResult {
  readonly notes: readonly WrittenNote[];
  readonly gestures: readonly string[];
  readonly articulations: Readonly<Record<string, number>>;
}

/** Loudness limits of the voice (MIDI velocity): a singing line, never forced. */
export const VOICE_VELOCITY: readonly [number, number] = [38, 100];
const LEAN = 6;
const RELEASE = 5;

export const pitchAtOctave0 = (frame: TonalFrame, note: Pick<PhraseNote, 'step' | 'alter'>): number => 60 + frame.key + semitonesOf(frame, note);

export function writeVoice(input: VoiceInput): VoiceResult {
  const { frame } = input;
  const connected: Articulation = input.triggerable.includes('legato') ? 'legato' : 'sustain';
  const out: WrittenNote[] = [];
  let leans = 0;
  let breaths = 0;
  for (const phrase of input.phrases) {
    phrase.notes.forEach((source, i) => {
      const shaping: string[] = [];
      const bar = Math.floor(source.tick / frame.barTicks);
      const energy = Math.max(0, Math.min(1, input.energyByBar[bar] ?? 0.5));
      // the bar's level in the song, then the note's place in the phrase
      let velocity = 46 + 34 * energy + 16 * (source.intensity - 0.6);
      const previous = phrase.notes[i - 1];
      if (source.function === 'appoggiatura' || source.function === 'suspension') {
        velocity += LEAN;
        shaping.push('leaned on (accented dissonance)');
        leans++;
      } else if (previous && (previous.function === 'appoggiatura' || previous.function === 'suspension') && !previous.breathAfter) {
        velocity -= RELEASE;
        shaping.push('released (resolution)');
      }
      let duration = source.duration;
      if (source.segment === 'ending') {
        velocity -= 6;
        shaping.push('held and let go');
      } else if (source.breathAfter) {
        // the bow lifts: half a beat of silence after a long note, a quarter of a shorter one
        const lift = source.duration >= 2 * frame.beatTicks ? frame.beatTicks / 2 : Math.round(source.duration / 4);
        duration = source.duration - lift;
        shaping.push(`bow lifts ${lift} ticks early`);
        breaths++;
      } else if (phrase.notes[i + 1]) {
        shaping.push('slurred into the next note');
      }
      out.push({
        note: {
          pitch: pitchAtOctave0(frame, source) + 12 * input.octave,
          startTick: source.tick,
          durationTicks: duration,
          velocity: Math.max(VOICE_VELOCITY[0], Math.min(VOICE_VELOCITY[1], Math.round(velocity))),
          articulation: connected,
        },
        phrase: phrase.index,
        source,
        shaping,
      });
    });
  }
  const articulations: Record<string, number> = {};
  for (const w of out) articulations[w.note.articulation ?? 'none'] = (articulations[w.note.articulation ?? 'none'] ?? 0) + 1;
  const gestures = [
    `one connected sound (${connected}) inside every gesture: each note sounds until the next begins`,
    `${breaths} written breath${breaths === 1 ? '' : 's'}: the bow lifts after a statement before the line goes on`,
    `${leans} leaning note${leans === 1 ? '' : 's'}: an accented dissonance is played ${LEAN} louder and its resolution ${RELEASE} softer`,
    'loudness rises to each phrase\'s high point and falls to its held last note',
    'silence between phrases: the voice does not fill the bars after an ending',
  ];
  return { notes: out, gestures, articulations };
}
