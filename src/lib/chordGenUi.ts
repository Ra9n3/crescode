/**
 * Chord-generation UI actions (spec §2, §8) — the isolated integration boundary
 * for the future harmony engine. The scope detection (lib/genScope.ts) decides
 * WHAT Generate would do; this module decides what clicking it DOES today.
 *
 * UI/UX phase contract:
 * - Clicking Generate never opens a prompt or configuration dialog.
 * - No placeholder chords are fabricated to fake functionality.
 * - The seed does NOT advance when generation cannot actually execute.
 * - When the engine is not connected, the click reports a subtle status
 *   message (a toast — the app's ambient status channel) and changes nothing.
 *
 * Connecting the engine later means replacing the `generateChords` stub below
 * with the real call; nothing in the UI layer needs to change.
 */
import type { Chord, Project } from '../shared/schema/types';
import { DEFAULT_CHORDGEN_SETTINGS } from '../shared/schema/types';
import { useStore } from '../store/store';
import { detectGenerationScope, scopeTooltip, type GenerationScope } from './genScope';

/** Integration seam: set to a real generator implementation when the engine lands.
 *  It receives the project, the detected scope and the current seed, and returns
 *  the replacement chord array (or null when it declines to run). */
export type ChordGenerator = (p: Project, scope: GenerationScope, seed: number) => Chord[] | null;
let generateChords: ChordGenerator | null = null;

/** Test/diagnostic hook: register or clear the generator implementation. */
export function __setChordGenerator(fn: ChordGenerator | null): void { generateChords = fn; }

/** 32-bit random seed for the Advanced-panel dice button (crypto when available). */
export function randomSeed(): number {
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } }).crypto;
  if (c?.getRandomValues) return c.getRandomValues(new Uint32Array(1))[0] >>> 0;
  return Math.floor(Math.random() * 0x100000000) >>> 0;
}

/** The Generate press. Repeated clicks are safe; state, not history, decides the scope. */
export function runChordGenerate(): void {
  const s = useStore.getState();
  const scope = detectGenerationScope(s.project, s.selectedSectionId);
  const seed = s.project.chordGenSettings?.seed ?? 1;

  if (generateChords) {
    const chords = generateChords(s.project, scope, seed);
    if (chords) {
      // One undoable step for the whole operation (spec §9), a fresh seed for the
      // next variation (spec §8), and a brief highlight for what changed (spec §4).
      const before = new Set(s.project.chords.map((c) => c.id));
      s.edit((p) => ({ ...p, chords, chordGenSettings: { ...DEFAULT_CHORDGEN_SETTINGS, ...(p.chordGenSettings ?? {}), seed: advanceSeed(seed) } }));
      const fresh = chords.filter((c) => !before.has(c.id)).map((c) => c.id);
      s.set({ genHighlight: { at: Date.now(), chordIds: fresh.length ? fresh : null } });
      s.toast('success', 'Chords generated');
      return;
    }
  }
  // Not connected (or declined): subtle status only — no dialog, no state change,
  // no seed advance (spec §2, §8).
  s.toast('info', `Chord generator is not connected yet — ${scopeTooltip(scope, s.project).toLowerCase()}.`);
}

/** Next variation seed. Deterministic +1 wrap within the 32-bit range for now;
 *  the engine may replace this with a hash-based step when it lands. */
function advanceSeed(seed: number): number {
  return (seed + 1) >>> 0;
}
