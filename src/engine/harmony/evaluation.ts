/**
 * Complete-progression evaluation (Phase 5) — judging harmony as a developing
 * composition instead of a sequence of locally acceptable chord changes.
 *
 * Phases 1–4.3 evaluate DECISIONS while they are made (a transition, a
 * continuation, a color pick, one phrase path). Phase 5 adds the missing
 * level: after a complete progression exists, evaluate how it behaves AS
 * MUSIC — over whole phrases, across section seams, between repeated
 * sections and across the whole arrangement — and let a bounded set of
 * complete candidates be compared on those evaluations (selection.ts).
 *
 * Architecture (Phase 5 spec §3, §12, §13):
 *   evaluatePhrase(phrase, chords, context)  → one phrase's musical behavior
 *   evaluateSongProgression(project, chords, plan) → whole-arrangement view
 *
 * What the evaluator reads:
 *   - STRUCTURAL FOUNDATIONS first (Phase 4.1): movement, direction, tonal
 *     identity, cadences and repetition are judged on foundations, never on
 *     chord symbols. Extensions cannot fake development (spec §5).
 *   - ACTUAL DURATIONS: a four-bar sustain is one harmony for four bars —
 *     repeated re-articulations of one foundation are not movement (§6).
 *   - PHRASE INTENTIONS (Phase 3): roles, directions and cadence intentions
 *     decide what each phrase should be judged FOR — a static Intro is not
 *     penalized for lacking exploration, a Build is not judged as an Intro
 *     (§4, §12). There is no mandatory T→D→T pattern and no universal
 *     changes-per-bar target.
 *   - CONTEXT for chromaticism (§10): a borrowed chord is judged by its
 *     relationships to the surrounding harmony — never by its scale
 *     membership alone.
 *   - COLOR LAST and lightly (§11): richness fit, suspension purpose and
 *     arrival coloring are evaluated AFTER structure, with strictly less
 *     total influence than structural coherence (enforced by the weights
 *     below, documented as heuristics for listening calibration).
 *
 * Objective/heuristic separation (Phase 5 spec §17): every evaluation result
 * carries `facts` (objective, derivable: counts, shares, labels) beside
 * `scores` (internal 0..1 heuristic fits). Heuristic scores are comparison
 * tools for selecting between candidates — never proof of musical quality;
 * the final judgment is human listening (spec §20).
 *
 * Symmetrical scales (Whole Tone, Diminished): tonal identity is evaluated
 * as root recurrence + recurring pitch-class anchoring, never as traditional
 * tonic function (spec §7).
 *
 * Pure and deterministic: no rng, no clock, no mutation. Identical inputs
 * produce identical evaluations. No React, no store, no async, no
 * dependencies. The manual workflow and the orchestral generator are
 * untouched — this module only READS progressions.
 */
import { parseChord, type ParsedChord } from '../../shared/schema/chords';
import { scalePitchClasses } from '../../shared/schema/modes';
import {
  DEFAULT_CHORDGEN_SETTINGS, type Chord, type ChordGenSettings, type Project,
} from '../../shared/schema/types';
import { cadenceEnvironment } from './cadences';
import {
  analyzeFoundationRelationship, buildFoundationPool, foundationArrivalFit,
  foundationInfoFromSymbol, foundationLabel, realizedFoundationFamily,
  reinforcesTonic, type FoundationInfo, type FoundationPool,
} from './foundation';
import {
  flattenPhrases, planningProjectFor, windowsForTarget,
  type SectionProfilePrefs,
} from './generation';
import { meterFacts, type MeterFacts } from './rhythm';
import { structuralContext, type SelectionWindow } from './progression';
import { buildSongHarmonyProfiles } from './profiles';
import type {
  BoundaryIntention, CadenceEnvironment, CadenceIntention, PhraseRole,
  SongHarmonyPlan,
} from './types';
import { generationRegionEnd } from './coverage';

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/* ==========================================================================
 * Timeline — one parsed pass over a complete chord array
 * ======================================================================== */

/** One chord event of a complete progression with its structural identity
 *  and color facts precomputed (parsed once, read everywhere). */
export interface TimedHarmonicEvent {
  chord: Chord;
  /** Structural foundation — color-independent (Phase 4.1 extraction). */
  foundation: FoundationInfo;
  /** Parsed color of the final symbol. */
  parsed: ParsedChord;
  /** Color richness rank: 0 triad, 0.5 seventh, 1 extension. */
  tierRank: number;
  /** The COLOR carries only scale tones (foundation diatonicism is separate). */
  colorDiatonic: boolean;
}

function tierRankOf(parsed: ParsedChord): number {
  const n = parsed.intervals.length;
  return n <= 3 ? 0 : n === 4 ? 0.5 : 1;
}

/** Parse a full progression once. Unparsable symbols are skipped (counted in
 *  `unparsableSymbols` — objective facts, never silently invented harmony). */
export function buildTimeline(
  chords: Chord[],
  key: number,
  mode: Project['mode'],
): { events: TimedHarmonicEvent[]; unparsableSymbols: string[] } {
  const events: TimedHarmonicEvent[] = [];
  const unparsableSymbols: string[] = [];
  const scaleSet = new Set(scalePitchClasses(key, mode));
  for (const chord of chords) {
    const parsed = parseChord(chord.symbol);
    if (!parsed.ok) {
      unparsableSymbols.push(chord.symbol);
      continue;
    }
    const foundation = foundationInfoFromSymbol(chord.symbol, key, mode);
    if (foundation === null) {
      unparsableSymbols.push(chord.symbol);
      continue;
    }
    events.push({
      chord,
      foundation,
      parsed: parsed.chord,
      tierRank: tierRankOf(parsed.chord),
      colorDiatonic: parsed.chord.pitchClasses.every((p) => scaleSet.has(p)),
    });
  }
  events.sort((a, b) => a.chord.startTick - b.chord.startTick);
  return { events, unparsableSymbols };
}

/** The event sounding at `tick` (start ≤ tick < end), or null. */
export function eventSoundingAt(events: TimedHarmonicEvent[], tick: number): TimedHarmonicEvent | null {
  for (const e of events) {
    if (e.chord.startTick <= tick && tick < e.chord.startTick + e.chord.durationTicks) return e;
  }
  return null;
}

/** The event immediately before `tick` (ends exactly at or before it), or null. */
function eventBefore(events: TimedHarmonicEvent[], tick: number): TimedHarmonicEvent | null {
  let best: TimedHarmonicEvent | null = null;
  for (const e of events) {
    if (e.chord.startTick + e.chord.durationTicks <= tick) {
      if (best === null || e.chord.startTick > best.chord.startTick) best = e;
    }
  }
  return best;
}

/** The event immediately after `tick` (starts at or after it), or null. */
function eventAfter(events: TimedHarmonicEvent[], tick: number): TimedHarmonicEvent | null {
  let best: TimedHarmonicEvent | null = null;
  for (const e of events) {
    if (e.chord.startTick >= tick) {
      if (best === null || e.chord.startTick < best.chord.startTick) best = e;
    }
  }
  return best;
}

/* ==========================================================================
 * Evaluation context — the SAME planning view the generator used
 * ======================================================================== */

/** A phrase window for evaluation: the generator's own SelectionWindow shape
 *  (so the single-implementation scoring helpers accept it) plus flags the
 *  evaluator and reports need. */
export interface EvaluationWindow extends SelectionWindow {
  /** True when no planned phrase covers this span (synthetic neutral window). */
  synthetic: boolean;
  isSongStart: boolean;
  isSongEnd: boolean;
}

