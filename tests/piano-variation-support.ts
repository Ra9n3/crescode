/**
 * Shared support for the Piano variation measurements (Stage 1).
 *
 * Runs the ordinary production `composeAllTracks` path for one matrix cell and
 * fingerprints the Piano. Used by the baseline-protection tests and by
 * scripts/piano-variation-matrix.ts. Measurement only: nothing here feeds
 * back into composition.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { composeAllTracks, type ComposeResult } from '../src/orchestrator/compose';
import type { PianoCompositionMode } from '../src/orchestrator/keys/piano-composition-identity';
import {
  fingerprintTextureTheme, measureTextureThemeIdentitySurvival, noteProfilesOfTextureTheme, textureThemeFingerprintInputs, type FingerprintInput, type TextureThemeFingerprints,
} from '../src/orchestrator/keys/piano-fingerprint';
import type { IdentitySurvival, PianoNoteProfile } from '../src/orchestrator/keys/piano-note-analysis';
import { isInstrumentTrack, projectFromFixture, type Project, type Track } from '../src/shared/schema';
import { beatTicks } from '../src/shared/schema/meter';

const here = path.dirname(fileURLToPath(import.meta.url));

export const PIANO_TEMPLATES = ['chamber', 'sonata', 'vocalbacking', 'cinematic', 'hybridstudio'] as const;
export type PianoTemplateKey = typeof PIANO_TEMPLATES[number];
export const PIANO_FIXTURES = ['dorian-16bars', 'three-chorus-40bars'] as const;
export type PianoFixtureKey = typeof PIANO_FIXTURES[number];

export interface PianoCell {
  readonly template: PianoTemplateKey | 'symphony';
  readonly fixture: PianoFixtureKey;
  readonly seed: number;
  /** Take stored on the project before composing; the app increments it on every Compose All. */
  readonly take: number;
  readonly density: number;
  /** Semitones the whole fixture (key and chords) is moved up. */
  readonly transpose: number;
  /** Piano-only project: every other instrument track is removed. */
  readonly standalone: boolean;
  /** Piano composition mode; omitted means the production default (identity). */
  readonly mode?: PianoCompositionMode;
}

export const cellId = (cell: PianoCell): string =>
  `${cell.template}${cell.standalone ? '-solo' : ''}__${cell.fixture}__key+${cell.transpose}__seed${cell.seed}__take${cell.take}__d${cell.density}${cell.mode && cell.mode !== 'classic' ? `__${cell.mode}` : ''}`;

const NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const NATURAL: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Transpose one chord symbol (root and optional slash bass); the quality is left untouched. */
export function transposeChordSymbol(symbol: string, semitones: number): string {
  const move = (text: string): string => text.replace(/^([A-G])([#b]?)/, (_, letter: string, accidental: string) => {
    const pitch = NATURAL[letter] + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0);
    return NOTE_NAMES[(((pitch + semitones) % 12) + 12) % 12];
  });
  const [head, bass] = symbol.split('/');
  return bass === undefined ? move(head) : `${move(head)}/${move(bass)}`;
}

/** A copy of a fixture document in another key: key and every chord symbol move together. */
export function transposeFixture<T extends { key: number; chords: { symbol: string }[] }>(doc: T, semitones: number): T {
  const copy = JSON.parse(JSON.stringify(doc)) as T;
  copy.key = (((copy.key + semitones) % 12) + 12) % 12;
  for (const chord of copy.chords) chord.symbol = transposeChordSymbol(chord.symbol, semitones);
  return copy;
}

export function loadFixture(fixture: PianoFixtureKey): { key: number; chords: { symbol: string }[] } & Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(here, '..', 'fixtures', `${fixture}.json`), 'utf8'));
}

export function projectForCell(cell: PianoCell): Project {
  const project = projectFromFixture(transposeFixture(loadFixture(cell.fixture), cell.transpose) as Partial<Project>);
  project.ensemble = { templateId: `ensemble.${cell.template}`, overrides: {}, pins: {} };
  project.orchestration = { take: cell.take };
  if (cell.standalone) project.tracks = project.tracks.filter((track) => !isInstrumentTrack(track) || track.role === 'piano');
  return project;
}

export interface PianoCellRun {
  readonly cell: PianoCell;
  readonly project: Project;
  readonly result: ComposeResult;
  readonly piano: Extract<Track, { notes: unknown }> | null;
  /** Null when the template has no Piano or nothing was composed. */
  readonly fingerprints: TextureThemeFingerprints | null;
  readonly inputs: { independent: FingerprintInput; adapted: FingerprintInput } | null;
  /** Stage 2: what adaptation kept of the piece's identity, and note-only profiles. */
  readonly survival: IdentitySurvival | null;
  readonly noteProfiles: { independent: PianoNoteProfile; adapted: PianoNoteProfile; melodyLabelAgreement: number } | null;
}

export function runPianoCell(cell: PianoCell): PianoCellRun {
  const project = projectForCell(cell);
  const result = composeAllTracks(project, { seed: cell.seed, density: cell.density, pianoComposition: cell.mode });
  const piano = result.tracks.find((track) => isInstrumentTrack(track) && track.role === 'piano') ?? null;
  const diagnostics = result.pianoDiagnostics;
  const context = diagnostics ? {
    diagnostics,
    scoreEvents: result.pianoScore.events,
    barWindows: result.pianoEngineInput.context.barWindows,
    beatTicks: beatTicks(project.timeSignature),
    tonicPitchClass: project.key,
  } : null;
  return {
    cell, project, result,
    piano: piano && isInstrumentTrack(piano) ? piano : null,
    fingerprints: context ? fingerprintTextureTheme(context) : null,
    inputs: context ? textureThemeFingerprintInputs(context) : null,
    survival: context ? measureTextureThemeIdentitySurvival(context) : null,
    noteProfiles: context ? noteProfilesOfTextureTheme(context) : null,
  };
}
