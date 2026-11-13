import { describe, expect, it } from 'vitest';
import dorian from '../fixtures/dorian-16bars.json';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { analyzePianoInput } from '../src/orchestrator/keys/piano-analyzer';
import {
  composePianoPlan,
  composePianoFoundationScore,
  composePianoScore,
  composePianoScoreWithDiagnostics,
  type PianoComposerPlan,
  type PianoPhraseIntention,
  type PianoTemplateIdentity,
  type PianoTextureKind,
} from '../src/orchestrator/keys/piano-composer';
import { validatePianoScorePlayability } from '../src/orchestrator/keys/piano-playability';
import type { PianoScore } from '../src/orchestrator/keys/piano-score';
import { projectFromFixture, isInstrumentTrack, type Project, type Track } from '../src/shared/schema';
import { PPQ } from '../src/shared/schema/types';
import { projectEndTick } from '../src/shared/schema/meter';

const TEMPLATE_IDS = [
  'ensemble.chamber',
  'ensemble.sonata',
  'ensemble.vocalbacking',
  'ensemble.cinematic',
  'ensemble.hybridstudio',
] as const;
type TemplateId = (typeof TEMPLATE_IDS)[number];

interface ComposerSample {
  readonly project: Project;
  readonly piano: Track;
  readonly input: ReturnType<typeof composeAllTracks>['pianoEngineInput'];
  readonly plan: PianoComposerPlan;
  readonly score: PianoScore;
}

const sampleCache = new Map<string, ComposerSample>();

