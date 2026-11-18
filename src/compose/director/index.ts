/**
 * Layer 3 — Orchestration Director.
 *
 * Decides WHO does WHAT, before any instrument writes a note. It never emits a
 * pitch: it emits participation, roles, registers, doubling with a stated
 * purpose, moments and fills.
 *
 * Governing rules:
 *  - The roster is the project's existing instrument tracks. This module never
 *    creates, deletes or renames a track.
 *  - Every eligible track gets a participation decision. No minimum number of
 *    families is required: solo, duo, chamber and tutti are all legitimate.
 *  - Resting is a decision, not a failure; so is sustaining throughout.
 */
import { isInstrumentTrack } from '../../shared/schema/types';
import type { Track } from '../../shared/schema/types';
import type {
  BarCell,
  FormSection,
  LayerName,
  MusicalRole,
  OrchestraPlan,
  Participation,
  PlannedFill,
  PlannedMoment,
  RegisterBand,
  SectionPlan,
  Tick,
} from '../ir';

export interface DirectorInput {
  readonly sections: readonly FormSection[];
  readonly bars: readonly BarCell[];
  readonly tracks: readonly Track[];
  readonly registerField: ReadonlyMap<string, RegisterBand>;
  /** Roles legitimately excluded by the active template, with the reason. */
  readonly templateExclusions: ReadonlyMap<string, string>;
  /** Roles the user pinned out of the band. */
  readonly userExclusions: ReadonlySet<string>;
  readonly rng: () => number;
  /** Chord spans, so a fill can be aimed at a real gap. */
  readonly harmonySpans: readonly { startTick: number; endTick: number }[];
}

/**
 * How many voices the texture wants at a given energy. This is deliberately
 * continuous: at 0.2 a duo is right, at 0.9 the whole ensemble is.
 */
function wantedVoiceCount(energy: number, available: number): number {
  if (available <= 1) return available;
  const fraction = 0.25 + 0.75 * energy;
  return Math.max(1, Math.min(available, Math.round(available * fraction)));
}

/**
 * Rank roles for a texture from the lowest energy to the highest. The order
 * encodes orchestral convention: strings carry the core, winds add colour,
 * brass adds weight, percussion marks accents.
 */
function rankFor(role: string): { tier: number; character: 'low' | 'mid' | 'high' | 'pulse' | 'colour' } {
  if (role === 'cellosBasses' || role === 'basses' || role === 'tuba' || role === 'bassoons') {
    return { tier: 0, character: 'low' };
  }
  if (role === 'violas' || role === 'horns' || role === 'trombones' || role === 'clarinets') {
    return { tier: 1, character: 'mid' };
  }
  if (role === 'violins1' || role === 'violins2' || role === 'flutes' || role === 'oboes') {
    return { tier: 2, character: 'high' };
  }
  if (role === 'trumpets') return { tier: 3, character: 'high' };
  if (role === 'timpani' || role === 'snare' || role === 'cymbals' || role === 'aux') {
    return { tier: 4, character: 'pulse' };
  }
  if (role === 'harp') return { tier: 1, character: 'colour' };
  if (role === 'piano') return { tier: 2, character: 'colour' };
  return { tier: 2, character: 'mid' };
}

interface Candidate {
  readonly track: Track;
  readonly role: string;
  readonly band: RegisterBand;
  readonly tier: number;
  readonly character: ReturnType<typeof rankFor>['character'];
}

function collectCandidates(input: DirectorInput): Candidate[] {
  const candidates: Candidate[] = [];
  for (const track of input.tracks) {
    if (!isInstrumentTrack(track)) continue;
    if (track.locked) continue;                       // locks win, always
    if (input.userExclusions.has(track.role)) continue;
    if (input.templateExclusions.has(track.role)) continue;
    const band = input.registerField.get(track.id);
    if (!band) continue;
    // Piano is owned end-to-end by Piano Engine V5. The Director must not
    // claim it: assigning it a material role would put the melody on a track
    // this engine never writes, leaving the texture leaderless.
    if (track.role === 'piano') continue;
    const rank = rankFor(track.role);
    candidates.push({ track, role: track.role, band, tier: rank.tier, character: rank.character });
  }
  return candidates;
}

/**
 * Assigns musical roles within a section, given how many voices it wants.
 * The highest-ranked sounding voice takes the lead; the lowest takes the bass;
 * the rest distribute across inner/pad/counter.
 */
