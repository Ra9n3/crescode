/**
 * Phrase planning (Phase 3) — how harmonic ideas are organized over time.
 *
 * Divides a section into phrases (exact, gapless, bar-aligned spans) and
 * describes each one's role, broad direction and cadential intention. Phrase
 * lengths EMERGE from the section's length, harmonic profile, structural
 * context, existing chords and the optional seed: two-bar, three-bar,
 * five-bar, uneven and extended phrases are all reachable, and no four- or
 * eight-bar template exists (spec §3). A one-bar section plans as a single
 * one-bar phrase; odd lengths plan like any other.
 *
 * Existing chords are read as context only (spec §11): their starts may make
 * nearby boundaries more plausible and locked chords act as anchors — but
 * nothing here moves, deletes, resizes or replaces a single chord. A
 * sustained chord may span a phrase boundary just as a phrase may contain
 * several chords; no hard rule binds either way.
 *
 * Deterministic (spec §10 Option B): identical (project, profile, seed)
 * produce identical plans; different seeds explore different musically
 * plausible organizations coherently (candidates are scored as WHOLE
 * structures, never bar-by-bar coin flips). The seed is never advanced or
 * persisted, and no chord events are generated.
 */
import { barToTick, barTicks } from '../../shared/schema/meter';
import {
  DEFAULT_CHORDGEN_SETTINGS, isChordLocked, type ChordGenSettings, type Project,
} from '../../shared/schema/types';
import { hashString, mulberry32 } from '../generate';
import { planCadence } from './cadences';
import { evaluateContour } from './contours';
import { applyVariation, clamp01, lerp, pickWeighted, roundTo } from './planning';
import type {
  ExistingHarmonyContext, HarmonicPhrase, PhrasePlanOptions, PhraseRole,
  SectionGoalKind, SectionHarmonicGoal, SectionHarmonyProfile, SectionPhrases,
} from './types';

/**
 * Read-only chord observations for one section span (spec §11). Chord starts
 * inside the span become `chordChangeTicks`; locked chords overlapping the
 * span are reported clamped to it. Never mutates anything.
 */
export function collectExistingHarmony(
  project: Pick<Project, 'chords'>,
  span: { startTick: number; endTick: number },
): ExistingHarmonyContext {
  const chordChangeTicks: number[] = [];
  const lockedChordSpans: ExistingHarmonyContext['lockedChordSpans'] = [];
  for (const c of project.chords) {
    const end = c.startTick + c.durationTicks;
    if (!(c.startTick < span.endTick && end > span.startTick)) continue;
    if (c.startTick >= span.startTick && c.startTick < span.endTick) chordChangeTicks.push(c.startTick);
    if (isChordLocked(c)) {
      lockedChordSpans.push({
        startTick: Math.max(c.startTick, span.startTick),
        endTick: Math.min(end, span.endTick),
      });
    }
  }
  return {
    chordChangeTicks: [...new Set(chordChangeTicks)].sort((a, b) => a - b),
    lockedChordSpans,
  };
}

/* --------------------------------------------------------------------------
 * Phrase-structure derivation
 * ----------------------------------------------------------------------- */

/**
 * Felt-beat correction (spec §12): meters whose felt beat is shorter than a
 * quarter (compound meters like 6/8 with two dotted-quarter beats) get a
 * mild preference toward phrases spanning a few more notated bars, so equal
 * activity feels comparable across meters without imposing a four-beat
 * model. Capped at ±25% — a tendency, not a rewrite.
 */
function meterLengthFactor(beatsPerBar: number): number {
  return Math.min(1.25, Math.max(0.8, Math.sqrt(4 / Math.max(1, beatsPerBar))));
}

/**
 * Section activity 0..1 from the Phase 2 profile — an internal planning
 * parameter blending movement, harmonic-rhythm density and (inversely)
 * stability. Higher activity → shorter, more conversational phrases.
 */
function sectionActivity(profile: SectionHarmonyProfile): number {
  const rhythm = profile.preferences.rhythm;
  const density = clamp01((rhythm.preferredChangesPerBar - 0.5) / 3.5);
  return clamp01(
    0.4 * profile.preferences.movement.preferred
    + 0.35 * density
    + 0.25 * (1 - profile.preferences.stability.preferred),
  );
}

