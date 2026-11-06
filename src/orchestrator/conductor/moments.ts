/**
 * Moments (Phase 7): the rare designed gestures — unison phrase, tutti hit,
 * soli, divisi, imitation. Planned at the CONDUCTOR level, before rendering,
 * deterministically beside the textures (never instead of them): the planner
 * runs on its own salted D8 stream — `hashString('moments')` over the
 * (inputs, take) seed — so the texture draws are untouched byte-for-byte and
 * only the bars a moment covers may change.
 *
 * Budget: weights, not fixed bars. Each kind draws 0–2 occurrences per piece
 * (mostly 0–1); candidates come from the piece's structure (section openings,
 * pre-chorus dips, the peak-chorus entry, the bar after a breath) and must
 * pass the energy reading (a lower-energy bar precedes; nothing lands on the
 * near-silence bar or the final bar; no two moments share bars).
 *
 * Gating by template (the availability table below): unison needs the
 * octaveDoubling policy 'allowed' (D2); tutti needs a real roster; soli and
 * imitation need textures that can carry them; divisi needs pad/tremolo
 * beds. Vocal Backing (pad-only, forbidden doubling) gets nothing. The
 * moment DEFINITION is roster-wide — `participantRoles` names every in-band
 * role, strings are only the first participants (the renderer writes the
 * strings; compose.ts writes the roster hit for the other families).
 *
 * Everything here is an in-memory annotation: never persisted, never stored
 * in the project. Old projects without orchestration are untouched (no
 * compose → no plan → no notes).
 */
import { mulberry32, hashString } from '../../engine/generate';
import { orchestrationSeedFor, type ArcBar, type ResolvedChord, type SpineSection } from '../spine';
import { barTicks, beatTicks, projectBars } from '../../shared/schema/meter';
import { scalePitchClasses } from '../../shared/schema/modes';
import type { Note, OrchestrationState, Project, Track } from '../../shared/schema/types';
import { isInBand } from '../../shared/schema/band';
import type { EnsembleTemplate } from '../../shared/schema/ensembleTemplate';
import { chordAt } from '../lines/motif';
import { voiceLead, type VoicingChord, type VoiceFix, type VoiceSpec, type VoicingOptions } from '../voicing/voiceLead';
import { chordTones } from '../voicing/chordTones';
import { WIND_SOLI_ORDER } from '../winds/profile';
import { STRING_PROFILE_BY_ROLE } from '../profiles/strings';
import type { BreathWindow } from './index';

export type MomentKind = 'unison' | 'tutti' | 'soli' | 'divisi' | 'imitation';

export interface MomentSpanPitch { startTick: number; endTick: number; pitch: number }

/** One planned moment. Bars are inclusive; ticks are clipped to the bars. */
export interface MomentPlan {
  kind: MomentKind;
  startBar: number;
  endBar: number;
  startTick: number;
  endTick: number;
  /** unison: the drawn spread and the texture's lead (the line everyone plays). */
  spread?: 'tight' | 'wide';
  carrierTrackId?: string;
  /** unison: pitch offset per ROLE (resolved from the track at render time). */
  offsetByRole?: Record<string, number>;
  /** tutti: the ROSTER roles that hit together (strings are the first participants). */
  participantRoles?: string[];
  /** tutti: what follows the marcato hit inside the bar. */
  shape?: 'hold' | 'breath' | 'decay';
  /** soli: the carrier plays the motif ('lead') or the bass holds alone ('bass'). */
  flavor?: 'lead' | 'bass';
  /** divisi: the track that splits, and its second line per chord span. */
  divTrackId?: string;
  divSpans?: MomentSpanPitch[];
  /** imitation: the answering voice, its delay and transposition mode. */
  answerTrackId?: string;
  leadTrackId?: string;
  delayTicks?: number;
  transpose?: 'chordTone' | 'diatonic3' | 'diatonic5';
}

/** The moment covering one bar, or null. The renderer's lookup. */
export const momentForBar = (moments: MomentPlan[] | undefined, bar: number): MomentPlan | null =>
  moments?.find((m) => bar >= m.startBar && bar <= m.endBar) ?? null;

/* ---------------- availability (gating by template) ---------------- */

/** Per-template moment availability. Keys are template ids; a template not
 *  listed gets nothing. Data, not code — review is a one-table read. */
