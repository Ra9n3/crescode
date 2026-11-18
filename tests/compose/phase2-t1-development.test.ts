/**
 * Phase 2 - T1: Genuine thematic development.
 *
 * These tests hold the MATERIAL LAYER to its declared transformation semantics
 * and its lineage contract. They are written against
 * `statementDegrees`/`statementDurations` (the material layer) rather than
 * realized pitches, because `fitDegreeToHarmony` legitimately bends degrees onto
 * chord tones at realization time. Testing identity on realized pitches would be
 * measuring the wrong layer and would pressure the realization to stop being
 * harmonic.
 *
 * What these prove: every exposed operation has a defined, testable effect and
 * declared invariants; there are no dead or falsely-implemented operations;
 * transposition magnitude varies with musical context; planned sequences move
 * consistently; lineage is multi-generational and never points forward or in a
 * cycle; and phrase position changes the developmental plan.
 *
 * What they CANNOT prove: that the development is musically convincing. That is
 * a listening judgement made in the DAW against the UVI library. No test here is
 * presented as evidence of musical quality.
 */
import { describe, expect, it } from 'vitest';
import dorian from '../../fixtures/dorian-16bars.json';
import threeChorus from '../../fixtures/three-chorus-40bars.json';
import { projectFromFixture, type Project } from '../../src/shared/schema';
import { composeOrchestra } from '../../src/compose';
import {
  durationsForOp,
  generateMotif,
  makeRng,
  stateMotif,
  statementDegrees,
  statementDurations,
} from '../../src/compose/material';
import type { DevelopmentOp, Motif, MotifStatement } from '../../src/compose/ir';

const FIXTURES = [
  ['dorian-16bars', dorian],
  ['three-chorus-40bars', threeChorus],
] as const;

function compose(fixture: unknown, seed = 1) {
  const project = projectFromFixture(JSON.parse(JSON.stringify(fixture)) as Project);
  project.ensemble = { templateId: 'ensemble.chamber', overrides: {}, pins: {} };
  return composeOrchestra(project, { seed, take: 1 }).score;
}

/** A motif from a known rhythm cell, so duration invariants are exact. */
function fixedMotif(): Motif {
  const project = projectFromFixture(JSON.parse(JSON.stringify(dorian)) as Project);
  for (let attempt = 0; attempt < 200; attempt++) {
    const motif = generateMotif(project, makeRng(1000 + attempt), 960, 1);
    if (motif.id.startsWith('motif-arch')) return motif;
  }
  throw new Error('arch cell not reachable');
}

const SCALE = 7;
const MIN_TICKS = 480;

const OPS: readonly DevelopmentOp[] = [
  'identity',
  'transpose',
  'invert',
  'fragment',
  'augment',
  'diminish',
  'displace',
];

function render(motif: Motif, op: DevelopmentOp, shift = 0) {
  const statement = stateMotif(motif, op, 0, shift, 0, null, { minTicks: MIN_TICKS });
  return {
    degrees: statementDegrees(motif, statement, SCALE),
    durations: [...statementDurations(motif, statement, MIN_TICKS)],
  };
}

const intervals = (degrees: readonly number[]): number[] =>
  degrees.slice(1).map((degree, index) => degree - degrees[index]);

