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
 * Registers (§16.2): the bed and the arpeggio write inside the sweet spot
 * (harp 36–91, piano 55–84) over about two octaves of chord tones; the low
 * plucked roots, the low octave pulse and the tutti hits fold into the low
 * register; a glissando may use the extreme octaves. The config hard range
 * (the track's own lowestNote/highestNote) always wins. In vocalbacking the
 * vocal zone (A3..A5 sounding, the D6 default the strings already keep
 * free) stays free of both parts: a note that would land in it moves by
 * octave (down first), a run note that cannot is dropped.
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
import { KEYS_PARTS, KEYS_GATES, KEYS_PROFILES, isChorusTypeK, keysRosterOf, type KeysPart } from './profile';
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
  if (!template || !plan.bars.length || !ctx.spans.length) return { notesByTrackId, reports };

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
   *  land in the zone moves by octave — down first, then up — and a note
   *  that cannot move out of the zone inside the track's range is dropped. */
  const zoneShift = (pitch: number, lo: number, hi: number): number | null => {
    if (!zoneFree || !inVocalZone(pitch)) return pitch;
    let p = pitch;
    while (inVocalZone(p) && p - 12 >= lo) p -= 12;
    if (!inVocalZone(p)) return p;
    p = pitch;
    while (inVocalZone(p) && p + 12 <= hi) p += 12;
    if (!inVocalZone(p)) return p;
    return null;
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
     *  track's range, zone-shifted and deduped ascending (§16.2). */
    const figurePool = (tick: number, winLo: number, winHi: number): number[] => {
      const { pcs, rootPc } = chordPcsAt(tick);
      const base0 = foldPc(rootPc, Math.max(winLo, lo), Math.min(winHi, hi));
      if (base0 === null) return [];
      const out: number[] = [];
      for (let p = base0; p <= Math.min(winHi, hi, base0 + 24); p++) {
        if (!pcs.has(pcOf(p))) continue;
        const shifted = zoneShift(p, lo, hi);
        if (shifted !== null && !out.includes(shifted)) out.push(shifted);
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
          // the broken-chord eighths (the bed, and the closing descending
          // figure): the chord tones cycling over about two octaves inside
          // the sweet spot — the pool is rebuilt at EVERY onset, so a bar
          // spanning two half-bar chords walks both (stateless per onset);
          // each note rings until the next onset (the harp blur), capped at
          // one bar and damped before a tacet (§16.6). In the chorus relief
          // the bed rides the relief intensity floor.
          const relief = kind === 'bed' && reliefAt(bar, planBar.norm);
          const nSlots = Math.max(1, Math.floor((barEnd - barStart) / eighth));
          for (let i = 0; i < nSlots; i++) {
            const onset = barStart + i * eighth;
            const pool = figurePool(onset, prof.sweet[0], prof.sweet[1]);
            if (!pool.length) continue;
            const idx = kind === 'final' ? (pool.length - 1 - (i % pool.length) + pool.length) % pool.length : i % pool.length;
            const pitch = pool[idx];
            const next = onset + eighth;
            candidates.push({ pitch, startTick: onset, durationTicks: damp(onset, Math.min(next, barEnd) - onset), ...(relief ? { relief: true } : {}) });
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
          // the comping: a chord on the downbeat — the main voice + its
          // 'kbd' sisters (the chord's tones in the comp register, lowest
          // first; the one-voice cap's sanctioned relaxation, §16.1) —
          // ringing a beat. In the chorus relief the chord restrikes on
          // EVERY QUARTER (the drive's grid line — the generator's own
          // chorus comp was a quarter-grid block chord; the chorus must not
          // thin, §16.4) and rides the relief velocity. The chord is built
          // per onset (the half-bar chord walk); the search reaches one
          // octave above the comp register so the zone-shifted tones
          // (vocalbacking) still yield four voices; the extreme top octaves
          // stay reserved for roots and glissandos; and a pitch class
          // already voiced is skipped — no octave sisters inside the chord
          // (the doubling policies read them as doubles).
          const relief = reliefAt(bar, planBar.norm);
          const hits = relief ? [0, 1, 2, 3] : [0];
          for (const h of hits) {
            const onset = barStart + h * beat;
            if (onset >= barEnd) break;
            const { pcs: pcsHere } = chordPcsAt(onset);
            const chord: number[] = [];
            const voicedPcs = new Set<number>();
            for (let p = Math.max(prof.comp[0], lo); p <= Math.min(prof.comp[1] + 12, hi) && chord.length < COMP_CHORD_VOICES; p++) {
              if (!pcsHere.has(pcOf(p))) continue;
              if (voicedPcs.has(pcOf(p))) continue;
              const shifted = zoneShift(p, lo, hi);
              if (shifted === null || voicedPcs.has(pcOf(shifted)) || chord.includes(shifted)) continue;
              chord.push(shifted);
              voicedPcs.add(pcOf(p));
              voicedPcs.add(pcOf(shifted));
            }
            chord.forEach((pitch, i) => {
              candidates.push({ pitch, startTick: onset, durationTicks: damp(onset, Math.min(beat, barEnd - onset)), ...(i > 0 ? { layer: 'kbd' as const } : {}), ...(relief ? { relief: true } : {}) });
            });
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
  const windows: { start: number; end: number; bound: number }[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const barStart = bar * btBar;
    for (let off = 0; off < btBar; off += beat) {
      const start = barStart + off;
      if (start >= endTick) continue;
      const end = Math.min(endTick, start + beat);
      const roles = new Set<string>();
      for (const r of others) if (r.notes.some((n) => n.startTick < end && n.startTick + n.durationTicks > start)) roles.add(r.role);
      for (const r of allKeys) if (r.notes.some((n) => n.startTick < end && n.startTick + n.durationTicks > start)) roles.add(r.role);
      windows.push({ start, end, bound: roles.size ? maxMeanVelocityFor(N, clampMax, roles.size) : 127 });
    }
  }
  const boundAt = (tick: number): number => {
    let b = 127;
    for (const w of windows) {
      if (tick >= w.start && tick < w.end) b = Math.min(b, w.bound);
    }
    return b;
  };

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
      const bound = boundAt(Math.min(endTick - 1, c.startTick));
      const norm = planByBar.get(bar)?.norm ?? 0;
      let v: number;
      if (c.moment) v = Math.min(momentVelocity(bar), bound);
      else if (c.relief) {
        // the chorus relief rides the ABSOLUTE scale (the percussion drive's
        // rule): the clamp guarantee stays with the final safety pass
        v = Math.max(1, Math.round(RELIEF_VELOCITY * (c.ramp !== undefined ? 0.45 + 0.35 * c.ramp : 1)));
      } else {
        const shaped = Math.max(1, Math.round(1 + (Math.min(bound, KEYS_VELOCITY_CEILING) - 1) * Math.min(1, Math.max(0, norm))));
        const accent = c.articulation === 'marcato' ? 8 : 0;
        const rampScale = c.ramp !== undefined ? 0.45 + 0.35 * c.ramp : 1;
        v = Math.max(1, Math.round(Math.min(bound, shaped + accent) * rampScale));
      }
      v = Math.max(1, Math.min(127, c.relief || c.moment ? v : Math.min(v, bound)));
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

  return { notesByTrackId, reports };
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
