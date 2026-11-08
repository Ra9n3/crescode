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
  GLISS_MAX_PER_PIECE, GLISS_WEIGHTS, HARP_FIGURE_MENU, HARP_FIGURE_UNIT_BARS, HARP_ROTATION_OFFSET,
  KEYS_GATES, KEYS_PARTS, OUTRO_LIKE, PIANO_ARP_FIGURES,
  PIANO_COLOR_MENUS, PIANO_JOB_FALLBACK, PIANO_JOB_MENUS, PIANO_L1_MENU, PIANO_MOTION_MENUS,
  PIANO_POWER_FIGURES, PIANO_RHYTHM_MENUS,
  isChorusTypeK, keysRosterOf, levelForNormK,
  type HarpFigure, type KeysLevel, type KeysPart, type PianoFigure, type PianoJob, type PianoL1,
} from './profile';

export type HarpVoiceKind = 'bed' | 'roots' | 'gliss' | 'final';
export type PianoVoiceKind = 'job' | 'tutti' | 'final';
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
  /** §16.3a: the conductor's fillGating answer bars reserved for the piano
   *  (the answer figure plays in them; the renderer reads the set). */
  fillBars: number[];
  /** §16.9 (Phase 11.6): the piano JOB per section instance — the balanced
   *  rotation offset per take (the same job never repeats in two
   *  consecutive sections of one take), the L1 chord variant, the job's
   *  figure per four-bar phrase (the phrase-level hash rotation; a chorus
   *  of 4+ bars always holds at least 2 figures), and the last-chorus
   *  octave shift where the range allows. startBar-keyed. */
  pianoJobs: { startBar: number; job: PianoJob; l1: PianoL1; figures: PianoFigure[]; octaveShift: boolean }[];
  /** §16.6 (Phase 11.5): the harp's bed figure per two-bar unit per section
   *  instance — the balanced rotation offset from the piano's, plus the
   *  hash-stepped unit walk (a chorus of at least 4 bars always holds at
   *  least 2 figures, and never the verse's figure). */
  harpFigures: { startBar: number; figures: HarpFigure[] }[];
  reports: string[];
}

/** The empty plan (no template / no keys roster): the module is silent. */
export const EMPTY_KEYS_PLAN: KeysPlan = { bars: [], glisses: [], arpeggiatorByType: {}, pianoJobs: [], fillBars: [], harpFigures: [], reports: [] };

/** The salted keys stream (D8): a pure function of (inputs, take). */
export const keysRng = (project: Project, take: number): (() => number) =>
  mulberry32((orchestrationSeedFor(project, { take }) ^ Math.imul(hashString('keys'), 0x85ebca6b)) >>> 0);

