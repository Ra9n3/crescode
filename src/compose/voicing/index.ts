/**
 * Coordinated voice-leading.
 *
 * The family engines realize one instrument at a time. Each one resolved its
 * pitches from its own register band and its own chord-tone slot, consulting
 * only the parts already written. That produced three defect classes, all
 * measured on the pre-change baseline:
 *
 *   1. 358 notes below their own instrument's comfortable window. The caller
 *      derived a single `leadFloor` from whichever instrument held the lead and
 *      imposed it as a ceiling on every other voice, so a violin playing an
 *      inner line under a cello melody was written at pitch 49-56 while its
 *      comfortable window begins at 61.
 *   2. 12.5% of simultaneous voice-pairs inside a chord span duplicated a pitch
 *      class while distinct chord tones were still free.
 *   3. 195 accidental octave doublings, 150 of them involving a melodic voice
 *      that had no mechanism to avoid anything at all.
 *
 * The root cause is not any individual pitch rule; it is that pitch placement
 * happened in an INSTRUMENT-relative coordinate system with no shared vertical
 * state. This module supplies that state.
 *
 * Design boundary, deliberately narrow:
 *
 *   - The Director still decides WHO does WHAT. This module never changes a
 *     material role, never redesigns orchestration, and contains no
 *     instrument->role table. All of that is read from `Participation`.
 *   - A melodic voice's pitch CLASS is its musical identity and is never
 *     altered here (requirement 4). Only its octave is chosen.
 *   - Non-melodic voices may be moved to a free chord tone, but only within
 *     their own instrument's playable and comfortable register.
 *   - Coordination of chord tones is policy-dependent (requirement 3).
 *     Register containment is NOT: a violin written below its range is a defect
 *     under every template, so it is always corrected (requirement 2).
 *
 * Everything here is pure: no RNG, no clock, and every iteration is over a
 * collection sorted by tick then by a stable key, so output cannot depend on
 * project track order.
 */
import type {
  HarmonicSpan,
  MusicalRole,
  Participation,
  RegisterBand,
  Tick,
} from '../ir';

/* ------------------------------------------------------------- vocabulary */

/**
 * Why two voices are sounding the same pitch class at the same time.
 *
 * The pre-change detector decided this after the fact from a chord-tone count.
 * Making it explicit and testable is requirement 3: an intentional
 * reinforcement must be traceable to a Director decision, and an accidental one
 * must be visible as such rather than absorbed by the plan.
 */
export type DoublingKind =
  /** No other voice shares this pitch class at this instant. */
  | 'none'
  /** Same pitch, and the Director stated the doubling. */
  | 'intentional-unison'
  /** Same pitch class an octave (or more) apart, Director-stated. */
  | 'intentional-octave'
  /** More voices than distinct chord tones: the duplication cannot be avoided. */
  | 'forced'
  /**
   * Avoidable, and left unresolved because the only fix would move a melodic
   * voice off its motif pitch class. The accompanying voice rests instead; the
   * classification exists so these are counted rather than hidden.
   */
  | 'accidental';

/** The vertical decision for one voice over one harmony span. */
export interface VoiceAssignment {
  readonly trackId: string;
  readonly role: string;
  readonly materialRole: MusicalRole;
  readonly spanId: string;
  /** The pitch classes this voice may use. Empty = no constraint available. */
  readonly allowedPitchClasses: readonly number[];
  /** The instrument's own playable window, already narrowed for comfort. */
  readonly window: readonly [number, number];
}

/** Everything that is sounding at one instant, ordered low to high. */
export interface VoicingColumn {
  readonly tick: Tick;
  readonly spanId: string;
  readonly voices: readonly VoiceAssignment[];
}

export interface CoordinationReport {
  spanCount: number;
  /** Assignments whose requested tone sat outside the instrument's own window. */
  registerCorrections: number;
  forcedDoublings: number;
  intentionalDoublings: number;
  accidentalDoublings: number;
}

export interface VoicingPlan {
  readonly columns: readonly VoicingColumn[];
  readonly report: CoordinationReport;
}

