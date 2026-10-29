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
import { hashString, mulberry32 } from '../generate';
import { buildSongHarmonyProfiles } from './profiles';
import { planSongHarmony } from './plan';
import { cadenceEnvironment, compatibleCadenceFamilies } from './cadences';
import { applyHarmonicColor, type PreviousColor } from './color';
import {
  buildFoundationPool, foundationInfoFromSymbol, foundationLabel, reinforcesTonic,
  realizedFoundationFamily, type FoundationInfo, type FoundationPool, type StructuralContext,
} from './foundation';
import { selectWindowFoundations, type MaterialReference, type SelectionWindow } from './progression';
import { meterFacts, planRhythmSlots, type RhythmSlot, type RhythmWindowInput } from './rhythm';
import { resolveScopePlan, generationRegionEnd, engineSongSpanTicks } from './coverage';
import type {
  BoundaryIntention, CadenceEnvironment, HarmonicPhrase, PhraseRole, RhythmShape,
} from './types';
import type {
  ChordGenerationResult, ChordGenerationReport, GenerateProgressionOptions, GenerationScope,
} from './generation-types';

/* Settings-derived neutral anchors (mirrors profiles.ts's documented tables). */
const COMPLEXITY_ANCHOR: Record<ChordGenSettings['complexity'], number> = { 1: 0.35, 2: 0.5, 3: 0.65 };
const DENSITY_ANCHOR: Record<ChordGenSettings['density'], number> = { 0: 1, 1: 2, 2: 3 };

interface PlannedPhraseInfo {
  phrase: HarmonicPhrase;
  sectionId: string;
  isSectionLast: boolean;
  boundaryIntoNext: BoundaryIntention | null;
}

interface WindowPrefs {
  stability: number; movement: number; complexity: number; tension: number; modal: number; contrast: number;
  changesPerBar: number; shape: RhythmShape;
}

/** Structural subset of SectionHarmonyProfile this module reads. */
interface SectionProfilePrefs {
  stability: { preferred: number }; movement: { preferred: number }; complexity: { preferred: number };
  tension: { preferred: number }; modalEmphasis: { preferred: number }; contrast: { preferred: number };
  rhythm: { preferredChangesPerBar: number; shape: RhythmShape };
}

