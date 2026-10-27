import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/dorian-16bars.json';
import { generate, mulberry32 } from '../src/engine/generate';
import { defaultRules } from '../src/config/generation-rules';
import type { GenerationRules } from '../src/engine/rules-schema';
import {
  MODE_NAMES, barTicks, isInstrumentTrack, projectEndTick, projectFromFixture, validateProject, type Project, type Track,
} from '../src/shared/schema';

const fx = (): Project => projectFromFixture(JSON.parse(JSON.stringify(fixture)));
const SIGS = [{ numerator: 4, denominator: 4 }, { numerator: 3, denominator: 4 }, { numerator: 6, denominator: 8 }, { numerator: 5, denominator: 4 }];
const SYMS = ['C', 'Dm7', 'G7', 'Fmaj7', 'Am', 'E7/G#', 'Bm7b5', 'Bbadd9', 'Csus4', 'F#dim7', 'Ab', 'Ebmaj7/G'];
const NAMES = ['Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Bridge', 'Outro', 'Breakdown'];

function randomProject(seed: number): Project {
  const r = mulberry32(seed * 7919);
  const p = fx();
  p.mode = MODE_NAMES[seed % MODE_NAMES.length];
  p.key = (Math.floor(r() * 12)) as Project['key'];
  p.timeSignature = SIGS[seed % 4];
  p.bpm = 60 + Math.floor(r() * 120);
  p.tempoMap = [{ tick: 0, bpm: p.bpm }];
  const bt = barTicks(p.timeSignature);
  p.sections = []; p.chords = [];
  let bar = 1;
  for (let i = 0; i < 3 + Math.floor(r() * 3); i++) {
    const len = 2 + Math.floor(r() * 6);
    p.sections.push({ id: `s${i}`, name: NAMES[Math.floor(r() * NAMES.length)], startBar: bar, lengthBars: len });
    bar += len;
  }
  let t = 0;
  const end = (bar - 1) * bt;
  let i = 0;
  while (t < end) {
    const d = r() < 0.5 ? bt : bt / 2;
    p.chords.push({ id: `c${i++}`, symbol: SYMS[Math.floor(r() * SYMS.length)], startTick: t, durationTicks: Math.min(d, end - t) });
    t += d;
  }
  return p;
}

function checkInvariants(p: Project, tracks: Track[]) {
  const end = projectEndTick(p);
  let range = 0, overlap = 0, past = 0, zero = 0;
  for (const t of tracks) {
    const byPitch = new Map<number, { s: number; e: number }[]>();
    for (const n of t.notes) {
      if (n.pitch < t.lowestNote || n.pitch > t.highestNote) range++;
      if (n.durationTicks <= 0) zero++;
      if (n.startTick + n.durationTicks > end) past++;
      const a = byPitch.get(n.pitch) ?? [];
      a.push({ s: n.startTick, e: n.startTick + n.durationTicks });
      byPitch.set(n.pitch, a);
    }
    for (const a of byPitch.values()) {
      a.sort((x, y) => x.s - y.s);
      for (let i = 1; i < a.length; i++) if (a[i].s < a[i - 1].e) overlap++;
    }
  }
  return { range, overlap, past, zero };
}

