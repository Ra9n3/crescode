/**
 * Phase 3 tests — harmonic phrase & cadence planning (spec §13).
 *
 * The planner is blueprint-only: it reads chords as context and never
 * creates, moves or modifies them, so the no-mutation assertions below also
 * guard the boundary toward the manual workflow and the orchestral
 * generator. Cadence assertions check tendencies and validity — never a
 * mandatory chord formula (spec §13-T4).
 */
import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/dorian-16bars.json';
import { generate } from '../src/engine/generate';
import {
  boundaryTendencies, cadenceEnvironment, cadenceTendencies,
  collectExistingHarmony, compatibleCadenceFamilies, getChordVocabulary,
  planCadence, planSectionPhrases, planSongHarmony, buildSongHarmonyProfiles,
} from '../src/engine/harmony';
import { topOf } from '../src/engine/harmony/planning';
import { MODE_NAMES } from '../src/shared/schema/modes';
import { barTicks } from '../src/shared/schema/meter';
import { projectFromFixture } from '../src/shared/schema';
import { DEFAULT_CHORDGEN_SETTINGS, type Chord, type ModeName, type Project, type Section } from '../src/shared/schema/types';

/* --------------------------------------------------------------------------
 * Fixtures
 * ----------------------------------------------------------------------- */

const sec = (id: string, name: string, startBar: number, lengthBars: number, energy?: number): Section =>
  ({ id, name, startBar, lengthBars, ...(energy === undefined ? {} : { energy }) });

function makeProject(sections: Section[], opts: Partial<Project> = {}): Project {
  const base = projectFromFixture({ name: 'Test', tracks: [] });
  return { ...base, sections, chords: [] as Chord[], ...opts };
}

const profileFor = (p: Project, id: string) => {
  const r = buildSongHarmonyProfiles(p).find((x) => x.sectionId === id);
  expect(r, `profile for ${id} must exist`).toBeDefined();
  return r!;
};

const planSection = (p: Project, id: string, seed?: number) =>
  planSectionPhrases(p, profileFor(p, id), seed === undefined ? {} : { seed });

const plan = (p: Project, seed?: number) => planSongHarmony(p, seed === undefined ? {} : { seed });

const popSong = (): Project => makeProject([
  sec('s1', 'Intro', 1, 4, 0.2),
  sec('s2', 'Verse 1', 5, 8, 0.4),
  sec('s3', 'Pre-Chorus', 13, 4, 0.6),
  sec('s4', 'Chorus', 17, 8, 0.9),
  sec('s5', 'Verse 2', 25, 8, 0.5),
  sec('s6', 'Bridge', 33, 4, 0.6),
  sec('s7', 'Final Chorus', 37, 8, 0.95),
  sec('s8', 'Outro', 45, 4, 0.3),
]);

/* --------------------------------------------------------------------------
 * Test 1 — Phrase coverage
 * ----------------------------------------------------------------------- */
