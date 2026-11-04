/**
 * Per-track string layer assignment (Phase 4a), texture palettes (Phase 4.6).
 * The conductor's plan gives every in-band unlocked string TRACK a role for
 * every bar. One track = one role per bar (the polyphony cap is one voice
 * per track, so the roles are exclusive by construction). Pure: same context
 * → same assignment.
 *
 * Phase 4.6 replaces the fixed role assignment with a weighted PALETTE of
 * textures per preset. Per take, ONE texture is drawn per section TYPE (all
 * Verses share one, all Choruses share one — a section type stays coherent)
 * from the D8 seed: same take → identical plan, a new take can change it.
 * The draw is a pure function of (musical inputs, take, section type).
 *
 * Palettes (weights are named constants):
 *  - cinematic: lead+pad bed 25, single ostinato 20, interlocking ostinato
 *    15, pizz/staccato pulse 15, tremolo bed 15, trailer (V2+Vla 16th
 *    spiccato) 10 — V1 carries the tune in every texture (4.5: bars at arc
 *    energy ≥ TREMOLO_ENERGY_THRESHOLD render it as measured tremolo);
 *  - symphony: V1 lead with Cb pizz vs sustained, and lead handoff (V2 or
 *    Vla takes the tune);
 *  - chamber: quartet (V1 lead, V2 counterline), V1 lead without
 *    counterline, V2 lead handoff;
 *  - sonata: V1 soloist, Cb lead handoff;
 *  - hybrid studio: counterline on V2 or on Vla;
 *  - vocal backing: pad only — wide legato, no lead inside the vocal zone,
 *    nothing shorter than an eighth, no ostinato, no stabs.
 *
 * Every texture obeys maxLayers (≤ one layer per track), the octaveDoubling
 * policy (the voicer enforces it; ostinato textures only ship on the
 * doubling-'allowed' cinematic preset), the conductor's breath windows (the
 * renderer cuts around them), one role per track per bar, one voice per
 * track and the vocal zone. Intro-like sections never carry a lead (or a
 * counterline) — the motif arrives with the first real phrase.
 */
import type { OrchestratorContext, StringsLayer } from '../module';
import { stringVoiceTracks } from '../profiles/strings';
import { mulberry32, hashString } from '../../engine/generate';
import { orchestrationSeedFor } from '../spine';

/** The bar's arc energy from which Cinematic V1 switches to measured tremolo. */
export const TREMOLO_ENERGY_THRESHOLD = 0.65;

/** Sections that never carry a lead (the motif arrives with the first phrase). */
const LEAD_FREE_SECTIONS = /intro|prelude|breakdown|ambient/;

/* ------------------------------------------------------------------ */
/* Textures (Phase 4.6)                                                */
/* ------------------------------------------------------------------ */

/** Ostinato rate as part of the texture: default 8ths, 16ths only for the trailer. */
export type OstinatoRate = 'eighths' | 'sixteenths';
/** Pattern shape, seeded per take: repeated note, chord-tone arpeggio, root-fifth. */
export type OstinatoShape = 'repeat' | 'arpeggio' | 'rootFifth';

/** The render style a texture hands the strings renderer. */
export interface TextureStyle {
  rate: OstinatoRate;
  /** Interlocking: two ostinato tracks offset by half the rate — never the same rhythm. */
  interlock: boolean;
  ostArticulation: 'spiccato' | 'pizz';
  /** Trailer only: notes clipped under 0.25 s. Otherwise short but not clipped. */
  clippedShort: boolean;
  shape: OstinatoShape;
  /** Bars into the section before the ostinato enters (1–2, seeded). */
  enterAfter: 1 | 2;
  /** Symphony: cellosBasses pizz-pulse (true) vs sustained bass (false). */
  bassPizz: boolean;
}

export interface Texture {
  id: string;
  /** role → layer for every bar of the section type (a role left out = pad). */
  plan: Partial<Record<string, StringsLayer>>;
  style: TextureStyle;
}

const baseStyle = (over: Partial<TextureStyle>): TextureStyle => ({
  rate: 'eighths',
  interlock: false,
  ostArticulation: 'spiccato',
  clippedShort: false,
  shape: 'arpeggio',
  enterAfter: 1,
  bassPizz: false,
  ...over,
});

