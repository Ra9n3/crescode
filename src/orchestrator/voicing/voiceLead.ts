/**
 * Global voice-leading (spec §7.3, work-order step 2c). A dynamic-programming
 * search over the WHOLE chord list — every chord's voicing is chosen with
 * full knowledge of what came before. The raw state space (candidates^voices,
 * chained across chords) is far past a billion transitions, so the DP runs
 * beam-pruned (Viterbi with a bounded frontier): global rather than greedy,
 * instant to run. The pruning is noted as a deviation in PHASE2_REPORT.md.
 *
 * Hard constraints (a state that breaks one is never generated):
 *   - every pitch inside its voice's hard range (INSTRUMENTS);
 *   - no crossing (voices are enumerated low → high, non-decreasing);
 *   - the lowest voice sings the bass pitch class (slash bass or root);
 *   - no doubled leading tone where the mode has one (derived rule);
 *   - no octave doubling when the template forbids it (climaxOnly counts as
 *     forbidding while pads cannot reach a climax);
 *   - low-interval limit below C3: two simultaneous notes both under 48 sit
 *     only at unisons/octaves (0 mod 12) or fifths (7 mod 12);
 *   - nothing inside the vocal zone when the preset demands it.
 * Fewer voices than chord tones: the tone set is pre-trimmed by keep-priority
 * (bass → third → seventh → fifth → extensions) — see chordTones.ts.
 *
 * Soft costs: motion distance with a common-tone reward (Δ=0 ties across
 * boundaries), parallel 5ths/8ves among independent voices (off in symmetric
 * modes), leaps over a 5th in upper voices, spacing (normal: adjacent upper
 * voices within an octave; open-spacing mode: gaps of an octave or more),
 * pitch-class priority, and a seeded micro-jitter that breaks cost ties
 * differently per take — takes genuinely differ while (inputs, take) stays
 * byte-deterministic.
 */
import type { ChordTones } from './chordTones';
import { keepTones } from './chordTones';

export interface VoiceSpec {
  trackId: string;
  role: string;
  low: number;
  high: number;
  comfortable: [number, number];
  isBass: boolean;
}

export interface VoicingChord {
  id: string;
  startTick: number;
  endTick: number;
  ct: ChordTones;
}

export interface VoicingOptions {
  forbidOctaveDoubling: boolean;
  /** Pitch class of the leading tone, or null when the mode has none. */
  leadingTonePc: number | null;
  checkParallels: boolean;
  openSpacing: boolean;
  /** Sounding zone kept free of notes (Vocal Backing), or null. */
  zoneFree: readonly [number, number] | null;
  /** Deterministic per-take stream for the tie-break jitter and register lean. */
  rng: () => number;
}

export interface VoicedChord {
  id: string;
  startTick: number;
  endTick: number;
  /** One pitch per voice (voices ordered low → high); null = the voice rests. */
  pitches: (number | null)[];
}

const MAX_CANDIDATES_PER_VOICE = 8;
const BEAM_WIDTH = 320;
const C3 = 48;
/** Per-take cost jitter: large enough to flip near-ties between takes, well
 *  below the structural costs (motion ≥ 1, parallels 8). */
const TAKE_JITTER = 2.0;
const CANDIDATE_JITTER = 0.5;
/**
 * D11 take variety: the backtrack does not walk the single optimal path — it
 * SAMPLES, seeded by the take's stream, among the top-K near-optimal choices
 * at every chord (the best entry within COST_MARGIN of it, capped at K;
 * backwards through the P best parents each entry kept). Hard constraints
 * are never traded: every sampled state is a feasibility-checked static.
 * Same take → same draws → byte-identical; a new take re-samples.
 */
export const VOICING_TOP_K = 8;
export const VOICING_COST_MARGIN = 5.0;
const PARENT_TOP_P = 8;

interface Candidate { pitch: number; staticCost: number }

