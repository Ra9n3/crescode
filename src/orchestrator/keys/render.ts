/**
 * Keys renderer (Phase 11.6b). The harp retains its Phase 11.5 bed, roots,
 * glissandos and closing descent. The piano keeps a held two-hand anchor
 * (LH root body plus RH triad/seventh at harmonic changes) and layers only
 * the planner's RH motion figure over it. Tutti and final hits are single
 * low roots. Planner-assigned role tags are copied onto every piano event.
 *
 * The piano concurrency cap is applied twice: to the written candidate
 * schedule and again after micro-timing. Cap pressure trims or drops a whole
 *  strike group, so chord voices keep a common release. Velocity shaping uses
 *  the golden105 piano-role beat map to preserve harp's historical window
 *  bounds; compose absorbs newly added piano energy, though the final safety
 *  pass retains the known vocalbacking-only harp velocity residual.
 */
import { chordTones } from '../voicing/chordTones';
import { scalePitchClasses } from '../../shared/schema/modes';
import { PPQ, isInstrumentTrack, type Note, type NoteRoleTag, type Project, type Track } from '../../shared/schema/types';
import { barTicks, beatOffsets, beatTicks, projectBars } from '../../shared/schema/meter';
import { hashString, sanitizeNotes } from '../../engine/generate';
import { msToTicks } from '../spine';
import { maxMeanVelocityFor } from '../energy';
import { momentForBar } from '../conductor/moments';
import { inVocalZone } from '../profiles/strings';
import { cellGrid } from '../lines/ostinato';
import type { OrchestratorContext } from '../module';
import {
  HARP_FIGURE_UNIT_BARS, KEYS_GATES, KEYS_PARTS, KEYS_PROFILES, PIANO_CONCURRENCY,
  PIANO_HAND_GAP, PIANO_LH, PIANO_RH, VB_LOW, VB_RH, VB_SPARKLE_BODY, VB_SPARKLE_PEAK,
  isChorusTypeK, keysRosterOf, type HarpFigure, type KeysPart,
} from './profile';
import type { KeysPlan } from './plan';

/** Ordinary keys shaping ceiling and the existing chorus relief level. */
export const KEYS_VELOCITY_CEILING = 84;
export const RELIEF_VELOCITY = 92;

interface KeysCandidate {
  pitch: number;
  startTick: number;
  durationTicks: number;
  articulation?: Note['articulation'];
  moment?: boolean;
  ramp?: number;
  layer?: Note['layer'];
  relief?: boolean;
  soft?: boolean;
  velScale?: number;
  roleTag?: NoteRoleTag;
  /** True when this new piano event has no golden105 role-presence window. */
  absorb?: boolean;
  /** All notes of one held piano strike share an id. */
  strikeId?: string;
  /** Cascade notes may sustain across bars to their harmonic-span end. */
  holdToSpan?: boolean;
  v?: number;
  drop?: boolean;
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
  /** The rules generator's notes for roles no module owns. */
  ruleNotes: { role: string; notes: Note[] }[];
}

export interface KeysRenderResult {
  notesByTrackId: Record<string, Note[]>;
  reports: string[];
  /** Beat windows containing piano notes; compose caps those notes alone. */
  absorbWindows: { start: number; end: number }[];
}

/**
 * Enforce total and register-band polyphony without chopping one voice out
 * of a held chord. On pressure, shorten an earlier strike group as a unit;
 * if the incoming strike cannot fit by itself, drop that whole group.
 */