describe('generation engine', () => {
  it('generates the 16-bar fixture in under 1 second and output validates', () => {
    const p = fx();
    const t0 = performance.now();
    const tracks = generate(p, { seed: 1, humanize: true });
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(1000);
    expect(tracks.filter(isInstrumentTrack).reduce((s, t) => s + t.notes.length, 0)).toBeGreaterThan(100);
    expect(validateProject({ ...p, tracks }).errors).toEqual([]);
  });

  it('is deterministic for the same project + options + seed', () => {
    const a = generate(fx(), { seed: 42, humanize: true, density: 0.8 });
    const b = generate(fx(), { seed: 42, humanize: true, density: 0.8 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = generate(fx(), { seed: 43, humanize: true, density: 0.8 });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it('100 random seeds across all modes and 4 time signatures: zero violations', () => {
    const totals = { range: 0, overlap: 0, past: 0, zero: 0 };
    for (let seed = 1; seed <= 100; seed++) {
      const p = randomProject(seed);
      const tracks = generate(p, { seed, humanize: seed % 2 === 0, density: 0.5 + (seed % 5) / 5 });
      const r = checkInvariants(p, tracks);
      totals.range += r.range; totals.overlap += r.overlap; totals.past += r.past; totals.zero += r.zero;
    }
    expect(totals).toEqual({ range: 0, overlap: 0, past: 0, zero: 0 });
  });

  it('returns locked tracks bit-identical and still generates muted tracks', () => {
    const p = fx();
    p.tracks = generate(p, { seed: 5 });
    const strings = p.tracks.filter((t) => t.family === 'Strings');
    strings.forEach((t) => (t.locked = true));
    const horns = p.tracks.find((t) => t.role === 'horns')!;
    horns.muted = true;
    const before = JSON.stringify(strings);
    const out = generate(p, { seed: 999 });
    expect(JSON.stringify(out.filter((t) => t.family === 'Strings'))).toBe(before);
    out.filter((t) => t.family === 'Strings').forEach((t, i) => expect(t).toBe(strings[i]));
    expect(out.find((t) => t.role === 'horns')!.notes.length).toBeGreaterThan(0);
    // lockedTrackIds option works too
    const out2 = generate(p, { seed: 1000, lockedTrackIds: [horns.id] });
    expect(out2.find((t) => t.id === horns.id)).toBe(horns);
  });

  it('humanize keeps notes in range and inside their original bar', () => {
    const p = fx();
    const plain = generate(p, { seed: 3, humanize: false });
    const hum = generate(p, { seed: 3, humanize: true });
    const bt = barTicks(p.timeSignature);
    const maxOff = Math.floor(0.015 * (p.bpm / 60) * 960);
    expect(checkInvariants(p, hum)).toEqual({ range: 0, overlap: 0, past: 0, zero: 0 });
    for (let i = 0; i < plain.length; i++) {
      const a = plain[i].notes, b = hum[i].notes;
      expect(b.length).toBeLessThanOrEqual(a.length);
      const starts = new Set(a.map((n) => Math.floor(n.startTick / bt)));
      for (const n of b) {
        expect(starts.has(Math.floor(n.startTick / bt))).toBe(true);
        expect(a.some((o) => o.pitch === n.pitch && Math.abs(o.startTick - n.startTick) <= maxOff)).toBe(true);
      }
    }
  });

  it('meter math places beat-patterns on correct ticks for 3/4, 6/8, 5/4', () => {
    const rules: GenerationRules = {
      version: 1, patterns: {},
      sections: { '*': { parts: [{ match: { roles: ['piano'] }, role: 'percussion', pitch: { source: 'root' }, rhythm: { type: 'pattern', unit: 'beat', steps: Array.from({ length: 8 }, (_, i) => ({ at: i, len: 0.5 })) }, velocity: [80, 80] }] } },
    };
    for (const ts of SIGS.slice(1)) {
      const p = fx(); p.sections = []; p.chords = [{ id: 'c', symbol: 'C', startTick: 0, durationTicks: barTicks(ts) * 2 }];
      p.timeSignature = ts;
      const piano = generate(p, { seed: 1, rules }).find((t) => t.role === 'piano')!;
      const starts = piano.notes.map((n) => n.startTick);
      const expected = ts.denominator === 8 ? [0, 1440, 2880, 4320] : Array.from({ length: ts.numerator * 2 }, (_, i) => i * 960);
      expect(starts, `${ts.numerator}/${ts.denominator}`).toEqual(expected);
    }
  });

  it('changing the rules config changes the output without code changes', () => {
    const p = fx();
    const a = generate(p, { seed: 7, rules: defaultRules });
    const edited: GenerationRules = JSON.parse(JSON.stringify(defaultRules, (_k, v) => (typeof v === 'function' ? undefined : v)));
    edited.sections.Verse.parts = edited.sections.Verse.parts.map((part) => ({ ...part, rhythm: { type: 'pattern', unit: 'eighth', steps: [{ at: 0, len: 1 }], cycle: 1 } }));
    const b = generate(p, { seed: 7, rules: edited });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    const v1a = a.find((t) => t.role === 'violins1')!.notes.filter((n) => n.startTick < 8 * 3840).length;
    const v1b = b.find((t) => t.role === 'violins1')!.notes.filter((n) => n.startTick < 8 * 3840).length;
    expect(v1b).toBeGreaterThan(v1a);
  });

  it('provides correct scale pitch classes to rules for every mode', () => {
    for (const mode of MODE_NAMES) {
      const p = fx(); p.mode = mode;
      let seen: number[] = [];
      const rules: GenerationRules = { version: 1, patterns: {}, sections: { '*': { parts: [{ match: { roles: ['piano'] }, role: 'melody', pitch: { source: 'scale' }, rhythm: 'x', custom: (pc) => { seen = pc.ctx.scalePitchClasses; return []; } }] } } };
      p.sections = [];
      generate(p, { seed: 1, rules });
      expect(seen.length).toBeGreaterThanOrEqual(6);
      expect(seen[0]).toBe(p.key);
    }
  });
});
