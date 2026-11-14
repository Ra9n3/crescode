/**
 * Piano performance roles (Stage 2A).
 *
 * The Piano composes a complete independent piece first. This module decides,
 * one phrase at a time, how that piece is *presented* inside the finished
 * arrangement: featured, supporting, rhythmic, atmospheric or restrained.
 *
 * A role is a statement about musical function. It does not carry a density
 * or a velocity: those still come from the composition identity, the energy
 * arc and the archetype. The decision reads only evidence the engine already
 * has (lead annotation, the plan's interaction and hand intentions, conductor
 * moments, written activity by register, the section arc and the identity),
 * and it is deterministic: no random stream is drawn here.
 *
 * Without orchestral evidence every phrase is Featured and the presentation
 * pass is a no-op.
 */
import type { PianoArchetype, PianoProtectedTrait } from './piano-composition-identity';

export type PianoPerformanceRole = 'featured' | 'supporting' | 'rhythmic' | 'atmospheric' | 'restrained';

export const PIANO_PERFORMANCE_ROLES: readonly PianoPerformanceRole[] =
  ['featured', 'supporting', 'rhythmic', 'atmospheric', 'restrained'];

/** What is known about one phrase before its role is chosen. All shares are 0..1. */
export interface PianoPhraseRoleEvidence {
  readonly phraseId: string;
  readonly sectionName: string;
  /** The section-arc role of the independent composition (`PianoArcRole`). */
  readonly arcRole: string;
  /** Sounding (non-restricted) bars. */
  readonly liveBars: number;
  readonly meanEnergy: number;
  /** Position of this phrase's energy inside the piece: 0 quietest, 1 loudest. */
  readonly energyRank: number;
  /** The phrase contains the head of the Piano's theme. */
  readonly hasThemeHead: boolean;
  /** Centre of the Piano theme in this phrase (MIDI). */
  readonly themeCentre: number;
  /** Share of live bars in which an annotated lead sounds. */
  readonly leadCoverage: number;
  /** Lead attacks per bar in the bars where it sounds. */
  readonly leadOnsetsPerBar: number;
  readonly leadMeanPitch: number | null;
  /** Non-lead attacks per bar between MIDI 60 and 96 (pitched, non-bass parts). */
  readonly upperOnsetsPerBar: number;
  /** Attacks per bar between MIDI 28 and 55. */
  readonly bassOnsetsPerBar: number;
  /** Share of the phrase's chords for each `orchestration.interaction` value of the plan. */
  readonly interweaveShare: number;
  readonly leaveSpaceShare: number;
  readonly spotlightYieldShare: number;
  /** Share of chords whose planned left or right hand motion is `yield`. */
  readonly handYieldShare: number;
  /** Share of chords whose `structuralRole` is `arrival`. */
  readonly arrivalShare: number;
  /** Share of live bars inside a soli or unison moment that does not include the Piano. */
  readonly spotlightShare: number;
}

export interface PianoRoleContext {
  readonly evidenceAvailable: boolean;
  /** `plan.template.style.identity`, e.g. `chamber-counterpoint`. */
  readonly templateIdentity: string;
  readonly archetype: PianoArchetype;
  readonly protectedTraits: readonly PianoProtectedTrait[];
  readonly phrases: readonly PianoPhraseRoleEvidence[];
}

export interface PianoPhraseRoleDecision {
  readonly phraseId: string;
  readonly role: PianoPerformanceRole;
  /** Featured score; the phrase is featured at or above `PIANO_FEATURED_THRESHOLD`. Null without evidence or for vocal sections. */
  readonly featuredScore: number | null;
  /** Why this role, in plain language. */
  readonly reason: string;
  /** The figures the decision used. */
  readonly evidence: string;
  /** True when the stability pass changed the first choice. */
  readonly stabilised: boolean;
}

export const PIANO_FEATURED_THRESHOLD = 0.15;
/** A score this close to the threshold keeps the side of the previous phrase. */
export const PIANO_ROLE_HYSTERESIS = 0.08;

