/**
 * Piano section transitions (Stage 2A).
 *
 * One decision per section boundary, taken for the last bar of the outgoing
 * section. The decision looks at both sides of the boundary: where the energy
 * is going, what the two sections are in the form, what the harmony does,
 * what kind of piece this is, and whether the Piano was given the bar as a
 * fill. `none` and `minimal` are ordinary outcomes; nothing is added to make
 * a boundary look different from the last one.
 *
 * The decision is part of the independent composition, so it also shapes
 * Piano-only pieces. When the finished arrangement is known, a second pass
 * may only *withdraw or narrow* a gesture: another instrument that already
 * fills the bar keeps it, and a Piano that is not featured does not announce
 * the next section with a flourish.
 *
 * Deterministic: the only variation comes from the caller's seeded `noise`.
 */
import type { PianoArchetype, PianoRunPolicy } from './piano-composition-identity';
import type { PianoPerformanceRole } from './piano-performance-role';

export type PianoTransitionGesture =
  | 'pickup' | 'rising-figure' | 'descending-resolution' | 'cadence' | 'short-fill' | 'chordal-punctuation'
  | 'sustained-handover' | 'break' | 'register-lift' | 'flourish' | 'minimal' | 'none';

export const PIANO_TRANSITION_GESTURES: readonly PianoTransitionGesture[] = [
  'pickup', 'rising-figure', 'descending-resolution', 'cadence', 'short-fill', 'chordal-punctuation',
  'sustained-handover', 'break', 'register-lift', 'flourish', 'minimal', 'none',
];

/** Everything the independent composition knows about one boundary. */
export interface PianoBoundaryContext {
  /** Last bar of the outgoing section. */
  readonly bar: number;
  readonly outgoingSection: string;
  readonly incomingSection: string;
  readonly outgoingArcRole: string;
  readonly incomingArcRole: string;
  /** Energy of the last bar as the conductor supplied it (it may contain the general pre-change dip). */
  readonly suppliedEnergy: number;
  /** Energy the outgoing section reaches before the boundary, without that dip. */
  readonly outgoingEnergy: number;
  /** Mean energy of the first bars of the incoming section. */
  readonly incomingEnergy: number;
  /** The last bar is a near-silence or explicit leave-space window. */
  readonly restricted: boolean;
  /** The first bar of the incoming section is restricted. */
  readonly incomingRestricted: boolean;
  /** The theme development already ends this bar with a run. */
  readonly existingRun: 'up' | 'down' | null;
  readonly level: number;
  /** Eighth-note slots in the bar. */
  readonly slots: number;
  /** The right hand carries a theme bar here. */
  readonly hasRightHandTheme: boolean;
  /** Root falls a fifth (or rises a fourth) into the incoming section. */
  readonly authenticMotion: boolean;
  /** The conductor reserved this bar as a Piano fill and the plan accepted it. */
  readonly pianoOwnsFill: boolean;
  readonly incomingIsClimax: boolean;
  readonly incomingIsFinalSection: boolean;
  /** The incoming section name has been heard before. */
  readonly incomingReturns: boolean;
  /** Bars in the outgoing section. */
  readonly outgoingBars: number;
}

export interface PianoTransitionFacts {
  readonly archetype: PianoArchetype;
  readonly runs: PianoRunPolicy;
  readonly sixteenthRuns: boolean;
  readonly density: number;
}

/** What the finished arrangement adds at one boundary. */
export interface PianoBoundaryOrchestration {
  readonly outgoingRole: PianoPerformanceRole;
  readonly incomingRole: PianoPerformanceRole;
  /** Attacks by other parts in the second half of the bar. */
  readonly tailOnsets: number;
  /** Their usual attacks per half bar in the two bars before. */
  readonly usualHalfBarOnsets: number;
  /** Notes other parts tagged as a fill or flourish in the bar. */
  readonly fillTaggedNotes: number;
  /** Tracks that carry the tail (for the report). */
  readonly tailTrackIds: readonly string[];
  /** How the role directive presents the theme in this bar. A figure needs a melodic line to be written into. */
  readonly melody: 'theme' | 'answers' | 'skeleton' | 'none';
  /** The role directive rests a hand, or the whole Piano, in this bar. */
  readonly rest: 'left' | 'right' | 'both' | null;
}

