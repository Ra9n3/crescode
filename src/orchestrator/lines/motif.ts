/**
 * The lead motif (Phase 4c, spec D8 seeding). A 1–2 bar cell in scale
 * degrees with a meter-relative rhythm, seeded per take: same (inputs,
 * take) → the same motif, a new take re-rolls it. Strong beats land on
 * chord tones (of the chord sounding at the event), weak beats may be any
 * scale step. The cell is developed by section occurrence:
 *
 *   - first Verse(-like) section  → statement, the cell as generated;
 *   - the next phrase             → answer (contour inverted) or sequence
 *                                   (start degree shifted up), seeded;
 *   - Chorus(-like) sections      → the motif RAISED — sequenced up a pair
 *                                   of degrees or up an octave, clamped
 *                                   into the lead's comfortable range;
 *   - the final section (when not chorus-like) → fragmentation (first half
 *                                   of the cell, played sparse) or
 *                                   augmentation (durations doubled);
 *   - intro-like sections         → no motif (the lead rests; pads play).
 *
 * The contour CLASS (the up/down shape of the onsets) survives raising and
 * sequencing, so the Chorus statement is recognisably the Verse motif an
 * octave or a step higher — that is what the 4h tests assert.
 */
import { mulberry32, hashString } from '../../engine/generate';
import { orchestrationSeedFor } from '../spine';
import { barTicks, beatOffsets, beatTicks, isCompound } from '../../shared/schema/meter';
import { scalePitchClasses } from '../../shared/schema/modes';
import { chordTones } from '../voicing/chordTones';
import type { Note, Project } from '../../shared/schema/types';
import type { ResolvedChord, SpineSection } from '../spine';

export type MotifDevelopment = 'statement' | 'answer' | 'sequence' | 'raised' | 'fragmentation' | 'augmentation';

/** Sections where no lead ever enters. */
const INTRO_LIKE = /intro|prelude|breakdown|ambient/;
const CHORUS_LIKE = /chorus|refrain|hook|drop/;
const VERSE_LIKE = /verse|strophe/;

/** The lead line's articulation (Phase 4g assigns articulations only here). */
export const LEAD_ARTICULATION = 'legato' as const;

export interface MotifInput {
  project: Project;
  spans: ResolvedChord[];
  sections: SpineSection[];
  /** The bars where the layer plan actually gives the lead track the lead. */
  leadBars: ReadonlySet<number>;
  /** The lead track's ordinary writing window (hard range ⊇ this). */
  comfortable: [number, number];
  /** The take counter (D8): same inputs + take → identical motif. */
  take: number;
}

/** The chord sounding at a tick (spans are normalized and non-overlapping). */
export function chordAt(spans: ResolvedChord[], tick: number): ResolvedChord | null {
  for (const s of spans) {
    if (tick < s.startTick) return null;
    if (tick < s.endTick) return s;
  }
  return null;
}

/** Contour class of a line: U/D/S per onset-to-onset move, in time order. */
export function contourOf(notes: Note[]): string {
  const onsets = [...notes].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
  let out = '';
  for (let i = 1; i < onsets.length; i++) {
    const d = onsets[i].pitch - onsets[i - 1].pitch;
    out += d > 0 ? 'U' : d < 0 ? 'D' : 'S';
  }
  return out;
}

interface RhythmCell {
  bars: number;
  /** Onsets in felt beats from the cell start; durations run to the next onset / cell end. */
  onsets: number[];
}

function makeRhythmCell(beatsPerBar: number, simple: boolean, rng: () => number): RhythmCell {
  const bars = rng() < 0.5 ? 1 : 2;
  const cellBeats = bars * beatsPerBar;
  const onsets: number[] = [0];
  for (let b = 1; b < cellBeats; b++) if (rng() < 0.72) onsets.push(b);
  if (onsets.length === 1) onsets.push(cellBeats - 1); // never one long drone
  if (simple && rng() < 0.45) {
    // a half-beat anticipation inside the cell (simple meters divide by two)
    const b = 1 + Math.floor(rng() * (cellBeats - 2));
    if (!onsets.includes(b) && !onsets.includes(b + 0.5)) onsets.push(b + 0.5);
    onsets.sort((a, b) => a - b);
  }
  return { bars, onsets };
}

