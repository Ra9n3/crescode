/**
 * Song-level harmony planning (Phase 3) — one coherent blueprint per song.
 *
 * Combines Phase 2 section profiles with phrase plans (phrases.ts) and
 * cadence descriptions (cadences.ts), adds section-boundary intentions and
 * explicit repeated-material links between the phrases of related sections.
 *
 * Repeated material stays coherent (spec §4): the first occurrence of a
 * relationship group establishes a reusable phrase structure, and later
 * occurrences with the same length reuse that form when preserveIdentity is
 * on. Sections of different lengths are never forced into identical
 * boundaries — they plan freshly and link proportionally instead, leaving
 * Phase 4 to decide how much material to preserve.
 *
 * Pure and deterministic (spec §10): identical (project, seed) → identical
 * plan; the seed is echoed, never advanced or persisted. Sections keep their
 * exact spans; phrases cover them gaplessly; chords are only ever READ.
 * Nothing here touches the manual chord editor, the orchestral generator or
 * the UI.
 */
import { barToTick } from '../../shared/schema/meter';
import {
  DEFAULT_CHORDGEN_SETTINGS, type ChordGenSettings, type Project,
} from '../../shared/schema/types';
import { hashString, mulberry32 } from '../generate';
import { relationshipKey } from './context';
import { buildSongHarmonyProfiles } from './profiles';
import { planSectionPhrases } from './phrases';
import { applyVariation, pickWeighted, topOf } from './planning';
import type {
  BoundaryIntention, CadenceIntention, HarmonicPhrase, PlannedSection,
  SectionBoundaryPlan, SectionHarmonyProfile, SongHarmonyPlan, SongPlanOptions,
} from './types';

/** All boundary intentions in deterministic order (the pick's tie-break). */
export const BOUNDARY_INTENTIONS: readonly BoundaryIntention[] = [
  'continuation', 'preparation', 'resolution', 'contrast', 'suspension', 'abrupt',
];

export interface BoundaryTendencyInput {
  from: SectionHarmonyProfile;
  to: SectionHarmonyProfile;
  /** Cadence intention of `from`'s last phrase — the seam's starting side. */
  endingIntention?: CadenceIntention;
  /** Merged over DEFAULT_CHORDGEN_SETTINGS when omitted. */
  settings?: Partial<ChordGenSettings>;
}

/** How a cadential arrival tends to color the seam that follows it. */
const INTENTION_TO_SEAM: Partial<Record<CadenceIntention, BoundaryIntention[]>> = {
  resolved: ['resolution'],
  transitional: ['preparation'],
  open: ['continuation'],
  suspended: ['suspension'],
  ambiguous: ['suspension', 'abrupt'],
  deceptive: ['contrast'],
  modal: ['continuation', 'contrast'],
};

/**
 * Deterministic boundary weights for one seam — the honest, inspectable
 * planning surface behind the picked intention. Structural facts (energy
 * delta, family change, what returns) shift weights; nothing is mandatory
 * and smooth and abrupt seams both stay reachable (spec §8).
 */
export function boundaryTendencies(input: BoundaryTendencyInput): Record<BoundaryIntention, number> {
  const settings: ChordGenSettings = { ...DEFAULT_CHORDGEN_SETTINGS, ...(input.settings ?? {}) };
  // sectionAware scales the contextual shifts; the base seam vocabulary stays.
  const cf = settings.sectionAware ? 1 : 0.5;
  const from = input.from.context;
  const to = input.to.context;
  const energyDelta = to.energy - from.energy;
  const w: Record<BoundaryIntention, number> = {
    continuation: 1.5, preparation: 1.25, resolution: 0.75, contrast: 1, suspension: 0.5, abrupt: 0.3,
  };

  // The same material returning right away flows onward.
  if (from.family !== 'unknown' && from.family === to.family) {
    w.continuation += 1.5 * cf;
    w.preparation += 0.25 * cf;
    w.contrast *= 1 - 0.5 * cf;
    w.abrupt *= 1 - 0.6 * cf;
  }
  // Energy shape of the seam: rises anticipate, drops cut or release.
  if (energyDelta >= 0.2) { w.preparation += 1.25 * cf; w.contrast += 0.35 * cf; }
  if (energyDelta <= -0.2) {
    w.contrast += 0.9 * cf;
    w.abrupt += 0.9 * cf;
    w.resolution += 0.35 * cf;
  }
  // Identities with a strong sense of arrival or unwind.
  if (to.identity === 'outro' || to.identity === 'coda') {
    w.resolution += 1.4 * cf;
    w.continuation += 0.2 * cf;
  }
  if (to.identity === 'breakdown') { w.contrast += 0.6 * cf; w.suspension += 0.6 * cf; }
  if (to.qualifier === 'final') { w.preparation += 0.8 * cf; w.resolution += 0.5 * cf; }
  if (to.identity === 'chorus'
    && (from.identity === 'bridge' || from.identity === 'breakdown' || from.identity === 'solo')) {
    // The return home after a departure reads as preparation and arrival.
    w.preparation += 0.75 * cf;
    w.resolution += 0.5 * cf;
  }
  // Returning to familiar material reads as arrival, not departure.
  if (to.isRepeated && to.occurrence > 1) {
    w.resolution += 0.35 * cf;
    w.continuation += 0.25 * cf;
  }
  // The ending side colors the seam.
  if (input.endingIntention) {
    for (const seam of INTENTION_TO_SEAM[input.endingIntention] ?? []) w[seam] += 0.4 * cf;
  }
  // Contrast preference invites harder seams; stability softens them.
  if (input.from.preferences.contrast.preferred >= 0.6) w.contrast += 0.35 * cf;
  if (input.from.preferences.stability.preferred >= 0.6) w.abrupt *= 1 - 0.3 * cf;
  return w;
}