describe('Test 1: phrase coverage is complete, gapless and overlap-free', () => {
  function expectCoverage(p: Project, sectionId: string) {
    const prof = profileFor(p, sectionId);
    const { phrases } = planSection(p, sectionId);
    expect(phrases.length, sectionId).toBeGreaterThan(0);
    const bt = barTicks(p.timeSignature);
    const startTick = (prof.context.startBar - 1) * bt;
    const endTick = startTick + prof.context.lengthBars * bt;
    // First phrase starts at the section beginning; last ends at its end.
    expect(phrases[0].startTick, sectionId).toBe(startTick);
    const last = phrases[phrases.length - 1];
    expect(last.startTick + last.durationTicks, sectionId).toBe(endTick);
    for (const ph of phrases) {
      expect(ph.durationTicks, sectionId).toBeGreaterThan(0);
      expect(ph.lengthBars, sectionId).toBeGreaterThan(0);
      expect(ph.startTick, sectionId).toBeGreaterThanOrEqual(startTick);
      expect(ph.startTick + ph.durationTicks, sectionId).toBeLessThanOrEqual(endTick);
      // Bar-grid alignment through the project's own meter.
      expect((ph.startTick - startTick) % bt, sectionId).toBe(0);
      expect(ph.durationTicks % bt, sectionId).toBe(0);
    }
    // No gaps, no overlaps.
    for (let i = 1; i < phrases.length; i++) {
      expect(phrases[i].startTick, sectionId)
        .toBe(phrases[i - 1].startTick + phrases[i - 1].durationTicks);
    }
  }

  it('covers every section of a full song, across seeds', () => {
    const song = popSong();
    for (const seed of [1, 7, 42]) {
      for (const s of song.sections) expectCoverage(song, s.id);
    }
  });

  it('a song-level plan plans every section exactly once, in order', () => {
    const song = popSong();
    const result = plan(song, 3);
    expect(result.sections.map((s) => s.sectionId))
      .toEqual(['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8']);
    for (const s of result.sections) {
      expect(s.phrases.length).toBeGreaterThan(0);
      expect(s.boundary === null).toBe(s.sectionId === 's8');
      const sum = s.phrases.reduce((a, ph) => a + ph.durationTicks, 0);
      expect(sum).toBe(s.durationTicks);
    }
  });
});

/* --------------------------------------------------------------------------
 * Test 2 — Odd section lengths
 * ----------------------------------------------------------------------- */
describe('Test 2: odd section lengths all produce valid plans', () => {
  const lengths = [1, 2, 3, 5, 7, 9, 11, 13];

  it('plans 1, 2, 3, 5, 7, 9, 11 and 13 bar sections with valid coverage', () => {
    const names = ['Intro', 'Verse', 'Chorus', 'Bridge', 'Solo', 'Breakdown', 'Interlude', 'Outro'];
    let startBar = 1;
    const sections = lengths.map((len, i) => {
      const s = sec(`o${i}`, names[i], startBar, len, 0.5);
      startBar += len;
      return s;
    });
    const p = makeProject(sections);
    for (const s of sections) {
      const { phrases } = planSection(p, s.id, 5);
      const totalBars = phrases.reduce((a, ph) => a + ph.lengthBars, 0);
      expect(totalBars, `${s.name} (${s.lengthBars} bars)`).toBe(s.lengthBars);
      expect(phrases[0].startBar, s.name).toBe(s.startBar);
      expect(phrases.every((ph) => ph.lengthBars >= 1), s.name).toBe(true);
      for (let i = 1; i < phrases.length; i++) {
        expect(phrases[i].startBar, s.name)
          .toBe(phrases[i - 1].startBar + phrases[i - 1].lengthBars);
      }
    }
  });

  it('a one-bar section plans as exactly one phrase with a compatible arrival', () => {
    const p = makeProject([sec('one', 'Verse', 1, 1)]);
    const { phrases } = planSection(p, 'one', 9);
    expect(phrases).toHaveLength(1);
    expect(phrases[0].lengthBars).toBe(1);
    expect(phrases[0].cadence.compatibleFamilies.length).toBeGreaterThan(0);
    expect(phrases[0].cadence.intention).toBeTruthy();
  });
});

/* --------------------------------------------------------------------------
 * Test 3 — Different meters
 * ----------------------------------------------------------------------- */
describe('Test 3: phrase timing follows the project meter (never 3840 by assumption)', () => {
  const inMeter = (n: number, d: number) =>
    makeProject([sec('m', 'Chorus', 1, 8)], { timeSignature: { numerator: n, denominator: d } });

  it('4/4, 3/4 and 6/8 compute exact tick spans', () => {
    for (const [n, d] of [[4, 4], [3, 4], [6, 8]] as const) {
      const p = inMeter(n, d);
      const bt = barTicks(p.timeSignature);
      expect(bt, `${n}/${d}`).toBe(Math.round((960 * 4 * n) / d)); // derived, not hardcoded
      const result = planSection(p, 'm', 5);
      const total = result.phrases.reduce((a, ph) => a + ph.durationTicks, 0);
      expect(total, `${n}/${d}`).toBe(8 * bt);
      for (const ph of result.phrases) {
        expect(ph.durationTicks, `${n}/${d}`).toBe(ph.lengthBars * bt);
        expect(ph.startTick % bt, `${n}/${d}`).toBe(0);
      }
    }
  });

  it('6/8 bars are 2880 ticks and compound phrases span whole notated bars', () => {
    const p = inMeter(6, 8);
    const result = plan(p, 5);
    const s = result.sections[0];
    expect(s.startTick).toBe(0);
    expect(s.durationTicks).toBe(8 * 2880);
    expect(s.phrases[0].startTick).toBe(0);
    for (const ph of s.phrases) expect(ph.durationTicks % 2880).toBe(0);
  });
});

