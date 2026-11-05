/**
 * Brass planner (Phase 8, spec §13). Runs at the CONDUCTOR level, after the
 * moments: per bar it reads the arc target as a fraction of the clamp max,
 * gates the choir (low/mid/high/peak), and assigns each rostered brass part
 * at most one voice kind. Its draws ride ONE salted D8 stream —
 * `hashString('brass')` over the (inputs, take) seed — so the texture draws,
 * the moments stream and every existing draw are untouched byte-for-byte.
 *
 * Draw order (fixed): 1) the brass lead (peak only, rare, weighted), 2) the
 * trumpets' HIGH+ role per section type. Everything else is deterministic
 * reading: the gates, the moment overrides, the entrance rule and the
 * trailer-texture switch consult no randomness.
 *
 * Entrance rule (§13.3): a part's first bar after a fully silent bar must
 * follow a strictly lower-energy bar (the bar before the entrance is lower
 * than the entrance bar). Bar 1 never carries ordinary brass — the piece
 * opens with the strings. Moment kinds (tutti/unison/soli) and the brass
 * lead are exempt: each carries its own placement contract from its planner.
 */
import { mulberry32, hashString } from '../../engine/generate';
import { orchestrationSeedFor, peakSectionOf, ticksToSeconds, type ArcBar, type SpineSection } from '../spine';
import { barTicks, projectBars } from '../../shared/schema/meter';
import type { Project } from '../../shared/schema/types';
import type { EnsembleTemplate } from '../../shared/schema/ensembleTemplate';
import { freshEnsemble } from '../../shared/schema/band';
import { drawWeighted, sectionTypeNameAtBar, textureForType } from '../conductor/layers';
import type { OrchestratorContext } from '../module';
import {
  BRASS_LEAD_WEIGHTS, BRASS_PROFILES, TRUMPET_ROLE_WEIGHTS, brassTrackOf,
  levelForNorm, type BrassLevel, type BrassPart, type TrumpetRole,
} from './profile';

export type BrassVoiceKind =
  | 'pad' | 'guide' | 'lowDouble' | 'fanfare' | 'stab' | 'swell'
  | 'ostinato' | 'lead' | 'leadDouble' | 'tutti' | 'unison' | 'soli';

export interface BrassBarPlan {
  bar: number;
  level: BrassLevel;
  /** The arc target over the clamp max this bar. */
  norm: number;
  voices: Partial<Record<BrassPart, BrassVoiceKind>>;
  /** The kinds the level gates + the entrance rule produced BEFORE the
   *  moment overrides — the ordinary line the renderer ghost-runs through
   *  moment bars so its cap/voice-leading state stays moment-independent. */
  ordinary: Partial<Record<BrassPart, BrassVoiceKind>>;
  /** The moment covering the bar, when it drives the brass kinds. */
  moment?: 'tutti' | 'unison' | 'soli';
}

export interface BrassLeadSpan {
  startBar: number;
  endBar: number;
  startTick: number;
  endTick: number;
}

export interface BrassPlan {
  bars: BrassBarPlan[];
  leads: BrassLeadSpan[];
  /** The drawn trumpets' role per section-type key (HIGH+ bars read it). */
  trumpetRoleByType: Record<string, TrumpetRole>;
  reports: string[];
}

/** The empty plan (no template / no brass roster): the module is silent. */
export const EMPTY_BRASS_PLAN: BrassPlan = { bars: [], leads: [], trumpetRoleByType: {}, reports: [] };

/** The salted brass stream (D8): a pure function of (inputs, take). */
export const brassRng = (project: Project, take: number): (() => number) =>
  mulberry32((orchestrationSeedFor(project, { take }) ^ Math.imul(hashString('brass'), 0x85ebca6b)) >>> 0);

const secTypeKey = (name: string): string => name.trim().toLowerCase() || '*';

const doublingAllowed = (template: EnsembleTemplate): boolean =>
  (template.rules.find((r) => r.type === 'octaveDoubling')?.params as { policy?: string } | undefined)?.policy === 'allowed';

