/**
 * Early vertical integration: the new strings engine inside Compose All.
 *
 * These tests drive the REAL application path — the Zustand store's
 * `composeAll()` action, exactly as the Compose All button does — rather than
 * calling a helper directly. Each case builds a project from the shipped
 * fixtures, adjusts its tracks, and asserts on the project the store actually
 * produced.
 *
 * Scope note: this milestone wires STRINGS only. Winds, brass, percussion and
 * harp are still not realised by any engine, so a test that asserted notes on
 * those tracks would be asserting a feature that was never in scope.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import dorian from '../../fixtures/dorian-16bars.json';
import { projectFromFixture, isInstrumentTrack, makeTrack, type Project, type Track } from '../../src/shared/schema';
import { useStore } from '../../src/store/store';
import { buildMergedMidi, parseMidiFile } from '../../src/export/midi';
import { PPQ } from '../../src/shared/schema/types';
import { generateStringPiece } from '../../src/compose/stylecard';

const STRING_ROLES = ['violins1', 'violins2', 'violas', 'cellosBasses'] as const;

function buildProject(mutate: (project: Project) => void = () => {}): Project {
  const project = projectFromFixture(JSON.parse(JSON.stringify(dorian)) as Partial<Project>);
  project.ensemble = { templateId: 'ensemble.chamber', overrides: {}, pins: {} };
  project.orchestration = { take: 0 };
  mutate(project);
  return project;
}

/** Loads a project into the store and runs the real Compose All action. */
function composeAll(project: Project) {
  useStore.getState().loadProject(project);
  const historyBefore = useStore.getState().past.length;
  const report = useStore.getState().composeAll();
  return { report, historyBefore, result: useStore.getState().project };
}

const byRole = (project: Project, role: string): Track | undefined =>
  project.tracks.find((track) => isInstrumentTrack(track) && track.role === role);

const noteCount = (track: Track | undefined): number => track?.notes.length ?? 0;

beforeEach(() => {
  useStore.getState().loadProject(buildProject());
});

describe('A. piano + strings', () => {
  it('composes both, and every part stays on its own existing track', () => {
    const source = buildProject();
    const sourceIds = source.tracks.map((track) => track.id);
    const { result } = composeAll(source);

    // Same tracks, same ids, same order — the engine may not create or drop.
    expect(result.tracks.map((track) => track.id)).toEqual(sourceIds);

    const piano = byRole(result, 'piano');
    expect(piano, 'piano track survives').toBeDefined();
    expect(noteCount(piano), 'piano has notes').toBeGreaterThan(0);

    for (const role of STRING_ROLES) {
      const track = byRole(result, role);
      expect(track, `${role} exists`).toBeDefined();
      expect(noteCount(track), `${role} has notes`).toBeGreaterThan(0);
    }
  });

  it('piano notes stay inside the piano track range and carry no duplicates', () => {
    const { result } = composeAll(buildProject());
    const piano = byRole(result, 'piano')!;
    const pitches = piano.notes.map((note) => note.pitch);
    expect(Math.min(...pitches)).toBeGreaterThanOrEqual(piano.lowestNote);
    expect(Math.max(...pitches)).toBeLessThanOrEqual(piano.highestNote);
    expect(new Set(piano.notes.map((note) => `${note.pitch}@${note.startTick}`)).size)
      .toBe(piano.notes.length);
    expect(piano.notes.every((note) => note.velocity >= 1 && note.velocity <= 127)).toBe(true);
    expect(piano.notes.every((note) => note.durationTicks > 0)).toBe(true);
  });

  it('string notes respect their own track ranges and PPQ grid', () => {
    const { result } = composeAll(buildProject());
    for (const role of STRING_ROLES) {
      const track = byRole(result, role)!;
      for (const note of track.notes) {
        expect(note.pitch, `${role} pitch in authored range`)
          .toBeGreaterThanOrEqual(track.lowestNote);
        expect(note.pitch, `${role} pitch in authored range`)
          .toBeLessThanOrEqual(track.highestNote);
        expect(Number.isInteger(note.startTick), `${role} start is a tick`).toBe(true);
        expect(note.durationTicks).toBeGreaterThan(0);
        expect(note.velocity).toBeGreaterThanOrEqual(1);
        expect(note.velocity).toBeLessThanOrEqual(127);
      }
    }
  });
});

