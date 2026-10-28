import { FAMILY_COLORS } from '../../theme/tokens';
import { ADD_TRACK_TEMPLATES, INSTRUMENTS, instrumentRange } from './ranges';
import { DEFAULT_CHORDGEN_SETTINGS, PPQ, SCHEMA_VERSION, isInstrumentTrack, type Project, type Track, type TrackFamily } from './types';

let counter = 0;
export function uid(prefix = 'id'): string {
  counter = (counter + 1) % 1e6;
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.floor(Date.now() % 1e8).toString(36);
  return `${prefix}_${rnd}${counter.toString(36)}`;
}

export function makeTrack(partial: Partial<Track> & { name: string; family: TrackFamily }): Track {
  return {
    id: partial.id ?? uid('trk'),
    name: partial.name,
    family: partial.family,
    color: partial.color ?? FAMILY_COLORS[partial.family],
    role: partial.role ?? partial.name.toLowerCase().replace(/[^a-z0-9]+/g, ''),
    lowestNote: partial.lowestNote ?? 0,
    highestNote: partial.highestNote ?? 127,
    locked: partial.locked ?? false,
    muted: partial.muted ?? false,
    soloed: partial.soloed ?? false,
    libraryGroupId: partial.libraryGroupId ?? null,
    midiChannel: partial.midiChannel ?? 1,
    frozen: partial.frozen ?? false,
    volume: partial.volume ?? 0.8,
    pan: partial.pan ?? 0,
    notes: partial.notes ?? [],
  };
}

export function createDefaultTracks(): Track[] {
  let ch = 0;
  return INSTRUMENTS.map((def, i) => {
    const [lo, hi] = instrumentRange(def);
    const t = makeTrack({
      id: `trk_${String(i).padStart(2, '0')}_${def.role}`,
      name: def.name, family: def.family, role: def.role, lowestNote: lo, highestNote: hi,
    });
    if (isInstrumentTrack(t)) { t.midiChannel = (ch % 16) + 1; ch++; }
    return t;
  });
}

export function createDefaultProject(): Project {
  return {
    schemaVersion: SCHEMA_VERSION,
    name: 'Untitled',
    bpm: 120,
    tempoMap: [{ tick: 0, bpm: 120 }],
    timeSignature: { numerator: 4, denominator: 4 },
    key: 0,
    mode: 'Ionian',
    sections: [],
    chords: [],
    chordGenSettings: { ...DEFAULT_CHORDGEN_SETTINGS },
    referenceAudio: { path: null, offsetMs: 0 },
    tracks: createDefaultTracks(),
    libraryGroups: [],
    masterVolume: 1,
  };
}

/** Builds a new track for the "Add Track" menu. */
export function createAddedTrack(family: TrackFamily, existing: Track[]): Track {
  const tpl = ADD_TRACK_TEMPLATES[family] ?? ADD_TRACK_TEMPLATES.Keys;
  const n = existing.filter((t) => t.family === family).length + 1;
  const used = existing.filter((t) => isInstrumentTrack(t)).length;
  return makeTrack({
    name: `${tpl.name} ${n}`, family, role: tpl.role,
    lowestNote: tpl.low, highestNote: tpl.high, midiChannel: (used % 16) + 1,
  });
}

/** Builds a project from a minimal fixture document (fills in default tracks if omitted). */
export function projectFromFixture(doc: Partial<Project>): Project {
  const base = createDefaultProject();
  const p: Project = { ...base, ...doc, tracks: doc.tracks && doc.tracks.length ? doc.tracks : base.tracks } as Project;
  p.tempoMap = doc.tempoMap ?? [{ tick: 0, bpm: p.bpm }];
  return p;
}

export const TICKS_PER_QUARTER = PPQ;
