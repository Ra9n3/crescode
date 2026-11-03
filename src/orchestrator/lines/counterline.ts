/**
 * The counterline (Phase 4d). A stepwise second line UNDER the lead that
 * sounds where the lead holds long notes or rests, moving mostly in
 * contrary motion to it (the direction flips against the lead's motion at
 * every window), consonant with the lead (3rd/6th/10th) on strong beats —
 * or with the chord when the lead is silent there. Parallel 5ths/8ves
 * between lead and counterline carry a soft penalty: one alternative is
 * tried, otherwise the parallel stands. Deterministic per (inputs, take)
 * via its own salted D8 stream.
 */
import { mulberry32, hashString } from '../../engine/generate';
import { orchestrationSeedFor } from '../spine';
import { barTicks, beatOffsets, beatTicks, isCompound } from '../../shared/schema/meter';
import { scalePitchClasses } from '../../shared/schema/modes';
import { chordAt } from './motif';
import type { Note, Project } from '../../shared/schema/types';
import type { ResolvedChord } from '../spine';

/** Consonant intervals below the lead, mod octave: 3rds and 6ths (10ths reduce to 3rds). */
const CONSONANT_BELOW_MOD = new Set([3, 4, 8, 9]);
export const COUNTERLINE_ARTICULATION = 'legato' as const;

export interface CounterInput {
  project: Project;
  spans: ResolvedChord[];
  /** The bars where the layer plan gives the counterline track its role. */
  counterBars: ReadonlySet<number>;
  /** The finished lead line (motif notes) the counterline answers. */
  lead: Note[];
  comfortable: [number, number];
  take: number;
  /** Pitch class of the leading tone, or null — the counter never doubles
   *  the lead's leading tone (the hard no-doubled-LT rule, 4h). */
  leadingTonePc?: number | null;
}

const overlapsTick = (n: Note, tick: number) => n.startTick <= tick && tick < n.startTick + n.durationTicks;

