/**
 * Keys renderer (Phase 11, spec §16). Realises the planner's per-bar voice
 * kinds AFTER the percussion renderer, so the velocity math sees every other
 * family's notes: every keys note's velocity is shaped by its bar's arc norm
 * and capped by the governor bound of the beat window it attacks in
 * (mean ≤ 127·clampMax·N/roles) — the same invariant the strings, brass,
 * winds and percussion obey, so a keys figure can never push a window over
 * the hard clamp. A final safety pass (governKeysVelocities) re-checks the
 * windows after the strings' humanize/legato and lowers KEYS ALONE if
 * anything moved.
 *
 * One voice per track (§16.1): every kind writes a single sequential line —
 * the bed and the arpeggio cycle the chord tones, each note ending at the
 * next onset; the comping, the pulse and the tutti hit are single downbeat
 * notes; the glissando is a 16th run. No chords anywhere, so the note
 * `layer` field is never generalised. Figures are STATELESS per bar (the
 * cycle restarts from the bar's own chord), so no moment needs a ghost run.
 *
 * Registers (§16.2, §16.2a): the bed and the arpeggio write inside the sweet
 * spot (harp 36-91, piano 62-84 — Phase 11.1 raised the piano's window:
 * the right-hand material is centred in 62-84 with the chord's top voice
 * around 72-84) over about two octaves of chord tones; the low plucked
 * roots, the low octave pulse and the tutti hits fold into the low
 * register; a glissando may use the extreme octaves; the piano's comp
 * material checks the strings' register in the same bar (a candidate in
 * the octave band holding the violas'/cellos' median pitch moves up). The
 * config hard range (the track's own lowestNote/highestNote) always wins.
 * In vocalbacking the vocal zone (A3..A5 sounding, the D6 default the
 * strings already keep free) stays free of both parts: a harp note that
 * would land in it moves by octave (down first, then up) and a note that
 * cannot move out of the zone inside the track's range is dropped; the
 * PIANO (Phase 11.1) builds its material zone-free by construction — the
 * sparkle register above the zone (82-96) or the low root/fifth below it
 * (40-56) — and its zone shift, as a last resort, moves UP first: never
 * an octave-down fallback for chords or arpeggios.
 *
 * Ring and damping (§16.6): a harp note is capped at about one bar; no
 * keys note rings across a near-silence bar or a soli (the hits are
 * shortened — damping as composition, the percussion rule). Glissandos are
 * stored as plain notes with no new articulation; the tutti hit is
 * 'marcato'; everything else is unmarked. No CC lane reaches a keys track
 * (the generator writes none today; the module adds none — no sustain
 * pedal, §16.7).
 *
 * Micro-timing (§16.7) is applied LAST: a hash-seeded lag in the part's ms
 * range (harp +0..8 ms, piano +4..12 ms — always late), stored in the notes
 * so the preview and the export show the same offsets; a note never crosses
 * its bar or a moment boundary because of the jitter (the start clamps
 * inside the written bar, the end stays where the figure put it).
 */
import { chordTones } from '../voicing/chordTones';
import { scalePitchClasses } from '../../shared/schema/modes';
import { PPQ, isInstrumentTrack, type Note, type Project, type Track } from '../../shared/schema/types';
import { barTicks, beatTicks, projectBars } from '../../shared/schema/meter';
import { hashString, sanitizeNotes } from '../../engine/generate';
import { msToTicks } from '../spine';
import { maxMeanVelocityFor } from '../energy';
import { momentForBar } from '../conductor/moments';
import { inVocalZone } from '../profiles/strings';
import { sectionTypeNameAtBar, textureForType } from '../conductor/layers';
import type { OrchestratorContext } from '../module';
import {
  HARP_FIGURE_UNIT_BARS, KEYS_GATES, KEYS_PARTS, KEYS_PROFILES, PIANO_ARP_TEMPLATES, PIANO_CONCURRENCY,
  PIANO_HAND_GAP, PIANO_LH, PIANO_RH, PIANO_SPARKLE_CAP, PIANO_SPARKLE_FLOOR,
  VB_LOW, VB_SPARKLE, VB_SPARKLE_TOP, isChorusTypeK, keysRosterOf,
  type HarpFigure, type KeysPart, type PianoFigure,
} from './profile';
import type { KeysPlan } from './plan';

/** §16.4 velocity shaping: the ordinary notes shape against the MUSICAL
 *  ceiling (84 — the generator's keys band topped out there; the window
 *  bound alone is not a target), capped by the window bound. The chorus
 *  relief rides the ABSOLUTE relief velocity (the percussion drive's rule,
 *  §15.4a: the drive line never rides the window bound — the bound is
 *  moments-dependent and the block chord it replaces sat ABOVE the shaped
 *  level); the hard clamp stays with governKeysVelocities, which lowers
 *  KEYS ALONE where a real breach appears (§16.8). */
export const KEYS_VELOCITY_CEILING = 84;
export const RELIEF_VELOCITY = 92;
/** §16.3 the comping chord: the main voice + its 'kbd' sisters (the
 *  one-voice cap's sanctioned chord relaxation — the div2 precedent). */
export const COMP_CHORD_VOICES = 5;

interface KeysCandidate {
  pitch: number;
  startTick: number;
  durationTicks: number;
  articulation?: Note['articulation'];
  /** Moment notes (tutti) ride the whole-roster cap shape. */
  moment?: boolean;
  /** The gliss run's ramp position (0..1) — the run crescendos into its landing. */
  ramp?: number;
  /** The comping chord's additional voice (the one-voice cap's sanctioned
   *  chord relaxation — the div2 precedent, §16.1). */
  layer?: Note['layer'];
  /** The chorus relief's intensity rule: the relief notes ride
   *  max(shaped, RELIEF_INTENSITY_FLOOR) capped at the window bound (§16.4). */
  relief?: boolean;
  /** §16.4 (11.4): the candidate is NEW keys presence (the mid-energy
   *  comping) — the other families' caps were computed without a keys role
   *  in these windows, so the piano absorbs any clamp excess ITSELF in
   *  phase B (the absorption pass below) and the final safety pass never
   *  fires there — the harp's bytes stay on golden103. */
  absorb?: boolean;
  /** §16.6 (11.5): the high-octave dry pluck sparkle softens at low energy
   *  (the shaped velocity scales by 0.7 below the mid gate). */
  soft?: boolean;
  /** §16.5 (11.5): a relief note's own scale of the relief velocity (the
   *  top-voice line's "lower velocity" — 0.95 keeps it under the held
   *  chord's 92 while the chorus mean stays at the relief's level). */
  velScale?: number;
  /** The phase-B velocity (shaped, then absorption-capped). */
  v?: number;
  /** §16.9 (11.6): the concurrency-cap priority — 2 = the held body/chord
   *  (culled last), 1 = the figures (culled first). */
  priority?: number;
  /** §16.9 (11.6): dropped by the retrigger dedupe or the cap. */
  drop?: boolean;
  /** §16.9 (11.6): the L2 figure the candidate realises (the audit trail). */
  fig?: PianoFigure;
}

const pcOf = (p: number): number => ((p % 12) + 12) % 12;

type PianoJobPlan = KeysPlan['pianoJobs'][number];

export interface KeysRenderInput {
  ctx: OrchestratorContext;
  plan: KeysPlan;
  /** The strings module's notes by track id (window math). */
  stringsNotes: Record<string, Note[]>;
  /** The rendered brass notes by track id (window math). */
  brassNotes: Record<string, Note[]>;
  /** The rendered wind notes by track id (window math). */
  windNotes: Record<string, Note[]>;
  /** The rendered percussion notes by track id (window math). */
  percNotes: Record<string, Note[]>;
  /** The rules generator's notes by role for roles no module owns
   *  (window math; the keys' own phantom is NOT here — it is replaced). */
  ruleNotes: { role: string; notes: Note[] }[];
}

export interface KeysRenderResult {
  notesByTrackId: Record<string, Note[]>;
  reports: string[];
  /** §16.4 (11.4): the beat windows holding the NEW mid-energy comping —
   *  the piano's absorption pass in compose.ts (post-humanize, the same
   *  state the keys safety pass reads) caps the PIANO ALONE inside them so
   *  the final safety pass never fires there and the harp's bytes stay on
   *  golden103. */
  absorbWindows: { start: number; end: number }[];
}