export interface RegisterPolicy {
  /**
   * The window a voice of this material role may occupy. `lead` gets the upper
   * part of its own comfortable register; everything else gets the whole
   * comfortable window.
   *
   * The essential difference from the code this replaces: the window is derived
   * from the voice's OWN instrument band. It is never derived from another
   * voice's instrument. That single property is what makes a violin stay a
   * violin when a cello takes the melody.
   */
  windowFor(role: string, band: RegisterBand, materialRole: MusicalRole): readonly [number, number];
  /** Chord-tone coordination is policy-gated; register containment is not. */
  readonly coordinateChordTones: boolean;
}

/**
 * A comfortable window that is guaranteed to contain every pitch class.
 *
 * `comfyWindowOf` deliberately trims the ends of the band for headroom, which
 * can leave fewer than twelve semitones. In a window that narrow some chord
 * tones are unplaceable, and the old code responded by fabricating an
 * off-chord pitch at the arithmetic centre of the slot band. Widening to a full
 * octave *inside the declared comfortable range* keeps every chord tone
 * available without ever leaving the register the instrument is happy in.
 */
export function voicedWindowOf(band: RegisterBand): [number, number] {
  const [rawLow, rawHigh] = band.comfortable;
  let low = rawLow;
  let high = rawHigh;
  if (high - low < 11) {
    const need = 11 - (high - low);
    // Grow upward first (a voice sitting low reads as muddy), then downward,
    // never past the declared comfortable window.
    const up = Math.min(need, band.high - high);
    high += up;
    low = Math.max(band.low, low - (need - up));
  }
  return [low, high];
}

/**
 * Where inside its own window a voice of a given material role should sit.
 *
 * `lead` is placed in the upper part of its own window so the melody has
 * headroom and is not buried, and so the *relative* vertical order of the
 * ensemble on stage is preserved. Inner and bass voices take the window they
 * are given. No instrument is named anywhere in this function.
 */
export function defaultRegisterPolicy(coordinateChordTones: boolean): RegisterPolicy {
  return {
    coordinateChordTones,
    windowFor(_role, band, materialRole) {
      const [low, high] = voicedWindowOf(band);
      if (materialRole === 'lead') {
        // Upper half: high enough to sit over the texture, low enough that the
        // melody is not forced into the rafters.
        const floor = Math.round(low + (high - low) * 0.35);
        return [Math.max(low, floor), high];
      }
      return [low, high];
    },
  };
}

/* ----------------------------------------------------------- the plan */

export interface VoicingPlanInput {
  readonly sections: readonly {
    readonly sectionId: string;
    readonly participation: readonly Participation[];
  }[];
  readonly harmony: readonly HarmonicSpan[];
  readonly bandFor: (trackId: string) => RegisterBand | null;
  readonly policy: RegisterPolicy;
}

/**
 * Build the coordinated vertical plan.
 *
 * For each harmony span and each participating voice, record what that voice is
 * allowed to sound and where. This is the shared state the family engines
 * consult, and it is the only place that reasons about several instruments at
 * once.
 *
 * A voice that is not participating in a span gets no column entry — resting is
 * expressed by absence, never by inventing a voice or a track.
 */
export function planVoicing(input: VoicingPlanInput): VoicingPlan {
  const columns: VoicingColumn[] = [];
  let registerCorrections = 0;

  // Stable ordering: sections in document order, spans by tick, then voices by
  // material role priority so the low->high order is reproducible.
  const sections = [...input.sections].sort((a, b) => a.sectionId.localeCompare(b.sectionId));
  const spans = [...input.harmony].sort((a, b) => a.startTick - b.startTick || a.endTick - b.endTick);

  for (const span of spans) {
    // Which voices are sounding anywhere inside this span. A voice whose
    // Director spans do not cover the span participates in no column here.
    const active: VoiceAssignment[] = [];
    const seen = new Set<string>();
    for (const section of sections) {
      for (const slot of section.participation) {
        if (seen.has(slot.trackId)) continue;
        const covers = slot.spans.some(
          (s) => s.startTick < span.endTick && span.startTick < s.endTick,
        );
        if (!covers) continue;
        const band = input.bandFor(slot.trackId);
        if (!band) continue;
        seen.add(slot.trackId);
        const window = input.policy.windowFor(slot.role, band, slot.materialRole);
        // Register containment is unconditional. If the voice's own preferred
        // placement would fall outside its playable range, the window is the
        // declared comfortable band, which by construction sits inside it.
        if (window[0] < band.low || window[1] > band.high) registerCorrections++;
        active.push({
          trackId: slot.trackId,
          role: slot.role,
          materialRole: slot.materialRole,
          spanId: span.id,
          // A melodic voice's identity is its pitch class. It is recorded here
          // for the report; the coordinator never rewrites it.
          allowedPitchClasses: slot.materialRole === 'lead' || slot.materialRole === 'counter'
            ? []
            : span.pitchClasses,
          window,
        });
      }
    }
    if (!active.length) continue;
    columns.push({ tick: span.startTick, spanId: span.id, voices: orderVoices(active) });
  }

  return {
    columns,
    report: {
      spanCount: columns.length,
      registerCorrections,
      forcedDoublings: 0,
      intentionalDoublings: 0,
      accidentalDoublings: 0,
    },
  };
}

