/**
 * Keys planner (Phase 11, spec §16). Runs at the CONDUCTOR level, after the
 * percussion: per bar it reads the arc target as a fraction of the clamp max,
 * gates the keys (low/mid/high/peak, §16.4) and assigns each rostered keys
 * part at most ONE voice kind. Its draws ride ONE salted D8 stream —
 * `hashString('keys')` over the (inputs, take) seed — so the texture draws,
 * the moments, the brass, the winds, the percussion and every existing draw
 * are untouched byte-for-byte.
 *
 * Draw order (fixed; the moment-dependent draw rides the LAST pass so a
 * moments-off run consumes an identical prefix — the Phase 8 draw-identity
 * pin): 1) the arpeggiator draw, one per SECTION TYPE where BOTH parts are
 * rostered (all sections of a type stay coherent, exactly like the texture
 * draws — never both harp and piano arp in one section, §16.3), 2) the
 * chorus-entry glissandos in bar order, 3) the outro/resolution glissando
 * (descending, into the first outro-like section's downbeat), 4) the tutti
 * moments in bar order — the glissando into the tutti downbeat (weighted;
 * the piano's tutti root hit is the moment's own gesture, no draw).
 * Glissandos share the piece-wide budget of 2 (§16.2); every run checks its
 * crossing bars free of near-silence — a soli covering a crossing bar
 * deletes the kind at the voice map below (the draws themselves never read
 * the moments).
 *
 * Gating (§16.4, fractions of the clamp max — reported): off < 0.30; LOW
 * ≥ 0.30 (the harp bed, soft; the piano's comping at phrase starts); MID
 * ≥ 0.50 (the arpeggiators' main zone); HIGH ≥ 0.72 (the harp thins to
 * glissandos or rests outside a chorus — it is buried under a tutti; the
 * piano's low octave pulse in ostinato/trailer textures); PEAK ≥ 0.90
 * (harp tacet except a glissando; the piano's pulse and tutti hit only).
 * CHORUS RELIEF (the 8.3/10 lesson — a chorus must not get thinner): inside
 * a chorus-type section the keys sound from the section's FIRST bar at the
 * LOW gate — the drawn arpeggiator keeps its figure, the comping rides
 * every bar downbeat, the bed keeps ringing — no entrance rule, no
 * thin-to-rests. Tacets: a soli, a near-silence bar and a unison moment
 * (the keys do not join) silence both parts; a tutti moment reduces the
 * harp to its drawn glissando and the piano to the root hit. The final bar
 * is never a tacet: the closing figure sounds (the landing bar must still
 * sound).
 *
 * One arpeggiator per section (§16.3): the drawn arpeggiator is the only
 * FIGURE voice — when the piano arps, the harp keeps only its non-figure
 * roles (roots, glissandos), and when the harp beds, the cinematic/hybrid
 * piano keeps only its pulse. The comping (chamber, sonata, vocalbacking)
 * is a downbeat guide tone, not a figure, and coexists with the harp bed.
 *
 * The line is STATELESS per bar — the bed's and the arpeggio's pitch cycle
 * restarts from the bar's own chord every bar, the comping folds the bar's
 * root into its register — so no moment needs a ghost run to preserve a
 * pitch walk (the percussion's timpani walk was stateful; the keys are not).
 */
import { mulberry32, hashString } from '../../engine/generate';
import { orchestrationSeedFor } from '../spine';
import { barTicks, projectBars } from '../../shared/schema/meter';
import type { Project } from '../../shared/schema/types';
import { sectionTypeNameAtBar, textureForType } from '../conductor/layers';
import type { OrchestratorContext } from '../module';
import { momentForBar } from '../conductor/moments';
import {
  GLISS_MAX_PER_PIECE, GLISS_WEIGHTS, KEYS_GATES, KEYS_PARTS, OUTRO_LIKE, PIANO_ARP_TEMPLATES,
  PIANO_COMP_MENU, PIANO_DRIVE_MENU, PIANO_VB_MENU,
  isChorusTypeK, keysRosterOf, levelForNormK,
  type KeysLevel, type KeysPart, type PianoPattern,
} from './profile';