const TEMPLATE_BASE: Readonly<Record<string, number>> = {
  'chamber-counterpoint': 0.30,
  'sonata-dialogue': 0.36,
  'cinematic-expanse': 0.28,
  'hybrid-pulse-and-color': 0.28,
  'adaptive-spacious': 0.20,
};
/** Templates whose Piano must keep the ability to lead somewhere in the piece. */
const PIANO_LED_TEMPLATES = new Set(['chamber-counterpoint', 'sonata-dialogue']);
const VOCAL_TEMPLATE = 'vocal-space';
/** Sections of a song that a singer normally carries. */
const VOCAL_SECTION = /verse|chorus|refrain|hook|pre|bridge|vocal|strophe/i;

const ARC_WEIGHT: Readonly<Record<string, number>> = {
  statement: 0.20, climax: 0.20, arrival: 0.15, reprise: 0.10, build: 0, development: -0.05,
  contrast: -0.05, response: -0.10, release: -0.15, breath: 0,
};

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
const fixed = (value: number, digits = 2): string => value.toFixed(digits);

/** Whether the lead and the Piano theme would share a register in this phrase. */
function registerOverlap(phrase: PianoPhraseRoleEvidence): boolean {
  return phrase.leadMeanPitch !== null && Math.abs(phrase.leadMeanPitch - phrase.themeCentre) <= 7;
}

/** How much a lead weighs on the Piano's theme: fully in the same register, far less an octave or more away. */
function registerWeight(phrase: PianoPhraseRoleEvidence): number {
  if (phrase.leadMeanPitch === null) return 0;
  const distance = Math.abs(phrase.leadMeanPitch - phrase.themeCentre);
  return distance <= 7 ? 1 : distance <= 12 ? 0.7 : 0.45;
}

/** No other part writes anything in the phrase (for example a bar the conductor reserved for the Piano). */
function pianoAlone(phrase: PianoPhraseRoleEvidence): boolean {
  return phrase.leadCoverage === 0 && phrase.upperOnsetsPerBar === 0 && phrase.bassOnsetsPerBar === 0 && phrase.spotlightShare === 0;
}

export function pianoFeaturedScore(context: PianoRoleContext, phrase: PianoPhraseRoleEvidence): number {
  const base = TEMPLATE_BASE[context.templateIdentity] ?? TEMPLATE_BASE['adaptive-spacious'];
  // A lead does not by itself push the Piano back: what counts is how much of the phrase it
  // covers, how busy it is and where it sits. A slow lead, or one an octave away from the Piano's
  // theme, leaves room for a second melodic voice.
  const leadActivity = clamp(phrase.leadOnsetsPerBar / 4, 0, 1);
  const lead = phrase.leadCoverage * (0.1 + 0.25 * leadActivity) * registerWeight(phrase);
  const overlap = phrase.leadCoverage >= 0.5 && registerOverlap(phrase) ? 0.1 : 0;
  const saturation = 0.2 * clamp(phrase.upperOnsetsPerBar / 16, 0, 1);
  const head = phrase.hasThemeHead && context.protectedTraits.includes('theme-head') ? 0.08 : 0;
  return base + (ARC_WEIGHT[phrase.arcRole] ?? 0) - lead - overlap - saturation
    + 0.2 * phrase.interweaveShare - 0.05 * phrase.handYieldShare - 0.2 * phrase.spotlightYieldShare + head;
}

function describeEvidence(phrase: PianoPhraseRoleEvidence, score: number | null): string {
  const lead = phrase.leadCoverage > 0
    ? `lead in ${Math.round(phrase.leadCoverage * 100)}% of bars, ${fixed(phrase.leadOnsetsPerBar, 1)} attacks/bar, mean pitch ${phrase.leadMeanPitch === null ? 'n/a' : fixed(phrase.leadMeanPitch, 0)} against theme centre ${phrase.themeCentre}`
    : 'no annotated lead';
  return `${lead}; ${fixed(phrase.upperOnsetsPerBar, 1)} upper and ${fixed(phrase.bassOnsetsPerBar, 1)} low attacks/bar from other parts; `
    + `plan interaction interweave ${Math.round(phrase.interweaveShare * 100)}% / leave-space ${Math.round(phrase.leaveSpaceShare * 100)}%; `
    + `arc role ${phrase.arcRole}, energy rank ${fixed(phrase.energyRank)}`
    + (phrase.spotlightShare > 0 ? `; soli/unison without Piano in ${Math.round(phrase.spotlightShare * 100)}% of bars` : '')
    + (score === null ? '' : `; featured score ${fixed(score)} (threshold ${fixed(PIANO_FEATURED_THRESHOLD)})`);
}

