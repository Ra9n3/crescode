/**
 * Keys planner (Phase 11.6c). The harp keeps its existing figure and
 * glissando plan. The piano keeps its held anchor, then draws balanced
 * support/motion/power jobs, phrase RH figures, arrivals and punctuation.
 * Job/figure decisions are planned here, never made by the renderer.
 *
 * The harp's deterministic bed/root owner draw keeps the existing D8 slot.
 * Its figure/timing output remains stable; a piano motion figure yields when
 * the harp owns the section's single arpeggiator. The golden105 piano-role
 * beat map remains read-only velocity accounting for the harp.
 */
import { mulberry32, hashString } from '../../engine/generate';
import { orchestrationSeedFor } from '../spine';
import { barTicks, beatTicks, projectBars } from '../../shared/schema/meter';
import type { Project } from '../../shared/schema/types';
import { sectionTypeNameAtBar, textureForType, type OstinatoCellId } from '../conductor/layers';
import { cellGrid } from '../lines/ostinato';
import type { OrchestratorContext } from '../module';
import { momentForBar } from '../conductor/moments';
import {
  GLISS_MAX_PER_PIECE, GLISS_WEIGHTS, HARP_FIGURE_MENU, HARP_FIGURE_UNIT_BARS, HARP_ROTATION_OFFSET,
  KEYS_GATES, KEYS_PARTS, OUTRO_LIKE, PIANO_ARPEGGIATOR_FAMILIES, PIANO_JOB_ROTATION,
  PIANO_MOTION_MENUS, PIANO_MOTION_PHRASE_BARS, PIANO_ARRIVAL_PHRASE_BARS,
  PIANO_REPEATED_CHORD_MAX_SHARE, PIANO_UP_MAX_SHARE,
  isChorusTypeK, keysRosterOf, levelForNormK,
  type HarpFigure, type KeysLevel, type KeysPart, type PianoEnergySlope, type PianoFigure,
  type PianoFigureFamily, type PianoJob, type PianoRoleTag,
} from './profile';

export type HarpVoiceKind = 'bed' | 'roots' | 'gliss' | 'final';
export type PianoVoiceKind = 'anchor' | 'tutti' | 'final';
export type KeysVoiceKind = HarpVoiceKind | PianoVoiceKind;

export interface PianoAnswerPlan {
  kind: 'leadEcho' | 'chordToneFragment';
  /** One monophonic pitch per beat; the final pitch releases at windowEndTick. */
  pitches: number[];
  windowEndTick: number;
}

export interface KeysBarPlan {
  bar: number;
  level: KeysLevel;
  /** The arc target over the clamp max this bar. */
  norm: number;
  /** Section-local difference between adjacent ArcBar targets. */
  energySlope: PianoEnergySlope;
  voices: Partial<Record<KeysPart, KeysVoiceKind>>;
  /** Assigned at plan time (never inferred from a renderer draw). */
  pianoRole?: 'anchor';
  pianoJob?: PianoJob;
  /** The actual per-bar figure; direction is resolved against energySlope. */
  pianoFigure?: PianoFigure;
  /** The phrase-level menu family; `pianoFigure` is its slope-resolved bar figure. */
  pianoFigureFamily?: PianoFigureFamily;
  pianoFigureRole?: PianoRoleTag;
  /** The candidate arpeggio suppressed because the harp owns that section. */
  pianoFigureYieldedFrom?: PianoFigure;
  /** Rhythm cell used by the cinematic/hybrid/VB piano-cell figures. */
  pianoCell?: OstinatoCellId;
  /** The rare vocalbacking peak phrase-start upper sparkle window. */
  pianoSparkleTop?: 91 | 96;
  /** Rolled RH chord trigger and its musical placement. */
  pianoArrival?: 'sectionStart' | 'chorusDownbeat' | 'phraseStart' | 'closingChord';
  /** Short RH stab placement; renderer verifies a held LH body underneath. */
  pianoPunctuation?: 'cadence' | 'phraseEnd' | 'preChorus' | 'pump';
  /** Power-job LH subdivision; absent at peak/tacet bars. */
  pianoPower?: 'quarter' | 'eighth';
  /** Cinematic/hybrid chorus RH chord repeated on each beat. */
  pianoRepeatedChord?: boolean;
  /** Chamber/sonata monophonic RH answer in a violins1 rest window. */
  pianoAnswer?: PianoAnswerPlan;
  /** Rare chamber/sonata peak allows RH ceiling 88 instead of 84. */
  pianoRarePeak?: boolean;
  /** Section-level owner of the single arpeggiator, when piano is rostered. */
  arpeggiatorOwner?: KeysPart;
  /** The slope comparison's local direction at a closing section bar. */
  sectionEnd?: boolean;
  /** The moment covering the bar, when it drives the keys kinds. */
  moment?: 'tutti' | 'soli' | 'unison';
}

