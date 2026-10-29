/**
 * Chord-generation UI actions (spec §2, §8) — the isolated integration boundary
 * between the app and the harmony engine. The scope detection (lib/genScope.ts)
 * decides WHAT Generate does from the current state; this module invokes the
 * Phase 4 engine and commits the result.
 *
 * Contract (spec §3, §13, §15):
 * - Clicking Generate never opens a prompt or configuration dialog.
 * - The whole operation is ONE undoable project edit: chords + advanced seed
 *   commit atomically, so undo/redo restores both together.
 * - The seed advances only on a successful generation that actually produced
 *   chords; a declined or failed run leaves the project untouched.
 * - No placeholder chords are fabricated; locking, persistence and the
 *   orchestral Generate (composeAll) are untouched.
 */
import type { Chord, Project } from '../shared/schema/types';
import { DEFAULT_CHORDGEN_SETTINGS } from '../shared/schema/types';
import { generateEvaluatedProgression } from '../engine/harmony/selection';
import type { GenerationScope } from '../engine/harmony/generation-types';
import { useStore } from '../store/store';
import { detectGenerationScope, scopeTooltip, type GenerationScope as UiScope } from './genScope';

/** Test/diagnostic override seam: when set, it replaces the real engine call.
 *  It receives the project, the detected scope and the current seed, and
 *  returns the replacement chord array (or null to decline the run). */
export type ChordGenerator = (p: Project, scope: UiScope, seed: number) => Chord[] | null;
let generateChords: ChordGenerator | null = null;

/** Test/diagnostic hook: register or clear the generator override. */
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
      commit(chords, seed);
      return;
    }
    // Override declined: subtle status only — no dialog, no state change,
    // no seed advance.
    s.toast('info', `Chord generation declined — ${scopeTooltip(scope, s.project).toLowerCase()}.`);
    return;
  }

  // Real engine path (Phase 5): bounded complete candidates → whole-song
  // evaluation → deterministic seeded selection among musically competitive
  // outcomes — then commit atomically. Locked chords, scopes, manual
  // material and undo/redo semantics are untouched: every candidate is a
  // plain production run and selection only ever PICKS one.
  try {
    const result = generateEvaluatedProgression(s.project, {
      seed,
      scope: scope as GenerationScope,
      settings: s.project.chordGenSettings,
    });
    if (result.report.generatedChordCount === 0) {
      // Nothing eligible in scope (fully locked, empty section selection…):
      // report subtly, change nothing, do not advance the seed (spec §13).
      s.toast('info', `Nothing to generate — ${scopeTooltip(scope, s.project).toLowerCase()} is already covered by preserved chords.`);
      return;
    }
    commit(result.chords, seed);
  } catch {
    // The engine is deterministic and total, but a failed run must never
    // corrupt the project or advance the seed (spec §13).
    s.toast('error', 'Chord generation failed — the project is unchanged.');
  }
}

/** One undoable step: the full replacement chord array plus the advanced
 *  seed, then the brief highlight and status toast (spec §4, §9, §15). */
function commit(chords: Chord[], seed: number): void {
  const s = useStore.getState();
  const before = new Set(s.project.chords.map((c) => c.id));
  s.edit((p) => ({
    ...p,
    chords,
    chordGenSettings: { ...DEFAULT_CHORDGEN_SETTINGS, ...(p.chordGenSettings ?? {}), seed: advanceSeed(seed) },
  }));
  const fresh = chords.filter((c) => !before.has(c.id)).map((c) => c.id);
  s.set({ genHighlight: { at: Date.now(), chordIds: fresh.length ? fresh : null } });
  s.toast('success', 'Chords generated');
}

/** Next variation seed. Deterministic +1 wrap within the 32-bit range;
 *  the engine derives all of its own randomness from the seed value. */
function advanceSeed(seed: number): number {
  return (seed + 1) >>> 0;
}
