/**
 * Phase 4.3C — consistent audition export for human listening evaluation
 * (spec §9, §10).
 *
 * The production chord generator's voicing (and the orchestral MIDI
 * generator) are intentionally NOT touched. This module renders generated
 * chord events into a small standalone Type-1 MIDI file with ONE fixed,
 * neutral representation used identically for every configuration:
 *
 *   - same tempo (the project's bpm),
 *   - same meter and section markers (same phrase boundaries),
 *   - same block-chord voicing strategy: the root anchored near C3, chord
 *     tones stacked upward in closed position, slash bass below when given,
 *   - same velocity, same short release gap so changes articulate clearly.
 *
 * Differences heard between files therefore come from the harmony alone —
 * never from sound design. Uses the existing `midi-file` dependency only.
 */
import { writeMidi, type MidiData } from 'midi-file';
import { PPQ, type Project } from '../../shared/schema/types';
import { barTicks, barToTick } from '../../shared/schema/meter';
import { parseChord } from '../../shared/schema/chords';
import type { AuditEvent } from './audit';

/** Anchor register for the audition voicing (C3 = MIDI 48). */
const ANCHOR = 48;
const VELOCITY = 80;
/** Release gap (ticks) so consecutive block chords articulate. */
const GAP_TICKS = 30;

/** Fixed closed-position voicing for one chord symbol. */
export function auditionVoicing(symbol: string): number[] {
  const parsed = parseChord(symbol);
  if (!parsed.ok) return [];
  const chord = parsed.chord;
  // Root anchored just below/at the anchor register.
  let root = ANCHOR + ((chord.root - ANCHOR) % 12 + 12) % 12;
  if (root > ANCHOR + 11) root -= 12;
  // Slash bass sits below the root.
  const notes: number[] = [];
  if (chord.bass !== null) {
    let bass = root - 12 + ((chord.bass - root) % 12 + 12) % 12;
    if (bass >= root) bass -= 12;
    notes.push(bass);
  }
  notes.push(root);
  // Stack the remaining chord tones upward in closed position.
  let prev = root;
  for (const pc of chord.pitchClasses) {
    if (pc === chord.root && chord.bass === null) continue;
    if (pc === chord.root) continue;
    let next = prev + (((pc - prev) % 12) + 12) % 12;
    if (next === prev) next += 12;
    notes.push(next);
    prev = next;
  }
  return notes;
}

/** One note pair with absolute ticks. */
interface AuditionNote { pitch: number; startTick: number; endTick: number }

/** Render audit events into block-chord notes. */
export function auditionNotes(events: AuditEvent[]): AuditionNote[] {
  const notes: AuditionNote[] = [];
  for (const ev of events) {
    const end = ev.startTick + Math.max(1, ev.durationTicks - GAP_TICKS);
    for (const pitch of auditionVoicing(ev.symbol)) {
      notes.push({ pitch, startTick: ev.startTick, endTick: Math.max(ev.startTick + 1, end) });
    }
  }
  return notes.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
}

interface AbsEvent { abs: number; order: number; [k: string]: unknown }

function finalizeTrack(events: AbsEvent[], endTick: number): MidiData['tracks'][number] {
  const sorted = [...events].sort((a, b) =>
    (a.abs as number) - (b.abs as number) || (a.order as number) - (b.order as number));
  let last = 0;
  const out: MidiData['tracks'][number] = sorted.map((e) => {
    const { abs, order, ...rest } = e;
    void order;
    return { ...rest, deltaTime: (abs as number) - last } as MidiData['tracks'][number][number];
  });
  out.push({ deltaTime: Math.max(0, endTick - last), meta: true, type: 'endOfTrack' });
  return out;
}

/**
 * Build a Type-1 audition MIDI (960 PPQ): conductor track (tempo, meter,
 * section markers) + one block-chord track. Deterministic for identical
 * inputs — no wall-clock data anywhere in the file.
 */
export function buildAuditionMidi(project: Project, events: AuditEvent[]): Uint8Array {
  const bt = barTicks(project.timeSignature);
  const lastEvent = events.length > 0 ? events[events.length - 1] : null;
  const endTick = lastEvent !== null
    ? Math.max(lastEvent.startTick + lastEvent.durationTicks, project.sections.length * bt, bt)
    : bt;
  const tempoUs = Math.round(60000000 / project.bpm);

  const conductor: AbsEvent[] = [
    { abs: 0, order: 0, meta: true, type: 'trackName', text: 'Crescode audit audition' },
    { abs: 0, order: 0, meta: true, type: 'setTempo', microsecondsPerBeat: tempoUs },
    { abs: 0, order: 0, meta: true, type: 'timeSignature', numerator: project.timeSignature.numerator, denominator: project.timeSignature.denominator, metronome: 24, thirtyseconds: 8 },
  ];
  for (const s of [...project.sections].sort((a, b) => a.startBar - b.startBar)) {
    conductor.push({ abs: barToTick(s.startBar, project.timeSignature), order: 0, meta: true, type: 'marker', text: s.name });
  }

  const chords: AbsEvent[] = [{ abs: 0, order: 0, meta: true, type: 'trackName', text: 'Block chords (audit voicing)' }];
  for (const n of auditionNotes(events)) {
    chords.push({ abs: n.startTick, order: 2, channel: 0, type: 'noteOn', noteNumber: n.pitch, velocity: VELOCITY });
    chords.push({ abs: n.endTick, order: 1, channel: 0, type: 'noteOff', noteNumber: n.pitch, velocity: 0 });
  }

  const data: MidiData = {
    header: { format: 1, numTracks: 2, ticksPerBeat: PPQ },
    tracks: [finalizeTrack(conductor, endTick), finalizeTrack(chords, endTick)],
  };
  return new Uint8Array(writeMidi(data));
}