/** Everything phrase evaluation needs, derived once per progression. */
export interface EvaluationContext {
  project: Project;
  settings: ChordGenSettings;
  meter: MeterFacts;
  env: CadenceEnvironment;
  pool: FoundationPool;
  plan: SongHarmonyPlan;
  /** The evaluated span: the full song (0 .. regionEnd) — evaluation always
   *  sees the COMPLETE harmonic context, including preserved chords (§16). */
  span: { startTick: number; endTick: number };
  windows: EvaluationWindow[];
  windowById: Map<string, EvaluationWindow>;
  profileBySection: Map<string, SectionProfilePrefs>;
  /** Full section-harmony profiles by section id (development relationships
   *  and contours — the structural subset above is enough for windows, this
   *  map serves repeated-section evaluation). */
  profileFullBySection: Map<string, import('./types').SectionHarmonyProfile>;
}

/** Build the evaluation context from a project and the plan a candidate was
 *  generated with (plan.seed identifies the run; profiles are seed-free). */
export function buildEvaluationContext(
  project: Project,
  plan: SongHarmonyPlan,
  settingsOverride?: Partial<ChordGenSettings>,
): EvaluationContext {
  const settings: ChordGenSettings = {
    ...DEFAULT_CHORDGEN_SETTINGS,
    ...(project.chordGenSettings ?? {}),
    ...(settingsOverride ?? {}),
  };
  const planProject = planningProjectFor(project);
  const profiles = buildSongHarmonyProfiles(planProject);
  const profileBySection = new Map<string, SectionProfilePrefs>(
    profiles.map((p) => [p.sectionId, p.preferences as SectionProfilePrefs]),
  );
  const { phrases: plannedPhrases } = flattenPhrases(plan);
  const env = cadenceEnvironment(project.key, project.mode);
  const span = { startTick: 0, endTick: generationRegionEnd(project) };
  const raw = windowsForTarget(
    span, plannedPhrases, profileBySection, settings, env, true,
  );
  const windows: EvaluationWindow[] = raw.map((w, i) => ({
    ...w,
    synthetic: w.phraseRef === null,
    isSongStart: i === 0 && w.startTick === span.startTick,
    isSongEnd: w.endTick === span.endTick,
  }));
  const windowById = new Map<string, EvaluationWindow>();
  for (const w of windows) windowById.set(w.phraseRef?.id ?? `@${w.startTick}`, w);
  const profileFullBySection = new Map<string, import('./types').SectionHarmonyProfile>(
    profiles.map((p) => [p.sectionId, p]),
  );
  return {
    project,
    settings,
    meter: meterFacts(project.timeSignature),
    env,
    pool: buildFoundationPool(project.key, project.mode, settings),
    plan,
    span,
    windows,
    windowById,
    profileBySection,
    profileFullBySection,
  };
}

/* ==========================================================================
 * Phrase evaluation (spec §4–§11, §12)
 * ======================================================================== */

/** Objective, derivable facts about one phrase's realized harmony (§17). */
export interface PhraseFacts {
  eventCount: number;
  distinctFoundations: number;
  /** Distinct foundation labels in first-appearance order. */
  foundationLabels: string[];
  distinctRoots: number;
  /** Foundation changes inside the phrase (a sustained harmony counts once). */
  structuralChanges: number;
  changesPerBar: number;
  meanEventDurationTicks: number;
  longestSustainBars: number;
  /** Duration share reinforcing the tonal center (root contact for
   *  symmetrical modes). Descriptive — higher is not automatically better. */
  tonalContactShare: number;
  /** Duration share of non-diatonic FOUNDATIONS. Descriptive. */
  chromaticShare: number;
  arrivalSymbol: string | null;
  hasPlannedArrival: boolean;
}

/** Heuristic fits, 0..1 — internal comparison tools, not quality measures
 *  (§17). Null = genuinely not applicable (never synthesized). */
export interface PhraseScores {
  tonalIdentity: number;
  harmonicDirection: number;
  movementFit: number;
  /** Null when the phrase has no planned arrival inside the evaluated span. */
  cadenceFit: number | null;
  /** Null when the plan links the phrase to no earlier material. */
  repetitionDevelopment: number | null;
  chromaticCoherence: number;
  colorFit: number;
  /** Contextual weighted blend (role-dependent weights below). */
  total: number;
}

export interface PhraseEvaluation {
  key: string;
  phraseId: string | null;
  sectionId: string | null;
  sectionName: string | null;
  synthetic: boolean;
  role: PhraseRole;
  cadenceIntention: CadenceIntention | null;
  startTick: number;
  endTick: number;
  /** True when this window closes the song (its arrival is the song's end). */
  isSongEnd: boolean;
  scores: PhraseScores;
  facts: PhraseFacts;
}

/** One event slice inside a phrase window: the event's OVERLAP with the
 *  window (a sustain crossing a phrase boundary feeds both phrases with its
 *  actual sounding time — actual durations, §12). */
interface PhraseSlice {
  event: TimedHarmonicEvent;
  startTick: number;
  durationTicks: number;
  isArrival: boolean;
}

/** Duration share targets for tonic contact by phrase role — soft contextual
 *  preferences (mirror progression.ts's role table; an evaluator-local
 *  calibration, not a quota). */
const ROLE_TONAL_CONTACT: Record<PhraseRole, number> = {
  establish: 0.5, continue: 0.35, repeat: 0.45, develop: 0.3, contrast: 0.15, conclude: 0.45, prepare: 0.2,
};

/** How large the phrase's dominant harmony ("home") may read, by role. */
const ROLE_HOME_SHARE: Record<PhraseRole, number> = {
  establish: 0.55, continue: 0.38, repeat: 0.5, develop: 0.28, contrast: 0.22, conclude: 0.42, prepare: 0.3,
};

/** How many distinct foundations a phrase's journey should visit, by role —
 *  a soft center for a two-sided fit, scaled to the phrase's slot count. */
const ROLE_DISTINCT_TARGET: Record<PhraseRole, number> = {
  establish: 2.5, continue: 3, repeat: 2.5, develop: 4, contrast: 3.5, conclude: 2.5, prepare: 3,
};

/** Direction-component weights by role (identity / journey / preparation).
 *  Calibrated heuristics for listening review — never presented as
 *  music-theory constants (§4, §11). */
const ROLE_DIRECTION_WEIGHTS: Record<PhraseRole, [number, number, number]> = {
  establish: [0.45, 0.2, 0.35],
  continue: [0.3, 0.35, 0.35],
  repeat: [0.4, 0.25, 0.35],
  develop: [0.2, 0.45, 0.35],
  contrast: [0.15, 0.5, 0.35],
  conclude: [0.35, 0.2, 0.45],
  prepare: [0.25, 0.35, 0.4],
};

/** Phrase-category weights by role. Structural coherence (identity,
 *  direction, movement, cadence, repetition, chromatic context) always
 *  outweighs color: colorFit ≤ 0.18 everywhere and its SONG-level influence
 *  is additionally capped (§11). Calibration heuristics, not constants. */
