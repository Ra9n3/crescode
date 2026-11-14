/** Musical development V2. Structural segmentation and thematic operations
 * produce symbolic line intentions only. Instrument, octave, bow, articulation,
 * velocity and MIDI remain owned by the accepted writers.
 */
import { identityDraw, type StringsIdentity } from '../identity';
import { adaptMaterial, type Adaptation } from '../material/adapt';
import { chordAt, judgeLine, pitchClassOf, type LineNote, type TonalFrame } from '../material/line';
import type { Theme } from '../material/theme';
import type { PhraseInput, PhrasePlan, PhrasePlanningResult, PhraseSegment, SegmentKind } from './plan';

type Journey = 'continuous' | 'dialogue' | 'sequence' | 'reconstruction' | 'lyrical' | 'delayed-arrival';
type Operation = 'statement' | 'head' | 'tail' | 'inversion' | 'augmentation' | 'diminution' | 'fragment' | 'reconstruction';
interface Unit { operation: Operation; kind: SegmentKind; ticks: number; shift: number }
const mod = (v: number, n: number) => ((v % n) + n) % n;

interface Material { notes: LineNote[]; rhythmScale: number; headTicks: number }
function materialFor(theme: Theme, operation: Operation, ticks: number, beat: number): Material | null {
  const head = theme.notes.slice(0, theme.headCount);
  const tail = theme.notes.slice(theme.headCount);
  let source: readonly LineNote[] = operation === 'tail' && tail.length >= 2 ? tail
    : operation === 'head' || operation === 'fragment' || operation === 'inversion' ? head : theme.notes;
  if (operation === 'fragment') source = head.slice(0, Math.max(2, Math.ceil(head.length / 2)));
  if (source.length < 2) return null;
  const origin = source[0].tick;
  const length = source[source.length - 1].tick + source[source.length - 1].duration - origin;
  // Only metrical augmentation/diminution, never arbitrary proportional squeeze.
  const nominal = source === theme.notes ? theme.lengthTicks
    : operation === 'head' || operation === 'inversion' ? (theme.notes[theme.headCount]?.tick ?? theme.lengthTicks) : length;
  const factor = [4, 2, 1, 0.5].find((f) => nominal * f <= ticks && source.every((n) => n.duration * f >= beat / 2));
  if (factor === undefined) return null;
  // Do not squeeze a musical idea into a collection of tiny notes.
  if (source.some((n) => n.duration * factor < beat / 2)) return null;
  const firstStep = source[0].step;
  const notes = source.map((n) => ({ tick: Math.round((n.tick - origin) * factor), duration: Math.round(n.duration * factor),
    step: operation === 'inversion' ? 2 * firstStep - n.step : n.step, alter: operation === 'inversion' ? 0 : n.alter }));
  return { notes, rhythmScale: factor, headTicks: Math.min(length, (theme.notes[theme.headCount]?.tick ?? theme.lengthTicks) - origin) * factor };
}

/** Boundary choice uses supplied structural evidence, harmonic arrivals and a
 * piece-specific breathing span. No fixed one-phrase-per-section assumption. */
function divide(input: PhraseInput, identity: StringsIdentity): { startTick: number; endTick: number; energy: number; evidence: string[] }[] {
  const { frame, structure } = input;
  const out: ReturnType<typeof divide> = [];
  for (const window of input.windows) {
    let start = window.startTick;
    while (start < window.endTick) {
      const remaining = window.endTick - start;
      const target = Math.max(2 * frame.barTicks, identity.intent.phraseBeats * frame.beatTicks);
      if (remaining <= target * 1.3 || remaining < target + 2 * frame.barTicks) { out.push({ startTick: start, endTick: window.endTick, energy: window.energy ?? 0.5, evidence: ['remaining sounding window'] }); break; }
      const minimum = start + 2 * frame.barTicks;
      const maximum = Math.min(window.endTick - 2 * frame.barTicks, start + target * 1.5);
      const candidates = structure.candidates.filter((c) => c.tick >= minimum && c.tick <= maximum);
      const ranked = candidates.map((c) => ({ tick: c.tick, evidence: [`${c.level}: ${c.levelReason}`],
        cost: Math.abs(c.tick - start - target) / frame.barTicks - c.strength * 1.5 - (c.level === 'structural-division' ? 1.5 : 0) }));
      for (const arrival of structure.arrivals.filter((a) => a.tick >= minimum && a.tick <= maximum)) ranked.push({
        tick: arrival.tick, evidence: [`harmonic arrival: ${arrival.kind}`], cost: Math.abs(arrival.tick - start - target) / frame.barTicks - arrival.strength,
      });
      // Sustained harmony may have no internal evidence: a metrical breath is
      // explicit and subordinate, never disguised as a detected cadence.
      if (!ranked.length) ranked.push({ tick: Math.min(maximum, start + Math.round(target / frame.barTicks) * frame.barTicks), evidence: ['metrical breath; no internal structural evidence'], cost: 0 });
      ranked.sort((a, b) => a.cost - b.cost || a.tick - b.tick);
      const chosen = ranked[0];
      if (chosen.tick <= start) break;
      out.push({ startTick: start, endTick: chosen.tick, energy: window.energy ?? 0.5, evidence: chosen.evidence });
      start = chosen.tick;
    }
  }
  return out;
}

