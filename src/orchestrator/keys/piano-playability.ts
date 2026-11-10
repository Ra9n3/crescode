/**
 * Report-only Piano playability diagnostics. The validator never edits, moves,
 * shortens, or removes an event; all findings retain their source score IDs.
 */
import type { PianoScore, PianoScoreEvent, PianoHand } from './piano-score';

export type PianoPlayabilitySeverity = 'warning' | 'violation';
export type PianoPlayabilityFindingCode =
  | 'invalid-event'
  | 'pitch-range'
  | 'hand-span'
  | 'voice-leap'
  | 'voice-register-discontinuity'
  | 'simultaneous-hand-demand'
  | 'hand-crossing'
  | 'per-hand-polyphony'
  | 'sustain-movement-conflict'
  | 'suspicious-density';

export interface PianoPlayabilityException {
  readonly code: PianoPlayabilityFindingCode | '*';
  readonly startTick: number;
  readonly endTick: number;
  /** A specific musical reason, e.g. a marked dialogue crossing or rolled chord. */
  readonly reason: string;
}

export interface PianoPlayabilityContext {
  readonly lowestNote?: number;
  readonly highestNote?: number;
  /** Exact meter-derived bar length when available; defaults to 4/4 at 960 PPQ. */
  readonly barTicks?: number;
  readonly softHandSpanSemitones?: number;
  readonly hardHandSpanSemitones?: number;
  readonly maxAttacksPerHandPerBar?: number;
  /** Exceptions annotate findings; they never erase them. */
  readonly exceptions?: readonly PianoPlayabilityException[];
}

export interface PianoPlayabilityFinding {
  readonly code: PianoPlayabilityFindingCode;
  readonly severity: PianoPlayabilitySeverity;
  readonly tick: number;
  readonly endTick: number;
  readonly eventIds: readonly string[];
  readonly message: string;
  readonly hand?: PianoHand;
  /** A matching exception is visible in the report, not silently exempted. */
  readonly contextualException?: string;
}

export interface PianoPlayabilityReport {
  readonly warnings: readonly PianoPlayabilityFinding[];
  readonly violations: readonly PianoPlayabilityFinding[];
  readonly findings: readonly PianoPlayabilityFinding[];
}

const endOf = (event: PianoScoreEvent): number => event.startTick + event.durationTicks;
const overlaps = (a: PianoScoreEvent, b: PianoScoreEvent): boolean => a.startTick < endOf(b) && b.startTick < endOf(a);

function registerBand(pitch: number): number {
  if (pitch < 48) return 0;
  if (pitch < 60) return 1;
  if (pitch < 72) return 2;
  if (pitch < 84) return 3;
  return 4;
}

function exceptionAt(
  context: PianoPlayabilityContext,
  code: PianoPlayabilityFindingCode,
  tick: number,
  endTick: number,
): PianoPlayabilityException | undefined {
  return context.exceptions?.find((exception) =>
    (exception.code === code || exception.code === '*')
      && tick < exception.endTick && exception.startTick < endTick);
}

/**
 * Validate hand reach/demand, voice continuity, crossings, sustain travel, and
 * density in musical context. Thresholds are advisory defaults, not claims of
 * universal technique: template/gesture-specific exceptions can annotate a
 * finding, while impossible MIDI data and extreme physical demands remain
 * visible as hard violations unless explicitly documented.
 */
