/**
 * MIDI export (Type 1, 960 PPQ) using the `midi-file` library.
 * Mixer state (volume/pan/mute/solo) and routing are intentionally ignored.
 *
 * Phase 5.5: an optional export profile rewrites the instrument tracks into
 * profile PARTS (patch name, own channel, keyswitch notes ahead of every
 * articulation change, filtered CC lanes, transposition, sampled-tremolo
 * merge). Without a profile the writers are byte-identical to the plain
 * export; the profile never touches the project — keyswitches exist only in
 * the exported file.
 */
import { parseMidi, writeMidi, type MidiData, type MidiEvent } from 'midi-file';
import { barTicks, projectEndTick } from '../shared/schema/meter';
import { MODES } from '../shared/schema/modes';
import { PPQ, isInstrumentTrack, type CcLane, type Note, type Project, type Track } from '../shared/schema/types';
import { chunksForTrack, type ExportProfile } from './profile';

type Abs = MidiEvent & { abs: number; order: number };

const MAJOR_SHARPS: Record<number, number> = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 1: -5, 8: -4, 3: -3, 10: -2, 5: -1 };
const RELATIVE_MAJOR_OFFSET: Record<string, number> = { Ionian: 0, Dorian: 2, Phrygian: 4, Lydian: 5, Mixolydian: 7, Aeolian: 9, Locrian: 11 };

/** Key signature meta values for a key + mode. Church modes use the parent major's signature. */
export function keySignatureFor(key: number, mode: string): { key: number; scale: 0 | 1 } {
  if (mode === 'Aeolian' || mode === 'Harmonic Minor' || mode === 'Melodic Minor') {
    return { key: MAJOR_SHARPS[(key + 3) % 12], scale: 1 };
  }
  const off = RELATIVE_MAJOR_OFFSET[mode];
  if (off !== undefined) return { key: MAJOR_SHARPS[(key - off + 12) % 12], scale: 0 };
  return { key: MAJOR_SHARPS[key % 12], scale: 0 };
}

function conductorEvents(p: Project, withMarkers: boolean): Abs[] {
  const k = keySignatureFor(p.key, p.mode in MODES ? p.mode : 'Ionian');
  const ev: Abs[] = [
    { abs: 0, order: 0, deltaTime: 0, meta: true, type: 'setTempo', microsecondsPerBeat: Math.round(60000000 / p.bpm) } as Abs,
    { abs: 0, order: 0, deltaTime: 0, meta: true, type: 'timeSignature', numerator: p.timeSignature.numerator, denominator: p.timeSignature.denominator, metronome: 24, thirtyseconds: 8 } as Abs,
    { abs: 0, order: 0, deltaTime: 0, meta: true, type: 'keySignature', key: k.key, scale: k.scale } as Abs,
  ];
  if (withMarkers) {
    const bt = barTicks(p.timeSignature);
    for (const s of [...p.sections].sort((a, b) => a.startBar - b.startBar)) {
      ev.push({ abs: (s.startBar - 1) * bt, order: 0, deltaTime: 0, meta: true, type: 'marker', text: s.name } as Abs);
    }
  }
  return ev;
}

function noteEvents(notes: Note[], channel: number, endTick: number): Abs[] {
  const ev: Abs[] = [];
  const ch = Math.max(0, Math.min(15, channel - 1));
  for (const n of notes) {
    const s = Math.max(0, Math.round(n.startTick));
    const e = Math.min(endTick, Math.round(n.startTick + n.durationTicks));
    if (e <= s) continue;
    ev.push({ abs: s, order: 2, deltaTime: 0, channel: ch, type: 'noteOn', noteNumber: n.pitch, velocity: Math.max(1, Math.min(127, Math.round(n.velocity))) } as Abs);
    ev.push({ abs: e, order: 1, deltaTime: 0, channel: ch, type: 'noteOff', noteNumber: n.pitch, velocity: 0 } as Abs);
  }
  return ev;
}

/**
 * Optional CC lanes as controller events on the track's channel. Points sit
 * at their exact tick (clamped into [0, endTick]); at a shared tick they sort
 * before note-ons (order 0), so a swell peak lands before the note that
 * follows it. Projects without cc produce zero events — notes-only exports
 * stay byte-identical to the pre-CC writer.
 */
function ccEvents(cc: CcLane[] | undefined, channel: number, endTick: number): Abs[] {
  if (!cc || !cc.length) return [];
  const ev: Abs[] = [];
  const ch = Math.max(0, Math.min(15, channel - 1));
  for (const lane of cc) {
    if (!lane || !Array.isArray(lane.points)) continue;
    for (const pt of lane.points) {
      if (!Number.isInteger(pt.tick) || !Number.isInteger(pt.value)) continue;
      const tick = Math.max(0, Math.min(endTick, pt.tick));
      ev.push({ abs: tick, order: 0, deltaTime: 0, channel: ch, type: 'controller', controllerType: Math.max(0, Math.min(127, lane.cc)), value: Math.max(0, Math.min(127, pt.value)) } as Abs);
    }
  }
  return ev;
}

