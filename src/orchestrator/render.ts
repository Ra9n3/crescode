/**
 * Strings pad module (spec §7, work-order step 2d). Sustained notes per chord
 * span, one voice per in-band unlocked string track, voiced by the global DP
 * voice leader (voicing/), velocities from a per-section-type energy table
 * passed through the velocity governor so measureEnergy can never exceed the
 * template clamp.
 *
 * Energy → velocity mapping (deviation from the naive reading, reported):
 * the section-type target E is mapped linearly across the velocity window the
 * governor allows for the sounding count — v = 1 + (cap−1)·E. Chasing the
 * literal target (v = E·127·N/n) would push every string pad to velocity 127
 * in the big bands, because strings are only 4 of 17 roster roles (D3) and
 * the spec itself says that floor gap is "expected and must be reported, not
 * fixed". The linear mapping keeps pads musical while v ≤ cap still bounds
 * window energy by the clamp: E = (n/N)·(v/127) ≤ (n/N)·(cap/127) ≤ max.
 *
 * The DP runs over the WHOLE progression once per Compose All (spec §7.3);
 * per-section render calls slice the memoised result, so section boundaries
 * re-articulate the pad with each section's own energy.
 *
 * Vocal Backing preset (spec §7.7): nothing inside VOCAL_ZONE, no notes
 * shorter than an eighth, open spacing — and triads stay complete because
 * three string voices carry the three tone tiers exactly.
 */
import { mulberry32 } from '../engine/generate';
import { scalePitchClasses } from '../shared/schema/modes';
import { isInstrumentTrack, PPQ, type Note, type Track } from '../shared/schema/types';
import type { EnsembleTemplate } from '../shared/schema/ensembleTemplate';
import { isInBand } from '../shared/schema/band';
import { maxMeanVelocityFor } from './energy';
import { STRING_PROFILE_BY_ROLE, STRING_ROLES, VOCAL_ZONE } from './profiles/strings';
import type { LayerPlan, OrchestratorContext, SectionModule, SectionPatch } from './module';
import { chordTones } from './voicing/chordTones';
import { leadingTonePcOf, voiceLead, type VoicedChord, type VoiceSpec, type VoicingChord } from './voicing/voiceLead';

const MODULE_ID = 'strings';

/** Subtract the breath windows from one [start, end) span: what is left is
 *  what the track may actually sound (Phase 3a — the conductor's breaths). */
export function subtractBreaths([start, end]: [number, number], cuts: [number, number][]): [number, number][] {
  let out: [number, number][] = [[start, end]];
  for (const [cs, ce] of [...cuts].sort((a, b) => a[0] - b[0])) {
    const next: [number, number][] = [];
    for (const [s, e] of out) {
      if (ce <= s || cs >= e) { next.push([s, e]); continue; }
      if (cs > s) next.push([s, cs]);
      if (ce < e) next.push([ce, e]);
    }
    out = next;
  }
  return out.filter(([s, e]) => e > s);
}

/** Per-section-type energy targets (0..1), clamped into the template budget. */
const SECTION_ENERGY: [RegExp, number][] = [
  [/intro|prelude/, 0.30],
  [/breakdown|ambient/, 0.25],
  [/verse|strophe/, 0.50],
  [/prechorus|pre-chorus|lift/, 0.60],
  [/build|riser/, 0.70],
  [/chorus|refrain|hook|drop/, 0.75],
  [/bridge|middle/, 0.55],
  [/outro|coda|fade/, 0.40],
  [/theme|main|groove/, 0.60],
];
const DEFAULT_ENERGY = 0.55;

export const sectionEnergyTarget = (name: string): number => {
  const n = name.trim().toLowerCase();
  for (const [re, e] of SECTION_ENERGY) if (re.test(n)) return e;
  return DEFAULT_ENERGY;
};

const SYMMETRIC_MODES = new Set(['Whole Tone', 'Diminished (Half-Whole)', 'Diminished (Whole-Half)', 'Locrian']);

/** The strings family tracks that will actually sound: in the band, unlocked. */
export function stringVoiceTracks(ctx: OrchestratorContext): Track[] {
  return ctx.project.tracks
    .filter((t) => t.family === 'Strings' && isInstrumentTrack(t) && !t.locked && isInBand(t.role, ctx.ensemble, ctx.template))
    .sort((a, b) => {
      const sa = STRING_PROFILE_BY_ROLE.get(a.role)?.slot ?? 'inner';
      const sb = STRING_PROFILE_BY_ROLE.get(b.role)?.slot ?? 'inner';
      const order = { bass: 0, inner: 1, top: 2 } as Record<string, number>;
      return order[sa] - order[sb] || a.role.localeCompare(b.role);
    });
}

/** A stand-in template for the no-band case: everyone in, no clamp pressure. */
function effectiveTemplate(ctx: OrchestratorContext): { rosterLength: number; clamp: [number, number]; template: EnsembleTemplate | null } {
  if (ctx.template) return { rosterLength: ctx.template.roster.length, clamp: ctx.template.budget.energyClamp, template: ctx.template };
  const roles = new Set(ctx.project.tracks.filter((t) => isInstrumentTrack(t) && isInBand(t.role, ctx.ensemble, null)).map((t) => t.role));
  return { rosterLength: Math.max(1, roles.size), clamp: [0, 1], template: null };
}

// The global DP is computed once per context+take and sliced per section.
interface GlobalVoicing { key: string; voiced: VoicedChord[]; voiceTrackIds: string[] }
const globalCache = new WeakMap<OrchestratorContext, GlobalVoicing>();

