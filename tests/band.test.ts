import { describe, expect, it } from 'vitest';
import {
  applyTemplate, BAND_ROLES, clearOverrides, createDefaultProject, flipBand, freshEnsemble, isInBand,
  projectFromFixture, setPin, templateBandRoles, validateProject,
  type EnsembleTemplate, type Project, type ProjectEnsemble,
} from '../src/shared/schema';
import { ENSEMBLES, ENSEMBLE_BY_ID, ENSEMBLE_IDS } from '../src/config/ensembles';
import { validateEnsembleTemplate } from '../src/shared/schema/ensembleTemplate';

const symphony = ENSEMBLE_BY_ID.get('ensemble.symphony') as EnsembleTemplate;
const noBand = freshEnsemble();

const note = (i: number) => ({ pitch: 60 + (i % 12), startTick: i * 240, durationTicks: 120, velocity: 80 });
const trackByRole = (p: Project, role: string) => p.tracks.find((t) => t.role === role)!;
const withNotes = (p: Project, role: string, count: number, locked = false): Project => ({
  ...p,
  tracks: p.tracks.map((t) => (t.role === role ? { ...t, locked, notes: Array.from({ length: count }, (_, i) => note(i)) } : t)),
});

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
    const doc = projectFromFixture({ name: 'Legacy' }) as unknown as Record<string, unknown>;
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
    const p = projectFromFixture({ ensemble: { templateId: null, overrides: { tuba: 'maybe' as never }, pins: {} } });
    const r = validateProject(p);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.path === 'ensemble.overrides.tuba' && /must be "in" or "out" \(got "maybe"\)/.test(e.message))).toBe(true);
  });

  it('rejects a malformed ensemble section', () => {
    expect(validateProject(projectFromFixture({ ensemble: 'Symphony' as unknown as ProjectEnsemble })).ok).toBe(false);
    expect(validateProject(projectFromFixture({ ensemble: { templateId: null, overrides: [], pins: {} } as unknown as ProjectEnsemble })).ok).toBe(false);
  });
});