/** Sorts absolute events, converts to delta times and appends end-of-track at endTick. */
function finalize(events: Abs[], endTick: number): MidiEvent[] {
  const sorted = events.map((e, i) => ({ e, i })).sort((a, b) => a.e.abs - b.e.abs || a.e.order - b.e.order || a.i - b.i).map((x) => x.e);
  let last = 0;
  const out: MidiEvent[] = sorted.map((e) => {
    const { abs, order, ...rest } = e;
    void order;
    const ev = { ...rest, deltaTime: abs - last } as MidiEvent;
    last = abs;
    return ev;
  });
  out.push({ deltaTime: Math.max(0, endTick - last), meta: true, type: 'endOfTrack' } as MidiEvent);
  return out;
}

const nameEvent = (text: string): Abs => ({ abs: 0, order: 0, deltaTime: 0, meta: true, type: 'trackName', text } as Abs);

export function exportableTracks(p: Project, mode: 'all' | 'selected' | 'unlocked', selected: string[] = []): Track[] {
  return p.tracks.filter((t) => isInstrumentTrack(t) && (mode === 'all' || (mode === 'selected' ? selected.includes(t.id) : !t.locked)));
}

/** Single Type-1 file: conductor track + one track per instrument (per profile part when a profile is given). */
export function buildMergedMidi(p: Project, tracks: Track[], profile: ExportProfile | null = null): Uint8Array {
  const end = projectEndTick(p);
  const chunks = tracks.flatMap((t) => chunksForTrack(p, t, profile));
  const data: MidiData = {
    header: { format: 1, numTracks: chunks.length + 1, ticksPerBeat: PPQ },
    tracks: [
      finalize([nameEvent(p.name || 'Crescode'), ...conductorEvents(p, true)], end),
      ...chunks.map((c) => finalize([nameEvent(c.name), ...ccEvents(c.cc, c.channel, end), ...noteEvents(c.notes, c.channel, end)], end)),
    ],
  };
  return new Uint8Array(writeMidi(data));
}

export function perTrackFileName(p: Project, t: Track): string {
  const idx = p.tracks.findIndex((x) => x.id === t.id) + 1;
  const safe = t.name.replace(/[\\/:*?"<>|]+/g, '-').trim();
  return `${String(idx).padStart(2, '0')} ${safe}.mid`;
}

/** One Type-1 file per instrument (per profile part when a profile is given); each has tempo/time/key and ends at the project end tick. */
export function buildPerTrackMidi(p: Project, tracks: Track[], profile: ExportProfile | null = null): { fileName: string; data: Uint8Array }[] {
  const end = projectEndTick(p);
  return tracks.flatMap((t) =>
    chunksForTrack(p, t, profile).map((c) => ({
      fileName: perTrackFileName(p, { ...t, name: c.name }),
      data: new Uint8Array(writeMidi({
        header: { format: 1, numTracks: 2, ticksPerBeat: PPQ },
        tracks: [
          finalize([nameEvent(c.name), ...conductorEvents(p, true)], end),
          finalize([nameEvent(c.name), ...ccEvents(c.cc, c.channel, end), ...noteEvents(c.notes, c.channel, end)], end),
        ],
      })),
    })),
  );
}

export interface ParsedCcEvent { cc: number; tick: number; value: number }
export interface ParsedMidiTrack { name: string; channel: number | null; notes: Note[]; cc: ParsedCcEvent[]; endTick: number }
export interface ParsedMidiFile { ppq: number; format: number; bpm: number | null; timeSignature: [number, number] | null; markers: { tick: number; text: string }[]; tracks: ParsedMidiTrack[] }

/** Parses a MIDI file back into notes (used for the round-trip test and verification). */
export function parseMidiFile(bytes: Uint8Array): ParsedMidiFile {
  const m = parseMidi(bytes);
  const res: ParsedMidiFile = { ppq: m.header.ticksPerBeat ?? 0, format: m.header.format, bpm: null, timeSignature: null, markers: [], tracks: [] };
  for (const tr of m.tracks) {
    let abs = 0;
    let name = '';
    let channel: number | null = null;
    const open = new Map<number, { start: number; vel: number }[]>();
    const notes: Note[] = [];
    const cc: ParsedCcEvent[] = [];
    for (const e of tr) {
      abs += e.deltaTime;
      if (e.type === 'trackName') name = e.text;
      else if (e.type === 'setTempo') res.bpm = Math.round((60000000 / e.microsecondsPerBeat) * 1000) / 1000;
      else if (e.type === 'timeSignature') res.timeSignature = [e.numerator, e.denominator];
      else if (e.type === 'marker') res.markers.push({ tick: abs, text: e.text });
      else if (e.type === 'controller') {
        cc.push({ cc: e.controllerType, tick: abs, value: e.value });
        if (channel === null) channel = e.channel + 1;
      }
      else if (e.type === 'noteOn' && e.velocity > 0) {
        channel = e.channel + 1;
        const q = open.get(e.noteNumber) ?? [];
        q.push({ start: abs, vel: e.velocity });
        open.set(e.noteNumber, q);
      } else if (e.type === 'noteOff' || (e.type === 'noteOn' && e.velocity === 0)) {
        const q = open.get(e.noteNumber);
        const o = q?.shift();
        if (o) notes.push({ pitch: e.noteNumber, startTick: o.start, durationTicks: abs - o.start, velocity: o.vel });
      }
    }
    notes.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
    cc.sort((a, b) => a.tick - b.tick || a.cc - b.cc || a.value - b.value);
    res.tracks.push({ name, channel, notes, cc, endTick: abs });
  }
  return res;
}
