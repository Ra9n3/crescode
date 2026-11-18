/**
 * The new orchestration engine — public entry point.
 *
 *   Musical Context -> Composition Intelligence -> Orchestration Director
 *   -> Family Realization -> Performance/MIDI -> Track[]
 *
 * Phase 1 scope: the strings family is fully realised. Winds, brass,
 * percussion and harp are NOT yet implemented; their tracks are left exactly
 * as they were rather than being filled with placeholder material.
 *
 * This module is intentionally NOT wired into Compose All. The hard switch at
 * `store.ts:401` is Phase 6 work.
 */
import { isInstrumentTrack, type Project, type Track } from '../shared/schema/types';
import { scalePitchClasses } from '../shared/schema/modes';
import { resolveTemplate } from '../config/ensembles';
import { isInBand } from '../shared/schema/band';
import {
  buildBars,
  buildEnergy,
  buildGrid,
  buildHarmony,
  buildSections,
  registerFieldFor,
} from './context';
import {
  buildPhrases,
  generateCounterMotif,
  generateMotif,
  hashString,
  makeRng,
} from './material';
import { direct, planFillsFromRealisation } from './director';
import { isStringRole, realizeStrings } from './families/strings';
import {
  coordinateVoices,
  defaultRegisterPolicy,
  planVoicing,
  voicedWindowOf,
  voicingQuery,
} from './voicing';
import type { RegisterBand } from './ir';
import { compile, type CompileResult } from './compile';
import { buildCcLanesFor } from './perform/cc';
import { seal, type SealViolation } from './seal';
import { buildConductorPlanForPiano, unannotatedRolesFor } from './adapters/piano';
const EMPTY_PITCH_CLASSES: ReadonlySet<number> = new Set<number>();

import {
  ENGINE_VERSION,
  type HarmonicSpan,
  type Motif,
  type MusicalPart,
  type OrchestraScore,
  type Participation,
} from './ir';

export interface ComposeOrchestraOptions {
  /** User-facing seed. Same seed + same project => identical music. */
  readonly seed?: number;
  /** Take, matching the store's compose-take semantics. */
  readonly take?: number;
}

export interface ComposeOrchestraResult {
  readonly tracks: Track[];
  readonly score: OrchestraScore;
  readonly violations: SealViolation[];
  readonly reports: string[];
  /** The plan handed to Piano V5's input builder. */
  readonly pianoPlan: ReturnType<typeof buildConductorPlanForPiano>;
}

