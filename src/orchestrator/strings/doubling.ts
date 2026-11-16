import type { Note, OrchestratorContext, Section } from '../module';

const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const hashString = (s: string): number => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};
import { chordTones } from '../voicing/voiceLead';
import { scalePitchClasses } from '../../shared/schema/modes';
import { STRING_PROFILE_BY_ROLE, VOCAL_ZONE } from '../profiles/strings';
import { stringLayerForBar } from '../conductor/layers';

export type DoublingStrategy = 'none' | 'v2ThirdSixth' | 'violaOctave' | 'full';

/**
 * Strategy weights (celloOctave removed until cellos and basses are split desks in E4;
 * its 0.10 weight was redistributed: none 0.30, v2ThirdSixth 0.30, violaOctave 0.25, full 0.15).
 */
export const DOUBLING_WEIGHTS: Record<DoublingStrategy, number> = {
  none: 0.30,
  v2ThirdSixth: 0.30,
  violaOctave: 0.25,
  full: 0.15,
};

export interface SectionDoublingPlan {
  sectionId: string;
  strategy: DoublingStrategy;
  /** Target desk trackIds that are doubling in this section. */
  desks: string[];
  /** Interval mode per desk. */
  deskMode: Record<string, 'thirdSixth' | 'octave'>;
}

const isPadOrTacetInSection = (
  ctx: OrchestratorContext,
  sec: Section,
  trackId: string,
): boolean => {
  let hasAnyBar = false;
  for (let b = sec.startBar; b < sec.startBar + sec.lengthBars; b++) {
    const layer = stringLayerForBar(ctx, b, trackId);
    if (!layer) continue;
    hasAnyBar = true;
    if (layer !== 'pad' && layer !== 'tacet') {
      return false;
    }
  }
  return hasAnyBar;
};

export const feasibleStrategiesForSection = (
  ctx: OrchestratorContext,
  sec: Section,
  hasLeadInSection: boolean,
  energy: number,
  voiceTrackIds: string[],
): DoublingStrategy[] => {
  if (!hasLeadInSection) return ['none'];

  const resolveDesk = (role: string): string | null => {
    for (const id of voiceTrackIds) {
      const tr = ctx.project.tracks.find((t) => t.id === id);
      if (tr?.role === role || id === role) return id;
    }
    return null;
  };
  const v2Id = resolveDesk('violins2');
  const vaId = resolveDesk('violas');
  const hasV2 = v2Id !== null && isPadOrTacetInSection(ctx, sec, v2Id);
  const hasVa = vaId !== null && isPadOrTacetInSection(ctx, sec, vaId);

  const out: DoublingStrategy[] = ['none'];
  if (hasV2) out.push('v2ThirdSixth');
  if (hasVa) out.push('violaOctave');
  if (hasV2 && hasVa && energy >= 0.70) out.push('full');
  return out;
};

export const selectSectionDoubling = (
  ctx: OrchestratorContext,
  sec: Section,
  hasLeadInSection: boolean,
  energy: number,
  voiceTrackIds: string[],
  seed: number,
): SectionDoublingPlan => {
  const feasible = feasibleStrategiesForSection(ctx, sec, hasLeadInSection, energy, voiceTrackIds);
  if (feasible.length <= 1 || ctx.variety !== true) {
    return { sectionId: sec.id, strategy: 'none', desks: [], deskMode: {} };
  }

  const salted = (seed ^ Math.imul(hashString(`strings-doubling:${sec.id}`), 0x9e3779b1)) >>> 0;
  const rng = mulberry32(salted);

  const totalWeight = feasible.reduce((acc, s) => acc + DOUBLING_WEIGHTS[s], 0);
  let r = rng() * totalWeight;
  let chosen: DoublingStrategy = feasible[0];
  for (const s of feasible) {
    r -= DOUBLING_WEIGHTS[s];
    if (r <= 0) {
      chosen = s;
      break;
    }
  }

  const resolveDesk = (role: string): string => {
    for (const id of voiceTrackIds) {
      const tr = ctx.project.tracks.find((t) => t.id === id);
      if (tr?.role === role || id === role) return id;
    }
    return role;
  };
  const v2Id = resolveDesk('violins2');
  const vaId = resolveDesk('violas');

  if (chosen === 'none') {
    return { sectionId: sec.id, strategy: 'none', desks: [], deskMode: {} };
  }
  if (chosen === 'v2ThirdSixth') {
    return { sectionId: sec.id, strategy: chosen, desks: [v2Id], deskMode: { [v2Id]: 'thirdSixth' } };
  }
  if (chosen === 'violaOctave') {
    return { sectionId: sec.id, strategy: chosen, desks: [vaId], deskMode: { [vaId]: 'octave' } };
  }
  // full
  return {
    sectionId: sec.id,
    strategy: 'full',
    desks: [v2Id, vaId],
    deskMode: { [v2Id]: 'thirdSixth', [vaId]: 'octave' },
  };
};

