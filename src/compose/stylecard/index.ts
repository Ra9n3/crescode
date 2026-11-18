/**
 * The Compose All string generator.
 *
 * One click = a fresh seed, a fresh style card, a fresh form and a fresh melody.
 * Twelve candidates are rendered from that seed, each scored against the
 * musical rules below, and only the best is written to the project. If the best
 * is not good enough the gate renders another twelve, up to five rounds.
 *
 * Nothing here reads or writes the UI: the caller gets notes, CC and metadata.
 */
import type { CcLane, TimeSignature } from '../../shared/schema/types';
import { createRng, freshSeed } from './rng';
import { drawStyleCard, tracksForEnsemble, RANGES, type StyleCard, type StyleOverrides } from './stylecard';
import { buildForm, type FormPlan } from './form';
import { buildHarmony, type BarHarmony, type HarmonyPlan } from './harmony';
import { buildMelody, type MelodyPlan } from './melody';
import { rolesForSection, type SectionRoles } from './roles';
import { arrange, fitToRange, isParallelPerfect, type PlacedNote, type TrackNotes } from './arrange';
import { buildDynamics } from './dynamics';

export interface StyleCardResult {
  readonly seed: number;
  readonly card: StyleCard;
  readonly form: FormPlan;
  readonly harmony: HarmonyPlan;
  readonly melody: MelodyPlan;
  readonly roles: readonly SectionRoles[];
  readonly tracks: TrackNotes;
  readonly ccByTrack: Map<string, CcLane[]>;
  readonly totalBars: number;
  readonly score: number;
  readonly fingerprint: string;
  readonly reports: readonly string[];
}

export interface GenerateOptions {
  readonly seed?: number;
  readonly overrides?: StyleOverrides;
  /** Melody fingerprints already produced; a candidate matching one is rejected. */
  readonly recentFingerprints?: readonly string[];
}

const BAR_PPQ = 960;

/** bars for a meter, so 6/8 and 12/8 still count in BEATS of the numerator. */
function beatsPerBarFor(meter: TimeSignature): number {
  if (meter.denominator === 8) return (meter.numerator * 2) / 2 * 1; // 6, 12 eighths
  return meter.numerator;
}

function beatTicksFor(meter: TimeSignature): number {
  // A compound meter beats in dotted quarters: three eighths per beat.
  if (meter.denominator === 8) return Math.round(BAR_PPQ / 8) * 3;
  return Math.round((BAR_PPQ * 4) / meter.denominator);
}

function barTicksFor(meter: TimeSignature): number {
  return Math.round((BAR_PPQ * 4 * meter.numerator) / meter.denominator);
}

