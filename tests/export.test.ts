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