export function renderKeys(input: KeysRenderInput): KeysRenderResult {
  const { ctx, plan, stringsNotes, brassNotes, windNotes, percNotes, ruleNotes } = input;
  const { project, template } = ctx;
  const notesByTrackId: Record<string, Note[]> = {};
  const reports: string[] = [];
  // every rostered keys track is CLAIMED up front (an empty list when the
  // part never sounds) — the generator's phantom keys notes must never
  // reach the final score through the assembly's generator fallback
  const roster = keysRosterOf(ctx);
  const trackOf = new Map<KeysPart, Track>();
  for (const part of roster) {
    const t = ctx.project.tracks.find((x) => x.role === part && x.family === 'Keys' && isInstrumentTrack(x) && !x.locked);
    if (t) {
      trackOf.set(part, t);
      notesByTrackId[t.id] = [];
    }
  }
  if (!template || !plan.bars.length || !ctx.spans.length) return { notesByTrackId, reports, absorbWindows: [] };

  const btBar = barTicks(project.timeSignature);
  const beat = beatTicks(project.timeSignature);
  const eighth = PPQ / 2;
  const sixteenth = PPQ / 4;
  const bars = projectBars(project);
  const endTick = bars * btBar;
  const clampMax = template.budget.energyClamp[1];
  const N = template.roster.length;
  const scale = scalePitchClasses(project.key, project.mode);
  const scalePcs = new Set(scale.map((pc) => ((pc % 12) + 12) % 12));
  const zoneFree = template.id === 'ensemble.vocalbacking';
  const planByBar = new Map(plan.bars.map((b) => [b.bar, b]));
  const glissByBar = new Map<number, KeysPlan['glisses'][number]>();
  for (const g of plan.glisses) {
    const startBar = Math.floor(g.startTick / btBar) + 1;
    for (let b = startBar; b <= g.targetBar; b++) glissByBar.set(b, g);
  }

  const momentVelocity = (bar: number): number => {
    const E = Math.min(clampMax, Math.max(0, ctx.arc?.[bar - 1]?.target ?? 0));
    const capAll = maxMeanVelocityFor(N, clampMax, N);
    return Math.max(1, Math.min(capAll, Math.round(1 + (capAll - 1) * E)));
  };
  const spanAt = (tick: number) =>
    ctx.spans.find((sp) => sp.startTick <= tick && tick < sp.endTick) ?? ctx.spans[0];
  /** §16.5 (11.5) the harmonic span's end at a tick — the held notes'
   *  sustain target (the bar line caps it, at most 1 bar). */
  const spanEndOf = (tick: number): number => {
    const sp = spanAt(tick);
    return sp ? sp.endTick : Number.MAX_SAFE_INTEGER;
  };

  // the tacet starts (bar-aligned): damping boundaries — no keys note rings
  // across a near-silence bar or a soli moment (§16.6)
  const tacetStarts: number[] = [];
  for (let bar = 1; bar <= bars; bar++) {
    const m = momentForBar(ctx.moments, bar);
    const near = ctx.arc?.[bar - 1]?.nearSilence;
    if (m?.kind === 'soli' || near) tacetStarts.push((bar - 1) * btBar);
  }
  const dampingEnd = (start: number): number => {
    let end = endTick;
    for (const t of tacetStarts) {
      if (t > start && t < end) end = t;
    }
    return end;
  };

  /** The chord's tone pitch classes (any tier) at a tick. */
  const chordPcsAt = (tick: number): { pcs: Set<number>; rootPc: number } => {
    const sp = spanAt(tick);
    const ct = chordTones(sp.parsed);
    const rootTone = ct.tones.find((t) => t.tier === 'root');
    const rootPc = (((rootTone?.pc ?? ct.bassPc) % 12) + 12) % 12;
    const pcs = new Set<number>([...ct.tones.map((t) => ((t.pc % 12) + 12) % 12), rootPc]);
    return { pcs, rootPc };
  };

  /** The lowest pitch in [lo, hi] carrying the pitch class (null when the
   *  window is narrower than an octave and misses it). */
  const foldPc = (pc: number, lo: number, hi: number): number | null => {
    for (let p = Math.max(0, lo); p <= hi; p++) if (pcOf(p) === pc) return p;
    return null;
  };

  /** The vocal-zone displacement (vocalbacking only): a note that would
   *  land in the zone moves by octave — DOWN first, then up — and a note
   *  that cannot move out of the zone inside the track's range is dropped.
   *  The PIANO passes upFirst (§16.2a): its material is built zone-free by
   *  construction, and the last-resort shift moves UP first — never an
   *  octave-down fallback for chords or arpeggios. The harp's behaviour is
   *  unchanged. */
  const zoneShift = (pitch: number, lo: number, hi: number, upFirst = false): number | null => {
    if (!zoneFree || !inVocalZone(pitch)) return pitch;
    if (upFirst) {
      let p = pitch;
      while (inVocalZone(p) && p + 12 <= hi) p += 12;
      if (!inVocalZone(p)) return p;
      p = pitch;
      while (inVocalZone(p) && p - 12 >= lo) p -= 12;
      if (!inVocalZone(p)) return p;
      return null;
    }
    let p = pitch;
    while (inVocalZone(p) && p - 12 >= lo) p -= 12;
    if (!inVocalZone(p)) return p;
    p = pitch;
    while (inVocalZone(p) && p + 12 <= hi) p += 12;
    if (!inVocalZone(p)) return p;
    return null;
  };

  /* ---------- §16.9 helpers (Phase 11.6, piano from scratch) -------------- */

  // the drawn JOB per section instance (the plan's balanced rotation)
  const jobByStart = new Map<number, PianoJobPlan>(plan.pianoJobs.map((e) => [e.startBar, e]));
  const jobOfBar = (bar: number): PianoJobPlan | null => {
    const sec = ctx.sections.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
    if (!sec) return null;
    return jobByStart.get(sec.startBar) ?? null;
  };
  const fillBarSet = new Set(plan.fillBars);
  // §16.6 (11.5): the harp's bed figure per two-bar unit
  const harpFiguresByStart = new Map<number, HarpFigure[]>(plan.harpFigures.map((e) => [e.startBar, e.figures]));
  // the template's octave-doubling policy: on 'forbidden' (sonata,
  // vocalbacking) a same-track pc double at the octave is a hard finding
  // unless the chord voices force it (D10) — the LH body there is a single
  // root and the RH chord is ROOTLESS (the bass stays the LH root; the
  // inversions live inside the RH), so no pitch class ever doubles between
  // the hands
  const forbiddenDoubling = (template.rules.find((r) => r.type === 'octaveDoubling')?.params as { policy?: string } | undefined)?.policy === 'forbidden';
  // the hand bands (vocalbacking's LH sits at 40-56, below the vocal zone)
  const lhLo = zoneFree ? VB_LOW[0] : PIANO_LH[0];
  const lhHi = zoneFree ? VB_LOW[1] : PIANO_LH[1];
  const pianoTrack = trackOf.get('piano');
  const pianoLo = pianoTrack?.lowestNote ?? 21;
  const pianoHi = pianoTrack?.highestNote ?? 108;

  /** The strings-overlap rule (chamber, sonata): true when the violas or
   *  the cellosBasses sound at or below MIDI 71 in the bar — the RH then
   *  starts at 72 or above (or the piano plays the LH-only version). */
  const stringsLowCache = new Map<number, boolean>();
  const stringsLowAt = (bar: number): boolean => {
    if (stringsLowCache.has(bar)) return stringsLowCache.get(bar)!;
    const s = (bar - 1) * btBar;
    const e = bar * btBar;
    let out = false;
    for (const id of Object.keys(stringsNotes)) {
      const role = project.tracks.find((t) => t.id === id)?.role;
      if (role !== 'violas' && role !== 'cellosBasses') continue;
      for (const n of stringsNotes[id] ?? []) {
        if (n.startTick < e && n.startTick + n.durationTicks > s && n.pitch <= 71) { out = true; break; }
      }
      if (out) break;
    }
    stringsLowCache.set(bar, out);
    return out;
  };

  /** The RH chord voicer (§16.9): ascending distinct pitch classes from the
   *  window floor's root fold, at most `cap` voices, minimum adjacent
   *  interval a third, every 3+ voice chord spanning at least an octave,
   *  the RH bottom at least a sixth (8 semitones) above the LH top. The
   *  bass note stays the LH root — the RH never writes below its window. */
  const rhChord = (pcs: Set<number>, rootPc: number, loB: number, hiB: number, cap: number, lhTop: number, skipPcs?: Set<number>): number[] => {
    const lo = Math.max(loB, lhTop >= 0 ? lhTop + PIANO_HAND_GAP : loB);
    // the seed: the root's fold — or, when the window cannot host the
    // root's pitch class (the 10-semitone sparkle body misses two), the
    // lowest chord tone that folds. The RH-internal inversion keeps the
    // strike's bass on the LH root (the bass-note rule reads the strike).
    let base0 = forbiddenDoubling ? null : foldPc(rootPc, lo, hiB);
    if (base0 === null) {
      for (let off = 1; off < 12 && base0 === null; off++) {
        const pc = ((rootPc + off) % 12 + 12) % 12;
        if (pcs.has(pc)) base0 = foldPc(pc, lo, hiB);
      }
    }
    if (base0 === null) return [];
    void rootPc;
    // the chord tones: each pitch class at its ascending fold from the
    // seed, wrapped an octave down at the window top (the whole window is
    // used — the sparkle body's 10 semitones host three or four voices)
    const raw: number[] = [];
    const voiced = new Set<number>();
    for (let off = 0; off < 12 && raw.length < cap + 2; off++) {
      const pc = (((base0 % 12) + off) % 12 + 12) % 12;
      if (!pcs.has(pc) || voiced.has(pc)) continue;
      if (skipPcs?.has(pc)) continue; // the pcs the LH body already carries (no pc doubles between the hands)
      if (forbiddenDoubling && pc === ((rootPc % 12) + 12) % 12) continue; // the rootless RH (the bass stays the LH root)
      let p = base0 + off;
      if (p > hiB) p -= 12;
      if (p < lo || p > hiB) continue;
      raw.push(p);
      voiced.add(pc);
    }
    raw.sort((a, b) => a - b);
    // the minimum interval inside an RH chord is a third: a too-close tone
    // lifts an octave inside the window or drops
    const tones: number[] = [];
    for (const p of raw) {
      const last = tones[tones.length - 1];
      if (last === undefined || p - last >= 3) { tones.push(p); continue; }
      if (p + 12 <= hiB) tones.push(p + 12);
    }
    // the rootless chord fills to three voices with the bottom tone's
    // octave — the strike's voices then outnumber the chord's distinct
    // tones (the LH root included), which is the D10 arithmetic necessity
    // that keeps the internal octave finding-free on 'forbidden' templates
    while (forbiddenDoubling && tones.length < cap && tones.length) {
      const ups = tones.map((t) => t + 12)
        .filter((t) => t <= hiB && t - tones[tones.length - 1] >= 3 && !tones.includes(t))
        .sort((a, b) => a - b);
      if (!ups.length) break;
      tones.push(ups[0]);
      tones.sort((a, b) => a - b);
    }
    return tones.length > cap ? tones.slice(0, cap) : tones;
  };

  /** The strike grid inside [onset, until): the onset plus every
   *  harmonic-span change — a held chord re-strikes the new chord there
   *  (a ring never outlives its own harmony). */
  const spanStrikes = (onset: number, until: number): number[] => {
    const out: number[] = [];
    let cur = onset;
    while (cur < until) {
      out.push(cur);
      const next = Math.min(spanEndOf(cur), until);
      if (next <= cur) break;
      cur = next;
    }
    return out;
  };

  /** The LH body (L0) at a tick: the chord's root folded into the low band,
   *  as an open fifth (the chord's OWN fifth, root plus fifth, no third)
   *  when it fits the band, else a single root. The lowest note is always
   *  the root (the bass-note rule); never a third or fourth below 55.
   *  `chorus` folds the root HIGH (49-55) and drops the fifth: the
   *  chorus's below-55 share target (at most 8%) — the body is the only
   *  mandatory low voice, so it rides the top of the band there. */
  const lhBodyAt = (onset: number, chorus: boolean): number[] => {
    const { pcs, rootPc } = chordPcsAt(onset);
    if (chorus) {
      // the chorus fold: as high as the band allows while still hosting
      // every root pitch class (a 12-semitone window) — the body is the
      // only mandatory below-55 voice, so it rides the top of the band.
      // The chorus body takes its OCTAVE form where the zone allows (the
      // top of the octave is not a below-55 note, so the chorus's below-55
      // share stays at one note per strike; the RH floor rises above the
      // octave's top through the hand-split gap rule). Vocalbacking keeps
      // the root-and-fifth form — its octave top would enter the zone.
      const root = foldPc(rootPc, Math.max(44, lhLo), Math.min(lhHi, pianoHi));
      if (root === null) return [];
      const fifthPc = ((rootPc + 7) % 12 + 12) % 12;
      if (pcs.has(fifthPc) && root + 7 <= Math.min(lhHi, pianoHi)) return [root, root + 7];
      return [root];
    }
    const root = foldPc(rootPc, Math.max(lhLo, pianoLo), Math.min(lhHi, pianoHi));
    if (root === null) return [];
    const fifthPc = ((rootPc + 7) % 12 + 12) % 12;
    if (pcs.has(fifthPc) && root + 7 <= Math.min(lhHi, pianoHi)) return [root, root + 7];
    return [root];
  };
  const lhTopAt = (onset: number, chorus: boolean): number => {
    const body = lhBodyAt(onset, chorus);
    return body.length ? body[body.length - 1] : -1;
  };

  /** The power job's octave fold: the root anywhere in the low band — the
   *  hand-split gap is kept by the RH floor rising above the octave's top
   *  (rhChord reads the LH top), and vocalbacking caps the root at 44 so
   *  the octave's top never enters the vocal zone (57-81). */
  const lhOctaveAt = (onset: number, _underChord: boolean): number[] => {
    const { rootPc } = chordPcsAt(onset);
    const ceil = zoneFree ? Math.min(44, lhHi) : Math.min(lhHi, pianoHi);
    const root = foldPc(rootPc, Math.max(40, pianoLo), Math.min(ceil, pianoHi));
    if (root === null) return [];
    return [root, root + 12];
  };
  /** The octave form's LH top (the octave's upper note) at a tick. */
  const lhOctaveTopAt = (onset: number): number => {
    const oct = lhOctaveAt(onset, true);
    return oct.length ? oct[oct.length - 1] : -1;
  };

  /* ---------------- phase A: candidates per part (no velocities yet) ------ */

  // §16.9 (11.6): the piece-wide flourish budget (at most 2 per piece)
  let flourishCount = 0;
  let pianoCandsFinal: KeysCandidate[] | null = null;

  const candidatesByPart: Partial<Record<KeysPart, KeysCandidate[]>> = {};
  for (const part of KEYS_PARTS) {
    const track = trackOf.get(part);
    if (!track) continue;
    const prof = KEYS_PROFILES[part];
    const candidates: KeysCandidate[] = [];
    candidatesByPart[part] = candidates;
    const lo = track.lowestNote;
    const hi = track.highestNote;

    /** True when this bar sits in the chorus relief (a chorus-type section
     *  at the LOW gate and above — the plan's own reading, recomputed). */
    const reliefAt = (bar: number, norm: number): boolean => {
      const sec = ctx.sections.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
      return isChorusTypeK(sec?.name) && norm >= KEYS_GATES.low;
    };

    /** The figure's chord-tone pool: the chord tones over about two octaves
     *  from the window floor's nearest root, inside the sweet spot and the
     *  track's range, zone-shifted and deduped ascending (§16.2). The
     *  PIANO (§16.2a) additionally moves a candidate up out of the strings'
     *  octave band and shifts the zone UP first (§16.3a). */
    const figurePool = (tick: number, winLo: number, winHi: number): number[] => {
      const { pcs, rootPc } = chordPcsAt(tick);
      const base0 = foldPc(rootPc, Math.max(winLo, lo), Math.min(winHi, hi));
      if (base0 === null) return [];
      const out: number[] = [];
      for (let p = base0; p <= Math.min(winHi, hi, base0 + 24); p++) {
        if (!pcs.has(pcOf(p))) continue;
        const shifted = zoneShift(p, lo, hi, part === 'piano');
        if (shifted === null) continue;
        if (!out.includes(shifted)) out.push(shifted);
      }
      return out.sort((a, b) => a - b);
    };

    for (let bar = 1; bar <= bars; bar++) {
      const planBar = planByBar.get(bar);
      if (!planBar) continue;
      const kind = planBar.voices[part];
      if (!kind) continue;
      const barStart = (bar - 1) * btBar;
      const barEnd = bar * btBar;
      const damp = (start: number, dur: number): number => Math.max(1, Math.min(dur, dampingEnd(start) - start));

      // the gliss run (harp): 16ths of the key's diatonic scale only, from
      // the drawn start to the landing chord tone at the target downbeat;
      // plain notes, no new articulation. In vocalbacking the zone's scale
      // tones drop out of the run (the sweep keeps its direction).
      if (kind === 'gliss') {
        const g = glissByBar.get(bar);
        if (g) {
          const { pcs } = chordPcsAt(g.targetTick);
          const winLo = Math.max(prof.sweet[0], lo);
          const winHi = Math.min(prof.sweet[1], hi);
          let target: number | null = null;
          let bestDist = Infinity;
          for (let p = winLo; p <= winHi; p++) {
            if (!pcs.has(pcOf(p))) continue;
            const shifted = zoneShift(p, lo, hi);
            if (shifted === null) continue;
            const d = Math.abs(shifted - 72);
            if (d < bestDist) {
              bestDist = d;
              target = shifted;
            }
          }
          if (target !== null) {
            const n = Math.max(1, Math.round((g.targetTick - g.startTick) / sixteenth));
            const run: number[] = [];
            if (g.dir === 'up') {
              const below: number[] = [];
              for (let p = target - 1; p >= lo && below.length < n; p--) {
                if (!scalePcs.has(pcOf(p))) continue;
                if (zoneFree && inVocalZone(p)) continue; // the zone's tones drop out of the run
                below.push(p);
              }
              run.push(...below.reverse(), target);
            } else {
              const above: number[] = [];
              for (let p = target + 1; p <= hi && above.length < n; p++) {
                if (!scalePcs.has(pcOf(p))) continue;
                if (zoneFree && inVocalZone(p)) continue; // the zone's tones drop out of the run
                above.push(p);
              }
              run.push(...above.reverse(), target);
            }
            run.forEach((pitch, i) => {
              const isLanding = i === run.length - 1;
              const onset = isLanding ? g.targetTick : g.startTick + i * sixteenth;
              if (onset >= barEnd || onset < barStart) return;
              candidates.push({
                pitch,
                startTick: onset,
                durationTicks: isLanding ? damp(onset, barEnd - onset) : sixteenth,
                ...(isLanding ? {} : { ramp: n > 1 ? i / (n - 1) : 0.5 }),
              });
            });
          }
        }
        continue;
      }

      if (part === 'harp') {
        if (kind === 'bed' || kind === 'final') {
          // §16.6 (Phase 11.5): the bed realises the section's DRAWN FIGURE —
          // the plan's balanced rotation (offset from the piano's) with the
          // hash-stepped two-bar unit walk. The eighth-cycle figures keep the
          // Phase 11 blur (each note rings until the next onset, capped at
          // one bar, damped before a tacet); the held chord figures sustain
          // to the harmonic span or the bar line (§16.5 — pedal emulation by
          // length, re-taken at the half-bar line so every written note
          // stays inside the figuration exemption). The final bar keeps the
          // descending close. In the chorus relief the bed rides the relief
          // intensity floor.
          const relief = kind === 'bed' && reliefAt(bar, planBar.norm);
          const secHere = ctx.sections.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
          const unit = secHere ? Math.floor((bar - secHere.startBar) / HARP_FIGURE_UNIT_BARS) : 0;
          const figs = secHere ? harpFiguresByStart.get(secHere.startBar) : undefined;
          const figure: HarpFigure | 'finalDescent' = kind === 'final' ? 'finalDescent' : figs?.[Math.min(unit, (figs?.length ?? 1) - 1)] ?? 'arpUp';
          /** §16.6 (11.5) the held ring: to the harmonic span or the bar line
           *  (at most 1 bar), re-taken so every written segment stays
           *  STRICTLY SHORTER than half a bar (959 ticks): the figuration
           *  exemption needs the shorter note ≤ half a bar AND the other
           *  note strictly longer — a 960-vs-960 pair (the piano's half-bar
           *  holds, the string pads) would fall through to the doubling
           *  audit, and the forbidden-doubling templates read it as a hard
           *  finding. The 1-tick-shy segments keep every harp hold exempt
           *  against the piano's 960-tick holds and the longer string pads.
           *  `until` caps the ring earlier (the next strike of the same
           *  figure — the pedal continues through the re-strike). */
          const pushHeldHarp = (onset: number, pitch: number, opts: { relief?: boolean; soft?: boolean; until?: number } = {}) => {
            const cap = Math.min(opts.until ?? barEnd, barEnd);
            const total = Math.max(1, Math.min(spanEndOf(onset), cap) - onset);
            const segLen = Math.floor(btBar / 2) - 1;
            const nSeg = Math.floor(total / segLen);
            const emit = (start: number, len: number) => {
              candidates.push({ pitch, startTick: start, durationTicks: damp(start, len), ...(relief || opts.relief ? { relief: true } : {}), ...(opts.soft ? { soft: true } : {}) });
            };
            // whole segments only — a 1-2 tick tail note would inflate the
            // beat windows' sounding count (and the ring ends a couple of
            // ticks early, inaudible)
            if (nSeg === 0) emit(onset, total);
            else for (let i = 0; i < nSeg; i++) emit(onset + i * segLen, segLen);
          };
          /** The harp's strike grid inside [onset, until): the onset plus
           *  every harmonic-span change — a held ring re-strikes the new
           *  chord there (a ring never outlives its own harmony). */
          const spanStrikesHarp = (onset: number, until: number): number[] => {
            const out: number[] = [];
            let cur = onset;
            while (cur < until) {
              out.push(cur);
              const next = Math.min(spanEndOf(cur), until);
              if (next <= cur) break;
              cur = next;
            }
            return out;
          };
          if (figure === 'arpUp' || figure === 'arpDown' || figure === 'pendulum' || figure === 'brokenThirds' || figure === 'finalDescent') {
            const order = (i: number, L: number): number =>
              figure === 'arpDown' ? L - 1 - (i % L)
                : figure === 'pendulum' ? (() => { const c = i % Math.max(2, 2 * L - 2); return c < L ? c : 2 * L - 2 - c; })()
                  : figure === 'brokenThirds' ? (() => { const evens = Math.ceil(L / 2); const k = i % L; return k < evens ? k * 2 : (k - evens) * 2 + 1; })()
                    : (kind === 'final' ? (L - 1 - (i % L) + L) % L : i % L);
            const nSlots = Math.max(1, Math.floor((barEnd - barStart) / eighth));
            for (let i = 0; i < nSlots; i++) {
              const onset = barStart + i * eighth;
              const pool = figurePool(onset, prof.sweet[0], prof.sweet[1]);
              if (!pool.length) continue;
              const pitch = pool[order(i, pool.length) % pool.length];
              const next = onset + eighth;
              candidates.push({ pitch, startTick: onset, durationTicks: damp(onset, Math.min(next, barEnd) - onset), ...(relief ? { relief: true } : {}) });
            }
          } else if (figure === 'offBeatPairs') {
            // pairs of eighths starting on the off-beats: (and-of-1, 2),
            // (and-of-2, 3), (and-of-3, 4) and (and-of-4, 1) — the walk
            // starts on every off-beat eighth and runs to the bar line (the
            // last pair's tail rings into the next bar's downbeat and is
            // damped there); the downbeat itself rests, the walk never
            // repeats a pitch inside a beat
            let k = 0;
            for (const slot of [1, 2, 3, 4, 5, 6, 7]) {
              const onset = barStart + slot * eighth;
              if (onset >= barEnd) break;
              const pool = figurePool(onset, prof.sweet[0], prof.sweet[1]);
              if (!pool.length) continue;
              candidates.push({ pitch: pool[k % pool.length], startTick: onset, durationTicks: damp(onset, Math.min(onset + eighth, barEnd) - onset), ...(relief ? { relief: true } : {}) });
              k++;
            }
          } else if (figure === 'pluckSparkle') {
            // high-octave dry pluck sparkle: the chord tones folded into the
            // top octave of the track's HARD range (the config range wins),
            // dry plucks on every eighth (short, no ring), soft at low
            // energy — the walk never repeats a pitch inside a beat
            for (let i = 0; i < 8; i++) {
              const onset = barStart + i * eighth;
              if (onset >= barEnd) break;
              const { pcs: pcsHere } = chordPcsAt(onset);
              const tones: number[] = [];
              for (let p = Math.max(prof.sweet[0], hi - 12); p <= hi; p++) if (pcsHere.has(pcOf(p))) tones.push(p);
              if (!tones.length) continue;
              candidates.push({
                pitch: tones[i % tones.length], startTick: onset, durationTicks: damp(onset, Math.min(eighth, barEnd - onset)),
                ...(relief ? { relief: true } : {}), ...(planBar.norm < KEYS_GATES.mid ? { soft: true } : {}),
              });
            }
          } else if (figure === 'wideRoll' || figure === 'rolledChord' || figure === 'lowRootFifth') {
            // the held chord figures. The tone selection folds the root into
            // the figure's window and walks the chord's pitch classes
            // ascending; below MIDI 48 a kept tone must clear a fifth above
            // the last kept one (the low-interval rule — the harp writes
            // 5th-or-wider intervals or single notes down there). The wide
            // roll spreads two octaves, the rolled chord stays compact (the
            // vocalbacking rolls live below the vocal zone), the low root
            // and fifth re-strikes on beat 3 (the pedal continues through
            // the re-strike). Every strike is chord-fresh and the held ring
            // re-strikes at each harmonic-span change (a ring never outlives
            // its own chord).
            const rollLo = zoneFree ? 36 : Math.max(prof.sweet[0], 36);
            const rollHi = zoneFree ? 56 : (figure === 'wideRoll' ? Math.min(prof.sweet[1], hi) : Math.min(prof.sweet[1], hi, 83));
            const buildRoll = (pcs: Set<number>, rootPc: number, spread: boolean): number[] => {
              const base0 = foldPc(rootPc, Math.max(rollLo, lo), Math.min(rollHi, hi));
              if (base0 === null) return [];
              const tones: number[] = [];
              const voiced = new Set<number>();
              for (let off = 0; off < (spread ? 24 : 12) && tones.length < 4; off++) {
                const pc = ((rootPc + off) % 12 + 12) % 12;
                if (!pcs.has(pc)) continue;
                if (off < 12 && voiced.has(pc)) continue;
                let p = base0 + off;
                let wrapped = false;
                while (p > Math.min(rollHi, hi)) { p -= 12; wrapped = true; }
                if (p < Math.max(rollLo, lo)) continue;
                if (off >= 12 && !wrapped) break; // the second octave only above the window's first
                if (off < 12) voiced.add(pc);
                const last = tones[tones.length - 1];
                if (last !== undefined && p < 48 && last < 48 && Math.abs(p - last) < 7) continue;
                tones.push(p);
              }
              // the low-interval rule reads the SIMULTANEOUS set — the
              // sorted adjacency, not the walk order; the groups below 48
              // (both ends) sit a fifth or wider apart
              tones.sort((a, b) => a - b);
              const kept: number[] = [];
              for (const t of tones) {
                const last = kept[kept.length - 1];
                if (last === undefined || t - last >= 7 || last >= 48 || t >= 48) kept.push(t);
              }
              // the harp's held rolls keep the bed's own two-voice window
              // presence (two notes sounding per beat window — the footprint
              // the Phase 11 window math saw): the rolled chord holds its
              // lowest pair, the wide roll holds the extremes (the
              // two-octave spread IS the pair)
              if (spread) return kept.length > 1 ? [kept[0], kept[kept.length - 1]] : kept;
              return kept.slice(0, 2);
            };
            const harpStrikes = spanStrikesHarp(barStart, barEnd);
            if (figure === 'lowRootFifth') {
              harpStrikes.forEach((onset, k) => {
                const { rootPc: rootHere } = chordPcsAt(onset);
                const rootNote = foldPc(rootHere, Math.max(36, lo), zoneFree ? 56 : 55);
                if (rootNote === null) return;
                const fifth = rootNote + 7 <= (zoneFree ? 56 : 55) ? rootNote + 7 : rootNote - 7 >= Math.max(23, lo) ? rootNote - 7 : rootNote + 12 <= hi ? rootNote + 12 : rootNote;
                const pair = fifth !== rootNote ? [rootNote, fifth] : [rootNote];
                const until = k + 1 < harpStrikes.length ? harpStrikes[k + 1] : barEnd;
                for (const p of pair) pushHeldHarp(onset, p, { until });
              });
            } else {
              harpStrikes.forEach((onset, k) => {
                const { pcs: pcsHere, rootPc: rootHere } = chordPcsAt(onset);
                const tones = buildRoll(pcsHere, rootHere, figure === 'wideRoll');
                const until = k + 1 < harpStrikes.length ? harpStrikes[k + 1] : barEnd;
                tones.forEach((p, i) => pushHeldHarp(k === 0 ? barStart + i * sixteenth : onset + i * sixteenth, p, { until, ...(relief ? { relief: true } : {}) }));
              });
            }
          }
        } else if (kind === 'roots') {
          // the low plucked roots: the chord's root in the bottom octave, a
          // soft quarter-length pluck on the phrase start (§16.2); in the
          // chorus relief it is the non-arpeggiating harp's drive line — the
          // root on EVERY QUARTER (the grid analogue, one voice, never an
          // arpeggio) riding the relief velocity (§16.4)
          const relief = reliefAt(bar, planBar.norm);
          const { rootPc } = chordPcsAt(barStart);
          const pitch = foldPc(rootPc, Math.max(prof.low[0], lo), Math.min(prof.low[1], hi));
          if (pitch !== null) {
            const hits = relief ? [0, 1, 2, 3] : [0];
            for (const h of hits) {
              const onset = barStart + h * beat;
              if (onset >= barEnd) break;
              candidates.push({ pitch, startTick: onset, durationTicks: damp(onset, Math.min(beat, barEnd - onset)), ...(relief ? { relief: true } : {}) });
            }
          }
        }
      } else if (part === 'piano') {
        if (kind === 'final') {
          // the closing anchor: the final chord's root, low (floor 36),
          // marcato, half a bar — a single note (the octaves ride the L3
          // rules; the single root is finding-free on every doubling
          // policy). The landing chord must still sound (§16.5); the harp
          // carries the closing figure where rostered.
          const { rootPc } = chordPcsAt(barStart);
          const pitch = foldPc(rootPc, Math.max(36, lo), Math.min(lhHi, hi));
          if (pitch !== null) {
            candidates.push({ pitch, startTick: barStart, durationTicks: damp(barStart, Math.min(beat * 2, barEnd - barStart)), articulation: 'marcato', priority: 2 });
          }
        } else if (kind === 'tutti') {
          // the tutti root hit: the downbeat chord's root, low (floor 36),
          // marcato, the drawn moment shape — a single note (§16.9; the
          // moment's own voices force any octave through D10, the single
          // root never needs the exemption)
          const moment = momentForBar(ctx.moments, bar);
          if (moment?.kind === 'tutti') {
            const { rootPc } = chordPcsAt(barStart);
            const pitch = foldPc(rootPc, Math.max(36, lo), Math.min(lhHi, hi));
            if (pitch !== null) {
              const hitLen = moment.shape === 'breath' ? beat : moment.shape === 'decay' ? beat * 2 : btBar;
              candidates.push({ pitch, startTick: barStart, durationTicks: damp(barStart, Math.min(hitLen, barEnd - barStart)), articulation: 'marcato', moment: true, priority: 2 });
            }
          }
        } else if (kind === 'job') {
          // §16.9 (Phase 11.6): the job engine. Every piano event belongs
          // to a hand; the layers ride the energy arc bar by bar (start
          // sparse, add only where the music grows): L0 body everywhere the
          // piano is active, L1 chord and the L2 figure from the mid gate
          // (the chorus relief from the LOW gate — the chorus never
          // thins), L3 at high energy, the thinning and tacet bands by
          // ABSOLUTE energy (0.72 / 0.90 — the chamber, sonata and
          // vocalbacking clamps never reach them; cinematic and
          // hybridstudio do).
          const jobPlan = jobOfBar(bar);
          if (jobPlan) {
            const secHere = ctx.sections.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
            const secStart = secHere?.startBar ?? 1;
            const chorusHere = isChorusTypeK(secHere?.name);
            const relief = reliefAt(bar, planBar.norm);
            const phraseStart = bar === secStart || (bar - secStart) % 4 === 0;
            const figure: PianoFigure | null = jobPlan.figures.length
              ? jobPlan.figures[Math.min(Math.floor((bar - secStart) / 4), jobPlan.figures.length - 1)]
              : null;
            const energy = planBar.norm * clampMax;
            const thinning = !chorusHere && energy >= 0.72;
            const fullLayers = relief || (!thinning && planBar.norm >= KEYS_GATES.mid);
            const powerHot = planBar.norm >= KEYS_GATES.high;
            // the RH window: 64-84 (chamber, sonata, cinematic,
            // hybridstudio); the sparkle band (vocalbacking) — the 92-96
            // top only on phrase-start chords of peak bars; the
            // last-chorus octave shift where the range allows; the
            // strings-overlap bar (chamber, sonata) raises the RH floor to
            // 72 (the LH-only version is the fallback when the window
            // cannot fit the figure).
            const isVB = zoneFree;
            let rhLo: number = isVB ? VB_SPARKLE[0] : PIANO_RH[0];
            let rhHi: number = isVB
              ? (phraseStart && planBar.norm >= KEYS_GATES.peak ? VB_SPARKLE_TOP : VB_SPARKLE[1])
              : PIANO_RH[1];
            const stringsOverlapBar = !isVB && !PIANO_ARP_TEMPLATES.has(template.id) && stringsLowAt(bar);
            if (stringsOverlapBar) rhLo = Math.max(rhLo, 72);
            if (jobPlan.octaveShift && chorusHere) { rhLo = Math.min(rhLo + 12, PIANO_SPARKLE_CAP); rhHi = Math.min(rhHi + 12, PIANO_SPARKLE_CAP); }
            const rhCap = COMP_CHORD_VOICES;
            /** the held-ring writer (§16.9): to the harmonic span or the bar
             *  line (at most 1 bar), re-taken at the half-bar line so every
             *  written note stays inside the figuration exemption (the
             *  11.5 pattern). `until` caps earlier; the damp boundaries
             *  always win. */
            // the job boundary: a hold never rings into the next section's
            // texture (the new job's own strikes take over cleanly)
            const secEndTick = Math.min(barEnd, secHere ? (secHere.startBar + secHere.lengthBars) * btBar : barEnd);
            const pushHeld = (onset: number, pitch: number, opts: { layer?: Note['layer']; until?: number; priority?: number; fig?: PianoFigure } = {}) => {
              const total = Math.max(1, Math.min(spanEndOf(onset), Math.min(opts.until ?? barEnd, barEnd), secEndTick) - onset);
              const first = Math.min(total, btBar / 2);
              const tag = { ...(opts.layer ? { layer: opts.layer } : {}), ...(relief ? { relief: true } : {}), priority: opts.priority ?? 2, ...(opts.fig ? { fig: opts.fig } : {}) };
              candidates.push({ pitch, startTick: onset, durationTicks: damp(onset, first), ...tag });
              // the re-take never ATTACKS in the next bar: the ring stops at
              // the bar line and the next bar's own strikes continue it (a
              // cross-bar attack would double against the next chord's
              // voicing and break the held chord's equality)
              if (total > first && onset + first < barEnd) candidates.push({ pitch, startTick: onset + first, durationTicks: damp(onset + first, total - first), ...tag });
            };
            const strikeHeld = (onset: number, chord: number[], until: number, variant: 'block' | 'rolled', fig?: PianoFigure) => {
              chord.forEach((pitch, i) => {
                if (variant === 'rolled') pushHeld(onset + Math.min(i * 60, eighth - 1), pitch, { layer: i > 0 ? 'kbd' : undefined, until, fig });
                else pushHeld(onset, pitch, { layer: i > 0 ? 'kbd' : undefined, until, fig });
              });
            };
            const rhPoolAt = (onset: number): number[] => {
              const { pcs, rootPc } = chordPcsAt(onset);
              const lhTop = powerOctave ? Math.max(lhTopAt(onset, chorusHere), lhOctaveTopAt(onset)) : lhTopAt(onset, chorusHere);
              const skipPcs = new Set<number>();
              if (forbiddenDoubling) {
                skipPcs.add(((rootPc % 12) + 12) % 12);
                const body = lhBodyAt(onset, chorusHere);
                if (body.length > 1) skipPcs.add(((rootPc + 7) % 12 + 12) % 12);
              }
              return rhChord(pcs, rootPc, rhLo, rhHi, rhCap, lhTop, skipPcs);
            };
            /** the pad's slow inner voice: the middle tone alternates
             *  between the chord's third and fifth folds at successive
             *  strikes (chord tones, the gaps and the span re-checked). */
            const padChord = (onset: number, k: number): number[] => {
              const { pcs, rootPc } = chordPcsAt(onset);
              const skipPcs = new Set<number>();
              if (forbiddenDoubling) {
                skipPcs.add(((rootPc % 12) + 12) % 12);
                const body = lhBodyAt(onset, chorusHere);
                if (body.length > 1) skipPcs.add(((rootPc + 7) % 12 + 12) % 12);
              }
              const chord = rhChord(pcs, rootPc, rhLo, rhHi, rhCap, lhTopAt(onset, chorusHere), skipPcs);
              if (chord.length < 3 || k % 2 === 0) return chord;
              const thirdPc = ((rootPc + (pcs.has(((rootPc + 4) % 12 + 12) % 12) ? 4 : 3)) % 12 + 12) % 12;
              const fifthPc = ((rootPc + 7) % 12 + 12) % 12;
              const swapTo = pcOf(chord[1]) === fifthPc ? thirdPc : fifthPc;
              if (!pcs.has(swapTo)) return chord;
              const p = foldPc(swapTo, chord[0] + 3, chord[chord.length - 1] - 3);
              if (p === null) return chord;
              const out = [chord[0], p, chord[chord.length - 1]];
              return out[out.length - 1] - out[0] >= 12 ? out : chord;
            };
            const strikes = spanStrikes(barStart, barEnd);
            // ---- L0 body: the LH at every span strike, held to the span end ----
            // (the power job at high energy merges into its octave line: the
            // L3 octave IS the body's octave form — no duplicate low root)
            const powerOctave = jobPlan.job === 'power' && powerHot && (figure === 'octavePulse' || figure === 'brokenOctaves')
              && lhOctaveAt(barStart, true).length > 0;
            // the pump bar: the body rides the cell grid (the cells below
            // re-strike the root) — the span-held segment would fight the
            // cells and break the held chord's equality
            const pumpBar = jobPlan.job === 'rhythm' && figure === 'pump' && fullLayers && !thinning;
            if (!powerOctave && !pumpBar) {
              strikes.forEach((onset, k) => {
                const until = k + 1 < strikes.length ? strikes[k + 1] : barEnd;
                for (const [i, p] of lhBodyAt(onset, chorusHere).entries()) {
                  pushHeld(onset, p, { layer: i > 0 ? 'kbd' : undefined, until });
                }
              });
            }
            // ---- L1 chord: the RH held the same way (support, melody, power) ----
            if (fullLayers && (jobPlan.job === 'support' || jobPlan.job === 'melody' || jobPlan.job === 'power')) {
              const variant: 'block' | 'rolled' = jobPlan.l1 === 'rolled' ? 'rolled' : 'block';
              strikes.forEach((onset, k) => {
                const until = k + 1 < strikes.length ? strikes[k + 1] : barEnd;
                const chord = jobPlan.l1 === 'pad' ? padChord(onset, k) : rhPoolAt(onset);
                strikeHeld(onset, chord, until, variant);
              });
            }
            // ---- L3 power (the power job at high energy; the thinning band) ----
            if (jobPlan.job === 'power' && fullLayers && powerHot && figure) {
              const eighthPulse = PIANO_ARP_TEMPLATES.has(template.id);
              if (figure === 'octavePulse') {
                for (let h = 0; h < 4; h++) {
                  const onset = barStart + h * beat;
                  if (onset >= barEnd) break;
                  const until = Math.min(onset + beat, barEnd);
                  for (const p of lhOctaveAt(onset, true)) pushHeld(onset, p, { until, fig: figure });
                }
              } else if (figure === 'brokenOctaves') {
                const step = eighthPulse ? eighth : beat;
                for (let i = 0; i * step < btBar; i++) {
                  const onset = barStart + i * step;
                  if (onset >= barEnd) break;
                  const oct = lhOctaveAt(onset, true);
                  if (!oct.length) continue;
                  const p = i % 2 === 0 ? oct[0] : oct[1];
                  pushHeld(onset, p, { until: Math.min(onset + step, barEnd), fig: figure });
                }
              }
            }
            if (thinning) {
              // the thinning band: L0 plus an L3 hit on the downbeat — the
              // L1 chord and the L2 figure drop (the 0.72 ABSOLUTE band;
              // chamber, sonata and vocalbacking never reach it)
              for (const p of lhOctaveAt(barStart, false)) {
                pushHeld(barStart, p, { until: Math.min(barStart + beat, barEnd), fig: 'octavePulse' });
              }
            }
            // ---- L2 figure: the moving part (motion, rhythm, color) ----
            const eighthNote = (onset: number, pitch: number, fig: PianoFigure) => {
              candidates.push({ pitch, startTick: onset, durationTicks: damp(onset, Math.min(onset + eighth, barEnd) - onset), ...(relief ? { relief: true } : {}), priority: 1, fig });
            };
            if (fullLayers && figure && !thinning) {
              if (jobPlan.job === 'motion') {
                if (figure === 'alberti') {
                  // low-high-mid-high over the RH pool, eighths
                  for (let i = 0; i < 8; i++) {
                    const onset = barStart + i * eighth;
                    if (onset >= barEnd) break;
                    const pool = rhPoolAt(onset);
                    if (!pool.length) continue;
                    eighthNote(onset, pool[[0, 2, 1, 2][i % 4] % pool.length], figure);
                  }
                } else if (figure === 'arpUp' || figure === 'arpDown' || figure === 'arpPendulum') {
                  for (let i = 0; i < 8; i++) {
                    const onset = barStart + i * eighth;
                    if (onset >= barEnd) break;
                    const pool = rhPoolAt(onset);
                    const L = pool.length;
                    if (!L) continue;
                    const c = i % Math.max(2, 2 * L - 2);
                    const idx = figure === 'arpUp' ? i % L : figure === 'arpDown' ? L - 1 - (i % L) : L === 1 ? 0 : (c < L ? c : 2 * L - 2 - c);
                    eighthNote(onset, pool[idx], figure);
                  }
                } else if (figure === 'wideBroken') {
                  // the body carries beat 1; a gap; high chord tones on the off-beats
                  let w = 0;
                  for (const slot of [3, 5, 7]) {
                    const onset = barStart + slot * eighth;
                    if (onset >= barEnd) break;
                    const pool = rhPoolAt(onset);
                    if (!pool.length) continue;
                    eighthNote(onset, pool[w % pool.length], figure);
                    w++;
                  }
                } else if (figure === 'cascade') {
                  // slow arpeggio (quarters), each note held to the span end
                  strikes.forEach((onset, k) => {
                    const spanEnd = Math.min(k + 1 < strikes.length ? strikes[k + 1] : barEnd, barEnd);
                    const { pcs, rootPc } = chordPcsAt(onset);
                    const skipPcs = new Set<number>();
                    if (forbiddenDoubling) {
                      skipPcs.add(((rootPc % 12) + 12) % 12);
                      const body = lhBodyAt(onset, chorusHere);
                      if (body.length > 1) skipPcs.add(((rootPc + 7) % 12 + 12) % 12);
                    }
                    const pool = rhChord(pcs, rootPc, rhLo, rhHi, rhCap, lhTopAt(onset, chorusHere), skipPcs);
                    for (let q = 0; q < 4; q++) {
                      const onset2 = onset + q * beat;
                      if (onset2 >= spanEnd) break;
                      if (!pool.length) break;
                      pushHeld(onset2, pool[q % pool.length], { layer: q > 0 ? 'kbd' : undefined, until: spanEnd, fig: figure, priority: 1 });
                    }
                  });
                } else if (figure === 'ostinatoCell') {
                  // a 3-4 note cell from the existing ostinato vocabulary
                  // (straight eighths or the 3+3+2 syncopated cell)
                  const cell = hashString(`piano-cell:${project.orchestration?.take ?? 0}:${secStart}`) % 2 === 0 ? 'straight' : 'syncopated';
                  const slots = cell === 'straight' ? [0, 1, 2, 3, 4, 5, 6, 7] : [0, 1, 2, 3, 4, 5, 6];
                  let w = 0;
                  for (const slot of slots) {
                    const onset = barStart + slot * eighth;
                    if (onset >= barEnd) break;
                    const pool = rhPoolAt(onset);
                    if (!pool.length) continue;
                    eighthNote(onset, pool[w % pool.length], figure);
                    w++;
                  }
                }
              } else if (jobPlan.job === 'rhythm') {
                if (figure === 'pump') {
                  // the 3+3+2 cell: chord strikes held to the next,
                  // chord-fresh — the LH body re-strikes on the same cell
                  // grid so every voice of the strike ends together (the
                  // held chord's equality rule)
                  const cellStrikes: number[] = [];
                  for (const [slot] of [[0], [3], [6]] as const) {
                    const onset = barStart + slot * eighth;
                    if (onset >= barEnd) break;
                    cellStrikes.push(onset);
                  }
                  const uniq = [...new Set(cellStrikes)].sort((a, b) => a - b);
                  uniq.forEach((onset, k) => {
                    const until = k + 1 < uniq.length ? uniq[k + 1] : barEnd;
                    for (const [i, p] of lhBodyAt(onset, chorusHere).entries()) {
                      pushHeld(onset, p, { layer: i > 0 ? 'kbd' : undefined, until });
                    }
                    strikeHeld(onset, rhPoolAt(onset), until, 'block', figure);
                  });
                } else if (figure === 'repeatedChords') {
                  // RH chords on every beat, each held to the next
                  for (let h = 0; h < 4; h++) {
                    const onset = barStart + h * beat;
                    if (onset >= barEnd) break;
                    const until = Math.min(onset + beat, barEnd);
                    strikeHeld(onset, rhPoolAt(onset), until, 'block', figure);
                  }
                } else if (figure === 'stab') {
                  // the short dry chord on beat 1 (a deliberate accent)
                  const chord = rhPoolAt(barStart);
                  chord.forEach((pitch, i) => {
                    candidates.push({ pitch, startTick: barStart, durationTicks: damp(barStart, Math.min(beat, barEnd - barStart)), ...(i > 0 ? { layer: 'kbd' as const } : {}), ...(relief ? { relief: true } : {}), priority: 1, fig: figure });
                  });
                } else if (figure === 'ostinatoCell') {
                  const slots = [0, 1, 2, 3, 4, 5, 6, 7];
                  let w = 0;
                  for (const slot of slots) {
                    const onset = barStart + slot * eighth;
                    if (onset >= barEnd) break;
                    const pool = rhPoolAt(onset);
                    if (!pool.length) continue;
                    eighthNote(onset, pool[w % pool.length], figure);
                    w++;
                  }
                }
              } else if (jobPlan.job === 'color') {
                // the sparse colors are the LOW-energy color; from the mid
                // gate (the chorus relief included) the color is the high
                // rolled chord — a chorus never carries the two-note cell
                if (fullLayers && figure !== 'highRoll' && figure !== 'flourish') {
                  strikes.forEach((onset, k) => {
                    const until = k + 1 < strikes.length ? strikes[k + 1] : barEnd;
                    strikeHeld(onset, rhPoolAt(onset), until, 'rolled', 'highRoll');
                  });
                } else if (figure === 'highSparkle') {
                  // single high notes at 84+, soft — the low-energy color
                  const sparkleLo = Math.max(PIANO_SPARKLE_FLOOR, rhLo);
                  const sparkleHi = Math.min(isVB ? VB_SPARKLE[1] : PIANO_SPARKLE_CAP, pianoHi);
                  const { pcs, rootPc: sparkRootPc } = chordPcsAt(barStart);
                  const tones: number[] = [];
                  for (let p = sparkleLo; p <= sparkleHi; p++) {
                    if (!pcs.has(pcOf(p))) continue;
                    if (forbiddenDoubling && pcOf(p) === ((sparkRootPc % 12) + 12) % 12) continue;
                    tones.push(p);
                  }
                  if (tones.length) {
                    const onset = barStart + (planBar.norm >= KEYS_GATES.mid ? beat * 2 : beat);
                    if (onset < barEnd) {
                      candidates.push({ pitch: tones[hashString(`piano-sparkle:${bar}:${project.orchestration?.take ?? 0}`) % tones.length], startTick: onset, durationTicks: damp(onset, Math.min(beat, barEnd - onset)), soft: true, priority: 1, fig: figure });
                    }
                  }
                } else if (figure === 'highRoll') {
                  // the high rolled chord, held
                  strikes.forEach((onset, k) => {
                    const until = k + 1 < strikes.length ? strikes[k + 1] : barEnd;
                    strikeHeld(onset, rhPoolAt(onset), until, 'rolled', figure);
                  });
                } else if (figure === 'sparkleCell') {
                  // the sparse sparkle cell (vocalbacking): two soft tones
                  // per bar in the sparkle band
                  const { pcs, rootPc: cellRootPc } = chordPcsAt(barStart);
                  const tones: number[] = [];
                  for (let p = Math.max(VB_SPARKLE[0], pianoLo); p <= Math.min(VB_SPARKLE[1], pianoHi); p++) {
                    if (!pcs.has(pcOf(p))) continue;
                    if (forbiddenDoubling && pcOf(p) === ((cellRootPc % 12) + 12) % 12) continue;
                    tones.push(p);
                  }
                  if (tones.length) {
                    for (const slot of [0, 5]) {
                      const onset = barStart + slot * eighth;
                      if (onset >= barEnd) break;
                      candidates.push({ pitch: tones[(slot + hashString(`piano-cellv:${bar}`)) % tones.length], startTick: onset, durationTicks: damp(onset, Math.min(eighth * 2, barEnd - onset)), soft: true, priority: 1, fig: figure });
                    }
                  }
                } else if (figure === 'flourish') {
                  // the diatonic upward run: 8-16 sixteenths ending on a
                  // chord tone at the NEXT bar's downbeat when that bar
                  // enters a chorus (at most 2 per piece, never in a bar
                  // where the harp glissando fires, never vocalbacking)
                  const nextBar = bar + 1;
                  const nextSec = ctx.sections.find((s) => nextBar >= s.startBar && nextBar < s.startBar + s.lengthBars);
                  const landsChorus = nextSec !== undefined && nextSec.startBar === nextBar && isChorusTypeK(nextSec.name);
                  if (landsChorus && !glissByBar.has(bar) && flourishCount < 2 && nextBar * btBar <= endTick) {
                    const landingTick = (nextBar - 1) * btBar;
                    const { rootPc: rootThere } = chordPcsAt(landingTick);
                    const landing = foldPc(rootThere, rhLo, rhHi);
                    if (landing !== null) {
                      const n = 8 + (hashString(`piano-flourish:${bar}`) % 9);
                      const run: number[] = [landing];
                      let p = landing;
                      const { rootPc: flRootPc } = chordPcsAt(landingTick);
                      while (run.length < n && p - 1 >= Math.max(rhLo, lo)) {
                        p--;
                        if (!scalePcs.has(pcOf(p))) continue;
                        if (forbiddenDoubling && pcOf(p) === ((flRootPc % 12) + 12) % 12) continue;
                        run.push(p);
                      }
                      run.reverse();
                      run.forEach((pitch, i) => {
                        const isLanding = i === run.length - 1;
                        const onset = isLanding ? landingTick : landingTick - (run.length - 1 - i) * sixteenth;
                        if (onset < barStart) return;
                        candidates.push({
                          pitch, startTick: onset,
                          durationTicks: isLanding ? damp(onset, Math.min(beat, barEnd - onset)) : sixteenth,
                          ...(relief ? { relief: true } : {}), priority: 1, fig: figure,
                        });
                      });
                      flourishCount++;
                    }
                  }
                }
              }
            }
            if (jobPlan.job === 'melody' && fillBarSet.has(bar) && planBar.norm >= KEYS_GATES.low && !thinning) {
                // the answer window: the strings rest there — the piano
                // echoes the lead's last 3-5 notes (moved into the RH
                // range, diatonic, the last note held); with no lead, a
                // chord-tone fragment
                const leadPitches: number[] = [];
                for (const id of Object.keys(stringsNotes)) {
                  if (project.tracks.find((t) => t.id === id)?.role !== 'violins1') continue;
                  const before = (stringsNotes[id] ?? []).filter((n) => n.startTick + n.durationTicks <= barStart).sort((a, b) => a.startTick - b.startTick);
                  for (const n of before.slice(-12)) {
                    if (leadPitches[leadPitches.length - 1] !== n.pitch) leadPitches.push(n.pitch);
                  }
                }
                const picked = leadPitches.slice(-5).length >= 3 ? leadPitches.slice(-5) : rhPoolAt(barStart);
                const lhRootHere = lhBodyAt(barStart, chorusHere)[0] ?? -1;
                const echo: number[] = [];
                for (const raw of picked) {
                  // diatonic snap, then fold into the RH window
                  let pitch = raw;
                  if (forbiddenDoubling && pcOf(pitch) === ((lhRootHere % 12) + 12) % 12 && lhRootHere >= 0) continue; // no pc double against the held root
                  if (!scalePcs.has(pcOf(pitch))) {
                    for (const d of [1, -1, 2, -2]) {
                      if (scalePcs.has(pcOf(pitch + d))) { pitch += d; break; }
                    }
                  }
                  while (pitch < rhLo) pitch += 12;
                  while (pitch > rhHi) pitch -= 12;
                  // no seconds against the chord sounding under the echo:
                  // a tone a step from a held chord tone moves an octave or
                  // drops out of the line
                  const chordTones = rhPoolAt(barStart);
                  if (chordTones.some((cp) => Math.abs(cp - pitch) <= 2)) {
                    const alt = pitch + 12 <= rhHi && !chordTones.some((cp) => Math.abs(cp - (pitch + 12)) <= 2) ? pitch + 12
                      : pitch - 12 >= rhLo && !chordTones.some((cp) => Math.abs(cp - (pitch - 12)) <= 2) ? pitch - 12 : null;
                    if (alt === null) continue;
                    pitch = alt;
                  }
                  if (!echo.includes(pitch)) echo.push(pitch);
                }
                const notes = echo.slice(0, 5);
                notes.forEach((pitch, i) => {
                  const onset = barStart + i * eighth;
                  if (onset >= barEnd) return;
                  if (i === notes.length - 1) pushHeld(onset, pitch, { until: barEnd, fig: 'answer', priority: 1 });
                  else candidates.push({ pitch, startTick: onset, durationTicks: damp(onset, Math.min(eighth, barEnd - onset)), ...(relief ? { relief: true } : {}), priority: 1, fig: 'answer' });
                });
              }
          }
        }
      }
    }
  }

  /* ---------------- §16.9: the retrigger and the concurrency cap ---------- */

  // Same-pitch retrigger: when a held note's pitch is struck again, the
  // earlier note ends at the new onset; identical onsets keep their longest
  // note. Runs on the WRITTEN onsets (the jitter never moves a note's end,
  // so the no-overlap property survives it) and keeps sanitizeNotes a
  // no-op.
  const pianoRaw = candidatesByPart.piano;
  if (pianoRaw && pianoRaw.length) {
    pianoRaw.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch || b.durationTicks - a.durationTicks);
    const byPitch = new Map<number, KeysCandidate[]>();
    for (const c of pianoRaw) {
      const arr = byPitch.get(c.pitch) ?? [];
      arr.push(c);
      byPitch.set(c.pitch, arr);
    }
    for (const arr of byPitch.values()) {
      const kept: KeysCandidate[] = [];
      for (const c of arr) {
        const prev = kept[kept.length - 1];
        if (prev && prev.startTick === c.startTick) { c.drop = true; continue; } // identical onset: keep the longest
        if (prev && prev.startTick + prev.durationTicks > c.startTick) {
          prev.durationTicks = Math.max(1, c.startTick - prev.startTick); // the retrigger ends the earlier note
        }
        kept.push(c);
      }
    }
    // the polyphony cap (§16.9): at most 8 simultaneous, at most 2 below
    // MIDI 55, at most 6 at or above 55 — the earliest still-sounding note
    // in the offending band ends at the new onset (figures cull first).
    const live: KeysCandidate[] = [];
    const onsets = [...new Set(pianoRaw.filter((c) => !c.drop).map((c) => c.startTick))].sort((a, b) => a - b);
    for (const t of onsets) {
      for (let i = live.length - 1; i >= 0; i--) {
        if (live[i].startTick + live[i].durationTicks <= t) live.splice(i, 1);
      }
      const starting = pianoRaw.filter((c) => !c.drop && c.startTick === t);
      for (const c of starting) {
        const cLow = c.pitch < 55;
        let guard = 0;
        while (guard++ < 24) {
          const total = live.length;
          const lowN = live.filter((a) => a.pitch < 55).length;
          const highN = total - lowN;
          const overTotal = total + 1 > PIANO_CONCURRENCY.total;
          const overBand = cLow ? lowN + 1 > PIANO_CONCURRENCY.below55 : highN + 1 > PIANO_CONCURRENCY.at55;
          if (!overTotal && !overBand) break;
          const band = cLow ? live.filter((a) => a.pitch < 55) : live.filter((a) => a.pitch >= 55);
          const pool = band.length ? band : live;
          if (!pool.length) { c.drop = true; break; }
          pool.sort((a, b) => (a.priority ?? 1) - (b.priority ?? 1) || a.startTick - b.startTick);
          const victim = pool[0];
          const newEnd = Math.max(1, t - victim.startTick);
          if (newEnd <= 1) {
            const idx = live.indexOf(victim);
            if (idx >= 0) live.splice(idx, 1);
            continue;
          }
          victim.durationTicks = newEnd;
          if ((victim.priority ?? 1) >= 2) {
            // the held chord releases as a unit: every live held voice ends
            // together (the chord breathes — the equality rule survives the
            // cap)
            for (const o of live) {
              if ((o.priority ?? 1) >= 2 && o !== victim && o.startTick + o.durationTicks > t) o.durationTicks = Math.max(1, t - o.startTick);
            }
          }
          const idx = live.indexOf(victim);
          if (idx >= 0 && victim.startTick + victim.durationTicks <= t) live.splice(idx, 1);
        }
        if (!c.drop) live.push(c);
      }
    }
    pianoCandsFinal = pianoRaw.filter((c) => !c.drop);
  }

  /* ---------------- phase B: velocities over the whole mix ---------------- */

  const rosterRoles = new Set(template.roster.map((r) => r.role));
  const byRole = (notesById: Record<string, Note[]>) =>
    Object.entries(notesById)
      .map(([id, notes]) => ({ role: project.tracks.find((t) => t.id === id)?.role ?? '', notes }))
      .filter((r) => rosterRoles.has(r.role));
  const others = [
    ...ruleNotes.filter((r) => rosterRoles.has(r.role)),
    ...byRole(stringsNotes),
    ...byRole(brassNotes),
    ...byRole(windNotes),
    ...byRole(percNotes),
  ];
  if (pianoCandsFinal) candidatesByPart.piano = pianoCandsFinal;
  const allKeys = KEYS_PARTS.map((p) => ({ role: p, notes: candidatesByPart[p] ?? [] })).filter((r) => r.notes.length);
  const pianoCands = candidatesByPart.piano ?? [];

  // §16.9 (11.6): the golden105 role-map. The windows where the PRE-11.6
  // engine's piano sounded WITHOUT the 11.4 absorb tag are the windows the
  // harp's shaped velocities were computed WITH a piano role in; the new
  // piano joins the role set in exactly those windows and stays out
  // everywhere else, so the harp's shaped velocities — and therefore its
  // bytes — are unchanged outside the windows the old safety pass fired
  // in. Read-only: it drives no rendering.
  const ostTexAt = (bar: number): boolean => {
    const tex = textureForType(ctx, sectionTypeNameAtBar(ctx, bar));
    return tex.id === 'singleOstinato' || tex.id === 'interlockingOstinato' || tex.id === 'trailer';
  };
  const winOf = (tick: number): { bar: number; winStart: number; winEnd: number } => {
    const bar = Math.min(bars, Math.max(1, Math.floor(tick / btBar) + 1));
    const barStart = (bar - 1) * btBar;
    const idx = Math.min(3, Math.floor((tick - barStart) / beat));
    return { bar, winStart: barStart + idx * beat, winEnd: barStart + (idx + 1) * beat };
  };
  const oldRolePresence = (bar: number, winStart: number): boolean => {
    const planBar = planByBar.get(bar);
    if (!planBar) return false;
    const m = momentForBar(ctx.moments, bar);
    if (m?.kind === 'tutti') {
      const hitLen = m.shape === 'breath' ? beat : m.shape === 'decay' ? beat * 2 : btBar;
      return winStart < (bar - 1) * btBar + hitLen;
    }
    if (bar === bars) return winStart < (bar - 1) * btBar + beat * 2; // the final anchor (half a bar)
    const norm = planBar.norm;
    if (norm < KEYS_GATES.low) return false;
    const sec = ctx.sections.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
    const chorus = isChorusTypeK(sec?.name);
    if (m?.kind === 'soli' || m?.kind === 'unison' || ctx.arc?.[bar - 1]?.nearSilence) return false;
    if (chorus) return true; // the relief drive, every window
    const secStart = sec?.startBar ?? 1;
    const barStart = (bar - 1) * btBar;
    const isFill = fillBarSet.has(bar);
    if (isFill) {
      // the comp chord (downbeat, held to the span/bar) + the answer eighths (the back half)
      const chordEnd = Math.min(spanEndOf(barStart), bar * btBar);
      return winStart < chordEnd || winStart >= barStart + 4 * eighth;
    }
    if (PIANO_ARP_TEMPLATES.has(template.id)) {
      if (norm < KEYS_GATES.high) return true; // the arp, every eighth
      return ostTexAt(bar); // the pulse, every quarter (ostinato/trailer textures)
    }
    const phraseStart = bar === secStart || (bar - secStart) % 4 === 0;
    if (phraseStart && norm < KEYS_GATES.peak) {
      // the comp chord: below the mid gate it rode the role set; from the
      // mid gate it carried the 11.4 absorb tag (out of the role set)
      if (norm < KEYS_GATES.mid) return winStart < Math.min(spanEndOf(barStart), bar * btBar);
      return false;
    }
    return false;
  };
  // tag every piano candidate: absorb iff NO window it sounds in carried
  // the old non-absorb presence (a held ring never straddles the two —
  // both engines bound their holds by the same span math)
  for (const c of pianoCands) {
    const w0 = winOf(c.startTick);
    const wEnd = winOf(Math.max(c.startTick, c.startTick + c.durationTicks - 1));
    let oldPresence = false;
    for (let bar = w0.bar; bar <= wEnd.bar && !oldPresence; bar++) {
      const barStart = (bar - 1) * btBar;
      const from = bar === w0.bar ? w0.winStart : barStart;
      const to = bar === wEnd.bar ? wEnd.winStart : barStart + btBar - beat;
      for (let ws = from; ws <= to; ws += beat) {
        if (oldRolePresence(bar, ws)) { oldPresence = true; break; }
      }
    }
    if (!oldPresence) c.absorb = true;
  }

  interface AbsorbWindow { start: number; end: number; bound: number; absorb: boolean; pianoIdx: number[] }
  const windows: AbsorbWindow[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const barStart = bar * btBar;
    for (let off = 0; off < btBar; off += beat) {
      const start = barStart + off;
      if (start >= endTick) continue;
      const end = Math.min(endTick, start + beat);
      const roles = new Set<string>();
      for (const r of others) if (r.notes.some((n) => n.startTick < end && n.startTick + n.durationTicks > start)) roles.add(r.role);
      const pianoIdx: number[] = [];
      for (const r of allKeys) {
        const cands = r.notes;
        for (let i = 0; i < cands.length; i++) {
          const c = cands[i];
          if (c.startTick < end && c.startTick + c.durationTicks > start) {
            // §16.4 (11.4): the absorb-tagged candidates are NEW keys
            // presence — the phase-B bounds must stay the 11.1 role sets
            // (the harp's shaped velocities — and therefore its bytes —
            // read them), so they join the window's piano list WITHOUT
            // joining the role set. Their clamp excess is absorbed by the
            // compose.ts pass, which caps the PIANO ALONE.
            if (!(r.role === 'piano' && c.absorb)) roles.add(r.role);
            if (r.role === 'piano') pianoIdx.push(i);
          }
        }
      }
      windows.push({ start, end, bound: roles.size ? maxMeanVelocityFor(N, clampMax, roles.size) : 127, absorb: pianoIdx.some((i) => pianoCands[i]?.absorb === true), pianoIdx });
    }
  }
  const boundAt = (tick: number): number => {
    let b = 127;
    for (const w of windows) {
      if (tick >= w.start && tick < w.end) b = Math.min(b, w.bound);
    }
    return b;
  };

  // pass 1: the shaped velocities (stored on the candidates)
  for (const part of KEYS_PARTS) {
    const candidates = candidatesByPart[part];
    if (!candidates) continue;
    for (const c of candidates) {
      const bar = Math.min(bars, Math.max(1, Math.floor(c.startTick / btBar) + 1));
      const bound = boundAt(Math.min(endTick - 1, c.startTick));
      const norm = planByBar.get(bar)?.norm ?? 0;
      let v: number;
      if (c.moment) v = Math.min(momentVelocity(bar), bound);
      else if (c.relief) {
        // the chorus relief rides the ABSOLUTE scale (the percussion drive's
        // rule): the clamp guarantee stays with the final safety pass
        v = Math.max(1, Math.round(RELIEF_VELOCITY * (c.ramp !== undefined ? 0.45 + 0.35 * c.ramp : 1) * (c.velScale ?? 1)));
      } else {
        const shaped = Math.max(1, Math.round(1 + (Math.min(bound, KEYS_VELOCITY_CEILING) - 1) * Math.min(1, Math.max(0, norm))));
        const accent = c.articulation === 'marcato' ? 8 : 0;
        const rampScale = c.ramp !== undefined ? 0.45 + 0.35 * c.ramp : 1;
        // §16.6 (11.5): the high-octave dry pluck sparkle softens at low
        // energy (0.7 below the mid gate — soft, dry, never leading)
        const softScale = c.soft && norm < KEYS_GATES.mid ? 0.7 : 1;
        v = Math.max(1, Math.round(Math.min(bound, shaped + accent) * rampScale * softScale));
      }
      c.v = Math.max(1, Math.min(127, c.relief || c.moment ? v : Math.min(v, bound)));
    }
  }

  // pass 2: the notes (the jitter hash reads the pitch and the written onset
  // only — never the velocity — so the absorption cap in compose.ts never
  // moves a note in time)
  for (const part of KEYS_PARTS) {
    const track = trackOf.get(part);
    const candidates = candidatesByPart[part];
    if (!track || !candidates) continue;
    const prof = KEYS_PROFILES[part];
    const [msLo, msHi] = prof.timingMs;
    const ordered = [...candidates].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
    const notes: Note[] = [];
    for (const c of ordered) {
      const bar = Math.min(bars, Math.max(1, Math.floor(c.startTick / btBar) + 1));
      const v = c.v ?? 1;
      // the micro-timing (§16.7): a hash-seeded lag in the part's ms range,
      // clamped inside the written bar (a note never crosses its bar or a
      // moment boundary because of the jitter). The note's END stays where
      // the figure put it — the damping boundaries hold at the lagged onset.
      const h = hashString(`${track.id}|${c.startTick}|${c.pitch}`);
      const ms = msLo + (h / 0xffffffff) * (msHi - msLo);
      const jitter = Math.max(0, Math.round(msToTicks(ms, project.tempoMap)));
      const barStart = (bar - 1) * btBar;
      const barEnd = Math.min(endTick, bar * btBar);
      const start2 = Math.max(barStart, Math.min(barEnd - 1, c.startTick + jitter));
      const end2 = Math.min(barEnd, c.startTick + c.durationTicks);
      notes.push({
        pitch: c.pitch, startTick: start2, durationTicks: Math.max(1, end2 - start2), velocity: v,
        ...(c.articulation !== undefined ? { articulation: c.articulation } : {}),
        ...(c.layer !== undefined ? { layer: c.layer } : {}),
      });
    }
    if (part === 'piano' && notes.length) {
      // §16.9 post-jitter enforcement: the same retrigger and band caps on
      // the FINAL (jittered) schedule — the starts shift late, the ends stay
      // where the figure put them, so the written-time pass can miss an
      // overlap the shifted schedule creates. sanitizeNotes stays a no-op.
      notes.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch || b.durationTicks - a.durationTicks);
      const byPitch = new Map<number, Note[]>();
      for (const n of notes) {
        const arr = byPitch.get(n.pitch) ?? [];
        arr.push(n);
        byPitch.set(n.pitch, arr);
      }
      const dropped = new Set<Note>();
      for (const arr of byPitch.values()) {
        const kept: Note[] = [];
        for (const n of arr) {
          const prev = kept[kept.length - 1];
          if (prev && prev.startTick === n.startTick) { dropped.add(n); continue; }
          if (prev && prev.startTick + prev.durationTicks > n.startTick) {
            prev.durationTicks = Math.max(1, n.startTick - prev.startTick);
          }
          kept.push(n);
        }
      }
      const liveNotes: Note[] = [];
      const finalOnsets = [...new Set(notes.filter((n) => !dropped.has(n)).map((n) => n.startTick))].sort((a, b) => a - b);
      for (const t of finalOnsets) {
        for (let i = liveNotes.length - 1; i >= 0; i--) {
          if (liveNotes[i].startTick + liveNotes[i].durationTicks <= t) liveNotes.splice(i, 1);
        }
        const starting = notes.filter((n) => !dropped.has(n) && n.startTick === t);
        for (const n of starting) {
          const nLow = n.pitch < 55;
          let guard = 0;
          while (guard++ < 24) {
            const total = liveNotes.length;
            const lowN = liveNotes.filter((a) => a.pitch < 55).length;
            const overTotal = total + 1 > PIANO_CONCURRENCY.total;
            const overBand = nLow ? lowN + 1 > PIANO_CONCURRENCY.below55 : total - lowN + 1 > PIANO_CONCURRENCY.at55;
            if (!overTotal && !overBand) break;
            const band = liveNotes.filter((a) => (a.pitch < 55) === nLow);
            const pool = band.length ? band : liveNotes;
            if (!pool.length) { dropped.add(n); break; }
            pool.sort((a, b) => a.startTick - b.startTick);
            const victim = pool[0];
            const newEnd = Math.max(1, t - victim.startTick);
            if (newEnd <= 1) {
              const idx = liveNotes.indexOf(victim);
              if (idx >= 0) liveNotes.splice(idx, 1);
              continue;
            }
            victim.durationTicks = newEnd;
            if ((victim as any).priority !== 1) {
              for (const o of liveNotes) {
                if ((o as any).priority !== 1 && o !== victim && o.startTick + o.durationTicks > t) o.durationTicks = Math.max(1, t - o.startTick);
              }
            }
            const idx = liveNotes.indexOf(victim);
            if (idx >= 0 && victim.startTick + victim.durationTicks <= t) liveNotes.splice(idx, 1);
          }
          if (!dropped.has(n)) liveNotes.push(n);
        }
      }
      notesByTrackId[track.id] = notes.filter((n) => !dropped.has(n));
      reports.push(`keys piano: post-jitter cap enforced over ${notes.length} notes (${dropped.size} dropped)`);
    } else {
      notesByTrackId[track.id] = sanitizeNotes(notes, track.lowestNote, track.highestNote, endTick);
    }
    const count = notesByTrackId[track.id].length;
    if (count) reports.push(`keys ${part}: ${count} notes (range ${track.lowestNote}-${track.highestNote}, lag ${msLo}-${msHi} ms)`);
  }

  return { notesByTrackId, reports, absorbWindows: windows.filter((w) => w.pianoIdx.length > 0).map((w) => ({ start: w.start, end: w.end })) };
}