export const MOMENT_AVAILABILITY: Record<string, MomentKind[]> = {
  'ensemble.cinematic': ['tutti', 'unison', 'soli', 'divisi'], // the palette has no counterline/handoff: no imitation
  'ensemble.symphony': ['tutti', 'unison', 'soli', 'divisi', 'imitation'],
  'ensemble.hybridstudio': ['tutti', 'unison', 'soli', 'divisi', 'imitation'],
  'ensemble.chamber': ['soli', 'divisi', 'imitation'], // climaxOnly doubling: no unison; 5-player roster: no tutti
  'ensemble.sonata': ['soli', 'imitation'], // forbidden doubling; soloist aesthetic: no tutti/divisi
  'ensemble.vocalbacking': [], // pad-only preset: the vocal owns the moments
};

const LEAD_FREE = /intro|prelude|breakdown|ambient/;
const CHORUS_LIKE = /chorus|refrain|hook|drop/;
const BRIDGE_LIKE = /bridge|middle/;

/* ---------------- planning ---------------- */

export interface MomentPlanInput {
  project: Project;
  template: EnsembleTemplate | null;
  sections: SpineSection[];
  spans: ResolvedChord[];
  arc: ArcBar[];
  /** The conductor's breath windows (a soli may sit right after one). */
  breaths: BreathWindow[];
  /** The texture's role→layer plan for one section type (read-only). */
  texturePlanOf: (typeName: string) => Partial<Record<string, string>>;
  /** In-band unlocked string tracks, bass slot first. */
  stringTracks: Track[];
  take: number;
  /** Phase 8: the brass lead's bars (when the template rosters brass) — no
   *  moment may share a bar with the lead, whose placement is
   *  moments-independent (planned first at the conductor). */
  brassLeadBars?: ReadonlySet<number>;
  /** Phase 9: the wind lead's bars (when the template rosters winds) — the
   *  same contract (planned first at the conductor, moments-independent). */
  windLeadBars?: ReadonlySet<number>;
}

const COUNT_WEIGHTS: Record<MomentKind, [number, number, number]> = {
  //        none  one   two
  tutti: [0.30, 0.45, 0.25], // two = the peak entry AND the first-chorus entry
  unison: [0.20, 0.60, 0.20],
  soli: [0.25, 0.50, 0.25],
  divisi: [0.35, 0.45, 0.20],
  imitation: [0.30, 0.50, 0.20],
};

/** The bars no moment may cover: the near-silence bar and the song's final
 *  bar (the landing chord always sounds; Phase 3.5). */
const forbiddenBars = (arc: ArcBar[], bars: number): Set<number> => {
  const out = new Set<number>([bars]);
  for (const a of arc) if (a.nearSilence) out.add(a.bar);
  return out;
};

/**
 * Plans the take's moments. Pure: same (inputs, take) → the same plan.
 * Kinds are drawn in a fixed order (tutti → unison → soli → divisi →
 * imitation); candidates carry a deterministic shuffle key drawn at build
 * time, so the draw order is stable and no later kind can disturb an
 * earlier one.
 */