type PhraseWeightSet = Record<keyof Omit<PhraseScores, 'total'>, number>;
const ROLE_PHRASE_WEIGHTS: Record<PhraseRole, PhraseWeightSet> = {
  establish: { tonalIdentity: 0.24, harmonicDirection: 0.2, movementFit: 0.14, cadenceFit: 0.12, repetitionDevelopment: 0.08, chromaticCoherence: 0.08, colorFit: 0.14 },
  continue: { tonalIdentity: 0.18, harmonicDirection: 0.22, movementFit: 0.16, cadenceFit: 0.16, repetitionDevelopment: 0.1, chromaticCoherence: 0.08, colorFit: 0.1 },
  repeat: { tonalIdentity: 0.16, harmonicDirection: 0.16, movementFit: 0.12, cadenceFit: 0.14, repetitionDevelopment: 0.24, chromaticCoherence: 0.08, colorFit: 0.1 },
  develop: { tonalIdentity: 0.12, harmonicDirection: 0.26, movementFit: 0.16, cadenceFit: 0.12, repetitionDevelopment: 0.14, chromaticCoherence: 0.12, colorFit: 0.08 },
  contrast: { tonalIdentity: 0.06, harmonicDirection: 0.24, movementFit: 0.16, cadenceFit: 0.12, repetitionDevelopment: 0.06, chromaticCoherence: 0.18, colorFit: 0.18 },
  conclude: { tonalIdentity: 0.2, harmonicDirection: 0.16, movementFit: 0.1, cadenceFit: 0.28, repetitionDevelopment: 0.08, chromaticCoherence: 0.08, colorFit: 0.1 },
  prepare: { tonalIdentity: 0.12, harmonicDirection: 0.26, movementFit: 0.14, cadenceFit: 0.2, repetitionDevelopment: 0.08, chromaticCoherence: 0.1, colorFit: 0.1 },
};

/** Collect a phrase's event slices with allocated overlap durations. */
function slicesForWindow(
  window: EvaluationWindow,
  events: TimedHarmonicEvent[],
): PhraseSlice[] {
  const slices: PhraseSlice[] = [];
  for (const e of events) {
    const s = Math.max(e.chord.startTick, window.startTick);
    const t = Math.min(e.chord.startTick + e.chord.durationTicks, window.endTick);
    if (t > s) {
      slices.push({
        event: e,
        startTick: s,
        durationTicks: t - s,
        isArrival: window.arrivalPlanned && s < window.endTick
          && e.chord.startTick + e.chord.durationTicks >= window.endTick,
      });
    }
  }
  return slices.sort((a, b) => a.startTick - b.startTick);
}

function tonicChordRelationship(
  f: FoundationInfo,
  pool: FoundationPool,
): number {
  if (pool.tonicTriadPcs.length === 0) return 0;
  const set = new Set(f.corePitchClasses);
  return pool.tonicTriadPcs.filter((p) => set.has(p)).length / pool.tonicTriadPcs.length;
}

/* --- tonal identity (§7) -------------------------------------------------- */

function tonalIdentityScore(
  slices: PhraseSlice[],
  window: EvaluationWindow,
  context: EvaluationContext,
): number {
  const { pool } = context;
  const totalDur = slices.reduce((s, x) => s + x.durationTicks, 0);
  if (totalDur <= 0) return 0.5;

  if (pool.symmetric) {
    // Symmetrical scales: identity = root recurrence + recurring pitch-class
    // anchoring — never traditional tonic function (§7).
    const target = 0.2 + 0.3 * window.direction.stability;
    const rootContact = slices.reduce(
      (s, x) => s + (x.event.foundation.rootPc === pool.tonic ? x.durationTicks : 0), 0,
    ) / totalDur;
    const contactFit = 1 - Math.abs(rootContact - target);
    const anchor = slices[0].event.foundation;
    let recurrenceSum = 0;
    let weightSum = 0;
    for (const x of slices) {
      const shared = x.event.foundation.corePitchClasses
        .filter((p) => anchor.corePitchClasses.includes(p)).length;
      const ratio = shared / Math.max(1, Math.min(anchor.corePitchClasses.length, x.event.foundation.corePitchClasses.length));
      recurrenceSum += ratio * x.durationTicks;
      weightSum += x.durationTicks;
    }
    const recurrence = weightSum > 0 ? recurrenceSum / weightSum : 0;
    return clamp01(0.55 * contactFit + 0.45 * recurrence);
  }

  // Tonal modes: contact fit + DEPARTURE CONNECTIVITY + anchoring. Tonic-chord
  // frequency is one input among three, never the measure (§7).
  const target = ROLE_TONAL_CONTACT[window.role];
  let contactDur = 0;
  let connectivitySum = 0;
  let connectivityWeight = 0;
  for (const x of slices) {
    const f = x.event.foundation;
    if (reinforcesTonic(f, pool.tonic, pool.tonicTriadPcs)) {
      contactDur += x.durationTicks;
    } else {
      connectivitySum += tonicChordRelationship(f, pool) * x.durationTicks;
      connectivityWeight += x.durationTicks;
    }
  }
  const contactShare = contactDur / totalDur;
  const contactFit = 1 - Math.abs(contactShare - target);
  const connectivity = connectivityWeight > 0 ? connectivitySum / connectivityWeight : 1;
  const first = slices[0].event.foundation;
  const last = slices[slices.length - 1].event.foundation;
  const anchorFit = 0.5
    * (reinforcesTonic(first, pool.tonic, pool.tonicTriadPcs) ? 1 : tonicChordRelationship(first, pool))
    + 0.5
    * (reinforcesTonic(last, pool.tonic, pool.tonicTriadPcs) ? 1 : tonicChordRelationship(last, pool));
  return clamp01(0.45 * contactFit + 0.25 * connectivity + 0.3 * anchorFit);
}

/* --- harmonic direction (§4) ---------------------------------------------- */

function harmonicDirectionScore(
  slices: PhraseSlice[],
  window: EvaluationWindow,
): number {
  const totalDur = slices.reduce((s, x) => s + x.durationTicks, 0);
  if (totalDur <= 0) return 0.5;

  // Sustained RUNS: consecutive same-foundation slices collapse — a
  // re-articulated harmony is one harmony (§4 continuation), so the journey
  // below is measured over distinct sustained harmonies, never event counts.
  const runs: Array<{ foundation: FoundationInfo; dur: number }> = [];
  for (const x of slices) {
    const last = runs[runs.length - 1];
    if (last !== undefined && last.foundation.id === x.event.foundation.id) last.dur += x.durationTicks;
    else runs.push({ foundation: x.event.foundation, dur: x.durationTicks });
  }

  // Identity: the dominant harmony's duration share against the role's
  // expectation (establishment without domination).
  const shareByFoundation = new Map<string, number>();
  for (const x of slices) {
    shareByFoundation.set(x.event.foundation.id,
      (shareByFoundation.get(x.event.foundation.id) ?? 0) + x.durationTicks);
  }
  let homeShare = 0;
  for (const share of shareByFoundation.values()) homeShare = Math.max(homeShare, share);
  homeShare /= totalDur;
  const homeTarget = ROLE_HOME_SHARE[window.role];
  const identityFit = 1 - Math.abs(homeShare - homeTarget);

  // Journey: distinct foundations against the role's two-sided center,
  // scaled by the phrase's sustained-run count (its real structural size).
  const distinct = shareByFoundation.size;
  const distinctTarget = Math.min(ROLE_DISTINCT_TARGET[window.role], Math.max(2, runs.length));
  const journeyFit = clamp01(1 - Math.abs(distinct - distinctTarget) / Math.max(2, distinctTarget));

  // Preparation: how the harmony moves INTO its final destination — the
  // relationship of the previous sustained harmony to the last one (shared
  // structural tones, leading motion). This is the "development /
  // preparation of important arrivals" reading (§4), judged WITHOUT any
  // mandatory progression pattern. Runs guarantee a real structural change —
  // a same-foundation re-articulation is not a preparation event.
  let prepFit = 0.5;
  if (runs.length >= 2) {
    const rel = analyzeFoundationRelationship(
      runs[runs.length - 2].foundation, runs[runs.length - 1].foundation,
    );
    prepFit = clamp01(0.35 + 0.4 * rel.coreCommonRatio
      + (rel.leadingToneIntoB ? 0.25 : 0)
      + (rel.intervalClass === 5 || rel.intervalClass === 4 ? 0.1 : 0));
  }
  const [wIdentity, wJourney, wPrep] = ROLE_DIRECTION_WEIGHTS[window.role];
  return clamp01(wIdentity * identityFit + wJourney * journeyFit + wPrep * prepFit);
}