/**
 * §16.4 (Phase 11.4): the piano's absorption pass. The NEW mid-energy
 * comping is keys presence the other families' caps never saw (their
 * windows were computed without a keys role where the generator's phantom
 * keys was silent), so the raw mix can breach the hard clamp and the final
 * keys safety pass would lower KEYS ALONE — moving the harp off the
 * golden103 bytes. Over the windows renderKeys marked as holding the new
 * comping (post-humanize, post-legato — the SAME state the safety pass
 * reads) this pass caps the PIANO ALONE: its notes' velocity sum in the
 * window is lowered so the window's energy stays inside the clamp with the
 * harp untouched. Runs immediately BEFORE governKeysVelocities; with the
 * absorption in place the safety pass fires exactly where (and only where)
 * it fired at Phase 11.1.
 */
export function absorbPianoVelocities(input: {
  template: NonNullable<OrchestratorContext['template']>;
  piano: { role: string; notes: Note[] };
  harp: { role: string; notes: Note[] } | null;
  otherNotes: { role: string; notes: Note[] }[];
  windows: { start: number; end: number }[];
}): void {
  const { template, piano, harp, otherNotes, windows } = input;
  const clampMax = template.budget.energyClamp[1];
  const N = template.roster.length;
  const rosterRoles = new Set(template.roster.map((r) => r.role));
  const others = otherNotes.filter((r) => rosterRoles.has(r.role));
  const harpNotes = harp && rosterRoles.has(harp.role) ? harp.notes : [];
  for (const w of windows) {
    const roles = new Set<string>();
    let otherSum = 0;
    let otherCount = 0;
    let harpSum = 0;
    let harpCount = 0;
    const pianoIdx: number[] = [];
    for (const r of others) {
      for (const n of r.notes) {
        if (n.startTick < w.end && n.startTick + n.durationTicks > w.start) { roles.add(r.role); otherSum += n.velocity; otherCount++; }
      }
    }
    for (const n of harpNotes) {
      if (n.startTick < w.end && n.startTick + n.durationTicks > w.start) { roles.add('harp'); harpSum += n.velocity; harpCount++; }
    }
    piano.notes.forEach((n, i) => {
      if (n.startTick < w.end && n.startTick + n.durationTicks > w.start) { roles.add('piano'); pianoIdx.push(i); }
    });
    const count = otherCount + harpCount + pianoIdx.length;
    if (!count || !roles.size || !pianoIdx.length) continue;
    const allowedKeys = (127 * clampMax * N * count) / roles.size - otherSum;
    const pianoAllowed = allowedKeys - harpSum;
    const pianoSum = pianoIdx.reduce((a, i) => a + piano.notes[i].velocity, 0);
    if (pianoSum <= pianoAllowed) continue;
    const cap = Math.max(0, pianoAllowed) / pianoSum;
    for (const i of pianoIdx) {
      const n = piano.notes[i];
      n.velocity = Math.max(1, Math.floor(n.velocity * cap));
    }
  }
}

