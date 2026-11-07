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
import type { OrchestratorContext } from '../module';
import {
  DRIVE_LOW, HARP_FIGURE_UNIT_BARS, KEYS_GATES, KEYS_PARTS, KEYS_PROFILES, PIANO_LH, PIANO_SPARKLE_CAP,
  VB_LOW, VB_SPARKLE, VB_SPARKLE_TOP, isChorusTypeK, keysRosterOf,
  type HarpFigure, type KeysPart, type PianoPattern,
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
export const COMP_CHORD_VOICES = 4;

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
}

const pcOf = (p: number): number => ((p % 12) + 12) % 12;

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

  /* ---------- §16.2a/§16.3a helpers (Phase 11.1, piano only) ------------- */

  // the drawn piano pattern per section instance (the plan's menu draw)
  const patternByStart = new Map<number, PianoPattern>(plan.pianoPatterns.map((e) => [e.startBar, e.pattern]));
  // §16.5 (11.5): the chorus figure per four-bar phrase (the plan's rotation;
  // the block slot arrives RESOLVED to a drive variant)
  const chorusFiguresByStart = new Map<number, PianoPattern[]>(plan.chorusFigures.map((e) => [e.startBar, e.figures]));
  // §16.6 (11.5): the harp's bed figure per two-bar unit
  const harpFiguresByStart = new Map<number, HarpFigure[]>(plan.harpFigures.map((e) => [e.startBar, e.figures]));
  const patternOfBar = (bar: number): PianoPattern | null => {
    const sec = ctx.sections.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
    if (!sec) return null;
    if (isChorusTypeK(sec.name)) {
      const figures = chorusFiguresByStart.get(sec.startBar);
      if (!figures) return patternByStart.get(sec.startBar) ?? null;
      const phrase = Math.floor((bar - sec.startBar) / 4);
      return figures[Math.min(phrase, figures.length - 1)] ?? null;
    }
    return patternByStart.get(sec.startBar) ?? null;
  };
  const fillBarSet = new Set(plan.fillBars);
  // the strings-register check: the octave band holding the violas'/cellos'
  // median pitch in the bar (null when neither desk sounds there) — the
  // piano's right-hand material moves up out of it (the rule yields at the
  // window's top). Pitch-only: the window roles, the note counts and the
  // velocities are untouched, so no other track can move through it.
  const stringsBandCache = new Map<number, [number, number] | null>();
  const stringsBandAt = (bar: number): [number, number] | null => {
    if (stringsBandCache.has(bar)) return stringsBandCache.get(bar)!;
    const s = (bar - 1) * btBar;
    const e = bar * btBar;
    const pitches: number[] = [];
    for (const id of Object.keys(stringsNotes)) {
      const role = project.tracks.find((t) => t.id === id)?.role;
      if (role !== 'violas' && role !== 'cellosBasses') continue;
      for (const n of stringsNotes[id] ?? []) {
        if (n.startTick < e && n.startTick + n.durationTicks > s) pitches.push(n.pitch);
      }
    }
    let out: [number, number] | null = null;
    if (pitches.length) {
      const sorted = [...pitches].sort((a, b) => a - b);
      const med = sorted[Math.floor(sorted.length / 2)];
      const base = 12 * Math.floor(med / 12);
      out = [base, base + 12];
    }
    stringsBandCache.set(bar, out);
    return out;
  };
  const outOfStringsBand = (p: number, hi: number, bar: number): number => {
    const band = stringsBandAt(bar);
    if (band && p >= band[0] && p < band[1] && p + 12 <= hi) return p + 12;
    return p;
  };
  /** The relief drive's voicing variant (§16.3a): the Phase 11 chord rule
   *  (ascending distinct pitch classes from the window floor's root, at
   *  most COMP_CHORD_VOICES voices — the count rule the relief's energy
   *  was measured with) with the variant's octave placement inside
   *  [lo, hi]. The tone placement WRAPS an octave down when the scan
   *  reaches the window top, so the count is min(cap, #pcs) in EVERY
   *  window — the relief's per-strike voice count, velocity and therefore
   *  energy are identical to the Phase 11 drive's (whose windows sit at
   *  the clamp on the tight templates — the safety pass must keep firing
   *  exactly as before, or the clamped harp moves). Pitch-only otherwise.
   *  §16.2b (11.4): the sparkle BODY window is 10 semitones wide, so a
   *  root (or a tone) whose pitch class has no fold inside it takes the
   *  rescue path — the whole chord, or the single tone, drops to the low
   *  band (zone-free, count-preserving). The strings-register check
   *  applies where it was designed (the mid 62-84 windows); the sparkle
   *  and low registers sit outside the strings' octave band by
   *  construction, and moving a body tone up would break the cap. */
  const driveChord = (pcs: Set<number>, rootPc: number, variant: PianoPattern, loB: number, hiB: number, bar: number): number[] => {
    let base0 = foldPc(rootPc, loB, hiB);
    let lo = loB;
    let hi = hiB;
    if (base0 === null && zoneFree) {
      base0 = foldPc(rootPc, DRIVE_LOW[0], DRIVE_LOW[1]);
      lo = DRIVE_LOW[0];
      hi = DRIVE_LOW[1];
    }
    if (base0 === null) return [];
    const tones: number[] = [];
    const voiced = new Set<number>();
    for (let off = 0; off < 12 && tones.length < COMP_CHORD_VOICES; off++) {
      const pc = ((rootPc + off) % 12 + 12) % 12;
      if (!pcs.has(pc) || voiced.has(pc)) continue;
      let p = base0 + ((pc - base0) % 12 + 12) % 12;
      if (p > hi) p -= 12;
      if (p < lo || p > hi) {
        const rescue = zoneFree ? foldPc(pc, DRIVE_LOW[0], DRIVE_LOW[1]) : null;
        if (rescue === null) continue;
        p = rescue;
      }
      tones.push(p);
      voiced.add(pc);
    }
    const fits = (p: number): boolean => p >= lo && p <= hi;
    if (variant === 'driveInvert' && tones.length && fits(tones[tones.length - 1] - 12)) {
      tones[tones.length - 1] -= 12;
    } else if (variant === 'driveOpen' && tones.length >= 2 && fits(tones[1] + 12)) {
      tones[1] += 12;
    } else if (variant === 'driveTight') {
      // the compact voicing packs the tones at the window's floor — the
      // pack stops at the 48 line (folding a tone under 48 next to its
      // upper neighbour stacks the close thirds the low-interval rule
      // forbids; the pack keeps the octave above it)
      for (let i = 0; i < tones.length; i++) {
        while (tones[i] - 12 >= lo && tones[i] > lo + 11 && tones[i] - 12 >= 48) tones[i] -= 12;
      }
    }
    tones.sort((a, b) => a - b);
    if (lo < 48) {
      // §16.6 (11.5) the low-interval rule — the spec's own reading: the
      // GROUPS BELOW MIDI 48 (both notes under 48) must sit a fifth or
      // wider apart, or be single notes. The filter runs AFTER the voicing
      // tweaks (the invert's dropped top tone would re-stack a third under
      // the root). A tone is kept unless the interval down to the last kept
      // tone is closer than a fifth with BOTH ends under 48; the root's own
      // octave joins first and a too-close tone LIFTS an octave inside the
      // band (the count-preserving rescue — the drive keeps its per-strike
      // voice count).
      if (base0 + 12 <= hi && !tones.includes(base0 + 12)) tones.push(base0 + 12);
      const pass = (input: number[]): number[] => {
        const kept: number[] = [];
        for (const t of input) {
          const last = kept[kept.length - 1];
          if (last === undefined || t - last >= 7 || last >= 48 || t >= 48) { kept.push(t); continue; }
          const lift = t + 12;
          const last2 = kept[kept.length - 1];
          if (lift <= hi && (last2 === undefined || lift - last2 >= 7 || last2 >= 48 || lift >= 48)) kept.push(lift);
        }
        return kept;
      };
      tones.sort((a, b) => a - b);
      const kept = pass(tones);
      // the octave lifts insert out of order — re-sort and re-check the
      // sorted adjacency once (a tone the second pass cannot place drops)
      kept.sort((a, b) => a - b);
      const kept2 = pass(kept);
      tones.length = 0;
      tones.push(...kept2);
    }
    if (zoneFree) return tones.sort((a, b) => a - b);
    return tones.map((p) => outOfStringsBand(p, hi, bar)).sort((a, b) => a - b);
  };

  /* ---------------- phase A: candidates per part (no velocities yet) ------ */

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
      const barHere = Math.min(bars, Math.max(1, Math.floor(tick / btBar) + 1));
      const base0 = foldPc(rootPc, Math.max(winLo, lo), Math.min(winHi, hi));
      if (base0 === null) return [];
      const out: number[] = [];
      for (let p = base0; p <= Math.min(winHi, hi, base0 + 24); p++) {
        if (!pcs.has(pcOf(p))) continue;
        const shifted = zoneShift(p, lo, hi, part === 'piano');
        if (shifted === null) continue;
        const fixed = part === 'piano' ? outOfStringsBand(shifted, Math.min(winHi, hi), barHere) : shifted;
        if (!out.includes(fixed)) out.push(fixed);
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
        if (kind === 'arp') {
          // the arpeggiator: broken-chord eighths in the mid register
          // (§16.3) — the pool rebuilt at every onset (the half-bar chord
          // walk); the relief rides the floor
          const relief = reliefAt(bar, planBar.norm);
          const nSlots = Math.max(1, Math.floor((barEnd - barStart) / eighth));
          for (let i = 0; i < nSlots; i++) {
            const onset = barStart + i * eighth;
            const pool = figurePool(onset, prof.sweet[0], prof.sweet[1]);
            if (!pool.length) continue;
            const pitch = pool[i % pool.length];
            candidates.push({ pitch, startTick: onset, durationTicks: damp(onset, Math.min(onset + eighth, barEnd) - onset), ...(relief ? { relief: true } : {}) });
          }
        } else if (kind === 'final') {
          // the closing hit: the final chord's root, low, marcato, half a
          // bar — the landing chord must still sound (§16.5); the harp
          // carries the closing arpeggio, the piano anchors its root (one
          // voice — and no octave pair against the harp's figure under the
          // forbidden doubling policies). The half-bar length keeps the hit
          // on the figuration exemption's short side against the strings'
          // long landing chord (the doubling audit reads it as a figure).
          const { rootPc } = chordPcsAt(barStart);
          const pitch = foldPc(rootPc, Math.max(prof.low[0], lo), Math.min(prof.low[1], hi));
          if (pitch !== null) {
            candidates.push({ pitch, startTick: barStart, durationTicks: damp(barStart, Math.min(beat * 2, barEnd - barStart)), articulation: 'marcato' });
          }
        } else if (kind === 'pulse') {
          // the low octave pulse: the root, quarters (downbeat + beats 2–4),
          // ringing a beat each (§16.3 — never faster than eighths); in the
          // chorus relief it is the non-arpeggiating piano's drive line (the
          // timpani drive's grid analogue — a fresh hit every quarter)
          const relief = reliefAt(bar, planBar.norm);
          const { rootPc } = chordPcsAt(barStart);
          const pitch = foldPc(rootPc, Math.max(prof.low[0], lo), Math.min(prof.low[1], hi));
          if (pitch !== null) {
            const hits = relief ? [0, 1, 2, 3] : [0, 2];
            for (const h of hits) {
              const onset = barStart + h * beat;
              if (onset >= barEnd) break;
              candidates.push({ pitch, startTick: onset, durationTicks: damp(onset, Math.min(beat, barEnd - onset)), articulation: h === 0 ? 'marcato' : undefined, ...(relief ? { relief: true } : {}) });
            }
          }
        } else if (kind === 'comp') {
          // §16.3a (Phase 11.1): the comp instrument realises the section's
          // drawn pattern. The chorus relief keeps the Phase 11 drive grid
          // (a chord on EVERY QUARTER, ringing a beat, the relief velocity)
          // and the drawn variant only re-voices it — the grid, the note
          // counts and the velocities are the relief's own, so the chorus
          // energy is untouched. The other bars play the drawn pattern.
          // Every chord is the main voice + its 'kbd' sisters (§16.1), the
          // pitch classes distinct (no octave sisters — the doubling
          // policies read them as doubles), built per onset (the half-bar
          // chord walk). The right-hand windows: 62-84 (chamber, sonata),
          // the sparkle register (vocalbacking — above the vocal zone; the
          // low root/fifth pattern sits below it, 40-56; never an
          // octave-down fallback). §16.2b (11.4): the sparkle BODY caps at
          // 91 — the 92-96 top is only for the phrase-start chords of
          // peak-level bars (VB_SPARKLE_TOP); the single-line material
          // (eighths, answers) always caps at the body. §16.4 (11.4): the
          // comp gate reaches the PEAK gate — below the HIGH gate the full
          // drawn pattern sounds; above it the comp THINS toward the tacet
          // at the peak gate: one downbeat event in the pattern's own
          // register (the echo, the answer, the left hand, the eighth
          // figures and the off-beat stabs drop). The fill answer bars
          // never thin — the strings rest there and the piano answers.
          // The deliberate left-hand single root/fifth (40-55) rides the
          // chord patterns at phrase starts only. Where the harp shares
          // the bar, the piano keeps the Phase 11 window presence (downbeat
          // events only, a beat long) so the shared window math — and the
          // harp — never moves.
          const secHere = ctx.sections.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
          const secStart = secHere?.startBar ?? 1;
          const relief = reliefAt(bar, planBar.norm);
          const drawn = patternOfBar(bar);
          const loRH = zoneFree ? VB_SPARKLE[0] : prof.comp[0];
          const isPhraseStart = bar === secStart || (bar - secStart) % 4 === 0;
          const hiChord = zoneFree ? (isPhraseStart && planBar.norm >= KEYS_GATES.peak ? VB_SPARKLE_TOP : VB_SPARKLE[1]) : prof.comp[1];
          const hiLine = zoneFree ? VB_SPARKLE[1] : prof.comp[1];
          const thinned = !relief && planBar.norm >= KEYS_GATES.high && !fillBarSet.has(bar);
          // §16.4 (11.4): the NEW keys presence — the mid-energy comping
          // (phrase starts at the mid gate and above that 11.1 never
          // produced). The fill answer bars and the low band [0.30, 0.50)
          // were the 11.1 population; the chorus relief rides its own
          // absolute scale. The absorb-tagged candidates take the
          // phase-B absorption cap so the final safety pass never fires in
          // their windows (the harp's bytes stay on golden103).
          const absorb = !relief && !fillBarSet.has(bar) && planBar.norm >= KEYS_GATES.mid;
          const absorbFrom = candidates.length;
          const harpInBar = (candidatesByPart.harp ?? []).some((c) => c.startTick < barEnd && c.startTick + c.durationTicks > barStart);
          const { pcs: pcs0, rootPc } = chordPcsAt(barStart);
          // the left-hand single root/fifth at phrase starts (derived — no
          // draw): the fifth on the back half of the section. It rides the
          // downbeat-chord patterns only — never the eighth figures, never
          // the off-beat stabs (a lone 'kbd' at the downbeat would have no
          // main voice — the one-voice cap's audit), never the thinned
          // bars — and only on the harp-free templates (chamber, sonata):
          // vocalbacking's shared windows sit at zero energy headroom, so
          // their per-onset voice counts stay exactly the Phase 11 ones.
          const lhPattern = patternOfBar(bar);
          const lhApplies = !relief && !thinned && !zoneFree && isPhraseStart && lhPattern !== null
            && ['block', 'echo', 'callfill', 'dyad'].includes(lhPattern);
          const lhPitch = lhApplies
            ? foldPc(((bar - secStart) % 8) >= 4 ? (rootPc + 7) % 12 : rootPc, zoneFree ? VB_LOW[0] : PIANO_LH[0], zoneFree ? VB_LOW[1] : PIANO_LH[1])
            : null;
          const rhCap = lhPitch !== null ? COMP_CHORD_VOICES - 1 : COMP_CHORD_VOICES;
          // the ascending distinct-pitch-class chord (the Phase 11 count
          // rule: min(cap, #pcs)) with the strings-register check applied
          // per tone in the mid windows. The tone placement WRAPS an octave
          // down at the window top; where the body window is narrower than
          // an octave a wrapping tone RESCUES into the low band (zone-free,
          // count-preserving) instead of dropping.
          const chordWindowOf = (root: number): { lo: number; hi: number; base0: number } | null => {
            const base0 = foldPc(root, loRH, hiChord);
            if (base0 !== null) return { lo: loRH, hi: hiChord, base0 };
            if (!zoneFree) return null;
            const lowBase = foldPc(root, DRIVE_LOW[0], DRIVE_LOW[1]);
            return lowBase === null ? null : { lo: DRIVE_LOW[0], hi: DRIVE_LOW[1], base0: lowBase };
          };
          const rhChord = (pcs: Set<number>, root: number, cap: number): number[] => {
            const w = chordWindowOf(root);
            if (!w) return [];
            const chord: number[] = [];
            const voiced = new Set<number>();
            for (let off = 0; off < 12 && chord.length < cap; off++) {
              const pc = ((root % 12) + 12 + off) % 12;
              if (!pcs.has(pc) || voiced.has(pc)) continue;
              let p = w.base0 + ((pc - w.base0) % 12 + 12) % 12;
              if (p > w.hi) p -= 12;
              if (p < w.lo || p > w.hi) {
                const rescue = zoneFree ? foldPc(pc, DRIVE_LOW[0], DRIVE_LOW[1]) : null;
                if (rescue === null) continue;
                p = rescue;
              }
              chord.push(zoneFree ? p : outOfStringsBand(p, w.hi, bar));
              voiced.add(pc);
            }
            return chord.sort((a, b) => a - b);
          };
          const pushChordBeat = (onset: number, chord: number[]) => {
            chord.forEach((pitch, i) => {
              candidates.push({
                pitch, startTick: onset, durationTicks: damp(onset, Math.min(beat, barEnd - onset)),
                ...(i > 0 ? { layer: 'kbd' as const } : {}), ...(relief ? { relief: true } : {}),
              });
            });
          };
          // §16.5 (11.5) the held-note rule — pedal emulation by length: a
          // chord note sustains to the end of its harmonic span, or the bar
          // line, whichever comes first (at most 1 bar). Where that ring is
          // longer than half a bar the hold RE-TAKES at the half-bar line —
          // the pedal keeps ringing to the span/bar end while every written
          // note stays inside the figuration exemption (≤ half a bar) that
          // keeps the forbidden-doubling templates hard-finding-free against
          // the sustained string pads. No CC. `until` caps the ring earlier
          // (the next strike of the same figure — the pedal continues
          // through the re-strike); the damp boundaries (the tacet, soli and
          // near-silence bars) always win.
          const pushHeldPiano = (onset: number, pitch: number, layer?: Note['layer'], reliefFlag?: boolean, until?: number) => {
            const total = Math.max(1, Math.min(spanEndOf(onset), Math.min(until ?? barEnd, barEnd)) - onset);
            const first = Math.min(total, btBar / 2);
            candidates.push({ pitch, startTick: onset, durationTicks: damp(onset, first), ...(layer ? { layer } : {}), ...(relief || reliefFlag ? { relief: true } : {}) });
            if (total > first) candidates.push({ pitch, startTick: onset + first, durationTicks: damp(onset + first, total - first), ...(layer ? { layer } : {}), ...(relief || reliefFlag ? { relief: true } : {}) });
          };
          const pushHeldChord = (onset: number, chord: number[], until?: number) => {
            chord.forEach((pitch, i) => pushHeldPiano(onset, pitch, i > 0 ? 'kbd' : undefined, relief, until));
          };
          /** The strike grid inside [onset, until): the onset plus every
           *  harmonic-span change — a held chord re-strikes the new chord
           *  there (a ring never outlives its own harmony). */
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
          if (relief) {
            // §16.5 (11.5): the chorus FIGURE — the plan's phrase rotation.
            // Six rhythmic figures replace the all-block chorus (the chorus
            // is no longer only quarter-note block strikes, and one chorus
            // can use two or more figures); the block slot keeps the relief
            // drive's own voicing variants (their realized share of chorus
            // bars is the one menu slot, well under the 25% cap). The held
            // components sustain to the span/bar end (§16.5); the drive
            // strikes keep their quarter grid and voice counts, now with
            // the pedal ring.
            const figure: PianoPattern = drawn ?? 'figRoll';
            const lhLo = zoneFree ? VB_LOW[0] : PIANO_LH[0];
            const lhHi = zoneFree ? VB_LOW[1] : PIANO_LH[1];
            const splitHi = isPhraseStart && planBar.norm >= KEYS_GATES.peak ? VB_SPARKLE_TOP : VB_SPARKLE[1];
            const splitStrike = (pcs: Set<number>, root: number): number[] => {
              const lowRoot = foldPc(root, DRIVE_LOW[0], DRIVE_LOW[1]);
              if (lowRoot === null) return rhChord(pcs, root, COMP_CHORD_VOICES);
              const notes: number[] = [lowRoot];
              // the root's own octave keeps the strike's fourth voice when
              // the low-interval rule costs the low rescue (the octave sits
              // at 48 or above, where the rule does not bind)
              if (lowRoot + 12 <= DRIVE_LOW[1]) notes.push(lowRoot + 12);
              for (let off = 1; off < 12 && notes.length < COMP_CHORD_VOICES; off++) {
                const pc = ((root + off) % 12 + 12) % 12;
                if (!pcs.has(pc)) continue;
                let p = foldPc(pc, VB_SPARKLE[0], splitHi) ?? foldPc(pc, DRIVE_LOW[0], DRIVE_LOW[1]);
                if (p === null) continue;
                // §16.6 (11.5): a low-band rescue stays 5th-or-wider from
                // the low root below MIDI 48 (the low-interval rule — the
                // two folds can sit a step apart; the tone moves an octave
                // up inside the band or drops)
                if (p < 48 && Math.abs(p - lowRoot) < 7) {
                  const alt = p + 12;
                  p = alt <= DRIVE_LOW[1] && Math.abs(alt - lowRoot) >= 7 ? alt : null;
                }
                if (p !== null && !notes.includes(p)) notes.push(p);
              }
              return notes.sort((a, b) => a - b);
            };
            const eighthLine = (onset: number, pitch: number) =>
              candidates.push({ pitch, startTick: onset, durationTicks: damp(onset, Math.min(onset + eighth, barEnd) - onset), relief: true });
            /** §16.6 (11.5) the held pedal under the broken/Alberti figures:
             *  the root, the chord's OWN fifth tone (the rootPc+7 pitch
             *  class — a fifth-below fallback that is not a chord tone
             *  would hand the doubling audit a non-chord-tone pair), and
             *  the octave — every kept tone a fifth or wider from the last
             *  where both ends sit under 48, a too-close tone lifted an
             *  octave inside the band. */
            const heldPedal = (pcs: Set<number>, rootPc: number, loB: number, hiB: number): number[] => {
              const rootNote = foldPc(rootPc, loB, hiB);
              if (rootNote === null) return [];
              const cands = [rootNote];
              const fifthPc = ((rootPc + 7) % 12 + 12) % 12;
              if (pcs.has(fifthPc)) {
                let fifth: number | null = null;
                for (let q = rootNote + 7; q <= hiB; q++) if (((q % 12) + 12) % 12 === fifthPc) { fifth = q; break; }
                if (fifth === null) for (let q = rootNote - 7; q >= loB; q--) if (((q % 12) + 12) % 12 === fifthPc) { fifth = q; break; }
                if (fifth === null) for (let q = loB; q <= hiB; q++) if (((q % 12) + 12) % 12 === fifthPc && Math.min(q, rootNote) >= 48) { fifth = q; break; }
                if (fifth !== null) cands.push(fifth);
              }
              if (rootNote + 12 <= hiB) cands.push(rootNote + 12);
              cands.sort((a, b) => a - b);
              const kept: number[] = [];
              for (const t of cands) {
                const last = kept[kept.length - 1];
                if (last === undefined || t - last >= 7 || last >= 48 || t >= 48) { kept.push(t); continue; }
                const lift = t + 12;
                const last2 = kept[kept.length - 1];
                if (lift <= hiB && (last2 === undefined || lift - last2 >= 7 || last2 >= 48 || lift >= 48)) kept.push(lift);
              }
              return kept;
            };
            if (figure.startsWith('drive')) {
              // the block drive: the Phase 11 grid with the drawn voicing
              // variant. §16.5 (11.5) the pedal ring — the mid/sparkle
              // variants hold to the span/bar line (re-taken at the half
              // bar); the LOW-band strikes (the driveLow chord, the
              // driveSplit's low root) ring only to the NEXT STRIKE — their
              // pedal continues through the re-strike, and the held low
              // tones never overlap the next chord's fold (the low-interval
              // rule reads simultaneous notes; two held strikes a step apart
              // would pair below 48).
              const variant: PianoPattern = figure;
              for (const h of [0, 1, 2, 3]) {
                const onset = barStart + h * beat;
                if (onset >= barEnd) break;
                const { pcs: pcsHere, rootPc: rootHere } = chordPcsAt(onset);
                if (variant === 'driveSplit') {
                  // §16.3a (11.4): the split strike — a low root below the
                  // vocal zone with the remaining chord tones above it (the
                  // sparkle band), nothing in 57-81. The low root rings to
                  // the next strike; the sparkle tones hold the span/bar.
                  const strike = splitStrike(pcsHere, rootHere);
                  const low = strike.length && strike[0] < VB_SPARKLE[0] ? strike[0] : null;
                  const up = strike.filter((p) => p >= VB_SPARKLE[0]);
                  if (low !== null) pushHeldPiano(onset, low, undefined, true, onset + beat);
                  if (up.length) pushHeldChord(onset, up);
                  if (strike.length && low === null) pushHeldChord(onset, strike);
                } else if (variant === 'driveLow') {
                  // §16.3a (11.4): the low variant — the drive's whole chord
                  // folded below the vocal zone (40-56); §16.6 (11.5) fixes
                  // its voicing to the low-interval rule (5th-or-wider
                  // below MIDI 48) inside driveChord, and the strike rings
                  // only to the next (the low band never overlaps strikes).
                  pushHeldChord(onset, driveChord(pcsHere, rootHere, variant, DRIVE_LOW[0], DRIVE_LOW[1], bar), onset + beat);
                } else {
                  pushHeldChord(onset, driveChord(pcsHere, rootHere, variant, loRH, hiChord, bar));
                }
              }
            } else if (figure === 'figRoll') {
              // rolled chord: the chord tones staggered inside the first
              // eighth (60 ticks apart), then held — re-struck (plain chord,
              // chord-fresh) at each harmonic-span change so the ring never
              // outlives its own chord and every beat window stays covered
              const strikes = spanStrikes(barStart, barEnd);
              strikes.forEach((onset, k) => {
                const { pcs: pcsHere, rootPc: rootHere } = chordPcsAt(onset);
                const chord = zoneFree ? splitStrike(pcsHere, rootHere) : rhChord(pcsHere, rootHere, COMP_CHORD_VOICES);
                const until = k + 1 < strikes.length ? strikes[k + 1] : barEnd;
                chord.forEach((pitch, i) => {
                  if (k === 0) pushHeldPiano(barStart + Math.min(i * 60, eighth - 1), pitch, i > 0 ? 'kbd' : undefined, true, until);
                  else pushHeldPiano(onset, pitch, i > 0 ? 'kbd' : undefined, true, until);
                });
              });
            } else if (figure === 'figBroken') {
              // broken-chord eighths in the right hand over a held left-hand
              // root-and-fifth pedal (the octave joins where every interval
              // it forms stays legal below 48 — the pedal keeps the chorus's
              // per-window body at the relief's own density: the drive it
              // replaces struck up to four voices every quarter). The
              // pedal's pitch classes never double in the right hand — no
              // same-track octave pair against the hold. The pedal
              // re-strikes chord-fresh at each span change.
              const rootStrikes = spanStrikes(barStart, barEnd);
              const pedalPcs: number[] = [];
              rootStrikes.forEach((onset, k) => {
                const { pcs: pcsHere, rootPc: rootHere } = chordPcsAt(onset);
                const pedal = heldPedal(pcsHere, rootHere, lhLo, lhHi);
                if (!pedal.length) return;
                for (const p of pedal) pedalPcs.push(p);
                const until = k + 1 < rootStrikes.length ? rootStrikes[k + 1] : barEnd;
                for (const [i, p] of pedal.entries()) pushHeldPiano(onset, p, i > 0 ? 'kbd' : undefined, true, until);
              });
              for (let i = 0; i < 8; i++) {
                const onset = barStart + i * eighth;
                if (onset >= barEnd) break;
                const pool = figurePool(onset, loRH, hiLine).filter((p) => !pedalPcs.some((r) => pcOf(r) === pcOf(p)));
                // the starved-pool fallback: when the pedal's pitch classes
                // consumed every foldable sparkle tone, the eighths re-strike
                // the pedal's own upper tone (the same pitch as the hold —
                // never an octave pair) so the window keeps its body
                const tone = pool.length ? pool[i % pool.length] : pedalPcs.length ? pedalPcs[pedalPcs.length - 1] : null;
                if (tone === null) continue;
                eighthLine(onset, tone);
              }
            } else if (figure === 'figAlberti') {
              // the Alberti order over the chord tones, eighths (chord-fresh
              // per onset) over its own held root-and-fifth pedal (the
              // Alberti bass's downbeat; the octave joins where the
              // low-interval rule allows — the pedal keeps the per-window
              // body at the relief's own density and re-strikes chord-fresh
              // at each span change; its pitch classes never double in the
              // Alberti line). The vocalbacking version splits: the low
              // band carries the pedal, the Alberti line stays in the
              // sparkle band.
              const rootStrikes = spanStrikes(barStart, barEnd);
              const pedalPcs: number[] = [];
              rootStrikes.forEach((onset, k) => {
                const { pcs: pcsHere, rootPc: rootHere } = chordPcsAt(onset);
                const pedal = heldPedal(pcsHere, rootHere, lhLo, lhHi);
                if (!pedal.length) return;
                for (const p of pedal) pedalPcs.push(p);
                const until = k + 1 < rootStrikes.length ? rootStrikes[k + 1] : barEnd;
                for (const [i, p] of pedal.entries()) pushHeldPiano(onset, p, i > 0 ? 'kbd' : undefined, true, until);
              });
              for (let i = 0; i < 8; i++) {
                const onset = barStart + i * eighth;
                if (onset >= barEnd) break;
                const pool = figurePool(onset, loRH, hiLine).filter((p) => !pedalPcs.some((r) => pcOf(r) === pcOf(p)));
                // the Alberti order [0,2,1,2] over the pool; the starved-pool
                // fallback re-strikes the pedal's own upper tone (the same
                // pitch as the hold — never an octave pair) so the window
                // keeps its body
                const tone = pool.length ? pool[[0, 2, 1, 2][i % 4] % pool.length] : pedalPcs.length ? pedalPcs[pedalPcs.length - 1] : null;
                if (tone === null) continue;
                eighthLine(onset, tone);
              }
            } else if (figure === 'figSyncopate') {
              // syncopated pump with held chords: the 3+3+2 eighth cell —
              // each chord held until the next strike, and a harmonic-span
              // change inside a cell re-strikes the new chord (a held chord
              // never outlives its own harmony; every beat window stays
              // covered)
              const cellStrikes: number[] = [];
              for (const [slot, len] of [[0, 3], [3, 3], [6, 2]] as const) {
                const onset = barStart + slot * eighth;
                const next = Math.min(barStart + (slot + len) * eighth, barEnd);
                if (onset >= barEnd) break;
                cellStrikes.push(...spanStrikes(onset, next));
              }
              const uniq = [...new Set(cellStrikes)].sort((a, b) => a - b);
              uniq.forEach((onset, k) => {
                const { pcs: pcsHere, rootPc: rootHere } = chordPcsAt(onset);
                const chord = zoneFree ? splitStrike(pcsHere, rootHere) : rhChord(pcsHere, rootHere, COMP_CHORD_VOICES);
                pushHeldChord(onset, chord, k + 1 < uniq.length ? uniq[k + 1] : barEnd);
              });
            } else if (figure === 'figTopVoice') {
              // sustained chord with a slow top-voice chord-tone line at
              // lower velocity: the full chord holds (re-struck chord-fresh
              // at each span change) and the top voice re-strikes its own
              // tone above it on the slow quarter line — the same pitch
              // (never an octave pair against the hold), clearly below the
              // relief's own velocity
              const heldStrikes = spanStrikes(barStart, barEnd);
              heldStrikes.forEach((onset, k) => {
                const { pcs: pcsHere, rootPc: rootHere } = chordPcsAt(onset);
                const chord = zoneFree ? splitStrike(pcsHere, rootHere) : rhChord(pcsHere, rootHere, COMP_CHORD_VOICES);
                if (!chord.length) return;
                const top = chord[chord.length - 1];
                pushHeldChord(onset, chord, k + 1 < heldStrikes.length ? heldStrikes[k + 1] : barEnd);
                for (const h of [0, 1, 2]) {
                  const lineOnset = onset + h * beat;
                  if (lineOnset >= (k + 1 < heldStrikes.length ? heldStrikes[k + 1] : barEnd)) break;
                  candidates.push({ pitch: top, startTick: lineOnset, durationTicks: damp(lineOnset, Math.min(beat, barEnd - lineOnset)), relief: true, velScale: 0.95 });
                }
              });
            } else if (figure === 'figOctavePulse') {
              // octave-pulse eighths in the left hand under a held
              // right-hand chord: the pulse re-reads the chord at EVERY
              // onset (a half-bar chord change re-folds the root — a stale
              // pitch would be a non-chord tone against the new chord and
              // the doubling audit reads exactly that), the chord never
              // doubles the pulse's pitch class, and the chord re-strikes
              // chord-fresh at each span change
              const rootNote0 = foldPc(chordPcsAt(barStart).rootPc, lhLo, lhHi);
              if (rootNote0 !== null) {
                for (let i = 0; i < 8; i++) {
                  const onset = barStart + i * eighth;
                  if (onset >= barEnd) break;
                  const { rootPc: rootHere } = chordPcsAt(onset);
                  const rootNote = foldPc(rootHere, lhLo, lhHi);
                  if (rootNote === null) continue;
                  const partner = rootNote + 12 <= lhHi ? rootNote + 12
                    : rootNote - 12 >= lhLo ? rootNote - 12
                    : rootNote + 7 <= lhHi ? rootNote + 7
                    : rootNote - 7 >= lhLo ? rootNote - 7 : rootNote;
                  eighthLine(onset, i % 2 === 0 ? rootNote : partner);
                }
                const strikes = spanStrikes(barStart, barEnd);
                strikes.forEach((sOnset, k) => {
                  const { pcs: pcsS, rootPc: rootS } = chordPcsAt(sOnset);
                  const rootS2 = foldPc(rootS, lhLo, lhHi);
                  const upperS = new Set([...pcsS].filter((pc) => rootS2 === null || pc !== pcOf(rootS2)));
                  const chordS = zoneFree ? splitStrike(upperS, rootS).filter((p) => p >= VB_SPARKLE[0]) : rhChord(upperS, rootS, COMP_CHORD_VOICES);
                  if (chordS.length) pushHeldChord(sOnset, chordS, k + 1 < strikes.length ? strikes[k + 1] : barEnd);
                });
              } else {
                pushHeldChord(barStart, rhChord(pcs0, rootPc, COMP_CHORD_VOICES));
              }
            } else {
              pushHeldChord(barStart, rhChord(pcs0, rootPc, COMP_CHORD_VOICES));
            }
          } else {
            const pattern: PianoPattern = drawn && !drawn.startsWith('drive') ? drawn : 'block';
            if (thinned && pattern !== 'lowFifth' && pattern !== 'dyad' && pattern !== 'dyadHigh') {
              // the thinning band: one downbeat event in the pattern's own
              // register, one beat — the 11.4 shape (a longer ring under the
              // hot bridge strings was a sustained octave double the audit
              // flagged; the thinning band keeps the short window-presence
              // footprint)
              pushChordBeat(barStart, rhChord(pcs0, rootPc, COMP_CHORD_VOICES));
            } else if (pattern === 'block' || pattern === 'sparkle' || (pattern === 'highArp' && harpInBar)) {
              // the guide-tone chord on the downbeat (the Phase 11 comp,
              // re-registered; the highArp's harp-shared fallback) — §16.5
              // (11.5): it sustains to the harmonic span or the bar line
              pushHeldChord(barStart, rhChord(pcs0, rootPc, rhCap));
            } else if (pattern === 'echo' || pattern === 'callfill') {
              pushHeldChord(barStart, rhChord(pcs0, rootPc, rhCap));
              if (pattern === 'echo') {
                // a single soft high echo of the chord's top tone in the
                // rest (beat 3), an octave above when the cap allows
                const chord = rhChord(pcs0, rootPc, COMP_CHORD_VOICES);
                if (chord.length) {
                  const cap = zoneFree ? hiLine : PIANO_SPARKLE_CAP;
                  const echoPitch = Math.min(chord[chord.length - 1] + 12, cap);
                  candidates.push({ pitch: outOfStringsBand(echoPitch, cap, bar), startTick: barStart + 2 * beat, durationTicks: damp(barStart + 2 * beat, Math.min(beat, barEnd - barStart - 2 * beat)), ramp: 0.25 });
                }
              } else if (fillBarSet.has(bar)) {
                // the conductor's answer window: the strings rest there —
                // the piano answers with four soft eighths (it never leads)
                for (let i = 0; i < 4; i++) {
                  const onset = barStart + (4 + i) * eighth;
                  if (onset >= barEnd) break;
                  const pool = figurePool(onset, loRH, hiLine);
                  if (!pool.length) continue;
                  candidates.push({ pitch: pool[(i + 1) % pool.length], startTick: onset, durationTicks: damp(onset, Math.min(eighth, barEnd - onset)), ramp: 0.25 });
                }
              }
            } else if (pattern === 'offbeat') {
              // the chord stabs on beats 2 and 4 — §16.5 (11.5): each stab
              // sustains to the span/bar line
              for (const h of [1, 3]) {
                const onset = barStart + h * beat;
                if (onset >= barEnd) break;
                const { pcs: pcsHere, rootPc: rootHere } = chordPcsAt(onset);
                pushHeldChord(onset, rhChord(pcsHere, rootHere, rhCap));
              }
            } else if (pattern === 'lowFifth') {
              // the low root plus fifth below the vocal zone (vocalbacking)
              // — already a single downbeat event, so the thinning band
              // realises exactly this shape too; §16.5 (11.5) holds it to
              // the span/bar line, and the fifth-below fallback is a FIFTH
              // (root − 7) — the low-interval rule's 5th-or-wider spacing
              const root = foldPc(rootPc, VB_LOW[0], VB_LOW[1]);
              if (root !== null) {
                // the chord's OWN fifth tone, placed a fifth from the root
                // when the band allows (a fifth-below fallback that is not a
                // chord tone would hand the doubling audit a non-chord-tone
                // pair)
                const fifthPc = ((rootPc + 7) % 12 + 12) % 12;
                let fifth: number | null = null;
                if (pcs0.has(fifthPc)) {
                  for (let q = root + 7; q <= VB_LOW[1]; q++) if (((q % 12) + 12) % 12 === fifthPc) { fifth = q; break; }
                  if (fifth === null) for (let q = root - 7; q >= VB_LOW[0]; q--) if (((q % 12) + 12) % 12 === fifthPc) { fifth = q; break; }
                  if (fifth === null) for (let q = VB_LOW[0]; q <= VB_LOW[1]; q++) if (((q % 12) + 12) % 12 === fifthPc && Math.min(q, root) >= 48) { fifth = q; break; }
                }
                {
                  const total = Math.max(1, Math.min(spanEndOf(barStart), barEnd) - barStart);
                  const first = Math.min(total, btBar / 2);
                  candidates.push({ pitch: root, startTick: barStart, durationTicks: damp(barStart, first) });
                  if (fifth !== null) candidates.push({ pitch: fifth, startTick: barStart, durationTicks: damp(barStart, first), layer: 'kbd' });
                  if (total > first) {
                    candidates.push({ pitch: root, startTick: barStart + first, durationTicks: damp(barStart + first, total - first) });
                    if (fifth !== null) candidates.push({ pitch: fifth, startTick: barStart + first, durationTicks: damp(barStart + first, total - first), layer: 'kbd' });
                  }
                }
              }
            } else if (pattern === 'dyad' || pattern === 'dyadHigh') {
              // the sustained open fifth: root + fifth in the pattern's own
              // window; it rings the bar where the bar is the piano's own,
              // one beat where the harp shares it (the window presence the
              // Phase 11 math saw) — and ONE BEAT in the thinning band too:
              // a bar-long fifth under the hot bridge strings is a
              // sustained octave double the forbidding policies read as a
              // layer (the figuration exemption needs a note of at most
              // half a bar); the beat ring keeps the pattern's identity
              // inside the window-presence footprint
              const w = chordWindowOf(rootPc);
              if (w) {
                // the chord's OWN fifth tone, placed a fifth from the root
                // when the window allows
                const fifthPc = ((rootPc + 7) % 12 + 12) % 12;
                let fifth: number | null = null;
                if (pcs0.has(fifthPc)) {
                  for (let q = w.base0 + 7; q <= w.hi; q++) if (((q % 12) + 12) % 12 === fifthPc) { fifth = q; break; }
                  if (fifth === null) for (let q = w.base0 - 7; q >= w.lo; q--) if (((q % 12) + 12) % 12 === fifthPc) { fifth = q; break; }
                  if (fifth === null) for (let q = w.lo; q <= w.hi; q++) if (((q % 12) + 12) % 12 === fifthPc && Math.min(q, w.base0) >= 48) { fifth = q; break; }
                }
                // §16.2b (11.4): with the sparkle body capped at 91 the
                // fifth can fall outside the 10-semitone body window or land
                // in the vocal zone — the zone stays free and the fifth
                // always sounds: its pitch class RESCUES into the low band
                if (fifth === null || (zoneFree && inVocalZone(fifth))) {
                  fifth = foldPc(((w.base0 + 7) % 12 + 12) % 12, VB_LOW[0], VB_LOW[1]);
                }
                // the ring: to the harmonic span or the bar line, re-taken
                // at the half-bar line (each segment stays inside the
                // figuration exemption's short side against the sustained
                // string pads — the thin single-fifth bars need it); ONE
                // BEAT where the harp shares the bar or the bar is thinned
                const dur = !thinned && (pattern === 'dyad' || !harpInBar) ? -1 : 0;
                const total = Math.max(1, Math.min(spanEndOf(barStart), barEnd) - barStart);
                const first = Math.min(total, btBar / 2);
                if (dur === 0) {
                  candidates.push({ pitch: w.base0, startTick: barStart, durationTicks: damp(barStart, Math.min(beat, barEnd - barStart)) });
                  if (fifth !== null) candidates.push({ pitch: fifth, startTick: barStart, durationTicks: damp(barStart, Math.min(beat, barEnd - barStart)), layer: 'kbd' });
                } else {
                  candidates.push({ pitch: w.base0, startTick: barStart, durationTicks: damp(barStart, first) });
                  if (fifth !== null) candidates.push({ pitch: fifth, startTick: barStart, durationTicks: damp(barStart, first), layer: 'kbd' });
                  if (total > first) {
                    candidates.push({ pitch: w.base0, startTick: barStart + first, durationTicks: damp(barStart + first, total - first) });
                    if (fifth !== null) candidates.push({ pitch: fifth, startTick: barStart + first, durationTicks: damp(barStart + first, total - first), layer: 'kbd' });
                  }
                }
              }
            } else if (!thinned) {
              // the eighth figures: broken chords, the Alberti order, and
              // the high-register broken-chord arpeggio (vocalbacking,
              // harp-free bars only — the one-arpeggiator rule keeps the
              // shared bars chord-only)
              const alberti = pattern === 'alberti';
              const nSlots = Math.max(1, Math.floor((barEnd - barStart) / eighth));
              for (let i = 0; i < nSlots; i++) {
                const onset = barStart + i * eighth;
                const pool = figurePool(onset, loRH, hiLine);
                if (!pool.length) continue;
                const idx = alberti ? [0, 2, 1, 2][i % 4] % pool.length : i % pool.length;
                candidates.push({ pitch: pool[idx], startTick: onset, durationTicks: damp(onset, Math.min(onset + eighth, barEnd) - onset) });
              }
            }
            // the deliberate left-hand single note at phrase starts
            if (lhPitch !== null) {
              candidates.push({ pitch: lhPitch, startTick: barStart, durationTicks: damp(barStart, Math.min(beat, barEnd - barStart)), layer: 'kbd' });
            }
            if (absorb) for (let i = absorbFrom; i < candidates.length; i++) candidates[i].absorb = true;
          }
        } else if (kind === 'tutti') {
          // the tutti root hit: the downbeat chord's root, low, marcato, the
          // drawn moment shape (§16.5)
          const moment = momentForBar(ctx.moments, bar);
          if (moment?.kind === 'tutti') {
            const { rootPc } = chordPcsAt(barStart);
            const pitch = foldPc(rootPc, Math.max(prof.low[0], lo), Math.min(prof.low[1], hi));
            if (pitch !== null) {
              const hitLen = moment.shape === 'breath' ? beat : moment.shape === 'decay' ? beat * 2 : btBar;
              candidates.push({ pitch, startTick: barStart, durationTicks: damp(barStart, Math.min(hitLen, barEnd - barStart)), articulation: 'marcato', moment: true });
            }
          }
        }
      }
    }
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
  const allKeys = KEYS_PARTS.map((p) => ({ role: p, notes: candidatesByPart[p] ?? [] })).filter((r) => r.notes.length);
  const pianoCands = candidatesByPart.piano ?? [];
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
    notesByTrackId[track.id] = sanitizeNotes(notes, track.lowestNote, track.highestNote, endTick);
    const count = notesByTrackId[track.id].length;
    if (count) reports.push(`keys ${part}: ${count} notes (range ${track.lowestNote}-${track.highestNote}, lag ${msLo}-${msHi} ms)`);
  }

  return { notesByTrackId, reports, absorbWindows: windows.filter((w) => w.absorb).map((w) => ({ start: w.start, end: w.end })) };
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
