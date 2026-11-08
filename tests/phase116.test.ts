import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { defaultRules } from '../src/config/generation-rules';
import { checkTemplateRules, measureEnergy } from '../src/orchestrator/energy';
import { chordSpans, sanitizeNotes } from '../src/engine/generate';
import { barTicks, beatOffsets, beatTicks, projectBars } from '../src/shared/schema/meter';
import { projectEndTick, projectFromFixture, validateProject, type Note, type Project } from '../src/shared/schema';
import { resolveTemplate } from '../src/config/ensembles';
import { msToTicks } from '../src/orchestrator/spine';
import { cellGrid } from '../src/orchestrator/lines/ostinato';
import { scalePitchClasses } from '../src/shared/schema/modes';
import { buildMergedMidi, parseMidiFile } from '../src/export/midi';
import {
  PIANO_ARRIVAL_PHRASE_BARS, PIANO_CONCURRENCY, PIANO_JOB_ROTATION, PIANO_MOTION_PHRASE_BARS,
  PIANO_PUNCTUATION_SHARE, PIANO_REPEATED_CHORD_MAX_SHARE, PIANO_UP_MAX_SHARE, type PianoJob,
} from '../src/orchestrator/keys/profile';

const PIANO = 'piano';
const HARP = 'harp';
const TEMPLATES = [
  'ensemble.chamber', 'ensemble.sonata', 'ensemble.vocalbacking',
  'ensemble.cinematic', 'ensemble.hybridstudio', 'ensemble.symphony',
];
const FIXTURES = { three: threeChorus as unknown as Project, dorian: dorian as unknown as Project };
type Fixture = keyof typeof FIXTURES;

function composeTake(fixture: Fixture, templateId: string, take: number) {
  const p = projectFromFixture(JSON.parse(JSON.stringify(FIXTURES[fixture])) as Project);
  p.ensemble = { templateId, overrides: {}, pins: {} };
  p.orchestration = { take };
  const result = composeAllTracks(p, { seed: 11 });
  return { project: { ...p, tracks: result.tracks, orchestration: result.orchestration } as Project, result };
}

const roleNotes = (project: Project, role: string): Note[] => project.tracks.find((t) => t.role === role)?.notes ?? [];
const pcOf = (pitch: number): number => ((pitch % 12) + 12) % 12;
const spansOf = (project: Project) => chordSpans(project);
const spanAt = (spans: ReturnType<typeof chordSpans>, tick: number) =>
  spans.find((s) => s.startTick <= tick && tick < s.endTick) ?? spans[0];

function samePitchOverlapPairs(notes: Note[]): [Note, Note][] {
  const pairs: [Note, Note][] = [];
  for (let i = 0; i < notes.length; i++) for (let j = i + 1; j < notes.length; j++) {
    const a = notes[i], b = notes[j];
    if (a.pitch === b.pitch && a.startTick < b.startTick + b.durationTicks && b.startTick < a.startTick + a.durationTicks) pairs.push([a, b]);
  }
  return pairs;
}

function lowStringsSoundInBar(project: Project, bar: number): boolean {
  const bt = barTicks(project.timeSignature);
  const start = (bar - 1) * bt;
  const end = bar * bt;
  return project.tracks
    .filter((t) => t.role === 'violas' || t.role === 'cellosBasses')
    .some((t) => t.notes.some((n) => n.pitch <= 71 && n.startTick < end && n.startTick + n.durationTicks > start));
}

function strikesForBar(project: Project, bar: number, kind: string, shape?: string) {
  const bt = barTicks(project.timeSignature);
  const beat = beatTicks(project.timeSignature);
  const start = (bar - 1) * bt;
  const end = Math.min(projectEndTick(project), bar * bt);
  const hitEnd = kind === 'final'
    ? Math.min(end, start + beat * 2)
    : kind === 'tutti'
      ? Math.min(end, start + (shape === 'breath' ? beat : shape === 'decay' ? beat * 2 : bt))
      : end;
  const spans = spansOf(project);
  const starts = [...new Set([start, ...spans.filter((s) => s.startTick > start && s.startTick < hitEnd).map((s) => s.startTick)])]
    .filter((t) => t < hitEnd).sort((a, b) => a - b);
  return starts.map((onset, i) => {
    const span = spanAt(spans, onset);
    const release = Math.min(hitEnd, end, span?.endTick ?? end, starts[i + 1] ?? Number.MAX_SAFE_INTEGER);
    return { onset, release, span };
  });
}

function groupAt(notes: Note[], onset: number, jitterMax: number): Note[] {
  return notes.filter((n) => n.startTick >= onset && n.startTick <= onset + jitterMax);
}

function assertPianoPolyphony(notes: Note[], label: string) {
  const starts = [...new Set(notes.map((n) => n.startTick))].sort((a, b) => a - b);
  for (const tick of starts) {
    const active = notes.filter((n) => n.startTick <= tick && n.startTick + n.durationTicks > tick);
    const below = active.filter((n) => n.pitch < 55).length;
    const atOrAbove = active.length - below;
    expect(active.length, `${label}: ${active.length} total notes at ${tick}`).toBeLessThanOrEqual(PIANO_CONCURRENCY.total);
    expect(below, `${label}: ${below} notes below 55 at ${tick}`).toBeLessThanOrEqual(PIANO_CONCURRENCY.below55);
    expect(atOrAbove, `${label}: ${atOrAbove} notes at/above 55 at ${tick}`).toBeLessThanOrEqual(PIANO_CONCURRENCY.at55);
  }
}