/** Cumulative scale-degree walk for the cell: one entry per onset. */
function degreeWalk(onsets: number[], rng: () => number): number[] {
  const out = [0];
  for (let i = 1; i < onsets.length; i++) {
    const r = rng();
    const step = r < 0.4 ? 1 : r < 0.8 ? -1 : r < 0.9 ? 2 : -2;
    out.push(out[i - 1] + step);
  }
  return out;
}

/** The absolute pitch of a scale degree: anchor = the tonic pitch taken as degree 0.
 *  Degree octaves are honoured (degree 7 is a real octave above degree 0). */
function pitchForDegree(degree: number, scale: number[], anchor: number): number {
  const scaleLen = scale.length;
  const oct = Math.floor(degree / scaleLen);
  const idx = (((degree % scaleLen) + scaleLen) % scaleLen);
  const pc = ((scale[idx] % 12) + 12) % 12;
  const tonic = ((scale[0] % 12) + 12) % 12;
  return anchor + 12 * oct + (((pc - tonic) + 12) % 12);
}

/** The nearest degree (walking the scale) whose pitch class is a chord tone. */
function degreeOntoChordTone(degree: number, scale: number[], tonePcs: ReadonlySet<number>): number {
  for (let d = 0; d <= scale.length; d++) {
    for (const dir of d === 0 ? [1] : [1, -1]) {
      const cand = degree + d * dir;
      const pc = ((scale[(((cand % scale.length) + scale.length) % scale.length)] % 12) + 12) % 12;
      if (tonePcs.has(pc)) return cand;
    }
  }
  return degree;
}

