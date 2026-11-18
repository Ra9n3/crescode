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
import { comfyWindowOf, isStringRole, realizeStrings } from './families/strings';
import type { RegisterBand } from './ir';
import { compile, type CompileResult } from './compile';
import { buildCcLanesFor } from './perform/cc';
import { seal, type SealViolation } from './seal';
import { buildConductorPlanForPiano, unannotatedRolesFor } from './adapters/piano';
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
  const { phrases, statements } = buildPhrases(sections, grid, primary, secondary, phraseRng);
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
  const slotOf = new Map(byChoir.map((track, index) => [track.id, index]));

  // Family stack. The lead sings in the upper part of its own window; every
  // other string voice is capped BELOW the lead's floor, so the choir cannot
  // invert (an inner voice above the melody is a voice-crossing defect).
  const leadBank = (band: RegisterBand): number => {
    const [low] = comfyWindowOf(band);
    // A fifth above the bottom of the window: high enough to sit over the
    // inner voices, low enough that the melody is not forced into the rafters
    // (a floor at 45% of a 25-semitone window forced 9-semitone leaps).
    return Math.round(low + 7);
  };
  const anyLead = [...leadTrackIds]
    .map((id) => registerField.get(id))
    .find((band): band is RegisterBand => Boolean(band));
  const leadFloor = anyLead ? leadBank(anyLead) : null;

  // Iterate the choir order, NOT the raw roster order: the lead must be
  // realised before the voices that are bounded by it, or the counterline is
  // written against a lead that does not exist yet.
  for (const track of byChoir) {
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
      stackFloor: leadTrackIds.has(track.id) ? leadFloor : null,
      stackCeiling: leadTrackIds.has(track.id) || leadFloor === null ? null : leadFloor - 1,
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