/* --- movement / pacing (§6) ----------------------------------------------- */

function movementFitScore(
  slices: PhraseSlice[],
  window: EvaluationWindow,
  facts: { structuralChanges: number },
  context: EvaluationContext,
): number {
  const spanTicks = window.endTick - window.startTick;
  if (spanTicks <= 0 || slices.length === 0) return 0.5;
  const bars = spanTicks / context.meter.barTicksValue;
  const actualCpb = facts.structuralChanges / Math.max(bars, 1e-6);
  // Intended pacing: the section's harmonic-rhythm preference (Phase 2,
  // meter-aware) skewed by the phrase's movement intent — NEVER a universal
  // changes-per-bar target (§6). Two-sided: churn and stagnation both cost.
  const movementIntent = clamp01((window.prefs.movement + window.direction.movement) / 2);
  const intended = window.prefs.changesPerBar * (0.5 + movementIntent);
  const fit = 1 - Math.abs(actualCpb - intended) / Math.max(intended, 0.5);
  return clamp01(fit);
}

/* --- cadence fit (§8) ------------------------------------------------------ */

function cadenceFitScore(
  slices: PhraseSlice[],
  window: EvaluationWindow,
  events: TimedHarmonicEvent[],
  context: EvaluationContext,
): number | null {
  if (!window.arrivalPlanned || slices.length === 0) return null;
  const arrivalSlice = slices.find((s) => s.isArrival) ?? slices[slices.length - 1];
  const arrivalF = arrivalSlice.event.foundation;
  const prevEvent = eventBefore(events, arrivalSlice.event.chord.startTick);
  const prevF = prevEvent !== null ? prevEvent.foundation : null;
  // The SAME single-implementation arrival fit the generator's search used —
  // the evaluator never re-invents cadence mathematics (§17).
  const sctx = structuralContext(window, context.pool, context.env, context.settings);
  const base = foundationArrivalFit(prevF, arrivalF, window.cadence.intention, sctx);
  const baseFit = Math.min(1, base / 1.4);
  const family = realizedFoundationFamily(prevF, arrivalF, sctx);
  const familyFit = family !== null
    ? (window.cadence.compatibleFamilies.includes(family) ? 1 : 0.4)
    : 0.3;
  // Preparation over several chords: the ≤2 harmonies before the arrival are
  // judged on how they lead INTO it (§8 — never the final chord alone).
  let prep = 0.35;
  {
    const before: FoundationInfo[] = [];
    for (let i = slices.length - 1; i >= 0 && before.length < 2; i--) {
      if (slices[i] === arrivalSlice) continue;
      before.push(slices[i].event.foundation);
    }
    if (before.length > 0) {
      let sum = 0;
      for (const f of before) {
        const rel = analyzeFoundationRelationship(f, arrivalF);
        sum += clamp01(0.7 * rel.coreCommonRatio + (rel.leadingToneIntoB ? 0.3 : 0));
      }
      prep = sum / before.length;
    }
  }
  return clamp01(0.5 * baseFit + 0.25 * familyFit + 0.25 * prep);
}

/* --- repetition & development (§9) ---------------------------------------- */

/** Proportional structural similarity between two spans' realized harmony:
 *  K sample points by relative position, foundation agreement — different
 *  lengths never invalidate a relationship (§9). */
function structuralSimilarity(
  a: { startTick: number; endTick: number },
  b: { startTick: number; endTick: number },
  events: TimedHarmonicEvent[],
): number {
  const K = 8;
  let agree = 0;
  for (let k = 0; k < K; k++) {
    const fa = eventSoundingAt(events, a.startTick + ((k + 0.5) / K) * (a.endTick - a.startTick));
    const fb = eventSoundingAt(events, b.startTick + ((k + 0.5) / K) * (b.endTick - b.startTick));
    if (fa === null && fb === null) { agree += 1; continue; }
    if (fa === null || fb === null) continue;
    if (fa.foundation.id === fb.foundation.id) agree += 1;
  }
  return agree / K;
}

function rhythmSimilarity(cpbA: number, cpbB: number): number {
  const max = Math.max(cpbA, cpbB, 0.5);
  return clamp01(1 - Math.abs(cpbA - cpbB) / max);
}

function repetitionDevelopmentScore(
  slices: PhraseSlice[],
  window: EvaluationWindow,
  facts: { changesPerBar: number },
  events: TimedHarmonicEvent[],
  context: EvaluationContext,
): number | null {
  if (window.relatedPhraseIds.length === 0 || slices.length === 0) return null;
  let refWindow: EvaluationWindow | null = null;
  for (const id of window.relatedPhraseIds) {
    const w = context.windowById.get(id);
    if (w !== undefined && w.startTick !== window.startTick) { refWindow = w; break; }
  }
  if (refWindow === null) return null;
  const refSlices = slicesForWindow(refWindow, events);
  if (refSlices.length === 0) return null;

  const similarity = structuralSimilarity(
    { startTick: window.startTick, endTick: window.endTick },
    { startTick: refWindow.startTick, endTick: refWindow.endTick },
    events,
  );
  const refCpb = (() => {
    const spanTicks = refWindow.endTick - refWindow.startTick;
    const bars = spanTicks / context.meter.barTicksValue;
    let changes = 0;
    for (let i = 1; i < refSlices.length; i++) {
      if (refSlices[i].event.foundation.id !== refSlices[i - 1].event.foundation.id) changes += 1;
    }
    return changes / Math.max(bars, 1e-6);
  })();
  const rhythmSim = rhythmSimilarity(facts.changesPerBar, refCpb);
  const lastA = slices[slices.length - 1].event.foundation;
  const lastB = refSlices[refSlices.length - 1].event.foundation;
  const arrivalSim = lastA.id === lastB.id ? 1
    : lastA.rootPc === lastB.rootPc ? 0.6
      : analyzeFoundationRelationship(lastA, lastB).coreCommonRatio;

  // What similarity SHOULD read, by this window's role: a repeat keeps the
  // idea recognizable; a develop keyword wants identity WITH variation; other
  // links are looser. Two-sided — total identity and total divergence both
  // fail their target (§9 "intentional variation").
  const target = window.role === 'repeat' ? 0.85
    : window.role === 'develop' ? 0.55
      : 0.35;
  const normDistance = Math.abs(similarity - target) / Math.max(target, 1 - target);
  return clamp01(0.6 * (1 - normDistance) + 0.25 * rhythmSim + 0.15 * arrivalSim);
}

/* --- chromatic coherence (§10) --------------------------------------------- */

