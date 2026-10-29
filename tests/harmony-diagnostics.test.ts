/**
 * Harmony diagnostics tests (Phase 4.2, spec §15).
 *
 * The generator's decisions must be fully inspectable WITHOUT changing any of
 * them: identical chords with diagnostics enabled or disabled, no extra PRNG
 * consumption, correct structural-vs-color attribution (a suspension can only
 * ever BE the structural foundation — the color stage cannot introduce one),
 * foundation-identity transition classification, and reports that are plain
 * serializable data.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateChordProgression } from '../src/engine/harmony/generation';
import {
  foundationFactsRecord, serializeHarmonyDiagnostics,
  type HarmonyDiagnosticReport,
} from '../src/engine/harmony/diagnostics';
import { foundationOf } from '../src/engine/harmony/foundation';
import { MODE_NAMES, scalePitchClasses, type ModeName } from '../src/shared/schema/modes';
import {
  projectFromFixture, validateProject,
  type Chord, type Project, type Section,
} from '../src/shared/schema';

const here = path.dirname(fileURLToPath(import.meta.url));
const BT = 960 * 4;

function makeProject(sections: Section[], chords: Chord[], opts: Partial<Project> = {}): Project {
  const base = projectFromFixture({ name: 'DiagTest', tracks: [] });
  return { ...base, sections, chords, ...opts };
}
const sec = (id: string, name: string, startBar: number, lengthBars: number): Section =>
  ({ id, name, startBar, lengthBars });
const chd = (id: string, startTick: number, durationTicks: number, symbol = 'C', locked?: boolean): Chord =>
  ({ id, symbol, startTick, durationTicks, ...(locked !== undefined ? { locked } : {}) });

const verseChorus = (opts: Partial<Project> = {}): Project =>
  makeProject([sec('a', 'Verse', 1, 8), sec('b', 'Chorus', 9, 8)], [], { key: 4, mode: 'Aeolian', ...opts });

/** Deep-walk a value and fail on functions / symbols / circular references. */
function assertPlainData(node: unknown, seen = new Set<object>(), path = '$'): void {
  if (node === null) return;
  if (typeof node !== 'object') {
    expect(['number', 'string', 'boolean']).toContain(typeof node);
    return;
  }
  if (seen.has(node as object)) {
    throw new Error(`Revisited object at ${path} — shared or circular reference`);
  }
  seen.add(node as object);
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) assertPlainData(v, seen, `${path}.${k}`);
  seen.delete(node as object);
}

describe('Phase 4.2 — diagnostics do not change generation (spec §15 Test 1, 2)', () => {
  const projects: Array<[string, Project, number[]]> = [
    ['E Aeolian verse-chorus', verseChorus(), [1, 42, 777]],
    ['sectionless', makeProject([], [], { key: 2, mode: 'Dorian' }), [5, 99]],
    ['locked + manual chords', makeProject(
      [sec('a', 'Intro', 1, 4), sec('b', 'Verse', 5, 8)],
      [chd('m1', 0, BT, 'E', true), chd('m2', 5 * BT, BT, 'F#m7b5'), chd('m3', 9 * BT, 2 * BT, 'Am9', true)],
      { key: 4, mode: 'Aeolian' },
    ), [3, 42]],
    ['Whole Tone', makeProject([sec('a', 'Verse', 1, 8)], [], { key: 9, mode: 'Whole Tone' }), [7]],
  ];

  it('produces deep-equal chord arrays with diagnostics on or off', () => {
    for (const [label, project, seeds] of projects) {
      for (const seed of seeds) {
        const normal = generateChordProgression(project, { scope: { type: 'all' }, seed });
        const diagnostic = generateChordProgression(project, { scope: { type: 'all' }, seed, diagnostics: true });
        expect(diagnostic.chords, `${label} seed ${seed}`).toEqual(normal.chords);
        expect(diagnostic.report, `${label} seed ${seed} (report)`).toEqual(normal.report);
      }
    }
  });

  it('attaches diagnostics only when requested', () => {
    const project = verseChorus();
    const normal = generateChordProgression(project, { seed: 42 });
    expect(normal.diagnostics).toBeUndefined();
    const diagnostic = generateChordProgression(project, { seed: 42, diagnostics: true });
    expect(diagnostic.diagnostics).toBeDefined();
  });

  it('consumes no extra PRNG values — repeated diagnostic runs are identical', () => {
    const project = verseChorus();
    for (const seed of [1, 2, 3, 42, 0xbeef]) {
      const a = generateChordProgression(project, { seed, diagnostics: true });
      const b = generateChordProgression(project, { seed, diagnostics: true });
      expect(b.chords).toEqual(a.chords);
      // And the diagnostic run still equals the plain run for the same seed.
      const plain = generateChordProgression(project, { seed });
      expect(a.chords).toEqual(plain.chords);
    }
  });
});

