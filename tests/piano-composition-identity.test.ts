/**
 * Stage 2: Composition Identity.
 *
 * One identity is drawn per generation and every part of the Piano piece is
 * written from it. These tests pin the rules of that draw (determinism, take
 * walk, density independence, template limits) and the production contract of
 * the identity composer. Classic behaviour is pinned separately by
 * tests/piano-variation-baseline.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PIANO_COMPOSITION_MODE, PIANO_ARCHETYPES, PIANO_IDENTITY_TEMPLATE_LIMITS, archetypeOrderForCycle,
  derivePianoCompositionIdentity, validatePianoCompositionIdentity, type PianoArchetype,
} from '../src/orchestrator/keys/piano-composition-identity';
import { pianoIdentityTemplateFacts } from '../src/orchestrator/keys/piano-texture-theme';
import { PIANO_TEMPLATES, runPianoCell, type PianoCell } from './piano-variation-support';

const TEMPLATE_IDENTITY = {
  chamber: 'chamber-counterpoint', sonata: 'sonata-dialogue', vocalbacking: 'vocal-space',
  cinematic: 'cinematic-expanse', hybridstudio: 'hybrid-pulse-and-color',
} as const;
const identities = Object.values(TEMPLATE_IDENTITY);
/** Archetypes a template allows (the limits table holds a weight per allowed archetype). */
const allowedFor = (template: string): PianoArchetype[] =>
  PIANO_ARCHETYPES.filter((name) => (PIANO_IDENTITY_TEMPLATE_LIMITS[template].archetypes[name] ?? 0) > 0);
/** `takeIndex` counts Compose All presses from 0; the identity request carries the take about to be written (from 1). */
const derive = (template: (typeof identities)[number], projectSeed: number, takeIndex: number, compositionSeed = projectSeed * 31 + takeIndex) =>
  derivePianoCompositionIdentity({ projectSeed, take: takeIndex + 1, compositionSeed, template: pianoIdentityTemplateFacts(template) });
const cell = (overrides: Partial<PianoCell> = {}): PianoCell => ({
  template: 'chamber', fixture: 'dorian-16bars', standalone: false, transpose: 0, density: 1, seed: 1, take: 0, mode: 'identity', ...overrides,
});
const identityOf = (overrides: Partial<PianoCell> = {}) => runPianoCell(cell(overrides)).result.pianoDiagnostics!.identity!;