describe('band: the track-header in/out button', () => {
  it('taking an instrument out empties its lane and marks the override — the untouched original is what undo restores', () => {
    const p = withNotes(projectFromFixture({}), 'violins1', 5);
    const res = flipBand(p, trackByRole(p, 'violins1').id, null);
    if (!res.ok) throw new Error('expected a successful flip');
    expect(res.nowIn).toBe(false);
    expect(res.clearedTrackIds).toEqual([trackByRole(p, 'violins1').id]);
    expect(res.project.ensemble!.overrides.violins1).toBe('out');
    expect(trackByRole(res.project, 'violins1').notes).toEqual([]);
    expect(validateProject(res.project).ok).toBe(true);
    // other lanes untouched
    expect(trackByRole(res.project, 'cellosBasses').notes).toEqual(trackByRole(p, 'cellosBasses').notes);
    // the original project keeps its notes — one Ctrl+Z brings them back
    expect(trackByRole(p, 'violins1').notes).toHaveLength(5);
  });

  it('a locked track keeps its notes even when out — lock wins over OUT', () => {
    const p = withNotes(projectFromFixture({}), 'tuba', 3, true);
    const res = flipBand(p, trackByRole(p, 'tuba').id, null);
    if (!res.ok) throw new Error('expected a successful flip');
    expect(res.nowIn).toBe(false);
    expect(res.clearedTrackIds).toEqual([]);
    expect(trackByRole(res.project, 'tuba').notes).toHaveLength(3);
    expect(res.project.ensemble!.overrides.tuba).toBe('out');
  });

  it('bringing it back in writes an explicit override and resurrects nothing (undo, not the button, returns notes)', () => {
    const p = withNotes(projectFromFixture({}), 'violins1', 5);
    const out = flipBand(p, trackByRole(p, 'violins1').id, null);
    if (!out.ok) throw new Error('expected a successful flip');
    const back = flipBand(out.project, trackByRole(p, 'violins1').id, null);
    if (!back.ok) throw new Error('expected a successful flip');
    expect(back.nowIn).toBe(true);
    expect(back.clearedTrackIds).toEqual([]);
    expect(back.project.ensemble!.overrides.violins1).toBe('in');
    expect(trackByRole(back.project, 'violins1').notes).toEqual([]);
  });

  it('a pinned role refuses the header button', () => {
    const p = projectFromFixture({ ensemble: { templateId: null, overrides: {}, pins: { violas: 'out' } } });
    expect(flipBand(p, trackByRole(p, 'violas').id, null)).toEqual({ ok: false, reason: 'pinned', role: 'violas' });
  });

  it('non-band lanes refuse the flip', () => {
    const p = projectFromFixture({});
    for (const role of ['structure', 'chords', 'reference']) {
      expect(flipBand(p, trackByRole(p, role).id, null)).toEqual({ ok: false, reason: 'notBand', role });
    }
    expect(flipBand(p, 'no-such-track', null)).toEqual({ ok: false, reason: 'notBand', role: '' });
  });

  it('the template roster sets the starting position; the button overrules both ways and keeps the templateId', () => {
    const base = withNotes(
      projectFromFixture({ ensemble: { templateId: 'ensemble.symphony', overrides: {}, pins: {} } }),
      'tuba', 3,
    );
    const piano = flipBand(base, trackByRole(base, 'piano').id, symphony); // roster leaves piano out → click brings it in
    if (!piano.ok) throw new Error('expected a successful flip');
    expect(piano.nowIn).toBe(true);
    expect(piano.project.ensemble!.overrides.piano).toBe('in');
    expect(piano.project.ensemble!.templateId).toBe('ensemble.symphony');
    const tuba = flipBand(base, trackByRole(base, 'tuba').id, symphony); // roster has tuba in → click takes it out
    if (!tuba.ok) throw new Error('expected a successful flip');
    expect(tuba.nowIn).toBe(false);
    expect(tuba.clearedTrackIds).toEqual([trackByRole(base, 'tuba').id]);
    expect(trackByRole(tuba.project, 'tuba').notes).toEqual([]);
  });

  it('every unlocked track with the role empties together; locked ones keep their notes', () => {
    const p0 = withNotes(projectFromFixture({}), 'violins1', 4);
    const dupe = { ...trackByRole(p0, 'violins1'), id: 'violins1-copy', locked: true };
    const p: Project = { ...p0, tracks: [...p0.tracks, dupe] };
    const res = flipBand(p, trackByRole(p, 'violins1').id, null);
    if (!res.ok) throw new Error('expected a successful flip');
    expect(res.clearedTrackIds).toEqual([trackByRole(p, 'violins1').id]);
    expect(trackByRole(res.project, 'violins1').notes).toEqual([]);
    expect(res.project.tracks.find((t) => t.id === 'violins1-copy')!.notes).toHaveLength(4);
  });

  it('a project without an ensemble field gains a valid one on the first flip', () => {
    const legacy = withNotes(projectFromFixture({}), 'violas', 2);
    delete legacy.ensemble;
    const res = flipBand(legacy, trackByRole(legacy, 'violas').id, null);
    if (!res.ok) throw new Error('expected a successful flip');
    expect(res.project.ensemble).toEqual({ templateId: null, overrides: { violas: 'out' }, pins: {} });
    expect(validateProject(res.project).ok).toBe(true);
    expect(trackByRole(res.project, 'violas').notes).toEqual([]);
  });

  it('deterministic: same input → identical output, and the input is never mutated', () => {
    const p = withNotes(projectFromFixture({}), 'violins2', 7);
    const before = JSON.stringify(p);
    const a = flipBand(p, trackByRole(p, 'violins2').id, null);
    const b = flipBand(p, trackByRole(p, 'violins2').id, null);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(p)).toBe(before);
  });
});

