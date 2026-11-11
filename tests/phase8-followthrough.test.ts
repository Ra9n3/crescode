import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Project, Note } from '../src/shared/schema/types';
import { PPQ } from '../src/shared/schema/types';
import { projectEndTick } from '../src/shared/schema/meter';
import { analyzePianoInput } from '../src/orchestrator/keys/piano-analyzer';
import {
  composePianoPlan,
  type PianoComposerPlan,
  type PianoFillDecision,
} from '../src/orchestrator/keys/piano-composer';
import type { PianoEngineInput } from '../src/orchestrator/keys/piano-engine';
import {
  realizePianoPlan,
  realizePianoPlanWithAudit,
  type PianoRealizerTarget,
} from '../src/orchestrator/keys/piano-realizer';

const TEMPLATE_SLUGS = ['chamber', 'sonata', 'vocal-backing', 'cinematic', 'hybrid-studio'] as const;
type TemplateSlug = (typeof TEMPLATE_SLUGS)[number];

interface EvaluationCase {
  readonly slug: TemplateSlug;
  readonly input: PianoEngineInput;
  readonly project: Project;
  readonly target: PianoRealizerTarget;
  readonly plan: PianoComposerPlan;
  readonly projectEnd: number;
}

function loadCase(slug: TemplateSlug): EvaluationCase {
  const sourceInput = JSON.parse(readFileSync(
    new URL(`../evaluation/phase8/inputs/piano-engine-inputs/${slug}.json`, import.meta.url), 'utf8',
  )) as PianoEngineInput;
  // These Phase 8 cases pin Composer/Realizer suspension, fill, and rhythm
  // behavior. Strip the older strings-layer lead annotations so Stage 5's
  // explicit lead-response policy does not turn these independent-writing
  // regressions into lead-yield tests.
  const input: PianoEngineInput = {
    ...sourceInput,
    context: {
      ...sourceInput.context,
      leadWindows: [],
      moments: [],
      layerInformation: {
        ...sourceInput.context.layerInformation,
        perBar: sourceInput.context.layerInformation.perBar.map((bar) => ({ ...bar, layers: [] })),
      },
    },
  };
  const project = JSON.parse(readFileSync(
    new URL(`../evaluation/phase8/inputs/projects/${slug}.json`, import.meta.url), 'utf8',
  )) as Project;
  const track = project.tracks.find((candidate) => candidate.role === 'piano');
  if (!track) throw new Error(`Phase 7 ${slug} evaluation project has no piano target.`);
  const target: PianoRealizerTarget = {
    role: 'piano',
    family: track.family,
    locked: track.locked,
    lowestNote: track.lowestNote,
    highestNote: track.highestNote,
  };
  return {
    slug,
    input,
    project,
    target,
    plan: composePianoPlan(input, analyzePianoInput(input)),
    projectEnd: projectEndTick(project),
  };
}

const cases = TEMPLATE_SLUGS.map(loadCase);
const pc = (pitch: number): number => ((pitch % 12) + 12) % 12;
const endOf = (note: Note): number => note.startTick + note.durationTicks;
const circularDistance = (a: number, b: number): number => {
  const distance = Math.abs(pc(a) - pc(b));
  return Math.min(distance, 12 - distance);
};

function plannedMotifOnset(phrase: PianoComposerPlan['phrases'][number], position: 1 | 2): number | null {
  const rhythm = phrase.rhythmicPlan;
  const weights = rhythm.weights;
  const legacyCellTicks = Math.min(phrase.endTick - phrase.startTick,
    phrase.motif.operation === 'rhythmic-augmentation' ? 8 * PPQ : 4 * PPQ);
  const cellTicks = Math.max(1, rhythm.cellTicks ?? legacyCellTicks);
  const gridTicks = Math.max(1, rhythm.gridTicks ?? 1);
  const cells = rhythm.motifCells ?? [{
    startOffsetTicks: 0,
    positions: [0, 1, 2, 3] as const,
    variation: 'statement' as const,
  }];
  const cell = cells.find((candidate) => candidate.positions.includes(position));
  if (!cell) return null;
  const cellStart = phrase.startTick + cell.startOffsetTicks;
  const cellEnd = Math.min(phrase.endTick, cellStart + cellTicks);
  const activeCellTicks = cellEnd - cellStart;
  if (activeCellTicks <= 0) return null;
  const onsets: number[] = [];
  let cumulative = 0;
  for (let index = 0; index < 4; index++) {
    const raw = cellStart + Math.round(cumulative * activeCellTicks);
    const quantized = rhythm.gridTicks === undefined
      ? raw : phrase.startTick + Math.round((raw - phrase.startTick) / gridTicks) * gridTicks;
    const minimum = index === 0 ? cellStart : onsets[index - 1] + gridTicks;
    onsets.push(Math.min(cellEnd - 1, Math.max(minimum, quantized)));
    cumulative += weights[index];
  }
  const displacement = rhythm.syncopation;
  if (displacement?.displacedPosition === position) {
    const syncGrid = rhythm.gridTicks ?? PPQ / 4;
    const lower = onsets[position - 1] + syncGrid;
    const upper = onsets[position + 1] - syncGrid;
    if (lower <= upper) {
      const desired = onsets[position] + displacement.offsetTicks;
      const quantized = phrase.startTick + Math.round((desired - phrase.startTick) / syncGrid) * syncGrid;
      onsets[position] = Math.round(Math.max(lower, Math.min(upper, quantized)));
    }
  }
  return onsets[position];
}