/** The piano-variety stream (§16.3a, Phase 11.1): a different hash salt and
 *  mixer constant from the keys D8 stream. Phase 11.4 replaced the random
 *  menu draw with a deterministic balanced rotation (the diversity targets
 *  are hard caps measured on realized notes, and the 10-sample section
 *  types cannot meet a ≤ 40% cap under multinomial noise), so the plan no
 *  longer consumes this stream — it stays exported as the piano's reserved
 *  salt for future per-take piano draws. A pure function of (inputs, take). */
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
  // ---- the draws ----
  // 1) the arpeggiator per section type (only where both keys parts are
  // rostered — with one part there is nothing to draw). Drawn FIRST on the
  // keys stream (the stream's consumption order is unchanged — the menu
  // draw below rides its OWN piano-variety stream) because §16.3a (11.4)
  // needs the owner BEFORE the menu draw: where the harp owns a section
  // type's arpeggiator, the vocalbacking piano draws only its non-arpeggio
  // patterns there (the one-arpeggiator rule — the menu's highArp is the
  // only figure).
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

  // §16.9 (Phase 11.6): the piano JOB per section instance — a DETERMINISTIC
  // BALANCED ROTATION, the take and the section ordinal indexing the
  // template's job menu (adjacent menu entries land on adjacent sections,
  // so the same job never repeats in two consecutive sections of one
  // take). The draw consumes NO stream — a pure function of (inputs, take)
  // — so the keys stream's consumption order (the arpeggiator draw, the
  // glissandos) is untouched and the harp's bytes stay on golden105. Each
  // section also draws its L1 chord variant (the same rotation family) and
  // its FIGURE per four-bar phrase: the job's own menu walked with a
  // salted-hash phase — consecutive phrases never repeat, so a chorus of
  // 4+ bars always uses at least 2 figures, and every figure in the menu
  // realises over the 20-run survey by construction. Where the HARP owns a
  // section type's arpeggiator the motion menu drops the arpeggio figures
  // (the one-arpeggiator rule). The LAST chorus may shift its figure up an
  // octave where the range allows (never vocalbacking — the sparkle cap
  // bounds the band). The renderer realises the layers through the energy
  // arc: L0 body everywhere the piano is active, L1+L2 from the mid gate
  // (the chorus relief from the LOW gate), L3 at high energy, the thinning
  // and tacet bands by ABSOLUTE energy (0.72 / 0.90 — the chamber, sonata
  // and vocalbacking clamps never reach them).
  const pianoJobs: { startBar: number; job: PianoJob; l1: PianoL1; figures: PianoFigure[]; octaveShift: boolean }[] = [];
  const pianoMenuable = roster.includes('piano');
  if (pianoMenuable) {
    const jobMenu = PIANO_JOB_MENUS[template.id] ?? PIANO_JOB_FALLBACK;
    const orderedSecs = [...sections].sort((a, b) => a.startBar - b.startBar);
    const lastChorusStart = [...orderedSecs].reverse().find((s) => isChorusTypeK(s.name))?.startBar ?? -1;
    const figureOrdinal = new Map<string, number>();
    orderedSecs.forEach((sec, ordinal) => {
      const chorus = isChorusTypeK(sec.name);
      const job = jobMenu[(take - 1 + ordinal) % jobMenu.length];
      const figK = figureOrdinal.get(job) ?? 0;
      figureOrdinal.set(job, figK + 1);
      const l1 = PIANO_L1_MENU[(take - 1 + ordinal) % PIANO_L1_MENU.length];
      let menu: readonly PianoFigure[] = [];
      if (job === 'motion') {
        const base = PIANO_MOTION_MENUS[template.id] ?? PIANO_MOTION_MENUS['ensemble.chamber'];
        const harpOwns = arpeggiatorByType[sec.name.trim().toLowerCase() || '*'] === 'harp';
        menu = harpOwns ? base.filter((f) => !PIANO_ARP_FIGURES.includes(f)) : base;
        if (!menu.length) menu = base.filter((f) => !PIANO_ARP_FIGURES.includes(f));
      } else if (job === 'rhythm') menu = PIANO_RHYTHM_MENUS[template.id] ?? ['pump'];
      else if (job === 'color') menu = PIANO_COLOR_MENUS[template.id] ?? ['highSparkle'];
      else if (job === 'power') menu = PIANO_POWER_FIGURES;
      const nPhrases = Math.max(1, Math.ceil(sec.lengthBars / 4));
      const base = menu.length ? (take - 1 + figK) % menu.length : 0;
      const figures: PianoFigure[] = [];
      for (let p = 0; p < nPhrases; p++) {
        if (menu.length) figures.push(menu[(base + p) % menu.length]);
      }
      const octaveShift = chorus && sec.startBar === lastChorusStart
        && template.id !== 'ensemble.vocalbacking'
        && hashString(`piano-shift:${take}:${sec.startBar}`) % 2 === 0;
      pianoJobs.push({ startBar: sec.startBar, job, l1, figures, octaveShift });
    });
    reports.push(`keys piano jobs (take ${take}, balanced rotation): ${pianoJobs.map((e) => `b${e.startBar}=${e.job}${e.octaveShift ? '+8ve' : ''}`).join(', ')}`);
    reports.push(`keys piano figures (take ${take}, phrase rotation): ${pianoJobs.map((e) => `b${e.startBar}=[${e.figures.join(' | ')}]`).join(', ') || 'none'}`);
  }

  // §16.6 (Phase 11.5): the harp's bed figure per section instance — a
  // DETERMINISTIC BALANCED ROTATION over the type's GLOBAL unit stream,
  // offset from the piano's rotation by a constant: the type's units across
  // the whole take are numbered (take-1)*U + i (U = the type's unit count,
  // fixed per fixture), the figure = menu[globalIndex + phase] where the
  // PHASE is the phrase-level hash variation — a salted hash of
  // (take, type) shifts the menu per take and per section type, so the same
  // global index draws a different figure on a different type or take while
  // the rotation keeps every figure's share at ceil(units/9) — the ≤ 40%
  // cap holds even for the 7-unit realized samples (a hot bridge where the
  // harp tacets half the units). Consecutive units never repeat (the global
  // index steps by 1), so a chorus of at least 4 bars (two units) always
  // uses at least 2 figures, and a chorus never repeats the verse's figure
  // (the phase and the index both differ).
  const harpFigures: { startBar: number; figures: HarpFigure[] }[] = [];
  if (roster.includes('harp')) {
    const byType = new Map<string, { startBar: number; lengthBars: number }[]>();
    for (const sec of [...sections].sort((a, b) => a.startBar - b.startBar)) {
      const key = sec.name.trim().toLowerCase() || '*';
      if (!byType.has(key)) byType.set(key, []);
      byType.get(key)!.push({ startBar: sec.startBar, lengthBars: sec.lengthBars });
    }
    for (const [type, secs] of byType) {
      const totalUnits = secs.reduce((a, s) => a + Math.max(1, Math.ceil(s.lengthBars / HARP_FIGURE_UNIT_BARS)), 0);
      const phase = hashString(`harp-fig:${take}:${type}`) % HARP_FIGURE_MENU.length;
      let idx = 0;
      for (const s of secs) {
        const nUnits = Math.max(1, Math.ceil(s.lengthBars / HARP_FIGURE_UNIT_BARS));
        const figures: HarpFigure[] = [];
        for (let u = 0; u < nUnits; u++) {
          const globalIdx = (take - 1) * totalUnits + idx + HARP_ROTATION_OFFSET;
          figures.push(HARP_FIGURE_MENU[(globalIdx + phase) % HARP_FIGURE_MENU.length]);
          idx++;
        }
        harpFigures.push({ startBar: s.startBar, figures });
      }
    }
    reports.push(`keys harp figures (take ${take}, global rotation +${HARP_ROTATION_OFFSET}, hash phase per type): ${harpFigures.map((e) => `b${e.startBar}=[${e.figures.join(' | ')}]`).join(', ')}`);
  }
  const bars = projectBars(project);
  const btBar = barTicks(project.timeSignature);
  const nearSilenceBars = new Set<number>();
  for (const a of arc) if (a.nearSilence) nearSilenceBars.add(a.bar);

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

    // PIANO (§16.9, Phase 11.6): the section's JOB realises bar by bar
    // through the energy arc — L0 body everywhere the piano is active, the
    // L1 chord and the L2 figure from the mid gate (the chorus relief from
    // the LOW gate — the chorus never thins), L3 at high energy. The
    // thinning and tacet bands read ABSOLUTE energy (norm * clampMax):
    // above 0.72 the non-chorus piano thins to L0 plus an L3 downbeat hit;
    // at 0.90 and above it is tacet except the tutti hit and the final bar
    // (the chamber/sonata/vocalbacking clamps are 0.65-0.70 — they never
    // reach either band). The tutti root hit and the final-bar anchor keep
    // their Phase 11 shapes.
    if (roster.includes('piano')) {
      if (bar === bars) voices.piano = 'final';
      else if (isTutti) voices.piano = 'tutti';
      else if (!tacet) {
        const energy = norm * clampMax;
        const peakStop = !inChorus && energy >= 0.9;
        if (!peakStop && norm >= KEYS_GATES.low) voices.piano = 'job';
      }
    }

    barPlans.push({
      bar, level, norm, voices,
      ...(isTutti && !isSoli ? { moment: 'tutti' as const } : isSoli ? { moment: 'soli' as const } : isUnison ? { moment: 'unison' as const } : {}),
    });
  }

  const glissLine = glisses.map((g) => `b${g.targetBar}:${g.dir}(${g.source})`).join(',') || 'none';
  reports.push(`keys (take ${take}): gates 0.30/0.50/0.72/0.90 of clamp ${clampMax}, chorus relief from 0.30, comp 0.30-0.90 (thinned above 0.72); arpeggiator ${Object.entries(arpeggiatorByType).map(([t, p]) => `${t}=${p}`).join(',') || 'single-part'}; glissandos ${glissLine} (budget ${GLISS_MAX_PER_PIECE})`);
  const firstBars = barPlans.filter((b) => Object.values(b.voices).some((v) => v !== undefined)).slice(0, 12);
  if (firstBars.length) reports.push(`keys plan (take ${take}): ${firstBars.map((b) => `b${b.bar}[${b.level}] ${Object.entries(b.voices).map(([p, k]) => `${p}:${k}`).join(' | ')}`).join(' | ')}`);

  return { bars: barPlans, glisses, arpeggiatorByType, pianoJobs, fillBars: fillBarList, harpFigures, reports };
}

/** The keys tracks the plan annotates (the conductor's honesty list). */
export function keysPlannedRoles(ctx: OrchestratorContext): KeysPart[] {
  if (!ctx.template) return [];
  return KEYS_PARTS.filter((p) => keysRosterOf(ctx).includes(p));
}
