import { describe, expect, it } from 'vitest';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { analyzePianoInput } from '../src/orchestrator/keys/piano-analyzer';
import { composePianoPlan, type PianoComposerPlan } from '../src/orchestrator/keys/piano-composer';
import { realizePianoPlan } from '../src/orchestrator/keys/piano-realizer';
import type { PianoEngineInput } from '../src/orchestrator/keys/piano-engine';
import { sanitizeNotes } from '../src/engine/generate';
import { projectFromFixture } from '../src/shared/schema';
import { projectEndTick } from '../src/shared/schema/meter';
import { validateProject } from '../src/shared/schema/validate';
import type { Note, Project, Track } from '../src/shared/schema/types';

const project = projectFromFixture(JSON.parse(JSON.stringify(dorian)) as Project);
project.ensemble = { templateId: 'ensemble.chamber', overrides: {}, pins: {} };
project.orchestration = { take: 0 };
const productionInput = composeAllTracks(project, { seed: 17 }).pianoEngineInput;
const engineInput: PianoEngineInput = {
  ...productionInput,
  context: {
    ...productionInput.context,
    layerInformation: {
      ...productionInput.context.layerInformation,
      perBar: productionInput.context.layerInformation.perBar.map((bar) => ({ ...bar, layers: [] })),
    },
  },
  analysis: { tracks: [] },
};
const pianoTrack = project.tracks.find((track) => track.role === 'piano')!;
const projectEnd = projectEndTick(project);

function planFor(input: PianoEngineInput = engineInput): PianoComposerPlan {
  return composePianoPlan(input, analyzePianoInput(input));
}

const plan = planFor();

function realize(sourcePlan: PianoComposerPlan = plan, target: Track = pianoTrack, end = projectEnd): readonly Note[] {
  return realizePianoPlan({ plan: sourcePlan, targetTrack: target, projectEndTick: end });
}

const pc = (pitch: number): number => ((pitch % 12) + 12) % 12;
const endOf = (note: Note): number => note.startTick + note.durationTicks;
const overlaps = (a: Note, b: Note): boolean => a.startTick < endOf(b) && b.startTick < endOf(a);
const mean = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};