export function planMoments(input: MomentPlanInput): MomentPlan[] {
  const { project, template, sections, arc, breaths, texturePlanOf, stringTracks } = input;
  if (!template) return [];
  const available = MOMENT_AVAILABILITY[template.id] ?? [];
  if (!available.length || !stringTracks.length || !arc.length) return [];

  const btBar = barTicks(project.timeSignature);
  const beat = beatTicks(project.timeSignature);
  const bars = projectBars(project);
  const rng = mulberry32((orchestrationSeedFor(project, project.orchestration) ^ Math.imul(hashString('moments'), 0x85ebca6b)) >>> 0);
  const noGo = forbiddenBars(arc, bars);
  for (const b of input.brassLeadBars ?? []) noGo.add(b);
  for (const b of input.windLeadBars ?? []) noGo.add(b);
  const takenBars = new Set<number>();
  const out: MomentPlan[] = [];

  const policy = template.rules.find((r) => r.type === 'octaveDoubling');
  const doublingAllowed = policy !== undefined && (policy.params as { policy?: string }).policy === 'allowed';

  const drawCount = (kind: MomentKind): number => {
    const [w0, w1] = COUNT_WEIGHTS[kind];
    const r = rng();
    return r < w0 ? 0 : r < w0 + w1 ? 1 : 2;
  };

  const trackOfRole = new Map(stringTracks.map((t) => [t.role, t]));
  const sectionEndBar = (sec: SpineSection): number => Math.min(bars, sec.startBar + sec.lengthBars - 1);

  interface Candidate {
    /** The bars the moment would touch, before clipping. */
    first: number;
    maxEnd: number;
    key: number;
    build: () => MomentPlan | null;
  }
  const candidates: { kind: MomentKind; list: Candidate[] }[] = [];

  // ---- tutti: the peak-chorus entry (optionally also the first chorus) ----
  if (available.includes('tutti')) {
    const list: Candidate[] = [];
    const chorusSecs = [...sections].sort((a, b) => a.startBar - b.startBar).filter((s) => CHORUS_LIKE.test(s.name.trim().toLowerCase()));
    const peak = chorusSecs[chorusSecs.length - 1];
    const first = chorusSecs[0];
    const entries: SpineSection[] = [];
    if (peak && peak.startBar > 1) entries.push(peak);
    if (first && peak && first.id !== peak.id && first.startBar > 1) entries.push(first); // the optional second hit
    for (const sec of entries) {
      const entryBar = sec.startBar;
      if (noGo.has(entryBar) || noGo.has(entryBar - 1)) continue;
      // anticipation: at least one lower-energy bar precedes the hit
      if (!((arc[entryBar - 2]?.target ?? 0) < (arc[entryBar - 1]?.target ?? 0))) continue;
      list.push({
        first: entryBar, maxEnd: entryBar, key: rng(),
        build: () => {
          const r = rng();
          const shape = r < 0.5 ? 'hold' : r < 0.8 ? 'decay' : 'breath';
          return {
            kind: 'tutti', startBar: entryBar, endBar: entryBar,
            startTick: (entryBar - 1) * btBar, endTick: entryBar * btBar,
            participantRoles: template.roster.map((r2) => r2.role), shape,
          };
        },
      });
    }
    candidates.push({ kind: 'tutti', list });
  }

  // ---- unison: a section opening, or the bar just before a chorus ----
  if (available.includes('unison') && doublingAllowed) {
    const list: Candidate[] = [];
    for (const sec of sections) {
      const typeKey = sec.name.trim().toLowerCase() || '*';
      if (LEAD_FREE.test(typeKey)) continue; // the motif arrives with the first phrase
      const plan = texturePlanOf(typeKey);
      const leadRole = Object.keys(plan).find((r) => plan[r] === 'lead');
      const carrier = leadRole ? trackOfRole.get(leadRole) : undefined;
      if (!carrier) continue; // no lead in this texture: nothing to unify on
      const openings: { bar: number; maxEnd: number }[] = [];
      if (sec.startBar > 1 && !noGo.has(sec.startBar)) openings.push({ bar: sec.startBar, maxEnd: sectionEndBar(sec) });
      if (CHORUS_LIKE.test(typeKey) && sec.startBar > 1 && !noGo.has(sec.startBar - 1)) {
        openings.push({ bar: sec.startBar - 1, maxEnd: sectionEndBar(sec) }); // flows into the chorus
      }
      for (const { bar, maxEnd } of openings) {
        // a lower-energy bar precedes the moment's peak
        const peakTarget = Math.max(...Array.from({ length: 4 }, (_, i) => arc[bar - 1 + i]?.target ?? 0));
        if (!((arc[bar - 2]?.target ?? 0) < peakTarget)) continue;
        list.push({
          first: bar, maxEnd, key: rng(),
          build: () => {
            const wide = rng() < 0.5;
            const offsets: Record<string, number> = { violins1: 0, violins2: 0, violas: -12, cellosBasses: -12 };
            if (wide) {
              if (rng() < 0.5) offsets.violins2 = -12;
              offsets.cellosBasses = -24;
            }
            return {
              kind: 'unison', spread: wide ? 'wide' : 'tight',
              startBar: bar, endBar: bar, startTick: (bar - 1) * btBar, endTick: bar * btBar,
              carrierTrackId: carrier.id, offsetByRole: offsets,
            };
          },
        });
      }
    }
    candidates.push({ kind: 'unison', list });
  }

  // ---- soli: bridges and intros (bass flavor), or the bar after a breath ----
  if (available.includes('soli')) {
    const list: Candidate[] = [];
    const starts: { bar: number; maxEnd: number; typeKey: string }[] = [];
    for (const sec of sections) {
      const typeKey = sec.name.trim().toLowerCase() || '*';
      if (BRIDGE_LIKE.test(typeKey) || LEAD_FREE.test(typeKey)) starts.push({ bar: sec.startBar, maxEnd: sectionEndBar(sec), typeKey });
    }
    for (const b of breaths) {
      const afterBar = Math.floor(b.endTick / btBar) + 1;
      if (afterBar > bars) continue;
      const sec = sections.find((s) => afterBar >= s.startBar && afterBar < s.startBar + s.lengthBars);
      if (sec) starts.push({ bar: afterBar, maxEnd: sectionEndBar(sec), typeKey: sec.name.trim().toLowerCase() || '*' });
    }
    const seen = new Set<number>();
    for (const { bar, maxEnd, typeKey } of starts) {
      if (seen.has(bar) || noGo.has(bar) || bar > bars - 1) continue;
      seen.add(bar);
      list.push({
        first: bar, maxEnd, key: rng(),
        build: () => {
          const leadAllowed = !LEAD_FREE.test(typeKey);
          const flavor: 'lead' | 'bass' = leadAllowed && rng() < 0.6 ? 'lead' : 'bass';
          let carrierTrackId: string;
          if (flavor === 'bass') {
            carrierTrackId = (trackOfRole.get('cellosBasses') ?? stringTracks[0]).id;
          } else {
            // Phase 8: a horn soli is allowed — horns join the pool when the
            // template rosters them (the renderer hands the line to the brass
            // module; the strings rest under it). Templates without brass
            // keep the exact Phase 7 pool and draws (byte-identical moments).
            const pool = ['violas', 'cellosBasses', 'violins1'].map((r) => trackOfRole.get(r)).filter((t): t is Track => !!t);
            const hornInRoster = template.roster.some((r) => r.role === 'horns');
            const hornTrack = hornInRoster
              ? project.tracks.find((t) => t.role === 'horns' && !t.locked && isInBand(t.role, project.ensemble ?? { templateId: null, overrides: {}, pins: {} }, template))
              : undefined;
            // Phase 9: a wind soli is allowed — the first rostered of oboes,
            // clarinets, flutes joins the pool the same way (the renderer
            // hands the line to the winds module) — but NOT on a chorus-type
            // candidate: a wind solo replacing a string solo at a chorus
            // entry would thin the chorus (the addendum's chorus-mean rule),
            // so chorus-entry solis keep the exact prior pool and draws.
            // Templates without a wind roster keep them everywhere.
            const windPart = !CHORUS_LIKE.test(typeKey)
              ? WIND_SOLI_ORDER.find((p) => template.roster.some((r) => r.role === p))
              : undefined;
            const windTrack = windPart
              ? project.tracks.find((t) => t.role === windPart && t.family === 'Woodwinds' && !t.locked && isInBand(t.role, project.ensemble ?? { templateId: null, overrides: {}, pins: {} }, template))
              : undefined;
            const withHorn = hornTrack ? [...pool, hornTrack] : pool;
            const full = windTrack ? [...withHorn, windTrack] : withHorn;
            carrierTrackId = (full[Math.floor(rng() * full.length)] ?? stringTracks[0]).id;
          }
          return {
            kind: 'soli', flavor, carrierTrackId,
            startBar: bar, endBar: bar, startTick: (bar - 1) * btBar, endTick: bar * btBar,
          };
        },
      });
    }
    candidates.push({ kind: 'soli', list });
  }

  // ---- divisi: chorus/peak pads or tremolo beds ----
  if (available.includes('divisi')) {
    const list: Candidate[] = [];
    const divPool = ['violins1', 'violins2', 'violas', 'cellosBasses'];
    for (const sec of sections) {
      const typeKey = sec.name.trim().toLowerCase() || '*';
      if (!CHORUS_LIKE.test(typeKey)) continue;
      const plan = texturePlanOf(typeKey);
      const tracks = divPool
        .map((r) => trackOfRole.get(r))
        .filter((t): t is Track => !!t && ['pad', 'tremolo'].includes((plan[t.role] ?? 'pad') as string));
      if (!tracks.length) continue;
      const startBar = sec.startBar + 1; // the chorus establishes first
      if (startBar > bars - 1 || noGo.has(startBar)) continue;
      list.push({
        first: startBar, maxEnd: sectionEndBar(sec), key: rng(),
        build: () => {
          const divTrack = tracks[Math.floor(rng() * tracks.length)];
          return {
            kind: 'divisi', divTrackId: divTrack.id,
            startBar, endBar: startBar, startTick: (startBar - 1) * btBar, endTick: startBar * btBar,
          };
        },
      });
    }
    candidates.push({ kind: 'divisi', list });
  }

  // ---- imitation: verses/bridges in textures with a counterline or handoff ----
  if (available.includes('imitation')) {
    const list: Candidate[] = [];
    for (const sec of sections) {
      const typeKey = sec.name.trim().toLowerCase() || '*';
      if (!(/verse|strophe/.test(typeKey) || BRIDGE_LIKE.test(typeKey))) continue;
      const plan = texturePlanOf(typeKey);
      const counterRole = Object.keys(plan).find((r) => plan[r] === 'counterline');
      const leadRole = Object.keys(plan).find((r) => plan[r] === 'lead');
      const handoff = leadRole !== undefined && leadRole !== 'violins1';
      if (!counterRole && !handoff) continue;
      // the answer sits BELOW the lead (it replays the material transposed
      // down): the topmost string voice strictly under the lead's register
      // slot — the counterline track when the texture has one, else the
      // nearest lower voice. A lead with no lower voice gets no imitation.
      const leadSlot = leadRole ? STRING_PROFILE_BY_ROLE.get(leadRole)?.slot ?? 'inner' : 'top';
      const slotOrder = { bass: 0, inner: 1, top: 2 } as const;
      let answer: Track | undefined;
      if (counterRole) {
        const c = trackOfRole.get(counterRole);
        const cSlot = STRING_PROFILE_BY_ROLE.get(counterRole)?.slot ?? 'inner';
        if (c && slotOrder[cSlot] < slotOrder[leadSlot]) answer = c;
      } else {
        const lower = stringTracks.filter((t) => {
          const s = STRING_PROFILE_BY_ROLE.get(t.role)?.slot ?? 'inner';
          return slotOrder[s] < slotOrder[leadSlot] && plan[t.role] !== 'ostinato' && plan[t.role] !== 'tremolo';
        });
        answer = lower[lower.length - 1]; // the topmost voice strictly under the lead
      }
      if (!answer) continue;
      const startBar = sec.startBar;
      if (noGo.has(startBar) || startBar > bars - 1) continue;
      const leadTrackId = leadRole ? trackOfRole.get(leadRole)?.id : undefined;
      if (!leadTrackId) continue;
      list.push({
        first: startBar, maxEnd: sectionEndBar(sec), key: rng(),
        build: () => {
          const r = rng();
          const mode = r < 0.4 ? 'chordTone' : r < 0.75 ? 'diatonic3' : 'diatonic5';
          const delayTicks = rng() < 0.6 ? beat * (1 + Math.floor(rng() * 2)) : btBar;
          return {
            kind: 'imitation', answerTrackId: answer.id, leadTrackId, transpose: mode, delayTicks,
            startBar, endBar: startBar, startTick: (startBar - 1) * btBar, endTick: startBar * btBar,
          };
        },
      });
    }
    candidates.push({ kind: 'imitation', list });
  }

  // ---- pick: fixed kind order, deterministic shuffle, no shared bars ----
  for (const { kind, list } of candidates) {
    const count = drawCount(kind);
    if (!count || !list.length) continue;
    const shuffled = [...list].sort((a, b) => a.key - b.key);
    let placed = 0;
    for (const cand of shuffled) {
      if (placed >= count) break;
      const endBar = Math.min(cand.maxEnd, cand.first + 3); // moments are 2–4 bars (tutti: 1)
      if (endBar < cand.first) continue;
      let clash = false;
      for (let b = cand.first; b <= endBar; b++) if (takenBars.has(b) || noGo.has(b)) { clash = true; break; }
      if (clash) continue;
      const m = cand.build();
      if (!m) continue;
      m.startBar = cand.first;
      m.endBar = m.kind === 'tutti' ? cand.first : Math.max(cand.first + 1, endBar); // at least 2 bars
      m.startTick = (m.startBar - 1) * btBar;
      m.endTick = m.endBar * btBar;
      out.push(m);
      for (let b = m.startBar; b <= m.endBar; b++) takenBars.add(b);
      placed++;
    }
  }
  return out.sort((a, b) => a.startBar - b.startBar || a.kind.localeCompare(b.kind));
}