function chromaticCoherenceScore(
  slices: PhraseSlice[],
  window: EvaluationWindow,
  events: TimedHarmonicEvent[],
): number {
  let chromaticDur = 0;
  let weighted = 0;
  for (const x of slices) {
    const f = x.event.foundation;
    if (f.diatonic) continue;
    chromaticDur += x.durationTicks;
    const prevEvent = eventBefore(events, x.event.chord.startTick);
    const nextEvent = eventAfter(events, x.event.chord.startTick + x.event.chord.durationTicks);
    let coherence = 0;
    if (prevEvent !== null) {
      const rel = analyzeFoundationRelationship(prevEvent.foundation, f);
      coherence = Math.max(coherence, rel.coreCommonRatio, rel.leadingToneIntoB ? 0.9 : 0);
    }
    if (nextEvent !== null) {
      const rel = analyzeFoundationRelationship(f, nextEvent.foundation);
      coherence = Math.max(coherence, rel.coreCommonRatio, rel.leadingToneIntoB ? 1 : 0);
    }
    // Contrast roles deliberately invite chromatic departure — a weaker
    // relationship is tolerable there when the section seeks contrast (§10:
    // context, never scale membership). A chromatic chord surrounded by
    // unrelated harmony in a neutral context stays weak.
    const contrastFloor = window.role === 'contrast' || window.role === 'develop' ? 0.45
      : window.prefs.contrast >= 0.6 ? 0.4 : 0;
    coherence = Math.max(coherence, contrastFloor);
    if (prevEvent === null && nextEvent === null) coherence = 0.2;
    weighted += coherence * x.durationTicks;
  }
  if (chromaticDur <= 0) return 1; // vacuously coherent — no chromatic content to judge
  return clamp01(weighted / chromaticDur);
}

/* --- color fit (§11) -------------------------------------------------------- */

function colorFitScore(
  slices: PhraseSlice[],
  window: EvaluationWindow,
  tonalIdentity: number,
): number {
  const totalDur = slices.reduce((s, x) => s + x.durationTicks, 0);
  if (totalDur <= 0) return 0.5;
  // The SAME richness target curve the color stage weights with (color.ts):
  // extensions available, never required; richer is never "better" (§11).
  const richnessTarget = 0.2 + 0.5 * window.prefs.complexity;
  let sum = 0;
  let susColorDur = 0;
  for (let i = 0; i < slices.length; i++) {
    const x = slices[i];
    let fit = 1 - Math.abs(x.event.tierRank - richnessTarget);
    // Arrival coloring: the color must support the intended arrival (§11).
    if (x.isArrival && window.arrivalPlanned) {
      const quality = x.event.parsed.quality;
      const stable = quality === 'major' || quality === 'minor';
      const suspendedColor = quality.includes('sus')
        || x.event.foundation.quality === 'suspended';
      let arrivalFit = 0.85;
      if (window.cadence.intention === 'resolved') {
        arrivalFit = stable && x.event.tierRank <= 0.5 ? 1 : suspendedColor ? 0.3 : 0.7;
      } else if (window.cadence.intention === 'suspended' || window.cadence.intention === 'ambiguous') {
        arrivalFit = suspendedColor ? 1 : 0.75;
      }
      fit = 0.75 * fit + 0.25 * arrivalFit;
    }
    // No triad→extension whiplash between neighbors (mild).
    if (i > 0 && Math.abs(x.event.tierRank - slices[i - 1].event.tierRank) >= 1) fit -= 0.1;
    if (x.event.parsed.quality.includes('sus')) susColorDur += x.durationTicks;
    sum += Math.max(0, fit) * x.durationTicks;
  }
  let score = sum / totalDur;
  // Repeated ambiguous suspension weakens tonal identity — the §11
  // interaction: suspension is legitimate color, but heavy suspension ON TOP
  // OF weak tonal identity costs color fit.
  const susShare = susColorDur / totalDur;
  score -= 0.25 * susShare * (1 - tonalIdentity);
  return clamp01(score);
}

/* ==========================================================================
 * evaluatePhrase (spec §12)
 * ======================================================================== */

/**
 * Evaluate one complete phrase span of a progression (spec §12):
 * `evaluatePhrase(phrase, chords, context)`. `phrase` is an evaluation
 * window (build one via buildEvaluationContext + context.windows — planned
 * phrases and synthetic neutral windows both work). Evaluates complete
 * phrase spans with actual durations, structural foundations, phrase
 * intentions and neighboring-harmony context; supports locked anchors (they
 * are ordinary timeline events) and all twelve modes.
 */
export function evaluatePhrase(
  phrase: EvaluationWindow,
  chords: Chord[],
  context: EvaluationContext,
): PhraseEvaluation {
  const { events } = buildTimeline(chords, context.project.key, context.project.mode);
  return evaluatePhraseWindow(phrase, events, context);
}

/** Internal single-implementation path used by the song evaluator (which has
 *  already built the timeline once for all phrases). */
function evaluatePhraseWindow(
  window: EvaluationWindow,
  events: TimedHarmonicEvent[],
  context: EvaluationContext,
): PhraseEvaluation {
  const slices = slicesForWindow(window, events);
  const totalDur = slices.reduce((s, x) => s + x.durationTicks, 0);

  // Objective facts first (§17) — the scores below read some of them.
  const foundationLabels: string[] = [];
  const foundationSeen = new Set<string>();
  let structuralChanges = 0;
  let chromaticDur = 0;
  let contactDur = 0;
  for (let i = 0; i < slices.length; i++) {
    const f = slices[i].event.foundation;
    if (!foundationSeen.has(f.id)) {
      foundationSeen.add(f.id);
      foundationLabels.push(foundationLabel(f));
    }
    if (i > 0 && slices[i - 1].event.foundation.id !== f.id) structuralChanges += 1;
    if (!f.diatonic) chromaticDur += slices[i].durationTicks;
    if (context.pool.symmetric
      ? f.rootPc === context.pool.tonic
      : reinforcesTonic(f, context.pool.tonic, context.pool.tonicTriadPcs)) {
      contactDur += slices[i].durationTicks;
    }
  }
  const bars = (window.endTick - window.startTick) / context.meter.barTicksValue;
  const arrivalSlice = slices.find((s) => s.isArrival) ?? null;
  const facts: PhraseFacts = {
    eventCount: slices.length,
    distinctFoundations: foundationSeen.size,
    foundationLabels,
    distinctRoots: new Set(slices.map((s) => s.event.foundation.rootPc)).size,
    structuralChanges,
    changesPerBar: structuralChanges / Math.max(bars, 1e-6),
    meanEventDurationTicks: slices.length > 0 ? Math.round(totalDur / slices.length) : 0,
    // Provisional — replaced by the duration-based computation below (§4).
    longestSustainBars: 0,
    tonalContactShare: totalDur > 0 ? contactDur / totalDur : 0,
    chromaticShare: totalDur > 0 ? chromaticDur / totalDur : 0,
    arrivalSymbol: arrivalSlice !== null ? arrivalSlice.event.chord.symbol : null,
    hasPlannedArrival: window.arrivalPlanned,
  };
  // Longest SUSTAINED harmony in bars (duration-based, §4 continuation): the
  // longest run of consecutive same-foundation slices by allocated time.
  {
    let runDur = 0;
    let bestDur = 0;
    for (let i = 0; i < slices.length; i++) {
      if (i > 0 && slices[i].event.foundation.id === slices[i - 1].event.foundation.id) {
        runDur += slices[i].durationTicks;
      } else {
        runDur = slices[i].durationTicks;
      }
      bestDur = Math.max(bestDur, runDur);
    }
    facts.longestSustainBars = bars > 0 ? bestDur / context.meter.barTicksValue : 0;
  }

  const tonalIdentity = tonalIdentityScore(slices, window, context);
  const harmonicDirection = harmonicDirectionScore(slices, window);
  const movementFit = movementFitScore(slices, window, { structuralChanges }, context);
  const cadenceFit = cadenceFitScore(slices, window, events, context);
  const repetitionDevelopment = repetitionDevelopmentScore(
    slices, window, { changesPerBar: facts.changesPerBar }, events, context,
  );
  const chromaticCoherence = chromaticCoherenceScore(slices, window, events);
  const colorFit = colorFitScore(slices, window, tonalIdentity);

  // Contextual weighted blend — role weights, null components skipped with
  // weight renormalization (§12: no arbitrary fixed weights regardless of
  // context; not-applicable categories never fabricate a number).
  const w = ROLE_PHRASE_WEIGHTS[window.role];
  const parts: Array<[number, number]> = [
    [w.tonalIdentity, tonalIdentity],
    [w.harmonicDirection, harmonicDirection],
    [w.movementFit, movementFit],
    [w.chromaticCoherence, chromaticCoherence],
    [w.colorFit, colorFit],
  ];
  if (cadenceFit !== null) parts.push([w.cadenceFit, cadenceFit]);
  if (repetitionDevelopment !== null) parts.push([w.repetitionDevelopment, repetitionDevelopment]);
  const weightSum = parts.reduce((s, [weight]) => s + weight, 0);
  const total = weightSum > 0
    ? parts.reduce((s, [weight, v]) => s + weight * v, 0) / weightSum
    : 0.5;

  return {
    key: window.phraseRef?.id ?? `@${window.startTick}`,
    phraseId: window.phraseRef?.id ?? null,
    sectionId: window.sectionId,
    sectionName: window.sectionId !== null
      ? context.plan.sections.find((s) => s.sectionId === window.sectionId)?.sectionName ?? null
      : null,
    synthetic: window.synthetic,
    role: window.role,
    cadenceIntention: window.cadence.intention,
    startTick: window.startTick,
    endTick: window.endTick,
    isSongEnd: window.isSongEnd,
    scores: {
      tonalIdentity, harmonicDirection, movementFit, cadenceFit,
      repetitionDevelopment, chromaticCoherence, colorFit, total,
    },
    facts,
  };
}