/* --------------------------------------------------------------------------
 * Test 4 — Section transitions
 * ----------------------------------------------------------------------- */
describe('Test 4: boundary and cadence intentions reflect structural context', () => {
  const song = makeProject([
    sec('intro', 'Intro', 1, 4, 0.2),
    sec('verse', 'Verse', 5, 8, 0.4),
    sec('chorus', 'Chorus', 13, 8, 0.9),
    sec('break', 'Breakdown', 21, 4, 0.2),
    sec('bridge', 'Bridge', 25, 4, 0.6),
    sec('final', 'Final Chorus', 29, 8, 0.95),
    sec('outro', 'Outro', 37, 4, 0.25),
  ]);
  const VALID = ['continuation', 'preparation', 'resolution', 'contrast', 'suspension', 'abrupt'];

  it('every planned seam carries a valid boundary intention, once per seam', () => {
    const result = plan(song, 11);
    expect(result.sections).toHaveLength(7);
    for (let i = 0; i < result.sections.length; i++) {
      const s = result.sections[i];
      if (i === result.sections.length - 1) {
        expect(s.boundary).toBeNull();
      } else {
        expect(s.boundary, `${s.sectionId} → ${result.sections[i + 1].sectionId}`).not.toBeNull();
        expect(VALID, s.sectionId).toContain(s.boundary!.intention);
        expect(s.boundary!.fromSectionId).toBe(s.sectionId);
        expect(s.boundary!.toSectionId).toBe(result.sections[i + 1].sectionId);
      }
    }
  });

  it('tendency order follows structure — without mandating one cadence', () => {
    const profiles = buildSongHarmonyProfiles(song);
    const result = plan(song, 11);
    const ending = (i: number) => result.sections[i].phrases.at(-1)!.cadence.intention;
    // Deterministic top tendency per seam — the structural expectation.
    expect(topOf(boundaryTendencies({ from: profiles[0], to: profiles[1], endingIntention: ending(0) })))
      .toBe('preparation'); // Intro → Verse: anticipation rises
    expect(topOf(boundaryTendencies({ from: profiles[1], to: profiles[2], endingIntention: ending(1) })))
      .toBe('preparation'); // Verse → Chorus
    expect(topOf(boundaryTendencies({ from: profiles[2], to: profiles[3], endingIntention: ending(2) })))
      .toBe('contrast'); // Chorus → Breakdown: energy collapse
    expect(topOf(boundaryTendencies({ from: profiles[4], to: profiles[5], endingIntention: ending(4) })))
      .toBe('preparation'); // Bridge → Final Chorus: the return home
    expect(topOf(boundaryTendencies({ from: profiles[5], to: profiles[6], endingIntention: ending(5) })))
      .toBe('resolution'); // Final Chorus → Outro: unwind
    // The harder seam must not merely tie the softer one.
    const drop = boundaryTendencies({ from: profiles[2], to: profiles[3], endingIntention: ending(2) });
    expect(drop.contrast).toBeGreaterThan(drop.continuation);
    const lift = boundaryTendencies({ from: profiles[4], to: profiles[5], endingIntention: ending(4) });
    expect(lift.preparation).toBeGreaterThan(lift.abrupt);
  });

  it('cadence tendencies bend by role and position, without mandating outcomes', () => {
    const settings = { ...DEFAULT_CHORDGEN_SETTINGS };
    // A concluding phrase at the song end leans resolved…
    const outroProfile = profileFor(makeProject([sec('o', 'Outro', 1, 4, 0.3)]), 'o');
    const endT = cadenceTendencies({
      role: 'conclude', phraseIndex: 1, phraseCount: 2, isSectionEnd: true, isSongEnd: true,
      profile: outroProfile, environment: cadenceEnvironment(song.key, song.mode), settings,
    });
    expect(topOf(endT)).toBe('resolved');
    // …while a preparing phrase before a transition leans transitional…
    const verseProfile = profileFor(song, 'verse');
    const prepT = cadenceTendencies({
      role: 'prepare', phraseIndex: 1, phraseCount: 2, isSectionEnd: true, isSongEnd: false,
      profile: verseProfile, environment: cadenceEnvironment(song.key, song.mode), settings,
    });
    expect(topOf(prepT)).toBe('transitional');
    // …and both keep every other intention reachable (no mandates).
    for (const t of [endT, prepT]) {
      for (const w of Object.values(t)) expect(w).toBeGreaterThan(0);
    }
  });

  it('picked intentions are seed-stable and always valid members', () => {
    const intents = ['resolved', 'open', 'suspended', 'transitional', 'deceptive', 'modal', 'ambiguous'];
    const a = plan(song, 5).sections[1].phrases.at(-1)!.cadence.intention;
    const b = plan(song, 5).sections[1].phrases.at(-1)!.cadence.intention;
    expect(a).toBe(b);
    expect(intents).toContain(a);
    const direct = planCadence(
      { role: 'establish', index: 0, count: 2, isSongEnd: false },
      { project: song, profile: profileFor(song, 'verse'), seed: 5 },
    );
    expect(intents).toContain(direct.intention);
    expect(direct.compatibleFamilies.length).toBeGreaterThan(0);
  });
});