/**
 * The brass lead spans (§13.5): peak only, rare (weighted 0.65 none / 0.35
 * one per piece), 2–4 bars capped by the trumpet phrase cap, placed on the
 * peak section's PEAK-gate bars where a strictly lower-energy bar precedes,
 * never on the near-silence or final bar. INDEPENDENT of the moments: the
 * conductor plans the lead BEFORE the moments and the moments avoid its
 * bars — so the strings' suppression on lead bars is identical with and
 * without them (the draw-identity pin). Pure: the conductor calls this for
 * the strings' suppression and the planner calls it again — identical
 * inputs, identical spans.
 */
export function planBrassLeads(
  project: Project, template: EnsembleTemplate | null, sections: SpineSection[],
  arc: ArcBar[], rng: () => number,
): BrassLeadSpan[] {
  const out: BrassLeadSpan[] = [];
  if (!template || !arc.length || !sections.length) return out;
  if (!brassTrackOf({ project, ensemble: project.ensemble ?? freshEnsemble(), template }, 'trumpets')) return out;
  const btBar = barTicks(project.timeSignature);
  const clampMax = template.budget.energyClamp[1];
  const noGo = new Set<number>([projectBars(project)]); // the final bar always sounds untouched
  for (const a of arc) if (a.nearSilence) noGo.add(a.bar);
  const peak = peakSectionOf(sections);
  if (!peak) return out;

  if (rng() >= BRASS_LEAD_WEIGHTS.none) {
    const candidates: number[] = [];
    for (let b = peak.startBar; b < peak.startBar + peak.lengthBars && b <= arc.length; b++) {
      const norm = (arc[b - 1]?.target ?? 0) / clampMax;
      if (norm < 0.9) continue; // the lead lives at the peak gate, never below
      if (noGo.has(b)) continue;
      if (b < 2 || (arc[b - 2]?.target ?? 0) >= (arc[b - 1]?.target ?? 0)) continue; // entrance rule
      candidates.push(b);
    }
    if (candidates.length) {
      const startBar = candidates[Math.floor(rng() * candidates.length)];
      const secPerBar = ticksToSeconds(barTicks(project.timeSignature), project.tempoMap);
      const capBars = Math.max(2, Math.min(4, Math.floor(BRASS_PROFILES.trumpets.phraseCapSec / Math.max(0.01, secPerBar))));
      const peakEnd = peak.startBar + peak.lengthBars - 1;
      const endBar = Math.min(peakEnd, projectBars(project) - 1, startBar + capBars - 1);
      if (endBar > startBar) {
        out.push({ startBar, endBar, startTick: (startBar - 1) * btBar, endTick: (endBar + 1) * btBar });
      }
    }
  }
  return out;
}

/**
 * Plans the take's brass. Pure: same context → same plan. Runs at the
 * conductor level (after the moments); the renderer realises it after the
 * rules generator so the velocity math sees every other family's notes.
 */
