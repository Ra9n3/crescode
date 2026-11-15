/**
 * Winds planner (Phase 9, spec §14). Runs at the CONDUCTOR level, after the
 * moments, mirroring the brass planner's shape: per bar it reads the arc
 * target as a fraction of the clamp max, gates the choir (low/mid/high/
 * peak, chorus relief §14.4) and assigns each rostered wind part at most
 * one voice kind. Its draws ride ONE salted D8 stream —
 * `hashString('winds')` over the (inputs, take) seed — so the texture
 * draws, the moments stream, the brass stream and every existing draw are
 * untouched byte-for-byte.
 *
 * Draw order (fixed): 1) the wind lead (bridge only, rare, weighted —
 * planned moments-INDEPENDENT so the conductor can hand its bars to the
 * moments' noGo before the moments are drawn, exactly the brass-lead
 * pattern), 2) the lead double per section type (mode, then part — two
 * draws per type, always), 3) the flutter-tongue draws (flutes, clarinets —
 * one weighted draw each), 4) the pickup runs (per candidate: chance, then
 * part). Everything else is deterministic reading: the gates, the texture,
 * the moment overrides, the entrance rule and the brass windowing consult
 * no randomness. The pickup run targets only STRUCTURAL downbeats (chorus-
 * type entries — where the tutti moments land anyway), so no wind draw
 * depends on the moments (§14.8).
 *
 * Entrance rule (§14.4, the brass rule): a part's first bar after a fully
 * silent bar must follow a strictly lower-energy bar. Bar 1 never carries
 * ordinary winds. Moment kinds (tutti/unison/soli) and the wind lead are
 * exempt: each carries its own placement contract from its planner.
 */
import { mulberry32, hashString } from '../../engine/generate';
import { orchestrationSeedFor, ticksToSeconds, type ArcBar, type SpineSection } from '../spine';
import { barTicks, beatTicks, projectBars } from '../../shared/schema/meter';
import { chordTones } from '../voicing/chordTones';
import type { Project } from '../../shared/schema/types';
import type { EnsembleTemplate } from '../../shared/schema/ensembleTemplate';
import { freshEnsemble } from '../../shared/schema/band';
import { drawWeighted, sectionTypeNameAtBar, textureForType } from '../conductor/layers';
import type { OrchestratorContext } from '../module';
import { leadingTonePcOf } from '../voicing/voiceLead';
import { scalePitchClasses } from '../../shared/schema/modes';
import {
  FLUTTER_WEIGHTS, LEAD_DOUBLE_MODE_WEIGHTS, LEAD_DOUBLE_PART_WEIGHTS, PICKUP_RUN_CHANCE, PICKUP_RUN_MAX,
  PICKUP_RUN_PART_WEIGHTS, WIND_GATES, WIND_LEAD_INSTRUMENT_WEIGHTS, WIND_LEAD_WEIGHTS, WIND_PARTS,
  WIND_PROFILES, isChorusTypeW, levelForNormW, windTrackOf,
  type LeadDoubleMode, type WindLevel, type WindPart, type WindProfile,
} from './profile';

export type WindVoiceKind =
  | 'colour' | 'leadDouble' | 'counter' | 'bassDouble' | 'harmony' | 'ostinato'
  | 'lead' | 'tutti' | 'unison' | 'soli';

export interface WindBarPlan {
  bar: number;
  level: WindLevel;
  /** The arc target over the clamp max this bar. */
  norm: number;
  voices: Partial<Record<WindPart, WindVoiceKind>>;
  /** The kinds the level gates + the entrance rule produced BEFORE the
   *  moment overrides — the ordinary line the renderer ghost-runs through
   *  moment bars so its cap/voice-leading state stays moment-independent. */
  ordinary: Partial<Record<WindPart, WindVoiceKind>>;
  /** The moment covering the bar, when it drives the wind kinds. */
  moment?: 'tutti' | 'unison' | 'soli';
}

export interface WindLeadSpan {
  startBar: number;
  endBar: number;
  part: WindPart;
  startTick: number;
  endTick: number;
}

