/**
 * MIDI → chord analysis (feature spec §1).
 *
 * Reads the notes of a MIDI clip on the chord track and parses them into a
 * Chord, tolerating real-world input: root position, inversions, sevenths
 * and extensions, doubled notes, missing chord tones, passing/non-chord
 * tones, arpeggiation and spread velocities/durations.
 *
 * Algorithm (deterministic, no rng):
 *  1. Collect notes whose sounding time overlaps the analysis window.
 *  2. pitchClass = midi % 12.
 *  3. weight = soundingDuration × velocity × bassBoost × beatBoost — longer,
 *     louder, lower and on-beat notes count more; everything is relative.
 *  4. A pitch class is STRONG at ≥ 8% of the total weight, WEAK at ≥ 3%
 *     (faint passing tones), invisible below that.
 *  5. All 12 roots × every template (derived from the shared parseChord —
 *     one chord grammar in crescode, never two) are scored with
 *     score = matchedChordTones − missingChordTones − unexpectedNotes.
 *     A fully absent THIRD costs 1.5, not 1 — the third defines quality, so
 *     "Cmaj9 without its E" must not outrank the triad the notes actually
 *     spell (this is what keeps G/C ahead of Cmaj9 on C-G-B-D).
 *  6. The lowest sounding pitch is a bass HINT (+0.5 when it is the root,
 *     inversion label when it is a chord tone, slash "G/C" when a full
 *     chord sits over a foreign bass — the bass explains itself there and is
 *     not counted as an unexpected note) — never an automatic root.
 *  7. Key context (tonic/diatonic roots) and neighboring chords break ties
 *     in the ranking; the clear/ambiguous verdict stays context-free so a
 *     genuinely contested reading is never hidden by context bonuses.
 *
 * confidence is reported 0–100 per the feature spec; the contract
 * `Chord.confidence` remains 0..1 and is populated as confidence/100.
 */
import { parseChord, scalePitchClasses, type PitchClass } from '../../shared/schema';
import { chordFromSymbol, spelledNoteName } from './model';
import type {
  Chord, ChordCandidate, ChordQuality, ChordClip, GridResolution, Pitch, ProjectKey,
} from './types';

// --- Tuning constants (documented invariants, pinned by tests) -------------

const STRONG_RATIO = 0.08;   // of total weight
const WEAK_RATIO = 0.03;     // of total weight — probable passing tones
const MISSING_WEAK_PENALTY = 0.25; // faintly-present chord tone
const MISSING_THIRD_PENALTY = 1.5; // absent third — quality-defining tone
const BASS_ROOT_BONUS = 0.5;
const TONIC_BONUS = 0.2;
const DIATONIC_BONUS = 0.1;
const NEIGHBOR_FIFTH_BONUS = 0.15; // prev resolves up a fourth to cand / cand is V of next
const NEIGHBOR_SAME_BONUS = 0.1;
const AMBIGUOUS_GAP = 0.5;   // raw-score gap below which a reading is contested
const ALTERNATIVE_GAP = 1.0; // raw-score window for alternative interpretations
const ALTERNATIVE_LIMIT = 5;
const DOWNBEAT_BOOST = 1.3;
const MIDBAR_BOOST = 1.15;

const mod12 = (v: number): PitchClass => (((v % 12) + 12) % 12) as PitchClass;

// --- Templates: derived from the shared parser -----------------------------

/** Chord shapes the analyzer distinguishes, as shared-grammar suffixes.
 *  Order is the stable tie-break (earlier = more common reading). */
const TEMPLATE_SUFFIXES = [
  '', 'm', 'dim', 'aug', 'sus2', 'sus4', '5', '6', 'm6',
  '7', 'maj7', 'm7', 'm7b5', 'dim7', '7sus4', 'add9', '9', 'maj9', 'm9',
] as const;

