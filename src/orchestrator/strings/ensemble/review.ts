/**
 * Ensemble review for two voices (Strings V1, Stage 3) — reads the finished
 * passage as a whole and names what is wrong with it, stretch by stretch.
 * It changes nothing itself: the caller lowers the level of a stretch that
 * has a finding (preferred → plainer → silent) and has it written again.
 *
 * What is read:
 *   together   every two-voice rule of `judgeTogether`, over the whole
 *              passage (also across the joins between stretches);
 *   own line   each gesture of the second voice as a line of its own: a
 *              dissonance left open at the end of a gesture is a finding;
 *   high point the second voice's highest note of a phrase must not begin
 *              within a beat of the first voice's high point;
 *   breath     a note must not run past the tick its stretch has to end by.
 *
 * The facts (how the voices move, how often they begin together, how their
 * contours compare) are counted for the report. They are not targets and
 * nothing is rewritten to change them.
 */
import { judgeLine, type TonalFrame } from '../material/line';
import { judgeTogether, soundingPitch, type ConflictKind, type MotionCount, type SoundingNote } from './counterpoint';
import type { EnsemblePlan } from './plan';
import type { CompanionNote } from '../writers/companion';

export type FindingKind = ConflictKind | 'open-dissonance' | 'own-line' | 'shared-high-point' | 'no-breath';

export interface ReviewFinding {
  /** The stretch the finding belongs to; null when it cannot be placed. */
  readonly span: number | null;
  readonly tick: number;
  readonly kind: FindingKind;
  readonly text: string;
}

export interface EnsembleFacts {
  readonly notes: { readonly primary: number; readonly companion: number };
  /** Beats in which each voice sounds. */
  readonly beats: { readonly total: number; readonly primaryOnly: number; readonly companionOnly: number; readonly both: number; readonly neither: number };
  /** Notes of the second voice, and how many begin together with a note of the first. */
  readonly onsets: { readonly companion: number; readonly together: number };
  readonly motion: MotionCount;
  /** Time the two voices sound together, by the interval between them (beats). */
  readonly together: { readonly thirdsAndSixths: number; readonly fifthsAndOctaves: number; readonly dissonant: number };
  /** Beat by beat, where both voices sound on this beat and the one before: do they go the same way? */
  readonly contour: { readonly same: number; readonly opposite: number; readonly oneHolds: number; readonly bothHold: number };
  /** Bars in which both voices play, and in how many of them their rhythms are the same. */
  readonly rhythm: { readonly barsTogether: number; readonly sameRhythm: number };
}

export interface EnsembleReview {
  readonly findings: readonly ReviewFinding[];
  readonly facts: EnsembleFacts;
}

export interface ReviewInput {
  readonly frame: TonalFrame;
  readonly plan: EnsemblePlan;
  readonly primary: readonly SoundingNote[];
  readonly companion: readonly CompanionNote[];
  readonly phrases: readonly { readonly index: number; readonly startTick: number; readonly endTick: number; readonly climaxTick: number }[];
  /** The last tick of the piece. */
  readonly endTick: number;
}

