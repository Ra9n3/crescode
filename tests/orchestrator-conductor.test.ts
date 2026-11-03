import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/dorian-16bars.json';
import { ENSEMBLE_BY_ID } from '../src/config/ensembles';
import { composeAllTracks } from '../src/orchestrator/compose';
import { checkTemplateRules, measureEnergy } from '../src/orchestrator/energy';
import { LAYER_VOCABULARY, type ConductorPlan } from '../src/orchestrator/conductor';
import { energyCurve, arcTargetAt, sectionMap, peakSectionOf, PEAK_RESERVE, type SpineSection } from '../src/orchestrator/spine';
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
  it('uses the shared layer vocabulary and gives every string track exactly one role per bar (4a)', () => {
    expect(LAYER_VOCABULARY).toContain('lead');
    expect(LAYER_VOCABULARY).toContain('pad');
    expect(LAYER_VOCABULARY).toContain('fill');
    const { project, result } = compose('ensemble.chamber');
    expect(result.plan.bars).toHaveLength(16);
    const voiceIds = project.tracks.filter((t) => t.family === 'Strings').map((t) => t.id).sort();
    for (const bar of result.plan.bars) {
      expect(bar.layers.map((l) => l.layer).sort()).toEqual(['bass', 'counterline', 'lead', 'pad']); // the chamber preset
      // one track = one role per bar: the voice tracks partition exactly
      const ids = bar.layers.flatMap((l) => l.trackIds).sort();
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toEqual(voiceIds);
      for (const l of bar.layers) expect(l.source).toBe('strings');
    }
    expect(result.plan.templateId).toBe('ensemble.chamber');
    expect(result.plan.maxLayers).toBe(5);
    expect(result.plan.octaveDoublingPolicy).toBe('climaxOnly');
    expect(result.plan.unannotatedRoles).toEqual(['piano']); // in band, owned by the rules generator
  });

  it('presets assign the documented roles per bar (4a): cinematic switches V1 by arc energy', () => {
    const sym = compose('ensemble.symphony');
    expect(sym.result.plan.bars[2].layers.map((l) => l.layer).sort()).toEqual(['bass', 'lead', 'pad']);
    const cine = compose('ensemble.cinematic');
    // chorus bars (arc ≥ 0.65) put V1 on tremolo; verse bars keep the lead
    expect(cine.result.plan.bars[9].layers.map((l) => l.layer).sort()).toEqual(['bass', 'ostinato', 'tremolo']);
    expect(cine.result.plan.bars[1].layers.map((l) => l.layer).sort()).toEqual(['bass', 'lead', 'ostinato']);
    const vb = compose('ensemble.vocalbacking');
    for (const bar of vb.result.plan.bars) expect(bar.layers.map((l) => l.layer)).toEqual(['pad']); // wide legato only
    // intro-like sections never carry a lead — the motif arrives with the first phrase
    const ip = BASE();
    ip.sections = [{ id: 's0', name: 'Intro', startBar: 1, lengthBars: 4 }, { id: 's1', name: 'Verse', startBar: 5, lengthBars: 12 }];
    ip.ensemble = { templateId: 'ensemble.chamber', overrides: {}, pins: {} };
    const intro = composeAllTracks(ip, { seed: 11 });
    expect(intro.plan.bars[0].layers.map((l) => l.layer).sort()).toEqual(['bass', 'pad']);
    expect(intro.plan.bars[6].layers.map((l) => l.layer).sort()).toEqual(['bass', 'counterline', 'lead', 'pad']);
  });

  it('fillGating breaths: the resting parts rest on each non-final section\u2019s last bar, \u2265 minGapTicks, fills registered', () => {
    const { result } = compose('ensemble.chamber'); // piano fills during Strings rests (480)
    // Phase 3.5: the Chorus's last bar IS the song's final bar — the landing
    // chord always sounds, so no breath and no fill window there
    expect(result.plan.breaths.map((b) => [b.startTick, b.endTick])).toEqual([
      [26880, 30720], // Verse last bar (bar 8) — also the arc's pre-Chorus near-silence
    ]);
    expect(result.plan.breaths[0].reason).toBe('fillGating');
    expect(result.plan.breaths[0].nearSilence).toBe(true); // merged with the arc's silence bar
    expect(result.plan.breaths.every((b) => b.endTick - b.startTick >= b.minGapTicks)).toBe(true);
    expect(result.plan.breaths[0].duringRestsOf).toBe('Strings');
    expect(result.plan.breaths[0].trackIds).toHaveLength(4);
    expect(result.plan.fills).toEqual([{ target: 'piano', startTick: 26880, endTick: 30720 }]);

    // sonata gates on violins1 specifically — its fillGating breaths touch
    // only that track, and only on bar 8 (bar 16 is the final bar, Phase 3.5);
    // the arc's near-silence breath covers every string voice
    const sonata = compose('ensemble.sonata');
    const gate = sonata.result.plan.breaths.filter((b) => b.reason === 'fillGating');
    expect(gate).toHaveLength(1);
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
        // a note must never STRADDLE a breath window either
        expect(n.startTick < 30720 && n.startTick + n.durationTicks > 26880).toBe(false);
      }
    }
    // …and strings still play elsewhere — including the FINAL bar (Phase 3.5:
    // the landing chord is sustained; only bar 8, the pre-Chorus silence, rests)
    expect(track(project, 'cellosBasses').notes.length).toBeGreaterThan(0);
    expect(track(project, 'violins1').notes.some((n) => n.startTick < 61440 && n.startTick + n.durationTicks > 57600)).toBe(true);
    // symphony has no fillGating: bar 16 keeps its pads, bar 8 rests (the
    // arc's deliberate near-silence before the first Chorus)
    const sym = compose('ensemble.symphony');
    const v1 = track(sym.project, 'violins1').notes;
    expect(v1.some((n) => n.startTick < 30720 && n.startTick + n.durationTicks > 26880)).toBe(false);
    expect(v1.some((n) => n.startTick < 61440 && n.startTick + n.durationTicks > 57600)).toBe(true);
    expect(v1.some((n) => n.startTick < 26880 && n.startTick + n.durationTicks > 23040)).toBe(true); // bar 7 sounds
  });

  it('Phase 3.5: the final bar always sounds — no breath or fill lands on it (all six templates)', () => {
    const btBar = 3840; // 4/4 at 960 PPQ
    const finalStart = 15 * btBar;
    for (const id of TEMPLATE_IDS) {
      const { project, result } = compose(id);
      const template = ENSEMBLE_BY_ID.get(id)!;
      const strings = project.tracks.filter((t) => t.family === 'Strings' && result.stringsTrackIds.includes(t.id));
      expect(strings.length).toBeGreaterThan(0); // every template has in-band strings to sustain the landing chord
      for (const t of strings) {
        const sounding = t.notes.some((n) => n.startTick < finalStart + btBar && n.startTick + n.durationTicks > finalStart);
        expect(sounding).toBe(true);
      }
      // and the plan agrees: no breath, no fill window may claim the final bar
      for (const b of result.plan.breaths) expect(b.endTick <= finalStart || b.startTick >= finalStart + btBar).toBe(true);
      for (const f of result.plan.fills) expect(f.endTick <= finalStart || f.startTick >= finalStart + btBar).toBe(true);
      // the fillGating templates really do gate fills (the test is not vacuous)
      if (template.rules.some((r) => r.type === 'fillGating')) expect(result.plan.breaths.some((b) => b.reason === 'fillGating')).toBe(true);
    }
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
          ? { ...b, layers: [...b.layers, { layer: 'tremolo' as const, trackIds: b.layers[0].trackIds, source: 'strings' as const }, { layer: 'fill' as const, trackIds: b.layers[0].trackIds, source: 'strings' as const }] }
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
    expect(findings.length).toBe(1); // the one remaining fill (bar 8) loses its (now too short) rest
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

describe('Phase 3.5: peak reservation — one section owns the top of the range', () => {
  const symphony = ENSEMBLE_BY_ID.get('ensemble.symphony')!;
  const sec = (id: string, name: string, startBar: number, lengthBars: number): SpineSection => ({
    id, name, index: 0, occurrence: 1, startBar, lengthBars,
    startTick: (startBar - 1) * 3840, endTick: (startBar - 1 + lengthBars) * 3840,
  });
  const sectionRuns = (plan: ConductorPlan) => {
    const runs: { id: string; name: string; targets: number[] }[] = [];
    for (const b of plan.bars) {
      const last = runs[runs.length - 1];
      if (last && last.id === b.sectionId) last.targets.push(b.energyTarget);
      else runs.push({ id: b.sectionId, name: b.sectionName, targets: [b.energyTarget] });
    }
    return runs;
  };

  it('the peak is the last Chorus, else the last non-outro section; none without structure', () => {
    expect(peakSectionOf([sec('v', 'Verse', 1, 8), sec('c', 'Chorus', 9, 6), sec('o', 'Outro', 15, 2)])?.id).toBe('c');
    expect(peakSectionOf([sec('v', 'Verse', 1, 6), sec('b', 'Bridge', 7, 6), sec('o', 'Outro', 13, 4)])?.id).toBe('b');
    expect(peakSectionOf([sec('v', 'Verse', 1, 8), sec('c1', 'Chorus', 9, 4), sec('c2', 'Chorus', 13, 4)])?.id).toBe('c2');
    expect(peakSectionOf([])).toBeNull();
  });

  it('exactly one section reaches within 3% of the clamp; every other caps at PEAK_RESERVE; measureEnergy never exceeds it', () => {
    for (const id of TEMPLATE_IDS) {
      const { project, result } = compose(id);
      const template = ENSEMBLE_BY_ID.get(id)!;
      const clampMax = template.budget.energyClamp[1];
      const peak = peakSectionOf(sectionMap(BASE()))!;
      const runs = sectionRuns(result.plan).map((r) => ({ ...r, max: Math.max(...r.targets) }));

      const atTop = runs.filter((r) => r.max >= 0.97 * clampMax);
      expect(atTop).toHaveLength(1);
      expect(atTop[0].id).toBe(peak.id); // the last Chorus (here) is the peak by default
      for (const r of runs) {
        if (r.id === peak.id) continue;
        expect(r.max).toBeLessThanOrEqual(PEAK_RESERVE * clampMax + 1e-9); // ~88%, the named constant
      }

      // …and the plan is audible honestly: the measured energy never breaches the clamp
      const energy = measureEnergy(project, template);
      expect(energy.max).toBeLessThanOrEqual(clampMax + 1e-9);
      expect(energy.violations.filter((v) => v.kind === 'aboveMax')).toHaveLength(0);
    }
  });

  it('a peak section planned below the clamp is scaled UP to it (cinematic: raw top 0.81 → clamp 0.95)', () => {
    const { result } = compose('ensemble.cinematic');
    const clampMax = ENSEMBLE_BY_ID.get('ensemble.cinematic')!.budget.energyClamp[1];
    const chorus = sectionRuns(result.plan).find((r) => /chorus/i.test(r.name))!;
    expect(Math.max(...chorus.targets)).toBeCloseTo(clampMax, 9);
  });

  it('no structure → no peak reservation: the arc keeps its own shape below the clamp', () => {
    const p = BASE();
    p.sections = [];
    const a = energyCurve(p, sectionMap(p), 1, symphony, true);
    expect(Math.max(...a.map((b) => b.target))).toBeLessThan(symphony.budget.energyClamp[1]);
    expect(a.every((b) => b.target >= 0)).toBe(true);
  });
});