/* ==========================================================================
 * Whole-song evaluation (spec §13)
 * ======================================================================== */

/** Objective per-section summary of the realized harmony (§17). */
export interface SectionHarmonySummary {
  sectionId: string;
  sectionName: string;
  startTick: number;
  endTick: number;
  foundationLabels: string[];
  distinctRoots: number;
  changesPerBar: number;
  arrivalSymbol: string | null;
  /** Duration share of non-diatonic foundations. Descriptive. */
  chromaticShare: number;
}

/** One section seam: the planned boundary intention beside what the harmony
 *  actually does across it (objective facts + the heuristic fit). */
export interface SeamRecord {
  fromSectionId: string;
  toSectionId: string;
  boundaryIntention: BoundaryIntention | null;
  leavingFoundation: string | null;
  arrivingFoundation: string | null;
  sameFoundationSustained: boolean;
  fit: number;
}

/** Heuristic song-level components (§13, §17 — internal comparison tools). */
export interface SongComponents {
  /** Song-wide tonal identity (phrases + arrivals + final anchoring). */
  tonalIdentity: number;
  /** Realized transitions across planned section seams. */
  harmonicContinuity: number | null;
  /** Adjacent-section overlap against their relationship expectation. */
  sectionContrast: number | null;
  /** Structural identity preserved between related (repeated) sections. */
  repeatedSectionIdentity: number | null;
  /** Phrase-level development arc (opening identity, recurring motion
   *  vocabulary, directed ending). */
  phraseDevelopment: number | null;
  /** Planned arrivals, song end weighted highest. */
  arrivalQuality: number | null;
  /** Arrangement-level pacing against each section's preference (two-sided). */
  harmonicRhythmFit: number | null;
  /** Song-level chromatic coherence (duration-weighted). */
  chromaticCoherence: number;
}

export interface SongFacts {
  eventCount: number;
  /** Distinct foundation labels in first-appearance order. */
  foundationLabels: string[];
  distinctRoots: number;
  structuralChanges: number;
  changesPerBar: number;
  durationBars: number;
  unparsableSymbols: string[];
  sectionSummaries: SectionHarmonySummary[];
  seams: SeamRecord[];
  relatedSectionPairs: Array<{ a: string; b: string; role: string; similarity: number }>;
}

export interface SongEvaluation {
  /** 0..1 heuristic overall fit — the candidate-comparison signal. NOT an
   *  objective measure of musical quality (§17, §20). */
  total: number;
  components: SongComponents;
  /** Component weights the total actually consumed (transparency, §17).
   *  'phraseAggregate' is the duration-weighted mean of phrase totals — a
   *  structural-dominated aggregate whose color share is capped (§11). */
  weights: Partial<Record<keyof SongComponents | 'phraseAggregate', number>>;
  phrases: PhraseEvaluation[];
  facts: SongFacts;
}

/** Song-component weights. Structural relationships dominate; color enters
 *  ONLY through the phrase aggregate (whose internal color share is capped)
 *  — its worst-case influence on the total is < 5% versus structure's > 80%
 *  (§11 requirement). Heuristics for listening calibration, not constants. */
const SONG_WEIGHTS: Partial<Record<keyof SongComponents | 'phraseAggregate', number>> = {
  tonalIdentity: 0.16,
  harmonicContinuity: 0.1,
  sectionContrast: 0.05,
  repeatedSectionIdentity: 0.1,
  phraseDevelopment: 0.08,
  arrivalQuality: 0.14,
  harmonicRhythmFit: 0.09,
  chromaticCoherence: 0.06,
  phraseAggregate: 0.22,
};

/** How well the realized transition across one seam serves the planned
 *  boundary intention (§13 harmonic continuity). Symmetrical intentions get
 *  symmetrical treatment: smooth intentions fit smooth transitions, contrast
 *  intentions fit contrast — neither direction is privileged. */
function seamFit(
  intention: BoundaryIntention | null,
  leftF: FoundationInfo | null,
  rightF: FoundationInfo | null,
): number {
  if (leftF === null || rightF === null) return 0.5;
  const rel = analyzeFoundationRelationship(leftF, rightF);
  const same = leftF.id === rightF.id;
  switch (intention) {
    case 'continuation':
      return clamp01(same ? 1 : 0.3 + 0.7 * rel.coreCommonRatio);
    case 'suspension':
      return clamp01(same ? 1 : (rel.sameRootDifferentCore ? 0.9 : 0.3 + 0.6 * rel.coreCommonRatio));
    case 'preparation':
    case 'resolution':
      // Arriving SOMEWHERE meaningful: home, or a harmony strongly related to
      // the mode's center, or led-into by the leaving harmony.
      if (rel.leadingToneIntoB) return 0.9;
      return clamp01(0.35 + 0.45 * rel.coreCommonRatio + (rel.intervalClass === 5 ? 0.2 : 0));
    case 'contrast':
      return same ? 0.2 : clamp01(0.35 + 0.65 * (rel.intervalClass >= 3 ? 1 : rel.intervalClass / 3));
    case 'abrupt':
      return same ? 0.15 : clamp01(0.3 + 0.7 * (1 - rel.coreCommonRatio));
    default:
      return 0.5;
  }
}