describe('Phase 11.6a: piano held-anchor contract', () => {
  it('plans anchor roles from section position and energy, reports the counts, and tags every rendered piano event', () => {
    for (const [fixture, template, take] of [
      ['three', 'ensemble.chamber', 1],
      ['three', 'ensemble.vocalbacking', 3],
      ['dorian', 'ensemble.sonata', 2],
      ['three', 'ensemble.cinematic', 4],
    ] as const) {
      const { project, result } = composeTake(fixture, template, take);
      const piano = roleNotes(project, PIANO);
      const plan = result.plan.keys;
      const plannedAnchors = plan.bars.filter((b) => b.pianoRole === 'anchor').length;
      expect(plan.pianoRoleCounts.anchor, `${template} t${take}: plan role count`).toBe(plannedAnchors);
      expect(plan.bars.some((b) => b.voices.piano === 'anchor')).toBe(true);
      const generatedTake = result.orchestration.take;
      expect(result.reports.some((r) => r.includes(`keys piano roles (take ${generatedTake}): anchor=${plannedAnchors}, answer=`))).toBe(true);
      expect(result.reports.some((r) => r.includes(`keys plan (take ${generatedTake}): roles anchor=${plannedAnchors}, answer=`))).toBe(true);
      expect(result.reports.some((r) => r.startsWith(`keys piano answer role events (take ${generatedTake}):`))).toBe(true);
      expect(result.reports.some((r) => r.startsWith(`piano absorption (take ${generatedTake}):`))).toBe(true);
      expect(piano.length).toBeGreaterThan(0);
      expect(piano.every((n) => ['anchor', 'lift', 'settle', 'bed', 'atmosphere', 'arrival', 'punctuation', 'power', 'answer'].includes(n.roleTag ?? '')), `${template} t${take}: piano role tags are schema-approved`).toBe(true);
      expect(piano.some((n) => n.roleTag === 'anchor'), `${template} t${take}: held anchor remains present`).toBe(true);
      expect(project.tracks.find((t) => t.role === HARP)?.notes.every((n) => n.roleTag === undefined)).toBe(true);
      assertPianoPolyphony(piano, `${template} ${fixture} t${take}`);
    }
  });

  it('writes LH root bodies and RH triads/sevenths at chord changes, holds releases together, and keeps the two hands separated', () => {
    const samples = [
      ['three', 'ensemble.chamber', 1],
      ['three', 'ensemble.sonata', 4],
      ['three', 'ensemble.vocalbacking', 2],
      ['dorian', 'ensemble.cinematic', 3],
      ['three', 'ensemble.hybridstudio', 5],
    ] as const;
    for (const [fixture, templateId, take] of samples) {
      const { project, result } = composeTake(fixture, templateId, take);
      const notes = roleNotes(project, PIANO);
      const anchors = notes.filter((note) => note.roleTag === 'anchor');
      const bt = barTicks(project.timeSignature);
      const jitterMax = Math.ceil(msToTicks(12, project.tempoMap)) + 2;
      const bars = projectBars(project);
      const strikesSeen = new Set<string>();
      let strikesTotal = 0;
      let fifthPedals = 0;

      for (const planBar of result.plan.keys.bars) {
        const kind = planBar.voices.piano;
        if (!kind || planBar.pianoPower || planBar.pianoRepeatedChord || planBar.pianoAnswer) continue;
        const shape = result.plan.moments.find((m) => m.kind === 'tutti' && planBar.bar >= m.startBar && planBar.bar <= m.endBar)?.shape;
        for (const strike of strikesForBar(project, planBar.bar, kind, shape)) {
          const group = groupAt(anchors, strike.onset, jitterMax);
          expect(group.length, `${templateId} t${take} b${planBar.bar}: planned strike at ${strike.onset} is rendered`).toBeGreaterThan(0);
          strikesSeen.add(`${planBar.bar}:${strike.onset}`);
          expect(group.every((n) => n.roleTag === 'anchor')).toBe(true);
          const ends = group.map((n) => n.startTick + n.durationTicks);
          const body = group.filter((n) => n.pitch <= (templateId === 'ensemble.vocalbacking' ? 56 : 55));
          if (!planBar.pianoPunctuation && !planBar.pianoFigure) {
            expect(Math.max(...ends) - Math.min(...ends), `${templateId} t${take} b${planBar.bar}: unornamented strike releases together`).toBeLessThanOrEqual(16);
          }
          expect(Math.max(...ends), `${templateId} b${planBar.bar}: release does not pass its harmonic span`).toBeLessThanOrEqual(strike.release);
          if (body.length) {
            const heldLowest = body.reduce((lowest, note) => note.pitch < lowest.pitch ? note : lowest);
            expect(strike.release - (heldLowest.startTick + heldLowest.durationTicks), `${templateId} b${planBar.bar}: held body's lowest note reaches the span end`).toBeLessThanOrEqual(jitterMax + 2);
          }
          expect(Math.max(...group.map((n) => n.durationTicks)), `${templateId} b${planBar.bar}: piano note exceeds a bar`).toBeLessThanOrEqual(bt);

          const rootPc = pcOf(strike.span.parsed.root);
          const bass = Math.min(...group.map((n) => n.pitch));
          const bassInterval = (pcOf(bass) - rootPc + 12) % 12;
          expect([0, 7], `${templateId} b${planBar.bar}: bass must be root or an allowed fifth pedal`).toContain(bassInterval);
          strikesTotal++;
          if (bassInterval === 7) fifthPedals++;
          const isSpecial = kind === 'tutti' || kind === 'final';
          if (isSpecial) {
            expect(group.length, `${templateId} b${planBar.bar}: tutti/final is a single or octave hit`).toBeLessThanOrEqual(2);
            expect(Math.max(...group.map((n) => n.pitch)) - Math.min(...group.map((n) => n.pitch)), `${templateId} b${planBar.bar}: special hit is not wider than an octave`).toBeLessThanOrEqual(12);
            expect(new Set(group.map((n) => pcOf(n.pitch))).size, `${templateId} b${planBar.bar}: special hit is root/octave only`).toBe(1);
            expect(bass).toBeGreaterThanOrEqual(36);
            continue;
          }

          const isVocalBacking = templateId === 'ensemble.vocalbacking';
          const lh = group.filter((n) => n.pitch <= (isVocalBacking ? 56 : 55));
          const rh = group.filter((n) => n.pitch >= (isVocalBacking ? 82 : 64));
          expect(lh.length, `${templateId} b${planBar.bar}: LH body is present`).toBeGreaterThanOrEqual(1);
          expect(Math.min(...lh.map((n) => n.pitch)), `${templateId} b${planBar.bar}: LH floor`).toBeGreaterThanOrEqual(40);
          expect(Math.max(...lh.map((n) => n.pitch)), `${templateId} b${planBar.bar}: LH ceiling`).toBeLessThanOrEqual(isVocalBacking ? 56 : 55);
          for (const n of lh) {
            const interval = (pcOf(n.pitch) - rootPc + 12) % 12;
            expect([0, 7], `${templateId} b${planBar.bar}: LH uses root/octave/open fifth only`).toContain(interval);
            if (n.pitch < 55) expect([0, 7], `${templateId} b${planBar.bar}: no third/fourth below 55`).toContain(interval);
          }
          if (planBar.pianoArrival && strike.onset === (planBar.bar - 1) * bt) continue; // rolled RH is checked in 11.6c
          const overlap = (templateId === 'ensemble.chamber' || templateId === 'ensemble.sonata') && lowStringsSoundInBar(project, planBar.bar);
          if (rh.length) {
            expect(Math.min(...rh.map((n) => n.pitch)), `${templateId} b${planBar.bar}: RH floor`).toBeGreaterThanOrEqual(isVocalBacking ? 82 : overlap ? 72 : 64);
            expect(Math.min(...rh.map((n) => n.pitch)) - Math.max(...lh.map((n) => n.pitch)), `${templateId} b${planBar.bar}: hand gap`).toBeGreaterThanOrEqual(8);
            const sortedRh = rh.map((n) => n.pitch).sort((a, b) => a - b);
            for (let i = 1; i < sortedRh.length; i++) {
              expect(sortedRh[i] - sortedRh[i - 1], `${templateId} b${planBar.bar}: adjacent RH tones need at least a third`).toBeGreaterThanOrEqual(3);
            }
            if (sortedRh.length >= 3 && !planBar.pianoFigure && !planBar.pianoPunctuation) {
              expect(sortedRh.at(-1)! - sortedRh[0]).toBeGreaterThanOrEqual(12);
            }
            if (overlap) expect(sortedRh[0]).toBeGreaterThanOrEqual(72);
            const hasSeventh = strike.span.parsed.quality.toLowerCase().includes('7') || strike.span.parsed.intervals.some((i) => i === 10 || i === 11);
            if (planBar.pianoFigure || planBar.pianoPunctuation) {
              expect(rh.length, `${templateId} b${planBar.bar}: chord tones survive the planned overlay`).toBeGreaterThanOrEqual(2);
            } else if (hasSeventh) {
              expect([3, 4], `${templateId} b${planBar.bar}: retain or drop the seventh as needed`).toContain(rh.length);
            } else expect(rh.length, `${templateId} b${planBar.bar}: RH triad`).toBe(3);
          } else {
            expect(overlap, `${templateId} b${planBar.bar}: LH-only is allowed only for low chamber/sonata strings`).toBe(true);
          }
          expect(group.every((n) => !isVocalBacking || n.pitch <= 56 || n.pitch >= 82), `${templateId} b${planBar.bar}: vocalbacking gap 57-81 remains empty`).toBe(true);
        }
      }
      expect(strikesSeen.size, `${templateId} ${fixture} t${take}: no planned strikes were checked`).toBeGreaterThan(0);
      expect(fifthPedals, `${templateId} ${fixture} t${take}: fifth pedal strikes exceed 10%`).toBeLessThanOrEqual(Math.floor(strikesTotal * 0.1));

      // No piano note may appear away from an active planned chord-change
      // window (modulo the documented late microtiming).
      const allExpected = result.plan.keys.bars.flatMap((pb) => {
        const kind = pb.voices.piano;
        if (!kind) return [];
        const shape = result.plan.moments.find((m) => m.kind === 'tutti' && pb.bar >= m.startBar && pb.bar <= m.endBar)?.shape;
        return strikesForBar(project, pb.bar, kind, shape).map((strike) => strike.onset);
      });
      for (const n of anchors) {
        expect(allExpected.some((tick) => n.startTick >= tick && n.startTick <= tick + jitterMax), `${templateId} t${take}: unexpected held-anchor onset ${n.startTick}`).toBe(true);
      }
      expect(bars).toBeGreaterThan(0);
    }
  });

  it('honours vocalbacking registers, chamber/sonata string clearance, moment hits and the two-stage polyphony cap', () => {
    for (const [fixture, templateId, take] of [
      ['three', 'ensemble.vocalbacking', 1],
      ['three', 'ensemble.chamber', 1],
      ['three', 'ensemble.sonata', 3],
      ['dorian', 'ensemble.vocalbacking', 7],
    ] as const) {
      const { project, result } = composeTake(fixture, templateId, take);
      const notes = roleNotes(project, PIANO);
      expect(notes.length).toBeGreaterThan(0);
      expect(notes.every((n) => ['anchor', 'lift', 'settle', 'bed', 'atmosphere', 'arrival', 'punctuation', 'power', 'answer'].includes(n.roleTag ?? ''))).toBe(true);
      expect(notes.some((n) => n.roleTag === 'anchor')).toBe(true);
      assertPianoPolyphony(notes, `${templateId} ${fixture} t${take}`);
      if (templateId === 'ensemble.vocalbacking') {
        expect(notes.every((n) => n.pitch <= 56 || n.pitch >= 82), `${templateId}: no piano notes in 57-81`).toBe(true);
        expect(notes.filter((n) => n.pitch <= 56).every((n) => n.pitch >= 40 || n.articulation === 'marcato'), `${templateId}: LH floor`).toBe(true);
      }
      if (templateId === 'ensemble.chamber' || templateId === 'ensemble.sonata') {
        const bt = barTicks(project.timeSignature);
        for (const n of notes) {
          const bar = Math.floor(n.startTick / bt) + 1;
          if (!lowStringsSoundInBar(project, bar) || n.pitch < 64) continue;
          expect(n.pitch, `${templateId} b${bar}: RH clears low viola/cello register`).toBeGreaterThanOrEqual(72);
        }
      }
      const specialBars = result.plan.keys.bars.filter((b) => b.voices.piano === 'tutti' || b.voices.piano === 'final');
      for (const pb of specialBars) {
        const bt = barTicks(project.timeSignature);
        const start = (pb.bar - 1) * bt;
        const notesInHit = notes.filter((n) => n.startTick >= start && n.startTick < start + beatTicks(project.timeSignature));
        for (const n of notesInHit) expect(n.pitch).toBeGreaterThanOrEqual(36);
        expect(notesInHit.every((n) => n.roleTag === 'anchor' || (pb.voices.piano === 'final' && n.roleTag === 'arrival'))).toBe(true);
      }
      const template = resolveTemplate({ templateId, overrides: {}, pins: {} })!;
      const energy = measureEnergy(project, template);
      expect(energy.violations.filter((v) => v.kind === 'aboveMax'), `${templateId}: energy clamp`).toHaveLength(0);
    }
  });

  it('makes sanitizeNotes a no-op on each complete piano lane and preserves the collision-free lane in MIDI export', () => {
    for (const [templateId, take] of [
      ['ensemble.chamber', 1], ['ensemble.chamber', 7],
      ['ensemble.sonata', 2], ['ensemble.sonata', 11],
      ['ensemble.vocalbacking', 1], ['ensemble.vocalbacking', 9],
      ['ensemble.cinematic', 3], ['ensemble.cinematic', 13],
      ['ensemble.hybridstudio', 5], ['ensemble.hybridstudio', 17],
    ] as const) {
      const { project } = composeTake('three', templateId, take);
      const piano = project.tracks.find((track) => track.role === PIANO)!;
      expect(samePitchOverlapPairs(piano.notes), `${templateId} take ${take}: full piano lane`).toHaveLength(0);
      expect(
        sanitizeNotes(piano.notes, piano.lowestNote, piano.highestNote, projectEndTick(project)),
        `${templateId} take ${take}: full-lane sanitizer no-op`,
      ).toEqual(piano.notes);
      const parsed = parseMidiFile(buildMergedMidi(project, project.tracks));
      const midiPiano = parsed.tracks.find((track) => track.name === piano.name);
      expect(midiPiano, `${templateId} take ${take}: piano MIDI track`).toBeDefined();
      expect(samePitchOverlapPairs(midiPiano!.notes), `${templateId} take ${take}: exported piano MIDI lane`).toHaveLength(0);
    }
  }, 120000);

  it('schema validation accepts anchor and rejects unknown role tags', () => {
    const { project } = composeTake('three', 'ensemble.chamber', 1);
    const good = validateProject(project);
    expect(good.ok).toBe(true);
    const altered = structuredClone(project);
    const piano = altered.tracks.find((t) => t.role === PIANO)!;
    piano.notes[0].roleTag = 'not-a-role' as never;
    const bad = validateProject(altered);
    expect(bad.ok).toBe(false);
    expect('errors' in bad && bad.errors.some((e) => e.path.includes('roleTag'))).toBe(true);
  });

  it('keeps keys deterministic, clamp-safe, vocal-zone-free, sanitize-safe and valid', () => {
    const first = composeTake('three', 'ensemble.vocalbacking', 0); // output take 1
    const second = composeTake('three', 'ensemble.vocalbacking', 0);
    expect(JSON.stringify(first.project.tracks)).toBe(JSON.stringify(second.project.tracks));
    expect(validateProject(first.project).ok).toBe(true);

    const template = resolveTemplate({ templateId: 'ensemble.vocalbacking', overrides: {}, pins: {} })!;
    expect(measureEnergy(first.project, template).violations.filter((v) => v.kind === 'aboveMax')).toHaveLength(0);
    const piano = first.project.tracks.find((t) => t.role === PIANO)!;
    expect(samePitchOverlapPairs(piano.notes)).toHaveLength(0);
    expect(sanitizeNotes(piano.notes, piano.lowestNote, piano.highestNote, projectEndTick(first.project))).toEqual(piano.notes);
    const keysNotes = first.project.tracks.filter((t) => t.role === PIANO || t.role === HARP).flatMap((t) => t.notes);
    expect(keysNotes.every((n) => n.pitch <= 56 || n.pitch >= 82)).toBe(true);
  });
});

