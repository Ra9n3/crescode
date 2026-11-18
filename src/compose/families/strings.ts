/**
 * Layer 4 — Strings family realization.
 *
 * Takes abstract material (scale degrees + rhythm) and the Director's decision
 * for the phrase's own section, and realises it idiomatically for a string
 * instrument: placed in the comfortable window, spaced for the bow, articulated
 * for the role.
 *
 * It MAY choose octave, spacing, articulation and divisi distribution.
 * It MAY NOT invent material, change phrase function, or contradict the
 * harmony — `seal.ts` checks those.
 */
import { scalePitchClasses } from '../../shared/schema/modes';
import type { Project } from '../../shared/schema/types';
import { fitDegreeToHarmony, statementDegrees, statementDurations } from '../material';
import type {
  Articulation,
  BarCell,
  DynamicIntent,
  HarmonicSpan,
  Motif,
  MotifStatement,
  MusicalPart,
  MusicalRole,
  Participation,
  Phrase,
  RealizedNote,
  RegisterBand,
  Tick,
} from '../ir';

const STRING_ROLES = new Set(['violins1', 'violins2', 'violas', 'cellosBasses', 'basses']);

export function isStringRole(role: string): boolean {
  return STRING_ROLES.has(role)
    || role.startsWith('violin') || role.startsWith('viola') || role.startsWith('cello');
}

/* --------------------------------------------------------- placement */

/** The comfortable writing window, with a margin below the hard ceiling. */
export function comfyWindowOf(band: RegisterBand): [number, number] {
  const [rawLow, rawHigh] = band.comfortable;
  const margin = Math.max(1, Math.round((rawHigh - rawLow) * 0.12));
  let low = rawLow + Math.round(margin * 0.5);
  let high = rawHigh - margin;
  // Aim for >= 12 semitones so every pitch class is reachable — but never
  // by widening PAST the comfortable window. Widening downward was putting
  // inner voices a tone or two below their comfortable register.
  if (high - low < 11) {
    const need = 11 - (high - low);
    const up = Math.min(need, band.comfortable[1] - high);
    high += up;
    low = Math.max(band.comfortable[0], low - (need - up));
  }
  return [Math.max(band.low, low), Math.min(band.high, high)];
}

/**
 * Places an exact pitch class for a voice slot.
 *
 * Searches the whole comfortable window (never a narrow sub-band: a 6-semitone
 * band cannot represent every pitch class, and falling back to the hard range
 * is what produced 12-semitone leaps). Cost = motion from the previous note,
 * plus distance from the slot's preferred centre.
 */
const EMPTY_CLASSES: ReadonlySet<number> = new Set<number>();