function prefsFromProfile(
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
function flattenPhrases(
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
 * Clip the plan's phrase windows onto a generation target; synthesize neutral
 * windows for sub-spans the plan does not cover (song tails beyond the last
 * section, projects without sections, gaps between sections).
 */
function windowsForTarget(
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
  const hasSections = project.sections.length > 0;
  let planProject = project;
  if (!hasSections) {
    planProject = {
      ...project,
      sections: [{ id: '(song)', name: 'Song', startBar: 1, lengthBars: Math.max(1, projectBars(project)) }],
    };
  }
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
  let nextId = 0;
  const nextChordId = makeIdFactory(seed, project.chords);

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
    const after: FoundationInfo | null = target.after
      ? foundationInfoFromSymbol(target.after.symbol, project.key, project.mode)
      : null;
    if (target.after && after === null) {
      warnings.push(`Anchor symbol "${target.after.symbol}" could not be parsed — continuity context reduced.`);
    }

    // Structural events accumulate per target; same-foundation slot runs
    // merge into one sustained harmonic event (spec §9).
    const targetEvents: StructuralEvent[] = [];
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

      const selectRng = mulberry32(hashString(
        ['crescode:gen:select', String(window.startTick), String(window.endTick), window.phraseRef?.id ?? `syn${wi}`, String(seed)].join('|'),
      ));
      const output = selectWindowFoundations({
        window, slots: windowSlots, pool, env, prev, after,
        material, settings, rng: selectRng,
        forcedFirst: mergeFirst[wi] && prev !== null ? prev : null,
        isSongEnd: isRegionEnd,
      });

      // Emit slots → structural events with foundation-based merging.
      for (let si = 0; si < output.foundations.length && si < windowSlots.length; si++) {
        const f = output.foundations[si];
        const slot = windowSlots[si];
        const last = targetEvents[targetEvents.length - 1];
        const adjacent = last !== undefined && last.startTick + last.durationTicks === slot.startTick;
        const withinWindow = last !== undefined && last.endWindowIndex === wi;
        const crossWindow = last !== undefined && wi > 0
          && (mergeFirst[wi] || !windows[wi - 1].arrivalPlanned);
        if (last !== undefined && adjacent && last.foundation.id === f.id
          && (withinWindow || crossWindow)) {
          last.durationTicks += slot.durationTicks; // deliberate prolongation
          last.endWindowIndex = wi;
          last.slotCount += 1;
          continue;
        }
        targetEvents.push({
          foundation: f,
          startTick: slot.startTick,
          durationTicks: slot.durationTicks,
          startWindowIndex: wi,
          endWindowIndex: wi,
          slotCount: 1,
        });
      }

      // Per-window diagnostics + material record.
      distinctRootsPerPhrase.push(new Set(output.foundations.map((f) => f.rootPc)).size);
      chosenByPhrase.set(window.phraseRef?.id ?? `@${window.startTick}`, output.foundations);
      prev = output.last;
    }

    // STAGE B — color every structural event (foundation → chord symbol).
    const colorRng = mulberry32(hashString(
      ['crescode:gen:color', String(target.startTick), String(target.endTick), String(seed)].join('|'),
    ));
    let prevColor: PreviousColor | null = null;
    for (let ei = 0; ei < targetEvents.length; ei++) {
      const ev = targetEvents[ei];
      const endWindow = windows[ev.endWindowIndex];
      const startWindow = windows[ev.startWindowIndex];
      const isArrival = endWindow.arrivalPlanned
        && ev.startTick + ev.durationTicks === endWindow.endTick;
      const res = applyHarmonicColor(ev.foundation, pool, {
        complexityPref: startWindow.prefs.complexity,
        modalPref: startWindow.prefs.modal,
        variation: settings.variation,
        isArrival,
        intention: isArrival ? endWindow.cadence.intention : null,
        role: startWindow.role,
        prev: prevColor,
      }, colorRng);

      // Structural cadence realization diagnostics at planned arrivals.
      if (isArrival) {
        const before = ei > 0 ? targetEvents[ei - 1].foundation : prev;
        const family = realizedFoundationFamily(before, ev.foundation, sctx);
        structuralCadences.push({ intention: endWindow.cadence.intention, family });
        if (family !== null) familiesUsed.add(family);
      }
      // Same-foundation adjacency diagnostics (kept rearticulations).
      const prevEv = targetEvents[ei - 1];
      if (prevEv !== undefined && prevEv.foundation.id === ev.foundation.id) {
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
      // Sections affected: which REAL project section contains this tick.
      for (const sec of project.sections) {
        const s = barToTick(sec.startBar, project.timeSignature);
        const e = s + sec.lengthBars * barTicks(project.timeSignature);
        if (ev.startTick >= s && ev.startTick < e) sectionsAffected.add(sec.id);
      }
      prevColor = { symbol: res.symbol, tierRank: res.tierRank, pitchClasses: res.pitchClasses };
    }
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
    structuralCadences,
    sectionFoundationOverlap,
  };

  // Assemble: preserved events keep their exact objects; stable sort by time.
  const indexed = [
    ...plan.keep.map((c, i) => ({ c, i })),
    ...generated.map((c, i) => ({ c, i: plan.keep.length + i })),
  ].sort((a, b) => a.c.startTick - b.c.startTick || a.i - b.i);
  const chords = indexed.map((x) => x.c);

  return { chords, report };
}

/** Exposed for tests: the engine's own view of the generation region end. */
export { generationRegionEnd, engineSongSpanTicks };