function outsideComfy(pitch: number, v: VoiceSpec, lean: number): number {
  const lo = Math.max(v.low, Math.min(v.high, v.comfortable[0] + lean));
  const hi = Math.max(v.low, Math.min(v.high, v.comfortable[1] + lean));
  return pitch < lo ? lo - pitch : pitch > hi ? hi - pitch : 0;
}

function voiceCandidates(v: VoiceSpec, allowedPcs: number[], bassPc: number, opts: VoicingOptions, lean: number, mustDouble: boolean): Candidate[] {
  // When voices outnumber distinct tones, doubling is unavoidable — restrict
  // it to the BASS pitch class (classic root doubling) instead of resting.
  const pcs = v.isBass ? [bassPc] : [...new Set(mustDouble ? [bassPc, ...allowedPcs] : allowedPcs)];
  const zone = opts.zoneFree;
  const rankOf = new Map(allowedPcs.map((pc, i) => [pc, i]));
  // Cap per PITCH CLASS, not globally: a global cap lets one pc crowd the
  // others out (3 A's beat 1 E on cost) and can leave a no-doubling chord
  // with no feasible tuple at all. Two octaves per pc keep every tone
  // reachable while bounding the tuple space.
  const perPc = Math.max(2, Math.ceil(MAX_CANDIDATES_PER_VOICE / pcs.length));
  const byPc = new Map<number, Candidate[]>();
  for (let p = v.low; p <= v.high; p++) {
    if (zone && p >= zone[0] && p <= zone[1]) continue;
    if (!pcs.includes(p % 12)) continue;
    const rank = v.isBass ? 0 : (rankOf.get(p % 12) ?? 0);
    const cand: Candidate = { pitch: p, staticCost: outsideComfy(p, v, lean) * 0.8 + rank * 0.4 + opts.rng() * CANDIDATE_JITTER };
    const list = byPc.get(p % 12) ?? [];
    list.push(cand);
    byPc.set(p % 12, list);
  }
  const out: Candidate[] = [];
  for (const list of byPc.values()) {
    list.sort((a, b) => a.staticCost - b.staticCost || a.pitch - b.pitch);
    out.push(...list.slice(0, perPc));
  }
  out.sort((a, b) => a.staticCost - b.staticCost || a.pitch - b.pitch);
  return out;
}

/** Hard checks on a complete tuple (nulls = resting voices, skipped).
 *  `doublePc`: the one pitch class that may sound in two voices, or null when
 *  doubling is fully forbidden. */
function tupleFeasible(pitches: (number | null)[], opts: VoicingOptions, doublePc: number | null): boolean {
  const placed: number[] = [];
  for (const p of pitches) if (p !== null) placed.push(p);
  if (opts.leadingTonePc !== null && placed.filter((p) => p % 12 === opts.leadingTonePc).length > 1) return false;
  if (opts.forbidOctaveDoubling && doublePc === null) {
    const seen = new Set<number>();
    for (const p of placed) {
      if (seen.has(p % 12)) return false;
      seen.add(p % 12);
    }
  } else if (opts.forbidOctaveDoubling && doublePc !== null) {
    const seen = new Set<number>();
    for (const p of placed) {
      if (seen.has(p % 12) && p % 12 !== doublePc) return false;
      seen.add(p % 12);
    }
    if (placed.filter((p) => p % 12 === doublePc).length > 2) return false;
  }
  for (let i = 0; i < placed.length; i++) {
    if (placed[i] >= C3) continue;
    for (let j = 0; j < i; j++) {
      if (placed[j] >= C3) continue;
      const d = (placed[i] - placed[j]) % 12;
      if (d !== 0 && d !== 7) return false;
    }
  }
  return true;
}

/** Static (within-chord) spacing cost between adjacent sounding voices. */
function spacingCost(placed: number[], opts: VoicingOptions): number {
  let cost = 0;
  for (let i = 1; i < placed.length; i++) {
    const gap = placed[i] - placed[i - 1];
    if (opts.openSpacing) {
      if (gap < 12) cost += (12 - gap) * 0.5; // prefer open gaps
    } else if (i > 1 && gap > 12) {
      cost += 2; // adjacent upper voices within an octave
    }
  }
  return cost;
}