describe('Retired generator-rule guard', () => {
  it('the generator writes exactly the 16 retired rules of spec §16.10 — no more, none missing', () => {
    const windRoles = new Set(['clarinets', 'flutes', 'oboes', 'bassoons']);
    const percussionRoles = new Set(['timpani', 'snare', 'cymbals']);
    const keysRoles = new Set(['harp', 'piano']);
    const expected = {
      winds: ['Clarinet line', 'Flutes double Vln I', 'Oboes', 'Bassoons bass', 'Oboe solo'],
      percussion: ['Timpani downbeat', 'Snare roll fill', 'Timpani', 'Snare', 'Cymbal crash'],
      keys: ['Harp arpeggio', 'Piano chords', 'Piano', 'Harp arp', 'Harp final', 'Keys sustain (any family Keys)'],
    };
    const found: Record<keyof typeof expected, string[]> = { winds: [], percussion: [], keys: [] };
    for (const [sectionName, section] of Object.entries(defaultRules.sections)) {
      for (const part of section.parts) {
        const roles = part.match.roles ?? [];
        const family = roles.some((role) => windRoles.has(role)) ? 'winds'
          : roles.some((role) => percussionRoles.has(role)) ? 'percussion'
            : roles.some((role) => keysRoles.has(role)) || (part.match.families ?? []).includes('Keys') ? 'keys'
              : null;
        if (family) found[family].push(`${sectionName}:${part.label}`);
      }
    }
    for (const family of ['winds', 'percussion', 'keys'] as const) {
      const actual = found[family].map((entry) => entry.split(':')[1]).sort();
      expect(actual, `${family} retired rules`).toEqual([...expected[family]].sort());
    }
    expect(found.winds).toHaveLength(5);
    expect(found.percussion).toHaveLength(5);
    expect(found.keys).toHaveLength(6);
  });
});

