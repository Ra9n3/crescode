/**
 * Strings module (spec §7, Phase 4). Sustained pads per chord span, one
 * voice per in-band unlocked string track, voiced by the global DP voice
 * leader (voicing/) — now UNDER the fixed lines (Phase 4b): the lead motif
 * and the counterline are written first (lines/), their per-span pitches
 * become hard constraints for the DP, and a span whose fixed lines make it
 * infeasible falls back to the plain pad voicing for that span — never to
 * silence, never to a rule violation. Velocities come from the arc through
 * the velocity governor, so measureEnergy can never exceed the clamp.
 *
 * Layers (Phase 4a): one track = one role per bar. The renderer reads the
 * same per-bar assignment the conductor annotates (conductor/layers.ts) and
 * writes pad / bass (sustained DP voices), lead / counterline (the fixed
 * lines), ostinato / tremolo (their presets, 4e). Phase 4.5: the cinematic
 * 'tremolo' layer CARRIES THE LEAD — V1 plays the motif as measured repeats
 * (each lead note subdivided at TREMOLO_STEP_TICKS, the first repeat on the
 * motif pitch at the motif onset), so the chorus keeps its tune; fallback
 * spans repeat the DP's pitch so the layer never falls silent.
 *
 * Energy → velocity mapping (unchanged since Phase 2): the section target E
 * maps linearly across the velocity window the governor allows for the
 * sounding count — v = 1 + (cap−1)·E — keeping window energy ≤ clamp.
 *
 * The DP runs over the WHOLE progression once per Compose All (spec §7.3);
 * per-section render calls slice the memoised result.
 *
 * Vocal Backing preset (spec §7.7): nothing inside VOCAL_ZONE, no notes
 * shorter than an eighth, open spacing — and its preset keeps every string
 * track on pad (wide legato only, 4e).
 */
import { mulberry32 } from '../engine/generate';
import { noteName, scalePitchClasses } from '../shared/schema/modes';
import { isInstrumentTrack, PPQ, type Note } from '../shared/schema/types';
import { barTicks, projectBars } from '../shared/schema/meter';
import { isInBand } from '../shared/schema/band';
import { maxMeanVelocityFor } from './energy';
import { arcTargetAt, orchestrationSeedFor } from './spine';
import { STRING_PROFILE_BY_ROLE, STRING_ROLES, VOCAL_ZONE, stringVoiceTracks } from './profiles/strings';
import { chordTones } from './voicing/chordTones';
import { leadingTonePcOf, voiceLead, type VoicedChord, type VoiceFix, type VoiceSpec, type VoicingChord } from './voicing/voiceLead';
import type { EnsembleTemplate } from '../shared/schema/ensembleTemplate';
import type { LayerPlan, OrchestratorContext, SectionModule, SectionPatch, StringsLayer } from './module';
import { assignStringLayers, stringLayerForBar, textureForType, sectionTypeNameAtBar, tuneCarrierForBar } from './conductor/layers';
import { motifLine } from './lines/motif';
import { counterlineLine } from './lines/counterline';
import { ostinatoNotes, TREMOLO_STEP_TICKS, SHORT_NOTE_SECONDS } from './lines/ostinato';
import { beatOffsets, beatTicks, isCompound } from '../shared/schema/meter';
import { secondsToTicks } from './spine';

const MODULE_ID = 'strings';

export { stringVoiceTracks } from './profiles/strings';

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

/** A stand-in template for the no-band case: everyone in, no clamp pressure. */
function effectiveTemplate(ctx: OrchestratorContext): { rosterLength: number; clamp: [number, number]; template: EnsembleTemplate | null } {
  if (ctx.template) return { rosterLength: ctx.template.roster.length, clamp: ctx.template.budget.energyClamp, template: ctx.template };
  const roles = new Set(ctx.project.tracks.filter((t) => isInstrumentTrack(t) && isInBand(t.role, ctx.ensemble, null)).map((t) => t.role));
  return { rosterLength: Math.max(1, roles.size), clamp: [0, 1], template: null };
}

/* ------------------------------------------------------------------ */
/* Phase 4b: the prepared lines — motif, counterline, constrained DP   */
/* ------------------------------------------------------------------ */

