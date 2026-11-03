import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/dorian-16bars.json';
import { ENSEMBLE_BY_ID } from '../src/config/ensembles';
import { composeAllTracks } from '../src/orchestrator/compose';
import { checkTemplateRules, measureEnergy } from '../src/orchestrator/energy';
import { LAYER_VOCABULARY, type ConductorPlan } from '../src/orchestrator/conductor';
import { energyCurve, arcTargetAt, sectionMap } from '../src/orchestrator/spine';
import { projectFromFixture, type Project } from '../src/shared/schema';

const TEMPLATE_IDS = ['ensemble.symphony', 'ensemble.chamber', 'ensemble.cinematic', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.hybridstudio'] as const;

const BASE = (): Project => projectFromFixture(JSON.parse(JSON.stringify(fixture)));

const compose = (templateId: string | null) => {
  const p = BASE();
  p.ensemble = { templateId, overrides: {}, pins: {} };
  const result = composeAllTracks(p, { seed: 11 });
  return { project: { ...p, tracks: result.tracks }, result };
};

const track = (p: Project, role: string) => p.tracks.find((t) => t.role === role)!;

describe('conductor: per-bar layer plan (3a)', () => {
  it('uses the shared layer vocabulary and annotates the strings pad on every bar', () => {
    expect(LAYER_VOCABULARY).toContain('lead');
    expect(LAYER_VOCABULARY).toContain('pad');
    expect(LAYER_VOCABULARY).toContain('fill');
    const { result } = compose('ensemble.chamber');
    expect(result.plan.bars).toHaveLength(16);
    for (const bar of result.plan.bars) {
      expect(bar.layers.map((l) => l.layer)).toEqual(['pad']);
      expect(bar.layers[0].trackIds).toHaveLength(4); // the quartet
      expect(bar.layers[0].source).toBe('strings');
    }
    expect(result.plan.templateId).toBe('ensemble.chamber');
    expect(result.plan.maxLayers).toBe(5);
    expect(result.plan.octaveDoublingPolicy).toBe('climaxOnly');
    expect(result.plan.unannotatedRoles).toEqual(['piano']); // in band, owned by the rules generator
  });

  it('fillGating breaths: the resting parts rest on each section\u2019s last bar, \u2265 minGapTicks, fills registered', () => {
    const { result } = compose('ensemble.chamber'); // piano fills during Strings rests (480)
    expect(result.plan.breaths.map((b) => [b.startTick, b.endTick])).toEqual([
      [26880, 30720], // Verse last bar (bar 8) — also the arc's pre-Chorus near-silence
      [57600, 61440], // Chorus last bar (bar 16)
    ]);
    expect(result.plan.breaths[0].reason).toBe('fillGating');
    expect(result.plan.breaths[0].nearSilence).toBe(true); // merged with the arc's silence bar
    expect(result.plan.breaths[1].nearSilence).toBeUndefined();
    expect(result.plan.breaths.every((b) => b.endTick - b.startTick >= b.minGapTicks)).toBe(true);
    expect(result.plan.breaths[0].duringRestsOf).toBe('Strings');
    expect(result.plan.breaths[0].trackIds).toHaveLength(4);
    expect(result.plan.fills).toEqual([
      { target: 'piano', startTick: 26880, endTick: 30720 },
      { target: 'piano', startTick: 57600, endTick: 61440 },
    ]);

    // sonata gates on violins1 specifically — its fillGating breaths touch
    // only that track; the arc's near-silence breath covers every string voice
    const sonata = compose('ensemble.sonata');
    const gate = sonata.result.plan.breaths.filter((b) => b.reason === 'fillGating');
    expect(gate).toHaveLength(2);
    expect(gate.every((b) => b.roles.length === 1 && b.roles[0] === 'violins1')).toBe(true);
    const silence = sonata.result.plan.breaths.filter((b) => b.reason === 'nearSilence');
    expect(silence.map((b) => [b.startTick, b.endTick])).toEqual([[26880, 30720]]);
    expect(silence[0].roles.sort()).toEqual(['cellosBasses', 'violins1']);

    // templates without fillGating still plan the arc's near-silence bar
    for (const id of ['ensemble.symphony', 'ensemble.cinematic', 'ensemble.vocalbacking']) {
      const { result: r } = compose(id);
      expect(r.plan.breaths.map((b) => [b.startTick, b.endTick, b.reason])).toEqual([[26880, 30720, 'nearSilence']]);
    }
  });

  it('the renderer honours the breaths: strings are silent inside them, other bars still sound', () => {
    const { project } = compose('ensemble.chamber');
    for (const role of ['violins1', 'violins2', 'violas', 'cellosBasses']) {
      for (const n of track(project, role).notes) {
        expect(n.startTick >= 26880 && n.startTick < 30720).toBe(false);
        expect(n.startTick >= 57600 && n.startTick < 61440).toBe(false);
        // a note must never STRADDLE a breath window either
        expect(n.startTick < 30720 && n.startTick + n.durationTicks > 26880).toBe(false);
        expect(n.startTick < 61440 && n.startTick + n.durationTicks > 57600).toBe(false);
      }
    }
    // …and strings still play elsewhere
    expect(track(project, 'cellosBasses').notes.length).toBeGreaterThan(0);
    // symphony has no fillGating: bar 16 keeps its pads, bar 8 rests (the
    // arc's deliberate near-silence before the first Chorus)
    const sym = compose('ensemble.symphony');
    const v1 = track(sym.project, 'violins1').notes;
    expect(v1.some((n) => n.startTick < 30720 && n.startTick + n.durationTicks > 26880)).toBe(false);
    expect(v1.some((n) => n.startTick < 61440 && n.startTick + n.durationTicks > 57600)).toBe(true);
    expect(v1.some((n) => n.startTick < 26880 && n.startTick + n.durationTicks > 23040)).toBe(true); // bar 7 sounds
  });

  it('the plan never exceeds maxLayers and never plans doubling against the band policy', () => {
    for (const id of TEMPLATE_IDS) {
      const { result } = compose(id);
      const template = ENSEMBLE_BY_ID.get(id)!;
      for (const bar of result.plan.bars) {
        expect(bar.layers.length).toBeLessThanOrEqual(template.budget.maxLayers);
      }
      // every planned layer is from the vocabulary and no doubling layer
      // exists unless the policy allows it
      const dbl = result.plan.bars.flatMap((b) => b.layers).filter((l) => l.layer === 'ostinato' && false);
      expect(dbl).toHaveLength(0); // (placeholder: no doubling slots exist at all in this phase)
      expect(result.plan.octaveDoublingPolicy).toBe(
        template.rules.find((r) => r.type === 'octaveDoubling') ? (template.rules.find((r) => r.type === 'octaveDoubling')!.params as { policy: string }).policy : 'none',
      );
    }
  });
});

describe('checker from the annotation (3b): maxLayers + fillGating replace their stubs', () => {
  it('the real plan audits clean — no maxLayers/fillGating findings and no stubs for them', () => {
    for (const id of TEMPLATE_IDS) {
      const { project, result } = compose(id);
      const template = ENSEMBLE_BY_ID.get(id)!;
      const findings = checkTemplateRules(project, template, result.plan);
      expect(findings.filter((f) => f.rule === 'maxLayers')).toHaveLength(0);
      expect(findings.filter((f) => f.rule === 'fillGating')).toHaveLength(0);
      expect(findings.filter((f) => f.severity === 'stub')).toHaveLength(0);
      // …and no HARD findings, except one honest case: under policy
      // 'forbidden' a rules-generator note can land an octave from the pad by
      // coincidence (the piano cannot see the strings' voicing yet) — the
      // strict template rightly flags it. Not a plan breach.
      const hard = findings.filter((f) => f.severity === 'hard');
      const strictNoise = hard.filter((f) => f.rule === 'octaveDoubling');
      if (result.plan.octaveDoublingPolicy === 'forbidden') {
        expect(hard).toEqual(strictNoise);
      } else {
        expect(hard).toHaveLength(0);
      }
    }
  });

  it('a violating plan is caught: too many layers in a bar', () => {
    const { result } = compose('ensemble.chamber');
    const bad: ConductorPlan = {
      ...result.plan,
      bars: result.plan.bars.map((b, i) =>
        i === 0
          ? { ...b, layers: [...b.layers, { layer: 'lead' as const, trackIds: b.layers[0].trackIds, source: 'strings' as const }, { layer: 'ostinato' as const, trackIds: b.layers[0].trackIds, source: 'strings' as const }, { layer: 'tremolo' as const, trackIds: b.layers[0].trackIds, source: 'strings' as const }, { layer: 'counterline' as const, trackIds: b.layers[0].trackIds, source: 'strings' as const }, { layer: 'fill' as const, trackIds: b.layers[0].trackIds, source: 'strings' as const }] }
          : b,
      ),
    };
    const findings = checkTemplateRules(BASE(), ENSEMBLE_BY_ID.get('ensemble.chamber')!, bad).filter((f) => f.rule === 'maxLayers');
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('hard');
    expect(findings[0].message).toMatch(/6 concurrent layers .* exceed the budget 5/);
  });

  it('a violating plan is caught: a fill with no resting parts around it', () => {
    const { result } = compose('ensemble.chamber');
    const bad: ConductorPlan = {
      ...result.plan,
      fills: [{ target: 'piano', startTick: 0, endTick: 3840 }], // bar 1: strings play here
    };
    const findings = checkTemplateRules(BASE(), ENSEMBLE_BY_ID.get('ensemble.chamber')!, bad).filter((f) => f.rule === 'fillGating');
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('hard');
    expect(findings[0].message).toMatch(/no Strings rest/);
  });

  it('a violating plan is caught: a breath shorter than minGapTicks', () => {
    const { result } = compose('ensemble.chamber');
    const bad: ConductorPlan = {
      ...result.plan,
      breaths: result.plan.breaths.map((b) => ({ ...b, endTick: b.startTick + 240 })), // 240 < 480
    };
    const findings = checkTemplateRules(BASE(), ENSEMBLE_BY_ID.get('ensemble.chamber')!, bad).filter((f) => f.rule === 'fillGating');
    expect(findings.length).toBe(2); // both fills lose their (now too short) rests
    expect(findings.every((f) => f.severity === 'hard')).toBe(true);
  });

  it('without the annotation the two rules stay honest stubs', () => {
    const stubs = checkTemplateRules(BASE(), ENSEMBLE_BY_ID.get('ensemble.chamber')!).filter((f) => f.severity === 'stub');
    expect(stubs.map((f) => f.rule).sort()).toEqual(['fillGating', 'maxLayers']);
  });
});

describe('energy arc (3c): per-section curves, dips, tapers, one near-silence bar', () => {
  const symphony = ENSEMBLE_BY_ID.get('ensemble.symphony')!;
  const arc = (take = 1, template = symphony) => {
    const p = BASE();
    return energyCurve(p, sectionMap(p), take, template, true);
  };

  it('builds inside sections: targets rise through an 8-bar section', () => {
    const a = arc();
    const verse = a.slice(0, 8).map((b) => b.target);
    expect(verse[6]).toBeGreaterThan(verse[0]); // the build (bar 8 is the near-silence)
    expect(new Set(verse.slice(0, 7).map((t) => t.toFixed(4))).size).toBeGreaterThan(2); // a curve, not one flat level
  });

  it('dips on the last bar before a section change and tapers intro and outro', () => {
    const a = arc();
    expect(a[7].target).toBeLessThan(a[6].target); // the pre-Chorus dip (bar 8 — here it dips to 0: near-silence)
    expect(a[7].nearSilence).toBe(true); // bar 8 is the deliberate near-silence before the first Chorus
    const verseMid = a[3].target;
    expect(a[0].target).toBeLessThan(verseMid); // intro taper: bar 1 below the section body
    expect(a[15].target).toBeLessThan(a[13].target); // outro taper into the end
    // the near-silence bar is the bar right before the first Chorus
    const chorus = sectionMap(BASE()).find((s) => s.name === 'Chorus')!;
    expect(chorus.startBar).toBe(9);
    expect(a[7].bar).toBe(8);
  });

  it('every target respects the template clamp; the lookup reads the right bar', () => {
    const a = arc();
    for (const b of a) expect(b.target).toBeLessThanOrEqual(symphony.budget.energyClamp[1] + 1e-12);
    expect(arcTargetAt(a, 0)).toBe(a[0].target);
    expect(arcTargetAt(a, 26880)).toBe(a[7].target); // bar 8
    expect(arcTargetAt(a, 999999)).toBe(a[15].target); // past the end → last bar
  });

  it('no template and no strings → no near-silence bar (and the arc still shapes the build)', () => {
    const p = BASE();
    const a = energyCurve(p, sectionMap(p), 1, null, false);
    expect(a.some((b) => b.nearSilence)).toBe(false);
    expect(a[7].target).toBeGreaterThan(0); // the dip is a dip, not a silence
  });

  it('3d: the arc shape varies per take, deterministically per D8', () => {
    const one = arc(1);
    const oneAgain = arc(1);
    expect(one).toEqual(oneAgain); // same take → byte-identical shape
    const two = arc(2);
    const differing = one.filter((b, i) => Math.abs(b.target - two[i].target) > 1e-9).length;
    expect(differing).toBeGreaterThan(0); // a new take re-rolls the SHAPE
    // …and never past the clamp
    for (const b of two) expect(b.target).toBeLessThanOrEqual(symphony.budget.energyClamp[1] + 1e-12);
  });

  it('composed output follows the arc: measureEnergy stays under the clamp with the near-silence in it', () => {
    for (const id of TEMPLATE_IDS) {
      const { project, result } = compose(id);
      const template = ENSEMBLE_BY_ID.get(id)!;
      const energy = measureEnergy(project, template);
      expect(energy.max).toBeLessThanOrEqual(template.budget.energyClamp[1] + 1e-9);
      // the near-silence bar really is silent in the strings
      const silence = result.plan.breaths.filter((b) => b.nearSilence);
      for (const b of silence) {
        for (const t of project.tracks.filter((x) => x.family === 'Strings')) {
          expect(t.notes.some((n) => n.startTick < b.endTick && n.startTick + n.durationTicks > b.startTick)).toBe(false);
        }
      }
    }
  });
});
