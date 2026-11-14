/** Stage 2 first slice: ONE dialogue score, not four independent generators.
 * Only called across the Stage 1 finalized-context boundary. A small idea is
 * passed between players; density and source occupancy decide its placement.
 * This is deliberately a listening-gate vocabulary, not a thematic engine.
 */
import { PPQ, isInstrumentTrack, type Note } from '../../shared/schema/types';
import { scalePitchClasses } from '../../shared/schema/modes';
import { barTicks, beatTicks } from '../../shared/schema/meter';
import { ticksToMs, msToTicks } from '../spine';
import { chordTones } from '../voicing/chordTones';
import { leadingTonePcOf } from '../voicing/voiceLead';
import type { OrchestratorContext } from '../module';
import type { WindPlan } from './plan';
import { WIND_PARTS, WIND_PROFILES, windTrackOf, type WindPart } from './profile';
import { windStream, type WindIdentity } from './identity';

export type PhraseDuty = 'statement' | 'answer' | 'continuation' | 'support' | 'arrival';
export interface WindPhrase {
  id: string;
  bar: number;
  part: WindPart;
  duty: PhraseDuty;
  idea: string;
  relatedTo: string | null;
  transformation: 'original' | 'inverted-answer' | 'extended-ending' | 'rhythmic-support' | 'cadential-ending';
  reason: string;
  notes: Note[];
}
export interface WindEnsembleScore {
  version: 'dialogue-slice-1';
  phrases: WindPhrase[];
  /** Allocated before writing, also for reserved source gestures. */
  windows: { part: WindPart; bar: number; startTick: number; endTick: number }[];
  decisions: { bar: number; foreground: string | null; reason: string; resting: WindPart[] }[];
}

const closest = (pool: number[], target: number) => pool.reduce((a, b) => Math.abs(b - target) < Math.abs(a - target) ? b : a);
const pc = (p: number) => (p % 12 + 12) % 12;

/** Write within allocated windows, before the renderer's safety validation.
 * Strong attacks/ends use current chord tones (including borrowed harmony);
 * weak movement uses the existing mode. No harmony-system replacement.
 */