export interface ChordTemplate {
  readonly suffix: string;
  readonly quality: ChordQuality;
  /** Pitch classes of the shape stacked from root pc 0 (intervals mod 12). */
  readonly pcs: readonly PitchClass[];
}

export const CHORD_TEMPLATES: readonly ChordTemplate[] = TEMPLATE_SUFFIXES.map((suffix) => {
  const parsed = parseChord(`C${suffix}`);
  if (!parsed.ok) throw new Error(`chord template "${suffix}" failed to parse — shared grammar drift`);
  const pcs: PitchClass[] = [];
  for (const interval of parsed.chord.intervals) {
    const pc = mod12(parsed.chord.root + interval);
    if (!pcs.includes(pc)) pcs.push(pc);
  }
  return { suffix, quality: parsed.chord.quality as ChordQuality, pcs };
});

// --- Public types -----------------------------------------------------------

export type ChordAnalysisStatus = 'clear' | 'ambiguous' | 'incomplete' | 'unknown';

export interface ChordAnalysisContext {
  /** Analysis window; defaults to the bounding box of the valid notes. */
  window?: { startTick: number; endTick: number };
  /** Native grid — enables the on-beat weight boost. */
  grid?: GridResolution;
  /** Project key — spelling canon plus tonic/diatonic ranking bonuses. */
  projectKey?: ProjectKey;
  /** Neighboring chords — tie-break bonuses only (see module doc §7). */
  previousChord?: Chord | null;
  nextChord?: Chord | null;
}

/** Anything shaped like a chord-lane MIDI clip: a MidiClip, or a ChordClip
 *  with its rawMidiNotes as `notes`. */
export interface ClipWindow {
  startTime: number;
  lengthTicks: number;
  notes: readonly Pitch[];
}

export interface ChordAnalysis {
  status: ChordAnalysisStatus;
  /** Primary reading; null only when there was nothing to analyze. */
  chord: Chord | null;
  /** 0–100 per the feature spec (contract Chord carries confidence/100). */
  confidence: number;
  /** Close second readings, best first, primary excluded. */
  alternatives: ChordCandidate[];
  matchedPitchClasses: PitchClass[];
  missingPitchClasses: PitchClass[];
  extraPitchClasses: PitchClass[];
  /** Faint input (3–8% of total weight) — probable passing tones. */
  weakPitchClasses: PitchClass[];
  bassPitchClass: PitchClass | null;
  window: { startTick: number; endTick: number };
  /** Notes dropped for being invalid MIDI (bad range/velocity/duration). */
  ignoredNoteCount: number;
}

// --- Internals ---------------------------------------------------------------

interface ScoredCandidate {
  root: PitchClass;
  template: ChordTemplate;
  raw: number;
  final: number;
  matched: PitchClass[];
  /** Chord tones entirely absent from the input. */
  missing: PitchClass[];
  /** Total missing penalty — absent tones at full weight, faint tones at 0.25.
   *  A reading with any penalty is not "complete" for the ambiguity verdict. */
  missingPenalty: number;
  extras: PitchClass[];
  /** Sounding bass the symbol carries: a foreign slash bass ("G/C") or a
   *  chord-tone inversion bass ("C/E"); null in root position. */
  symbolBass: PitchClass | null;
  /** True when symbolBass is foreign to the chord (slash, not inversion). */
  slashBass: PitchClass | null;
}

const isUsableNote = (n: Pitch): boolean =>
  Number.isInteger(n.midi) && n.midi >= 0 && n.midi <= 127 &&
  Number.isInteger(n.velocity) && n.velocity >= 1 && n.velocity <= 127 &&
  Number.isInteger(n.startTick) && n.startTick >= 0 &&
  Number.isInteger(n.durationTicks) && n.durationTicks >= 1;