describe('T1 - transformation semantics', () => {
  it('reorchestrate is gone from the material layer', () => {
    expect(OPS).not.toContain('reorchestrate' as DevelopmentOp);
    for (const [, fixture] of FIXTURES) {
      const score = compose(fixture, 1);
      const notes = score.statements.map((statement) => statement.note).join(' ');
      expect(notes).not.toContain('new colour');
    }
  });

  it('identity preserves intervals and rhythm exactly', () => {
    const motif = fixedMotif();
    const out = render(motif, 'identity');
    expect(out.degrees).toEqual([...motif.degrees]);
    expect(out.durations).toEqual([...motif.durations]);
  });

  it('transpose changes register only: intervals and rhythm preserved', () => {
    const motif = fixedMotif();
    const base = render(motif, 'identity');
    const up = render(motif, 'transpose', 3);
    expect(intervals(up.degrees)).toEqual(intervals(base.degrees));
    expect(up.durations).toEqual(base.durations);
    expect(up.degrees).not.toEqual(base.degrees);
    expect(up.degrees.map((degree, index) => degree - base.degrees[index]))
      .toEqual(base.degrees.map(() => 3));
  });

  it('invert mirrors direction while preserving interval magnitudes', () => {
    const motif = fixedMotif();
    const base = render(motif, 'identity');
    const inverted = render(motif, 'invert');
    expect(inverted.durations).toEqual(base.durations);
    const baseIntervals = intervals(base.degrees);
    const invIntervals = intervals(inverted.degrees);
    expect(invIntervals.map(Math.abs)).toEqual(baseIntervals.map(Math.abs));
    expect(invIntervals).toEqual(baseIntervals.map((value) => -value));
  });

  it('fragment shortens the cell and keeps its opening', () => {
    const motif = fixedMotif();
    const base = render(motif, 'identity');
    const fragment = render(motif, 'fragment');
    expect(fragment.degrees.length).toBeLessThan(base.degrees.length);
    expect(fragment.degrees).toEqual(base.degrees.slice(0, fragment.degrees.length));
    expect(fragment.durations).toEqual(base.durations.slice(0, fragment.durations.length));
  });

  it('augment doubles durations and preserves pitch material', () => {
    const motif = fixedMotif();
    const base = render(motif, 'identity');
    const augmented = render(motif, 'augment');
    expect(augmented.degrees).toEqual(base.degrees);
    expect(augmented.durations).toEqual(base.durations.map((d) => d * 2));
  });

  it('diminish halves durations, preserves pitches, and never degenerates', () => {
    const motif = fixedMotif();
    const base = render(motif, 'identity');
    const diminished = render(motif, 'diminish');
    expect(diminished.degrees).toEqual(base.degrees);
    expect(diminished.durations.every((d, index) => d < base.durations[index])).toBe(true);
    expect(diminished.durations.every((d) => d >= MIN_TICKS)).toBe(true);
    expect(diminished.durations.every((d) => Number.isInteger(d) && d > 0)).toBe(true);
  });

  it('diminish respects the subdivision floor for very short motifs', () => {
    const tiny: Motif = {
      id: 'motif-tiny-1',
      degrees: [0, 1, 2],
      durations: [120, 120, 240],
      lengthTicks: 480,
      originBar: 1,
    };
    expect(durationsForOp(tiny, 'diminish', MIN_TICKS).every((d) => d >= MIN_TICKS)).toBe(true);
  });

  it('displace is genuine metric reorientation: pitches and durations preserved', () => {
    const motif = fixedMotif();
    const base = render(motif, 'identity');
    const displaced = render(motif, 'displace');
    expect(displaced.degrees).toEqual(base.degrees);
    expect(displaced.durations).toEqual(base.durations);
    const onBeat = stateMotif(motif, 'identity', 3840, 0, 0, null, { minTicks: MIN_TICKS });
    const offBeat = stateMotif(motif, 'displace', 3840, 0, 1, null, { minTicks: MIN_TICKS });
    expect(offBeat.startTick).toBeGreaterThan(onBeat.startTick);
    expect(offBeat.displacementTicks).toBeGreaterThan(0);
    const pinned = stateMotif(motif, 'displace', 0, 0, 2, null, { minTicks: MIN_TICKS, displacementTicks: 0 });
    expect(pinned.displacementTicks).toBe(0);
    expect(pinned.note).toContain('already off the beat');
  });

  it('every exposed op changes something except the two that declare otherwise', () => {
    const motif = fixedMotif();
    // Compare each op against ITSELF at shift 0, not against a shifted baseline:
    // comparing against shift 2 would make `identity` and `displace` look like
    // changes when the only difference is the transposition we ourselves asked
    // for. This was a bug in the first draft of this test.
    const baseline = render(motif, 'identity', 0);
    for (const op of OPS) {
      // Transposing by zero degrees is, correctly, no transposition at all, so
      // that op is exercised at a real shift. Every other op takes shift 0 so
      // the comparison isolates the operation itself.
      const out = render(motif, op, op === 'transpose' ? 2 : 0);
      const sameMaterial = out.degrees.join(',') === baseline.degrees.join(',');
      const sameRhythm = out.durations.join(',') === baseline.durations.join(',');
      if (op === 'identity' || op === 'displace') {
        // These two DECLARE that pitch and rhythm are untouched. `displace`'s
        // effect is in time, asserted separately above.
        expect(sameMaterial && sameRhythm).toBe(true);
      } else {
        expect(sameMaterial && sameRhythm).toBe(false);
      }
    }
  });

  it('a displace statement never spills outside the phrase that contains it', () => {
    // The offset is bounded by construction; assert it in the composed output,
    // because an unbounded displacement would push notes into the next phrase
    // and break the "every note belongs to its own phrase" invariant.
    for (const [, fixture] of FIXTURES) {
      for (const seed of [1, 2, 3, 7]) {
        const score = compose(fixture, seed);
        const displaced = score.statements.filter((statement) => statement.op === 'displace');
        for (const statement of displaced) {
          const phrase = score.phrases.find((candidate) => candidate.statementIds.includes(statement.id));
          if (!phrase) continue;
          expect(statement.startTick).toBeGreaterThanOrEqual(phrase.startTick);
          expect(statement.endTick).toBeLessThanOrEqual(phrase.endTick);
          expect(statement.displacementTicks).toBeGreaterThan(0);
        }
      }
    }
  });

  it('no statement carries an operation outside the exposed set', () => {
    for (const [, fixture] of FIXTURES) {
      for (const statement of compose(fixture, 1).statements) {
        expect(OPS).toContain(statement.op);
      }
    }
  });
});