/** Aggregate one section's realized harmony (objective facts). */
function sectionSummary(
  section: { sectionId: string; sectionName: string; startTick: number; durationTicks: number },
  events: TimedHarmonicEvent[],
  barTicksValue: number,
): SectionHarmonySummary {
  const endTick = section.startTick + section.durationTicks;
  const labels: string[] = [];
  const seen = new Set<string>();
  let changes = 0;
  let chromaticDur = 0;
  let totalDur = 0;
  let lastFoundation: FoundationInfo | null = null;
  for (const e of events) {
    const s = Math.max(e.chord.startTick, section.startTick);
    const t = Math.min(e.chord.startTick + e.chord.durationTicks, endTick);
    if (t <= s) continue;
    const dur = t - s;
    totalDur += dur;
    if (!seen.has(e.foundation.id)) { seen.add(e.foundation.id); labels.push(foundationLabel(e.foundation)); }
    if (lastFoundation !== null && lastFoundation.id !== e.foundation.id) changes += 1;
    lastFoundation = e.foundation;
    if (!e.foundation.diatonic) chromaticDur += dur;
  }
  const bars = section.durationTicks / barTicksValue;
  const arrival = eventSoundingAt(events, endTick - 1) ?? eventBefore(events, endTick);
  return {
    sectionId: section.sectionId,
    sectionName: section.sectionName,
    startTick: section.startTick,
    endTick,
    foundationLabels: labels,
    distinctRoots: new Set(
      events
        .filter((e) => e.chord.startTick < endTick && e.chord.startTick + e.chord.durationTicks > section.startTick)
        .map((e) => e.foundation.rootPc),
    ).size,
    changesPerBar: changes / Math.max(bars, 1e-6),
    arrivalSymbol: arrival !== null ? arrival.chord.symbol : null,
    chromaticShare: totalDur > 0 ? chromaticDur / totalDur : 0,
  };
}

/**
 * Evaluate a complete song progression (spec §13):
 * `evaluateSongProgression(project, chords, harmonyPlan)`.
 *
 * Examines the relationships an arrangement has and a phrase-by-phrase
 * average cannot see: section seams against their planned boundary
 * intentions, adjacent-section contrast, repeated-section structural
 * identity (colors may differ — §9), the phrase development arc, major
 * structural arrivals with the song end weighted highest, arrangement-level
 * harmonic rhythm against per-section preferences, and song-wide tonal
 * identity (symmetrical scales judged by recurrence/anchoring, §7).
 */