/* ---------------- divisi second line (scoped mini-DP) ---------------- */

/**
 * Resolves one divisi moment's second line: a scoped run of THE global
 * voicing DP over just the moment's chord spans, with the part contributing
 * TWO voices — the parent pinned to the main run's pitch (VoiceFix 'pitch'),
 * the second line constrained to a distinct chord tone strictly below it
 * (VoiceFix 'below'). The main run is untouched — its voice list, stream and
 * constraints are exactly what they would be without the moment, so voicings
 * outside the moment's bars stay byte-identical. Spans where no distinct
 * tone fits simply get no second line (the parent line continues).
 */
export function resolveDivisiSpans(
  project: Project,
  spans: ResolvedChord[],
  moment: MomentPlan,
  divTrack: Track,
  parentPitches: { startTick: number; endTick: number; pitch: number }[],
): MomentSpanPitch[] {
  if (!parentPitches.length) return [];
  const scale = scalePitchClasses(project.key, project.mode);
  const lt = ((project.key % 12) + 11) % 12;
  const leadingTonePc = scale.includes(lt) ? lt : null;
  const opts: VoicingOptions = {
    forbidOctaveDoubling: true, // the second line is a distinct tone by construction
    leadingTonePc,
    checkParallels: !/whole tone|diminished|locrian/i.test(project.mode),
    openSpacing: false,
    zoneFree: null,
    // the moment's own stream — decorrelated from every other draw (D8)
    rng: mulberry32((orchestrationSeedFor(project, project.orchestration) ^ Math.imul(hashString(`moments-div:${moment.startBar}:${moment.divTrackId ?? ''}`), 0x85ebca6b)) >>> 0),
  };
  const mid = Math.floor((divTrack.lowestNote + divTrack.highestNote) / 2);
  const spec = (lowerHalf: boolean): VoiceSpec => ({
    trackId: divTrack.id, role: divTrack.role,
    low: divTrack.lowestNote, high: divTrack.highestNote,
    comfortable: lowerHalf ? [divTrack.lowestNote, mid] : [mid, divTrack.highestNote],
    isBass: false,
  });
  const chords: VoicingChord[] = [];
  for (const pp of parentPitches) {
    const span = spans.find((s) => s.startTick < pp.endTick && s.endTick > pp.startTick);
    if (!span) continue;
    const fixes: (VoiceFix | undefined)[] = [{ kind: 'below', pitch: pp.pitch }, { kind: 'pitch', pitch: pp.pitch }];
    chords.push({ id: `${pp.startTick}`, startTick: pp.startTick, endTick: pp.endTick, ct: chordTones(span.parsed), fixed: fixes });
  }
  if (!chords.length) return [];
  const voiced = voiceLead(chords, [spec(true), spec(false)], opts);
  const out: MomentSpanPitch[] = [];
  voiced.forEach((vc, i) => {
    const p = vc.pitches[0];
    if (p !== null) out.push({ startTick: chords[i].startTick, endTick: chords[i].endTick, pitch: p });
  });
  return out;
}