describe('Phase 11.6b: motion figures over the held anchor', () => {
  it('assigns balanced section-instance jobs with take offset and derives each slope from adjacent arc targets', () => {
    for (const inputTake of [0, 1]) {
      const { project, result } = composeTake('three', 'ensemble.chamber', inputTake);
      const outputTake = result.orchestration.take;
      const keysPlan = result.plan.keys;
      const jobs = keysPlan.pianoJobs;
      expect(jobs).toHaveLength(project.sections.length);
      jobs.forEach((section, ordinal) => {
        expect(section.job, `take ${outputTake}, ${section.sectionName} instance ${ordinal}`).toBe(
          PIANO_JOB_ROTATION[(outputTake - 1 + ordinal) % PIANO_JOB_ROTATION.length],
        );
        expect(section.arpeggiatorOwner).toMatch(/^(harp|piano)$/);
        if (ordinal > 0) expect(section.job).not.toBe(jobs[ordinal - 1].job);
      });
      const jobCounts: Record<PianoJob, number> = { support: 0, motion: 0, power: 0 };
      for (const section of jobs) jobCounts[section.job]++;
      expect(Math.max(...Object.values(jobCounts)) - Math.min(...Object.values(jobCounts))).toBeLessThanOrEqual(1);

      for (const planBar of keysPlan.bars) {
        const section = project.sections.find((candidate) => planBar.bar >= candidate.startBar && planBar.bar < candidate.startBar + candidate.lengthBars);
        if (!section) continue;
        const sectionEnd = section.startBar + section.lengthBars - 1;
        const adjacent = planBar.bar < sectionEnd
          ? keysPlan.bars[planBar.bar]?.norm - planBar.norm
          : planBar.bar > section.startBar
            ? planBar.norm - keysPlan.bars[planBar.bar - 2].norm
            : 0;
        const expected = adjacent > 0.005 ? 'rising' : adjacent < -0.005 ? 'falling' : 'flat';
        expect(planBar.energySlope, `b${planBar.bar} slope vs adjacent ArcBar targets`).toBe(expected);
        expect(planBar.sectionEnd).toBe(planBar.bar === sectionEnd || undefined);
      }

      const plannedUps = keysPlan.bars.filter((bar) => bar.pianoFigure === 'arpUp');
      const plannedDowns = keysPlan.bars.filter((bar) => bar.pianoFigure === 'arpDown');
      const plannedPendulums = keysPlan.bars.filter((bar) => bar.pianoFigure === 'arpPendulum');
      expect(plannedUps.every((bar) => bar.energySlope === 'rising' && bar.pianoFigureRole === 'lift')).toBe(true);
      expect(plannedDowns.every((bar) => (bar.energySlope === 'falling' || bar.sectionEnd) && bar.pianoFigureRole === 'settle')).toBe(true);
      expect(plannedPendulums.every((bar) => bar.energySlope === 'flat' && bar.pianoFigureRole === 'bed')).toBe(true);
      expect(keysPlan.pianoMotionStats.upBars).toBe(plannedUps.length);
      expect(keysPlan.pianoMotionStats.upLimit).toBe(Math.floor(keysPlan.pianoMotionStats.motionBars * PIANO_UP_MAX_SHARE));
      expect(plannedUps.length).toBeLessThanOrEqual(keysPlan.pianoMotionStats.upLimit);
      expect(result.reports.some((line) => line.includes('keys piano energy slope'))).toBe(true);
    }
  });

  it('changes figure family at two-bar phrase boundaries in long take-1 choruses and audits harp-owner yields', () => {
    for (const [fixture, templateId] of [
      ['three', 'ensemble.chamber'],
      ['dorian', 'ensemble.sonata'],
      ['three', 'ensemble.cinematic'],
      ['three', 'ensemble.hybridstudio'],
    ] as const) {
      const { project, result } = composeTake(fixture, templateId, 0); // output take 1
      const keysPlan = result.plan.keys;
      const jobsById = new Map(keysPlan.pianoJobs.map((section) => [section.sectionId, section]));
      for (const section of project.sections.filter((candidate) => /chorus|refrain|hook|drop/i.test(candidate.name) && candidate.lengthBars >= 4)) {
        const job = jobsById.get(section.id)!;
        expect(job.job).toBeDefined();
        const phraseFamilies: string[] = [];
        const phraseFigures: string[] = [];
        const phraseCount = Math.ceil(section.lengthBars / PIANO_MOTION_PHRASE_BARS);
        for (let phrase = 0; phrase < phraseCount; phrase++) {
          const firstBar = section.startBar + phrase * PIANO_MOTION_PHRASE_BARS;
          const lastBar = Math.min(section.startBar + section.lengthBars, firstBar + PIANO_MOTION_PHRASE_BARS);
          const phraseBars = keysPlan.bars.filter((bar) => bar.bar >= firstBar && bar.bar < lastBar && bar.pianoFigure);
          const families = [...new Set(phraseBars.map((bar) => bar.pianoFigureFamily!))];
          expect(families.length, `${templateId} ${section.name} phrase ${phrase + 1} uses one planned family`).toBeLessThanOrEqual(1);
          if (families.length) phraseFamilies.push(families[0]);
          const figures = [...new Set(phraseBars.map((bar) => bar.pianoFigure!))];
          if (figures.length) phraseFigures.push(figures[0]);
        }
        expect(phraseFamilies.length, `${templateId} ${section.name}: at least two active phrases`).toBeGreaterThanOrEqual(2);
        expect(phraseFamilies[0], `${templateId} ${section.name}: family changes at phrase level`).not.toBe(phraseFamilies[1]);
        expect(new Set(phraseFigures).size, `${templateId} ${section.name}: at least two actual figures`).toBeGreaterThanOrEqual(2);
        if (templateId === 'ensemble.sonata') {
          expect(phraseFamilies.filter((family) => family === 'alberti').length, 'sonata weights Alberti heavily').toBeGreaterThanOrEqual(1);
        }
      }

      for (const planBar of keysPlan.bars) {
        const section = project.sections.find((candidate) => planBar.bar >= candidate.startBar && planBar.bar < candidate.startBar + candidate.lengthBars);
        if (!section) continue;
        const sectionJob = jobsById.get(section.id)!;
        expect(planBar.arpeggiatorOwner).toBe(sectionJob.arpeggiatorOwner);
        const yielded = planBar.pianoFigureYieldedFrom;
        if (!yielded) continue;
        expect(sectionJob.arpeggiatorOwner, `b${planBar.bar} piano yields the shared figure`).toBe('harp');
        expect(keysPlan.harpModeByType[section.name.toLowerCase()]).toBe('bed');
        expect(['arpUp', 'arpDown', 'arpPendulum', 'cascade']).toContain(yielded);
        expect(['arpUp', 'arpDown', 'arpPendulum', 'cascade']).not.toContain(planBar.pianoFigure);
        const harpPlan = keysPlan.harpFigures.find((entry) => entry.startBar === section.startBar);
        expect(harpPlan, `b${planBar.bar} has a harp bed figure owner`).toBeDefined();
      }
      expect(result.reports.some((line) => line.startsWith(`keys piano yields (take ${result.orchestration.take},`))).toBe(true);
      expect(result.reports.some((line) => line.startsWith(`keys piano map (take ${result.orchestration.take},`))).toBe(true);
    }
  });

  it('yields piano arpeggio/cascade candidates to the harp owner without double-owning a section', () => {
    const { project, result } = composeTake('three', 'ensemble.cinematic', 0); // output take 1
    const keysPlan = result.plan.keys;
    const collisions = keysPlan.bars.filter((bar) => bar.pianoFigureYieldedFrom);
    expect(collisions.length, 'take 1 includes planned harp/piano owner collisions to audit').toBeGreaterThan(0);
    for (const planBar of collisions) {
      const section = project.sections.find((candidate) => planBar.bar >= candidate.startBar && planBar.bar < candidate.startBar + candidate.lengthBars)!;
      expect(planBar.arpeggiatorOwner).toBe('harp');
      expect(keysPlan.arpeggiatorOwnerByType[section.name.toLowerCase()]).toBe('harp');
      expect(keysPlan.harpModeByType[section.name.toLowerCase()]).toBe('bed');
      expect(['arpUp', 'arpDown', 'arpPendulum', 'cascade']).toContain(planBar.pianoFigureYieldedFrom);
      expect(['arpUp', 'arpDown', 'arpPendulum', 'cascade']).not.toContain(planBar.pianoFigure);
      const harpSection = keysPlan.harpFigures.find((entry) => entry.startBar === section.startBar)!;
      const harpFigure = harpSection.figures[Math.floor((planBar.bar - section.startBar) / 2)];
      expect(harpFigure).toBeDefined();
      expect(result.reports.some((line) => line.includes(`b${planBar.bar}:harp-${harpFigure} owns; piano-${planBar.pianoFigureYieldedFrom} suppressed`))).toBe(true);
    }
  });

  it('renders tagged RH figures in register, preserves the held body, keeps cascade rings to chord spans, and uses sparse cell onsets', () => {
    const samples = [
      ['three', 'ensemble.chamber', 0],
      ['dorian', 'ensemble.sonata', 0],
      ['three', 'ensemble.cinematic', 0],
      ['three', 'ensemble.chamber', 3],
      ['three', 'ensemble.vocalbacking', 0],
      ['dorian', 'ensemble.vocalbacking', 2],
    ] as const;
    const expectedRole: Record<string, string> = {
      arpUp: 'lift', arpDown: 'settle', arpPendulum: 'bed', alberti: 'bed', cascade: 'atmosphere',
      wideBroken: 'bed', ostinatoCell: 'bed', highSparkle: 'bed',
    };
    for (const [fixture, templateId, inputTake] of samples) {
      const { project, result } = composeTake(fixture, templateId, inputTake);
      const notes = roleNotes(project, PIANO);
      const anchors = notes.filter((note) => note.roleTag === 'anchor' || note.roleTag === 'power');
      const bt = barTicks(project.timeSignature);
      const eighth = Math.floor(beatTicks(project.timeSignature) / 2);
      const jitterMax = Math.ceil(msToTicks(12, project.tempoMap)) + 2;
      const spans = spansOf(project);
      const cellSectionStarts = new Set<number>();
      let checkedFigureBars = 0;

      for (const planBar of result.plan.keys.bars) {
        if (templateId === 'ensemble.vocalbacking' && planBar.pianoSparkleTop === 96) {
          const section = project.sections.find((candidate) => planBar.bar >= candidate.startBar && planBar.bar < candidate.startBar + candidate.lengthBars)!;
          expect(planBar.norm).toBeGreaterThanOrEqual(0.9);
          expect((planBar.bar - section.startBar) % PIANO_MOTION_PHRASE_BARS).toBe(0);
        }
        if (!planBar.pianoFigure || planBar.pianoRepeatedChord) continue;
        expect(planBar.pianoJob).toBeDefined();
        expect(planBar.pianoFigureRole).toBe(expectedRole[planBar.pianoFigure]);
        const barStart = (planBar.bar - 1) * bt;
        const barEnd = planBar.bar * bt;
        const overlays = notes.filter((note) => note.roleTag === planBar.pianoFigureRole && note.startTick >= barStart && note.startTick < barEnd);
        const anchorInBar = anchors.filter((note) => note.startTick >= barStart && note.startTick < barEnd);
        expect(anchorInBar.length, `${templateId} b${planBar.bar}: held anchor remains under figure`).toBeGreaterThan(0);
        if (planBar.pianoFigure === 'highSparkle' && planBar.norm >= 0.5) {
          expect(overlays).toHaveLength(0);
          continue;
        }
        expect(overlays.length, `${templateId} b${planBar.bar} ${planBar.pianoFigure}: rendered overlay`).toBeGreaterThan(0);
        checkedFigureBars++;

        for (const note of overlays) {
          const bodyUnder = anchors.some((anchor) => (anchor.roleTag === 'power' || anchor.pitch <= (templateId === 'ensemble.vocalbacking' ? 56 : 55))
            && anchor.startTick <= note.startTick + jitterMax
            && anchor.startTick + anchor.durationTicks > note.startTick - jitterMax);
          expect(bodyUnder, `${templateId} b${planBar.bar} ${planBar.pianoFigure}: LH held body sounds under figure note at ${note.startTick}`).toBe(true);
          expect(note.pitch, `${templateId} b${planBar.bar} ${planBar.pianoFigure}: ${JSON.stringify(note)}`).toBeGreaterThanOrEqual(templateId === 'ensemble.vocalbacking' ? 82 : 64);
          if (templateId === 'ensemble.vocalbacking') {
            expect(note.pitch).toBeLessThanOrEqual(planBar.pianoSparkleTop ?? 91);
            if (note.pitch > 91) expect(planBar.pianoSparkleTop).toBe(96);
          } else if ((templateId === 'ensemble.chamber' || templateId === 'ensemble.sonata') && lowStringsSoundInBar(project, planBar.bar)) {
            expect(note.pitch).toBeGreaterThanOrEqual(72);
          }
        }
        if (['arpUp', 'arpDown', 'arpPendulum'].includes(planBar.pianoFigure)) {
          expect(overlays.every((note) => note.durationTicks <= eighth)).toBe(true);
          if (planBar.pianoFigure === 'arpUp') expect(planBar.energySlope).toBe('rising');
          if (planBar.pianoFigure === 'arpDown') expect(planBar.energySlope).toBe('falling');
          if (planBar.pianoFigure === 'arpPendulum') expect(planBar.energySlope).toBe('flat');
          const ordered = [...overlays].sort((a, b) => a.startTick - b.startTick);
          const firstSpan = spanAt(spans, ordered[0].startTick);
          const sameSpan = ordered.filter((note) => spanAt(spans, note.startTick).startTick === firstSpan.startTick);
          if (sameSpan.length >= 2 && planBar.pianoFigure === 'arpUp') expect(sameSpan[0].pitch).toBeLessThanOrEqual(sameSpan[1].pitch);
          if (sameSpan.length >= 2 && planBar.pianoFigure === 'arpDown') expect(sameSpan[0].pitch).toBeGreaterThanOrEqual(sameSpan[1].pitch);
        }
        if (planBar.pianoFigure === 'alberti' || planBar.pianoFigure === 'wideBroken' || planBar.pianoFigure === 'highSparkle') {
          expect(overlays.every((note) => note.durationTicks <= eighth), `${templateId} b${planBar.bar} ${planBar.pianoFigure}: ${overlays.map((note) => `${note.pitch}/${note.durationTicks}`).join(',')}`).toBe(true);
        }
        if (planBar.pianoFigure === 'alberti') {
          const firstFour = [...overlays].sort((a, b) => a.startTick - b.startTick).slice(0, 4).map((note) => note.pitch);
          expect(firstFour).toHaveLength(4);
          expect(firstFour[0]).toBeLessThanOrEqual(firstFour[1]);
          expect(firstFour[1]).toBeGreaterThanOrEqual(firstFour[2]);
          expect(firstFour[2]).toBeGreaterThanOrEqual(firstFour[0]);
          expect(firstFour[3]).toBe(firstFour[1]);
        }
        if (planBar.pianoFigure === 'wideBroken') {
          const slots = overlays.map((note) => Math.round((note.startTick - barStart) / eighth)).sort((a, b) => a - b);
          expect(slots[0]).toBeGreaterThanOrEqual(3);
          expect(slots.every((slot) => [3, 5, 7].includes(slot))).toBe(true);
        }
        if (planBar.pianoFigure === 'highSparkle') {
          expect(overlays).toHaveLength(1);
          expect(overlays[0].pitch).toBeGreaterThanOrEqual(84);
          expect(planBar.norm).toBeLessThan(0.5);
          expect(overlays[0].velocity).toBeLessThan(Math.min(...anchorInBar.map((note) => note.velocity)));
        }
        if (planBar.pianoFigure === 'cascade') {
          for (const note of overlays) {
            const span = spanAt(spans, note.startTick);
            const release = note.startTick + note.durationTicks;
            expect(release).toBeLessThanOrEqual(span.endTick);
            if (span.endTick - release > jitterMax + 2) {
              const resolvedAtNewStrike = notes.some((other) => Math.abs(other.startTick - release) <= jitterMax
                && (other.pitch === note.pitch || other.roleTag === 'punctuation' || other.roleTag === 'arrival'));
              expect(resolvedAtNewStrike, `b${planBar.bar}: early cascade release is only at a conflicting strike`).toBe(true);
            }
          }
        }
        if (planBar.pianoFigure === 'ostinatoCell') {
          const section = project.sections.find((candidate) => planBar.bar >= candidate.startBar && planBar.bar < candidate.startBar + candidate.lengthBars)!;
          cellSectionStarts.add(section.startBar);
          const cell = planBar.pianoCell ?? 'straight';
          const sourceGrid = cellGrid(project.timeSignature, cell, 'eighths');
          const minimumNotes = templateId === 'ensemble.vocalbacking' ? Math.min(3, sourceGrid.slots.length) : 3;
          expect(overlays.length, 'cell figure uses 3-4 notes per bar (or the complete sparse VB cell)').toBeGreaterThanOrEqual(minimumNotes);
          expect(overlays.length, 'cell figure has no more than four notes per bar').toBeLessThanOrEqual(4);
          const slotTicks = bt / (beatOffsets(project.timeSignature).length * sourceGrid.perBeat);
          for (const note of overlays) {
            const slot = Math.round((note.startTick - barStart) / slotTicks);
            expect(sourceGrid.slots).toContain(slot);
          }
          if (templateId === 'ensemble.vocalbacking') expect(planBar.pianoCell).toBe('sparse');
        }
      }
      expect(checkedFigureBars, `${templateId}: audible motion figure bars checked`).toBeGreaterThan(0);
      if (templateId === 'ensemble.vocalbacking') {
        expect(cellSectionStarts.size).toBeLessThanOrEqual(1);
        if (result.orchestration.take === 3) expect(cellSectionStarts.size, 'the selected VB cell section uses one sparse cell').toBe(1);
      }
      assertPianoPolyphony(notes, `${templateId} take ${result.orchestration.take} with motion overlays`);
    }
  });
});