describe('B. strings only', () => {
  it('generates strings without any piano track present', () => {
    const source = buildProject((project) => {
      project.tracks = project.tracks.filter((track) => track.role !== 'piano');
    });
    expect(byRole(source, 'piano')).toBeUndefined();

    const { result } = composeAll(source);
    expect(byRole(result, 'piano'), 'no piano track is invented').toBeUndefined();
    for (const role of STRING_ROLES) {
      expect(noteCount(byRole(result, role)), `${role} still composed`).toBeGreaterThan(0);
    }
  });
});

describe('C. piano only', () => {
  it('keeps Piano V5 behaviour and creates no string tracks', () => {
    const source = buildProject((project) => {
      project.tracks = project.tracks.filter((track) => !STRING_ROLES.includes(track.role as never));
    });
    const sourceIds = source.tracks.map((track) => track.id);

    const { result } = composeAll(source);
    expect(result.tracks.map((track) => track.id), 'no track created').toEqual(sourceIds);
    expect(noteCount(byRole(result, 'piano')), 'piano still composes').toBeGreaterThan(0);
    for (const role of STRING_ROLES) expect(byRole(result, role)).toBeUndefined();
  });

  it('produces a different piece on every Compose All click', () => {
    // Compose All is the "surprise me" button: it draws a fresh crypto seed per
    // click, so two clicks on the same project must not hand back the same tune.
    // Reproducibility moved one level down — see the seed test below.
    const source = buildProject((project) => {
      project.tracks = project.tracks.filter((track) => !STRING_ROLES.includes(track.role as never));
    });
    const first = composeAll(source).result;
    const second = composeAll(JSON.parse(JSON.stringify(source)) as Project).result;
    expect(byRole(second, 'piano')!.notes).not.toEqual(byRole(first, 'piano')!.notes);
  });

  it('is reproducible from a seed: the same seed composes the same piece', () => {
    const a = generateStringPiece({ seed: 987654321 });
    const b = generateStringPiece({ seed: 987654321 });
    expect(b.fingerprint).toBe(a.fingerprint);
    expect(b.tracks.get('violins1')).toEqual(a.tracks.get('violins1'));
  });
});

describe('D. single string instrument', () => {
  it('composes a valid part for a lone violin track', () => {
    const source = buildProject((project) => {
      project.tracks = project.tracks.filter(
        (track) => !STRING_ROLES.includes(track.role as never) || track.role === 'violins1',
      );
    });
    const violins = byRole(source, 'violins1')!;
    const { result } = composeAll(source);

    const composed = byRole(result, 'violins1')!;
    expect(composed.notes.length).toBeGreaterThan(0);
    expect(composed.id).toBe(violins.id);
    for (const note of composed.notes) {
      expect(note.pitch).toBeGreaterThanOrEqual(composed.lowestNote);
      expect(note.pitch).toBeLessThanOrEqual(composed.highestNote);
    }
    // The other string tracks are gone; none may be resurrected.
    for (const role of ['violins2', 'violas', 'cellosBasses']) {
      expect(byRole(result, role)).toBeUndefined();
    }
  });
});

describe('E. no eligible strings', () => {
  it('does not error and invents no tracks', () => {
    const source = buildProject((project) => {
      project.tracks = project.tracks.filter(
        (track) => !STRING_ROLES.includes(track.role as never) && track.role !== 'piano',
      );
    });
    const sourceIds = source.tracks.map((track) => track.id);

    const { result, report } = composeAll(source);
    expect(report, 'composeAll reports success').not.toBeNull();
    expect(result.tracks.map((track) => track.id)).toEqual(sourceIds);
    expect(result.tracks.some((track) => STRING_ROLES.includes(track.role as never))).toBe(false);
  });

  it('leaves a piano-only project composing normally', () => {
    const source = buildProject((project) => {
      project.tracks = project.tracks.filter(
        (track) => !STRING_ROLES.includes(track.role as never),
      );
    });
    const { result } = composeAll(source);
    expect(noteCount(byRole(result, 'piano'))).toBeGreaterThan(0);
  });

  it('a project with no instrument tracks at all composes without error', () => {
    const source = buildProject((project) => {
      project.tracks = project.tracks.filter((track) => !isInstrumentTrack(track));
    });
    const { result, report } = composeAll(source);
    expect(report).not.toBeNull();
    expect(result.tracks.filter(isInstrumentTrack)).toHaveLength(0);
  });
});

