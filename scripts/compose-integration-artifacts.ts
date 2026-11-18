/**
 * Generates the EARLY VERTICAL INTEGRATION audition artifacts.
 *
 * This drives the REAL application path — the Zustand store's Compose All
 * action, exactly as the button does — rather than the engine in isolation.
 * The output is therefore what the app would actually export.
 *
 * Written separately from `artifacts/phase1/`, which is preserved unchanged:
 * Phase 1 measured the engine alone, this measures the integrated app.
 *
 * Run via its test wrapper (no `tsx` dependency in this repo):
 *   ./node_modules/.bin/vitest run tests/integration/integration-artifacts.test.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import dorian from '../fixtures/dorian-16bars.json';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import { projectFromFixture, isInstrumentTrack, type Project, type Track } from '../src/shared/schema';
import { useStore } from '../src/store/store';
import { buildMergedMidi, buildPerTrackMidi, parseMidiFile } from '../src/export/midi';
import { parseExportProfile } from '../src/export/profile';
import { PPQ } from '../src/shared/schema/types';

export const OUT = join(process.cwd(), 'artifacts', 'integration');

const STRING_ROLES = ['violins1', 'violins2', 'violas', 'cellosBasses'];

const CASES = [
  { name: 'dorian-16bars', fixture: dorian, templateId: 'ensemble.chamber' },
  { name: 'three-chorus-40bars', fixture: threeChorus, templateId: 'ensemble.chamber' },
  { name: 'dorian-16bars', fixture: dorian, templateId: 'ensemble.symphony' },
] as const;

export interface CaseSummary {
  readonly case: string;
  readonly templateId: string;
  readonly ppq: number;
  readonly mergedFile: string;
  readonly mergedBytes: number;
  readonly perTrackFiles: number;
  readonly trackIds: string[];
  readonly tracks: {
    id: string; role: string; notes: number; ccLanes: number;
    minPitch: number | null; maxPitch: number | null;
  }[];
  readonly allNotesInRange: boolean;
  readonly stringNotes: number;
  readonly pianoNotes: number;
  readonly keyswitches: number;
}

export function generateIntegrationArtifacts(): CaseSummary[] {
  mkdirSync(OUT, { recursive: true });
  const profile = parseExportProfile(JSON.parse(
    readFileSync(join(process.cwd(), 'src/export/profiles/uvi-orchestral-suite.json'), 'utf8'),
  ));
  const summaries: CaseSummary[] = [];

  for (const c of CASES) {
    const project = projectFromFixture(JSON.parse(JSON.stringify(c.fixture)) as Partial<Project>);
    project.ensemble = { templateId: c.templateId, overrides: {}, pins: {} };
    project.orchestration = { take: 0 };

    useStore.getState().loadProject(project);
    const before = useStore.getState().project;
    const report = useStore.getState().composeAll();
    expect(report, `${c.name}/${c.templateId} composed`).not.toBeNull();
    const composed = useStore.getState().project;

    // Track identity is preserved exactly — no created, dropped or renamed tracks.
    expect(composed.tracks.map((t) => t.id)).toEqual(before.tracks.map((t) => t.id));

    const base = `${c.name}-${c.templateId.replace('ensemble.', '')}`;
    const mergedFile = `${base}-merged.mid`;
    const merged = buildMergedMidi(composed, composed.tracks, profile);
    writeFileSync(join(OUT, mergedFile), merged);

    const perTrack = buildPerTrackMidi(composed, composed.tracks, profile);
    for (const file of perTrack) writeFileSync(join(OUT, `${base}-${file.fileName}`), file.data);

    const parsed = parseMidiFile(merged);
    expect(parsed.ppq, 'PPQ survives the export').toBe(PPQ);

    const tracks = composed.tracks.filter(isInstrumentTrack).map((track: Track) => {
      const pitches = track.notes.map((note) => note.pitch);
      return {
        id: track.id,
        role: track.role,
        notes: track.notes.length,
        ccLanes: track.cc?.length ?? 0,
        minPitch: pitches.length ? Math.min(...pitches) : null,
        maxPitch: pitches.length ? Math.max(...pitches) : null,
      };
    });

    const allInRange = composed.tracks.filter(isInstrumentTrack).every((track: Track) =>
      track.notes.every((note) => note.pitch >= track.lowestNote && note.pitch <= track.highestNote));

    // Keyswitches: articulation changes on string tracks, the UVI contract.
    const keyswitches = composed.tracks
      .filter((t) => isInstrumentTrack(t) && STRING_ROLES.includes(t.role))
      .reduce((sum, t) => sum + t.notes.filter((n) => n.articulation && n.articulation !== 'sustain').length, 0);

    summaries.push({
      case: c.name,
      templateId: c.templateId,
      ppq: parsed.ppq,
      mergedFile,
      mergedBytes: merged.length,
      perTrackFiles: perTrack.length,
      trackIds: composed.tracks.map((t) => t.id),
      tracks,
      allNotesInRange: allInRange,
      stringNotes: tracks.filter((t) => STRING_ROLES.includes(t.role)).reduce((s, t) => s + t.notes, 0),
      pianoNotes: tracks.find((t) => t.role === 'piano')?.notes ?? 0,
      keyswitches,
    });
  }

  writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summaries, null, 2));
  return summaries;
}