const notesFor = (evaluation: EvaluationCase, plan = evaluation.plan): readonly Note[] =>
  realizePianoPlan({ plan, targetTrack: evaluation.target, projectEndTick: evaluation.projectEnd });

function isPlannedSuspensionAttack(plan: PianoComposerPlan, note: Note): boolean {
  return plan.harmonicEvents.some((event) => {
    const suspension = event.suspension;
    if (!suspension) return false;
    if (note.roleTag === 'settle') {
      return pc(note.pitch) === pc(suspension.resolvesToPitchClass)
        && note.startTick > event.chord.startTick && note.startTick < event.chord.endTick;
    }
    if (note.roleTag !== 'answer') return false;
    const preparing = plan.harmonicEvents.find((candidate) =>
      candidate.chord.id === suspension.preparedByChordId);
    return !!preparing
      && pc(note.pitch) === pc(suspension.tensionPitchClass)
      && note.startTick < event.chord.startTick
      && endOf(note) > event.chord.startTick
      && note.startTick >= preparing.chord.startTick;
  });
}

function fillDecision(
  startTick: number,
  endTick: number,
  decision: PianoFillDecision['decision'],
): PianoFillDecision {
  return {
    target: 'piano',
    startTick,
    endTick,
    sectionId: null,
    decision,
    observedWrittenActivity: { availability: 'available', activeTrackIds: [], onsetCount: 0 },
    rationale: 'Explicit Phase 8 test fixture decision.',
    mandatory: false,
  };
}

