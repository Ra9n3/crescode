import { PPQ, type Note, type TempoEntry, type TimeSignature, type Track } from '../../shared/schema/types';
import { barTicks } from '../../shared/schema/meter';
import { humanizeHeadTicks } from '../expression/timing';
import type { PianoComposerPlan } from './piano-composer';

export type PianoPolicyNote = Pick<Note, 'pitch' | 'startTick' | 'durationTicks'>;

export interface PianoPolicyExternalTrack {
  readonly id: string;
  readonly role: string;
  readonly notes: readonly PianoPolicyNote[];
}

export interface PianoOctavePolicyReport {
  readonly policy: 'forbidden' | 'not-required';
  readonly revoiced: number;
  readonly shortened: number;
  readonly dropped: number;
  readonly remainingHardPairs: number;
}

export interface PianoOctavePolicyInput {
  readonly plan: PianoComposerPlan;
  readonly targetTrack: Pick<Track, 'lowestNote' | 'highestNote'>;
  readonly notes: readonly Note[];
  /** Only tracks covered by the resolved template's octave rule. */
  readonly externalTracks?: readonly PianoPolicyExternalTrack[];
  readonly tempoMap?: readonly TempoEntry[];
  readonly timeSignature?: TimeSignature;
}

interface PolicyNoteRef {
  readonly trackId: string;
  readonly note: PianoPolicyNote;
  readonly pianoIndex: number | null;
}

interface HardOctavePair {
  readonly pianoIndex: number;
  readonly tick: number;
}

const pc = (pitch: number): number => ((pitch % 12) + 12) % 12;
const endOf = (note: PianoPolicyNote): number => note.startTick + note.durationTicks;
const overlaps = (a: PianoPolicyNote, b: PianoPolicyNote): boolean =>
  a.startTick < endOf(b) && b.startTick < endOf(a);
const isOctaveInterval = (a: number, b: number): boolean => {
  const interval = Math.abs(a - b);
  return interval > 0 && interval % 12 === 0;
};

function plannedSuspensionPitch(plan: PianoComposerPlan, note: Note): boolean {
  return plan.harmonicEvents.some((event) => {
    const suspension = event.suspension;
    if (!suspension) return false;
    if (note.roleTag === 'settle') {
      return pc(note.pitch) === pc(suspension.resolvesToPitchClass)
        && note.startTick > event.chord.startTick
        && note.startTick < event.chord.endTick;
    }
    if (note.roleTag !== 'answer') return false;
    const prepared = plan.harmonicEvents.find((candidate) =>
      candidate.chord.id === suspension.preparedByChordId);
    return !!prepared
      && pc(note.pitch) === pc(suspension.tensionPitchClass)
      && note.startTick < event.chord.startTick
      && endOf(note) > event.chord.startTick
      && note.startTick >= prepared.chord.startTick;
  });
}

function commonChordPitchClasses(plan: PianoComposerPlan, note: Note): number[] {
  const active = plan.harmonicEvents.filter((event) =>
    event.chord.startTick < endOf(note) && event.chord.endTick > note.startTick);
  if (!active.length) return [];
  let common = new Set(active[0].chord.availablePitchClasses.map(pc));
  for (const event of active.slice(1)) {
    const available = new Set(event.chord.availablePitchClasses.map(pc));
    common = new Set([...common].filter((pitchClass) => available.has(pitchClass)));
  }
  return [...common].sort((a, b) => a - b);
}

function candidatePitches(
  plan: PianoComposerPlan,
  note: Note,
  targetTrack: Pick<Track, 'lowestNote' | 'highestNote'>,
): number[] {
  let pitchClasses = commonChordPitchClasses(plan, note);
  if (plannedSuspensionPitch(plan, note)) pitchClasses = pitchClasses.filter((tone) => tone === pc(note.pitch));
  if (!pitchClasses.length) return [];
  const candidates: number[] = [];
  for (let pitch = targetTrack.lowestNote; pitch <= targetTrack.highestNote; pitch++) {
    if (pitch !== note.pitch && pitchClasses.includes(pc(pitch))) candidates.push(pitch);
  }
  // Prefer a nearby chord tone over moving the same pitch class by an octave;
  // the small penalty leaves an exact unison as a valid last-resort repair.
  return candidates.sort((a, b) => {
    const score = (pitch: number) => Math.abs(pitch - note.pitch)
      + (pc(pitch) === pc(note.pitch) ? 2 : 0);
    return score(a) - score(b) || a - b;
  });
}

/**
 * Enforce the same hard `forbidden` octave policy applied by the template
 * rule audit, without changing any non-Piano track. Revoicing uses only pitch
 * classes common to every supplied chord the note spans; if no safe chord
 * tone fits, the Piano note is shortened before the external entrance or
 * removed rather than leaving a hard policy violation in the score.
 */
