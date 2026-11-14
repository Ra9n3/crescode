import { afterEach, describe, expect, it, vi } from 'vitest';
import dorian from '../fixtures/dorian-16bars.json';
import { devStringsAuditionOverride } from '../src/dev/stringsAudition';
import { projectFromFixture, type Project } from '../src/shared/schema';
import * as composition from '../src/orchestrator/compose';
import { useStore } from '../src/store/store';

const original = useStore.getState();
afterEach(() => {
  useStore.setState(original, true);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const browserDev = (search = '') => {
  vi.stubEnv('DEV', true);
  vi.stubGlobal('window', { location: { search } });
};

describe('normal local browser Compose All auditions both V1 families', () => {
  it('enables Strings V1 and Woodwinds V1 on the normal URL, without flags', () => {
    browserDev();
    expect(devStringsAuditionOverride()).toEqual({ stringsComposition: 'v1', windsComposition: 'v1' });
  });

  it('also works with the old strings audition URL or unrelated query parameters', () => {
    for (const query of ['?strings=v1', '?foo=bar']) {
      browserDev(query);
      expect(devStringsAuditionOverride()).toEqual({ stringsComposition: 'v1', windsComposition: 'v1' });
    }
  });

  it('does not opt in production browser builds, even at the old query URL', () => {
    browserDev('?strings=v1'); vi.stubEnv('DEV', false);
    expect(devStringsAuditionOverride()).toEqual({});
  });

  it('does not override non-browser callers', () => {
    vi.stubEnv('DEV', true); vi.stubGlobal('window', undefined);
    expect(devStringsAuditionOverride()).toEqual({});
  });

  it('the real store button route produces and saves both V1 results together, and undoes/redoes them', () => {
    browserDev();
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const compose = vi.spyOn(composition, 'composeAllTracks');
    const p = projectFromFixture(structuredClone(dorian) as Partial<Project>);
    p.ensemble = { templateId: 'ensemble.symphony', overrides: {}, pins: {} };
    p.orchestration = { take: 0 };
    useStore.setState({ project: p, past: [], future: [], composeOptions: { seed: 1, density: 1, humanize: false } });
    expect(useStore.getState().composeAll()).not.toBeNull();
    expect(compose).toHaveBeenCalledTimes(1);
    expect(compose.mock.calls[0][1]).toMatchObject({ stringsComposition: 'v1', windsComposition: 'v1' });
    const result = compose.mock.results[0].value as composition.ComposeResult;
    expect(result.stringsDiagnostics.mode).toBe('v1');
    expect(result.stringsDiagnostics.v1?.orchestration?.accepted).toBe(true);
    expect(result.windDiagnostics.route).toBe('v1-final');
    expect(result.windDiagnostics.identity?.version).toBe('winds-v1-stage2');
    expect(result.windDiagnostics.plan?.ensemble?.phrases.length).toBeGreaterThan(0);
    expect(useStore.getState().project.tracks).toEqual(result.tracks);
    expect(useStore.getState().project.orchestration?.take).toBe(1);
    expect(useStore.getState().project).not.toHaveProperty('stringsComposition');
    expect(useStore.getState().project).not.toHaveProperty('windsComposition');
    expect(info).toHaveBeenCalledWith('[composeAll] local audition: Strings V1 + Woodwinds V1', expect.objectContaining({ strings: result.stringsDiagnostics, winds: result.windDiagnostics }));
    useStore.getState().undo(); expect(useStore.getState().project).toEqual(p);
    useStore.getState().redo(); expect(useStore.getState().project.tracks).toEqual(result.tracks);
  }, 30000);
});
