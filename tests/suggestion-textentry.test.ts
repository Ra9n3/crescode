/**
 * Smart Chord Suggestion — text-based chord entry and renaming.
 *
 * Covered: the chord-text grammar breakdown over the shared parser (root,
 * accidental, quality, extensions, slash bass, invalid text, input folding),
 * the bare-"sus" ambiguity surfacing, triad-only autocomplete (no extensions
 * until an extension marker is typed; exact-then-diatonic ranking; the
 * empty-input diatonic menu), key-idiomatic normalization with the pitch
 * class invariant, text→MIDI voicing (C4-centered close stacks), and the
 * full "Rename Chord" track update: guard order (invalid → ambiguous →
 * drift → unrecognized user MIDI), the clear→write→rename transaction with
 * preserved bounds, failure rollback and the no-clip-creation guarantee.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  parseChord, projectFromFixture, scalePitchClasses,
  type Chord as ChordEvent, type Note, type PitchClass, type Project,
} from '../src/shared/schema';
import {
  applyChordTextToClip, createCrescodeChordTrackApi, interpretChordText, isDiatonicSymbol,
  normalizeChordText, parseChordText, RENAME_TRANSACTION_LABEL, suggestChordCompletions,
  voiceChordText,
  type ChordLaneHostIo, type CrescodeChordTrackApi, type ProjectKey,
} from '../src/engine/suggestion';

const TS44 = { numerator: 4, denominator: 4 };
const KEY_C: ProjectKey = { tonic: 0, mode: 'Ionian', spelling: 'mixed' };
const KEY_D: ProjectKey = { tonic: 2, mode: 'Ionian', spelling: 'mixed' };
const KEY_EB: ProjectKey = { tonic: 3, mode: 'Ionian', spelling: 'mixed' };
const KEY_F: ProjectKey = { tonic: 5, mode: 'Ionian', spelling: 'mixed' };

const scaleOf = (key: ProjectKey): Set<PitchClass> => new Set(scalePitchClasses(key.tonic, key.mode) as PitchClass[]);

const spellings = (r: ReturnType<typeof interpretChordText>): string[] =>
  r.status === 'ambiguous' ? r.interpretations.map((c) => c.spelling) : [];

// --- §2 grammar ---------------------------------------------------------------

describe('parseChordText (chord text grammar breakdown)', () => {
  const partsOf = (text: string) => {
    const r = parseChordText(text);
    if (!r.ok) throw new Error(r.error);
    return r.parts;
  };

  it('separates root, accidental, quality, extensions and slash bass', () => {
    expect(partsOf('C')).toMatchObject({ rootLetter: 'C', rootName: 'C', accidental: '', quality: 'major', extensions: [], bassName: null, qualitySuffix: '' });
    expect(partsOf('Cm')).toMatchObject({ rootName: 'C', accidental: '', quality: 'minor', qualitySuffix: 'm' });
    expect(partsOf('C#')).toMatchObject({ rootName: 'C#', accidental: '#', quality: 'major' });
    expect(partsOf('Db')).toMatchObject({ rootName: 'Db', accidental: 'b', quality: 'major' });
    expect(partsOf('F#m')).toMatchObject({ rootName: 'F#', accidental: '#', quality: 'minor', qualitySuffix: 'm' });
    expect(partsOf('Bb/D')).toMatchObject({ rootName: 'Bb', quality: 'major', bassName: 'D', qualitySuffix: '' });
    expect(partsOf('G/B')).toMatchObject({ rootName: 'G', bassName: 'B' });
    expect(partsOf('Gsus4')).toMatchObject({ rootName: 'G', quality: 'sus4' });
    expect(partsOf('Cmaj7')).toMatchObject({ quality: 'maj7', extensions: [] });
    expect(partsOf('C7')).toMatchObject({ quality: '7' });
    expect(partsOf('Cm7')).toMatchObject({ quality: 'm7' });
    expect(partsOf('Cadd9')).toMatchObject({ quality: 'add9', extensions: [] });
    expect(partsOf('C6')).toMatchObject({ quality: '6' });
    expect(partsOf('Cm6')).toMatchObject({ quality: 'm6' });
    expect(partsOf('Dbm7(b9)')).toMatchObject({ rootName: 'Db', quality: 'm7', extensions: ['b9'], qualitySuffix: 'm7(b9)' });
  });

  it('is forgiving on input folding (case, unicode accidentals)', () => {
    expect(partsOf('dbm7')).toMatchObject({ rootName: 'Db', quality: 'm7' });
    expect(partsOf('c')).toMatchObject({ rootName: 'C' });
    expect(partsOf('C♯9')).toMatchObject({ rootName: 'C#', accidental: '#', quality: '9', extensions: [] });
  });

  it('reports invalid or unrecognized text without throwing', () => {
    for (const bad of ['', '   ', 'H', 'Cq', 'C E G', 'C/9', 'Cadd', '123', 'm7', 'Xyz']) {
      const r = parseChordText(bad);
      expect(r.ok, `"${bad}" must not parse`).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
    }
    expect(parseChordText('Xyz')).toEqual({ ok: false, error: '"Xyz": must start with a note letter A–G' });
  });
});

// --- ambiguity -----------------------------------------------------------------

describe('interpretChordText (ambiguity is surfaced, never resolved silently)', () => {
  it('reads unambiguous text into a user-authored chord (confidence 1)', () => {
    const r = interpretChordText('Dm7');
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.chord.spelling).toBe('Dm7');
      expect(r.chord.confidence).toBe(1);
    }
  });

  it('a bare "sus" offers both readings — grammar default sus4 first', () => {
    expect(spellings(interpretChordText('Csus'))).toEqual(['Csus4', 'Csus2']);
    expect(spellings(interpretChordText('G7sus'))).toEqual(['G7sus4', 'G7sus2']);
    expect(spellings(interpretChordText('Asus/B'))).toEqual(['Asus4/B', 'Asus2/B']);
  });

  it('explicit sus2/sus4 text is NOT ambiguous', () => {
    expect(interpretChordText('Csus4').status).toBe('ok');
    expect(interpretChordText('Csus2').status).toBe('ok');
    expect(interpretChordText('C7sus4').status).toBe('ok');
  });

  it('invalid text stays invalid', () => {
    expect(interpretChordText('Xzz').status).toBe('invalid');
    expect(interpretChordText('').status).toBe('invalid');
  });
});

// --- §3 triad-only autocomplete --------------------------------------------------

describe('suggestChordCompletions (triad-only autocomplete)', () => {
  it('a bare root suggests only the four triads of that root — no 7ths/9ths/sus', () => {
    const list = suggestChordCompletions('C', KEY_C);
    expect(list.length).toBeGreaterThanOrEqual(4);
    expect(list.every((c) => c.stage === 'triad')).toBe(true);
    expect(list.map((c) => c.symbol)).toEqual(expect.arrayContaining(['C', 'Cm', 'Cdim', 'Caug']));
    for (const c of list) expect(c.symbol).not.toMatch(/(7|9|11|13|sus|add|6)/);
  });

  it('root+quality stays triad-only — typing "Cm" must NOT offer Cm7', () => {
    const list = suggestChordCompletions('Cm', KEY_C);
    expect(list[0]).toMatchObject({ symbol: 'Cm', exact: true });
    expect(list.every((c) => c.stage === 'triad')).toBe(true);
    expect(list.some((c) => c.symbol.includes('7'))).toBe(false);
  });

  it('"F# diminished" is among the suggestions for a typed root', () => {
    expect(suggestChordCompletions('F#', KEY_C).map((c) => c.symbol)).toContain('F#dim');
  });

  it('an extension marker opens the relevant extensions of the shared grammar', () => {
    expect(suggestChordCompletions('Cm7', KEY_C).map((c) => c.symbol)).toEqual(['Cm7', 'Cm7b5']);
    expect(suggestChordCompletions('C7', KEY_C).map((c) => c.symbol)).toEqual(['C7', 'C7sus4', 'C7sus2']);
    const adds = suggestChordCompletions('Cadd', KEY_C).map((c) => c.symbol);
    expect(adds).toEqual(expect.arrayContaining(['Cadd9', 'Cadd2', 'Cadd11', 'Cadd4']));
    expect(adds.every((s) => s.startsWith('Cadd'))).toBe(true);
    expect(suggestChordCompletions('Cmaj7', KEY_C)[0]).toMatchObject({ symbol: 'Cmaj7', exact: true });
    expect(suggestChordCompletions('Csus2', KEY_C)[0]).toMatchObject({ symbol: 'Csus2', exact: true });
    expect(suggestChordCompletions('Gsus4', KEY_C)[0]).toMatchObject({ symbol: 'Gsus4', exact: true });
    expect(suggestChordCompletions('C6', KEY_C).map((c) => c.symbol)).toEqual(['C6', 'C6/9']);
  });

  it('prioritizes exact matches, then diatonically relevant chords', () => {
    const g = suggestChordCompletions('G', KEY_C);
    expect(g[0]).toMatchObject({ symbol: 'G', exact: true, diatonic: true });
    expect(isDiatonicSymbol('G', scaleOf(KEY_C))).toBe(true);
    expect(isDiatonicSymbol('Gm', scaleOf(KEY_C))).toBe(false); // G–Bb–D: Bb is not in C major
    const cm = suggestChordCompletions('Cm', KEY_C);
    expect(cm[0]).toMatchObject({ symbol: 'Cm', exact: true });
    expect(cm.find((c) => c.symbol === 'Cm')?.diatonic).toBe(false); // Cm itself is not diatonic in C major
  });

  it('empty input offers the key\'s diatonic triads as the starting menu', () => {
    expect(suggestChordCompletions('', KEY_C).map((c) => c.symbol)).toEqual(['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim']);
    expect(suggestChordCompletions('   ', KEY_D).map((c) => c.symbol)).toEqual(['D', 'Em', 'F#m', 'G', 'A', 'Bm', 'C#dim']);
    expect(suggestChordCompletions('', null)).toEqual([]); // no key context → no menu
  });

  it('non-heptatonic modes produce no diatonic menu', () => {
    expect(suggestChordCompletions('', { tonic: 0, mode: 'Whole Tone', spelling: 'mixed' })).toEqual([]);
  });

  it('suggests key-idiomatic spellings without moving the pitch class', () => {
    // C#dim (the key's own vii°) outranks the remaining triads via the
    // diatonic bonus — exact match still leads.
    expect(suggestChordCompletions('Db', KEY_D).map((c) => c.symbol)).toEqual(['C#', 'C#dim', 'C#m', 'C#aug']);
    expect(suggestChordCompletions('C#', KEY_EB).map((c) => c.symbol)).toEqual(['Db', 'Dbm', 'Dbdim', 'Dbaug']);
    expect(suggestChordCompletions('Db', KEY_EB).map((c) => c.symbol)).toEqual(['Db', 'Dbm', 'Dbdim', 'Dbaug']);
    expect(suggestChordCompletions('Bb', KEY_F)[0]).toMatchObject({ symbol: 'Bb', exact: true });
    for (const c of suggestChordCompletions('Db', KEY_D)) expect(parseChord(c.symbol).chord.root).toBe(1);
  });

  it('respects the limit and returns nothing for non-note text', () => {
    expect(suggestChordCompletions('', KEY_C, 3)).toHaveLength(3);
    expect(suggestChordCompletions('X', KEY_C)).toEqual([]);
    expect(suggestChordCompletions('H', KEY_C)).toEqual([]);
  });
});

// --- §4 normalization ------------------------------------------------------------

describe('normalizeChordText (key-idiomatic spelling, pitch class invariant)', () => {
  it('Db → C# in D major (spec example)', () => {
    const r = normalizeChordText('Dbm7', KEY_D);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.symbol).toBe('C#m7');
      expect(r.chord.rootPc).toBe(1);
      expect(r.chord.confidence).toBe(1);
    }
  });

  it('C# → Db in Eb major (spec example)', () => {
    expect(normalizeChordText('C#m7', KEY_EB)).toMatchObject({ ok: true, symbol: 'Dbm7' });
  });

  it('F major prefers Bb over A# (spec example)', () => {
    expect(normalizeChordText('Bb', KEY_F)).toMatchObject({ ok: true, symbol: 'Bb' });
    expect(normalizeChordText('A#', KEY_F)).toMatchObject({ ok: true, symbol: 'Bb' });
  });

  it('preserves explicit valid spellings (naturals, already-idiomatic roots)', () => {
    expect(normalizeChordText('G/B', KEY_C)).toMatchObject({ ok: true, symbol: 'G/B' });
    expect(normalizeChordText('Db', KEY_EB)).toMatchObject({ ok: true, symbol: 'Db' });
    expect(normalizeChordText('B', KEY_F)).toMatchObject({ ok: true, symbol: 'B' }); // Lydian #4 stays
  });

  it('normalizes the slash bass too, without moving either pitch class', () => {
    const r = normalizeChordText('Db/F', KEY_D);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.symbol).toBe('C#/F');
      expect(parseChord(r.symbol).chord.root).toBe(parseChord('Db/F').chord.root);
      expect(parseChord(r.symbol).chord.bass).toBe(parseChord('Db/F').chord.bass);
    }
  });

  it('keeps the typed quality/extension suffix verbatim', () => {
    expect(normalizeChordText('Dbmaj7(b9)', KEY_D)).toMatchObject({ ok: true, symbol: 'C#maj7(b9)' });
    expect(normalizeChordText('Gb6/9', KEY_D)).toMatchObject({ ok: true, symbol: 'F#6/9' });
  });

  it('invalid text stays invalid', () => {
    expect(normalizeChordText('Hm7', KEY_C).ok).toBe(false);
    expect(normalizeChordText('', KEY_C).ok).toBe(false);
  });
});

// --- §5 text → MIDI ---------------------------------------------------------------

describe('voiceChordText (text → MIDI voicing)', () => {
  it('returns both the normalized name and a C4-centered close voicing', () => {
    const r = voiceChordText('C', KEY_C);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.voicing.symbol).toBe('C');
    expect(r.voicing.notes.map((n) => n.midi)).toEqual([60, 64, 67]);
  });

  it('honors slash bass, keeps notes in MIDI 36–84, one note per pitch class', () => {
    const r = voiceChordText('C/E', KEY_C);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const midis = r.voicing.notes.map((n) => n.midi);
    expect(r.voicing.bassNote).toBe('E');
    expect(midis[0]! % 12).toBe(4);
    for (const m of midis) expect(m).toBeGreaterThanOrEqual(36);
    for (const m of midis) expect(m).toBeLessThanOrEqual(84);
    expect(new Set(midis.map((m) => m % 12)).size).toBe(midis.length);
    for (let i = 1; i < midis.length; i++) expect(midis[i]).toBeGreaterThan(midis[i - 1]!);
  });

  it('normalizes before voicing (Dbm7 in D major sounds C#m7)', () => {
    const r = voiceChordText('Dbm7', KEY_D);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.voicing.symbol).toBe('C#m7');
    expect(r.voicing.notes.map((n) => n.midi % 12).sort((a, b) => a - b)).toEqual([1, 4, 8, 11]);
  });

  it('invalid text fails without voicing', () => {
    expect(voiceChordText('Xq', KEY_C).ok).toBe(false);
  });
});

// --- §6 the track update ------------------------------------------------------------

// --- fixtures (mirroring the interaction-suite rig) ----------------------------------

const ev = (id: string, symbol: string, startTick: number, durationTicks: number): ChordEvent =>
  ({ id, symbol, startTick, durationTicks });

const makeProject = (chords: ChordEvent[] = [], laneNotes: Note[] = []): Project => {
  const p = projectFromFixture({
    schemaVersion: 1, name: 'textentry-test', bpm: 120,
    tempoMap: [{ tick: 0, bpm: 120 }], timeSignature: TS44,
    key: 2, mode: 'Ionian', // D major — the spec's normalization example key
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

/** Real adapter + call recorder: undo labels, write order, and a tripwire
 *  that throws if the rename path ever tries to CREATE a clip. */