function assignRoles(
  voices: readonly Candidate[],
  density: number,
  rng: () => number,
): Map<string, { role: MusicalRole; layer: LayerName }> {
  const assigned = new Map<string, { role: MusicalRole; layer: LayerName }>();
  if (!voices.length) return assigned;

  const low = voices.filter((v) => v.character === 'low');
  const pulse = voices.filter((v) => v.character === 'pulse');
  const pitched = voices.filter((v) => v.character !== 'pulse' && v.character !== 'low');
  const lead = pitched[0] ?? voices[0];

  for (const voice of voices) {
    if (voice === lead) {
      assigned.set(voice.track.id, { role: 'lead', layer: 'lead' });
      continue;
    }
    if (low.includes(voice) && !assigned.has(voice.track.id)) {
      // One bass is the foundation; further low voices double it for weight,
      // which is a purposeful doubling rather than an accident.
      const bassTaken = [...assigned.values()].some((value) => value.role === 'bass');
      assigned.set(voice.track.id, bassTaken
        ? { role: 'inner', layer: 'bass' }
        : { role: 'bass', layer: 'bass' });
      continue;
    }
    if (pulse.includes(voice)) {
      assigned.set(voice.track.id, { role: 'accent', layer: 'percussion' });
      continue;
    }
    if (voice.character === 'colour') {
      assigned.set(voice.track.id, density > 0.6
        ? { role: 'pulse', layer: 'ostinato' }
        : { role: 'pad', layer: 'texture' });
      continue;
    }
    // Pitch-capable inner voices: alternate between support and a counterline
    // so the texture is not uniformly sustained.
    const isCounter = rng() < 0.45;
    assigned.set(voice.track.id, isCounter
      ? { role: 'counter', layer: 'counterline' }
      : { role: 'inner', layer: 'pad' });
  }
  return assigned;
}

export function direct(input: DirectorInput): OrchestraPlan {
  const candidates = collectCandidates(input).sort((a, b) => {
    // Highest-sounding voice first, so `pitched[0]` really is the top of the
    // texture and the melody is not handed to an instrument that sits below
    // another one. Tier orders the families (strings before winds before
    // brass before percussion); centroid orders within a family, descending.
    if (a.tier !== b.tier) return b.tier - a.tier;
    return b.band.centroid - a.band.centroid;
  });

  const sections: SectionPlan[] = [];
  for (const section of input.sections) {
    const sectionBars = input.bars.filter(
      (bar) => bar.startTick >= section.startTick && bar.startTick < section.endTick,
    );
    const meanEnergy = sectionBars.length
      ? sectionBars.reduce((sum, bar) => sum + bar.energy, 0) / sectionBars.length
      : 0.5;
    const density = clamp01(0.2 + 0.8 * meanEnergy);
    const wanted = wantedVoiceCount(meanEnergy, candidates.length);
    // Pick the wanted voices, always including the lowest so the texture has a
    // floor, then the highest so it has a top.
    const sounding = selectVoices(candidates, wanted, meanEnergy);
    const roles = assignRoles(sounding, density, input.rng);

    const participation: Participation[] = [];
    let leadRole: string | null = null;
    for (const voice of candidates) {
      const decision = roles.get(voice.track.id);
      const spans = decision
        ? spansForRole(decision.role, section, sectionBars)
        : [{ startTick: section.startTick, endTick: section.endTick }];
      const doubling = decision?.role === 'inner' && decision.layer === 'bass'
        ? { of: findBassRole(roles), reason: 'low-end weight at this energy' }
        : { of: null, reason: null };
      if (decision?.role === 'lead') leadRole = voice.role;
      participation.push({
        role: voice.role,
        trackId: voice.track.id,
        // A voice with no role still gets a decision: it sustains as texture
        // when the section is quiet, and rests when the texture is full.
        materialRole: decision?.role ?? (meanEnergy < 0.45 ? 'pad' : 'inner'),
        layer: decision?.layer ?? (meanEnergy < 0.45 ? 'texture' : 'pad'),
        spans,
        doublingOf: doubling.of,
        doublingReason: doubling.reason,
        register: voice.band,
      });
    }
    sections.push({ sectionId: section.id, participation, density, leadRole });
  }

  // Moments are only honest if they are audible. planMoments records which
  // roles are exposed (a soli) or which speak as one (a unison), but those
  // participant lists used to be reported and never applied, so every part
  // sounded through every moment: the soli at bars 25-28 had all four strings
  // playing. Narrow the non-participants' spans to the moment windows.
  const moments = planMoments(input, sections);
  return {
    sections: applyMoments(sections, moments),
    moments,
    // Fills are attached after realization (see planFillsFromRealisation):
    // they depend on where the ensemble ACTUALLY leaves room.
    fills: [],
  };
}