function journeyFor(theme: Theme, duration: number, bar: number, identity: StringsIdentity, index: number): Journey {
  const candidates: Journey[] = ['continuous', 'dialogue', 'sequence', 'reconstruction', 'lyrical', 'delayed-arrival'];
  const rhythm = theme.identity.rhythm;
  const active = rhythm.filter((n) => n <= 0.5).length / rhythm.length;
  const leaping = Math.abs(theme.identity.leap.steps) >= 3;
  const suitability: Record<Journey, number> = {
    continuous: 0.8, dialogue: index % 2 ? 1.4 : 0.8,
    sequence: leaping ? 1.3 : 0.8, reconstruction: active > 0.2 || leaping ? 1.25 : 0.7,
    lyrical: active < 0.3 ? 1.4 : 0.6, 'delayed-arrival': duration >= 4 * bar ? 0.9 + identity.intent.patience : 0.2,
  };
  // Weighted preference races select intentions, not note patterns. All notes
  // are subsequently composed and harmony-checked; suitability is contextual.
  return candidates.map((name) => ({ name, score: -Math.log(Math.max(1e-9, identityDraw(identity.streams.development, `journey:${index}:${name}`))) / suitability[name] }))
    .sort((a, b) => a.score - b.score)[0].name;
}

function unitsFor(journey: Journey, room: number, theme: Theme, frame: TonalFrame, index: number): Unit[] {
  const bar = frame.barTicks;
  const whole = theme.lengthTicks;
  const units: Unit[] = [];
  const push = (operation: Operation, ticks: number, kind: SegmentKind, shift: number) => {
    if (ticks <= room && ticks >= frame.beatTicks) { units.push({ operation, ticks, kind, shift }); room -= ticks; return true; }
    return false;
  };
  if (journey === 'lyrical') push('augmentation', Math.min(whole * 2, Math.floor(room / bar) * bar), 'statement', 0);
  else if (journey === 'reconstruction') { push('fragment', bar, 'development', 0); if (room >= whole + bar) push('inversion', bar, 'development', -1); push('reconstruction', whole, 'statement', 0); }
  else if (journey === 'delayed-arrival') { push('tail', bar, 'approach', -2); push('statement', whole, 'statement', 0); }
  else if (journey === 'sequence') push('head', bar, 'development', 0);
  else if (journey === 'dialogue' && index % 2) { push('inversion', bar, 'development', -1); push('tail', bar, 'approach', -2); }
  else push('statement', whole, 'statement', 0);
  let count = 0;
  while (room >= frame.beatTicks) {
    const size = Math.min(bar, room);
    const operation: Operation = journey === 'sequence' ? 'head' : journey === 'continuous' ? (count % 2 ? 'tail' : 'inversion')
      : journey === 'lyrical' ? 'tail' : journey === 'reconstruction' ? 'fragment' : count % 2 ? 'tail' : 'head';
    const shift = journey === 'sequence' ? (count + 1) * (index % 2 ? -1 : 1) : journey === 'lyrical' ? -count : count % 2 ? -1 : 1;
    if (!push(operation, size, 'development', Math.max(-5, Math.min(5, shift)))) break;
    count++;
  }
  return units;
}