function globalVoicing(ctx: OrchestratorContext, voiceTrackIds: string[], seed: number): GlobalVoicing {
  const key = `${seed}|${voiceTrackIds.join(',')}`;
  const hit = globalCache.get(ctx);
  if (hit && hit.key === key) return hit;

  const isVocalBacking = ctx.template?.id === 'ensemble.vocalbacking';
  const voices: VoiceSpec[] = voiceTrackIds.map((id) => {
    const t = ctx.project.tracks.find((x) => x.id === id)!;
    const prof = STRING_PROFILE_BY_ROLE.get(t.role);
    return {
      trackId: t.id, role: t.role,
      // hard bounds = the track's own range (what the sanitizer and
      // validateProject enforce; defaults come from INSTRUMENTS)
      low: t.lowestNote, high: t.highestNote,
      comfortable: prof ? [Math.max(t.lowestNote, Math.min(t.highestNote, prof.comfortable[0])), Math.max(t.lowestNote, Math.min(t.highestNote, prof.comfortable[1]))] : [t.lowestNote, t.highestNote],
      isBass: prof?.slot === 'bass',
    };
  });

  const chords: VoicingChord[] = ctx.spans.map((s) => ({ id: s.id, startTick: s.startTick, endTick: s.endTick, ct: chordTones(s.parsed) }));
  const opts = {
    // climaxOnly forbids doubling for pads too (no climax bookkeeping yet);
    // when voices outnumber tones the voicer falls back to a minimal bass-pc
    // doubling instead of silence (see voiceLead.ts).
    forbidOctaveDoubling: ctx.template ? ctx.template.rules.some((r) => r.type === 'octaveDoubling' && r.params.policy !== 'allowed') : false,
    leadingTonePc: leadingTonePcOf(ctx.project.key, scalePitchClasses(ctx.project.key, ctx.project.mode)),
    checkParallels: !SYMMETRIC_MODES.has(ctx.project.mode),
    openSpacing: isVocalBacking,
    zoneFree: isVocalBacking ? VOCAL_ZONE : null,
    rng: mulberry32(seed >>> 0),
  };

  const voiced = voiceLead(chords, voices, opts);
  const entry = { key, voiced, voiceTrackIds };
  globalCache.set(ctx, entry);
  return entry;
}

export const stringsModule: SectionModule = {
  family: 'Strings',

  roles(ctx: OrchestratorContext): LayerPlan[] {
    const voiceTrackIds = stringVoiceTracks(ctx).map((t) => t.id);
    if (!voiceTrackIds.length) return [];
    return ctx.sections.map((sec) => ({ moduleId: MODULE_ID, sectionId: sec.id, layer: 'pad' as const, voiceTrackIds }));
  },

  render(ctx: OrchestratorContext, plan: LayerPlan, seed: number): SectionPatch {
    const section = ctx.sections.find((s) => s.id === plan.sectionId);
    if (!section || !plan.voiceTrackIds.length) return { notesByTrackId: {} };

    const { rosterLength, clamp } = effectiveTemplate(ctx);
    const isVocalBacking = ctx.template?.id === 'ensemble.vocalbacking';
    const minDuration = isVocalBacking ? PPQ / 2 : 1; // no notes under an eighth
    const { voiced } = globalVoicing(ctx, plan.voiceTrackIds, seed);
    const target = Math.min(sectionEnergyTarget(section.name), clamp[1]);

    const notesByTrackId: Record<string, Note[]> = {};
    for (const id of plan.voiceTrackIds) notesByTrackId[id] = [];

    // Take phrasing: which chord spans the pad RE-ATTACKS (split at the
    // midpoint) instead of sustaining through. The mask is take · 0x9E3779B1
    // (odd multiplier) — multiplication by an odd constant is a bijection
    // mod 2ⁿ, so takes within 2ⁿ of each other always differ in at least one
    // of the first n span bits: nearby takes are GUARANTEED different scores,
    // not just probably different. Same take → same mask → same phrase.
    const take = ctx.project.orchestration?.take ?? 0;
    const phraseMask = Math.imul(take, 0x9e3779b1) >>> 0;

    voiced.forEach((vc, spanIndex) => {
      // clip the span into the section window — a chord crossing a boundary
      // re-articulates per section with that section's energy
      const start = Math.max(vc.startTick, section.startTick);
      const end = Math.min(vc.endTick, section.endTick);
      if (end - start < minDuration) return; // gap or too short (Vocal Backing eighth rule)

      const sounding = vc.pitches.filter((p): p is number => p !== null);
      if (!sounding.length) return;
      const cap = maxMeanVelocityFor(rosterLength, clamp[1], sounding.length);
      const velocity = Math.max(1, Math.min(127, Math.round(1 + (cap - 1) * target)));

      // the take's phrase decision for this span (both halves must clear the
      // preset's minimum duration, so tiny spans are never split into stubs)
      const reattack = ((phraseMask >>> (spanIndex % 31)) & 1) === 1;

      plan.voiceTrackIds.forEach((trackId, vi) => {
        const pitch = vc.pitches[vi];
        if (pitch === null) return;
        // conductor breaths (3a): the track rests inside its breath windows,
        // so the span is cut around them before any note is written
        const windows = subtractBreaths([start, end], plan.breathByTrack?.[trackId] ?? []);
        for (const [s, e] of windows) {
          const len = e - s;
          if (len < minDuration) continue;
          if (reattack && len >= minDuration * 2) {
            const half = Math.floor(len / 2);
            notesByTrackId[trackId].push({ pitch, startTick: s, durationTicks: half, velocity });
            notesByTrackId[trackId].push({ pitch, startTick: s + half, durationTicks: len - half, velocity });
          } else {
            notesByTrackId[trackId].push({ pitch, startTick: s, durationTicks: len, velocity });
          }
        }
      });
    });

    return { notesByTrackId };
  },
};

/** Roles the strings module claims — used to exclude them from the rules generator. */
export const stringsFamilyRoles = STRING_ROLES;
