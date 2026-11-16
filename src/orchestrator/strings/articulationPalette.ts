/**
 * Strings articulation palettes — ONE table (STRINGS-ORCH-1).
 * Weighted palette per layer per template, own salted stream hashString('strings-artic').
 * Only articulations in ARTICULATIONS are emitted; colLegno/harmonics/trill are NOT emitted
 * (see fallback docs below). Every emitted articulation has UVI export fallback.
 */
import { hashString, mulberry32 } from '../../engine/generate';
import { orchestrationSeedFor, arcTargetAt } from '../spine';
import { sectionTypeKeyOf } from '../conductor/layers';
import type { OrchestratorContext } from '../module';
import type { Articulation } from '../../shared/schema/types';

/**
 * ONE TABLE — all weights live here. Shown in REPORT.
 * Weights are per-template, per-layer. Values are relative, sum not required to be 100.
 * Intro gets its own palette (pad_intro) to ensure visible change in bars 1-8.
 *
 * Sources:
 * - lead: legato mostly; detache/portato on faster bars; marcato at peaks
 * - counterline: legato/detache/portato
 * - pad: legato at mid energy; sulTasto at low energy (intros especially); sulPont rarely at tension; conSord at low energy in chamber/vocalbacking
 * - tremolo: tremolo; sulPont tremolo option in cinematic
 * - tutti: marcato/staccato/spiccato
 *
 * UVI mapping: all palette articulations are in ARTICULATIONS and in uvi-orchestral-suite.json keyswitches
 * or fallback chains (detache/portato/sulTasto/sulPont/conSord → sustain, staccato/spiccato → marcato on cello/bass).
 * Missing from spec colLegno → spiccato, harmonics → sulTasto, trill → tremolo — never emitted, listed here.
 */
