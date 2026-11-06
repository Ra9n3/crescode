/**
 * Percussion renderer (Phase 10, spec §15). Realises the planner's per-bar
 * voice kinds AFTER the winds renderer, so the velocity math sees every
 * other family's notes: every percussion note's velocity is shaped by its
 * bar's arc norm and capped by the governor bound of every beat window it
 * touches (mean ≤ 127·clampMax·N/roles) — the same invariant the strings,
 * brass and winds obey, so a percussion hit can never push a window over
 * the hard clamp. A final safety pass (governPercussionVelocities)
 * re-checks the windows after the strings' humanize/legato and lowers
 * PERCUSSION ALONE if anything moved.
 *
 * Anchoring (§15.4): the timpani lands on the downbeat or the ostinato's
 * anchor slot — never off-grid; the snare rides the section's drawn rhythm
 * cell; the aux plays the meter's off-beat eighths. Damping (§15.6): the
 * timpani and cymbal hits are shortened so they end before a near-silence
 * bar and before a soli moment — no hit rings across them. Rolls are
 * velocity ramps (the generator writes no CC1/CC11 for percussion today),
 * stored as the 'tremolo' articulation, ending on a hit. Repeated hits on
 * one pitch get a small deterministic velocity variation (±1..3 units,
 * hashed from track, start and pitch — no machine-gun repeats, no
 * Math.random). Micro-timing (§15.3) is applied LAST, hash-seeded per note,
 * stored in the notes so the preview and the export show the same offsets;
 * a hit never crosses its bar because of the jitter.
 */
import { chordTones } from '../voicing/chordTones';
import { leadingTonePcOf } from '../voicing/voiceLead';
import { scalePitchClasses } from '../../shared/schema/modes';
import { PPQ, isInstrumentTrack, type Note, type Project, type Track } from '../../shared/schema/types';
import { barTicks, beatOffsets, beatTicks, projectBars } from '../../shared/schema/meter';
import { hashString, sanitizeNotes } from '../../engine/generate';
import { msToTicks } from '../spine';
import { maxMeanVelocityFor } from '../energy';
import { momentForBar } from '../conductor/moments';
import { cellGrid } from '../lines/ostinato';
import { textureForType, sectionTypeNameAtBar } from '../conductor/layers';
import type { OrchestratorContext } from '../module';
import { PERC_GATES, PERC_PARTS, PERC_PROFILES, REPEAT_BUMP_MAX, isChorusTypeP, percRosterOf, type PercPart } from './profile';
import type { PercPlan } from './plan';

interface PercCandidate {
  pitch: number;
  startTick: number;
  durationTicks: number;
  articulation?: Note['articulation'];
  /** Moment notes (tutti) ride the whole-roster cap shape. */
  moment?: boolean;
  /** The planned hit a roll lands on keeps the suppressed hit's velocity rule. */
  velocityRule?: 'shaped' | 'moment';
  /** Rolls ramp: the roll note's position in its ramp (0..1). */
  ramp?: number;
  /** The chorus drive's light pattern (Phase 10.1): it rides the HIGH
   *  gate's intensity from the moment it engages (the bar's norm, but never
   *  below the high gate) — the window bound still caps every note. */
  drive?: boolean;
}

const slotTicksOf = (ts: Parameters<typeof cellGrid>[0], cell: Parameters<typeof cellGrid>[1], rate: Parameters<typeof cellGrid>[2], barStart: number, beat: number): { ticks: number[]; step: number } => {
  const grid = cellGrid(ts, cell, rate);
  const slotLen = Math.floor(beat / grid.perBeat);
  const uniq = [...new Set(grid.slots)]
    .map((slotIdx) => barStart + Math.floor(slotIdx / grid.perBeat) * beat + (slotIdx % grid.perBeat) * slotLen)
    .sort((a, b) => a - b);
  const step = uniq.length > 1 ? uniq[1] - uniq[0] : slotLen;
  return { ticks: uniq, step };
};