function enforcePianoConcurrency(candidates: KeysCandidate[]): number {
  const keyOf = (c: KeysCandidate) => c.strikeId ?? `single:${c.startTick}:${c.pitch}`;
  const byKey = new Map<string, KeysCandidate[]>();
  for (const c of candidates) {
    const key = keyOf(c);
    const group = byKey.get(key) ?? [];
    group.push(c);
    byKey.set(key, group);
  }
  const droppedGroups = new Set<string>();
  const cutoffByGroup = new Map<string, number>();
  const live: KeysCandidate[] = [];
  const onsets = [...new Set(candidates.filter((c) => !c.drop).map((c) => c.startTick))].sort((a, b) => a - b);
  let droppedCount = 0;

  const trimGroup = (key: string, at: number) => {
    cutoffByGroup.set(key, Math.min(cutoffByGroup.get(key) ?? Number.MAX_SAFE_INTEGER, at));
    for (const c of byKey.get(key) ?? []) {
      if (c.startTick >= at) {
        if (!c.drop) { c.drop = true; droppedCount++; }
      } else if (c.startTick + c.durationTicks > at) {
        c.durationTicks = at - c.startTick;
      }
    }
    if ((byKey.get(key) ?? []).every((c) => c.drop)) droppedGroups.add(key);
  };

  for (const tick of onsets) {
    for (let i = live.length - 1; i >= 0; i--) {
      if (live[i].drop || live[i].startTick + live[i].durationTicks <= tick) live.splice(i, 1);
    }
    const starting = candidates.filter((c) => !c.drop && c.startTick === tick).sort((a, b) => a.pitch - b.pitch);
    for (const c of starting) {
      const key = keyOf(c);
      if (droppedGroups.has(key) || c.drop || (cutoffByGroup.has(key) && c.startTick >= cutoffByGroup.get(key)!)) {
        if (!c.drop) { c.drop = true; droppedCount++; }
        droppedGroups.add(key);
        continue;
      }
      let guard = 0;
      while (guard++ < 32) {
        const low = live.filter((x) => x.pitch < 55).length;
        const high = live.length - low;
        const exceeds = live.length + 1 > PIANO_CONCURRENCY.total
          || (c.pitch < 55 ? low + 1 > PIANO_CONCURRENCY.below55 : high + 1 > PIANO_CONCURRENCY.at55);
        if (!exceeds) break;
        const activeGroups = [...new Set(live.map(keyOf))];
        if (!activeGroups.length) {
          trimGroup(key, tick);
          break;
        }
        // Prefer releasing an older strike; if the incoming strike already
        // began under jitter, cut it as a whole rather than one chord voice.
        const victim = activeGroups
          .filter((candidateKey) => candidateKey !== key)
          .sort((a, b) => Math.min(...(byKey.get(a) ?? []).map((n) => n.startTick)) - Math.min(...(byKey.get(b) ?? []).map((n) => n.startTick)))[0]
          ?? (activeGroups.includes(key) ? key : undefined);
        if (!victim) {
          trimGroup(key, tick);
          break;
        }
        trimGroup(victim, tick);
        for (let i = live.length - 1; i >= 0; i--) {
          if (live[i].drop || live[i].startTick + live[i].durationTicks <= tick) live.splice(i, 1);
        }
      }
      if (!c.drop && !droppedGroups.has(key)) live.push(c);
    }
  }
  return droppedCount;
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

  /** Harp vocal-zone displacement: move down by octaves first, then up;
   *  drop a note only if the track range cannot clear the zone. */
  const zoneShift = (pitch: number, lo: number, hi: number): number | null => {
    if (!zoneFree || !inVocalZone(pitch)) return pitch;
    let p = pitch;
    while (inVocalZone(p) && p - 12 >= lo) p -= 12;
    if (!inVocalZone(p)) return p;
    p = pitch;
    while (inVocalZone(p) && p + 12 <= hi) p += 12;
    return inVocalZone(p) ? null : p;
  };

  /* ---------------- held piano hand model ------------------------------- */
  const harpFiguresByStart = new Map<number, HarpFigure[]>(plan.harpFigures.map((e) => [e.startBar, e.figures]));
  const lhLo = zoneFree ? VB_LOW[0] : PIANO_LH[0];
  const lhHi = zoneFree ? VB_LOW[1] : PIANO_LH[1];
  const pianoTrack = trackOf.get('piano');
  const pianoLo = pianoTrack?.lowestNote ?? 21;
  const pianoHi = pianoTrack?.highestNote ?? 108;
  const take = project.orchestration?.take ?? 0;

  /** The strings-overlap rule (chamber, sonata): low viola/cello sound in
   *  the bar raises the RH floor to 72. */
  const stringsLowCache = new Map<number, boolean>();
  const stringsLowAt = (bar: number): boolean => {
    if (stringsLowCache.has(bar)) return stringsLowCache.get(bar)!;
    const start = (bar - 1) * btBar;
    const end = bar * btBar;
    // String humanization/legato runs after keys. Look back a sixteenth so
    // a low note whose pre-humanized release sits on the barline is still
    // treated as sounding when the final strings renderer lengthens it.
    const overlapLookback = PPQ / 4;
    let found = false;
    for (const [id, notes] of Object.entries(stringsNotes)) {
      const role = project.tracks.find((t) => t.id === id)?.role;
      if (role !== 'violas' && role !== 'cellosBasses') continue;
      if (notes.some((n) => n.startTick < end && n.startTick + n.durationTicks > start - overlapLookback && n.pitch <= 71)) {
        found = true;
        break;
      }
    }
    stringsLowCache.set(bar, found);
    return found;
  };

  /** Strike at the bar start and every chord-span boundary within the bar. */
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

  /** LH body: root only, a root octave, or an open perfect fifth. The
   *  section/bar position and take rotate among the legal shapes; the root
   *  stays lowest, and no LH tone crosses 55 (56 in vocalbacking). */
  const lhBodyAt = (onset: number, bar: number, sectionStart: number): number[] => {
    const { pcs, rootPc } = chordPcsAt(onset);
    const root = foldPc(rootPc, Math.max(lhLo, pianoLo), Math.min(lhHi, pianoHi));
    if (root === null) return [];
    const slot = ((bar - sectionStart + take) % 3 + 3) % 3;
    if (slot === 2 && root + 12 <= Math.min(lhHi, pianoHi)) return [root, root + 12];
    const fifthPc = pcOf(rootPc + 7);
    if ((slot === 1 || slot === 2) && pcs.has(fifthPc) && root + 7 <= Math.min(lhHi, pianoHi)) return [root, root + 7];
    return [root];
  };

  /** Structural RH chord pcs. The written root (never a slash bass) is
   *  retained with a third/suspension, fifth and, for seventh symbols, a
   *  seventh. A power/no-third symbol gets a scale-quality third so the RH
   *  remains a triad as requested. */
  const chordPcsForRh = (tick: number): number[] => {
    const sp = spanAt(tick);
    const parsed = sp.parsed;
    const rootPc = pcOf(parsed.root);
    const baseIntervals = parsed.intervals.filter((i) => i >= 0 && i < 12);
    let third = [3, 4, 2, 5].find((i) => baseIntervals.includes(i));
    if (third === undefined) {
      const scaleThird = [3, 4].find((i) => scalePcs.has(pcOf(rootPc + i)));
      if (scaleThird !== undefined) third = scaleThird;
      else {
        const q = parsed.quality.toLowerCase();
        third = q.startsWith('m') || q.includes('minor') || q.includes('dim') ? 3 : 4;
      }
    }
    const fifth = [6, 7, 8].find((i) => baseIntervals.includes(i)) ?? 7;
    const seventh = [10, 11].find((i) => baseIntervals.includes(i))
      ?? (parsed.quality.toLowerCase().includes('dim7') && baseIntervals.includes(9) ? 9 : undefined);
    const pcs = [rootPc, pcOf(rootPc + third), pcOf(rootPc + fifth)];
    if (seventh !== undefined) pcs.push(pcOf(rootPc + seventh));
    return [...new Set(pcs)];
  };

  /** Choose an ascending RH triad/seventh in the allowed register. Every
   *  adjacent voice is at least a minor third apart, the chord spans an
   *  octave, and its bottom clears both the register floor and LH hand gap. */
  const rhChordAt = (tick: number, rhFloor: number, lhTop: number): number[] => {
    const chordPcs = chordPcsForRh(tick);
    const lo = Math.max(rhFloor, lhTop + PIANO_HAND_GAP, pianoLo);
    const hi = Math.min(pianoHi, 127);
    if (hi < lo) return [];
    const options = chordPcs.map((pc) => {
      const pitches: number[] = [];
      for (let p = lo; p <= hi; p++) if (pcOf(p) === pc) pitches.push(p);
      return pitches;
    });
    const voicings: number[][] = [];
    const walk = (remaining: number[], chosen: number[]) => {
      if (!remaining.length) {
        if (chosen.length >= 3 && chosen[chosen.length - 1] - chosen[0] >= 12) voicings.push(chosen);
        return;
      }
      for (let i = 0; i < remaining.length; i++) {
        const optionIndex = remaining[i];
        for (const pitch of options[optionIndex]) {
          if (chosen.length && pitch - chosen[chosen.length - 1] < 3) continue;
          walk(remaining.filter((_, j) => j !== i), [...chosen, pitch]);
        }
      }
    };
    walk(chordPcs.map((_, i) => i), []);
    if (!voicings.length) return [];
    const score = (notes: number[]) => {
      const span = notes[notes.length - 1] - notes[0];
      // Prefer the lowest comfortable inversion and the narrowest spacing
      // that still supplies the required octave span.
      return (notes[0] - lo) * 4 + (span - 12) + Math.max(0, span - 24) * 2;
    };
    voicings.sort((a, b) => score(a) - score(b) || a[0] - b[0]);
    return voicings[0];
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
      const base0 = foldPc(rootPc, Math.max(winLo, lo), Math.min(winHi, hi));
      if (base0 === null) return [];
      const out: number[] = [];
      for (let p = base0; p <= Math.min(winHi, hi, base0 + 24); p++) {
        if (!pcs.has(pcOf(p))) continue;
        const shifted = zoneShift(p, lo, hi);
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
        const roleTag = planBar.pianoRole;
        if (!roleTag) continue;

        // Special hits remain single low roots. They are struck at harmonic
        // changes inside the hit window, and never include an RH chord.
        if (kind === 'final' || kind === 'tutti') {
          const moment = momentForBar(ctx.moments, bar);
          if (kind === 'tutti' && moment?.kind !== 'tutti') continue;
          const hitLen = kind === 'final'
            ? Math.min(beat * 2, barEnd - barStart)
            : moment?.shape === 'breath' ? beat
              : moment?.shape === 'decay' ? beat * 2 : btBar;
          const hitEnd = Math.min(barEnd, barStart + hitLen);
          const strikes = spanStrikes(barStart, hitEnd);
          strikes.forEach((onset, index) => {
            const until = Math.min(index + 1 < strikes.length ? strikes[index + 1] : hitEnd, hitEnd);
            const { rootPc } = chordPcsAt(onset);
            const pitch = foldPc(rootPc, Math.max(36, pianoLo), Math.min(lhHi, pianoHi));
            if (pitch === null) return;
            candidates.push({
              pitch, startTick: onset, durationTicks: Math.max(1, until - onset),
              articulation: 'marcato', ...(kind === 'tutti' ? { moment: true } : {}),
              roleTag, strikeId: `piano:${bar}:${onset}`,
            });
          });
          continue;
        }

        if (kind !== 'anchor') continue;
        const sec = ctx.sections.find((candidate) => bar >= candidate.startBar && bar < candidate.startBar + candidate.lengthBars);
        const sectionStart = sec?.startBar ?? 1;
        const relief = reliefAt(bar, planBar.norm);
        const chamberSonataOverlap = (template.id === 'ensemble.chamber' || template.id === 'ensemble.sonata') && stringsLowAt(bar);
        const rhFloor = Math.max(zoneFree ? VB_RH[0] : PIANO_RH[0], chamberSonataOverlap ? 72 : 0);
        const strikes = spanStrikes(barStart, barEnd);
        strikes.forEach((onset, index) => {
          const strikeEnd = Math.min(index + 1 < strikes.length ? strikes[index + 1] : barEnd, spanEndOf(onset), barEnd);
          if (strikeEnd <= onset) return;
          const body = lhBodyAt(onset, bar, sectionStart);
          if (!body.length) return;
          const lhTop = body[body.length - 1];
          const rh = rhChordAt(onset, rhFloor, lhTop);
          const strikeId = `piano:${bar}:${onset}`;
          const common = {
            startTick: onset,
            durationTicks: strikeEnd - onset,
            ...(relief ? { relief: true } : {}),
            roleTag,
            strikeId,
          };
          for (const pitch of body) candidates.push({ pitch, ...common });
          // Chamber/sonata can deliberately leave the RH silent when low
          // strings occupy the chord's register. Otherwise the RH voicer is
          // expected to return a complete triad or seventh.
          for (const pitch of rh) candidates.push({ pitch, ...common });
        });

        // Motion figures are RH overlays: the LH root/body and the held RH
        // anchor above continue through their harmonic-span release. Every
        // overlay is chord-tone, hand-gap, track-range, and VB-sparkle bounded.
        const figure = planBar.pianoFigure;
        if (figure) {
          const figureRole = planBar.pianoFigureRole ?? 'anchor';
          const sparkleTop = zoneFree
            ? (planBar.pianoSparkleTop === 96 ? VB_SPARKLE_PEAK[1] : VB_SPARKLE_BODY[1])
            : PIANO_RH[1];
          const figureLo = Math.max(zoneFree ? VB_SPARKLE_BODY[0] : PIANO_RH[0], rhFloor, pianoLo);
          const figureHi = Math.min(sparkleTop, pianoHi, PIANO_RH[1]);
          const poolAt = (tick: number, lo = figureLo): number[] => {
            const high = Math.max(lo, figureHi);
            const pool = figurePool(tick, lo, high).filter((pitch) => pitch >= lo && pitch <= high);
            if (pool.length) return pool;
            return rhChordAt(tick, lo, Math.max(0, lo - PIANO_HAND_GAP)).filter((pitch) => pitch >= lo && pitch <= high);
          };
          const pushFigure = (pitch: number, onset: number, until: number, soft = false, holdToSpan = false) => {
            const limit = holdToSpan ? endTick : barEnd;
            if (onset < barStart || onset >= barEnd || until <= onset || pitch < figureLo || pitch > figureHi) return;
            candidates.push({
              pitch,
              startTick: onset,
              durationTicks: damp(onset, Math.min(until, limit) - onset),
              roleTag: figureRole,
              strikeId: `piano-figure:${bar}:${figure}:${onset}:${pitch}`,
              ...(soft ? { soft: true } : {}),
              ...(holdToSpan ? { holdToSpan: true } : {}),
            });
          };
          const figureSlots = Math.ceil((barEnd - barStart) / eighth);
          const noteToNextEighth = (onset: number) => Math.min(barEnd, spanEndOf(onset), onset + eighth);

          if (figure === 'arpUp' || figure === 'arpDown' || figure === 'arpPendulum' || figure === 'alberti') {
            for (let i = 0; i < figureSlots; i++) {
              const onset = barStart + i * eighth;
              if (onset >= barEnd) break;
              const pool = poolAt(onset);
              if (!pool.length) continue;
              let pitch: number;
              if (figure === 'alberti') {
                const mid = Math.floor((pool.length - 1) / 2);
                const order = [0, pool.length - 1, mid, pool.length - 1];
                pitch = pool[order[i % order.length]];
              } else {
                const cycle = figure === 'arpDown'
                  ? pool.length - 1 - (i % pool.length)
                  : figure === 'arpPendulum'
                    ? pool.length === 1 ? 0 : (() => { const period = 2 * pool.length - 2; const k = i % period; return k < pool.length ? k : period - k; })()
                    : i % pool.length;
                pitch = pool[cycle];
              }
              pushFigure(pitch, onset, noteToNextEighth(onset));
            }
          } else if (figure === 'cascade') {
            // A slow two-note cascade over each harmony: the first attack is
            // at the span start, the second at its midpoint. Each note rings
            // to the actual span end, even when that falls in a later bar.
            ctx.spans.filter((span) => span.startTick < barEnd && span.endTick > barStart)
              .forEach((span, spanIndex) => {
                const spanEnd = Math.min(span.endTick, endTick);
                const midpoint = span.startTick + Math.floor((spanEnd - span.startTick) / (2 * eighth)) * eighth;
                const attacks = [span.startTick, ...(midpoint > span.startTick && midpoint < spanEnd ? [midpoint] : [])];
                attacks.forEach((onset, attackIndex) => {
                  if (onset < barStart || onset >= barEnd) return;
                  const pool = poolAt(onset);
                  if (!pool.length) return;
                  const pitch = pool[(spanIndex + attackIndex) % pool.length];
                  pushFigure(pitch, onset, spanEnd, false, true);
                });
              });
          } else if (figure === 'wideBroken') {
            // The anchor's LH root is the first event; after a deliberate gap,
            // three high chord tones answer on eighth slots 3, 5, and 7.
            for (const slot of [3, 5, 7]) {
              const onset = barStart + slot * eighth;
              if (onset >= barEnd) continue;
              const pool = poolAt(onset);
              if (!pool.length) continue;
              pushFigure(pool[(slot + sectionStart) % pool.length], onset, noteToNextEighth(onset));
            }
          } else if (figure === 'ostinatoCell' && planBar.pianoCell) {
            let grid = cellGrid(project.timeSignature, planBar.pianoCell, 'eighths');
            if (template.id !== 'ensemble.vocalbacking' && grid.slots.length < 3) grid = cellGrid(project.timeSignature, 'straight', 'eighths');
            const slotsPerBar = Math.max(1, beatOffsets(project.timeSignature).length * grid.perBeat);
            const slotTicks = btBar / slotsPerBar;
            const count = template.id === 'ensemble.vocalbacking'
              ? Math.min(4, grid.slots.length)
              : Math.min(4, Math.max(3, grid.slots.length));
            const selectedSlots: number[] = [];
            for (let i = 0; i < count; i++) {
              const index = count === 1 ? 0 : Math.round(i * (grid.slots.length - 1) / (count - 1));
              const slot = grid.slots[index];
              if (slot !== undefined && !selectedSlots.includes(slot)) selectedSlots.push(slot);
            }
            selectedSlots.forEach((slot, index) => {
              const onset = barStart + slot * slotTicks;
              if (onset >= barEnd) return;
              const pool = poolAt(onset);
              if (!pool.length) return;
              pushFigure(pool[index % pool.length], onset, Math.min(barEnd, spanEndOf(onset), onset + slotTicks));
            });
          } else if (figure === 'highSparkle' && planBar.norm < KEYS_GATES.mid) {
            const lo = Math.max(84, figureLo);
            const onset = Math.min(barEnd - 1, barStart + eighth);
            const pool = poolAt(onset, lo);
            if (pool.length) {
              const pick = hashString(`piano-sparkle:${take}:${bar}:${planBar.pianoFigure}`) % pool.length;
              pushFigure(pool[pick], onset, noteToNextEighth(onset), true);
            }
          }
        }
      }
    }
  }

  /* ---------------- written-schedule polyphony cap ---------------------- */
  const pianoRaw = candidatesByPart.piano;
  if (pianoRaw?.length) {
    const dropped = enforcePianoConcurrency(pianoRaw);
    candidatesByPart.piano = pianoRaw.filter((c) => !c.drop);
    reports.push(`keys piano: written cap enforced over ${pianoRaw.length} notes (${dropped} dropped)`);
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
  // The plan supplies the immutable golden105 piano-role beat map. Mark a
  // new held strike as baseline presence if any beat window it overlaps had
  // the old piano role; otherwise it is new energy for piano-only absorption.
  const goldenPianoRoleBeats = new Set(plan.golden105PianoRoleBeats);
  const winOf = (tick: number): { bar: number; winStart: number } => {
    const bar = Math.min(bars, Math.max(1, Math.floor(tick / btBar) + 1));
    const barStart = (bar - 1) * btBar;
    const idx = Math.min(3, Math.floor((tick - barStart) / beat));
    return { bar, winStart: barStart + idx * beat };
  };
  const pianoCands = candidatesByPart.piano ?? [];
  for (const c of pianoCands) {
    const w0 = winOf(c.startTick);
    const wEnd = winOf(Math.max(c.startTick, c.startTick + c.durationTicks - 1));
    let baselinePresence = false;
    for (let bar = w0.bar; bar <= wEnd.bar && !baselinePresence; bar++) {
      const barStart = (bar - 1) * btBar;
      const from = bar === w0.bar ? w0.winStart : barStart;
      const to = bar === wEnd.bar ? wEnd.winStart : barStart + btBar - beat;
      for (let windowStart = from; windowStart <= to; windowStart += beat) {
        if (goldenPianoRoleBeats.has(windowStart)) { baselinePresence = true; break; }
      }
    }
    c.absorb = !baselinePresence;
  }

  interface AbsorbWindow { start: number; end: number; bound: number; pianoIdx: number[] }
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
            // Match the old role set exactly: baseline piano strikes count
            // as a piano role; newly added strikes remain outside the bound
            // and are capped by compose's piano-only absorption pass.
            if (!(r.role === 'piano' && c.absorb)) roles.add(r.role);
            if (r.role === 'piano') pianoIdx.push(i);
          }
        }
      }
      windows.push({ start, end, bound: roles.size ? maxMeanVelocityFor(N, clampMax, roles.size) : 127, pianoIdx });
    }
  }
  const boundAt = (tick: number): number => {
    let b = 127;
    for (const w of windows) {
      if (tick >= w.start && tick < w.end) b = Math.min(b, w.bound);
    }
    return b;
  };

  // pass 1: shaped velocities, using the golden105 role-presence windows
  // for the harp-compatible bounds (new piano presence is absorbed later).
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

  // pass 2: micro-timing and final note events. The written note end is
  // unchanged by jitter, so all notes in a strike keep a common release.
  const renderedRoleCounts: Record<NoteRoleTag, number> = { anchor: 0, lift: 0, settle: 0, bed: 0, atmosphere: 0 };
  for (const part of KEYS_PARTS) {
    const track = trackOf.get(part);
    const candidates = candidatesByPart[part];
    if (!track || !candidates) continue;
    const prof = KEYS_PROFILES[part];
    const [msLo, msHi] = prof.timingMs;
    const ordered = [...candidates].filter((c) => !c.drop).sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
    for (const c of ordered) {
      const writtenStart = c.startTick;
      const writtenEnd = writtenStart + c.durationTicks;
      const bar = Math.min(bars, Math.max(1, Math.floor(writtenStart / btBar) + 1));
      const h = hashString(`${track.id}|${writtenStart}|${c.pitch}`);
      const ms = msLo + (h / 0xffffffff) * (msHi - msLo);
      const jitter = Math.max(0, Math.round(msToTicks(ms, project.tempoMap)));
      const barStart = (bar - 1) * btBar;
      const barEnd = Math.min(endTick, bar * btBar);
      c.startTick = Math.max(barStart, Math.min(barEnd - 1, writtenStart + jitter));
      c.durationTicks = Math.max(1, Math.min(c.holdToSpan ? endTick : barEnd, writtenEnd) - c.startTick);
    }

    if (part === 'piano') {
      const before = ordered.length;
      const dropped = enforcePianoConcurrency(ordered);
      const finalCandidates = ordered.filter((c) => !c.drop);
      const notes: Note[] = finalCandidates.map((c) => ({
        pitch: c.pitch,
        startTick: c.startTick,
        durationTicks: c.durationTicks,
        velocity: c.v ?? 1,
        roleTag: c.roleTag ?? 'anchor',
        ...(c.articulation !== undefined ? { articulation: c.articulation } : {}),
        ...(c.layer !== undefined ? { layer: c.layer } : {}),
      }));
      notesByTrackId[track.id] = notes;
      for (const n of notes) renderedRoleCounts[n.roleTag ?? 'anchor']++;
      reports.push(`keys piano: post-jitter cap enforced over ${before} notes (${dropped} dropped)`);
    } else {
      const notes: Note[] = ordered.map((c) => ({
        pitch: c.pitch,
        startTick: c.startTick,
        durationTicks: c.durationTicks,
        velocity: c.v ?? 1,
        ...(c.articulation !== undefined ? { articulation: c.articulation } : {}),
        ...(c.layer !== undefined ? { layer: c.layer } : {}),
      }));
      notesByTrackId[track.id] = sanitizeNotes(notes, track.lowestNote, track.highestNote, endTick);
    }
    const count = notesByTrackId[track.id].length;
    if (count) reports.push(`keys ${part}: ${count} notes (range ${track.lowestNote}-${track.highestNote}, lag ${msLo}-${msHi} ms)`);
  }
  reports.push(`keys piano role events (take ${project.orchestration?.take ?? 0}): ${Object.entries(renderedRoleCounts).map(([role, count]) => `${role}=${count}`).join(', ')}`);

  return { notesByTrackId, reports, absorbWindows: windows.filter((w) => w.pianoIdx.length > 0).map((w) => ({ start: w.start, end: w.end })) };
}