export interface StringLines {
  /** The per-bar per-track layer assignment (the renderer's truth). */
  assignment: { bar: number; byTrack: Record<string, StringsLayer> }[];
  /** The lead motif and the track that carries it (null when none).
   *  Phase 4.6: the PRIMARY carrier — the topmost track that carries the
   *  tune anywhere in the take. Handoff textures may move the tune to
   *  another track in some section types; every carrier is in `leads`. */
  lead: { trackId: string; notes: Note[] } | null;
  /** Every tune carrier of this take (4.6), one motif line each. */
  leads: { trackId: string; notes: Note[] }[];
  /** The tune carrier per bar (index bar−1; null = no lead this bar). */
  carrierByBar: (string | null)[];
  /** The counterline and its track (null when no track carries it). */
  counter: { trackId: string; notes: Note[] } | null;
  /** Span ids whose fixed lines had to be dropped: they render as pure pad. */
  fallbackSpanIds: Set<string>;
  /** The DP's voicing, one entry per chord span, voices in voiceTrackIds order. */
  voiced: VoicedChord[];
  voiceTrackIds: string[];
  voiceIndex: Map<string, number>;
  /** Measured tremolo repeats written while carrying the lead (4.5 report). */
  tremoloRepeats: number;
  /** Human-readable notes for the report (fallbacks, skipped layerings). */
  reports: string[];
}

/** The take's stream for one DP round (deterministic per (inputs, take, round)). */
const roundRng = (seed: number, round: number) => mulberry32((seed ^ Math.imul(round + 1, 0x85ebca6b)) >>> 0);

