import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateEnsembleTemplate, type EnsembleTemplate } from '../src/shared/schema/ensembleTemplate';

const load = (p: string): unknown => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const SYMPHONY = load('../specs/ensemble-templates/templates/symphony.json');
const clone = (t: unknown): EnsembleTemplate => JSON.parse(JSON.stringify(t)) as EnsembleTemplate;

describe('ensemble templates: shipped templates pass the rulebook', () => {
  it('symphony template validates cleanly', () => {
    const r = validateEnsembleTemplate(SYMPHONY);
    if (!r.ok) throw new Error('symphony.json should pass: ' + JSON.stringify(r.errors, null, 2));
    expect(r.template.roster).toHaveLength(17);
    expect(r.template.budget).toEqual({ energyClamp: [0.25, 0.85], maxLayers: 7 });
    expect(r.template.rules).toHaveLength(2);
  });
});

describe('ensemble templates: roster', () => {
  it('rejects duplicate roles', () => {
    const t = clone(SYMPHONY);
    t.roster[1].role = 'violins1';
    const r = validateEnsembleTemplate(t);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /duplicate roster role "violins1"/.test(e.message))).toBe(true);
  });

  it('rejects unknown families', () => {
    const t = clone(SYMPHONY);
    t.roster[0].family = 'Guitars';
    const r = validateEnsembleTemplate(t);
    expect(r.errors.some((e) => e.path === 'roster[0].family' && /unknown family "Guitars"/.test(e.message))).toBe(true);
  });

  it('rejects known roles whose family disagrees with the app instrument table', () => {
    const t = clone(SYMPHONY);
    t.roster[0].family = 'Brass';
    const r = validateEnsembleTemplate(t);
    expect(r.errors.some((e) => /role "violins1" is family "Strings" in the app instrument table, not "Brass"/.test(e.message))).toBe(true);
  });

  it('rejects a range hint where low exceeds high', () => {
    const t = clone(SYMPHONY);
    t.roster.push({ role: 'glockenspiel', family: 'Percussion', low: 'C7', high: 'G4' });
    const r = validateEnsembleTemplate(t);
    expect(r.errors.some((e) => /low must not exceed high \(C7 = 96 > 67 = G4\)/.test(e.message))).toBe(true);
  });

  it('rejects unparseable note names', () => {
    const t = clone(SYMPHONY);
    t.roster.push({ role: 'glockenspiel', family: 'Percussion', low: 'H4', high: 'C7' });
    const r = validateEnsembleTemplate(t);
    expect(r.errors.some((e) => e.path === 'roster[17].range' && /range notes must be scientific pitch like "Bb3" or "C7" \(got "H4"–"C7"\)/.test(e.message))).toBe(true);
  });

  it('rejects format-valid note names outside the MIDI span', () => {
    const t = clone(SYMPHONY);
    t.roster.push({ role: 'glockenspiel', family: 'Percussion', low: 'B9', high: 'B9' });
    const r = validateEnsembleTemplate(t);
    expect(r.errors.some((e) => /"B9" is not a valid note name/.test(e.message))).toBe(true);
  });

  it('requires low and high together', () => {
    const t = clone(SYMPHONY);
    t.roster.push({ role: 'glockenspiel', family: 'Percussion', low: 'G4' });
    const r = validateEnsembleTemplate(t);
    expect(r.errors.some((e) => /low and high must be provided together/.test(e.message))).toBe(true);
  });
});

describe('ensemble templates: budget', () => {
  it('rejects a reversed energy clamp', () => {
    const t = clone(SYMPHONY);
    t.budget.energyClamp = [0.85, 0.25];
    const r = validateEnsembleTemplate(t);
    expect(r.errors.some((e) => /energyClamp min must not exceed max \(got \[0.85, 0.25\]\)/.test(e.message))).toBe(true);
  });

  it('rejects clamp values outside 0–1', () => {
    const t = clone(SYMPHONY);
    t.budget.energyClamp = [0.1, 1.5];
    const r = validateEnsembleTemplate(t);
    expect(r.errors.some((e) => e.path === 'budget.energyClamp' && /0–1/.test(e.message))).toBe(true);
  });

  it('rejects maxLayers below 1', () => {
    const t = clone(SYMPHONY);
    t.budget.maxLayers = 0;
    const r = validateEnsembleTemplate(t);
    expect(r.errors.some((e) => /maxLayers must be an integer 1–32 \(got 0\)/.test(e.message))).toBe(true);
  });

  it('rejects more concurrent layers than roster tracks', () => {
    const t = clone(SYMPHONY);
    t.budget.maxLayers = 18;
    const r = validateEnsembleTemplate(t);
    expect(r.errors.some((e) => /cannot run 18 concurrent layers with only 17 roster tracks/.test(e.message))).toBe(true);
  });
});