describe('T1 - transposition responds to musical context', () => {
  it('magnitude is not a fixed cap across the corpus', () => {
    const magnitudes = new Set<number>();
    for (const [, fixture] of FIXTURES) {
      for (const seed of [1, 2, 3, 7]) {
        for (const statement of compose(fixture, seed).statements) {
          if (statement.op === 'transpose') magnitudes.add(Math.abs(statement.degreesShift));
        }
      }
    }
    expect(magnitudes.size).toBeGreaterThanOrEqual(3);
    expect(Math.max(...magnitudes)).toBeGreaterThan(2);
  });

  it('does not force a particular interval', () => {
    // Deliberately no assertion that any specific value appears: the brief
    // forbids predetermined intervals. Only variety and a usable range.
    for (const [, fixture] of FIXTURES) {
      const shifts = compose(fixture, 1).statements
        .filter((statement) => statement.op === 'transpose')
        .map((statement) => statement.degreesShift);
      if (shifts.length < 2) continue;
      expect(Math.max(...shifts.map(Math.abs))).toBeGreaterThanOrEqual(1);
    }
  });

  it('a planned sequence keeps one direction', () => {
    for (const [, fixture] of FIXTURES) {
      for (const seed of [1, 2, 3, 7]) {
        const score = compose(fixture, seed);
        const byId = new Map(score.statements.map((statement) => [statement.id, statement]));
        for (const phrase of score.phrases) {
          const statements = phrase.statementIds
            .map((id) => byId.get(id))
            .filter((statement): statement is MotifStatement => Boolean(statement));
          const transposed = statements.filter((statement) => statement.op === 'transpose');
          if (transposed.length < 2) continue;
          const signs = transposed.map((statement) => Math.sign(statement.degreesShift));
          expect(signs.every((sign) => sign === signs[0])).toBe(true);
        }
      }
    }
  });

  it('transposition still leaves a connected line', () => {
    for (const [, fixture] of FIXTURES) {
      const score = compose(fixture, 1);
      const lead = score.parts.find((part) => part.trackId.includes('violins1'));
      if (!lead) continue;
      const ordered = [...lead.notes].sort((a, b) => a.startTick - b.startTick);
      const leaps = ordered.slice(1).map((note, index) => Math.abs(note.pitch - ordered[index].pitch));
      if (!leaps.length) continue;
      expect(Math.max(...leaps)).toBeLessThanOrEqual(12);
    }
  });
});

