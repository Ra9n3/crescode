import { describe, expect, it } from 'vitest';
import {
  BAND_ROLES, clearOverrides, createDefaultProject, freshEnsemble, isInBand,
  projectFromFixture, templateBandRoles, validateProject,
  type EnsembleTemplate, type ProjectEnsemble,
} from '../src/shared/schema';
import { ENSEMBLES, ENSEMBLE_BY_ID, ENSEMBLE_IDS } from '../src/config/ensembles';
import { validateEnsembleTemplate } from '../src/shared/schema/ensembleTemplate';

const symphony = ENSEMBLE_BY_ID.get('ensemble.symphony') as EnsembleTemplate;
const noBand = freshEnsemble();

describe('band: the shipped registry', () => {
  it('bundles exactly the six agreed bands, in lineup order', () => {
    expect(ENSEMBLES.map((t) => t.id)).toEqual([
      'ensemble.symphony', 'ensemble.chamber', 'ensemble.cinematic',
      'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.hybridstudio',
    ]);
    expect(ENSEMBLE_IDS.size).toBe(6);
  });

  it('re-validates every bundled template (corrupt data fails fast, not at runtime)', () => {
    for (const t of ENSEMBLES) {
      const r = validateEnsembleTemplate(t);
      expect(r.ok, t.id).toBe(true);
    }
  });
});

describe('band: membership rules', () => {
  it('no band chosen means every instrument track is in', () => {
    expect(isInBand('violins1', noBand, null)).toBe(true);
    expect(isInBand('tuba', noBand, null)).toBe(true);
    expect(isInBand('piano', noBand, null)).toBe(true);
  });

  it('a template roster decides who is in by default', () => {
    expect(isInBand('violins1', { ...noBand, templateId: 'ensemble.symphony' }, symphony)).toBe(true);
    expect(isInBand('tuba', { ...noBand, templateId: 'ensemble.symphony' }, symphony)).toBe(true);
    expect(isInBand('piano', { ...noBand, templateId: 'ensemble.symphony' }, symphony)).toBe(false);
  });

  it('the track-header override beats the template, both directions', () => {
    const e: ProjectEnsemble = { templateId: 'ensemble.symphony', overrides: { piano: 'in', tuba: 'out' }, pins: {} };
    expect(isInBand('piano', e, symphony)).toBe(true);
    expect(isInBand('tuba', e, symphony)).toBe(false);
  });

  it('project-settings pins beat everything', () => {
    const e: ProjectEnsemble = {
      templateId: 'ensemble.symphony',
      overrides: { violins1: 'out', piano: 'in' },
      pins: { violins1: 'in', piano: 'out', tuba: 'in' },
    };
    expect(isInBand('violins1', e, symphony)).toBe(true); // pin in beats override out
    expect(isInBand('piano', e, symphony)).toBe(false); // pin out beats override in
    expect(isInBand('tuba', e, symphony)).toBe(true); // pin in beats template's roster choice
  });

  it('pins stay and overrides clear on a template switch', () => {
    const e: ProjectEnsemble = {
      templateId: 'ensemble.symphony',
      overrides: { tuba: 'out', piano: 'in' },
      pins: { tuba: 'in' },
    };
    const switched = clearOverrides(e);
    expect(switched.overrides).toEqual({});
    expect(switched.pins).toEqual({ tuba: 'in' });
    expect(switched.templateId).toBe('ensemble.symphony');
    // the original is untouched (immutable update)
    expect(e.overrides).toEqual({ tuba: 'out', piano: 'in' });
  });

  it('the band manages exactly the 18 instrument roles, never Structure/Audio lanes', () => {
    expect(BAND_ROLES.size).toBe(18);
    expect(BAND_ROLES.has('violins1')).toBe(true);
    expect(BAND_ROLES.has('harp')).toBe(true);
    expect(BAND_ROLES.has('structure')).toBe(false);
    expect(BAND_ROLES.has('chords')).toBe(false);
    expect(BAND_ROLES.has('reference')).toBe(false);
  });

  it('templateBandRoles mirrors the roster', () => {
    expect(templateBandRoles(symphony).size).toBe(17);
    expect(templateBandRoles(null).size).toBe(0);
  });
});

describe('band: projects remember their band', () => {
  it('a new project starts with a fresh, unshared no-band state', () => {
    const a = createDefaultProject();
    const b = createDefaultProject();
    expect(a.ensemble).toEqual({ templateId: null, overrides: {}, pins: {} });
    expect(a.ensemble!.overrides).not.toBe(b.ensemble!.overrides);
  });

  it('old saved projects without an ensemble field still load', () => {
    const doc = projectFromFixture({ name: 'Legacy' }) as Record<string, unknown>;
    delete doc.ensemble;
    const r = validateProject(doc);
    expect(r.ok).toBe(true);
  });

  it('a project carrying band state validates', () => {
    const p = projectFromFixture({
      ensemble: { templateId: 'ensemble.sonata', overrides: { cellosBasses: 'out' }, pins: { tuba: 'out' } },
    });
    expect(validateProject(p).ok).toBe(true);
  });

  it('rejects an unknown template id', () => {
    const p = projectFromFixture({ ensemble: { templateId: 'ensemble.jazz', overrides: {}, pins: {} } });
    const r = validateProject(p);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.path === 'ensemble.templateId' && /unknown ensemble template "ensemble\.jazz"/.test(e.message))).toBe(true);
  });

  it('rejects overrides or pins on non-instrument roles', () => {
    const p = projectFromFixture({ ensemble: { templateId: null, overrides: { chords: 'out' }, pins: {} } });
    const r = validateProject(p);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.path === 'ensemble.overrides.chords' && /not an instrument track role/.test(e.message))).toBe(true);
  });

  it('rejects band states other than in/out', () => {
    const p = projectFromFixture({ ensemble: { templateId: null, overrides: { tuba: 'maybe' }, pins: {} } });
    const r = validateProject(p);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.path === 'ensemble.overrides.tuba' && /must be "in" or "out" \(got "maybe"\)/.test(e.message))).toBe(true);
  });

  it('rejects a malformed ensemble section', () => {
    expect(validateProject(projectFromFixture({ ensemble: 'Symphony' as unknown as ProjectEnsemble })).ok).toBe(false);
    expect(validateProject(projectFromFixture({ ensemble: { templateId: null, overrides: [], pins: {} } as unknown as ProjectEnsemble })).ok).toBe(false);
  });
});
