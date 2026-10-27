/**
 * Scorch generation engine — a generic interpreter of the rules config.
 * Contains no musical decisions; it only expands what the rules describe
 * and enforces engineering invariants (determinism, ranges, no overlaps,
 * no zero-length notes, nothing past the project end, locked tracks untouched).
 */
import { parseChord, type ParsedChord } from '../shared/schema/chords';
import { barTicks, beatOffsets, beatTicks, isCompound, projectBars, pulseTicks } from '../shared/schema/meter';
import { scalePitchClasses } from '../shared/schema/modes';
import { PPQ, isInstrumentTrack, type Note, type Project, type Track } from '../shared/schema/types';
import { defaultRules } from '../config/generation-rules';
import type {
  GenerationContext, GenerationRules, MeterInfo, PartContext, PartRule, PitchSpec, ResolvedChord,
  ResolvedSection, RhythmSpec, RhythmUnit, SectionRules,
} from './rules-schema';

export interface GenerateOptions {
  seed: number;
  density?: number;
  humanize?: boolean;
  lockedTrackIds?: string[];
  /** Override the rules config (used by tests); defaults to src/config/generation-rules.ts. */
  rules?: GenerationRules;
}

/* ---------------- PRNG (seedable, never Math.random) ---------------- */
export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rngFor = (...parts: (string | number)[]) => mulberry32(hashString(parts.join('|')));

/* ---------------- Context ---------------- */
export function buildMeter(p: Project): MeterInfo {
  const ts = p.timeSignature;
  return {
    numerator: ts.numerator, denominator: ts.denominator,
    barTicks: barTicks(ts), beatTicks: beatTicks(ts), pulseTicks: pulseTicks(ts),
    beatOffsets: beatOffsets(ts), compound: isCompound(ts),
  };
}

function fallbackChord(p: Project): ParsedChord {
  const scale = scalePitchClasses(p.key, p.mode);
  const pcs = [scale[0], scale[2 % scale.length], scale[4 % scale.length]];
  return {
    symbol: '(tonic)', root: p.key, rootName: '', quality: 'scale', extensions: [], bass: null, bassName: null,
    intervals: pcs.map((pc) => (pc - p.key + 12) % 12), pitchClasses: [...new Set(pcs)],
  };
}

export function buildContext(p: Project, opts: Required<Omit<GenerateOptions, 'rules'>>, locked: Track[], rules: GenerationRules): GenerationContext {
  const meter = buildMeter(p);
  const bars = projectBars(p);
  const endTick = bars * meter.barTicks;
  const chords: ResolvedChord[] = [...p.chords]
    .sort((a, b) => a.startTick - b.startTick)
    .flatMap((c) => {
      const r = parseChord(c.symbol);
      return r.ok ? [{ id: c.id, symbol: c.symbol, startTick: c.startTick, endTick: c.startTick + c.durationTicks, parsed: r.chord }] : [];
    });
  const tonic: ResolvedChord = { id: '__tonic', symbol: '(tonic)', startTick: 0, endTick, parsed: fallbackChord(p) };
  const chordAt = (tick: number): ResolvedChord => {
    let best: ResolvedChord | null = null;
    for (const c of chords) {
      if (c.startTick <= tick) { if (tick < c.endTick) return c; best = c; } else break;
    }
    return best ?? chords[0] ?? tonic;
  };

  const srcSections = p.sections.length
    ? [...p.sections].sort((a, b) => a.startBar - b.startBar)
    : [{ id: '__all', name: '*', startBar: 1, lengthBars: bars }];
  const occ: Record<string, number> = {};
  const sections: ResolvedSection[] = srcSections.map((s, index) => {
    const ruleKey = resolveRuleKey(rules, s.name);
    const k = s.name.trim().toLowerCase();
    occ[k] = (occ[k] ?? 0) + 1;
    const startTick = (s.startBar - 1) * meter.barTicks;
    return {
      id: s.id, name: s.name, ruleKey, index, occurrence: occ[k], startBar: s.startBar, lengthBars: s.lengthBars,
      startTick, endTick: Math.min(endTick, startTick + s.lengthBars * meter.barTicks),
    };
  });

  const byTrackId: Record<string, Note[]> = {};
  const byRole: Record<string, Note[]> = {};
  for (const t of locked) { byTrackId[t.id] = t.notes; byRole[t.role] = [...(byRole[t.role] ?? []), ...t.notes]; }

  return {
    ppq: PPQ, bpm: p.bpm, key: p.key, mode: p.mode, scalePitchClasses: scalePitchClasses(p.key, p.mode),
    meter, endTick, bars, chords, sections, chordAt, options: opts,
    lockedNotes: { byTrackId, byRole }, generatedByRole: {},
  };
}