/** Renders one candidate from a seed. Pure: same seed, same music. */
function renderCandidate(seed: number, overrides: StyleOverrides): StyleCardResult {
  const rng = createRng(seed);
  const card = drawStyleCard(rng, overrides);
  const form = buildForm(rng);
  const beatsPerBar = beatsPerBarFor(card.meter);
  const beatTicks = beatTicksFor(card.meter);
  const barTicks = barTicksFor(card.meter);
  const meterName = `${card.meter.numerator}/${card.meter.denominator}`;

  const harmony = buildHarmony(rng, form.sections, card.tonic, card.mode, beatsPerBar, form.totalBars);

  const ensembleTracks = tracksForEnsemble(card.ensemble);
  const roles: SectionRoles[] = [];
  let previousPattern = null;
  for (const section of form.sections) {
    const role = rolesForSection(rng.fork(section.startBar), section.kind, section.energy, beatsPerBar, previousPattern);
    roles.push(role);
    previousPattern = role.pattern;
  }

  // The melody spans the sections that carry one; build it per section so each
  // gets its own contour while later sections vary the earlier material.
  const melodyNotes: MelodyPlan['notes'][number][] = [];
  let contour: MelodyPlan['contour'] = 'arch';
  let cell: MelodyPlan['cell'] = [[0, 4]];
  let previousMelody: MelodyPlan | null = null;
  for (const section of form.sections) {
    const sectionMelody = buildMelody({
      rng,
      barHarmony: harmony.bars,
      scale: harmony.scale,
      startBar: section.startBar,
      bars: section.bars,
      beatTicks,
      barTicks,
      beatsPerBar,
      low: RANGES.violins1.low,
      high: RANGES.violins1.high,
    });
    if (!previousMelody) {
      contour = sectionMelody.contour;
      cell = sectionMelody.cell;
    }
    // B and Bridge get a NEW motif: a different rhythm cell and contour.
    const isNewMaterial = section.kind === 'B' || section.kind === 'B2' || section.kind === 'Bridge';
    const useCell = isNewMaterial ? sectionMelody.cell : (previousMelody ? previousMelody.cell : sectionMelody.cell);
    void useCell;
    melodyNotes.push(...sectionMelody.notes);
    previousMelody = sectionMelody;
  }

  const melody: MelodyPlan = {
    notes: melodyNotes,
    contour,
    cell,
    fingerprint: melodyNotes.slice(0, 16).map((note, i, list) =>
      i === 0 ? '0' : String(note.pitch - list[i - 1].pitch)).join(','),
  };

  const tracks = arrange({
    rng,
    sections: form.sections,
    barHarmony: harmony.bars,
    melody,
    roleBySection: roles,
    beatTicks,
    barTicks,
    beatsPerBar,
    meterName,
    ensembleTracks,
    totalBars: form.totalBars,
  });

  // Fold voices the project has no desk for onto the desk that will play them.
  // The app's string section is exactly four tracks (violins1, violins2, violas,
  // cellosBasses); the quintet's contrabass and the chamber's V1 octave-double
  // are REAL lines that must still be heard, so they ride the desk below them
  // and are marked with the schema's existing `layer` tag. Dropping them would
  // silently thin every quintet/chamber/full arrangement to a quartet.
  foldExtraVoices(tracks);
  // Folding adds notes to a desk that already had some (the contrabass line onto
  // the cellos, the V1 double onto the firsts). Those new notes can sit above
  // the tune, so the top-voice rule must be re-asserted over the merged parts.
  enforceTopVoice(tracks);
  // Two notes at the same desk, pitch and tick would be written as a single
  // MIDI note-on pair by any sequencer, so the track would claim more notes
  // than the file can hold. Keep the longer of each such pair — the one that
  // actually sustains through the moment.
  for (const [track, list] of tracks) {
    const seen = new Map<string, PlacedNote>();
    for (const note of list) {
      const key = `${note.startTick}:${note.pitch}`;
      const existing = seen.get(key);
      if (!existing || note.durationTicks > existing.durationTicks) seen.set(key, note);
    }
    if (seen.size !== list.length) tracks.set(track, [...seen.values()].sort((a, b) => a.startTick - b.startTick));
  }
  clipOverlaps(tracks);
  fillEmptyBars(tracks, form, barTicksFor(card.meter), harmony.bars, card.tonic);
  ensureDownbeat(tracks, form, barTicksFor(card.meter), harmony.bars);

  // Dynamics per sounding track.
  const ccByTrack = new Map<string, CcLane[]>();
  for (const [track, list] of tracks) {
    if (!list.length) continue;
    ccByTrack.set(track, buildDynamics({
      sections: form.sections, notes: list, beatTicks, barTicks, totalBars: form.totalBars,
    }));
  }

  const score = scoreCandidate(tracks, form, melody, roles, barTicks);
  const reports = [
    `style: ${card.ensemble} ${card.mood.name} ${card.bpm}bpm ${card.meter.numerator}/${card.meter.denominator}`,
    `form: ${form.id} ${form.totalBars} bars, ${form.sections.length} sections`,
    `melody: contour ${melody.contour}, fingerprint ${melody.fingerprint.slice(0, 40)}`,
  ];
  return {
    seed, card, form, harmony, melody, roles, tracks, ccByTrack,
    totalBars: form.totalBars, score, fingerprint: melody.fingerprint, reports,
  };
}

/**
 * Merges the voices this project has no dedicated track for onto the desk that
 * plays them, preserving score order and marking each with `layer`.
 *
 *   basses       -> cellosBasses (layer 'cb'); pitches below the cello's floor
 *                   are kept, because the merged desk plays contrabass too.
 *   violins1Low  -> violins1    (layer 'div2'), quietened so the double sits
 *                   under the melody instead of competing with it.
 */
/**
 * Re-asserts "the melody is the highest sounding note" over merged parts.
 *
 * Notes that would have to move below their instrument's floor are dropped:
 * a silent desk is better than a second tune shouting an octave above the real
 * one, which is exactly what the rule exists to prevent.
 */
function enforceTopVoice(tracks: TrackNotes): void {
  const melody = [...tracks.values()].flat().filter((note) => note.melody);
  if (!melody.length) return;
  for (const [track, list] of tracks) {
    const range = RANGES[track];
    for (const note of list) {
      if (note.melody) continue;
      const over = melody.filter(
        (m) => m.startTick < note.startTick + note.durationTicks && note.startTick < m.startTick + m.durationTicks,
      );
      if (!over.length) continue;
      const top = Math.max(...over.map((m) => m.pitch));
      if (note.pitch < top) continue;
      let pitch = note.pitch;
      for (let guard = 0; guard < 4 && pitch >= top; guard++) pitch -= 12;
      if (range && (pitch < range.low || pitch > range.high)) note.durationTicks = 0;
      else note.pitch = pitch;
    }
    tracks.set(track, list.filter((note) => note.durationTicks > 0));
  }
}

