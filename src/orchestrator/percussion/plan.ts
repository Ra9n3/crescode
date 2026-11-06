/**
 * Percussion planner (Phase 10, spec §15). Runs at the CONDUCTOR level,
 * after the winds: per bar it reads the arc target as a fraction of the
 * clamp max, gates the kit (low/mid/high/peak, §15.5) and assigns each
 * rostered percussion part at most one voice kind. Its draws ride ONE
 * salted D8 stream — `hashString('percussion')` over the (inputs, take)
 * seed — so the texture draws, the moments, the brass, the winds and every
 * existing draw are untouched byte-for-byte.
 *
 * Draw order (fixed, moments-INDEPENDENT — the Phase 8 draw-identity pin):
 * 1) the final-bar timpani hit (weighted 0.5), 2) the chorus-type entries in
 * bar order — per entry: the crash draw (the peak chorus is forced), the
 * cymbal swell draw, the timpani roll draw (chance, then length), the snare
 * roll draw, with the crash budget kept among the entries themselves — 3)
 * the tutti moments in bar order — the crash (unconditional, subject to the
 * same budget), the snare roll draw, the timpani roll draw. With the moments
 * off, step 3 vanishes and steps 1–2 are byte-identical, so every crash,
 * swell and roll outside moment bars is identical with and without them.
 * Everything else is deterministic reading: the gates, the textures' drawn
 * cell grids, the entrance rule and the near-silence bars consult no
 * randomness.
 *
 * Tacets (§15.6): the near-silence bar silences the kit (the plan's own
 * reading — it is moments-independent by construction). A soli-covered bar
 * silences the kit at the PLAN's voice map (the tests read it there) and at
 * the RENDERER (damping keeps the hits from RINGING across it) — but the
 * soli never feeds the DRAWS or the entrance chain, which stay
 * moments-independent (the soli ghost-advances the entrance tracker). The
 * final bar is no crash/roll territory but not a tacet: a drawn closing
 * timpani hit sounds there (the landing bar must still sound). Chorus
 * relief (§15.4): inside a chorus-type section the mid kit sounds from the
 * section's FIRST bar at the mid gate — no entrance rule, no enter-after
 * delay (the Phase 8.3 lesson). Elsewhere the continuing pulses keep the
 * house entrance rule; the structural downbeat support and the planned
 * hits are exempt.
 *
 * Chorus drive (Phase 10.1, §15.4): inside a chorus-type section at the mid
 * gate and above, the kit's chorus line is TEXTURE-INDEPENDENT — the
 * timpani lands its root on every bar downbeat wherever the drawn pulse
 * does not already (plus the optional fifth on the half bar at the high
 * gate; never faster than quarters outside rolls), the snare plays the
 * backbeat-style hit at the high gate where the fuller cell does not, and
 * the aux plays the sparse off-beat at the high gate where the full
 * off-beat does not. The drive never sounds during a soli, a near-silence
 * bar or the PRE-CHORUS bar (the bar before a chorus entry) — the prepared
 * entry: that bar is a full percussion tacet, swells and roll starts
 * included (a roll's ending hit still lands on the entry downbeat). The
 * crash budget is untouched.
 */
import { mulberry32, hashString } from '../../engine/generate';
import { orchestrationSeedFor, type SpineSection } from '../spine';
import { barTicks, projectBars } from '../../shared/schema/meter';
import type { Project } from '../../shared/schema/types';
import { sectionTypeNameAtBar, textureForType } from '../conductor/layers';
import type { OrchestratorContext } from '../module';
import { momentForBar } from '../conductor/moments';
import {
  CELL_TEXTURES, AUX_TEXTURES, CRASH_WEIGHTS, CYMBAL_SWELL_CHANCE, FINAL_TIMPANI_WEIGHTS, PERC_GATES,
  PERC_PARTS, SNARE_ROLL_CHANCE, TIMPANI_ROLL_CHANCE, isChorusTypeP, levelForNormP, percRosterOf, percTrackOf,
  type PercLevel, type PercPart,
} from './profile';

export type PercVoiceKind =
  | 'support' | 'pulse' | 'roll' | 'tutti' | 'final'
  | 'drive' | 'cellLight' | 'cellFull' | 'backbeat' | 'grid' | 'crash' | 'swell' | 'offbeat';

