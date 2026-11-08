import { describe, expect, it } from 'vitest';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { projectFromFixture, validateProject, type Project } from '../src/shared/schema';

function compose(take: number) {
  const project = projectFromFixture(JSON.parse(JSON.stringify(threeChorus)) as Project);
  project.ensemble = { templateId: 'ensemble.chamber', overrides: {}, pins: {} };
  project.orchestration = { take: take - 1 };
  const result = composeAllTracks(project, { seed: 11 });
  return { project: { ...project, tracks: result.tracks } as Project, result };
}

describe('Phase 11 keys smoke contract', () => {
  it('plans anchor roles before rendering and exposes the role counts in the compose log', () => {
    const { project, result } = compose(1);
    const plan = result.plan.keys;
    const activeBars = plan.bars.filter((b) => b.pianoRole === 'anchor').length;
    const piano = project.tracks.find((t) => t.role === 'piano')!;
    expect(activeBars).toBeGreaterThan(0);
    expect(plan.pianoRoleCounts.anchor).toBe(activeBars);
    expect(piano.notes.length).toBeGreaterThan(0);
    expect(piano.notes.every((n) => ['anchor', 'lift', 'settle', 'bed', 'atmosphere', 'arrival', 'punctuation', 'power', 'answer'].includes(n.roleTag ?? ''))).toBe(true);
    expect(piano.notes.some((n) => n.roleTag === 'anchor')).toBe(true);
    expect(result.reports.some((line) => line.includes(`keys piano roles (take 1): anchor=${activeBars}, answer=${plan.pianoRoleCounts.answer} planned bars`))).toBe(true);
    expect(validateProject(project).ok).toBe(true);
  });
});