export function composeOrchestra(
  project: Project,
  options: ComposeOrchestraOptions = {},
): ComposeOrchestraResult {
  const seed = Math.trunc(options.seed ?? 1);
  const take = Math.max(0, Math.trunc(options.take ?? 1));
  const reports: string[] = [];

  /* ---- Layer 1: context ---- */
  const grid = buildGrid(project);
  const sections = buildSections(project, grid);
  const harmony = buildHarmony(project, grid);
  const energy = buildEnergy(sections, grid);
  const bars = buildBars(sections, grid, energy);
  const registerField = registerFieldFor(project.tracks);
  const energyAt = (bar: number): number => energy[Math.max(0, Math.min(energy.length - 1, bar - 1))] ?? 0.5;

  /* ---- eligibility: the roster is the project ---- */
  const template = resolveTemplate(project.ensemble);
  const templateExclusions = new Map<string, string>();
  if (template) {
    const roster = new Set(template.roster.map((entry) => entry.role));
    for (const track of project.tracks) {
      if (!isInstrumentTrack(track)) continue;
      if (!roster.has(track.role)) {
        templateExclusions.set(track.role, `not in the "${template.name}" roster`);
      }
    }
  }
  const userExclusions = new Set<string>();
  const ensemble = project.ensemble ?? { templateId: null, overrides: {}, pins: {} };
  for (const track of project.tracks) {
    if (!isInstrumentTrack(track)) continue;
    if (!isInBand(track.role, ensemble, template)) userExclusions.add(track.role);
  }

  /* ---- Layer 2: material ---- */
  const inputHash = hashString(JSON.stringify({
    key: project.key, mode: project.mode, bpm: project.bpm,
    ts: project.timeSignature, chords: project.chords.map((c) => c.symbol),
    sections: project.sections.map((s) => [s.name, s.startBar, s.lengthBars]),
    seed, take,
  }));
  const rosterHash = hashString(project.tracks.filter(isInstrumentTrack).map((t) => t.role).sort().join(','));
  const motifRng = makeRng((inputHash ^ hashString(`motif:${take}`)) >>> 0);
  const primary = generateMotif(project, motifRng, grid.beatTicks, sections[0]?.startBar ?? 1);
  const secondary = generateCounterMotif(project, motifRng, grid.beatTicks, sections[0]?.startBar ?? 1);
  const phraseRng = makeRng((inputHash ^ hashString(`phrase:${take}`)) >>> 0);
  const scaleSize = Math.max(1, scalePitchClasses(project.key, project.mode).length);
  const { phrases, statements } = buildPhrases(sections, grid, primary, secondary, phraseRng, scaleSize);
  const motifs = new Map<string, Motif>([[primary.id, primary], [secondary.id, secondary]]);
  reports.push(
    `material: motif "${primary.id}" (${primary.degrees.length} events), counter "${secondary.id}"; ` +
    `${phrases.length} phrases, ${statements.length} statements ` +
    `[${[...new Set(statements.map((s) => s.op))].join(', ')}]`,
  );

  /* ---- Layer 3: director ---- */
  const directorRng = makeRng((inputHash ^ hashString(`director:${take}`)) >>> 0);
  const plan = direct({
    sections,
    bars,
    tracks: project.tracks,
    registerField,
    templateExclusions,
    userExclusions,
    rng: directorRng,
    harmonySpans: harmony,
  });
  reports.push(
    `director: ${plan.sections.length} section plans, ${plan.moments.length} moments ` +
    `[${[...new Set(plan.moments.map((m) => m.kind))].join(', ') || 'none'}], ${plan.fills.length} piano fill window(s)`,
  );

  /* ---- Layer 4: family realization (strings only, phase 1) ---- */
  const parts: MusicalPart[] = [];
  // Per-section participation, so a track's role and spans differ by section
  // instead of being overwritten by whichever section came last.
  const participationBySection = new Map<string, Map<string, Participation>>();
  for (const section of plan.sections) {
    const byTrack = new Map<string, Participation>();
    for (const slot of section.participation) byTrack.set(slot.trackId, slot);
    participationBySection.set(section.sectionId, byTrack);
  }
  const stringTracks = project.tracks.filter(
    (track) => isInstrumentTrack(track) && isStringRole(track.role) && !track.locked
      && !userExclusions.has(track.role) && !templateExclusions.has(track.role),
  );
  // Choir layout. Orchestral convention is authoritative here: Violins I sit
  // ABOVE Violins II, violas below, cellos/basses at the floor. The register
  // centroids of Vln I and Vln II are nearly identical, so centroid sorting
  // put them the wrong way round; a string-family order is the honest answer.
  const CHOIR_ORDER = ['violins1', 'violins2', 'violas', 'cellosBasses', 'basses'];
  const choirRank = (role: string): number => {
    const index = CHOIR_ORDER.indexOf(role);
    return index >= 0 ? index : CHOIR_ORDER.length;
  };
  // Whoever carries the lead sings on top; the rest stack beneath in choir
  // order. Fixing slots purely by instrument name let an inner voice sit
  // above the melody when the Director gave the lead to Violins II.
  const leadTrackIds = new Set<string>();
  for (const section of plan.sections) {
    for (const slot of section.participation) {
      if (slot.materialRole === 'lead') leadTrackIds.add(slot.trackId);
    }
  }
  const byChoir = [...stringTracks].sort((a, b) => {
    const leadDelta = Number(leadTrackIds.has(b.id)) - Number(leadTrackIds.has(a.id));
    if (leadDelta !== 0) return leadDelta;
    return choirRank(a.role) - choirRank(b.role);
  });
  // Realisation ORDER differs from choir order. The choir order above decides
  // who sits where; this decides who is written first, and it matters because
  // each accompanying voice avoids the chord tones already sounding. The bass
  // is harmonically load-bearing — if the inner voices are written first they
  // consume the free tones and the bass is forced onto one already in use,
  // which is exactly the doubling being fixed. So: lead, then bass, then the
  // inner voices from the top down.
  // Which tracks the Director actually gave the BASS material to. Keying this
  // off the instrument NAME would be wrong: in sonata the cellos carry the
  // melody in the verse while the violins take the inner line, so a name-based
  // rule would re-order voices against the Director's decision.
  const bassMaterialTrackIds = new Set<string>();
  for (const section of plan.sections) {
    for (const slot of section.participation) {
      if (slot.materialRole === 'bass') bassMaterialTrackIds.add(slot.trackId);
    }
  }
  const byRealisationOrder = [...byChoir].sort((a, b) => {
    const leadDelta = Number(leadTrackIds.has(b.id)) - Number(leadTrackIds.has(a.id));
    if (leadDelta !== 0) return leadDelta;
    const bassDelta = Number(bassMaterialTrackIds.has(b.id)) - Number(bassMaterialTrackIds.has(a.id));
    if (bassDelta !== 0) return bassDelta;
    return choirRank(a.role) - choirRank(b.role);
  });
  const slotOf = new Map(byChoir.map((track, index) => [track.id, index]));

  // ---- coordinated chord-tone assignment --------------------------------
  // Accompanying voices must not all take the same chord tone. Two inner
  // voices handed the same tone land on the same pitch CLASS in their own
  // registers, and a same pitch class sounding together IS an octave doubling
  // however far apart the octaves sit — the doubling rule is defined over
  // pitch class, so independent octave placement can never fix it.
  //
  // Distinct tones are handed out by choir position instead: the lead is
  // excluded (it carries the melody), the bass takes the chord's own bass, and
  // the remaining voices walk the span's tones from index 1 upward. Voices
  // whose parts do not overlap in a span may share a tone, but any two
  // accompanying voices CAN overlap, so each gets its own index.
  const doublingPolicy = template?.rules.find((rule) => rule.type === 'octaveDoubling');
  const policyKind = String((doublingPolicy?.params as { policy?: string } | undefined)?.policy ?? 'allowed');
  const accompanying = byChoir.filter((track) => !leadTrackIds.has(track.id));
  // Under 'allowed' the policy asks for nothing, so the historical constants
  // stay exactly as they were; only the policies that actually forbid a
  // doubling need the tones distributed.
  const chordToneSlots = new Map<string, number>();
  if (policyKind !== 'allowed') {
    let nextSlot = 1;
    for (const track of accompanying) {
      // The bass role reads span.bass and ignores the slot; skipping it keeps
      // the inner voices starting at 1, exactly where they are today.
      if (track.role === 'basses' || track.role === 'cellosBasses') continue;
      chordToneSlots.set(track.id, nextSlot);
      nextSlot += 1;
    }
  }
  reports.push(
    `voice-leading: doubling policy "${policyKind}"; chord tones distributed across ` +
    `${chordToneSlots.size} accompanying voice(s)` +
    (chordToneSlots.size ? ` [${[...chordToneSlots].map(([id, slot]) => `${project.tracks.find((t) => t.id === id)?.role ?? id}=${slot}`).join(', ')}]` : ''),
  );

  /**
   * Pitch classes already sounding from the parts realised SO FAR, across a
   * span. Voices are realised lead-first, so an accompanying voice sees the
   * lead (and any earlier voice) and can pick a chord tone that avoids it.
   *
   * Under 'allowed' this returns nothing on purpose: the template asks for no
   * coordination, so every voice keeps its historical independent choice.
   */
  const soundingPitchClassesAcross = (start: number, end: number): ReadonlySet<number> => {
    if (policyKind === 'allowed') return EMPTY_PITCH_CLASSES;
    const classes = new Set<number>();
    for (const realised of parts) {
      // A track's OWN part can already be realised (a track that carries the
      // lead in one section and an inner line in another is written once, in
      // the lead pass). Reading its own notes back as "another voice sounding"
      // made the voice avoid itself and, worse, pushed it off the tone it was
      // about to play. Only other parts count.
      if (realised.trackId === currentTrackId) continue;
      for (const note of realised.notes) {
        if (note.startTick < end && start < note.startTick + note.durationTicks) {
          classes.add(((note.pitch % 12) + 12) % 12);
        }
      }
    }
    return classes;
  };

  // ---- coordinated voice-leading -----------------------------------------
  // The stack used to be expressed as ONE number: a `leadFloor` derived from
  // whichever instrument held the lead, imposed as a hard ceiling on every
  // other voice. That is instrument-relative, and it was wrong whenever the
  // lead instrument was not the highest one: when the cellos carried the tune
  // the violins were capped at cello_floor - 1 and written at 49-56, a full
  // octave below their own comfortable window (358 notes on the baseline).
  //
  // The stack is therefore no longer a single number. Each voice is bounded by
  // ITS OWN instrument window, and the vertical ordering of the ensemble comes
  // from the coordinated plan (`planVoicing`), which orders voices by musical
  // role rather than by which instrument happens to be playing it.
  //
  // Register containment is unconditional: it does not depend on the doubling
  // policy, because a note outside the instrument's own register is a defect
  // under every template. Only chord-tone coordination is policy-gated.
  const voicingPlan = planVoicing({
    sections: plan.sections.map((section) => ({
      sectionId: section.sectionId,
      participation: section.participation,
    })),
    harmony,
    bandFor: (trackId) => registerField.get(trackId) ?? null,
    policy: defaultRegisterPolicy(policyKind !== 'allowed'),
  });
  const voicing = voicingQuery(voicingPlan);

  // The floor depends on the voice's role IN THIS SECTION, not on a piece-wide
  // union of everything it ever does. Keying it off the union meant a track
  // that leads in one chorus lost its floor in every verse too, which is how
  // violins1 kept landing at 49 while playing an inner line.
  const stackFloorForSection = (trackId: string, band: RegisterBand) =>
    (sectionId: string): number | null => {
      const slot = participationBySection.get(sectionId)?.get(trackId);
      if (!slot) return null;
      if (slot.materialRole === 'lead') return null;
      return voicedWindowOf(band)[0];
    };

  // Iterate the choir order, NOT the raw roster order: the lead must be
  // realised before the voices that are bounded by it, or the counterline is
  // written against a lead that does not exist yet.
  let currentTrackId = '';
  for (const track of byRealisationOrder) {
    currentTrackId = track.id;
    const band = registerField.get(track.id);
    if (!band) continue;
    const part = realizeStrings({
      project,
      participationFor: (sectionId) => participationBySection.get(sectionId)?.get(track.id) ?? null,
      register: band,
      voiceSlot: slotOf.get(track.id) ?? 0,
      phrases,
      statements,
      motifs,
      harmony,
      bars,
      beatTicks: grid.beatTicks,
      energyAt,
      leadPitchClasses: leadPitchClassesFor(track.id, plan, parts),
      chordToneSlot: chordToneSlots.get(track.id),
      soundingPitchClasses: soundingPitchClassesAcross,
      // The floor is the voice's OWN window, never another instrument's. The
      // lead gets no floor (it sits where its window puts it) and the ceiling
      // is applied per note from the sounding lead inside the realization
      // loop, so a lower voice still cannot cross above the melody.
      stackFloor: null,
      stackFloorForSection: stackFloorForSection(track.id, band),
      stackCeiling: null,
      voicing,
      coordinateChordTones: policyKind !== 'allowed',
      // Chord-tone coordination is policy-gated: under 'allowed' the template
      // asks for no coordination and the historical choice stands.
      // Chord-tone allocation is done ONCE for the whole ensemble after every
      // part exists (see `coordinateVoices` below), not per voice inside the
      // realization loop. Deciding in the loop made the result depend on
      // realization order, and the first voice had nothing to avoid.
      // The parts are realised lead-first (descending centroid), so when a
      // counterline is written the lead is already in `parts` and its real
      // pitches can bound the counter note by note.
      leadPitchAt: (tick: number): number | null => {
        const lead = parts.find((candidate) => leadTrackIds.has(candidate.trackId));
        if (!lead) return null;
        const note = lead.notes.find(
          (candidate) =>
            candidate.startTick <= tick
            && candidate.startTick + candidate.durationTicks > tick,
        );
        return note ? note.pitch : null;
      },
    });
    const realised: MusicalPart = { ...part, trackId: track.id, role: track.role };
    parts.push(realised);
    const roleNames = [...new Set(plan.sections
      .map((section) => participationBySection.get(section.sectionId)?.get(track.id)?.materialRole)
      .filter(Boolean))];
    reports.push(
      `strings: ${track.role} -> ${roleNames.join('/')} (${realised.notes.length} notes, ` +
      `${realised.restSpans.length} rest span(s), ${registerSummary(realised)})`,
    );
  }
  // ---- coordinated vertical resolution ----------------------------------
  // Runs ONCE, after every part exists. This is the only position from which
  // the whole sonority at an instant is visible; deciding inside the per-voice
  // realization loop inevitably depends on which voice happened to be written
  // first. Melodic voices keep their pitch class; accompanying voices move to
  // the nearest free chord tone inside their OWN register.
  const coordinated = coordinateVoices(
    parts.map((part) => ({
      trackId: part.trackId,
      role: part.role,
      register: part.register,
      notes: part.notes.map((note) => ({
        pitch: note.pitch,
        startTick: note.startTick,
        durationTicks: note.durationTicks,
        role: note.role,
      })),
    })),
    {
      coordinateChordTones: policyKind !== 'allowed',
      chordAt: (tick) => {
        const span = harmony.find((candidate) => candidate.startTick <= tick && tick < candidate.endTick);
        return span ? { pitchClasses: span.pitchClasses, bass: span.bass } : null;
      },
    },
  );
  const coordinatedByTrack = new Map(coordinated.parts.map((part) => [part.trackId, part]));
  for (let index = 0; index < parts.length; index++) {
    const next = coordinatedByTrack.get(parts[index].trackId);
    if (!next) continue;
    // Rebuild rather than mutate: RealizedNote is immutable by contract.
    parts[index] = {
      ...parts[index],
      notes: next.notes.map((note, noteIndex) => ({
        ...parts[index].notes[noteIndex],
        pitch: note.pitch,
      })),
    };
  }
  reports.push(
    `coordination: policy "${policyKind}"; ${coordinated.report.spanCount} vertical slice(s), ` +
    `${coordinated.report.forcedDoublings} forced doubling(s), ` +
    `${coordinated.report.accidentalDoublings} unresolved`,
  );

  const unrealisedStringRoles = stringTracks
    .filter((track) => !parts.some((part) => part.trackId === track.id))
    .map((track) => track.role);
  if (unrealisedStringRoles.length) {
    reports.push(`strings: no participation decision for ${unrealisedStringRoles.join(', ')}`);
  }

  /* ---- fills, derived from what actually sounds ---- */
  const fills = planFillsFromRealisation(
    {
      sections, bars, tracks: project.tracks, registerField,
      templateExclusions, userExclusions, rng: directorRng, harmonySpans: harmony,
    },
    plan.sections,
    parts,
  );
  if (fills.length) reports.push(`fills: ${fills.length} piano window(s) in genuine lead gaps`);
  const planWithFills = { ...plan, fills };

  /* ---- assemble the score ---- */
  const score: OrchestraScore = {
    meta: { seed, take, inputHash: inputHash.toString(16), rosterHash: rosterHash.toString(16), engineVersion: ENGINE_VERSION, templateId: template?.id ?? null },
    grid,
    bars,
    sections,
    harmony,
    motifs: [...motifs.values()],
    statements,
    phrases,
    plan: planWithFills,
    parts,
  };

  /* ---- Layer 5 / compile ---- */
  // ---- Layer 5: performance realization (CC from intention) ----
  const ccByTrackId = buildCcLanesFor({
    score,
    parts,
    energyAtTick: (tick) => energyAt(Math.floor(tick / grid.barTicks) + 1),
  });
  if (ccByTrackId.size) {
    const summary = [...ccByTrackId.entries()].map(([id, lanes]) => {
      const role = project.tracks.find((track) => track.id === id)?.role ?? id;
      return `${role} ${lanes.length}L/${lanes.reduce((sum, lane) => sum + lane.points.length, 0)}P`;
    });
    reports.push(`cc: ${summary.join(', ')}`);
  }

  const compiled: CompileResult = compile(score, project, ccByTrackId);

  const originalTrackIds = project.tracks.map((track) => track.id);
  const violations = seal(score, {
    originalTrackIds,
    finalTrackIds: compiled.tracks.map((track) => track.id),
    exemptTrackIds: new Set(compiled.untouchedTrackIds),
  });

  const realisedRoles = new Set(parts.map((part) => part.role));
  const instrumentRoles = project.tracks
    .filter((track) => isInstrumentTrack(track))
    .map((track) => track.role);
  const pianoPlan = buildConductorPlanForPiano({
    plan: planWithFills,
    sections,
    bars,
    templateId: template?.id ?? null,
    unannotatedRoles: unannotatedRolesFor(instrumentRoles, realisedRoles),
  });

  const coverage = [...new Set(plan.sections.flatMap((section) =>
    section.participation.map((slot) => `${slot.role}:${slot.materialRole}`)))];
  reports.push(`director coverage: ${coverage.join(', ')}`);

  return { tracks: compiled.tracks, score, violations, reports, pianoPlan };
}