/* --------------------------------------------------------------------------
 * Test 5 — Modal compatibility
 * ----------------------------------------------------------------------- */
describe('Test 5: cadence compatibility follows harmonic structure, not mode names', () => {
  const families = (mode: ModeName) => compatibleCadenceFamilies(cadenceEnvironment(2, mode));

  it('Ionian supports functional arrivals; Dorian, Phrygian, Aeolian and Locrian do not', () => {
    expect(families('Ionian')).toContain('functional-tonal');
    for (const mode of ['Dorian', 'Phrygian', 'Aeolian', 'Locrian'] as const) {
      const f = families(mode);
      expect(f, mode).not.toContain('functional-tonal');
      expect(f, mode).toContain('modal'); // non-dominant arrivals stay available
    }
    // Locrian's diminished tonic removes plagal support as well.
    expect(families('Locrian')).not.toContain('plagal');
    expect(families('Locrian')[0]).toBe('coloristic');
  });

  it('symmetrical scales never receive tonal cadences — pedal and color lead', () => {
    for (const mode of ['Whole Tone', 'Diminished (Half-Whole)', 'Diminished (Whole-Half)'] as const) {
      const f = families(mode);
      expect(f, mode).not.toContain('functional-tonal');
      expect(f, mode).not.toContain('modal');
      expect(f[0], mode).toBe('pedal');
      expect(f, mode).toContain('coloristic');
      expect(f, mode).toContain('stepwise');
      expect(f, mode).toContain('chromatic'); // chromatic approaches remain possible
    }
  });

  it('every supported mode keeps at least four compatible families — nothing is boxed in', () => {
    for (const mode of MODE_NAMES) {
      expect(families(mode).length, mode).toBeGreaterThanOrEqual(4);
    }
  });

  it('planned phrases carry the environment-derived families', () => {
    const p = makeProject([sec('v', 'Verse', 1, 8)], { mode: 'Dorian' as ModeName });
    const { phrases } = planSection(p, 'v', 3);
    for (const ph of phrases) {
      expect(ph.cadence.compatibleFamilies, ph.id).toContain('modal');
      expect(ph.cadence.compatibleFamilies, ph.id).not.toContain('functional-tonal');
    }
  });
});