export interface PickupRun {
  /** The part carrying the run. */
  part: WindPart;
  /** The bar whose last beat(s) carry the run (the bar BEFORE the downbeat). */
  bar: number;
  /** The run's first onset (inside the pickup bar). */
  startTick: number;
  /** The downbeat the run lands on (a chord tone there). */
  downbeatTick: number;
  downbeatBar: number;
  /** The chord tone at the downbeat the run ends on (planned deterministically). */
  downbeatPitch: number;
}

export interface LeadDoubleChoice {
  part: WindPart | null;
  mode: LeadDoubleMode;
}

export interface WindPlan {
  bars: WindBarPlan[];
  leads: WindLeadSpan[];
  /** The drawn lead double per section-type key. */
  leadDoubleByType: Record<string, LeadDoubleChoice>;
  /** The drawn pickup runs, in piece order. */
  pickupRuns: PickupRun[];
  /** The drawn flutter-tongue bars per part (peak only, rare). */
  flutterBars: Partial<Record<WindPart, number[]>>;
  reports: string[];
}

/** The empty plan (no template / no wind roster): the module is silent. */
export const EMPTY_WIND_PLAN: WindPlan = { bars: [], leads: [], leadDoubleByType: {}, pickupRuns: [], flutterBars: {}, reports: [] };

/** The salted winds stream (D8): a pure function of (inputs, take). */
export const windRng = (project: Project, take: number): (() => number) =>
  mulberry32((orchestrationSeedFor(project, { take }) ^ Math.imul(hashString('winds'), 0x85ebca6b)) >>> 0);

const secTypeKey = (name: string): string => name.trim().toLowerCase() || '*';
const BRIDGE_LIKE = /bridge|middle/;
/** The textures whose rhythm cell the wind ostinato figures may join (§14.5). */
export const OSTINATO_TEXTURES = new Set(['singleOstinato', 'interlockingOstinato', 'pizzPulse', 'trailer']);

const capBarsOf = (prof: WindProfile, secPerBar: number): number => {
  const bySec = Math.max(1, Math.floor(prof.phraseCapSec / Math.max(0.01, secPerBar)));
  return prof.phraseCapBars !== null ? Math.min(bySec, prof.phraseCapBars) : bySec;
};

/**
 * The wind lead spans (§14.5): BRIDGE sections only, mid gate or above,
 * rare (weighted 0.7 none / 0.3 one per piece), 2–4 bars capped by the
 * chosen instrument's phrase cap, placed where a strictly lower-energy bar
 * precedes, never on the near-silence or final bar, never on a brass-lead
 * bar (one lead at a time). INDEPENDENT of the moments: the conductor plans
 * it BEFORE the moments and the moments avoid its bars — so the strings'
 * suppression on its bars is identical with and without them (the
 * draw-identity pin). Pure: the conductor calls this for the strings'
 * suppression and the planner calls it again — identical inputs, identical
 * spans.
 */
