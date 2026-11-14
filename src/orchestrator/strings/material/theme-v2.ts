/** Intent-conditioned, bounded melodic search. Rhythm and pitch are composed
 * separately, then judged together. No stored melodies, named tune presets or
 * per-note random walk. Intent changes the objective, not the safety rules.
 */
import { identityDraw, type StringsIdentity } from '../identity';
import { chordAt, judgeLine, localScale, pitchClassOf, semitonesOf, type LineNote, type TonalFrame } from './line';
import { describeTheme, type ThemeInput, type ThemeResult } from './theme';

interface Rhythm { readonly lengths: number[]; readonly offset: number; readonly cost: number }

/** Enumerate metrical partitions, not a menu of complete rhythm patterns. */
function rhythms(beats: number, identity: StringsIdentity, tail: boolean): Rhythm[] {
  const out: Rhythm[] = [];
  const activity = identity.intent.activity;
  const offset = !tail && identity.intent.syncopation > 0.68 ? 0.5 : 0;
  const targetCount = 2 + activity * Math.min(4, beats);
  const walk = (left: number, lengths: number[]): void => {
    if (left === 0) {
      if (lengths.length < 2) return;
      let at = offset;
      let off = 0;
      for (const length of lengths) { if (at % 1 !== 0) off++; at += length; }
      const short = lengths.filter((n) => n === 0.5).length / lengths.length;
      const repetition = lengths.slice(1).filter((n, i) => n === lengths[i]).length;
      const cadence = tail && lengths[lengths.length - 1] < 1 ? 0.8 : 0;
      const signature = lengths.join(',');
      out.push({ lengths, offset, cost: Math.abs(lengths.length - targetCount) * 0.8
        + Math.abs(off / lengths.length - identity.intent.syncopation * 0.65)
        + Math.abs(short - activity * 0.6) + cadence + repetition * 0.06
        + identityDraw(identity.streams.rhythm, `${tail ? 'tail' : 'head'}:${signature}`) * 0.35 });
      return;
    }
    if (lengths.length >= 6) return;
    for (const length of [0.5, 1, 1.5, 2, 3, 4]) if (length <= left) walk(left - length, [...lengths, length]);
  };
  walk(beats - offset, []);
  return out.sort((a, b) => a.cost - b.cost).slice(0, 5);
}

function targetAt(identity: StringsIdentity, progress: number): number {
  const p = Math.min(2.9999, Math.max(0, progress * 3));
  const i = Math.floor(p);
  const points = identity.intent.trajectory;
  return points[i] + (points[i + 1] - points[i]) * (p - i);
}

/** Include chord-inflected scale notes, including chromatic thirds/sevenths. */
function optionsAt(frame: TonalFrame, tick: number): Pick<LineNote, 'step' | 'alter'>[] {
  const chord = chordAt(frame, tick);
  if (!chord) return [];
  const allowed = localScale(frame, chord);
  const out: Pick<LineNote, 'step' | 'alter'>[] = [];
  for (let step = -5; step <= 12; step++) {
    for (const alter of [0, -1, 1]) {
      const n = { step, alter };
      if (!allowed.has(pitchClassOf(frame, n))) continue;
      // Prefer the mode's own spelling (F, not E-sharp). An alteration
      // represents an actually foreign chord tone, not an enharmonic way
      // of falsifying a diatonic interval/direction in thematic memory.
      if (alter !== 0 && frame.scale.some((s) => (frame.key + s) % 12 === pitchClassOf(frame, n))) continue;
      // Alteration is a harmonic inflection, never ornamental noise.
      if (alter !== 0 && !chord.fact.pitchClasses.includes(pitchClassOf(frame, n))) continue;
      if (out.some((o) => semitonesOf(frame, o) === semitonesOf(frame, n))) continue;
      out.push(n);
    }
  }
  return out;
}