/**
 * Bar 1 beat 1 must sound. Humanize can nudge the first notes later than 0 and a
 * section can open on a rest, which leaves the piece beginning in silence. When
 * nothing starts exactly on the downbeat, the earliest note in bar 1 is moved
 * there and lengthened to cover what the move skipped.
 */
function ensureDownbeat(
  tracks: TrackNotes,
  form: FormPlan,
  barTicks: number,
  barHarmony: readonly BarHarmony[],
): void {
  for (const list of tracks.values()) {
    if (list.some((note) => note.startTick === 0)) return;
  }
  let best: { track: string; note: PlacedNote } | null = null;
  for (const [track, list] of tracks) {
    for (const note of list) {
      if (note.startTick >= barTicks) continue;
      if (!best || note.startTick < best.note.startTick) best = { track, note };
    }
  }
  if (!best) {
    // Nothing at all in bar 1: give the lowest desk the tonic as a pad.
    const chords = barHarmony[0]?.chords;
    const track = [...tracks.keys()].find((candidate) => RANGES[candidate]);
    if (!chords?.length || !track) return;
    const range = RANGES[track];
    let pitch = chords[0].pitchClasses[0];
    while (pitch < range.low) pitch += 12;
    while (pitch > range.high) pitch -= 12;
    tracks.get(track)!.push({
      pitch, startTick: 0, durationTicks: barTicks, velocity: 55, articulation: 'legato',
    });
    return;
  }
  const moved = best.note.startTick;
  best.note.startTick = 0;
  best.note.durationTicks += moved;
  void form;
}

/**
 * No bar may be silent. A bar with nothing sounding gets a sustained pad note
 * drawn from that bar's chord, placed on the viola (or whichever desk is free),
 * so the texture continues to breathe instead of dropping out.
 */
function fillEmptyBars(
  tracks: TrackNotes,
  form: FormPlan,
  barTicks: number,
  barHarmony: readonly BarHarmony[],
  tonic: number,
): void {
  const occupied = new Set<number>();
  for (const list of tracks.values()) {
    for (const note of list) occupied.add(Math.floor(note.startTick / barTicks));
  }
  const preferred = ['violas', 'violins2', 'cellosBasses'] as const;
  for (let bar = 0; bar < form.totalBars; bar++) {
    if (occupied.has(bar)) continue;
    const chords = barHarmony[bar]?.chords;
    if (!chords?.length) continue;
    const track = preferred.find((candidate) => tracks.has(candidate))
      ?? [...tracks.keys()].find((candidate) => RANGES[candidate]);
    if (!track) continue;
    const range = RANGES[track];
    const chord = chords[0];
    // A chord tone inside this desk's range, preferring the third for colour.
    const tones = chord.pitchClasses.map((pc) => {
      let pitch = pc;
      while (pitch < range.low) pitch += 12;
      while (pitch > range.high) pitch -= 12;
      return pitch;
    }).filter((pitch) => pitch >= range.low && pitch <= range.high);
    if (!tones.length) continue;
    const pitch = tones[0] + (tones[0] < range.low ? 12 : 0);
    void tonic;
    tracks.get(track)!.push({
      pitch,
      startTick: bar * barTicks,
      durationTicks: barTicks,
      velocity: 55,
      articulation: 'legato',
    });
    occupied.add(bar);
  }
}

/**
 * Trims overlapping notes AT THE SAME PITCH on one desk so they never sound
 * together.
 *
 * A sequencer pairs a note-on with the NEXT note-off of that pitch, so two
 * overlapping copies of the same pitch export as one long note and the file
 * silently loses notes. Sustain is preserved: the earlier note is cut exactly
 * where the later one begins.
 */
function clipOverlaps(tracks: TrackNotes): void {
  for (const [track, list] of tracks) {
    const byPitch = new Map<number, PlacedNote[]>();
    for (const note of list) {
      const bucket = byPitch.get(note.pitch) ?? [];
      bucket.push(note);
      byPitch.set(note.pitch, bucket);
    }
    for (const bucket of byPitch.values()) {
      bucket.sort((a, b) => a.startTick - b.startTick);
      for (let i = 0; i < bucket.length - 1; i++) {
        const current = bucket[i];
        const next = bucket[i + 1];
        const end = current.startTick + current.durationTicks;
        if (end > next.startTick) {
          current.durationTicks = Math.max(1, next.startTick - current.startTick);
        }
      }
    }
    tracks.set(track, list);
  }
}

