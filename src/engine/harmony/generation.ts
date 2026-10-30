/**
 * Chord progression generation (Phase 4.1) — the first Crescode engine stage
 * that CREATES chord events (spec §1).
 *
 * Pipeline per request:
 *   1. resolve scope → preserved chords, removed chords, generation targets
 *      (coverage.ts — locked chords and out-of-scope harmony are untouchable)
 *   2. build the Phase 2/3 planning backdrop (profiles + song harmony plan)
 *   3. clip phrase windows onto each target (synthesizing neutral windows
 *      where no section exists — projects without sections stay first-class)
 *   4. plan harmonic rhythm per target (rhythm.ts — WHEN chords change)
 *   5. STAGE A — select STRUCTURAL harmony per window (progression.ts over
 *      foundation.ts): a sequence of harmonic foundations with phrase-level
 *      trajectory evaluation, tonal-center awareness and diversity-aware
 *      search; anchors and repeated material enter as foundations
 *   6. merge same-foundation slot runs into sustained harmonic events
 *      (spec §9 — prolongation by default, never automatic re-chords)
 *   7. STAGE B — apply harmonic COLOR per event (color.ts): richness,
 *      continuity and arrival-aware chord symbols from the foundation's
 *      parser-validated palette; complexity can no longer steer the harmony
 *   8. emit events, assemble the full chord array + report
 *
 * Musical guarantees (spec §5, §11, §12, §16): integer ticks at 960 PPQ,
 * exact target coverage (no gaps, no overlaps, nothing outside the region,
 * no zero/negative durations), existing chords preserved byte-for-byte,
 * manually written chromatic chords treated as valid anchors, no score
 * floors and no arbitrary prohibitions.
 *
 * Determinism (spec §13): every random decision rides Crescode's seeded
 * PRNG over domain-separated streams; identical (project, settings, scope,
 * seed) produce byte-identical results. The seed is read, never advanced or
 * persisted — the application layer owns that. No React, no Zustand, no
 * async, no new dependencies.
 */
import {
  DEFAULT_CHORDGEN_SETTINGS, type Chord, type ChordGenSettings, type Project,
} from '../../shared/schema/types';
import { barToTick, barTicks, projectBars } from '../../shared/schema/meter';
import { scalePitchClasses } from '../../shared/schema/modes';
import { hashString, mulberry32 } from '../generate';
import { buildSongHarmonyProfiles } from './profiles';
import { planSongHarmony } from './plan';
import { cadenceEnvironment, compatibleCadenceFamilies } from './cadences';
import { applyHarmonicColor, type PreviousColor } from './color';
import {
  advanceTensionState, analyzeFoundationRelationship, buildFoundationPool, foundationInfoFromSymbol,
  foundationLabel, foundationTransitionScoreDetailed, reinforcesTonic, seedTensionState,
  stabilityEvidence, realizedFoundationFamily,
  type FoundationInfo, type FoundationPool, type StructuralContext,
} from './foundation';
import {
  positionScoreDetailed, phraseContrastPenalty, selectWindowFoundations, structuralContext,
  type MaterialReference, type PriorPhraseFeatures, type SelectionTrace, type SelectionWindow,
} from './progression';
import {
  classifyColorOperation, classifyTransition, createDiagnosticCollector, extractAlternatives,
  foundationFactsRecord, signedRootMovement,
  type ColorDecisionRecord, type RhythmSlotRecord, type StructuralSlotRecord, type WindowRecord,
} from './diagnostics';
import { meterFacts, planRhythmSlots, type RhythmSlot, type RhythmWindowInput } from './rhythm';
import { resolveScopePlan, generationRegionEnd, engineSongSpanTicks } from './coverage';
import type {
  BoundaryIntention, CadenceEnvironment, CadenceFamily, HarmonicPhrase, PhraseRole, RhythmShape,
  SectionHarmonicGoal,
} from './types';
import type { ColorObservation } from './color';
import type {
  ChordGenerationResult, ChordGenerationReport, GenerateProgressionOptions, GenerationScope,
} from './generation-types';

/* Settings-derived neutral anchors (mirrors profiles.ts's documented tables). */
const COMPLEXITY_ANCHOR: Record<ChordGenSettings['complexity'], number> = { 1: 0.35, 2: 0.5, 3: 0.65 };
const DENSITY_ANCHOR: Record<ChordGenSettings['density'], number> = { 0: 1, 1: 2, 2: 3 };

export interface PlannedPhraseInfo {
  phrase: HarmonicPhrase;
  sectionId: string;
  isSectionLast: boolean;
  /** The section's sampled harmonic goal (story pass). */
  sectionGoal: SectionHarmonicGoal | null;
  boundaryIntoNext: BoundaryIntention | null;
}

export interface WindowPrefs {
  stability: number; movement: number; complexity: number; tension: number; modal: number; contrast: number;
  changesPerBar: number; shape: RhythmShape;
}

/** Structural subset of SectionHarmonyProfile this module reads. */
export interface SectionProfilePrefs {
  stability: { preferred: number }; movement: { preferred: number }; complexity: { preferred: number };
  tension: { preferred: number }; modalEmphasis: { preferred: number }; contrast: { preferred: number };
  rhythm: { preferredChangesPerBar: number; shape: RhythmShape };
}

export function prefsFromProfile(
  profile: SectionProfilePrefs | undefined,
  settings: ChordGenSettings,
): WindowPrefs {
  if (!profile) {
    return {
      stability: 0.5, movement: 0.5, complexity: COMPLEXITY_ANCHOR[settings.complexity],
      tension: 0.5, modal: 0.3 + 0.4 * settings.modalEmphasis, contrast: 0.5,
      changesPerBar: DENSITY_ANCHOR[settings.density], shape: 'regular',
    };
  }
  const p = profile;
  return {
    stability: p.stability.preferred,
    movement: p.movement.preferred,
    complexity: p.complexity.preferred,
    tension: p.tension.preferred,
    modal: p.modalEmphasis.preferred,
    contrast: p.contrast.preferred,
    changesPerBar: p.rhythm.preferredChangesPerBar,
    shape: p.rhythm.shape,
  };
}