export const ARTICULATION_WEIGHTS = {
  'ensemble.cinematic': {
    lead: { legato: 48, detache: 20, portato: 14, marcato: 10, staccato: 4, spiccato: 4 } as Record<string, number>,
    counterline: { legato: 52, detache: 28, portato: 20 } as Record<string, number>,
    pad: { legato: 36, sulTasto: 28, detache: 12, conSord: 12, sulPont: 7, portato: 5 } as Record<string, number>,
    pad_intro: { sulTasto: 44, legato: 28, conSord: 14, sulPont: 8, detache: 6 } as Record<string, number>,
    tremolo: { tremolo: 78, sulPont: 12, legato: 10 } as Record<string, number>,
    tutti: { marcato: 58, staccato: 22, spiccato: 15, legato: 5 } as Record<string, number>,
  },
  'ensemble.symphony': {
    lead: { legato: 55, detache: 18, portato: 12, marcato: 10, staccato: 3, spiccato: 2 } as Record<string, number>,
    counterline: { legato: 56, detache: 24, portato: 20 } as Record<string, number>,
    pad: { legato: 42, sulTasto: 22, conSord: 14, detache: 10, sulPont: 7, portato: 5 } as Record<string, number>,
    pad_intro: { sulTasto: 38, legato: 32, conSord: 16, sulPont: 8, detache: 6 } as Record<string, number>,
    tremolo: { tremolo: 88, sulPont: 7, legato: 5 } as Record<string, number>,
    tutti: { marcato: 62, staccato: 20, spiccato: 13, legato: 5 } as Record<string, number>,
  },
  'ensemble.chamber': {
    lead: { legato: 58, detache: 18, portato: 14, marcato: 6, conSord: 4 } as Record<string, number>,
    counterline: { legato: 54, detache: 26, portato: 20 } as Record<string, number>,
    pad: { legato: 32, sulTasto: 24, conSord: 24, detache: 10, sulPont: 5, portato: 5 } as Record<string, number>,
    pad_intro: { conSord: 32, sulTasto: 30, legato: 26, sulPont: 7, detache: 5 } as Record<string, number>,
    tremolo: { tremolo: 86, sulPont: 8, legato: 6 } as Record<string, number>,
    tutti: { marcato: 50, staccato: 26, spiccato: 18, legato: 6 } as Record<string, number>,
  },
  'ensemble.sonata': {
    lead: { legato: 60, detache: 16, portato: 12, marcato: 8, staccato: 4 } as Record<string, number>,
    counterline: { legato: 58, detache: 22, portato: 20 } as Record<string, number>,
    pad: { legato: 40, sulTasto: 26, conSord: 12, detache: 12, sulPont: 5, portato: 5 } as Record<string, number>,
    pad_intro: { sulTasto: 36, legato: 34, conSord: 16, sulPont: 8, detache: 6 } as Record<string, number>,
    tremolo: { tremolo: 90, sulPont: 5, legato: 5 } as Record<string, number>,
    tutti: { marcato: 60, staccato: 22, spiccato: 12, legato: 6 } as Record<string, number>,
  },
  'ensemble.vocalbacking': {
    lead: { legato: 62, detache: 14, portato: 10, marcato: 6, conSord: 8 } as Record<string, number>,
    counterline: { legato: 56, detache: 24, portato: 20 } as Record<string, number>,
    pad: { legato: 30, sulTasto: 28, conSord: 26, detache: 8, sulPont: 4, portato: 4 } as Record<string, number>,
    pad_intro: { conSord: 36, sulTasto: 32, legato: 22, sulPont: 6, detache: 4 } as Record<string, number>,
    tremolo: { tremolo: 88, sulPont: 6, legato: 6 } as Record<string, number>,
    tutti: { marcato: 48, staccato: 28, spiccato: 16, legato: 8 } as Record<string, number>,
  },
  'ensemble.hybridstudio': {
    lead: { legato: 46, detache: 22, portato: 16, marcato: 10, spiccato: 6 } as Record<string, number>,
    counterline: { legato: 50, detache: 28, portato: 22 } as Record<string, number>,
    pad: { legato: 34, sulTasto: 26, conSord: 16, detache: 12, sulPont: 7, portato: 5 } as Record<string, number>,
    pad_intro: { sulTasto: 40, legato: 30, conSord: 16, sulPont: 8, detache: 6 } as Record<string, number>,
    tremolo: { tremolo: 80, sulPont: 12, legato: 8 } as Record<string, number>,
    tutti: { marcato: 56, staccato: 24, spiccato: 15, legato: 5 } as Record<string, number>,
  },
} as const;

/** Missing spec articulations — never emitted, nearest existing fallback used */
export const MISSING_ARTICULATIONS: Record<string, { fallback: Articulation; reason: string }> = {
  colLegno: { fallback: 'spiccato', reason: 'no UVI keyswitch; nearest short bow' },
  harmonics: { fallback: 'sulTasto', reason: 'no UVI keyswitch; nearest soft high' },
  trill: { fallback: 'tremolo', reason: 'no UVI keyswitch; nearest measured repeat' },
};

export type StringsLayerArt = 'lead' | 'counterline' | 'pad' | 'tremolo' | 'tutti';
export type ArtPaletteLayer = StringsLayerArt | 'pad_intro';

function layerKeyFor(layer: string, isIntro: boolean): ArtPaletteLayer {
  if (layer === 'pad' && isIntro) return 'pad_intro';
  if (layer === 'bass' && isIntro) return 'pad_intro'; // bass uses pad palette
  if (layer === 'bass') return 'pad';
  if ((layer as ArtPaletteLayer) in ({} as any)) return layer as ArtPaletteLayer;
  // map our internal layer names to palette keys
  if (layer === 'lead') return 'lead';
  if (layer === 'counterline') return 'counterline';
  if (layer === 'tremolo') return 'tremolo';
  if (layer === 'tutti' || layer === 'stab') return 'tutti';
  return 'pad';
}

