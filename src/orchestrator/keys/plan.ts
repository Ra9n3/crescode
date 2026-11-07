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
  KEYS_GATES, KEYS_PARTS, OUTRO_LIKE, PIANO_ARP_TEMPLATES,
  PIANO_BLOCK_FAMILY, PIANO_CHORUS_FIGURE_MENU, PIANO_COMP_MENU, PIANO_DRIVE_MENU, PIANO_VB_MENU, PIANO_VB_MENU_NON_ARP,
  isChorusTypeK, keysRosterOf, levelForNormK,
  type HarpFigure, type KeysLevel, type KeysPart, type PianoPattern,
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
  /** §16.5 (Phase 11.5): the chorus piano figure per four-bar phrase per
   *  chorus section instance (the rotation draws the figure menu per chorus
   *  occurrence and changes it at phrase level; the block slot is resolved
   *  to a concrete drive variant here — the renderer never sees the
   *  sentinel). startBar-keyed like pianoPatterns. */
  chorusFigures: { startBar: number; figures: PianoPattern[] }[];
  /** §16.6 (Phase 11.5): the harp's bed figure per two-bar unit per section
   *  instance — the balanced rotation offset from the piano's, plus the
   *  hash-stepped unit walk (a chorus of at least 4 bars always holds at
   *  least 2 figures, and never the verse's figure). */
  harpFigures: { startBar: number; figures: HarpFigure[] }[];
  reports: string[];
}

