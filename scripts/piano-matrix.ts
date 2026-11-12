/**
 * Piano Texture-and-Theme validation matrix.
 *
 * Runs the ordinary production `composeAllTracks` path over a fixed matrix
 * (templates x fixtures x seeds x densities), measures the final Piano track,
 * and exports MIDI through the shipped UVI profile for audition.
 *
 *   npx vite-node scripts/piano-matrix.ts -- <label>
 *
 * Output: evaluation/piano-texture-theme-20261112/<label>/
 * These are structural facts for review, never a musical-quality verdict.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { composeAllTracks } from '../src/orchestrator/compose';
import { buildMergedMidi, buildPerTrackMidi } from '../src/export/midi';
import { EXPORT_PROFILES } from '../src/export/profiles';
import { isInstrumentTrack, projectFromFixture, type Note, type Project } from '../src/shared/schema';
import { barTicks, projectEndTick } from '../src/shared/schema/meter';

const here = path.dirname(fileURLToPath(import.meta.url));
// This matrix documents the accepted Texture-and-Theme Composer, which is now the Classic mode.
// Set PIANO_COMPOSITION=identity to run the same matrix on the identity composer instead.
const PIANO_MODE = process.env.PIANO_COMPOSITION === 'identity' ? 'identity' as const : 'classic' as const;
const label = process.argv.slice(2).find((arg) => /^[a-z0-9-]+$/i.test(arg)) ?? 'run';
const outRoot = path.join(here, '..', 'evaluation', 'piano-texture-theme-20261112', label);
const PROFILE = EXPORT_PROFILES.find((entry) => entry.id === 'uvi-orchestral-suite')!.profile;

const TEMPLATES = [
  { id: 'chamber', templateId: 'ensemble.chamber', standalone: false },
  { id: 'sonata', templateId: 'ensemble.sonata', standalone: false },
  { id: 'vocalbacking', templateId: 'ensemble.vocalbacking', standalone: false },
  { id: 'cinematic', templateId: 'ensemble.cinematic', standalone: false },
  { id: 'hybridstudio', templateId: 'ensemble.hybridstudio', standalone: false },
  { id: 'standalone-chamber', templateId: 'ensemble.chamber', standalone: true },
  { id: 'symphony-negative-control', templateId: 'ensemble.symphony', standalone: false },
] as const;
const FIXTURES = ['dorian-16bars', 'three-chorus-40bars'] as const;
const SEEDS = [0, 11, 29] as const;
const DENSITIES = [{ id: 'low', value: 0.3 }, { id: 'medium', value: 0.6 }, { id: 'high', value: 1 }] as const;
/** MIDI is written for a listening subset; metrics cover the full matrix. */
const exportMidiFor = (seed: number): boolean => seed === 0 || seed === 11;

const PPQ = 960;
const round = (value: number, places = 2): number => Math.round(value * 10 ** places) / 10 ** places;

function measure(notes: readonly Note[], bar: number, bars: number) {
  if (!notes.length) return { notes: 0 };
  const onsets = [...new Set(notes.map((note) => note.startTick))].sort((a, b) => a - b);
  const perBar = Array.from({ length: bars }, (_, index) =>
    new Set(notes.filter((note) => Math.floor(note.startTick / bar) === index).map((note) => note.startTick)).size);
  const grid = { beat: 0, eighth: 0, sixteenth: 0, other: 0 };
  for (const tick of onsets) {
    const rem = tick % PPQ;
    if (rem === 0) grid.beat++;
    else if (rem === PPQ / 2) grid.eighth++;
    else if (rem % (PPQ / 4) === 0) grid.sixteenth++;
    else grid.other++;
  }
  const chordOnsets = onsets.filter((tick) =>
    notes.filter((note) => note.startTick === tick && note.pitch >= 55).length >= 3).length;
  const velocities = notes.map((note) => note.velocity);
  const top = onsets.map((tick) => Math.max(...notes.filter((note) => note.startTick === tick).map((note) => note.pitch)));
  const sorted = [...perBar].sort((a, b) => a - b);
  return {
    notes: notes.length,
    attacks: onsets.length,
    attacksPerBar: round(onsets.length / bars),
    attacksPerBarMin: sorted[0],
    attacksPerBarMedian: sorted[Math.floor(sorted.length / 2)],
    attacksPerBarMax: sorted[sorted.length - 1],
    attacksByBar: perBar,
    grid,
    longNoteShare: round(notes.filter((note) => note.durationTicks >= 2 * PPQ).length / notes.length),
    chordOnsets,
    pitchRange: [Math.min(...notes.map((note) => note.pitch)), Math.max(...notes.map((note) => note.pitch))],
    velocityRange: [Math.min(...velocities), Math.max(...velocities)],
    distinctTopPitches: new Set(top).size,
    emptyBars: perBar.filter((count) => count === 0).length,
  };
}

