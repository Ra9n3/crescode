/**
 * MIDI voicing for the Smart Chord overlay (feature spec: "MIDI Generation").
 *
 * Turns a chord symbol into exact MIDI note values under the spec's rules:
 *
 *  - The DEFAULT octave is centered near C4 (MIDI 60). "Centered" is defined
 *    deterministically: among every octave the bass note may start in, the
 *    voicing whose stack MEDIAN sits closest to the anchor wins (ties go to
 *    the lower bass octave). A user-supplied octaveOffset shifts the anchor
 *    in whole octaves — that is the "unless the user specifies otherwise"
 *    escape hatch, and it also lifts the MIDI 36–84 guard.
 *  - CLOSE voicing by default: after the bass, chord tones stack upward by
 *    shortest interval from the bass, so every inversion and slash bass
 *    voices correctly (C/E → E3 G3 C4, not a root-position shape).
 *  - The bass note is the stack's first tone — at or below every upper tone
 *    by construction.
 *  - Notes below MIDI 36 (C2) or above MIDI 84 (C6) are avoided whenever the
 *    octave is the default; an explicit octaveOffset may leave that window.
 *  - Duplicate pitch classes cannot occur: the shared parser already emits
 *    one entry per pitch class, and each is placed exactly once.
 *  - The selected inversion or slash bass is respected: it IS the bass.
 *  - The chord's spelling is preserved: the bass note keeps the chord's own
 *    normalized spelling (normalizeChord output carried in rootName /
 *    bassName); remaining tones use crescode's mixed canon.
 *  - Clip start time and duration are NEVER decided here — callers pass the
 *    clip bounds to voicingToPitches, and nothing else about the clip is
 *    touched.
 *
 * Pure and deterministic: same symbol + options → same notes, always.
 */
import { parseChord, type PitchClass } from '../../shared/schema';
import { spelledNoteName } from './model';
import { SuggestionError, type NoteName, type Pitch } from './types';

/** Velocity for applied chord notes (matches the Smart clip placeholder). */
export const VOICE_VELOCITY = 100;
/** Spec range guard: avoid notes below C2 (36) or above C6 (84). */
export const VOICE_LOW = 36;
export const VOICE_HIGH = 84;
/** Default anchor: C4. */
export const VOICE_ANCHOR = 60;

/** Octave offsets are clamped to ±2 — beyond that the "centered near C4"
 *  idea stops meaning anything. */
const MAX_OFFSET = 2;

export interface VoicedNote {
  midi: number;
  spelling: NoteName;
  octave: number;
}

export type VoicingResult =
  | { ok: true; chordName: string; bassNote: NoteName; notes: VoicedNote[] }
  | { ok: false; error: string };

export interface VoicingOptions {
  /** Whole octaves to shift the C4 anchor (user-specified octave). */
  octaveOffset?: number;
}

const mod12 = (v: number): number => ((v % 12) + 12) % 12;

/** Median of an ascending-only list (average of the two middles when even). */
function medianOf(sorted: readonly number[]): number {
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The exact MIDI voicing of one chord symbol (spec §3 "MIDI Generation").
 * Every rule of the spec is enforced here; see the module doc.
 */
export function voiceChordSymbol(symbol: string, options: VoicingOptions = {}): VoicingResult {
  const parsed = parseChord(symbol);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const c = parsed.chord;

  const raw = options.octaveOffset;
  const offset =
    typeof raw === 'number' && Number.isFinite(raw)
      ? Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, Math.round(raw)))
      : 0;
  const anchor = VOICE_ANCHOR + 12 * offset;
  const enforceRange = offset === 0; // "unless explicitly requested"

  // Shared grammar invariant: pitchClasses[0] is the slash bass (or the root),
  // the rest are the root-stacked tones — deduped, one per pitch class.
  const bassPc = c.pitchClasses[0]!;
  const uppers = c.pitchClasses
    .slice(1)
    .map((pc) => ({ pc, iv: mod12(pc - bassPc) }))
    .sort((a, b) => a.iv - b.iv); // close voicing: shortest interval from the bass first

  /** Ascending close stack starting from the given bass midi. */
  const stackFor = (bass: number): number[] => {
    const out = [bass];
    let prev = bass;
    for (const { pc } of uppers) {
      prev = prev + 1 + mod12(pc - prev - 1); // smallest midi > prev with that pitch class
      out.push(prev);
    }
    return out;
  };

  // Try every octave the bass note can start on; the winner centers the
  // stack's median on the anchor. Strict `<` keeps the LOWER bass on ties.
  let best: { bass: number; stack: number[]; dist: number } | null = null;
  let fallback: { bass: number; stack: number[]; dist: number } | null = null;
  for (let bass = bassPc; bass <= 127; bass += 12) {
    const stack = stackFor(bass);
    if (stack[stack.length - 1]! > 127) break;
    const dist = Math.abs(medianOf(stack) - anchor);
    const entry = { bass, stack, dist };
    if (fallback === null || dist < fallback.dist) fallback = entry;
    if (!enforceRange) continue;
    if (stack[0]! >= VOICE_LOW && stack[stack.length - 1]! <= VOICE_HIGH) {
      if (best === null || dist < best.dist) best = entry;
    }
  }
  const chosen = best ?? fallback;
  if (chosen === null) return { ok: false, error: `"${symbol}": no playable voicing in MIDI 0–127` };

  const notes: VoicedNote[] = chosen.stack.map((midi, i) => {
    const pc = i === 0 ? bassPc : uppers[i - 1]!.pc;
    return {
      midi,
      // Bass keeps the chord's own spelling (normalizeChord output);
      // upper tones use crescode's canonical mixed spellings.
      spelling: i === 0 ? ((c.bassName ?? c.rootName) as NoteName) : spelledNoteName(pc),
      octave: Math.floor(midi / 12) - 1,
    };
  });

  return {
    ok: true,
    chordName: c.symbol,
    bassNote: notes[0]!.spelling,
    notes,
  };
}

/** Bridge to the adapter's write contract: places the voicing inside a clip
 *  window. Start/duration always come from the CLIP — never decided here. */
export function voicingToPitches(
  voicing: VoicingResult & { ok: true },
  startTick: number,
  durationTicks: number,
  velocity = VOICE_VELOCITY,
): Pitch[] {
  if (!Number.isInteger(startTick) || startTick < 0 || !Number.isInteger(durationTicks) || durationTicks < 1) {
    throw new SuggestionError('invalid-range', `voicingToPitches: clip bounds must be ticks (got [${startTick}, +${durationTicks}])`);
  }
  return voicing.notes.map((n) => ({
    midi: n.midi,
    pitchClass: mod12(n.midi) as PitchClass,
    spelling: n.spelling,
    octave: n.octave,
    velocity,
    startTick,
    durationTicks,
  })) as Pitch[];
}

/** "E3 · G3 · C4" — the live-preview note list. */
export function voicingLabel(notes: readonly VoicedNote[]): string {
  return notes.map((n) => `${n.spelling}${n.octave}`).join(' · ');
}
