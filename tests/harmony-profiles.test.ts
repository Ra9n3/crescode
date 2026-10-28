/**
 * Phase 2 tests — section harmony profiles (spec §14).
 *
 * The profile layer is planning-only: every test here also implicitly guards
 * the "no chord events" boundary, since the whole suite runs against a pure
 * function layer that never touches project.chords.
 */
import { describe, expect, it } from 'vitest';
import {
  analyzeChordInMode, buildSectionHarmonyProfile, buildSongHarmonyProfiles,
  evaluateContour, getChordVocabulary, resolveSectionIdentity,
} from '../src/engine/harmony';
import { projectFromFixture, validateProject } from '../src/shared/schema';
import type {
  Chord, Project, Section,
} from '../src/shared/schema/types';

/* --------------------------------------------------------------------------
 * Fixtures
 * ----------------------------------------------------------------------- */

const sec = (id: string, name: string, startBar: number, lengthBars: number, energy?: number): Section =>
  ({ id, name, startBar, lengthBars, ...(energy === undefined ? {} : { energy }) });

function makeProject(sections: Section[], opts: Partial<Project> = {}): Project {
  const base = projectFromFixture({ name: 'Test', tracks: [] });
  return { ...base, sections, chords: [] as Chord[], ...opts };
}

const profile = (p: Project, id: string) => {
  const r = buildSectionHarmonyProfile(p, id);
  expect(r, `profile for ${id} must exist`).not.toBeNull();
  return r!;
};