describe('F. unrelated tracks', () => {
  it('preserves non-string tracks that are locked, and never writes them', () => {
    const source = buildProject((project) => {
      const horns = project.tracks.find((track) => track.role === 'horns')!;
      horns.locked = true;
      horns.notes = [{
        pitch: 60, startTick: 0, durationTicks: PPQ, velocity: 88, articulation: 'sustain',
      }];
    });

    const { result } = composeAll(source);
    const horns = result.tracks.find((track) => track.role === 'horns')!;
    expect(horns.locked, 'lock survives').toBe(true);
    expect(horns.notes, 'locked notes are byte-identical').toEqual([
      { pitch: 60, startTick: 0, durationTicks: PPQ, velocity: 88, articulation: 'sustain' },
    ]);
  });

  it('does not write notes onto out-of-band or non-realised families', () => {
    const source = buildProject();
    const { result } = composeAll(source);
    // Only Piano and strings are realised in this milestone.
    const realisedRoles = new Set(['piano', ...STRING_ROLES]);
    const unexpected = result.tracks
      .filter((track) => isInstrumentTrack(track) && !realisedRoles.has(track.role as never))
      .filter((track) => track.notes.length > 0)
      .map((track) => track.role);
    expect(unexpected, 'no other family is written in this milestone').toEqual([]);
  });

  it('never overwrites a locked string track', () => {
    const lockedNotes = [
      { pitch: 67, startTick: 0, durationTicks: PPQ, velocity: 72, articulation: 'sustain' as const },
    ];
    const source = buildProject((project) => {
      const violas = project.tracks.find((track) => track.role === 'violas')!;
      violas.locked = true;
      violas.notes = [...lockedNotes];
    });

    const { result } = composeAll(source);
    expect(result.tracks.find((track) => track.role === 'violas')!.notes).toEqual(lockedNotes);
    // ...and the other string tracks still compose around it.
    expect(noteCount(byRole(result, 'violins1'))).toBeGreaterThan(0);
  });
});

describe('G. atomicity', () => {
  it('Compose All is exactly one undoable edit', () => {
    const source = buildProject();
    const { historyBefore } = composeAll(source);
    expect(useStore.getState().past.length).toBe(historyBefore + 1);
  });

  it('one undo restores both the pre-compose notes and the take', () => {
    const source = buildProject();
    const takeBefore = source.orchestration?.take;
    composeAll(source);
    expect(useStore.getState().project.orchestration?.take).not.toBe(takeBefore);

    useStore.getState().undo();
    const restored = useStore.getState().project;
    expect(restored.orchestration?.take).toBe(takeBefore);
    for (const track of restored.tracks.filter(isInstrumentTrack)) {
      expect(track.notes, `${track.role} notes restored`).toEqual([]);
    }
  });

  it('the take advances by exactly one per Compose All', () => {
    const source = buildProject();
    composeAll(source);
    expect(useStore.getState().project.orchestration?.take).toBe(1);
    useStore.getState().composeAll();
    expect(useStore.getState().project.orchestration?.take).toBe(2);
  });
});

describe('MIDI export from the integrated workflow', () => {
  it('contains real notes for every string track and valid PPQ', () => {
    const { result } = composeAll(buildProject());
    const bytes = buildMergedMidi(result, result.tracks);
    const parsed = parseMidiFile(bytes);

    expect(parsed.ppq).toBe(PPQ);
    const names = parsed.tracks.map((track) => track.name).filter(Boolean);
    for (const role of STRING_ROLES) {
      const track = byRole(result, role)!;
      expect(names, `${role} named in the MIDI`).toContain(track.name);
      const midiTrack = parsed.tracks.find((candidate) => candidate.name === track.name)!;
      expect(midiTrack.notes.length, `${role} notes reached the file`).toBe(track.notes.length);
    }
    expect(parsed.tracks.find((track) => track.name === 'Piano')?.notes.length ?? 0).toBeGreaterThan(0);
  });
});
