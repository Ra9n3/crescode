/**
 * Composition brief (Strings V1, Stage 1) — a deterministic, data-only
 * description of the composition, read from what the project provides.
 *
 * `facts` are copied or counted from the project, the template and the
 * existing energy arc. `readings` are simple interpretations of those facts
 * and say how they were derived. `notDerived` lists what later stages will
 * need and this stage does not know; those fields stay null.
 *
 * No randomness: the same inputs give the same brief.
 */
import { hashString } from '../../../engine/generate';
import type { EnsembleTemplate } from '../../../shared/schema/ensembleTemplate';
import { barTicks, beatOffsets, beatTicks, isCompound, projectBars, projectEndTick } from '../../../shared/schema/meter';
import { scalePitchClasses } from '../../../shared/schema/modes';
import type { Project, ProjectEnsemble } from '../../../shared/schema/types';
import { splitEngaged, BASSES_ROLE } from '../../basses';
import { sectionTypeKeyOf } from '../../conductor/layers';
import { stringVoiceTracks } from '../../profiles/strings';
import { orchestrationInputs, orchestrationSeedFor, type ArcBar, type SpineSection } from '../../spine';

export interface BriefSection {
  readonly id: string;
  readonly name: string;
  /** Lower-cased section name: sections sharing it are occurrences of one type. */
  readonly typeKey: string;
  readonly occurrence: number;
  readonly startBar: number;
  readonly lengthBars: number;
  readonly startTick: number;
  readonly endTick: number;
  /** Mean and peak of the existing arc over the section; null when no arc was supplied. */
  readonly meanEnergy: number | null;
  readonly peakEnergy: number | null;
}

export interface CompositionBrief {
  readonly version: 1;
  readonly facts: {
    readonly identity: {
      /** Hash of the musical inputs (chords, structure, key, mode, tempo, band). Unchanged by a new take. */
      readonly projectSeed: number;
      /** The take this brief describes. */
      readonly take: number;
      /** The existing orchestration seed for (inputs, take). */
      readonly takeSeed: number;
    };
    readonly tonality: { readonly key: number; readonly mode: string; readonly scalePitchClasses: readonly number[] };
    readonly time: {
      readonly bpm: number;
      readonly tempoChanges: number;
      readonly numerator: number;
      readonly denominator: number;
      readonly compound: boolean;
      readonly beatsPerBar: number;
      readonly barTicks: number;
      readonly beatTicks: number;
      readonly bars: number;
      readonly endTick: number;
    };
    readonly template: {
      readonly id: string | null;
      readonly name: string | null;
      /** Roles of the string tracks that will sound (in the band, unlocked), bass slot first. */
      readonly stringVoiceRoles: readonly string[];
      /** True when the existing pipeline creates or refills a Double Basses track for this project. */
      readonly bassDesk: boolean;
    };
    /** False when the project has no sections and the whole song reads as one section. */
    readonly sectionsProvided: boolean;
    readonly sections: readonly BriefSection[];
    readonly energy: {
      readonly available: boolean;
      readonly min: number | null;
      readonly max: number | null;
      readonly mean: number | null;
      readonly peakBar: number | null;
      readonly peakSectionId: string | null;
      readonly nearSilenceBars: readonly number[];
    };
  };
  readonly readings: {
    /** 'minor-like' when the mode's third degree is a minor third above the tonic, else 'major-like'. */
    readonly modeColour: 'major-like' | 'minor-like';
    /** Section ids grouped by type key, in song order: the only section relationship the project states. */
    readonly sectionRecurrence: Readonly<Record<string, readonly string[]>>;
    /** Section ids ordered from the highest mean energy to the lowest; empty without an arc. */
    readonly sectionsByEnergy: readonly string[];
  };
  /** Reserved for later stages. Null means "not derived", never "none". */
  readonly vocabulary: {
    readonly melodic: null;
    readonly rhythmic: null;
    readonly dissonanceTolerance: null;
    readonly secondTheme: null;
  };
  readonly notDerived: readonly string[];
}

export interface BriefInput {
  readonly project: Project;
  readonly template: EnsembleTemplate | null;
  readonly ensemble: ProjectEnsemble;
  readonly sections: readonly SpineSection[];
  readonly arc?: readonly ArcBar[];
  /** The take being composed. */
  readonly take: number;
}