describe('Phase 11.6c: collision-safe arrivals, punctuation and power', () => {
  const samples = [
    ['ensemble.chamber', 0], ['ensemble.sonata', 0], ['ensemble.vocalbacking', 0],
    ['ensemble.cinematic', 0], ['ensemble.hybridstudio', 0],
  ] as const;

  it('keeps every complete piano lane collision-free, sanitizer-identical, voicing-safe and collision-free in MIDI', () => {
    for (const [templateId, take] of samples) {
      const { project, result } = composeTake('three', templateId, take);
      const piano = project.tracks.find((track) => track.role === PIANO)!;
      const label = `${templateId} take ${result.orchestration.take}`;
      expect(samePitchOverlapPairs(piano.notes), `${label}: full piano lane`).toHaveLength(0);
      expect(sanitizeNotes(piano.notes, piano.lowestNote, piano.highestNote, projectEndTick(project)), `${label}: sanitizeNotes is a no-op on the full lane`).toEqual(piano.notes);
      assertPianoPolyphony(piano.notes, label);

      const rhFloor = templateId === 'ensemble.vocalbacking' ? 82 : 64;
      const rh = piano.notes.filter((note) => note.roleTag !== 'power' && note.pitch >= rhFloor);
      for (let i = 0; i < rh.length; i++) for (let j = i + 1; j < rh.length; j++) {
        const a = rh[i], b = rh[j];
        if (a.startTick >= b.startTick + b.durationTicks || b.startTick >= a.startTick + a.durationTicks) continue;
        expect([11, 13], `${label}: simultaneous RH interval ${a.pitch}-${b.pitch}`).not.toContain(Math.abs(a.pitch - b.pitch));
      }
      if (templateId === 'ensemble.chamber' || templateId === 'ensemble.sonata') {
        const plans = new Map(result.plan.keys.bars.map((bar) => [bar.bar, bar]));
        for (const note of piano.notes) {
          const bar = Math.floor(note.startTick / barTicks(project.timeSignature)) + 1;
          if (note.pitch <= 84) continue;
          expect(plans.get(bar)?.pianoRarePeak, `${label} b${bar}: pitch ${note.pitch} is only allowed on a rare peak`).toBe(true);
          expect(note.pitch).toBeLessThanOrEqual(88);
        }
        expect(piano.notes.some((note) => note.pitch === 91), `${label}: no overbright G6`).toBe(false);
      }

      const parsed = parseMidiFile(buildMergedMidi(project, project.tracks));
      const midiPiano = parsed.tracks.find((track) => track.name === piano.name);
      expect(midiPiano, `${label}: exported MIDI piano track`).toBeDefined();
      expect(samePitchOverlapPairs(midiPiano!.notes), `${label}: MIDI piano lane`).toHaveLength(0);
    }
  });

  it('rolls one held arrival per four-bar phrase and marks vocalbacking arrivals high', () => {
    const jitter = Math.ceil(msToTicks(12, FIXTURES.three.tempoMap)) + 2;
    const eighth = Math.floor(beatTicks(FIXTURES.three.timeSignature) / 2);
    for (const [templateId, take] of samples) {
      const { project, result } = composeTake('three', templateId, take);
      const notes = roleNotes(project, PIANO);
      const bt = barTicks(project.timeSignature);
      const arrivals = notes.filter((note) => note.roleTag === 'arrival');
      const planned = result.plan.keys.bars.filter((bar) => bar.pianoArrival);
      expect(planned.length, `${templateId}: planned arrival bars`).toBeGreaterThan(0);
      const phraseKeys = new Set<string>();
      for (const barPlan of planned) {
        const section = project.sections.find((candidate) => barPlan.bar >= candidate.startBar && barPlan.bar < candidate.startBar + candidate.lengthBars)!;
        const phrase = `${section.id}:${Math.floor((barPlan.bar - section.startBar) / PIANO_ARRIVAL_PHRASE_BARS)}`;
        expect(phraseKeys.has(phrase), `${templateId} b${barPlan.bar}: at most one arrival per phrase`).toBe(false);
        phraseKeys.add(phrase);
        if (barPlan.pianoArrival === 'closingChord') expect(barPlan.bar).toBe(projectBars(project));
        else expect((barPlan.bar - section.startBar) % PIANO_ARRIVAL_PHRASE_BARS).toBe(0);

        const start = (barPlan.bar - 1) * bt;
        const group = arrivals.filter((note) => note.startTick >= start && note.startTick < start + bt);
        expect(group.length, `${templateId} b${barPlan.bar}: rolled arrival rendered`).toBeGreaterThanOrEqual(3);
        const onsets = group.map((note) => note.startTick).sort((a, b) => a - b);
        expect(onsets[0]).toBeGreaterThanOrEqual(start);
        expect(onsets[0] - start).toBeLessThanOrEqual(jitter);
        expect(onsets.at(-1)! - onsets[0]).toBeLessThanOrEqual(eighth + jitter);
        expect(group.filter((note) => note.durationTicks > eighth).length, `${templateId} b${barPlan.bar}: rolled chord has held tones`).toBeGreaterThanOrEqual(2);
        if (templateId === 'ensemble.vocalbacking') expect(Math.min(...group.map((note) => note.pitch))).toBeGreaterThanOrEqual(82);
      }
      expect(arrivals.length).toBeGreaterThanOrEqual(planned.length * 3);
    }
  });

  it('places short punctuation at derived cadences/phrase ends and reports total-strike share and harp yields', () => {
    for (const [templateId, take] of samples) {
      const { project, result } = composeTake('three', templateId, take);
      const notes = roleNotes(project, PIANO);
      const bt = barTicks(project.timeSignature);
      const beat = beatTicks(project.timeSignature);
      const sixteenth = Math.floor(beat / 4);
      const jitter = Math.ceil(msToTicks(12, project.tempoMap)) + 2;
      const plans = result.plan.keys.bars.filter((bar) => bar.pianoPunctuation);
      const spans = spansOf(project);
      const tonic = pcOf(project.key);
      const dominant = pcOf(project.key + 7);
      for (const planBar of plans) {
        const section = project.sections.find((candidate) => planBar.bar >= candidate.startBar && planBar.bar < candidate.startBar + candidate.lengthBars)!;
        if (planBar.pianoPunctuation === 'cadence') {
          const start = (planBar.bar - 1) * bt;
          const spanIndex = spans.findIndex((span) => span.startTick >= start && span.startTick < start + bt);
          expect(spanIndex).toBeGreaterThan(0);
          expect(pcOf(spans[spanIndex - 1].parsed.root)).toBe(dominant);
          expect(pcOf(spans[spanIndex].parsed.root)).toBe(tonic);
        }
        if (planBar.pianoPunctuation === 'phraseEnd') {
          const expectedEnd = Math.min(section.startBar + section.lengthBars - 1,
            section.startBar + Math.floor((planBar.bar - section.startBar) / PIANO_ARRIVAL_PHRASE_BARS) * PIANO_ARRIVAL_PHRASE_BARS + PIANO_ARRIVAL_PHRASE_BARS - 1);
          expect(planBar.bar).toBe(expectedEnd);
        }
        if (planBar.pianoPunctuation === 'preChorus') {
          expect(planBar.bar).toBe(section.startBar + section.lengthBars - 1);
          expect(project.sections.find((candidate) => candidate.startBar === section.startBar + section.lengthBars)?.name.toLowerCase()).toMatch(/chorus|refrain|hook|drop/);
        }
        if (planBar.pianoPunctuation === 'pump') {
          expect(['ensemble.cinematic', 'ensemble.hybridstudio']).toContain(templateId);
          expect(section.name.toLowerCase()).toMatch(/chorus|refrain|hook|drop/);
          expect((planBar.bar - section.startBar) % PIANO_ARRIVAL_PHRASE_BARS).toBe(1);
        }
      }
      for (let i = 1; i < plans.length; i++) expect(plans[i].bar - plans[i - 1].bar).not.toBe(1);

      const punctuation = notes.filter((note) => note.roleTag === 'punctuation');
      expect(punctuation.length, `${templateId}: short punctuation notes`).toBeGreaterThan(0);
      const punctuationBars = [...new Set(punctuation.map((note) => Math.floor(note.startTick / bt) + 1))].sort((a, b) => a - b);
      for (let i = 1; i < punctuationBars.length; i++) expect(punctuationBars[i] - punctuationBars[i - 1]).toBeGreaterThan(1);
      for (const note of punctuation) expect(note.durationTicks).toBeLessThanOrEqual(sixteenth + jitter);
      if (templateId === 'ensemble.vocalbacking') {
        expect(punctuation.every((note) => note.pitch >= 82 && note.pitch <= 96)).toBe(true);
        expect(punctuation.every((note) => note.velocity <= 84)).toBe(true);
        for (const bar of punctuationBars) expect(plans.find((entry) => entry.bar === bar)?.pianoPunctuation).toBe('phraseEnd');
      }
      for (const note of punctuation) {
        const bar = Math.floor(note.startTick / bt) + 1;
        const hasHeldBody = notes.some((other) => other.roleTag === 'anchor' && other.pitch <= (templateId === 'ensemble.vocalbacking' ? 56 : 55)
          && other.startTick <= note.startTick && other.startTick + other.durationTicks > note.startTick);
        const strings = project.tracks.filter((track) => track.family === 'Strings');
        const stringRest = strings.every((track) => !track.notes.some((other) => other.startTick < bar * bt && other.startTick + other.durationTicks > (bar - 1) * bt));
        expect(hasHeldBody || stringRest, `${templateId} b${bar}: punctuation rides a held body or string rest`).toBe(true);
      }

      const report = result.reports.find((line) => line.startsWith('keys piano punctuation vs total strikes:'));
      expect(report).toBeDefined();
      const match = report!.match(/\((\d+\.\d+)%\); limit (\d+)%/);
      expect(match).not.toBeNull();
      const limit = templateId === 'ensemble.vocalbacking' ? PIANO_PUNCTUATION_SHARE.vocalbacking : PIANO_PUNCTUATION_SHARE.default;
      expect(Number(match![1])).toBeLessThanOrEqual(limit * 100);
      expect(result.reports.some((line) => line.startsWith('keys piano punctuation harp yields (take ') && line.length > 0)).toBe(true);
    }
  });

  it('uses quarter/eighth power motion within the low floor and limits repeated chords to cinematic/hybrid choruses', () => {
    const beat = beatTicks(FIXTURES.three.timeSignature);
    const jitter = Math.ceil(msToTicks(12, FIXTURES.three.tempoMap)) + 2;
    for (const [templateId, take] of samples) {
      const { project, result } = composeTake('three', templateId, take);
      const notes = roleNotes(project, PIANO);
      const bt = barTicks(project.timeSignature);
      const powerBars = result.plan.keys.bars.filter((bar) => bar.pianoPower);
      const powerNotes = notes.filter((note) => note.roleTag === 'power');
      expect(powerBars.length, `${templateId}: power-job bars`).toBeGreaterThan(0);
      expect(powerNotes.length, `${templateId}: rendered power notes`).toBeGreaterThan(0);
      expect(result.plan.keys.bars.filter((bar) => bar.norm >= 0.9).every((bar) => !bar.pianoPower)).toBe(true);
      expect(powerNotes.every((note) => note.pitch >= 40)).toBe(true);
      if (templateId === 'ensemble.vocalbacking') expect(powerNotes.every((note) => note.pitch <= 56 || note.pitch >= 82)).toBe(true);
      if (!['ensemble.cinematic', 'ensemble.hybridstudio'].includes(templateId)) {
        expect(powerBars.every((bar) => bar.pianoPower === 'quarter')).toBe(true);
      }

      for (const barPlan of powerBars) {
        const start = (barPlan.bar - 1) * bt;
        const barNotes = powerNotes.filter((note) => note.startTick >= start && note.startTick < start + bt);
        expect(barNotes.length, `${templateId} b${barPlan.bar}: power figure sounds`).toBeGreaterThan(0);
        if (barPlan.norm >= 0.72 && ['ensemble.cinematic', 'ensemble.hybridstudio'].includes(templateId)) expect(barPlan.pianoPower).toBe('eighth');
        if (barPlan.norm >= 0.72 && !['ensemble.cinematic', 'ensemble.hybridstudio'].includes(templateId)) {
          expect(new Set(barNotes.map((note) => Math.round((note.startTick - start) / beat))).size).toBeLessThanOrEqual(3);
        }
        const downbeat = barNotes.filter((note) => note.startTick <= start + jitter);
        const template = resolveTemplate({ templateId, overrides: {}, pins: {} })!;
        const forbidsOctaves = template.rules.some((rule) => rule.type === 'octaveDoubling' && rule.params.policy === 'forbidden');
        if (forbidsOctaves) {
          if (downbeat.length > 0) {
            expect(downbeat.some((a) => downbeat.some((b) => {
              const interval = Math.abs(a.pitch - b.pitch);
              return interval > 0 && interval % 12 !== 0;
            })) || downbeat.length === 1,
              `${templateId} b${barPlan.bar}: forbidden-octave power uses non-octave chord tones or a single low tone`).toBe(true);
          }
          for (let i = 0; i < barNotes.length; i++) for (let j = i + 1; j < barNotes.length; j++) {
            const a = barNotes[i], b = barNotes[j];
            if (a.startTick < b.startTick + b.durationTicks && b.startTick < a.startTick + a.durationTicks) {
              expect(Math.abs(a.pitch - b.pitch) % 12, `${templateId} b${barPlan.bar}: power avoids octave doubling`).not.toBe(0);
            }
          }
        } else {
          expect(downbeat.some((a) => downbeat.some((b) => Math.abs(a.pitch - b.pitch) === 12)), `${templateId} b${barPlan.bar}: downbeat LH octave`).toBe(true);
        }
        const lowEvents = barNotes.filter((note) => note.pitch < 55 && !barNotes.some((other) =>
          other.pitch === note.pitch + 12 && Math.abs(other.startTick - note.startTick) <= jitter));
        const lowOnsetBeats = [...new Set(lowEvents.map((note) => Math.round((note.startTick - start) / beat)))].sort((a, b) => a - b);
        for (let i = 1; i < lowOnsetBeats.length; i++) expect(lowOnsetBeats[i] - lowOnsetBeats[i - 1]).toBeGreaterThanOrEqual(1);
      }

      const repeated = result.plan.keys.bars.filter((bar) => bar.pianoRepeatedChord);
      if (['ensemble.cinematic', 'ensemble.hybridstudio'].includes(templateId)) {
        expect(repeated.length).toBeGreaterThan(0);
        for (const section of project.sections.filter((entry) => /chorus|refrain|hook|drop/i.test(entry.name))) {
          const sectionBars = repeated.filter((bar) => bar.bar >= section.startBar && bar.bar < section.startBar + section.lengthBars);
          expect(sectionBars.length).toBeLessThanOrEqual(Math.floor(section.lengthBars * PIANO_REPEATED_CHORD_MAX_SHARE));
          if (sectionBars.length) expect(result.plan.keys.pianoJobs.find((job) => job.sectionId === section.id)?.job).not.toBe('power');
          for (const barPlan of sectionBars) {
            const start = (barPlan.bar - 1) * bt;
            for (let beatIndex = 0; beatIndex < 4; beatIndex++) {
              const onset = start + beatIndex * beat;
              const chord = notes.filter((note) => note.roleTag === 'bed' && note.pitch >= 64
                && note.startTick >= onset - jitter && note.startTick <= onset + jitter);
              expect(chord.length, `${templateId} b${barPlan.bar} beat ${beatIndex + 1}: repeated held RH chord`).toBeGreaterThanOrEqual(3);
              expect(chord.every((note) => note.durationTicks <= beat + jitter)).toBe(true);
            }
          }
        }
      } else expect(repeated).toHaveLength(0);
    }
  });
});