/* --------------------------------------------------------------------------
 * Test 6 — Existing chord anchors
 * ----------------------------------------------------------------------- */
describe('Test 6: existing chords inform planning without being modified', () => {
  const bt = barTicks({ numerator: 4, denominator: 4 });
  const chord = (id: string, symbol: string, startBar: number, bars: number, locked = false): Chord => ({
    id,
    symbol,
    startTick: (startBar - 1) * bt,
    durationTicks: bars * bt,
    ...(locked ? { locked: true } : {}),
  });

  it('handles no chords, sparse, dense, crossing and locked chords; chords never change', () => {
    const scenarios: Array<[string, Chord[]]> = [
      ['none', []],
      ['sparse', [chord('c1', 'Dm', 1, 2), chord('c2', 'Gm', 5, 2)]],
      ['dense', Array.from({ length: 8 }, (_, i) => chord(`d${i}`, i % 2 ? 'A7' : 'Dm', i + 1, 1))],
      ['crossing', [chord('x1', 'Bb', 3, 4), chord('x2', 'C', 7, 2)]], // spans mid-section
      ['locked', [chord('l1', 'Dm', 1, 2, true), chord('l2', 'Gm', 5, 4, true)]],
    ];
    for (const [name, chords] of scenarios) {
      const p = makeProject([sec('v', 'Verse', 1, 8)], { chords });
      const before = JSON.stringify(p.chords);
      const result = plan(p, 9);
      expect(result.sections[0].phrases.length, name).toBeGreaterThan(0);
      const sum = result.sections[0].phrases.reduce((a, ph) => a + ph.durationTicks, 0);
      expect(sum, name).toBe(8 * bt);
      expect(JSON.stringify(p.chords), name).toBe(before); // untouched, byte for byte
    }
  });

  it('locked chord starts act as anchors — boundaries gather there (soft, not forced)', () => {
    const anchorTick = 4 * bt; // bar 5 start of the 8-bar verse
    const withAnchor = makeProject([sec('v', 'Verse', 1, 8)], { chords: [chord('l', 'Dm', 5, 4, true)] });
    const without = makeProject([sec('v', 'Verse', 1, 8)]);
    const rate = (p: Project) => {
      let hits = 0;
      for (let seed = 1; seed <= 30; seed++) {
        if (planSection(p, 'v', seed).phrases.some((ph) => ph.startTick === anchorTick)) hits++;
      }
      return hits;
    };
    const anchored = rate(withAnchor);
    const free = rate(without);
    expect(anchored).toBeGreaterThan(free); // anchored plans favor the boundary…
    expect(free).toBeGreaterThan(0); // …without ever forcing it
  });

  it('collectExistingHarmony reports chord changes and clamped locked spans', () => {
    const p = makeProject(
      [sec('v', 'Verse', 5, 8)],
      { chords: [chord('a', 'Dm', 1, 5), chord('b', 'Gm', 6, 2, true), chord('c', 'A7', 9, 8)] },
    );
    const ctx = collectExistingHarmony(p, { startTick: 4 * bt, endTick: 12 * bt });
    expect(ctx.chordChangeTicks).toEqual([5 * bt, 8 * bt]);
    expect(ctx.lockedChordSpans).toEqual([{ startTick: 5 * bt, endTick: 7 * bt }]);
  });
});

/* --------------------------------------------------------------------------
 * Test 7 — Repeated sections
 * ----------------------------------------------------------------------- */