describe('Piano Composition Identity: the draw', () => {
  it('is the production default, and Classic is a separate explicit mode', () => {
    expect(DEFAULT_PIANO_COMPOSITION_MODE).toBe('identity');
    const identity = runPianoCell(cell()).result.pianoDiagnostics!;
    const classic = runPianoCell(cell({ mode: 'classic' })).result.pianoDiagnostics!;
    const unspecified = runPianoCell(cell({ mode: undefined })).result.pianoDiagnostics!;
    expect(identity.algorithm).toBe('piano-composition-identity-v1');
    expect(identity.identity).toBeDefined();
    expect(unspecified.algorithm).toBe('piano-composition-identity-v1');
    expect(classic.algorithm).toBe('piano-texture-theme-v1');
    expect('identity' in classic).toBe(false);
  });

  it('gives the same identity for the same seed and take, as an immutable value', () => {
    for (const template of identities) for (const seed of [0, 1, 11, 29, 104729]) for (const take of [0, 1, 5]) {
      const first = derive(template, seed, take);
      expect(JSON.stringify(derive(template, seed, take))).toBe(JSON.stringify(first));
      expect(Object.isFrozen(first)).toBe(true);
      expect(Object.isFrozen(first.theme)).toBe(true);
    }
  });

  it('only draws archetypes the template allows, and every allowed archetype is reachable', () => {
    for (const template of identities) {
      const allowed = allowedFor(template);
      const seen = new Set<PianoArchetype>();
      for (let seed = 0; seed < 40; seed++) for (let take = 0; take < allowed.length; take++) {
        const archetype = derive(template, seed, take).archetype;
        expect(allowed, `${template} seed ${seed} take ${take}`).toContain(archetype);
        expect(PIANO_ARCHETYPES).toContain(archetype);
        seen.add(archetype);
      }
      expect([...seen].sort(), template).toEqual([...allowed].sort());
    }
  });

  it('walks successive takes through every allowed archetype before any repeats', () => {
    for (const template of identities) {
      const size = allowedFor(template).length;
      for (const seed of [0, 1, 2, 11, 29, 977]) for (const cycle of [0, 1, 2]) {
        const drawn = Array.from({ length: size }, (_, index) => derive(template, seed, cycle * size + index));
        expect(new Set(drawn.map((item) => item.archetype)).size, `${template} seed ${seed} cycle ${cycle}`).toBe(size);
        drawn.forEach((item, index) => {
          expect(item.generation.cycle).toBe(cycle);
          expect(item.generation.positionInCycle).toBe(index);
          expect(item.generation.takeIndex).toBe(cycle * size + index);
          expect(item.generation.projectSeed).toBe(seed);
        });
      }
    }
  });

  it('never opens a new cycle with the archetype the previous cycle ended on', () => {
    for (const template of identities) {
      const size = allowedFor(template).length;
      for (let seed = 0; seed < 60; seed++) for (const cycle of [1, 2, 3]) {
        expect(derive(template, seed, cycle * size).archetype, `${template} seed ${seed} cycle ${cycle}`)
          .not.toBe(derive(template, seed, cycle * size - 1).archetype);
      }
    }
  });

  it('orders the archetypes differently for different seeds and cycles: no fixed rotation', () => {
    for (const template of identities) {
      const allowed = PIANO_IDENTITY_TEMPLATE_LIMITS[template].archetypes;
      const bySeed = new Set(Array.from({ length: 60 }, (_, seed) => archetypeOrderForCycle(seed, allowed, 0).join('>')));
      const byCycle = new Set(Array.from({ length: 12 }, (_, cycle) => archetypeOrderForCycle(7, allowed, cycle).join('>')));
      expect(bySeed.size, `${template} orders across seeds`).toBeGreaterThanOrEqual(3);
      expect(byCycle.size, `${template} orders across cycles`).toBeGreaterThanOrEqual(2);
    }
  });

  it('draws coordinated, compatible identities: the compatibility rules hold for every template, seed and take', { timeout: 60_000 }, () => {
    let checked = 0;
    for (const template of identities) {
      const facts = pianoIdentityTemplateFacts(template);
      for (let seed = 0; seed < 150; seed++) for (let take = 0; take < 8; take++) {
        const identity = derivePianoCompositionIdentity({ projectSeed: seed, take: take + 1, compositionSeed: seed * 7919 + take * 104729, template: facts });
        expect(validatePianoCompositionIdentity(identity, facts), `${template} seed ${seed} take ${take}: ${identity.description}`).toEqual([]);
        expect(identity.protectedTraits.length).toBeGreaterThanOrEqual(2);
        expect(identity.protectedTraits.length).toBeLessThanOrEqual(3);
        expect(identity.description.length).toBeGreaterThan(40);
        checked++;
      }
    }
    expect(checked).toBe(identities.length * 150 * 8);
  });

  it('varies more than the archetype: the same archetype is drawn with different themes, rhythms and accompaniments', () => {
    for (const template of identities) {
      const byArchetype = new Map<string, Set<string>>();
      for (let seed = 0; seed < 80; seed++) for (let take = 0; take < 4; take++) {
        const identity = derive(template, seed, take, seed * 7919 + take * 104729);
        const key = `${identity.theme.contour}/${identity.theme.headRhythm}/${identity.accompaniment.left}/${identity.accompaniment.right}`;
        byArchetype.set(identity.archetype, (byArchetype.get(identity.archetype) ?? new Set()).add(key));
      }
      for (const [archetype, variants] of byArchetype) expect(variants.size, `${template} ${archetype}`).toBeGreaterThanOrEqual(6);
    }
  });
});