export function prepareStrings(ctx: OrchestratorContext, take: number): StringLines {
  const voices = stringVoiceTracks(ctx);
  const voiceTrackIds = voices.map((v) => v.id);
  const voiceIndex = new Map(voiceTrackIds.map((id, i) => [id, i]));
  const assignment = assignStringLayers(ctx);
  const reports: string[] = [];

  // the counterline track: the topmost voice carrying the role.
  const barsWithLayer = (trackId: string, layer: StringsLayer) =>
    assignment.bars.filter((b) => b.byTrack[trackId] === layer).length;
  const counterTrack = [...voices].reverse().find((v) => barsWithLayer(v.id, 'counterline') > 0) ?? null;
  const comfyOf = (trackId: string): [number, number] => {
    const t = ctx.project.tracks.find((x) => x.id === trackId)!;
    const prof = STRING_PROFILE_BY_ROLE.get(t.role);
    return prof ? [Math.max(t.lowestNote, Math.min(t.highestNote, prof.comfortable[0])), Math.max(t.lowestNote, Math.min(t.highestNote, prof.comfortable[1]))] : [t.lowestNote, t.highestNote];
  };

  // Phase 4.6: the tune carrier per bar comes from the drawn texture — a
  // handoff texture moves the lead to V2/Vla/Cb for whole section types.
  // Each carrier gets its own motif line over ITS bars (the same take seed,
  // so a handed-off chorus states the same cell in the new voice's window).
  const carrierByBar = assignment.bars.map((b) => tuneCarrierForBar(ctx, b.bar));
  const carrierBars = new Map<string, number[]>();
  assignment.bars.forEach((b, i) => {
    const c = carrierByBar[i];
    if (!c) return;
    const arr = carrierBars.get(c);
    if (arr) arr.push(b.bar);
    else carrierBars.set(c, [b.bar]);
  });
  const leads = [...carrierBars.entries()]
    .map(([trackId, bars]) => ({
      trackId,
      notes: motifLine({ project: ctx.project, spans: ctx.spans, sections: ctx.sections, leadBars: new Set(bars), comfortable: comfyOf(trackId), take }),
    }))
    .filter((l) => l.notes.length);
  const lead = [...voices].reverse().map((v) => leads.find((l) => l.trackId === v.id)).find((x) => x) ?? null; // topmost carrier
  const counterBars = new Set(assignment.bars.filter((b) => counterTrack && b.byTrack[counterTrack.id] === 'counterline').map((b) => b.bar));

  const counterNotes = counterTrack
    ? counterlineLine({
        project: ctx.project, spans: ctx.spans, counterBars, lead: lead?.notes ?? [],
        comfortable: comfyOf(counterTrack.id), take,
        leadingTonePc: leadingTonePcOf(ctx.project.key, scalePitchClasses(ctx.project.key, ctx.project.mode)),
      })
    : [];
  const counter = counterTrack && counterNotes.length ? { trackId: counterTrack.id, notes: counterNotes } : null;

  // per-span fixes: a voice is fixed to the line's lowest pitch across the
  // span (the DP's other voices must fit strictly under it), or rests when
  // the line is silent but the role is planned there. Spans whose covering
  // bars give the track a different layer stay unconstrained (free pad voice).
  const btBar = barTicks(ctx.project.timeSignature);
  const bars = projectBars(ctx.project);
  const barOf = (tick: number) => Math.min(bars, Math.max(1, Math.floor(tick / btBar) + 1));
  const spanBars = (s: { startTick: number; endTick: number }) => {
    const out: number[] = [];
    for (let b = barOf(s.startTick); b <= barOf(Math.max(s.startTick, s.endTick - 1)); b++) out.push(b);
    return out;
  };
  const minPitchOver = (notes: Note[], s: { startTick: number; endTick: number }): number | null => {
    const overlapping = notes.filter((n) => n.startTick < s.endTick && n.startTick + n.durationTicks > s.startTick);
    return overlapping.length ? Math.min(...overlapping.map((n) => n.pitch)) : null;
  };
  const fixFor = (trackId: string | undefined, planned: (bar: number) => boolean, line: Note[] | null, s: { startTick: number; endTick: number }): VoiceFix | undefined => {
    if (!trackId) return undefined;
    const barsHere = spanBars(s);
    if (!barsHere.some(planned)) return undefined;
    if (!line) return { kind: 'rest' };
    const mp = minPitchOver(line, s);
    return mp === null ? { kind: 'rest' } : { kind: 'pitch', pitch: mp };
  };

  // which spans fell back: every span whose constraints had to be dropped —
  // detected by DELETION, never by the final voicing coincidentally matching
  // (a free lead voice can land on the demanded pitch without the DP having
  // seen the line's other notes)
  const deletedSpans = new Set<string>();
  const pending = new Map<string, (VoiceFix | undefined)[]>();
  for (const s of ctx.spans) {
    const arr: (VoiceFix | undefined)[] = new Array(voices.length).fill(undefined);
    for (const l of leads) {
      // the carrier is planned wherever THE TEXTURE gives it the tune (the
      // layer may read 'tremolo' on the cinematic threshold bars)
      arr[voiceIndex.get(l.trackId)!] = fixFor(l.trackId, (b) => carrierByBar[b - 1] === l.trackId, l.notes, s);
    }
    if (counter) arr[voiceIndex.get(counter.trackId)!] = fixFor(counter.trackId, (b) => assignment.bars[b - 1]?.byTrack[counter.trackId] === 'counterline', counter.notes, s);
    if (arr.some((x) => x !== undefined)) pending.set(s.id, arr);
  }

  // every pitch class the fixed lines sound anywhere in each span — the pad
  // must not double the leading tone against them, nor (when the policy
  // forbids) octave-double them; conflicts make the span fall back to pad
  const linePcsBySpan = new Map<string, Set<number>>();
  for (const s of ctx.spans) {
    const pcs = new Set<number>();
    for (const line of [...leads.map((l) => l.notes), counter?.notes]) {
      if (!line) continue;
      for (const n of line) {
        if (n.startTick < s.endTick && n.startTick + n.durationTicks > s.startTick) pcs.add(((n.pitch % 12) + 12) % 12);
      }
    }
    if (pcs.size) linePcsBySpan.set(s.id, pcs);
  }

  // the DP, voiced for the whole progression; spans whose fixed lines make
  // them infeasible drop their constraints and re-join as plain pad (4b)
  const isVocalBacking = ctx.template?.id === 'ensemble.vocalbacking';
  const voiceSpecs: VoiceSpec[] = voices.map((t) => {
    const prof = STRING_PROFILE_BY_ROLE.get(t.role);
    return {
      trackId: t.id, role: t.role,
      low: t.lowestNote, high: t.highestNote,
      comfortable: prof ? [Math.max(t.lowestNote, Math.min(t.highestNote, prof.comfortable[0])), Math.max(t.lowestNote, Math.min(t.highestNote, prof.comfortable[1]))] : [t.lowestNote, t.highestNote],
      isBass: prof?.slot === 'bass',
    };
  });
  const seed = orchestrationSeedFor(ctx.project, { take });

  const makeOpts = (round: number) => ({
    // climaxOnly forbids doubling for pads too (no climax bookkeeping yet);
    // when voices outnumber tones the voicer falls back to a minimal bass-pc
    // doubling instead of silence (see voiceLead.ts).
    forbidOctaveDoubling: ctx.template ? ctx.template.rules.some((r) => r.type === 'octaveDoubling' && r.params.policy !== 'allowed') : false,
    leadingTonePc: leadingTonePcOf(ctx.project.key, scalePitchClasses(ctx.project.key, ctx.project.mode)),
    checkParallels: !SYMMETRIC_MODES.has(ctx.project.mode),
    openSpacing: isVocalBacking,
    zoneFree: isVocalBacking ? VOCAL_ZONE : null,
    rng: roundRng(seed, round),
  });

  let voiced: VoicedChord[] = [];
  const runDp = (round: number): VoicedChord[] => {
    const chords: VoicingChord[] = ctx.spans.map((s) => ({
      id: s.id, startTick: s.startTick, endTick: s.endTick, ct: chordTones(s.parsed),
      // constraints (and the line-pc exclusions they justify) only bind while
      // the span still carries its fixed lines — a fallback span re-joins as
      // an unconstrained pad, bass pc included
      ...(pending.get(s.id) ? { fixed: pending.get(s.id) } : {}),
      ...(pending.get(s.id) && linePcsBySpan.get(s.id) ? { linePcs: linePcsBySpan.get(s.id) } : {}),
    }));
    return voiceLead(chords, voiceSpecs, makeOpts(round));
  };
  for (let round = 0; ; round++) {
    voiced = runDp(round);
    const dishonored = new Set<string>();
    for (const [spanId, fix] of pending) {
      const v = voiced.find((x) => x.id === spanId)!;
      const bad = fix.some((f, i) => {
        if (!f) return false;
        const p = v.pitches[i];
        return f.kind === 'rest' ? p !== null : p !== f.pitch;
      });
      if (bad) dishonored.add(spanId);
    }
    if (!dishonored.size) break;
    for (const id of dishonored) { pending.delete(id); deletedSpans.add(id); }
    if (round >= 3) { voiced = runDp(round + 1); break; } // final pure-pad pass
  }

  // which of the ORIGINAL fixes survived (the renderer writes line notes on
  // honoured spans and DP pad notes on fallback spans)
  const fallbacks = [...deletedSpans];

  if (fallbacks.length) reports.push(`lines: ${fallbacks.length} chord span(s) fell back to the pad voicing (the fixed lead/counterline left no feasible tuple)`);

  return {
    assignment: assignment.bars,
    lead,
    leads,
    carrierByBar,
    counter,
    fallbackSpanIds: new Set(fallbacks),
    voiced,
    voiceTrackIds,
    voiceIndex,
    tremoloRepeats: 0,
    reports,
  };
}