function makeRig(project: Project, breakReplace = false) {
  const host = makeIo(project);
  const api = createCrescodeChordTrackApi(host.io);
  const labels: string[] = [];
  const calls: string[] = [];
  const recording: CrescodeChordTrackApi = {
    ...api,
    beginUndoTransaction: (label) => { labels.push(label); calls.push('begin'); return api.beginUndoTransaction(label); },
    clearMidiNotes: (id) => { calls.push('clear'); api.clearMidiNotes(id); },
    replaceMidiNotes: (id, notes) => {
      calls.push('replace');
      if (breakReplace) throw new Error('MIDI write failed');
      api.replaceMidiNotes(id, notes);
    },
    renameChordClip: (id, name) => { calls.push('rename'); api.renameChordClip(id, name); },
    commitUndoTransaction: () => { calls.push('commit'); api.commitUndoTransaction(); },
    cancelUndoTransaction: () => { calls.push('cancel'); api.cancelUndoTransaction(); },
    createMidiClip: () => { throw new Error('renaming must never create a clip'); },
  };
  return { api: recording, labels, calls, host };
}

const laneNotesOf = (p: Project): Note[] => p.tracks.find((t) => t.role === 'chords')?.notes ?? [];
const chordEventOf = (p: Project, id: string): ChordEvent => p.chords.find((c) => c.id === id)!;