/** The role of a phrase that is not featured. */
function collaborativeRole(context: PianoRoleContext, phrase: PianoPhraseRoleEvidence): { role: PianoPerformanceRole; reason: string } {
  if (phrase.upperOnsetsPerBar >= 24 && phrase.bassOnsetsPerBar >= 10 && context.archetype !== 'rhythmic') {
    return { role: 'restrained', reason: 'The orchestra is already writing densely in both the Piano\'s upper and lower registers: the Piano reduces to what still adds something.' };
  }
  const rhythmicIdentity = context.archetype === 'rhythmic'
    || (context.protectedTraits.includes('rhythm-cell') && context.protectedTraits[0] === 'rhythm-cell');
  if (rhythmicIdentity && phrase.energyRank >= 0.4) {
    return { role: 'rhythmic', reason: 'The piece\'s identity is rhythmic and the phrase has energy: the Piano keeps its rhythm and bass function and withholds the theme.' };
  }
  if (context.templateIdentity === 'hybrid-pulse-and-color' && phrase.energyRank >= 0.7 && phrase.upperOnsetsPerBar >= 8
    && context.archetype !== 'sparse') {
    return { role: 'rhythmic', reason: 'A loud, busy phrase of a pulse-driven template: the Piano contributes drive rather than a second melody.' };
  }
  if (phrase.energyRank <= 0.35 && (context.archetype === 'sparse' || context.archetype === 'chorale' || context.archetype === 'lyrical'
    || phrase.leadOnsetsPerBar <= 2)) {
    return { role: 'atmospheric', reason: 'A quiet phrase carried by others: the Piano adds sustained colour in a register that is free.' };
  }
  return { role: 'supporting', reason: 'Another part carries the phrase: the Piano accompanies and answers with its theme where there is room.' };
}

/**
 * One role per phrase. `breath` phrases (every bar restricted) are returned as
 * Featured with a neutral reason: there is nothing to present in them.
 */