export interface PianoSectionPlan {
  sectionId: string;
  sectionName: string;
  startBar: number;
  lengthBars: number;
  job: PianoJob;
  arpeggiatorOwner: KeysPart;
  /** Vocalbacking may spend its one sparse-cell section on this instance. */
  vocalCellAllowed: boolean;
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
  /** Harp's per-section mode; `bed` owns the shared arpeggiator. */
  harpModeByType: Record<string, 'bed' | 'roots'>;
  /** The single arpeggiator owner per section type (preserving the owner draw). */
  arpeggiatorOwnerByType: Record<string, KeysPart>;
  /** Balanced support/motion/power job assignment per section instance. */
  pianoJobs: PianoSectionPlan[];
  /** §16.6: harp bed figure per two-bar unit per section instance. */
  harpFigures: { startBar: number; figures: HarpFigure[] }[];
  /** Planned role bars, including answer-line bars assigned after strings render. */
  pianoRoleCounts: Record<'anchor' | 'answer', number>;
  /** Piano motion denominator and hard up-arp share for this take. */
  pianoMotionStats: { motionBars: number; upBars: number; upLimit: number };
  /** Beat-window piano role presence in the immutable golden105 reference.
   *  Read only by the velocity shaper so newly added piano notes do not
   *  change the harp's historical velocity bounds. */
  golden105PianoRoleBeats: number[];
  reports: string[];
}

/** The empty plan (no template / no keys roster): the module is silent. */
export const EMPTY_KEYS_PLAN: KeysPlan = {
  bars: [], glisses: [], harpModeByType: {}, arpeggiatorOwnerByType: {}, pianoJobs: [], harpFigures: [],
  pianoRoleCounts: { anchor: 0, answer: 0 }, pianoMotionStats: { motionBars: 0, upBars: 0, upLimit: 0 },
  golden105PianoRoleBeats: [], reports: [],
};

/** The salted keys stream (D8): a pure function of (inputs, take). */
export const keysRng = (project: Project, take: number): (() => number) =>
  mulberry32((orchestrationSeedFor(project, { take }) ^ Math.imul(hashString('keys'), 0x85ebca6b)) >>> 0);

/** The section's phrase starts (§16.4): first bar and every fourth bar. */
const phraseStartOf = (secStart: number, bar: number): boolean => bar === secStart || (bar - secStart) % 4 === 0;

/** A fillGating window, kept only to reconstruct golden105 piano presence. */
export interface KeysFillWindow { target: string; startTick: number; endTick: number }

interface PianoRoleContext {
  positionInSection: number;
  norm: number;
  energy: number;
  inChorus: boolean;
  tacet: boolean;
  special: 'tutti' | 'final' | null;
}

/**
 * Base held-anchor role policy. The plan decides whether `anchor` applies
 * using bar position (interior/final/tutti), section type and the energy
 * gate. Motion-figure tags are assigned separately and never replace the
 * held anchor role.
 */
function pianoRoleForBar(input: PianoRoleContext): 'anchor' | null {
  if (input.special === 'tutti' || input.special === 'final') return 'anchor';
  if (input.tacet || input.positionInSection < 0) return null;
  const phraseEntry = input.positionInSection % 4 === 0;
  const gate = input.inChorus || phraseEntry ? KEYS_GATES.low : KEYS_GATES.mid;
  if (input.norm < gate) return null;
  if (!input.inChorus && input.energy >= KEYS_GATES.peak) return null;
  return 'anchor';
}

function energySlopeForBar(
  bar: number,
  sectionStart: number,
  sectionEnd: number,
  arc: { bar: number; target: number }[],
  clampMax: number,
): PianoEnergySlope {
  const targetAt = (n: number): number | undefined => arc.find((entry) => entry.bar === n)?.target;
  const here = targetAt(bar) ?? 0;
  const previous = bar > sectionStart ? targetAt(bar - 1) : undefined;
  const next = bar < sectionEnd ? targetAt(bar + 1) : undefined;
  const delta = next !== undefined ? next - here : previous !== undefined ? here - previous : 0;
  const flatBand = Math.max(1e-6, clampMax * 0.005);
  return delta > flatBand ? 'rising' : delta < -flatBand ? 'falling' : 'flat';
}

function roleForFigure(figure: PianoFigure): PianoRoleTag {
  if (figure === 'arpUp') return 'lift';
  if (figure === 'arpDown') return 'settle';
  if (figure === 'arpPendulum' || figure === 'alberti') return 'bed';
  if (figure === 'cascade') return 'atmosphere';
  // Wide-broken, ostinato-cell and high-sparkle notes are supporting beds.
  return 'bed';
}

/** The piano-role windows present in the golden105 reference. This is an
 *  audit/velocity compatibility map only; it does not draw or render any
 *  piano figure. */
const GOLDEN105_FIGURE_TEMPLATES = new Set(['ensemble.cinematic', 'ensemble.hybridstudio']);

/**
 * Plans the take's keys. Pure: same context → same plan. Runs at the
 * conductor level after percussion. `fills` is used only for the immutable
 * golden105 velocity-role map (the new piano does not answer fill windows).
 */