export type HarpVoiceKind = 'bed' | 'roots' | 'gliss' | 'final';
export type PianoVoiceKind = 'arp' | 'pulse' | 'comp' | 'tutti' | 'final';
export type KeysVoiceKind = HarpVoiceKind | PianoVoiceKind;

export interface KeysBarPlan {
  bar: number;
  level: KeysLevel;
  /** The arc target over the clamp max this bar. */
  norm: number;
  voices: Partial<Record<KeysPart, KeysVoiceKind>>;
  /** The moment covering the bar, when it drives the keys kinds. */
  moment?: 'tutti' | 'soli' | 'unison';
}

export interface KeysGliss {
  part: 'harp';
  /** The first tick of the run (its 16ths start here). */
  startTick: number;
  /** The downbeat the run lands on (a chorus entry, a tutti, an outro). */
  targetTick: number;
  targetBar: number;
  dir: 'up' | 'down';
  source: 'chorus' | 'tutti' | 'outro';
}

export interface KeysPlan {
  bars: KeysBarPlan[];
  glisses: KeysGliss[];
  /** The drawn arpeggiator per section type (the one-arp-per-section rule). */
  arpeggiatorByType: Record<string, KeysPart>;
  /** §16.3a (Phase 11.1): the drawn piano pattern per section instance
   *  (startBar-keyed; the renderer realises the comp/drive kinds through
   *  it). Empty where the template's piano has no menu (cinematic and
   *  hybridstudio keep the arpeggiator). */
  pianoPatterns: { startBar: number; pattern: PianoPattern }[];
  /** §16.3a: the conductor's fillGating answer bars reserved for the piano
   *  (the callfill pattern answers in them; the renderer reads the set). */
  fillBars: number[];
  reports: string[];
}

/** The empty plan (no template / no keys roster): the module is silent. */
export const EMPTY_KEYS_PLAN: KeysPlan = { bars: [], glisses: [], arpeggiatorByType: {}, pianoPatterns: [], fillBars: [], reports: [] };

/** The salted keys stream (D8): a pure function of (inputs, take). */
export const keysRng = (project: Project, take: number): (() => number) =>
  mulberry32((orchestrationSeedFor(project, { take }) ^ Math.imul(hashString('keys'), 0x85ebca6b)) >>> 0);

/** §16.3a (Phase 11.1) the piano menu's OWN salted stream — a different
 *  hash salt and mixer constant from the keys D8 stream, so the existing
 *  draw streams are untouched byte-for-byte. A pure function of
 *  (inputs, take). */
export const pianoMenuRng = (project: Project, take: number): (() => number) =>
  mulberry32((orchestrationSeedFor(project, { take }) ^ Math.imul(hashString('piano-variety'), 0x9e3779b9)) >>> 0);

/** The section's phrase starts (§16.4): the first bar and every 4th bar of
 *  it — the hypermeter, the same reading the percussion's support uses. */
const phraseStartOf = (secStart: number, bar: number): boolean => bar === secStart || (bar - secStart) % 4 === 0;

/** A fillGating window reserved for the piano (the conductor's plan). */
export interface KeysFillWindow { target: string; startTick: number; endTick: number }

/**
 * Plans the take's keys. Pure: same context → same plan. Runs at the
 * conductor level (after the percussion); the renderer realises it after
 * the percussion renderer so the velocity math sees every other family's
 * notes. `fills` is the conductor's fillGating window list (the piano's
 * planned answer bars).
 */