function drawWeighted<T extends string>(rng: () => number, weights: Record<T, number>): T {
  const keys = Object.keys(weights) as T[];
  const total = keys.reduce((a, k) => a + (weights as any)[k], 0);
  let roll = rng() * total;
  for (const k of keys) {
    roll -= (weights as any)[k];
    if (roll < 0) return k;
  }
  return keys[keys.length - 1];
}

/** Per-context cache to enforce at most one articulation change per bar per part */
const articCache = new WeakMap<object, Map<string, Articulation>>();

/**
 * Draw articulation for a given layer/template/bar/track.
 * Own salted stream hashString('strings-artic'), seeded via orchestrationSeedFor.
 * Energy (arc target) and register (pitch vs comfortable) subtly bias weights:
 * - low energy (<0.35) boosts sulTasto/conSord
 * - high energy (>0.68) boosts marcato
 * - high register (pitch > mid+6) slightly boosts sulPont
 * Intro sections use pad_intro palette.
 */
export function articulationFor(
  ctx: OrchestratorContext,
  layer: string,
  bar: number,
  trackId: string,
  pitchHint: number | null = null,
): Articulation {
  const templateId = ctx.template?.id ?? 'ensemble.cinematic';
  const palette = (ARTICULATION_WEIGHTS as any)[templateId] ?? (ARTICULATION_WEIGHTS as any)['ensemble.cinematic'];
  const sec = ctx.sections.find(s => bar >= s.startBar && bar < s.startBar + s.lengthBars);
  const typeKey = sectionTypeKeyOf(sec?.name ?? '*');
  const isIntro = /intro|prelude|breakdown|ambient/.test(typeKey);
  const palLayer = layerKeyFor(layer, isIntro);
  let weights: Record<string, number> = palette[palLayer] ?? palette.pad ?? { legato: 1 };

  // Energy/register bias (subtle, keeps vocal zone/ranges/governors unchanged)
  const energy = ctx.arc ? arcTargetAt(ctx.arc, bar) ?? 0.5 : 0.5;
  // clone to mutate
  weights = { ...weights };
  if (layer === 'pad' || layer === 'bass') {
    if (energy < 0.35) {
      // low energy — sulTasto/conSord up
      if (weights.sulTasto !== undefined) weights.sulTasto *= 1.4;
      if (weights.conSord !== undefined) weights.conSord *= 1.3;
      if (weights.legato !== undefined) weights.legato *= 0.85;
    } else if (energy > 0.68) {
      if (weights.marcato !== undefined) weights.marcato *= 1.5;
      else if (weights.legato !== undefined) weights.legato *= 0.8;
      if (weights.sulPont !== undefined) weights.sulPont *= 1.6; // rarely at tension
    }
  }
  if (layer === 'lead' && energy > 0.70) {
    if (weights.marcato !== undefined) weights.marcato *= 1.6;
  }
  // register: if pitchHint high above comfortable mid, slight sulPont boost
  if (pitchHint !== null && (layer === 'pad' || layer === 'tremolo')) {
    const track = ctx.project.tracks.find(t => t.id === trackId);
    // approximate comfortable mid from track range
    const mid = track ? (track.lowestNote + track.highestNote) / 2 : 60;
    if (pitchHint > mid + 7 && weights.sulPont !== undefined) weights.sulPont *= 1.3;
  }

  // Own salted stream — per bar per track per layer per template, deterministic
  const take = ctx.project.orchestration?.take ?? 0;
  const key = `${templateId}:${palLayer}:${typeKey}:bar${bar}:${trackId}`;
  const cacheKey = key;
  let cache = articCache.get(ctx);
  if (!cache) { cache = new Map(); articCache.set(ctx, cache); }
  const hit = cache.get(cacheKey);
  if (hit) return hit as Articulation;

  const rng = mulberry32((orchestrationSeedFor(ctx.project, { take }) ^ Math.imul(hashString(`strings-artic:${key}`), 0x9e3779b1)) >>> 0);
  const art = drawWeighted(rng, weights as Record<Articulation, number>) as Articulation;
  cache.set(cacheKey, art);
  return art;
}
