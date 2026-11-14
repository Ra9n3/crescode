/** Production-default V1 identity/development tests; historical Stage 2–6
 * reconstruction tests deliberately exercise the explicit legacy option. */
import { beforeAll, describe, expect, it } from 'vitest';
import { composeAllTracks, type ComposeResult } from '../src/orchestrator/compose';
import { createStringsIdentity, identityDraw } from '../src/orchestrator/strings/identity';
import { generateTheme } from '../src/orchestrator/strings/material/theme';
import { judgeLine, pitchClassOf, type TonalFrame } from '../src/orchestrator/strings/material/line';
import { planPhrases } from '../src/orchestrator/strings/phrases/plan';
import { projectForStringCell, isStringTrack } from './strings-v1-support';
import { MODES } from '../src/shared/schema/modes';
import { chordSpans, sectionMap } from '../src/orchestrator/spine';
import { buildStringsUnderstanding } from '../src/orchestrator/strings/understanding';
import { freshEnsemble } from '../src/shared/schema/band';
import type { Project } from '../src/shared/schema';

const project = (seed = 1, take = 0, template: 'symphony' | 'chamber' | 'cinematic' = 'symphony') => projectForStringCell({ template, fixture: 'dorian-16bars', seed, take });
const run = (p: Project, seed: number) => composeAllTracks(p, { seed, stringsComposition: 'v1' });
const context = (r: ComposeResult) => r.stringsDiagnostics.v1!;
const comp = (r: ComposeResult) => context(r).composition!;
const frame = (r: ComposeResult): TonalFrame => ({ ...comp(r).frame!, harmony: context(r).understanding.harmony });
const json = (v: unknown) => JSON.stringify(v);
let seeds: ComposeResult[];
let takes: ComposeResult[];
beforeAll(() => {
  seeds = Array.from({ length: 8 }, (_, i) => run(project(i + 1), i + 1));
  takes = [1, 2, 3].map((take) => run(project(1, take), 1));
}, 180000);

describe('independent addressed identity streams', () => {
  it('is reproducible and independently addresses categories and decisions', () => {
    const a = createStringsIdentity(123, 7, 0);
    expect(createStringsIdentity(123, 7, 0)).toEqual(a);
    expect(new Set(Object.values(a.streams)).size).toBe(4);
    const rhythm = identityDraw(a.streams.rhythm, 'event:3');
    identityDraw(a.streams.theme, 'unrelated new decision');
    expect(identityDraw(a.streams.rhythm, 'event:3')).toBe(rhythm);
    for (const b of [createStringsIdentity(123, 8, 0), createStringsIdentity(123, 7, 1)]) {
      expect(b.streams).not.toEqual(a.streams);
      expect(b.intent).not.toEqual(a.intent);
    }
  });
});