describe('Phase 4.2 — all modes and scopes (spec §15 Test 3)', () => {
  it('generates inspectable diagnostics across all twelve modes', () => {
    for (const mode of MODE_NAMES as ModeName[]) {
      const project = makeProject([sec('a', 'Verse', 1, 8), sec('b', 'Chorus', 9, 8)], [], { key: 6, mode });
      const plain = generateChordProgression(project, { seed: 11 });
      const diag = generateChordProgression(project, { seed: 11, diagnostics: true });
      expect(diag.chords).toEqual(plain.chords);
      const report = diag.diagnostics!;
      expect(report.context.mode).toBe(mode);
      expect(report.planning.pool.foundations.length).toBe(report.planning.pool.size);
      expect(report.structure.slots.length).toBeGreaterThan(0);
      expect(report.color.length).toBeGreaterThan(0);
      // Report is plain serializable data in every mode.
      expect(() => serializeHarmonyDiagnostics(report)).not.toThrow();
    }
  });

  it('supports section and empty scopes with diagnostics', () => {
    const project = verseChorus();
    for (const scope of [{ type: 'section', sectionId: 'b' }, { type: 'empty' }] as const) {
      const plain = generateChordProgression(project, { seed: 8, scope });
      const diag = generateChordProgression(project, { seed: 8, scope, diagnostics: true });
      expect(diag.chords).toEqual(plain.chords);
      expect(diag.diagnostics!.context.scope).toEqual(scope);
    }
  });
});

describe('Phase 4.2 — chromatic decisions are traceable (spec §15 Test 4)', () => {
  it('reports the chromatic pool and the exact facts for non-diatonic selections', () => {
    const project = makeProject(
      [sec('a', 'Verse', 1, 8), sec('b', 'Chorus', 9, 8)],
      [], { key: 4, mode: 'Aeolian', chordGenSettings: { ...projectFromFixture({}).chordGenSettings!, borrowing: 'more' } },
    );
    let found = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const { diagnostics: report } = generateChordProgression(project, { seed, diagnostics: true });
      // Pool-level facts: chromatic foundations are visible with provenance.
      const chromatic = report.planning.pool.foundations.filter((f) => !f.diatonic);
      expect(chromatic.length).toBeGreaterThan(0);
      const scaleRoots = new Set(scalePitchClasses(4, 'Aeolian'));
      for (const f of chromatic) {
        expect(f.nonDiatonicCoreNames.length).toBeGreaterThan(0);
        // A chromatic CORE may still sit on a diatonic root (e.g. F# major in
        // E Aeolian): scaleDegree is null only when the ROOT is chromatic.
        if (!scaleRoots.has(f.rootPc)) expect(f.scaleDegree).toBeNull();
      }
      // Selection-level facts for every non-diatonic slot decision.
      for (const slot of report.structure.slots) {
        if (slot.selected.diatonic) continue;
        found += 1;
        expect(slot.selected.nonDiatonicCorePcs.length).toBeGreaterThan(0);
        expect(slot.chromaticDeparture === false || slot.previousFoundation !== null).toBe(true);
        if (slot.relationshipToPrevious !== null) {
          expect(Math.abs(slot.relationshipToPrevious.rootMovementSemitones)).toBeLessThanOrEqual(6);
        }
      }
      // Color-level facts: chromatic tones are reported per emitted symbol.
      for (const ev of report.color) {
        if (!ev.operation.chromaticNotesIntroduced) continue;
        expect(ev.operation.nonDiatonicPcs.length).toBeGreaterThan(0);
      }
    }
    expect(found).toBeGreaterThan(0);
  });
});