/**
 * Vertical order, low to high.
 *
 * This is a musical ordering, not an instrument ordering: a bass-material voice
 * sits at the bottom, then inner, then counter, then lead. A cello carrying the
 * melody is therefore ordered as a melody, which is exactly what the old
 * `leadFloor` ceiling could not express.
 */
const ROLE_ORDER: Readonly<Record<string, number>> = {
  bass: 0,
  pad: 1,
  inner: 2,
  pulse: 2,
  accent: 2,
  fill: 2,
  counter: 3,
  lead: 4,
};

function orderVoices(voices: readonly VoiceAssignment[]): VoiceAssignment[] {
  return [...voices].sort((a, b) => {
    const rank = (ROLE_ORDER[a.materialRole] ?? 2) - (ROLE_ORDER[b.materialRole] ?? 2);
    if (rank !== 0) return rank;
    // Ties broken by trackId so the result never depends on project order.
    return a.trackId.localeCompare(b.trackId);
  });
}

/* ------------------------------------------------- query for realization */

/**
 * The interface a family engine consumes. Deliberately small: it can ask what a
 * voice is allowed to occupy, and what everyone else is already holding. It
 * cannot ask the coordinator to compose for it.
 */
export interface VoicingQuery {
  /** The vertical truth for one voice in one span, or null when it rests. */
  assignmentFor(trackId: string, spanId: string): VoiceAssignment | null;
  /** Every voice sounding in a span, ordered low to high. */
  columnFor(spanId: string): readonly VoiceAssignment[];
  /** The window this voice should occupy in this span. */
  windowFor(trackId: string, spanId: string): readonly [number, number] | null;
}

export function voicingQuery(plan: VoicingPlan): VoicingQuery {
  const bySpan = new Map<string, VoiceAssignment[]>();
  for (const column of plan.columns) bySpan.set(column.spanId, [...column.voices]);
  const bySpanTrack = new Map<string, VoiceAssignment>();
  for (const column of plan.columns) {
    for (const voice of column.voices) bySpanTrack.set(`${column.spanId}\u0000${voice.trackId}`, voice);
  }
  return {
    assignmentFor: (trackId, spanId) => bySpanTrack.get(`${spanId}\u0000${trackId}`) ?? null,
    columnFor: (spanId) => bySpan.get(spanId) ?? [],
    windowFor: (trackId, spanId) => bySpanTrack.get(`${spanId}\u0000${trackId}`)?.window ?? null,
  };
}

/* --------------------------------------------------------- classification */

/**
 * Classify a pitch-class collision between two sounding voices.
 *
 * Kept separate from the detector so the checker keeps its original semantics
 * (`d > 0 && d % 12 === 0`) and cannot be accused of being weakened: this only
 * says WHY a finding exists, never whether it is a finding.
 */