/* Named palette weights (4.6) — the take draws one texture per section type. */
export const CINEMATIC_TEXTURE_WEIGHTS = {
  leadPadBed: 25,
  singleOstinato: 20,
  interlockingOstinato: 15,
  pizzPulse: 15,
  tremoloBed: 15,
  trailer: 10,
} as const;

export const SYMPHONY_TEXTURE_WEIGHTS = {
  v1LeadsPizzBass: 45,
  v1LeadsSustainedBass: 25,
  v2HandoffPizzBass: 15,
  vlaHandoffSustainedBass: 15,
} as const;

export const CHAMBER_TEXTURE_WEIGHTS = {
  quartet: 45,
  v1LeadsNoCounter: 25,
  v2Handoff: 30,
} as const;

export const SONATA_TEXTURE_WEIGHTS = {
  soloist: 70,
  cbHandoff: 30,
} as const;

export const HYBRID_TEXTURE_WEIGHTS = {
  v2Counter: 55,
  vlaCounter: 45,
} as const;

type OstTrack = 'violins2' | 'violas';
interface PaletteDef {
  id: string;
  weight: number;
  plan: Partial<Record<string, StringsLayer>> | ((ost: OstTrack) => Partial<Record<string, StringsLayer>>);
  style?: Partial<TextureStyle>;
  /** True when the plan needs the seeded ostinato-track draw (single ostinato, pizz pulse). */
  ostTrack?: boolean;
}

const CINEMATIC_PALETTE: PaletteDef[] = [
  { id: 'leadPadBed', weight: CINEMATIC_TEXTURE_WEIGHTS.leadPadBed, plan: { violins1: 'lead', violins2: 'pad', violas: 'pad', cellosBasses: 'bass' } },
  {
    id: 'singleOstinato', weight: CINEMATIC_TEXTURE_WEIGHTS.singleOstinato, ostTrack: true,
    plan: (ost) => ({ violins1: 'lead', violins2: ost === 'violins2' ? 'ostinato' : 'pad', violas: ost === 'violas' ? 'ostinato' : 'pad', cellosBasses: 'bass' }),
    style: { rate: 'eighths', ostArticulation: 'spiccato' },
  },
  {
    id: 'interlockingOstinato', weight: CINEMATIC_TEXTURE_WEIGHTS.interlockingOstinato,
    plan: { violins1: 'lead', violins2: 'ostinato', violas: 'ostinato', cellosBasses: 'bass' },
    style: { rate: 'eighths', interlock: true, ostArticulation: 'spiccato' },
  },
  {
    id: 'pizzPulse', weight: CINEMATIC_TEXTURE_WEIGHTS.pizzPulse, ostTrack: true,
    plan: (ost) => ({ violins1: 'lead', violins2: ost === 'violins2' ? 'ostinato' : 'pad', violas: ost === 'violas' ? 'ostinato' : 'pad', cellosBasses: 'bass' }),
    style: { rate: 'eighths', ostArticulation: 'pizz' },
  },
  { id: 'tremoloBed', weight: CINEMATIC_TEXTURE_WEIGHTS.tremoloBed, plan: { violins1: 'lead', violins2: 'tremolo', violas: 'tremolo', cellosBasses: 'bass' } },
  {
    id: 'trailer', weight: CINEMATIC_TEXTURE_WEIGHTS.trailer,
    plan: { violins1: 'lead', violins2: 'ostinato', violas: 'ostinato', cellosBasses: 'bass' },
    style: { rate: 'sixteenths', ostArticulation: 'spiccato', clippedShort: true },
  },
];

const SYMPHONY_PALETTE: PaletteDef[] = [
  { id: 'v1LeadsPizzBass', weight: SYMPHONY_TEXTURE_WEIGHTS.v1LeadsPizzBass, plan: { violins1: 'lead', violins2: 'pad', violas: 'pad', cellosBasses: 'bass' }, style: { bassPizz: true } },
  { id: 'v1LeadsSustainedBass', weight: SYMPHONY_TEXTURE_WEIGHTS.v1LeadsSustainedBass, plan: { violins1: 'lead', violins2: 'pad', violas: 'pad', cellosBasses: 'bass' }, style: { bassPizz: false } },
  { id: 'v2HandoffPizzBass', weight: SYMPHONY_TEXTURE_WEIGHTS.v2HandoffPizzBass, plan: { violins2: 'lead', violins1: 'pad', violas: 'pad', cellosBasses: 'bass' }, style: { bassPizz: true } },
  { id: 'vlaHandoffSustainedBass', weight: SYMPHONY_TEXTURE_WEIGHTS.vlaHandoffSustainedBass, plan: { violas: 'lead', violins1: 'pad', violins2: 'pad', cellosBasses: 'bass' }, style: { bassPizz: false } },
];