describe('Phase 4.2 — structural vs color attribution (spec §15 Test 5)', () => {
  it('never lets the color stage introduce a suspension or replace a third', () => {
    // Architectural invariant of the two-stage separation: a suspension is a
    // FOUNDATION (its own core), so any emitted sus symbol must sit on a
    // suspended foundation, and the color operation must be non-replacing.
    const project = verseChorus();
    let susEvents = 0;
    let susFoundations = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { diagnostics: report } = generateChordProgression(project, { seed, diagnostics: true });
      for (const ev of report.color) {
        if (!/sus/.test(ev.symbol)) continue;
        susEvents += 1;
        expect(ev.foundationLabel).toMatch(/suspended/);
        expect(ev.operation.suspensionIntroduced).toBe(false);
        expect(ev.operation.thirdReplaced).toBe(false);
      }
      for (const slot of report.structure.slots) {
        if (slot.selected.quality === 'suspended') susFoundations += 1;
      }
      for (const ev of report.color) {
        // The color stage never alters the foundation it expresses.
        const core = foundationOf(ev.symbol);
        expect(core).not.toBeNull();
        expect(`${core!.rootPc}|${core!.corePitchClasses.join('.')}`).toBe(ev.foundationId);
      }
    }
    expect(susEvents).toBeGreaterThan(0);
    expect(susFoundations).toBeGreaterThan(0);
  });
});

describe('Phase 4.2 — phrase and section association (spec §15 Test 6)', () => {
  it('associates every generated event with its section and phrase', () => {
    const project = verseChorus();
    const { chords, diagnostics: report } = generateChordProgression(project, { seed: 42, diagnostics: true });
    const generated = chords.filter((c) => !project.chords.some((p) => p.id === c.id));
    expect(generated.length).toBe(report.color.length);
    // Every generated event has a structural slot record with phrase info.
    for (const c of generated) {
      const slot = report.structure.slots.find((s) => s.startTick === c.startTick);
      expect(slot, `slot at ${c.startTick}`).toBeDefined();
      if (slot!.phraseId !== null) {
        const phrase = report.planning.phrases.find((p) => p.id === slot!.phraseId);
        expect(phrase, `phrase ${slot!.phraseId}`).toBeDefined();
        expect(phrase!.sectionId).toBe(slot!.sectionId);
        const section = project.sections.find((s) => s.id === slot!.sectionId);
        expect(section).toBeDefined();
        const startBar = Math.floor(c.startTick / BT) + 1;
        expect(startBar).toBeGreaterThanOrEqual(section!.startBar);
        expect(startBar).toBeLessThan(section!.startBar + section!.lengthBars);
      }
    }
    // Rhythm slot records cover the same span and reference planned phrases.
    for (const rs of report.rhythm.slots) {
      if (rs.phraseId !== null) {
        expect(report.planning.phrases.some((p) => p.id === rs.phraseId)).toBe(true);
      }
    }
  });
});