function findBassRole(roles: ReadonlyMap<string, { role: MusicalRole }>): string | null {
  for (const [trackId, value] of roles) if (value.role === 'bass') return trackId;
  return null;
}

/**
 * Which voices sound in a section. Always keeps a floor and a top when they
 * exist, then fills by tier — so a quiet section still has a bass and a lead
 * rather than an arbitrary subset.
 */
function selectVoices(
  candidates: readonly Candidate[],
  wanted: number,
  energy: number,
): Candidate[] {
  const selected: Candidate[] = [];
  const take = (voice: Candidate | undefined) => {
    if (voice && !selected.includes(voice) && selected.length < wanted) selected.push(voice);
  };
  const lowest = candidates[candidates.length - 1];
  const highest = candidates[0];
  if (energy >= 0.15) take(lowest);
  take(highest);
  for (const candidate of candidates) {
    if (selected.length >= wanted) break;
    take(candidate);
  }
  return selected;
}

/**
 * A lead sings the phrases; a pad sustains across them; a bass anchors the
 * harmony changes; a counter enters where the lead breathes.
 */
function spansForRole(
  role: MusicalRole,
  section: FormSection,
  bars: readonly BarCell[],
): { startTick: number; endTick: number }[] {
  if (!bars.length) return [{ startTick: section.startTick, endTick: section.endTick }];
  const spans: { startTick: number; endTick: number }[] = [];
  const groupSize = role === 'lead' || role === 'counter' ? 2 : 4;
  for (let index = 0; index < bars.length; index += groupSize) {
    const first = bars[index];
    const last = bars[Math.min(bars.length - 1, index + groupSize - 1)];
    spans.push({ startTick: first.startTick, endTick: last.endTick });
  }
  return spans;
}

/**
 * Moments are the orchestral punctuation: a tutti at a culmination, a soli
 * where the texture thins to expose one voice, a unison where the ensemble
 * should speak as one. Their participant roles are honest, because Piano V5
 * decides whether to yield by reading them.
 */
function planMoments(input: DirectorInput, sections: readonly SectionPlan[]): PlannedMoment[] {
  const moments: PlannedMoment[] = [];
  for (const section of input.sections) {
    const sectionBars = input.bars.filter(
      (bar) => bar.startTick >= section.startTick && bar.startTick < section.endTick,
    );
    if (!sectionBars.length) continue;
    const peakBar = sectionBars.reduce((best, bar) => (bar.energy > best.energy ? bar : best), sectionBars[0]);
    const plan = sections.find((candidate) => candidate.sectionId === section.id);
    if (!plan) continue;
    const sounding = plan.participation.filter((slot) => slot.materialRole !== 'pad' || plan.density < 0.5);

    if (section.function === 'culmination' && peakBar.energy >= 0.7) {
      moments.push({
        kind: 'tutti',
        startBar: peakBar.bar,
        endBar: peakBar.bar,
        startTick: peakBar.startTick,
        endTick: peakBar.endTick,
        participantRoles: plan.participation.map((slot) => slot.role),
        shape: 'hold',
      });
    } else if (section.function === 'contrast' && sounding.length >= 2) {
      const soloist = plan.participation.find((slot) => slot.materialRole === 'lead')
        ?? plan.participation[0];
      moments.push({
        kind: 'soli',
        startBar: sectionBars[0].bar,
        endBar: sectionBars[sectionBars.length - 1].bar,
        startTick: section.startTick,
        endTick: section.endTick,
        participantRoles: [soloist.role],
        shape: 'breath',
      });
    } else if (section.function === 'opening' && sectionBars.length >= 2) {
      const unisonBar = sectionBars[0];
      const leader = plan.participation.find((slot) => slot.materialRole === 'lead');
      if (leader) {
        moments.push({
          kind: 'unison',
          startBar: unisonBar.bar,
          endBar: unisonBar.bar,
          startTick: unisonBar.startTick,
          endTick: unisonBar.endTick,
          participantRoles: [leader.role, ...plan.participation
            .filter((slot) => slot.materialRole === 'bass')
            .map((slot) => slot.role)],
          shape: 'hold',
        });
      }
    }
  }
  return moments;
}