const CHAMBER_PALETTE: PaletteDef[] = [
  { id: 'quartet', weight: CHAMBER_TEXTURE_WEIGHTS.quartet, plan: { violins1: 'lead', violins2: 'counterline', violas: 'pad', cellosBasses: 'bass' } },
  { id: 'v1LeadsNoCounter', weight: CHAMBER_TEXTURE_WEIGHTS.v1LeadsNoCounter, plan: { violins1: 'lead', violins2: 'pad', violas: 'pad', cellosBasses: 'bass' } },
  { id: 'v2Handoff', weight: CHAMBER_TEXTURE_WEIGHTS.v2Handoff, plan: { violins2: 'lead', violins1: 'pad', violas: 'pad', cellosBasses: 'bass' } },
];

const SONATA_PALETTE: PaletteDef[] = [
  { id: 'soloist', weight: SONATA_TEXTURE_WEIGHTS.soloist, plan: { violins1: 'lead', cellosBasses: 'bass' } },
  { id: 'cbHandoff', weight: SONATA_TEXTURE_WEIGHTS.cbHandoff, plan: { cellosBasses: 'lead', violins1: 'pad' } },
];

const HYBRID_PALETTE: PaletteDef[] = [
  { id: 'v2Counter', weight: HYBRID_TEXTURE_WEIGHTS.v2Counter, plan: { violins1: 'lead', violins2: 'counterline', violas: 'pad', cellosBasses: 'bass' } },
  { id: 'vlaCounter', weight: HYBRID_TEXTURE_WEIGHTS.vlaCounter, plan: { violins1: 'lead', violas: 'counterline', violins2: 'pad', cellosBasses: 'bass' } },
];

const PALETTES: Record<string, PaletteDef[]> = {
  'ensemble.cinematic': CINEMATIC_PALETTE,
  'ensemble.symphony': SYMPHONY_PALETTE,
  'ensemble.chamber': CHAMBER_PALETTE,
  'ensemble.sonata': SONATA_PALETTE,
  'ensemble.hybridstudio': HYBRID_PALETTE,
  'ensemble.vocalbacking': [{ id: 'padBed', weight: 1, plan: {} }], // wide legato only
};

const SHAPES: OstinatoShape[] = ['repeat', 'arpeggio', 'rootFifth'];

/** Per-context memo: the draw is pure, but `orchestrationSeedFor` serializes
 *  the musical inputs — cache the (rare) resolution per context object. */
const textureCache = new WeakMap<object, Map<string, Texture>>();

/** The normalized section TYPE key a texture is drawn for (all sections of
 *  the same name share one draw — a section type stays coherent). */
export const sectionTypeKeyOf = (name: string): string => name.trim().toLowerCase() || '*';

export function sectionTypeNameAtBar(ctx: OrchestratorContext, bar: number): string {
  const sec = ctx.sections.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
  return sectionTypeKeyOf(sec?.name ?? '*');
}

function drawTexture(ctx: OrchestratorContext, typeKey: string): Texture {
  const palette = ctx.template ? PALETTES[ctx.template.id] : undefined;
  if (!palette) return { id: 'padBed', plan: {}, style: baseStyle({}) }; // no band: Phase-2 pads
  const take = ctx.project.orchestration?.take ?? 0;
  const rng = mulberry32((orchestrationSeedFor(ctx.project, { take }) ^ Math.imul(hashString(`texture:${typeKey}`), 0x85ebca6b)) >>> 0);
  const total = palette.reduce((a, e) => a + e.weight, 0);
  let roll = rng() * total;
  let chosen = palette[palette.length - 1];
  for (const e of palette) {
    roll -= e.weight;
    if (roll < 0) { chosen = e; break; }
  }
  // seeded style draws — fixed order, independent of the texture picked
  const shape = SHAPES[Math.floor(rng() * SHAPES.length)];
  const enterAfter: 1 | 2 = rng() < 0.5 ? 1 : 2;
  const ost: OstTrack = rng() < 0.5 ? 'violins2' : 'violas';
  const plan = typeof chosen.plan === 'function' ? chosen.plan(ost) : chosen.plan;
  return { id: chosen.id, plan, style: baseStyle({ shape, enterAfter, ...chosen.style }) };
}

