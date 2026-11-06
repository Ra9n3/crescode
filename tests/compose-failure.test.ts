/**
 * Compose All must NEVER fail silently (user report: "the compose all button
 * does not work" — a throw anywhere in the store's compose path used to
 * bubble into the click handler and die there: no toast, no notes, no
 * diagnosis). Contract: when the engine throws, composeAll returns null,
 * toasts the real error and leaves the project (and the undo history)
 * untouched — the same rule switchTemplate follows for the band picker.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../src/orchestrator/compose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/orchestrator/compose')>();
  return { ...actual, composeAllTracks: vi.fn(() => { throw new Error('boom: timpani fold'); }) };
});

import { composeAllTracks } from '../src/orchestrator/compose';
import { useStore } from '../src/store/store';

describe('Compose All failure is never silent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const s = useStore.getState();
    s.loadProject(JSON.parse(JSON.stringify(s.project)));
    s.set({ toasts: [] });
  });

  it('composeAll returns null, toasts the real error and leaves the project untouched', () => {
    const s = useStore.getState();
    const before = s.project;
    const res = s.composeAll();
    expect(res).toBeNull();
    expect(vi.mocked(composeAllTracks)).toHaveBeenCalledTimes(1);

    const toasts = useStore.getState().toasts;
    const last = toasts[toasts.length - 1];
    expect(last.kind).toBe('error');
    expect(last.text).toContain('Compose All failed');
    expect(last.text).toContain('boom: timpani fold');

    // no edit happened: the project reference and the history are untouched
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().past.length).toBe(0);
  });
});
