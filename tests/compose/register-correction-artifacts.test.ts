/**
 * Generates audition artifacts for the configurations the Phase 2 defects
 * actually occurred in.
 *
 * Why a separate set: the existing `artifacts/integration/` cases use the
 * chamber and symphony templates. Symphony is `octaveDoubling: allowed`, which
 * by design asks for no chord-tone coordination, and the chamber case at these
 * seeds had no register defect to correct — so those artifacts are legitimately
 * unchanged by the coordination work. The defect measured in the investigation
 * needs a template where a LOW instrument takes the melody while a HIGH
 * instrument plays underneath, which is sonata (violins1 + cellosBasses only).
 *
 * Output goes to `artifacts/coordination/`; the baseline MIDI in
 * `artifacts/integration/` and `artifacts/baseline-pre-coordination/` is never
 * touched.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import dorian from '../../fixtures/dorian-16bars.json';
import threeChorus from '../../fixtures/three-chorus-40bars.json';
import { projectFromFixture, isInstrumentTrack, type Project } from '../../src/shared/schema';
import { composeOrchestra } from '../../src/compose';
import { buildMergedMidi, buildPerTrackMidi } from '../../src/export/midi';
import { readFileSync } from 'node:fs';
import { parseExportProfile } from '../../src/export/profile';

const OUT = join(process.cwd(), 'artifacts', 'coordination');

const CASES = [
  { name: 'dorian-16bars', fixture: dorian, templateId: 'ensemble.sonata', seed: 1 },
  { name: 'three-chorus-40bars', fixture: threeChorus, templateId: 'ensemble.sonata', seed: 1 },
  { name: 'three-chorus-40bars', fixture: threeChorus, templateId: 'ensemble.chamber', seed: 3 },
] as const;

it('generates coordinated-audition MIDI for the defect configurations', () => {
  mkdirSync(OUT, { recursive: true });
  const profile = parseExportProfile(JSON.parse(
    readFileSync(join(process.cwd(), 'src/export/profiles/uvi-orchestral-suite.json'), 'utf8'),
  ));

  for (const c of CASES) {
    const project = projectFromFixture(JSON.parse(JSON.stringify(c.fixture)) as Partial<Project>);
    project.ensemble = { templateId: c.templateId, overrides: {}, pins: {} };
    const result = composeOrchestra(project, { seed: c.seed, take: 1 });

    const base = `${c.name}-${c.templateId.replace('ensemble.', '')}-seed${c.seed}`;
    writeFileSync(
      join(OUT, `${base}-merged.mid`),
      buildMergedMidi({ ...project, tracks: result.tracks }, result.tracks.filter(isInstrumentTrack), profile),
    );
    for (const file of buildPerTrackMidi({ ...project, tracks: result.tracks }, result.tracks.filter(isInstrumentTrack), profile)) {
      writeFileSync(join(OUT, `${base}-${file.fileName}`), file.data);
    }

    // The defect this set exists to demonstrate must be gone.
    for (const part of result.score.parts) {
      if (part.role === 'piano') continue;
      const [low, high] = part.register.comfortable;
      for (const note of part.notes) {
        expect(note.pitch, `${c.name}/${c.templateId} ${part.role} below its register`)
          .toBeGreaterThanOrEqual(low);
        expect(note.pitch).toBeLessThanOrEqual(high);
      }
    }
  }
  expect(CASES.length).toBeGreaterThan(0);
}, 300_000);