export function planWindLeads(
  project: Project, template: EnsembleTemplate | null, sections: SpineSection[],
  arc: ArcBar[], rng: () => number,
): WindLeadSpan[] {
  const out: WindLeadSpan[] = [];
  if (!template || !arc.length || !sections.length) return out;
  const ctxLike = { project, ensemble: project.ensemble ?? freshEnsemble(), template };
  const soloists = (['oboes', 'clarinets', 'flutes'] as WindPart[]).filter((p) => windTrackOf(ctxLike, p) !== null);
  if (!soloists.length) return out;
  const btBar = barTicks(project.timeSignature);
  const clampMax = template.budget.energyClamp[1];
  const noGo = new Set<number>([projectBars(project)]); // the final bar always sounds untouched
  for (const a of arc) if (a.nearSilence) noGo.add(a.bar);

  if (rng() >= WIND_LEAD_WEIGHTS.none) {
    const part = drawWeighted(rng, WIND_LEAD_INSTRUMENT_WEIGHTS, soloists);
    // bridge INTERIOR bars only (§14.5): every moment candidate class sits
    // at a section opening, a pre-chorus dip or the bar after a breath —
    // a bridge's interior bars are moment-free, so the lead never displaces
    // a moment and the moments' plan stays byte-identical to HEAD; the
    // span also never touches the bridge's last bar (the pre-chorus dip a
    // unison may own) or its first (the soli/imitation opening)
    const candidates: number[] = [];
    for (const sec of sections) {
      if (!BRIDGE_LIKE.test(secTypeKey(sec.name))) continue;
      const secEnd = sec.startBar + sec.lengthBars - 1;
      for (let b = sec.startBar + 1; b <= secEnd - 1 && b <= arc.length; b++) {
        const norm = (arc[b - 1]?.target ?? 0) / clampMax;
        if (norm < WIND_GATES.mid) continue;
        if (noGo.has(b)) continue;
        if (b < 2 || (arc[b - 2]?.target ?? 0) >= (arc[b - 1]?.target ?? 0)) continue; // entrance rule
        candidates.push(b);
      }
    }
    if (candidates.length) {
      const startBar = candidates[Math.floor(rng() * candidates.length)];
      const secPerBar = ticksToSeconds(barTicks(project.timeSignature), project.tempoMap);
      const capBars = Math.max(2, Math.min(4, capBarsOf(WIND_PROFILES[part], secPerBar)));
      const secHere = sections.find((s) => startBar >= s.startBar && startBar < s.startBar + s.lengthBars);
      const secEnd = secHere ? secHere.startBar + secHere.lengthBars - 1 : projectBars(project) - 1;
      const endBar = Math.min(secEnd - 1, projectBars(project) - 1, startBar + capBars - 1);
      if (endBar > startBar) {
        out.push({ startBar, endBar, part, startTick: (startBar - 1) * btBar, endTick: (endBar + 1) * btBar });
      }
    }
  }
  return out;
}

/**
 * Plans the take's winds. Pure: same context → same plan. Runs at the
 * conductor level (after the moments); the renderer realises it after the
 * brass renderer so the velocity math and the windowing see every other
 * family's notes.
 */
