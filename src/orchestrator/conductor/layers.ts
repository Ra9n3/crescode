/**
 * Per-track string layer assignment (Phase 4a). The conductor's plan gives
 * every in-band unlocked string TRACK a role for every bar — lead,
 * counterline, pad, ostinato, tremolo or bass — chosen from the section
 * type, the bar's arc energy and the template's preset. One track = one
 * role per bar (the polyphony cap is one voice per track, so the roles are
 * exclusive by construction). Pure: same context → same assignment.
 *
 * The assignment is shared: `conduct()` uses it for the per-bar annotation
 * the checker audits (maxLayers, one role per track), and the strings
 * renderer uses the very same function so the plan and the notes can never
 * disagree. No template (or a band without a preset) keeps the Phase-2
 * behaviour: every track is a pad.
 *
 * Presets (Phase 4e):
 *  - symphony:        V1 lead, V2+Vla pad, cellosBasses bass (rendered pizz-pulse);
 *  - chamber:         V1 lead, V2 counterline, Vla pad, cellosBasses bass;
 *  - hybrid studio:   as chamber;
 *  - sonata:          V1 lead, cellosBasses bass (no counterline track in band);
 *  - cinematic:       V2+Vla ostinato, cellosBasses bass, V1 carries the lead
 *                     in every non-intro bar (4.5: bars at arc energy ≥
 *                     TREMOLO_ENERGY_THRESHOLD RENDER it as measured tremolo
 *                     repeats — the tune stays readable);
 *  - vocal backing:   pad only — wide legato, no lead inside the vocal zone,
 *                     nothing shorter than an eighth, no ostinato, no stabs;
 *  - intro-like sections never carry a lead (the motif arrives with the
 *     first real phrase; the intro is pad and bass only).
 */
import type { OrchestratorContext, StringsLayer } from '../module';
import { stringVoiceTracks } from '../profiles/strings';

/** The bar's arc energy from which Cinematic V1 switches to measured tremolo. */
export const TREMOLO_ENERGY_THRESHOLD = 0.65;

/** Sections that never carry a lead (the motif arrives with the first phrase). */
const LEAD_FREE_SECTIONS = /intro|prelude|breakdown|ambient/;

/** Preset = the layer skeleton per string role (top → bass), minus energy turns. */
type Preset = Partial<Record<string, StringsLayer>>;

const PRESETS: Record<string, Preset> = {
  'ensemble.symphony': { violins1: 'lead', violas: 'pad', violins2: 'pad', cellosBasses: 'bass' },
  'ensemble.chamber': { violins1: 'lead', violins2: 'counterline', violas: 'pad', cellosBasses: 'bass' },
  'ensemble.hybridstudio': { violins1: 'lead', violins2: 'counterline', violas: 'pad', cellosBasses: 'bass' },
  'ensemble.sonata': { violins1: 'lead', cellosBasses: 'bass' },
  'ensemble.cinematic': { violins1: 'lead', violins2: 'ostinato', violas: 'ostinato', cellosBasses: 'bass' },
  'ensemble.vocalbacking': {}, // wide legato only: every track stays a pad
};

/** The layer one string track plays in one bar (null = it is not in the band plan). */
export function stringLayerForBar(ctx: OrchestratorContext, bar: number, trackId: string): StringsLayer | null {
  const preset = ctx.template ? PRESETS[ctx.template.id] : undefined;
  const voices = stringVoiceTracks(ctx);
  const track = voices.find((t) => t.id === trackId);
  if (!track) return null;
  if (!preset || !preset[track.role]) return 'pad'; // no preset, or the preset keeps this role on pad

  const sec = ctx.sections.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
  const inLeadFreeSection = !sec || LEAD_FREE_SECTIONS.test(sec.name.trim().toLowerCase());
  const base = preset[track.role]!;

  if (track.role === 'violins1' && ctx.template?.id === 'ensemble.cinematic') {
    if (inLeadFreeSection) return 'pad'; // no lead in intros — and no tremolo before the build earns it
    const target = ctx.arc?.[bar - 1]?.target ?? 0;
    return target >= TREMOLO_ENERGY_THRESHOLD ? 'tremolo' : 'lead';
  }
  if (base === 'lead' || base === 'counterline') return inLeadFreeSection ? 'pad' : base;
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