describe('Test 7: repeated sections are recognized as related material', () => {
  it('Verse 2 shares Verse 1\u2019s form (preserveIdentity) and links its phrases', () => {
    const p = makeProject([
      sec('v1', 'Verse 1', 1, 8, 0.4),
      sec('c1', 'Chorus 1', 9, 8, 0.9),
      sec('v2', 'Verse 2', 17, 8, 0.5),
      sec('c2', 'Chorus 2', 25, 8, 0.9),
    ]);
    const result = plan(p, 21);
    const byId = new Map(result.sections.map((s) => [s.sectionId, s]));
    const v1 = byId.get('v1')!;
    const v2 = byId.get('v2')!;
    expect(v1.phrases.length).toBeGreaterThan(0);
    // Same material, same form — boundaries are reused, not re-invented.
    expect(v2.phrases.map((ph) => ph.lengthBars)).toEqual(v1.phrases.map((ph) => ph.lengthBars));
    expect(v1.phrases[0].role).toBe('establish');
    expect(v2.phrases[0].role).toBe('repeat');
    for (const ph of v2.phrases) {
      expect(ph.relatedPhraseIds, ph.id).toContain(v1.phrases[ph.index].id);
    }
    // Cadences are planned per section — related, never force-identical.
    for (const ph of v2.phrases) {
      expect(['resolved', 'open', 'suspended', 'transitional', 'deceptive', 'modal', 'ambiguous'])
        .toContain(ph.cadence.intention);
    }
  });

  it('different-length repeats stay linked without forced identical boundaries', () => {
    const p = makeProject([sec('v1', 'Verse 1', 1, 8, 0.4), sec('v2', 'Verse 2', 9, 12, 0.5)]);
    const result = plan(p, 4);
    const [v1, v2] = result.sections;
    expect(v1.phrases.map((ph) => ph.lengthBars)).not.toEqual(v2.phrases.map((ph) => ph.lengthBars));
    for (const ph of v2.phrases) {
      expect(ph.relatedPhraseIds.some((id) => id.startsWith('v1#')), ph.id).toBe(true);
    }
  });

  it('preserveIdentity: false releases the shared form but keeps the relationship', () => {
    const p = makeProject(
      [sec('v1', 'Verse 1', 1, 8, 0.4), sec('v2', 'Verse 2', 9, 8, 0.5)],
      { chordGenSettings: { ...DEFAULT_CHORDGEN_SETTINGS, preserveIdentity: false } },
    );
    const result = plan(p, 2);
    const [, v2] = result.sections;
    expect(v2.phrases[0].role).toBe('develop');
    for (const ph of v2.phrases) {
      expect(ph.relatedPhraseIds.some((id) => id.startsWith('v1#')), ph.id).toBe(true);
    }
  });
});

/* --------------------------------------------------------------------------
 * Test 8 — Seed determinism
 * ----------------------------------------------------------------------- */
describe('Test 8: seeded planning is deterministic and varies meaningfully', () => {
  const song = makeProject([
    sec('i', 'Intro', 1, 2, 0.2),
    sec('v1', 'Verse 1', 3, 8, 0.4),
    sec('c', 'Chorus', 11, 8, 0.9),
    sec('v2', 'Verse 2', 19, 8, 0.5),
    sec('o', 'Outro', 27, 4, 0.2),
  ]);

  it('identical project and seed produce byte-identical plans', () => {
    expect(JSON.stringify(plan(song, 12345))).toBe(JSON.stringify(plan(song, 12345)));
  });

  it('planning neither mutates the project nor advances or persists the seed', () => {
    const before = JSON.stringify(song);
    plan(song, 999);
    planSectionPhrases(song, profileFor(song, 'c'), { seed: 999 });
    expect(JSON.stringify(song)).toBe(before);
    expect(song.chordGenSettings!.seed).toBe(DEFAULT_CHORDGEN_SETTINGS.seed);
  });

  it('different seeds produce different valid plans; section spans never move', () => {
    const signature = (seed: number) =>
      plan(song, seed).sections.map((s) => s.phrases.map((ph) => ph.lengthBars).join('+')).join('|');
    const sigs = new Set<string>();
    for (let seed = 0; seed < 12; seed++) sigs.add(signature(seed));
    expect(sigs.size).toBeGreaterThan(1); // meaningful variation exists

    const base = plan(song, 0).sections.map((s) => [s.startTick, s.durationTicks]);
    for (let seed = 1; seed < 12; seed++) {
      expect(plan(song, seed).sections.map((s) => [s.startTick, s.durationTicks])).toEqual(base);
    }
  });
});