/* ---------------- imitation answer ---------------- */

export interface ImitationInput {
  project: Project;
  spans: ResolvedChord[];
  /** The lead's notes over the moment bars. */
  lead: Note[];
  answerTrack: Track;
  startTick: number;
  endTick: number;
  delayTicks: number;
  mode: 'chordTone' | 'diatonic3' | 'diatonic5';
  take: number;
}

/** The derived leading-tone rule (same as the voicer's): semitone below the tonic when the scale holds it. */
const leadingTonePcOf = (key: number, scale: number[]): number | null => {
  const lt = ((key % 12) + 11) % 12;
  return scale.includes(lt) ? lt : null;
};

/**
 * The imitation answer (Phase 7): the lead's motif material replayed
 * `delayTicks` later in the answer voice, transposed down a diatonic third
 * or fifth, or onto the chord tones — an answer, not a canon. The lead's
 * rhythm is kept note for note (clipped at the moment's end); the answer
 * never doubles the lead's leading tone and never rises above the lead
 * where both sound. Runs on its OWN salted stream: the free counterline's
 * draws are untouched (it is generated as usual and the imitation bars'
 * notes replace it afterwards).
 */
export function imitationAnswer(input: ImitationInput): Note[] {
  const { project, spans, lead, answerTrack, startTick, endTick, delayTicks, mode, take } = input;
  const scale = scalePitchClasses(project.key, project.mode);
  const scaleLen = scale.length;
  const tonicPc = ((scale[0] % 12) + 12) % 12;
  const ltPc = leadingTonePcOf(project.key, scale);
  const seed = (orchestrationSeedFor(project, { take } as OrchestrationState) ^ Math.imul(hashString('imitation'), 0x85ebca6b)) >>> 0;
  void seed; // reserved for future shape draws; the answer itself is fully deterministic
  const pcOfDegree = (d: number) => ((scale[(((d % scaleLen) + scaleLen) % scaleLen)] % 12) + 12) % 12;
  const anchor = [40, 52, 64, 76]
    .map((p) => p - ((((p - tonicPc) % 12) + 12) % 12))
    .reduce((best, p) => (Math.abs(p - 52) < Math.abs(best - 52) ? p : best));
  const degreePitch = (d: number): number => anchor + 12 * Math.floor(d / scaleLen) + (((pcOfDegree(d) - tonicPc) + 12) % 12);
  const degreeOfPitch = (p: number): number | null => {
    const pc = ((p % 12) + 12) % 12;
    const idx = scale.findIndex((s) => ((s % 12) + 12) % 12 === pc);
    return idx < 0 ? null : idx;
  };
  const fitOctave = (p: number): number => {
    let pitch = p;
    while (pitch > answerTrack.highestNote && pitch - 12 >= answerTrack.lowestNote) pitch -= 12;
    while (pitch < answerTrack.lowestNote && pitch + 12 <= answerTrack.highestNote) pitch += 12;
    return Math.min(answerTrack.highestNote, Math.max(answerTrack.lowestNote, pitch));
  };

  const sorted = [...lead].sort((a, b) => a.startTick - b.startTick);
  const leadAt = (tick: number): Note | null => sorted.find((n) => n.startTick <= tick && tick < n.startTick + n.durationTicks) ?? null;
  const out: Note[] = [];
  let prevInterval: number | null = null;

  for (const n of sorted) {
    const t = n.startTick + delayTicks;
    if (t < startTick || t >= endTick) continue;
    let pitch: number | null = null;
    if (mode === 'chordTone') {
      const chord = chordAt(spans, t);
      if (chord) {
        const target = n.pitch - 5; // roughly a fourth below, chord-tone snapped
        const cands: number[] = [];
        for (const pc of new Set(chord.parsed.pitchClasses)) {
          const off = (((pc - answerTrack.lowestNote) % 12) + 12) % 12;
          for (let p = answerTrack.lowestNote + off; p <= answerTrack.highestNote; p += 12) cands.push(p);
        }
        const leadNow0 = leadAt(t);
        const ok = cands.filter((p) => p <= n.pitch - 2
          && !(ltPc !== null && leadNow0 !== null && ((leadNow0.pitch % 12) + 12) % 12 === ltPc && ((p % 12) + 12) % 12 === ltPc));
        if (ok.length) pitch = ok.reduce((best, p) => (Math.abs(p - target) < Math.abs(best - target) ? p : best));
      }
    } else {
      const d = degreeOfPitch(n.pitch);
      if (d !== null) {
        const step = mode === 'diatonic3' ? -2 : -4; // down a diatonic third / fifth
        pitch = fitOctave(degreePitch(d + step));
      }
    }
    if (pitch === null) continue; // nothing fits: the answer rests here
    const leadNow = leadAt(t);
    // stay under the lead where both sound — always, at any register
    while (leadNow && pitch > leadNow.pitch - 2) {
      pitch -= 12;
      if (pitch < answerTrack.lowestNote) { pitch = null; break; }
    }
    if (pitch === null) continue;
    // soft parallel remedy: one semitone aside against consecutive 5ths/8ves
    if (leadNow && prevInterval !== null) {
      const iv = ((((leadNow.pitch - pitch) % 12) + 12) % 12);
      if ((iv === 0 || iv === 7) && iv === prevInterval) {
        const nudged = pitch - 1 <= answerTrack.lowestNote ? pitch + 1 : pitch - 1;
        if (nudged >= answerTrack.lowestNote && nudged <= answerTrack.highestNote && ((((leadNow.pitch - nudged) % 12) + 12) % 12) !== iv) pitch = nudged;
      }
    }
    const duration = Math.max(1, Math.min(n.durationTicks, endTick - t));
    out.push({ pitch, startTick: t, durationTicks: duration, velocity: 74, articulation: 'legato' });
    prevInterval = leadNow ? ((((leadNow.pitch - pitch) % 12) + 12) % 12) : null;
  }
  return out;
}