export function pitchForPitchClass(
  pitchClass: number,
  band: RegisterBand,
  voiceSlot: number,
  previous: number | null = null,
  /** Never placed below this pitch (family stack: lead above inner voices). */
  floor: number | null = null,
  /** Never placed above this pitch (a voice beneath the lead). */
  ceiling: number | null = null,
  /**
   * Other chord tones the caller will accept when the requested class has NO
   * representative inside the window. A hard ceiling under a low lead can leave
   * fewer than twelve semitones; the requested class may genuinely be absent.
   * The old fallback returned `target`, the arithmetic midpoint of the slot
   * band — a pitch with an essentially arbitrary class. Downstream avoidance
   * then filtered on the REQUESTED tone while the EMITTED note sang a different
   * one, so every collision test silently passed the wrong note through
   * (`tone=0` in C/E surfaced as pitch 67 = pc 7). Falling back to a real chord
   * tone keeps the note harmonically legal; the caller orders these by
   * preference.
   */
  alternatives: readonly number[] = [],
  /** Classes the caller has already ruled out; substitutes on these are worst. */
  avoided: ReadonlySet<number> = EMPTY_CLASSES,
): number {
  const pc = ((pitchClass % 12) + 12) % 12;
  const [winLow, winHigh] = comfyWindowOf(band);
  // A voice that must stay beneath the lead gets a shortened window rather
  // than an octave-dropped pitch: clamping the window keeps the voice inside
  // its comfortable register, which the post-hoc octave fold did not.
  const low = winLow;
  // The ceiling is HARD. This used to read
  // `Math.max(winLow + 11, Math.min(winHigh, ceiling))`, which silently raised
  // the ceiling back to a full octave whenever it left fewer than eleven
  // semitones — so an inner voice bounded under a lead at 68 could still be
  // placed at 72, above the lead it was supposed to sit beneath. When the
  // remaining window is shorter than an octave we keep it short and let the
  // band/nearby/anywhere fallbacks below cover the missing pitch classes.
  const high = ceiling === null ? winHigh : Math.min(winHigh, ceiling);
  const span = Math.max(1, high - low);

  // Each slot owns a horizontal band of the window, so voices STACK instead of
  // crossing. Bands overlap by a semitone so a voice is never stranded when
  // its pitch class is absent from its own band.
  const slotCount = 4;
  const bandHigh = Math.round(high - (span * voiceSlot) / slotCount);
  const bandLow = Math.round(high - (span * (voiceSlot + 1)) / slotCount) - 1;
  const target = Math.round((bandHigh + bandLow) / 2);

  const choose = (lo: number, hi: number): number | null => {
    let best: number | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let pitch = Math.max(low, lo); pitch <= Math.min(high, hi); pitch++) {
      if (((pitch % 12) + 12) % 12 !== pc) continue;
      const move = previous === null ? 0 : Math.abs(pitch - previous);
      // Candidates that respect the floor win outright; smoothness decides
      // among equals, so the melody still moves by step.
      const score = (meetsFloor(pitch) ? 0 : 1000) + move;
      if (score < bestScore) { best = pitch; bestScore = score; }
    }
    return best;
  };

  // Prefer the slot's own band; widen only if the pitch class is not there.
  // The floor is a PREFERENCE, not a clamp. Forcing octave lifts to clear it
  // produced 11-semitone leaps in the melody; instead the search prefers
  // pitches at or above the floor and only settles below it when nothing
  // suitable exists. The octave-only ceiling is a hard rule: a lower voice
  // must never rise above the lead.
  const meetsFloor = (value: number): boolean => floor === null || value >= floor;

  /** Same search as `choose`, for a pitch class supplied per call. */
  const chooseForPc = (want: number): number | null => {
    let best: number | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let pitch = low; pitch <= high; pitch++) {
      if (((pitch % 12) + 12) % 12 !== want) continue;
      const move = previous === null ? 0 : Math.abs(pitch - previous);
      const score = (meetsFloor(pitch) ? 0 : 1000) + move;
      if (score < bestScore) { best = pitch; bestScore = score; }
    }
    return best;
  };

  const inBand = choose(bandLow, bandHigh);
  if (inBand !== null) return inBand;
  const nearby = choose(bandLow - 3, bandHigh + 3);
  if (nearby !== null) return nearby;
  const anywhere = choose(low, high);
  if (anywhere !== null) return anywhere;
  // The requested class is absent from the window. Prefer a chord tone the
  // caller offered, choosing the one that lands closest to this slot's centre
  // so the choir keeps its layout, and only then give up on harmony.
  let fallback: number | null = null;
  let fallbackDistance = Number.POSITIVE_INFINITY;
  for (const alt of alternatives) {
    const altPc = ((alt % 12) + 12) % 12;
    if (altPc === pc) continue;
    const placed = chooseForPc(altPc);
    if (placed === null) continue;
    // Prefer a substitute whose class the caller did NOT already veto, otherwise
    // the fallback simply swaps one doubling for another.
    const penalty = avoided.has(altPc) ? 100 : 0;
    const distance = penalty + Math.abs(placed - target);
    if (distance < fallbackDistance) { fallback = placed; fallbackDistance = distance; }
  }
  return fallback ?? target;
}

/**
 * Melodic placement for the lead and counterline.
 *
 * A melody is not a stack: slot bands force it into a register lane and make
 * it leap. Here the voice takes the pitch of the target class NEAREST to where
 * it already is, inside the comfortable window, with the family floor as a
 * soft preference. That is what produces stepwise, singable lines.
 */