describe('actual default production material, not identifiers', () => {
  it('eight displayed seeds change pitches, rhythms, contours, divisions and written notes', () => {
    for (const [i, r] of seeds.entries()) {
      expect(comp(r).identity?.userSeed).toBe(i + 1);
      expect(comp(r).written, comp(r).reason ?? '').toBe(true);
    }
    for (const extract of [
      (r: ComposeResult) => comp(r).theme!.identity.intervals,
      (r: ComposeResult) => comp(r).theme!.identity.rhythm,
      (r: ComposeResult) => comp(r).theme!.identity.contour,
      (r: ComposeResult) => comp(r).phrases.map((p) => [p.startTick, p.endTick]),
      (r: ComposeResult) => comp(r).phrases.map((p) => p.segments.map((s) => s.operation)),
      (r: ComposeResult) => comp(r).voiceNotes.map((n) => n.note),
    ]) expect(new Set(seeds.map((r) => json(extract(r)))) .size).toBeGreaterThanOrEqual(4);
    const openings = new Set(seeds.map((r) => Math.sign(comp(r).theme!.identity.intervals[0])));
    // These eight identities request ascending/descending openings. A
    // repeated opening is tested explicitly below, not inferred from an
    // enharmonic respelling of a sounding step.
    expect(openings.has(-1) && openings.has(1)).toBe(true);
    expect(new Set(seeds.flatMap((r) => comp(r).phrases.map((p) => p.development!.strategy))).size).toBeGreaterThanOrEqual(5);
  });

  it('take changes theme and planning independently of displayed seed', () => {
    const all = [seeds[0], ...takes];
    expect(new Set(all.map((r) => json(comp(r).theme!.notes))).size).toBe(4);
    expect(new Set(all.map((r) => json(comp(r).phrases.map((p) => [p.startTick, p.endTick, p.segments.map((s) => s.operation)])))).size).toBeGreaterThan(1);
    expect(all.every((r) => comp(r).identity!.userSeed === 1)).toBe(true);
  });

  it('repeats the full result exactly and leaves classic/nonstring handoffs unchanged', () => {
    const p = project();
    expect(run(p, 1)).toEqual(seeds[0]);
    const classic = composeAllTracks(p, { seed: 1, stringsComposition: 'classic' });
    const implicit = composeAllTracks(p, { seed: 1 });
    expect(implicit.tracks).toEqual(classic.tracks);
    expect(seeds[0].tracks.filter((t) => !isStringTrack(t))).toEqual(classic.tracks.filter((t) => !isStringTrack(t)));
    expect(seeds[0].tracks.map((t) => [t.id, t.role, t.name])).toEqual(classic.tracks.map((t) => [t.id, t.role, t.name]));
    expect(new Set(seeds[0].tracks.map((t) => t.id)).size).toBe(seeds[0].tracks.length);
  }, 30000);

  it('separates template-induced composition from roster/energy effects; no mood claim', () => {
    for (const template of ['chamber', 'cinematic'] as const) {
      const r = run(project(1, 0, template), 1);
      expect(comp(r).written, comp(r).reason ?? '').toBe(true);
      expect(comp(r).identity!.userSeed).toBe(1);
      // Existing semantic orchestration identity includes template. Do not
      // describe this as a fixed-material orchestration comparison.
      expect(comp(r).identity!.orchestrationSeed).not.toBe(comp(seeds[0]).identity!.orchestrationSeed);
      expect(comp(r).theme!.notes).not.toEqual(comp(seeds[0]).theme!.notes);
    }
  }, 30000);
});