export interface PercBarPlan {
  bar: number;
  level: PercLevel;
  /** The arc target over the clamp max this bar. */
  norm: number;
  voices: Partial<Record<PercPart, PercVoiceKind>>;
  /** The kinds the gates + the entrance rule produced BEFORE the moment
   *  overrides and the soli deletion — the ordinary line the renderer
   *  ghost-runs through moment bars so the timpani's pitch walk (the
   *  nearest-candidate rule) stays byte-identical with and without the
   *  moments (the draw-identity pin). */
  ordinary: Partial<Record<PercPart, PercVoiceKind>>;
  /** The moment covering the bar, when it drives the percussion kinds. */
  moment?: 'tutti' | 'soli';
}

export interface PercRoll {
  part: 'timpani' | 'snare';
  /** The first bar of the roll (the roll's 16ths start here). */
  startBar: number;
  /** The bar whose downbeat the roll lands on (a chorus entry or a tutti). */
  targetBar: number;
  /** The roll's length in bars (timpani 1–2, snare 1). */
  bars: number;
  startTick: number;
  targetTick: number;
}

export interface PercCrash {
  bar: number;
  source: 'chorusEntry' | 'tutti';
  /** True when a one-bar swell precedes the crash. */
  swell: boolean;
}

export interface PercPlan {
  bars: PercBarPlan[];
  rolls: PercRoll[];
  crashes: PercCrash[];
  /** The drawn closing timpani hit on the final bar. */
  finalTimpani: boolean;
  reports: string[];
}

/** The empty plan (no template / no percussion roster): the module is silent. */
export const EMPTY_PERC_PLAN: PercPlan = { bars: [], rolls: [], crashes: [], finalTimpani: false, reports: [] };

/** The salted percussion stream (D8): a pure function of (inputs, take). */
export const percRng = (project: Project, take: number): (() => number) =>
  mulberry32((orchestrationSeedFor(project, { take }) ^ Math.imul(hashString('percussion'), 0x85ebca6b)) >>> 0);

/**
 * Plans the take's percussion. Pure: same context → same plan. Runs at the
 * conductor level (after the winds); the renderer realises it after the
 * winds renderer so the velocity math sees every other family's notes.
 */