describe('Piano Composition Identity: production Compose All', () => {
  it('composes identically for identical seed and take', () => {
    for (const template of PIANO_TEMPLATES) {
      const first = runPianoCell(cell({ template, take: 2, seed: 11 }));
      const second = runPianoCell(cell({ template, take: 2, seed: 11 }));
      expect(JSON.stringify(second.piano!.notes), template).toBe(JSON.stringify(first.piano!.notes));
      expect(JSON.stringify(second.piano!.cc), template).toBe(JSON.stringify(first.piano!.cc));
      expect(JSON.stringify(second.result.pianoDiagnostics!.identity)).toBe(JSON.stringify(first.result.pianoDiagnostics!.identity));
    }
  });

  it('does not let density change the identity', () => {
    for (const template of PIANO_TEMPLATES) for (const take of [0, 1]) {
      const reference = JSON.stringify(identityOf({ template, take, density: 1 }));
      for (const density of [0.3, 0.6, 0.85]) expect(JSON.stringify(identityOf({ template, take, density })), `${template} take ${take} density ${density}`).toBe(reference);
    }
  });

  it('does not let the rest of the arrangement change the identity', () => {
    for (const template of PIANO_TEMPLATES) {
      expect(JSON.stringify(identityOf({ template, standalone: true })), template).toBe(JSON.stringify(identityOf({ template, standalone: false })));
    }
  });

  it('gives successive Compose All takes different archetypes until the template set is used up', () => {
    for (const template of PIANO_TEMPLATES) for (const seed of [1, 11]) {
      const size = allowedFor(TEMPLATE_IDENTITY[template]).length;
      const drawn = Array.from({ length: size }, (_, take) => identityOf({ template, seed, take }));
      expect(new Set(drawn.map((item) => item.archetype)).size, `${template} seed ${seed}`).toBe(size);
      drawn.forEach((item, take) => expect(item.generation.takeIndex).toBe(take));
      expect(new Set(drawn.map((item) => item.generation.projectSeed)).size, 'the take does not enter the project seed').toBe(1);
    }
  });

  it('keeps template limits authoritative: texture ceiling, playability and a present theme', { timeout: 60_000 }, () => {
    for (const template of PIANO_TEMPLATES) for (const fixture of ['dorian-16bars', 'three-chorus-40bars'] as const) for (const take of [0, 1, 2, 3]) {
      const identityRun = runPianoCell(cell({ template, fixture, take }));
      const classicRun = runPianoCell(cell({ template, fixture, take, mode: 'classic' }));
      const diagnostics = identityRun.result.pianoDiagnostics!;
      const label = `${template} ${fixture} take ${take} (${diagnostics.identity!.archetype})`;
      const ceiling = Math.max(...classicRun.result.pianoDiagnostics!.bars.map((bar) => bar.independentLevel));
      expect(Math.max(...diagnostics.bars.map((bar) => bar.independentLevel)), `${label} texture ceiling`).toBeLessThanOrEqual(Math.max(ceiling, 2));
      if (template === 'vocalbacking') expect(Math.max(...diagnostics.bars.map((bar) => bar.independentLevel)), `${label} vocal ceiling`).toBeLessThanOrEqual(2);
      expect(identityRun.result.pianoPlayability.violations, label).toHaveLength(0);
      expect(diagnostics.theme, label).not.toBeNull();
      expect(diagnostics.theme!.bars, label).toHaveLength(4);
      expect(identityRun.piano!.notes.length, label).toBeGreaterThan(20);
      expect(validatePianoCompositionIdentity(diagnostics.identity!, pianoIdentityTemplateFacts(diagnostics.templateIdentity)), label).toEqual([]);
    }
  });

  it('keeps the theme recognisable through adaptation in every generation, without demanding exact bars', { timeout: 60_000 }, () => {
    for (const template of PIANO_TEMPLATES) for (const fixture of ['dorian-16bars', 'three-chorus-40bars'] as const) for (const take of [0, 1, 2]) {
      const run = runPianoCell(cell({ template, fixture, take }));
      const survival = run.survival!;
      const label = `${template} ${fixture} take ${take}`;
      expect(survival.themeBars, label).toBeGreaterThan(0);
      expect(survival.themeExact + survival.themeTransformed, `${label}: some theme bar survives exactly or transformed`).toBeGreaterThan(0);
      expect(survival.themeExact + survival.themeTransformed + survival.themeLost, label).toBeCloseTo(1, 2);
    }
  });

  it('writes the theme the identity describes: the head rhythm of the plan is the rhythm that sounds', () => {
    for (const template of PIANO_TEMPLATES) for (const take of [0, 1, 2, 3]) {
      const run = runPianoCell(cell({ template, take, standalone: true }));
      const diagnostics = run.result.pianoDiagnostics!;
      const identity = diagnostics.identity!;
      expect(diagnostics.theme!.bars[0].map((note) => note.pos), `${template} take ${take}`).toEqual([...identity.rhythm.cell]);
      const eighth = 480;
      const headBars = diagnostics.bars.filter((bar) => bar.themeBar === 0).map((bar) => bar.bar);
      const windows = run.result.pianoEngineInput.context.barWindows;
      const sounding = headBars.filter((number) => {
        const window = windows.find((item) => item.bar === number)!;
        const attacks = new Set(run.result.pianoScore.events
          .filter((event) => event.startTick >= window.startTick && event.startTick < window.endTick && event.musicalRole === 'melody')
          .map((event) => (event.startTick - window.startTick) / eighth));
        return identity.rhythm.cell.every((slot) => attacks.has(slot));
      });
      expect(sounding.length, `${template} take ${take} (${identity.archetype}): head rhythm ${identity.rhythm.cell.join('.')} sounds in a head bar`).toBeGreaterThan(0);
    }
  });
});