describe('Phase 4.2 — locked and preserved chords (spec §15 Test 7)', () => {
  it('reports preserved chords accurately and leaves them untouched', () => {
    const project = makeProject(
      [sec('a', 'Intro', 1, 4), sec('b', 'Verse', 5, 8)],
      [chd('k1', 0, BT, 'E', true), chd('k2', 8 * BT, 2 * BT, 'Am9')],
      { key: 4, mode: 'Aeolian' },
    );
    const plain = generateChordProgression(project, { seed: 6 });
    const { chords, diagnostics: report } = generateChordProgression(project, { seed: 6, diagnostics: true });
    expect(chords).toEqual(plain.chords);

    // Preserved (locked) events keep identity, symbol, timing and lock flag.
    // Scope 'all' preserves LOCKED chords; unlocked ones are regenerated.
    for (const original of project.chords.filter((c) => c.locked)) {
      const kept = chords.find((c) => c.id === original.id);
      expect(kept).toBeDefined();
      expect(kept!.symbol).toBe(original.symbol);
      expect(kept!.startTick).toBe(original.startTick);
      expect(kept!.durationTicks).toBe(original.durationTicks);
      expect(kept!.locked).toBe(original.locked);
    }
    // Context layer lists them with locked flags; anchors are named.
    const lockedInContext = report.context.existingChords.filter((c) => c.locked);
    expect(lockedInContext.map((c) => c.id)).toEqual(['k1']);
    expect(report.context.existingChords.length).toBe(project.chords.length);
    // No generated event overlaps a locked span.
    const lockedSpans = project.chords.filter((c) => c.locked)
      .map((c) => ({ start: c.startTick, end: c.startTick + c.durationTicks }));
    for (const slot of report.structure.slots) {
      for (const span of lockedSpans) {
        const overlaps = slot.startTick < span.end && slot.startTick + slot.durationTicks > span.start;
        expect(overlaps).toBe(false);
      }
    }
  });
});

describe('Phase 4.2 — report serialization (spec §15 Test 8)', () => {
  it('is plain data: no functions, no circular references, stable JSON round-trip', () => {
    const project = verseChorus();
    const { diagnostics: report } = generateChordProgression(project, { seed: 42, diagnostics: true });
    assertPlainData(report);
    const json = serializeHarmonyDiagnostics(report);
    const parsed = JSON.parse(json) as HarmonyDiagnosticReport;
    expect(parsed).toEqual(report);
  });
});

describe('Phase 4.2 — disabled by default (spec §15 Test 9)', () => {
  it('collects nothing when diagnostics are not requested', () => {
    const project = verseChorus();
    const plain = generateChordProgression(project, { seed: 42 });
    // The observable contract: no diagnostics property on the result, and the
    // classic report shape is unchanged (no deep-report payload inside it).
    expect('diagnostics' in plain).toBe(false);
    expect(plain.report.structuralFoundations).toBeDefined();
    // The deep report never leaks into the plain report.
    expect('windows' in plain.report).toBe(false);
    expect('slots' in plain.report).toBe(false);
  });
});

describe('Phase 4.2 — E Aeolian example fixture (deliverable 6)', () => {
  it('produces a complete diagnostic report for the documented example project', () => {
    const fixturePath = path.join(here, '..', 'fixtures', 'example-e-aeolian.json');
    const doc = JSON.parse(readFileSync(fixturePath, 'utf8')) as Partial<Project>;
    const validation = validateProject(projectFromFixture(doc));
    expect(validation.ok).toBe(true);
    const project = projectFromFixture(doc);
    const { diagnostics: report } = generateChordProgression(project, { seed: 42, diagnostics: true });
    expect(report.context.keyName).toBe('E');
    expect(report.context.mode).toBe('Aeolian');
    expect(report.planning.sections.map((s) => s.sectionName)).toEqual(['Verse', 'Chorus']);
    // Every layer is populated.
    expect(report.planning.phrases.length).toBeGreaterThan(0);
    expect(report.rhythm.slots.length).toBeGreaterThan(0);
    expect(report.structure.windows.length).toBeGreaterThan(0);
    expect(report.structure.slots.length).toBeGreaterThan(0);
    expect(report.color.length).toBeGreaterThan(0);
    expect(report.transitions.length).toBe(report.color.length - 1);
    // Foundation facts round-trip against the shared foundation model.
    for (const f of report.planning.pool.foundations) {
      expect(f.id).toBe(`${f.rootPc}|${f.corePitchClasses.join('.')}`);
      expect(f.label).toBe(foundationLabelMatches(f));
    }
  });
});

/** Label form used by foundationLabel (kept local to avoid an import cycle). */
function foundationLabelMatches(f: { rootPc: number; quality: string; corePitchClasses: number[] }): string {
  const names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const base = `${names[f.rootPc]} ${f.quality}`;
  return f.quality === 'other'
    ? `${base}[${f.corePitchClasses.map((p) => names[p]).join(',')}]`
    : base;
}

// Re-export for readers: the facts helper is exercised indirectly above.
void foundationFactsRecord;
