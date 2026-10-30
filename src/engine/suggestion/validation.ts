/**
 * Validation rules for the suggestion contracts. Never throws — every rule
 * returns { ok: true } | { ok: false, error: SuggestionError }; the adapter
 * turns failures into thrown SuggestionErrors at its write boundaries.
 *
 * Covered per the spec: invalid MIDI notes, invalid chord names, overlapping
 * clips, zero-length gaps — plus the transaction-lifecycle guards the
 * ChordTrackAPI write contract leans on.
 */
import { parseChord } from '../../shared/schema';
import {
  isChordExtension, isChordQuality, isPitchClass,
  type Chord, type Pitch, type Suggestion, type SuggestionColorCategory,
  type SuggestionError, type SuggestionValidation, type UndoTransaction,
  SUGGESTION_COLOR_CATEGORIES, SuggestionError as SuggestionErrorCtor,
} from './types';
import { pcOfNoteName } from './model';

const OK: SuggestionValidation = { ok: true };
const fail = (code: SuggestionError['code'], message: string): SuggestionValidation => ({
  ok: false, error: new SuggestionErrorCtor(code, message),
});
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** Rule: invalid MIDI notes — every Pitch field must agree with the others. */
export function validatePitch(p: Pitch): SuggestionValidation {
  if (!isInt(p.midi) || p.midi < 0 || p.midi > 127) {
    return fail('invalid-midi-note', `midi must be an integer 0–127 (got ${p.midi})`);
  }
  if (!isPitchClass(p.pitchClass) || p.pitchClass !== (((p.midi % 12) + 12) % 12)) {
    return fail('invalid-midi-note', `pitchClass ${p.pitchClass} does not match midi ${p.midi}`);
  }
  const spelled = pcOfNoteName(p.spelling);
  if (spelled === null || spelled !== p.pitchClass) {
    return fail('invalid-midi-note', `spelling "${p.spelling}" does not resolve to pitch class ${p.pitchClass}`);
  }
  if (p.octave !== Math.floor(p.midi / 12) - 1) {
    return fail('invalid-midi-note', `octave ${p.octave} does not match midi ${p.midi}`);
  }
  if (!isInt(p.velocity) || p.velocity < 1 || p.velocity > 127) {
    return fail('invalid-midi-note', `velocity must be 1–127 (got ${p.velocity})`);
  }
  if (!isInt(p.startTick) || p.startTick < 0) {
    return fail('invalid-midi-note', 'startTick must be an integer ≥ 0');
  }
  if (!isInt(p.durationTicks) || p.durationTicks < 1) {
    return fail('invalid-midi-note', 'durationTicks must be an integer ≥ 1');
  }
  return OK;
}

/** Rule: invalid chord names — the shared parser is the single grammar. */
export function validateChordName(symbol: string): SuggestionValidation {
  const r = parseChord(symbol);
  if (!r.ok) return fail('invalid-chord-name', r.error);
  return OK;
}

/** Rule: a constructed Chord must be internally consistent. */
export function validateChord(c: Chord): SuggestionValidation {
  if (!isPitchClass(c.rootPc)) {
    return fail('invalid-chord-name', `rootPc must be 0–11 (got ${c.rootPc})`);
  }
  if (!isChordQuality(c.quality)) {
    return fail('invalid-chord-name', `unknown quality "${String(c.quality)}"`);
  }
  if (c.extensions.includes('none') && c.extensions.length > 1) {
    return fail('invalid-chord-name', "'none' must appear alone in extensions");
  }
  for (const e of c.extensions) {
    if (!isChordExtension(e)) return fail('invalid-chord-name', `unknown extension "${String(e)}"`);
  }
  if (typeof c.confidence !== 'number' || !(c.confidence >= 0 && c.confidence <= 1)) {
    return fail('invalid-chord-name', `confidence must be 0–1 (got ${c.confidence})`);
  }
  for (const pc of c.sourcePitchClasses) {
    if (!isPitchClass(pc)) return fail('invalid-midi-note', `sourcePitchClasses entry ${String(pc)} is not a pitch class`);
  }
  return OK;
}