/**
 * Pitch classes the lead is currently sounding, so a counterline can avoid
 * shadowing it an octave apart. Reads already-realised parts only.
 */
function leadPitchClassesFor(
  trackId: string,
  plan: ReturnType<typeof direct>,
  parts: readonly MusicalPart[],
): Set<number> {
  const leadTrackIds = new Set<string>();
  for (const section of plan.sections) {
    for (const slot of section.participation) {
      if (slot.materialRole === 'lead' && slot.trackId !== trackId) leadTrackIds.add(slot.trackId);
    }
  }
  const classes = new Set<number>();
  for (const part of parts) {
    if (!leadTrackIds.has(part.trackId)) continue;
    for (const note of part.notes) classes.add(((note.pitch % 12) + 12) % 12);
  }
  return classes;
}

function registerSummary(part: MusicalPart): string {
  if (!part.notes.length) return 'empty';
  const pitches = part.notes.map((note) => note.pitch);
  return `range ${Math.min(...pitches)}-${Math.max(...pitches)}, comfy ${part.register.comfortable[0]}-${part.register.comfortable[1]}`;
}

export { buildConductorPlanForPiano } from './adapters/piano';
export type { OrchestraScore, OrchestraPlan } from './ir';
export { ENGINE_VERSION } from './ir';
export type { HarmonicSpan };