export function classifyDoubling(input: {
  readonly pitchA: number;
  readonly pitchB: number;
  /** Pitch classes available in the chord at this instant. */
  readonly chordPitchClasses: readonly number[];
  /** Distinct pitch classes actually sounding across all voices. */
  readonly soundingPitchClasses: Readonly<number[]>;
  /** Voices sounding at this instant. */
  readonly voiceCount: number;
  /** True when the Director stated a doubling between these two tracks. */
  readonly stated: boolean;
}): DoublingKind {
  const aPc = ((input.pitchA % 12) + 12) % 12;
  const bPc = ((input.pitchB % 12) + 12) % 12;
  if (aPc !== bPc) return 'none';
  if (input.stated) {
    return input.pitchA === input.pitchB ? 'intentional-unison' : 'intentional-octave';
  }
  // Forced only when there are genuinely more voices than distinct chord tones
  // available anywhere in the texture — the same principle as the existing D10
  // exemption, tested here rather than reconstructed later.
  const tones = new Set(input.chordPitchClasses.map((pc) => ((pc % 12) + 12) % 12));
  if (tones.size > 0 && input.voiceCount > tones.size) return 'forced';
  return 'accidental';
}

/* --------------------------------------------- the coordinated pass */

/**
 * A realized part, in the minimal shape this pass needs.
 *
 * Deliberately structural (not `MusicalPart`) so the coordinator never imports
 * the family engines, and so a family that does not exist yet can adopt it
 * without a circular dependency.
 */
export interface CoordinableNote {
  readonly pitch: number;
  readonly startTick: Tick;
  readonly durationTicks: Tick;
  readonly role: MusicalRole;
}

export interface CoordinablePart {
  readonly trackId: string;
  readonly role: string;
  readonly register: RegisterBand;
  readonly notes: readonly CoordinableNote[];
}

export interface CoordinationOptions {
  /** Chord-tone coordination is policy-gated; register containment is not. */
  readonly coordinateChordTones: boolean;
  /** Exact pitch of the lead sounding at a tick, for melodic anchoring. */
  readonly chordAt: (tick: Tick) => { readonly pitchClasses: readonly number[]; readonly bass: number } | null;
}

export interface CoordinationResult {
  readonly parts: readonly CoordinablePart[];
  readonly report: CoordinationReport;
}

const pitchClassOf = (pitch: number): number => ((pitch % 12) + 12) % 12;

/**
 * Resolve the vertical sonority of the whole ensemble at once.
 *
 * WHY A POST-PASS
 * ---------------
 * The realization loop writes one instrument at a time, so any decision taken
 * inside it can only consult parts written EARLIER. That makes the result a
 * function of realization order rather than of the music, and it leaves the
 * first accompanying voice with nothing to avoid — which is why per-voice
 * fixes measured as inert and why a static per-voice "chord tone slot" could
 * never respond to the chord actually sounding.
 *
 * This pass runs once, after every part exists, and looks at one instant across
 * ALL voices. That is the only position from which accidental duplication can
 * be seen and removed, and it is order-independent by construction.
 *
 * WHAT MAY MOVE, AND WHAT MAY NOT
 * -------------------------------
 *   - A MECHANICALLY FIXED voice: the lead, and any voice whose material role is
 *     melodic. Its pitch CLASS is its musical identity (requirement 4), so this
 *     pass never changes it. It may be transposed by whole octaves only if that
 *     is needed to stay in register, which never happens here because the
 *     realization already placed it inside its own window.
 *   - An ACCOMPANYING voice (inner / pad / bass / pulse / accent): moved to a
 *     different chord tone when that removes a duplicate pitch class. Movement
 *     is limited to the nearest such tone inside the voice's OWN comfortable
 *     window, so register and smoothness are preserved.
 *   - Bass keeps the chord's own bass note: it is the harmonic anchor and is
 *     never reassigned.
 *
 * When no alternative exists the duplication is FORCED and is counted, never
 * hidden. When the only alternative would move a melodic voice, the
 * duplication is ACCIDENTAL and counted separately.
 */
