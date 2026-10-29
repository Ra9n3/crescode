/**
 * Harmonic color (Phase 4.1, spec §5 Stage B, §12) — HOW each structural
 * foundation sounds, chosen AFTER the foundation sequence exists.
 *
 * The structural search never sees a chord symbol, so complexity can no
 * longer dominate root selection: this stage receives one foundation per
 * harmonic event and decides its color — triad, seventh, extension — from
 * the foundation's available colors (all parser-validated and settings-
 * filtered at pool build time). By construction a color can never change the
 * foundation it expresses: Em stays E minor whether it sounds as Em, Em7 or
 * Em9, and D7/D13 are both just colors of the D major foundation.
 *
 * Choice is contextual, not a richness race:
 * - the complexity preference sets a richness TARGET with real weight on
 *   plain triads — extensions are available, never required (anti-saturation);
 * - neighboring colors stay related in richness and shared tones;
 * - arrival intentions prefer stable colors for resolved endings, suspended
 *   colors for suspended ones, characteristic-tone-rich colors for modal ones;
 * - diatonic colors are graded above chromatic ones, shaped by the borrowing
 *   preference (settings filtered availability already);
 * - modal emphasis rewards colors that carry the mode's characteristic tones.
 *
 * Deterministic: weighted picks ride the caller's seeded rng in a fixed
 * candidate order. No async, no dependencies, no React.
 */
import { NOTE_NAMES } from '../../shared/schema/modes';
import { parseChord } from '../../shared/schema/chords';
import { applyVariation, pickWeighted } from './planning';
import type { CadenceIntention } from './types';
import { poolFoundationOrFallback, type FoundationInfo, type FoundationPool } from './foundation';

/** Richness rank of a color: triad 0, seventh 0.5, extension 1. */
export function colorTierRank(tier: 'triad' | 'seventh' | 'extension'): number {
  return tier === 'triad' ? 0 : tier === 'seventh' ? 0.5 : 1;
}

/** Everything the color stage knows about the previous emitted color. */
export interface PreviousColor {
  symbol: string;
  tierRank: number;
  pitchClasses: number[];
}

export interface ColorContext {
  /** Profile complexity preference, 0..1 — a richness TARGET, not a demand. */
  complexityPref: number;
  modalPref: number;
  variation: number;
  /** True when this event carries a planned cadential arrival. */
  isArrival: boolean;
  intention: CadenceIntention | null;
  role: string;
  prev: PreviousColor | null;
}

export interface ColorResult {
  symbol: string;
  /** False when the chosen color carries tones outside the mode (borrowed color). */
  diatonic: boolean;
  tierRank: number;
  pitchClasses: number[];
}

/** Last-resort color for a foundation with no pooled colors (an anchor-derived
 *  foundation outside the settings' palette): a basic parser-safe triad or
 *  dyad that preserves the foundation's core exactly. */
export function basicColorFor(foundation: FoundationInfo): string {
  const root = NOTE_NAMES[foundation.rootPc];
  const suffix = foundation.quality === 'major' ? ''
    : foundation.quality === 'minor' ? 'm'
      : foundation.quality === 'diminished' ? 'dim'
        : foundation.quality === 'augmented' ? 'aug'
          : foundation.quality === 'suspended' ? 'sus4' : '5';
  const symbol = `${root}${suffix}`;
  const r = parseChord(symbol);
  if (r.ok) return symbol;
  return root; // a bare note name always parses
}

/** Weight one color of a foundation under the event's context. */
function colorWeight(
  foundation: FoundationInfo,
  colorIndex: number,
  cctx: ColorContext,
): number {
  const c = foundation.colors[colorIndex];
  const rank = colorTierRank(c.tier);
  // Richness target: even at high complexity the target stays below the
  // extension ceiling, and triads keep a floor — richer is never "better".
  const target = 0.2 + 0.5 * cctx.complexityPref;
  let w = Math.exp(-1.4 * Math.abs(rank - target));
  if (rank === 0) w += 0.18; // plain triads always remain substantial
  if (rank === 1) w *= 0.85; // extensions need a reason

  // Color continuity with the previous event.
  if (cctx.prev !== null) {
    if (Math.abs(rank - cctx.prev.tierRank) >= 1.5) w *= 0.45; // no triad→13th whiplash
    if (c.symbol === cctx.prev.symbol) w *= 0.15; // the same color twice in a row is rarely intended
    const set = new Set(cctx.prev.pitchClasses);
    const common = c.pcs.filter((p) => set.has(p)).length;
    const smaller = Math.min(c.pcs.length, cctx.prev.pitchClasses.length) || 1;
    w *= 0.7 + 0.6 * (common / smaller); // related colors feel related
  }

  // Arrival realization preferences (the STRUCTURE already realized the
  // cadence — color supports it without overriding it).
  if (cctx.isArrival && cctx.intention !== null) {
    switch (cctx.intention) {
      case 'resolved':
        if (rank === 0.5) w *= 1.5; // stable, complete
        if (rank === 1) w *= 0.35;  // unresolved color noise on a resolved arrival
        break;
      case 'open':
        if (rank === 0) w *= 1.3;
        break;
      case 'suspended':
        if (rank === 0) w *= 1.2;
        break;
      case 'transitional':
      case 'deceptive':
        if (rank >= 0.5) w *= 1.2;
        break;
      case 'modal':
      case 'ambiguous':
        break;
    }
  }

  // Chromatic colors are graded, never forbidden (availability was already
  // filtered by the borrowing setting at pool build time).
  if (!c.diatonic) w *= cctx.role === 'contrast' || cctx.role === 'develop' ? 0.8 : 0.55;

  // Modal emphasis: colors carrying the mode's characteristic tones.
  w *= 1 + 0.6 * c.characteristicToneCoverage * cctx.modalPref;

  return Math.max(0, w);
}

/**
 * Choose the color of one structural foundation. Never throws, never changes
 * the foundation, always returns a parser-compatible symbol.
 */
export function applyHarmonicColor(
  foundation: FoundationInfo,
  pool: FoundationPool,
  cctx: ColorContext,
  rng: () => number,
): ColorResult {
  const f = foundation.colors.length > 0 ? foundation : poolFoundationOrFallback(pool, foundation);
  if (f.colors.length === 0) {
    // Anchor-derived foundation outside the pool: deterministic basic color.
    const symbol = basicColorFor(f);
    const r = parseChord(symbol);
    return {
      symbol,
      diatonic: f.diatonic,
      tierRank: 0,
      pitchClasses: r.ok ? r.chord.pitchClasses : f.corePitchClasses,
    };
  }

  const weights = f.colors.map((_, i) => [`c${i}`, colorWeight(f, i, cctx)] as const);
  const varied = applyVariation(weights, cctx.variation);
  const pick = pickWeighted(varied, rng);
  const idx = Number(pick.slice(1));
  const c = f.colors[idx];
  return {
    symbol: c.symbol,
    diatonic: c.diatonic,
    tierRank: colorTierRank(c.tier),
    pitchClasses: [...c.pcs],
  };
}