export function resolveRuleKey(rules: GenerationRules, name: string): string {
  const keys = Object.keys(rules.sections);
  const find = (n: string) => keys.find((k) => k.toLowerCase() === n.toLowerCase());
  return find(name.trim()) ?? find(name.trim().replace(/\s*\d+$/, '')) ?? (keys.includes('*') ? '*' : '');
}

/* ---------------- Rhythm expansion ---------------- */
interface Event { start: number; len: number; accent: number; prob: number; chordStart: boolean }

function unitTicks(unit: RhythmUnit, m: MeterInfo): number {
  switch (unit) {
    case 'beat': return m.beatTicks;
    case 'quarter': return PPQ;
    case 'eighth': return PPQ / 2;
    case 'sixteenth': return PPQ / 4;
    case 'triplet8': return PPQ / 3;
    case 'pulse': return m.pulseTicks;
    case 'bar': return m.barTicks;
  }
}

function resolveRhythm(spec: RhythmSpec, rules: GenerationRules, depth = 0): Exclude<RhythmSpec, string> {
  if (typeof spec !== 'string') return spec;
  const r = rules.patterns[spec];
  if (!r || depth > 8) return { type: 'sustain', per: 'chord' };
  return resolveRhythm(r, rules, depth + 1);
}

function expandRhythm(spec: RhythmSpec, start: number, end: number, ctx: GenerationContext, rules: GenerationRules, barFilter?: (barStart: number) => boolean): Event[] {
  const r = resolveRhythm(spec, rules);
  const m = ctx.meter;
  const out: Event[] = [];
  const isChordStart = (t: number) => ctx.chords.some((c) => c.startTick === t) || t === start;
  const barsIn = (): number[] => {
    const res: number[] = [];
    for (let b = start; b < end; b += m.barTicks) if (!barFilter || barFilter(b)) res.push(b);
    return res;
  };
  if (r.type === 'sustain') {
    const per = r.per ?? 'chord';
    const cuts = new Set<number>([start, end]);
    if (per === 'chord' || per === 'chordOrBar') for (const c of ctx.chords) if (c.startTick > start && c.startTick < end) cuts.add(c.startTick);
    if (per === 'bar' || per === 'chordOrBar') for (let b = start; b < end; b += m.barTicks) cuts.add(b);
    if (per === 'beat') for (let b = start; b < end; b += m.barTicks) for (const o of m.beatOffsets) if (b + o < end) cuts.add(b + o);
    const pts = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i < pts.length - 1; i++) {
      const s = pts[i], e = pts[i + 1];
      const barStart = start + Math.floor((s - start) / m.barTicks) * m.barTicks;
      if (barFilter && !barFilter(barStart)) continue;
      if (e > s) out.push({ start: s, len: e - s, accent: 0, prob: 1, chordStart: isChordStart(s) });
    }
    return out;
  }
  const u = unitTicks(r.unit ?? 'beat', m);
  const cycle = r.cycle ? r.cycle * u : m.barTicks;
  const anchors: [number, number][] = r.anchor === 'section' ? [[start, end]] : barsIn().map((b) => [b, Math.min(end, b + m.barTicks)]);
  for (const [a0, a1] of anchors) {
    for (let c = a0; c < a1; c += cycle) {
      for (const st of r.steps) {
        const s = Math.round(c + st.at * u);
        if (s >= a1 || s >= c + cycle) continue;
        if (r.anchor === 'section' && barFilter && !barFilter(start + Math.floor((s - start) / m.barTicks) * m.barTicks)) continue;
        const len = Math.min(Math.round(st.len * u), a1 - s);
        if (len > 0) out.push({ start: s, len, accent: st.accent ?? 0, prob: st.prob ?? 1, chordStart: isChordStart(s) });
      }
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/* ---------------- Pitch selection ---------------- */
export function candidates(pcs: number[], lo: number, hi: number): number[] {
  const set = new Set(pcs.map((x) => ((x % 12) + 12) % 12));
  const out: number[] = [];
  for (let p = Math.max(0, lo); p <= Math.min(127, hi); p++) if (set.has(p % 12)) out.push(p);
  return out;
}

function sourcePcs(spec: PitchSpec, chord: ParsedChord, ctx: GenerationContext): number[] {
  let list: number[];
  switch (spec.source) {
    case 'chord': list = chord.pitchClasses; break;
    case 'chordUpper': list = chord.bass !== null ? chord.pitchClasses.slice(1) : chord.pitchClasses; break;
    case 'root': list = [chord.root]; break;
    case 'bass': list = [chord.bass ?? chord.root]; break;
    case 'scale': list = ctx.scalePitchClasses; break;
    default: list = [];
  }
  if (spec.degrees && spec.degrees.length) {
    const sub = spec.degrees.map((d) => list[d % Math.max(1, list.length)]).filter((x) => x !== undefined);
    if (sub.length) list = sub;
  }
  return list;
}

interface PitchState { prev: number[]; chordId: string | null; arpIdx: number; arpDir: 1 | -1 }

function nearest(cands: number[], target: number): number {
  let best = cands[0];
  for (const c of cands) if (Math.abs(c - target) < Math.abs(best - target)) best = c;
  return best;
}

function pickPitches(spec: PitchSpec, track: Track, ev: Event, chord: ResolvedChord, ctx: GenerationContext, st: PitchState, rng: () => number, lockedAt: (tick: number) => Set<number>, octaveShift: number): number[] {
  const lo = track.lowestNote, hi = track.highestNote;
  if (spec.source === 'fixed' || lo === hi) return [spec.note ?? lo];
  const reg = spec.register ?? [0.3, 0.7];
  let wLo: number, wHi: number;
  if (spec.absolute) { wLo = reg[0]; wHi = reg[1]; } else { wLo = Math.round(lo + (hi - lo) * reg[0]); wHi = Math.round(lo + (hi - lo) * reg[1]); }
  wLo = Math.max(lo, wLo + octaveShift); wHi = Math.min(hi, wHi + octaveShift);
  if (wHi < wLo) { wLo = lo; wHi = hi; }
  let pcs = sourcePcs(spec, chord.parsed, ctx);
  if (spec.source === 'scale' && spec.chordToneOnStrongBeats && ev.chordStart) pcs = chord.parsed.pitchClasses;
  let cands = candidates(pcs, wLo, wHi);
  if (!cands.length) cands = candidates(pcs, lo, hi);
  if (spec.avoidLockedUnisons) {
    const busy = lockedAt(ev.start);
    const f = cands.filter((c) => !busy.has(c));
    if (f.length) cands = f;
  }
  if (!cands.length) return [Math.round((lo + hi) / 2)];
  const voices = Math.max(1, spec.voices ?? 1);
  const motion = spec.motion ?? 'block';
  const center = (wLo + wHi) / 2;

  if (motion === 'random') return [cands[Math.floor(rng() * cands.length)]];
  if (motion.startsWith('arpeggio')) {
    if (st.chordId !== chord.id) { st.chordId = chord.id; st.arpIdx = motion === 'arpeggioDown' ? cands.length - 1 : 0; st.arpDir = motion === 'arpeggioDown' ? -1 : 1; }
    let i = st.arpIdx;
    if (i < 0 || i >= cands.length) i = motion === 'arpeggioDown' ? cands.length - 1 : 0;
    const p = cands[i];
    if (motion === 'arpeggioUpDown') {
      let n = i + st.arpDir;
      if (n >= cands.length || n < 0) { st.arpDir = st.arpDir === 1 ? -1 : 1; n = i + st.arpDir; }
      st.arpIdx = Math.max(0, Math.min(cands.length - 1, n));
    } else st.arpIdx = motion === 'arpeggioDown' ? (i - 1 + cands.length) % cands.length : (i + 1) % cands.length;
    return [p];
  }
  if (motion === 'stepwise') {
    const prev = st.prev[0] ?? nearest(cands, center);
    const leap = spec.maxLeap ?? 5;
    const near = cands.filter((c) => Math.abs(c - prev) <= leap && c !== prev);
    const pool = near.length ? near : [nearest(cands, prev)];
    const p = pool[Math.floor(rng() * pool.length)];
    st.prev = [p];
    return [p];
  }
  // block: keep voicing while the chord holds; voice-lead on change.
  if (st.chordId === chord.id && st.prev.length === voices && st.prev.every((p) => cands.includes(p))) return st.prev;
  let result: number[];
  if (st.prev.length === voices) {
    const used = new Set<number>();
    result = st.prev.map((pv) => {
      const avail = cands.filter((c) => !used.has(c));
      const n = nearest(avail.length ? avail : cands, pv);
      used.add(n);
      return n;
    });
  } else {
    const step = spec.spread === 'open' ? 2 : 1;
    const startIdx = Math.max(0, Math.min(cands.length - 1, cands.indexOf(nearest(cands, center)) - Math.floor(((voices - 1) * step) / 2)));
    result = [];
    for (let v = 0; v < voices; v++) {
      const idx = startIdx + v * step;
      if (idx < cands.length) result.push(cands[idx]);
    }
  }
  result = [...new Set(result)].sort((a, b) => a - b);
  st.prev = result; st.chordId = chord.id;
  return result;
}

/* ---------------- Sanitizer (engine invariants) ---------------- */
export function sanitizeNotes(notes: Note[], lo: number, hi: number, endTick: number): Note[] {
  const fixed: Note[] = [];
  for (const n of notes) {
    let p = Math.round(n.pitch);
    while (p < lo && p + 12 <= 127) p += 12;
    while (p > hi && p - 12 >= 0) p -= 12;
    if (p < lo || p > hi) p = Math.min(hi, Math.max(lo, p));
    const s = Math.max(0, Math.round(n.startTick));
    if (s >= endTick) continue;
    const e = Math.min(endTick, Math.round(n.startTick + n.durationTicks));
    if (e - s < 1) continue;
    fixed.push({ pitch: p, startTick: s, durationTicks: e - s, velocity: Math.max(1, Math.min(127, Math.round(n.velocity))) });
  }
  fixed.sort((a, b) => a.pitch - b.pitch || a.startTick - b.startTick || b.durationTicks - a.durationTicks);
  const out: Note[] = [];
  let last: Note | null = null;
  for (const n of fixed) {
    if (last && last.pitch === n.pitch && n.startTick < last.startTick + last.durationTicks) {
      if (n.startTick === last.startTick) continue;
      last.durationTicks = n.startTick - last.startTick;
    }
    out.push(n);
    last = n;
  }
  return out.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
}

function humanizeNotes(notes: Note[], ctx: GenerationContext, rng: () => number, rules: GenerationRules): Note[] {
  const ms = Math.min(14.5, rules.humanize?.maxTimingMs ?? 12);
  const maxTicks = Math.floor((ms / 1000) * (ctx.bpm / 60) * PPQ);
  const vd = rules.humanize?.maxVelocityDelta ?? 6;
  const bt = ctx.meter.barTicks;
  return notes.map((n) => {
    const off = Math.round((rng() * 2 - 1) * maxTicks);
    const v = Math.round((rng() * 2 - 1) * vd);
    const barStart = Math.floor(n.startTick / bt) * bt;
    const s = Math.max(barStart, Math.min(barStart + bt - 1, n.startTick + off));
    const end = Math.min(ctx.endTick, n.startTick + n.durationTicks + off);
    return { pitch: n.pitch, startTick: s, durationTicks: Math.max(1, end - s), velocity: Math.max(1, Math.min(127, n.velocity + v)) };
  });
}

/* ---------------- Main entry ---------------- */
function partMatches(part: PartRule, t: Track): boolean {
  const m = part.match;
  return !!(m.roles?.includes(t.role) || m.families?.includes(t.family) || m.trackNames?.some((n) => n.toLowerCase() === t.name.toLowerCase()));
}

export function generate(project: Project, options: GenerateOptions): Track[] {
  const rules = options.rules ?? defaultRules;
  const opts = { seed: options.seed, density: options.density ?? 1, humanize: options.humanize ?? false, lockedTrackIds: options.lockedTrackIds ?? [] };
  const isLocked = (t: Track) => t.locked || opts.lockedTrackIds.includes(t.id);
  const locked = project.tracks.filter((t) => isInstrumentTrack(t) && isLocked(t));
  const ctx = buildContext(project, opts, locked, rules);

  const lockedAt = (tick: number) => {
    const s = new Set<number>();
    for (const t of locked) for (const n of t.notes) if (n.startTick <= tick && tick < n.startTick + n.durationTicks) s.add(n.pitch);
    return s;
  };

  // doubleOf parts run after all primary parts so they can read generated notes.
  const deferred: { track: Track; section: ResolvedSection; part: PartRule; sr: SectionRules; out: Note[] }[] = [];
  const results = new Map<string, Note[]>();

  for (const track of project.tracks) {
    if (!isInstrumentTrack(track) || isLocked(track)) continue;
    const out: Note[] = [];
    results.set(track.id, out);
    for (const section of ctx.sections) {
      const sr = rules.sections[section.ruleKey];
      if (!sr) continue;
      sr.parts.forEach((part, pi) => {
        if (!partMatches(part, track)) return;
        if (part.occurrences && !part.occurrences.includes(section.occurrence)) return;
        if (part.doubleOf) { deferred.push({ track, section, part, sr, out }); return; }
        out.push(...runPart(track, section, part, pi, sr, ctx, rules, lockedAt));
      });
    }
    ctx.generatedByRole[track.role] = [...(ctx.generatedByRole[track.role] ?? []), ...out];
  }
  for (const d of deferred) {
    const src = [...(ctx.generatedByRole[d.part.doubleOf!.role] ?? []), ...(ctx.lockedNotes.byRole[d.part.doubleOf!.role] ?? [])];
    let notes = src
      .filter((n) => n.startTick >= d.section.startTick && n.startTick < d.section.endTick)
      .map((n) => ({ ...n, pitch: n.pitch + d.part.doubleOf!.interval }));
    if (d.part.transform) notes = d.part.transform(notes, makePartCtx(d.track, d.section, d.part, ctx, rngFor(opts.seed, d.track.id, d.section.index, 'dbl')));
    d.out.push(...notes);
  }

  return project.tracks.map((t) => {
    if (!isInstrumentTrack(t) || isLocked(t)) return t;
    let notes = sanitizeNotes(results.get(t.id) ?? [], t.lowestNote, t.highestNote, ctx.endTick);
    if (opts.humanize) notes = sanitizeNotes(humanizeNotes(notes, ctx, rngFor(opts.seed, t.id, 'humanize'), rules), t.lowestNote, t.highestNote, ctx.endTick);
    return { ...t, notes };
  });
}

function makePartCtx(track: Track, section: ResolvedSection, part: PartRule, ctx: GenerationContext, rng: () => number): PartContext {
  return { track, section, part, ctx, rng, candidates };
}

function runPart(track: Track, section: ResolvedSection, part: PartRule, pi: number, sr: SectionRules, ctx: GenerationContext, rules: GenerationRules, lockedAt: (t: number) => Set<number>): Note[] {
  const repeat = section.occurrence > 1;
  const v = sr.variation ?? {};
  const reseed = v.reseedPerOccurrence ?? true;
  const rng = rngFor(ctx.options.seed, track.id, section.ruleKey, reseed ? section.occurrence : 1, pi);
  const pctx = makePartCtx(track, section, part, ctx, rng);
  if (part.custom) {
    const notes = part.custom(pctx);
    return part.transform ? part.transform(notes, pctx) : notes;
  }
  const m = ctx.meter;
  const lastBar = section.startTick + (section.lengthBars - 1) * m.barTicks;
  const fill = part.fill;
  const isFillBar = (b: number) => {
    if (!fill) return false;
    if (fill.when === 'lastBarOfSection') return b === lastBar;
    if (fill.when === 'firstBarOfSection') return b === section.startTick;
    const n = Math.max(1, fill.n ?? 4);
    return ((b - section.startTick) / m.barTicks + 1) % n === 0;
  };
  const events = [
    ...expandRhythm(part.rhythm, section.startTick, section.endTick, ctx, rules, fill ? (b) => !isFillBar(b) : undefined),
    ...(fill ? expandRhythm(fill.rhythm, section.startTick, section.endTick, ctx, rules, isFillBar).map((e) => ({ ...e, accent: e.accent + (fill.velocityOffset ?? 0) })) : []),
  ].sort((a, b) => a.start - b.start);

  const density = Math.min(1, (part.density ?? 1) * (sr.density ?? 1) * ctx.options.density * (repeat ? v.densityScaleOnRepeat ?? 1 : 1));
  const [vMin, vMax] = part.velocity ?? [64, 96];
  const vScale = sr.velocityScale ?? 1;
  const vRepeat = repeat ? v.velocityOffsetOnRepeat ?? 0 : 0;
  const octave = repeat ? (v.octaveShiftOnRepeat ?? 0) * 12 : 0;
  const legato = Math.max(0.05, Math.min(1, part.articulation?.legato ?? 0.95));
  const minTicks = Math.max(1, part.articulation?.minTicks ?? 30);
  const state: PitchState = { prev: [], chordId: null, arpIdx: 0, arpDir: 1 };
  const span = Math.max(1, section.endTick - section.startTick);
  const notes: Note[] = [];

  for (const ev of events) {
    const roll = rng();
    if (roll >= ev.prob * density) continue;
    const chord = ctx.chordAt(ev.start);
    const pitches = pickPitches(part.pitch, track, ev, chord, ctx, state, rng, lockedAt, octave);
    const pos = (ev.start - section.startTick) / span;
    const curve = part.velocityCurve === 'crescendo' ? pos : part.velocityCurve === 'diminuendo' ? 1 - pos : 0.5;
    const base = part.velocityCurve && part.velocityCurve !== 'flat' ? vMin + (vMax - vMin) * curve : vMin + (vMax - vMin) * rng();
    const vel = Math.round((base + ev.accent + vRepeat) * vScale);
    const dur = Math.min(ev.len, Math.max(minTicks, Math.round(ev.len * legato)));
    for (const p of pitches) {
      notes.push({ pitch: p, startTick: ev.start, durationTicks: dur, velocity: vel });
      for (const d of part.doubling ?? []) {
        const q = p + d;
        if (q >= track.lowestNote && q <= track.highestNote) notes.push({ pitch: q, startTick: ev.start, durationTicks: dur, velocity: vel });
      }
    }
  }
  return part.transform ? part.transform(notes, pctx) : notes;
}