export function generateIdentityTheme(input: ThemeInput, identity: StringsIdentity): ThemeResult {
  const { frame, homeTick } = input;
  if (frame.scale.length !== 7) return { ok: false, reason: 'the mode does not have seven notes' };
  // These are the metres already supported by the V1 material contract.
  if (frame.beatsPerBar !== 3 && frame.beatsPerBar !== 4) return { ok: false, reason: `no theme rhythm vocabulary for ${frame.beatsPerBar} beats in a bar` };
  if (input.availableTicks !== undefined && input.availableTicks < frame.barTicks) return { ok: false, reason: 'less than one bar available for an uncompressed theme' };
  const bars = (input.availableTicks ?? 2 * frame.barTicks) >= 2 * frame.barTicks ? 2 : 1;
  const lengthTicks = bars * frame.barTicks;
  const first = chordAt(frame, homeTick);
  if (!first || !chordAt(frame, homeTick + lengthTicks - 1)) return { ok: false, reason: 'no harmony under the theme home' };
  const heads = rhythms(frame.beatsPerBar, identity, false);
  const tails = bars === 2 ? rhythms(frame.beatsPerBar, identity, true) : [{ lengths: [], offset: 0, cost: 0 }];
  const anchors = [...new Set(optionsAt(frame, homeTick).filter((n) => n.step >= 0 && n.step <= 6 && first.fact.pitchClasses.includes(pitchClassOf(frame, n))).map((n) => n.step))];
  if (!anchors.length) return { ok: false, reason: 'the first harmony has no scale anchor for a theme' };
  const anchor = anchors[Math.floor(identityDraw(identity.streams.theme, 'harmonic-anchor') * anchors.length)];
  interface Candidate { notes: LineNote[]; cost: number; headCount: number; parts: Record<string, number> }
  let best: Candidate | null = null;
  let judgedCount = 0;
  for (const head of heads) for (const tail of tails) {
    const slots: { tick: number; duration: number }[] = [];
    for (const [b, rhythm] of [head, tail].entries()) {
      let tick = homeTick + b * frame.barTicks + rhythm.offset * frame.beatTicks;
      for (const beats of rhythm.lengths) { slots.push({ tick, duration: beats * frame.beatTicks }); tick += beats * frame.beatTicks; }
    }
    let paths: { notes: LineNote[]; cost: number; dissonances: number }[] = [{ notes: [], cost: 0, dissonances: 0 }];
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const chord = chordAt(frame, slot.tick);
      if (!chord) { paths = []; break; }
      const next: typeof paths = [];
      for (const path of paths) for (const option of optionsAt(frame, slot.tick)) {
        const note: LineNote = { ...slot, ...option };
        const prev = path.notes[i - 1];
        const move = prev ? note.step - prev.step : 0;
        if (prev && (Math.abs(move) > 5 || Math.abs(semitonesOf(frame, note) - semitonesOf(frame, prev)) > 9)) continue;
        if (i >= 2 && move === 0 && prev.step === path.notes[i - 2].step) continue;
        const notes = [...path.notes, note];
        if (Math.max(...notes.map((n) => n.step)) - Math.min(...notes.map((n) => n.step)) > identity.intent.breadth + 2) continue;
        const judged = judgeLine(frame, notes, { finalStable: i === slots.length - 1 });
        // A last pending dissonance/held suspension is judged when its successor exists.
        if (judged.problems.some((p) => p.index < i || i === slots.length - 1)) continue;
        const tone = chord.fact.pitchClasses.includes(pitchClassOf(frame, note));
        const dissonances = path.dissonances + (tone ? 0 : 1);
        const progress = (slot.tick - homeTick) / Math.max(1, lengthTicks - frame.beatTicks);
        const shape = Math.abs(note.step - (anchor + targetAt(identity, progress))) * 0.55;
        const opening = i === 1 ? Math.abs(move - identity.intent.opening) * 1.65 : 0;
        const connection = prev ? Math.max(0, Math.abs(move) - 2) * 0.35 : Math.abs(note.step - anchor) * 1.5;
        const tension = Math.abs(dissonances - (i + 1) * identity.intent.tension) * 0.25;
        next.push({ notes, dissonances, cost: path.cost + shape + opening + connection + tension });
      }
      // Preserve multiple first gestures in the beam, rather than one globally preferred leap.
      const groups = new Map<string, typeof paths>();
      for (const p of next.sort((a, b) => a.cost - b.cost)) {
        const key = p.notes.length > 1 ? `${p.notes[1].step - p.notes[0].step}:${p.notes[p.notes.length - 1].step}` : `${p.notes[0].step}`;
        const group = groups.get(key) ?? [];
        if (group.length < 2) group.push(p);
        groups.set(key, group);
      }
      paths = [...groups.values()].flat().sort((a, b) => a.cost - b.cost).slice(0, 32);
    }
    for (const path of paths) {
      judgedCount++;
      if (!judgeLine(frame, path.notes, { finalStable: true }).ok) continue;
      const range = Math.max(...path.notes.map((n) => n.step)) - Math.min(...path.notes.map((n) => n.step));
      if (range < 2) continue;
      const rhythmCost = (head.cost + tail.cost) * 3;
      const breadthCost = Math.abs(range - identity.intent.breadth) * 0.45;
      const cost = path.cost / path.notes.length + rhythmCost + breadthCost;
      if (!best || cost < best.cost) best = { notes: path.notes, headCount: head.lengths.length, cost, parts: { line: path.cost / path.notes.length, rhythm: rhythmCost, breadth: breadthCost } };
    }
  }
  if (!best) return { ok: false, reason: 'no intent-conditioned theme satisfies the tonal, resolution and span rules' };
  const notes = best.notes.map((n) => ({ ...n, tick: n.tick - homeTick }));
  const functions = judgeLine(frame, best.notes, { finalStable: true }).functions;
  const described = describeTheme(frame, best.notes, functions);
  const leapAt = described.intervals.findIndex((n) => Math.abs(n) >= 3);
  const move = leapAt < 0 ? 0 : described.intervals[leapAt];
  const rhythmCharacter = `${identity.intent.activity > 0.6 ? 'active' : identity.intent.activity < 0.3 ? 'spacious' : 'measured'}, ${notes[0].tick > 0 ? 'pickup' : identity.intent.syncopation > 0.4 ? 'displaced' : 'grounded'}`;
  return { ok: true, theme: {
    id: `strings-theme-v2-${identity.seed.toString(16)}-${homeTick}`,
    notes: notes.map((n, i) => ({ ...n, function: functions[i], inHead: i < best!.headCount })), lengthTicks, headCount: best.headCount,
    identity: { ...described,
      leap: { fromIndex: leapAt, steps: move, semitones: leapAt < 0 ? 0 : Math.abs(described.semitoneIntervals[leapAt]), name: leapAt < 0 ? 'stepwise gesture (no defining leap)' : `${move < 0 ? 'falling' : 'rising'} ${Math.abs(move) + 1}th` },
      direction: notes[notes.length - 1].step > notes[0].step ? 'opening outward' : 'returning inward',
      harmonicRoles: functions, rhythmicCharacter: rhythmCharacter,
      character: `${rhythmCharacter}; ${described.dissonances.length ? 'leaning and resolving' : 'harmonically settled'}`,
      protectedFeatures: ['the head rhythm', 'the head interval directions', ...(leapAt >= 0 ? ['the characteristic interval'] : ['the stepwise/repeated-note opening'])],
    },
    home: { startTick: homeTick, endTick: homeTick + lengthTicks, chords: frame.harmony.chords.filter((c) => c.fact.startTick < homeTick + lengthTicks && c.fact.endTick > homeTick).map((c) => c.fact.symbol) },
    score: -best.cost, scoreParts: best.parts, candidatesJudged: judgedCount,
  } };
}