function fit(frame: TonalFrame, theme: Theme, material: readonly LineNote[], tick: number, shift: number, before: readonly LineNote[]): Adaptation | null {
  const headCount = Math.min(material.length, theme.headCount);
  const leapIndex = material.slice(1, headCount).findIndex((n, i) => Math.abs(n.step - material[i].step) >= 3);
  const preferred = [...new Set([shift, shift + 1, shift - 1, shift + 2, shift - 2, 0, 3, -3, 4, -4, 5, -5, 7, -7])];
  const result = adaptMaterial({ frame, material, headCount, leapIndex, homeTick: null, targetTick: tick,
    shifts: preferred, before, after: [], finalStable: true,
    rank: (notes) => (notes.some((n) => n.step < -2 || n.step > 11) ? 10000 : 0) + Math.abs(notes[0].step - material[0].step - shift) * 0.8
      + (before.length ? Math.max(0, Math.abs(notes[0].step - before[before.length - 1].step) - 2) : 0),
  });
  return result.ok && result.notes.every((n) => n.step >= -2 && n.step <= 11) ? result : null;
}

export function planIdentityPhrases(input: PhraseInput, identity: StringsIdentity): PhrasePlanningResult {
  const { frame, theme, structure } = input;
  const phrases: PhrasePlan[] = [];
  const silentWindows: { startTick: number; endTick: number; reason: string }[] = [];
  const windows = divide(input, identity);
  for (const [windowIndex, window] of windows.entries()) {
    const beat = frame.beatTicks;
    const duration = window.endTick - window.startTick;
    if (duration < 2 * beat) { silentWindows.push({ ...window, reason: 'less than two beats: no uncompressed thematic gesture fits' }); continue; }
    const journey = journeyFor(theme, duration, frame.barTicks, identity, windowIndex);
    const arrivals = structure.arrivals.filter((a) => a.tick >= window.startTick + Math.min(theme.lengthTicks, duration / 2) && a.tick <= window.endTick - beat && a.tick >= window.endTick - frame.barTicks);
    const arrival = [...arrivals].sort((a, b) => b.strength - a.strength || b.tick - a.tick)[0];
    const goalTick = arrival?.tick ?? window.endTick - Math.min(2 * beat, duration / 3);
    const goalChord = chordAt(frame, goalTick);
    if (!goalChord) { silentWindows.push({ ...window, reason: 'no harmony under the proposed phrase arrival' }); continue; }
    const segments: PhraseSegment[] = [];
    const line: (LineNote & { segment: SegmentKind; breathAfter: boolean })[] = [];
    const decisions: string[] = [...window.evidence];
    let cursor = window.startTick;
    // A genuine pickup is a rest before the entry, not time stolen from the preceding section.
    const pickup = theme.notes[0].tick;
    if (pickup > 0 && duration >= theme.lengthTicks + 2 * beat) cursor += pickup;
    const units = unitsFor(journey, goalTick - cursor, theme, frame, windowIndex);
    for (const unit of units) {
      let material = materialFor(theme, unit.operation, unit.ticks, beat);
      let adapted = material ? fit(frame, theme, material.notes, cursor, unit.shift, line) : null;
      let operation: string = unit.operation;
      if (!adapted) {
        // Explicit, thematic repair: the closing gesture or head fragment, not
        // a return to the old phrase narrative or an unrelated chord-tone fill.
        for (const repair of ['tail', 'fragment', 'head'] as const) {
          material = materialFor(theme, repair, unit.ticks, beat);
          if (material) adapted = fit(frame, theme, material.notes, cursor, unit.shift, line);
          if (adapted) { operation = `${unit.operation} → ${repair} (harmonic repair)`; break; }
        }
      }
      if (!adapted) { decisions.push(`unavailable ${unit.operation} at ${cursor}: no safe thematic adaptation; intentional gap`); cursor += unit.ticks; continue; }
      const startTick = adapted.notes[0].tick;
      const endTick = adapted.notes[adapted.notes.length - 1].tick + adapted.notes[adapted.notes.length - 1].duration;
      // Report the realized rhythmic operation, not an unfulfilled request.
      if (operation === 'augmentation' && material!.rhythmScale <= 1) operation = material!.rhythmScale < 1 ? 'diminution' : 'statement';
      else if (operation === 'statement' && material!.rhythmScale < 1) operation = 'diminution';
      const kind = operation.includes('repair') ? 'approach' : unit.kind;
      segments.push({ kind, startTick, endTick, noteCount: adapted.notes.length,
        adaptation: adapted, operation, description: `${operation}, rhythm ×${material!.rhythmScale}, ${adapted.strategy}, shift ${adapted.shift}`,
        rhythmScale: material!.rhythmScale,
        thematicHeadTicks: Math.max(0, Math.round(material!.headTicks)),
      });
      adapted.notes.forEach((n, i) => line.push({ ...n, segment: kind, breathAfter: i === adapted!.notes.length - 1 }));
      cursor += unit.ticks;
    }
    if (!line.length) { silentWindows.push({ startTick: window.startTick, endTick: window.endTick, reason: decisions.join('; ') + '; no safe thematic unit' }); continue; }
    const previous = line[line.length - 1];
    const stable: LineNote[] = [];
    for (let step = -2; step <= 11; step++) for (const alter of [0, -1, 1]) {
      const note = { tick: goalTick, duration: Math.min(2 * beat, window.endTick - goalTick), step, alter };
      if (!goalChord.fact.pitchClasses.includes(pitchClassOf(frame, note))) continue;
      if (!judgeLine(frame, [...line, note], { finalStable: true }).ok) continue;
      stable.push(note);
    }
    stable.sort((a, b) => {
      const cost = (n: LineNote) => Math.abs(n.step - previous.step) + (goalChord.reading.isTonicRoot && pitchClassOf(frame, n) !== frame.key ? 2 : 0) + Math.abs(n.alter) * 0.5;
      return cost(a) - cost(b);
    });
    const ending = stable[0];
    if (ending) {
      // An arrival may not be held across an incompatible next chord.
      let until = ending.tick + ending.duration;
      for (const c of frame.harmony.chords) if (c.fact.startTick > ending.tick && c.fact.startTick < until && !c.fact.pitchClasses.includes(pitchClassOf(frame, ending))) until = c.fact.startTick;
      const note = { ...ending, duration: until - ending.tick };
      line.push({ ...note, segment: 'ending', breathAfter: true });
      segments.push({ kind: 'ending', startTick: note.tick, endTick: until, noteCount: 1, adaptation: null, operation: 'arrival', description: arrival ? `${arrival.kind}: ${arrival.rule}` : 'nearest safe harmonic release' });
    } else decisions.push('no safe added arrival: thematic tail itself closes the phrase');
    const whole = judgeLine(frame, line, { finalStable: true });
    if (!whole.ok) { silentWindows.push({ startTick: window.startTick, endTick: window.endTick, reason: `joined phrase rejected: ${whole.problems.map((p) => p.text).join('; ')}` }); continue; }
    const climaxNote = line.reduce((best, n) => n.step > best.step ? n : best, line[0]);
    const endTick = line[line.length - 1].tick + line[line.length - 1].duration;
    const startTick = line[0].tick;
    const last = line[line.length - 1];
    const closed = !!ending && goalChord.reading.isTonicRoot && pitchClassOf(frame, ending) === mod(frame.key, 12);
    const effectiveJourney = journey === 'reconstruction' && !segments.some((s) => s.operation === 'reconstruction') ? 'fragment-response'
      : journey === 'delayed-arrival' && !segments.some((s) => s.kind === 'statement') ? 'tail-led-connection' : journey;
    phrases.push({ index: phrases.length, window: { startTick: window.startTick, endTick: window.endTick },
      lifted: window.energy > (windows[0]?.energy ?? 0) + 0.1, startTick, endTick,
      development: { strategy: effectiveJourney, relationship: windowIndex === 0 ? 'introduction' : journey === 'dialogue' ? 'answer to the previous phrase' : 'development of the remembered theme', evidence: decisions },
      goal: { tick: ending?.tick ?? last.tick, chord: goalChord.fact.symbol, evidence: arrival?.rule ?? 'safe release inside the available window', ending: closed ? 'closed' : 'open' },
      climax: { tick: climaxNote.tick, step: climaxNote.step }, segments,
      notes: line.map((n, i) => ({ ...n, function: whole.functions[i], intensity: n.tick <= climaxNote.tick
        ? 0.45 + 0.55 * (n.tick - startTick) / Math.max(beat, climaxNote.tick - startTick)
        : 1 - 0.7 * (n.tick - climaxNote.tick) / Math.max(beat, last.tick - climaxNote.tick) })),
      landmarks: [{ tick: startTick, label: `${journey}: phrase begins` }, ...segments.map((s) => ({ tick: s.startTick, label: s.description })), { tick: climaxNote.tick, label: 'high point' }, { tick: endTick, label: 'phrase ends' }],
      breathTicks: window.endTick - endTick,
    });
  }
  return { phrases, silentWindows };
}