export function planKeys(ctx: OrchestratorContext, fills: KeysFillWindow[]): KeysPlan {
  const { project, template, sections, arc } = ctx;
  const moments = ctx.moments ?? [];
  const take = project.orchestration?.take ?? 0;
  const reports: string[] = [];
  if (!template || !arc?.length) return EMPTY_KEYS_PLAN;
  const clampMax = template.budget.energyClamp[1];
  const roster = keysRosterOf(ctx);
  if (!roster.length) return EMPTY_KEYS_PLAN;

  const rng = keysRng(project, take);
  // §16.3a: the piano menu draw — ONE draw per section instance on the
  // piano-variety stream (never the keys D8 stream). chorus-type sections
  // draw the relief drive's voicing variants; the others draw the comp
  // menu (chamber, sonata) or the vocalbacking menu. cinematic and
  // hybridstudio keep the arpeggiator — no menu, no draw. The take and the
  // section ordinal rotate the drawn index so the distinct-track target
  // holds across takes 1-10 without depending on the stream's luck.
  const pianoPatterns: { startBar: number; pattern: PianoPattern }[] = [];
  const pianoMenuable = roster.includes('piano') && !PIANO_ARP_TEMPLATES.has(template.id);
  if (pianoMenuable) {
    const menuRng = pianoMenuRng(project, take);
    const ordered = [...sections].sort((a, b) => a.startBar - b.startBar);
    const drawn: PianoPattern[] = [];
    ordered.forEach((sec, ordinal) => {
      const chorusMenu = isChorusTypeK(sec.name);
      const menu = chorusMenu ? PIANO_DRIVE_MENU : template.id === 'ensemble.vocalbacking' ? PIANO_VB_MENU : PIANO_COMP_MENU;
      const idx = (Math.floor(menuRng() * menu.length) + (take - 1) + ordinal) % menu.length;
      const pattern = menu[idx];
      drawn.push(pattern);
      pianoPatterns.push({ startBar: sec.startBar, pattern });
    });
    // within one take the sections must not all play the same pattern —
    // the deterministic rotation (no extra stream consumption)
    if (ordered.length > 1 && drawn.every((p) => p === drawn[0])) {
      pianoPatterns.forEach((entry, ordinal) => {
        const sec = ordered[ordinal];
        const menu = isChorusTypeK(sec.name) ? PIANO_DRIVE_MENU : template.id === 'ensemble.vocalbacking' ? PIANO_VB_MENU : PIANO_COMP_MENU;
        entry.pattern = menu[(menu.indexOf(entry.pattern) + ordinal) % menu.length];
      });
    }
    reports.push(`keys piano menu (take ${take}): ${pianoPatterns.map((e) => `b${e.startBar}=${e.pattern}`).join(', ')}`);
  }
  const bars = projectBars(project);
  const btBar = barTicks(project.timeSignature);
  const nearSilenceBars = new Set<number>();
  for (const a of arc) if (a.nearSilence) nearSilenceBars.add(a.bar);

  // ---- the draws ----
  // 1) the arpeggiator per section type (only where both keys parts are
  // rostered — with one part there is nothing to draw)
  const arpeggiatorByType: Record<string, KeysPart> = {};
  const bothParts = roster.includes('harp') && roster.includes('piano');
  const typeOrder = [...new Set(sections.map((s) => s.name.trim().toLowerCase() || '*'))];
  if (bothParts) {
    for (const type of typeOrder) arpeggiatorByType[type] = rng() < 0.5 ? 'harp' : 'piano';
  }
  const arpeggiatorFor = (bar: number): KeysPart | null => {
    if (!bothParts) return roster.includes('harp') ? 'harp' : 'piano';
    return arpeggiatorByType[sectionTypeNameAtBar(ctx, bar)] ?? null;
  };

  // 2)+3) the chorus-entry and outro glissandos (moments-INDEPENDENT order;
  // a harp-rostered take only — the run is a harp figure, so without the
  // harp the draws never run and never touch the stream)
  const glisses: KeysGliss[] = [];
  const harpRostered = roster.includes('harp');
  const runFree = (startTick: number, targetTick: number): boolean => {
    const startBar = Math.floor(startTick / btBar) + 1;
    const endBar = Math.min(bars, Math.floor((targetTick - 1) / btBar) + 1);
    for (let b = startBar; b <= endBar; b++) if (nearSilenceBars.has(b)) return false;
    return true;
  };
  if (harpRostered) {
    const chorusSecs = [...sections].sort((a, b) => a.startBar - b.startBar).filter((s) => isChorusTypeK(s.name));
    for (const sec of chorusSecs) {
      if (glisses.length >= GLISS_MAX_PER_PIECE) break;
      const bar = sec.startBar;
      if (bar <= 1 || bar > bars) continue;
      if (rng() >= GLISS_WEIGHTS.chorus) continue;
      if (nearSilenceBars.has(bar)) continue;
      const len = rng() < 0.5 ? btBar : Math.floor(btBar / 2);
      const startTick = (bar - 1) * btBar - len;
      if (startTick < 0) continue;
      if (!runFree(startTick, (bar - 1) * btBar)) continue;
      glisses.push({ part: 'harp', startTick, targetTick: (bar - 1) * btBar, targetBar: bar, dir: 'up', source: 'chorus' });
    }
    const outroSec = sections.find((s) => OUTRO_LIKE.test(s.name.trim().toLowerCase()));
    if (outroSec && glisses.length < GLISS_MAX_PER_PIECE) {
      const bar = outroSec.startBar;
      if (bar >= 2 && bar <= bars && !nearSilenceBars.has(bar) && rng() < GLISS_WEIGHTS.outro) {
        const len = rng() < 0.5 ? btBar : Math.floor(btBar / 2);
        const startTick = (bar - 1) * btBar - len;
        if (startTick >= 0 && runFree(startTick, (bar - 1) * btBar)) {
          glisses.push({ part: 'harp', startTick, targetTick: (bar - 1) * btBar, targetBar: bar, dir: 'down', source: 'outro' });
        }
      }
    }
  }
  // 4) the tutti moments (with the moments off this pass vanishes and steps
  // 1–3 stay byte-identical)
  const tuttiMoments = moments.filter((m) => m.kind === 'tutti').sort((a, b) => a.startBar - b.startBar);
  for (const m of tuttiMoments) {
    if (!harpRostered || glisses.length >= GLISS_MAX_PER_PIECE) break;
    const bar = m.startBar;
    if (bar < 2 || bar > bars) continue;
    if (nearSilenceBars.has(bar) || rng() >= GLISS_WEIGHTS.tutti) continue;
    const len = rng() < 0.5 ? btBar : Math.floor(btBar / 2);
    const startTick = (bar - 1) * btBar - len;
    if (startTick < 0 || !runFree(startTick, (bar - 1) * btBar)) continue;
    glisses.push({ part: 'harp', startTick, targetTick: (bar - 1) * btBar, targetBar: bar, dir: 'up', source: 'tutti' });
  }

  // ---- the per-bar kinds ----
  const glissByBar = new Map<number, KeysGliss>();
  for (const g of glisses) {
    const startBar = Math.floor(g.startTick / btBar) + 1;
    for (let b = startBar; b <= g.targetBar; b++) glissByBar.set(b, g);
  }
  // the fillGating answer bars (the conductor's reserved windows): the
  // strings rest there, so the piano answers in a real rest (§16.3)
  const fillBars = new Set<number>();
  for (const f of fills) {
    if (f.target !== 'piano' && f.target !== 'Keys') continue;
    const b = Math.floor(f.startTick / btBar) + 1;
    fillBars.add(b);
  }

  const barPlans: KeysBarPlan[] = [];
  const fillBarList = [...fillBars].sort((a, b) => a - b);
  for (let bar = 1; bar <= bars; bar++) {
    const target = arc[bar - 1]?.target ?? 0;
    const norm = clampMax > 0 ? target / clampMax : 0;
    const level: KeysLevel = levelForNormK(norm);
    const voices: Partial<Record<KeysPart, KeysVoiceKind>> = {};
    const secHere = sections.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
    const inChorus = isChorusTypeK(secHere?.name);
    const secStart = secHere?.startBar ?? 1;
    const tex = textureForType(ctx, sectionTypeNameAtBar(ctx, bar));
    const moment = momentForBar(moments, bar);
    const isSoli = moment?.kind === 'soli';
    const isUnison = moment?.kind === 'unison';
    const isTutti = moment?.kind === 'tutti';
    const isNearSilence = nearSilenceBars.has(bar);
    const chorusRelief = inChorus && norm >= KEYS_GATES.low;
    const tacet = isSoli || isNearSilence || isUnison;
    const glissHere = roster.includes('harp') ? glissByBar.get(bar) : undefined;
    const arpOwner = arpeggiatorFor(bar);
    const harpArps = arpOwner === 'harp';
    const canArp = PIANO_ARP_TEMPLATES.has(template.id);
    const arpMine = canArp && arpOwner === 'piano';

    // HARP (§16.2): a glissando owns its bars; a tutti reduces the harp to
    // its drawn glissando; the high gates thin it to glissandos or rests
    // outside a chorus (it is buried under a tutti); the bed is the main
    // low/mid figure (only when the harp owns the arpeggiator); the low
    // plucked roots ride the pizz-flavoured sparse textures on phrase
    // starts.
    if (roster.includes('harp')) {
      if (glissHere) voices.harp = 'gliss';
      else if (bar === bars) voices.harp = 'final';
      else if (isTutti) {
        // the gliss-into-tutti lands ON the downbeat — its landing note
        // sounds there; without a drawn gliss the harp stays tacet (peak:
        // tacet except a glissando into the tutti)
      } else if (!tacet) {
        if (chorusRelief && harpArps) voices.harp = 'bed';
        else if (chorusRelief) voices.harp = 'roots';
        else if ((level === 'low' || level === 'mid') && harpArps) voices.harp = 'bed';
        else if (level === 'low') {
          const pizzSparse = tex.style.bassPizz === true || tex.id === 'pizzPulse' || tex.style.ostArticulation === 'pizz';
          if (pizzSparse && phraseStartOf(secStart, bar)) voices.harp = 'roots';
        }
        // high/peak outside a chorus: thin to glissandos or rests — tacet
      }
    }

    // PIANO (§16.3): the arpeggiator (drawn, cinematic/hybridstudio) at low
    // to mid energy and under the chorus relief; the low octave pulse at
    // high energy in ostinato/trailer textures; the comping (chamber,
    // sonata, vocalbacking) on phrase starts at low to mid energy, on the
    // fillGating answer bars, and on every chorus bar downbeat; the tutti
    // root hit; the closing figure on the final bar.
    if (roster.includes('piano')) {
      if (bar === bars) voices.piano = 'final';
      else if (isTutti) voices.piano = 'tutti';
      else if (!tacet) {
        const isOstTex = tex.id === 'singleOstinato' || tex.id === 'interlockingOstinato' || tex.id === 'trailer';
        if (arpMine && ((norm >= KEYS_GATES.low && norm < KEYS_GATES.high) || chorusRelief)) voices.piano = 'arp';
        else if (isOstTex && norm >= KEYS_GATES.high) voices.piano = 'pulse';
        else if (chorusRelief && canArp) voices.piano = 'pulse';
        else if (!canArp) {
          if (chorusRelief) voices.piano = 'comp';
          else if (norm >= KEYS_GATES.low && norm < KEYS_GATES.mid && (phraseStartOf(secStart, bar) || fillBars.has(bar))) voices.piano = 'comp';
          else if (fillBars.has(bar) && norm >= KEYS_GATES.low) voices.piano = 'comp';
        }
      }
    }

    barPlans.push({
      bar, level, norm, voices,
      ...(isTutti && !isSoli ? { moment: 'tutti' as const } : isSoli ? { moment: 'soli' as const } : isUnison ? { moment: 'unison' as const } : {}),
    });
  }

  const glissLine = glisses.map((g) => `b${g.targetBar}:${g.dir}(${g.source})`).join(',') || 'none';
  reports.push(`keys (take ${take}): gates 0.30/0.50/0.72/0.90 of clamp ${clampMax}, chorus relief from 0.30; arpeggiator ${Object.entries(arpeggiatorByType).map(([t, p]) => `${t}=${p}`).join(',') || 'single-part'}; glissandos ${glissLine} (budget ${GLISS_MAX_PER_PIECE})`);
  const firstBars = barPlans.filter((b) => Object.values(b.voices).some((v) => v !== undefined)).slice(0, 12);
  if (firstBars.length) reports.push(`keys plan (take ${take}): ${firstBars.map((b) => `b${b.bar}[${b.level}] ${Object.entries(b.voices).map(([p, k]) => `${p}:${k}`).join(' | ')}`).join(' | ')}`);

  return { bars: barPlans, glisses, arpeggiatorByType, pianoPatterns, fillBars: fillBarList, reports };
}

/** The keys tracks the plan annotates (the conductor's honesty list). */
export function keysPlannedRoles(ctx: OrchestratorContext): KeysPart[] {
  if (!ctx.template) return [];
  return KEYS_PARTS.filter((p) => keysRosterOf(ctx).includes(p));
}