/** Flatten the song plan into chronological phrase info with boundary context. */
export function flattenPhrases(
  plan: ReturnType<typeof planSongHarmony>,
): { phrases: PlannedPhraseInfo[]; byId: Map<string, PlannedPhraseInfo> } {
  const phrases: PlannedPhraseInfo[] = [];
  const byId = new Map<string, PlannedPhraseInfo>();
  for (const section of plan.sections) {
    section.phrases.forEach((phrase, i) => {
      const info: PlannedPhraseInfo = {
        phrase,
        sectionId: section.sectionId,
        isSectionLast: i === section.phrases.length - 1,
        sectionGoal: section.goal,
        boundaryIntoNext: i === section.phrases.length - 1 && section.boundary
          ? section.boundary.intention
          : null,
      };
      phrases.push(info);
      byId.set(phrase.id, info);
    });
  }
  return { phrases, byId };
}

/**
 * The project view the planning backdrop is built from: sectionless songs get
 * one neutral synthetic section covering the song span, so a song without
 * sections stays a first-class planning citizen. Purely a view — the input
 * project is never mutated. (Phase 5: exported so the evaluation layer
 * rebuilds the EXACT backdrop a generation run used — single implementation.)
 */
export function planningProjectFor(project: Project): Project {
  if (project.sections.length > 0) return project;
  return {
    ...project,
    sections: [{ id: '(song)', name: 'Song', startBar: 1, lengthBars: Math.max(1, projectBars(project)) }],
  };
}

/**
 * Clip the plan's phrase windows onto a generation target; synthesize neutral
 * windows for sub-spans the plan does not cover (song tails beyond the last
 * section, projects without sections, gaps between sections).
 */
export function windowsForTarget(
  target: { startTick: number; endTick: number },
  planned: PlannedPhraseInfo[],
  profileBySection: Map<string, SectionProfilePrefs>,
  settings: ChordGenSettings,
  env: CadenceEnvironment,
  isRegionEnd: boolean,
): SelectionWindow[] {
  const raw: Array<{ start: number; end: number; info: PlannedPhraseInfo | null }> = [];
  for (const info of planned) {
    const p = info.phrase;
    const start = Math.max(p.startTick, target.startTick);
    const end = Math.min(p.startTick + p.durationTicks, target.endTick);
    if (end > start) raw.push({ start, end, info });
  }
  raw.sort((a, b) => a.start - b.start);

  const windows: SelectionWindow[] = [];
  let cursor = target.startTick;
  const pushSynthetic = (start: number, end: number) => {
    if (end <= start) return;
    const isSongEnd = isRegionEnd && end === target.endTick;
    const role: PhraseRole = isSongEnd ? 'conclude' : 'continue';
    const intention = isSongEnd ? 'resolved' as const : 'open' as const;
    windows.push({
      startTick: start,
      endTick: end,
      role,
      direction: { stability: 0.5, movement: 0.5, tension: 0.5 },
      cadence: { intention, compatibleFamilies: compatibleCadenceFamilies(env, { role }) },
      sectionId: null,
      isSectionStart: start === 0,
      boundaryIntoNext: null,
      relatedPhraseIds: [],
      arrivalPlanned: true,
      phraseRef: null,
      sectionGoal: null,
      isSectionLast: false,
      sectionArrivalRoots: [],
      priorPhraseFeatures: null,
      prefs: prefsFromProfile(undefined, settings),
    });
  };
  for (const w of raw) {
    pushSynthetic(cursor, w.start);
    const info = w.info!;
    const p = info.phrase;
    const profile = profileBySection.get(info.sectionId);
    windows.push({
      startTick: w.start,
      endTick: w.end,
      role: p.role,
      direction: { ...p.direction },
      cadence: { intention: p.cadence.intention, compatibleFamilies: [...p.cadence.compatibleFamilies] },
      sectionId: info.sectionId,
      isSectionStart: p.index === 0,
      boundaryIntoNext: info.isSectionLast ? info.boundaryIntoNext : null,
      relatedPhraseIds: [...p.relatedPhraseIds],
      arrivalPlanned: w.end === p.startTick + p.durationTicks,
      phraseRef: p,
      sectionGoal: info.sectionGoal,
      isSectionLast: info.isSectionLast,
      sectionArrivalRoots: [],
      priorPhraseFeatures: null,
      prefs: prefsFromProfile(profile, settings),
    });
    cursor = w.end;
  }
  pushSynthetic(cursor, target.endTick);
  return windows;
}

/** Structural material for a linked phrase: this run's foundations, else the
 *  existing chords sounding through the related phrase's span (spec §10, §15).
 *  Self-references are skipped — a phrase never reuses itself. */
function materialForPhrase(
  relatedIds: string[],
  ownId: string | null,
  byId: Map<string, PlannedPhraseInfo>,
  chosenByPhrase: Map<string, FoundationInfo[]>,
  project: Project,
): MaterialReference | null {
  for (const id of relatedIds) {
    if (ownId !== null && id === ownId) continue;
    let foundations: FoundationInfo[] | null = null;
    let intention: MaterialReference['intention'] = null;
    const chosen = chosenByPhrase.get(id);
    if (chosen !== undefined && chosen.length > 0) {
      foundations = chosen;
    } else {
      const info = byId.get(id);
      if (!info) continue;
      const p = info.phrase;
      const end = p.startTick + p.durationTicks;
      const inside = project.chords
        .filter((c) => c.startTick >= p.startTick && c.startTick < end)
        .sort((a, b) => a.startTick - b.startTick)
        .map((c) => foundationInfoFromSymbol(c.symbol, project.key, project.mode))
        .filter((f): f is FoundationInfo => f !== null);
      if (inside.length > 0) {
        foundations = inside;
      } else {
        const sounding = project.chords
          .filter((c) => c.startTick <= p.startTick && c.startTick + c.durationTicks > p.startTick)
          .sort((a, b) => a.startTick - b.startTick);
        if (sounding.length > 0) {
          const f = foundationInfoFromSymbol(sounding[0].symbol, project.key, project.mode);
          if (f) foundations = [f];
        }
      }
      intention = p.cadence.intention;
    }
    if (!foundations || foundations.length === 0) continue;
    // Collapse consecutive duplicates: reuse maps chord content, not slots.
    const collapsed = foundations.filter((f, i) => i === 0 || f.id !== foundations![i - 1].id);
    return { foundations: collapsed, mode: 'full', intention };
  }
  return null;
}

/** Deterministic chord ids that cannot collide with preserved events. */
function makeIdFactory(seed: number, existing: Chord[]): (n: number) => string {
  const used = new Set(existing.map((c) => c.id));
  return (n: number) => {
    let id = `chd_g${seed.toString(36)}_${n}`;
    while (used.has(id)) id += 'x';
    used.add(id);
    return id;
  };
}