/** Plausible phrase-length window for the section, in bars. */
function lengthWindow(
  activity: number,
  profile: SectionHarmonyProfile,
): { preferred: number; min: number; max: number } {
  const lengthBars = profile.context.lengthBars;
  let preferred = Math.round(lerp(7, 2, activity) * meterLengthFactor(profile.meter.beatsPerBar));
  if (profile.preferences.rhythm.shape === 'hold') preferred += 1;
  preferred = Math.min(Math.max(1, preferred), Math.max(1, Math.min(9, lengthBars)));
  const max = Math.min(lengthBars, Math.max(preferred + 3, 3));
  const min = Math.max(1, Math.min(preferred - 2, max));
  return { preferred, min, max };
}

/** Distribute `rem` extra bars across `k` phrases as evenly as possible. */
function spreadExtras(k: number, rem: number): boolean[] {
  const flags: boolean[] = Array.from({ length: k }, () => false);
  for (let i = 0; i < rem; i++) {
    const index = Math.round(((i + 0.5) * k) / rem) - 1;
    flags[Math.min(k - 1, Math.max(0, index))] = true;
  }
  return flags;
}

interface CompositionCandidate {
  bars: number[];
  score: number;
}

/**
 * Score one whole candidate structure. Whole-structure scoring (not
 * bar-by-bar decisions) is what keeps seeded variation coherent: a candidate
 * is plausible as a SHAPE, or it is not.
 */
function scoreComposition(
  bars: number[],
  window: { preferred: number; min: number; max: number },
  profile: SectionHarmonyProfile,
  anchors: Map<number, number>,
): number {
  const k = bars.length;
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;

  // How close the phrase lengths sit to the section's preferred length.
  const lengthFit = mean(bars.map((len) => Math.exp(-Math.abs(len - window.preferred) / 1.5)));

  // Shape fit: does the length ordering match the section's rhythm shape?
  let shapeFit = 0.5;
  const shape = profile.preferences.rhythm.shape;
  if (shape === 'accelerating' || shape === 'decelerating') {
    let s = 0;
    for (let i = 1; i < k; i++) {
      s += Math.sign(bars[i] - bars[i - 1]) * (shape === 'decelerating' ? 1 : -1);
    }
    shapeFit = clamp01(0.5 + (s / Math.max(1, k - 1)) * 0.5);
  } else if (shape === 'regular' || shape === 'periodic' || shape === 'hold') {
    const m = mean(bars);
    const stdev = Math.sqrt(mean(bars.map((b) => (b - m) ** 2)));
    shapeFit = 1 - Math.min(1, stdev / Math.max(1, m));
  }

  // Anchor fit: boundaries that coincide with existing chord starts (0.5)
  // or locked-chord starts (1.0) are more plausible. Soft — a sustained
  // chord spanning a boundary is explicitly allowed (spec §11).
  let anchorFit = 0.5; // neutral when no existing chords are present
  if (anchors.size > 0) {
    let hit = 0;
    let acc = 0;
    for (let i = 0; i < k - 1; i++) {
      acc += bars[i];
      hit += anchors.get(acc) ?? 0;
    }
    anchorFit = clamp01(0.3 + 0.7 * (hit / Math.max(1, k - 1)));
  }

  return Math.max(0.01, 0.35 * lengthFit + 0.15 * shapeFit + 0.5 * anchorFit);
}

/**
 * Generate and score candidate structures, then pick one with the seeded
 * generator. Candidates are built from balanced partitions of the section
 * (early/late/evenly spread extras) plus seed-driven rebalanced variants —
 * deterministic, bounded, no exhaustive search (spec §14).
 */