/** Rule: overlapping clips — half-open [startTime, startTime+lengthTicks)
 *  spans; clips that merely touch at an edge are NOT overlapping. */
export function validateNoClipOverlap(
  clips: ReadonlyArray<{ id?: string; startTime: number; lengthTicks: number }>,
): SuggestionValidation {
  for (let i = 0; i < clips.length; i++) {
    const a = clips[i];
    const aId = a.id ?? String(i);
    if (!isInt(a.startTime) || a.startTime < 0 || !isInt(a.lengthTicks) || a.lengthTicks < 1) {
      return fail('invalid-range', `clip "${aId}": bounds must be integers with lengthTicks ≥ 1`);
    }
    for (let j = i + 1; j < clips.length; j++) {
      const b = clips[j];
      const aEnd = a.startTime + a.lengthTicks;
      const bEnd = b.startTime + b.lengthTicks;
      if (a.startTime < bEnd && b.startTime < aEnd) {
        return fail('overlapping-clips', `clips "${aId}" and "${b.id ?? String(j)}" overlap ([${a.startTime}, ${aEnd}) vs [${b.startTime}, ${bEnd}))`);
      }
    }
  }
  return OK;
}

/** Rule: zero-length (or negative) gaps are invalid; "no gap" (null) is fine. */
export function validateGap(gap: { startTime: number; endTime: number } | null): SuggestionValidation {
  if (gap === null) return OK;
  if (!isInt(gap.startTime) || !isInt(gap.endTime) || gap.endTime <= gap.startTime) {
    return fail('zero-length-gap', `gap must satisfy endTime > startTime (got [${gap.startTime}, ${gap.endTime}))`);
  }
  return OK;
}

/** Rule: [startTime, endTime) query ranges must be non-empty and ordered. */
export function validateTimeRange(startTime: number, endTime: number): SuggestionValidation {
  if (!isInt(startTime) || !isInt(endTime) || startTime < 0 || endTime <= startTime) {
    return fail('invalid-range', `range must satisfy 0 ≤ startTime < endTime (got [${startTime}, ${endTime}))`);
  }
  return OK;
}

/** Rule: a suggestion carries a bounded score, a known color category and
 *  its inner chord must validate. */
export function validateSuggestion(s: Suggestion): SuggestionValidation {
  if (typeof s.score !== 'number' || !(s.score >= 0 && s.score <= 1)) {
    return fail('invalid-range', `score must be 0–1 (got ${s.score})`);
  }
  if (!SUGGESTION_COLOR_CATEGORIES.includes(s.colorCategory as SuggestionColorCategory)) {
    return fail('invalid-range', `unknown colorCategory "${String(s.colorCategory)}"`);
  }
  if (!Array.isArray(s.reasonCodes) || s.reasonCodes.some((r) => typeof r !== 'string')) {
    return fail('invalid-range', 'reasonCodes must be an array of strings');
  }
  if (typeof s.contextExplanation !== 'string' || s.contextExplanation.length === 0) {
    return fail('invalid-range', 'contextExplanation must be a non-empty string');
  }
  return validateChord(s.chord);
}

// --- Transaction lifecycle guards (the ChordTrackAPI write contract) ---

/** Every mutation must run inside an open transaction. */
export function assertInTransaction(tx: UndoTransaction | null, op: string): void {
  if (tx === null) {
    throw new SuggestionErrorCtor('no-transaction', `"${op}" requires an open undo transaction — call beginUndoTransaction first`);
  }
}
/** Transactions are not nestable. */
export function assertNoOpenTransaction(tx: UndoTransaction | null): void {
  if (tx !== null) {
    throw new SuggestionErrorCtor('transaction-open', `transaction "${tx.label}" is already open — nested transactions are not supported`);
  }
}
/** commit/cancel need an open transaction. */
export function assertTransactionOpen(tx: UndoTransaction | null): UndoTransaction {
  if (tx === null) {
    throw new SuggestionErrorCtor('transaction-not-open', 'no undo transaction is open');
  }
  return tx;
}