export function reviewEnsemble(input: ReviewInput): EnsembleReview {
  const { frame, plan, primary, companion } = input;
  const beat = frame.beatTicks;
  const findings: ReviewFinding[] = [];
  const spanAt = (tick: number): number | null => {
    const note = companion.find((n) => n.tick <= tick && tick < n.tick + n.duration);
    if (note) return note.span;
    return plan.spans.find((s) => s.startTick <= tick && tick < s.endTick)?.index ?? null;
  };
  const pitch = (n: SoundingNote): number => soundingPitch(frame, n);

  // the two voices together, over the whole passage
  const together = judgeTogether(frame, companion, primary, { side: null });
  for (const conflict of together.conflicts) findings.push({ span: spanAt(conflict.tick), tick: conflict.tick, kind: conflict.kind, text: conflict.text });
  // a stretch stays on one side of the first voice
  for (const span of plan.spans) {
    const signs = new Set(together.verticals.filter((v) => companion[v.a].span === span.index && v.semitones !== 0).map((v) => Math.sign(v.semitones)));
    if (signs.size > 1) findings.push({ span: span.index, tick: span.startTick, kind: 'crossing', text: 'the voices cross inside one stretch' });
  }

  // each gesture of the second voice as a line of its own
  let gesture: CompanionNote[] = [];
  const close = (): void => {
    if (gesture.length) {
      const judged = judgeLine(frame, gesture, { finalStable: true });
      for (const problem of judged.problems) {
        const note = gesture[problem.index];
        const last = problem.index === gesture.length - 1;
        findings.push({ span: note.span, tick: note.tick, kind: last && /ends on a dissonance|does not resolve/.test(problem.text) ? 'open-dissonance' : 'own-line', text: problem.text });
      }
    }
    gesture = [];
  };
  for (const note of companion) {
    const last = gesture[gesture.length - 1];
    if (last && (last.breathAfter || last.tick + last.duration !== note.tick)) close();
    gesture.push(note);
  }
  close();

  // high points
  for (const phrase of input.phrases) {
    const inside = companion.filter((n) => n.tick >= phrase.startTick && n.tick < phrase.endTick);
    if (inside.length < 2) continue;
    const top = Math.max(...inside.map(pitch));
    const peak = inside.find((n) => pitch(n) === top)!;
    const lowest = Math.min(...inside.map(pitch));
    if (top > lowest && Math.abs(peak.tick - phrase.climaxTick) <= beat) {
      findings.push({ span: peak.span, tick: peak.tick, kind: 'shared-high-point', text: 'the second voice reaches its highest note within a beat of the first voice\'s high point' });
    }
  }

  // breaths
  for (const note of companion) {
    const span = plan.spans[note.span];
    if (span && note.tick + note.duration > span.mustEndBy && !(plan.spans[note.span + 1] && plan.spans[note.span + 1].relationship === 'support' && note.relationship === 'support')) {
      findings.push({ span: note.span, tick: note.tick, kind: 'no-breath', text: 'a note runs past the point its stretch has to be silent by' });
    }
  }

  /* ---------------- facts ---------------- */
  const sounding = (line: readonly SoundingNote[], tick: number): SoundingNote | undefined => line.find((n) => n.tick <= tick && tick < n.tick + n.duration);
  const soundsIn = (line: readonly SoundingNote[], from: number, to: number): boolean => line.some((n) => n.tick < to && n.tick + n.duration > from);
  const beats = { total: 0, primaryOnly: 0, companionOnly: 0, both: 0, neither: 0 };
  const contour = { same: 0, opposite: 0, oneHolds: 0, bothHold: 0 };
  for (let tick = 0; tick < input.endTick; tick += beat) {
    beats.total++;
    const p = soundsIn(primary, tick, tick + beat);
    const c = soundsIn(companion, tick, tick + beat);
    if (p && c) beats.both++; else if (p) beats.primaryOnly++; else if (c) beats.companionOnly++; else beats.neither++;
    if (tick >= beat) {
      const pNow = sounding(primary, tick); const pBefore = sounding(primary, tick - beat);
      const cNow = sounding(companion, tick); const cBefore = sounding(companion, tick - beat);
      if (pNow && pBefore && cNow && cBefore) {
        const dp = Math.sign(pitch(pNow) - pitch(pBefore));
        const dc = Math.sign(pitch(cNow) - pitch(cBefore));
        if (dp === 0 && dc === 0) contour.bothHold++; else if (dp === 0 || dc === 0) contour.oneHolds++; else if (dp === dc) contour.same++; else contour.opposite++;
      }
    }
  }
  const primaryTicks = new Set(primary.map((n) => n.tick));
  const time = { thirdsAndSixths: 0, fifthsAndOctaves: 0, dissonant: 0 };
  for (const v of together.verticals) {
    const length = (v.endTick - v.tick) / beat;
    if (v.quality === 'imperfect') time.thirdsAndSixths += length; else if (v.quality === 'perfect') time.fifthsAndOctaves += length; else time.dissonant += length;
  }
  const rhythm = { barsTogether: 0, sameRhythm: 0 };
  for (let tick = 0; tick < input.endTick; tick += frame.barTicks) {
    const pattern = (line: readonly SoundingNote[]): string => line.filter((n) => n.tick >= tick && n.tick < tick + frame.barTicks).map((n) => n.tick - tick).join(',');
    if (soundsIn(primary, tick, tick + frame.barTicks) && soundsIn(companion, tick, tick + frame.barTicks)) {
      rhythm.barsTogether++;
      if (pattern(primary) === pattern(companion)) rhythm.sameRhythm++;
    }
  }
  const round = (n: number): number => Math.round(n * 100) / 100;
  return {
    findings,
    facts: {
      notes: { primary: primary.length, companion: companion.length },
      beats,
      onsets: { companion: companion.length, together: companion.filter((n) => primaryTicks.has(n.tick)).length },
      motion: together.motion,
      together: { thirdsAndSixths: round(time.thirdsAndSixths), fifthsAndOctaves: round(time.fifthsAndOctaves), dissonant: round(time.dissonant) },
      contour,
      rhythm,
    },
  };
}