export function applyPianoOctavePolicy(input: PianoOctavePolicyInput): {
  readonly notes: Note[];
  readonly report: PianoOctavePolicyReport;
} {
  const { plan, targetTrack, tempoMap, timeSignature } = input;
  const externalTracks = (input.externalTracks ?? []).filter((track) => track.role !== 'piano');
  const required = plan.templateConstraints.octaveDoubling === 'forbidden';
  const initialNotes = input.notes.map((note) => ({ ...note }));
  if (!required || !initialNotes.length || !externalTracks.length) {
    return {
      notes: initialNotes,
      report: { policy: required ? 'forbidden' : 'not-required', revoiced: 0, shortened: 0, dropped: 0, remainingHardPairs: 0 },
    };
  }

  const notes = initialNotes;
  const external = externalTracks.flatMap((track) => track.notes.map((note) => ({
    trackId: track.id,
    note,
    pianoIndex: null,
  })));
  const tempoEntries = tempoMap ? [...tempoMap] : undefined;
  const headAt = (tick: number): number => tempoEntries ? humanizeHeadTicks(tempoEntries, tick) : 0;
  const barSize = timeSignature ? barTicks(timeSignature) : 0;

  const allRefs = (): PolicyNoteRef[] => [
    ...notes.map((note, pianoIndex) => ({ trackId: '__piano__', note, pianoIndex })),
    ...external,
  ];

  const chordAt = (tick: number) => plan.harmonicEvents.find((event) =>
    tick >= event.chord.startTick && tick < event.chord.endTick) ?? null;

  const forcedAt = (at: number, pitch: number, all: readonly PolicyNoteRef[]): boolean => {
    const chord = chordAt(at);
    if (!chord) return false;
    const chordTones = chord.chord.availablePitchClasses.map(pc);
    if (!chordTones.includes(pc(pitch))) return false;
    const head = headAt(at);
    let sounding = 0;
    for (const entry of all) {
      if (entry.note.startTick <= at + head && endOf(entry.note) > at) sounding++;
    }
    return sounding > chordTones.length;
  };

  const isHardPair = (a: PolicyNoteRef, b: PolicyNoteRef, all: readonly PolicyNoteRef[]): boolean => {
    if (!overlaps(a.note, b.note) || !isOctaveInterval(a.note.pitch, b.note.pitch)) return false;
    const tick = Math.max(a.note.startTick, b.note.startTick);
    const head = headAt(tick);
    if (forcedAt(tick, a.note.pitch, all) || forcedAt(tick - head, a.note.pitch, all)) return false;

    if (a.trackId !== b.trackId && barSize > 0) {
      const shortNote = a.note.durationTicks <= b.note.durationTicks ? a.note : b.note;
      const longNote = shortNote === a.note ? b.note : a.note;
      const chord = chordAt(tick);
      if (shortNote.durationTicks <= barSize / 2
        && longNote.durationTicks > shortNote.durationTicks
        && chord?.chord.availablePitchClasses.map(pc).includes(pc(shortNote.pitch))) return false;
    }
    return true;
  };

  const findHardPairs = (): HardOctavePair[] => {
    const all = allRefs();
    const piano = all.filter((entry) => entry.pianoIndex !== null);
    const other = all.filter((entry) => entry.pianoIndex === null);
    const pairs: HardOctavePair[] = [];
    for (let i = 0; i < piano.length; i++) {
      const a = piano[i];
      for (const b of other) {
        if (isHardPair(a, b, all)) pairs.push({ pianoIndex: a.pianoIndex!, tick: Math.max(a.note.startTick, b.note.startTick) });
      }
      for (let j = i + 1; j < piano.length; j++) {
        const b = piano[j];
        if (isHardPair(a, b, all)) pairs.push({ pianoIndex: a.pianoIndex!, tick: Math.max(a.note.startTick, b.note.startTick) });
      }
    }
    return pairs.sort((a, b) => a.tick - b.tick || a.pianoIndex - b.pianoIndex);
  };

  const collidesWithPianoUnison = (pianoIndex: number, pitch: number): boolean =>
    notes.some((other, index) => index !== pianoIndex
      && other.pitch === pitch && overlaps(notes[pianoIndex], other));

  let revoiced = 0;
  let shortened = 0;
  let dropped = 0;
  let hardPairs = findHardPairs();
  let guard = 0;
  const maxPasses = Math.max(1, notes.length * (external.length + notes.length) + notes.length + 1);

  while (hardPairs.length && guard++ < maxPasses) {
    const beforeCount = hardPairs.length;
    const conflict = hardPairs[0];
    const note = notes[conflict.pianoIndex];
    if (!note) break;

    let repaired = false;
    for (const pitch of candidatePitches(plan, note, targetTrack)) {
      if (collidesWithPianoUnison(conflict.pianoIndex, pitch)) continue;
      const original = note.pitch;
      note.pitch = pitch;
      const nextPairs = findHardPairs();
      if (nextPairs.length < beforeCount) {
        revoiced++;
        hardPairs = nextPairs;
        repaired = true;
        break;
      }
      note.pitch = original;
    }
    if (repaired) continue;

    const originalDuration = note.durationTicks;
    const keptTicks = conflict.tick - note.startTick;
    if (keptTicks >= Math.min(PPQ / 4, originalDuration)) {
      note.durationTicks = keptTicks;
      const nextPairs = findHardPairs();
      if (nextPairs.length < beforeCount) {
        shortened++;
        hardPairs = nextPairs;
        continue;
      }
      note.durationTicks = originalDuration;
    }

    notes.splice(conflict.pianoIndex, 1);
    dropped++;
    hardPairs = findHardPairs();
  }

  hardPairs = findHardPairs();
  return {
    notes,
    report: {
      policy: 'forbidden',
      revoiced,
      shortened,
      dropped,
      remainingHardPairs: hardPairs.length,
    },
  };
}
