/**
 * Voice characters (Strings V1, Stage 2) — where each string instrument
 * carries a singing line best, and what it sounds like there.
 *
 * The SINGING REGISTER is narrower than the comfortable writing window in
 * `profiles/strings.ts` (which is read, never copied): it is the stretch in
 * which the instrument projects a lyrical line without strain or thinness.
 * These are orchestration judgements, stated once here; nothing has been
 * calibrated by listening yet.
 */
export interface VoiceCharacter {
  /** Track role in the roster. */
  readonly role: string;
  readonly name: string;
  /** Sounding MIDI range in which a lyrical line carries best. */
  readonly singing: readonly [number, number];
  readonly character: string;
}

export const VOICE_CHARACTERS: readonly VoiceCharacter[] = [
  { role: 'violins1', name: 'Violin I', singing: [67, 91], character: 'bright and carrying; at its best above the staff' },
  { role: 'violins2', name: 'Violin II', singing: [60, 84], character: 'warm, in the middle of the violin; close to a singing voice' },
  { role: 'violas', name: 'Viola', singing: [53, 76], character: 'dark and veiled; an inner voice that speaks rather than shines' },
  { role: 'cellosBasses', name: 'Cello', singing: [48, 72], character: 'tenor, full and vocal on the upper strings' },
];

export const VOICE_CHARACTER_BY_ROLE: ReadonlyMap<string, VoiceCharacter> = new Map(VOICE_CHARACTERS.map((v) => [v.role, v]));