export interface PianoTransitionDecision {
  readonly bar: number;
  readonly boundary: string;
  readonly gesture: PianoTransitionGesture;
  readonly reason: string;
  readonly evidence: string;
  /** Change of the bar's dynamic level (Piano intensity scale 0-5). */
  readonly intensityDelta: number;
  /** Velocity points added progressively from the start to the end of the bar. */
  readonly ramp: number;
  /** The three best-scoring candidates, for the report. */
  readonly candidates: readonly { readonly gesture: PianoTransitionGesture; readonly score: number }[];
  /** The gesture of the independent composition (equal to `gesture` unless the arrangement changed it). */
  readonly independentGesture: PianoTransitionGesture;
  readonly changedByArrangement: boolean;
  /** The figure is the run the theme development already wrote into this bar; no second gesture was added. */
  readonly fromThemeRun: boolean;
  /** Set when the selected figure could not be written into the bar and the decision fell back to this one. */
  readonly fallbackFrom?: PianoTransitionGesture;
}

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

/** -1 (clearly falling) .. +1 (clearly rising). */
export function boundaryRise(boundary: Pick<PianoBoundaryContext, 'outgoingEnergy' | 'incomingEnergy'>): number {
  return clamp((boundary.incomingEnergy - boundary.outgoingEnergy) / 0.2, -1, 1);
}

const DYNAMICS: Readonly<Record<PianoTransitionGesture, { delta: number; ramp: number }>> = {
  pickup: { delta: 0, ramp: 0 },
  'rising-figure': { delta: 0.2, ramp: 8 },
  flourish: { delta: 0.3, ramp: 10 },
  'register-lift': { delta: 0.1, ramp: 4 },
  'short-fill': { delta: 0, ramp: 0 },
  'chordal-punctuation': { delta: 0.2, ramp: 0 },
  'descending-resolution': { delta: -0.3, ramp: -8 },
  cadence: { delta: -0.2, ramp: -5 },
  'sustained-handover': { delta: -0.35, ramp: 0 },
  break: { delta: 0, ramp: 0 },
  minimal: { delta: 0, ramp: 0 },
  none: { delta: 0, ramp: 0 },
};

function dynamicsFor(gesture: PianoTransitionGesture, rise: number): { delta: number; ramp: number } {
  // Minimal means: no figure, only the dynamic direction the form asks for.
  if (gesture === 'minimal') return { delta: 0, ramp: Math.round(6 * rise) };
  if (gesture === 'pickup') return { delta: 0.1 * rise, ramp: rise > 0 ? 4 : 0 };
  return DYNAMICS[gesture];
}

type Scores = Partial<Record<PianoTransitionGesture, number>>;