/* --------------------------------------------------------------------------
 * Entry point
 * ----------------------------------------------------------------------- */

/** Nearest first-occurrence phrase by normalized center — the proportional
 *  link used when related sections have different lengths (spec §4). */
function nearestPhrase(
  phrases: HarmonicPhrase[],
  sectionStartTick: number,
  sectionDurationTicks: number,
  target: HarmonicPhrase,
  targetStartTick: number,
  targetDurationTicks: number,
): HarmonicPhrase {
  const center = (p: HarmonicPhrase, startTick: number, durationTicks: number) =>
    (p.startTick + p.durationTicks / 2 - startTick) / Math.max(1, durationTicks);
  const t = center(target, targetStartTick, targetDurationTicks);
  let best = phrases[0];
  let bestDistance = Infinity;
  for (const p of phrases) {
    const d = Math.abs(center(p, sectionStartTick, sectionDurationTicks) - t);
    if (d < bestDistance) { best = p; bestDistance = d; }
  }
  return best;
}

/**
 * Plan the whole song's harmonic phrase blueprint. Returns an empty section
 * list for a sectionless project; every positive-length section produces a
 * complete, gapless plan with a boundary into its successor (null for the
 * last section).
 */
export function planSongHarmony(project: Project, options: SongPlanOptions = {}): SongHarmonyPlan {
  const settings: ChordGenSettings = { ...DEFAULT_CHORDGEN_SETTINGS, ...(project.chordGenSettings ?? {}) };
  const seed = options.seed ?? settings.seed;
  const profiles = buildSongHarmonyProfiles(project);
  if (profiles.length === 0) return { seed, sections: [] };

  // Pass 1 — phrase every section; the first occurrence of each relationship
  // group establishes the form later occurrences may reuse.
  const firstForm = new Map<string, { lengthBars: number; bars: number[]; phrases: HarmonicPhrase[]; startTick: number; durationTicks: number }>();
  const planned: PlannedSection[] = [];

  for (const profile of profiles) {
    const ctx = profile.context;
    const key = relationshipKey(ctx.name, ctx.family);
    const first = firstForm.get(key);
    const sectionStartTick = barToTick(ctx.startBar, project.timeSignature);
    const sectionDurationTicks = ctx.lengthBars * profile.meter.barTicks;

    const reuse = first !== undefined
      && settings.preserveIdentity
      && first.lengthBars === ctx.lengthBars;
    const { phrases, goal } = planSectionPhrases(project, profile, {
      seed,
      structureOverride: reuse ? first!.bars.map((b) => b) : undefined,
    });

    if (first === undefined && phrases.length > 0) {
      firstForm.set(key, {
        lengthBars: ctx.lengthBars,
        bars: phrases.map((p) => p.lengthBars),
        phrases,
        startTick: sectionStartTick,
        durationTicks: sectionDurationTicks,
      });
    }

    // Explicit repeated-material links (spec §4): by index when the forms
    // match, proportionally when they do not — never forced.
    if (first !== undefined && ctx.occurrence > 1 && first.phrases.length > 0) {
      const sameShape = first.phrases.length === phrases.length
        && first.phrases.every((f, i) => f.lengthBars === phrases[i].lengthBars);
      for (let i = 0; i < phrases.length; i++) {
        const target = sameShape
          ? first.phrases[i]
          : nearestPhrase(first.phrases, first.startTick, first.durationTicks, phrases[i], sectionStartTick, sectionDurationTicks);
        phrases[i] = {
          ...phrases[i],
          relatedPhraseIds: [...phrases[i].relatedPhraseIds, target.id],
        };
      }
    }

    planned.push({
      sectionId: ctx.sectionId,
      sectionName: ctx.name,
      startBar: ctx.startBar,
      lengthBars: ctx.lengthBars,
      startTick: sectionStartTick,
      durationTicks: sectionDurationTicks,
      phrases,
      goal,
      boundary: null,
    });
  }

  // Pass 2 — seam planning between chronological neighbors.
  for (let i = 0; i < planned.length - 1; i++) {
    const cur = planned[i];
    const nxt = planned[i + 1];
    const lastPhrase = cur.phrases[cur.phrases.length - 1];
    const tendencies = boundaryTendencies({
      from: profiles[i],
      to: profiles[i + 1],
      endingIntention: lastPhrase?.cadence.intention,
      settings,
    });
    const rng = mulberry32(hashString(
      ['crescode:boundary', cur.sectionId, nxt.sectionId, String(seed)].join('|'),
    ));
    const intention = pickWeighted(
      applyVariation(
        BOUNDARY_INTENTIONS.map((b) => [b, tendencies[b]] as const),
        settings.variation,
      ),
      rng,
    );
    const boundary: SectionBoundaryPlan = { fromSectionId: cur.sectionId, toSectionId: nxt.sectionId, intention };
    cur.boundary = boundary;
  }

  return { seed, sections: planned };
}

/** Exposed for tests/diagnostics: the deterministic top seam for a boundary. */
export function topBoundaryIntention(input: BoundaryTendencyInput): BoundaryIntention {
  return topOf(boundaryTendencies(input));
}
