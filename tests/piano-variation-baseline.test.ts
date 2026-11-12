import { describe, expect, it } from 'vitest';
import { buildMergedMidi, buildPerTrackMidi, parseMidiFile } from '../src/export/midi';
import { EXPORT_PROFILES } from '../src/export/profiles';
import { analyzePianoInput } from '../src/orchestrator/keys/piano-analyzer';
import { composePianoPlan } from '../src/orchestrator/keys/piano-composer';
import {
  classifySimilarity, compareFingerprints, fingerprintDigest, fingerprintPiano, transposeFingerprintInput,
  FINGERPRINT_GRID_TICKS, STAGE1_THRESHOLDS,
} from '../src/orchestrator/keys/piano-fingerprint';
import { realizePianoPlanWithAudit } from '../src/orchestrator/keys/piano-realizer';
import { createPianoScore, type PianoScoreEvent } from '../src/orchestrator/keys/piano-score';
import { isInstrumentTrack, type Note, type Track } from '../src/shared/schema';
import { projectEndTick } from '../src/shared/schema/meter';
import { PPQ } from '../src/shared/schema/types';
import { PIANO_TEMPLATES, cellId, runPianoCell, transposeChordSymbol, type PianoCell, type PianoCellRun } from './piano-variation-support';

/**
 * Piano Performance Styles, Stage 1: measurement and baseline protection.
 *
 * Every case runs the ordinary production Compose All path. The snapshot pins
 * the Texture-and-Theme Composer as auditioned; a change to it is a change of
 * Piano musical behaviour and has to be reviewed, never updated by reflex.
 * The fingerprints measure structure. They do not judge how anything sounds.
 */
// Classic is the regression mode: it must keep reproducing the accepted Texture-and-Theme Composer.
const BASE: PianoCell = { template: 'chamber', fixture: 'dorian-16bars', seed: 1, take: 0, density: 0.6, transpose: 0, standalone: false, mode: 'classic' };
const cache = new Map<string, PianoCellRun>();
const run = (overrides: Partial<PianoCell> = {}): PianoCellRun => {
  const cell = { ...BASE, ...overrides };
  const id = cellId(cell);
  let value = cache.get(id);
  if (!value) cache.set(id, value = runPianoCell(cell));
  return value;
};
const adapted = (overrides: Partial<PianoCell> = {}) => run(overrides).fingerprints!.adapted;
const noteKey = (note: Pick<Note, 'pitch' | 'startTick' | 'durationTicks' | 'velocity'>) => `${note.startTick}:${note.durationTicks}:${note.pitch}:${note.velocity}`;
const cc64 = (track: { cc?: { cc: number; points: { tick: number; value: number }[] }[] } | null) =>
  (track?.cc?.find((lane) => lane.cc === 64)?.points ?? []).map((point) => `${point.tick}:${point.value}`);
const textDigest = (text: string): string => {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
  return hash.toString(16).padStart(8, '0');
};
const profile = EXPORT_PROFILES[0].profile;

