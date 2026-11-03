import { describe, expect, it } from 'vitest';
import { parseMidi } from 'midi-file';
import fixture from '../fixtures/dorian-16bars.json';
import { generate } from '../src/engine/generate';
import { buildMergedMidi, buildPerTrackMidi, exportableTracks, parseMidiFile, perTrackFileName } from '../src/export/midi';
import { exportProjectJson, importProjectJson } from '../src/export/json';
import { isInstrumentTrack, projectEndTick, projectFromFixture, type Project } from '../src/shared/schema';

const composed = (): Project => {
  const p = projectFromFixture(JSON.parse(JSON.stringify(fixture)));
  p.tracks = generate(p, { seed: 11, humanize: true });
  return p;
};

describe('MIDI export', () => {
  it('round-trips every note (pitch, start, duration, velocity) in the merged file', () => {
    const p = composed();
    const tracks = exportableTracks(p, 'all');
    const parsed = parseMidiFile(buildMergedMidi(p, tracks));
    expect(parsed.format).toBe(1);
    expect(parsed.ppq).toBe(960);
    expect(parsed.bpm).toBe(100);
    expect(parsed.timeSignature).toEqual([4, 4]);
    expect(parsed.markers.map((m) => m.text)).toEqual(['Verse', 'Chorus']);
    expect(parsed.markers[1].tick).toBe(8 * 3840);
    expect(parsed.tracks).toHaveLength(tracks.length + 1);
    tracks.forEach((t, i) => {
      const got = parsed.tracks[i + 1];
      expect(got.name).toBe(t.name);
      const want = [...t.notes].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
      expect(got.notes).toEqual(want);
      if (t.notes.length) expect(got.channel).toBe(t.midiChannel);
    });
  });

  it('has no zero-length notes and no event after end-of-track; all tracks end at project end', () => {
    const p = composed();
    const end = projectEndTick(p);
    const raw = parseMidi(buildMergedMidi(p, exportableTracks(p, 'all')));
    for (const tr of raw.tracks) {
      let abs = 0;
      tr.forEach((e, i) => {
        abs += e.deltaTime;
        if (e.type === 'endOfTrack') expect(i).toBe(tr.length - 1);
      });
      expect(abs).toBe(end);
    }
    for (const t of parseMidiFile(buildMergedMidi(p, exportableTracks(p, 'all'))).tracks) for (const n of t.notes) expect(n.durationTicks).toBeGreaterThan(0);
  });

  it('per-track files share the same length, contain tempo/time/key and are named NN Name.mid', () => {
    const p = composed();
    const files = buildPerTrackMidi(p, exportableTracks(p, 'all'));
    expect(files[0].fileName).toBe('04 Violins I.mid');
    expect(files.find((f) => f.fileName.includes('Cellos'))!.fileName).toBe('07 Cellos-Basses.mid');
    const end = projectEndTick(p);
    for (const f of files) {
      const raw = parseMidi(f.data);
      const types = raw.tracks.flat().map((e) => e.type);
      expect(types).toContain('setTempo');
      expect(types).toContain('timeSignature');
      expect(types).toContain('keySignature');
      for (const tr of raw.tracks) expect(tr.reduce((s, e) => s + e.deltaTime, 0)).toBe(end);
    }
  });

  it('ignores mixer state and routing; selection modes work', () => {
    const p = composed();
    const a = buildMergedMidi(p, exportableTracks(p, 'all'));
    p.tracks.forEach((t) => { t.volume = 0.1; t.pan = -1; t.muted = true; t.soloed = true; });
    p.libraryGroups.push({ id: 'g', name: 'G', pluginId: null, pluginState: null });
    p.tracks[3].libraryGroupId = 'g'; p.tracks[4].libraryGroupId = 'g';
    const b = buildMergedMidi(p, exportableTracks(p, 'all'));
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    p.tracks[3].locked = true;
    expect(exportableTracks(p, 'unlocked').length).toBe(p.tracks.filter(isInstrumentTrack).length - 1);
    expect(exportableTracks(p, 'selected', [p.tracks[5].id]).map((t) => t.name)).toEqual(['Violas']);
    expect(perTrackFileName(p, p.tracks[3])).toBe('04 Violins I.mid');
  });
});