function composerSample(templateId: TemplateId, seed: number, fixture: unknown = threeChorus): ComposerSample {
  const fixtureKey = fixture === dorian ? 'dorian' : 'three-chorus';
  const key = `${templateId}:${seed}:${fixtureKey}`;
  const cached = sampleCache.get(key);
  if (cached) return cached;

  const project = projectFromFixture(JSON.parse(JSON.stringify(fixture)) as Project);
  project.ensemble = { templateId, overrides: {}, pins: {} };
  project.orchestration = { take: 0 };
  const result = composeAllTracks(project, { seed });
  const piano = result.tracks.find((track) => isInstrumentTrack(track) && track.role === 'piano');
  if (!piano) throw new Error(`${templateId} composition returned no Piano target.`);
  const productionInput = result.pianoEngineInput;
  const input = {
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
  const plan = composePianoPlan(input, analyzePianoInput(input));
  const score = composePianoScore(input, plan, piano, projectEndTick(project));
  const sample = { project, piano, input, plan, score };
  sampleCache.set(key, sample);
  return sample;
}

function scoreSignature(score: PianoScore): string {
  return JSON.stringify(score.events.map((event) => [
    event.voiceId,
    event.pitch,
    event.startTick,
    event.durationTicks,
    event.techniqueIntent,
    event.dynamicIntent.velocity,
  ]));
}


function forcedTexturePlan(
  plan: PianoComposerPlan,
  textureKind: PianoTextureKind,
  identity: PianoTemplateIdentity,
  patch: {
    readonly fillDecision?: PianoComposerPlan['fillDecisions'][number];
    readonly attackRestriction?: PianoComposerPlan['attackRestrictions'][number];
  } = {},
): { readonly plan: PianoComposerPlan; readonly phrase: PianoPhraseIntention } {
  const phrase = plan.phrases.find((candidate) => candidate.endTick - candidate.startTick >= 8 * PPQ);
  if (!phrase) throw new Error('The score-level regression fixture needs a phrase of at least two bars.');
  const purpose: PianoPhraseIntention['texture']['purpose'] = textureKind === 'sparse-sustained'
    ? 'preserve-space'
    : textureKind === 'broken-chords' ? 'connect-harmony'
      : textureKind === 'arpeggiated' ? 'build-motion'
        : textureKind === 'melody-accompaniment' ? 'carry-melody'
          : textureKind === 'block-chords' ? 'mark-arrival'
            : textureKind === 'contrapuntal-dialogue' ? 'exchange-voices' : 'punctuate-phrase';
  const phrases = plan.phrases.map((candidate) => candidate.id !== phrase.id ? candidate : {
    ...candidate,
    intendedDensity: 'broad' as const,
    texture: {
      ...candidate.texture,
      kind: textureKind,
      purpose,
      leftHandRole: 'Composer-planned harmonic foundation and independent response.',
      rightHandRole: 'Composer-planned subject with chord-tone inner movement.',
    },
  });
  const harmonicEvents = plan.harmonicEvents.map((event) => event.phraseId !== phrase.id ? event : {
    ...event,
    hands: {
      left: { ...event.hands.left, motion: 'change-with-harmony' as const },
      right: { ...event.hands.right, density: 'broad' as const, motion: 'motif-led' as const },
    },
    orchestration: {
      ...event.orchestration,
      explicitLeadTrackIds: [],
      interaction: 'support-moment' as const,
    },
    dynamicIntent: { ...event.dynamicIntent, sourceEnergyNearSilence: false },
  });
  const forcedPlan: PianoComposerPlan = {
    ...plan,
    template: { ...plan.template, style: { ...plan.template.style, identity } },
    phrases,
    harmonicEvents,
    fillDecisions: patch.fillDecision ? [...plan.fillDecisions, patch.fillDecision] : plan.fillDecisions,
    attackRestrictions: patch.attackRestriction
      ? [...plan.attackRestrictions, patch.attackRestriction] : plan.attackRestrictions,
  };
  return { plan: forcedPlan, phrase };
}

function noUnisonOverlap(score: PianoScore): boolean {
  for (let index = 0; index < score.events.length; index++) {
    const left = score.events[index];
    for (let otherIndex = index + 1; otherIndex < score.events.length; otherIndex++) {
      const right = score.events[otherIndex];
      if (left.pitch !== right.pitch) continue;
      const overlap = left.startTick < right.startTick + right.durationTicks
        && right.startTick < left.startTick + left.durationTicks;
      if (overlap) return false;
    }
  }
  return true;
}

describe('Piano Engine Stage 3 musical development and coordinated writing', () => {
  it('is deterministic for identical inputs, varies by generation seed, and retains template identity', () => {
    const sameInput = composerSample('ensemble.chamber', 11);
    const repeatedPlan = composePianoPlan(sameInput.input, analyzePianoInput(sameInput.input));
    const repeatedScore = composePianoScore(
      sameInput.input, sameInput.plan, sameInput.piano, projectEndTick(sameInput.project),
    );
    expect(JSON.stringify(repeatedPlan)).toBe(JSON.stringify(sameInput.plan));
    expect(JSON.stringify(repeatedScore)).toBe(JSON.stringify(sameInput.score));

    const seedScores = [11, 29, 47].map((seed) => composerSample('ensemble.chamber', seed));
    expect(new Set(seedScores.map(({ score }) => scoreSignature(score))).size).toBeGreaterThan(1);
    for (const sample of seedScores) {
      expect(sample.score.generationIdentity.seed).toBe(sample.input.context.seed);
      expect(sample.score.events.length).toBeGreaterThan(0);
      expect(sample.score.events.every((event) => event.pitch >= sample.piano.lowestNote
        && event.pitch <= sample.piano.highestNote
        && event.startTick + event.durationTicks <= sample.score.projectEndTick)).toBe(true);
      expect(validatePianoScorePlayability(sample.score, {
        lowestNote: sample.piano.lowestNote,
        highestNote: sample.piano.highestNote,
      }).violations).toEqual([]);
    }

    const templateSamples = TEMPLATE_IDS.map((templateId) => composerSample(templateId, 11));
    expect(new Set(templateSamples.map(({ plan }) => plan.template.style.identity)).size).toBe(TEMPLATE_IDS.length);
    expect(new Set(templateSamples.map(({ score }) => scoreSignature(score))).size).toBeGreaterThan(1);
    for (const sample of templateSamples) {
      expect(sample.score.templateId).toBe(sample.plan.template.id);
      expect(sample.plan.template.eligible).toBe(true);
      expect(sample.score.events.every((event) => event.pitch >= sample.piano.lowestNote
        && event.pitch <= sample.piano.highestNote
        && event.startTick + event.durationTicks <= sample.score.projectEndTick)).toBe(true);
      expect(validatePianoScorePlayability(sample.score, {
        lowestNote: sample.piano.lowestNote,
        highestNote: sample.piano.highestNote,
      }).violations).toEqual([]);
    }
  });

  it('production contract — musical development and texture: phrase roles, theme operations and texture levels make audible structural differences', () => {
    const { plan, score, piano } = composerSample('ensemble.chamber', 17, dorian);
    expect(plan.motif).not.toBeNull();
    const melody = score.events.filter((event) => event.voiceId === 'rh.melody')
      .sort((a, b) => a.startTick - b.startTick);
    expect(melody.length).toBeGreaterThan(6);
    expect(new Set(melody.map((event) => event.pitch)).size).toBeGreaterThan(3);
    const intervals = melody.slice(1).map((event, index) => event.pitch - melody[index].pitch);
    expect(intervals.some((interval) => interval > 0)).toBe(true);
    expect(intervals.some((interval) => interval < 0)).toBe(true);
    expect(new Set(melody.slice(1).map((event, index) => event.startTick - melody[index].startTick)).size)
      .toBeGreaterThan(1);

    // Development is role-driven: the arc plan assigns more than one theme operation, and the
    // theme is both stated and developed in the written score.
    const { diagnostics } = composePianoScoreWithDiagnostics(
      composerSample('ensemble.chamber', 17, dorian).input, plan, piano, score.projectEndTick);
    expect(diagnostics).not.toBeNull();
    const operations = new Set(diagnostics!.phrases.map((phrase) => phrase.themeOperation)
      .filter((operation) => operation !== 'rest'));
    expect(operations.size).toBeGreaterThan(1);
    expect(melody.every((event) => event.startTick % (PPQ / 4) === 0)).toBe(true);
    expect(melody.some((event) => event.techniqueIntent === 'theme-statement')).toBe(true);
    expect(melody.some((event) => event.techniqueIntent === 'theme-development')).toBe(true);

    const left = score.events.filter((event) => event.hand === 'left');
    const right = score.events.filter((event) => event.hand === 'right');
    const leftOnsets = new Set(left.map((event) => event.startTick));
    const rightOnsets = new Set(right.map((event) => event.startTick));
    expect([...leftOnsets].some((tick) => rightOnsets.has(tick))).toBe(true);
    expect([...rightOnsets].some((tick) => !leftOnsets.has(tick))).toBe(true);
    expect(score.events.some((event) => event.voiceId === 'lh.bass' && event.noteRoleTag === 'anchor')).toBe(true);
    const innerEvents = score.events.filter((event) => event.voiceId === 'rh.inner');
    expect(new Set(innerEvents.map((event) => event.pitch)).size).toBeGreaterThan(1);

    for (const event of score.events) {
      expect(event.pitch).toBeGreaterThanOrEqual(piano.lowestNote);
      expect(event.pitch).toBeLessThanOrEqual(piano.highestNote);
      expect(event.startTick + event.durationTicks).toBeLessThanOrEqual(score.projectEndTick);
      expect(event.harmonicContext.chordIds.length).toBeGreaterThan(0);
      if (event.musicalRole === 'suspension'
        || event.harmonicContext.pitchClasses.includes(event.pitch % 12)) continue;
      // Only the theme may leave the chord, and only as a passing or neighbour tone that the
      // next theme note resolves by step onto a chord tone.
      const resolvedThemeTone = event.voiceId === 'rh.melody'
        && melody.some((candidate) => candidate.phraseId === event.phraseId
          && candidate.startTick > event.startTick
          && Math.abs(candidate.pitch - event.pitch) <= 2
          && candidate.harmonicContext.pitchClasses.includes(candidate.pitch % 12));
      expect(resolvedThemeTone,
        `${event.voiceId} off-chord pitch ${event.pitch} at ${event.startTick} resolves by step onto a chord tone`).toBe(true);
    }
    for (const tension of score.events.filter((event) => event.gestureIntent === 'prepared-tension')) {
      const resolution = score.events.find((event) => event.voiceId === tension.voiceId
        && event.gestureIntent === 'stepwise-resolution'
        && event.startTick >= tension.startTick + tension.durationTicks
        && event.phraseId !== null);
      expect(resolution).toBeDefined();
      expect(Math.abs(resolution!.pitch - tension.pitch)).toBeLessThanOrEqual(2);
    }

    expect(new Set(diagnostics!.bars.map((bar) => bar.adaptedLevel)).size).toBeGreaterThan(1);
    expect(noUnisonOverlap(score)).toBe(true);

    // ---- The same contract on the longer form, through the real Compose All path. ----
    const project = projectFromFixture(JSON.parse(JSON.stringify(threeChorus)) as Project);
    project.ensemble = { templateId: 'ensemble.chamber', overrides: {}, pins: {} };
    project.orchestration = { take: 0 };
    const composed = composeAllTracks(project, { seed: 17 });
    const form = composed.pianoDiagnostics!;
    const formScore = composed.pianoScore;
    const barTicksOf = 4 * PPQ;
    const barOf = (tick: number) => Math.floor(tick / barTicksOf) + 1;
    const draft = form.independentDraft.notes;
    const phraseOf = new Map(form.bars.map((bar) => [bar.bar, bar.phraseId]));
    const roleOf = new Map(form.phrases.map((phrase) => [phrase.phraseId, phrase.role]));

    // Phrase roles: the form is planned as more than statement-and-repeat ...
    const roles = new Set(form.phrases.map((phrase) => phrase.role));
    for (const role of ['statement', 'climax', 'arrival'] as const) expect(roles.has(role), role).toBe(true);
    expect(roles.size).toBeGreaterThanOrEqual(5);
    // ... and the roles are audible in the written notes: the climax phrase is planned at a higher
    // texture level than the statement, carries more attacks per bar, and is louder; the bar before
    // the final landing is quieter than the climax.
    const barsOfRole = (role: string) => form.bars.filter((bar) => roleOf.get(bar.phraseId) === role);
    const meanOf = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    const peakVelocity = (bars: typeof form.bars) => {
      const set = new Set(bars.map((bar) => bar.bar));
      return Math.max(...draft.filter((note) => set.has(barOf(note.t))).map((note) => note.v));
    };
    const statementBars = barsOfRole('statement');
    const climaxBars = barsOfRole('climax');
    const arrivalBars = barsOfRole('arrival');
    expect(meanOf(climaxBars.map((bar) => bar.independentLevel))).toBeGreaterThan(meanOf(statementBars.map((bar) => bar.independentLevel)));
    expect(meanOf(climaxBars.map((bar) => bar.independent.attacks))).toBeGreaterThan(meanOf(statementBars.map((bar) => bar.independent.attacks)));
    expect(peakVelocity(climaxBars)).toBeGreaterThan(peakVelocity(statementBars));
    expect(peakVelocity(climaxBars)).toBeGreaterThan(peakVelocity(arrivalBars));
    // The climax is the dynamic peak of the whole independent composition.
    expect(peakVelocity(climaxBars)).toBe(Math.max(...draft.map((note) => note.v)));

    // Texture levels: each level is a different way of playing, not a different note count.
    // Up to level 1 the left hand stays on the beat; from level 2 it moves in eighth notes.
    const leftDraft = (bar: number) => draft.filter((note) => barOf(note.t) === bar && (note.l === 'bass' || note.l === 'accompaniment'));
    const reshapedByTransition = new Set((form.performance?.transitions ?? [])
      .filter((decision) => (decision.independentGesture ?? decision.gesture) !== 'none' && (decision.independentGesture ?? decision.gesture) !== 'minimal')
      .map((decision) => decision.bar));
    // Those bars are not left unchecked: each is a section boundary whose gesture was verified
    // against the final score, and they are a small part of the piece.
    const boundaryRendering = new Map((form.performance?.transitionRendering ?? []).map((item) => [item.bar, item]));
    for (const bar of reshapedByTransition) {
      expect(boundaryRendering.get(bar)?.rendered, `boundary bar ${bar}: ${boundaryRendering.get(bar)?.found}`).toBe(true);
    }
    expect(reshapedByTransition.size).toBeLessThanOrEqual((form.performance?.transitions ?? []).length);
    expect(reshapedByTransition.size * 4).toBeLessThanOrEqual(form.bars.length);
    const levelsPresent = [...new Set(form.bars.map((bar) => bar.independentLevel))].sort();
    expect(levelsPresent.length).toBeGreaterThanOrEqual(3);
    for (const bar of form.bars.filter((entry) => entry.independent.attacks > 0 && entry.independent.bass + entry.independent.accompaniment > 0)) {
      const offBeat = leftDraft(bar.bar).filter((note) => note.t % PPQ !== 0).length;
      // (A bar in which the left hand carries the theme is not an accompaniment bar.)
      const leftTheme = draft.some((note) => barOf(note.t) === bar.bar && note.k === 'independent-counterline');
      if (leftTheme) continue;
      // (Stage 2A: a boundary bar whose transition gesture reshapes the bar is not a texture-level bar.)
      if (reshapedByTransition.has(bar.bar)) continue;
      if (bar.independentLevel <= 1) expect(offBeat, `level ${bar.independentLevel} bar ${bar.bar} keeps to the beat`).toBe(0);
      else expect(offBeat, `level ${bar.independentLevel} bar ${bar.bar} flows in eighths`).toBeGreaterThan(0);
    }
    const meanLeftAttacks = (level: number) => meanOf(form.bars
      .filter((bar) => bar.independentLevel === level && bar.independent.attacks > 0)
      .map((bar) => new Set(leftDraft(bar.bar).map((note) => note.t)).size));
    expect(meanLeftAttacks(2)).toBeGreaterThan(meanLeftAttacks(1));
    expect(meanLeftAttacks(1)).toBeGreaterThan(meanLeftAttacks(0));

    // Theme development: the theme's opening bar is restated in several phrases with the same
    // rhythm but at different pitch levels, under more than two role-driven operations.
    const themeBarShape = (bar: number) => {
      const notes = draft.filter((note) => note.l === 'melody' && note.k !== 'octave-doubling' && note.k !== 'cascading-gesture'
        && barOf(note.t) === bar).sort((a, b) => a.t - b.t);
      return {
        rhythm: notes.map((note) => note.t - (bar - 1) * barTicksOf).join(','),
        pitches: notes.map((note) => note.p).join(','),
        count: notes.length,
      };
    };
    const openings = form.bars.filter((bar) => bar.themeBar === 0).map((bar) => ({ bar, shape: themeBarShape(bar.bar) }))
      .filter(({ shape }) => shape.count >= 3);
    const statementOpening = openings.find(({ bar }) => roleOf.get(bar.phraseId) === 'statement')!;
    expect(statementOpening).toBeDefined();
    const sameRhythm = openings.filter(({ shape }) => shape.rhythm === statementOpening.shape.rhythm);
    expect(new Set(sameRhythm.map(({ bar }) => bar.phraseId)).size, 'the theme head recurs across phrases').toBeGreaterThanOrEqual(3);
    expect(new Set(sameRhythm.map(({ shape }) => shape.pitches)).size, 'and is heard at several pitch levels').toBeGreaterThanOrEqual(3);
    const formOperations = new Set(form.phrases.map((phrase) => phrase.themeOperation));
    formOperations.delete('rest');
    expect(formOperations.size).toBeGreaterThanOrEqual(4);
    // Each operation is tied to a role, never drawn at random: the same role always maps to one operation.
    const operationByRole = new Map<string, Set<string>>();
    for (const phrase of form.phrases) {
      operationByRole.set(phrase.role, (operationByRole.get(phrase.role) ?? new Set()).add(phrase.themeOperation));
    }
    for (const [role, set] of operationByRole) {
      if (role !== 'development') expect(set.size, `${role} uses one operation`).toBe(1);
    }
    // Hand exchange is part of the development: somewhere the left hand carries the theme while the
    // right hand takes over the broken figuration in the same bar.
    const exchangeBars = [...new Set(formScore.events.filter((event) => event.techniqueIntent === 'independent-counterline')
      .map((event) => barOf(event.startTick)))];
    expect(exchangeBars.length).toBeGreaterThan(0);
    for (const bar of exchangeBars) {
      expect(formScore.events.some((event) => barOf(event.startTick) === bar && event.hand === 'right'
        && event.techniqueIntent === 'broken-chord-accompaniment'), `bar ${bar} right hand accompanies the left-hand theme`).toBe(true);
    }
    expect(phraseOf.size).toBe(form.bars.length);
    expect(composed.pianoPlayability.violations).toEqual([]);
    const playability = validatePianoScorePlayability(score, {
      lowestNote: piano.lowestNote,
      highestNote: piano.highestNote,
    });
    expect(playability.violations).toEqual([]);
  });

  it('legacy foundation writer (not the production score): writes broken chords, arpeggiation, dialogue, hybrid pulse, and reserved flourishes', () => {
    const sample = composerSample('ensemble.chamber', 17, dorian);
    const basePhrase = sample.plan.phrases.find((phrase) => phrase.endTick - phrase.startTick >= 8 * PPQ)!;
    const fillDecision: PianoComposerPlan['fillDecisions'][number] = {
      target: 'piano',
      startTick: basePhrase.startTick + PPQ,
      endTick: basePhrase.startTick + 4 * PPQ,
      sectionId: basePhrase.sectionId,
      decision: 'consider-brief-gesture',
      observedWrittenActivity: { availability: 'available', activeTrackIds: [], onsetCount: 0 },
      rationale: 'Stage 3 score regression reservation.',
      mandatory: false,
    };
    const patternCases: Array<{
      readonly kind: PianoTextureKind;
      readonly identity: PianoTemplateIdentity;
      readonly technique: PianoScore['events'][number]['techniqueIntent'];
      readonly fill?: boolean;
    }> = [
      { kind: 'broken-chords', identity: 'chamber-counterpoint', technique: 'broken-chord-accompaniment' },
      { kind: 'arpeggiated', identity: 'cinematic-expanse', technique: 'arpeggiated-chord-accompaniment' },
      { kind: 'contrapuntal-dialogue', identity: 'sonata-dialogue', technique: 'independent-counterline' },
      { kind: 'arpeggiated', identity: 'hybrid-pulse-and-color', technique: 'pulsed-bass-pattern' },
      { kind: 'short-flourishes', identity: 'sonata-dialogue', technique: 'staccato-fill-gesture', fill: true },
    ];

    for (const pattern of patternCases) {
      const forced = forcedTexturePlan(sample.plan, pattern.kind, pattern.identity,
        pattern.fill ? { fillDecision } : {});
      const score = composePianoFoundationScore(sample.input, forced.plan, sample.piano, projectEndTick(sample.project));
      const plannedPatternEvents = score.events.filter((event) => event.phraseId === forced.phrase.id
        && event.techniqueIntent === pattern.technique);
      expect(plannedPatternEvents.length, `${pattern.identity} ${pattern.kind} must reach score notes`).toBeGreaterThan(0);
      expect(plannedPatternEvents.every((event) => event.startTick >= forced.phrase.startTick
        && event.startTick < forced.phrase.endTick)).toBe(true);
      expect(noUnisonOverlap(score)).toBe(true);
      expect(validatePianoScorePlayability(score, {
        lowestNote: sample.piano.lowestNote,
        highestNote: sample.piano.highestNote,
      }).violations).toEqual([]);

      if (pattern.kind === 'short-flourishes') {
        expect(plannedPatternEvents.every((event) => event.startTick >= fillDecision.startTick
          && event.startTick < fillDecision.endTick)).toBe(true);
        expect(plannedPatternEvents.every((event) => event.articulation === 'staccato')).toBe(true);
      }
    }

    const restrictedStart = basePhrase.startTick + PPQ;
    const restrictedEnd = basePhrase.startTick + 2 * PPQ;
    const restriction = {
      bar: 1,
      startTick: restrictedStart,
      endTick: restrictedEnd,
      reason: 'near-silence-zero-energy' as const,
      rationale: 'A Composer regression gate forbids new accompaniment onsets here.',
    };
    const forcedPulse = forcedTexturePlan(sample.plan, 'arpeggiated', 'hybrid-pulse-and-color', {
      attackRestriction: restriction,
      fillDecision: {
        target: 'piano', startTick: restrictedStart, endTick: restrictedEnd,
        sectionId: basePhrase.sectionId, decision: 'leave-space',
        observedWrittenActivity: { availability: 'available', activeTrackIds: [], onsetCount: 0 },
        rationale: 'Explicit leave-space regression gate.', mandatory: false,
      },
    });
    const gatedScore = composePianoFoundationScore(
      sample.input, forcedPulse.plan, sample.piano, projectEndTick(sample.project),
    );
    expect(gatedScore.events.some((event) => event.startTick >= restrictedStart && event.startTick < restrictedEnd
      && event.voiceId !== 'rh.suspension')).toBe(false);
  });
});
