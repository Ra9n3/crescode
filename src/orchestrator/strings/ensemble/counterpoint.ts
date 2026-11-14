/**
 * Two voices together (Strings V1, Stage 3) — the craft a voice uses to
 * listen to another voice, and the ensemble review uses to read a finished
 * passage. Skills, not decisions.
 *
 * Both lines are given in SOUNDING scale steps (step 0 = the tonic at the
 * octave-4 position), so intervals between them are real intervals.
 *
 * `judgeTogether` reads every moment the two voices sound together and the
 * way they move from one such moment to the next:
 *
 *   clash                 a minor second anywhere; a minor ninth or an
 *                         adjacent major second unless one of the two notes
 *                         is a short unaccented dissonance of its own line;
 *   unresolved dissonance a seventh, ninth, fourth or tritone between the
 *                         voices is accepted when both notes are chord tones,
 *                         or when the note outside the chord is a dissonance
 *                         its own line treats (prepares and resolves);
 *   resolution doubled    the note an accented dissonance resolves to must
 *                         not sound in the other voice at the same time,
 *                         unless that voice is more than an octave below;
 *   parallel perfect      two fifths, or two octaves/unisons, in the same
 *                         direction;
 *   direct octave         both voices move the same way into an octave or
 *                         unison;
 *   parallel run          more than three moves in a row in parallel thirds
 *                         or sixths: one voice shadowing the other;
 *   crossing              the voice that was planned above goes below (or
 *                         the reverse).
 *
 * The same reading also counts how the voices move (contrary, oblique,
 * similar, parallel) and how many of their notes begin together: facts for
 * a writer to weigh and for a report to state.
 */
import { chordAt, pitchClassOf, semitonesOf, type LineNote, type NoteFunction, type TonalFrame } from '../material/line';

export interface SoundingNote extends LineNote {
  readonly function: NoteFunction;
}

export type ConflictKind = 'clash' | 'unresolved-dissonance' | 'resolution-doubled' | 'parallel-perfect' | 'direct-octave' | 'parallel-run' | 'crossing';

export interface Conflict {
  readonly tick: number;
  readonly kind: ConflictKind;
  readonly text: string;
}

export type VerticalQuality = 'perfect' | 'imperfect' | 'dissonant';

export interface Vertical {
  readonly tick: number;
  readonly endTick: number;
  /** Index into the first / second voice. */
  readonly a: number;
  readonly b: number;
  /** First voice minus second voice, in semitones. */
  readonly semitones: number;
  readonly quality: VerticalQuality;
  readonly bothChordTones: boolean;
}

export interface MotionCount {
  readonly contrary: number;
  readonly oblique: number;
  readonly similar: number;
  readonly parallel: number;
}

export interface TogetherJudgement {
  readonly ok: boolean;
  readonly conflicts: readonly Conflict[];
  readonly verticals: readonly Vertical[];
  readonly motion: MotionCount;
  /** Notes of the first voice, and how many begin together with a note of the second. */
  readonly onsetsA: number;
  readonly sharedOnsets: number;
  /** Notes of the second voice that begin while the first voice's passage lasts. */
  readonly onsetsB: number;
}

export interface TogetherOptions {
  /** Where the first voice was planned relative to the second; null when either is acceptable. */
  readonly side: 'above' | 'below' | null;
}

const ACCENTED: ReadonlySet<NoteFunction> = new Set<NoteFunction>(['appoggiatura', 'suspension']);
const UNACCENTED: ReadonlySet<NoteFunction> = new Set<NoteFunction>(['passing', 'neighbour', 'leaning', 'chromatic-neighbour']);
const TREATED: ReadonlySet<NoteFunction> = new Set<NoteFunction>([...ACCENTED, ...UNACCENTED]);
/** The longest run of parallel thirds or sixths before one voice is only shadowing the other. */
export const MAX_PARALLEL_RUN = 3;

/** Sounding MIDI pitch of a note given in sounding scale steps. */
export const soundingPitch = (frame: TonalFrame, note: Pick<LineNote, 'step' | 'alter'>): number => 60 + frame.key + semitonesOf(frame, note);

export function intervalName(semitones: number): string {
  const distance = Math.abs(semitones);
  const names = ['unison', 'minor second', 'major second', 'minor third', 'major third', 'fourth', 'tritone', 'fifth', 'minor sixth', 'major sixth', 'minor seventh', 'major seventh'];
  if (distance === 0) return 'unison';
  if (distance % 12 === 0) return distance === 12 ? 'octave' : `${distance / 12} octaves`;
  if (distance < 12) return names[distance];
  const compound = ['', 'minor ninth', 'major ninth', 'minor tenth', 'major tenth', 'eleventh', 'octave and tritone', 'twelfth', 'minor thirteenth', 'major thirteenth', 'octave and minor seventh', 'octave and major seventh'];
  return distance < 24 ? compound[distance - 12] : `${names[distance % 12]} plus ${Math.floor(distance / 12)} octaves`;
}

export function qualityOf(semitones: number): VerticalQuality {
  const ic = Math.abs(semitones) % 12;
  return ic === 0 || ic === 7 ? 'perfect' : ic === 3 || ic === 4 || ic === 8 || ic === 9 ? 'imperfect' : 'dissonant';
}