describe('JSON export/import', () => {
  it('export then import produces an identical project', () => {
    const p = composed();
    const json = exportProjectJson(p);
    expect(JSON.parse(json).exportedAt).toBeTruthy();
    const r = importProjectJson(json);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.project).toEqual(p);
  });
  it('import shows clear validation errors', () => {
    const r = importProjectJson('{"schemaVersion":1}');
    expect(r.ok).toBe(false);
    const bad = importProjectJson('not json');
    expect(!bad.ok && bad.errors[0].message).toMatch(/Not valid JSON/);
  });
});

describe('MIDI export: CC lanes', () => {
  const withCc = (): Project => {
    const p = composed();
    const v1 = p.tracks.find((t) => t.role === 'violins1')!;
    v1.notes = [
      { pitch: 74, startTick: 960, durationTicks: 960, velocity: 70 },
      { pitch: 77, startTick: 3840, durationTicks: 960, velocity: 80 },
    ];
    v1.cc = [
      { cc: 1, points: [{ tick: 0, value: 8 }, { tick: 1920, value: 100 }, { tick: 5760, value: 20 }] },
      { cc: 11, points: [{ tick: 960, value: 90 }] },
    ];
    return p;
  };

  it('writes CC lanes as controller events on the track channel, and parses back exactly', () => {
    const p = withCc();
    const v1 = p.tracks.find((t) => t.role === 'violins1')!;
    const parsed = parseMidiFile(buildMergedMidi(p, exportableTracks(p, 'all')));
    const got = parsed.tracks.find((t) => t.name === v1.name)!;
    expect(got.channel).toBe(v1.midiChannel);
    expect(got.cc).toEqual([
      { cc: 1, tick: 0, value: 8 }, { cc: 11, tick: 960, value: 90 }, { cc: 1, tick: 1920, value: 100 }, { cc: 1, tick: 5760, value: 20 },
    ]);
    // the notes are untouched by the CC writer
    expect(got.notes).toEqual(v1.notes);
  });

  it('per-track files carry the CC lanes too', () => {
    const p = withCc();
    const v1 = p.tracks.find((t) => t.role === 'violins1')!;
    const file = buildPerTrackMidi(p, [v1])[0];
    const parsed = parseMidiFile(file.data);
    expect(parsed.tracks[1].cc.map((e) => e.cc)).toEqual([1, 11, 1, 1]);
    expect(parsed.tracks[1].cc.filter((e) => e.cc === 1).map((e) => e.value)).toEqual([8, 100, 20]);
  });

  it('projects without cc keep byte-identical notes-only exports', () => {
    const p = composed();
    const a = buildMergedMidi(p, exportableTracks(p, 'all'));

    const withEmptyLanes = JSON.parse(JSON.stringify(p)) as Project;
    for (const t of withEmptyLanes.tracks) t.cc = [];
    const b = buildMergedMidi(withEmptyLanes, exportableTracks(withEmptyLanes, 'all'));
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);

    const withPointlessLanes = JSON.parse(JSON.stringify(p)) as Project;
    for (const t of withPointlessLanes.tracks) t.cc = [{ cc: 1, points: [] }, { cc: 11, points: [] }];
    const c = buildMergedMidi(withPointlessLanes, exportableTracks(withPointlessLanes, 'all'));
    expect(Buffer.from(a).equals(Buffer.from(c))).toBe(true);
  });

  it('a CC point at the same tick as a noteOn lands in the file before the note', () => {
    const p = withCc();
    const parsed = parseMidi(buildMergedMidi(p, exportableTracks(p, 'all')));
    const v1 = parsed.tracks.find((t) => t.some((e) => e.type === 'trackName' && (e as { text?: string }).text === 'Violins I'));
    expect(v1).toBeTruthy();
    const kinds = v1!.filter((e) => e.type === 'controller' || e.type === 'noteOn').map((e) => e.type);
    // first controller (tick 0, cc 1) precedes the first noteOn (tick 960)
    expect(kinds.indexOf('controller')).toBeLessThan(kinds.indexOf('noteOn'));
  });
});