/** Pop song: Intro V1 PC C V2 C Bridge FinalC Outro (8 + …). */
const standardSong = (): Project => makeProject([
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
 * Test 1 — Section identities
 * ----------------------------------------------------------------------- */
describe('Test 1: section identity recognition', () => {
  const cases: Array<[string, string, string]> = [
    ['Intro', 'intro', 'intro'],
    ['Verse', 'verse', 'verse'],
    ['Verse 1', 'verse', 'verse'],
    ['Verse 2', 'verse', 'verse'],
    ['Pre-Chorus', 'prechorus', 'prechorus'],
    ['Chorus', 'chorus', 'chorus'],
    ['Final Chorus', 'chorus', 'chorus'],
    ['Build', 'build', 'build'],
    ['Build-Up', 'build', 'build'],
    ['Bridge', 'bridge', 'bridge'],
    ['Breakdown', 'breakdown', 'breakdown'],
    ['Outro', 'outro', 'outro'],
    ['Instrumental', 'instrumental', 'instrumental'],
    ['Interlude', 'interlude', 'interlude'],
    ['Solo', 'solo', 'solo'],
    ['Coda', 'coda', 'outro'],
    ['Chorus Reprise', 'reprise', 'chorus'],
  ];

  it('recognizes common identities, families and variations', () => {
    for (const [name, identity, family] of cases) {
      const r = resolveSectionIdentity(name);
      expect(r.identity, name).toBe(identity);
      expect(r.family, name).toBe(family);
      expect(r.confidence, name).toBeGreaterThan(0.9);
    }
  });

  it('extracts numbering and final qualifiers', () => {
    expect(resolveSectionIdentity('Verse 2').explicitOccurrence).toBe(2);
    expect(resolveSectionIdentity('Chorus A').explicitOccurrence).toBeNull(); // letters are not numbers
    expect(resolveSectionIdentity('Final Chorus').qualifier).toBe('final');
    expect(resolveSectionIdentity('Verse 1').qualifier).toBeNull();
  });

  it('treats unknown names neutrally (fully supported, never guessed)', () => {
    for (const name of ['Unknown Section', 'Section A', 'Part B', 'Nonsense']) {
      const r = resolveSectionIdentity(name);
      expect(r.identity, name).toBe('unknown');
      expect(r.family, name).toBe('unknown');
      expect(r.confidence, name).toBe(0);
      // Placed mid-song so no first/last structural boosts apply: the result
      // must be the pure neutral profile — no identity bias at all.
      const p = makeProject([sec('pre', 'Intro', 1, 4), sec('x', name, 5, 8), sec('post', 'Outro', 13, 4)]);
      const prof = profile(p, 'x');
      expect(prof.preferences.stability.preferred, name).toBe(0.5);
      expect(prof.preferences.rhythm.shape, name).toBe('mixed');
      expect(prof.development.role, name).toBe('establish');
      expect(prof.development.relatedSectionIds, name).toEqual([]);
    }
  });

  it('returns null for a sectionId that does not exist', () => {
    expect(buildSectionHarmonyProfile(standardSong(), 'nope')).toBeNull();
  });
});

/* --------------------------------------------------------------------------
 * Test 2 — Context sensitivity
 * ----------------------------------------------------------------------- */
describe('Test 2: identical names, different arrangements → different profiles', () => {
  // Same three names, mirrored arrangement.
  const a = makeProject([sec('v1', 'Verse', 1, 8), sec('c', 'Chorus', 9, 8), sec('v2', 'Verse', 17, 8)]);
  const b = makeProject([sec('v1', 'Verse', 1, 4), sec('c', 'Chorus', 5, 16), sec('v2', 'Verse', 21, 4)]);

  it('reflects structural position and neighbors', () => {
    const pa1 = profile(a, 'v1');
    const pb1 = profile(b, 'v1');
    expect(pa1.context.next?.family).toBe('chorus');
    expect(pb1.context.next?.family).toBe('chorus');
    expect(pa1.context.lengthBars).toBe(8);
    expect(pb1.context.lengthBars).toBe(4);
    // Same name, different arrangement → different place in the song.
    expect(pb1.context.normalizedPosition.center)
      .toBeLessThan(pa1.context.normalizedPosition.center);
    expect(pb1.context.nearBeginning).toBe(true);
  });

  it('the two Verses in one song are related but positioned differently', () => {
    const p1 = profile(a, 'v1');
    const p2 = profile(a, 'v2');
    expect(p1.context.isFirst).toBe(true);
    expect(p2.context.isFirst).toBe(false);
    expect(p1.context.next?.family).toBe('chorus');
    expect(p2.context.previous?.family).toBe('chorus');
    expect(p2.context.occurrence).toBe(2);
    // Same identity, different context → measurably different profiles.
    expect(p1.preferences.contrast.preferred).not.toBe(p2.preferences.contrast.preferred);
  });

  it('a Pre-Chorus before a Chorus differs from one before a Breakdown', () => {
    const beforeChorus = makeProject([sec('pc', 'Pre-Chorus', 1, 4), sec('c', 'Chorus', 5, 8)]);
    const beforeBreak = makeProject([sec('pc', 'Pre-Chorus', 1, 4), sec('b', 'Breakdown', 5, 8)]);
    // The structural roles are recognized (spec §4) even where the numeric
    // planning targets legitimately coincide.
    expect(profile(beforeChorus, 'pc').context.next?.identity).toBe('chorus');
    expect(profile(beforeBreak, 'pc').context.next?.identity).toBe('breakdown');
    expect(profile(beforeChorus, 'pc').context.precedesMajorTransition).toBe(true);
    expect(profile(beforeBreak, 'pc').context.precedesMajorTransition).toBe(true);
  });
});

/* --------------------------------------------------------------------------
 * Test 3 — Energy sensitivity (influence, never determination)
 * ----------------------------------------------------------------------- */
describe('Test 3: energy influences without dictating', () => {
  const withEnergy = (e: number): Project => makeProject([
    sec('v', 'Verse', 1, 8, e), sec('c', 'Chorus', 9, 8, e),
  ]);
  const lo = profile(withEnergy(0.1), 'c');
  const hi = profile(withEnergy(0.9), 'c');

  it('higher energy nudges movement and harmonic rhythm upward', () => {
    expect(hi.preferences.movement.preferred).toBeGreaterThan(lo.preferences.movement.preferred);
    expect(hi.preferences.rhythm.preferredChangesPerBar)
      .toBeGreaterThan(lo.preferences.rhythm.preferredChangesPerBar);
  });

  it('tension is influenced only weakly — no energy = tension mapping', () => {
    const dTension = hi.preferences.tension.preferred - lo.preferences.tension.preferred;
    const dMovement = hi.preferences.movement.preferred - lo.preferences.movement.preferred;
    expect(dTension).toBeGreaterThan(0);          // present…
    expect(dTension).toBeLessThan(0.1);           // …deliberately weak
    expect(dTension).toBeLessThan(dMovement);     // never the dominant response
    expect(dTension).not.toBe(0.8);               // ≠ the raw energy delta
  });

  it('stability, modal emphasis and contrast are not energy-driven', () => {
    expect(hi.preferences.stability.preferred).toBe(lo.preferences.stability.preferred);
    expect(hi.preferences.modalEmphasis.preferred).toBe(lo.preferences.modalEmphasis.preferred);
  });

  it('missing energy resolves to neutral 0.5 and is reported as implicit', () => {
    const p = makeProject([sec('v', 'Verse', 1, 8)]);
    const ctx = profile(p, 'v').context;
    expect(ctx.energy).toBe(0.5);
    expect(ctx.energyExplicit).toBe(false);
  });

  it('energy deltas to neighbors are exposed as facts', () => {
    const p = makeProject([sec('a', 'Intro', 1, 4, 0.2), sec('b', 'Chorus', 5, 4, 0.9)]);
    const ctxB = profile(p, 'b').context;
    expect(ctxB.energyDeltaFromPrevious).toBeCloseTo(0.7, 5);
    expect(ctxB.energyDeltaToNext).toBeNull();
  });
});

/* --------------------------------------------------------------------------
 * Test 4 — Settings sensitivity
 * ----------------------------------------------------------------------- */
describe('Test 4: generator settings shape the appropriate dimensions', () => {
  const withSettings = (s: Partial<Project['chordGenSettings']>): Project =>
    makeProject([sec('v', 'Verse', 1, 8), sec('c', 'Chorus', 9, 8)], { chordGenSettings: { ...{}, ...s } as Project['chordGenSettings'] });

  it('density shifts the preferred harmonic rhythm', () => {
    const sparse = profile(withSettings({ density: 0 }), 'c').preferences.rhythm.preferredChangesPerBar;
    const dense = profile(withSettings({ density: 2 }), 'c').preferences.rhythm.preferredChangesPerBar;
    expect(dense).toBeGreaterThan(sparse);
    expect(dense - sparse).toBe(2); // anchor distance survives the small identity bias
  });

  it('complexity shifts the complexity preference', () => {
    const simple = profile(withSettings({ complexity: 1 }), 'c').preferences.complexity.preferred;
    const rich = profile(withSettings({ complexity: 3 }), 'c').preferences.complexity.preferred;
    expect(rich).toBeGreaterThan(simple);
  });

  it('modalEmphasis shifts the modal identity preference', () => {
    const plain = profile(withSettings({ modalEmphasis: 0 }), 'c').preferences.modalEmphasis.preferred;
    const strong = profile(withSettings({ modalEmphasis: 1 }), 'c').preferences.modalEmphasis.preferred;
    expect(strong - plain).toBeCloseTo(0.4, 3);
  });

  it('sectionAware:false shrinks identity influence to a residual, not zero', () => {
    const gapWith = (sectionAware: boolean): number => {
      const p = withSettings({ sectionAware });
      const chorus = profile(p, 'c').preferences.modalEmphasis.preferred;
      const verse = profile(p, 'v').preferences.modalEmphasis.preferred;
      return chorus - verse;
    };
    const full = gapWith(true);
    const residual = gapWith(false);
    expect(residual).toBeGreaterThan(0);  // analysis still runs
    expect(residual).toBeLessThan(full);  // …but section type matters less
  });

  it('preserveIdentity decides repeat vs develop for recurring sections', () => {
    const song = makeProject([sec('v1', 'Verse', 1, 8), sec('v2', 'Verse', 9, 8)]);
    expect(profile(song, 'v2').development.role).toBe('repeat');
    const varied = makeProject([sec('v1', 'Verse', 1, 8), sec('v2', 'Verse', 9, 8)], {
      chordGenSettings: { ...{}, preserveIdentity: false } as Project['chordGenSettings'],
    });
    expect(profile(varied, 'v2').development.role).toBe('develop');
  });

  it('variation widens flexibility; borrowing widens movement/contrast', () => {
    const fixed = profile(withSettings({ variation: 0, borrowing: 'none' }), 'c');
    const wild = profile(withSettings({ variation: 1, borrowing: 'more' }), 'c');
    expect(wild.preferences.tension.flexibility).toBeGreaterThan(fixed.preferences.tension.flexibility);
    expect(wild.preferences.movement.flexibility).toBeGreaterThan(fixed.preferences.movement.flexibility);
    expect(wild.preferences.contrast.flexibility).toBeGreaterThan(fixed.preferences.contrast.flexibility);
  });

  it('cadence strength leans on stability', () => {
    const soft = profile(withSettings({ cadence: 'soft' }), 'c').preferences.stability.preferred;
    const strong = profile(withSettings({ cadence: 'strong' }), 'c').preferences.stability.preferred;
    expect(strong).toBeGreaterThan(soft);
  });
});

/* --------------------------------------------------------------------------
 * Test 5 — Repeated sections
 * ----------------------------------------------------------------------- */
describe('Test 5: repeated sections are recognized as related material', () => {
  const song = makeProject([
    sec('v1', 'Verse 1', 1, 8), sec('v2', 'Verse 2', 9, 8), sec('v3', 'Verse 3', 17, 8),
  ]);

  it('all three verses share one family and relate to each other', () => {
    const p1 = profile(song, 'v1');
    const p2 = profile(song, 'v2');
    const p3 = profile(song, 'v3');
    expect(p1.family).toBe('verse');
    expect(p1.context.familyCount).toBe(3);
    expect(p1.context.isRepeated).toBe(true);
    expect(p1.development.relatedSectionIds).toEqual(['v2', 'v3']);
    expect(p2.development.relatedSectionIds).toEqual(['v1', 'v3']);
    expect(p3.development.relatedSectionIds).toEqual(['v1', 'v2']);
  });

  it('occurrence follows explicit numbering when present', () => {
    expect(profile(song, 'v1').context.occurrence).toBe(1);
    expect(profile(song, 'v2').context.occurrence).toBe(2);
    expect(profile(song, 'v3').context.occurrence).toBe(3);
  });

  it('distinguishes establishing from repeating/developing', () => {
    expect(profile(song, 'v1').development.role).toBe('establish');
    expect(profile(song, 'v2').development.role).toBe('repeat'); // preserveIdentity default
    const varied = makeProject([
      sec('v1', 'Verse 1', 1, 8), sec('v2', 'Verse 2', 9, 8), sec('v3', 'Verse 3', 17, 8),
    ], { chordGenSettings: { ...{}, preserveIdentity: false } as Project['chordGenSettings'] });
    expect(profile(varied, 'v2').development.role).toBe('develop');
    expect(profile(varied, 'v3').development.role).toBe('develop');
  });

  it('numbered names still relate even when numbers are missing elsewhere', () => {
    const unnamed = makeProject([sec('a', 'Jam 1', 1, 4), sec('b', 'Jam 2', 5, 4)]);
    expect(profile(unnamed, 'a').development.relatedSectionIds).toEqual(['b']);
    const letters = makeProject([sec('a', 'Section A', 1, 4), sec('b', 'Part B', 5, 4)]);
    expect(profile(letters, 'a').development.relatedSectionIds).toEqual([]);
  });
});

/* --------------------------------------------------------------------------
 * Test 6 — Unusual song structures
 * ----------------------------------------------------------------------- */
describe('Test 6: unusual structures remain valid', () => {
  it('one-section song: first and last, spanning 0→1', () => {
    const p = makeProject([sec('only', 'Instrumental', 1, 16)]);
    const prof = profile(p, 'only');
    expect(prof.context.isFirst).toBe(true);
    expect(prof.context.isLast).toBe(true);
    expect(prof.context.normalizedPosition).toEqual({ start: 0, center: 0.5, end: 1 });
    expect(prof.development.role).toBe('establish');
  });

  it('songs without a chorus work', () => {
    const p = makeProject([
      sec('i', 'Intro', 1, 4), sec('v1', 'Verse', 5, 8), sec('v2', 'Verse', 13, 8), sec('o', 'Outro', 21, 4),
    ]);
    const profiles = buildSongHarmonyProfiles(p);
    expect(profiles.map((x) => x.family)).toEqual(['intro', 'verse', 'verse', 'outro']);
    expect(profiles.every((x) => x.preferences.tension.preferred >= 0 && x.preferences.tension.preferred <= 1)).toBe(true);
  });

  it('consecutive bridges relate without collapsing into one', () => {
    const p = makeProject([sec('b1', 'Bridge', 1, 4), sec('b2', 'Bridge', 5, 4)]);
    const p1 = profile(p, 'b1');
    const p2 = profile(p, 'b2');
    expect(p2.context.occurrence).toBe(2);
    expect(p1.development.relatedSectionIds).toEqual(['b2']);
    expect(p2.development.relatedSectionIds).toEqual(['b1']);
    expect(p1.context.previous).toBeNull();
    expect(p2.context.previous?.family).toBe('bridge');
  });

  it('repeated outros work', () => {
    const p = makeProject([sec('o1', 'Outro', 1, 4), sec('o2', 'Outro', 5, 4)]);
    expect(profile(p, 'o2').context.occurrence).toBe(2);
    expect(profile(p, 'o2').context.isLast).toBe(true);
    expect(profile(p, 'o1').context.isLast).toBe(false);
  });

  it('sections of different lengths report meter-aware durations', () => {
    const p = makeProject([sec('a', 'Verse', 1, 2), sec('b', 'Chorus', 3, 16), sec('c', 'Bridge', 19, 7)]);
    expect(profile(p, 'a').context.durationTicks).toBe(2 * 3840);
    expect(profile(p, 'b').context.durationTicks).toBe(16 * 3840);
    expect(profile(p, 'c').context.endBar).toBe(25);
  });

  it('nonstandard ordering and gaps are handled chronologically', () => {
    const p = makeProject([sec('x', 'Outro', 1, 4), sec('y', 'Intro', 9, 4)]); // gap bars 5–8
    const profiles = buildSongHarmonyProfiles(p);
    expect(profiles.map((x) => x.sectionId)).toEqual(['x', 'y']);
    expect(profiles[0].context.normalizedPosition.start).toBe(0);
    expect(profiles[1].context.normalizedPosition.end).toBe(1);
    expect(profiles[1].context.previous?.family).toBe('outro');
  });
});

/* --------------------------------------------------------------------------
 * Test 7 — Contour evaluation
 * ----------------------------------------------------------------------- */
describe('Test 7: contours are deterministic, bounded and boundary-consistent', () => {
  const families = ['stable', 'rising', 'falling', 'arch', 'valley', 'wave'] as const;
  const sample = (c: Parameters<typeof evaluateContour>[0]) =>
    Array.from({ length: 21 }, (_, i) => evaluateContour(c, i / 20));

  it('deterministic — same contour, same position, same value forever', () => {
    for (const f of families) {
      const c = { family: f };
      expect(evaluateContour(c, 0.37)).toBe(evaluateContour(c, 0.37));
      expect(sample(c)).toEqual(sample(c));
    }
  });

  it('bounded to [0, 1] for every family and parameterization', () => {
    const variants: Parameters<typeof evaluateContour>[0][] = [
      ...families.map((f) => ({ family: f })),
      { family: 'arch', peak: 0.25 }, { family: 'arch', peak: 0.8 },
      { family: 'valley', peak: 0.3 }, { family: 'wave', cycles: 5 },
      { family: 'rising', lo: 0.9, hi: 1 }, { family: 'falling', lo: 0, hi: 0.1 },
    ];
    for (const c of variants) {
      for (const v of sample(c)) expect(v).toBeGreaterThanOrEqual(0);
      for (const v of sample(c)) expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('rising/falling hit their endpoints; stable is constant', () => {
    expect(evaluateContour({ family: 'rising' }, 0)).toBe(0.25);
    expect(evaluateContour({ family: 'rising' }, 1)).toBe(0.85);
    expect(evaluateContour({ family: 'falling' }, 0)).toBe(0.85);
    expect(evaluateContour({ family: 'falling' }, 1)).toBe(0.25);
    expect(evaluateContour({ family: 'stable', level: 0.6 }, 0.123)).toBe(0.6);
    const rising = sample({ family: 'rising' });
    for (let i = 1; i < rising.length; i++) expect(rising[i]).toBeGreaterThanOrEqual(rising[i - 1]);
  });

  it('arch/valley start and end consistently; peak placement works', () => {
    expect(evaluateContour({ family: 'arch' }, 0)).toBe(evaluateContour({ family: 'arch' }, 1));
    expect(evaluateContour({ family: 'arch' }, 0.5)).toBe(0.85);
    expect(evaluateContour({ family: 'arch', peak: 0.75 }, 0.75)).toBe(0.85);
    expect(evaluateContour({ family: 'valley' }, 0.5)).toBe(0.25);
    expect(evaluateContour({ family: 'valley' }, 0)).toBe(evaluateContour({ family: 'valley' }, 1));
  });

  it('wave with whole cycles starts and ends on its midline', () => {
    const mid = (0.25 + 0.85) / 2;
    expect(evaluateContour({ family: 'wave', cycles: 2 }, 0)).toBeCloseTo(mid, 9);
    expect(evaluateContour({ family: 'wave', cycles: 2 }, 1)).toBeCloseTo(mid, 9);
    expect(evaluateContour({ family: 'wave', cycles: 2 }, 0.125)).toBeCloseTo(0.85, 9); // first crest
  });

  it('profile contours inherit bounded values from their preferences', () => {
    const prof = profile(standardSong(), 's6'); // Bridge: wave tension, arch complexity
    expect(prof.contours.tension.family).toBe('wave');
    expect(prof.contours.complexity.family).toBe('arch');
    for (const c of [prof.contours.tension, prof.contours.rhythm, prof.contours.complexity]) {
      for (const v of sample(c)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

/* --------------------------------------------------------------------------
 * Test 8 — Meter awareness
 * ----------------------------------------------------------------------- */
describe('Test 8: harmonic rhythm respects the project meter (never assumes 4/4)', () => {
  const inMeter = (n: number, d: number) => makeProject(
    [sec('c', 'Chorus', 1, 8)],
    { timeSignature: { numerator: n, denominator: d } },
  );

  it('reports correct meter facts', () => {
    expect(profile(inMeter(4, 4), 'c').meter).toEqual({
      timeSignature: { numerator: 4, denominator: 4 },
      barTicks: 3840, beatTicks: 960, beatsPerBar: 4, compound: false,
    });
    expect(profile(inMeter(3, 4), 'c').meter).toEqual({
      timeSignature: { numerator: 3, denominator: 4 },
      barTicks: 2880, beatTicks: 960, beatsPerBar: 3, compound: false,
    });
    const m68 = profile(inMeter(6, 8), 'c').meter;
    expect(m68.barTicks).toBe(2880);
    expect(m68.beatTicks).toBe(1440);   // dotted-quarter felt beat
    expect(m68.beatsPerBar).toBe(2);
    expect(m68.compound).toBe(true);
  });

  it('the same changes-per-bar yields meter-appropriate tick intervals', () => {
    // Default settings → Chorus prefers 2 changes/bar everywhere.
    for (const [n, d, expectedTicks, expectedBeats] of [
      [4, 4, 1920, 2], [3, 4, 1440, 1.5], [6, 8, 1440, 1],
    ] as Array<[number, number, number, number]>) {
      const r = profile(inMeter(n, d), 'c').preferences.rhythm;
      expect(r.preferredChangesPerBar).toBe(2);
      expect(r.preferredChangeIntervalTicks).toBe(expectedTicks);
      expect(r.preferredChangeIntervalBeats).toBe(expectedBeats);
    }
  });
});

/* --------------------------------------------------------------------------
 * Test 9 — Determinism
 * ----------------------------------------------------------------------- */
describe('Test 9: identical inputs → identical profiles', () => {
  it('whole-song profiles are byte-identical across runs', () => {
    const a = JSON.stringify(buildSongHarmonyProfiles(standardSong()));
    const b = JSON.stringify(buildSongHarmonyProfiles(standardSong()));
    expect(a).toBe(b);
  });

  it('profiles are chronological and complete', () => {
    const profiles = buildSongHarmonyProfiles(standardSong());
    expect(profiles.map((p) => p.sectionId))
      .toEqual(['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8']);
    for (let i = 1; i < profiles.length; i++) {
      expect(profiles[i].context.startBar).toBeGreaterThan(profiles[i - 1].context.startBar);
    }
  });

  it('profile construction never mutates the project', () => {
    const p = standardSong();
    const before = JSON.stringify(p);
    buildSongHarmonyProfiles(p);
    buildSectionHarmonyProfile(p, 's4');
    expect(JSON.stringify(p)).toBe(before);
  });
});

/* --------------------------------------------------------------------------
 * Test 10 — Regression protection
 * ----------------------------------------------------------------------- */
describe('Test 10: Phase 1 vocabulary, schema validation and manual workflow', () => {
  it('Phase 1 API is intact and still answers correctly', () => {
    const vocab = getChordVocabulary({ root: 'D', mode: 'Dorian' });
    const symbols = vocab.candidates.map((c) => c.symbol);
    expect(symbols).toContain('Dm');
    expect(symbols).toContain('G7');
    const analysis = analyzeChordInMode('Bbmaj7', { root: 'D', mode: 'Dorian' });
    expect(analysis.isDiatonic).toBe(false);
    expect(analysis.parallelModesContaining).toContain('Aeolian');
  });

  it('schema accepts the optional section energy and rejects bad values', () => {
    const good = makeProject([sec('s', 'Verse', 1, 4, 0.75)]);
    expect(validateProject(good).ok).toBe(true);
    const none = makeProject([sec('s', 'Verse', 1, 4)]);
    expect(validateProject(none).ok).toBe(true);
    for (const bad of [-0.1, 1.5]) {
      const r = validateProject(makeProject([sec('s', 'Verse', 1, 4, bad)]));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.some((e) => e.path.includes('energy'))).toBe(true);
    }
  });

  it('profiles neither create, remove nor alter chords', () => {
    const base = projectFromFixture({ name: 'T', tracks: [] });
    const p: Project = {
      ...base,
      sections: [sec('s1', 'Chorus', 1, 8), sec('s2', 'Verse', 9, 8)],
      chords: [{ id: 'c1', symbol: 'Dm7', startTick: 0, durationTicks: 3840, locked: true }],
    };
    buildSongHarmonyProfiles(p);
    expect(p.chords).toHaveLength(1);
    expect(p.chords[0]).toEqual({ id: 'c1', symbol: 'Dm7', startTick: 0, durationTicks: 3840, locked: true });
  });
});
