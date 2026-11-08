import { describe, expect, it } from 'vitest';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { projectFromFixture, type Project } from '../src/shared/schema';

function vocalBacking(take: number) {
  const project = projectFromFixture(JSON.parse(JSON.stringify(threeChorus)) as Project);
  project.ensemble = { templateId: 'ensemble.vocalbacking', overrides: {}, pins: {} };
  project.orchestration = { take: take - 1 };
  const result = composeAllTracks(project, { seed: 11 });
  return { project: { ...project, tracks: result.tracks } as Project, result };
}

describe('Phase 11.1 vocalbacking piano registers', () => {
  it('keeps anchor LH in 40-56, RH at 82+, and the 57-81 vocal zone empty', () => {
    const { project } = vocalBacking(1);
    const piano = project.tracks.find((t) => t.role === 'piano')!;
    expect(piano.notes.length).toBeGreaterThan(0);
    expect(piano.notes.every((n) => ['anchor', 'lift', 'settle', 'bed', 'atmosphere', 'arrival', 'punctuation', 'power'].includes(n.roleTag ?? ''))).toBe(true);
    expect(piano.notes.some((n) => n.roleTag === 'anchor')).toBe(true);
    expect(piano.notes.every((n) => (n.pitch >= 40 && n.pitch <= 56) || n.pitch >= 82 || (n.articulation === 'marcato' && n.pitch >= 36 && n.pitch < 40))).toBe(true);
    expect(piano.notes.some((n) => n.pitch >= 57 && n.pitch <= 81)).toBe(false);
  });
});
