/**
 * Smart Chord Suggestion — the floating overlay (feature spec: chord grid,
 * customization controls, MIDI generation, Apply).
 *
 * Covered: every MIDI-generation voicing rule (C4-centered close voicing,
 * bass at or below the upper tones, the MIDI 36–84 guard, duplicate pitch
 * classes, inversion/slash bass, spelling preservation, octave offsets,
 * determinism), the customization tables (extension choices are
 * grammar-gated and round-trip through the shared parser, bass choices
 * normalize through the project key), the non-destructive Apply guard
 * (missing/moved/renamed/edited) and the whole "Apply Smart Chord"
 * transaction through the REAL crescode host adapter, plus the engine →
 * overlay chain: every engine suggestion composes and voices in range.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { projectFromFixture, type Chord as ChordEvent, type Note, type Project } from '../src/shared/schema';
import {
  APPLY_TRANSACTION_LABEL, applyChordToClip, bassChoicesFor, buildChordSymbol, chordFromSymbol, chordPitchClasses,
  clipDrift, createCrescodeChordTrackApi, createSuggestionInteraction, extensionChoicesFor,
  extensionIdOf, filterSuggestions, generateChordSuggestions, gridResolutionOf, takeClipSnapshot,
  triadBaseOf, voiceChordSymbol, voicingLabel, voicingToPitches,
  VOICE_HIGH, VOICE_LOW,
  type ChordLaneHostIo, type InteractionApi, type InteractionHooks,
  type ProjectKey, type SuggestionColorFilter,
} from '../src/engine/suggestion';

const TS44 = { numerator: 4, denominator: 4 };
const GRID = gridResolutionOf(TS44);
const C_MAJOR: ProjectKey = { tonic: 0, mode: 'Ionian', spelling: 'mixed' };
const EB_MAJOR: ProjectKey = { tonic: 3, mode: 'Ionian', spelling: 'mixed' };
const F_MAJOR: ProjectKey = { tonic: 5, mode: 'Ionian', spelling: 'mixed' };

const midis = (v: ReturnType<typeof voiceChordSymbol>): number[] =>
  v.ok ? v.notes.map((n) => n.midi) : [];

// --- host harness (mirrors the real store binding in wire.ts) ----------------

const ev = (id: string, symbol: string, startTick: number, durationTicks: number): ChordEvent =>
  ({ id, symbol, startTick, durationTicks });

const makeProject = (chords: ChordEvent[] = [], laneNotes: Note[] = []): Project => {
  const p = projectFromFixture({
    schemaVersion: 1, name: 'overlay-test', bpm: 120,
    tempoMap: [{ tick: 0, bpm: 120 }], timeSignature: TS44,
    key: 3, mode: 'Ionian', // Eb — placeholder tonic symbol "Eb"
    sections: [], chords, referenceAudio: { path: null, offsetMs: 0 },
    tracks: [], libraryGroups: [], masterVolume: 1,
  });
  if (laneNotes.length === 0) return p;
  return { ...p, tracks: p.tracks.map((t) => (t.role === 'chords' ? { ...t, notes: laneNotes } : t)) };
};

function makeIo(project: Project) {
  const state = { project, dirty: false };
  let commits = 0;
  const io: ChordLaneHostIo = {
    getProject: () => state.project,
    snapshot: () => ({ project: state.project, dirty: state.dirty }),
    putProject: (p) => { state.project = p; state.dirty = true; },
    endTransaction: (pre, mode) => {
      if (mode === 'cancel') { state.project = pre.project; state.dirty = pre.dirty; return; }
      commits += 1;
      state.dirty = true;
    },
    isPlaying: () => false,
    now: () => 0,
    notify: () => undefined,
  };
  return { io, state, commitCount: () => commits };
}

/** A rig with one Smart clip created exactly like the double-click gesture
 *  does it (1 bar inside the gap [3840, 7680) between F and C). */