/**
 * Fill windows are real gaps the ensemble leaves, where a filling instrument
 * can speak. Target 'piano' is used only when the piano is actually present
 * and actually free — a fabricated window would give V5 unrequested freedom.
 */
/**
 * Fill windows: places where the ensemble actually leaves room.
 *
 * A fill must NOT be derived from planned spans alone. The family engines
 * hold a phrase-final note to the phrase end (idiomatic phrasing), which fills
 * the very gap the span list implied — a fill planned from spans therefore
 * overlapped real melody. Fills are computed from the REALISED parts instead,
 * and only in windows where the lead is genuinely silent.
 */
export function planFillsFromRealisation(
  input: DirectorInput,
  sections: readonly SectionPlan[],
  realised: readonly { trackId: string; notes: readonly { startTick: number; durationTicks: number }[] }[],
): PlannedFill[] {
  const fills: PlannedFill[] = [];
  const piano = input.tracks.find((track) => isInstrumentTrack(track) && track.role === 'piano');
  // No piano in the project means no piano fill: do not invent an opportunity
  // for an instrument that cannot take it.
  if (!piano || piano.locked) return fills;
  const leadTrackIds = new Set<string>();
  for (const section of sections) {
    for (const slot of section.participation) {
      if (slot.materialRole === 'lead') leadTrackIds.add(slot.trackId);
    }
  }
  if (!leadTrackIds.size) return fills;
  const leadNotes = realised
    .filter((part) => leadTrackIds.has(part.trackId))
    .flatMap((part) => part.notes)
    .sort((a, b) => a.startTick - b.startTick);
  const minGap = input.bars[0] ? input.bars[0].endTick - input.bars[0].startTick : 1920;

  // A real gap in the lead's sounding line, long enough to be music.
  let cursor = 0;
  for (const note of leadNotes) {
    if (note.startTick - cursor >= minGap) {
      fills.push({ target: 'piano', startTick: cursor, endTick: note.startTick });
    }
    cursor = Math.max(cursor, note.startTick + note.durationTicks);
  }
  return fills;
}


const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Remove the moment windows from every role that is NOT a participant, so a
 * soli really exposes one voice and a unison really thins to leader and bass.
 * A gap between spans is an intentional rest; this is where they are created.
 */
function applyMoments(
  sections: readonly SectionPlan[],
  moments: readonly PlannedMoment[],
): SectionPlan[] {
  if (!moments.length) return sections.map((section) => ({ ...section }));
  return sections.map((section) => {
    const participation = section.participation.map((slot) => {
      const windows = moments
        .filter((moment) => !moment.participantRoles.includes(slot.role))
        .map((moment) => ({ startTick: moment.startTick, endTick: moment.endTick }));
      if (!windows.length) return slot;
      const spans = subtractWindows(slot.spans, windows);
      return { ...slot, spans };
    });
    return { ...section, participation };
  });
}

/** Subtract tick windows from spans, splitting where a window lands mid-span. */
function subtractWindows(
  spans: readonly { readonly startTick: Tick; readonly endTick: Tick }[],
  windows: readonly { readonly startTick: Tick; readonly endTick: Tick }[],
): { startTick: Tick; endTick: Tick }[] {
  let remaining = spans.map((span) => ({ startTick: span.startTick, endTick: span.endTick }));
  for (const window of windows) {
    const next: { startTick: Tick; endTick: Tick }[] = [];
    for (const span of remaining) {
      if (window.endTick <= span.startTick || window.startTick >= span.endTick) {
        next.push(span);
        continue;
      }
      if (window.startTick > span.startTick) next.push({ startTick: span.startTick, endTick: window.startTick });
      if (window.endTick < span.endTick) next.push({ startTick: window.endTick, endTick: span.endTick });
    }
    remaining = next;
  }
  return remaining
    .filter((span) => span.endTick > span.startTick)
    .sort((a, b) => a.startTick - b.startTick);
}