describe('Phase 11.6a: non-piano preservation', () => {
  it('keeps non-piano, non-harp tracks byte-identical; harp structure/CC exact except for vocalbacking velocity-only delta', () => {
    const otherFailures: string[] = [];
    const harpStructureFailures: string[] = [];
    const velocityDiffs: Record<string, number> = {};
    let vocalHarpDeltaSum = 0;
    let vocalHarpDeltaNotes = 0;
    let vocalHarpDeltaMax = 0;
    let checkedAbsorptionWindows = 0;
    let loweredPianoNotes = 0;
    let loweredWindows = 0;
    for (const templateId of TEMPLATES) {
      const short = templateId.replace('ensemble.', '');
      velocityDiffs[short] = 0;
      for (const fixture of ['three', 'dorian'] as const) {
        for (let take = 1; take <= 10; take++) {
          const expected = JSON.parse(readFileSync(new URL(`./golden105/${short}-${fixture}-t${take}.json`, import.meta.url), 'utf8')) as {
            tracks: { id: string; role: string; notes: Note[]; cc?: unknown }[];
          };
          const { project, result } = composeTake(fixture, templateId, take);
          const byId = new Map(expected.tracks.map((t) => [t.id, t]));
          for (const track of project.tracks) {
            if (track.role === PIANO) continue;
            const baseline = byId.get(track.id);
            if (!baseline) continue;
            if (track.role !== HARP) {
              const current = JSON.stringify({ notes: track.notes, cc: track.cc ?? null });
              const before = JSON.stringify({ notes: baseline.notes, cc: baseline.cc ?? null });
              if (current !== before) otherFailures.push(`${short} ${fixture} t${take} ${track.role}`);
              continue;
            }
            const current = [...track.notes].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
            const before = [...baseline.notes].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
            if (current.length !== before.length) {
              harpStructureFailures.push(`${short} ${fixture} t${take}: note count ${before.length} -> ${current.length}`);
              continue;
            }
            for (let i = 0; i < current.length; i++) {
              const { velocity: currentVelocity, ...currentShape } = current[i];
              const { velocity: baselineVelocity, ...baselineShape } = before[i];
              if (JSON.stringify(currentShape) !== JSON.stringify(baselineShape)) {
                harpStructureFailures.push(`${short} ${fixture} t${take} #${i}: pitch/timing/articulation/layer changed`);
              }
              const velocityDelta = Math.abs(currentVelocity - baselineVelocity);
              if (currentVelocity !== baselineVelocity) velocityDiffs[short]++;
              if (short === 'vocalbacking') {
                vocalHarpDeltaSum += velocityDelta;
                vocalHarpDeltaNotes++;
                vocalHarpDeltaMax = Math.max(vocalHarpDeltaMax, velocityDelta);
              }
            }
            if (JSON.stringify(track.cc ?? null) !== JSON.stringify(baseline.cc ?? null)) {
              harpStructureFailures.push(`${short} ${fixture} t${take}: harp CC changed`);
            }
          }
          const absorption = result.reports.find((r) => r.startsWith(`piano absorption (take ${result.orchestration.take}):`));
          const match = absorption?.match(/checked (\d+) windows; lowered (\d+) notes in (\d+) windows/);
          if (match) {
            checkedAbsorptionWindows += Number(match[1]);
            loweredPianoNotes += Number(match[2]);
            loweredWindows += Number(match[3]);
          }
        }
      }
    }
    expect(otherFailures, `non-piano/non-harp golden105 changes:\n  ${otherFailures.slice(0, 20).join('\n  ')}`).toEqual([]);
    expect(harpStructureFailures, `harp golden105 pitch/timing changes:\n  ${harpStructureFailures.slice(0, 20).join('\n  ')}`).toEqual([]);
    for (const template of ['chamber', 'sonata', 'cinematic', 'hybridstudio', 'symphony']) {
      expect(velocityDiffs[template], `${template}: harp velocities changed`).toBe(0);
    }
    expect(velocityDiffs.vocalbacking, 'vocalbacking should retain only the known velocity-only safety-pass delta').toBeGreaterThan(0);
    const vocalHarpMeanDelta = vocalHarpDeltaNotes ? vocalHarpDeltaSum / vocalHarpDeltaNotes : 0;
    expect(vocalHarpMeanDelta, 'vocalbacking harp mean absolute velocity delta').toBeLessThanOrEqual(3);
    expect(vocalHarpDeltaMax, 'vocalbacking harp maximum absolute velocity delta').toBeLessThanOrEqual(10);
    expect(loweredPianoNotes).toBeGreaterThan(0);
    console.log(`PHASE116 harp vs golden105: exact pitch/timing/articulation/layer/CC; vocalbacking velocity deltas ${velocityDiffs.vocalbacking}, mean |dv| ${vocalHarpMeanDelta.toFixed(2)}, max ${vocalHarpDeltaMax}`);
    console.log(`PHASE116 piano absorption: ${checkedAbsorptionWindows} windows checked; ${loweredPianoNotes} notes lowered in ${loweredWindows} windows`);
  }, 1200000);
});