export function counterlineLine(input: CounterInput): Note[] {
  const { project, spans, counterBars, lead, comfortable, take, leadingTonePc } = input;
  if (!counterBars.size) return [];
  const btBar = barTicks(project.timeSignature);
  const beat = beatTicks(project.timeSignature);
  const simple = !isCompound(project.timeSignature);
  const nBeats = beatOffsets(project.timeSignature).length;
  const scale = scalePitchClasses(project.key, project.mode);
  const scaleLen = scale.length;
  const modScale = (d: number) => (((d % scaleLen) + scaleLen) % scaleLen);
  const pcOfDegree = (d: number) => ((scale[modScale(d)] % 12) + 12) % 12;

  const rng = mulberry32((orchestrationSeedFor(project, { take }) ^ Math.imul(hashString('counter'), 0x85ebca6b)) >>> 0);

  const sortedLead = [...lead].sort((a, b) => a.startTick - b.startTick);
  const leadAt = (tick: number): Note | null => sortedLead.find((n) => overlapsTick(n, tick)) ?? null;
  const isStrongBeat = (tick: number): boolean => {
    const inBar = ((tick % btBar) + btBar) % btBar;
    const idx = Math.round(inBar / beat);
    if (Math.abs(inBar - idx * beat) > 1e-9) return false; // not on a felt-beat position
    return idx === 0 || (simple && idx * 2 === nBeats);
  };

  const out: Note[] = [];
  let degree: number | null = null; // running scale-degree position of the counterline

  let prevInterval: number | null = null; // last (lead − counter) interval, mod reduced
  let prevLeadPitch: number | null = null;

  for (const bar of [...counterBars].sort((a, b) => a - b)) {
    const barStart = (bar - 1) * btBar;
    const barEnd = barStart + btBar;
    // the room the lead leaves: its rests, and the body of its long holds
    const inBarLead = sortedLead.filter((n) => n.startTick < barEnd && n.startTick + n.durationTicks > barStart);
    const windows: [number, number][] = [];
    let cursor = barStart;
    for (const n of inBarLead) {
      if (n.startTick > cursor) windows.push([cursor, Math.min(n.startTick, barEnd)]);
      const holdFrom = Math.max(n.startTick, barStart);
      const holdTo = Math.min(n.startTick + n.durationTicks, barEnd);
      if (n.durationTicks >= beat && holdTo - holdFrom >= beat) windows.push([holdFrom + beat / 2, holdTo]);
      cursor = Math.max(cursor, holdTo);
    }
    if (cursor < barEnd) windows.push([cursor, barEnd]);

    for (const [ws, we] of windows) {
      if (we - ws < beat / 2) continue; // too short to speak
      // contrary motion: flip against the lead's direction across the boundary
      const before = sortedLead.filter((n) => n.startTick + n.durationTicks <= ws + 1).pop();
      const after = sortedLead.find((n) => n.startTick >= ws);
      const leadDir = before && after ? Math.sign(after.pitch - before.pitch) : 0;
      const dir: number = leadDir !== 0 ? -leadDir : rng() < 0.5 ? 1 : -1;
      if (degree === null) {
        // enter roughly a 10th below the lead's first window pitch
        const lp = leadAt(ws)?.pitch ?? comfortable[1];
        const targetPc = ((lp - 15) % 12 + 12) % 12;
        degree = scale.findIndex((pc) => ((pc % 12) + 12) % 12 === targetPc);
        if (degree < 0) degree = 0;
        degree -= scaleLen; // sit low in the register
      }

      const stepTicks = we - ws < 2 * beat ? beat / 2 : beat;
      // absolute degree → pitch (degree octaves honoured), like the motif
      const mid = (comfortable[0] + comfortable[1]) / 2;
      const tonicPc = ((scale[0] % 12) + 12) % 12;
      const anchorCandidates = [40, 52, 64, 76, 88].map((p) => p - ((((p - tonicPc) % 12) + 12) % 12));
      const anchor = anchorCandidates.reduce((best, p) => (Math.abs(p - (mid - 15)) < Math.abs(best - (mid - 15)) ? p : best), anchorCandidates[0]);
      const pitchFor = (d: number): number => anchor + 12 * Math.floor(d / scaleLen) + (((pcOfDegree(d) - tonicPc) + 12) % 12);
      const settle = (d: number, ceiling: number): { d: number; p: number } | null => {
        let dd = d;
        let guard = 0;
        let p = pitchFor(dd);
        while (p > ceiling && guard++ < scaleLen) { dd -= 1; p = pitchFor(dd); }
        while (p < comfortable[0] && guard++ < 2 * scaleLen) { dd += 1; p = pitchFor(dd); }
        return p < comfortable[0] || p > ceiling ? null : { d: dd, p };
      };

      for (let t = ws; t < we - 1e-9; t += stepTicks) {
        const len = Math.min(stepTicks, we - t);
        degree! += dir * (rng() < 0.82 ? 1 : 2);
        // stay under the lead wherever it sounds
        const leadNow = leadAt(t);
        const ceiling = leadNow ? leadNow.pitch - 2 : comfortable[1];
        const settled = settle(degree!, ceiling);
        if (!settled) { degree! -= dir; continue; }
        degree = settled.d;
        let pitch = settled.p;
        // never double the lead's leading tone (hard rule): step away or rest
        if (leadingTonePc != null && leadNow && ((leadNow.pitch % 12) + 12) % 12 === leadingTonePc && pcOfDegree(degree!) === leadingTonePc) {
          const alt = settle(degree! + dir, ceiling);
          if (alt && pcOfDegree(alt.d) !== leadingTonePc) { degree = alt.d; pitch = alt.p; }
          else continue;
        }
        // strong beats: consonant with the lead — or with the chord if it rests
        if (isStrongBeat(t)) {
          const l = leadAt(t);
          let fixed: number | null = null;
          for (let d = 0; d <= scaleLen && fixed === null; d++) {
            for (const d2 of d === 0 ? [0] : [1, -1]) {
              const s = settle(degree! + d * d2, ceiling);
              if (!s) continue;
              if (l) {
                const iv = ((((l.pitch - s.p) % 12) + 12) % 12);
                const ltClash = leadingTonePc != null && ((l.pitch % 12) + 12) % 12 === leadingTonePc && pcOfDegree(s.d) === leadingTonePc;
                if (CONSONANT_BELOW_MOD.has(iv) && !ltClash) { fixed = s.p; degree! = s.d; break; }
              } else {
                const chord = chordAt(spans, t);
                if (chord && chord.parsed.pitchClasses.includes(pcOfDegree(s.d))) {
                  fixed = s.p; degree! = s.d; break;
                }
              }
            }
          }
          if (fixed === null) continue; // nothing consonant fits: the counterline rests here
          pitch = fixed;
        } else if (leadNow && prevInterval !== null && prevLeadPitch !== null) {
          // soft parallel penalty: one alternative is tried against 5ths/8ves
          const iv = ((((leadNow.pitch - pitch) % 12) + 12) % 12);
          const similar = Math.sign(leadNow.pitch - prevLeadPitch) === Math.sign(pitch - (prevLeadPitch - prevInterval));
          if ((iv === 0 || iv === 7) && iv === prevInterval && similar) {
            const alt = settle(degree! + dir, ceiling);
            if (alt) { degree = alt.d; pitch = alt.p; }
          }
        }
        out.push({ pitch, startTick: t, durationTicks: Math.round(len), velocity: 74, articulation: COUNTERLINE_ARTICULATION });
        prevInterval = leadNow ? ((((leadNow.pitch - pitch) % 12) + 12) % 12) : null;
        prevLeadPitch = leadNow?.pitch ?? null;
      }
    }
  }
  return out;
}