describe('Piano fingerprints', () => {
  it('are deterministic and compact', () => {
    const first = runPianoCell(BASE);
    const second = runPianoCell(BASE);
    expect(JSON.stringify(second.fingerprints)).toBe(JSON.stringify(first.fingerprints));
    expect(JSON.stringify(second.piano!.notes)).toBe(JSON.stringify(first.piano!.notes));
    expect(JSON.stringify(second.piano!.cc)).toBe(JSON.stringify(first.piano!.cc));
    expect(JSON.stringify(first.fingerprints!.adapted).length).toBeLessThan(12000);
    const comparison = compareFingerprints(first.fingerprints!.adapted, second.fingerprints!.adapted);
    expect(comparison.exact).toBe(true);
    expect(comparison.overall).toBe(0);
    expect(classifySimilarity(comparison).classification).toBe('same');
  });

  it('recognise the same notes in another key as a transposition, in every template', () => {
    for (const template of PIANO_TEMPLATES) for (const semitones of [5, -3, 1]) {
      const source = run({ template });
      const moved = fingerprintPiano(transposeFingerprintInput(source.inputs!.adapted, semitones));
      const comparison = compareFingerprints(source.fingerprints!.adapted, moved);
      expect(comparison.exact, `${template} ${semitones}`).toBe(false);
      expect(comparison.exactTransposition, `${template} ${semitones}`).toBe(true);
      expect(comparison.overall, `${template} ${semitones}`).toBeLessThanOrEqual(STAGE1_THRESHOLDS.sameOverall);
      expect(classifySimilarity(comparison).classification, `${template} ${semitones}`).toBe('transposed');
    }
  });

  it('do not mistake raw note differences for variation', () => {
    // One octave up: every MIDI pitch differs, the composition does not.
    const source = run();
    const moved = fingerprintPiano(transposeFingerprintInput(source.inputs!.adapted, 12));
    const comparison = compareFingerprints(source.fingerprints!.adapted, moved);
    expect(comparison.dimensions.theme).toBe(0);
    expect(comparison.dimensions.rhythm).toBe(0);
    expect(comparison.dimensions.development).toBe(0);
    expect(['same', 'transposed']).toContain(classifySimilarity(comparison).classification);
  });

  it('order the calibration anchors: same generation < other density < other template', () => {
    for (const template of PIANO_TEMPLATES) {
      const base = adapted({ template });
      const density = compareFingerprints(base, adapted({ template, density: 1 }));
      expect(density.dimensions.theme, `${template} density theme`).toBeLessThan(STAGE1_THRESHOLDS.different.theme);
      expect(classifySimilarity(density).classification, `${template} density`).toBe('variation');
      for (const other of PIANO_TEMPLATES) {
        if (other === template) continue;
        const comparison = compareFingerprints(base, adapted({ template: other }));
        expect(comparison.dimensions.theme, `${template} vs ${other} theme`).toBeGreaterThan(density.dimensions.theme);
        expect(comparison.overall, `${template} vs ${other}`).toBeGreaterThan(0.2);
        expect(['variation', 'different'], `${template} vs ${other}`).toContain(classifySimilarity(comparison).classification);
      }
    }
  });

  it('represents every baseline onset exactly: integer ticks, off-grid only in suspensions', () => {
    for (const template of PIANO_TEMPLATES) {
      for (const event of run({ template }).result.pianoScore.events) {
        expect(Number.isInteger(event.startTick) && Number.isInteger(event.durationTicks), `${template} ${event.id}`).toBe(true);
        // Suspension preparations and resolutions sit at 288 and 576 ticks inside the beat, off the
        // 40-tick grid. The fingerprint keeps such positions as exact tick tokens instead of rounding.
        if (event.startTick % FINGERPRINT_GRID_TICKS !== 0) expect(event.musicalRole, `${template} ${event.id}`).toBe('suspension');
      }
      expect(adapted({ template }).rhythm.subdivision.other, template).toBeLessThan(0.1);
    }
  });

  it('transposes fixture chord symbols with their slash basses', () => {
    expect(transposeChordSymbol('Dm7', 5)).toBe('Gm7');
    expect(transposeChordSymbol('G/B', 5)).toBe('C/E');
    expect(transposeChordSymbol('Bbmaj7', 5)).toBe('Ebmaj7');
    expect(transposeChordSymbol('A7sus4', -2)).toBe('G7sus4');
    expect(run({ transpose: 5 }).project.key).toBe(7);
  });
});