export function planBrass(ctx: OrchestratorContext): BrassPlan {
  const { project, template, sections, arc } = ctx;
  const moments = ctx.moments ?? [];
  const take = project.orchestration?.take ?? 0;
  const reports: string[] = [];
  if (!template || !arc?.length) return { bars: [], leads: [], trumpetRoleByType: {}, reports };
  const clampMax = template.budget.energyClamp[1];
  const roster = (['horns', 'trumpets', 'trombones', 'tuba'] as BrassPart[]).filter(
    (p) => brassTrackOf(ctx, p) !== null,
  );
  if (!roster.length) return { bars: [], leads: [], trumpetRoleByType: {}, reports };

  const rng = brassRng(project, take);
  const leads = planBrassLeads(project, template, sections, arc, rng);

  // the trumpets' HIGH+ role, one draw per section type (first-occurrence order)
  const trumpetRoleByType: Record<string, TrumpetRole> = {};
  if (roster.includes('trumpets')) {
    for (const sec of sections) {
      const key = secTypeKey(sec.name);
      if (trumpetRoleByType[key] === undefined) trumpetRoleByType[key] = drawWeighted(rng, TRUMPET_ROLE_WEIGHTS);
    }
  }

  const bars = projectBars(project);
  const hornTrackId = brassTrackOf(ctx, 'horns')?.id ?? null;
  const d2ok = doublingAllowed(template);
  const leadByBar = new Map<number, BrassLeadSpan>();
  for (const l of leads) for (let b = l.startBar; b <= l.endBar; b++) leadByBar.set(b, l);

  const barPlans: BrassBarPlan[] = [];
  const lastSounding: Partial<Record<BrassPart, number>> = {};
  for (let bar = 1; bar <= bars; bar++) {
    const target = arc[bar - 1]?.target ?? 0;
    const norm = clampMax > 0 ? target / clampMax : 0;
    const level: BrassLevel = levelForNorm(norm);
    const voices: Partial<Record<BrassPart, BrassVoiceKind>> = {};
    const ordinaryVoices: Partial<Record<BrassPart, BrassVoiceKind>> = {};
    const secHere = sections.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
    const typeKey = secTypeKey(secHere?.name ?? '*');
    const isTrailer = textureForType(ctx, sectionTypeNameAtBar(ctx, bar)).id === 'trailer';
    const moment = moments.find(
      (m) => bar >= m.startBar && bar <= m.endBar && (m.kind === 'tutti' || m.kind === 'unison' || m.kind === 'soli'),
    );

    // --- ordinary level roles (§13.3/§13.4): one voice per part ---
    const ordinary = (p: BrassPart): BrassVoiceKind | undefined => {
      if (level === 'off') return undefined;
      if (p === 'horns') return isTrailer ? 'ostinato' : 'pad';
      if (p === 'trombones') {
        if (level === 'low') return undefined;
        if (isTrailer) return 'guide'; // trombones never take the ostinato cell
        return level === 'high' || level === 'peak' ? 'lowDouble' : 'guide';
      }
      if (p === 'trumpets') {
        if (level === 'low' || level === 'mid') return undefined;
        if (isTrailer) return 'ostinato';
        return trumpetRoleByType[typeKey] ?? 'fanfare';
      }
      if (p === 'tuba') return level === 'peak' ? 'lowDouble' : undefined;
      return undefined;
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
        // entrance: the bar before must be strictly lower-energy than this one
        if (!((arc[bar - 2]?.target ?? 0) < (arc[bar - 1]?.target ?? 0))) ordinaryVoices[p] = undefined;
      }
    }
    for (const p of roster) if (ordinaryVoices[p] !== undefined) lastSounding[p] = bar;

    // the ordinary line is the base; the moments replace its OUTPUT on their
    // bars (the renderer ghost-runs the ordinary kind to keep its state)
    for (const p of roster) voices[p] = ordinaryVoices[p];
    if (moment?.kind === 'tutti') {
      for (const p of roster) voices[p] = 'tutti';
    } else if (moment?.kind === 'unison') {
      if (roster.includes('horns') && d2ok) voices.horns = 'unison'; // joins at the octave only where D2 allows
    } else if (moment?.kind === 'soli') {
      // one voice alone: the horn when it carries the soli, silence otherwise
      for (const p of roster) voices[p] = undefined;
      if (hornTrackId && moment.carrierTrackId === hornTrackId) voices.horns = 'soli';
    }

    // --- the brass lead (peak): trumpets lead, horns double at the octave ---
    const lead = leadByBar.get(bar);
    if (lead) {
      if (roster.includes('trumpets')) voices.trumpets = 'lead';
      if (roster.includes('horns') && d2ok) voices.horns = 'leadDouble';
    }

    barPlans.push({
      bar, level, norm, voices, ordinary: ordinaryVoices,
      ...(moment ? { moment: moment.kind as 'tutti' | 'unison' | 'soli' } : {}),
    });
  }

  const kindLabel = (b: BrassBarPlan): string =>
    (Object.entries(b.voices) as [BrassPart, BrassVoiceKind | undefined][])
      .filter(([, k]) => k !== undefined)
      .map(([p, k]) => `${p}:${k}`)
      .join(',') || 'rest';
  reports.push(`brass (take ${take}): gates 0.30/0.55/0.75/0.90 of clamp ${clampMax}; lead ${leads.map((l) => `${l.startBar}-${l.endBar}`).join(',') || 'none'}`);
  const firstBars = barPlans.filter((b) => Object.values(b.voices).some((v) => v !== undefined)).slice(0, 12);
  if (firstBars.length) reports.push(`brass plan (take ${take}): ${firstBars.map((b) => `b${b.bar}[${b.level}] ${kindLabel(b)}`).join(' | ')}`);

  return { bars: barPlans, leads, trumpetRoleByType, reports };
}