const round = (value: number): number => Math.round(value * 1000) / 1000;

export function buildCompositionBrief(input: BriefInput): CompositionBrief {
  const { project, template, ensemble, sections, arc, take } = input;
  const ts = project.timeSignature;
  const scale = scalePitchClasses(project.key, project.mode);
  const thirdAboveTonic = scale.map((pc) => (pc - project.key + 12) % 12).includes(3) && !scale.map((pc) => (pc - project.key + 12) % 12).includes(4);
  const arcOf = (section: SpineSection): number[] =>
    (arc ?? []).filter((b) => b.bar >= section.startBar && b.bar < section.startBar + section.lengthBars).map((b) => b.target);

  const briefSections: BriefSection[] = sections.map((s) => {
    const targets = arcOf(s);
    return {
      id: s.id,
      name: s.name,
      typeKey: sectionTypeKeyOf(s.name),
      occurrence: s.occurrence,
      startBar: s.startBar,
      lengthBars: s.lengthBars,
      startTick: s.startTick,
      endTick: s.endTick,
      meanEnergy: targets.length ? round(targets.reduce((a, b) => a + b, 0) / targets.length) : null,
      peakEnergy: targets.length ? round(Math.max(...targets)) : null,
    };
  });

  const targets = (arc ?? []).map((b) => b.target);
  const peak = arc && arc.length ? arc.reduce((best, b) => (b.target > best.target ? b : best), arc[0]) : null;
  const recurrence: Record<string, string[]> = {};
  for (const s of briefSections) recurrence[s.typeKey] = [...(recurrence[s.typeKey] ?? []), s.id];

  const voiceTracks = stringVoiceTracks({ project, ensemble, template });
  const cello = voiceTracks.find((t) => t.role === 'cellosBasses');
  const ownBasses = project.tracks.some((t) => t.role === BASSES_ROLE);

  return {
    version: 1,
    facts: {
      identity: {
        projectSeed: hashString(orchestrationInputs(project)),
        take,
        takeSeed: orchestrationSeedFor(project, { ...(project.orchestration ?? {}), take }),
      },
      tonality: { key: project.key, mode: project.mode, scalePitchClasses: scale },
      time: {
        bpm: project.bpm,
        tempoChanges: Math.max(0, project.tempoMap.length - 1),
        numerator: ts.numerator,
        denominator: ts.denominator,
        compound: isCompound(ts),
        beatsPerBar: beatOffsets(ts).length,
        barTicks: barTicks(ts),
        beatTicks: beatTicks(ts),
        bars: projectBars(project),
        endTick: projectEndTick(project),
      },
      template: {
        id: template?.id ?? null,
        name: template?.name ?? null,
        stringVoiceRoles: voiceTracks.map((t) => t.role),
        bassDesk: (!!cello && splitEngaged(template)) || ownBasses,
      },
      sectionsProvided: project.sections.length > 0,
      sections: briefSections,
      energy: {
        available: targets.length > 0,
        min: targets.length ? round(Math.min(...targets)) : null,
        max: targets.length ? round(Math.max(...targets)) : null,
        mean: targets.length ? round(targets.reduce((a, b) => a + b, 0) / targets.length) : null,
        peakBar: peak?.bar ?? null,
        peakSectionId: peak?.sectionId ?? null,
        nearSilenceBars: (arc ?? []).filter((b) => b.nearSilence).map((b) => b.bar),
      },
    },
    readings: {
      modeColour: thirdAboveTonic ? 'minor-like' : 'major-like',
      sectionRecurrence: recurrence,
      sectionsByEnergy: briefSections
        .filter((s) => s.meanEnergy !== null)
        .sort((a, b) => (b.meanEnergy as number) - (a.meanEnergy as number) || a.startBar - b.startBar)
        .map((s) => s.id),
    },
    vocabulary: { melodic: null, rhythmic: null, dissonanceTolerance: null, secondTheme: null },
    notDerived: [
      'melodic vocabulary: no melodic material exists in the project; chosen in the material stage',
      'rhythmic vocabulary: the project states tempo and metre only; chosen in the material stage',
      'dissonance tolerance: not stated by the project or the template',
      'second theme and its kinship: chosen in the material stage',
      'section relationships beyond recurrence of a section name: not stated by the project',
      'vocal melody, vocal activity and vocal phrase boundaries: the project holds no vocal data',
    ],
  };
}