function planComposition(
  lengthBars: number,
  window: { preferred: number; min: number; max: number },
  profile: SectionHarmonyProfile,
  anchors: Map<number, number>,
  rng: () => number,
  variation: number,
): number[] {
  const N = lengthBars;
  if (N <= 1) return [Math.max(1, N)];
  const kMin = Math.max(1, Math.ceil(N / window.max));
  const kMax = Math.max(kMin, Math.min(N, 16, Math.ceil(N / window.min)));

  const candidates: CompositionCandidate[] = [];
  const seen = new Set<string>();
  const push = (bars: number[]) => {
    const key = bars.join(',');
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ bars, score: scoreComposition(bars, window, profile, anchors) });
  };

  for (let k = kMin; k <= kMax; k++) {
    const base = Math.floor(N / k);
    const rem = N - base * k;
    // Extras early, extras late, extras spread — three canonical balanced shapes.
    push(Array.from({ length: k }, (_, i) => base + (i < rem ? 1 : 0)));
    push(Array.from({ length: k }, (_, i) => base + (i >= k - rem ? 1 : 0)));
    const flags = spreadExtras(k, rem);
    push(Array.from({ length: k }, (_, i) => base + (flags[i] ? 1 : 0)));
    // One seed-driven variant: a few single-bar rebalancing moves.
    const variant = Array.from({ length: k }, (_, i) => base + (i < rem ? 1 : 0));
    const moves = Math.floor(rng() * 3);
    for (let m = 0; m < moves; m++) {
      const movable = variant.map((len, i) => (len > 1 ? i : -1)).filter((i) => i >= 0);
      if (movable.length === 0) break;
      const from = movable[Math.floor(rng() * movable.length)];
      const dirs = [from - 1, from + 1].filter((j) => j >= 0 && j < k);
      if (dirs.length === 0) break; // single-phrase composition: nothing to rebalance into
      const to = dirs[Math.floor(rng() * dirs.length)];
      variant[from] -= 1;
      variant[to] += 1;
    }
    push(variant);
  }

  const weighted = applyVariation(
    candidates.map((c) => [c.bars.join(','), c.score] as const),
    variation,
  );
  const chosen = pickWeighted(weighted, rng);
  return candidates.find((c) => c.bars.join(',') === chosen)!.bars;
}

/* --------------------------------------------------------------------------
 * Phrase roles, directions, relations
 * ----------------------------------------------------------------------- */

/** The section's ending context: does its last phrase prepare a departure? */
function sectionPreparesDeparture(profile: SectionHarmonyProfile): boolean {
  const ctx = profile.context;
  if (ctx.precedesMajorTransition) return true;
  return Boolean(
    ctx.next && ctx.family !== 'unknown' && ctx.next.family !== 'unknown'
    && ctx.next.family !== ctx.family,
  );
}

/**
 * Phrase role from structural position, the section's development role and
 * its contours — descriptive, never a chord instruction (spec §4). The
 * contract is seed-stable: the FIRST phrase always carries the section's
 * material identity (establish/repeat/develop/contrast), the LAST phrase
 * carries the arrival/departure (conclude/prepare), and middle phrases
 * develop when the section's dimensions actively evolve there (contour
 * movement), otherwise continue. For a single-phrase section the phrase is
 * both — the material identity wins, and the transitional nuance is carried
 * by the cadence intention instead of the role.
 */
function phraseRole(index: number, count: number, profile: SectionHarmonyProfile): PhraseRole {
  const ctx = profile.context;
  const first = index === 0;
  const last = index === count - 1;
  if (first && last) return ctx.isLast ? 'conclude' : profile.development.role;
  if (first) return profile.development.role;
  if (last) {
    if (ctx.isLast) return 'conclude';
    if (sectionPreparesDeparture(profile)) return 'prepare';
    return 'continue';
  }
  const center = (i: number) => (i + 0.5) / count;
  const tensionDelta = Math.abs(
    evaluateContour(profile.contours.tension, center(index))
    - evaluateContour(profile.contours.tension, center(index - 1)),
  );
  const rhythmDelta = Math.abs(
    evaluateContour(profile.contours.rhythm, center(index))
    - evaluateContour(profile.contours.rhythm, center(index - 1)),
  );
  return tensionDelta >= 0.1 || rhythmDelta >= 0.15 ? 'develop' : 'continue';
}

/**
 * Broad trajectory at the phrase's center (spec §7): sampled from the
 * section's contours and preferences, with small interpretable role biases.
 * A trajectory, not a bar-by-bar command — the generator keeps room for
 * local tension and release.
 */