export function evaluateSongProgression(
  project: Project,
  chords: Chord[],
  harmonyPlan: SongHarmonyPlan,
): SongEvaluation {
  const context = buildEvaluationContext(project, harmonyPlan);
  const { events, unparsableSymbols } = buildTimeline(chords, project.key, project.mode);

  // --- phrase evaluations (the foundation of everything below) -------------
  const phrases = context.windows.map((w) => evaluatePhraseWindow(w, events, context));
  const totalPhraseDur = phrases.reduce((s, p) => s + (p.endTick - p.startTick), 0);
  const phraseAggregate = totalPhraseDur > 0
    ? phrases.reduce((s, p) => s + p.scores.total * (p.endTick - p.startTick), 0) / totalPhraseDur
    : 0.5;

  // --- section spans (plan sections; a sectionless plan has none) ----------
  const spans = context.plan.sections.map((s) => ({
    sectionId: s.sectionId,
    sectionName: s.sectionName,
    startTick: s.startTick,
    durationTicks: s.durationTicks,
  }));
  const summaries = spans.map((s) => sectionSummary(s, events, context.meter.barTicksValue));

  // --- harmonic continuity: section seams (§13) ----------------------------
  const seams: SeamRecord[] = [];
  for (let i = 0; i < context.plan.sections.length - 1; i++) {
    const a = context.plan.sections[i];
    const b = context.plan.sections[i + 1];
    const seamTick = b.startTick;
    const leftEvent = eventSoundingAt(events, seamTick - 1) ?? eventBefore(events, seamTick);
    const rightEvent = eventSoundingAt(events, seamTick) ?? eventAfter(events, seamTick);
    const leftF = leftEvent !== null ? leftEvent.foundation : null;
    const rightF = rightEvent !== null ? rightEvent.foundation : null;
    const intention = a.boundary !== null ? a.boundary.intention : null;
    const fit = seamFit(intention, leftF, rightF);
    seams.push({
      fromSectionId: a.sectionId,
      toSectionId: b.sectionId,
      boundaryIntention: intention,
      leavingFoundation: leftF !== null ? foundationLabel(leftF) : null,
      arrivingFoundation: rightF !== null ? foundationLabel(rightF) : null,
      sameFoundationSustained: leftF !== null && rightF !== null && leftF.id === rightF.id,
      fit,
    });
  }
  const harmonicContinuity = seams.length > 0
    ? seams.reduce((s, x) => s + x.fit, 0) / seams.length
    : null;

  // --- section contrast: adjacent-section overlap vs relationship (§13) ----
  let sectionContrast: number | null = null;
  if (summaries.length >= 2) {
    const setOf = (sectionId: string): Set<string> => {
      const start = spans.find((s) => s.sectionId === sectionId)!;
      const end = start.startTick + start.durationTicks;
      const ids = new Set<string>();
      for (const e of events) {
        if (e.chord.startTick < end && e.chord.startTick + e.chord.durationTicks > start.startTick) {
          ids.add(e.foundation.id);
        }
      }
      return ids;
    };
    let sum = 0;
    for (let i = 0; i < spans.length - 1; i++) {
      const A = setOf(spans[i].sectionId);
      const B = setOf(spans[i + 1].sectionId);
      const union = new Set([...A, ...B]);
      const jaccard = union.size > 0 ? [...A].filter((x) => B.has(x)).length / union.size : 1;
      const related = (context.profileFullBySection.get(spans[i].sectionId)?.development.relatedSectionIds
        ?? []).includes(spans[i + 1].sectionId);
      const target = related ? 0.85 : 0.35;
      sum += clamp01(1 - Math.abs(jaccard - target) / Math.max(target, 1 - target));
    }
    sectionContrast = sum / (spans.length - 1);
  }

  // --- repeated-section structural identity (§9, §13) ----------------------
  const relatedPairs: SongFacts['relatedSectionPairs'] = [];
  let repeatedSectionIdentity: number | null = null;
  {
    const orderOf = new Map(spans.map((s, i) => [s.sectionId, i]));
    for (const [sectionId, prefs] of context.profileFullBySection) {
      for (const rid of prefs.development.relatedSectionIds) {
        if (rid === sectionId) continue;
        const aIdx = orderOf.get(rid) ?? -1;
        const bIdx = orderOf.get(sectionId) ?? -1;
        if (aIdx < 0 || bIdx < 0 || aIdx >= bIdx) continue;
        const a = spans[aIdx];
        const b = spans[bIdx];
        const similarity = structuralSimilarity(
          { startTick: a.startTick, endTick: a.startTick + a.durationTicks },
          { startTick: b.startTick, endTick: b.startTick + b.durationTicks },
          events,
        );
        const role = context.profileFullBySection.get(sectionId)?.development.role ?? 'repeat';
        relatedPairs.push({ a: rid, b: sectionId, role, similarity: Math.round(similarity * 1000) / 1000 });
      }
    }
    if (relatedPairs.length > 0) {
      let sum = 0;
      for (const pair of relatedPairs) {
        // Same two-sided expectation logic as phrase-level repetition (§9):
        // repeats keep identity, developments vary around it.
        const target = pair.role === 'develop' ? 0.55 : pair.role === 'contrast' ? 0.3 : 0.85;
        const normDistance = Math.abs(pair.similarity - target) / Math.max(target, 1 - target);
        sum += clamp01(1 - normDistance);
      }
      repeatedSectionIdentity = sum / relatedPairs.length;
    }
  }

  // --- phrase development arc (§13) ----------------------------------------
  let phraseDevelopment: number | null = null;
  {
    const planned = phrases.filter((p) => !p.synthetic);
    const identityValues = phrases.map((p) => p.scores.tonalIdentity);
    const meanIdentity = identityValues.length > 0
      ? identityValues.reduce((s, v) => s + v, 0) / identityValues.length
      : 0.5;
    const parts: number[] = [];
    // (a) The opening establishes: the first planned phrase carries at least
    // average tonal identity.
    if (planned.length > 0) {
      parts.push(clamp01(1 - Math.max(0, meanIdentity - planned[0].scores.tonalIdentity) * 2));
    }
    // (b) The ending is directed: the last phrase's harmonic direction does
    // not fall below the song's average by much.
    if (planned.length > 1) {
      const meanDirection = planned.reduce((s, p) => s + p.scores.harmonicDirection, 0) / planned.length;
      const lastDirection = planned[planned.length - 1].scores.harmonicDirection;
      parts.push(clamp01(1 - Math.max(0, meanDirection - lastDirection) * 2));
    }
    // (c) Recurring motion vocabulary: root-motion interval classes used in
    // the first half of the song recur in the second half — development of
    // one harmonic idea rather than unrelated material.
    const changes: Array<{ tick: number; ic: number }> = [];
    for (let i = 1; i < events.length; i++) {
      const rel = analyzeFoundationRelationship(events[i - 1].foundation, events[i].foundation);
      if (rel.sameRoot) continue;
      changes.push({ tick: events[i].chord.startTick, ic: rel.intervalClass });
    }
    if (changes.length >= 4) {
      const mid = context.span.endTick / 2;
      const firstHalf = new Set(changes.filter((c) => c.tick < mid).map((c) => c.ic));
      const secondHalf = new Set(changes.filter((c) => c.tick >= mid).map((c) => c.ic));
      if (firstHalf.size > 0 && secondHalf.size > 0) {
        const union = new Set([...firstHalf, ...secondHalf]);
        const overlap = [...firstHalf].filter((ic) => secondHalf.has(ic)).length / union.size;
        parts.push(clamp01(0.3 + 0.7 * overlap));
      }
    }
    phraseDevelopment = parts.length > 0 ? parts.reduce((s, v) => s + v, 0) / parts.length : null;
  }

  // --- arrival quality (§13): planned arrivals, song end weighted highest --
  let arrivalQuality: number | null = null;
  {
    let sum = 0;
    let weightSum = 0;
    for (const p of phrases) {
      if (p.scores.cadenceFit === null) continue;
      const weight = p.isSongEnd ? 2 : 1;
      sum += weight * p.scores.cadenceFit;
      weightSum += weight;
    }
    if (weightSum > 0) arrivalQuality = sum / weightSum;
  }

  // --- harmonic rhythm across the arrangement (§13, two-sided) --------------
  let harmonicRhythmFit: number | null = null;
  if (summaries.length > 0) {
    let sum = 0;
    let count = 0;
    for (const s of summaries) {
      const prefs = context.profileBySection.get(s.sectionId) ?? null;
      if (prefs === null) continue;
      const preferred = prefs.rhythm.preferredChangesPerBar;
      sum += clamp01(1 - Math.abs(s.changesPerBar - preferred) / Math.max(preferred, 0.5));
      count += 1;
    }
    if (count > 0) harmonicRhythmFit = sum / count;
  }

  // --- song-wide tonal identity (§7) ----------------------------------------
  let tonalIdentity: number;
  {
    const durWeighted = totalPhraseDur > 0
      ? phrases.reduce((s, p) => s + p.scores.tonalIdentity * (p.endTick - p.startTick), 0) / totalPhraseDur
      : 0.5;
    const lastEvent = events.length > 0 ? events[events.length - 1] : null;
    const endAnchor = lastEvent === null ? 0.5
      : context.pool.symmetric
        ? (lastEvent.foundation.rootPc === context.pool.tonic ? 1 : 0.4)
        : (reinforcesTonic(lastEvent.foundation, context.pool.tonic, context.pool.tonicTriadPcs)
          ? 1
          : tonicChordRelationship(lastEvent.foundation, context.pool));
    tonalIdentity = clamp01(0.75 * durWeighted + 0.25 * endAnchor);
  }

  // --- song-level chromatic coherence ---------------------------------------
  const chromaticCoherence = totalPhraseDur > 0
    ? phrases.reduce((s, p) => s + p.scores.chromaticCoherence * (p.endTick - p.startTick), 0) / totalPhraseDur
    : 1;

  const components: SongComponents = {
    tonalIdentity,
    harmonicContinuity,
    sectionContrast,
    repeatedSectionIdentity,
    phraseDevelopment,
    arrivalQuality,
    harmonicRhythmFit,
    chromaticCoherence,
  };

  // Weighted total over the components that EXIST (null components are
  // genuinely not applicable — their weight is redistributed, §13 "not a
  // simple average" and never a fabricated number).
  const weightEntries: Array<[keyof SongComponents | 'phraseAggregate', number, number]> = [];
  for (const [name, weight] of Object.entries(SONG_WEIGHTS) as Array<[keyof SongComponents | 'phraseAggregate', number]>) {
    const value = name === 'phraseAggregate' ? phraseAggregate : components[name];
    if (value === null || value === undefined) continue;
    weightEntries.push([name, value, weight]);
  }
  const wSum = weightEntries.reduce((s, [, , weight]) => s + weight, 0);
  const total = wSum > 0
    ? weightEntries.reduce((s, [, v, weight]) => s + v * weight, 0) / wSum
    : 0.5;

  // Objective song facts (§17).
  const songLabels: string[] = [];
  const songSeen = new Set<string>();
  let songChanges = 0;
  for (let i = 0; i < events.length; i++) {
    const f = events[i].foundation;
    if (!songSeen.has(f.id)) { songSeen.add(f.id); songLabels.push(foundationLabel(f)); }
    if (i > 0 && events[i - 1].foundation.id !== f.id) songChanges += 1;
  }
  const songBars = (context.span.endTick - context.span.startTick) / context.meter.barTicksValue;
  const facts: SongFacts = {
    eventCount: events.length,
    foundationLabels: songLabels,
    distinctRoots: new Set(events.map((e) => e.foundation.rootPc)).size,
    structuralChanges: songChanges,
    changesPerBar: songChanges / Math.max(songBars, 1e-6),
    durationBars: songBars,
    unparsableSymbols,
    sectionSummaries: summaries,
    seams,
    relatedSectionPairs: relatedPairs,
  };

  const weightsUsed: Partial<Record<keyof SongComponents | 'phraseAggregate', number>> = {};
  for (const [name, , weight] of weightEntries) {
    weightsUsed[name] = weight;
  }

  return { total, components, weights: weightsUsed, phrases, facts };
}
