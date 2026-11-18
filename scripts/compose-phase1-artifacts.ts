/**
 * Generates the Phase 1 audition artifacts through the EXISTING export
 * pipeline (UVI orchestral profile), then parses every file back and prints
 * evidence.
 *
 * Run:  ./node_modules/.bin/tsx scripts/compose-phase1-artifacts.ts
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import dorian from '../fixtures/dorian-16bars.json';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import { projectFromFixture, isInstrumentTrack, type Project, type Track } from '../src/shared/schema';
import { composeOrchestra } from '../src/compose';
import { buildMergedMidi, buildPerTrackMidi, parseMidiFile } from '../src/export/midi';
import { parseExportProfile } from '../src/export/profile';

const OUT = join(process.cwd(), 'artifacts', 'phase1');
mkdirSync(OUT, { recursive: true });

const profileDoc = JSON.parse(
  readFileSync(join(process.cwd(), 'src/export/profiles/uvi-orchestral-suite.json'), 'utf8'),
);
const profile = parseExportProfile(profileDoc);

const CASES = [
  { name: 'dorian-16bars', fixture: dorian, templateId: 'ensemble.chamber', seed: 1 },
  { name: 'three-chorus-40bars', fixture: threeChorus, templateId: 'ensemble.chamber', seed: 1 },
] as const;

interface Summary {
  readonly name: string;
  readonly seed: number;
  readonly tracks: number;
  readonly notesByRole: Record<string, number>;
  readonly mergedFile: string;
  readonly mergedBytes: number;
  readonly parsed: {
    ppq: number;
    format: number;
    trackCount: number;
    perTrack: { name: string; channel: number | null; notes: number; cc: string[]; keyswitches: number }[];
  };
  readonly violations: number;
  readonly reports: string[];
}

const summaries: Summary[] = [];

for (const testCase of CASES) {
  const project: Project = projectFromFixture(
    JSON.parse(JSON.stringify(testCase.fixture)) as Project,
  );
  project.ensemble = { templateId: testCase.templateId, overrides: {}, pins: {} };
  project.orchestration = { take: 0 };
  project.name = `Phase1 ${testCase.name} s${testCase.seed}`;

  const result = composeOrchestra(project, { seed: testCase.seed, take: 1 });
  const composed: Project = { ...project, tracks: result.tracks };

  // Only tracks this engine actually wrote; the rest are untouched project
  // content and are not part of the Phase 1 deliverable.
  const writtenIds = new Set(
    result.score.parts.map((part) => part.trackId),
  );
  const writtenTracks: Track[] = composed.tracks.filter(
    (track) => isInstrumentTrack(track) && writtenIds.has(track.id),
  );

  const merged = buildMergedMidi(composed, writtenTracks, profile);
  const mergedFile = join(OUT, `${testCase.name}-s${testCase.seed}.mid`);
  writeFileSync(mergedFile, merged);

  const perTrack = buildPerTrackMidi(composed, writtenTracks, profile);
  for (const file of perTrack) {
    writeFileSync(join(OUT, `${testCase.name}-s${testCase.seed}-${file.fileName}`), file.data);
  }

  // ---- parse back and record real evidence ----
  const parsed = parseMidiFile(merged);
  const notesByRole: Record<string, number> = {};
  for (const part of result.score.parts) notesByRole[part.role] = part.notes.length;

  const perTrackReport = parsed.tracks.map((track, index) => {
    // A keyswitch is the single short note at tick 0 inside the part's zone.
    const keyswitches = track.notes.filter(
      (note) => note.startTick === 0 && note.durationTicks >= 20 && note.durationTicks <= 60,
    ).length;
    return {
      name: track.name,
      channel: track.channel,
      notes: track.notes.length,
      cc: [...new Set(track.cc.map((event) => String(event.cc)))].sort((a, b) => Number(a) - Number(b)),
      keyswitches,
      index,
    };
  }).filter((track) => track.index > 0); // drop the conductor track

  summaries.push({
    name: testCase.name,
    seed: testCase.seed,
    tracks: writtenTracks.length,
    notesByRole,
    mergedFile,
    mergedBytes: merged.length,
    parsed: {
      ppq: parsed.ppq,
      format: parsed.format,
      trackCount: parsed.tracks.length,
      perTrack: perTrackReport,
    },
    violations: result.violations.length,
    reports: result.reports,
  });
}

writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summaries, null, 2));

for (const summary of summaries) {
  console.log(`\n=== ${summary.name} (seed ${summary.seed}) ===`);
  console.log(`file: ${summary.mergedFile} (${summary.mergedBytes} bytes)`);
  console.log(`seal violations: ${summary.violations}`);
  console.log(`ppq ${summary.parsed.ppq} | format ${summary.parsed.format} | tracks ${summary.parsed.trackCount}`);
  console.log('notes by role:', JSON.stringify(summary.notesByRole));
  for (const track of summary.parsed.perTrack) {
    console.log(
      `  ch ${String(track.channel).padStart(2)} | ${track.name.padEnd(18)} | ` +
      `${String(track.notes).padStart(3)} notes | cc [${track.cc.join(',')}] | ks ${track.keyswitches}`,
    );
  }
  console.log('reports:');
  for (const report of summary.reports) console.log('   ', report);
}