export function judgeTogether(frame: TonalFrame, a: readonly SoundingNote[], b: readonly SoundingNote[], options: TogetherOptions): TogetherJudgement {
  const conflicts: Conflict[] = [];
  const verticals: Vertical[] = [];
  const half = frame.beatTicks / 2;
  const pa = a.map((n) => soundingPitch(frame, n));
  const pb = b.map((n) => soundingPitch(frame, n));
  const brief = (n: SoundingNote): boolean => n.duration <= half && UNACCENTED.has(n.function);
  const resolutionOf = (line: readonly SoundingNote[], i: number): SoundingNote | null => {
    const next = line[i + 1];
    return ACCENTED.has(line[i].function) && next && next.tick === line[i].tick + line[i].duration ? next : null;
  };

  a.forEach((x, i) => {
    b.forEach((y, j) => {
      const tick = Math.max(x.tick, y.tick);
      const endTick = Math.min(x.tick + x.duration, y.tick + y.duration);
      if (endTick <= tick) return;
      const semitones = pa[i] - pb[j];
      const distance = Math.abs(semitones);
      const ic = distance % 12;
      const chord = chordAt(frame, tick);
      const xChord = !!chord && chord.fact.pitchClasses.includes(pitchClassOf(frame, x));
      const yChord = !!chord && chord.fact.pitchClasses.includes(pitchClassOf(frame, y));
      const quality = qualityOf(semitones);
      verticals.push({ tick, endTick, a: i, b: j, semitones, quality, bothChordTones: xChord && yChord });

      if (options.side === 'above' && semitones < 0) conflicts.push({ tick, kind: 'crossing', text: 'the voice planned above goes below the other' });
      if (options.side === 'below' && semitones > 0) conflicts.push({ tick, kind: 'crossing', text: 'the voice planned below goes above the other' });

      if (distance === 1) conflicts.push({ tick, kind: 'clash', text: 'a minor second between the voices' });
      else if (ic === 1) { if (!brief(x) && !brief(y)) conflicts.push({ tick, kind: 'clash', text: `a ${intervalName(semitones)} that is not a short passing dissonance` }); }
      else if (distance === 2) { if (!brief(x) && !brief(y)) conflicts.push({ tick, kind: 'clash', text: 'an adjacent major second that is not a short passing dissonance' }); }
      else if (quality === 'dissonant' && !(xChord && yChord)) {
        const xTreated = xChord || TREATED.has(x.function);
        const yTreated = yChord || TREATED.has(y.function);
        if (!xTreated || !yTreated) conflicts.push({ tick, kind: 'unresolved-dissonance', text: `a ${intervalName(semitones)} with a note outside the chord that its own line does not resolve` });
        else if (!xChord && !yChord) conflicts.push({ tick, kind: 'unresolved-dissonance', text: `two dissonances at once that form a ${intervalName(semitones)}` });
      }

      // the note of resolution sounding against its own dissonance
      const xResolves = resolutionOf(a, i);
      if (xResolves && pitchClassOf(frame, xResolves) === pitchClassOf(frame, y) && pb[j] > pa[i] - 12) {
        conflicts.push({ tick, kind: 'resolution-doubled', text: 'the other voice sounds the note this dissonance resolves to' });
      }
      const yResolves = resolutionOf(b, j);
      if (yResolves && pitchClassOf(frame, yResolves) === pitchClassOf(frame, x) && pa[i] > pb[j] - 12) {
        conflicts.push({ tick, kind: 'resolution-doubled', text: 'this voice sounds the note the other voice\'s dissonance resolves to' });
      }
    });
  });
  verticals.sort((u, v) => u.tick - v.tick || u.a - v.a || u.b - v.b);

  // how the voices move from one moment together to the next
  const motion = { contrary: 0, oblique: 0, similar: 0, parallel: 0 };
  let run = 0;
  for (let k = 1; k < verticals.length; k++) {
    const from = verticals[k - 1];
    const to = verticals[k];
    if (from.endTick !== to.tick) { run = 0; continue; } // a rest in one voice: no motion to read
    const da = pa[to.a] - pa[from.a];
    const db = pb[to.b] - pb[from.b];
    if (da === 0 && db === 0) continue;
    if (da === 0 || db === 0) { motion.oblique++; run = 0; continue; }
    if (Math.sign(da) !== Math.sign(db)) { motion.contrary++; run = 0; continue; }
    const fromIc = Math.abs(from.semitones) % 12;
    const toIc = Math.abs(to.semitones) % 12;
    const sameSize = a[to.a].step - b[to.b].step === a[from.a].step - b[from.b].step;
    if (toIc === 0 && fromIc === 0) conflicts.push({ tick: to.tick, kind: 'parallel-perfect', text: 'parallel octaves or unisons' });
    else if (toIc === 7 && fromIc === 7) conflicts.push({ tick: to.tick, kind: 'parallel-perfect', text: 'parallel fifths' });
    else if (toIc === 0) conflicts.push({ tick: to.tick, kind: 'direct-octave', text: 'both voices move the same way into an octave or unison' });
    if (sameSize) {
      motion.parallel++;
      run++;
      if (run > MAX_PARALLEL_RUN) conflicts.push({ tick: to.tick, kind: 'parallel-run', text: `more than ${MAX_PARALLEL_RUN} moves in a row in parallel ${intervalName(to.semitones)}s` });
    } else {
      motion.similar++;
      run = 0;
    }
  }

  const bTicks = new Set(b.map((n) => n.tick));
  const first = a.length ? a[0].tick : 0;
  const last = a.length ? a[a.length - 1].tick + a[a.length - 1].duration : 0;
  return {
    ok: conflicts.length === 0,
    conflicts,
    verticals,
    motion,
    onsetsA: a.length,
    sharedOnsets: a.filter((n) => bTicks.has(n.tick)).length,
    onsetsB: b.filter((n) => n.tick >= first && n.tick < last).length,
  };
}