export function planKeys(ctx: OrchestratorContext, fills: KeysFillWindow[] = []): KeysPlan {
  const { project, template, sections, arc } = ctx;
  const moments = ctx.moments ?? [];
  const take = project.orchestration?.take ?? 0;
  const reports: string[] = [];
  if (!template || !arc?.length) return EMPTY_KEYS_PLAN;
  const clampMax = template.budget.energyClamp[1];
  const roster = keysRosterOf(ctx);
  if (!roster.length) return EMPTY_KEYS_PLAN;

  const bars = projectBars(project);
  const btBar = barTicks(project.timeSignature);
  const beat = beatTicks(project.timeSignature);
  const rng = keysRng(project, take);

  // Keep the harp's historical bed/root coin flips and their D8 slots. The
  // removed piano arpeggiator no longer participates in this decision.
  const harpModeByType: Record<string, 'bed' | 'roots'> = {};
  const arpeggiatorOwnerByType: Record<string, KeysPart> = {};
  const bothParts = roster.includes('harp') && roster.includes('piano');
  const typeOrder = [...new Set(sections.map((s) => s.name.trim().toLowerCase() || '*'))];
  if (bothParts) {
    for (const type of typeOrder) {
      const owner = rng() < 0.5 ? 'harp' : 'piano';
      arpeggiatorOwnerByType[type] = owner;
      harpModeByType[type] = owner === 'harp' ? 'bed' : 'roots';
    }
  } else {
    const onlyOwner: KeysPart = roster.includes('harp') ? 'harp' : 'piano';
    for (const type of typeOrder) arpeggiatorOwnerByType[type] = onlyOwner;
  }
  const harpModeFor = (bar: number): 'bed' | 'roots' => {
    if (!bothParts) return 'bed';
    return harpModeByType[sectionTypeNameAtBar(ctx, bar)] ?? 'roots';
  };

  // §16.6: balanced harp figure rotation over each section type's global
  // two-bar-unit stream. This is harp-only and remains unchanged.
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

  const nearSilenceBars = new Set<number>();
  for (const a of arc) if (a.nearSilence) nearSilenceBars.add(a.bar);

  // The job rotates per section INSTANCE, not per section type. The three-job
  // support/motion/power ring is balanced and cannot repeat adjacently.
  const orderedSections = [...sections].sort((a, b) => a.startBar - b.startBar);
  const basePianoJobs = roster.includes('piano')
    ? orderedSections.map((sec, ordinal) => {
        const type = sec.name.trim().toLowerCase() || '*';
        const owner = arpeggiatorOwnerByType[type] ?? (roster.includes('harp') ? 'harp' : 'piano');
        return {
          sectionId: sec.id,
          sectionName: sec.name,
          startBar: sec.startBar,
          lengthBars: sec.lengthBars,
          job: PIANO_JOB_ROTATION[((take - 1 + ordinal) % PIANO_JOB_ROTATION.length + PIANO_JOB_ROTATION.length) % PIANO_JOB_ROTATION.length],
          arpeggiatorOwner: owner,
          vocalCellAllowed: false,
        };
      })
    : [];
  const vbFigureSections = template.id === 'ensemble.vocalbacking'
    ? basePianoJobs.filter((entry) => isChorusTypeK(entry.sectionName) && entry.lengthBars >= 4)
    : [];
  const vbCellSectionStart = vbFigureSections.length
    ? vbFigureSections[((take - 1) % vbFigureSections.length + vbFigureSections.length) % vbFigureSections.length].startBar
    : -1;
  const pianoJobs: PianoSectionPlan[] = basePianoJobs.map((entry) => ({
    ...entry,
    vocalCellAllowed: template.id === 'ensemble.vocalbacking' && entry.startBar === vbCellSectionStart,
  }));

  const planNormAt = (bar: number): number => {
    const target = arc.find((entry) => entry.bar === bar)?.target ?? 0;
    return clampMax > 0 ? target / clampMax : 0;
  };
  const arrivalByBar = new Map<number, NonNullable<KeysBarPlan['pianoArrival']>>();
  for (const section of orderedSections) {
    const sectionEnd = section.startBar + section.lengthBars - 1;
    for (let phraseStart = section.startBar; phraseStart <= sectionEnd; phraseStart += PIANO_ARRIVAL_PHRASE_BARS) {
      const phraseEnd = Math.min(sectionEnd, phraseStart + PIANO_ARRIVAL_PHRASE_BARS - 1);
      const selectedBar = phraseEnd === bars ? phraseEnd : phraseStart;
      const reason = selectedBar === bars ? 'closingChord'
        : selectedBar === section.startBar && isChorusTypeK(section.name) ? 'chorusDownbeat'
          : selectedBar === section.startBar ? 'sectionStart' : 'phraseStart';
      const moment = momentForBar(moments, selectedBar);
      if (moment?.kind !== 'tutti' && !nearSilenceBars.has(selectedBar)) arrivalByBar.set(selectedBar, reason);
    }
  }

  const preChorusBars = new Set<number>();
  orderedSections.forEach((section, index) => {
    if (isChorusTypeK(orderedSections[index + 1]?.name)) {
      preChorusBars.add(section.startBar + section.lengthBars - 1);
    }
  });
  const isCadenceBar = (bar: number): boolean => {
    const start = (bar - 1) * btBar;
    const end = bar * btBar;
    const tonic = ((project.key % 12) + 12) % 12;
    const dominant = (tonic + 7) % 12;
    for (let i = 1; i < ctx.spans.length; i++) {
      const previous = ctx.spans[i - 1];
      const current = ctx.spans[i];
      const previousRoot = ((previous.parsed.root % 12) + 12) % 12;
      const currentRoot = ((current.parsed.root % 12) + 12) % 12;
      if (current.startTick >= start && current.startTick < end && previousRoot === dominant && currentRoot === tonic) return true;
    }
    return false;
  };
  const punctuationByBar = new Map<number, NonNullable<KeysBarPlan['pianoPunctuation']>>();
  for (const section of orderedSections) {
    const sectionEnd = section.startBar + section.lengthBars - 1;
    for (let phraseStart = section.startBar, phraseIndex = 0; phraseStart <= sectionEnd; phraseStart += PIANO_ARRIVAL_PHRASE_BARS, phraseIndex++) {
      const phraseEnd = Math.min(sectionEnd, phraseStart + PIANO_ARRIVAL_PHRASE_BARS - 1);
      let bar = phraseEnd;
      let reason: NonNullable<KeysBarPlan['pianoPunctuation']> = 'phraseEnd';
      if (template.id !== 'ensemble.vocalbacking') {
        const cadence = Array.from({ length: phraseEnd - phraseStart + 1 }, (_, i) => phraseStart + i).filter(isCadenceBar);
        if (cadence.length) { bar = cadence[cadence.length - 1]; reason = 'cadence'; }
        else if (preChorusBars.has(phraseEnd)) { bar = phraseEnd; reason = 'preChorus'; }
        else if ((template.id === 'ensemble.cinematic' || template.id === 'ensemble.hybridstudio')
          && isChorusTypeK(section.name) && phraseStart + 1 <= phraseEnd) {
          bar = phraseStart + 1;
          reason = 'pump';
        }
      }
      const moment = momentForBar(moments, bar);
      if (arrivalByBar.has(bar) || nearSilenceBars.has(bar) || moment?.kind === 'tutti' || moment?.kind === 'soli' || moment?.kind === 'unison') continue;
      if (planNormAt(bar) >= KEYS_GATES.peak) continue;
      punctuationByBar.set(bar, reason);
    }
  }
  // Chopped-only bars are never scheduled consecutively, even when an odd
  // section length places one phrase-end next to the following section.
  for (const [bar] of [...punctuationByBar].sort((a, b) => a[0] - b[0])) {
    if (punctuationByBar.has(bar - 1)) punctuationByBar.delete(bar);
  }

  const repeatedChordBars = new Set<number>();
  if (template.id === 'ensemble.cinematic' || template.id === 'ensemble.hybridstudio') {
    for (const section of orderedSections) {
      if (!isChorusTypeK(section.name)) continue;
      const sectionJob = pianoJobs.find((job) => job.sectionId === section.id);
      if (sectionJob?.job === 'power') continue;
      const sectionEnd = section.startBar + section.lengthBars - 1;
      const budget = Math.floor(section.lengthBars * PIANO_REPEATED_CHORD_MAX_SHARE + 1e-9);
      const eligible = Array.from({ length: section.lengthBars }, (_, i) => section.startBar + i)
        .filter((bar) => bar <= sectionEnd && !arrivalByBar.has(bar) && !punctuationByBar.has(bar)
          && !nearSilenceBars.has(bar) && planNormAt(bar) >= KEYS_GATES.mid && planNormAt(bar) < KEYS_GATES.peak
          && momentForBar(moments, bar)?.kind !== 'tutti');
      eligible.sort((a, b) => hashString(`piano-repeat:${take}:${section.id}:${a}`) - hashString(`piano-repeat:${take}:${section.id}:${b}`));
      for (const bar of eligible.slice(0, budget)) repeatedChordBars.add(bar);
    }
  }

  // Chorus-entry, outro and tutti glissandos. The harp-only D8 prefix above
  // deliberately retains the old draw count, so these draws remain stable.
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

  const glissByBar = new Map<number, KeysGliss>();
  for (const g of glisses) {
    const startBar = Math.floor(g.startTick / btBar) + 1;
    for (let b = startBar; b <= g.targetBar; b++) glissByBar.set(b, g);
  }

  // Fill bars are not used by the new piano. Retain their old-role meaning
  // only while computing the immutable golden105 beat map below.
  const goldenFillBars = new Set<number>();
  for (const f of fills) {
    if (f.target !== 'piano' && f.target !== 'Keys') continue;
    goldenFillBars.add(Math.floor(f.startTick / btBar) + 1);
  }

  const sectionOrdinalByStart = new Map(orderedSections.map((section, ordinal) => [section.startBar, ordinal]));
  const jobByStart = new Map(pianoJobs.map((section) => [section.startBar, section]));
  const normAtBar = planNormAt;
  const activeFigureBar = (bar: number, ignoreMoments = false): boolean => {
    const sec = sections.find((candidate) => bar >= candidate.startBar && bar < candidate.startBar + candidate.lengthBars);
    if (!sec || !roster.includes('piano')) return false;
    const moment = momentForBar(moments, bar);
    const special: PianoRoleContext['special'] = bar === bars ? 'final' : !ignoreMoments && moment?.kind === 'tutti' ? 'tutti' : null;
    if (special) return false;
    const momentTacet = !ignoreMoments && (moment?.kind === 'soli' || moment?.kind === 'unison');
    const tacet = momentTacet || nearSilenceBars.has(bar);
    return pianoRoleForBar({
      positionInSection: bar - sec.startBar,
      norm: normAtBar(bar),
      energy: normAtBar(bar) * clampMax,
      inChorus: isChorusTypeK(sec.name),
      tacet,
      special,
    }) === 'anchor';
  };
  const phraseHasLowAnchor = (section: PianoSectionPlan, phraseIndex: number): boolean => {
    const first = section.startBar + phraseIndex * PIANO_MOTION_PHRASE_BARS;
    const last = Math.min(section.startBar + section.lengthBars, first + PIANO_MOTION_PHRASE_BARS);
    for (let bar = first; bar < last; bar++) {
      if (activeFigureBar(bar, true) && normAtBar(bar) < KEYS_GATES.mid) return true;
    }
    return false;
  };
  interface PhraseChoice { requested: PianoFigureFamily; family: PianoFigureFamily; yieldedByHarp: boolean }
  const phraseChoices = new Map<string, PhraseChoice>();
  const phraseChoiceFor = (section: PianoSectionPlan, phraseIndex: number): PhraseChoice => {
    const key = `${section.startBar}:${phraseIndex}`;
    const cached = phraseChoices.get(key);
    if (cached) return cached;
    const menu = PIANO_MOTION_MENUS[template.id] ?? PIANO_MOTION_MENUS['ensemble.chamber'];
    const ordinal = sectionOrdinalByStart.get(section.startBar) ?? 0;
    const ringIndex = ((take - 1 + ordinal + phraseIndex) % menu.length + menu.length) % menu.length;
    const requested = menu[ringIndex];
    const allowed = (family: PianoFigureFamily) => {
      if (section.arpeggiatorOwner === 'harp' && PIANO_ARPEGGIATOR_FAMILIES.has(family)) return false;
      if (family === 'ostinatoCell' && template.id === 'ensemble.vocalbacking' && !section.vocalCellAllowed) return false;
      if (family === 'highSparkle' && !phraseHasLowAnchor(section, phraseIndex)) return false;
      return true;
    };
    const options = [...new Set(menu.filter(allowed))];
    const previous = phraseIndex > 0 ? phraseChoices.get(`${section.startBar}:${phraseIndex - 1}`)?.family : undefined;
    const nonRepeating = options.filter((family) => family !== previous);
    const choices = nonRepeating.length ? nonRepeating : options;
    const family = allowed(requested)
      ? requested !== previous || !nonRepeating.length
        ? requested
        : choices[((take - 1 + ordinal + phraseIndex) % choices.length + choices.length) % choices.length]
      : choices.length
        ? choices[((take - 1 + ordinal + phraseIndex) % choices.length + choices.length) % choices.length]
        : 'wideBroken';
    const choice = {
      requested,
      family,
      yieldedByHarp: section.arpeggiatorOwner === 'harp' && PIANO_ARPEGGIATOR_FAMILIES.has(requested),
    };
    phraseChoices.set(key, choice);
    return choice;
  };

  // The denominator is the planned figure grid, not sounding notes. A 4+ bar
  // chorus carries two or more RH figures even when its LH job is support or
  // power; all such bars count independent of moments for the stable 20% cap.
  const hasFigureJob = (section: PianoSectionPlan): boolean =>
    section.job === 'motion' || (isChorusTypeK(section.sectionName) && section.lengthBars >= 4);
  const motionBars = pianoJobs.reduce((sum, section) => sum + (hasFigureJob(section) ? section.lengthBars : 0), 0);
  const upLimit = Math.floor(motionBars * PIANO_UP_MAX_SHARE + 1e-9);
  let upBars = 0;
  // Reserve up-arp slots over the moment-independent potential motion grid.
  // A later figure must not change when moments are toggled on/off.
  let reservedUpBars = 0;
  const pianoRoleCounts: Record<'anchor' | 'answer', number> = { anchor: 0, answer: 0 };
  const barPlans: KeysBarPlan[] = [];
  for (let bar = 1; bar <= bars; bar++) {
    const target = arc.find((entry) => entry.bar === bar)?.target ?? 0;
    const norm = clampMax > 0 ? target / clampMax : 0;
    const level: KeysLevel = levelForNormK(norm);
    const voices: Partial<Record<KeysPart, KeysVoiceKind>> = {};
    const secHere = sections.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
    const inChorus = isChorusTypeK(secHere?.name);
    const secStart = secHere?.startBar ?? 1;
    const sectionPosition = bar - secStart;
    const tex = textureForType(ctx, sectionTypeNameAtBar(ctx, bar));
    const moment = momentForBar(moments, bar);
    const isSoli = moment?.kind === 'soli';
    const isUnison = moment?.kind === 'unison';
    const isTutti = moment?.kind === 'tutti';
    const isNearSilence = nearSilenceBars.has(bar);
    const tacet = isSoli || isNearSilence || isUnison;
    const glissHere = roster.includes('harp') ? glissByBar.get(bar) : undefined;

    if (roster.includes('harp')) {
      if (glissHere) voices.harp = 'gliss';
      else if (bar === bars) voices.harp = 'final';
      else if (isTutti) {
        // The gliss landing may sound on the downbeat; otherwise harp is tacet.
      } else if (!tacet) {
        if (inChorus && norm >= KEYS_GATES.low) voices.harp = harpModeFor(bar) === 'bed' ? 'bed' : 'roots';
        else if ((level === 'low' || level === 'mid') && harpModeFor(bar) === 'bed') voices.harp = 'bed';
        else if (level === 'low') {
          const pizzSparse = tex.style.bassPizz === true || tex.id === 'pizzPulse' || tex.style.ostArticulation === 'pizz';
          if (pizzSparse && phraseStartOf(secStart, bar)) voices.harp = 'roots';
        }
      }
    }

    const special: PianoRoleContext['special'] = bar === bars ? 'final' : isTutti ? 'tutti' : null;
    const pianoRole = roster.includes('piano')
      ? pianoRoleForBar({
          positionInSection: sectionPosition,
          norm,
          energy: norm * clampMax,
          inChorus,
          tacet,
          special,
        })
      : null;
    if (pianoRole) {
      pianoRoleCounts.anchor++;
      if (special === 'final') voices.piano = 'final';
      else if (special === 'tutti') voices.piano = 'tutti';
      else voices.piano = 'anchor';
    }

    const sectionEndBar = secHere ? secHere.startBar + secHere.lengthBars - 1 : bar;
    const sectionEnd = bar === sectionEndBar;
    const energySlope = secHere
      ? energySlopeForBar(bar, secHere.startBar, sectionEndBar, arc, clampMax)
      : 'flat';
    const jobPlan = jobByStart.get(secStart);
    let pianoFigure: PianoFigure | undefined;
    let pianoFigureFamily: PianoFigureFamily | undefined;
    let pianoFigureRole: PianoRoleTag | undefined;
    let pianoFigureYieldedFrom: PianoFigure | undefined;
    let pianoCell: OstinatoCellId | undefined;
    let pianoSparkleTop: 91 | 96 | undefined;
    const pianoPower: KeysBarPlan['pianoPower'] = jobPlan?.job === 'power' && pianoRole === 'anchor' && special === null
      && norm >= KEYS_GATES.low && norm < KEYS_GATES.peak && !repeatedChordBars.has(bar)
      ? (['ensemble.cinematic', 'ensemble.hybridstudio'].includes(template.id) && norm >= KEYS_GATES.high ? 'eighth' : 'quarter')
      : undefined;
    const pianoArrival = pianoRole && (special === null || special === 'final') ? arrivalByBar.get(bar) : undefined;
    const pianoPunctuation = pianoRole === 'anchor' && special === null && !pianoPower && !repeatedChordBars.has(bar)
      ? punctuationByBar.get(bar) : undefined;
    const pianoRepeatedChord = pianoRole === 'anchor' && special === null && !pianoPower && repeatedChordBars.has(bar);
    const phraseStart4 = sectionPosition % PIANO_ARRIVAL_PHRASE_BARS === 0;
    const pianoRarePeak = (template.id === 'ensemble.chamber' || template.id === 'ensemble.sonata')
      && pianoRole === 'anchor' && norm >= KEYS_GATES.peak && phraseStart4
      && hashString(`piano-rare-peak:${take}:${secHere?.id ?? 'none'}:${bar}`) % 12 === 0;

    const barPhraseIndex = Math.floor(sectionPosition / PIANO_MOTION_PHRASE_BARS);
    const preserveVocalCellArrival = !!jobPlan && template.id === 'ensemble.vocalbacking' && jobPlan.vocalCellAllowed
      && phraseChoiceFor(jobPlan, barPhraseIndex).family === 'ostinatoCell';
    const suppressArrivalFigure = arrivalByBar.has(bar) && !preserveVocalCellArrival;
    const potentialMotionBar = !!jobPlan && hasFigureJob(jobPlan) && secHere && !pianoRepeatedChord
      && !suppressArrivalFigure && activeFigureBar(bar, true);
    if (potentialMotionBar && secHere && jobPlan) {
      const phraseIndex = barPhraseIndex;
      const phraseChoice = phraseChoiceFor(jobPlan, phraseIndex);
      let figure: PianoFigure;
      if (phraseChoice.family === 'arpeggio') {
        if (energySlope === 'rising') {
          if (reservedUpBars < upLimit) {
            figure = 'arpUp';
            reservedUpBars++;
          } else {
            figure = 'alberti';
          }
        } else if (energySlope === 'falling') {
          figure = 'arpDown';
        } else {
          // A long chorus needs distinct realized figures across its phrases;
          // use the flat-slope pendulum rather than occasionally repeating
          // Alberti after an adjacent Alberti-family phrase.
          figure = isChorusTypeK(secHere.name) && secHere.lengthBars >= 4
            ? 'arpPendulum'
            : hashString(`piano-flat:${take}:${secHere.id}:${phraseIndex}:${bar}`) % 2 === 0 ? 'arpPendulum' : 'alberti';
        }
      } else {
        figure = phraseChoice.family;
      }

      const renderFigure = pianoRole === 'anchor' && special === null;
      if (renderFigure) {
        if (figure === 'arpUp') upBars++;
        // The harp-owner case swaps only the shared arpeggiator phrase for a
        // non-arpeggiating alternative; the held two-hand anchor never yields.
        // A requested cascade is likewise treated as the section's arpeggiator.
        if (phraseChoice.yieldedByHarp) {
          if (phraseChoice.requested === 'cascade') pianoFigureYieldedFrom = 'cascade';
          else if (phraseChoice.requested === 'arpeggio') {
            const candidate = energySlope === 'rising'
              ? (reservedUpBars < upLimit ? 'arpUp' : undefined)
              : energySlope === 'falling' ? 'arpDown'
                : hashString(`piano-flat:${take}:${secHere.id}:${phraseIndex}:${bar}`) % 2 === 0 ? 'arpPendulum' : undefined;
            if (candidate) pianoFigureYieldedFrom = candidate;
          }
        }

        pianoFigure = figure;
        pianoFigureFamily = phraseChoice.family;
        pianoFigureRole = roleForFigure(figure);
        if (figure === 'ostinatoCell') {
          const requestedCell: OstinatoCellId = template.id === 'ensemble.vocalbacking' ? 'sparse' : tex.style.cell;
          const grid = cellGrid(project.timeSignature, requestedCell, 'eighths');
          pianoCell = template.id !== 'ensemble.vocalbacking' && grid.slots.length < 3 ? 'straight' : requestedCell;
        }
        if (template.id === 'ensemble.vocalbacking') {
          const phraseStart = sectionPosition % PIANO_MOTION_PHRASE_BARS === 0;
          const rarePeak = phraseStart && norm >= KEYS_GATES.peak
            && hashString(`vb-piano-sparkle:${take}:${secHere.id}:${bar}`) % 10 === 0;
          pianoSparkleTop = rarePeak ? 96 : 91;
        }
      }
    }

    barPlans.push({
      bar, level, norm, energySlope, voices,
      ...(sectionEnd ? { sectionEnd: true } : {}),
      ...(jobPlan ? { pianoJob: jobPlan.job, arpeggiatorOwner: jobPlan.arpeggiatorOwner } : {}),
      ...(pianoRole ? { pianoRole } : {}),
      ...(pianoFigure ? { pianoFigure, pianoFigureFamily, pianoFigureRole } : {}),
      ...(pianoFigureYieldedFrom ? { pianoFigureYieldedFrom } : {}),
      ...(pianoCell ? { pianoCell } : {}),
      ...(pianoSparkleTop !== undefined ? { pianoSparkleTop } : {}),
      ...(pianoArrival ? { pianoArrival } : {}),
      ...(pianoPunctuation ? { pianoPunctuation } : {}),
      ...(pianoPower ? { pianoPower } : {}),
      ...(pianoRepeatedChord ? { pianoRepeatedChord: true } : {}),
      ...(pianoRarePeak ? { pianoRarePeak: true } : {}),
      ...(isTutti && !isSoli ? { moment: 'tutti' as const } : isSoli ? { moment: 'soli' as const } : isUnison ? { moment: 'unison' as const } : {}),
    });
  }

  // Reconstruct the beat windows in which golden105 counted piano as a
  // sounding role. This lets the harp's phase-B velocity bound remain pinned
  // while the new held piano adds notes in other windows.
  const spanEndOf = (tick: number): number =>
    (ctx.spans.find((sp) => sp.startTick <= tick && tick < sp.endTick) ?? ctx.spans[0])?.endTick ?? Number.MAX_SAFE_INTEGER;
  const golden105PianoRoleBeats: number[] = [];
  const oldRolePresence = (bar: number, winStart: number): boolean => {
    const planBar = barPlans[bar - 1];
    if (!planBar) return false;
    const m = momentForBar(moments, bar);
    if (m?.kind === 'tutti') {
      const hitLen = m.shape === 'breath' ? beat : m.shape === 'decay' ? beat * 2 : btBar;
      return winStart < (bar - 1) * btBar + hitLen;
    }
    if (bar === bars) return winStart < (bar - 1) * btBar + beat * 2;
    const norm = planBar.norm;
    if (norm < KEYS_GATES.low) return false;
    const sec = sections.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
    const chorus = isChorusTypeK(sec?.name);
    if (m?.kind === 'soli' || m?.kind === 'unison' || nearSilenceBars.has(bar)) return false;
    if (chorus) return true;
    const secStart = sec?.startBar ?? 1;
    const barStart = (bar - 1) * btBar;
    if (goldenFillBars.has(bar)) {
      const chordEnd = Math.min(spanEndOf(barStart), bar * btBar);
      return winStart < chordEnd || winStart >= barStart + 4 * (beat / 2);
    }
    if (GOLDEN105_FIGURE_TEMPLATES.has(template.id)) {
      if (norm < KEYS_GATES.high) return true;
      const oldTex = textureForType(ctx, sectionTypeNameAtBar(ctx, bar));
      return oldTex.id === 'singleOstinato' || oldTex.id === 'interlockingOstinato' || oldTex.id === 'trailer';
    }
    const phraseStart = bar === secStart || (bar - secStart) % 4 === 0;
    if (phraseStart && norm < KEYS_GATES.peak) {
      if (norm < KEYS_GATES.mid) return winStart < Math.min(spanEndOf(barStart), bar * btBar);
      return false;
    }
    return false;
  };
  for (let bar = 1; bar <= bars; bar++) {
    const start = (bar - 1) * btBar;
    for (let off = 0; off < btBar; off += beat) {
      const winStart = start + off;
      if (oldRolePresence(bar, winStart)) golden105PianoRoleBeats.push(winStart);
    }
  }

  const glissLine = glisses.map((g) => `b${g.targetBar}:${g.dir}(${g.source})`).join(',') || 'none';
  const harpModes = Object.entries(harpModeByType).map(([t, mode]) => `${t}=${mode}`).join(',') || 'single-part';
  const ownerLine = Object.entries(arpeggiatorOwnerByType).map(([t, owner]) => `${t}=${owner}`).join(',') || 'single-part';
  const roleCountLine = `anchor=${pianoRoleCounts.anchor}`;
  reports.push(`keys (take ${take}): gates 0.30/0.50/0.72/0.90 of clamp ${clampMax}, piano held body+chord from 0.30 (chorus relief), harp modes ${harpModes}; glissandos ${glissLine} (budget ${GLISS_MAX_PER_PIECE})`);
  reports.push(`keys piano roles (take ${take}): ${roleCountLine} planned bars`);
  if (pianoJobs.length) {
    reports.push(`keys piano energy slope (take ${take}): sign of next ArcBar.target minus current within section; section-end uses current minus previous; flat band ±max(1e-6, 0.5% of clamp ${clampMax})`);
    reports.push(`keys piano jobs (take ${take}, balanced section rotation): ${pianoJobs.map((entry) => `b${entry.startBar}-${entry.startBar + entry.lengthBars - 1}=${entry.job}/${entry.arpeggiatorOwner}${entry.vocalCellAllowed ? '/VB-cell' : ''}`).join(', ')}`);
    reports.push(`keys piano arrivals (take ${take}, four-bar phrase grid): ${barPlans.filter((bar) => bar.pianoArrival).map((bar) => `b${bar.bar}=${bar.pianoArrival}`).join(', ') || 'none'}`);
    reports.push(`keys piano punctuation plan (take ${take}, V-I cadence/phrase end/pre-chorus/pump): ${barPlans.filter((bar) => bar.pianoPunctuation).map((bar) => `b${bar.bar}=${bar.pianoPunctuation}`).join(', ') || 'none'}`);
    reports.push(`keys piano power job (take ${take}; thin at 0.72, tacet at 0.90): ${barPlans.filter((bar) => bar.pianoPower).map((bar) => `b${bar.bar}=${bar.pianoPower}`).join(', ') || 'none'}`);
    reports.push(`keys repeated RH chords (take ${take}, max 15% chorus bars): ${barPlans.filter((bar) => bar.pianoRepeatedChord).map((bar) => `b${bar.bar}`).join(', ') || 'none'}`);
    const mapLine = barPlans.filter((bar) => bar.pianoJob).map((bar) => {
      const figure = bar.pianoFigure ?? '—';
      const yielded = bar.pianoFigureYieldedFrom ? `,yielded:${bar.pianoFigureYieldedFrom}` : '';
      return `b${bar.bar}=${bar.pianoJob}/${figure}${yielded}/${bar.energySlope}`;
    }).join(' ');
    reports.push(`keys piano map (take ${take}, ${PIANO_MOTION_PHRASE_BARS}-bar phrases): ${mapLine}`);
    reports.push(`keys arpeggiator owners (take ${take}): ${ownerLine}`);
    reports.push(`keys piano up-arps (take ${take}): ${upBars}/${motionBars} motion bars, cap ${Math.floor(PIANO_UP_MAX_SHARE * 100)}% (limit ${upLimit})`);
    const harpFigureAtBar = (bar: number): HarpFigure | undefined => {
      const section = sections.find((candidate) => bar >= candidate.startBar && bar < candidate.startBar + candidate.lengthBars);
      const entry = section ? harpFigures.find((candidate) => candidate.startBar === section.startBar) : undefined;
      if (!section || !entry) return undefined;
      const unit = Math.floor((bar - section.startBar) / HARP_FIGURE_UNIT_BARS);
      return entry.figures[Math.min(unit, entry.figures.length - 1)];
    };
    const yielded = barPlans.filter((bar) => bar.pianoFigureYieldedFrom)
      .map((bar) => `b${bar.bar}:harp-${harpFigureAtBar(bar.bar) ?? 'bed'} owns; piano-${bar.pianoFigureYieldedFrom} suppressed -> ${bar.pianoFigure ?? 'support'}`);
    reports.push(`keys piano yields (take ${take}, section-owner collision audit): ${yielded.join(', ') || 'none'}`);
  }
  const firstBars = barPlans.filter((b) => Object.values(b.voices).some((v) => v !== undefined)).slice(0, 12);
  if (firstBars.length) {
    reports.push(`keys plan (take ${take}): roles ${roleCountLine} bars; ${firstBars.map((b) => `b${b.bar}[${b.level}] ${Object.entries(b.voices).map(([p, k]) => p === 'piano' ? `piano:${b.pianoRole ?? k}` : `${p}:${k}`).join(' | ')}`).join(' | ')}`);
  }

  return {
    bars: barPlans, glisses, harpModeByType, arpeggiatorOwnerByType, pianoJobs, harpFigures,
    pianoRoleCounts, pianoMotionStats: { motionBars, upBars, upLimit }, golden105PianoRoleBeats, reports,
  };
}

/** The keys tracks the plan annotates (the conductor's honesty list). */
export function keysPlannedRoles(ctx: OrchestratorContext): KeysPart[] {
  if (!ctx.template) return [];
  return KEYS_PARTS.filter((p) => keysRosterOf(ctx).includes(p));
}