describe('applyChordTextToClip (the "Rename Chord" track update)', () => {
  const key = KEY_D;
  let rig = makeRig(makeProject([ev('c1', 'C', 0, 3840)], [{ pitch: 48, startTick: 0, durationTicks: 3840, velocity: 100 }]));

  const apply = (text: string, opts?: Parameters<typeof applyChordTextToClip>[4]) =>
    applyChordTextToClip(rig.api, 'c1', text, key, opts);

  describe('happy path', () => {
    beforeEach(() => {
      rig = makeRig(makeProject([ev('c1', 'C', 0, 3840)], [{ pitch: 48, startTick: 0, durationTicks: 3840, velocity: 100 }]));
    });

    it('renames + rewrites the MIDI in one "Rename Chord" transaction, bounds preserved', () => {
      const r = apply('Dm7');
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.symbol).toBe('Dm7');
      expect(r.clip.startTime).toBe(0);
      expect(r.clip.lengthTicks).toBe(3840);
      expect(r.notes.map((n) => n.midi)).toEqual([50, 53, 57, 60]); // D3 F3 A3 C4
      expect(laneNotesOf(rig.host.state.project).map((n) => n.pitch)).toEqual([50, 53, 57, 60]);
      expect(chordEventOf(rig.host.state.project, 'c1')).toMatchObject({ symbol: 'Dm7', startTick: 0, durationTicks: 3840 });
      expect(rig.labels).toEqual([RENAME_TRANSACTION_LABEL]);
      expect(rig.host.commitCount()).toBe(1);
      expect(rig.calls).toEqual(['begin', 'clear', 'replace', 'rename', 'commit']); // spec §6 order
      expect(rig.host.state.dirty).toBe(true);
    });

    it('normalizes through the project key (Dbm7 → C#m7 in D major)', () => {
      const r = apply('Dbm7');
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.symbol).toBe('C#m7');
      expect(chordEventOf(rig.host.state.project, 'c1').symbol).toBe('C#m7');
      expect(r.notes.map((n) => n.midi)).toEqual([49, 52, 56, 59]); // C#3 E3 G#3 B3
    });

    it('never creates a clip while renaming', () => {
      expect(apply('Dm7').ok).toBe(true);
      expect(rig.host.state.project.chords).toHaveLength(1); // no new lane event
    });
  });

  describe('edge cases (nothing is modified before the transaction opens)', () => {
    beforeEach(() => {
      rig = makeRig(makeProject([ev('c1', 'C', 0, 3840)], [{ pitch: 48, startTick: 0, durationTicks: 3840, velocity: 100 }]));
    });

    it('invalid text → inline failure, no transaction, clip untouched', () => {
      const r = apply('Qz9');
      expect(r).toMatchObject({ ok: false, reason: 'invalid' });
      if (r.ok === false && r.reason === 'invalid') expect(r.error.length).toBeGreaterThan(0);
      expect(rig.host.state.project.chords[0]?.symbol).toBe('C');
      expect(laneNotesOf(rig.host.state.project)).toHaveLength(1);
      expect(rig.labels).toEqual([]);
      expect(rig.host.commitCount()).toBe(0);
    });

    it('ambiguous text → both readings offered, clip untouched until one is chosen', () => {
      const r = apply('Csus');
      expect(r).toMatchObject({ ok: false, reason: 'ambiguous' });
      if (r.ok === false && r.reason === 'ambiguous') {
        expect(r.interpretations.map((c) => c.spelling)).toEqual(['Csus4', 'Csus2']);
      }
      expect(rig.host.state.project.chords[0]?.symbol).toBe('C');
      expect(rig.labels).toEqual([]);
      const chosen = apply('Csus2'); // the user picked one → commits cleanly
      expect(chosen).toMatchObject({ ok: true, symbol: 'Csus2' });
      expect(laneNotesOf(rig.host.state.project).map((n) => n.pitch % 12).sort((a, b) => a - b)).toEqual([0, 2, 7]);
    });

    it('drift since the editor opened → non-destructive warning, nothing overwritten', () => {
      const snapshot = { id: 'c1', startTime: 960, lengthTicks: 3840, symbol: 'C', noteSignature: '48:0:3840:100' };
      const r = apply('Dm7', { snapshot });
      expect(r).toMatchObject({ ok: false, reason: 'drift', drift: 'moved' });
      expect(rig.host.state.project.chords[0]?.symbol).toBe('C');
      expect(rig.labels).toEqual([]);
      const gone = applyChordTextToClip(rig.api, 'nope', 'Dm7', KEY_D);
      expect(gone).toMatchObject({ ok: false, reason: 'drift', drift: 'missing' });
    });

    it('a failed DAW operation cancels the transaction and restores chord + MIDI', () => {
      rig = makeRig(makeProject([ev('c4', 'C', 0, 3840)], [{ pitch: 48, startTick: 0, durationTicks: 3840, velocity: 100 }]), true);
      const r = applyChordTextToClip(rig.api, 'c4', 'Dm7', KEY_D);
      expect(r).toMatchObject({ ok: false, reason: 'error' });
      if (r.ok === false && r.reason === 'error') expect(r.error).toContain('MIDI write failed');
      expect(chordEventOf(rig.host.state.project, 'c4')).toMatchObject({ symbol: 'C', startTick: 0, durationTicks: 3840 });
      expect(laneNotesOf(rig.host.state.project).map((n) => n.pitch)).toEqual([48]);
      expect(rig.calls[rig.calls.length - 1]).toBe('cancel');
      expect(rig.host.commitCount()).toBe(0);
    });
  });

  it('warns before replacing substantial user MIDI the analyzer cannot read', () => {
    rig = makeRig(makeProject(
      [ev('c2', 'C', 0, 3840)],
      [60, 61, 62, 63].map((pitch) => ({ pitch, startTick: 0, durationTicks: 3840, velocity: 100 })), // chromatic cluster
    ));
    const r = applyChordTextToClip(rig.api, 'c2', 'G', KEY_D);
    expect(r).toMatchObject({ ok: false, reason: 'unrecognized-midi' });
    if (r.ok === false && r.reason === 'unrecognized-midi') {
      expect(r.analysis.status).toBe('unknown');
      expect(r.message).toContain('G');
    }
    expect(chordEventOf(rig.host.state.project, 'c2').symbol).toBe('C'); // nothing modified
    expect(rig.labels).toEqual([]);
    const confirmed = applyChordTextToClip(rig.api, 'c2', 'G', KEY_D, { confirmUnsafe: true });
    expect(confirmed).toMatchObject({ ok: true, symbol: 'G' });
    expect(laneNotesOf(rig.host.state.project).map((n) => n.pitch)).toEqual([55, 59, 62]);
  });

  it('recognizable MIDI (even incomplete) is replaced without a warning', () => {
    rig = makeRig(makeProject(
      [ev('c3', 'C', 0, 3840)],
      [
        { pitch: 48, startTick: 0, durationTicks: 3840, velocity: 100 },
        { pitch: 55, startTick: 0, durationTicks: 3840, velocity: 100 }, // C + G dyad → power-chord reading
      ],
    ));
    const r = applyChordTextToClip(rig.api, 'c3', 'Am', KEY_D);
    expect(r).toMatchObject({ ok: true, symbol: 'Am' });
  });
});
