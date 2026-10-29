/**
 * Chord progression generation (Phase 4) — the first Crescode engine stage
 * that CREATES chord events (spec §1).
 *
 * Pipeline per request:
 *   1. resolve scope → preserved chords, removed chords, generation targets
 *      (coverage.ts — locked chords and out-of-scope harmony are untouchable)
 *   2. build the Phase 2/3 planning backdrop (profiles + song harmony plan)
 *   3. clip phrase windows onto each target (synthesizing neutral windows
 *      where no section exists — projects without sections stay first-class)
 *   4. plan harmonic rhythm per target (rhythm.ts — WHEN chords change)
 *   5. select chords per window (progression.ts + candidates.ts — WHICH
 *      chords, using Phase 1 vocabulary facts, cadence intentions, anchors
 *      and repeated-material links)
 *   6. emit events, merge sustains, assemble the full chord array + report
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
import { candidateFromSymbol, buildCandidatePool, type CandidateInfo, type CandidatePool } from './candidates';
import { meterFacts, planRhythmSlots, type RhythmSlot, type RhythmWindowInput } from './rhythm';
import { selectWindowChords, type MaterialReference, type SelectionWindow } from './progression';
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

/** Material for a linked phrase: this run's choices, else the existing chords
 *  sounding through the related phrase's span (spec §10). Self-references are
 *  skipped — a phrase never reuses itself. */
function materialForPhrase(
  relatedIds: string[],
  ownId: string | null,
  byId: Map<string, PlannedPhraseInfo>,
  chosenByPhrase: Map<string, string[]>,
  project: Project,
): MaterialReference | null {
  for (const id of relatedIds) {
    if (ownId !== null && id === ownId) continue;
    let symbols: string[] | null = null;
    let intention: MaterialReference['intention'] = null;
    const chosen = chosenByPhrase.get(id);
    if (chosen !== undefined) {
      symbols = chosen.filter((s): s is string => s !== null);
    } else {
      const info = byId.get(id);
      if (!info) continue;
      const p = info.phrase;
      const end = p.startTick + p.durationTicks;
      const inside = project.chords
        .filter((c) => c.startTick >= p.startTick && c.startTick < end)
        .sort((a, b) => a.startTick - b.startTick)
        .map((c) => c.symbol);
      if (inside.length > 0) {
        symbols = inside;
      } else {
        const sounding = project.chords
          .filter((c) => c.startTick <= p.startTick && c.startTick + c.durationTicks > p.startTick)
          .sort((a, b) => a.startTick - b.startTick);
        if (sounding.length > 0) symbols = [sounding[0].symbol];
      }
      intention = p.cadence.intention;
    }
    if (!symbols || symbols.length === 0) continue;
    // Collapse consecutive duplicates: reuse maps chord content, not slots.
    const collapsed = symbols.filter((s, i) => i === 0 || s !== symbols[i - 1]);
    return { symbols: collapsed, mode: 'full', intention };
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
  const pool: CandidatePool = buildCandidatePool(project.key, project.mode, settings);
  if (pool.all.length === 0) warnings.push('Candidate pool was empty — no chords could be generated.');

  // 3..6) Targets → windows → slots → selection → events.
  const chosenByPhrase = new Map<string, string[]>();
  const generated: Chord[] = [];
  const familiesUsed = new Set<string>();
  const sectionsAffected = new Set<string>();
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

    // Selection walks the windows, chaining the sounding chord.
    let prev: CandidateInfo | null = target.before
      ? candidateFromSymbol(target.before.symbol, project.key, project.mode)
      : null;
    if (target.before && prev === null) {
      warnings.push(`Anchor symbol "${target.before.symbol}" could not be parsed — continuity context reduced.`);
    }
    const after: CandidateInfo | null = target.after
      ? candidateFromSymbol(target.after.symbol, project.key, project.mode)
      : null;

    for (let wi = 0; wi < windows.length; wi++) {
      const window = windows[wi];
      const windowSlots = slices[wi] ?? [];
      if (windowSlots.length === 0) continue;

      // Repeated material (spec §10): full reuse when the plan links this
      // phrase to earlier material as a repeat — by role, or through a
      // CROSS-SECTION link (a repeated section's phrases may carry roles like
      // 'conclude' while still being repeated material). preserveIdentity
      // gates the whole mechanism; without it related sections develop
      // independently.
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
      const output = selectWindowChords({
        window, slots: windowSlots, pool, env, prev, after,
        material, settings, rng: selectRng, mergeFirst: mergeFirst[wi], isSongEnd: isRegionEnd,
      });

      // Emit events; null symbols sustain the previous event; same-symbol
      // adjacents within a window merge into one sustained event.
      const windowStart = windowSlots[0].startTick;
      const phraseKey = window.phraseRef?.id ?? `@${windowStart}`;
      const chosenForPhrase: string[] = [];
      for (let si = 0; si < windowSlots.length; si++) {
        const slot = windowSlots[si];
        const symbol = output.symbols[si] ?? null;
        if (symbol === null) {
          const lastEvent = generated[generated.length - 1];
          if (lastEvent !== undefined && lastEvent.startTick + lastEvent.durationTicks === slot.startTick) {
            lastEvent.durationTicks += slot.durationTicks; // sustain across the boundary
            continue;
          }
          continue; // defensive: continuation without a sounding event drops out
        }
        const lastEvent = generated[generated.length - 1];
        if (lastEvent !== undefined
          && lastEvent.symbol === symbol
          && lastEvent.startTick + lastEvent.durationTicks === slot.startTick
          && lastEvent.startTick >= windowStart && lastEvent.startTick < window.endTick
          && !slot.phraseEnd) {
          lastEvent.durationTicks += slot.durationTicks; // intra-window sustain
          continue;
        }
        generated.push({
          id: nextChordId(nextId++),
          symbol,
          startTick: slot.startTick,
          durationTicks: slot.durationTicks,
        });
        chosenForPhrase.push(symbol);
        // Sections affected: which REAL project section contains this tick.
        for (const sec of project.sections) {
          const s = barToTick(sec.startBar, project.timeSignature);
          const e = s + sec.lengthBars * barTicks(project.timeSignature);
          if (slot.startTick >= s && slot.startTick < e) sectionsAffected.add(sec.id);
        }
      }
      chosenByPhrase.set(phraseKey, chosenForPhrase);
      if (output.arrivalFamily !== null) familiesUsed.add(output.arrivalFamily);
      prev = output.last;
    }
  }

  // Diagnostics: borrowed chords among the generated events.
  const borrowedSymbols = [...new Set(generated
    .map((c) => pool.all.find((p) => p.symbol === c.symbol))
    .filter((c): c is NonNullable<typeof c> => c !== undefined && !c.diatonic)
    .map((c) => c.symbol))];

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