/** The texture drawn for one section type on this take. Deterministic per
 *  (musical inputs, take, type); same take → same texture. */
export function textureForType(ctx: OrchestratorContext, typeName: string): Texture {
  const key = sectionTypeKeyOf(typeName);
  let cache = textureCache.get(ctx);
  if (!cache) { cache = new Map(); textureCache.set(ctx, cache); }
  const hit = cache.get(key);
  if (hit) return hit;
  const tex = drawTexture(ctx, key);
  cache.set(key, tex);
  return tex;
}

/** The track carrying the tune in this bar (the drawn texture's lead role),
 *  or null in lead-free sections — the motif arrives with the first phrase. */
export function tuneCarrierForBar(ctx: OrchestratorContext, bar: number): string | null {
  const sec = ctx.sections.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
  if (!sec || LEAD_FREE_SECTIONS.test(sec.name.trim().toLowerCase())) return null;
  const tex = textureForType(ctx, sectionTypeNameAtBar(ctx, bar));
  const role = Object.keys(tex.plan).find((r) => tex.plan[r] === 'lead');
  if (!role) return null;
  return stringVoiceTracks(ctx).find((t) => t.role === role)?.id ?? null;
}

/** The layer one string track plays in one bar (null = it is not in the band plan). */
export function stringLayerForBar(ctx: OrchestratorContext, bar: number, trackId: string): StringsLayer | null {
  const voices = stringVoiceTracks(ctx);
  const track = voices.find((t) => t.id === trackId);
  if (!track) return null;

  const sec = ctx.sections.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
  const inLeadFreeSection = !sec || LEAD_FREE_SECTIONS.test(sec.name.trim().toLowerCase());
  const tex = textureForType(ctx, sectionTypeNameAtBar(ctx, bar));
  const base = tex.plan[track.role] ?? 'pad'; // the texture keeps this role on pad (or no texture at all)

  if ((base === 'lead' || base === 'counterline') && inLeadFreeSection) return 'pad';
  if (base === 'lead' && track.role === 'violins1' && ctx.template?.id === 'ensemble.cinematic') {
    // the tune stays readable: above the threshold it renders as measured tremolo
    const target = ctx.arc?.[bar - 1]?.target ?? 0;
    return target >= TREMOLO_ENERGY_THRESHOLD ? 'tremolo' : 'lead';
  }
  return base;
}

/** The whole assignment, bar by bar: trackId → layer. Deterministic. */
export function assignStringLayers(ctx: OrchestratorContext): { bars: { bar: number; byTrack: Record<string, StringsLayer> }[] } {
  const voices = stringVoiceTracks(ctx);
  const bars = ctx.arc?.length ?? 0;
  const out: { bar: number; byTrack: Record<string, StringsLayer> }[] = [];
  for (let bar = 1; bar <= bars; bar++) {
    const byTrack: Record<string, StringsLayer> = {};
    for (const v of voices) {
      const layer = stringLayerForBar(ctx, bar, v.id);
      if (layer) byTrack[v.id] = layer;
    }
    out.push({ bar, byTrack });
  }
  return { bars: out };
}

/** Group one bar's assignment into the plan's layer slots (bass → top order kept). */
export function layerSlotsForBar(ctx: OrchestratorContext, bar: number): { layer: StringsLayer; trackIds: string[] }[] {
  const voices = stringVoiceTracks(ctx);
  const slots: { layer: StringsLayer; trackIds: string[] }[] = [];
  for (const v of voices) {
    const layer = stringLayerForBar(ctx, bar, v.id);
    if (!layer) continue;
    const slot = slots.find((s) => s.layer === layer);
    if (slot) slot.trackIds.push(v.id);
    else slots.push({ layer, trackIds: [v.id] });
  }
  return slots;
}