function transitionCost(prev: (number | null)[], next: (number | null)[], opts: VoicingOptions): number {
  let cost = 0;
  let moved = 0;
  for (let i = 0; i < next.length; i++) {
    const a = prev[i], b = next[i];
    if (a === null || b === null) continue;
    const d = Math.abs(b - a);
    if (d === 0) { cost -= 1.2; continue; } // common tone: tied across the boundary
    cost += d;
    moved++;
    if (i > 0 && d > 7) cost += (d - 7) * 1.5; // leaps in upper voices
  }
  if (opts.checkParallels && moved >= 2) {
    for (let i = 0; i < next.length; i++) {
      const a0 = prev[i], b0 = next[i];
      if (a0 === null || b0 === null) continue;
      for (let j = i + 1; j < next.length; j++) {
        const a1 = prev[j], b1 = next[j];
        if (a1 === null || b1 === null) continue;
        const ivPrev = Math.abs(a0 - a1) % 12;
        const ivNext = Math.abs(b0 - b1) % 12;
        if ((ivPrev === 0 || ivPrev === 7) && ivPrev === ivNext && b0 !== a0 && b1 !== a1) {
          cost += 8; // parallel 5ths/8ves between independent voices
        }
      }
    }
  }
  return cost;
}

const cmpPitches = (a: (number | null)[], b: (number | null)[]): number => {
  const sa = a.join(','), sb = b.join(',');
  return sa < sb ? -1 : sa > sb ? 1 : 0;
};

interface BeamEntry {
  pitches: (number | null)[];
  cost: number;
  /** The P best predecessors (chord > 0): beam index + the transition cost
   *  to it. Sorted by total (prev cost + transition), best first. */
  parents: { index: number; transition: number; total: number }[];
}

/**
 * Voice-lead the chords. Voices are given low → high; one voice per track.
 * A chord no feasible state can host is carried as rests.
 */