export function planPercussion(ctx: OrchestratorContext): PercPlan {
  const { project, template, sections, arc } = ctx;
  const moments = ctx.moments ?? [];
  const take = project.orchestration?.take ?? 0;
  const reports: string[] = [];
  if (!template || !arc?.length) return EMPTY_PERC_PLAN;
  const clampMax = template.budget.energyClamp[1];
  const roster = percRosterOf(ctx);
  if (!roster.length) return EMPTY_PERC_PLAN;

  const rng = percRng(project, take);
  const bars = projectBars(project);
  const btBar = barTicks(project.timeSignature);
  const nearSilenceBars = new Set<number>();
  for (const a of arc) if (a.nearSilence) nearSilenceBars.add(a.bar);
  const soliBars = new Set<number>();
  for (const m of moments) {
    if (m.kind !== 'soli') continue;
    for (let b = m.startBar; b <= m.endBar; b++) soliBars.add(b);
  }
  /** A tacet bar: the kit is fully silent (§15.6). The final bar is NOT one.
   *  Solis never feed the DRAWS — only the voice map and the renderer. */
  const nearSilence = (bar: number): boolean => nearSilenceBars.has(bar);

  const chorusSecs = [...sections].sort((a, b) => a.startBar - b.startBar).filter((s) => isChorusTypeP(s.name));
  const peakChorus = chorusSecs[chorusSecs.length - 1];
  const firstChorus = chorusSecs[0];
  // the pre-chorus bars (Phase 10.1): the bar before a chorus-type entry — a
  // full percussion tacet so the entry stays prepared (contiguous chorus
  // sections have no bar between them)
  const preChorusBars = new Set<number>();
  for (const sec of chorusSecs) {
    const b = sec.startBar - 1;
    if (b < 1) continue;
    const secBefore = sections.find((s) => b >= s.startBar && b < s.startBar + s.lengthBars);
    if (secBefore && isChorusTypeP(secBefore.name)) continue;
    preChorusBars.add(b);
  }

  // ---- the draws (moments-INDEPENDENT order: the chorus entries first) ----
  const finalTimpani = roster.includes('timpani') && rng() >= FINAL_TIMPANI_WEIGHTS.none;
  const crashes: PercCrash[] = [];
  const rolls: PercRoll[] = [];
  let lastCrashBar = -Infinity;
  const crashSectionOf = (bar: number): SpineSection | undefined => sections.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
  // step 2: the chorus-type entries, in bar order — the crash draw (the
  // peak chorus is forced), the swell draw, the timpani roll, the snare
  // roll; the budget is kept among the entries themselves
  for (const sec of chorusSecs) {
    const bar = sec.startBar;
    if (bar <= 1 || bar > bars) continue;
    const peak = peakChorus !== undefined && sec.id === peakChorus.id;
    const first = firstChorus !== undefined && sec.id === firstChorus.id;
    const weight = peak ? CRASH_WEIGHTS.peakChorus : first ? CRASH_WEIGHTS.firstChorus : CRASH_WEIGHTS.otherChorus;
    if (!peak && rng() >= weight) continue; // the peak chorus is forced (no draw consumed either way)
    if (nearSilence(bar)) continue;
    if (bar - lastCrashBar < 4) continue; // never two crashes within 4 bars
    if (crashes.some((c) => crashSectionOf(c.bar)?.id === sec.id)) continue; // at most one per section
    // every crash is preceded by a strictly lower-energy bar (§15.4)
    if (bar < 2 || !((arc[bar - 2]?.target ?? 0) < (arc[bar - 1]?.target ?? 0))) continue;
    lastCrashBar = bar;
    // the swell draw (the bar before the crash, off the near-silence bars;
    // the draw stream is Phase 10's — the pre-chorus tacet eats the swell's
    // NOTE at the voice map, not the draw)
    let swell = false;
    const swellBar = bar - 1;
    if (roster.includes('cymbals') && swellBar >= 1 && !nearSilence(swellBar) && rng() < CYMBAL_SWELL_CHANCE) swell = true;
    crashes.push({ bar, source: 'chorusEntry', swell });
    // the timpani roll into the entry: 1–2 bars, the target at the mid gate
    if (roster.includes('timpani') && (arc[bar - 1]?.target ?? 0) / clampMax >= PERC_GATES.mid) {
      if (rng() < TIMPANI_ROLL_CHANCE) {
        const len = rng() < 0.5 ? 1 : 2;
        const startBar = bar - len;
        const free = startBar >= 1 && Array.from({ length: len }, (_, i) => startBar + i).every((b) => !nearSilence(b));
        if (free) rolls.push({ part: 'timpani', startBar, targetBar: bar, bars: len, startTick: (startBar - 1) * btBar, targetTick: (bar - 1) * btBar });
      }
    }
    // the snare roll into the entry: at most 1 bar, the target at the high gate
    if (roster.includes('snare') && (arc[bar - 1]?.target ?? 0) / clampMax >= PERC_GATES.high) {
      if (rng() < SNARE_ROLL_CHANCE) {
        const startBar = bar - 1;
        if (startBar >= 1 && !nearSilence(startBar)) rolls.push({ part: 'snare', startBar, targetBar: bar, bars: 1, startTick: (startBar - 1) * btBar, targetTick: (bar - 1) * btBar });
      }
    }
  }
  // step 3: the tutti moments, in bar order — with the moments off this
  // whole pass vanishes and steps 1–2 stay byte-identical
  const tuttiMoments = moments.filter((m) => m.kind === 'tutti').sort((a, b) => a.startBar - b.startBar);
  for (const m of tuttiMoments) {
    const bar = m.startBar;
    if (bar < 2 || bar > bars || nearSilence(bar)) continue;
    if (bar - lastCrashBar >= 4 && roster.includes('cymbals') && !crashes.some((c) => c.bar === bar)) {
      const sec = crashSectionOf(bar);
      if (!(sec && crashes.some((c) => crashSectionOf(c.bar)?.id === sec.id))) {
        lastCrashBar = bar;
        crashes.push({ bar, source: 'tutti', swell: false });
      }
    }
    if (roster.includes('snare') && (arc[bar - 1]?.target ?? 0) / clampMax >= PERC_GATES.high) {
      if (rng() < SNARE_ROLL_CHANCE) {
        const startBar = bar - 1;
        if (startBar >= 1 && !nearSilence(startBar)) rolls.push({ part: 'snare', startBar, targetBar: bar, bars: 1, startTick: (startBar - 1) * btBar, targetTick: (bar - 1) * btBar });
      }
    }
    if (roster.includes('timpani') && (arc[bar - 1]?.target ?? 0) / clampMax >= PERC_GATES.mid) {
      if (rng() < TIMPANI_ROLL_CHANCE) {
        const len = rng() < 0.5 ? 1 : 2;
        const startBar = bar - len;
        const free = startBar >= 1 && Array.from({ length: len }, (_, i) => startBar + i).every((b) => !nearSilence(b));
        if (free) rolls.push({ part: 'timpani', startBar, targetBar: bar, bars: len, startTick: (startBar - 1) * btBar, targetTick: (bar - 1) * btBar });
      }
    }
  }

  // ---- the per-bar kinds ----
  const rollByBarPart = new Map<string, PercRoll>();
  for (const r of rolls) {
    for (let b = r.startBar; b < r.targetBar; b++) rollByBarPart.set(`${b}:${r.part}`, r);
  }
  const crashByBar = new Map<number, PercCrash>(crashes.map((c) => [c.bar, c]));

  const barPlans: PercBarPlan[] = [];
  const lastSounding: Partial<Record<PercPart, number>> = {};
  for (let bar = 1; bar <= bars; bar++) {
    const target = arc[bar - 1]?.target ?? 0;
    const norm = clampMax > 0 ? target / clampMax : 0;
    const level: PercLevel = levelForNormP(norm);
    const voices: Partial<Record<PercPart, PercVoiceKind>> = {};
    const ordinaryVoices: Partial<Record<PercPart, PercVoiceKind>> = {};
    const secHere = sections.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
    const inChorus = isChorusTypeP(secHere?.name);
    const tex = textureForType(ctx, sectionTypeNameAtBar(ctx, bar));
    const moment = momentForBar(moments, bar);
    const isSoli = soliBars.has(bar);
    const isNearSilence = nearSilenceBars.has(bar);
    const isPreChorus = preChorusBars.has(bar);

    if (!nearSilence(bar) && !isPreChorus) {
      // the house entrance rule for the continuing pulses (§15.4): a part's
      // first bar after a silent bar follows a strictly lower-energy bar;
      // inside a chorus the relief engages the kit from the FIRST bar
      const entranceOk = (p: PercPart): boolean => {
        if (inChorus) return true;
        if (lastSounding[p] === bar - 1) return true; // continuous, not an entrance
        if (bar < 2) return false; // bar 1 never enters a continuing pulse
        return (arc[bar - 2]?.target ?? 0) < (arc[bar - 1]?.target ?? 0);
      };
      // the section's phrase starts (§15.4): the first bar and every 4th bar
      const secStart = secHere?.startBar ?? 1;
      const phraseStart = bar === secStart || (bar - secStart) % 4 === 0;

      // timpani
      if (roster.includes('timpani')) {
        if (rollByBarPart.has(`${bar}:timpani`)) voices.timpani = 'roll';
        // the chorus drive (Phase 10.1): the root on every bar downbeat —
        // texture-independent (the drawn pulse's anchor yields to it); the
        // renderer rings the root and adds the optional half-bar fifth at
        // the high gate (never faster than quarters outside rolls)
        else if (inChorus && norm >= PERC_GATES.mid) voices.timpani = 'drive';
        else if (CELL_TEXTURES.has(tex.id) && norm >= PERC_GATES.mid && entranceOk('timpani')) voices.timpani = 'pulse';
        else if (phraseStart && norm >= PERC_GATES.low) voices.timpani = 'support';
      }
      // snare: the chorus drive's backbeat-style hit from the mid gate up
      // (the block's gate — texture-independent, Phase 10.1); on a kit
      // WITHOUT the timpani the snare carries the kit's quarter grid (the
      // downbeat and beat 3 included, plain) so every chorus window keeps a
      // fresh hit. Outside the chorus the §15.4 texture rules stand.
      if (roster.includes('snare')) {
        if (rollByBarPart.has(`${bar}:snare`)) voices.snare = 'roll';
        else if (inChorus && norm >= PERC_GATES.mid) voices.snare = roster.includes('timpani') ? 'backbeat' : 'grid';
        else if (CELL_TEXTURES.has(tex.id) && norm >= PERC_GATES.high && entranceOk('snare')) voices.snare = 'cellFull';
        else if (CELL_TEXTURES.has(tex.id) && norm >= PERC_GATES.mid && entranceOk('snare')) voices.snare = 'cellLight';
      }
      // aux: the sparse off-beat line (the off-beat eighths — one per beat
      // window) is the chorus drive's aux voice from the mid gate up,
      // regardless of the drawn texture (Phase 10.1); elsewhere its §15.4
      // texture rule stands
      if (roster.includes('aux')) {
        if (inChorus && norm >= PERC_GATES.mid) voices.aux = 'offbeat';
        else if (AUX_TEXTURES.has(tex.id) && norm >= PERC_GATES.mid && entranceOk('aux')) voices.aux = 'offbeat';
      }
      // cymbals
      if (roster.includes('cymbals')) {
        if (crashByBar.has(bar)) voices.cymbals = 'crash';
        else if (crashes.some((c) => c.swell && c.bar === bar + 1)) voices.cymbals = 'swell';
      }
    }
    // the ordinary line is the base (the renderer ghost-runs it through the
    // moment bars so the timpani's pitch walk stays moments-independent)
    for (const p of PERC_PARTS) ordinaryVoices[p] = voices[p];

    // the moments run last: the tutti hit + crash; a soli, the near-silence
    // bar or the pre-chorus bar silences the kit entirely (§15.6; the
    // pre-chorus tacet is Phase 10.1's prepared entry). The soli's
    // deletion is a plan-map read only — the entrance tracker GHOSTS through
    // it (the tracker below advances as if the kit had sounded), so the
    // entrance chain stays byte-identical with and without the moments.
    const ghostBars = new Set<PercPart>();
    if (isSoli || isNearSilence || isPreChorus) {
      for (const p of PERC_PARTS) {
        if (voices[p] !== undefined) ghostBars.add(p);
        delete voices[p];
      }
      // the soli would also have silenced a drawn crash/swell's kind — the
      // ghost keeps the entrance chain continuous across it
      if (roster.includes('cymbals') && (crashByBar.has(bar) || crashes.some((c) => c.swell && c.bar === bar + 1))) ghostBars.add('cymbals');
      if (roster.includes('timpani') && rollByBarPart.has(`${bar}:timpani`)) ghostBars.add('timpani');
      if (roster.includes('snare') && rollByBarPart.has(`${bar}:snare`)) ghostBars.add('snare');
    } else if (moment?.kind === 'tutti') {
      if (roster.includes('timpani')) voices.timpani = 'tutti';
      if (roster.includes('cymbals') && !crashByBar.has(bar)) voices.cymbals = 'crash';
      delete voices.snare;
      delete voices.aux;
    }

    // the final bar's closing hit (the draw above; the landing bar sounds)
    if (bar === bars && finalTimpani && roster.includes('timpani') && !isSoli) voices.timpani = 'final';

    // the entrance tracker: real sounding bars advance it; a soli-ghosted
    // part advances too (the kit "would have sounded" — the moments must
    // never move a later entrance)
    for (const p of PERC_PARTS) {
      if (voices[p] !== undefined || ghostBars.has(p)) lastSounding[p] = bar;
    }

    barPlans.push({
      bar, level, norm, voices, ordinary: ordinaryVoices,
      ...(moment?.kind === 'tutti' && !isSoli && !isPreChorus ? { moment: 'tutti' as const } : isSoli && moment?.kind === 'soli' ? { moment: 'soli' as const } : {}),
    });
  }

  reports.push(`percussion (take ${take}): gates 0.30/0.50/0.72/0.90 of clamp ${clampMax}, chorus relief mid kit from the first chorus bar, chorus drive (root downbeats + high half-fifths, backbeats / grid, off-beat eighths at the high gate's level), pre-chorus tacet; crashes ${crashes.map((c) => `b${c.bar}:${c.source}${c.swell ? '+swell' : ''}`).join(',') || 'none'}; rolls ${rolls.map((r) => `b${r.startBar}-${r.targetBar}:${r.part}`).join(',') || 'none'}; final timpani ${finalTimpani ? 'hit' : 'none'}`);
  const firstBars = barPlans.filter((b) => Object.values(b.voices).some((v) => v !== undefined)).slice(0, 12);
  if (firstBars.length) reports.push(`percussion plan (take ${take}): ${firstBars.map((b) => `b${b.bar}[${b.level}] ${Object.entries(b.voices).map(([p, k]) => `${p}:${k}`).join(',')}`).join(' | ')}`);

  return { bars: barPlans, rolls, crashes, finalTimpani, reports };
}

/** The percussion tracks the plan annotates (the conductor's honesty list). */
export function percPlannedRoles(ctx: OrchestratorContext): PercPart[] {
  if (!ctx.template) return [];
  return PERC_PARTS.filter((p) => percTrackOf(ctx, p) !== null);
}