export function planWinds(ctx: OrchestratorContext): WindPlan {
  const { project, template, sections, arc } = ctx;
  const moments = ctx.moments ?? [];
  const take = project.orchestration?.take ?? 0;
  const reports: string[] = [];
  if (!template || !arc?.length) return EMPTY_WIND_PLAN;
  const clampMax = template.budget.energyClamp[1];
  const roster = WIND_PARTS.filter((p) => windTrackOf(ctx, p) !== null);
  if (!roster.length) return EMPTY_WIND_PLAN;

  const rng = windRng(project, take);
  const leads = planWindLeads(project, template, sections, arc, rng);

  // the lead double, one draw pair per section type (first-occurrence order)
  const doubleParts = roster.filter((p) => p === 'flutes' || p === 'oboes');
  const leadDoubleByType: Record<string, LeadDoubleChoice> = {};
  for (const sec of sections) {
    const key = secTypeKey(sec.name);
    if (leadDoubleByType[key] !== undefined) continue;
    const mode = drawWeighted(rng, LEAD_DOUBLE_MODE_WEIGHTS);
    const part = doubleParts.length ? drawWeighted(rng, LEAD_DOUBLE_PART_WEIGHTS, doubleParts) : null;
    leadDoubleByType[key] = { mode, part: mode === 'none' ? null : part };
  }

  // the flutter-tongue draws (flutes, clarinets — one weighted draw each)
  const flutterBars: Partial<Record<WindPart, number[]>> = {};
  for (const part of ['flutes', 'clarinets'] as WindPart[]) {
    if (!roster.includes(part)) continue;
    if (rng() >= FLUTTER_WEIGHTS[part]) continue;
    const peakBars: number[] = [];
    for (let b = 1; b <= arc.length; b++) {
      if ((arc[b - 1]?.target ?? 0) / clampMax < WIND_GATES.peak) continue;
      if (leads.some((l) => b >= l.startBar && b <= l.endBar)) continue;
      peakBars.push(b);
    }
    if (peakBars.length) flutterBars[part] = [peakBars[Math.floor(rng() * peakBars.length)]];
  }

  // the pickup runs: structural candidates only — the bar before a
  // chorus-type entry (where the tutti moments land anyway); rare, capped
  const pickupRuns: PickupRun[] = [];
  const btBar = barTicks(project.timeSignature);
  const beat = beatTicks(project.timeSignature);
  const noGo = new Set<number>([projectBars(project)]);
  for (const a of arc) if (a.nearSilence) noGo.add(a.bar);
  const runParts = roster.filter((p) => p !== 'bassoons');
  for (const sec of sections) {
    if (!isChorusTypeW(sec.name)) continue;
    const bar = sec.startBar - 1; // the pickup bar
    if (bar < 1 || noGo.has(bar)) continue;
    if (!((arc[bar - 1]?.target ?? 0) < (arc[sec.startBar - 1]?.target ?? 0))) continue; // the dip clears the entry
    if (rng() >= PICKUP_RUN_CHANCE) continue;
    if (pickupRuns.length >= PICKUP_RUN_MAX) break;
    if (!runParts.length) continue;
    const part = drawWeighted(rng, PICKUP_RUN_PART_WEIGHTS, runParts);
    // the landing pitch: the leading-tone-free chord tone of the downbeat
    // span inside the part's sweet window, nearest the window's middle
    const downbeatTick = (sec.startBar - 1) * btBar;
    const span = ctx.spans.find((sp) => sp.startTick <= downbeatTick && downbeatTick < sp.endTick) ?? ctx.spans[0];
    const prof = WIND_PROFILES[part];
    const [swLo, swHi] = prof.sweet;
    // the clarinet's 65–68 ban lifts the landing's floor past the band
    const poolFloor = prof.leadBan ? Math.max(swLo, prof.leadBan[1] + 1) : swLo;
    const scalePcs = new Set(scalePitchClasses(project.key, project.mode));
    const ltPc = leadingTonePcOf(project.key, scalePitchClasses(project.key, project.mode));
    const tonePcs = span ? chordTones(span.parsed).tones.map((t) => t.pc).filter((pc) => ltPc === null || pc !== ltPc) : [];
    const pool: number[] = [];
    for (const pc of tonePcs) for (let p = poolFloor + (((pc - poolFloor) % 12) + 12) % 12; p <= swHi; p += 12) pool.push(p);
    if (!pool.length) {
      // no in-window chord tone: fall back to the scale tones of the chord's root pc
      const rootPc = span ? ((chordTones(span.parsed).bassPc % 12) + 12) % 12 : 0;
      for (let p = poolFloor + (((rootPc - poolFloor) % 12) + 12) % 12; p <= swHi; p += 12) if (scalePcs.has(((p % 12) + 12) % 12)) pool.push(p);
    }
    if (!pool.length) continue;
    const mid = (swLo + swHi) / 2;
    const downbeatPitch = pool.reduce((best, c) => (Math.abs(c - mid) < Math.abs(best - mid) ? c : best), pool[0]);
    pickupRuns.push({
      part, bar,
      startTick: (bar - 1) * btBar + btBar - 2 * beat, // the last beat or two
      downbeatTick,
      downbeatBar: sec.startBar,
      downbeatPitch,
    });
  }

  const bars = projectBars(project);
  const d2ok = (template.rules.find((r) => r.type === 'octaveDoubling')?.params as { policy?: string } | undefined)?.policy === 'allowed';
  const leadByBar = new Map<number, WindLeadSpan>();
  for (const l of leads) for (let b = l.startBar; b <= l.endBar; b++) leadByBar.set(b, l);
  const soloCarrierPart = soloCarrierWindOf(ctx, roster);

  const barPlans: WindBarPlan[] = [];
  const lastSounding: Partial<Record<WindPart, number>> = {};
  for (let bar = 1; bar <= bars; bar++) {
    const target = arc[bar - 1]?.target ?? 0;
    const norm = clampMax > 0 ? target / clampMax : 0;
    const level: WindLevel = levelForNormW(norm);
    const voices: Partial<Record<WindPart, WindVoiceKind>> = {};
    const ordinaryVoices: Partial<Record<WindPart, WindVoiceKind>> = {};
    const secHere = sections.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
    const typeKey = secTypeKey(secHere?.name ?? '*');
    const inChorus = isChorusTypeW(secHere?.name);
    const tex = textureForType(ctx, sectionTypeNameAtBar(ctx, bar));
    const isOstTex = OSTINATO_TEXTURES.has(tex.id);
    const hasLead = (ctx.lines?.carrierByBar ?? [])[bar - 1] != null;
    const moment = moments.find(
      (m) => bar >= m.startBar && bar <= m.endBar && (m.kind === 'tutti' || m.kind === 'unison' || m.kind === 'soli'),
    );
    const dbl = leadDoubleByType[typeKey] ?? { part: null, mode: 'none' as const };
    // §14.4 chorus relief: in chorus-type bars the double engages from the
    // low gate (a chorus never thins with winds in) and a drawn 'none'
    // still doubles at the octave — the drawn mode governs elsewhere
    const dblMode: LeadDoubleMode | null = dbl.mode === 'none'
      ? (inChorus ? 'octaveAbove' : null)
      : dbl.mode;
    const dblGate = inChorus ? WIND_GATES.low : WIND_GATES.mid;
    const colorGate = WIND_GATES.low;
    const harGate = WIND_GATES.high;

    // --- ordinary level roles (§14.4/§14.5): one voice per part ---
    const ordinary = (p: WindPart): WindVoiceKind | undefined => {
      if (level === 'off') return undefined;
      if (p === 'bassoons') {
        // chorus relief: the bassoon sounds wherever the cellos play (the
        // renderer checks the real cello notes); elsewhere from the mid gate
        if (inChorus) return 'bassDouble';
        return norm >= WIND_GATES.mid ? 'bassDouble' : undefined;
      }
      if (p === 'clarinets') {
        if (norm < colorGate) return undefined;
        if (isOstTex && norm >= dblGate && norm < harGate) return 'ostinato';
        if (norm >= harGate) return 'harmony';
        // mid: the inner line against the lead where the counterline exists
        if (norm >= WIND_GATES.mid && ctx.lines?.counter) return 'counter';
        return 'colour';
      }
      if (p === 'oboes') {
        if (dblMode && dbl.part === 'oboes' && hasLead && norm >= dblGate && (dblMode !== 'unison' || d2ok)) return 'leadDouble';
        if (norm < colorGate) return undefined;
        // chorus relief: the oboe sounds through the chorus (the choir spreads)
        if (inChorus && norm >= colorGate) return 'harmony';
        if (norm >= harGate) return 'harmony';
        return 'colour';
      }
      // flutes
      if (dblMode && dbl.part === 'flutes' && hasLead && norm >= dblGate && (dblMode !== 'unison' || d2ok)) return 'leadDouble';
      if (isOstTex && norm >= dblGate && norm < harGate) return 'ostinato';
      if (norm >= harGate) return 'harmony';
      // chorus relief: the flute sounds through the chorus (the choir spreads)
      if (inChorus && norm >= WIND_GATES.low) return 'harmony';
      return undefined; // mid without a drawn double: the flute rests (colour is the reeds' job)
    };
    for (const p of roster) ordinaryVoices[p] = ordinary(p);

    // --- the entrance rule for the ORDINARY line (bar 1 never enters) —
    // gated and advanced independently of the moments, so the ordinary
    // line's continuity is identical with and without them
    if (bar === 1) {
      for (const p of roster) ordinaryVoices[p] = undefined;
    } else {
      for (const p of roster) {
        const kind = ordinaryVoices[p];
        if (kind === undefined) continue;
        if (lastSounding[p] === bar - 1) continue; // continuous, not an entrance
        if (!((arc[bar - 2]?.target ?? 0) < (arc[bar - 1]?.target ?? 0))) ordinaryVoices[p] = undefined;
      }
    }
    for (const p of roster) if (ordinaryVoices[p] !== undefined) lastSounding[p] = bar;

    // the ordinary line is the base; the wind lead takes the tune on its
    // bars (one soloist; the strings drop to pad — the brass-lead
    // mechanism), and the MOMENT overrides run last: a moment still wins
    // over the lead (the renderer ghost-runs the ordinary kind to keep its
    // state; the lead's fresh-phrase notes simply skip the bar)
    for (const p of roster) voices[p] = ordinaryVoices[p];
    const lead = leadByBar.get(bar);
    if (lead) voices[lead.part] = 'lead';
    if (moment?.kind === 'tutti') {
      for (const p of roster) voices[p] = 'tutti';
    } else if (moment?.kind === 'unison') {
      for (const p of roster) voices[p] = undefined;
      // §14.7: flutes and oboes join an octave above, bassoons with the
      // cellos — only where D2 allows (the clarinets rest)
      if (d2ok) {
        if (roster.includes('flutes')) voices.flutes = 'unison';
        if (roster.includes('oboes')) voices.oboes = 'unison';
        if (roster.includes('bassoons')) voices.bassoons = 'unison';
      }
    } else if (moment?.kind === 'soli') {
      // one voice alone: the wind when it carries the soli, silence otherwise
      for (const p of roster) voices[p] = undefined;
      if (soloCarrierPart && moment.carrierTrackId) {
        const t = windTrackOf(ctx, soloCarrierPart);
        if (t && t.id === moment.carrierTrackId) voices[soloCarrierPart] = 'soli';
      }
    }

    barPlans.push({
      bar, level, norm, voices, ordinary: ordinaryVoices,
      ...(moment ? { moment: moment.kind as 'tutti' | 'unison' | 'soli' } : {}),
    });
  }

  const kindLabel = (b: WindBarPlan): string =>
    (Object.entries(b.voices) as [WindPart, WindVoiceKind | undefined][])
      .filter(([, k]) => k !== undefined)
      .map(([p, k]) => `${p}:${k}`)
      .join(',') || 'rest';
  reports.push(`winds (take ${take}): gates 0.30/0.50/0.72/0.90 of clamp ${clampMax}, chorus relief upper winds ≥0.30 + bassoon follows cellos; lead ${leads.map((l) => `${l.startBar}-${l.endBar}:${l.part}`).join(',') || 'none'}; doubles ${Object.entries(leadDoubleByType).map(([k, d]) => `${k}=${d.part ?? 'none'}/${d.mode}`).join(' ')}; pickup runs ${pickupRuns.map((r) => `b${r.bar}:${r.part}`).join(',') || 'none'}; flutter ${Object.entries(flutterBars).map(([p, bars2]) => `${p}:${(bars2 ?? []).join('/')}`).join(' ') || 'none'}`);
  const firstBars = barPlans.filter((b) => Object.values(b.voices).some((v) => v !== undefined)).slice(0, 12);
  if (firstBars.length) reports.push(`winds plan (take ${take}): ${firstBars.map((b) => `b${b.bar}[${b.level}] ${kindLabel(b)}`).join(' | ')}`);

  return { bars: barPlans, leads, leadDoubleByType, pickupRuns, flutterBars, reports };
}

/** The wind that joins the soli carrier pool (§14.7): the first rostered of
 *  oboes, clarinets, flutes — the same track the moments' pool gains. */
export function soloCarrierWindOf(ctx: OrchestratorContext, roster?: WindPart[]): WindPart | null {
  const r = roster ?? WIND_PARTS.filter((p) => windTrackOf(ctx, p) !== null);
  for (const p of ['oboes', 'clarinets', 'flutes'] as WindPart[]) {
    if (r.includes(p) && windTrackOf(ctx, p) !== null) return p;
  }
  return null;
}