export function voiceLead(chords: VoicingChord[], voices: VoiceSpec[], opts: VoicingOptions): VoicedChord[] {
  if (!chords.length || !voices.length) return [];
  const nVoices = voices.length;
  // Per-take register lean: a base lean (±5) per voice plus a per-chord
  // offset (±2, redrawn every chord from the same deterministic take stream)
  // — takes genuinely re-register and re-shape lines chord by chord.
  const baseLeans = voices.map(() => Math.floor((opts.rng() - 0.5) * 11));

  interface StaticState { pitches: (number | null)[]; staticCost: number }
  const beams: BeamEntry[][] = [];
  let prev: BeamEntry[] = [];

  chords.forEach((chord, ci) => {
    const kept = keepTones(chord.ct, nVoices);
    const allowedPcs = kept.map((t) => t.pc);
    if (!allowedPcs.includes(chord.ct.bassPc)) allowedPcs.unshift(chord.ct.bassPc);
    // voices outnumbering distinct tones force a minimal root (bass) doubling
    const mustDouble = new Set(allowedPcs).size < nVoices;
    const doublePc = mustDouble ? chord.ct.bassPc : null;

    // per-voice candidates; a voice with none simply rests on this chord
    const chordLeans = voices.map((_, i) => baseLeans[i] + Math.floor((opts.rng() - 0.5) * 5));
    const candLists: (Candidate[] | null)[] = voices.map((v, i) => {
      const c = voiceCandidates(v, allowedPcs, chord.ct.bassPc, opts, chordLeans[i], mustDouble);
      return c.length ? c : null;
    });

    let statics: StaticState[] = [];
    if (candLists.some((c) => c !== null)) {
      const full: (number | null)[] = new Array(nVoices).fill(null);
      const seen = new Set<string>();
      const dfs = (vi: number, minPitch: number, acc: number) => {
        if (vi === nVoices) {
          const key = full.join(',');
          if (seen.has(key) || !tupleFeasible(full, opts, doublePc)) return;
          seen.add(key);
          const placed = full.filter((x): x is number => x !== null);
          statics.push({
            pitches: [...full],
            staticCost: acc + spacingCost(placed, opts) + (opts.rng() - 0.5) * TAKE_JITTER,
          });
          return;
        }
        const cands = candLists[vi];
        if (!cands) { dfs(vi + 1, minPitch, acc); return; }
        for (const c of cands) {
          if (c.pitch < minPitch) continue; // no crossing
          full[vi] = c.pitch;
          dfs(vi + 1, c.pitch, acc + c.staticCost);
          full[vi] = null;
        }
      };
      dfs(0, -1, 0);

      statics.sort((a, b) => a.staticCost - b.staticCost || cmpPitches(a.pitches, b.pitches));
      statics = statics.slice(0, BEAM_WIDTH);
    }

    let entries: BeamEntry[];
    if (ci === 0) {
      entries = statics.map((s) => ({ pitches: s.pitches, cost: s.staticCost, parents: [] }));
      if (!entries.length) entries = [{ pitches: new Array(nVoices).fill(null), cost: 0, parents: [] }];
    } else {
      entries = [];
      for (const s of statics) {
        // keep the P best parents (no big intermediate arrays)
        const top: BeamEntry['parents'] = [];
        for (let pi = 0; pi < prev.length; pi++) {
          const transition = transitionCost(prev[pi].pitches, s.pitches, opts);
          const total = prev[pi].cost + transition;
          if (top.length < PARENT_TOP_P) {
            top.push({ index: pi, transition, total });
            top.sort((a, b) => a.total - b.total);
          } else if (total < top[top.length - 1].total) {
            top[top.length - 1] = { index: pi, transition, total };
            top.sort((a, b) => a.total - b.total);
          }
        }
        if (top.length) entries.push({ pitches: s.pitches, cost: top[0].total + s.staticCost, parents: top });
      }
      entries.sort((a, b) => a.cost - b.cost || cmpPitches(a.pitches, b.pitches));
      entries = entries.slice(0, BEAM_WIDTH);
      if (!entries.length) {
        entries = prev.map((p, i) => ({ pitches: p.pitches.map(() => null), cost: p.cost + 1e6, parents: [{ index: i, transition: 0, total: p.cost }] }));
      }
    }

    beams.push(entries);
    prev = entries;
  });

  // D11 stochastic backtrack: sample the ending among near-optimal entries,
  // then walk back sampling among each entry's near-optimal parents.
  const out: VoicedChord[] = new Array(chords.length);
  let childIdx = -1;
  for (let ci = chords.length - 1; ci >= 0; ci--) {
    const beam = beams[ci];
    let idx: number;
    if (childIdx < 0) {
      const best = beam[0].cost; // entries sorted by cost
      const pool = beam.map((e, i) => ({ i, cost: e.cost })).filter(({ cost }) => cost <= best + VOICING_COST_MARGIN).slice(0, VOICING_TOP_K);
      idx = pool.length ? pool[Math.floor(opts.rng() * pool.length)].i : 0;
    } else {
      const parents = beams[ci + 1][childIdx].parents;
      if (parents.length) {
        const pool = parents.filter((p) => p.total <= parents[0].total + VOICING_COST_MARGIN).slice(0, VOICING_TOP_K);
        idx = pool[Math.floor(opts.rng() * pool.length)].index;
      } else {
        idx = 0; // the all-rests fallback of a first chord with no feasible state
      }
    }
    const e = beam[idx];
    out[ci] = { id: chords[ci].id, startTick: chords[ci].startTick, endTick: chords[ci].endTick, pitches: [...e.pitches] };
    childIdx = idx;
  }
  return out;
}

/** The derived leading-tone rule: semitone below the tonic, when the mode's scale holds it. */
export function leadingTonePcOf(key: number, scalePcs: number[]): number | null {
  const lt = ((key % 12) + 11) % 12;
  return scalePcs.includes(lt) ? lt : null;
}