/**
 * Phase 11.6a piano-only absorption. The historical window governors did not
 * see the newly written held piano/figure layers, so the piano absorbs any
 * remaining clamp excess while harp and other tracks stay untouched. Compute
 * every window's cap from the original piano velocities, then apply the
 * strictest overlapping cap once per note. This avoids window-order effects:
 * a transient note in an earlier beat cannot change the later velocity of a
 * sustained anchor or figure. The final keys governor remains the hard guard.
 */
export interface PianoAbsorptionReport { windows: number; loweredWindows: number; loweredNotes: number }

export function absorbPianoVelocities(input: {
  template: NonNullable<OrchestratorContext['template']>;
  piano: { role: string; notes: Note[] };
  harp: { role: string; notes: Note[] } | null;
  otherNotes: { role: string; notes: Note[] }[];
  windows: { start: number; end: number }[];
}): PianoAbsorptionReport {
  const { template, piano, harp, otherNotes, windows } = input;
  const clampMax = template.budget.energyClamp[1];
  const N = template.roster.length;
  const rosterRoles = new Set(template.roster.map((r) => r.role));
  const others = otherNotes.filter((r) => rosterRoles.has(r.role));
  const harpNotes = harp && rosterRoles.has(harp.role) ? harp.notes : [];
  const scaleByIndex = piano.notes.map(() => 1);
  const cappedWindows: number[][] = [];
  const loweredNoteSet = new Set<Note>();
  // Solve every beat against the original piano velocities, then apply each
  // note's strictest overlapping cap once. Sequentially mutating held notes
  // made a moment-only string tail in an earlier beat change a later piano
  // figure's velocity, even though that figure's own mix window was identical.
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
    for (const i of pianoIdx) scaleByIndex[i] = Math.min(scaleByIndex[i], cap);
    cappedWindows.push(pianoIdx);
  }
  const loweredIndices = new Set<number>();
  piano.notes.forEach((n, i) => {
    const next = Math.max(1, Math.floor(n.velocity * scaleByIndex[i]));
    if (next < n.velocity) {
      loweredIndices.add(i);
      loweredNoteSet.add(n);
    }
    n.velocity = next;
  });
  const loweredWindows = cappedWindows.filter((indices) => indices.some((i) => loweredIndices.has(i))).length;
  return { windows: windows.length, loweredWindows, loweredNotes: loweredNoteSet.size };
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
