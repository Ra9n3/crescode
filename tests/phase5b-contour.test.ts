import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/dorian-16bars.json';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import { resolveTemplate } from '../src/config/ensembles';
import { composeAllTracks } from '../src/orchestrator/compose';
import { chordSpans, sectionMap, energyCurve } from '../src/orchestrator/spine';
import { prepareStrings } from '../src/orchestrator/render';
import { contourOf } from '../src/orchestrator/lines/motif';
import type { Note, Project } from '../src/shared/schema/types';
import { projectFromFixture } from '../src/shared/schema';

/**
 * Phase 5b — the motif contour survives chord-tone snapping: strong-beat
 * snapping preserves each interval's DIRECTION (the same-direction chord
 * tone is preferred at every distance, in the snap and in the post-settle
 * re-snap), so the raised Chorus statement keeps the Verse contour on every
 * take. Asserted for ALL takes 0–5 on BOTH fixtures — not a pinned take.
 */
const BASE = (): Project => projectFromFixture(JSON.parse(JSON.stringify(fixture)));
const THREE = (): Project => projectFromFixture(JSON.parse(JSON.stringify(threeChorus)));

/** The planned lead motif for one compose, rebuilt deterministically. */
const plannedLead = (project: Project, take: number) => {
  project.ensemble = { templateId: 'ensemble.cinematic', overrides: {}, pins: {} };
  project.orchestration = { take };
  const composed = composeAllTracks(project, { seed: 11 });
  const used = composed.orchestration.take;
  const full = { ...project, orchestration: composed.orchestration, tracks: composed.tracks } as Project;
  const template = resolveTemplate(full.ensemble)!;
  const sections = sectionMap(full);
  const arc = energyCurve(full, sections, used, template, true);
  const lines = prepareStrings({ project: full, template, ensemble: full.ensemble!, spans: chordSpans(full), sections, arc }, used);
  return { sections, lines };
};

const agree = (a: string, b: string): number => [...a].filter((c, i) => c === b[i]).length / Math.min(a.length, b.length);

describe('Phase 5b: verse vs chorus contour agreement on every take (0–5), both fixtures', () => {
  const cases: { name: string; make: () => Project; verseOf: (n: Note, sections: ReturnType<typeof sectionMap>) => boolean; chorusOf: (n: Note, sections: ReturnType<typeof sectionMap>) => boolean }[] = [
    {
      name: 'dorian 16-bar',
      make: BASE,
      verseOf: (n, secs) => n.startTick < (secs.find((s) => /chorus/i.test(s.name))?.startTick ?? 0),
      chorusOf: (n, secs) => n.startTick >= (secs.find((s) => /chorus/i.test(s.name))?.startTick ?? Infinity),
    },
    {
      name: 'three-chorus 40-bar',
      make: THREE,
      verseOf: (n, secs) => {
        const v1 = secs.find((s) => /verse/i.test(s.name))!;
        const c1 = secs.find((s) => /chorus/i.test(s.name))!;
        return n.startTick >= v1.startTick && n.startTick < c1.startTick; // the statement verse only
      },
      chorusOf: (n, secs) => secs.filter((s) => /chorus/i.test(s.name)).some((s) => n.startTick >= s.startTick && n.startTick < s.endTick),
    },
  ];

  for (const c of cases) {
    it(`${c.name}: agreement >= 0.7 for takes 0..5 (cinematic planned lead)`, () => {
      const rows: string[] = [];
      for (let take = 0; take <= 5; take++) {
        const { sections, lines } = plannedLead(c.make(), take);
        expect(lines.lead).toBeTruthy();
        const verse = lines.lead!.notes.filter((n) => c.verseOf(n, sections));
        const chorus = lines.lead!.notes.filter((n) => c.chorusOf(n, sections));
        const vc = contourOf(verse);
        const cc = contourOf(chorus);
        const a = agree(vc, cc);
        rows.push(`  take ${take}: verse "${vc}" (${vc.length}) chorus "${cc}" (${cc.length}) agreement ${a.toFixed(2)}`);
        expect(a).toBeGreaterThanOrEqual(0.7);
        // the chorus is still the raised register
        const mean = (ns: Note[]) => ns.reduce((s, n) => s + n.pitch, 0) / ns.length;
        expect(mean(chorus)).toBeGreaterThan(mean(verse));
      }
      console.log(`5b contour agreement (${c.name}, cinematic planned lead):\n${rows.join('\n')}`);
    });
  }
});