export function validatePianoScorePlayability(
  score: PianoScore,
  context: PianoPlayabilityContext = {},
): PianoPlayabilityReport {
  const lowest = context.lowestNote ?? 0;
  const highest = context.highestNote ?? 127;
  const softSpan = context.softHandSpanSemitones ?? 12;
  const hardSpan = context.hardHandSpanSemitones ?? 19;
  const barTicks = Number.isFinite(context.barTicks) && context.barTicks! > 0 ? context.barTicks! : 3840;
  const maxAttacks = context.maxAttacksPerHandPerBar ?? 12;
  const findings: PianoPlayabilityFinding[] = [];

  const emit = (
    code: PianoPlayabilityFindingCode,
    severity: PianoPlayabilitySeverity,
    tick: number,
    endTick: number,
    events: readonly PianoScoreEvent[],
    message: string,
    hand?: PianoHand,
  ) => {
    const exception = exceptionAt(context, code, tick, Math.max(tick + 1, endTick));
    // An explicit exception explains a difficult but intentional passage; it
    // softens, but does not hide, a hard-demand finding.
    const reportedSeverity = exception && severity === 'violation' ? 'warning' : severity;
    findings.push(Object.freeze({
      code,
      severity: reportedSeverity,
      tick,
      endTick,
      eventIds: Object.freeze([...new Set(events.map((event) => event.id))].sort()),
      message,
      ...(hand ? { hand } : {}),
      ...(exception ? { contextualException: exception.reason } : {}),
    }));
  };

  for (const event of score.events) {
    if (!Number.isInteger(event.pitch) || !Number.isInteger(event.startTick)
      || !Number.isInteger(event.durationTicks) || event.startTick < 0 || event.durationTicks < 1) {
      emit('invalid-event', 'violation', Number.isFinite(event.startTick) ? Math.max(0, event.startTick) : 0,
        Number.isFinite(event.startTick + event.durationTicks) ? Math.max(1, endOf(event)) : 1,
        [event], `Score event ${event.id} has an invalid pitch or time/duration tuple.`, event.hand);
      continue;
    }
    if (event.pitch < lowest || event.pitch > highest || event.pitch < 0 || event.pitch > 127) {
      emit('pitch-range', 'violation', event.startTick, endOf(event), [event],
        `Score event ${event.id} uses MIDI ${event.pitch}, outside the playable range ${lowest}–${highest}.`, event.hand);
    }
    if (endOf(event) > score.projectEndTick) {
      emit('invalid-event', 'violation', event.startTick, endOf(event), [event],
        `Score event ${event.id} extends past project tick ${score.projectEndTick}.`, event.hand);
    }
  }

  const valid = score.events.filter((event) => Number.isInteger(event.pitch)
    && Number.isInteger(event.startTick) && Number.isInteger(event.durationTicks)
    && event.startTick >= 0 && event.durationTicks > 0);
  const boundaries = [...new Set(valid.flatMap((event) => [event.startTick, endOf(event)]))]
    .sort((a, b) => a - b);
  const segmentKeys = new Set<string>();
  for (let index = 0; index + 1 < boundaries.length; index++) {
    const tick = boundaries[index];
    const nextTick = boundaries[index + 1];
    if (nextTick <= tick) continue;
    const active = valid.filter((event) => event.startTick <= tick && endOf(event) > tick);
    const left = active.filter((event) => event.hand === 'left');
    const right = active.filter((event) => event.hand === 'right');

    for (const [hand, handEvents] of [['left', left], ['right', right]] as const) {
      const pitches = [...new Set(handEvents.map((event) => event.pitch))].sort((a, b) => a - b);
      if (pitches.length > 1) {
        const span = pitches[pitches.length - 1] - pitches[0];
        if (span > softSpan) {
          const key = `span:${hand}:${tick}:${pitches.join(',')}`;
          if (!segmentKeys.has(key)) {
            segmentKeys.add(key);
            emit('hand-span', span > hardSpan ? 'violation' : 'warning', tick, nextTick, handEvents,
              `${hand} hand spans ${span} semitones (${pitches[0]}–${pitches[pitches.length - 1]}); review reach and voicing.`, hand);
          }
        }
      }
      if (pitches.length > 4) {
        const key = `poly:${hand}:${tick}:${pitches.join(',')}`;
        if (!segmentKeys.has(key)) {
          segmentKeys.add(key);
          emit('per-hand-polyphony', pitches.length > 5 ? 'violation' : 'warning', tick, nextTick, handEvents,
            `${hand} hand has ${pitches.length} distinct simultaneous pitches; five is the conservative single-hand ceiling.`, hand);
        }
      }
    }

    const leftPitches = new Set(left.map((event) => event.pitch));
    const rightPitches = new Set(right.map((event) => event.pitch));
    const demand = leftPitches.size + rightPitches.size;
    if (demand > 8 && leftPitches.size >= 3 && rightPitches.size >= 3) {
      const all = [...left, ...right];
      const key = `demand:${tick}:${[...leftPitches].sort((a, b) => a - b).join(',')}:${[...rightPitches].sort((a, b) => a - b).join(',')}`;
      if (!segmentKeys.has(key)) {
        segmentKeys.add(key);
        emit('simultaneous-hand-demand', demand > 10 ? 'violation' : 'warning', tick, nextTick, all,
          `Both hands demand ${demand} distinct simultaneous pitches (${leftPitches.size} left, ${rightPitches.size} right).`);
      }
    }
  }

  // Crossings can be intentional (register exchange, dialogue, or a marked
  // hand transfer); the default is a review warning, never an automatic error.
  for (const left of valid.filter((event) => event.hand === 'left')) {
    for (const right of valid.filter((event) => event.hand === 'right')) {
      if (!overlaps(left, right) || left.pitch <= right.pitch) continue;
      const tick = Math.max(left.startTick, right.startTick);
      const key = `cross:${left.id}:${right.id}`;
      if (segmentKeys.has(key)) continue;
      segmentKeys.add(key);
      emit('hand-crossing', 'warning', tick, Math.min(endOf(left), endOf(right)), [left, right],
        `Left-hand voice ${left.voiceId} (MIDI ${left.pitch}) crosses above right-hand voice ${right.voiceId} (MIDI ${right.pitch}); confirm the register exchange is intentional.`);
    }
  }

  const byVoice = new Map<string, PianoScoreEvent[]>();
  for (const event of valid) {
    const line = byVoice.get(event.voiceId) ?? [];
    line.push(event);
    byVoice.set(event.voiceId, line);
  }
  for (const line of byVoice.values()) {
    line.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch || a.id.localeCompare(b.id));
    for (let index = 1; index < line.length; index++) {
      const previous = line[index - 1];
      const current = line[index];
      if (previous.phraseId !== current.phraseId || previous.sectionId !== current.sectionId) continue;
      const leap = Math.abs(current.pitch - previous.pitch);
      const bandChange = Math.abs(registerBand(current.pitch) - registerBand(previous.pitch));
      if (leap > 12) {
        emit('voice-leap', leap > 24 ? 'violation' : 'warning', current.startTick, endOf(current), [previous, current],
          `Voice ${current.voiceId} moves ${leap} semitones from MIDI ${previous.pitch} to ${current.pitch} within one phrase.`);
      }
      if (bandChange >= 2) {
        emit('voice-register-discontinuity', 'warning', current.startTick, endOf(current), [previous, current],
          `Voice ${current.voiceId} changes register band by ${bandChange} steps (${previous.pitch} → ${current.pitch}) within one phrase.`);
      }
    }
  }

  // A sustained note may ring while a voice moves, but a large same-hand
  // displacement under that sustain is a potential reach conflict.
  for (const sustained of valid) {
    for (const moving of valid) {
      if (sustained.id === moving.id || sustained.hand !== moving.hand
        || moving.startTick <= sustained.startTick || moving.startTick >= endOf(sustained)) continue;
      const leap = Math.abs(moving.pitch - sustained.pitch);
      if (leap <= 12) continue;
      emit('sustain-movement-conflict', leap > 19 ? 'violation' : 'warning', moving.startTick,
        Math.min(endOf(sustained), endOf(moving)), [sustained, moving],
        `The ${sustained.voiceId} sustain at MIDI ${sustained.pitch} remains active while ${moving.voiceId} moves ${leap} semitones in the same hand.`, moving.hand);
    }
  }

  // Attack density is measured per hand and supplied project bar, not against
  // a presumed style. Dense ostinato/figuration can be explicitly annotated.
  const attacksByBar = new Map<string, PianoScoreEvent[]>();
  for (const event of valid) {
    const bar = Math.floor(event.startTick / barTicks);
    const key = `${event.hand}:${bar}`;
    const entries = attacksByBar.get(key) ?? [];
    entries.push(event);
    attacksByBar.set(key, entries);
  }
  for (const [key, events] of attacksByBar) {
    if (events.length <= maxAttacks) continue;
    const [hand, barText] = key.split(':') as [PianoHand, string];
    const tick = Number(barText) * barTicks;
    emit('suspicious-density', events.length > maxAttacks * 2 ? 'violation' : 'warning', tick, tick + barTicks, events,
      `${hand} hand has ${events.length} attacks in one ${barTicks}-tick bar; review whether the density is intentional.`, hand);
  }

  findings.sort((a, b) => a.tick - b.tick || a.code.localeCompare(b.code)
    || a.eventIds.join(',').localeCompare(b.eventIds.join(',')));
  const frozen = Object.freeze(findings);
  return Object.freeze({
    warnings: Object.freeze(findings.filter((finding) => finding.severity === 'warning')),
    violations: Object.freeze(findings.filter((finding) => finding.severity === 'violation')),
    findings: frozen,
  });
}