describe('Phase 8 piano Composer/Realizer follow-through', () => {
  it('realizes every planned fixture suspension across its own boundary with an exact stepwise resolution', () => {
    let total = 0;
    for (const evaluation of cases) {
      const result = realizePianoPlanWithAudit({
        plan: evaluation.plan,
        targetTrack: evaluation.target,
        projectEndTick: evaluation.projectEnd,
      });
      const planned = evaluation.plan.harmonicEvents.filter((event) => event.suspension !== null);
      expect(result.suspensions).toHaveLength(planned.length);
      expect(planned.length).toBeGreaterThan(0);
      total += planned.length;

      for (const event of planned) {
        const suspension = event.suspension!;
        const boundary = event.chord.startTick;
        const preparation = result.notes.find((note) =>
          (note.roleTag === 'answer' || note.roleTag === 'settle')
          && pc(note.pitch) === pc(suspension.tensionPitchClass)
          && note.startTick < boundary && endOf(note) > boundary);
        const resolution = result.notes.find((note) =>
          note.roleTag === 'settle'
          && pc(note.pitch) === pc(suspension.resolvesToPitchClass)
          && note.startTick > boundary && note.startTick < event.chord.endTick);

        expect(preparation, `${evaluation.slug} ${event.chord.id} preparation`).toBeDefined();
        expect(resolution, `${evaluation.slug} ${event.chord.id} resolution`).toBeDefined();
        expect(Math.abs(resolution!.pitch - preparation!.pitch)).toBe(suspension.resolutionDistanceSemitones);
      }
      expect(result.suspensions.every((audit) => audit.complete && audit.reason === null)).toBe(true);
      expect(result.suspensions.every((audit) => audit.preparationReason === null && audit.resolutionReason === null)).toBe(true);
    }
    expect(total).toBe(15);
  });

  it('returns a concrete failure reason for each suspension when the target cannot be written', () => {
    const evaluation = cases.find((candidate) => candidate.slug === 'chamber')!;
    const result = realizePianoPlanWithAudit({
      plan: evaluation.plan,
      targetTrack: { ...evaluation.target, locked: true },
      projectEndTick: evaluation.projectEnd,
    });

    expect(result.notes).toEqual([]);
    expect(result.suspensions.length).toBeGreaterThan(0);
    for (const suspension of result.suspensions) {
      expect(suspension.complete).toBe(false);
      expect(suspension.preparationReason).toMatch(/locked/i);
      expect(suspension.resolutionReason).toMatch(/locked/i);
      expect(suspension.reason).toMatch(/locked/i);
    }
  });

  it('suppresses only gated attacks, preserves pre-window note tails, and permits only explicit exceptions', () => {
    const chamber = cases.find((candidate) => candidate.slug === 'chamber')!;
    const chamberResult = realizePianoPlanWithAudit({
      plan: chamber.plan,
      targetTrack: chamber.target,
      projectEndTick: chamber.projectEnd,
    });
    const restriction = chamber.plan.attackRestrictions[0];
    expect(restriction).toMatchObject({ bar: 8, startTick: 26880, endTick: 30720 });
    expect(chamberResult.notes.some((note) =>
      note.startTick >= restriction.startTick && note.startTick < restriction.endTick)).toBe(false);

    // Near-silence alone, or zero energy without the near-silence flag, must not
    // create a restricted bar. The Composer requires both supplied facts.
    for (const change of [
      { target: 0.2, nearSilence: true },
      { target: 0, nearSilence: false },
    ]) {
      const input: PianoEngineInput = {
        ...chamber.input,
        context: {
          ...chamber.input.context,
          energy: chamber.input.context.energy.map((energy) => energy.bar === restriction.bar
            ? { ...energy, ...change }
            : energy),
        },
      };
      const plan = composePianoPlan(input, analyzePianoInput(input));
      expect(plan.attackRestrictions.some((window) => window.bar === restriction.bar)).toBe(false);
    }

    // A note attacked before the restricted interval remains intact as it rings
    // through that interval; only attacks whose onsets fall inside are removed.
    const onsetWindow = { startTick: 960, endTick: 1440 };
    const base = notesFor(chamber);
    const crossing = base.find((note) => note.startTick < onsetWindow.startTick && endOf(note) > onsetWindow.startTick);
    expect(crossing).toBeDefined();
    const restrictedPlan: PianoComposerPlan = {
      ...chamber.plan,
      attackRestrictions: [
        ...chamber.plan.attackRestrictions,
        {
          bar: 1,
          startTick: onsetWindow.startTick,
          endTick: onsetWindow.endTick,
          reason: 'near-silence-zero-energy',
          rationale: 'Synthetic Phase 8 onset-gate test window.',
        },
      ],
    };
    const restrictedNotes = notesFor(chamber, restrictedPlan);
    expect(restrictedNotes.some((note) =>
      note.startTick >= onsetWindow.startTick && note.startTick < onsetWindow.endTick)).toBe(false);
    expect(restrictedNotes.some((note) => note.pitch === crossing!.pitch
      && note.startTick === crossing!.startTick && endOf(note) > onsetWindow.startTick)).toBe(true);

    // Sonata's selected `consider-brief-gesture` is an explicit Composer
    // exception; its suspensions and two selected flourish attacks survive.
    const sonata = cases.find((candidate) => candidate.slug === 'sonata')!;
    const sonataNotes = notesFor(sonata);
    const sonataWindow = sonata.plan.attackRestrictions[0];
    const selected = sonata.plan.fillDecisions.find((decision) =>
      decision.target.toLowerCase() === 'piano'
      && decision.decision === 'consider-brief-gesture'
      && decision.startTick === sonataWindow.startTick
      && decision.endTick === sonataWindow.endTick);
    expect(selected).toBeDefined();
    const barEight = sonataNotes.filter((note) =>
      note.startTick >= sonataWindow.startTick && note.startTick < sonataWindow.endTick);
    expect(barEight.some((note) => note.roleTag === 'settle' && isPlannedSuspensionAttack(sonata.plan, note))).toBe(true);
    expect(barEight.filter((note) => note.roleTag === 'flourish')).toHaveLength(2);
    expect(barEight.every((note) => note.roleTag === 'settle'
      ? isPlannedSuspensionAttack(sonata.plan, note)
      : note.roleTag === 'flourish' && selected!.decision === 'consider-brief-gesture')).toBe(true);

    // `leave-space` always wins if it overlaps a selected fill, even inside an
    // otherwise authorized zero-energy exception window.
    const overlappingDecisionPlan: PianoComposerPlan = {
      ...sonata.plan,
      fillDecisions: [
        ...sonata.plan.fillDecisions,
        fillDecision(sonataWindow.startTick, sonataWindow.endTick, 'leave-space'),
      ],
    };
    const withLeaveSpace = notesFor(sonata, overlappingDecisionPlan);
    expect(withLeaveSpace.some((note) =>
      note.startTick >= sonataWindow.startTick && note.startTick < sonataWindow.endTick)).toBe(false);
  });

  it('keeps Hybrid Studio syncopation chord- and motif-related over a quarter-note pulse without changing other templates', () => {
    const hybrid = cases.find((candidate) => candidate.slug === 'hybrid-studio')!;
    const result = realizePianoPlanWithAudit({
      plan: hybrid.plan,
      targetTrack: hybrid.target,
      projectEndTick: hybrid.projectEnd,
    });
    expect(hybrid.plan.template.style.identity).toBe('hybrid-pulse-and-color');
    const displacedPhrase = hybrid.plan.phrases.find((phrase) => phrase.rhythmicPlan.syncopation !== null);
    expect(displacedPhrase).toBeDefined();
    expect(displacedPhrase!.rhythmicPlan.pulseTicks).toBe(PPQ);

    const displacement = displacedPhrase!.rhythmicPlan.syncopation!;
    const position = displacement.displacedPosition;
    const expectedTick = plannedMotifOnset(displacedPhrase!, position);
    if (expectedTick === null) throw new Error('The selected Hybrid motif cell has no planned displaced position.');
    const displacedNote = result.notes.find((note) => note.roleTag === 'answer' && note.startTick === expectedTick);
    expect(displacedNote, 'a realized motif answer on the Composer-planned pickup').toBeDefined();
    expect(displacedNote!.startTick % PPQ).not.toBe(0);

    const chord = hybrid.plan.harmonicEvents.find((event) =>
      expectedTick >= event.chord.startTick && expectedTick < event.chord.endTick)!;
    expect(chord.chord.availablePitchClasses).toContain(pc(displacedNote!.pitch));
    expect(pc(displacedNote!.pitch)).not.toBe(chord.voicing.leftHandBassPitchClass);
    const motifPitch = hybrid.plan.motif!.tones[position]?.pitchClass;
    expect(circularDistance(displacedNote!.pitch, motifPitch)).toBeLessThanOrEqual(2);

    const quarterPulseAnchors = result.notes.filter((note) => note.roleTag === 'anchor');
    expect(quarterPulseAnchors.length).toBeGreaterThan(4);
    expect(quarterPulseAnchors.every((note) => note.startTick % PPQ === 0)).toBe(true);
    const contrastPhrase = hybrid.plan.phrases.find((phrase) =>
      phrase.id !== displacedPhrase!.id && phrase.rhythmicPlan.syncopation === null
      && result.notes.some((note) => note.roleTag === 'answer'
        && note.startTick >= phrase.startTick && note.startTick < phrase.endTick));
    expect(contrastPhrase).toBeDefined();
    expect(result.notes.some((note) => note.roleTag === 'answer'
      && note.startTick >= contrastPhrase!.startTick && note.startTick < contrastPhrase!.endTick
      && note.startTick % PPQ === 0)).toBe(true);

    for (const evaluation of cases.filter((candidate) => candidate.slug !== 'hybrid-studio')) {
      expect(evaluation.plan.phrases.every((phrase) => phrase.rhythmicPlan.syncopation === null), evaluation.slug).toBe(true);
    }

    // Revoicing and seed changes must not erase the selected pickup: the
    // displaced answer is moved to the nearest available chord tone when the
    // motif's ideal pitch would double either hand.
    for (const seed of [11, 17, 42, 101, 202, 303, 404, 505]) {
      const input: PianoEngineInput = {
        ...hybrid.input,
        context: { ...hybrid.input.context, seed },
      };
      const plan = composePianoPlan(input, analyzePianoInput(input));
      const realization = realizePianoPlanWithAudit({
        plan,
        targetTrack: hybrid.target,
        projectEndTick: hybrid.projectEnd,
      });
      const phrase = plan.phrases.find((candidate) => candidate.rhythmicPlan.syncopation !== null)!;
      const syncopation = phrase.rhythmicPlan.syncopation!;
      const plannedTick = plannedMotifOnset(phrase, syncopation.displacedPosition);
      if (plannedTick === null) throw new Error(`Hybrid Studio seed ${seed} lost its planned displaced cell position.`);
      const note = realization.notes.find((candidate) => candidate.roleTag === 'answer' && candidate.startTick === plannedTick);
      expect(note, `Hybrid Studio seed ${seed} retains its planned motif pickup`).toBeDefined();
      const event = plan.harmonicEvents.find((candidate) =>
        plannedTick >= candidate.chord.startTick && plannedTick < candidate.chord.endTick)!;
      expect(event.chord.availablePitchClasses).toContain(pc(note!.pitch));
      expect(pc(note!.pitch)).not.toBe(event.voicing.leftHandBassPitchClass);
    }
  });
});