describe('band: switching templates (the picker)', () => {
  const chamber = ENSEMBLE_BY_ID.get('ensemble.chamber') as EnsembleTemplate;

  it('a switch starts a new composition: templateId set, overrides cleared, pins kept, now-out lanes swept', () => {
    const p = withNotes(
      withNotes(
        projectFromFixture({ ensemble: { templateId: null, overrides: { violas: 'out', piano: 'in' }, pins: { harp: 'in' } } }),
        'tuba', 4,
      ),
      'violins1', 6,
    );
    const res = applyTemplate(p, chamber);
    expect(res.project.ensemble).toEqual({ templateId: 'ensemble.chamber', overrides: {}, pins: { harp: 'in' } });
    expect(res.inRoles).toEqual([...chamber.roster.map((r) => r.role), 'harp']); // pinned-in harp rides over the roster
    expect(res.sweptTrackIds).toEqual([trackByRole(p, 'tuba').id]); // tuba was in (no template) with notes → now out → swept
    expect(trackByRole(res.project, 'tuba').notes).toEqual([]);
    expect(trackByRole(res.project, 'violins1').notes).toHaveLength(6); // in-band lane untouched
    expect(validateProject(res.project).ok).toBe(true);
    // the original composition is untouched — one Ctrl+Z restores it wholesale
    expect(trackByRole(p, 'tuba').notes).toHaveLength(4);
  });

  it('locked lanes keep their notes even when the switch puts them out — lock wins over OUT', () => {
    const p = withNotes(projectFromFixture({}), 'tuba', 3, true);
    const res = applyTemplate(p, chamber);
    expect(res.sweptTrackIds).toEqual([]);
    expect(trackByRole(res.project, 'tuba').notes).toHaveLength(3);
    expect(res.project.ensemble!.templateId).toBe('ensemble.chamber');
  });

  it('pins ride over: a pinned-in non-roster instrument stays in, a pinned-out roster instrument is swept', () => {
    const p = withNotes(
      withNotes(
        projectFromFixture({ ensemble: { templateId: null, overrides: {}, pins: { tuba: 'in', violins1: 'out' } } }),
        'tuba', 4,
      ),
      'violins1', 3,
    );
    const res = applyTemplate(p, chamber); // chamber roster has violins1, not tuba
    expect(res.inRoles).toContain('tuba');
    expect(res.inRoles).not.toContain('violins1');
    expect(trackByRole(res.project, 'tuba').notes).toHaveLength(4); // pinned in → never swept
    expect(res.sweptTrackIds).toEqual([trackByRole(p, 'violins1').id]);
    expect(trackByRole(res.project, 'violins1').notes).toEqual([]);
  });

  it('switching to no band brings everyone in and sweeps nothing', () => {
    const p = withNotes(projectFromFixture({ ensemble: { templateId: 'ensemble.symphony', overrides: {}, pins: {} } }), 'tuba', 2);
    const res = applyTemplate(p, null);
    expect(res.project.ensemble!.templateId).toBe(null);
    expect(res.sweptTrackIds).toEqual([]);
    expect(res.inRoles.length).toBe(18);
    expect(trackByRole(res.project, 'tuba').notes).toHaveLength(2);
  });

  it('no band still respects pins: pinned-out roles stay out and sweep (the picker says "except your pins")', () => {
    const p = withNotes(projectFromFixture({ ensemble: { templateId: 'ensemble.symphony', overrides: {}, pins: { violas: 'out' } } }), 'violas', 3);
    const res = applyTemplate(p, null);
    expect(res.project.ensemble!.templateId).toBe(null);
    expect(res.inRoles.length).toBe(17);
    expect(res.inRoles).not.toContain('violas');
    expect(res.sweptTrackIds).toEqual([trackByRole(p, 'violas').id]);
    expect(trackByRole(res.project, 'violas').notes).toEqual([]);
    expect(res.project.ensemble!.pins).toEqual({ violas: 'out' }); // the pin rides over every band, "no band" included
  });

  it('re-picking the active band restarts the composition: overrides clear and out lanes sweep', () => {
    const p = withNotes(
      projectFromFixture({ ensemble: { templateId: 'ensemble.chamber', overrides: { violas: 'in' }, pins: {} } }),
      'tuba', 2,
    );
    const res = applyTemplate(p, chamber);
    expect(res.project).not.toBe(p);
    expect(res.project.ensemble!.overrides).toEqual({});
    expect(res.sweptTrackIds).toEqual([trackByRole(p, 'tuba').id]);
  });

  it('re-picking the active band with nothing pending changes nothing (same project reference, no history spam)', () => {
    const p = projectFromFixture({ ensemble: { templateId: 'ensemble.chamber', overrides: {}, pins: {} } });
    const res = applyTemplate(p, chamber);
    expect(res.project).toBe(p);
    expect(res.sweptTrackIds).toEqual([]);
  });

  it('deterministic: same input → identical output, input never mutated, result validates', () => {
    const p = withNotes(projectFromFixture({ ensemble: { templateId: 'ensemble.symphony', overrides: { piano: 'in' }, pins: {} } }), 'horns', 5);
    const before = JSON.stringify(p);
    const a = applyTemplate(p, chamber);
    const b = applyTemplate(p, chamber);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(p)).toBe(before);
    expect(validateProject(a.project).ok).toBe(true);
  });
});

