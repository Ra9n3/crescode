import { describe, expect, it } from 'vitest';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { projectFromFixture, type Project } from '../src/shared/schema';

function compose(take: number) {
  const project = projectFromFixture(JSON.parse(JSON.stringify(threeChorus)) as Project);
  project.ensemble = { templateId: 'ensemble.hybridstudio', overrides: {}, pins: {} };
  project.orchestration = { take: take - 1 };
  const result = composeAllTracks(project, { seed: 11 });
  return { project: { ...project, tracks: result.tracks } as Project, result };
}

describe('Phase 11.5 deterministic keys plan', () => {
  it('keeps the harp figure plan deterministic and the piano role assignment independent of drawing', () => {
    const a = compose(4);
    const b = compose(4);
    expect(a.result.plan.keys.harpFigures).toEqual(b.result.plan.keys.harpFigures);
    expect(a.result.plan.keys.bars.map((bar) => [bar.bar, bar.pianoRole])).toEqual(
      b.result.plan.keys.bars.map((bar) => [bar.bar, bar.pianoRole]),
    );
    expect(JSON.stringify(a.project.tracks)).toBe(JSON.stringify(b.project.tracks));
    const pianoNotes = a.project.tracks.find((t) => t.role === 'piano')!.notes;
    expect(pianoNotes.every((n) => ['anchor', 'lift', 'settle', 'bed', 'atmosphere', 'arrival', 'punctuation', 'power', 'answer', 'flourish'].includes(n.roleTag ?? ''))).toBe(true);
    expect(pianoNotes.some((n) => n.roleTag === 'anchor')).toBe(true);
  });
});