/** Affinity of every gesture that is possible at this boundary. */
export function scorePianoTransition(boundary: PianoBoundaryContext, facts: PianoTransitionFacts): Scores {
  const rise = boundaryRise(boundary);
  const up = Math.max(0, rise);
  const down = Math.max(0, -rise);
  const a = facts.archetype;
  const is = (...kinds: PianoArchetype[]) => kinds.includes(a);
  const fullBar = boundary.slots >= 8;
  const scores: Scores = {};
  scores.none = 0.34 - 0.3 * Math.abs(rise) + (boundary.outgoingBars <= 2 ? 0.3 : 0) + (boundary.level === 0 ? 0.2 : 0);
  scores.minimal = 0.4 - 0.2 * Math.abs(rise) + (is('sparse') ? 0.1 : 0);
  if (boundary.level >= 1) {
    scores.cadence = 0.28 + 0.3 * down + (boundary.authenticMotion ? 0.25 : 0) + (is('chorale', 'lyrical') ? 0.15 : 0)
      + (boundary.outgoingArcRole === 'release' || boundary.incomingIsFinalSection ? 0.1 : 0);
    scores['sustained-handover'] = 0.2 + 0.4 * down + (is('sparse', 'chorale') ? 0.25 : 0) + (boundary.outgoingEnergy < 0.45 ? 0.1 : 0);
    scores['chordal-punctuation'] = 0.18 + 0.3 * up + (is('rhythmic', 'chorale') ? 0.25 : 0) + (boundary.outgoingEnergy >= 0.6 ? 0.1 : 0)
      - (is('lyrical', 'flowing') ? 0.1 : 0);
  }
  if (boundary.hasRightHandTheme && fullBar) {
    scores.pickup = 0.32 + 0.45 * up + (is('lyrical', 'dialogue', 'flowing') ? 0.1 : 0) + (boundary.incomingReturns ? 0.05 : 0)
      - (boundary.incomingRestricted ? 1 : 0);
    scores['descending-resolution'] = 0.22 + 0.55 * down + (is('lyrical', 'flowing') ? 0.1 : 0) + (boundary.incomingIsFinalSection ? 0.1 : 0);
    scores['short-fill'] = 0.26 + 0.15 * Math.abs(rise) + (boundary.pianoOwnsFill ? 0.35 : 0) + (is('rhythmic', 'dialogue') ? 0.1 : 0)
      - (is('chorale') ? 0.2 : 0);
    scores['register-lift'] = 0.14 + 0.4 * up + (boundary.incomingArcRole === 'reprise' || boundary.incomingIsClimax ? 0.15 : 0)
      + (is('lyrical', 'chorale') ? 0.05 : 0);
    if (facts.runs !== 'none' && !is('chorale')) {
      scores['rising-figure'] = 0.18 + 0.55 * up + (boundary.incomingIsClimax ? 0.2 : 0) + (facts.runs === 'free' ? 0.1 : -0.05)
        + (is('flowing', 'rhythmic') ? 0.1 : 0) + (boundary.pianoOwnsFill ? 0.1 : 0) - (boundary.level < 2 ? 0.2 : 0);
    }
    if (facts.runs === 'free' && facts.sixteenthRuns && facts.density >= 0.75 && boundary.level >= 2) {
      scores.flourish = 0.02 + 0.5 * up + (boundary.incomingIsClimax ? 0.3 : 0) + (boundary.pianoOwnsFill ? 0.1 : 0);
    }
  }
  if (boundary.level >= 2 && fullBar && up > 0.5 && boundary.outgoingEnergy >= 0.45) {
    scores.break = 0.05 + 0.3 * up * (boundary.incomingIsClimax ? 1 : 0.5) + (is('rhythmic') ? 0.15 : 0);
  }
  return scores;
}

/** Gestures a role may still play at the end of its phrase. */
const ROLE_ALLOWS: Readonly<Record<PianoPerformanceRole, readonly PianoTransitionGesture[] | null>> = {
  featured: null,
  supporting: ['pickup', 'descending-resolution', 'cadence', 'short-fill', 'chordal-punctuation', 'sustained-handover', 'register-lift', 'minimal', 'none', 'break'],
  rhythmic: ['chordal-punctuation', 'break', 'cadence', 'minimal', 'none'],
  atmospheric: ['sustained-handover', 'cadence', 'minimal', 'none'],
  restrained: ['minimal', 'none'],
};

function boundaryEvidence(boundary: PianoBoundaryContext): string {
  const rise = boundaryRise(boundary);
  return `"${boundary.outgoingSection}" (${boundary.outgoingArcRole}) to "${boundary.incomingSection}" (${boundary.incomingArcRole}); `
    + `energy ${boundary.outgoingEnergy.toFixed(2)} to ${boundary.incomingEnergy.toFixed(2)} (${rise > 0.25 ? 'rising' : rise < -0.25 ? 'falling' : 'level'}); `
    + `conductor value for the bar ${boundary.suppliedEnergy.toFixed(2)}; `
    + `${boundary.authenticMotion ? 'root falls a fifth into the new section; ' : ''}`
    + `${boundary.pianoOwnsFill ? 'bar reserved as a Piano fill; ' : ''}texture level ${boundary.level}`;
}

const WHY: Readonly<Record<PianoTransitionGesture, string>> = {
  pickup: 'The theme leads into the new section with an upbeat that arrives on its first note.',
  'rising-figure': 'The line climbs through the second half of the bar with a crescendo into a stronger section.',
  flourish: 'A quick run with a crescendo announces the high point that follows.',
  'register-lift': 'The line climbs by chord tones so the next section starts from a higher register.',
  'short-fill': 'A short turn fills the end of the bar.',
  'chordal-punctuation': 'Two struck chords close the section: one on the downbeat, one before the bar line.',
  'descending-resolution': 'The line steps down and softens into a calmer section.',
  cadence: 'The bar broadens into a cadence: bass, then the held chord, slightly softer.',
  'sustained-handover': 'Everything is held and softened, handing the next section over without a figure.',
  break: 'After the downbeat the Piano stops, so the new section enters out of a short silence.',
  minimal: 'No figure: only the dynamic direction of the form is followed.',
  none: 'The section runs on into the next one unchanged.',
};