describe('T1 - lineage', () => {
  it('most statements record a parent, and every parent exists and precedes it', () => {
    for (const [, fixture] of FIXTURES) {
      const score = compose(fixture, 1);
      const index = new Map(score.statements.map((statement, position) => [statement.id, position]));
      const withParent = score.statements.filter((statement) => statement.parentStatementId !== null);
      expect(withParent.length).toBeGreaterThan(score.statements.length / 2);
      for (const statement of withParent) {
        const parentPosition = index.get(statement.parentStatementId as string);
        expect(parentPosition).toBeDefined();
        expect(parentPosition as number).toBeLessThan(index.get(statement.id) as number);
      }
    }
  });

  it('lineage reaches multiple generations and terminates without cycles', () => {
    for (const [, fixture] of FIXTURES) {
      const score = compose(fixture, 1);
      const byId = new Map(score.statements.map((statement) => [statement.id, statement]));
      let deepest = 0;
      for (const statement of score.statements) {
        let depth = 0;
        let cursor: MotifStatement | undefined = statement;
        const seen = new Set<string>();
        while (cursor && cursor.parentStatementId) {
          expect(seen.has(cursor.id)).toBe(false);
          seen.add(cursor.id);
          cursor = byId.get(cursor.parentStatementId);
          depth++;
          expect(depth).toBeLessThan(1000);
        }
        deepest = Math.max(deepest, depth);
      }
      expect(deepest).toBeGreaterThanOrEqual(3);
    }
  });

  it('every lineage chain reaches a real motif', () => {
    for (const [, fixture] of FIXTURES) {
      const score = compose(fixture, 1);
      const byId = new Map(score.statements.map((statement) => [statement.id, statement]));
      const motifIds = new Set(score.motifs.map((motif) => motif.id));
      for (const statement of score.statements) {
        let cursor: MotifStatement | undefined = statement;
        while (cursor) {
          expect(motifIds.has(cursor.motifId)).toBe(true);
          cursor = cursor.parentStatementId ? byId.get(cursor.parentStatementId) : undefined;
        }
      }
    }
  });
});

describe('T1 - phrase position shapes the developmental plan', () => {
  it('the two phrases of a multi-phrase section never share an identical plan', () => {
    for (const [, fixture] of FIXTURES) {
      const score = compose(fixture, 1);
      const byId = new Map(score.statements.map((statement) => [statement.id, statement]));
      const bySection = new Map<string, string[][]>();
      for (const phrase of score.phrases) {
        const plan = phrase.statementIds.map((id) => byId.get(id)?.op ?? '?');
        const list = bySection.get(phrase.sectionId) ?? [];
        list.push(plan);
        bySection.set(phrase.sectionId, list);
      }
      let compared = 0;
      for (const plans of bySection.values()) {
        if (plans.length < 2) continue;
        compared++;
        expect(plans[0].join(',')).not.toBe(plans[1].join(','));
      }
      expect(compared).toBeGreaterThan(0);
    }
  });

  it('later phrases develop earlier material rather than starting from nothing', () => {
    for (const [, fixture] of FIXTURES) {
      const score = compose(fixture, 1);
      const byId = new Map(score.statements.map((statement) => [statement.id, statement]));
      const phrasePosition = new Map(score.phrases.map((phrase, position) => [phrase.id, position]));
      let linked = 0;
      for (const phrase of score.phrases) {
        const first = phrase.statementIds[0] ? byId.get(phrase.statementIds[0]) : undefined;
        if (!first || !first.parentStatementId) continue;
        const parent = byId.get(first.parentStatementId);
        if (!parent) continue;
        const parentPosition = score.phrases.findIndex(
          (candidate) => candidate.statementIds.includes(parent.id),
        );
        if (parentPosition >= 0 && parentPosition < (phrasePosition.get(phrase.id) ?? 0)) linked++;
      }
      expect(linked).toBeGreaterThan(0);
    }
  });
});