export function pitchForMelody(
  pitchClass: number,
  band: RegisterBand,
  previous: number | null,
  floor: number | null,
  ceiling: number | null,
): number {
  const pc = ((pitchClass % 12) + 12) % 12;
  const [, hardHigh] = comfyWindowOf(band);
  // Never write below the instrument's declared comfortable register. The
  // working window shaves ~2 semitones off each end for headroom, so using it
  // alone let a counterline note land at 55 — the bottom of the violin range,
  // where it sounds like a mistake rather than a line.
  const low = Math.max(comfyWindowOf(band)[0], Math.min(band.comfortable[0], hardHigh));
  const high = hardHigh;
  const legalIn = (a: number, b: number): number[] => {
    const out: number[] = [];
    for (let pitch = a; pitch <= b; pitch++) {
      if (((pitch % 12) + 12) % 12 === pc) out.push(pitch);
    }
    return out;
  };
  const nearestTo = (candidates: readonly number[], reference: number): number | null => {
    let best: number | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const pitch of candidates) {
      const distance = Math.abs(pitch - reference);
      if (distance < bestDistance) { best = pitch; bestDistance = distance; }
    }
    return best;
  };

  // The CEILING is hard: a voice told to stay under the melody must not end up
  // a fifth above it. The FLOOR is soft for a melody. A hard floor destroyed
  // inversion: a mirrored descending line [0,-1,-2,-3] had its last note
  // pushed back up to the floor, turning a one-step descent into a 9-semitone
  // jump. Register discipline matters more than contour for an inner voice and
  // less than contour for the tune, so the floor is a preference here while the
  // strongest candidate inside it still wins whenever one exists.
  const hi = ceiling !== null ? Math.min(high, ceiling) : high;
  const target = Math.round((low + high) / 2);
  const reference = previous === null ? target : previous;
  const insideHard = legalIn(low, hi);
  if (insideHard.length) {
    const inside = floor !== null
      ? insideHard.filter((pitch) => pitch >= floor)
      : insideHard;
    if (inside.length) {
      // Take the floor-respecting option unless it costs a leap the contour
      // would never make. Degree -3 in the dorian mode is pitch class A, which
      // in this window occurs only at 57, 69 and 81; with a floor of 70 the
      // only legal A is 81, so a one-step melodic descent became a 9-semitone
      // jump. When the above-floor candidate is far worse than the best legal
      // pitch, prefer the musical line.
      const aboveFloor = nearestTo(inside, reference)!;
      if (Math.abs(aboveFloor - reference) <= 4) return aboveFloor;
      // Never wander onto the instrument's hard extremes to save a leap: a
      // note pinned at the very bottom of the range sounds like a mistake.
      const safe = insideHard.filter((pitch) => pitch > band.low && pitch < band.high);
      const anyLegal = nearestTo(safe.length ? safe : insideHard, reference)!;
      return Math.abs(anyLegal - reference) < Math.abs(aboveFloor - reference)
        ? anyLegal
        : aboveFloor;
    }
    return nearestTo(insideHard, reference)!;
  }
  // Nothing legal inside the narrowed window. Widen in stages, because the
  // obvious fallback — "any pitch of this class under the ceiling" — reached
  // down to the instrument's hard floor and pushed the counterline two
  // semitones below its declared comfortable register just to name a note.
  // Prefer, in order: the declared comfortable register under the ceiling,
  // then the whole instrument under the ceiling, then anything at all.
  if (ceiling !== null) {
    const [declaredLow, declaredHigh] = band.comfortable;
    const inDeclared = legalIn(
      Math.max(band.low, declaredLow),
      Math.min(ceiling, band.high, declaredHigh),
    );
    if (inDeclared.length) {
      return nearestTo(inDeclared, previous === null ? target : previous)!;
    }
    // Still nothing. Rather than drop to the instrument floor, allow the
    // counter to sit ON the lead's pitch class at its own comfortable octave —
    // a unison at a phrase boundary is far less damaging than a note at the
    // bottom of the range.
    const belowComfort = legalIn(
      Math.max(band.low, low - 2),
      Math.min(ceiling, band.high, high),
    );
    if (belowComfort.length) {
      return nearestTo(belowComfort, previous === null ? target : previous)!;
    }
    // Last resort under the ceiling: keep the DECLARED comfortable register as
    // the hard limit even here. The old fallback searched down to the
    // instrument's floor and put the counterline at 55 — the very bottom of the
    // violin — whenever the lead descended near the counter's own register.
    // This function's own principle, stated above, is that a brief unison at a
    // phrase boundary is far less damaging than a note at the bottom of the
    // range; apply it consistently instead of violating it in the last branch.
    const underCeiling = legalIn(
      Math.max(band.low, band.comfortable[0]),
      Math.min(ceiling, band.high),
    );
    if (underCeiling.length) {
      return nearestTo(underCeiling, previous === null ? target : previous)!;
    }
  }
  const comfortable = legalIn(low, high);
  if (comfortable.length) {
    return nearestTo(comfortable, previous === null ? target : previous)!;
  }
  const anywhere = legalIn(band.low, band.high);
  if (anywhere.length) return nearestTo(anywhere, target)!;
  return target;
}

/** Places a scale degree for a voice slot. */
export function pitchForDegree(
  degree: number,
  project: Project,
  band: RegisterBand,
  voiceSlot: number,
  previous: number | null = null,
  /** Hard floor: the lead is never placed below this pitch. */
  floor: number | null = null,
  /** Hard ceiling: a voice beneath the lead never rises above this. */
  ceiling: number | null = null,
): number {
  const scale = scalePitchClasses(project.key, project.mode);
  const size = scale.length || 7;
  const pc = scale[((degree % size) + size) % size];
  return pitchForPitchClass(pc, band, voiceSlot, previous, floor, ceiling);
}

/**
 * Keeps an inner voice from shadowing the lead.
 *
 * Two mistakes are avoided here: nudging by semitone leaves the harmony, and
 * searching upward without limit let a voice escape its window (a 20-semitone
 * jump). The voice moves to the nearest OTHER chord tone, staying inside the
 * comfortable window and close to where it already was.
 */