export const stringsModule: SectionModule = {
  family: 'Strings',

  roles(ctx: OrchestratorContext): LayerPlan[] {
    const voices = stringVoiceTracks(ctx);
    if (!voices.length) return [];
    const out: LayerPlan[] = [];
    for (const sec of ctx.sections) {
      // one plan per layer that OCCURS in the section (the renderer checks
      // the per-bar truth again — bars can switch layers inside a section)
      const byLayer = new Map<StringsLayer, string[]>();
      for (let b = sec.startBar; b < sec.startBar + sec.lengthBars; b++) {
        for (const v of voices) {
          const l = stringLayerForBar(ctx, b, v.id);
          if (!l) continue;
          const arr = byLayer.get(l);
          if (!arr) byLayer.set(l, [v.id]);
          else if (!arr.includes(v.id)) arr.push(v.id); // unique track ids across the section's bars
        }
      }
      for (const [layer, trackIds] of byLayer) out.push({ moduleId: MODULE_ID, sectionId: sec.id, layer, voiceTrackIds: trackIds });
    }
    return out;
  },

  render(ctx: OrchestratorContext, plan: LayerPlan, _seed: number): SectionPatch {
    const section = ctx.sections.find((s) => s.id === plan.sectionId);
    if (!section || !plan.voiceTrackIds.length) return { notesByTrackId: {} };

    const { rosterLength, clamp } = effectiveTemplate(ctx);
    const isVocalBacking = ctx.template?.id === 'ensemble.vocalbacking';
    const minDuration = isVocalBacking ? PPQ / 2 : 1; // no notes under an eighth
    const take = ctx.project.orchestration?.take ?? 0;
    const lines = ctx.lines ?? (ctx.lines = prepareStrings(ctx, take));
    const { voiced, voiceIndex, fallbackSpanIds } = lines;

    const clampMax = clamp[1];
    const targetOf = (start: number, end: number): number => {
      const t = ctx.arc ? arcTargetAt(ctx.arc, Math.floor((start + end) / 2)) : sectionEnergyTarget(section.name);
      return Math.min(clampMax, Math.max(0, t));
    };

    // Take phrasing: which chord spans the pad RE-ATTACKS (split at the
    // midpoint) instead of sustaining through. Same take → same mask.
    const phraseMask = Math.imul(take, 0x9e3779b1) >>> 0;

    const notesByTrackId: Record<string, Note[]> = {};
    for (const id of plan.voiceTrackIds) notesByTrackId[id] = [];

    const btBar = barTicks(ctx.project.timeSignature);
    const bars = projectBars(ctx.project);

    const pushDPNote = (sink: Note[], pitch: number, s: number, e: number, velocity: number, reattack: boolean) => {
      const len = e - s;
      if (reattack && len >= minDuration * 2) {
        const half = Math.floor(len / 2);
        sink.push({ pitch, startTick: s, durationTicks: half, velocity, articulation: 'legato' });
        sink.push({ pitch, startTick: s + half, durationTicks: len - half, velocity, articulation: 'legato' });
      } else {
        sink.push({ pitch, startTick: s, durationTicks: len, velocity, articulation: 'legato' });
      }
    };
    const writeLineNotes = (sink: Note[], line: Note[], s: number, e: number, velocity: number) => {
      for (const n of line) {
        if (n.startTick >= e || n.startTick + n.durationTicks <= s) continue;
        const st = Math.max(n.startTick, s);
        const en = Math.min(n.startTick + n.durationTicks, e);
        sink.push({ pitch: n.pitch, startTick: st, durationTicks: en - st, velocity, articulation: n.articulation ?? 'legato' });
      }
    };

    voiced.forEach((vc, spanIndex) => {
      // clip the span into the section window — a chord crossing a boundary
      // re-articulates per section with that section's energy
      const start0 = Math.max(vc.startTick, section.startTick);
      const end0 = Math.min(vc.endTick, section.endTick);
      if (end0 - start0 < minDuration) return; // gap or too short (Vocal Backing eighth rule)

      const cap = maxMeanVelocityFor(rosterLength, clamp[1], Math.max(1, vc.pitches.filter((p): p is number => p !== null).length));
      const reattack = ((phraseMask >>> (spanIndex % 31)) & 1) === 1;
      const fellBack = fallbackSpanIds.has(vc.id);

      const b0 = Math.max(1, Math.floor(start0 / btBar) + 1);
      const b1 = Math.min(bars, Math.floor((end0 - 1) / btBar) + 1);
      const beat = beatTicks(ctx.project.timeSignature);
      const lastSectionStart = ctx.sections.length ? Math.max(...ctx.sections.map((x) => x.startBar)) : 1;
      for (let bar = b0; bar <= b1; bar++) {
        const ps = Math.max(start0, (bar - 1) * btBar);
        const pe = Math.min(end0, bar * btBar);
        if (pe - ps < minDuration) continue;
        // Phase 4.6: the ostinato's per-bar shape — it does NOT run through
        // every bar of a section: it enters 1–2 bars in (the texture's
        // seeded draw), drops out for the section's pre-change dip bar, and
        // rests on the last beat of every 4th bar of the section.
        let ostWin: [number, number] | null = null;
        if (plan.layer === 'ostinato') {
          const sec = ctx.sections.find((x) => bar >= x.startBar && bar < x.startBar + x.lengthBars);
          const tex = textureForType(ctx, sectionTypeNameAtBar(ctx, bar));
          const into = sec ? bar - sec.startBar : 0;
          const dipBar = !!sec && bar === sec.startBar + sec.lengthBars - 1 && sec.startBar < lastSectionStart;
          if (into >= tex.style.enterAfter && !dipBar) {
            const end = (into + 1) % 4 === 0 ? Math.min(pe, (bar - 1) * btBar + btBar - beat) : pe;
            if (end > ps) ostWin = [ps, end];
          }
        }
        for (const trackId of plan.voiceTrackIds) {
          if (stringLayerForBar(ctx, bar, trackId) !== plan.layer) continue; // another plan carries this bar
          if (plan.layer === 'ostinato' && !ostWin) continue; // gated bar (4.6): the ostinato rests, it is not a pad
          const vi = voiceIndex.get(trackId);
          const dpPitch = vi !== undefined ? vc.pitches[vi] : null;
          // conductor breaths (3a): the track rests inside its breath windows,
          // so the piece is cut around them before any note is written. The
          // ostinato's window is pre-clipped by its per-bar gating (4.6).
          const windows = subtractBreaths(ostWin ?? [ps, pe], plan.breathByTrack?.[trackId] ?? []);
          for (const [s, e] of windows) {
            const len = e - s;
            if (len < minDuration) continue;
            const velocity = Math.max(1, Math.min(127, Math.round(1 + (cap - 1) * targetOf(s, e))));
            const carrierHere = lines.leads.find((l) => l.trackId === trackId);
            if (plan.layer === 'lead' && carrierHere && !fellBack) {
              writeLineNotes(notesByTrackId[trackId], carrierHere.notes, s, e, velocity);
            } else if (plan.layer === 'counterline' && lines.counter?.trackId === trackId && !fellBack) {
              writeLineNotes(notesByTrackId[trackId], lines.counter.notes, s, e, velocity);
            } else if (plan.layer === 'ostinato') {
              // Phase 4e: chord tones on the drawn rhythm cell (4.8: meter-
              // aware, over the felt beats — 8ths by default, the full 16th
              // grid only for the trailer — 4.6); both ostinato tracks are
              // drawn in ONE call so the lower voice stays under the upper.
              // The leading tone is never an ostinato tone: two ostinato
              // voices (or an ostinato voice over the bass) must not double
              // it. 4.6: the pulse stays UNDER the tune — its ceiling is the
              // lead's lowest pitch sounding in this window (the DP's V1
              // voice on a fallback span).
              // Phase 4.8: the two-track texture pairs its tracks — interlock
              // (the half-slot offset) or across-bar call/response (hocket:
              // V2 calls on even section bars, the viola answers on odd) —
              // and the drawn density curve thins it to ONE track on the low
              // ('rise') or high ('dip') half of the section's own arc range;
              // the contour walks the register and the accent shape rides
              // the window's governor cap.
              const ltPc = leadingTonePcOf(ctx.project.key, scalePitchClasses(ctx.project.key, ctx.project.mode));
              const ordered = [...plan.voiceTrackIds].reverse(); // top first
              const tex = textureForType(ctx, sectionTypeNameAtBar(ctx, bar));
              const style = tex.style;
              const secHere = ctx.sections.find((x) => bar >= x.startBar && bar < x.startBar + x.lengthBars);
              if (style.interlock) {
                if (style.pairing === 'hocket') {
                  // hocket: exactly one track sounds per bar (V2 on even
                  // section bars, the viola on odd), same grid, no offset
                  const parity = (bar - (secHere?.startBar ?? bar)) % 2;
                  if (trackId !== (parity === 0 ? ordered[0] : ordered[1])) continue;
                } else {
                  // density curve: full (two tracks) on the high half of the
                  // section's own arc range ('rise'), the reverse on 'dip';
                  // thin = the upper track alone
                  let lo = Infinity;
                  let hi = -Infinity;
                  for (let b = (secHere?.startBar ?? bar); b < (secHere?.startBar ?? bar) + (secHere?.lengthBars ?? 0); b++) {
                    const t = ctx.arc?.[b - 1]?.target ?? 0;
                    lo = Math.min(lo, t);
                    hi = Math.max(hi, t);
                  }
                  const thr = (lo + hi) / 2;
                  const target = ctx.arc?.[bar - 1]?.target ?? 0;
                  const full = style.density === 'rise' ? target >= thr : target <= thr;
                  if (!full && trackId === ordered[1]) continue;
                }
              }
              const leadPitches = lines.leads.flatMap((l) => l.notes).filter((n) => n.startTick < e && n.startTick + n.durationTicks > s).map((n) => n.pitch);
              const v1Voice = voiceIndex.get(ctx.project.tracks.find((t) => t.role === 'violins1')?.id ?? '');
              const ceilingPitch = leadPitches.length && !fellBack
                ? Math.min(...leadPitches)
                : v1Voice !== undefined ? vc.pitches[v1Voice] : null;
              const perTrack = ostinatoNotes({
                ts: ctx.project.timeSignature,
                tempoMap: ctx.project.tempoMap,
                startTick: s, endTick: e,
                tones: chordTones(ctx.spans[spanIndex].parsed).tones.filter((t) => ltPc === null || ((t.pc % 12) + 12) % 12 !== ltPc),
                project: ctx.project,
                spanIndex,
                tracks: ordered.map((id) => {
                  const t = ctx.project.tracks.find((x) => x.id === id)!;
                  const prof = STRING_PROFILE_BY_ROLE.get(t.role);
                  return { low: t.lowestNote, high: t.highestNote, comfortable: prof ? [Math.max(t.lowestNote, Math.min(t.highestNote, prof.comfortable[0])), Math.max(t.lowestNote, Math.min(t.highestNote, prof.comfortable[1]))] as [number, number] : [t.lowestNote, t.highestNote] as [number, number] };
                }),
                velocity,
                velocityCap: cap,
                rate: style.rate,
                cell: style.cell,
                contour: style.contour,
                accent: style.accent,
                shape: style.shape,
                interlock: style.interlock && style.pairing !== 'hocket',
                clipShort: style.clippedShort,
                articulation: style.ostArticulation,
                ceilingPitch,
              });
              const idx = ordered.indexOf(trackId);
              notesByTrackId[trackId].push(...(perTrack[idx] ?? []));
            } else if (plan.layer === 'tremolo') {
              // Phase 4.5: the tremolo layer CARRIES THE LEAD — the motif is
              // rendered as measured repeated notes (articulation 'tremolo'):
              // each lead note is subdivided at TREMOLO_STEP_TICKS and the
              // first repeat lands ON the motif pitch at the motif onset, so
              // the chorus keeps its tune. A fallback span (or a missing
              // line) repeats the DP's pitch — never silence. On the 4.6
              // tremolo-bed texture the non-carrier tracks repeat their DP
              // pitch: a shimmering bed under the tune.
              const leadHere = carrierHere && !fellBack ? carrierHere.notes : null;
              if (leadHere) {
                for (const n of leadHere) {
                  const ns = Math.max(n.startTick, s);
                  const ne = Math.min(n.startTick + n.durationTicks, e);
                  for (let t = ns; t < ne; t += TREMOLO_STEP_TICKS) {
                    notesByTrackId[trackId].push({ pitch: n.pitch, startTick: t, durationTicks: Math.min(TREMOLO_STEP_TICKS, ne - t), velocity, articulation: 'tremolo' });
                    lines.tremoloRepeats++;
                  }
                }
              } else if (dpPitch !== null) {
                for (let t = s; t < e; t += TREMOLO_STEP_TICKS) {
                  notesByTrackId[trackId].push({ pitch: dpPitch, startTick: t, durationTicks: Math.min(TREMOLO_STEP_TICKS, e - t), velocity, articulation: 'tremolo' });
                }
              }
            } else if (plan.layer === 'bass' && ctx.template?.id === 'ensemble.symphony' && textureForType(ctx, sectionTypeNameAtBar(ctx, bar)).style.bassPizz) {
              // Phase 4e: pizz-pulse on the strong beats under pads and lines
              // (4.6: only in the textures whose Cb axis is pizz, not sustained)
              if (dpPitch === null) continue;
              const offsets = beatOffsets(ctx.project.timeSignature);
              const nBeats = offsets.length;
              const simple = !isCompound(ctx.project.timeSignature);
              const barStart = Math.floor(s / btBar) * btBar;
              const shortTicks = Math.max(1, secondsToTicks(SHORT_NOTE_SECONDS, ctx.project.tempoMap));
              offsets.forEach((off, idx) => {
                const strong = idx === 0 || (simple && idx * 2 === nBeats);
                const t = barStart + off;
                if (!strong || t < s || t >= e) return;
                notesByTrackId[trackId].push({ pitch: dpPitch, startTick: t, durationTicks: Math.min(shortTicks, e - t), velocity, articulation: 'pizz' });
              });
            } else if (dpPitch !== null) {
              // pad / bass (sustained outside the symphony pizz textures)
              pushDPNote(notesByTrackId[trackId], dpPitch, s, e, velocity, reattack);
            }
          }
        }
      }
    });

    return { notesByTrackId };
  },
};