function makeRig() {
  const host = makeIo(makeProject([ev('p1', 'F', 0, 3840), ev('n1', 'C', 7680, 3840)]));
  const api = createCrescodeChordTrackApi(host.io);
  const hooks: InteractionHooks = {
    openEditor: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    placeholder: () => 'root-note',
    now: () => 10_000,
  };
  const controller = createSuggestionInteraction(api as InteractionApi, hooks);
  controller.handleDoubleClick(null, 4200);
  const clipId = api.getChordClipsInRange(3840, 7681)[0]!.id;
  const clip = api.getChordClipById(clipId)!;
  return { api, host, clipId, clip, snapshot: takeClipSnapshot(clip) };
}

// ---------------------------------------------------------------------------
// §3 MIDI generation — the voicing rules
// ---------------------------------------------------------------------------

describe('voiceChordSymbol (MIDI generation rules)', () => {
  it('C major → close voicing centered near C4: C4 E4 G4', () => {
    const v = voiceChordSymbol('C');
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(midis(v)).toEqual([60, 64, 67]);
    expect(v.bassNote).toBe('C');
    expect(voicingLabel(v.notes)).toBe('C4 · E4 · G4');
  });

  it('bass note at or below the upper tones; inversion respected (C/E → E3 G3 C4)', () => {
    const v = voiceChordSymbol('C/E');
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(midis(v)).toEqual([52, 55, 60]);
    expect(v.bassNote).toBe('E'); // the chord's own slash spelling is kept
  });

  it('G/B → B3 D4 G4 (the stack centers the median on C4, not the root)', () => {
    expect(midis(voiceChordSymbol('G/B'))).toEqual([59, 62, 67]);
  });

  it('sevenths stack close and stay in range (C7 → C4 E4 G4 Bb4)', () => {
    expect(midis(voiceChordSymbol('C7'))).toEqual([60, 64, 67, 70]);
  });

  it('Cadd9 → one note per pitch class, close cluster C4 D4 E4 G4', () => {
    const v = voiceChordSymbol('Cadd9');
    expect(midis(v)).toEqual([60, 62, 64, 67]);
    const m = midis(v);
    expect(new Set(m.map((x) => x % 12)).size).toBe(m.length); // no duplicate pitch classes
  });

  it('Am7 → A3 C4 E4 G4', () => {
    expect(midis(voiceChordSymbol('Am7'))).toEqual([57, 60, 64, 67]);
  });

  it('slash chord with a foreign bass keeps it lowest (C/F)', () => {
    const v = voiceChordSymbol('C/F');
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(midis(v)).toEqual([53, 55, 60, 64]);
    expect(v.notes[0]!.spelling).toBe('F');
  });

  it('a wide 13th chord stays inside MIDI 36–84 with the default octave', () => {
    const v = voiceChordSymbol('C13'); // 13 = 1 3 5 b7 9 13 — the 11th is omitted by convention
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.notes).toHaveLength(6);
    expect(v.notes.every((n) => n.midi >= VOICE_LOW && n.midi <= VOICE_HIGH)).toBe(true);
  });

  it('every common chord voicing avoids MIDI 36–84 violations', () => {
    for (const symbol of ['C', 'Fm', 'G7', 'Bb', 'Dm7', 'E7', 'Am7b5', 'Bdim7', 'Gsus4', 'Fsus2', 'A6', 'Em', 'Db', 'Abmaj7', 'Eb9', 'Bb13', 'F#m', 'C#dim', 'Gaug', 'B5', 'Cadd9', 'Gm6']) {
      const v = voiceChordSymbol(symbol);
      expect(v.ok, symbol).toBe(true);
      if (!v.ok) continue;
      const m = midis(v);
      expect(Math.min(...m), symbol).toBeGreaterThanOrEqual(VOICE_LOW);
      expect(Math.max(...m), symbol).toBeLessThanOrEqual(VOICE_HIGH);
      // bass is at or below every upper chord tone
      expect(Math.min(...m), symbol).toBe(m[0]);
      expect(new Set(m.map((x) => x % 12)).size, symbol).toBe(m.length);
    }
  });

  it('an explicit octave offset shifts the anchor and lifts the 36–84 guard', () => {
    expect(midis(voiceChordSymbol('C', { octaveOffset: 1 }))).toEqual([72, 76, 79]);
    expect(midis(voiceChordSymbol('C', { octaveOffset: -2 }))).toEqual([36, 40, 43]);
  });

  it('the chord spelling is preserved: root and slash bass keep their name', () => {
    const v = voiceChordSymbol('C#7');
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.notes.map((n) => n.spelling)).toEqual(['C#', 'F', 'Ab', 'B']); // bass = the chord's root name; tones = crescode canon (pc 5 spells F, never E#)
  });

  it('invalid symbols are rejected, never thrown', () => {
    const v = voiceChordSymbol('not-a-chord');
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.error).toContain('not-a-chord');
  });

  it('is deterministic: same input, same notes', () => {
    expect(JSON.stringify(voiceChordSymbol('Dm7'))).toBe(JSON.stringify(voiceChordSymbol('Dm7')));
  });

  it('voicingToPitches places the notes inside the given clip bounds', () => {
    const v = voiceChordSymbol('Gm7');
    if (!v.ok) throw new Error('expected a voicing');
    const pitches = voicingToPitches(v, 3840, 3840);
    expect(pitches.map((p) => p.midi)).toEqual([55, 58, 62, 65]);
    expect(pitches.every((p) => p.startTick === 3840 && p.durationTicks === 3840)).toBe(true);
    expect(pitches.every((p) => p.velocity > 0 && p.velocity <= 127)).toBe(true);
    expect(pitches.every((p) => p.pitchClass === p.midi % 12)).toBe(true);
    expect(() => voicingToPitches(v, -1, 3840)).toThrow();
    expect(() => voicingToPitches(v, 0, 0)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// §2 Customization controls — extension & bass choices, symbol composing
// ---------------------------------------------------------------------------

describe('extension and bass controls', () => {
  it('triad bases map every grammar quality', () => {
    expect(triadBaseOf('major')).toBe('maj');
    expect(triadBaseOf('m7')).toBe('min');
    expect(triadBaseOf('m7b5')).toBe('dim');
    expect(triadBaseOf('aug7')).toBe('aug');
    expect(triadBaseOf('7sus4')).toBe('sus4');
    expect(triadBaseOf('power')).toBe('power');
  });

  it('major-root dropdown offers the spec list; every choice parses for any root', () => {
    const ids = extensionChoicesFor('major').map((c) => c.id);
    for (const id of ['none', '7', 'maj7', 'min7', '9', 'maj9', 'add9', 'sus4', 'sus2', '6', '6/9', '11', '13']) {
      expect(ids, id).toContain(id);
    }
    for (const c of extensionChoicesFor('major')) {
      expect(parseOk(`Bb${c.suffix}`), `Bb${c.suffix}`).toBe(true);
    }
  });

  it('extensions that make the quality invalid are allowed to change it (spec rule)', () => {
    // min7 forces a minor quality on a major root; sus replaces the third;
    // on minor/dim bases the same sound arrives through the '7' row (deduped)
    expect(suffixFor('maj', 'min7')).toBe('m7');
    expect(suffixFor('maj', 'm6')).toBe('m6');
    expect(suffixFor('aug', 'maj7')).toBe('augmaj7');
    expect(suffixFor('sus4', '7')).toBe('7sus4');
    expect(suffixFor('dim', '7')).toBe('m7b5');
  });

  it('every engine quality round-trips: decompose → compose keeps the pitch classes', () => {
    for (const suffix of ['', 'm', '7', 'maj7', 'm7', '6', 'm6', 'sus2', 'sus4', 'dim', 'aug', '5', 'add9', '7sus4', 'm7b5', 'dim7', 'aug7', '9', 'maj9', 'm9']) {
      const symbol = `C${suffix}`;
      const chord = chordFromSymbol(symbol);
      if (!chord.ok) throw new Error(`fixture ${symbol} must parse`);
      const id = extensionIdOf(chord.chord.quality);
      const choices = extensionChoicesFor(chord.chord.quality);
      expect(choices.some((c) => c.id === id), `${symbol} → ${id} offered`).toBe(true);
      const built = buildChordSymbol(chord.chord, id, 'root', C_MAJOR);
      expect(built.ok, `${symbol} rebuild`).toBe(true);
      if (!built.ok) continue;
      const reparsed = chordFromSymbol(built.symbol);
      expect(reparsed.ok).toBe(true);
      if (!reparsed.ok) continue;
      expect(chordPitchClasses(reparsed.chord), symbol).toEqual(chordPitchClasses(chord.chord));
    }
  });

  it('buildChordSymbol composes slash basses and preserves the root pitch class', () => {
    const c = mustChord('C');
    expect(buildChordSymbol(c, 'maj7', { pc: 4 }, C_MAJOR)).toMatchObject({ ok: true, symbol: 'Cmaj7/E' });
    expect(buildChordSymbol(c, 'none', { pc: 5 }, C_MAJOR)).toMatchObject({ ok: true, symbol: 'C/F' });
    expect(buildChordSymbol(c, '7', 'root', C_MAJOR)).toMatchObject({ ok: true, symbol: 'C7' });
  });

  it('Auto keeps the chord\'s own bass; Root position clears it', () => {
    const ce = mustChord('C/E');
    expect(buildChordSymbol(ce, 'none', 'auto', C_MAJOR)).toMatchObject({ ok: true, symbol: 'C/E' });
    expect(buildChordSymbol(ce, 'none', 'root', C_MAJOR)).toMatchObject({ ok: true, symbol: 'C' });
  });

  it('bass note names normalize through the project key (Db in Eb major, Bb in F major)', () => {
    const c = mustChord('C7');
    expect(buildChordSymbol(c, '7', { pc: 1 }, EB_MAJOR)).toMatchObject({ ok: true, symbol: 'C7/Db' });
    expect(buildChordSymbol(c, '7', { pc: 10 }, F_MAJOR)).toMatchObject({ ok: true, symbol: 'C7/Bb' });
  });

  it('normalizeChord applies to the root too (C#7 → Db7 in Eb major, pc unchanged)', () => {
    const cs = mustChord('C#7');
    const built = buildChordSymbol(cs, extensionIdOf('7'), 'root', EB_MAJOR);
    expect(built).toMatchObject({ ok: true, symbol: 'Db7' });
    if (!built.ok) return;
    const reparsed = chordFromSymbol(built.symbol);
    expect(reparsed.ok).toBe(true);
    if (reparsed.ok) expect(reparsed.chord.rootPc).toBe(1); // the pitch class never moved
  });

  it('bass choices: auto/root plus the chromatic notes, labeled as inversion or slash', () => {
    const c = mustChord('C');
    const choices = bassChoicesFor(c);
    expect(choices[0]).toMatchObject({ id: 'auto' });
    expect(choices[1]).toMatchObject({ id: 'root', label: 'Root position' });
    const bassOptions = choices.slice(2);
    expect(bassOptions).toHaveLength(11); // the root itself is "Root position"
    expect(bassOptions.find((o) => o.id === 'pc:4')!.label).toContain('inversion'); // E is a chord tone
    expect(bassOptions.find((o) => o.id === 'pc:5')!.label).toContain('slash'); // F is not
  });
});

function mustChord(symbol: string) {
  const r = chordFromSymbol(symbol);
  if (!r.ok) throw new Error(`fixture "${symbol}" must parse`);
  return r.chord;
}

function suffixFor(base: string, id: string): string {
  const quality = { maj: 'major', min: 'm7', dim: 'm7b5', aug: 'aug7', sus4: '7sus4' }[base] ?? 'major';
  const choice = extensionChoicesFor(quality).find((c) => c.id === id);
  if (choice === undefined) throw new Error(`choice ${id} missing for base ${base}`);
  return choice.suffix;
}

function parseOk(symbol: string): boolean {
  // lazy import avoidance: chordFromSymbol goes through the shared parser
  return chordFromSymbol(symbol).ok;
}

// ---------------------------------------------------------------------------
// §4 Apply — the drift guard and the transaction, through the real adapter
// ---------------------------------------------------------------------------

describe('applyChordToClip (Apply Smart Chord)', () => {
  let rig: ReturnType<typeof makeRig>;

  beforeEach(() => {
    rig = makeRig();
  });

  it('replaces the notes and renames the clip in ONE "Apply Smart Chord" undo step', () => {
    const v = voiceChordSymbol('Gm7');
    if (!v.ok) throw new Error('expected a voicing');
    const commitsBefore = rig.host.commitCount(); // 1 = the Smart clip creation
    const outcome = applyChordToClip(rig.api, rig.clipId, 'Gm7', v, rig.snapshot);
    expect(outcome.ok).toBe(true);
    expect(rig.host.commitCount()).toBe(commitsBefore + 1); // exactly one undo step

    const after = rig.api.getChordClipById(rig.clipId)!;
    expect(after.chord.spelling).toBe('Gm7'); // displayed name = normalized spelling
    expect(after.startTime).toBe(3840); // position, length, track, metadata preserved
    expect(after.lengthTicks).toBe(3840);
    expect(after.metadata).toEqual({});

    const notes = rig.api.getMidiNotes(rig.clipId);
    expect(notes.map((n) => n.midi)).toEqual([55, 58, 62, 65]); // G3 Bb3 D4 F4
    expect(notes.every((n) => n.startTick === 3840 && n.durationTicks === 3840)).toBe(true);
  });

  it('warns instead of overwriting a clip that was moved after the overlay opened', () => {
    rig.host.state.project = {
      ...rig.host.state.project,
      chords: rig.host.state.project.chords.map((c) => (c.id === rig.clipId ? { ...c, startTick: 4800 } : c)),
    };
    const v = voiceChordSymbol('Gm7');
    if (!v.ok) throw new Error('expected a voicing');
    const commits = rig.host.commitCount();
    const outcome = applyChordToClip(rig.api, rig.clipId, 'Gm7', v, rig.snapshot);
    expect(outcome).toMatchObject({ ok: false, drift: 'moved' });
    expect(rig.host.commitCount()).toBe(commits); // nothing written
    expect(rig.host.state.project.chords.find((c) => c.id === rig.clipId)?.symbol).toBe('Eb');
  });

  it('warns instead of overwriting a clip that was renamed or note-edited by the user', () => {
    // user renames through some other surface (own undo step)
    rig.api.beginUndoTransaction('User Rename');
    rig.api.renameChordClip(rig.clipId, 'Cm');
    rig.api.commitUndoTransaction();
    const v = voiceChordSymbol('Gm7');
    if (!v.ok) throw new Error('expected a voicing');
    expect(applyChordToClip(rig.api, rig.clipId, 'Gm7', v, rig.snapshot)).toMatchObject({ ok: false, drift: 'renamed' });

    // refresh the baseline by symbol, then the user edits the notes
    const freshSnap = takeClipSnapshot(rig.api.getChordClipById(rig.clipId)!);
    rig.api.beginUndoTransaction('User Notes');
    rig.api.replaceMidiNotes(rig.clipId, [{ midi: 56, pitchClass: 8, spelling: 'Ab', octave: 3, velocity: 100, startTick: 3840, durationTicks: 3840 }]);
    rig.api.commitUndoTransaction();
    expect(applyChordToClip(rig.api, rig.clipId, 'Gm7', v, freshSnap)).toMatchObject({ ok: false, drift: 'edited' });
    expect(rig.api.isTransactionActive()).toBe(false);
  });

  it('reports a missing clip and never recreates anything', () => {
    rig.api.beginUndoTransaction('Cleanup');
    rig.api.removeChordClip(rig.clipId);
    rig.api.commitUndoTransaction();
    const v = voiceChordSymbol('Gm7');
    if (!v.ok) throw new Error('expected a voicing');
    expect(applyChordToClip(rig.api, rig.clipId, 'Gm7', v, rig.snapshot)).toMatchObject({ ok: false, drift: 'missing' });
  });

  it('a failed write cancels the transaction and leaves the timeline untouched', () => {
    const boom = {
      ...rig.api,
      replaceMidiNotes: () => { throw new Error('boom'); },
    };
    const v = voiceChordSymbol('Gm7');
    if (!v.ok) throw new Error('expected a voicing');
    const outcome = applyChordToClip(boom, rig.clipId, 'Gm7', v, rig.snapshot);
    expect(outcome).toMatchObject({ ok: false, drift: 'error', error: 'boom' });
    expect(rig.api.isTransactionActive()).toBe(false);
    const after = rig.api.getChordClipById(rig.clipId)!;
    expect(after.chord.spelling).toBe('Eb'); // still the placeholder
    expect(rig.api.getMidiNotes(rig.clipId)).toHaveLength(1); // still the placeholder note
  });

  it('the returned snapshot refreshes, so a second apply does not self-warn', () => {
    const v = voiceChordSymbol('Gm7');
    if (!v.ok) throw new Error('expected a voicing');
    const first = applyChordToClip(rig.api, rig.clipId, 'Gm7', v, rig.snapshot);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const v2 = voiceChordSymbol('Cm9');
    if (!v2.ok) throw new Error('expected a voicing');
    const second = applyChordToClip(rig.api, rig.clipId, 'Cm9', v2, first.snapshot);
    expect(second.ok).toBe(true);
    expect(rig.api.getChordClipById(rig.clipId)!.chord.spelling).toBe('Cm9');
  });
});

// ---------------------------------------------------------------------------
// §1 Chord grid — filtering / sorting
// ---------------------------------------------------------------------------

describe('filterSuggestions (grid search & sort)', () => {
  const mk = (symbol: string, color: 'green' | 'yellow' | 'red') => ({
    chord: mustChord(symbol),
    color,
    score100: 0,
  });
  const list = [mk('C', 'green'), mk('G7', 'yellow'), mk('Cm7', 'green'), mk('F#dim', 'red')];

  it('searches by symbol and quality, case-insensitively', () => {
    expect(filterSuggestions(list, { query: 'm7', color: 'all', sort: 'score' })).toHaveLength(1);
    expect(filterSuggestions(list, { query: 'dim', color: 'all', sort: 'score' })).toHaveLength(1);
    expect(filterSuggestions(list, { query: 'g7', color: 'all', sort: 'score' })).toHaveLength(1);
    expect(filterSuggestions(list, { query: 'zzz', color: 'all', sort: 'score' })).toHaveLength(0);
  });

  it('filters by color band', () => {
    const green = filterSuggestions(list, { query: '', color: 'green' as SuggestionColorFilter, sort: 'score' });
    expect(green).toHaveLength(2);
    expect(green.every((s) => s.color === 'green')).toBe(true);
  });

  it('sort=name sorts alphabetically; sort=score preserves the engine order', () => {
    const byName = filterSuggestions(list, { query: '', color: 'all', sort: 'name' });
    expect(byName.map((s) => s.chord.spelling)).toEqual(['C', 'Cm7', 'F#dim', 'G7']);
    const byScore = filterSuggestions(list, { query: '', color: 'all', sort: 'score' });
    expect(byScore.map((s) => s.chord.spelling)).toEqual(list.map((s) => s.chord.spelling));
  });
});

// ---------------------------------------------------------------------------
// Engine → overlay chain
// ---------------------------------------------------------------------------

describe('engine suggestions voice cleanly through the overlay', () => {
  it('every suggestion for a key-only context composes, voices and stays in range', () => {
    const key: ProjectKey = { tonic: 2, mode: 'Dorian', spelling: 'mixed' };
    const suggestions = generateChordSuggestions({
      projectKey: key, previousChord: null, nextChord: null,
      availableGapLength: 3840, currentGridResolution: GRID.ticksPerBeat,
    });
    expect(suggestions.length).toBeGreaterThanOrEqual(12);
    for (const s of suggestions) {
      const built = buildChordSymbol(s.chord, extensionIdOf(s.chord.quality), 'root', key);
      expect(built.ok, s.chord.spelling).toBe(true);
      if (!built.ok) continue;
      const v = voiceChordSymbol(built.symbol);
      expect(v.ok, built.symbol).toBe(true);
      if (!v.ok) continue;
      expect(v.notes.length).toBeGreaterThan(0);
      expect(v.notes[0]!.spelling).toBe(s.chord.rootName); // normalizeChord spelling preserved
      expect(v.notes.every((n) => n.midi >= VOICE_LOW && n.midi <= VOICE_HIGH), built.symbol).toBe(true);
    }
  });

  it('the apply transaction label is exactly the spec label', () => {
    expect(APPLY_TRANSACTION_LABEL).toBe('Apply Smart Chord');
  });

  it('clipDrift is null for a fresh snapshot of the same clip', () => {
    const { api, clipId } = makeRig();
    const clip = api.getChordClipById(clipId)!;
    expect(clipDrift(takeClipSnapshot(clip), clip)).toBeNull();
    expect(clipDrift(null, clip)).toBeNull();
  });
});