export function derivePianoPerformanceRoles(context: PianoRoleContext): PianoPhraseRoleDecision[] {
  if (!context.evidenceAvailable) {
    return context.phrases.map((phrase) => ({
      phraseId: phrase.phraseId,
      role: 'featured' as const,
      featuredScore: null,
      reason: 'No orchestral evidence: the Piano presents its independent composition unchanged.',
      evidence: 'No composer-visible non-Piano track has notes.',
      stabilised: false,
    }));
  }
  const vocal = context.templateIdentity === VOCAL_TEMPLATE;
  const first: PianoPhraseRoleDecision[] = context.phrases.map((phrase) => {
    if (phrase.arcRole === 'breath' || phrase.liveBars === 0) {
      return { phraseId: phrase.phraseId, role: 'featured', featuredScore: null, reason: 'Rest phrase: nothing to present.', evidence: 'Every bar is a restricted window.', stabilised: false };
    }
    if (vocal) {
      // The arrangement may not contain the vocal as a track. The template says a singer is
      // there, so the song's sung sections are treated as led by the voice.
      if (VOCAL_SECTION.test(phrase.sectionName)) {
        const quiet = phrase.energyRank <= 0.35;
        return {
          phraseId: phrase.phraseId,
          role: quiet ? 'atmospheric' : 'supporting',
          featuredScore: null,
          reason: quiet
            ? `"${phrase.sectionName}" is a sung section at low energy: the Piano gives sustained colour under the voice.`
            : `"${phrase.sectionName}" is a sung section: the Piano accompanies and answers at the end of the phrase, where a singer breathes.`,
          evidence: `Vocal Backing template; section "${phrase.sectionName}" counts as sung although no vocal track is written. ${describeEvidence(phrase, null)}`,
          stabilised: false,
        };
      }
      return {
        phraseId: phrase.phraseId, role: 'featured', featuredScore: null,
        reason: `"${phrase.sectionName}" is not a sung section: the Piano presents its own material.`,
        evidence: `Vocal Backing template; section "${phrase.sectionName}" is instrumental. ${describeEvidence(phrase, null)}`,
        stabilised: false,
      };
    }
    const score = pianoFeaturedScore(context, phrase);
    if (pianoAlone(phrase)) {
      return {
        phraseId: phrase.phraseId, role: 'featured', featuredScore: score,
        reason: 'No other part writes anything in this phrase: the Piano is alone and presents its own material.',
        evidence: describeEvidence(phrase, score), stabilised: false,
      };
    }
    if (phrase.spotlightShare < 0.5 && score >= PIANO_FEATURED_THRESHOLD) {
      return {
        phraseId: phrase.phraseId, role: 'featured', featuredScore: score,
        reason: phrase.leadCoverage >= 0.5
          ? 'A lead is present but leaves room: the Piano presents its theme beside it as a second melodic voice.'
          : 'No other part claims the phrase: the Piano presents its theme and full texture.',
        evidence: describeEvidence(phrase, score), stabilised: false,
      };
    }
    const choice = collaborativeRole(context, phrase);
    const spotlight = phrase.spotlightShare >= 0.5 && score >= PIANO_FEATURED_THRESHOLD
      ? ' A soli or unison moment without the Piano covers most of the phrase, so the Piano does not feature its theme here.' : '';
    return { phraseId: phrase.phraseId, role: choice.role, featuredScore: score, reason: choice.reason + spotlight, evidence: describeEvidence(phrase, score), stabilised: false };
  });

  // Stability. Roles belong to phrases, and neighbouring phrases should not trade roles on
  // evidence that barely differs.
  const live = context.phrases.map((phrase, index) => ({ phrase, index }))
    .filter(({ phrase }) => phrase.arcRole !== 'breath' && phrase.liveBars > 0);
  const result = [...first];
  const stabilise = (index: number, role: PianoPerformanceRole, why: string) => {
    if (result[index].role === role) return;
    result[index] = { ...result[index], role, reason: `${why} First choice was ${result[index].role}.`, stabilised: true };
  };
  for (let position = 1; position < live.length; position++) {
    const { phrase, index } = live[position];
    const previous = result[live[position - 1].index];
    const current = result[index];
    if (!vocal && pianoAlone(phrase)) continue;
    if (phrase.liveBars <= 1) {
      stabilise(index, previous.role, 'A one-bar phrase keeps the role of the phrase before it.');
      continue;
    }
    if (!vocal && current.featuredScore !== null && Math.abs(current.featuredScore - PIANO_FEATURED_THRESHOLD) < PIANO_ROLE_HYSTERESIS
      && (current.role === 'featured') !== (previous.role === 'featured')
      && phrase.sectionName === context.phrases[live[position - 1].index].sectionName) {
      // Borderline evidence inside one section: stay on the side the section is already on.
      stabilise(index, previous.role === 'featured' ? 'featured' : previous.role,
        `Borderline score ${fixed(current.featuredScore)} inside "${phrase.sectionName}": the role of the previous phrase is kept.`);
    }
  }
  // A short phrase between two phrases that agree does not get a role of its own.
  for (let position = 1; position + 1 < live.length; position++) {
    const { phrase, index } = live[position];
    const before = result[live[position - 1].index];
    const after = result[live[position + 1].index];
    if (phrase.liveBars <= 2 && before.role === after.role && result[index].role !== before.role
      && !(vocal && before.role === 'featured') && (vocal || !pianoAlone(phrase))
      && !(before.role === 'featured' && phrase.spotlightShare >= 0.5)) {
      stabilise(index, before.role, 'A two-bar phrase between two phrases with the same role takes that role.');
    }
  }
  // Piano-led templates keep at least one phrase in which the Piano leads.
  if (PIANO_LED_TEMPLATES.has(context.templateIdentity) && live.length && !live.some(({ index }) => result[index].role === 'featured')) {
    const candidates = live.filter(({ phrase }) => phrase.spotlightShare < 0.5 && phrase.liveBars >= 2);
    const best = (candidates.length ? candidates : live)
      .reduce((top, entry) => ((result[entry.index].featuredScore ?? -9) > (result[top.index].featuredScore ?? -9) ? entry : top));
    stabilise(best.index, 'featured', 'This template is Piano-led: the phrase with the most room is given to the Piano.');
  }
  return result;
}
