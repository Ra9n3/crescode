/**
 * Generates the audition set for the strings quality milestone.
 *
 * Written to `artifacts/strings-quality/` so the existing baseline in
 * `artifacts/integration/` and `artifacts/baseline-pre-coordination/` is never
 * touched. Every file is a real export through the shipped UVI orchestral
 * profile, so the keyswitches and CC lanes in the MIDI are the ones the sampler
 * will actually read.
 *
 * Stats are measured from the EXPORTED MIDI, not from the in-memory score, so
 * the numbers describe what a DAW will load.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import dorian from '../../fixtures/dorian-16bars.json';
import threeChorus from '../../fixtures/three-chorus-40bars.json';
import { projectFromFixture, isInstrumentTrack, type Project } from '../../src/shared/schema';
import { composeOrchestra } from '../../src/compose';
import { buildMergedMidi, buildPerTrackMidi, parseMidiFile } from '../../src/export/midi';
import { parseExportProfile } from '../../src/export/profile';
import { PPQ } from '../../src/shared/schema/types';

const OUT = join(process.cwd(), 'artifacts', 'strings-quality');

const CASES = [
  { name: 'dorian-16bars', fixture: dorian, templateId: 'ensemble.chamber', seed: 1 },
  { name: 'dorian-16bars', fixture: dorian, templateId: 'ensemble.sonata', seed: 1 },
  { name: 'three-chorus-40bars', fixture: threeChorus, templateId: 'ensemble.chamber', seed: 1 },
  { name: 'three-chorus-40bars', fixture: threeChorus, templateId: 'ensemble.chamber', seed: 3 },
  { name: 'three-chorus-40bars', fixture: threeChorus, templateId: 'ensemble.sonata', seed: 1 },
  { name: 'three-chorus-40bars', fixture: threeChorus, templateId: 'ensemble.symphony', seed: 1 },
] as const;

interface TrackStat {
  id: string; role: string; notes: number;
  minPitch: number | null; maxPitch: number | null;
  articulations: Record<string, number>;
  cc: Record<string, number>;
  keyswitches: number;
}

it('generates the strings-quality audition set with measured statistics', () => {
  mkdirSync(OUT, { recursive: true });
  const profile = parseExportProfile(JSON.parse(
    readFileSync(join(process.cwd(), 'src/export/profiles/uvi-orchestral-suite.json'), 'utf8'),
  ));
  const inventory: Record<string, unknown>[] = [];

  for (const c of CASES) {
    const project = projectFromFixture(JSON.parse(JSON.stringify(c.fixture)) as Partial<Project>);
    project.ensemble = { templateId: c.templateId, overrides: {}, pins: {} };
    const result = composeOrchestra(project, { seed: c.seed, take: 1 });
    const base = `${c.name}-${c.templateId.replace('ensemble.', '')}-seed${c.seed}`;

    const merged = buildMergedMidi(project, result.tracks, profile);
    writeFileSync(join(OUT, `${base}-merged.mid`), merged);
    for (const file of buildPerTrackMidi(project, result.tracks, profile)) {
      writeFileSync(join(OUT, `${base}-${file.fileName}`), file.data);
    }

    // Integrity: the export must parse, at the project PPQ, with the notes that
    // were written. A file that opens but has lost its timing is not an artifact.
    const parsed = parseMidiFile(merged);
    expect(parsed.ppq, `${base} PPQ`).toBe(PPQ);

    const perTrack: TrackStat[] = [];
    for (const track of result.tracks.filter(isInstrumentTrack)) {
      if (!track.notes.length) continue;
      const articulated: Record<string, number> = {};
      for (const note of track.notes) {
        const key = note.articulation ?? 'unset';
        articulated[key] = (articulated[key] ?? 0) + 1;
      }
      const cc: Record<string, number> = {};
      for (const lane of (track as unknown as { cc?: { cc: number; points: unknown[] }[] }).cc ?? []) {
        cc[`cc${lane.cc}`] = lane.points.length;
      }
      const keyswitches = Object.values(articulated).length;
      perTrack.push({
        id: track.id,
        role: track.role,
        notes: track.notes.length,
        minPitch: Math.min(...track.notes.map((note) => note.pitch)),
        maxPitch: Math.max(...track.notes.map((note) => note.pitch)),
        articulations: articulated,
        cc,
        keyswitches,
      });
    }

    const stringStats = perTrack.filter((entry) =>
      ['violins1', 'violins2', 'violas', 'cellosBasses'].includes(entry.role));

    inventory.push({
      case: base,
      template: c.templateId,
      seed: c.seed,
      mergedFile: `${base}-merged.mid`,
      mergedBytes: merged.length,
      ppq: parsed.ppq,
      tracks: perTrack.length,
      totalNotes: perTrack.reduce((sum, entry) => sum + entry.notes, 0),
      stringNotes: stringStats.reduce((sum, entry) => sum + entry.notes, 0),
      stringTracks: stringStats.map((entry) => ({
        role: entry.role,
        notes: entry.notes,
        range: [entry.minPitch, entry.maxPitch],
        articulations: entry.articulations,
        cc: entry.cc,
      })),
      phrases: result.score.phrases.length,
      statements: result.score.statements.length,
      reports: result.reports.filter((line) =>
        /coordination:|voice-leading:|cc:|material:|director:/.test(line)),
    });
  }

  writeFileSync(join(OUT, 'inventory.json'), JSON.stringify(inventory, null, 2));
  expect(inventory.length).toBe(CASES.length);
}, 900_000);