function pick(
  scores: Scores, allowed: readonly PianoTransitionGesture[] | null, bar: number,
  previous: PianoTransitionGesture | null, recall: PianoTransitionGesture | null, noise: (label: string) => number,
): { gesture: PianoTransitionGesture; ranked: { gesture: PianoTransitionGesture; score: number }[] } {
  const ranked = PIANO_TRANSITION_GESTURES
    .filter((gesture) => scores[gesture] !== undefined && (!allowed || allowed.includes(gesture)))
    .map((gesture) => {
      let score = scores[gesture]! + 0.12 * noise(`independent:transition:${bar}:${gesture}`);
      // A boundary the form repeats may sound the same again: that is recall, not habit.
      if (recall === gesture) score += 0.12;
      // Otherwise the same figure twice in a row is a habit. Leaving a boundary alone is not a figure.
      else if (previous === gesture && gesture !== 'none' && gesture !== 'minimal') score -= 0.3;
      return { gesture, score: Math.round(score * 1000) / 1000 };
    })
    .sort((x, y) => y.score - x.score || PIANO_TRANSITION_GESTURES.indexOf(x.gesture) - PIANO_TRANSITION_GESTURES.indexOf(y.gesture));
  return { gesture: ranked[0]?.gesture ?? 'none', ranked };
}

/**
 * Transition decisions of the independent composition.
 * `noise(label)` must return a seeded value in [0, 1).
 */
export function planPianoTransitions(
  boundaries: readonly PianoBoundaryContext[],
  facts: PianoTransitionFacts,
  noise: (label: string) => number,
): PianoTransitionDecision[] {
  const decisions: PianoTransitionDecision[] = [];
  const byForm = new Map<string, PianoTransitionGesture>();
  let previous: PianoTransitionGesture | null = null;
  for (const boundary of boundaries) {
    const formKey = `${boundary.outgoingSection}>${boundary.incomingSection}`;
    const rise = boundaryRise(boundary);
    const label = `bar ${boundary.bar}: ${boundary.outgoingSection} to ${boundary.incomingSection}`;
    let gesture: PianoTransitionGesture;
    let reason: string;
    let ranked: { gesture: PianoTransitionGesture; score: number }[] = [];
    if (boundary.restricted) {
      gesture = 'break';
      reason = 'The bar is a supplied near-silence or leave-space window: the Piano is silent for the whole bar and writes no isolated note into it.';
    } else if (boundary.existingRun) {
      gesture = boundary.existingRun === 'up' ? 'rising-figure' : 'descending-resolution';
      reason = 'The development of the theme already ends this phrase with a run; no second gesture is added.';
    } else {
      const chosen = pick(scorePianoTransition(boundary, facts), null, boundary.bar, previous, byForm.get(formKey) ?? null, noise);
      gesture = chosen.gesture;
      ranked = chosen.ranked;
      reason = WHY[gesture] + (byForm.get(formKey) === gesture ? ' The same boundary earlier in the form used this gesture; it is recalled.' : '');
    }
    const dynamics = boundary.restricted || boundary.existingRun ? { delta: 0, ramp: 0 } : dynamicsFor(gesture, rise);
    decisions.push({
      bar: boundary.bar, boundary: label, gesture, reason, evidence: boundaryEvidence(boundary),
      intensityDelta: dynamics.delta, ramp: dynamics.ramp, candidates: ranked.slice(0, 3),
      independentGesture: gesture, changedByArrangement: false,
      fromThemeRun: !boundary.restricted && boundary.existingRun !== null,
    });
    if (!boundary.restricted) { previous = gesture; if (!byForm.has(formKey)) byForm.set(formKey, gesture); }
  }
  return decisions;
}