export function motifLine(input: MotifInput): Note[] {
  const { project, spans, sections, leadBars, comfortable, take } = input;
  if (!leadBars.size || !sections.length) return [];
  const btBar = barTicks(project.timeSignature);
  const beat = beatTicks(project.timeSignature);
  const simple = !isCompound(project.timeSignature);
  const beatsPerBar = beatOffsets(project.timeSignature).length;
  const scale = scalePitchClasses(project.key, project.mode); // ascending pitch classes from the tonic

  // D8: the motif stream is the (inputs, take) seed salted away from the
  // voicing and arc streams — same take, same motif; new take, new motif.
  const rng = mulberry32((orchestrationSeedFor(project, { take }) ^ Math.imul(hashString('motif'), 0x85ebca6b)) >>> 0);

  const sorted = [...sections].sort((a, b) => a.startBar - b.startBar);
  const finalSection = sorted[sorted.length - 1];
  const cell = makeRhythmCell(beatsPerBar, simple, rng);
  const walk = degreeWalk(cell.onsets, rng);
  const statementStartDegree = 2 + Math.floor(rng() * 3); // around the 3rd..5th degree
  // absolute degree anchor: the tonic pitch nearest ~1.5 octaves below the
  // middle of the writing window, so the starting degrees land mid-window
  const mid = (comfortable[0] + comfortable[1]) / 2;
  const tonicPc = ((scale[0] % 12) + 12) % 12;
  const anchorCandidates = [40, 52, 64, 76, 88].map((p) => p - ((((p - tonicPc) % 12) + 12) % 12));
  const anchor = anchorCandidates.reduce((best, p) => (Math.abs(p - (mid - 15)) < Math.abs(best - (mid - 15)) ? p : best), anchorCandidates[0]);

  let verseSeen = 0;
  let statementMaxPitch: number | null = null; // the raise must fit above the statement
  const notes: Note[] = [];

  for (const sec of sorted) {
    const name = sec.name.trim().toLowerCase();
    const leadBarsHere = Array.from({ length: sec.lengthBars }, (_, i) => sec.startBar + i).filter((b) => leadBars.has(b));
    if (!leadBarsHere.length) continue;
    if (INTRO_LIKE.test(name)) continue; // the motif arrives with the first phrase

    // development for this occurrence
    let dev: MotifDevelopment;
    if (CHORUS_LIKE.test(name)) dev = 'raised';
    else if (sec.id === finalSection?.id) dev = rng() < 0.5 ? 'fragmentation' : 'augmentation';
    else if (VERSE_LIKE.test(name) && ++verseSeen === 1) dev = 'statement';
    else dev = rng() < 0.5 ? 'answer' : 'sequence';

    // degree transform for the whole section — the Chorus raise takes the
    // octave when the comfortable window can hold the statement + 12, else
    // it sequences up a pair of degrees ("within the comfortable range")
    let shift = 0;
    let invert = false;
    if (dev === 'raised') shift = statementMaxPitch !== null && statementMaxPitch + 12 <= comfortable[1] ? 7 : 2;
    else if (dev === 'answer') { invert = true; shift = -1; }
    else if (dev === 'sequence') shift = 2;
    const frag = dev === 'fragmentation';

    const firstLeadBar = leadBarsHere[0];
    const secNotes: Note[] = [];

    for (const bar of leadBarsHere) {
      if ((bar - firstLeadBar) % cell.bars !== 0) continue; // cells repeat from the first lead bar
      const barTick = (bar - 1) * btBar;
      const onsets = frag ? cell.onsets.slice(0, Math.max(2, Math.ceil(cell.onsets.length / 2))) : cell.onsets;
      onsets.forEach((onsetBeats, i) => {
        const step = invert ? -(walk[i] - walk[0]) : walk[i];
        let degree = statementStartDegree + shift + step;
        const tick = barTick + onsetBeats * beat;
        if (tick >= (sec.startBar - 1 + sec.lengthBars) * btBar) return; // keep the motif inside its section
        const chord = chordAt(spans, tick);
        const beatIdx = Math.round(onsetBeats);
        const onBeat = Math.abs(onsetBeats - beatIdx) < 1e-9;
        // strong = bar-relative: the downbeat and (simple meters) the middle beat
        const inBarBeat = ((beatIdx % beatsPerBar) + beatsPerBar) % beatsPerBar;
        const strong = onBeat && (inBarBeat === 0 || (simple && inBarBeat * 2 === beatsPerBar));
        const tones = strong && chord ? new Set(chordTones(chord.parsed).tones.map((t) => t.pc)) : null;
        if (tones) degree = degreeOntoChordTone(degree, scale, tones);
        // settle into the comfortable window by WALKING the scale — never an
        // octave flip, which would jump the register mid-line
        let pitch = pitchForDegree(degree, scale, anchor);
        let guard = 0;
        while (pitch > comfortable[1] && guard++ < 2 * scale.length) { degree -= 1; pitch = pitchForDegree(degree, scale, anchor); }
        while (pitch < comfortable[0] && guard++ < 4 * scale.length) { degree += 1; pitch = pitchForDegree(degree, scale, anchor); }
        if (tones) {
          // the settle may have walked off the chord tone: re-snap inside the window
          let fixed: number | null = null;
          for (let d = 0; d <= scale.length && fixed === null; d++) {
            for (const dir of d === 0 ? [0] : [1, -1]) {
              const p = pitchForDegree(degree + d * dir, scale, anchor);
              const pc = ((scale[(((degree + d * dir) % scale.length) + scale.length) % scale.length] % 12) + 12) % 12;
              if (p >= comfortable[0] && p <= comfortable[1] && tones.has(pc)) { fixed = p; degree += d * dir; break; }
            }
          }
          if (fixed === null) return; // the window cannot hold a chord tone here: rest instead
          pitch = fixed;
        }
        if (pitch < comfortable[0] || pitch > comfortable[1]) return; // the window cannot hold the line here: rest
        const nextOnset = onsets[i + 1] ?? cell.bars * beatsPerBar;
        let dur = (nextOnset - onsetBeats) * beat;
        if (dev === 'augmentation') dur *= 2;
        secNotes.push({ pitch, startTick: tick, durationTicks: Math.round(dur), velocity: 80, articulation: LEAD_ARTICULATION });
      });
    }
    if (dev === 'statement' && secNotes.length) statementMaxPitch = Math.max(...secNotes.map((n) => n.pitch));
    notes.push(...secNotes);
  }
  return notes;
}