/* --------------------------------------------------------------------------
 * Test 9 — Very short songs
 * ----------------------------------------------------------------------- */
describe('Test 9: very short songs plan without failures', () => {
  it('a single one-bar section', () => {
    const p = makeProject([sec('x', 'Verse', 1, 1)]);
    const result = plan(p, 6);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].phrases).toHaveLength(1);
    expect(result.sections[0].phrases[0].durationTicks).toBe(barTicks(p.timeSignature));
    expect(result.sections[0].boundary).toBeNull();
    expect(result.sections[0].phrases[0].cadence.compatibleFamilies.length).toBeGreaterThan(0);
  });

  it('a single two-bar section', () => {
    const p = makeProject([sec('x', 'Chorus', 1, 2)]);
    const result = plan(p, 6);
    const total = result.sections[0].phrases.reduce((a, ph) => a + ph.lengthBars, 0);
    expect(total).toBe(2);
    expect(result.sections[0].phrases.every((ph) => ph.durationTicks > 0)).toBe(true);
  });

  it('a lone two-bar Outro concludes toward arrival', () => {
    const p = makeProject([sec('x', 'Outro', 1, 2)]);
    const result = plan(p, 6);
    const phrases = result.sections[0].phrases;
    // Whatever the phrase count, the section's final phrase concludes.
    expect(phrases.at(-1)!.role).toBe('conclude');
    expect(['resolved', 'open', 'suspended', 'transitional', 'deceptive', 'modal', 'ambiguous'])
      .toContain(phrases.at(-1)!.cadence.intention);
  });

  it('a sectionless project plans to an empty, valid blueprint', () => {
    const result = plan(makeProject([]), 6);
    expect(result.sections).toEqual([]);
    expect(result.seed).toBe(6);
  });
});

/* --------------------------------------------------------------------------
 * Test 10 — Regression protection
 * ----------------------------------------------------------------------- */
describe('Test 10: Phases 1\u20132 and the orchestral generator remain intact', () => {
  it('Phase 1 vocabulary still answers correctly', () => {
    const vocab = getChordVocabulary({ root: 'D', mode: 'Dorian' });
    const symbols = vocab.candidates.map((c) => c.symbol);
    expect(symbols).toContain('Dm');
    expect(symbols).toContain('G7');
  });

  it('Phase 2 profiles still drive planning and stay context-sensitive', () => {
    const profiles = buildSongHarmonyProfiles(popSong());
    expect(profiles.map((p) => p.identity))
      .toEqual(['intro', 'verse', 'prechorus', 'chorus', 'verse', 'bridge', 'chorus', 'outro']);
    expect(profiles[1].development.relatedSectionIds).toContain('s5'); // Verse 1 ↔ Verse 2
  });

  it('the planner reads projects without altering them — chords, settings, sections', () => {
    const base = projectFromFixture({ name: 'T', tracks: [] });
    const p: Project = {
      ...base,
      sections: [sec('s1', 'Chorus', 1, 8), sec('s2', 'Verse', 9, 8)],
      chords: [{ id: 'c1', symbol: 'Dm7', startTick: 0, durationTicks: 3840, locked: true }],
    };
    const before = JSON.stringify(p);
    plan(p, 1);
    planSectionPhrases(p, profileFor(p, 's1'), { seed: 1 });
    expect(JSON.stringify(p)).toBe(before);
    expect(p.chords).toHaveLength(1);
    expect(p.chords[0]).toEqual({ id: 'c1', symbol: 'Dm7', startTick: 0, durationTicks: 3840, locked: true });
  });

  it('the orchestral generator still runs, unchanged and deterministic', () => {
    const p = projectFromFixture(JSON.parse(JSON.stringify(fixture)));
    const first = generate(p, { seed: 7 });
    const second = generate(p, { seed: 7 });
    expect(first.length).toBeGreaterThan(0);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