/** Gestures that are written into the Piano's melodic line. */
const MELODIC_GESTURES: ReadonlySet<PianoTransitionGesture> = new Set([
  'pickup', 'rising-figure', 'descending-resolution', 'short-fill', 'register-lift', 'flourish',
]);

/** Another part is already making the transition in this bar. */
export function otherPartOwnsTransition(orchestration: PianoBoundaryOrchestration): 'strong' | 'present' | null {
  if (orchestration.fillTaggedNotes >= 2) return 'strong';
  const { tailOnsets, usualHalfBarOnsets } = orchestration;
  if (tailOnsets >= 10 && tailOnsets >= 1.5 * usualHalfBarOnsets) return 'strong';
  if (tailOnsets >= 6 && tailOnsets >= 1.5 * usualHalfBarOnsets) return 'present';
  return null;
}

/**
 * The same decisions inside the finished arrangement. A decision is kept
 * unless the arrangement gives a reason against it; a replacement is the
 * best-scoring gesture that is still allowed.
 */
export function adaptPianoTransitions(
  independent: readonly PianoTransitionDecision[],
  boundaries: readonly PianoBoundaryContext[],
  facts: PianoTransitionFacts,
  orchestration: ReadonlyMap<number, PianoBoundaryOrchestration>,
  noise: (label: string) => number,
): PianoTransitionDecision[] {
  const result: PianoTransitionDecision[] = [];
  let previous: PianoTransitionGesture | null = null;
  independent.forEach((decision, index) => {
    const boundary = boundaries[index];
    const context = orchestration.get(decision.bar);
    if (!context || boundary.restricted) { result.push(decision); return; }
    if (context.rest === 'both') {
      // The role directive rests the whole Piano in this bar. Nothing can be written, so nothing is announced.
      const changed = decision.gesture !== 'none';
      result.push({
        ...decision, gesture: 'none',
        reason: `No gesture: the Piano rests for this whole bar (${context.outgoingRole} role, both registers are full).${changed ? ` The independent composition chose ${decision.gesture}.` : ''}`,
        intensityDelta: 0, ramp: 0, changedByArrangement: changed, fromThemeRun: false,
      });
      return;
    }
    const owner = boundary.pianoOwnsFill ? null : otherPartOwnsTransition(context);
    let allowed: readonly PianoTransitionGesture[] | null = ROLE_ALLOWS[context.outgoingRole];
    const reasons: string[] = [];
    if (context.outgoingRole !== 'featured') reasons.push(`the Piano is ${context.outgoingRole} in the outgoing phrase`);
    if (owner === 'strong') {
      allowed = ['none'];
      reasons.push(`other parts already fill the end of the bar (${context.tailOnsets} attacks in its second half against ${context.usualHalfBarOnsets.toFixed(1)} usual${context.fillTaggedNotes ? `, ${context.fillTaggedNotes} fill notes` : ''}; ${context.tailTrackIds.join(', ') || 'several tracks'})`);
    } else if (owner === 'present') {
      allowed = (allowed ?? PIANO_TRANSITION_GESTURES).filter((gesture) => gesture === 'minimal' || gesture === 'none' || gesture === 'sustained-handover' || gesture === 'cadence');
      reasons.push(`another part is active at the end of the bar (${context.tailOnsets} attacks in its second half against ${context.usualHalfBarOnsets.toFixed(1)} usual)`);
    }
    // An upbeat announces the Piano's own entry; it is not played into a phrase the Piano does not lead.
    if (context.incomingRole !== 'featured' && (!allowed || allowed.includes('pickup')) && context.outgoingRole !== 'featured') {
      allowed = (allowed ?? PIANO_TRANSITION_GESTURES).filter((gesture) => gesture !== 'pickup');
    }
    // A melodic figure is written into the theme line. Where the role withholds the theme, or reduces it to
    // long notes, only gestures that shape the whole bar remain.
    const lineAvailable = context.melody === 'theme' || context.melody === 'answers';
    if (!lineAvailable) {
      allowed = (allowed ?? PIANO_TRANSITION_GESTURES).filter((gesture) => !MELODIC_GESTURES.has(gesture));
      reasons.push(context.melody === 'none' ? 'the theme is withheld in this bar' : 'the theme is reduced to long notes in this bar');
    }
    if (boundary.existingRun && lineAvailable) {
      // The run belongs to the theme development. It stays when the role still presents the theme.
      result.push(decision); previous = decision.gesture; return;
    }
    if (!allowed || allowed.includes(decision.gesture)) { result.push(decision); previous = decision.gesture; return; }
    const chosen = pick(scorePianoTransition(boundary, facts), allowed, boundary.bar, previous, null, noise);
    const dynamics = dynamicsFor(chosen.gesture, boundaryRise(boundary));
    result.push({
      ...decision,
      gesture: chosen.gesture,
      reason: `${WHY[chosen.gesture]} The independent composition chose ${decision.gesture}; changed because ${reasons.join(' and ')}.`,
      intensityDelta: dynamics.delta, ramp: dynamics.ramp, candidates: chosen.ranked.slice(0, 3),
      changedByArrangement: true, fromThemeRun: false,
    });
    previous = chosen.gesture;
  });
  return result;
}