describe('band: project-settings pins (Settings → Band)', () => {
  const chamber = ENSEMBLE_BY_ID.get('ensemble.chamber') as EnsembleTemplate;

  it('pinning an instrument out writes the pin AND empties its unlocked lanes in the same edit', () => {
    const p = withNotes(projectFromFixture({}), 'violas', 4);
    const res = setPin(p, 'violas', 'out');
    if (!res.ok) throw new Error('expected a successful pin');
    expect(res.pin).toBe('out');
    expect(res.clearedTrackIds).toEqual([trackByRole(p, 'violas').id]);
    expect(res.project.ensemble!.pins).toEqual({ violas: 'out' });
    expect(trackByRole(res.project, 'violas').notes).toEqual([]);
    expect(validateProject(res.project).ok).toBe(true);
    // the original is untouched — one Ctrl+Z restores notes + pin together
    expect(trackByRole(p, 'violas').notes).toHaveLength(4);
    expect(p.ensemble!.pins).toEqual({});
  });

  it('lock wins over pins, too: a locked track keeps its notes while pinned out', () => {
    const p = withNotes(projectFromFixture({}), 'violas', 3, true);
    const res = setPin(p, 'violas', 'out');
    if (!res.ok) throw new Error('expected a successful pin');
    expect(res.clearedTrackIds).toEqual([]);
    expect(trackByRole(res.project, 'violas').notes).toHaveLength(3);
    expect(res.project.ensemble!.pins.violas).toBe('out');
  });

  it('a pin retires the header tweak beneath it: pin out beats an explicit override in', () => {
    const p = withNotes(
      projectFromFixture({ ensemble: { templateId: 'ensemble.symphony', overrides: { violas: 'in' }, pins: {} } }),
      'violas', 4,
    );
    expect(isInBand('violas', p.ensemble!, symphony)).toBe(true); // the header put it in
    const res = setPin(p, 'violas', 'out');
    if (!res.ok) throw new Error('expected a successful pin');
    expect(res.project.ensemble!.overrides).toEqual({}); // the tweak is retired
    expect(isInBand('violas', res.project.ensemble!, symphony)).toBe(false);
    expect(trackByRole(res.project, 'violas').notes).toEqual([]);
  });

  it('pinning in forces the instrument into every band — even off-roster — and resurrects nothing', () => {
    const p = withNotes(projectFromFixture({ ensemble: { templateId: 'ensemble.chamber', overrides: {}, pins: {} } }), 'tuba', 2);
    expect(isInBand('tuba', p.ensemble!, chamber)).toBe(false); // chamber is strings + piano, no tuba
    const res = setPin(p, 'tuba', 'in');
    if (!res.ok) throw new Error('expected a successful pin');
    expect(isInBand('tuba', res.project.ensemble!, chamber)).toBe(true);
    expect(res.clearedTrackIds).toEqual([]);
    expect(trackByRole(res.project, 'tuba').notes).toHaveLength(2); // nothing resurrected, nothing cleared
  });

  it('removing the pin returns the instrument to band control — and to an empty lane if the pin had swept it', () => {
    const p = withNotes(projectFromFixture({ ensemble: { templateId: 'ensemble.chamber', overrides: {}, pins: {} } }), 'violas', 3);
    const out = setPin(p, 'violas', 'out');
    if (!out.ok) throw new Error('expected a successful pin');
    const back = setPin(out.project, 'violas', null);
    if (!back.ok) throw new Error('expected a successful unpin');
    expect(back.project.ensemble!.pins).toEqual({});
    expect(isInBand('violas', back.project.ensemble!, chamber)).toBe(true); // roster decides again
    expect(trackByRole(back.project, 'violas').notes).toEqual([]); // unpin resurrects nothing — Compose All refills
  });

  it('pinning a role the pin already describes is a no-op (no history spam)', () => {
    const p = projectFromFixture({ ensemble: { templateId: null, overrides: {}, pins: { tuba: 'out' } } });
    expect(setPin(p, 'tuba', 'out')).toMatchObject({ ok: false, reason: 'noop' });
    expect(setPin(p, 'violas', null)).toMatchObject({ ok: false, reason: 'noop' }); // removing a pin that is not there
    expect(p.ensemble!.pins).toEqual({ tuba: 'out' });
  });

  it('refuses roles the band does not manage: Structure, Chords, Reference Audio, unknown', () => {
    const p = projectFromFixture({});
    for (const role of ['structure', 'chords', 'reference', 'theremin']) {
      expect(setPin(p, role, 'out')).toMatchObject({ ok: false, reason: 'notBand', role });
    }
    expect(p.ensemble!.pins).toEqual({});
  });

  it('a legacy project without an ensemble field gains a valid one on its first pin', () => {
    const doc = projectFromFixture({ name: 'Legacy' }) as unknown as Record<string, unknown>;
    delete doc.ensemble;
    const p = doc as unknown as Project;
    const res = setPin(p, 'violas', 'out');
    if (!res.ok) throw new Error('expected a successful pin');
    expect(res.project.ensemble).toEqual({ templateId: null, overrides: {}, pins: { violas: 'out' } });
    expect(validateProject(res.project).ok).toBe(true);
  });

  it('deterministic: same input → identical output, input never mutated, repeated pins agree', () => {
    const p = withNotes(projectFromFixture({ ensemble: { templateId: 'ensemble.symphony', overrides: { harp: 'in' }, pins: {} } }), 'harp', 4);
    const before = JSON.stringify(p);
    const a = setPin(p, 'harp', 'out');
    const b = setPin(p, 'harp', 'out');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(p)).toBe(before);
    expect(validateProject(a.ok ? a.project : p).ok).toBe(true);
  });
});
