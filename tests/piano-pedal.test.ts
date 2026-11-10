import { describe, expect, it } from 'vitest';
import type { Note } from '../src/shared/schema/types';
import {
  generatePianoPedalLane,
  PIANO_SUSTAIN_PEDAL_CC,
} from '../src/orchestrator/keys/piano-pedal';
import type {
  PianoComposerPlan,
  PianoHarmonicEvent,
  PianoPhraseIntention,
  PianoTemplateIdentity,
} from '../src/orchestrator/keys/piano-composer';

interface EventSpec {
  id: string;
  startTick: number;
  endTick: number;
  pitchClasses: number[];
  phraseId?: string;
  density?: 'very-sparse' | 'sparse' | 'moderate' | 'broad';
}

function syntheticPlan(
  events: readonly EventSpec[],
  projectEnd: number,
  options: {
    identity?: PianoTemplateIdentity;
    phraseEnd?: number;
    secondPhraseStart?: number;
    syncopated?: boolean;
  } = {},
): PianoComposerPlan {
  const phraseEnd = options.phraseEnd ?? projectEnd;
  const firstPhrase = {
    id: 'phrase-1',
    startTick: 0,
    endTick: options.secondPhraseStart ?? phraseEnd,
    rhythmicPlan: { syncopation: options.syncopated ? { displacedPosition: 1 } : null },
  };
  const phrases = (options.secondPhraseStart === undefined
    ? [firstPhrase]
    : [
        firstPhrase,
        { ...firstPhrase, id: 'phrase-2', startTick: options.secondPhraseStart, endTick: projectEnd },
      ]) as unknown as PianoPhraseIntention[];
  const harmonicEvents = events.map((event) => ({
    phraseId: event.phraseId ?? 'phrase-1',
    chord: {
      id: event.id,
      symbol: event.id,
      startTick: event.startTick,
      endTick: event.endTick,
      availablePitchClasses: event.pitchClasses,
    },
    hands: { right: { density: event.density ?? 'sparse' } },
  })) as unknown as PianoHarmonicEvent[];
  return {
    status: 'composed',
    template: {
      eligible: true,
      style: { identity: options.identity ?? 'chamber-counterpoint' },
    },
    phrases,
    harmonicEvents,
  } as unknown as PianoComposerPlan;
}

function note(pitch: number, startTick: number, durationTicks: number): Note {
  return { pitch, startTick, durationTicks, velocity: 70 };
}

const values = (lane: ReturnType<typeof generatePianoPedalLane>) =>
  lane?.points.map(({ tick, value }) => ({ tick, value })) ?? [];

describe('Piano Engine V5 sustain-pedal planning', () => {
  it('coordinates pedal changes with realized attacks and releases before incompatible harmony', () => {
    const plan = syntheticPlan([
      { id: 'C', startTick: 0, endTick: 1200, pitchClasses: [0, 4, 7] },
      { id: 'D', startTick: 1200, endTick: 2400, pitchClasses: [2, 6, 9] },
    ], 2400);
    const notes = [note(60, 0, 600), note(64, 600, 600), note(62, 1200, 600), note(66, 1800, 600)];
    const lane = generatePianoPedalLane(plan, notes, 2400);

    expect(lane?.cc).toBe(PIANO_SUSTAIN_PEDAL_CC);
    expect(values(lane)).toEqual([
      { tick: 0, value: 127 },
      { tick: 1199, value: 0 },
      { tick: 1200, value: 127 },
      { tick: 2400, value: 0 },
    ]);
    const attacks = new Set(notes.map((entry) => entry.startTick));
    expect(lane?.points.filter((point) => point.value === 127).every((point) => attacks.has(point.tick))).toBe(true);
    expect(lane?.points.at(-1)?.value).toBe(0);
  });

  it('carries pedal across adjacent compatible harmony without an unnecessary lift', () => {
    const plan = syntheticPlan([
      { id: 'C1', startTick: 0, endTick: 1200, pitchClasses: [0, 4, 7] },
      { id: 'C2', startTick: 1200, endTick: 2400, pitchClasses: [0, 4, 7] },
    ], 2400);
    const notes = [note(60, 0, 600), note(64, 600, 600), note(60, 1200, 600), note(64, 1800, 600)];
    const first = generatePianoPedalLane(plan, notes, 2400);
    const second = generatePianoPedalLane(plan, notes, 2400);
    expect(values(first)).toEqual([
      { tick: 0, value: 127 },
      { tick: 2400, value: 0 },
    ]);
    expect(second).toEqual(first);
  });

  it('avoids fast repeated attacks and over-dense voicings', () => {
    const plan = syntheticPlan([{ id: 'C', startTick: 0, endTick: 1200, pitchClasses: [0, 4, 7] }], 1200);
    const fastNotes = Array.from({ length: 6 }, (_, index) => note(60 + index, index * 120, 120));
    const denseNotes = Array.from({ length: 7 }, (_, index) => note(48 + index, 0, 720));

    expect(generatePianoPedalLane(plan, fastNotes, 1200)).toBeNull();
    expect(generatePianoPedalLane(plan, denseNotes, 1200)).toBeNull();
  });

  it('lifts through long rests and releases at a phrase boundary', () => {
    const restPlan = syntheticPlan([{ id: 'C', startTick: 0, endTick: 3000, pitchClasses: [0, 4, 7] }], 3000);
    const restLane = generatePianoPedalLane(restPlan, [note(48, 120, 480), note(60, 2200, 480)], 3000);
    expect(values(restLane)).toEqual([
      { tick: 120, value: 127 },
      { tick: 720, value: 0 },
      { tick: 2200, value: 127 },
      { tick: 2800, value: 0 },
    ]);

    const phrasePlan = syntheticPlan([
      { id: 'C1', startTick: 0, endTick: 1800, pitchClasses: [0, 4, 7], phraseId: 'phrase-1' },
      { id: 'C2', startTick: 1800, endTick: 3000, pitchClasses: [0, 4, 7], phraseId: 'phrase-2' },
    ], 3000, { secondPhraseStart: 1800 });
    const phraseLane = generatePianoPedalLane(phrasePlan, [
      note(48, 0, 600), note(60, 600, 1200), note(48, 1800, 600), note(60, 2400, 600),
    ], 3000);
    expect(values(phraseLane)).toEqual([
      { tick: 0, value: 127 },
      { tick: 1799, value: 0 },
      { tick: 1800, value: 127 },
      { tick: 3000, value: 0 },
    ]);
  });

  it('returns no lane when Piano is ineligible and responds to template style', () => {
    const eligible = syntheticPlan([{ id: 'C', startTick: 0, endTick: 1200, pitchClasses: [0, 4, 7] }], 1200);
    const ineligible = {
      ...eligible,
      template: { ...eligible.template, eligible: false },
    } as PianoComposerPlan;
    const notes = [note(48, 0, 600), note(60, 600, 600)];
    expect(generatePianoPedalLane(ineligible, notes, 1200)).toBeNull();

    const chamber = generatePianoPedalLane(eligible, notes, 1200);
    const hybridPlan = syntheticPlan(
      [{ id: 'C', startTick: 0, endTick: 1200, pitchClasses: [0, 4, 7] }],
      1200,
      { identity: 'hybrid-pulse-and-color', syncopated: true },
    );
    const hybrid = generatePianoPedalLane(hybridPlan, notes, 1200);
    expect(hybrid).toBeNull();
    expect(chamber?.points.at(-1)?.value).toBe(0);
  });
});