function phraseDirection(
  index: number,
  count: number,
  role: PhraseRole,
  profile: SectionHarmonyProfile,
): { stability: number; movement: number; tension: number } {
  const center = (index + 0.5) / count;
  const tension = evaluateContour(profile.contours.tension, center);
  const movement = clamp01(
    0.5 * profile.preferences.movement.preferred
    + 0.5 * evaluateContour(profile.contours.rhythm, center),
  );
  const stability = profile.preferences.stability.preferred;
  let stabAdj = 0;
  let moveAdj = 0;
  let tensAdj = 0;
  if (role === 'prepare') { stabAdj += 0.08; tensAdj += 0.06; }
  if (role === 'contrast') { stabAdj -= 0.08; moveAdj += 0.05; }
  if (role === 'conclude') { stabAdj += 0.06; moveAdj -= 0.1; }
  if (role === 'develop') moveAdj += 0.08;
  return {
    stability: roundTo(clamp01(stability + stabAdj)),
    movement: roundTo(clamp01(movement + moveAdj)),
    tension: roundTo(clamp01(tension + tensAdj)),
  };
}

/** Within-section material references (spec §4); cross-section links are
 *  appended by planSongHarmony. */
function relatedWithin(index: number, count: number, role: PhraseRole, sectionId: string): string[] {
  const first = `${sectionId}#p0`;
  if (role === 'establish') return [];
  if (role === 'continue') return index > 0 ? [`${sectionId}#p${index - 1}`] : [];
  if (role === 'conclude') return count > 1 ? [first] : [];
  if (role === 'repeat' || role === 'develop' || role === 'contrast') return [first];
  return []; // prepare — an arrival gesture, not a material reference
}

/* --------------------------------------------------------------------------
 * Section harmonic goal (story pass) — what the section's arrival sequence
 * is trying to say, sampled from its profile before any chord exists.
 * ----------------------------------------------------------------------- */

const GOAL_DESCRIPTIONS: Record<SectionGoalKind, string> = {
  'home-arrival': 'Return home — the section lands back on the tonic by its last phrase',
  'subdominant-arrival': 'Rest away from home — the last arrival sits on the subdominant',
  'dominant-arrival': 'Hold tension over the seam — the last arrival sits on the dominant',
  'mid-departure': 'Leave the tonic in the middle and come back only by the end',
  'static-home': 'Stay near home throughout — an intentional static section',
  'journey': 'Keep moving — the arrivals visit distinct roots, development through motion',
};

/** Sample the section's harmonic goal from its profile — deterministic per
 *  (sectionId, seed). Profile preferences shape the weights: stable sections
 *  lean home/static, active sections lean journeys and departures, and the
 *  song's final section strongly leans home. A story beat, never an
 *  instruction: every chord decision stays with the contextual generators. */
export function sampleSectionGoal(
  profile: SectionHarmonyProfile, seed: number,
): SectionHarmonicGoal {
  const rng = mulberry32(hashString(
    ['crescode:section-goal', profile.context.sectionId, String(seed)].join('|'),
  ));
  const stab = profile.preferences.stability.preferred;
  const move = profile.preferences.movement.preferred;
  const contrast = profile.preferences.contrast.preferred;
  const w: Record<SectionGoalKind, number> = {
    'home-arrival': 2, 'subdominant-arrival': 1.2, 'dominant-arrival': 0.8,
    'mid-departure': 0.8, 'static-home': 0.7, 'journey': 0.8,
  };
  if (stab >= 0.65) { w['home-arrival'] += 1.5; w['static-home'] += 1.2; w['journey'] = Math.max(0.05, w['journey'] - 0.4); w['mid-departure'] = Math.max(0.05, w['mid-departure'] - 0.3); }
  if (stab <= 0.35) { w['mid-departure'] += 0.8; w['journey'] += 0.6; w['static-home'] = Math.max(0.05, w['static-home'] - 0.3); }
  if (move >= 0.6) { w['journey'] += 1.5; w['mid-departure'] += 1; w['dominant-arrival'] += 0.5; w['static-home'] = Math.max(0.05, w['static-home'] - 0.4); }
  if (move <= 0.35) { w['static-home'] += 0.8; w['home-arrival'] += 0.4; w['journey'] = Math.max(0.05, w['journey'] - 0.4); }
  if (contrast >= 0.6) { w['mid-departure'] += 0.6; w['subdominant-arrival'] += 0.4; }
  if (profile.context.isLast) { w['home-arrival'] += 2.5; w['journey'] *= 0.3; w['mid-departure'] *= 0.4; }
  const entries = (Object.keys(w) as SectionGoalKind[])
    .map((k) => [k, Math.max(0.05, w[k])] as const);
  const kind = pickWeighted(entries, rng);
  return { kind, description: GOAL_DESCRIPTIONS[kind] };
}