describe('T1 - Phase 1 preservation', () => {
  it('the cross-section antecedent/consequent pair is untouched', () => {
    for (const [, fixture] of FIXTURES) {
      const score = compose(fixture, 1);
      const linked = score.phrases.filter((phrase) => phrase.answersPhraseId !== null);
      expect(linked.length).toBe(1);
      const consequent = linked[0];
      const antecedent = score.phrases.find((phrase) => phrase.id === consequent.answersPhraseId);
      expect(antecedent).toBeDefined();
      if (!antecedent) return;
      const sections = score.sections;
      const left = sections.findIndex((section) => section.id === antecedent.sectionId);
      const right = sections.findIndex((section) => section.id === consequent.sectionId);
      expect(right).toBe(left + 1);
      expect(consequent.startTick).toBe(antecedent.endTick);
    }
  });

  it('strong-beat harmonic compatibility is not regressed', () => {
    for (const [, fixture] of FIXTURES) {
      const score = compose(fixture, 1);
      const lead = score.parts.find((part) => part.trackId.includes('violins1'));
      if (!lead) continue;
      let strong = 0;
      let chordTone = 0;
      for (const note of lead.notes) {
        if (note.startTick % (score.grid.beatTicks * 2) !== 0) continue;
        strong++;
        const span = score.harmony.find(
          (candidate) => note.startTick >= candidate.startTick && note.startTick < candidate.endTick,
        );
        if (span && span.pitchClasses.includes(((note.pitch % 12) + 12) % 12)) chordTone++;
      }
      if (!strong) continue;
      expect(chordTone / strong).toBeGreaterThanOrEqual(0.95);
    }
  });

  it('every note keeps its own phrase and every part stays in its declared register', () => {
    for (const [, fixture] of FIXTURES) {
      const score = compose(fixture, 1);
      const windows = new Map(score.phrases.map((phrase) => [phrase.id, phrase]));
      for (const part of score.parts) {
        const pitches = part.notes.map((note) => note.pitch);
        expect(Math.min(...pitches)).toBeGreaterThan(part.register.low);
        expect(Math.max(...pitches)).toBeLessThan(part.register.high);
        for (const note of part.notes) {
          const phrase = windows.get(note.phraseId);
          if (!phrase) continue;
          expect(note.startTick).toBeGreaterThanOrEqual(phrase.startTick);
          expect(note.startTick + note.durationTicks).toBeLessThanOrEqual(phrase.endTick);
        }
      }
    }
  });

  it('the same seed reproduces the same music', () => {
    for (const [, fixture] of FIXTURES) {
      const signature = (): string => compose(fixture, 1).parts
        .map((part) => part.notes.map((note) => `${note.startTick}/${note.pitch}/${note.durationTicks}`).join(','))
        .join('|');
      expect(signature()).toBe(signature());
    }
  });

  it('different seeds still produce different development', () => {
    for (const [, fixture] of FIXTURES) {
      const opSignature = (seed: number): string =>
        compose(fixture, seed).statements.map((statement) => statement.op).join(',');
      expect(new Set([1, 2, 3, 7].map(opSignature)).size).toBeGreaterThan(1);
    }
  });
});