describe('Phase 11.6d-1: chamber and sonata piano answers', () => {
  it('keeps answer lines monophonic, diatonic, in RH rests, phrase-capped and lead-safe', () => {
    for (const templateId of TEMPLATES) {
      const { project, result } = composeTake('three', templateId, 0); // output take 1
      const piano = project.tracks.find((track) => track.role === PIANO)!;
      const answers = piano.notes.filter((note) => note.roleTag === 'answer');
      const answerPlans = result.plan.keys.bars.filter((bar) => bar.pianoAnswer);
      const allowed = templateId === 'ensemble.chamber' || templateId === 'ensemble.sonata';
      expect(answerPlans.length, `${templateId}: allowed templates only`).toBe(allowed ? answerPlans.length : 0);
      expect(result.plan.keys.pianoRoleCounts.answer).toBe(answerPlans.length);
      expect(result.reports.some((line) => line.includes(`answer=${answerPlans.length} planned bars`))).toBe(true);
      expect(result.reports.some((line) => line.startsWith(`keys piano answer role events (take ${result.orchestration.take}):`))).toBe(true);
      expect(answerPlans.length).toBeLessThanOrEqual(Math.floor(result.plan.keys.pianoRoleCounts.anchor * 0.15));
      if (allowed) expect(answerPlans.length, `${templateId}: answer line present in take 1`).toBeGreaterThan(0);

      const lead = project.tracks.find((track) => track.role === 'violins1')?.notes ?? [];
      const scale = new Set(scalePitchClasses(project.key, project.mode));
      const phraseKeys = new Set<string>();
      for (const planBar of answerPlans) {
        const answer = planBar.pianoAnswer!;
        const section = project.sections.find((candidate) => planBar.bar >= candidate.startBar && planBar.bar < candidate.startBar + candidate.lengthBars)!;
        const phraseKey = `${section.id}:${Math.floor((planBar.bar - section.startBar) / PIANO_ARRIVAL_PHRASE_BARS)}`;
        expect(phraseKeys.has(phraseKey), `${templateId} b${planBar.bar}: one answer per phrase`).toBe(false);
        phraseKeys.add(phraseKey);
        expect(planBar.pianoRole).toBe('anchor');
        expect(planBar.moment).toBeUndefined();
        expect(answer.pitches.length).toBeGreaterThanOrEqual(3);
        expect(answer.pitches.length).toBeLessThanOrEqual(5);
        const start = (planBar.bar - 1) * barTicks(project.timeSignature);
        const notes = answers.filter((note) => note.startTick >= start && note.startTick < answer.windowEndTick).sort((a, b) => a.startTick - b.startTick);
        expect(notes).toHaveLength(answer.pitches.length);
        expect(notes.every((note) => scale.has(pcOf(note.pitch)))).toBe(true);
        expect(Math.min(...notes.map((note) => note.pitch))).toBeGreaterThanOrEqual(lowStringsSoundInBar(project, planBar.bar) ? 72 : 64);
        expect(notes.at(-1)!.startTick + notes.at(-1)!.durationTicks).toBe(answer.windowEndTick);
        for (const note of notes) {
          expect(lead.some((lineNote) => note.startTick < lineNote.startTick + lineNote.durationTicks
            && lineNote.startTick < note.startTick + note.durationTicks), `${templateId} b${planBar.bar}: answer never overlaps violins1`).toBe(false);
        }
        for (let i = 0; i < notes.length; i++) for (let j = i + 1; j < notes.length; j++) {
          expect(notes[i].startTick + notes[i].durationTicks).toBeLessThanOrEqual(notes[j].startTick);
        }
        expect(piano.notes.filter((note) => note.roleTag !== 'answer' && note.pitch >= 64
          && note.startTick < answer.windowEndTick && note.startTick + note.durationTicks > start)).toHaveLength(0);
      }
      expect(piano.cc ?? []).toEqual([]);
      expect(validateProject(project).ok).toBe(true);
      expect(samePitchOverlapPairs(piano.notes)).toHaveLength(0);
      expect(sanitizeNotes(piano.notes, piano.lowestNote, piano.highestNote, projectEndTick(project))).toEqual(piano.notes);
      assertPianoPolyphony(piano.notes, `${templateId} take ${result.orchestration.take}`);
      const template = resolveTemplate(project.ensemble)!;
      expect(checkTemplateRules(project, template, result.plan).filter((finding) => finding.severity === 'hard')).toHaveLength(0);
      expect(measureEnergy(project, template).violations.filter((violation) => violation.kind === 'aboveMax')).toHaveLength(0);
    }
  });

  it('uses diatonic chord-tone fragments when violins1 has no lead', () => {
    const project = projectFromFixture(JSON.parse(JSON.stringify(FIXTURES.three)) as Project);
    project.ensemble = { templateId: 'ensemble.chamber', overrides: {}, pins: {} };
    project.orchestration = { take: 0 };
    const leadTrack = project.tracks.find((track) => track.role === 'violins1')!;
    leadTrack.locked = true;
    const result = composeAllTracks(project, { seed: 11 });
    const composed = { ...project, tracks: result.tracks, orchestration: result.orchestration } as Project;
    const piano = composed.tracks.find((track) => track.role === PIANO)!;
    const plans = result.plan.keys.bars.filter((bar) => bar.pianoAnswer);
    expect(plans.length).toBeGreaterThan(0);
    expect(plans.every((bar) => bar.pianoAnswer?.kind === 'chordToneFragment')).toBe(true);
    expect(piano.notes.filter((note) => note.roleTag === 'answer').length).toBe(plans.reduce((n, bar) => n + bar.pianoAnswer!.pitches.length, 0));
  });
});