describe('ensemble templates: rules', () => {
  it('rejects unknown rule types', () => {
    const t = clone(SYMPHONY);
    t.rules.push({ type: 'voodoo', params: {} });
    const r = validateEnsembleTemplate(t);
    expect(r.errors.some((e) => e.path === 'rules[2].type' && /unknown rule type "voodoo"/.test(e.message))).toBe(true);
  });

  it('rejects rule targets that resolve to nothing', () => {
    const t = clone(SYMPHONY);
    (t.rules[0].params as { actor: string }).actor = 'Guitars';
    const r = validateEnsembleTemplate(t);
    expect(r.errors.some((e) => e.path === 'rules[0].params.actor' && /"Guitars" is neither a family \(.*\) nor a roster role/.test(e.message))).toBe(true);
  });

  it('rejects octaveDoubling climaxOnly without an energy threshold', () => {
    const t = clone(SYMPHONY);
    (t.rules[1].params as Record<string, unknown>) = { policy: 'climaxOnly' };
    const r = validateEnsembleTemplate(t);
    expect(r.errors.some((e) => /policy "climaxOnly" requires energyThreshold/.test(e.message))).toBe(true);
  });

  it('rejects an energy threshold on non-climax policies', () => {
    const t = clone(SYMPHONY);
    (t.rules[1].params as Record<string, unknown>) = { policy: 'allowed', energyThreshold: 0.7 };
    const r = validateEnsembleTemplate(t);
    expect(r.errors.some((e) => /energyThreshold is only valid with policy "climaxOnly"/.test(e.message))).toBe(true);
  });

  it('rejects unisonOrnament tracks outside the roster', () => {
    const t = clone(SYMPHONY);
    t.rules.push({ type: 'unisonOrnament', params: { tracks: ['violins1', 'celesta'], transforms: ['graceNote'], divergence: 'perInstrument' } });
    const r = validateEnsembleTemplate(t);
    expect(r.errors.some((e) => e.path === 'rules[2].params.tracks[1]' && /"celesta" is not in the roster/.test(e.message))).toBe(true);
  });

  it('rejects unisonOrnament transforms outside the vocabulary', () => {
    const t = clone(SYMPHONY);
    t.rules.push({ type: 'unisonOrnament', params: { tracks: ['violins1'], transforms: ['vibrato'] } });
    const r = validateEnsembleTemplate(t);
    expect(r.errors.some((e) => /transforms must be a non-empty array drawn from/.test(e.message))).toBe(true);
  });

  it('rejects fillGating targets that resolve to nothing', () => {
    const t = clone(SYMPHONY);
    t.rules.push({ type: 'fillGating', params: { fills: 'Percussion', duringRestsOf: 'Ghosts', minGapTicks: 480 } });
    const r = validateEnsembleTemplate(t);
    expect(r.errors.some((e) => e.path === 'rules[2].params.duringRestsOf' && /"Ghosts" is neither a family/.test(e.message))).toBe(true);
  });
});

describe('ensemble templates: document shape and determinism', () => {
  it('rejects malformed template ids', () => {
    const t = clone(SYMPHONY);
    t.id = 'Symphony!';
    const r = validateEnsembleTemplate(t);
    expect(r.errors.some((e) => e.path === 'id' && /stable identifier/.test(e.message))).toBe(true);
  });

  it('rejects non-object input', () => {
    const r = validateEnsembleTemplate('nope');
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].message).toBe('Ensemble template must be a JSON object');
  });

  it('is deterministic — identical input yields identical error lists', () => {
    const t = clone(SYMPHONY);
    t.budget.maxLayers = 0;
    (t.rules[0].params as { actor: string }).actor = 'ghost';
    const a = validateEnsembleTemplate(t);
    const b = validateEnsembleTemplate(JSON.parse(JSON.stringify(t)));
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    expect(JSON.stringify(a.errors)).toBe(JSON.stringify(b.errors));
  });
});