export function avoidLeadCollision(
  pitch: number,
  chordPitchClasses: readonly number[],
  leadPitchClasses: ReadonlySet<number>,
  band: RegisterBand,
  /** The lead pitch sounding at the same instant, when there is one. */
  leadPitch: number | null = null,
  /** Hard ceiling (usually the lead's pitch minus one): never search above it. */
  ceiling: number | null = null,
  /**
   * Pitch classes already sounding from ANY other part in this span, not just
   * the lead. Guards only the lead could not prevent accompaniment-vs-
   * accompaniment doublings: the bass is written before the inner voices, so
   * an inner voice sharing the bass's pitch class is never caught by a
   * lead-only test.
   */
  occupiedPitchClasses: ReadonlySet<number> = EMPTY_CLASSES,
): number {
  const pc = ((pitch % 12) + 12) % 12;
  // `leadPitchClasses` is the whole piece's worth of lead pitch classes — a
  // union over every section. Using it as a per-moment exclusion bans almost
  // every chord tone (a diatonic lead visits 7 of 12 classes), which left the
  // search with no legal candidate and silently kept the colliding pitch. The
  // real test is the ONE lead pitch sounding at this instant; the piece-wide
  // set is only a fallback when no lead is sounding.
  const collidesByClass = (leadPitch !== null
    ? leadPitchClasses.has(pc) && ((leadPitch % 12) + 12) % 12 === pc
    : leadPitchClasses.has(pc)) || occupiedPitchClasses.has(pc);
  // A unison or an octave against the lead is doubling, not counterpoint, even
  // when the pitch classes differ on paper (e.g. D4 under D5). Reject those
  // intervals outright whenever the lead is sounding.
  const collidesByInterval = leadPitch !== null
    && Math.abs(((pitch - leadPitch) % 12 + 12) % 12) === 0;
  if (!collidesByClass && !collidesByInterval) return pitch;
  const [low, high] = comfyWindowOf(band);
  let best = pitch;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let candidate = low; candidate <= high; candidate++) {
    // Without this bound the nearest chord tone was often ABOVE the lead, so a
    // counterline tucked under a held melody jumped back over it on the nudge.
    if (ceiling !== null && candidate > ceiling) continue;
    const candidatePc = ((candidate % 12) + 12) % 12;
    if (!chordPitchClasses.includes(candidatePc)) continue;
    if (leadPitch !== null
      ? ((leadPitch % 12) + 12) % 12 === candidatePc
      : leadPitchClasses.has(candidatePc)) continue;
    if (occupiedPitchClasses.has(candidatePc)) continue;
    if (leadPitch !== null && ((candidate - leadPitch) % 12 + 12) % 12 === 0) continue;
    const distance = Math.abs(candidate - pitch);
    if (distance > 0 && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/* ----------------------------------------------------------- dynamics */

export function dynamicForPhrase(phrase: Phrase, energyAt: (bar: number) => number): DynamicIntent {
  const barCount = Math.max(1, Math.ceil((phrase.endTick - phrase.startTick) / 3840));
  const start = energyAt(phrase.startBar);
  const end = energyAt(phrase.startBar + barCount - 1);
  const peak = Math.min(1, Math.max(start, end) + 0.12);
  switch (phrase.function) {
    case 'climax': return { start: start * 0.92, peak, end: end * 0.95 };
    case 'cadence': return { start, peak: start * 0.85, end: Math.max(0.12, end * 0.55) };
    case 'antecedent': return { start: start * 0.9, peak, end: end * 0.95 };
    case 'sustain': return { start: start * 0.7, peak: start * 0.8, end: start * 0.7 };
    default: return { start, peak, end };
  }
}

/** Maps an intention-curve position (0..1) to a velocity. */
export function velocityAt(dynamic: DynamicIntent, t: number): number {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  const value = clamped <= 0.5
    ? dynamic.start + (dynamic.peak - dynamic.start) * (clamped / 0.5)
    : dynamic.peak + (dynamic.end - dynamic.peak) * ((clamped - 0.5) / 0.5);
  return Math.round(34 + Math.max(0, Math.min(1, value)) * 78);
}

/**
 * Articulation chosen for the role and the phrase — never per note.
 *
 * Restricted to what the shipped UVI orchestral profile actually provides:
 * legato, marcato, pizz, spiccato, sustain, tremolo. `detache` and `portato`
 * are legal values in the schema but are NOT in the profile's keyswitch map,
 * so writing them would silently fall back or, worse, invent a switch. The
 * documentation calls this out as the honest choice.
 */
export function articulationForRole(role: MusicalRole, phrase: Phrase): Articulation {
  if (role === 'pad') return 'legato';
  if (role === 'bass') return 'sustain';
  if (role === 'accent') return 'marcato';
  if (role === 'pulse') return 'spiccato';
  if (role === 'counter') return 'legato';
  if (phrase.function === 'climax') return 'marcato';
  if (phrase.function === 'cadence') return 'sustain';
  return 'legato';
}

/* ------------------------------------------------------- realization */

export interface StringsRealizationInput {
  readonly project: Project;
  /** The Director's decision for a given section, for this track. */
  readonly participationFor: (sectionId: string) => Participation | null;
  /** The track's register band (stable across the whole piece). */
  readonly register: RegisterBand;
  /** 0 = highest string voice; drives the choir layout. */
  readonly voiceSlot: number;
  readonly phrases: readonly Phrase[];
  readonly statements: readonly MotifStatement[];
  readonly motifs: ReadonlyMap<string, Motif>;
  readonly harmony: readonly HarmonicSpan[];
  readonly bars: readonly BarCell[];
  /** Meter grid, so strong beats can be identified without guessing. */
  readonly beatTicks: number;
  readonly energyAt: (bar: number) => number;
  /** Pitch classes another part is sounding as lead, to avoid shadowing it. */
  readonly leadPitchClasses: ReadonlySet<number>;
  /**
   * Pitch floor for this part, derived from the family stack: a voice beneath
   * the lead is kept below it, and the lead is kept above the inner voices.
   * `null` means unconstrained (a single-voice texture).
   */
  readonly stackFloor: number | null;
  /** Pitch ceiling for this part, so a lower voice cannot rise above the lead. */
  readonly stackCeiling: number | null;
  /**
   * Pitch classes already sounding from OTHER parts across a span, supplied by
   * the caller which realises them in order (lead first).
   *
   * Independent per-voice octave placement cannot prevent an octave doubling:
   * the doubling rule is defined over pitch CLASS, so two voices handed the
   * same chord tone collide however many octaves apart they sit. An
   * accompanying voice therefore consults what is already sounding and takes a
   * chord tone that is not among it. Absent (or when the doubling policy is
   * 'allowed') the historical choice stands unchanged.
   */
  readonly soundingPitchClasses?: (start: Tick, end: Tick) => ReadonlySet<number>;
  /** Which chord tone this voice prefers, as an index into `pitchClasses`. */
  readonly chordToneSlot?: number;
  /**
   * The lead's realised pitch sounding at a tick, when this part is the
   * counterline. A counter may weave around the melody but must not cross above
   * it: the stack ceiling alone is a fixed number, while the lead moves, so the
   * counter could still rise a tenth over a held lead note.
   */
  readonly leadPitchAt?: (tick: number) => number | null;
}

export function realizeStrings(input: StringsRealizationInput): MusicalPart {
  const { project, phrases, motifs, harmony, statements } = input;
  const band = input.register;
  const statementById = new Map(statements.map((statement) => [statement.id, statement]));
  const notes: RealizedNote[] = [];
  const spansBySection = new Map<string, { startTick: Tick; endTick: Tick }[]>();
  // Voice-leading state persists across phrases: resetting it per phrase made
  // inner voices leap back to the slot centre at every phrase boundary, which
  // is where the widest intervals came from.
  let previousSustained: number | null = null;
  // The melodic line also keeps its continuity across statements: the first
  // note of a new statement should continue from the last note of the
  // previous one, otherwise every statement starts with a leap.
  let previousLead: number | null = null;

  for (const phrase of phrases) {
    const participation = input.participationFor(phrase.sectionId);
    if (!participation) continue;
    spansBySection.set(phrase.sectionId, [...participation.spans] as { startTick: Tick; endTick: Tick }[]);
    if (!spansContain(participation.spans, phrase.startTick)) continue;

    const dynamic = dynamicForPhrase(phrase, input.energyAt);
    const articulation = articulationForRole(participation.materialRole, phrase);
    const phraseLength = Math.max(1, phrase.endTick - phrase.startTick);

    switch (participation.materialRole) {
      case 'lead':
      case 'counter': {
        const sourceIds = participation.materialRole === 'counter'
          ? phrase.counterStatementIds
          : phrase.statementIds;
        if (!sourceIds.length) break;
        for (const statementId of sourceIds) {
          const statement = statementById.get(statementId);
          if (!statement) continue;
          const motif = motifs.get(statement.motifId);
          if (!motif) continue;
          const degrees = statementDegrees(motif, statement, scaleLength(project));
          // Pass the beat subdivision so a 'diminish' contraction is floored at
          // one subdivision rather than degenerating into sub-tick slivers.
          const durations = statementDurations(motif, statement, Math.round(input.beatTicks / 2));
          const total = durations.reduce((sum, value) => sum + value, 0) || 1;
          let cursor = statement.startTick;
          for (let index = 0; index < degrees.length; index++) {
            const duration = durations[index] ?? 0;
            if (duration <= 0) continue;
            if (cursor + duration > phrase.endTick) break;
            const span = harmonyAt(harmony, cursor);
            // Melodic direction from the motif itself, so chord-tone fitting
            // preserves the contour instead of flattening it.
            const melodicDirection = index > 0
              ? Math.sign(degrees[index] - degrees[index - 1])
              : 0;
            // Chord-tone fitting applies on STRONG beats only. Forcing every
            // note onto a chord tone turns a melody into a chord arpeggio and
            // collapsed adjacent motif steps onto one pitch (36% of pairs).
            // A non-chord tone on a weak beat is a passing/neighbour note —
            // standard melodic practice and what keeps the motif recognisable.
            const beat = input.beatTicks;
            const positionInBeat = cursor % (beat * 2);
            const strong = positionInBeat === 0;
            const fitted = span && strong
              ? fitDegreeToHarmony(
                  project, span, degrees[index], melodicDirection,
                  index > 0 ? degrees[index - 1] : null,
                )
              : { degree: degrees[index], pitchClass: scalePitchClasses(project.key, project.mode)[((degrees[index] % (scalePitchClasses(project.key, project.mode).length || 7)) + (scalePitchClasses(project.key, project.mode).length || 7)) % (scalePitchClasses(project.key, project.mode).length || 7)] };
            // Melodic voices (lead and counter) are not stack slots: they get
            // the whole comfortable window so the line can move by step.
            // The counterline is bounded by the same stack ceiling as the inner
            // voices: it may weave around the lead but must not take the tune
            // above it. Left unbounded it rose up to 10 semitones above the
            // lead in 12 bars, which reads as a handover that never happens.
            const isLead = participation.materialRole === 'lead';
            const isCounter = participation.materialRole === 'counter';
            const leadNow = isCounter ? input.leadPitchAt?.(cursor) ?? null : null;
            // For the counterline the ceiling is the SOUNDING LEAD PITCH, not
            // the static family ceiling. Applying both squeezed the line into
            // 59-70 while its declared comfortable window starts at 61: the
            // fixed ceiling alone already guarantees no crossing.
            const ceilingFloor = isCounter ? null : input.stackCeiling;
            // Sit under the sounding lead note where one exists. A gap of one
            // semitone is enough to keep the counter beneath the melody without
            // forcing it out of its own tessitura; a wider gap pulled the line
            // down to 55 and produced a 13-semitone leap.
            const counterGap = 1;
            const perNoteCeiling = leadNow !== null ? leadNow - counterGap : null;
            const melodyCeiling = isLead
              ? input.stackCeiling
              : (perNoteCeiling !== null
                  ? (ceilingFloor !== null ? Math.min(ceilingFloor, perNoteCeiling) : perNoteCeiling)
                  : ceilingFloor);
            let pitch = pitchForMelody(
              scalePitchClasses(project.key, project.mode)[((fitted.degree % (scalePitchClasses(project.key, project.mode).length || 7)) + (scalePitchClasses(project.key, project.mode).length || 7)) % (scalePitchClasses(project.key, project.mode).length || 7)],
              band, previousLead,
              isLead ? input.stackFloor : null,
              melodyCeiling,
            );
            if (participation.materialRole === 'counter') {
              // A counterline is a melody too: place it melodically, then only
              // nudge it where a chord tone is available INSIDE the window.
              // The old nudge could leave the comfortable register entirely.
              let nudged = avoidLeadCollision(
                pitch, span?.pitchClasses ?? [], input.leadPitchClasses, band,
                null, leadNow !== null ? leadNow - 1 : null,
              );
              // Belt and braces: the collision search can still land above the
              // lead when it takes the nearest chord tone. Pull it back under.
              if (leadNow !== null && nudged >= leadNow) {
                const under = pitchForMelody(
                  ((nudged % 12) + 12) % 12,
                  band, previousLead, null, leadNow - 1,
                );
                if (under < leadNow) nudged = under;
              }
              const [winLow, winHigh] = comfyWindowOf(band);
              // Stay inside the declared comfortable register as well as the
              // working window: the counterline has no static ceiling now (the
              // sounding lead bounds it), so nothing else stops it drifting to
              // the very bottom of the instrument.
              const safeLow = Math.max(winLow, band.comfortable[0]);
              pitch = nudged >= safeLow && nudged <= winHigh ? nudged : pitch;
              // Absolute safety net. Whatever the search above concluded, a
              // counterline note must not be written below the cello end of the
              // instrument's comfortable register. Step up to the nearest
              // chord tone of the same pitch class at or above it; if that
              // class has no such pitch, take the nearest chord tone instead.
              if (pitch < safeLow) {
                // Lift, but never above the sounding lead: the crossing rule is
                // the stronger of the two. If the only way to lift is over the
                // melody, prefer staying under it and accept the low note.
                const ceilingNow = leadNow !== null ? leadNow - 1 : winHigh;
                const upper = Math.min(winHigh, ceilingNow);
                if (upper >= safeLow) {
                  const lifted = pitchForMelody(
                    ((pitch % 12) + 12) % 12, band, previousLead, safeLow, upper,
                  );
                  if (lifted >= safeLow && lifted <= upper) {
                    pitch = lifted;
                  } else {
                    const chord = (span?.pitchClasses ?? [])
                      .map((cls) => pitchForMelody(cls, band, previousLead, safeLow, upper))
                      .filter((candidate) => candidate >= safeLow && candidate <= upper);
                    if (chord.length) {
                      const ref = previousLead ?? safeLow;
                      pitch = chord.reduce(
                        (best, candidate) =>
                          Math.abs(candidate - ref) < Math.abs(best - ref) ? candidate : best,
                        chord[0],
                      );
                    }
                  }
                }
              }
            }
            previousLead = pitch;
            notes.push({
              pitch,
              startTick: cursor,
              durationTicks: Math.max(1, duration),
              velocity: velocityAt(dynamic, (cursor - phrase.startTick) / total),
              articulation,
              role: participation.materialRole,
              phraseId: phrase.id,
              statementId: statement.id,
            });
            cursor += duration;
          }
          // Phrase-final note is held to the phrase end when only a short gap
          // remains. Holding the last note is idiomatic string phrasing; a
          // two-beat silence before the phrase boundary is not a rest, it is
          // an unfinished phrase.
          const last = notes[notes.length - 1];
          if (last && last.phraseId === phrase.id) {
            const gap = phrase.endTick - (last.startTick + last.durationTicks);
            const oneBar = 3840;
            if (gap > 0 && gap <= oneBar) {
              notes[notes.length - 1] = { ...last, durationTicks: last.durationTicks + gap };
            }
          }
        }
        break;
      }
      case 'bass':
      case 'pad':
      case 'inner':
      case 'pulse':
      case 'accent':
      default: {
        // Sustained chord writing: one note per harmony span, held so the
        // harmony is audible rather than implied.
        // Coordinated assignment: the slot is chosen by the caller so no two
        // accompanying voices take the same chord tone. Falling back to the
        // historical constants keeps this a pure refinement when unset.
        const voiceOffset = input.chordToneSlot
          ?? (participation.materialRole === 'inner' ? 1 : 0);
        for (const span of harmony) {
          const start = Math.max(span.startTick, phrase.startTick);
          const end = Math.min(span.endTick, phrase.endTick);
          if (end <= start) continue;
          if (!spansContain(participation.spans, start)) continue;
          // Preferred tone: the chord's own bass for a bass voice, otherwise
          // the voice's slot in the chord.
          const spanTones = span.pitchClasses.length ? span.pitchClasses : [span.root];
          const slotTone = spanTones[voiceOffset % Math.max(1, spanTones.length)] ?? span.root;
          const accompaniment = participation.materialRole === 'bass'
            || participation.materialRole === 'inner';
          const sounding = accompaniment
            ? input.soundingPitchClasses?.(start, end)
            : undefined;
          // Take the first chord tone that is not already sounding from another
          // part. Preference order keeps the musical primacy of the voice: a
          // bass still tries its own bass note first, an inner voice its slot.
          // When every chord tone is already sounding (more voices than
          // distinct tones) the preferred tone stands — that doubling is forced
          // by the chord, not chosen, and is exempt from the rule.
          const toneOrder = participation.materialRole === 'bass'
            ? [span.bass, ...spanTones]
            : [...spanTones.slice(voiceOffset % Math.max(1, spanTones.length)), ...spanTones];
          const tone = sounding && sounding.size
            ? (toneOrder.find((candidate) => !sounding.has(((candidate % 12) + 12) % 12)) ?? slotTone)
            : (participation.materialRole === 'bass' ? span.bass : slotTone);
          // Place the chord tone by PITCH CLASS, not via a scale degree: a
          // chord tone outside the scale (a borrowed tone) must still sound
          // as itself. Going through `degreeForPitchClass` silently snapped
          // every such tone to the tonic, which is how inner voices ended up
          // 0-for-18 on chord membership.
          // Bound an inner voice by the SOUNDING lead pitch, not only by the
          // static family ceiling: with a static ceiling of leadFloor-1 an
          // inner voice still crossed a melody that had descended (dorian
          // violins2 held 72 under a lead at 64-67 in bars 6-8).
          // Sample the lead across the whole span, not just at its onset: an
          // inner voice that clears the ceiling at the start still crosses
          // when the melody descends underneath the sustained note (bar 7,
          // violins2 held 66 while the lead fell to 64). The lowest lead
          // pitch in the span is therefore the binding ceiling.
          const spanLeadPitches: number[] = [];
          if (participation.materialRole === 'inner') {
            for (let probe = start; probe < end; probe += Math.max(1, input.beatTicks)) {
              const lead = input.leadPitchAt?.(probe);
              if (lead !== null && lead !== undefined) spanLeadPitches.push(lead);
            }
          }
          const spanLeadLow = spanLeadPitches.length ? Math.min(...spanLeadPitches) : null;
          const innerCeiling = participation.materialRole === 'inner' && spanLeadLow !== null
            ? Math.min(input.stackCeiling ?? Number.POSITIVE_INFINITY, spanLeadLow - 1)
            : input.stackCeiling;
          // If the chosen tone has no representative inside the (possibly
          // shortened) window, offer the rest of the chord so the fallback
          // stays harmonic instead of landing on an arbitrary slot-centre
          // pitch. Anything another voice or the lead is already sounding is
          // omitted here so the substitute does not create the very doubling
          // this is meant to remove.
          // Every OTHER chord tone is a legal substitute; `avoidedClasses` ranks
          // them so a tone nobody is holding wins. Filtering occupied classes
          // out here would empty the list in a shortened window and push the
          // note straight back onto the slot-centre pitch.
          const fallbackTones = span.pitchClasses.filter(
            (cls) => (((cls % 12) + 12) % 12) !== (((tone % 12) + 12) % 12),
          );
          // Classes the substitute must not land on: what the lead is sounding
          // right now and everything other voices are already holding.
          const avoidedClasses = new Set<number>(sounding ?? []);
          {
            const leadNow = input.leadPitchAt?.(start) ?? null;
            if (leadNow !== null) avoidedClasses.add(((leadNow % 12) + 12) % 12);
          }
          let pitch = pitchForPitchClass(
            tone, band, input.voiceSlot, previousSustained, input.stackFloor, innerCeiling,
            fallbackTones, avoidedClasses,
          );
          if (participation.materialRole === 'inner') {
            // The nudge must respect the same ceiling that placed the note.
            // Called without it, this search walked up to the top of the
            // comfortable window and lifted inner voices back ABOVE the lead
            // that `pitchForPitchClass` had just clamped them under (dorian
            // violins2 sounded at 72 over a lead at 64-67). Pass the sounding
            // lead pitch so a unison/octave against the tune is rejected too.
            pitch = avoidLeadCollision(
              pitch,
              span.pitchClasses,
              input.leadPitchClasses,
              band,
              input.leadPitchAt?.(start) ?? null,
              innerCeiling,
              // Everything else already sounding in this span: the bass and any
              // earlier-written voice. Without this an inner voice is free to
              // sit on the bass's pitch class, which is the largest remaining
              // class of doubling.
              sounding ?? EMPTY_CLASSES,
            );
          }
          previousSustained = pitch;
          notes.push({
            pitch,
            startTick: start,
            durationTicks: Math.max(1, end - start),
            velocity: velocityAt(dynamic, (start - phrase.startTick) / phraseLength),
            articulation,
            role: participation.materialRole,
            phraseId: phrase.id,
            statementId: null,
          });
        }
        break;
      }
    }
  }

  notes.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
  const deduped = resolvePitchOverlaps(dedupe(notes));
  // Merge the spans first: every phrase contributes its section's spans, so
  // the raw list repeats them and produces overlapping "rests" that are not
  // rests at all (the voice is sounding from an adjacent span).
  const merged = mergeSpans([...spansBySection.values()].flat());
  return {
    trackId: '',
    role: '',
    register: band,
    notes: deduped,
    restSpans: restSpansFor(merged, deduped),
  };
}

/* --------------------------------------------------------- utilities */

const scaleLength = (project: Project): number =>
  scalePitchClasses(project.key, project.mode).length || 7;



function spansContain(spans: readonly { startTick: Tick; endTick: Tick }[], tick: Tick): boolean {
  return spans.some((span) => tick >= span.startTick && tick < span.endTick);
}

function harmonyAt(harmony: readonly HarmonicSpan[], tick: Tick): HarmonicSpan | null {
  return harmony.find((span) => tick >= span.startTick && tick < span.endTick) ?? null;
}

/** Drops exact duplicates (same pitch and onset) that spans can create. */
/**
 * Resolve same-pitch overlaps.
 *
 * A monophonic string part cannot play two notes of the same pitch at once.
 * The phrase-final hold below is the usual source: it runs once per statement,
 * so an earlier statement's last note is held to the phrase end and the next
 * statement then begins inside it (24 of 40 seeds on the dorian/symphony
 * sweep). `dedupe` only catches notes sharing a start tick, so these survived.
 *
 * The earlier note is TRIMMED to end where the later one begins; nothing is
 * moved and no pitch is invented. Output that has no overlap is returned
 * byte-identical, so every already-correct part is untouched.
 */
function resolvePitchOverlaps(notes: readonly RealizedNote[]): RealizedNote[] {
  // `RealizedNote` is immutable by contract, so build a new note rather than
  // mutating one. Only the notes that actually cross another are rebuilt;
  // everything else keeps its identity, so already-correct output is exact.
  const trims = new Map<RealizedNote, Tick>();
  const byPitch = new Map<number, RealizedNote[]>();
  for (const note of notes) {
    const list = byPitch.get(note.pitch);
    if (list) list.push(note); else byPitch.set(note.pitch, [note]);
  }
  for (const list of byPitch.values()) {
    list.sort((a, b) => a.startTick - b.startTick || b.durationTicks - a.durationTicks);
    for (let index = 1; index < list.length; index++) {
      const previous = list[index - 1];
      const current = list[index];
      const previousEnd = previous.startTick + previous.durationTicks;
      if (previousEnd <= current.startTick) continue;
      // Trim the earlier note to end where the later one begins. A note can be
      // trimmed more than once if two later onsets fall inside it, so always
      // measure from the ORIGINAL end and keep the smallest span.
      const trimmed = current.startTick - previous.startTick;
      const limit = Math.max(1, trimmed);
      const existing = trims.get(previous);
      const next = existing === undefined ? limit : Math.min(existing, limit);
      if (next < previous.durationTicks) trims.set(previous, next);
    }
  }
  if (!trims.size) return notes as RealizedNote[];
  return notes.map((note) => {
    const durationTicks = trims.get(note);
    return durationTicks === undefined ? note : { ...note, durationTicks };
  });
}

function dedupe(notes: readonly RealizedNote[]): RealizedNote[] {
  const seen = new Set<string>();
  const out: RealizedNote[] = [];
  for (const note of notes) {
    const key = `${note.pitch}:${note.startTick}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(note);
  }
  return out;
}

/** Sorts and merges overlapping/adjacent sounding spans. */
function mergeSpans(
  spans: readonly { startTick: Tick; endTick: Tick }[],
): { startTick: Tick; endTick: Tick }[] {
  const sorted = [...spans].sort((a, b) => a.startTick - b.startTick || a.endTick - b.endTick);
  const out: { startTick: Tick; endTick: Tick }[] = [];
  for (const span of sorted) {
    const last = out[out.length - 1];
    if (last && span.startTick <= last.endTick) {
      last.endTick = Math.max(last.endTick, span.endTick);
    } else {
      out.push({ startTick: span.startTick, endTick: span.endTick });
    }
  }
  return out;
}

/** Spans that carry no notes, stated explicitly rather than inferred. */
function restSpansFor(
  spans: readonly { startTick: Tick; endTick: Tick }[],
  notes: readonly RealizedNote[],
): { startTick: Tick; endTick: Tick }[] {
  const rests: { startTick: Tick; endTick: Tick }[] = [];
  for (const span of spans) {
    const sounding = notes
      .filter((note) => note.startTick < span.endTick && note.startTick + note.durationTicks > span.startTick)
      .sort((a, b) => a.startTick - b.startTick);
    let cursor = span.startTick;
    for (const note of sounding) {
      if (note.startTick > cursor) rests.push({ startTick: cursor, endTick: note.startTick });
      cursor = Math.max(cursor, note.startTick + note.durationTicks);
    }
    if (cursor < span.endTick) rests.push({ startTick: cursor, endTick: span.endTick });
  }
  return rests.filter((rest) => rest.endTick > rest.startTick);
}