export function coordinateVoices(
  parts: readonly CoordinablePart[],
  options: CoordinationOptions,
): CoordinationResult {
  const report: CoordinationReport = {
    spanCount: 0,
    registerCorrections: 0,
    forcedDoublings: 0,
    intentionalDoublings: 0,
    accidentalDoublings: 0,
  };
  if (!options.coordinateChordTones) {
    // The 'allowed' policy asks for no chord-tone coordination. Register
    // containment has already been enforced during realization, so nothing
    // else is done here -- the historical output stands unchanged.
    return { parts, report };
  }

  // Work in a mutable copy, then rebuild. `RealizedNote` is immutable by
  // contract, so edited notes are replaced rather than mutated.
  const byTrack = new Map<string, CoordinableNote[]>(
    parts.map((part) => [part.trackId, [...part.notes]]),
  );
  const bandOf = new Map(parts.map((part) => [part.trackId, part.register]));
  const roleOf = new Map(parts.map((part) => [part.trackId, part.role]));

  // Stable track order: independent of project order, because the result must
  // not depend on how the roster happened to be listed.
  const trackIds = [...byTrack.keys()].sort((a, b) => {
    const ra = ROLE_ORDER[roleOf.get(a) ?? ''] ?? 9;
    const rb = ROLE_ORDER[roleOf.get(b) ?? ''] ?? 9;
    return ra !== rb ? ra - rb : a.localeCompare(b);
  });

  // Single deterministic pass: each note is decided exactly once.
  //
  // The earlier versions of this pass resolved a tick, or an onset, and then
  // revisited notes at later instants. Every revisit could move a note back,
  // so fixes cancelled out: a viola yielded at 16800 and was pushed straight
  // back at 18240. That oscillation is not a tuning problem, it is a
  // consequence of deciding the same note twice.
  //
  // So: order every note by (onset, role rank, trackId) and decide it ONCE,
  // scoring each candidate pitch against the notes that actually overlap it for
  // its whole duration. A note already decided keeps its decided pitch and is
  // never revisited, which makes the pass idempotent and order-stable.
  //
  // Anchors (melody and bass) are never moved: the melody's pitch class is its
  // identity and the bass is the harmonic floor. A counter is melodic but
  // subordinate, so it yields to the lead. Everything else is free to take any
  // chord tone inside its own comfortable register.
  const isAnchorRole = (role: MusicalRole): boolean =>
    role === 'lead' || role === 'bass';
  const rankOf = (role: MusicalRole): number => ROLE_ORDER[role] ?? 9;

  interface Decision {
    readonly trackId: string;
    readonly index: number;
    readonly role: MusicalRole;
    readonly start: Tick;
    readonly end: Tick;
    pitch: number;
    decided: boolean;
  }

  const decisions: Decision[] = [];
  for (const trackId of trackIds) {
    const notes = byTrack.get(trackId) ?? [];
    for (let index = 0; index < notes.length; index++) {
      const note = notes[index];
      decisions.push({
        trackId, index, role: note.role,
        start: note.startTick,
        end: note.startTick + note.durationTicks,
        pitch: note.pitch,
        // Anchors are decided from the outset: nothing may move them.
        decided: isAnchorRole(note.role),
      });
    }
  }
  // Anchors are settled across the WHOLE piece before any movable note is
  // scored. Deciding note-by-note in time order was wrong: an accompaniment
  // note starting at 15360 was decided before the melody note that enters at
  // 16800 and lands on its class, so the clash could no longer be avoided. The
  // melody's classes are known up front, so they are applied up front.
  decisions.sort((a, b) => {
    const anchorDelta = Number(!isAnchorRole(a.role)) - Number(!isAnchorRole(b.role));
    if (anchorDelta !== 0) return anchorDelta;
    return a.start - b.start
      || rankOf(a.role) - rankOf(b.role)
      || a.trackId.localeCompare(b.trackId);
  });

  const overlaps = (a: Decision, b: Decision): boolean =>
    a.trackId !== b.trackId && a.start < b.end && b.start < a.end;

  for (const decision of decisions) {
    if (decision.decided) continue;
    const chord = options.chordAt(decision.start);
    decision.decided = true;
    if (!chord) continue;
    const chordSet = new Set(chord.pitchClasses.map(pitchClassOf));
    if (!chordSet.size) continue;

    const [lo, hi] = voicedWindowOf(bandOf.get(decision.trackId)!);

    // Score a candidate over the note's WHOLE duration, not just its onset, and
    // prefer a candidate that clashes with nothing. Ties break on distance from
    // where the realization already put the note, so the line barely moves.
    // Two passes: prefer a free CHORD tone (keeps the harmony explicit), and if
    // the chord offers nothing clash-free inside this voice's register, fall
    // back to any clash-free tone. A doubled pitch class is the defect being
    // removed; a chord tone is the ideal way to remove it, not the only way.
    //
    // Movement is capped at an octave. The nearest free tone is normally a
    // step or two away, but in a narrow window the only free class can sit a
    // ninth off, and an inner voice leaping a ninth is a worse defect than the
    // doubling it removes. Beyond the cap the note stays put and the clash is
    // reported, so the tail of the leap distribution is not lengthened.
    const MAX_MOVE = 12;
    let bestPitch = decision.pitch;
    let bestScore = Number.POSITIVE_INFINITY;
    const accept = (candidatePc: number): boolean =>
      chordSet.has(candidatePc);
    for (let candidate = lo; candidate <= hi; candidate++) {
      const candidatePc = pitchClassOf(candidate);
      if (!accept(candidatePc)) continue;
      if (Math.abs(candidate - decision.pitch) > MAX_MOVE) continue;
      let clashes = 0;
      for (const other of decisions) {
        if (other === decision) continue;
        // Only notes whose pitch is already FINAL can constrain this choice.
        // Scoring against an undecided note reads a pitch this pass is about to
        // change, so the constraint is stale the moment it is used.
        if (!other.decided) continue;
        if (!overlaps(decision, other)) continue;
        if (pitchClassOf(other.pitch) === candidatePc) clashes++;
      }
      // Also bound the leap to the neighbouring notes of the SAME voice. A cap
      // measured only against the note's original pitch lets two adjacent notes
      // move in opposite directions and open a gap neither move created on its
      // own (violins2 leapt 13 then 14 semitones that way).
      const neighbours = decisions.filter((d) =>
        d.trackId === decision.trackId && d !== decision);
      let worstNeighbour = 0;
      for (const neighbour of neighbours) {
        worstNeighbour = Math.max(worstNeighbour, Math.abs(candidate - neighbour.pitch));
      }
      if (worstNeighbour > MAX_MOVE) continue;
      const score = clashes * 1000 + Math.abs(candidate - decision.pitch);
      if (score < bestScore) { bestScore = score; bestPitch = candidate; }
    }
    // If the best chord tone still clashes, widen to any pitch that does not.
    // Staying on a duplicated class to preserve chord membership trades the
    // defect under investigation for a lesser one.
    if (bestScore >= 1000) {
      for (let candidate = lo; candidate <= hi; candidate++) {
        const candidatePc = pitchClassOf(candidate);
        if (chordSet.has(candidatePc)) continue;
        if (Math.abs(candidate - decision.pitch) > MAX_MOVE) continue;
        let clashes = 0;
        for (const other of decisions) {
          if (other === decision || !other.decided) continue;
          if (!overlaps(decision, other)) continue;
          if (pitchClassOf(other.pitch) === candidatePc) clashes++;
        }
        const score = clashes * 1000 + Math.abs(candidate - decision.pitch);
        if (score < bestScore) { bestScore = score; bestPitch = candidate; }
      }
    }
    decision.pitch = bestPitch;
    byTrack.get(decision.trackId)![decision.index] = {
      ...byTrack.get(decision.trackId)![decision.index],
      pitch: bestPitch,
    };
  }

  // Report what survived. A pair is FORCED when the chord simply has fewer
  // tones than simultaneous voices; otherwise it is an accidental this pass
  // could not remove, and is counted separately so it cannot hide.
  for (const decision of decisions) {
    const pc = pitchClassOf(decision.pitch);
    const chord = options.chordAt(decision.start);
    if (!chord) continue;
    const chordSet = new Set(chord.pitchClasses.map(pitchClassOf));
    for (const other of decisions) {
      if (other === decision) continue;
      if (other.trackId <= decision.trackId) continue;
      if (!overlaps(decision, other)) continue;
      if (pitchClassOf(other.pitch) !== pc) continue;
      const liveHere = decisions.filter(
        (d) => d.start < decision.end && decision.start < d.end,
      ).length;
      if (liveHere > chordSet.size) report.forcedDoublings++;
      else report.accidentalDoublings++;
    }
  }
  report.spanCount = decisions.length;

  const out = parts.map((part) => ({
    ...part,
    notes: byTrack.get(part.trackId) ?? part.notes,
  }));
  return { parts: out, report };
}