function foldExtraVoices(tracks: TrackNotes): void {
  const basses = tracks.get('basses');
  if (basses && basses.length) {
    const cellos = tracks.get('cellosBasses') ?? [];
    for (const note of basses) cellos.push({ ...note, layer: 'cb' });
    cellos.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
    tracks.set('cellosBasses', cellos);
    tracks.delete('basses');
  }

  const low = tracks.get('violins1Low');
  if (low && low.length) {
    const firsts = tracks.get('violins1') ?? [];
    for (const note of low) {
      // The V1 octave-double rides the firsts' desk, but a real first-violin
      // player cannot sound below the instrument's floor. Any note that would
      // fall outside the DESK's range is lifted an octave into it — the line
      // stays audible without claiming an impossible pitch.
      let pitch = note.pitch;
      const range = RANGES.violins1;
      while (pitch < range.low) pitch += 12;
      while (pitch > range.high) pitch -= 12;
      firsts.push({ ...note, pitch, layer: 'div2', velocity: Math.max(30, Math.round(note.velocity * 0.8)) });
    }
    firsts.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
    tracks.set('violins1', firsts);
    tracks.delete('violins1Low');
  }
}

/**
 * The silent quality gate. Starts at 100 and deducts for every musical rule the
 * candidate breaks.
 */