function beatBoostOf(startTick: number, grid: GridResolution | undefined): number {
  if (grid === undefined) return 1;
  const inBar = startTick % grid.ticksPerBar;
  const beatIndex = Math.floor(inBar / grid.ticksPerBeat);
  if (beatIndex === 0) return DOWNBEAT_BOOST;
  const feltBeats = grid.compound ? grid.timeSignature.numerator / 3 : grid.timeSignature.numerator;
  return feltBeats % 2 === 0 && beatIndex === feltBeats / 2 ? MIDBAR_BOOST : 1;
}

function buildChord(
  candidate: ScoredCandidate,
  confidence100: number,
  sourcePcs: PitchClass[],
): Chord | null {
  const rootName = spelledNoteName(candidate.root);
  const bassName = candidate.symbolBass !== null ? spelledNoteName(candidate.symbolBass) : null;
  const symbol = `${rootName}${candidate.template.suffix}${bassName !== null ? `/${bassName}` : ''}`;
  const built = chordFromSymbol(symbol, {
    confidence: Math.min(1, Math.max(0, confidence100 / 100)),
    sourcePitchClasses: sourcePcs,
  });
  return built.ok ? built.chord : null;
}

function candidateConfidence(c: ScoredCandidate): number {
  return Math.min(1, Math.max(0, c.raw / c.template.pcs.length));
}

// --- Core analysis -----------------------------------------------------------