describe('coherence, memory, bounded transformations and failure policy', () => {
  it('checks every theme, adapted segment and joined phrase under actual harmony', () => {
    for (const r of [...seeds, ...takes]) {
      const c = comp(r), f = frame(r), theme = c.theme!;
      expect(judgeLine(f, theme.notes.map((n) => ({ ...n, tick: n.tick + theme.home.startTick })), { finalStable: true }).ok).toBe(true);
      for (const p of c.phrases) {
        expect(judgeLine(f, p.notes, { finalStable: true }).ok).toBe(true);
        expect(p.startTick).toBeGreaterThanOrEqual(p.window.startTick);
        expect(p.endTick).toBeLessThanOrEqual(p.window.endTick);
        for (let i = 0; i < p.notes.length; i++) {
          const n = p.notes[i];
          expect(n.duration).toBeGreaterThanOrEqual(f.beatTicks / 2);
          if (i) expect(n.tick).toBeGreaterThanOrEqual(p.notes[i - 1].tick + p.notes[i - 1].duration);
          expect(n.step).toBeGreaterThanOrEqual(-2);
          expect(n.step).toBeLessThanOrEqual(11);
        }
        for (const s of p.segments.filter((s) => s.adaptation)) {
          expect(s.operation).toBeTruthy();
          expect([0.5, 1, 2, 4]).toContain(s.rhythmScale);
          if (s.operation === 'augmentation') expect(s.rhythmScale).toBeGreaterThan(1);
          if (s.operation === 'diminution') expect(s.rhythmScale).toBeLessThan(1);
          expect(Array.isArray(s.adaptation!.tried)).toBe(true);
          expect(s.adaptation!.strategy.length).toBeGreaterThan(0);
          // Verify actual thematic provenance, not just operation labels.
          const op = s.operation!.includes('→') ? s.operation!.split('→')[1].trim().split(' ')[0] : s.operation!;
          const head = theme.notes.slice(0, theme.headCount), tail = theme.notes.slice(theme.headCount);
          let source = op === 'tail' && tail.length >= 2 ? tail
            : ['head', 'fragment', 'inversion'].includes(op) ? head : theme.notes;
          if (op === 'fragment') source = head.slice(0, Math.max(2, Math.ceil(head.length / 2)));
          const actual = p.notes.filter((n) => n.tick >= s.startTick && n.tick < s.endTick);
          expect(actual.map((n) => n.duration)).toEqual(source.map((n) => n.duration * s.rhythmScale!));
          for (let i = 1; i < Math.min(theme.headCount, source.length); i++) {
            const intended = (source[i].step - source[i - 1].step) * (op === 'inversion' ? -1 : 1);
            expect(Math.sign(actual[i].step - actual[i - 1].step)).toBe(Math.sign(intended) || 0);
          }
        }
        const last = p.notes[p.notes.length - 1];
        const chord = f.harmony.chords.find((h) => h.fact.startTick <= last.tick && h.fact.endTick > last.tick)!;
        expect(chord.fact.pitchClasses).toContain(pitchClassOf(f, last));
      }
    }
  });

  it('can compose a genuine repeated-note opening without enharmonic interval tricks', () => {
    const c = comp(seeds[0]), f = frame(seeds[0]);
    const identity = { ...c.identity!, intent: { ...c.identity!.intent, opening: 0, trajectory: [0, 0, -2, 0] } };
    const t = generateTheme({ frame: f, identity, homeTick: 0, seed: 0 });
    expect(t.ok).toBe(true);
    if (t.ok) {
      expect(t.theme.identity.intervals[0]).toBe(0);
      expect(t.theme.identity.semitoneIntervals[0]).toBe(0);
      for (const n of t.theme.notes) if (n.alter !== 0) expect(f.scale.map((s) => (f.key + s) % 12)).not.toContain(pitchClassOf(f, n));
    }
  });

  it('fits material to changed harmony, rather than changing only labels', () => {
    const f = frame(seeds[0]);
    const id = createStringsIdentity(55, 1, 0);
    const a = generateTheme({ frame: f, homeTick: 0, seed: 0, identity: id });
    const shifted: TonalFrame = { ...f, harmony: { ...f.harmony, chords: f.harmony.chords.map((c) => ({ ...c, fact: { ...c.fact, pitchClasses: c.fact.pitchClasses.map((pc) => (pc + 1) % 12) } })) } };
    const b = generateTheme({ frame: shifted, homeTick: 0, seed: 0, identity: id });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.theme.notes.map((n) => [n.step, n.alter])).not.toEqual(b.theme.notes.map((n) => [n.step, n.alter]));
  }, 30000);

  it('handles short/incomplete/tail/silent windows explicitly without squeezing', () => {
    const r = seeds[0], f = frame(r), c = comp(r);
    const input = { frame: f, theme: c.theme!, identity: c.identity!, structure: context(r).understanding.structure };
    const empty = planPhrases({ ...input, windows: [] });
    expect(empty.phrases).toEqual([]);
    const tiny = planPhrases({ ...input, windows: [{ startTick: 0, endTick: 240 }] });
    expect(tiny.phrases).toEqual([]);
    expect(tiny.silentWindows[0].reason).toMatch(/two beats/);
    const tail = planPhrases({ ...input, windows: [{ startTick: 480, endTick: 3600 }, { startTick: 9000, endTick: 14000 }] });
    for (const p of tail.phrases) for (const n of p.notes) {
      expect(n.tick).toBeGreaterThanOrEqual(p.window.startTick);
      expect(n.tick + n.duration).toBeLessThanOrEqual(p.window.endTick);
      expect(n.duration).toBeGreaterThanOrEqual(480);
    }
    // Windows, including failed ones, must not disappear without evidence.
    expect(tail.phrases.length + tail.silentWindows.length).toBe(2);
    const long = planPhrases({ ...input, windows: [{ startTick: 0, endTick: 61440 }] });
    expect(long.phrases.length).toBeGreaterThan(1);
  }, 30000);

  it('supports three-beat material and one-bar homes; rejects unsupported meter/insufficient room', () => {
    const f = frame(seeds[0]), id = comp(seeds[0]).identity!;
    const three = generateTheme({ frame: { ...f, beatsPerBar: 3, barTicks: 2880 }, homeTick: 0, seed: 0, identity: id });
    expect(three.ok).toBe(true);
    const short = generateTheme({ frame: f, homeTick: 0, seed: 0, identity: id, availableTicks: 3840 });
    expect(short.ok).toBe(true);
    if (short.ok) expect(short.theme.lengthTicks).toBe(3840);
    expect(generateTheme({ frame: { ...f, beatsPerBar: 5 }, homeTick: 0, seed: 0, identity: id }).ok).toBe(false);
    expect(generateTheme({ frame: f, homeTick: 0, seed: 0, identity: id, availableTicks: 240 }).ok).toBe(false);
  }, 30000);

  it('composes coherent major/minor/modal and static/pedal/chromatic harmonic homes', () => {
    const id = createStringsIdentity(2026, 4, 1);
    const cases = [
      { mode: 'Ionian' as const, symbols: ['D', 'G', 'A7', 'D'] },
      { mode: 'Aeolian' as const, symbols: ['Dm', 'Bb', 'A7', 'Dm'] },
      { mode: 'Harmonic Minor' as const, symbols: ['Dm', 'Gm', 'A7', 'Dm'] },
      { mode: 'Dorian' as const, symbols: ['Dm7', 'Dm7', 'Dm7', 'Dm7'] },
      { mode: 'Dorian' as const, symbols: ['Dm/A', 'Bb/A', 'Eb7', 'A7'] },
      { mode: 'Lydian' as const, symbols: ['Dmaj7', 'E7', 'C#7', 'Dmaj7'] },
    ];
    for (const item of cases) {
      const p = project();
      p.mode = item.mode;
      p.chords = item.symbols.map((symbol, i) => ({ id: `edge${i}`, symbol, startTick: i * 3840, durationTicks: 3840 }));
      const u = buildStringsUnderstanding({ project: p, template: null, ensemble: freshEnsemble(), spans: chordSpans(p), sections: sectionMap(p), take: 1 });
      const f: TonalFrame = { key: p.key, scale: MODES[p.mode], barTicks: 3840, beatTicks: 960, beatsPerBar: 4, harmony: u.harmony };
      const t = generateTheme({ frame: f, identity: id, homeTick: 0, seed: 0 });
      expect(t.ok, item.mode + item.symbols.join(',')).toBe(true);
      if (t.ok) {
        expect(judgeLine(f, t.theme.notes, { finalStable: true }).ok).toBe(true);
        const planned = planPhrases({ frame: f, theme: t.theme, identity: id, structure: u.structure, windows: [{ startTick: 0, endTick: 15360 }] });
        expect(planned.phrases.length, item.mode).toBeGreaterThan(0);
        for (const ph of planned.phrases) expect(judgeLine(f, ph.notes, { finalStable: true }).ok).toBe(true);
        // Later unsupported harmony is rejected, not a repetitive substitute.
        const unsafe = { ...f, harmony: { ...f.harmony, chords: [] } };
        const rejected = planPhrases({ frame: unsafe, theme: t.theme, identity: id, structure: u.structure, windows: [{ startTick: 19200, endTick: 26880 }] });
        expect(rejected.phrases).toHaveLength(0);
        expect(rejected.silentWindows[0].reason).toMatch(/harmony/);
      }
    }
  }, 30000);


  it('uses an available violin primary and reports an unavailable violin handoff', () => {
    const p = project();
    p.tracks = seeds[0].tracks.map((t) => ({ ...t, notes: [], cc: [], locked: t.role === 'violins1' }));
    const second = run(p, 1);
    expect(comp(second).written, comp(second).reason ?? '').toBe(true);
    expect(second.tracks.find((t) => t.id === comp(second).trackId)!.role).toBe('violins2');
    p.tracks = p.tracks.map((t) => ({ ...t, locked: t.role === 'violins1' || t.role === 'violins2' }));
    const unavailable = run(p, 1);
    expect(comp(unavailable).written).toBe(false);
    expect(comp(unavailable).reason).toMatch(/violin/);
  }, 30000);

});