/* ------------------------------------------------------------------ */
/* Decision against written notes                                      */
/* ------------------------------------------------------------------ */

/** A written Piano note, as far as a transition check needs it. */
export interface PianoTransitionNote {
  readonly startTick: number;
  readonly durationTicks: number;
  readonly pitch: number;
  /** The note belongs to the right-hand theme line. */
  readonly melody: boolean;
}

export interface PianoTransitionBar {
  readonly startTick: number;
  readonly endTick: number;
  /** Ticks inside the bar at which the harmony changes (a held part may re-strike there). */
  readonly chordStarts: readonly number[];
  /** The theme development already wrote a run into this bar. */
  readonly existingRun?: boolean;
}

export interface PianoTransitionRendering {
  readonly bar: number;
  readonly gesture: PianoTransitionGesture;
  /** Whether the notes of the bar show the selected gesture. */
  readonly rendered: boolean;
  /** What the bar contains, in plain words. */
  readonly found: string;
}

/**
 * Compares one decision with the notes that were written into its bar. This is
 * a statement about notes, not about how the bar sounds.
 */
export function verifyPianoTransition(
  decision: Pick<PianoTransitionDecision, 'bar' | 'gesture'>,
  bar: PianoTransitionBar,
  notes: readonly PianoTransitionNote[],
): PianoTransitionRendering {
  const { startTick: start, endTick: end } = bar;
  const length = end - start;
  const eighth = Math.round(length / 8);
  const quarter = 2 * eighth;
  const inBar = notes.filter((note) => note.startTick >= start && note.startTick < end)
    .sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
  const line = inBar.filter((note) => note.melody);
  const others = inBar.filter((note) => !note.melody);
  const attacks = [...new Set(inBar.map((note) => note.startTick - start))];
  const rising = (items: readonly PianoTransitionNote[]) => items.every((note, index) => index === 0 || note.pitch > items[index - 1].pitch);
  const falling = (items: readonly PianoTransitionNote[]) => items.every((note, index) => index === 0 || note.pitch < items[index - 1].pitch);
  const describe = `${inBar.length} note(s), ${line.length} in the theme line, attacks at ${attacks.length ? attacks.map((tick) => (tick / quarter + 1).toFixed(2).replace(/\.?0+$/, '')).join(' ') : 'no'} beat(s)`;
  const result = (rendered: boolean, found: string): PianoTransitionRendering => ({ bar: decision.bar, gesture: decision.gesture, rendered, found: `${found} (${describe}).` });
  const onHarmony = (note: PianoTransitionNote) => note.startTick === start || bar.chordStarts.includes(note.startTick);
  switch (decision.gesture) {
    case 'break': {
      const late = inBar.filter((note) => note.startTick >= start + quarter || note.startTick + note.durationTicks > start + length / 2);
      const held = notes.filter((note) => note.startTick < start && note.startTick + note.durationTicks > start + length / 2);
      return result(late.length === 0 && held.length === 0, inBar.length ? 'Downbeat only, released by the middle of the bar' : 'The bar is silent');
    }
    case 'pickup':
    case 'short-fill': {
      const tail = line.filter((note) => note.startTick >= end - 3 * eighth);
      const placed = tail.length === 3 && tail.every((note, index) => note.startTick === end - (3 - index) * eighth);
      if (!placed) return result(false, 'No three-note figure in the last three eighths');
      if (decision.gesture === 'pickup') return result(rising(tail) || falling(tail), rising(tail) || falling(tail) ? 'Three-note upbeat moving in one direction' : 'Three notes in the last three eighths that change direction');
      return result(new Set(tail.map((note) => note.pitch)).size >= 2, 'Three-note turn at the end of the bar');
    }
    case 'rising-figure':
    case 'flourish': {
      const half = line.filter((note) => note.startTick >= start + length / 2);
      const ok = half.length >= 2 && rising(half);
      return result(ok, ok ? `Rising line of ${half.length} notes in the second half` : 'No rising line in the second half');
    }
    case 'register-lift': {
      const half = line.filter((note) => note.startTick >= start + length / 2);
      const before = line.filter((note) => note.startTick < start + length / 2).at(-1);
      const ok = half.length >= 1 && rising(before ? [before, ...half] : half);
      return result(ok, ok ? 'Line climbs in the second half' : 'No climbing line in the second half');
    }
    case 'descending-resolution': {
      const from = bar.existingRun ? line.filter((note) => note.startTick >= start + length / 2) : line.filter((note) => note.startTick >= start + quarter);
      const before = line.filter((note) => note.startTick < (from[0]?.startTick ?? start)).at(-1);
      const ok = from.length >= 2 && falling(before && !bar.existingRun ? [before, ...from] : from);
      return result(ok, ok ? `Falling line of ${from.length} notes` : 'No falling line');
    }
    case 'cadence': {
      const restruck = others.filter((note) => !onHarmony(note) && (note.startTick - start) % (2 * quarter) !== 0);
      const last = line.at(-1);
      const held = !last || last.startTick + last.durationTicks >= end - eighth;
      return result(inBar.length > 0 && restruck.length === 0 && held,
        inBar.length === 0 ? 'The bar is silent' : restruck.length ? `${restruck.length} accompaniment attack(s) off the half-bar grid` : held ? 'Half-bar accompaniment, last theme note held to the bar line' : 'Last theme note is not held');
    }
    case 'sustained-handover': {
      const restruck = others.filter((note) => !onHarmony(note));
      return result(inBar.length > 0 && restruck.length === 0 && line.length <= 1,
        inBar.length === 0 ? 'The bar is silent' : restruck.length || line.length > 1 ? 'The texture moves inside the bar' : 'Everything is struck once and held');
    }
    case 'chordal-punctuation': {
      const stray = inBar.filter((note) => note.startTick !== start && note.startTick !== end - quarter);
      const both = inBar.some((note) => note.startTick === start) && inBar.some((note) => note.startTick === end - quarter);
      const sustained = notes.filter((note) => note.startTick < end - quarter && note.startTick + note.durationTicks > end - quarter + eighth / 2 && note.startTick + note.durationTicks > start);
      return result(both && stray.length === 0 && sustained.length === 0,
        !both ? 'The two chords are not both present' : stray.length ? `${stray.length} note(s) struck between the two chords` : sustained.length ? 'A note is held through the second chord' : 'Two struck chords');
    }
    case 'minimal':
      return result(inBar.length > 0 || notes.some((note) => note.startTick < start && note.startTick + note.durationTicks > start), inBar.length ? 'The bar plays on without a figure' : 'The bar is silent');
    default:
      return result(true, inBar.length ? 'The bar plays on unchanged' : 'The Piano is silent in this bar');
  }
}

/**
 * The selected figure could not be written (for example the line would leave the
 * register, or the hand that carries the theme is the left). The boundary keeps
 * only the dynamic direction of the form, and says so.
 */
export function fallbackPianoTransition(
  decision: PianoTransitionDecision, boundary: PianoBoundaryContext, found: string,
): PianoTransitionDecision {
  const dynamics = dynamicsFor('minimal', boundaryRise(boundary));
  return {
    ...decision,
    gesture: 'minimal',
    reason: `${WHY.minimal} Selected first: ${decision.gesture}. It could not be written into this bar (${found.replace(/\.$/, '')}), so no figure is announced.`,
    intensityDelta: dynamics.delta, ramp: dynamics.ramp,
    fallbackFrom: decision.fallbackFrom ?? decision.gesture, fromThemeRun: false,
  };
}