/**
 * The final keys safety pass (§16.8): re-checks every beat window over the
 * FINAL notes (the strings' humanize/legato may have moved attacks across
 * window boundaries) and lowers KEYS ALONE where the mix would breach the
 * hard clamp. With properly capped velocities this never fires — it is the
 * clamp's guarantee, not a shaper.
 */
export function governKeysVelocities(input: {
  project: Project;
  template: NonNullable<OrchestratorContext['template']>;
  keys: { role: string; notes: Note[] }[];
  otherNotes: { role: string; notes: Note[] }[];
}): void {
  const { project, template, keys, otherNotes } = input;
  const clampMax = template.budget.energyClamp[1];
  const N = template.roster.length;
  const rosterRoles = new Set(template.roster.map((r) => r.role));
  const btBar = barTicks(project.timeSignature);
  const bars = projectBars(project);
  const endTick = bars * btBar;
  const bt = beatTicks(project.timeSignature);
  const others = otherNotes.filter((r) => rosterRoles.has(r.role));
  const keysRoles = keys.filter((r) => rosterRoles.has(r.role) && r.notes.length);
  if (!keysRoles.length) return;
  for (let bar = 0; bar < bars; bar++) {
    const barStart = bar * btBar;
    for (let off = 0; off < btBar; off += bt) {
      const start = barStart + off;
      if (start >= endTick) continue;
      const end = Math.min(endTick, start + bt);
      const roles = new Set<string>();
      let otherSum = 0;
      let keysSum = 0;
      let count = 0;
      for (const r of others) {
        for (const n of r.notes) {
          if (n.startTick < end && n.startTick + n.durationTicks > start) { roles.add(r.role); otherSum += n.velocity; count++; }
        }
      }
      for (const r of keysRoles) {
        for (const n of r.notes) {
          if (n.startTick < end && n.startTick + n.durationTicks > start) { roles.add(r.role); keysSum += n.velocity; count++; }
        }
      }
      if (!roles.size || !count || !keysSum) continue;
      const energy = (roles.size / N) * (((otherSum + keysSum) / count) / 127);
      if (energy <= clampMax + 1e-9) continue;
      const allowedTotal = (127 * clampMax * N * count) / roles.size;
      const targetKeys = Math.max(0, allowedTotal - otherSum);
      const scale = targetKeys / keysSum;
      if (scale >= 1) continue;
      for (const r of keysRoles) {
        for (const n of r.notes) {
          if (n.startTick < end && n.startTick + n.durationTicks > start) {
            n.velocity = Math.max(1, Math.floor(n.velocity * scale));
          }
        }
      }
    }
  }
}