describe('Texture-and-Theme baseline protection', () => {
  it('pins the auditioned baseline: notes, pedal and both fingerprints', () => {
    const cells: Partial<PianoCell>[] = [
      ...PIANO_TEMPLATES.map((template) => ({ template })),
      ...PIANO_TEMPLATES.map((template) => ({ template, standalone: true })),
      { template: 'chamber', seed: 11 }, { template: 'sonata', take: 1 }, { template: 'cinematic', density: 1 },
      { template: 'hybridstudio', density: 0.3 }, { template: 'vocalbacking', transpose: 5 },
      { template: 'chamber', fixture: 'three-chorus-40bars' }, { template: 'cinematic', fixture: 'three-chorus-40bars', standalone: true },
    ];
    const pinned = Object.fromEntries(cells.map((overrides) => {
      const value = run(overrides);
      const { independent, adapted: final, retention } = value.fingerprints!;
      return [cellId(value.cell), {
        notes: value.piano!.notes.length,
        noteDigest: textDigest(value.piano!.notes.map(noteKey).join(',')),
        pedalPoints: cc64(value.piano).length,
        pedalDigest: textDigest(cc64(value.piano).join(',')),
        scoreEvents: value.result.pianoScore.events.length,
        independentFingerprint: fingerprintDigest(independent),
        adaptedFingerprint: fingerprintDigest(final),
        themeRhythm: final.theme.rhythm.join(' | '),
        roles: final.development.roles.join(' '),
        texture: final.development.texture.join(''),
        retention,
      }];
    }));
    expect(pinned).toMatchSnapshot();
  });

  it('keeps the same planned theme with and without the orchestra', () => {
    for (const template of PIANO_TEMPLATES) {
      const full = adapted({ template });
      const solo = adapted({ template, standalone: true });
      expect(solo.theme.contour, template).toEqual(full.theme.contour);
      expect(solo.theme.rhythm, template).toEqual(full.theme.rhythm);
    }
  });

  it('composes independently: the Piano-only result is the independent draft', () => {
    for (const template of PIANO_TEMPLATES) {
      const { retention, independent, adapted: final } = run({ template, standalone: true }).fingerprints!;
      expect(retention.events, `${template} events`).toBeGreaterThanOrEqual(0.9);
      expect(retention.themeNotes, `${template} theme`).toBeGreaterThanOrEqual(0.9);
      expect(retention.rhythmicMotif, `${template} rhythm`).toBeGreaterThanOrEqual(0.9);
      expect(retention.textureChanged, `${template} texture`).toBe(0);
      expect(compareFingerprints(independent, final).dimensions.theme, template).toBeLessThan(STAGE1_THRESHOLDS.different.theme);
    }
  });

  it('states a theme and brings it back', () => {
    for (const template of PIANO_TEMPLATES) for (const standalone of [false, true]) {
      const final = adapted({ template, standalone });
      const name = `${template} ${standalone ? 'solo' : 'full'}`;
      expect(final.theme.contour.length, name).toBeGreaterThan(0);
      expect(final.theme.recurrence, name).toBeGreaterThanOrEqual(0.4);
      // Exact restatements are guaranteed only without an orchestra: adaptation may leave none
      // (14 of 300 full-arrangement generations in the Stage 1 matrix have no exact theme bar).
      if (standalone) expect(final.theme.relations.filter((relation) => relation === 'exact').length, name).toBeGreaterThanOrEqual(2);
      expect(new Set(final.development.operations).size, name).toBeGreaterThanOrEqual(2);
    }
  });

  it('bounds orchestral adaptation: the theme and the plan survive it', () => {
    for (const template of PIANO_TEMPLATES) {
      const value = run({ template });
      const { retention, independent, adapted: final } = value.fingerprints!;
      // Floors sit below the lowest value in the Stage 1 matrix (events 0.23, hybridstudio).
      expect(retention.events, `${template} events`).toBeGreaterThanOrEqual(0.2);
      expect(retention.themeNotes, `${template} theme notes`).toBeGreaterThanOrEqual(0.25);
      expect(final.development.roles, template).toEqual(independent.development.roles);
      expect(final.theme.contour, template).toEqual(independent.theme.contour);
      expect(final.theme.recurrence, template).toBeGreaterThan(0);
      expect(value.piano!.notes.length, template).toBeGreaterThan(0);
    }
  });

  it('stays playable', () => {
    for (const template of PIANO_TEMPLATES) for (const standalone of [false, true]) for (const density of [0.3, 1]) {
      expect(run({ template, standalone, density }).result.pianoPlayability.violations, `${template} ${standalone} ${density}`).toEqual([]);
    }
  });

  it('keeps Symphony without a Piano', () => {
    const value = run({ template: 'symphony' });
    expect(value.piano?.notes ?? []).toEqual([]);
    expect(value.result.pianoScore.events).toEqual([]);
    expect(value.fingerprints).toBeNull();
  });

  it('gives each template its own accompaniment and development', () => {
    const seen = new Set<string>();
    for (const template of PIANO_TEMPLATES) {
      const final = adapted({ template, standalone: true });
      seen.add(JSON.stringify([final.accompaniment.left, final.development.techniques]));
    }
    expect(seen.size).toBe(PIANO_TEMPLATES.length);
  });
});