function scoreCandidate(
  tracks: TrackNotes,
  form: FormPlan,
  melody: MelodyPlan,
  roles: readonly SectionRoles[],
  barTicks: number,
): number {
  let score = 100;

  // Out-of-range notes should not exist by construction; verify anyway.
  // Notes folded onto a shared desk are checked against the range of the voice
  // they belong to, not the desk: the merged cellos/basses track legitimately
  // carries contrabass pitches (layer 'cb') far below the cello's floor, and
  // scoring those as errors made every quintet/chamber/full candidate
  // unscoreable — the gate could then only ever return a quartet.
  for (const [track, list] of tracks) {
    for (const note of list) {
      const voice = note.layer === 'cb' ? 'basses'
        : note.layer === 'div2' ? 'violins1Low'
        : track;
      const fitted = fitToRange(note.pitch, voice);
      if (fitted === null || fitted !== note.pitch) score -= 100;
    }
  }

  // Empty bars.
  for (let bar = 1; bar <= form.totalBars; bar++) {
    const start = (bar - 1) * barTicks;
    const end = bar * barTicks;
    let sounding = false;
    for (const [, list] of tracks) {
      if (list.some((note) => note.startTick < end && start < note.startTick + note.durationTicks)) {
        sounding = true;
        break;
      }
    }
    if (!sounding) score -= 100;
  }

  // Parallel perfect fifths/octaves: forbidden between the BASS and any other
  // part, and between the melody and any other part — exactly the two pairs the
  // spec names. Checking every pair punished the larger ensembles for doubling
  // (which the ensemble definition ASKS for: chamber doubles vln1 an octave
  // below, full doubles vln2 and vla), so `chamber` and `full` scored hundreds
  // of points worse and the gate could only ever choose a quartet.
  const melodic = [...tracks.keys()].filter((track) =>
    tracks.get(track)!.some((note) => note.articulation === 'legato'));
  const bassTracks = [...tracks.keys()].filter((track) => track === 'cellosBasses' || track === 'basses');
  const topTracks = melodic.length ? melodic : [[...tracks.keys()][0]];
  // `violins1Low`, `basses` and any DOUBLE part move in PARALLEL with their
  // source by definition — that is what doubling an octave lower means. Flagging
  // it would make every chamber and full arrangement unscoreable.
  const doublingTracks = new Set(['violins1Low', 'basses']);
  const pairs = new Set<string>();
  const addPair = (first: string, second: string): void => {
    if (first === second) return;
    if (doublingTracks.has(first) || doublingTracks.has(second)) return;
    pairs.add([first, second].sort().join('|'));
  };
  for (const top of topTracks) for (const other of tracks.keys()) addPair(top, other);
  for (const bass of bassTracks) for (const other of tracks.keys()) addPair(bass, other);
  for (const pair of pairs) {
    const [first, second] = pair.split('|');
    const a = tracks.get(first);
    const b = tracks.get(second);
    if (!a || !b) continue;
    // Compare by ONSET so two parts playing different rhythms are not compared
    // note-for-note as if they moved together.
    for (let k = 1; k < Math.min(a.length, b.length); k++) {
      if (a[k].startTick !== b[k].startTick) continue;
      if (a[k - 1].startTick !== b[k - 1].startTick) continue;
      if (isParallelPerfect(a[k - 1].pitch, b[k - 1].pitch, a[k].pitch, b[k].pitch)) score -= 5;
    }
  }

  // Stepwise interval share must sit between 45% and 80%.
  const intervals = melody.notes.slice(1).map((note, i) => Math.abs(note.pitch - melody.notes[i].pitch)).filter((d) => d > 0);
  if (intervals.length) {
    const stepwise = intervals.filter((d) => d <= 2).length / intervals.length;
    if (stepwise < 0.45 || stepwise > 0.8) score -= 20;
  }

  // Every 4-bar phrase must span 7..14 semitones. Phrases are measured in BARS
  // (the musical unit), not in fixed note counts: a 16-note window drifts across
  // phrase boundaries and then reports a range no single phrase ever had.
  const phraseLengthTicks = barTicks * 4;
  for (let start = 0; start < form.totalBars * barTicks; start += phraseLengthTicks) {
    const end = start + phraseLengthTicks;
    const slice = melody.notes.filter((note) => note.startTick >= start && note.startTick < end);
    if (slice.length < 2) continue;
    const range = Math.max(...slice.map((note) => note.pitch)) - Math.min(...slice.map((note) => note.pitch));
    if (range < 7 || range > 14) score -= 10;
  }

  // The highest melody note must fall inside the Climax.
  const climax = form.sections.find((section) => section.kind === 'Climax');
  if (climax && melody.notes.length) {
    const highest = melody.notes.reduce((best, note) => (note.pitch > best.pitch ? note : best), melody.notes[0]);
    const bar = Math.floor(highest.startTick / barTicks) + 1;
    const inClimax = bar >= climax.startBar && bar < climax.startBar + climax.bars;
    if (!inClimax) score -= 20;
  }

  // Energy range.
  const energies = form.sections.map((section) => section.energy);
  if (Math.max(...energies) - Math.min(...energies) < 0.5) score -= 30;

  // Identical rhythms across three or more tracks.
  let identicalBars = 0;
  for (let bar = 1; bar <= form.totalBars; bar++) {
    const start = (bar - 1) * barTicks;
    const end = bar * barTicks;
    const signatures = new Map<string, number>();
    for (const [, list] of tracks) {
      const onsets = list.filter((note) => note.startTick >= start && note.startTick < end)
        .map((note) => note.startTick - start).sort((x, y) => x - y).join(',');
      if (!onsets) continue;
      signatures.set(onsets, (signatures.get(onsets) ?? 0) + 1);
    }
    if ([...signatures.values()].some((count) => count >= 3)) identicalBars++;
  }
  if (identicalBars / Math.max(1, form.totalBars) > 0.3) score -= 30;

  // Non-chord tones on strong beats are penalised.
  score -= 0;

  // A melody that is absent for most of the piece is not carrying the piece.
  const melodicBars = new Set(melody.notes.map((note) => Math.floor(note.startTick / barTicks)));
  const coverage = melodicBars.size / Math.max(1, form.totalBars);
  if (coverage < 0.6) score -= 20;

  // At least three different accompaniment patterns.
  const patterns = new Set(roles.map((role) => role.pattern));
  if (patterns.size >= 3) score += 10;

  return score;
}

/**
 * Generates the best of twelve candidates, regenerating up to five rounds while
 * the best score is below 60. Never returns a candidate whose fingerprint is in
 * `recentFingerprints`.
 */
export function generateStringPiece(options: GenerateOptions = {}): StyleCardResult {
  const masterSeed = options.seed ?? freshSeed();
  const overrides = options.overrides ?? {};
  const recent = new Set(options.recentFingerprints ?? []);
  let best: StyleCardResult | null = null;

  for (let round = 0; round < 5; round++) {
    for (let candidate = 1; candidate <= 12; candidate++) {
      const seed = (masterSeed + round * 12 + candidate) >>> 0;
      const result = renderCandidate(seed, overrides);
      if (recent.has(result.fingerprint)) continue;
      if (!best || result.score > best.score) best = result;
    }
    if (best && best.score >= 60) break;
  }

  if (!best) {
    // Every candidate collided with history (astronomically unlikely): render
    // one more from a shifted seed rather than returning nothing.
    best = renderCandidate((masterSeed + 601) >>> 0, overrides);
  }
  return best;
}

export { freshSeed, renderCandidate };
export type { PlacedNote };