export interface PercRenderInput {
  ctx: OrchestratorContext;
  plan: PercPlan;
  /** The strings module's notes by track id (window math). */
  stringsNotes: Record<string, Note[]>;
  /** The rendered brass notes by track id (window math). */
  brassNotes: Record<string, Note[]>;
  /** The rendered wind notes by track id (window math). */
  windNotes: Record<string, Note[]>;
  /** The rules generator's + tutti-hit notes by role (window math). */
  ruleNotes: { role: string; notes: Note[] }[];
}

export interface PercRenderResult {
  notesByTrackId: Record<string, Note[]>;
  reports: string[];
}

export function renderPercussion(input: PercRenderInput): PercRenderResult {
  const { ctx, plan, stringsNotes, brassNotes, windNotes, ruleNotes } = input;
  const { project, template } = ctx;
  const notesByTrackId: Record<string, Note[]> = {};
  const reports: string[] = [];
  // every rostered percussion track is CLAIMED up front (an empty list when
  // the part never sounds) — the generator's phantom percussion notes must
  // never reach the final score through the assembly's generator fallback
  const roster = percRosterOf(ctx);
  const trackOf = new Map<PercPart, Track>();
  for (const part of roster) {
    const t = ctx.project.tracks.find((x) => x.role === part && x.family === 'Percussion' && isInstrumentTrack(x) && !x.locked);
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
  const ltPc = leadingTonePcOf(project.key, scale);
  const planByBar = new Map(plan.bars.map((b) => [b.bar, b]));
  const rollByBarPart = new Map<string, PercPlan['rolls'][number]>();
  for (const r of plan.rolls) for (let b = r.startBar; b < r.targetBar; b++) rollByBarPart.set(`${b}:${r.part}`, r);
  const rollEnding = new Map<string, PercPlan['rolls'][number]>();
  for (const r of plan.rolls) rollEnding.set(`${r.targetBar}:${r.part}`, r);

  const momentVelocity = (bar: number): number => {
    const E = Math.min(clampMax, Math.max(0, ctx.arc?.[bar - 1]?.target ?? 0));
    const capAll = maxMeanVelocityFor(N, clampMax, N);
    return Math.max(1, Math.min(capAll, Math.round(1 + (capAll - 1) * E)));
  };
  const spanAt = (tick: number) =>
    ctx.spans.find((sp) => sp.startTick <= tick && tick < sp.endTick) ?? ctx.spans[0];

  // the tacet starts (bar-aligned): damping boundaries — no timpani/cymbal
  // hit rings across a near-silence bar or a soli moment (§15.6)
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

  /* ---------------- phase A: candidates per part (no velocities yet) ------ */

  const candidatesByPart: Partial<Record<PercPart, PercCandidate[]>> = {};
  for (const part of PERC_PARTS) {
    const track = trackOf.get(part);
    if (!track) continue;
    const prof = PERC_PROFILES[part];
    const candidates: PercCandidate[] = [];
    candidatesByPart[part] = candidates;
    const lo = Math.max(track.lowestNote, prof.range[0]);
    const hi = Math.min(track.highestNote, prof.range[1]);

    /** The timpani's pitch pool of one span: the chord's root and fifth
     *  folded into the range, never the leading tone (§15.4). */
    const timpaniPool = (tick: number): number[] => {
      const sp = spanAt(tick);
      const ct = chordTones(sp.parsed);
      const rootTone = ct.tones.find((t) => t.tier === 'root');
      const rootPc = (((rootTone?.pc ?? ct.bassPc) % 12) + 12) % 12;
      const pcs = new Set([rootPc, (rootPc + 7) % 12]);
      if (ltPc !== null) pcs.delete(ltPc);
      const out: number[] = [];
      for (let p = lo; p <= hi; p++) if (pcs.has(((p % 12) + 12) % 12)) out.push(p);
      return out;
    };
    let prevTimpani: number | null = null;
    const nearestIn = (pool: number[], target: number): number | null =>
      pool.length ? pool.reduce((best, c) => (Math.abs(c - target) < Math.abs(best - target) ? c : best), pool[0]) : null;
    const timpaniPitch = (tick: number): number | null => {
      const pool = timpaniPool(tick);
      if (!pool.length) return null;
      const target = prevTimpani ?? (lo + hi) / 2;
      const pick = nearestIn(pool, target);
      prevTimpani = pick;
      return pick;
    };
    // the chorus drive's picks (Phase 10.1): the downbeat lands on the
    // chord's ROOT, the optional half-bar on the FIFTH — each the nearest
    // in-range candidate of its pitch class, advancing the same walk. A
    // pitch class with no in-range candidate skips the hit (the fifth is
    // optional by construction; the root falls back to the whole pool —
    // the fold then has one candidate and it IS the answer).
    const timpaniRoot = (tick: number): number | null => {
      const pool = timpaniPool(tick);
      if (!pool.length) return null;
      const sp = spanAt(tick);
      const ct = chordTones(sp.parsed);
      const rootTone = ct.tones.find((t) => t.tier === 'root');
      const rootPc = (((rootTone?.pc ?? ct.bassPc) % 12) + 12) % 12;
      const rootPool = pool.filter((p) => (((p % 12) + 12) % 12) === rootPc);
      const pick = nearestIn(rootPool.length ? rootPool : pool, prevTimpani ?? (lo + hi) / 2)!;
      prevTimpani = pick;
      return pick;
    };
    const timpaniFifth = (tick: number): number | null => {
      const pool = timpaniPool(tick);
      if (!pool.length) return null;
      const sp = spanAt(tick);
      const ct = chordTones(sp.parsed);
      const rootTone = ct.tones.find((t) => t.tier === 'root');
      const rootPc = (((rootTone?.pc ?? ct.bassPc) % 12) + 12) % 12;
      const fifthPool = pool.filter((p) => (((p % 12) + 12) % 12) === ((rootPc + 7) % 12));
      const pick = nearestIn(fifthPool, prevTimpani ?? (lo + hi) / 2);
      if (pick === null) return null;
      prevTimpani = pick;
      return pick;
    };

    // the rolls (§15.4): 16ths stored as 'tremolo', a velocity ramp, ending
    // on a hit at the target downbeat. The roll rides ONE pitch — computed
    // at the roll's FIRST bar from the target chord's root/fifth pool,
    // nearest the previous hit (the sequential walk keeps the no-octave-jump
    // rule honest); the ending hit keeps the suppressed ordinary hit's
    // velocity rule (moment vs shaped).
    const rollPitch = new Map<PercPlan['rolls'][number], number>();
    const pitchOfRoll = (roll: PercPlan['rolls'][number]): number | null => {
      const hit = rollPitch.get(roll);
      if (hit !== undefined) return hit;
      let pick: number | null;
      if (prof.fixedNote !== null) pick = prof.fixedNote;
      else {
        const pool = timpaniPool(roll.targetTick);
        if (!pool.length) pick = null;
        else {
          const target = prevTimpani ?? (lo + hi) / 2;
          pick = pool.reduce((best, c) => (Math.abs(c - target) < Math.abs(best - target) ? c : best), pool[0]);
        }
      }
      if (pick !== null) {
        rollPitch.set(roll, pick);
        if (prof.fixedNote === null) prevTimpani = pick;
      }
      return pick;
    };
    const nRoll16ths = (roll: PercPlan['rolls'][number]): number => Math.max(1, Math.floor((roll.targetTick - roll.startTick) / sixteenth));

    for (let bar = 1; bar <= bars; bar++) {
      const planBar = planByBar.get(bar);
      if (!planBar) continue;
      const kind = planBar.voices[part];
      const rollEnds = rollEnding.get(`${bar}:${part}`);
      const rollActive = rollByBarPart.get(`${bar}:${part}`);
      // the ghost (below) must run even on a bar the moments emptied
      const ghostNeeded = part === 'timpani' && planBar.moment !== undefined && kind !== planBar.ordinary.timpani
        && (planBar.ordinary.timpani === 'support' || planBar.ordinary.timpani === 'pulse' || planBar.ordinary.timpani === 'drive');
      if (!kind && !rollEnds && !rollActive && !ghostNeeded) continue;
      const barStart = (bar - 1) * btBar;
      const barEnd = bar * btBar;
      const damp = (start: number, dur: number): number => Math.max(1, Math.min(dur, dampingEnd(start) - start));

      // the roll's slice inside this bar (the 16ths from the roll's start to
      // the target tick, clipped to the bar; a roll never sounds in a tacet
      // — a soli or a near-silence bar: the roll dies before it. On the
      // pre-chorus bar the 16ths SOUND (Phase 10.2): the prepared entry
      // keeps its build, only the groove is tacet there)
      if (rollActive) {
        const pitch = pitchOfRoll(rollActive);
        if (pitch !== null) {
          const n = nRoll16ths(rollActive);
          const from = Math.max(rollActive.startTick, barStart);
          const to = Math.min(rollActive.targetTick, barEnd);
          for (let onset = from; onset < to; onset += sixteenth) {
            const i = Math.round((onset - rollActive.startTick) / sixteenth);
            const near = ctx.arc?.[bar - 1]?.nearSilence;
            const m = momentForBar(ctx.moments, bar);
            if (near || m?.kind === 'soli') continue;
            candidates.push({ pitch, startTick: onset, durationTicks: sixteenth, articulation: 'tremolo', velocityRule: 'shaped', ramp: (i / n) * 0.5 });
          }
        }
      }
      // the moment ghost (the winds' pattern) — BEFORE the roll-end and
      // empty-kind continues: a soli's silence (and a tutti's replacement)
      // must still advance the timpani's pitch walk. A moment overriding
      // this part's ordinary line ghost-runs the ordinary timpani pick
      // first, so the walk — the nearest-candidate rule — advances EXACTLY
      // as it would without the moments, and every ordinary note outside
      // moment bars is byte-identical to a moment-less run.
      if (ghostNeeded) {
        // the walk advances with EXACTLY the picks the ordinary line would
        // have made — root-first for the drive, the free walk otherwise
        if (planBar.ordinary.timpani === 'drive') {
          timpaniRoot(barStart); // the walk advances; nothing is written
          if ((planBar.norm ?? 0) >= PERC_GATES.high) timpaniFifth(barStart + Math.floor(btBar / 2));
        } else {
          timpaniPitch(barStart); // the walk advances; nothing is written
          if (planBar.ordinary.timpani === 'pulse' && textureForType(ctx, sectionTypeNameAtBar(ctx, bar)).style.accent === 'offBeat') {
            timpaniPitch(barStart + Math.floor(beat / 2));
          }
        }
      }
      // the roll's ending hit owns the target downbeat (the ordinary hit the
      // plan wrote there is suppressed) — unless the target bar is a soli
      // (percussion is tacet there; the roll dies before the solo)
      if (rollEnds) {
        const targetMoment = momentForBar(ctx.moments, rollEnds.targetBar);
        if (targetMoment?.kind !== 'soli' && !ctx.arc?.[rollEnds.targetBar - 1]?.nearSilence) {
          const pitch = pitchOfRoll(rollEnds);
          if (pitch !== null) {
            const isMoment = part === 'timpani' && planBar.voices.timpani === 'tutti';
            candidates.push({ pitch, startTick: rollEnds.targetTick, durationTicks: beat, articulation: 'marcato', ...(isMoment ? { moment: true } : {}), velocityRule: isMoment ? 'moment' : 'shaped' });
          }
        }
        if (kind === 'roll' || !kind) continue;
      }
      if (!kind) continue;

      if (part === 'timpani') {
        if (kind === 'support' || kind === 'pulse') {
          const pitch = timpaniPitch(barStart);
          if (pitch !== null && !(rollEnds && barStart === rollEnds.targetTick)) {
            candidates.push({ pitch, startTick: barStart, durationTicks: damp(barStart, beat), articulation: 'marcato', velocityRule: 'shaped' });
          }
          if (kind === 'pulse') {
            // the ostinato's anchor slot (§15.4): the drawn accent's strong
            // off-beat when the cell carries one, else the downbeat only
            const tex = textureForType(ctx, sectionTypeNameAtBar(ctx, bar));
            if (tex.style.accent === 'offBeat') {
              const anchor = barStart + Math.floor(beat / 2);
              const pitch2 = timpaniPitch(anchor);
              if (pitch2 !== null && anchor < barEnd && !(rollEnds && anchor === rollEnds.targetTick)) {
                candidates.push({ pitch: pitch2, startTick: anchor, durationTicks: damp(anchor, beat), velocityRule: 'shaped' });
              }
            }
          }
        } else if (kind === 'drive') {
          // the chorus drive (Phase 10.1): the ROOT on the bar downbeat,
          // optionally the FIFTH on the half bar at the high gate — never
          // faster than quarters outside rolls. The hits RING until the next
          // drive hit in the bar (or the bar's end) — the timpani's
          // idiomatic sustain, truncated by the usual damping rules; the
          // ring carries the downbeat's support through the bar's weaker
          // beat windows instead of leaving them bare.
          const fifthHere = (planBar.norm ?? 0) >= PERC_GATES.high;
          const half = barStart + Math.floor(btBar / 2);
          const pitch = timpaniRoot(barStart);
          if (pitch !== null && !(rollEnds && barStart === rollEnds.targetTick)) {
            candidates.push({ pitch, startTick: barStart, durationTicks: damp(barStart, (fifthHere ? half : barEnd) - barStart), articulation: 'marcato', velocityRule: 'shaped', drive: true });
          }
          if (fifthHere) {
            const pitch2 = timpaniFifth(half);
            if (pitch2 !== null && half < barEnd && !(rollEnds && half === rollEnds.targetTick)) {
              candidates.push({ pitch: pitch2, startTick: half, durationTicks: damp(half, barEnd - half), velocityRule: 'shaped', drive: true });
            }
          }
        } else if (kind === 'tutti') {
          const moment = momentForBar(ctx.moments, bar);
          if (moment?.kind === 'tutti' && !(rollEnds && barStart === rollEnds.targetTick)) {
            // the tutti hit is a ROOT or FIFTH of the downbeat chord, folded
            // into the range, never the leading tone (§15.4) — the same pool
            // the ordinary hits read, picked WITHOUT advancing the walk (the
            // moment gesture is state-free; the ghost above owns the walk)
            const target0 = prevTimpani ?? (lo + hi) / 2;
            const pool0 = timpaniPool(barStart);
            const pitch = pool0.length ? pool0.reduce((best, c) => (Math.abs(c - target0) < Math.abs(best - target0) ? c : best), pool0[0]) : null;
            if (pitch !== null) {
              const hitLen = moment.shape === 'breath' ? beat : moment.shape === 'decay' ? beat * 2 : btBar;
              candidates.push({ pitch, startTick: barStart, durationTicks: damp(barStart, Math.min(hitLen, barEnd - barStart)), articulation: 'marcato', moment: true, velocityRule: 'moment' });
            }
          }
        } else if (kind === 'final') {
          const pitch = timpaniPitch(barStart);
          if (pitch !== null) {
            candidates.push({ pitch, startTick: barStart, durationTicks: damp(barStart, btBar), articulation: 'marcato', velocityRule: 'shaped' });
          }
        }
      } else if (part === 'snare') {
        if (kind === 'cellLight' || kind === 'cellFull') {
          const tex = textureForType(ctx, sectionTypeNameAtBar(ctx, bar));
          const { ticks, step } = slotTicksOf(project.timeSignature, tex.style.cell, tex.style.rate, barStart, beat);
          const pitch = prof.fixedNote!;
          const picked = kind === 'cellLight' ? ticks.filter((_, i) => i % 2 === 0) : ticks;
          picked.forEach((onset, i) => {
            if (rollEnding.get(`${bar}:snare`) && onset === barStart) return; // the roll's ending hit owns the downbeat
            const accent = i === 0;
            candidates.push({
              pitch, startTick: onset, durationTicks: Math.max(1, Math.min(step, barEnd - onset) / 2),
              articulation: accent ? 'marcato' : 'staccato', velocityRule: 'shaped',
            });
          });
        } else if (kind === 'backbeat' || kind === 'grid') {
          // the chorus drive's snare line (Phase 10.1): the backbeat-style
          // hit on the meter's every second beat from beat 2 (beats 2 and 4
          // in 4/4), accented; on a kit without the timpani the 'grid'
          // carries the kit's quarter grid — the downbeat and beat 3 added,
          // plain — so every chorus window keeps a fresh hit. Fixed pitch,
          // the high gate's intensity.
          const pitch = prof.fixedNote!;
          const offs = beatOffsets(project.timeSignature);
          for (let i = 0; i < offs.length; i++) {
            if (kind === 'backbeat' && i % 2 === 0) continue; // beats 2 and 4 only
            const onset = barStart + offs[i];
            if (onset >= barEnd) break;
            if (rollEnding.get(`${bar}:snare`) && onset === barStart) continue; // the roll's ending hit owns the downbeat
            const accent = i % 2 === 1;
            candidates.push({ pitch, startTick: onset, durationTicks: Math.max(1, Math.floor(beat / 2)), ...(accent ? { articulation: 'marcato' as const } : { articulation: 'staccato' as const }), velocityRule: 'shaped', drive: true });
          }
        }
      } else if (part === 'cymbals') {
        if (kind === 'crash') {
          candidates.push({ pitch: prof.fixedNote!, startTick: barStart, durationTicks: Math.max(1, Math.min(btBar, dampingEnd(barStart) - barStart)), velocityRule: 'shaped' });
        } else if (kind === 'swell') {
          candidates.push({ pitch: prof.fixedNote!, startTick: barStart, durationTicks: Math.max(1, Math.min(btBar, dampingEnd(barStart) - barStart)), articulation: 'tremolo', velocityRule: 'shaped', ramp: 0.5 });
        }
      } else if (part === 'aux') {
        if (kind === 'offbeat') {
          // the sparse off-beat line (the off-beat eighths — one per beat
          // window); in the chorus it is the drive's aux voice (Phase 10.1)
          // and rides the high gate's intensity
          const chorusDrive = isChorusTypeP(sectionTypeNameAtBar(ctx, bar)) && (planBar.norm ?? 0) >= PERC_GATES.mid;
          const { ticks } = slotTicksOf(project.timeSignature, 'offBeat', 'eighths', barStart, beat);
          for (const onset of ticks) {
            candidates.push({ pitch: prof.fixedNote!, startTick: onset, durationTicks: Math.max(1, Math.min(eighth, barEnd - onset) / 2), articulation: 'staccato', velocityRule: 'shaped', ...(chorusDrive ? { drive: true } : {}) });
          }
        }
      }
    }
  }

  /* ---------------- phase A.5: the machine-gun bump ---------------------- */
  // repeated hits on one pitch get a small deterministic velocity variation
  // (±1..3 units, hashed from track, start and pitch — §15.5)
  const bumpOf = (trackId: string, start: number, pitch: number): number => {
    const h = hashString(`${trackId}|${start}|${pitch}`);
    const bump = (h % (2 * REPEAT_BUMP_MAX + 1)) - REPEAT_BUMP_MAX;
    return bump === 0 ? 1 : bump;
  };

  /* ---------------- phase B: velocities over the whole mix ---------------- */

  const rosterRoles = new Set(template.roster.map((r) => r.role));
  const others = [
    ...ruleNotes.filter((r) => rosterRoles.has(r.role)),
    ...Object.entries(stringsNotes)
      .map(([id, notes]) => ({ role: project.tracks.find((t) => t.id === id)?.role ?? '', notes }))
      .filter((r) => rosterRoles.has(r.role)),
    ...Object.entries(brassNotes)
      .map(([id, notes]) => ({ role: project.tracks.find((t) => t.id === id)?.role ?? '', notes }))
      .filter((r) => rosterRoles.has(r.role)),
    ...Object.entries(windNotes)
      .map(([id, notes]) => ({ role: project.tracks.find((t) => t.id === id)?.role ?? '', notes }))
      .filter((r) => rosterRoles.has(r.role)),
  ];
  const allPerc = PERC_PARTS.map((p) => ({ role: p, notes: candidatesByPart[p] ?? [] })).filter((r) => r.notes.length);
  const windows: { start: number; end: number; bound: number }[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const barStart = bar * btBar;
    for (const off of beatOffsets(project.timeSignature)) {
      const start = barStart + off;
      if (start >= endTick) continue;
      const end = Math.min(endTick, start + beat);
      const roles = new Set<string>();
      for (const r of others) if (r.notes.some((n) => n.startTick < end && n.startTick + n.durationTicks > start)) roles.add(r.role);
      for (const r of allPerc) if (r.notes.some((n) => n.startTick < end && n.startTick + n.durationTicks > start)) roles.add(r.role);
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

  for (const part of PERC_PARTS) {
    const track = trackOf.get(part);
    const candidates = candidatesByPart[part];
    if (!track || !candidates) continue;
    const prof = PERC_PROFILES[part];
    const [msLo, msHi] = prof.timingMs;
    const ordered = [...candidates].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
    const notes: Note[] = [];
    for (const c of ordered) {
      const bar = Math.min(bars, Math.max(1, Math.floor(c.startTick / btBar) + 1));
      const bound = boundAt(Math.min(endTick - 1, c.startTick));
      const norm = planByBar.get(bar)?.norm ?? 0;
      let v: number;
      // the drive's velocity rides the ABSOLUTE scale, not the window bound:
      // the bound is moments-dependent (a soli's tail crosses the barline
      // and pollutes the neighbouring windows' role sets), and a
      // bound-relative drive velocity would let a moment move a note far
      // outside its bars — the Phase 8 identity pin. The clamp stays with
      // governPercussionVelocities (which lowers percussion alone on a real
      // breach). The post-9 generator was likewise norm-independent.
      const cap = c.drive ? 127 : bound;
      if (c.velocityRule === 'moment') v = Math.min(momentVelocity(bar), bound);
      else if (c.drive) {
        const shaped = Math.max(1, Math.round(1 + (127 - 1) * Math.max(norm, PERC_GATES.peak)));
        v = Math.max(1, Math.round(shaped + (c.articulation === 'marcato' ? 8 : 0)));
      } else {
        const shaped = Math.max(1, Math.round(1 + (bound - 1) * Math.min(1, Math.max(0, norm))));
        // the downbeat accent, the swell's low base, the roll's ramp (§15.4)
        const accent = c.articulation === 'marcato' ? 8 : 0;
        const rampScale = c.ramp !== undefined ? 0.45 + 0.35 * c.ramp : 1;
        v = Math.max(1, Math.round((shaped + accent) * rampScale));
      }
      // the machine-gun variation (§15.5): EVERY hit carries the small
      // hashed velocity variation (±1..3 units from track, start, pitch —
      // no Math.random), so repeated same-pitch hits can never machine-gun.
      // The variation is a pure per-note hash — deliberately independent of
      // the neighbouring candidates, so a moment's suppression of an earlier
      // hit can never move a later note's velocity (the Phase 8 draw-identity
      // pin). Clamped to the note's cap (the window bound — or 127 for the
      // drive's absolute scale).
      v = Math.max(1, Math.min(cap, v + bumpOf(track.id, c.startTick, c.pitch)));
      v = Math.max(1, Math.min(127, Math.min(v, cap)));
      // the micro-timing (§15.3): a hash-seeded lag in the part's ms range,
      // clamped inside the written bar (a hit never crosses its bar). The
      // note's END stays where the candidate put it — the damping boundaries
      // (a soli, a near-silence bar) hold at the lagged onset too.
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
      });
    }
    notesByTrackId[track.id] = sanitizeNotes(notes, track.lowestNote, track.highestNote, endTick);
    const count = notesByTrackId[track.id].length;
    if (count) reports.push(`percussion ${part}: ${count} notes (range ${track.lowestNote}-${track.highestNote}${prof.fixedNote !== null ? `, fixed ${prof.fixedNote}` : ''}, lag ${msLo}-${msHi} ms)`);
  }

  return { notesByTrackId, reports };
}

/**
 * The final percussion safety pass (§15.7): re-checks every beat window over
 * the FINAL notes (the strings' humanize/legato may have moved attacks
 * across window boundaries) and lowers PERCUSSION ALONE where the mix would
 * breach the hard clamp. With properly capped velocities this never fires —
 * it is the clamp's guarantee, not a shaper.
 */
export function governPercussionVelocities(input: {
  project: Project;
  template: NonNullable<OrchestratorContext['template']>;
  percussion: { role: string; notes: Note[] }[];
  otherNotes: { role: string; notes: Note[] }[];
}): void {
  const { project, template, percussion, otherNotes } = input;
  const clampMax = template.budget.energyClamp[1];
  const N = template.roster.length;
  const rosterRoles = new Set(template.roster.map((r) => r.role));
  const btBar = barTicks(project.timeSignature);
  const bars = projectBars(project);
  const endTick = bars * btBar;
  const bt = beatTicks(project.timeSignature);
  const others = otherNotes.filter((r) => rosterRoles.has(r.role));
  const percRoles = percussion.filter((r) => rosterRoles.has(r.role) && r.notes.length);
  if (!percRoles.length) return;
  for (let bar = 0; bar < bars; bar++) {
    const barStart = bar * btBar;
    for (let off = 0; off < btBar; off += bt) {
      const start = barStart + off;
      if (start >= endTick) continue;
      const end = Math.min(endTick, start + bt);
      const roles = new Set<string>();
      let otherSum = 0;
      let percSum = 0;
      let count = 0;
      for (const r of others) {
        for (const n of r.notes) {
          if (n.startTick < end && n.startTick + n.durationTicks > start) { roles.add(r.role); otherSum += n.velocity; count++; }
        }
      }
      for (const r of percRoles) {
        for (const n of r.notes) {
          if (n.startTick < end && n.startTick + n.durationTicks > start) { roles.add(r.role); percSum += n.velocity; count++; }
        }
      }
      if (!roles.size || !count || !percSum) continue;
      const energy = (roles.size / N) * (((otherSum + percSum) / count) / 127);
      if (energy <= clampMax + 1e-9) continue;
      const allowedTotal = (127 * clampMax * N * count) / roles.size;
      const targetPerc = Math.max(0, allowedTotal - otherSum);
      const scale = targetPerc / percSum;
      if (scale >= 1) continue;
      for (const r of percRoles) {
        for (const n of r.notes) {
          if (n.startTick < end && n.startTick + n.durationTicks > start) {
            n.velocity = Math.max(1, Math.floor(n.velocity * scale));
          }
        }
      }
    }
  }
}