/** One sustained structural event: a foundation plus the exact span it holds. */
interface StructuralEvent {
  foundation: FoundationInfo;
  startTick: number;
  durationTicks: number;
  startWindowIndex: number;
  endWindowIndex: number;
  slotCount: number;
  /** Global (run-wide) index of this event — used by diagnostics records. */
  eventIndex: number;
}

/**
 * Generate a chord progression for the requested scope.
 *
 * Returns the FULL replacement chord array (preserved + generated; see
 * ChordGenerationResult) plus a diagnostic report. Pure and deterministic;
 * the input project is never mutated.
 */
export function generateChordProgression(
  project: Project,
  options: GenerateProgressionOptions = {},
): ChordGenerationResult {
  const settings: ChordGenSettings = {
    ...DEFAULT_CHORDGEN_SETTINGS,
    ...(project.chordGenSettings ?? {}),
    ...(options.settings ?? {}),
  };
  const seed = options.seed ?? settings.seed;
  const scope: GenerationScope = options.scope ?? { type: 'all' };
  const warnings: string[] = [];

  // 1) Scope → keep / removed / targets.
  const plan = resolveScopePlan(project, scope);
  if (scope.type === 'section' && plan.regionEnd <= plan.regionStart) {
    warnings.push('Requested section was not found — nothing was generated.');
  }
  const regionEnd = plan.regionEnd;

  // 2) Planning backdrop (a neutral synthetic section covers sectionless songs).
  const planProject = planningProjectFor(project);
  const songPlan = planSongHarmony(planProject, { seed });
  const profiles = buildSongHarmonyProfiles(planProject);
  const profileBySection = new Map<string, SectionProfilePrefs>(
    profiles.map((p) => [p.sectionId, p.preferences as SectionProfilePrefs]),
  );
  const { phrases: plannedPhrases, byId } = flattenPhrases(songPlan);
  const env = cadenceEnvironment(project.key, project.mode);
  const meter = meterFacts(project.timeSignature);
  // STAGE SEPARATION (Phase 4.1): the foundation pool is the structural
  // possibility space; the colored pool inside it is the palette.
  const pool: FoundationPool = buildFoundationPool(project.key, project.mode, settings);
  if (pool.all.length === 0) warnings.push('Candidate pool was empty — no chords could be generated.');
  const sctx: StructuralContext = {
    stability: 0.5, movement: 0.5, tension: 0.5, modalPref: 0.5, contrastPref: 0.5,
    borrowing: settings.borrowing, role: '', pool, env,
  };

  // 3..8) Targets → windows → slots → structural selection → merge → color.
  const chosenByPhrase = new Map<string, FoundationInfo[]>();
  const generated: Chord[] = [];
  const familiesUsed = new Set<string>();
  const structuralCadences: ChordGenerationReport['structuralCadences'] = [];
  const sectionsAffected = new Set<string>();
  const borrowedColorSet = new Set<string>();
  const foundationOrder: string[] = [];
  const foundationSeen = new Set<string>();
  const distinctRootsPerPhrase: number[] = [];
  let sameFoundationRepetitions = 0;
  let colorOnlyChanges = 0;
  let tonicReinforcementEvents = 0;
  let phraseWindowCount = 0;
  let continuationSlotCount = 0;
  let sustainedEventCount = 0;
  // Story pass: section arrival sequences + prior-phrase shapes (goal and
  // contrast evaluation consume them), and the realized-movement counters.
  const sectionArrivalRoots = new Map<string, number[]>();
  const priorFeaturesBySection = new Map<string, PriorPhraseFeatures>();
  const arrivalFamiliesBySection = new Map<string, Array<CadenceFamily | null>>();
  let harmonicRhythmSwaps = 0;
  let phraseContrastPenalties = 0;
  let nextId = 0;
  const nextChordId = makeIdFactory(seed, project.chords);

  // Phase 4.2 diagnostics — created ONLY when requested; strictly
  // observational (no rng consumption, no ordering changes, no score edits).
  const diag = options.diagnostics === true
    ? createDiagnosticCollector({
        project, settings, seed, scope,
        regionStart: plan.regionStart, regionEnd,
        pool, profiles, plan: songPlan,
        anchorBefore: plan.targets[0]?.before?.symbol ?? null,
        anchorAfter: plan.targets[0]?.after?.symbol ?? null,
        protectedSpans: plan.keep.filter((c) =>
          c.startTick < regionEnd && c.startTick + c.durationTicks > plan.regionStart).length,
        warnings: [...warnings],
        preservedCount: plan.keep.length,
      }).report
    : null;
  const scalePcs = diag !== null ? scalePitchClasses(project.key, project.mode) : [];
  let nextEventIndex = 0;
  let nextSlotIndex = 0;
  const generatedFoundations: FoundationInfo[] = [];

  const targets = plan.targets;
  for (let ti = 0; ti < targets.length; ti++) {
    const target = targets[ti];
    const isRegionEnd = ti === targets.length - 1 && target.endTick === regionEnd;
    const windows = windowsForTarget(target, plannedPhrases, profileBySection, settings, env, isRegionEnd);
    phraseWindowCount += windows.length;

    // Harmonic rhythm across the whole target.
    const rhythmRng = mulberry32(hashString(['crescode:gen:rhythm', String(target.startTick), String(target.endTick), String(seed)].join('|')));
    const rhythmInputs: RhythmWindowInput[] = windows.map((w) => ({
      startTick: w.startTick, endTick: w.endTick,
      changesPerBar: w.prefs.changesPerBar, shape: w.prefs.shape,
    }));
    const slots: RhythmSlot[] = planRhythmSlots(target, rhythmInputs, meter, rhythmRng, settings.variation);
    if (slots.length === 0) continue;

    // Slot slices per window.
    const slices: RhythmSlot[][] = windows.map(() => []);
    for (const slot of slots) slices[slot.windowIndex]?.push(slot);

    // Diagnostics: rhythm-slot records (spec §7). Flags are filled during the
    // emission loop below; the continuation model is stated in the report.
    const slotRecords: RhythmSlotRecord[] = [];
    let srCursor = 0;
    if (diag !== null) {
      const posInWindow = new Map<RhythmSlot, number>();
      for (let wi = 0; wi < windows.length; wi++) {
        (slices[wi] ?? []).forEach((s, i) => posInWindow.set(s, i));
      }
      slots.forEach((slot, idx) => {
        const w = windows[slot.windowIndex];
        slotRecords.push({
          slotIndex: nextSlotIndex + idx,
          startTick: slot.startTick,
          durationTicks: slot.durationTicks,
          windowIndex: slot.windowIndex,
          phraseId: w.phraseRef?.id ?? null,
          sectionId: w.sectionId,
          positionInPhrase: posInWindow.get(slot) ?? 0,
          phraseSlotCount: (slices[slot.windowIndex] ?? []).length,
          phraseEnd: slot.phraseEnd,
          preference: { changesPerBar: w.prefs.changesPerBar, shape: w.prefs.shape },
          // Phase 4.3B: the planner proposes OPPORTUNITIES, not changes.
          // Filled during the emission loop — true only for slots where no
          // continuation option existed AND a new foundation was selected.
          plannerForcesNewFoundation: false,
          continuationRealizedStructurally: false,
          mergedIntoPreviousEvent: false,
          previousHarmonySustained: false,
          newFoundationSelected: true,
          continuationDecision: null,
        });
      });
      diag.rhythm.slots.push(...slotRecords);
      nextSlotIndex += slots.length;
    }

    // Sustain-across-boundary decisions (intention-driven, seeded, spec §8).
    const mergeFirst = windows.map(() => false);
    for (let wi = 1; wi < windows.length; wi++) {
      const prevWindow = windows[wi - 1];
      const suspends = prevWindow.cadence.intention === 'suspended' || prevWindow.cadence.intention === 'ambiguous';
      const flows = prevWindow.boundaryIntoNext === 'continuation' || prevWindow.boundaryIntoNext === 'suspension';
      if (!(suspends || flows)) continue;
      const mergeRng = mulberry32(hashString(['crescode:gen:merge', String(target.startTick), String(wi), String(seed)].join('|')));
      if (mergeRng() < 0.3 + 0.3 * prevWindow.direction.stability) mergeFirst[wi] = true;
    }

    // Structural context walks the windows, chaining the sounding foundation.
    let prev: FoundationInfo | null = target.before
      ? foundationInfoFromSymbol(target.before.symbol, project.key, project.mode)
      : null;
    if (target.before && prev === null) {
      warnings.push(`Anchor symbol "${target.before.symbol}" could not be parsed — continuity context reduced.`);
    }
    // The sounding trail: foundations realized so far in this target, in
    // order. The next window's loop detection sees the tail (≤2 before the
    // incoming foundation) so oscillation shapes cannot hide at a boundary.
    const soundingTrail: FoundationInfo[] = [];
    const after: FoundationInfo | null = target.after
      ? foundationInfoFromSymbol(target.after.symbol, project.key, project.mode)
      : null;
    if (target.after && after === null) {
      warnings.push(`Anchor symbol "${target.after.symbol}" could not be parsed — continuity context reduced.`);
    }

    // Structural events accumulate per target; a CONTINUED foundation (the
    // selector's explicit hold decision, Phase 4.3B) and any same-foundation
    // slot run merge into one sustained harmonic event (spec §8, §9).
    const targetEvents: StructuralEvent[] = [];
    let prevSlotFoundation: FoundationInfo | null = prev;
    let lastStructRec: StructuralSlotRecord | null = null;
    const eventOfRec = new Map<RhythmSlotRecord, StructuralEvent>();
    for (let wi = 0; wi < windows.length; wi++) {
      const window = windows[wi];
      const windowSlots = slices[wi] ?? [];
      if (windowSlots.length === 0) continue;

      // Repeated material (spec §10, §15): full reuse when the plan links
      // this phrase to earlier material as a repeat — by role, or through a
      // CROSS-SECTION link. preserveIdentity gates the whole mechanism;
      // without it related sections develop independently.
      let material: MaterialReference | null = null;
      if (settings.preserveIdentity && window.relatedPhraseIds.length > 0) {
        const crossLink = window.phraseRef !== null
          && window.relatedPhraseIds.some((id) =>
            window.sectionId === null || !id.startsWith(`${window.sectionId}#`));
        if (window.role === 'repeat' || crossLink) {
          material = materialForPhrase(
            window.relatedPhraseIds, window.phraseRef?.id ?? null, byId, chosenByPhrase, project,
          );
        }
      }

      const prevAtWindowStart = prev;
      // Story-pass context: the section's arrival sequence so far and the
      // previous phrase's observable shape, consumed by the whole-path
      // evaluation (section goal + phrase-to-phrase contrast).
      const storyKey = window.sectionId ?? '(gaps)';
      window.sectionArrivalRoots = [...(sectionArrivalRoots.get(storyKey) ?? [])];
      window.priorPhraseFeatures = priorFeaturesBySection.get(storyKey) ?? null;
      const selectRng = mulberry32(hashString(
        ['crescode:gen:select', String(window.startTick), String(window.endTick), window.phraseRef?.id ?? `syn${wi}`, String(seed)].join('|'),
      ));
      const trace: SelectionTrace | undefined = diag !== null
        ? {
            mode: 'beam', reuseReason: null, forcedFirst: null, developOpeningOverride: null,
            poolSize: pool.all.length, slotCount: windowSlots.length,
            beam: null, material: null, pathEvaluation: null, pathLabels: [],
          }
        : undefined;
      const output = selectWindowFoundations({
        window, slots: windowSlots, pool, env, prev, after,
        material, settings, rng: selectRng,
        forcedFirst: mergeFirst[wi] && prev !== null ? prev : null,
        isSongEnd: isRegionEnd,
        // ≤2 realized foundations before the incoming one — the trail's tail
        // minus `prev` itself (the incoming foundation is passed as prev).
        history: soundingTrail.length >= 1
          ? soundingTrail.slice(Math.max(0, soundingTrail.length - 3), soundingTrail.length - 1)
          : [],
        trace,
      });

      // Audible-motion alignment (rhythm ↔ structure): the rhythm planner
      // proposes slots without knowing where foundation changes landed. When
      // a change sits on a WEAK slot (shorter than its successor) and the new
      // harmony sustains adjacent, the change moves onto the strong slot and
      // the weak slot sustains the outgoing harmony instead. Bounded to
      // within-window; never moves a planned arrival or a forced first slot.
      // Swapped slots report no searched scores — the search did not decide
      // them (the same honesty rule as forcedFirst).
      const swappedSlots = new Set<number>();
      for (let si = 1; si + 1 < output.foundations.length && si + 1 < windowSlots.length; si++) {
        const slot = windowSlots[si]!;
        const nextSlot = windowSlots[si + 1]!;
        if (slot.phraseEnd) continue;
        if (output.actions[si] !== 'change') continue;
        if (output.actions[si + 1] !== 'continue') continue;
        if (slot.durationTicks >= nextSlot.durationTicks) continue;
        const fNew = output.foundations[si]!;
        const held = output.foundations[si - 1]!;
        if (fNew.id === held.id) continue;
        output.foundations[si] = held;
        output.foundations[si + 1] = fNew;
        output.actions[si] = 'continue';
        output.actions[si + 1] = 'change';
        swappedSlots.add(si);
        swappedSlots.add(si + 1);
        harmonicRhythmSwaps += 1;
      }

      // Diagnostics: window record with the full selection trace (spec §6, §9, §10).
      if (diag !== null && trace !== undefined) {
        const winRec: WindowRecord = {
          targetIndex: ti,
          windowIndex: wi,
          startTick: window.startTick,
          endTick: window.endTick,
          sectionId: window.sectionId,
          phraseId: window.phraseRef?.id ?? null,
          synthetic: window.phraseRef === null,
          role: window.role,
          direction: { ...window.direction },
          cadenceIntention: window.cadence.intention,
          compatibleFamilies: [...window.cadence.compatibleFamilies],
          arrivalPlanned: window.arrivalPlanned,
          isSectionStart: window.isSectionStart,
          boundaryIntoNext: window.boundaryIntoNext,
          relatedPhraseIds: [...window.relatedPhraseIds],
          prefs: { ...window.prefs },
          slotCount: windowSlots.length,
          selection: trace,
          // Phase 4.3B: filled in after the window's emission loop below.
          continuation: {
            opportunities: 0, changes: 0, continuations: 0,
            meanSustainedDurationTicks: 0, structuralChangesPerBar: 0,
            phraseMovementPreference: window.direction.movement,
            sectionMovementPreference: window.prefs.movement,
            actualActivity: 0,
          },
        };
        diag.structure.windows.push(winRec);
      }

      // Emit slots → structural events with foundation-based merging.
      for (let si = 0; si < output.foundations.length && si < windowSlots.length; si++) {
        const f = output.foundations[si];
        const slot = windowSlots[si];
        const last = targetEvents[targetEvents.length - 1];
        const adjacent = last !== undefined && last.startTick + last.durationTicks === slot.startTick;
        const withinWindow = last !== undefined && last.endWindowIndex === wi;
        const crossWindow = last !== undefined && wi > 0
          && (mergeFirst[wi] || !windows[wi - 1].arrivalPlanned);

        // Diagnostics: continuation/merge flags (spec §7, §12). The emission
        // loop walks slots in the same order they were planned.
        const rec = diag !== null ? slotRecords[srCursor] ?? null : null;
        srCursor += 1;
        // Phase 4.3B: the slot's structural action from the selector.
        const action: 'continue' | 'change' = output.actions[si]
          ?? (prevSlotFoundation !== null && prevSlotFoundation.id === f.id ? 'continue' : 'change');
        if (rec !== null) {
          rec.continuationRealizedStructurally = prevSlotFoundation !== null && prevSlotFoundation.id === f.id;
          rec.previousHarmonySustained = rec.continuationRealizedStructurally;
          rec.newFoundationSelected = !rec.continuationRealizedStructurally;
          // Phase 4.3B continuation decision — recorded from the search trace
          // and the selector's own actions; never rescored here. Scored
          // components are omitted when a forced first slot / develop override
          // decided the outcome after the search (the same honesty rule as
          // selectedCandidateScores), and on the reuse path (which maps
          // source material instead of searching).
          const beamMode = trace !== undefined && trace.mode === 'beam';
          const searchedSlot = beamMode && trace.beam !== null ? trace.beam.slots[si] ?? null : null;
          const searchedChosen = searchedSlot?.candidates.find((c) => c.selected) ?? null;
          const contestGroup = searchedSlot !== null && searchedChosen !== undefined && searchedChosen !== null
            ? searchedSlot.candidates.filter((c) => c.parentBeamIndex === searchedChosen.parentBeamIndex)
            : [];
          const continuationAvailable = beamMode
            ? si > 0 || (prevAtWindowStart !== null && pool.all.some((p) => p.id === prevAtWindowStart.id))
            : false;
          const scoresHonest = searchedChosen !== null
            && trace?.forcedFirst === null && trace?.developOpeningOverride === null;
          // Best recorded change score in the selected candidate's own
          // expansion (candidates are bounded to the top 10 by cumulative
          // score per beam — the honest recorded contest).
          const changeScores = contestGroup.filter((c) => c.kind === 'change').map((c) => c.transition);
          rec.plannerForcesNewFoundation = action === 'change' && !continuationAvailable;
          rec.continuationDecision = {
            available: continuationAvailable,
            selectedAction: action,
            continuationScore: scoresHonest && searchedChosen !== null && searchedChosen.kind === 'continuation'
              ? searchedChosen.transition
              : null,
            bestChangeScore: scoresHonest && changeScores.length > 0 ? Math.max(...changeScores) : null,
            phraseMovementPreference: window.direction.movement,
            sectionMovementPreference: window.prefs.movement,
            rhythmPreference: { changesPerBar: window.prefs.changesPerBar, shape: window.prefs.shape },
            positionInPhrase: si,
            mergedIntoOneEvent: false,
            resultingDurationTicks: slot.durationTicks,
          };
        }

        if (last !== undefined && adjacent && last.foundation.id === f.id
          && (withinWindow || crossWindow)) {
          last.durationTicks += slot.durationTicks; // deliberate prolongation
          last.endWindowIndex = wi;
          last.slotCount += 1;
          if (rec !== null) {
            rec.mergedIntoPreviousEvent = true;
            rec.previousHarmonySustained = true;
            rec.newFoundationSelected = false;
            eventOfRec.set(rec, last);
          }
          if (diag !== null) {
            if (lastStructRec !== null) lastStructRec.mergedWithNext = true;
            diag.structure.merges.push({
              eventIndex: last.eventIndex,
              startTick: last.startTick,
              durationTicks: last.durationTicks,
              slotCount: last.slotCount,
              foundation: foundationLabel(last.foundation),
              withinWindow,
              crossWindow,
            });
          }
          prevSlotFoundation = f;
          continue;
        }
        const newEvent: StructuralEvent = {
          foundation: f,
          startTick: slot.startTick,
          durationTicks: slot.durationTicks,
          startWindowIndex: wi,
          endWindowIndex: wi,
          slotCount: 1,
          eventIndex: nextEventIndex++,
        };
        targetEvents.push(newEvent);
        if (rec !== null) eventOfRec.set(rec, newEvent);

        // Diagnostics: the structural decision at this slot (spec §8).
        if (diag !== null && rec !== null) {
          const rel = prevSlotFoundation !== null
            ? analyzeFoundationRelationship(prevSlotFoundation, f)
            : null;
          const forcedSustain = trace !== undefined && trace.forcedFirst !== null && si === 0;
          const structRec: StructuralSlotRecord = {
            targetIndex: ti,
            slotIndex: rec.slotIndex,
            startTick: slot.startTick,
            durationTicks: slot.durationTicks,
            windowIndex: wi,
            phraseId: window.phraseRef?.id ?? null,
            sectionId: window.sectionId,
            positionInPhrase: si,
            phraseEnd: slot.phraseEnd,
            selected: foundationFactsRecord(f, project.key, project.mode),
            previousFoundation: prevSlotFoundation !== null ? foundationLabel(prevSlotFoundation) : null,
            relationshipToPrevious: rel === null ? null : {
              rootInterval: rel.rootInterval,
              rootMovementSemitones: signedRootMovement(rel.rootInterval),
              rootDirection: rel.rootDirection,
              sharedCoreTones: rel.sharedCoreTones,
              coreCommonRatio: rel.coreCommonRatio,
              sameQuality: rel.sameQuality,
              leadingToneIntoCandidate: rel.leadingToneIntoB,
              sameRootDifferentCore: rel.sameRootDifferentCore,
            },
            structuralRole: forcedSustain ? 'forced-sustain'
              : si === 0 ? 'opening'
                : slot.phraseEnd && window.arrivalPlanned ? 'arrival' : 'middle',
            repeatsPreviousFoundation: prevSlotFoundation !== null && prevSlotFoundation.id === f.id,
            rootChange: prevSlotFoundation !== null && prevSlotFoundation.rootPc !== f.rootPc,
            chromaticDeparture: prevSlotFoundation !== null && prevSlotFoundation.diatonic && !f.diatonic,
            phraseRole: window.role,
            cadenceIntention: window.cadence.intention,
            selectedCandidateScores: null,
            alternatives: [],
            mergedWithNext: false,
            stabilityEvidence: stabilityEvidence(f, pool),
          };
          // Selected-candidate scores: only from an unmodified beam path (a
          // forced first slot or develop override replaced the searched choice
          // after the fact — reporting the searched scores would be misleading).
          if (trace !== undefined && trace.mode === 'beam' && trace.beam !== null
            && trace.forcedFirst === null && trace.developOpeningOverride === null
            && !swappedSlots.has(si)) {
            const st = trace.beam.slots[si];
            const chosenCand = st?.candidates.find((c) => c.selected) ?? null;
            if (chosenCand !== undefined && chosenCand !== null) {
              const beamPrev = si === 0 ? prevAtWindowStart : output.foundations[si - 1];
              const sctxFull = structuralContext(window, pool, env, settings);
              // Tension story replay: the pressure-based tension target the
              // beam scored this slot with is a pure function of the chosen
              // prefix — rebuild it (same seed, same advanceTensionState rule)
              // so the recomputed parts are the ones that produced the choice.
              let tensionState = seedTensionState(prevAtWindowStart);
              for (let k = 0; k < si; k++) {
                tensionState = advanceTensionState(tensionState, output.foundations[k], sctxFull);
              }
              // Phase 4.3B: a selected CONTINUATION reports its own recorded
              // components (transitionParts is null — the transition score
              // did not rank it); a selected change reports the recomputed
              // transition parts as before.
              const selectedIsContinuation = chosenCand.kind === 'continuation';
              structRec.selectedCandidateScores = {
                total: chosenCand.total,
                parentScore: chosenCand.parentScore,
                transition: chosenCand.transition,
                position: chosenCand.position,
                loopPenalty: chosenCand.loopPenalty,
                jitter: chosenCand.jitter,
                rankInExpansion: chosenCand.rankInExpansion,
                transitionParts: selectedIsContinuation
                  ? null
                  : foundationTransitionScoreDetailed(beamPrev, f, sctxFull, tensionState).parts,
                continuationParts: selectedIsContinuation ? chosenCand.continuationParts : null,
                positionParts: positionScoreDetailed(
                  beamPrev, f, si, windowSlots.length, window, sctxFull, tensionState,
                ).parts,
              };
            }
            structRec.alternatives = extractAlternatives(trace, si);
          }
          diag.structure.slots.push(structRec);
          lastStructRec = structRec;
        }
        prevSlotFoundation = f;
      }

      // Per-window diagnostics + material record.
      distinctRootsPerPhrase.push(new Set(output.foundations.map((f) => f.rootPc)).size);
      chosenByPhrase.set(window.phraseRef?.id ?? `@${window.startTick}`, output.foundations);
      // Phase 4.3B: continuation counts are generation output — accumulated
      // UNCONDITIONALLY (report parity with/without diagnostics, Phase 4.2
      // non-interference contract). Slot 0 counts as an opportunity only
      // when a harmony was sounding at the window start.
      {
        const hasPrev = prevAtWindowStart !== null;
        continuationSlotCount += output.actions.filter((a, i) => (i > 0 || hasPrev) && a === 'continue').length;
      }
      if (diag !== null) {
        // Phase 4.3B whole-phrase continuation summary (descriptive — never
        // an optimization target).
        const winRec = diag.structure.windows[diag.structure.windows.length - 1];
        const hasPrev = prevAtWindowStart !== null;
        const changes = output.actions.filter((a, i) => (i > 0 || hasPrev) && a === 'change').length;
        const continuations = output.actions.filter((a, i) => (i > 0 || hasPrev) && a === 'continue').length;
        const opportunities = Math.max(0, windowSlots.length - (hasPrev ? 0 : 1));
        const eventsInWindow = targetEvents.filter((e) => e.startWindowIndex === wi);
        winRec.continuation = {
          opportunities,
          changes,
          continuations,
          meanSustainedDurationTicks: eventsInWindow.length > 0
            ? Math.round(eventsInWindow.reduce((s, e) => s + e.durationTicks, 0) / eventsInWindow.length)
            : 0,
          structuralChangesPerBar: window.endTick > window.startTick
            ? changes / ((window.endTick - window.startTick) / meter.barTicksValue)
            : 0,
          phraseMovementPreference: window.direction.movement,
          sectionMovementPreference: window.prefs.movement,
          actualActivity: opportunities > 0 ? changes / opportunities : 0,
        };
      }
      prev = output.last;
      if (output.foundations.length > 0) soundingTrail.push(...output.foundations);

      // Story-pass bookkeeping: record this phrase's arrival (the section's
      // arrival sequence) and its observable shape for the NEXT window's
      // goal/contrast evaluation; count realized flat pairs.
      if (output.foundations.length > 0) {
        const arrival = output.foundations[output.foundations.length - 1]!;
        if (window.arrivalPlanned) {
          const arrs = sectionArrivalRoots.get(storyKey) ?? [];
          arrs.push(arrival.rootPc);
          sectionArrivalRoots.set(storyKey, arrs);
        }
        const prevArrival = output.foundations.length > 1
          ? output.foundations[output.foundations.length - 2]!
          : null;
        priorFeaturesBySection.set(storyKey, {
          role: window.role,
          rootDensity: new Set(output.foundations.map((f) => f.rootPc)).size
            / output.foundations.length,
          arrivalFamily: realizedFoundationFamily(prevArrival, arrival, sctx),
          foundationIds: output.foundations.map((f) => f.id),
        });
        if (window.priorPhraseFeatures !== null
          && phraseContrastPenalty(output.foundations, window, sctx) > 0) {
          phraseContrastPenalties += 1;
        }
      }
    }

    // Phase 4.3B: fill each slot record's merged-event facts — the duration
    // of the event the slot ended up in, and whether that event spans
    // multiple slots (a sustained hold). The event count itself is
    // generation output and accumulated unconditionally.
    sustainedEventCount += targetEvents.filter((e) => e.slotCount > 1).length;
    if (diag !== null) {
      for (const [rec, ev] of eventOfRec) {
        if (rec.continuationDecision !== null) {
          rec.continuationDecision.mergedIntoOneEvent = ev.slotCount > 1;
          rec.continuationDecision.resultingDurationTicks = ev.durationTicks;
        }
      }
    }

    // STAGE B — color every structural event (foundation → chord symbol).
    const colorRng = mulberry32(hashString(
      ['crescode:gen:color', String(target.startTick), String(target.endTick), String(seed)].join('|'),
    ));
    let prevColor: PreviousColor | null = null;
    for (let ei = 0; ei < targetEvents.length; ei++) {
      const ev = targetEvents[ei];
      const prevEvent = ei > 0 ? targetEvents[ei - 1]! : null;
      // Story pass: when the FOUNDATION held, color motion is the only
      // audible change left — the color stage must know (it weighs symbol
      // repetition differently for held vs changed harmony).
      const foundationHeld = prevEvent !== null && prevEvent.foundation.id === ev.foundation.id;
      const endWindow = windows[ev.endWindowIndex];
      const startWindow = windows[ev.startWindowIndex];
      const isArrival = endWindow.arrivalPlanned
        && ev.startTick + ev.durationTicks === endWindow.endTick;
      const observations: ColorObservation[] = [];
      const res = applyHarmonicColor(ev.foundation, pool, {
        complexityPref: startWindow.prefs.complexity,
        modalPref: startWindow.prefs.modal,
        variation: settings.variation,
        isArrival,
        intention: isArrival ? endWindow.cadence.intention : null,
        role: startWindow.role,
        foundationHeld,
        prev: prevColor,
      }, colorRng, diag !== null ? (o) => { observations.push(o); } : undefined);

      // Structural cadence realization diagnostics at planned arrivals —
      // INCLUDING arrivals absorbed into a sustained event that spans the
      // boundary (Phase 4.3B: the arrival harmony sustains across it, and
      // the realized family is still judged from the harmony that led INTO
      // this event). Every planned-arrival window the event covers is
      // recorded exactly once.
      const coveredArrivals: typeof windows = [];
      for (let wj = ev.startWindowIndex; wj <= ev.endWindowIndex; wj++) {
        const w = windows[wj];
        if (!w.arrivalPlanned) continue;
        const covers = ev.startTick < w.endTick && ev.startTick + ev.durationTicks >= w.endTick;
        if (covers) coveredArrivals.push(w);
      }
      for (const arrivalWindow of coveredArrivals) {
        const before = ei > 0 ? targetEvents[ei - 1].foundation : prev;
        const family = realizedFoundationFamily(before, ev.foundation, sctx);
        structuralCadences.push({ intention: arrivalWindow.cadence.intention, family });
        {
          const sKey = arrivalWindow.sectionId ?? '(gaps)';
          const arrs = arrivalFamiliesBySection.get(sKey) ?? [];
          arrs.push(family);
          arrivalFamiliesBySection.set(sKey, arrs);
        }
        if (family !== null) familiesUsed.add(family);
        if (diag !== null) {
          diag.structure.cadences.push({
            phraseId: arrivalWindow.phraseRef?.id ?? null,
            sectionId: arrivalWindow.sectionId,
            startTick: ev.startTick,
            intention: arrivalWindow.cadence.intention,
            family,
            arrivalFoundation: foundationLabel(ev.foundation),
            previousFoundation: before !== null ? foundationLabel(before) : null,
          });
        }
      }
      // Same-foundation adjacency diagnostics (kept rearticulations).
      if (prevEvent !== undefined && prevEvent !== null && prevEvent.foundation.id === ev.foundation.id) {
        sameFoundationRepetitions += 1;
        if (prevColor !== null && prevColor.symbol !== res.symbol) colorOnlyChanges += 1;
      }
      if (reinforcesTonic(ev.foundation, pool.tonic, pool.tonicTriadPcs)) tonicReinforcementEvents += 1;
      if (!res.diatonic) borrowedColorSet.add(res.symbol);
      if (!foundationSeen.has(ev.foundation.id)) {
        foundationSeen.add(ev.foundation.id);
        foundationOrder.push(foundationLabel(ev.foundation));
      }

      generated.push({
        id: nextChordId(nextId++),
        symbol: res.symbol,
        startTick: ev.startTick,
        durationTicks: ev.durationTicks,
      });
      if (diag !== null) {
        generatedFoundations.push(ev.foundation);
        const obs = observations[0] ?? null;
        const tierLabel: 'triad' | 'seventh' | 'extension' | 'basic' = obs?.basicFallback === true
          ? 'basic'
          : res.tierRank === 0 ? 'triad' : res.tierRank === 0.5 ? 'seventh' : 'extension';
        const colorRec: ColorDecisionRecord = {
          eventIndex: ev.eventIndex,
          startTick: ev.startTick,
          durationTicks: ev.durationTicks,
          foundationId: ev.foundation.id,
          foundationLabel: foundationLabel(ev.foundation),
          resolvedFoundationId: obs !== null ? obs.resolvedFoundationId : null,
          symbol: res.symbol,
          availableColors: obs !== null ? obs.availableColors : [],
          pickedIndex: obs !== null ? obs.pickedIndex : null,
          basicFallback: obs !== null ? obs.basicFallback : false,
          complexityPref: startWindow.prefs.complexity,
          modalPref: startWindow.prefs.modal,
          variation: settings.variation,
          isArrival,
          intention: isArrival ? endWindow.cadence.intention : null,
          role: startWindow.role,
          slotCount: ev.slotCount,
          operation: classifyColorOperation(res.symbol, ev.foundation, scalePcs, tierLabel),
        };
        diag.color.push(colorRec);
      }
      // Sections affected: which REAL project section contains this tick.
      for (const sec of project.sections) {
        const s = barToTick(sec.startBar, project.timeSignature);
        const e = s + sec.lengthBars * barTicks(project.timeSignature);
        if (ev.startTick >= s && ev.startTick < e) sectionsAffected.add(sec.id);
      }
      prevColor = { symbol: res.symbol, tierRank: res.tierRank, pitchClasses: res.pitchClasses };
    }
  }

  // Diagnostics: adjacent emitted pairs classified on FOUNDATION identity
  // (Phase 4.2 spec §12 — symbol inequality alone never implies movement).
  if (diag !== null) {
    for (let i = 1; i < generated.length; i++) {
      const a = generated[i - 1];
      const b = generated[i];
      const adjacent = b.startTick === a.startTick + a.durationTicks;
      const t = classifyTransition(
        a.symbol, generatedFoundations[i - 1] ?? null,
        b.symbol, generatedFoundations[i] ?? null,
        !adjacent,
      );
      t.index = diag.transitions.length;
      diag.transitions.push(t);
    }
    diag.warnings = [...warnings];
  }

  // Borrowed-color diagnostics: generated events whose color carries tones
  // outside the project mode (availability was already borrowing-filtered).
  const borrowedSymbols = [...borrowedColorSet];

  // Foundation-set overlap between related (repeated) sections.
  const sectionFoundationOverlap: ChordGenerationReport['sectionFoundationOverlap'] = [];
  {
    const fsets = new Map<string, Set<string>>();
    for (const c of [...plan.keep, ...generated]) {
      const f = foundationInfoFromSymbol(c.symbol, project.key, project.mode);
      if (f === null) continue;
      for (const sec of planProject.sections) {
        const s = barToTick(sec.startBar, project.timeSignature);
        const e = s + sec.lengthBars * barTicks(project.timeSignature);
        if (c.startTick >= s && c.startTick < e) {
          let set = fsets.get(sec.id);
          if (!set) { set = new Set(); fsets.set(sec.id, set); }
          set.add(f.id);
        }
      }
    }
    const orderOf = new Map(planProject.sections.map((s, i) => [s.id, i]));
    const seenPairs = new Set<string>();
    for (const p of profiles) {
      for (const rid of p.development.relatedSectionIds) {
        if (rid === p.sectionId) continue;
        const A = fsets.get(p.sectionId);
        const B = fsets.get(rid);
        if (!A || !B || (A.size === 0 && B.size === 0)) continue;
        const [a, b] = (orderOf.get(p.sectionId) ?? 0) <= (orderOf.get(rid) ?? 0)
          ? [p.sectionId, rid] : [rid, p.sectionId];
        const key = `${a}::${b}`;
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);
        const union = new Set([...A, ...B]);
        let shared = 0;
        for (const x of A) if (B.has(x)) shared++;
        sectionFoundationOverlap.push({ a, b, overlap: union.size > 0 ? shared / union.size : 0 });
      }
    }
  }

  const durations = generated.map((c) => c.durationTicks);
  const report: ChordGenerationReport = {
    seed,
    scope,
    generatedChordCount: generated.length,
    preservedChordCount: plan.keep.length,
    sectionsAffected: [...sectionsAffected],
    warnings,
    borrowedSymbols,
    phraseCount: phraseWindowCount,
    cadenceFamiliesUsed: [...familiesUsed] as ChordGenerationReport['cadenceFamiliesUsed'],
    rhythmSummary: {
      changes: generated.length,
      meanDurationTicks: durations.length
        ? Math.round(durations.reduce((s, v) => s + v, 0) / durations.length)
        : 0,
    },
    anchorConstraints: {
      before: targets[0]?.before?.symbol ?? null,
      after: targets[0]?.after?.symbol ?? null,
      protectedSpans: plan.keep.filter((c) =>
        c.startTick < regionEnd && c.startTick + c.durationTicks > plan.regionStart).length,
    },
    structuralFoundations: foundationOrder,
    distinctRootsPerPhrase,
    sameFoundationRepetitions,
    colorOnlyChanges,
    tonicReinforcementEvents,
    continuationSlots: continuationSlotCount,
    sustainedEvents: sustainedEventCount,
    structuralCadences,
    sectionFoundationOverlap,
    // Story pass: each section's sampled harmonic goal, with the arrival
    // families realized against it (phrase order).
    sectionGoals: songPlan.sections.map((s) => ({
      sectionId: s.sectionId,
      sectionName: s.sectionName,
      goal: s.goal.kind,
      description: s.goal.description,
      realizedArrivalFamilies: arrivalFamiliesBySection.get(s.sectionId) ?? [],
    })),
    /** Audible-motion alignment: foundation changes moved off weak slots. */
    harmonicRhythmSwaps,
    /** Adjacent phrase pairs whose realized material differed in nothing. */
    phraseContrastPenalties,
  };

  // Assemble: preserved events keep their exact objects; stable sort by time.
  const indexed = [
    ...plan.keep.map((c, i) => ({ c, i })),
    ...generated.map((c, i) => ({ c, i: plan.keep.length + i })),
  ].sort((a, b) => a.c.startTick - b.c.startTick || a.i - b.i);
  const chords = indexed.map((x) => x.c);

  // Phase 4.2: the deep diagnostic report is attached ONLY when requested —
  // the plain result shape (and everything downstream of it) is unchanged.
  if (diag !== null) return { chords, report, diagnostics: diag };
  return { chords, report };
}

/** Exposed for tests: the engine's own view of the generation region end. */
export { generationRegionEnd, engineSongSpanTicks };