describe('Piano Realizer Phase 6', () => {
  it('is deterministic for an immutable symbolic plan and leaves both plan and target track untouched', () => {
    const planBefore = JSON.stringify(plan);
    const trackBefore = JSON.stringify(pianoTrack);
    const first = realize();
    const repeated = realize();

    expect(JSON.stringify(repeated)).toBe(JSON.stringify(first));
    expect(first.length).toBeGreaterThan(0);
    expect(JSON.stringify(plan)).toBe(planBefore);
    expect(JSON.stringify(pianoTrack)).toBe(trackBefore);
    expect(plan.containsMidiNotes).toBe(false);

    const alternateInput: PianoEngineInput = {
      ...engineInput,
      context: { ...engineInput.context, seed: engineInput.context.seed + 1 },
    };
    expect(JSON.stringify(realize(planFor(alternateInput)))).not.toBe(JSON.stringify(first));
  });

  it('realizes supplied harmony in coordinated hands with controlled register spacing and connected bass motion', () => {
    const notes = realize();
    const anchors = notes.filter((note) => note.roleTag === 'anchor');
    const rightHarmony = notes.filter((note) => note.roleTag === 'bed' || note.roleTag === 'arrival');
    const answers = notes.filter((note) => note.roleTag === 'answer');

    expect(anchors.length).toBeGreaterThan(4);
    expect(rightHarmony.length).toBeGreaterThan(3);
    expect(answers.length).toBeGreaterThan(2);
    expect(median(rightHarmony.map((note) => note.pitch))).toBeGreaterThan(median(anchors.map((note) => note.pitch)) + 8);

    for (const anchor of anchors) {
      const event = plan.harmonicEvents.find((candidate) => candidate.chord.startTick === anchor.startTick);
      if (event) expect(pc(anchor.pitch)).toBe(event.voicing.leftHandBassPitchClass);
    }
    const bassMotion = anchors.slice(1).map((note, index) => Math.abs(note.pitch - anchors[index].pitch));
    expect(Math.max(...bassMotion)).toBeLessThanOrEqual(12);

    // At each realized chord boundary, chord-bed attacks stay in that supplied
    // chord; any sustained right-hand note crossing a boundary must be common.
    for (const note of rightHarmony) {
      const event = plan.harmonicEvents.find((candidate) =>
        note.startTick >= candidate.chord.startTick && note.startTick < candidate.chord.endTick);
      if (event) expect(event.chord.availablePitchClasses).toContain(pc(note.pitch));
    }
    let retainedCommonTone = false;
    for (let index = 0; index < plan.harmonicEvents.length - 1; index++) {
      const current = plan.harmonicEvents[index];
      const next = plan.harmonicEvents[index + 1];
      if (current.chord.endTick !== next.chord.startTick) continue;
      for (const note of rightHarmony.filter((candidate) =>
        candidate.startTick < next.chord.startTick && endOf(candidate) > next.chord.startTick)) {
        expect(next.chord.availablePitchClasses).toContain(pc(note.pitch));
        if (next.voiceLeading.commonPitchClasses.includes(pc(note.pitch))) retainedCommonTone = true;
      }
    }
    expect(retainedCommonTone).toBe(true);

    const simultaneousHands = plan.harmonicEvents.some((event) => {
      const bass = anchors.find((note) => note.startTick === event.chord.startTick);
      const upper = rightHarmony.find((note) => note.startTick === event.chord.startTick);
      return !!bass && !!upper && upper.pitch - bass.pitch >= 8;
    });
    expect(simultaneousHands).toBe(true);
  });

  it('develops the supplied motif with phrase-specific operations, rhythmic spacing, and only planned chromatic tension', () => {
    const notes = realize();
    const answers = notes.filter((note) => note.roleTag === 'answer');
    const phrasePatterns = plan.phrases.flatMap((phrase) => {
      const phraseNotes = answers.filter((note) => note.startTick >= phrase.startTick && note.startTick < phrase.endTick);
      return phraseNotes.length > 0
        ? [phraseNotes.map((note) => Math.round((note.startTick - phrase.startTick) / (phrase.endTick - phrase.startTick) * 100))]
        : [];
    });
    const realizedOperations = new Set(plan.phrases.map((phrase) => phrase.motif.operation));

    expect(plan.motif).not.toBeNull();
    expect(realizedOperations.size).toBeGreaterThan(1);
    expect(phrasePatterns.length).toBeGreaterThan(1);
    expect(new Set(phrasePatterns.map((pattern) => pattern.join(','))).size).toBeGreaterThan(1);
    expect(answers.some((note) => note.startTick % 960 !== 0)).toBe(true);

    for (const note of answers) {
      const event = plan.harmonicEvents.find((candidate) =>
        note.startTick >= candidate.chord.startTick && note.startTick < candidate.chord.endTick);
      if (!event || event.chord.availablePitchClasses.includes(pc(note.pitch))) continue;
      expect(plan.motif?.tensionResolution.kind).toBe('chromatic-neighbor');
      const phrase = plan.phrases.find((candidate) => note.startTick >= candidate.startTick && note.startTick < candidate.endTick)!;
      const weights = phrase.rhythmicPlan.weights.length
        ? phrase.rhythmicPlan.weights : plan.motif!.rhythmicWeights;
      const cellTicks = phrase.rhythmicPlan.cellTicks ?? Math.min(phrase.endTick - phrase.startTick,
        phrase.motif.operation === 'rhythmic-augmentation' ? 8 * 960 : 4 * 960);
      const gridTicks = phrase.rhythmicPlan.gridTicks ?? 1;
      const cells = phrase.rhythmicPlan.motifCells ?? [{
        startOffsetTicks: 0,
        positions: [0, 1, 2, 3] as const,
        variation: 'statement' as const,
      }];
      const intendedPositionTwo = cells.flatMap((cell) => {
        if (!cell.positions.includes(2)) return [];
        const cellStart = phrase.startTick + cell.startOffsetTicks;
        const activeCellTicks = Math.min(phrase.endTick, cellStart + cellTicks) - cellStart;
        if (activeCellTicks <= 0) return [];
        const positionOffset = weights[0] + weights[1];
        const rawTick = cellStart + Math.round(positionOffset * activeCellTicks);
        return [phrase.startTick + Math.round((rawTick - phrase.startTick) / gridTicks) * gridTicks];
      });
      expect(intendedPositionTwo.length).toBeGreaterThan(0);
      const closestDistance = Math.min(...intendedPositionTwo.map((tick) => Math.abs(tick - note.startTick)));
      expect(closestDistance).toBeLessThanOrEqual(Math.max(1, gridTicks / 2)
        + Math.abs(phrase.rhythmicPlan.syncopation?.offsetTicks ?? 0));
    }
  });

  it('resolves the Chamber suspension outside and inside a climax without weakening unrelated octave restrictions', () => {
    const sourceEvent = plan.harmonicEvents.find((candidate) => candidate.suspension !== null);
    expect(sourceEvent).toBeDefined();
    const sourceSuspension = sourceEvent!.suspension!;
    expect(plan.templateConstraints.octaveDoubling).toBe('climaxOnly');
    expect(sourceEvent!.voicing.leftHandBassPitchClass).toBe(sourceSuspension.resolvesToPitchClass);

    const withClimax = (isClimax: boolean): PianoComposerPlan => ({
      ...plan,
      sectionIntentions: plan.sectionIntentions.map((section) =>
        sourceEvent!.sectionIds.includes(section.sectionId)
          ? { ...section, function: isClimax ? 'culmination' : 'continuation' }
          : section),
      phrases: plan.phrases.map((phrase) => phrase.id !== sourceEvent!.phraseId ? phrase : {
        ...phrase,
        function: isClimax ? 'arrival' : 'development',
        dynamics: { ...phrase.dynamics, peak: isClimax ? 5 : 2 },
      }),
      harmonicEvents: plan.harmonicEvents.map((event) => event.chord.id !== sourceEvent!.chord.id ? event : {
        ...event,
        structuralRole: isClimax ? 'arrival' : 'color-turn',
        dynamicIntent: { ...event.dynamicIntent, intensity: isClimax ? 5 : 2 },
      }),
    });
    const suspensionNotes = (sourcePlan: PianoComposerPlan) => {
      const event = sourcePlan.harmonicEvents.find((candidate) => candidate.chord.id === sourceEvent!.chord.id)!;
      const suspension = event.suspension!;
      const notes = realize(sourcePlan);
      const prepared = notes.find((note) => note.roleTag === 'answer'
        && pc(note.pitch) === suspension.tensionPitchClass
        && note.startTick < event.chord.startTick && endOf(note) > event.chord.startTick);
      const resolution = notes.find((note) => note.roleTag === 'settle'
        && pc(note.pitch) === suspension.resolvesToPitchClass
        && note.startTick > event.chord.startTick && note.startTick < event.chord.endTick);
      return { event, suspension, prepared, resolution, notes };
    };

    const nonClimax = withClimax(false);
    expect(nonClimax.templateConstraints.octaveDoubling).toBe('climaxOnly');
    expect(nonClimax.sectionIntentions.find((section) =>
      sourceEvent!.sectionIds.includes(section.sectionId))?.function).toBe('continuation');
    const ordinary = suspensionNotes(nonClimax);
    expect(ordinary.prepared).toBeDefined();
    expect(ordinary.resolution).toBeDefined();
    expect(Math.abs(ordinary.resolution!.pitch - ordinary.prepared!.pitch))
      .toBe(ordinary.suspension.resolutionDistanceSemitones);

    const climax = suspensionNotes(withClimax(true));
    expect(climax.event.structuralRole).toBe('arrival');
    expect(climax.prepared).toBeDefined();
    expect(climax.resolution).toBeDefined();
    expect(Math.abs(climax.resolution!.pitch - climax.prepared!.pitch))
      .toBe(climax.suspension.resolutionDistanceSemitones);

    // The same pitch-class proposal in an ordinary chord voicing is still
    // rejected: only the exact Composer-planned suspension/bass pair is exempt.
    const first = plan.harmonicEvents[0];
    const forcedDouble = {
      ...first,
      structuralRole: 'continuity' as const,
      hands: {
        left: { ...first.hands.left, motion: 'change-with-harmony' as const },
        right: { ...first.hands.right, density: 'broad' as const, motion: 'motif-led' as const },
      },
      orchestration: { ...first.orchestration, interaction: 'interweave' as const },
      voicing: { ...first.voicing, rightHandPitchClasses: [first.voicing.leftHandBassPitchClass] },
    };
    const outsideClimax = {
      ...nonClimax,
      harmonicEvents: [forcedDouble],
      ending: { ...nonClimax.ending, chordId: null, tick: null, availability: 'unavailable' as const, intention: 'unavailable' as const },
    };
    const withoutGenericDoubling = realize(outsideClimax);
    const bass = withoutGenericDoubling.find((note) => note.roleTag === 'anchor');
    expect(bass).toBeDefined();
    expect(withoutGenericDoubling.some((note) => pc(note.pitch) === pc(bass!.pitch)
      && note.roleTag !== 'anchor' && overlaps(note, bass!))).toBe(false);
  });

  it('retains the stricter forbidden and permissive allowed policies for other templates', () => {
    const withPolicy = (id: string, policy: PianoComposerPlan['templateConstraints']['octaveDoubling']): PianoComposerPlan => ({
      ...plan,
      template: { ...plan.template, id },
      templateConstraints: { ...plan.templateConstraints, octaveDoubling: policy },
    });
    const event = plan.harmonicEvents.find((candidate) => candidate.suspension !== null)!;
    const resolves = (sourcePlan: PianoComposerPlan): boolean => realize(sourcePlan).some((note) =>
      note.roleTag === 'settle'
      && pc(note.pitch) === event.suspension!.resolvesToPitchClass
      && note.startTick > event.chord.startTick && note.startTick < event.chord.endTick);

    expect(resolves(withPolicy('ensemble.sonata', 'forbidden'))).toBe(false);
    expect(resolves(withPolicy('ensemble.cinematic', 'allowed'))).toBe(true);
    expect(resolves(withPolicy('ensemble.vocalbacking', 'not-specified'))).toBe(false);
  });

  it('honors phrase dynamics, articulation, transitions, and the supplied final-harmony landing', () => {
    const firstPhrase = plan.phrases[0];
    const shapedPlan: PianoComposerPlan = {
      ...plan,
      phrases: plan.phrases.map((phrase) => phrase.id !== firstPhrase.id ? phrase : {
        ...phrase,
        dynamics: {
          ...phrase.dynamics,
          shape: 'arch',
          entry: 0,
          peak: 5,
          exit: 0,
          peakPosition: 0.5,
          intensityCurve: [
            { position: 0, intensity: 0, sourceBar: null, sourceTarget: null },
            { position: 0.5, intensity: 5, sourceBar: null, sourceTarget: null },
            { position: 1, intensity: 0, sourceBar: null, sourceTarget: null },
          ],
          segments: [{
            startPosition: 0, endPosition: 1, shape: 'arch', entry: 0, peak: 5, exit: 0,
            peakPosition: 0.5, turningPoint: null,
          }],
          emotionalColor: 'intimate',
        },
      }),
    };
    const notes = realize(shapedPlan);
    const inPhrase = notes.filter((note) => note.startTick >= firstPhrase.startTick && note.startTick < firstPhrase.endTick);
    const early = inPhrase.filter((note) => note.startTick < firstPhrase.startTick + (firstPhrase.endTick - firstPhrase.startTick) * 0.2);
    const peak = inPhrase.filter((note) => note.startTick >= firstPhrase.startTick + (firstPhrase.endTick - firstPhrase.startTick) * 0.4
      && note.startTick < firstPhrase.startTick + (firstPhrase.endTick - firstPhrase.startTick) * 0.6);
    const late = inPhrase.filter((note) => note.startTick >= firstPhrase.startTick + (firstPhrase.endTick - firstPhrase.startTick) * 0.65);

    expect(early.length).toBeGreaterThan(0);
    expect(peak.length).toBeGreaterThan(0);
    expect(late.length).toBeGreaterThan(0);
    expect(median(peak.map((note) => note.velocity))).toBeGreaterThan(median(early.map((note) => note.velocity)) + 20);
    expect(median(peak.map((note) => note.velocity))).toBeGreaterThan(median(late.map((note) => note.velocity)) + 20);
    expect(notes.some((note) => note.articulation === 'legato')).toBe(true);
    expect(new Set(notes.map((note) => note.durationTicks)).size).toBeGreaterThan(3);

    const finalEvent = plan.harmonicEvents[plan.harmonicEvents.length - 1];
    const finalNotes = realize().filter((note) => note.startTick >= finalEvent.chord.startTick);
    expect(finalNotes.length).toBeGreaterThan(0);
    expect(finalNotes.some((note) => endOf(note) === Math.min(projectEnd, finalEvent.chord.endTick))).toBe(true);
    expect(plan.ending.chordId).toBe(finalEvent.chord.id);
    expect(plan.phrases[plan.phrases.length - 1].motif.operation).toBe('fragment-to-landing');
  });

  it('respects the piano target range and project boundary, produces schema-valid notes, and is a sanitizer no-op', () => {
    const notes = realize();
    expect(notes.every((note) => Number.isInteger(note.pitch)
      && note.pitch >= pianoTrack.lowestNote && note.pitch <= pianoTrack.highestNote)).toBe(true);
    expect(notes.every((note) => Number.isInteger(note.startTick) && note.startTick >= 0
      && Number.isInteger(note.durationTicks) && note.durationTicks >= 1
      && endOf(note) <= projectEnd
      && Number.isInteger(note.velocity) && note.velocity >= 1 && note.velocity <= 127)).toBe(true);
    expect(notes.every((note) => note.bow === undefined && note.layer === undefined)).toBe(true);
    expect(sanitizeNotes([...notes], pianoTrack.lowestNote, pianoTrack.highestNote, projectEnd)).toEqual(notes);

    const validatedProject = JSON.parse(JSON.stringify(project)) as Project;
    const piano = validatedProject.tracks.find((track) => track.role === 'piano')!;
    piano.notes = [...notes];
    expect(validateProject(validatedProject)).toEqual({ ok: true, errors: [] });

    const narrow = { ...pianoTrack, lowestNote: 48, highestNote: 78 };
    const narrowNotes = realize(plan, narrow);
    expect(narrowNotes.length).toBeGreaterThan(0);
    expect(narrowNotes.every((note) => note.pitch >= narrow.lowestNote && note.pitch <= narrow.highestNote)).toBe(true);
  });

  it('adapts to distinct Composer templates without copying their register or density choices', () => {
    const planForTemplate = (id: string): PianoComposerPlan => {
      const input: PianoEngineInput = {
        ...engineInput,
        context: { ...engineInput.context, template: { id, pianoEligible: true } },
      };
      return planFor(input);
    };
    const vocalPlan = planForTemplate('ensemble.vocalbacking');
    const cinematicPlan = planForTemplate('ensemble.cinematic');
    const vocal = realize(vocalPlan).filter((note) => note.roleTag === 'bed' || note.roleTag === 'arrival' || note.roleTag === 'answer');
    const cinematic = realize(cinematicPlan).filter((note) => note.roleTag === 'bed' || note.roleTag === 'arrival' || note.roleTag === 'answer');

    expect(vocalPlan.template.style.identity).toBe('vocal-space');
    expect(cinematicPlan.template.style.identity).toBe('cinematic-expanse');
    expect(vocal.length).toBeGreaterThan(0);
    expect(cinematic.length).toBeGreaterThan(0);
    expect(mean(cinematic.map((note) => note.pitch))).toBeGreaterThan(mean(vocal.map((note) => note.pitch)) + 8);
  });

  it('realizes only explicit piano fill reservations as brief staccato gestures', () => {
    const fillDecision = {
      target: 'piano',
      startTick: 12_000,
      endTick: 14_000,
      sectionId: plan.harmonicEvents[3].sectionIds[0] ?? null,
      decision: 'consider-brief-gesture' as const,
      observedWrittenActivity: { availability: 'available' as const, activeTrackIds: [], onsetCount: 0 },
      rationale: 'Explicit fill reservation for the Realizer contract test.',
      mandatory: false as const,
    };
    const pianoFillPlan = { ...plan, fillDecisions: [fillDecision] };
    const flourishes = realize(pianoFillPlan).filter((note) => note.roleTag === 'flourish');
    expect(flourishes.length).toBeGreaterThan(0);
    expect(flourishes.every((note) => note.startTick >= fillDecision.startTick
      && endOf(note) <= fillDecision.endTick && note.articulation === 'staccato')).toBe(true);

    const keysFamilyPlan = {
      ...plan,
      fillDecisions: [{ ...fillDecision, target: 'Keys', decision: 'keys-family-only' as const }],
    };
    expect(realize(keysFamilyPlan).some((note) => note.roleTag === 'flourish')).toBe(false);
  });

  it('contains no octave-unison overlap, controller lane, harp target, or write to a locked track', () => {
    const notes = realize();
    for (let left = 0; left < notes.length; left++) {
      for (let right = left + 1; right < notes.length; right++) {
        const a = notes[left];
        const b = notes[right];
        const interval = Math.abs(a.pitch - b.pitch);
        const bass = a.roleTag === 'anchor' ? a : b.roleTag === 'anchor' ? b : null;
        const resolution = a.roleTag === 'settle' ? a : b.roleTag === 'settle' ? b : null;
        const plannedSuspensionBassPair = !!bass && !!resolution && plan.harmonicEvents.some((event) => {
          const suspension = event.suspension;
          return suspension !== null
            && event.chord.startTick === bass.startTick
            && resolution.startTick > event.chord.startTick
            && resolution.startTick < event.chord.endTick
            && pc(bass.pitch) === pc(suspension.resolvesToPitchClass)
            && pc(resolution.pitch) === pc(suspension.resolvesToPitchClass);
        });
        if (interval >= 12 && interval % 12 === 0 && overlaps(a, b) && !plannedSuspensionBassPair) {
          throw new Error(`Unexpected octave doubling: ${a.pitch} / ${b.pitch}`);
        }
      }
      expect((notes[left] as Note & { cc?: unknown }).cc).toBeUndefined();
    }
    expect(realize(plan, { ...pianoTrack, locked: true })).toEqual([]);
    expect(realize(plan, { ...pianoTrack, role: 'harp' })).toEqual([]);
    expect(realize(plan, { ...pianoTrack, family: 'Strings' })).toEqual([]);
  });

  it('handles empty, partial, reordered, clipped, and malformed harmonic plans safely', () => {
    const empty = { ...plan, harmonicEvents: [] };
    expect(realize(empty)).toEqual([]);

    const partial = { ...plan, harmonicEvents: [plan.harmonicEvents[0]] };
    const partialNotes = realize(partial);
    expect(partialNotes.length).toBeGreaterThan(0);
    expect(partialNotes.every((note) => endOf(note) <= plan.harmonicEvents[0].chord.endTick)).toBe(true);

    const reordered = { ...plan, harmonicEvents: [...plan.harmonicEvents].reverse() };
    expect(realize(reordered)).toEqual(realize());

    const last = plan.harmonicEvents[plan.harmonicEvents.length - 1];
    const clipped = {
      ...plan,
      harmonicEvents: [{ ...last, chord: { ...last.chord, endTick: projectEnd + 9600 } }],
    };
    const clippedNotes = realize(clipped, pianoTrack, projectEnd - 1200);
    expect(clippedNotes.length).toBeGreaterThan(0);
    expect(clippedNotes.every((note) => endOf(note) <= projectEnd - 1200)).toBe(true);
    expect(clippedNotes.some((note) => endOf(note) === projectEnd - 1200)).toBe(true);

    const malformed = {
      ...plan,
      harmonicEvents: [{ ...last, chord: { ...last.chord, startTick: -960, endTick: -1 } }],
    };
    expect(realize(malformed)).toEqual([]);
    expect(realize(plan, pianoTrack, 0)).toEqual([]);
  });

  it('deep-freezes every output note and the result array', () => {
    const notes = realize();
    expect(Object.isFrozen(notes)).toBe(true);
    expect(notes.every((note) => Object.isFrozen(note))).toBe(true);
    expect(() => { (notes[0] as Note).pitch = 0; }).toThrow();
  });
});