describe('Piano score to MIDI file: timing survives the real serializer', () => {
  const B = 4 * PPQ;
  interface Figure { name: string; notes: readonly (readonly [start: number, duration: number, pitch: number])[] }
  // Bars 2–9 of a 16-bar project; distinct pitches inside a figure so nothing overlaps on one key.
  const FIGURES: readonly Figure[] = [
    { name: 'eighth triplets', notes: [0, 1, 2, 3, 4, 5].map((i) => [B + i * 320, 320, 60 + i] as const) },
    { name: 'sixteenth triplets', notes: [0, 1, 2, 3, 4, 5].map((i) => [B + 2 * PPQ + i * 160, 160, 67 + i] as const) },
    { name: 'dotted eighth + sixteenth', notes: [[2 * B, 720, 60], [2 * B + 720, 240, 62], [2 * B + 960, 720, 64], [2 * B + 1680, 240, 65]] },
    { name: 'dotted quarter + eighth', notes: [[2 * B + 1920, 1440, 67], [2 * B + 3360, 480, 69]] },
    { name: 'syncopation (off-beat notes held over the beat)', notes: [[3 * B + 480, 960, 60], [3 * B + 1440, 960, 62], [3 * B + 2400, 960, 64]] },
    { name: 'anticipation tied over the bar line', notes: [[4 * B - 240, 1200, 72]] },
    { name: 'tie across two bar lines', notes: [[5 * B - 480, 480 + 2 * B, 48]] },
    { name: 'three against two', notes: [[7 * B, 640, 72], [7 * B + 640, 640, 74], [7 * B + 1280, 640, 76], [7 * B, 960, 55], [7 * B + 960, 960, 57]] },
    { name: 'thirty-seconds', notes: [0, 1, 2, 3].map((i) => [7 * B + 1920 + i * 120, 120, 79 + i] as const) },
    { name: 'quintuplet sixteenths', notes: [0, 1, 2, 3, 4].map((i) => [8 * B + i * 192, 192, 60 + i] as const) },
    { name: 'smallest grid step', notes: [[8 * B + 1920, 40, 70], [8 * B + 1960, 80, 71]] },
  ];

  function synthetic(template: 'chamber' | 'hybridstudio') {
    const source = run({ template, standalone: true });
    const input = source.result.pianoEngineInput;
    const plan = composePianoPlan(input, analyzePianoInput(input));
    const target = source.project.tracks.find((track) => isInstrumentTrack(track) && track.role === 'piano');
    if (!target || !isInstrumentTrack(target)) throw new Error('fixture needs a Piano track');
    const model = source.result.pianoScore.events.find((event) => event.hand === 'right')!;
    const end = projectEndTick(source.project);
    const make = (id: string, start: number, duration: number, pitch: number): PianoScoreEvent => ({
      ...model, id, pitch, startTick: start, durationTicks: duration, hand: pitch < 60 ? 'left' : 'right',
    });
    const events = FIGURES.flatMap((figure, f) => figure.notes.map(([start, duration, pitch], n) => make(`rt-${f}-${n}`, start, duration, pitch)));
    const score = (extra: readonly PianoScoreEvent[] = []) => createPianoScore({
      generationIdentity: source.result.pianoScore.generationIdentity,
      templateId: source.result.pianoScore.templateId,
      projectEndTick: end,
      events: [...events, ...extra],
      rests: [],
    });
    const realize = (value: ReturnType<typeof score>) => realizePianoPlanWithAudit({
      plan, score: value, targetTrack: target, projectEndTick: end, externalTracks: [],
      tempoMap: source.project.tempoMap, timeSignature: source.project.timeSignature,
    });
    return { source, target, end, make, score, realize };
  }

  const fileNotes = (project: PianoCellRun['project'], track: Track) => {
    const files = buildPerTrackMidi(project, [track], profile);
    expect(files).toHaveLength(1);
    const parsed = parseMidiFile(files[0].data);
    expect(parsed.ppq).toBe(PPQ);
    expect(parsed.format).toBe(1);
    const withNotes = parsed.tracks.filter((entry) => entry.notes.length || entry.cc.length);
    expect(withNotes).toHaveLength(1);
    return { parsed, track: withNotes[0] };
  };

  it.each(['chamber', 'hybridstudio'] as const)('writes every supported subdivision to the file at its exact tick (%s)', (template) => {
    const { source, target, realize, score } = synthetic(template);
    const realization = realize(score());
    const pedal = [
      { tick: 0, value: 127 }, { tick: 160, value: 0 }, { tick: 320, value: 127 }, { tick: 1279, value: 0 },
      { tick: 1280, value: 127 }, { tick: 3839, value: 0 }, { tick: 3840 + 720, value: 127 }, { tick: 2 * 3840 - 240, value: 0 },
    ];
    const track = { ...target, notes: realization.notes.map((note) => ({ ...note })), cc: [{ cc: 64, points: pedal }] } as Track;
    const file = fileNotes(source.project, track);
    for (const figure of FIGURES) {
      for (const [start, duration, pitch] of figure.notes) {
        const realized = realization.notes.filter((note) => note.startTick === start && note.pitch === pitch);
        expect(realized.map((note) => note.durationTicks), `${figure.name}: realizer ${start}/${pitch}`).toEqual([duration]);
        const written = file.track.notes.filter((note) => note.startTick === start && note.pitch === pitch);
        expect(written.map((note) => note.durationTicks), `${figure.name}: file ${start}/${pitch}`).toEqual([duration]);
      }
    }
    expect(file.track.notes).toHaveLength(FIGURES.reduce((sum, figure) => sum + figure.notes.length, 0));
    expect(file.track.cc.filter((entry) => entry.cc === 64).map(({ tick, value }) => ({ tick, value }))).toEqual(pedal);
    expect(file.track.endTick).toBe(projectEndTick(source.project));
  });

  it('records what the pipeline cannot carry: fractional ticks and notes past the end are dropped', () => {
    const { realize, score, make, end } = synthetic('chamber');
    const realization = realize(score([
      make('rt-septuplet', 10 * B + 960 / 7, 137, 61),
      make('rt-fraction', 10 * B + 960, 320.5, 63),
      make('rt-late', end - 240, 480, 65),
    ]));
    const at = (pitch: number) => realization.notes.filter((note) => note.pitch === pitch && note.startTick >= 10 * B);
    expect(at(61)).toEqual([]);
    expect(at(63)).toEqual([]);
    expect(at(65)).toEqual([]);
  });

  it('writes production Compose All output unchanged: per-track and merged files, notes and CC64', () => {
    for (const template of PIANO_TEMPLATES) for (const standalone of [false, true]) {
      const value = run({ template, standalone, density: 1 });
      const name = `${template} ${standalone ? 'solo' : 'full'}`;
      const project = { ...value.project, tracks: value.result.tracks };
      const piano = value.piano!;
      const expectedNotes = piano.notes.map(noteKey).sort();
      const file = fileNotes(project, piano as Track);
      expect(file.track.notes.map(noteKey).sort(), `${name} notes`).toEqual(expectedNotes);
      expect(file.track.cc.filter((entry) => entry.cc === 64).map((entry) => `${entry.tick}:${entry.value}`), `${name} CC64`).toEqual(cc64(piano));
      const merged = parseMidiFile(buildMergedMidi(project, [piano as Track], profile));
      const mergedPiano = merged.tracks.filter((entry) => entry.notes.length);
      expect(mergedPiano, `${name} merged`).toHaveLength(1);
      expect(mergedPiano[0].notes.map(noteKey).sort(), `${name} merged notes`).toEqual(expectedNotes);
      expect(mergedPiano[0].cc.filter((entry) => entry.cc === 64).map((entry) => `${entry.tick}:${entry.value}`), `${name} merged CC64`).toEqual(cc64(piano));
      // The realized score and the track agree on every start tick.
      const scoreStarts = value.result.pianoRealizedScoreEvents.map((event) => event.source.startTick).sort((a, b) => a - b);
      expect(piano.notes.map((note) => note.startTick).sort((a, b) => a - b), `${name} starts`).toEqual(scoreStarts);
    }
  });
});