/** Parse a weighed note set into a chord reading (feature spec §1). */
export function analyzeChord(
  notes: readonly Pitch[],
  context: ChordAnalysisContext = {},
): ChordAnalysis {
  const valid = notes.filter(isUsableNote);
  const ignoredNoteCount = notes.length - valid.length;

  const window = context.window ?? (valid.length > 0
    ? {
        startTick: Math.min(...valid.map((n) => n.startTick)),
        endTick: Math.max(...valid.map((n) => n.startTick + n.durationTicks)),
      }
    : { startTick: 0, endTick: 0 });

  const empty: ChordAnalysis = {
    status: 'unknown', chord: null, confidence: 0, alternatives: [],
    matchedPitchClasses: [], missingPitchClasses: [], extraPitchClasses: [],
    weakPitchClasses: [], bassPitchClass: null, window, ignoredNoteCount,
  };
  if (valid.length === 0) return empty;

  // Step 1–3: overlap the window, weight every note.
  const collected: Array<{ pc: PitchClass; midi: number; startTick: number; weight: number }> = [];
  for (const n of valid) {
    const noteEnd = n.startTick + n.durationTicks;
    if (context.window !== undefined && (n.startTick >= window.endTick || noteEnd <= window.startTick)) {
      continue; // sounds entirely outside the analysis window
    }
    const sounding = Math.min(noteEnd, window.endTick) - Math.max(n.startTick, window.startTick);
    collected.push({ pc: mod12(n.midi), midi: n.midi, startTick: n.startTick, weight: sounding * n.velocity });
  }
  if (collected.length === 0) return { ...empty, window };

  const lowest = Math.min(...collected.map((n) => n.midi));
  const bassPitchClass = collected.find((n) => n.midi === lowest)!.pc;

  const weightByPc = new Map<PitchClass, number>();
  let totalWeight = 0;
  for (const n of collected) {
    // Lower notes count more (1.5× at the bass, fading to 1.0 an octave up).
    const bassBoost = 1 + 0.5 * Math.max(0, 1 - (n.midi - lowest) / 12);
    const beatBoost = beatBoostOf(n.startTick, context.grid);
    const w = n.weight * bassBoost * beatBoost;
    weightByPc.set(n.pc, (weightByPc.get(n.pc) ?? 0) + w);
    totalWeight += w;
  }

  const strongPcs: PitchClass[] = [];
  const weakPcs: PitchClass[] = [];
  for (const [pc, w] of weightByPc) {
    if (w >= totalWeight * STRONG_RATIO) strongPcs.push(pc);
    else if (w >= totalWeight * WEAK_RATIO) weakPcs.push(pc);
  }
  strongPcs.sort((a, b) => a - b);
  weakPcs.sort((a, b) => a - b);

  // Step 7 (context bonuses — ranking only, never the verdict).
  const key = context.projectKey;
  const scalePcs = key !== undefined ? scalePitchClasses(key.tonic, key.mode) : null;
  const neighborBonuses = (root: PitchClass): number => {
    const bonuses: number[] = [0];
    const prev = context.previousChord;
    if (prev !== null && prev !== undefined) {
      if (root === mod12(prev.rootPc + 5)) bonuses.push(NEIGHBOR_FIFTH_BONUS);
      if (root === prev.rootPc) bonuses.push(NEIGHBOR_SAME_BONUS);
    }
    const next = context.nextChord;
    if (next !== null && next !== undefined && root === mod12(next.rootPc + 7)) {
      bonuses.push(NEIGHBOR_FIFTH_BONUS);
    }
    return Math.max(...bonuses);
  };

  // Steps 5–6: every root against every template.
  const scored: ScoredCandidate[] = [];
  for (const template of CHORD_TEMPLATES) {
    for (let root = 0; root <= 11; root++) {
      const rootPc = root as PitchClass;
      const templatePcs = template.pcs.map((p) => mod12(rootPc + p));
      let raw = 0;
      let missingPenalty = 0;
      const matched: PitchClass[] = [];
      const missing: PitchClass[] = [];
      for (const intervalPc of template.pcs) {
        const tpc = mod12(rootPc + intervalPc);
        if (strongPcs.includes(tpc)) { raw += 1; matched.push(tpc); }
        else if (weakPcs.includes(tpc)) { raw -= MISSING_WEAK_PENALTY; missingPenalty += MISSING_WEAK_PENALTY; }
        else {
          // A fully absent third is the quality-defining tone: for extended
          // templates (4+ tones) it costs 1.5 so "Cmaj9 without its E" never
          // outranks what the notes actually spell. Plain triads keep the
          // normal −1 so the honest triad completion stays visible (C+G can
          // still surface C/Cm as close alternatives).
          const third = (intervalPc === 3 || intervalPc === 4) && template.pcs.length >= 4;
          const penalty = third ? MISSING_THIRD_PENALTY : 1;
          raw -= penalty;
          missingPenalty += penalty;
          missing.push(tpc);
        }
      }
      const extras: PitchClass[] = [];
      for (const spc of strongPcs) {
        if (!templatePcs.includes(spc)) { raw -= 1; extras.push(spc); }
      }
      // Slash reading: full chord over a foreign bass — the bass note is
      // the reading's own label, not an unexpected tone (no extra penalty).
      let slashBass: PitchClass | null = null;
      if (missing.length === 0 && extras.length === 1 && bassPitchClass !== null && extras[0] === bassPitchClass) {
        raw += 1;
        slashBass = bassPitchClass;
        extras.length = 0;
      }
      // Inversion bass: a chord tone sounding lowest, below the root.
      const inversionBass = bassPitchClass !== null &&
        bassPitchClass !== rootPc && templatePcs.includes(bassPitchClass)
        ? bassPitchClass
        : null;
      let final = raw;
      if (bassPitchClass === rootPc) final += BASS_ROOT_BONUS;
      if (key !== undefined) {
        if (rootPc === key.tonic) final += TONIC_BONUS;
        else if (scalePcs !== null && scalePcs.includes(rootPc)) final += DIATONIC_BONUS;
      }
      final += neighborBonuses(rootPc);
      scored.push({
        root: rootPc, template, raw, final, matched, missing, missingPenalty, extras,
        symbolBass: slashBass ?? inversionBass, slashBass,
      });
    }
  }

  scored.sort((a, b) =>
    b.final - a.final ||
    b.raw - a.raw ||
    b.matched.length - a.matched.length ||
    a.template.pcs.length - b.template.pcs.length ||
    (b.root === bassPitchClass ? 1 : 0) - (a.root === bassPitchClass ? 1 : 0) ||
    CHORD_TEMPLATES.indexOf(a.template) - CHORD_TEMPLATES.indexOf(b.template));

  const best = scored[0]!;
  const second = scored[1] ?? null;

  // Status (context-free verdict).
  let status: ChordAnalysisStatus;
  if (best.raw < 0) status = 'unknown';
  else if (best.missing.length >= 2 && best.extras.length >= 1) status = 'unknown'; // no chord explains this
  else if (best.template.quality === 'power' || best.missing.length > 0) status = 'incomplete';
  else if (second !== null && best.raw - second.raw < AMBIGUOUS_GAP && second.missingPenalty === 0) status = 'ambiguous';
  else status = 'clear';

  // Confidence 0–100.
  const completeness = best.matched.length / best.template.pcs.length;
  const margin = second !== null ? Math.max(0, best.raw - second.raw) : 2;
  const bassFit = best.root === bassPitchClass
    ? 1
    : best.template.pcs.map((p) => mod12(best.root + p)).includes(bassPitchClass)
      ? 0.5
      : 0.25;
  let confidence = Math.round(45 * completeness + 35 * Math.min(1, margin / 1.5) + 20 * bassFit);
  if (status === 'unknown') confidence = Math.min(confidence, 20);
  if (status === 'incomplete') confidence = Math.min(confidence, 55);
  if (status === 'ambiguous') confidence = Math.min(confidence, 60);
  confidence = Math.min(100, Math.max(0, confidence));

  const chord = buildChord(best, confidence, strongPcs);

  const alternatives: ChordCandidate[] = scored
    .slice(1)
    .filter((c) => best.raw - c.raw <= ALTERNATIVE_GAP)
    .slice(0, ALTERNATIVE_LIMIT)
    .map((c) => {
      const altChord = buildChord(c, candidateConfidence(c) * 100, strongPcs);
      const later = scored.slice(scored.indexOf(c) + 1)
        .filter((x) => best.raw - x.raw <= ALTERNATIVE_GAP)
        .slice(0, ALTERNATIVE_LIMIT)
        .map((x) => buildChord(x, candidateConfidence(x) * 100, strongPcs))
        .filter((x): x is Chord => x !== null);
      return {
        chord: altChord,
        score: Math.min(1, Math.max(0, c.final / c.template.pcs.length)),
        confidence: candidateConfidence(c),
        matchedPitchClasses: [...c.matched].sort((a, b) => a - b),
        missingPitchClasses: [...c.missing].sort((a, b) => a - b),
        extraPitchClasses: [...c.extras].sort((a, b) => a - b),
        alternativeInterpretations: later,
      };
    })
    .filter((c): c is ChordCandidate => c.chord !== null);

  return {
    status,
    chord,
    confidence,
    alternatives,
    matchedPitchClasses: [...best.matched].sort((a, b) => a - b),
    missingPitchClasses: [...best.missing].sort((a, b) => a - b),
    extraPitchClasses: [...best.extras].sort((a, b) => a - b),
    weakPitchClasses: weakPcs,
    bassPitchClass,
    window,
    ignoredNoteCount,
  };
}

/**
 * §1 entry point: read the MIDI notes of an existing clip on the chord
 * track. Collects every note whose sounding time overlaps the clip's
 * [startTime, startTime + lengthTicks) window (clamping partial overlaps),
 * then analyzes that window.
 */
export function parseChordFromClip(
  clip: ClipWindow,
  context: ChordAnalysisContext = {},
): ChordAnalysis {
  const window = { startTick: clip.startTime, endTick: clip.startTime + clip.lengthTicks };
  return analyzeChord(clip.notes, { ...context, window });
}

/** Convenience overload for chord-lane clip views (rawMidiNotes backed). */
export function parseChordClipView(clip: ChordClip, context: ChordAnalysisContext = {}): ChordAnalysis {
  return parseChordFromClip(
    { startTime: clip.startTime, lengthTicks: clip.lengthTicks, notes: clip.rawMidiNotes ?? [] },
    context,
  );
}