/* --------------------------------------------------------------------------
 * Entry point
 * ----------------------------------------------------------------------- */

/**
 * Plan the phrases of one section. Returns an empty phrase list only for a
 * degenerate zero/negative-length section; every positive length produces a
 * complete, gapless, overlap-free, bar-aligned plan.
 */
export function planSectionPhrases(
  project: Project,
  sectionProfile: SectionHarmonyProfile,
  options: PhrasePlanOptions = {},
): SectionPhrases {
  const settings: ChordGenSettings = { ...DEFAULT_CHORDGEN_SETTINGS, ...(project.chordGenSettings ?? {}) };
  const seed = options.seed ?? settings.seed;
  const ctx = sectionProfile.context;
  const bt = barTicks(project.timeSignature);
  const startTick = barToTick(ctx.startBar, project.timeSignature);
  const N = Math.max(0, ctx.lengthBars);
  if (N < 1) {
    return {
      sectionId: ctx.sectionId,
      phrases: [],
      goal: sampleSectionGoal(sectionProfile, options.seed ?? settings.seed),
    };
  }

  // Existing chords as planning context (read-only, spec §11).
  const existing = collectExistingHarmony(project, { startTick, endTick: startTick + N * bt });
  const anchors = new Map<number, number>();
  for (const tick of existing.chordChangeTicks) {
    const offset = (tick - startTick) / bt;
    if (Number.isInteger(offset) && offset > 0 && offset < N) {
      anchors.set(offset, Math.max(anchors.get(offset) ?? 0, 0.5));
    }
  }
  for (const span of existing.lockedChordSpans) {
    const offset = (span.startTick - startTick) / bt;
    if (Number.isInteger(offset) && offset > 0 && offset < N) {
      anchors.set(offset, Math.max(anchors.get(offset) ?? 0, 1));
    }
  }

  // Structure: overridden (repeated sections sharing a form) or generated.
  const override = options.structureOverride;
  let bars: number[];
  if (override && override.length > 0
    && override.every((b) => Number.isInteger(b) && b >= 1)
    && override.reduce((s, b) => s + b, 0) === N) {
    bars = [...override];
  } else {
    const rng = mulberry32(hashString(['crescode:phrases', ctx.sectionId, String(seed)].join('|')));
    bars = planComposition(N, lengthWindow(sectionActivity(sectionProfile), sectionProfile), sectionProfile, anchors, rng, settings.variation);
  }
  const count = bars.length;
  const goal = sampleSectionGoal(sectionProfile, seed);

  const phrases: HarmonicPhrase[] = [];
  let acc = 0;
  for (let i = 0; i < count; i++) {
    const lengthBars = bars[i];
    const role = phraseRole(i, count, sectionProfile);
    const cadence = planCadence(
      { role, index: i, count, isSongEnd: ctx.isLast },
      { project, profile: sectionProfile, settings, seed },
    );
    phrases.push({
      id: `${ctx.sectionId}#p${i}`,
      sectionId: ctx.sectionId,
      index: i,
      startTick: startTick + acc * bt,
      durationTicks: lengthBars * bt,
      startBar: ctx.startBar + acc,
      lengthBars,
      role,
      direction: phraseDirection(i, count, role, sectionProfile),
      cadence,
      relatedPhraseIds: relatedWithin(i, count, role, ctx.sectionId),
    });
    acc += lengthBars;
  }
  return { sectionId: ctx.sectionId, phrases, goal };
}