export function arrangeWindEnsemble(ctx: OrchestratorContext, base: WindPlan, identity: WindIdentity): WindPlan {
  const plan: WindPlan = structuredClone(base);
  const score: WindEnsembleScore = { version: 'dialogue-slice-1', phrases: [], windows: [], decisions: [] };
  plan.ensemble = score;
  // Keep pending jobs visible when realization cannot begin. Missing harmony
  // is planned-empty, not a claim that the ensemble chose musical silence.
  if (!ctx.spans.length) {
    score.decisions = plan.bars.map((b) => ({ bar: b.bar, foreground: null, reason: 'normalized harmony unavailable; existing jobs remain pending/empty', resting: [...WIND_PARTS] }));
    return plan;
  }
  const bt = barTicks(ctx.project.timeSignature), beat = beatTicks(ctx.project.timeSignature);
  const roster = WIND_PARTS.filter((p) => windTrackOf(ctx, p));
  score.windows = plan.bars.flatMap((b) => roster.map((part) => {
    const startTick = (b.bar - 1) * bt;
    const byTime = msToTicks(ticksToMs(startTick, ctx.project.tempoMap) + WIND_PROFILES[part].phraseCapSec * 850, ctx.project.tempoMap);
    return { part, bar: b.bar, startTick, endTick: Math.floor(Math.min(b.bar * bt - beat, byTime)) };
  }));
  const scale = scalePitchClasses(ctx.project.key, ctx.project.mode), leading = leadingTonePcOf(ctx.project.key, scale);
  const phraseRng = windStream(identity, 'phrase-design', 'ensemble-idea');
  const shape = phraseRng() < 0.5 ? [0, 1, 3, 2] : [0, -1, -2, 1];
  const ideaId = `idea:${shape.join('/')}`;
  const previousPitch: Partial<Record<WindPart, number>> = {};
  const eligibleIds = new Set(roster.map((p) => windTrackOf(ctx, p)!.id));
  const external = ctx.project.tracks.filter((t) => isInstrumentTrack(t) && !eligibleIds.has(t.id));
  const soundingAt = (notes: readonly Note[], s: number, e: number) => notes.filter((n) => n.startTick < e && n.startTick + n.durationTicks > s);
  const sourceLine = (bar: number) => ctx.lines?.leads.find((l) => l.trackId === ctx.lines?.carrierByBar[bar - 1]);
  const sourceNotes = (bar: number) => soundingAt(sourceLine(bar)?.notes ?? [], (bar - 1) * bt, bar * bt);
  const protectedBar = (bar: number) => !!plan.bars[bar - 1]?.moment || plan.leads.some((l) => bar >= l.startBar && bar <= l.endBar);
  const usedAnchors = new Set<string>();
  let last: WindPhrase | null = null;
  let phraseIndex = 0;
  let sectionId: string | undefined;
  let nextDuty: 'statement' | 'answer' | 'continuation' = 'statement';

  const makePhrase = (bar: number, part: WindPart, duty: PhraseDuty, related: WindPhrase | null): WindPhrase | null => {
    const t = windTrackOf(ctx, part)!, prof = WIND_PROFILES[part];
    const norm = plan.bars[bar - 1].norm;
    const rng = windStream(identity, 'instrument-variation', `${part}:${bar}:${duty}`);
    const variant = rng() < 0.5;
    const isAnswer = duty === 'answer', isSupport = duty === 'support', arrival = duty === 'arrival';
    // At least a felt beat of air in EVERY designed bar. At slow tempi the
    // whole gesture is shortened, not truncated after generating a long line.
    const s = (bar - 1) * bt;
    const capEnd = msToTicks(ticksToMs(s, ctx.project.tempoMap) + prof.phraseCapSec * 1000 * 0.85, ctx.project.tempoMap);
    const available = Math.min(bt - beat, capEnd - s);
    if (available < beat * 0.5) return null;
    // Positions/durations are proportions of the phrase window. These four
    // compact inflections share contour but differ in weight and articulation.
    let rhythm: [number, number][];
    if (arrival) rhythm = [[0, 0.28], [0.34, 0.62]];
    else if (isSupport) rhythm = variant ? [[0.12, 0.16], [0.58, 0.25]] : [[0.32, 0.18], [0.76, 0.19]];
    else if (part === 'flutes') rhythm = variant ? [[0, 0.14], [0.18, 0.14], [0.36, 0.2], [0.6, 0.34]] : [[0, 0.25], [0.3, 0.13], [0.48, 0.13], [0.66, 0.29]];
    else if (part === 'oboes') rhythm = variant ? [[0, 0.43], [0.5, 0.13], [0.7, 0.27]] : [[0, 0.27], [0.34, 0.2], [0.61, 0.36]];
    else if (part === 'clarinets') rhythm = variant ? [[0, 0.22], [0.26, 0.22], [0.53, 0.17], [0.75, 0.22]] : [[0, 0.35], [0.4, 0.16], [0.61, 0.16], [0.81, 0.16]];
    else rhythm = variant ? [[0, 0.15], [0.32, 0.15], [0.68, 0.27]] : [[0.12, 0.18], [0.43, 0.18], [0.72, 0.23]];
    // Busy external foregrounds receive late wind responses rather than a
    // competing downbeat. Brass attack windows are avoided by design.
    const line = sourceNotes(bar);
    const busy = line.length >= 4;
    const delay = isSupport ? beat * 0.25 : (isAnswer || busy ? Math.min(beat * 0.5, (bt - available) * 0.5) : 0);
    const spanLength = Math.max(beat * 0.5, available - delay);
    const centers: Record<WindPart, number> = { flutes: 77, oboes: 71, clarinets: 73, bassoons: isSupport ? 53 : 58 };
    let lo = Math.max(t.lowestNote, prof.sweet[0], part === 'clarinets' ? 69 : 0);
    let hi = Math.min(t.highestNote, prof.sweet[1], part === 'flutes' && norm < 0.9 ? 84 : 127);
    if (part === 'oboes') hi = Math.min(hi, 81);
    if (part === 'bassoons') lo = Math.max(lo, 48); // tenor replies clear the crowded orchestral bass
    if (lo > hi) return null;
    // Register follows a bounded energy arch, not a random walk that gets
    // stuck at the top of the instrument after several returning motifs.
    let center = centers[part] + Math.round((norm - 0.55) * (part === 'bassoons' ? 3 : 6));
    const ref = related?.notes.at(-1) ?? line.at(-1);
    if (ref && previousPitch[part] === undefined) {
      const matches = Array.from({ length: hi - lo + 1 }, (_, i) => i + lo).filter((p) => pc(p) === pc(ref.pitch));
      if (matches.length) center = closest(matches, center);
    }
    // A related answer reverses the same small contour, then lands anew.
    const contour = rhythm.map((_, i) => {
      const d = shape[i % shape.length];
      return isSupport ? (i ? 2 : 0) : isAnswer ? -d : duty === 'continuation' ? d + (i === rhythm.length - 1 ? 1 : 0) : d;
    });
    const notes: Note[] = [];
    let prev = previousPitch[part] ?? center;
    const brassBar = ctx.brassPlan?.bars[bar - 1];
    const brassActive = !!brassBar && Object.values(brassBar.ordinary).some((k) => k === 'fanfare' || k === 'stab') || !!ctx.brassPlan?.leads.some((l) => bar >= l.startBar && bar <= l.endBar);
    const attacks = brassActive ? external.filter((t) => t.family === 'Brass').flatMap((t) => t.notes.filter((n) => n.startTick >= s && n.startTick < s + bt).map((n) => n.startTick)).sort((a, b) => a - b) : [];
    const grid = beat / 2; // felt-eighth onset grid; gates may be shorter
    const phraseEnd = Math.min(s + bt - beat, capEnd);
    // Allocate the complete rhythm BEFORE pitches. Shorten a note's gate to
    // its next slot, not by pushing that next slot until the cadence vanishes.
    const timing: { startTick: number; durationTicks: number; short: boolean; degree: number }[] = [];
    for (let i = 0; i < rhythm.length; i++) {
      let startTick = Math.round((s + delay + rhythm[i][0] * spanLength) / grid) * grid;
      startTick = Math.max(startTick, (timing.at(-1)?.startTick ?? -Infinity) + grid);
      for (const onset of attacks) if (startTick >= onset && startTick < onset + PPQ / 2) startTick = Math.ceil((onset + PPQ / 2) / grid) * grid;
      if (startTick + beat * 0.12 > phraseEnd) continue;
      const short = part === 'bassoons' || isSupport || (part === 'clarinets' && variant && norm > 0.72 && i % 2 === 0);
      const durationTicks = Math.min(Math.round(rhythm[i][1] * spanLength), short ? Math.round(beat * 0.65) : Infinity);
      timing.push({ startTick, durationTicks, short, degree: contour[i] });
    }
    for (let i = 0; i < timing.length; i++) {
      const { startTick, short, degree } = timing[i];
      let durationTicks = Math.max(1, Math.min(timing[i].durationTicks, Math.round(phraseEnd - startTick), (timing[i + 1]?.startTick ?? Infinity) - startTick - Math.round(beat * 0.04)));
      const sp = ctx.spans.find((sp) => sp.startTick <= startTick && startTick < sp.endTick);
      if (!sp) continue;
      const tones = new Set(chordTones(sp.parsed).tones.map((t) => t.pc));
      const strong = i === 0 || i === timing.length - 1 || arrival || isSupport;
      const pcs = strong ? tones : new Set([...scale, ...tones]);
      durationTicks = Math.min(durationTicks, sp.endTick - startTick);
      const pool = Array.from({ length: hi - lo + 1 }, (_, j) => lo + j).filter((p) => {
        if (!pcs.has(pc(p)) || pc(p) === leading || Math.abs(p - prev) > 7) return false;
        if (part === 'bassoons' && external.some((t) => soundingAt(t.notes, startTick, startTick + durationTicks).some((n) => Math.min(n.pitch, p) < 48 && Math.abs(n.pitch - p) < 7 && pc(n.pitch) !== pc(p)))) return false;
        // Keep simultaneous wind lines apart: support never occupies the
        // current foreground's register slot at the same time.
        return !score.phrases.filter((ph) => ph.bar === bar).some((ph) => soundingAt(ph.notes, startTick, startTick + durationTicks).some((n) => Math.abs(n.pitch - p) < 3));
      });
      if (!pool.length) continue;
      const target = center + degree * 2 + (norm >= 0.9 && part === 'flutes' && i === 2 ? 3 : 0);
      const pitch = pool.reduce((a, b) => {
        const cost = (p: number) => Math.abs(p - target) + 0.35 * Math.abs(p - prev);
        return cost(b) < cost(a) ? b : a;
      });
      // Existing UVI sustain/staccato vocabulary only. Flute above its soft
      // ceiling uses an existing hard attack, never an unsupported new art.
      const articulation: Note['articulation'] = short ? 'staccato' : prof.softCeiling !== null && pitch > prof.softCeiling ? 'marcato' : 'legato';
      notes.push({ pitch, startTick, durationTicks, velocity: 64, articulation });
      prev = pitch;
    }
    if (!notes.length) return null;
    previousPitch[part] = prev;
    return { id: `phrase:${bar}:${part}`, bar, part, duty, idea: ideaId, relatedTo: related?.id ?? null,
      transformation: arrival ? 'cadential-ending' : isSupport ? 'rhythmic-support' : isAnswer ? 'inverted-answer' : duty === 'continuation' ? 'extended-ending' : 'original',
      reason: `${duty}; ${line.length ? 'responds around finalized foreground' : 'wind foreground in final carrier space'}; ${part === 'bassoons' ? 'independent tenor/offbeat gesture' : 'shared contour, instrument-specific pacing'}; final felt beat reserved for air`, notes };
  };

  for (const pb of plan.bars) {
    const sec = ctx.sections.find((s) => pb.bar >= s.startBar && pb.bar < s.startBar + s.lengthBars);
    if (sectionId !== sec?.id) { sectionId = sec?.id; nextDuty = 'statement'; last = null; }
    const s = (pb.bar - 1) * bt;
    if (protectedBar(pb.bar)) {
      score.decisions.push({ bar: pb.bar, foreground: 'early-reserved gesture', reason: 'preserve conductor moment/lead contract; no competing dialogue', resting: roster.filter((p) => !pb.voices[p]) });
      nextDuty = 'statement'; last = null; continue;
    }
    const original = { ...pb.voices };
    pb.voices = {}; pb.ordinary = {};
    const rest = (reason: string) => score.decisions.push({ bar: pb.bar, foreground: null, reason, resting: [...roster] });
    if (pb.bar === 1 || pb.level === 'off' || ctx.arc?.[pb.bar - 1]?.nearSilence || !ctx.spans.some((sp) => sp.startTick < s + bt && sp.endTick > s)) {
      rest('opening/energy breath or unavailable normalized harmony; no forced entrance'); nextDuty = 'statement'; last = null; continue;
    }
    // Retain a selective source connection, not an all-piece doubling rule.
    // One real source double and counter per section are enough to establish
    // the relationship; subsequent bars develop our shared wind idea.
    const anchor = roster.find((p) => {
      const k = original[p], key = `${sec?.id}:${k}`;
      return !usedAnchors.has(key) && (k === 'leadDouble' && sourceNotes(pb.bar).length > 0 || k === 'counter' && soundingAt(ctx.lines?.counter?.notes ?? [], s, s + bt).length > 0);
    });
    if (anchor && nextDuty === 'statement') {
      const k = original[anchor]!; usedAnchors.add(`${sec?.id}:${k}`);
      pb.voices[anchor] = k; pb.ordinary[anchor] = k;
      score.decisions.push({ bar: pb.bar, foreground: sourceLine(pb.bar)?.trackId ?? 'final counter source', reason: `selective ${anchor} ${k} establishes source relationship; other winds leave space`, resting: roster.filter((p) => p !== anchor) });
      continue;
    }
    if (!roster.length) { rest('no writable wind players'); continue; }
    const casting = windStream(identity, 'casting', `dialogue:${sec?.id}:${pb.bar}`);
    const cadence = !!sec && pb.bar === sec.startBar + sec.lengthBars - 1;
    // Answers move to a different player; continuations sometimes remain.
    let choices = roster.filter((p) => nextDuty === 'continuation' || p !== last?.part);
    if (!choices.length) choices = roster;
    // Bassoon may take a tenor reply, but does not monopolize the foreground.
    const weights = choices.map((p) => p === 'bassoons' ? nextDuty === 'answer' ? 0.8 : 0.25 : p === 'oboes' && pb.norm < 0.72 ? 1.5 : 1);
    let draw = casting() * weights.reduce((a, b) => a + b, 0), selected = choices[0];
    for (let i = 0; i < choices.length; i++) { draw -= weights[i]; if (draw < 0) { selected = choices[i]; break; } }
    const duty = cadence ? 'arrival' : nextDuty;
    const phrase = makePhrase(pb.bar, selected, duty, last);
    if (!phrase) { rest('no legal phrase window/register; preserve air rather than force notes'); continue; }
    score.phrases.push(phrase); pb.voices[selected] = 'phrase'; pb.ordinary[selected] = 'phrase';
    // A second player fills late space while the first takes air. No more
    // than two designed voices, and low energy remains a single line.
    if (pb.norm >= 0.5 && !cadence) {
      const support = roster.includes('bassoons') && selected !== 'bassoons' ? 'bassoons' : roster.find((p) => p === 'clarinets' && p !== selected);
      if (support && (phraseIndex % 3 !== 1 || pb.norm >= 0.72)) {
        const supporting = makePhrase(pb.bar, support, 'support', phrase);
        if (supporting) { score.phrases.push(supporting); pb.voices[support] = 'phrase'; pb.ordinary[support] = 'phrase'; }
      }
    }
    score.decisions.push({ bar: pb.bar, foreground: phrase.id, reason: phrase.reason, resting: roster.filter((p) => !pb.voices[p]) });
    last = phrase; phraseIndex++;
    nextDuty = nextDuty === 'statement' ? 'answer' : nextDuty === 'answer' && casting() < 0.4 ? 'continuation' : 'statement';
  }
  // Legacy pickup replacement must not erase a planned conversation.
  plan.pickupRuns = plan.pickupRuns.filter((r) => !score.phrases.some((p) => p.bar === r.bar || p.bar === r.downbeatBar));
  plan.reports.push(`winds dialogue slice: ${score.phrases.length} phrase contributions; explicit source anchors, transformed answers, tenor support and air`);
  return plan;
}
