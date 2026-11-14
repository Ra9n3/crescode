/** Assertions shared by Vitest and the explicit dependency-free audit. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { composeAllTracks, type ComposeResult } from '../src/orchestrator/compose';
import { isInstrumentTrack, type Project, type ModeName } from '../src/shared/schema';
import { barTicks, projectEndTick } from '../src/shared/schema/meter';
import { resolveTemplate } from '../src/config/ensembles';
import { sectionMap, energyCurve } from '../src/orchestrator/spine';
import { generateChordSuggestions } from '../src/engine/suggestion/engine';
import type { Chord as SuggestedChord } from '../src/engine/suggestion/types';
import type { StringsV1VoiceInput } from '../src/orchestrator/strings/composition';
import { planOrchestration } from '../src/orchestrator/strings/orchestration/plan';
import { realizeOrchestration, occupiedTicks } from '../src/orchestrator/strings/orchestration/realize';
import { independentBassHandOff } from '../src/orchestrator/strings/bridge';
import { pitchAtOctave0 } from '../src/orchestrator/strings/writers/voice';
import { projectForStringCell, isStringTrack, type StringCell } from '../tests/strings-v1-support';

export const cell = (seed = 1, take = 0, template: StringCell['template'] = 'symphony', fixture: StringCell['fixture'] = 'dorian-16bars'): StringCell => ({ seed, take, template, fixture });
export const makeProject = (seed = 1, take = 0, template: StringCell['template'] = 'symphony', fixture: StringCell['fixture'] = 'dorian-16bars') => projectForStringCell(cell(seed, take, template, fixture));
export const run = (p: Project, seed: number) => composeAllTracks(p, { seed, stringsComposition: 'v1' });
export const orchestration = (r: ComposeResult) => r.stringsDiagnostics.v1!.orchestration!;
export function realizationInput(p: Project, r: ComposeResult): StringsV1VoiceInput {
  const template = resolveTemplate(p.ensemble), sections = sectionMap(p);
  return { project: { ...p, orchestration: r.orchestration }, template, sections,
    arc: energyCurve(p, sections, r.orchestration.take, template, true),
    understanding: r.stringsDiagnostics.v1!.understanding, seed: r.stringsDiagnostics.v1!.composition!.identity!.orchestrationSeed,
    identity: r.stringsDiagnostics.v1!.composition!.identity,
    voiceTracks: p.tracks.filter(isStringTrack), orchestrationTracks: r.tracks.filter(isStringTrack),
    reservedTrackIds: [], assignment: [], carrierByBar: [], classicNotesByTrackId: {} };
}
export function assertIsolation(p: Project, r: ComposeResult, seed: number): void {
  const classic = composeAllTracks(p, { seed, stringsComposition: 'classic' });
  assert.deepEqual(r.tracks.filter((t) => !isStringTrack(t)), classic.tracks.filter((t) => !isStringTrack(t)), 'ALL nonstring notes/CC/state');
  for (const family of ['Keys', 'Brass', 'Woodwinds', 'Percussion']) assert.deepEqual(r.tracks.filter((t) => t.family === family), classic.tracks.filter((t) => t.family === family), `${family} integration protection`);
  assert.deepEqual(r.pianoEngineInput, classic.pianoEngineInput, 'Piano consumed input');
  assert.deepEqual(r.pianoScore, classic.pianoScore, 'Piano Composer/Stage2A score');
  assert.deepEqual(r.pianoRealizedScoreEvents, classic.pianoRealizedScoreEvents, 'Piano realization and pedal source');
  assert.deepEqual(r.pianoDiagnostics, classic.pianoDiagnostics, 'Piano diagnostics');
  assert.deepEqual(r.stringsDiagnostics.consumed, classic.stringsDiagnostics.consumed, 'classic information consumed downstream');
  assert.deepEqual(r.plan, classic.plan, 'conductor/moments');
  assert.deepEqual(r.tracks.map((t) => [t.id, t.role, t.name]), classic.tracks.map((t) => [t.id, t.role, t.name]), 'no roster invention');
  assert.equal(new Set(r.tracks.map((t) => t.id)).size, r.tracks.length);
  if (!orchestration(r).accepted) assert.deepEqual(r.tracks, classic.tracks, 'atomic CLASSIC fallback');
}
export function assertRealized(p: Project, r: ComposeResult): void {
  const o = orchestration(r);
  assert(o && o.plan);
  assert.equal(o.exportValidation, 'not-serialized-here');
  assert.equal(r.stringsDiagnostics.v1!.passThrough, !o.accepted);
  if (!o.accepted) return;
  assert.equal(r.stringsDiagnostics.v1!.ensemble, null, 'no misleading sequential success field');
  const frame = { ...r.stringsDiagnostics.v1!.composition!.frame!, harmony: r.stringsDiagnostics.v1!.understanding.harmony };
  for (const cap of o.plan.capabilities) {
    const notes = o.notesByTrackId[cap.trackId];
    assert.deepEqual(r.tracks.find((t) => t.id === cap.trackId)!.notes, notes, 'final production handoff');
    for (const n of notes) {
      assert(Number.isInteger(n.pitch) && n.pitch >= cap.range[0] && n.pitch <= cap.range[1]);
      assert(n.durationTicks > 0 && n.startTick >= 0 && n.startTick + n.durationTicks <= projectEndTick(p));
      assert(cap.triggerable.includes(n.articulation!));
      const c = o.plan.contributions.find((c) => c.role === cap.role && n.startTick >= c.startTick && n.startTick < c.endTick);
      assert(c, 'no unplanned entrance');
      assert(n.startTick + n.durationTicks <= c.endTick, 'no filled planned silence');
      if (['foundation', 'support', 'motion'].includes(c.duty)) {
        const chord = frame.harmony.chords.find((h) => h.fact.startTick <= n.startTick && h.fact.endTick > n.startTick)!;
        assert(chord.fact.pitchClasses.includes(n.pitch % 12), 'support respects actual chord, including chromatic/borrowed');
        assert(n.startTick + n.durationTicks <= chord.fact.endTick);
      }
    }
    const d = o.desks.find((d) => d.role === cap.role)!;
    assert.equal(d.notes, notes.length); assert.equal(d.ticks, occupiedTicks(notes));
    if (d.state === 'intentional-silence') { assert.equal(d.plannedContributions, 0); assert.equal(notes.length, 0); }
    if (d.state === 'substantial') assert(notes.length > 2 && d.occupancy >= 0.1 && d.phraseCoverage === 1);
  }
  for (const c of o.plan.contributions.filter((c) => c.duty === 'foreground')) {
    const review = o.contributions.find((r) => r.contribution === c.index)!;
    assert.notEqual(review.status, 'rejected'); assert(review.realizedCoverage >= 0.55);
    const id = o.plan.capabilities.find((cap) => cap.role === c.role)!.trackId;
    const expected = r.stringsDiagnostics.v1!.composition!.phrases[c.phrase].notes.filter((n) => n.tick >= c.startTick && n.tick + n.duration <= c.endTick);
    const actual = o.gridByTrackId[id].filter((n) => n.startTick >= c.startTick && n.startTick < c.endTick);
    assert.deepEqual(actual.map((n) => [n.startTick, n.pitch]), expected.map((n) => [n.tick, pitchAtOctave0(frame, n) + 12 * review.octave!]), 'exact V2 fragment/inversion/sequence contour retained under whole-gesture octave');
  }
  for (const a of realizationInput(p, r).arc.filter((a) => a.nearSilence)) for (const notes of Object.values(o.notesByTrackId)) assert.equal(occupiedTicks(notes, a.startTick, a.endTick), 0, 'near-silence boundary');
  const bass = independentBassHandOff(r.stringsDiagnostics.v1);
  const cap = o.plan.capabilities.find((c) => c.role === 'basses');
  assert.deepEqual(bass?.notes ?? null, cap ? o.notesByTrackId[cap.trackId] : null, 'independent bass diagnostic handoff');
}
export function assertPlanAndRejection(p: Project, r: ComposeResult): void {
  const input = realizationInput(p, r), source = r.stringsDiagnostics.v1!.composition!;
  const frame = { ...source.frame!, harmony: input.understanding.harmony };
  assert.deepEqual(planOrchestration(input, frame, source.theme!, source.phrases), source.orchestrationPlan, 'plan reproducible before realization');
  const frozen = JSON.stringify(source);
  const extreme = realizeOrchestration(input, { ...source, phrases: source.phrases.map((p) => ({ ...p, notes: p.notes.map((n) => ({ ...n, step: n.step + 100 })) })) });
  assert.equal(extreme.accepted, false); assert.match(extreme.reason, /foreground failed/);
  assert.deepEqual(extreme.notesByTrackId, {}); assert(extreme.desks.some((d) => d.state === 'classic-fallback'));
  const supportRole = source.orchestrationPlan!.contributions.find((c) => c.duty === 'support')!.role;
  assert(!source.orchestrationPlan!.contributions.some((c) => c.duty === 'foreground' && c.role === supportRole));
  const rejected = realizeOrchestration(input, { ...source, orchestrationPlan: { ...source.orchestrationPlan!, capabilities: source.orchestrationPlan!.capabilities.map((c) => c.role === supportRole ? { ...c, range: [90, 89] as const } : c) } });
  assert.equal(rejected.accepted, true, 'other foreground remains valid');
  assert(rejected.desks.some((d) => d.role === supportRole && d.state === 'rejected-silent'));
  assert(rejected.contributions.some((c) => c.status === 'rejected' && c.generatedNotes === 0));
  assert.equal(JSON.stringify(source), frozen, 'source not mutated by realization or rejection');
}
export function generatedHarmony(mode: ModeName): Project {
  const p = makeProject(); p.mode = mode;
  let previous: SuggestedChord | null = null;
  p.chords = Array.from({ length: 16 }, (_, i) => {
    const candidates = generateChordSuggestions({ projectKey: { tonic: p.key, mode, spelling: 'mixed' }, previousChord: previous ? { chord: previous } : null, nextChord: null,
      availableGapLength: 3840, currentGridResolution: 240, preferences: { allowBorrowedChords: false } });
    const chosen = candidates.find((s) => s.chord.rootPc !== previous?.rootPc) ?? candidates[0];
    previous = chosen.chord;
    return { id: `generated-${i}`, symbol: chosen.chord.spelling, startTick: i * 3840, durationTicks: 3840 };
  });
  return p;
}
export function edgeProjects(): { tag: string; p: Project; seed: number }[] {
  const short = makeProject(); short.sections = [{ id: 'short', name: 'Verse', startBar: 1, lengthBars: 2 }]; short.chords = short.chords.filter((c) => c.startTick < 7680);
  const unequal = makeProject(); unequal.sections = [3, 5, 2, 7].map((lengthBars, i, ls) => ({ id: `unequal-${i}`, name: i % 2 ? 'Chorus' : 'Verse', startBar: 1 + ls.slice(0, i).reduce((s, n) => s + n, 0), lengthBars })); unequal.chords = Array.from({ length: 17 }, (_, i) => ({ id: `unequal-c${i}`, symbol: ['Dm', 'G', 'Dm', 'C'][i % 4], startTick: i * 3840, durationTicks: 3840 }));
  const meters = [{ numerator: 3, denominator: 4 }, { numerator: 6, denominator: 8 }, { numerator: 12, denominator: 8 }].map((ts) => {
    const p = makeProject(); const old = barTicks(p.timeSignature); p.timeSignature = ts; const ratio = barTicks(ts) / old;
    p.chords = p.chords.map((c) => ({ ...c, startTick: Math.round(c.startTick * ratio), durationTicks: Math.round(c.durationTicks * ratio) }));
    return { tag: `meter-${ts.numerator}-${ts.denominator}`, p, seed: 1 };
  });
  const staticP = makeProject(); staticP.chords = [{ id: 'pedal', symbol: 'Dm7', startTick: 0, durationTicks: 61440 }];
  const borrowed = makeProject(); borrowed.chords = Array.from({ length: 16 }, (_, i) => ({ id: `borrowed-${i}`, symbol: ['Dm/A', 'Bb/A', 'Eb7', 'A7'][i % 4], startTick: i * 3840, durationTicks: 3840 }));
  const unsupported = makeProject(); unsupported.mode = 'Whole Tone';
  const locked = makeProject(); locked.tracks = locked.tracks.map((t) => t.role === 'violins1' ? { ...t, locked: true, notes: [{ pitch: 67, startTick: 0, durationTicks: 960, velocity: 71 }], cc: [{ cc: 11, points: [{ tick: 0, value: 53 }] }] } : t);
  const noChords = makeProject(); noChords.chords = [];
  const restricted = makeProject(); restricted.tracks = restricted.tracks.map((t) => t.family === 'Strings' ? { ...t, lowestNote: 100, highestNote: 101 } : t);
  const outOfBand = makeProject(); outOfBand.ensemble = { ...outOfBand.ensemble!, pins: { cellosBasses: 'out' } };
  return [{ tag: 'short-2bars', p: short, seed: 1 }, { tag: 'unequal-repeated-17bars', p: unequal, seed: 1 }, ...meters,
    { tag: 'static-pedal', p: staticP, seed: 1 }, { tag: 'borrowed-chromatic', p: borrowed, seed: 1 },
    { tag: 'generated-dorian', p: generatedHarmony('Dorian'), seed: 1 }, { tag: 'generated-aeolian', p: generatedHarmony('Aeolian'), seed: 1 },
    { tag: 'fallback-unsupported-mode', p: unsupported, seed: 1 }, { tag: 'locked-violin1', p: locked, seed: 1 }, { tag: 'fallback-no-chords', p: noChords, seed: 1 }, { tag: 'fallback-restricted-ranges', p: restricted, seed: 1 }, { tag: 'out-of-band-cello', p: outOfBand, seed: 1 }];
}
export function assertHistoricalMaterial(r: ComposeResult, seed: number): void {
  const old = JSON.parse(readFileSync(`evaluation/strings-identity-v2/audition/symphony-dorian-16bars-seed${seed}-take0/evidence.json`, 'utf8'));
  const c = r.stringsDiagnostics.v1!.composition!;
  assert.deepEqual(c.theme, old.theme, 'V2 theme preserved exactly');
  assert.deepEqual(c.phrases, old.phrases, 'V2 phrase journeys preserved exactly');
}
export function assertHistoricalHandoff(p: Project, seed: number): void {
  const previous = composeAllTracks(p, { seed, stringsComposition: 'v1', stringsDevelopment: 'identity-v2' });
  assert.equal(previous.stringsDiagnostics.v1!.orchestration, undefined);
  const legacy = composeAllTracks(p, { seed, stringsComposition: 'v1', stringsDevelopment: 'legacy' });
  assert.equal(legacy.stringsDiagnostics.v1!.composition!.identity, undefined);
  assert.equal(legacy.stringsDiagnostics.v1!.orchestration, undefined);
  assert(legacy.stringsDiagnostics.v1!.doubleBass, 'Stage 6 still executed');
  const actual = previous.tracks.filter(isStringTrack);
  const old = JSON.parse(readFileSync(`evaluation/strings-identity-v2/audition/symphony-dorian-16bars-seed${seed}-take0/evidence.json`, 'utf8'));
  assert.deepEqual(actual, old.tracks, 'explicit prior V2 handoff reconstructs archived notes/CC');
  assert(previous.tracks.every((t) => !isInstrumentTrack(t) || t.notes.every((n) => n.durationTicks > 0)));
}