/** The empty plan (no template / no keys roster): the module is silent. */
export const EMPTY_KEYS_PLAN: KeysPlan = { bars: [], glisses: [], arpeggiatorByType: {}, pianoPatterns: [], fillBars: [], chorusFigures: [], harpFigures: [], reports: [] };

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

  // §16.3a: the piano menu — ONE pattern per section instance. Phase 11.4:
  // the draw is a DETERMINISTIC BALANCED ROTATION — the take and the
  // section ordinal index the menu — replacing the random draw. The
  // diversity targets are hard caps measured on realized notes (the most
  // frequent realized pattern ≤ 40% per section type), and the bridge and
  // outro types hold only 10 instances across the 20-run survey: over a
  // 3-4 pattern menu, multinomial noise puts the top pattern at 50%+ (and
  // sometimes never draws a pattern at all) — the rotation guarantees the
  // top share at ceil(instances/menu) ≤ 40% for every menu of ≥ 3
  // outcomes, and every pattern realises. The harp-owned vocalbacking
  // sections rotate the non-arpeggio subset (the one-arpeggiator rule).
  // §16.5 (Phase 11.5): chorus-type sections rotate the FIGURE menu per
  // four-bar phrase (the chorus is no longer only quarter-note block
  // strikes; the block slot resolves to the relief drive's own six
  // voicing variants rotating across the phrases that drew it — the
  // block share of chorus bars is 1 of the 7 menu slots, well under the
  // 25% cap). The other sections keep the 11.4 rotation (the comp menu
  // on chamber and sonata, the vocalbacking menu — or its non-arpeggio
  // subset under a harp-owned arpeggiator). cinematic and hybridstudio
  // keep the arpeggiator — no menu.
  const pianoPatterns: { startBar: number; pattern: PianoPattern }[] = [];
  const chorusFigures: { startBar: number; figures: PianoPattern[] }[] = [];
  const pianoMenuable = roster.includes('piano') && !PIANO_ARP_TEMPLATES.has(template.id);
  const isVB = template.id === 'ensemble.vocalbacking';
  const menuFor = (sec: { name: string }): readonly PianoPattern[] => {
    if (isChorusTypeK(sec.name)) return PIANO_DRIVE_MENU;
    if (isVB && arpeggiatorByType[sec.name.trim().toLowerCase() || '*'] === 'harp') return PIANO_VB_MENU_NON_ARP;
    return isVB ? PIANO_VB_MENU : PIANO_COMP_MENU;
  };
  if (pianoMenuable) {
    const ordered = [...sections].sort((a, b) => a.startBar - b.startBar);
    let chorusOrdinal = 0;
    let blockOrdinal = 0;
    ordered.forEach((sec, ordinal) => {
      if (isChorusTypeK(sec.name)) {
        // the chorus figure rotation: the base indexes the chorus
        // occurrence, each phrase steps one menu slot — consecutive
        // phrases never repeat, so a multi-phrase chorus always uses two
        // or more figures. The BLOCK slots number their own draws (the
        // k-th block over the take) and resolve to the relief drive's
        // variants in that order — every variant realises within six
        // block draws regardless of where the slots land.
        const figures: PianoPattern[] = [];
        const nPhrases = Math.max(1, Math.ceil(sec.lengthBars / 4));
        for (let p = 0; p < nPhrases; p++) {
          const drawn = PIANO_CHORUS_FIGURE_MENU[(take - 1 + chorusOrdinal + p) % PIANO_CHORUS_FIGURE_MENU.length];
          figures.push(drawn === PIANO_BLOCK_FAMILY ? PIANO_DRIVE_MENU[((take - 1) * 2 + blockOrdinal++) % PIANO_DRIVE_MENU.length] : drawn);
        }
        chorusFigures.push({ startBar: sec.startBar, figures });
        pianoPatterns.push({ startBar: sec.startBar, pattern: figures[0] });
        chorusOrdinal++;
        return;
      }
      const menu = menuFor(sec);
      const pattern = menu[(take - 1 + ordinal) % menu.length];
      pianoPatterns.push({ startBar: sec.startBar, pattern });
    });
    reports.push(`keys piano menu (take ${take}, balanced rotation): ${pianoPatterns.map((e) => `b${e.startBar}=${e.pattern}`).join(', ')}`);
    reports.push(`keys chorus figures (take ${take}, phrase rotation): ${chorusFigures.map((e) => `b${e.startBar}=[${e.figures.join(' | ')}]`).join(', ') || 'none'}`);
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
          // §16.4 (11.4): the comp gate moves from the low band to the
          // PEAK gate — the menu patterns sound at low AND mid energy, and
          // the renderer thins them toward tacet above the HIGH gate (the
          // pre-flight: the bridge phrase starts sit at 0.72-0.80 on sonata
          // and vocalbacking, so a hard stop at the high gate would leave
          // them permanently tacet; the thinning carries them). The fill
          // answer bars keep their own gate (low and above, any level —
          // the strings rest there; the piano answers).
          else if (norm >= KEYS_GATES.low && norm < KEYS_GATES.peak && (phraseStartOf(secStart, bar) || fillBars.has(bar))) voices.piano = 'comp';
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
  reports.push(`keys (take ${take}): gates 0.30/0.50/0.72/0.90 of clamp ${clampMax}, chorus relief from 0.30, comp 0.30-0.90 (thinned above 0.72); arpeggiator ${Object.entries(arpeggiatorByType).map(([t, p]) => `${t}=${p}`).join(',') || 'single-part'}; glissandos ${glissLine} (budget ${GLISS_MAX_PER_PIECE})`);
  const firstBars = barPlans.filter((b) => Object.values(b.voices).some((v) => v !== undefined)).slice(0, 12);
  if (firstBars.length) reports.push(`keys plan (take ${take}): ${firstBars.map((b) => `b${b.bar}[${b.level}] ${Object.entries(b.voices).map(([p, k]) => `${p}:${k}`).join(' | ')}`).join(' | ')}`);

  return { bars: barPlans, glisses, arpeggiatorByType, pianoPatterns, fillBars: fillBarList, chorusFigures, harpFigures, reports };
}

/** The keys tracks the plan annotates (the conductor's honesty list). */
export function keysPlannedRoles(ctx: OrchestratorContext): KeysPart[] {
  if (!ctx.template) return [];
  return KEYS_PARTS.filter((p) => keysRosterOf(ctx).includes(p));
}