mkdirSync(path.join(outRoot, 'midi'), { recursive: true });
const rows: unknown[] = [];
const failures: string[] = [];
for (const fixtureId of FIXTURES) {
  const fixture = JSON.parse(readFileSync(path.join(here, '..', 'fixtures', `${fixtureId}.json`), 'utf8'));
  for (const template of TEMPLATES) {
    for (const seed of SEEDS) {
      for (const density of DENSITIES) {
        const id = `${template.id}__${fixtureId}__seed${seed}__${density.id}`;
        try {
          const project: Project = projectFromFixture(JSON.parse(JSON.stringify(fixture)));
          project.ensemble = { templateId: template.templateId, overrides: {}, pins: {} };
          project.orchestration = { take: 0 };
          if (template.standalone) {
            project.tracks = project.tracks.filter((track) => !isInstrumentTrack(track) || track.role === 'piano');
          }
          const result = composeAllTracks(project, { seed, density: density.value, pianoComposition: PIANO_MODE });
          const piano = result.tracks.find((track) => isInstrumentTrack(track) && track.role === 'piano');
          const notes = piano && isInstrumentTrack(piano) ? piano.notes : [];
          const bar = barTicks(project.timeSignature);
          const bars = Math.round(projectEndTick(project) / bar);
          const techniques: Record<string, number> = {};
          for (const event of result.pianoScore?.events ?? []) {
            techniques[event.techniqueIntent] = (techniques[event.techniqueIntent] ?? 0) + 1;
          }
          const diagnostics = (result as unknown as { pianoDiagnostics?: unknown }).pianoDiagnostics ?? null;
          const row = {
            id,
            template: template.id,
            templateId: template.templateId,
            fixture: fixtureId,
            seed,
            density: density.value,
            standalone: template.standalone,
            pianoEligible: result.pianoEngineInput.context.template.pianoEligible,
            scoreEvents: result.pianoScore?.events.length ?? 0,
            playability: {
              warnings: result.pianoPlayability?.warnings.length ?? 0,
              violations: result.pianoPlayability?.violations.length ?? 0,
            },
            cc64Points: piano && isInstrumentTrack(piano)
              ? (piano.cc ?? []).filter((lane) => lane.cc === 64).reduce((sum, lane) => sum + lane.points.length, 0) : 0,
            metrics: measure(notes, bar, bars),
            techniques,
          };
          rows.push(row);
          if (diagnostics) {
            mkdirSync(path.join(outRoot, 'diagnostics'), { recursive: true });
            writeFileSync(path.join(outRoot, 'diagnostics', `${id}.json`), JSON.stringify(diagnostics, null, 1));
          }
          if (exportMidiFor(seed) && piano && notes.length) {
            const out: Project = { ...project, tracks: result.tracks };
            const pianoOnly = buildPerTrackMidi(out, [piano], PROFILE);
            if (pianoOnly[0]) writeFileSync(path.join(outRoot, 'midi', `${id}__piano-only.mid`), pianoOnly[0].data);
            if (!template.standalone && density.id !== 'low') {
              const audible = result.tracks.filter((track) => isInstrumentTrack(track) && track.notes.length > 0);
              writeFileSync(path.join(outRoot, 'midi', `${id}__full-mix.mid`), buildMergedMidi(out, audible, PROFILE));
            }
          }
        } catch (error) {
          failures.push(`${id}: ${(error as Error).message}`);
        }
      }
    }
  }
}

writeFileSync(path.join(outRoot, 'metrics.json'), JSON.stringify({
  label,
  productionPath: 'composeAllTracks -> buildPianoEngineInput -> analyzePianoInput -> composePianoPlan -> composePianoScore -> realizePianoPlanWithAudit -> governKeysVelocities; MIDI via src/export/midi.ts with the uvi-orchestral-suite profile',
  matrix: { templates: TEMPLATES.map((entry) => entry.id), fixtures: FIXTURES, seeds: SEEDS, densities: DENSITIES },
  audioRendered: false,
  failures,
  rows,
}, null, 1));

type Row = { template: string; density: number; fixture: string; metrics: ReturnType<typeof measure>; playability: { warnings: number; violations: number } };
const summary: string[] = ['template | density | fixture | attacks/bar (mean over seeds) | per-bar min–max | long-note share | chord onsets | velocity | 8th+16th share | playability viol/warn'];
for (const template of TEMPLATES) {
  for (const density of DENSITIES) {
    for (const fixtureId of FIXTURES) {
      const group = (rows as Row[]).filter((row) => row.template === template.id && row.density === density.value && row.fixture === fixtureId);
      const withNotes = group.filter((row) => row.metrics.notes > 0);
      if (!withNotes.length) { summary.push(`${template.id} | ${density.id} | ${fixtureId} | no Piano notes`); continue; }
      const mean = (pick: (row: Row) => number) => round(withNotes.reduce((sum, row) => sum + pick(row), 0) / withNotes.length);
      summary.push([
        template.id, density.id, fixtureId,
        mean((row) => row.metrics.attacksPerBar!),
        `${Math.min(...withNotes.map((row) => row.metrics.attacksPerBarMin!))}–${Math.max(...withNotes.map((row) => row.metrics.attacksPerBarMax!))}`,
        mean((row) => row.metrics.longNoteShare!),
        mean((row) => row.metrics.chordOnsets!),
        `${Math.min(...withNotes.map((row) => row.metrics.velocityRange![0]))}–${Math.max(...withNotes.map((row) => row.metrics.velocityRange![1]))}`,
        mean((row) => (row.metrics.grid!.eighth + row.metrics.grid!.sixteenth) / Math.max(1, row.metrics.attacks!)),
        `${withNotes.reduce((sum, row) => sum + row.playability.violations, 0)}/${withNotes.reduce((sum, row) => sum + row.playability.warnings, 0)}`,
      ].join(' | '));
    }
  }
}
writeFileSync(path.join(outRoot, 'summary.txt'), `${summary.join('\n')}\n${failures.length ? `\nFAILURES\n${failures.join('\n')}\n` : ''}`);
console.log(summary.join('\n'));
if (failures.length) console.log(`\nFAILURES (${failures.length})\n${failures.join('\n')}`);