const clampToRange = (pitch: number, low: number, high: number): number => {
  let p = pitch;
  while (p < low) p += 12;
  while (p > high) p -= 12;
  if (p < low) p = low;
  if (p > high) p = high;
  return p;
};

const diatonicStepBelow = (pitch: number, steps: number, scalePcs: number[]): number => {
  const pcSet = new Set(scalePcs.map((x) => ((x % 12) + 12) % 12));
  let p = pitch;
  let remaining = steps;
  while (remaining > 0 && p > 0) {
    p -= 1;
    if (pcSet.has(((p % 12) + 12) % 12)) {
      remaining -= 1;
    }
  }
  return p;
};

export const realizeDoublingNote = (
  ctx: OrchestratorContext,
  leadNote: Note,
  deskId: string,
  mode: 'thirdSixth' | 'octave',
  low: number,
  high: number,
  isVocalBacking: boolean,
): number | null => {
  let pitch: number;
  if (mode === 'octave') {
    pitch = leadNote.pitch - 12;
  } else {
    const scalePcs = scalePitchClasses(ctx.project.key, ctx.project.mode);
    const thirdBelow = diatonicStepBelow(leadNote.pitch, 2, scalePcs);
    const sixthBelow = diatonicStepBelow(leadNote.pitch, 5, scalePcs);

    const btBar = Math.round(ctx.project.timeSignature.numerator * 480 * (4 / ctx.project.timeSignature.denominator));
    const beatTicks = Math.floor(btBar / ctx.project.timeSignature.numerator);
    const tickInBar = leadNote.startTick % btBar;
    const isStrongBeat = tickInBar === 0 || tickInBar === 2 * beatTicks;

    if (isStrongBeat) {
      const span = ctx.spans.find((s) => leadNote.startTick >= s.startTick && leadNote.startTick < s.endTick);
      const rawTones: number[] = (span?.parsed as any)?.pitchClasses ?? (span?.parsed as any)?.tones ?? [];
      if (rawTones.length) {
        const ct = new Set(rawTones.map((x) => ((x % 12) + 12) % 12));
        if (ct.has(((thirdBelow % 12) + 12) % 12)) {
          pitch = thirdBelow;
        } else if (ct.has(((sixthBelow % 12) + 12) % 12)) {
          pitch = sixthBelow;
        } else {
          pitch = thirdBelow;
        }
      } else {
        pitch = thirdBelow;
      }
    } else {
      pitch = thirdBelow;
    }
  }

  const prof = STRING_PROFILE_BY_ROLE.get(deskId);
  const effLow = prof ? Math.max(low, prof.range[0]) : low;
  const effHigh = prof ? Math.min(high, prof.range[1]) : high;
  pitch = clampToRange(pitch, effLow, effHigh);

  if (isVocalBacking && pitch >= VOCAL_ZONE[0] && pitch <= VOCAL_ZONE[1]) {
    // Respect VOCAL_ZONE only for ensemble.vocalbacking
    const shiftedDown = pitch - 12;
    if (shiftedDown >= effLow && !(shiftedDown >= VOCAL_ZONE[0] && shiftedDown <= VOCAL_ZONE[1])) {
      pitch = shiftedDown;
    } else {
      return null;
    }
  }

  return pitch;
};
