/**
 * Strings articulation palettes — ONE table (STRINGS-ORCH-1b).
 * Weighted palette per layer per template, own salted stream hashString('strings-artic').
 * Bowing coherent: per SECTION + layer at 4-bar phrase boundaries, shared across desks,
 * with one exception desk at most one phrase in four. sulPont in intro/low-energy capped 5%.
 */
import { hashString, mulberry32 } from '../../engine/generate';
import { orchestrationSeedFor, arcTargetAt } from '../spine';
import { sectionTypeKeyOf } from '../conductor/layers';
import type { OrchestratorContext } from '../module';
import type { Articulation } from '../../shared/schema/types';
import { barTicks, projectBars } from '../../shared/schema/meter';

/**
 * ONE TABLE — all weights live here. Shown in REPORT.
 * sulPont in intro (pad_intro) capped at 5% (max weight 5). Low-energy pad effective capped too.
 * Tremolo sulPont kept for tension/tremolo beds (12,7,8...).
 */
export const ARTICULATION_WEIGHTS = {
  'ensemble.cinematic': {
    lead: { legato: 52, detache: 20, portato: 14, marcato: 10, spiccato: 4 } as Record<string, number>,
    counterline: { legato: 52, detache: 28, portato: 20 } as Record<string, number>,
    pad: { legato: 36, sulTasto: 28, detache: 12, conSord: 12, sulPont: 5, portato: 5 } as Record<string, number>,
    pad_intro: { sulTasto: 44, legato: 28, conSord: 14, sulPont: 5, detache: 6 } as Record<string, number>,
    tremolo: { tremolo: 78, sulPont: 12, legato: 10 } as Record<string, number>,
    tutti: { marcato: 62, spiccato: 18, legato: 12, detache: 8 } as Record<string, number>,
  },
  'ensemble.symphony': {
    lead: { legato: 58, detache: 18, portato: 12, marcato: 10, spiccato: 2 } as Record<string, number>,
    counterline: { legato: 56, detache: 24, portato: 20 } as Record<string, number>,
    pad: { legato: 42, sulTasto: 22, conSord: 14, detache: 10, sulPont: 5, portato: 5 } as Record<string, number>,
    pad_intro: { sulTasto: 38, legato: 32, conSord: 16, sulPont: 5, detache: 6 } as Record<string, number>,
    tremolo: { tremolo: 88, sulPont: 7, legato: 5 } as Record<string, number>,
    tutti: { marcato: 66, spiccato: 16, legato: 10, detache: 8 } as Record<string, number>,
  },
  'ensemble.chamber': {
    lead: { legato: 58, detache: 18, portato: 14, marcato: 6, conSord: 4 } as Record<string, number>,
    counterline: { legato: 54, detache: 26, portato: 20 } as Record<string, number>,
    pad: { legato: 32, sulTasto: 24, conSord: 24, detache: 10, sulPont: 5, portato: 5 } as Record<string, number>,
    pad_intro: { conSord: 32, sulTasto: 30, legato: 26, sulPont: 5, detache: 5 } as Record<string, number>,
    tremolo: { tremolo: 86, sulPont: 8, legato: 6 } as Record<string, number>,
    tutti: { marcato: 54, spiccato: 22, legato: 14, detache: 10 } as Record<string, number>,
  },
  'ensemble.sonata': {
    lead: { legato: 60, detache: 16, portato: 12, marcato: 8, spiccato: 4 } as Record<string, number>,
    counterline: { legato: 58, detache: 22, portato: 20 } as Record<string, number>,
    pad: { legato: 40, sulTasto: 26, conSord: 12, detache: 12, sulPont: 5, portato: 5 } as Record<string, number>,
    pad_intro: { sulTasto: 36, legato: 34, conSord: 16, sulPont: 5, detache: 6 } as Record<string, number>,
    tremolo: { tremolo: 90, sulPont: 5, legato: 5 } as Record<string, number>,
    tutti: { marcato: 64, spiccato: 14, legato: 12, detache: 10 } as Record<string, number>,
  },
  'ensemble.vocalbacking': {
    lead: { legato: 62, detache: 14, portato: 10, marcato: 6, conSord: 8 } as Record<string, number>,
    counterline: { legato: 56, detache: 24, portato: 20 } as Record<string, number>,
    pad: { legato: 30, sulTasto: 28, conSord: 26, detache: 8, sulPont: 4, portato: 4 } as Record<string, number>,
    pad_intro: { conSord: 36, sulTasto: 32, legato: 22, sulPont: 5, detache: 4 } as Record<string, number>,
    tremolo: { tremolo: 88, sulPont: 6, legato: 6 } as Record<string, number>,
    tutti: { marcato: 52, spiccato: 22, legato: 16, detache: 10 } as Record<string, number>,
  },
  'ensemble.hybridstudio': {
    lead: { legato: 46, detache: 22, portato: 16, marcato: 10, spiccato: 6 } as Record<string, number>,
    counterline: { legato: 50, detache: 28, portato: 22 } as Record<string, number>,
    pad: { legato: 34, sulTasto: 26, conSord: 16, detache: 12, sulPont: 5, portato: 5 } as Record<string, number>,
    pad_intro: { sulTasto: 40, legato: 30, conSord: 16, sulPont: 5, detache: 6 } as Record<string, number>,
    tremolo: { tremolo: 80, sulPont: 12, legato: 8 } as Record<string, number>,
    tutti: { marcato: 60, spiccato: 18, legato: 12, detache: 10 } as Record<string, number>,
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
  if (layer === 'bass' && isIntro) return 'pad_intro';
  if (layer === 'bass') return 'pad';
  if ((layer as ArtPaletteLayer) in ({} as any)) return layer as ArtPaletteLayer;
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

/** Per-context cache: section phrase articulations and final per-track per-phrase results */
type PhraseCache = Map<string, Articulation[]>; // key = template:palLayer:sectionId -> Art[]
type FinalCache = Map<string, Articulation>; // key = template:palLayer:sectionId:phraseIdx:trackId
const phraseCache = new WeakMap<object, PhraseCache>();
const finalCache = new WeakMap<object, FinalCache>();

function sectionForBar(ctx: OrchestratorContext, bar: number){
  const s = ctx.sections.find(x => bar >= x.startBar && bar < x.startBar + x.lengthBars);
  if(s) return s;
  // fallback single section spanning whole song
  const bars = ctx.arc?.length ?? projectBars(ctx.project);
  return { id: '*', name: '*', startBar: 1, lengthBars: bars, startTick: 0, endTick: bars*barTicks(ctx.project.timeSignature), index: 0, occurrence: 1 } as any;
}

/**
 * Build or retrieve the shared phrase articulation sequence for a section+layer.
 * - One base draw for phrase0 from weights (energy-biased at phrase start)
 * - Subsequent phrases keep previous unless RNG<0.25 proposes change, capped at floor(N/4) changes total
 */
function phraseArtsForSection(ctx: OrchestratorContext, templateId: string, palLayer: ArtPaletteLayer, sec: any, baseWeights: Record<string, number>): Articulation[] {
  let pc = phraseCache.get(ctx);
  if(!pc){ pc = new Map(); phraseCache.set(ctx, pc); }
  const key = `${templateId}:${palLayer}:${sec.id}`;
  const hit = pc.get(key);
  if(hit) return hit;

  const totalPhrases = Math.max(1, Math.ceil(sec.lengthBars / 4));
  const maxChanges = Math.floor(totalPhrases / 4); // never more than quarter of phrases change inside section
  const take = ctx.project.orchestration?.take ?? 0;
  const seed = orchestrationSeedFor(ctx.project, { take });

  // helper to get energy-biased weights for a given phrase start bar
  const weightsForPhrase = (phraseIdx: number): Record<string, number> => {
    const bar = sec.startBar + phraseIdx*4; // first bar of phrase
    const energy = ctx.arc ? arcTargetAt(ctx.arc, bar) ?? 0.5 : 0.5;
    const typeKey = sectionTypeKeyOf(sec.name ?? '*');
    const isIntro = /intro|prelude|breakdown|ambient/.test(typeKey);
    let w: Record<string, number> = { ...baseWeights };
    // energy bias (same as before but phrase-scoped, intro/low-energy sulPont never boosted)
    if (palLayer === 'pad' || (palLayer as string) === 'pad_intro') {
      if (energy < 0.35) {
        if (w.sulTasto !== undefined) w.sulTasto *= 1.4;
        if (w.conSord !== undefined) w.conSord *= 1.3;
        if (w.legato !== undefined) w.legato *= 0.85;
      } else if (energy > 0.68) {
        if (w.marcato !== undefined) w.marcato *= 1.5;
        else if (w.legato !== undefined) w.legato *= 0.8;
        // sulPont boost only if NOT intro/low-energy (tension allowed elsewhere)
        if (!isIntro && w.sulPont !== undefined) w.sulPont *= 1.6;
      }
      // enforce sulPont cap 5% for intro or low-energy pads
      if ((isIntro || energy < 0.35) && w.sulPont !== undefined) {
        const tot = Object.values(w).reduce((a,b)=>a+b,0);
        const cap = tot * 0.05;
        if (w.sulPont > cap) w.sulPont = cap;
      }
    }
    if (palLayer === 'lead' && energy > 0.70) {
      if (w.marcato !== undefined) w.marcato *= 1.6;
    }
    // register bias removed for shared coherence (would diverge per desk)
    return w;
  };

  const arts: Articulation[] = [];
  // phrase 0
  {
    const w = weightsForPhrase(0);
    const rng = mulberry32((seed ^ Math.imul(hashString(`strings-artic-base:${key}:phrase0`), 0x9e3779b1)) >>> 0);
    arts.push(drawWeighted(rng, w as Record<Articulation, number>) as Articulation);
  }
  let changes = 0;
  for(let i=1;i<totalPhrases;i++){
    if(changes >= maxChanges){
      arts.push(arts[i-1]);
      continue;
    }
    const rngChange = mulberry32((seed ^ Math.imul(hashString(`strings-artic-change:${key}:phrase${i}`), 0x9e3779b1)) >>> 0);
    if(rngChange() < 0.25){
      // propose distinct
      const w = weightsForPhrase(i);
      let newArt: Articulation | null = null;
      for(let attempt=0; attempt<10; attempt++){
        const rngDraw = mulberry32((seed ^ Math.imul(hashString(`strings-artic-draw:${key}:phrase${i}:a${attempt}`), 0x9e3779b1)) >>> 0);
        const cand = drawWeighted(rngDraw, w as Record<Articulation, number>) as Articulation;
        if(cand !== arts[i-1]){ newArt = cand; break; }
      }
      if(newArt && newArt !== arts[i-1]){
        arts.push(newArt);
        changes++;
      } else {
        arts.push(arts[i-1]);
      }
    } else {
      arts.push(arts[i-1]);
    }
  }
  pc.set(key, arts);
  return arts;
}

/**
 * Draw articulation for a given layer/template/bar/track.
 * Coherent: per SECTION and layer, shared across desks, change only at 4-bar boundaries ≤25%,
 * one exception desk at most one phrase in four.
 * Own salted stream hashString('strings-artic'), seeded via orchestrationSeedFor.
 */
export function articulationFor(
  ctx: OrchestratorContext,
  layer: string,
  bar: number,
  trackId: string,
  _pitchHint: number | null = null,
): Articulation {
  const templateId = ctx.template?.id ?? 'ensemble.cinematic';
  const palette = (ARTICULATION_WEIGHTS as any)[templateId] ?? (ARTICULATION_WEIGHTS as any)['ensemble.cinematic'];
  const sec: any = sectionForBar(ctx, bar);
  const typeKey = sectionTypeKeyOf(sec.name ?? '*');
  const isIntro = /intro|prelude|breakdown|ambient/.test(typeKey);
  const palLayer = layerKeyFor(layer, isIntro);
  let baseWeights: Record<string, number> = palette[palLayer] ?? palette.pad ?? { legato: 1 };

  const phraseIdx = Math.max(0, Math.floor((bar - sec.startBar) / 4));
  const phraseArts = phraseArtsForSection(ctx, templateId, palLayer, sec, baseWeights);
  const baseArt = phraseArts[Math.min(phraseIdx, phraseArts.length-1)];

  // Shared across desks: baseArt is candidate. Now exception logic (one desk per phrase at most one in four)
  let fc = finalCache.get(ctx);
  if(!fc){ fc = new Map(); finalCache.set(ctx, fc); }
  const finalKey = `${templateId}:${palLayer}:${sec.id}:phrase${phraseIdx}:${trackId}`;
  const fhit = fc.get(finalKey);
  if(fhit) return fhit;

  const take = ctx.project.orchestration?.take ?? 0;
  const seed = orchestrationSeedFor(ctx.project, { take });
  const excKey = `${templateId}:${palLayer}:${sec.id}:phrase${phraseIdx}`;
  // decide if this phrase is exceptional (25%)
  const rngExc = mulberry32((seed ^ Math.imul(hashString(`strings-artic-exc:${excKey}`), 0x9e3779b1)) >>> 0);
  let result: Articulation = baseArt;
  if(rngExc() < 0.25){
    // pick one exception desk among string desks
    const candidates = ctx.project.tracks.filter(t=> t.family==='Strings').map(t=>t.id).sort();
    if(candidates.length){
      const rngPick = mulberry32((seed ^ Math.imul(hashString(`strings-artic-exc-pick:${excKey}`), 0x9e3779b1)) >>> 0);
      const pickIdx = Math.floor(rngPick() * candidates.length);
      const excTrackId = candidates[pickIdx];
      if(trackId === excTrackId){
        // draw alternative distinct from base, using phrase weights
        const phraseBar = sec.startBar + phraseIdx*4;
        const energy = ctx.arc ? arcTargetAt(ctx.arc, phraseBar) ?? 0.5 : 0.5;
        let w: Record<string, number> = { ...baseWeights };
        if (palLayer === 'pad' || (palLayer as string)==='pad_intro'){
          if(energy < 0.35){
            if(w.sulTasto!==undefined) w.sulTasto*=1.4;
            if(w.conSord!==undefined) w.conSord*=1.3;
            if(w.legato!==undefined) w.legato*=0.85;
          } else if(energy > 0.68){
            if(w.marcato!==undefined) w.marcato*=1.5;
            else if(w.legato!==undefined) w.legato*=0.8;
            if(!isIntro && w.sulPont!==undefined) w.sulPont*=1.6;
          }
          if((isIntro || energy < 0.35) && w.sulPont!==undefined){
            const tot = Object.values(w).reduce((a,b)=>a+b,0);
            const cap = tot*0.05;
            if(w.sulPont > cap) w.sulPont = cap;
          }
        }
        if(palLayer==='lead' && energy > 0.70){
          if(w.marcato!==undefined) w.marcato*=1.6;
        }
        for(let attempt=0; attempt<10; attempt++){
          const rngDraw = mulberry32((seed ^ Math.imul(hashString(`strings-artic-exc-art:${excKey}:${trackId}:a${attempt}`), 0x9e3779b1)) >>> 0);
          const cand = drawWeighted(rngDraw, w as Record<Articulation, number>) as Articulation;
          if(cand !== baseArt){ result = cand; break; }
        }
      }
    }
  }

  fc.set(finalKey, result);
  return result;
}