/** Roles the strings module claims — used to exclude them from the rules generator. */
export const stringsFamilyRoles = STRING_ROLES;

/**
 * Phase 4f, per note since Phase 4.5: Vc+Cb layering inside cellosBasses —
 * the Cb doubles the Vc line an octave below, ONLY where the template's
 * octaveDoubling policy is 'allowed'. Per note: a note whose octave below
 * would leave the track's hard range is skipped (only that note), and the
 * leading tone is NEVER doubled — the hard rule wins over the layering, note
 * by note, so the Cb line simply opens where the Vc crosses it. The
 * doubled/total count lands in the reports per template. Mutates the
 * handed-in note arrays.
 */
export function maybeLayerCellosBasses(ctx: OrchestratorContext, notesByTrackId: Record<string, Note[]>, stringsTrackIds: string[]): void {
  const template = ctx.template;
  if (!template) return;
  const cbId = stringsTrackIds.find((id) => ctx.project.tracks.find((t) => t.id === id)?.role === 'cellosBasses');
  if (!cbId) return;
  const policy = (template.rules.find((r) => r.type === 'octaveDoubling')?.params as { policy?: string } | undefined)?.policy;
  const notes = notesByTrackId[cbId] ?? [];
  if (!notes.length) return;
  if (policy !== 'allowed') {
    ctx.lines?.reports.push(`Vc+Cb layering (${template.id}): skipped — the octaveDoubling policy is ${policy ?? 'none'}`);
    return;
  }
  const track = ctx.project.tracks.find((t) => t.id === cbId)!;
  const lt = leadingTonePcOf(ctx.project.key, scalePitchClasses(ctx.project.key, ctx.project.mode));
  const doubles: Note[] = [];
  let underRange = 0;
  let onLeadingTone = 0;
  for (const n of notes) {
    if (lt !== null && ((n.pitch % 12) + 12) % 12 === lt) { onLeadingTone++; continue; } // never double the leading tone
    if (n.pitch - 12 < track.lowestNote) { underRange++; continue; } // skip only the notes that would fall below
    doubles.push({ ...n, pitch: n.pitch - 12 });
  }
  if (doubles.length) {
    notesByTrackId[cbId] = [...notes, ...doubles].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
  }
  const skips = [
    underRange ? `${underRange} under the track's low ${noteName(track.lowestNote)}` : null,
    onLeadingTone ? `${onLeadingTone} on the leading tone` : null,
  ].filter(Boolean).join(', ');
  ctx.lines?.reports.push(`Vc+Cb layering (${template.id}): ${doubles.length}/${notes.length} notes doubled an octave below${skips ? ` (skipped: ${skips})` : ''}`);
}
