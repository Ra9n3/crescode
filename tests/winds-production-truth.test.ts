import { beforeAll, describe, expect, it, vi } from 'vitest';
import { parseMidi } from 'midi-file';
import dorian from '../fixtures/dorian-16bars.json';
import three from '../fixtures/three-chorus-40bars.json';
import { projectFromFixture, type Project } from '../src/shared/schema';
import { composeAllTracks, type ComposeResult } from '../src/orchestrator/compose';
import { WIND_PARTS } from '../src/orchestrator/winds/profile';
import * as identityModule from '../src/orchestrator/winds/identity';
import { createWindIdentity, windStream } from '../src/orchestrator/winds/identity';
import { completeWindsV1, reconcileWindExport, windFingerprint } from '../src/orchestrator/winds/production';
import { buildMergedMidi, buildPerTrackMidi } from '../src/export/midi';
import { EXPORT_PROFILES } from '../src/export/profiles';
import { type FoldStats } from '../src/export/profile';
import { useStore } from '../src/store/store';
import * as productionModule from '../src/orchestrator/winds/production';
import { resolveTemplate } from '../src/config/ensembles';
import { measureEnergy } from '../src/orchestrator/energy';
import { barTicks } from '../src/shared/schema/meter';

const parts = new Set<string>(WIND_PARTS);
const make = (long = false): Project => {
  const p = projectFromFixture(structuredClone(long ? three : dorian) as Partial<Project>);
  p.ensemble = { templateId: 'ensemble.symphony', overrides: {}, pins: {} };
  p.orchestration = { take: 0 }; return p;
};
const windTracks = (r: ComposeResult) => r.tracks.filter((t) => t.family === 'Woodwinds' && parts.has(t.role));
const otherTracks = (r: ComposeResult) => r.tracks.filter((t) => t.family !== 'Woodwinds');
const structure = (r: ComposeResult) => windTracks(r).map((t) => [t.role, t.notes.map((n) => [n.pitch, n.startTick, n.durationTicks])]);
const run = (p: Project, seed = 1) => composeAllTracks(p, { seed, windsComposition: 'v1' });
const stats = (): FoldStats => ({ folded: {}, droppedDoubling: {}, droppedHardRange: {}, winds: [] });
const profile = EXPORT_PROFILES[0].profile;
let seeds: ComposeResult[];
beforeAll(() => { seeds = Array.from({ length: 8 }, (_, i) => run(make(), i + 1)); }, 180000);

describe('Woodwinds V1 production truth', () => {
  it('reaches the final Compose All boundary, with complete identity and exact final external fingerprints', () => {
    const p = make(), before = structuredClone(p), r = seeds[0], d = r.windDiagnostics;
    expect(p).toEqual(before);
    expect(d.route).toBe('v1-final'); expect(d.identity!.userSeed).toBe(1); expect(d.identity!.producedTake).toBe(1);
    expect(d.context!.finalNonWindFingerprint).toBe(windFingerprint(otherTracks(r).filter((t) => !['Structure', 'Audio'].includes(t.family))));
    for (const f of d.context!.finalTrackFingerprints) expect(f.fingerprint).toBe(windFingerprint(r.tracks.find((t) => t.id === f.id)));
    expect(d.context!.reservations.leads).toEqual(r.plan.winds.leads);
    expect(d.context!.reservations.momentsFingerprint).toBe(windFingerprint(r.plan.moments));
    expect(Object.isFrozen(d.context)).toBe(true);
    expect(Object.keys(r)).not.toContain('windDiagnostics');
  });

  it('the store Compose All route runs exactly one final handoff, persists notes/take together, and undoes both', () => {
    const state = useStore.getState(), p = make();
    const spy = vi.spyOn(productionModule, 'completeWindsV1');
    try {
      useStore.setState({ project: p, past: [], future: [], composeOptions: { seed: 1, density: 1, humanize: false, windsComposition: 'v1' } });
      expect(useStore.getState().composeAll()).not.toBeNull();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(useStore.getState().project.tracks).toEqual(seeds[0].tracks);
      expect(useStore.getState().project.orchestration).toEqual(seeds[0].orchestration);
      useStore.getState().undo(); expect(useStore.getState().project).toEqual(p);
      useStore.getState().redo(); expect(useStore.getState().project.tracks).toEqual(seeds[0].tracks);
    } finally { spy.mockRestore(); useStore.setState(state, true); }
  });

  it('ordinary flute AND oboe doubles are written, not merely drawn; source onsets are final material', () => {
    const seen = new Set<string>();
    for (const r of seeds) for (const j of r.windDiagnostics.jobs.filter((j) => j.kind === 'leadDouble' && j.retainedAssociations > 0)) {
      const candidates = r.windDiagnostics.events.filter((e) => e.job === j.id && e.stage === 'generated' && e.reason === 'writer candidate');
      if (!candidates.length) continue; // brass cut-over alone is NOT evidence of ordinary doubling
      seen.add(j.part);
      const t = r.tracks.find((t) => t.role === j.part)!;
      const id = r.windDiagnostics.context!.carriers[j.bar - 1], source = r.tracks.find((t) => t.id === id)!;
      const bt = barTicks(make().timeSignature);
      const emitted = t.notes.filter((n) => n.startTick >= (j.bar - 1) * bt && n.startTick < j.bar * bt);
      expect(emitted.length).toBeGreaterThan(0);
      for (const e of candidates) {
        expect(source.notes.some((s) => s.startTick <= e.note!.startTick && s.startTick + s.durationTicks > e.note!.startTick), JSON.stringify({ job: j, candidate: e.note, source: source.notes })).toBe(true);
      }
    }
    expect([...seen].sort()).toEqual(['flutes', 'oboes']);
  });

  it('ordinary clarinet counter contributions reach actual final notes', () => {
    const runs = Array.from({ length: 4 }, (_, take) => { const p = make(true); p.ensemble!.templateId = 'ensemble.hybridstudio'; p.orchestration = { take }; return run(p, 1); });
    const hits = runs.flatMap((r) => r.windDiagnostics.jobs.filter((j) => j.part === 'clarinets' && j.kind === 'counter' && j.retainedAssociations > 0).map((j) => ({ r, j })));
    expect(hits.length).toBeGreaterThan(0);
    let actualSourceMatches = 0;
    for (const { r, j } of hits) {
      const notes = r.tracks.find((t) => t.role === 'clarinets')!.notes;
      const source = r.tracks.find((t) => t.id === r.windDiagnostics.context!.counterSource?.trackId)!;
      expect(source).toBeDefined();
      for (const e of r.windDiagnostics.events.filter((e) => e.job === j.id && e.stage === 'retained')) {
        expect(notes.some((n) => n.pitch === e.note!.pitch && n.startTick === e.note!.startTick)).toBe(true);
        if (source.notes.some((n) => n.pitch % 12 === e.note!.pitch % 12 && n.startTick <= e.note!.startTick && n.startTick + n.durationTicks > e.note!.startTick)) actualSourceMatches++;
      }
    }
    expect(actualSourceMatches).toBeGreaterThan(0); // a colour substitution alone cannot pass
  }, 60000);

  it('reproduces pitch/onset/duration/rhythm and full wind output with the same complete identity', () => {
    const again = run(make());
    expect(structure(again)).toEqual(structure(seeds[0])); expect(windTracks(again)).toEqual(windTracks(seeds[0]));
    expect(again.windDiagnostics).toEqual(seeds[0].windDiagnostics);
  });

  it('user seeds change actual structure, independently of velocity and CC', () => {
    expect(new Set(seeds.map((r) => JSON.stringify(structure(r)))).size).toBeGreaterThan(1);
    expect(new Set(seeds.map((r) => JSON.stringify(r.windDiagnostics.plan!.leadDoubleByType))).size).toBeGreaterThan(1);
  });

  it('produced takes change actual structure independently of displayed seed', () => {
    const p = make(); p.orchestration = { take: 1 }; const r = run(p, 1);
    expect(r.windDiagnostics.identity!.userSeed).toBe(1); expect(r.windDiagnostics.identity!.producedTake).toBe(2);
    expect(structure(r)).not.toEqual(structure(seeds[0])); expect(structure(run(p, 1))).toEqual(structure(r));
  });

  it('keyed substreams isolate instruments, categories and additional decisions', () => {
    const id = createWindIdentity(make(), 4, 1);
    const reference = windStream(id, 'phrase-design', 'clarinets:lead:4');
    const expected = Array.from({ length: 12 }, reference);
    const unrelated = windStream(id, 'instrument-variation', 'flutes:flutter');
    for (let i = 0; i < 100; i++) unrelated();
    expect(Array.from({ length: 12 }, windStream(id, 'phrase-design', 'clarinets:lead:4'))).toEqual(expected);
    expect(Array.from({ length: 12 }, windStream(id, 'expression', 'clarinets'))).not.toEqual(expected);
  });

  it('production instrument-expression consumption cannot advance another instrument stream', () => {
    const original = identityModule.windStream;
    let calls = 0;
    const spy = vi.spyOn(identityModule, 'windStream').mockImplementation((identity, category, key) => {
      const rng = original(identity, category, key);
      if (category === 'expression' && key === 'flutes') { calls++; for (let i = 0; i < 57; i++) rng(); }
      return rng;
    });
    try {
      const r = run(make());
      expect(calls).toBeGreaterThan(0);
      expect(windTracks(r).filter((t) => t.role !== 'flutes')).toEqual(windTracks(seeds[0]).filter((t) => t.role !== 'flutes'));
      expect(otherTracks(r)).toEqual(otherTracks(seeds[0]));
      expect(structure(r)).toEqual(structure(seeds[0]));
    } finally { spy.mockRestore(); }
  });

  it('preserves the complete non-wind output and reservations without replanning any family', () => {
    const classic = composeAllTracks(make(), { seed: 1 });
    expect(otherTracks(seeds[0])).toEqual(otherTracks(classic)); expect(seeds[0].plan).toEqual(classic.plan);
    expect(seeds[0].pianoScore).toEqual(classic.pianoScore); expect(seeds[0].pianoDiagnostics).toEqual(classic.pianoDiagnostics);
    expect(seeds[0].stringsDiagnostics).toEqual(classic.stringsDiagnostics);
    expect(composeAllTracks(make(), { seed: 1, windsComposition: 'classic' }).tracks).toEqual(classic.tracks);
  });

  it.each(['v1', 'classic'] as const)('protects accepted Strings %s, including final Piano and all CC', (stringsComposition) => {
    const p = make(); const before = structuredClone(p);
    const baseline = composeAllTracks(p, { seed: 3, stringsComposition, pianoComposition: 'classic' });
    const r = composeAllTracks(p, { seed: 3, stringsComposition, pianoComposition: 'classic', windsComposition: 'v1' });
    expect(otherTracks(r)).toEqual(otherTracks(baseline)); expect(r.stringsDiagnostics).toEqual(baseline.stringsDiagnostics);
    for (const f of r.windDiagnostics.context!.finalTrackFingerprints) expect(f.fingerprint).toBe(windFingerprint(r.tracks.find((t) => t.id === f.id)));
    expect(p).toEqual(before);
  }, 60000);

  it.each(['symphony', 'cinematic', 'hybridstudio'])('%s: final V1 tracks remain bounded/monophonic and do not violate the energy ceiling', (template) => {
    const p = make(); p.ensemble!.templateId = `ensemble.${template}`;
    const r = composeAllTracks(p, { seed: 3, stringsComposition: 'v1', windsComposition: 'v1' });
    for (const t of windTracks(r)) {
      let end = -1;
      for (const n of t.notes) {
        expect(n.pitch).toBeGreaterThanOrEqual(t.lowestNote); expect(n.pitch).toBeLessThanOrEqual(t.highestNote);
        expect(n.durationTicks).toBeGreaterThan(0); expect(n.startTick).toBeGreaterThanOrEqual(end);
        expect(n.startTick + n.durationTicks).toBeLessThanOrEqual(61440);
        end = n.startTick + n.durationTicks;
      }
    }
    const templateData = resolveTemplate(p.ensemble)!;
    expect(measureEnergy({ ...p, tracks: r.tracks }, templateData).max).toBeLessThanOrEqual(templateData.budget.energyClamp[1] + 1e-9);
  }, 60000);

  it('fails safely rather than labeling missing context final', () => {
    expect(() => completeWindsV1({ project: make(), ensemble: make().ensemble!, template: {} } as never, [], 1)).toThrow(/requires prepared/);
  });

  it('keeps owned empty parts empty and clears old notes/CC; distinguishes no jobs from no generated notes', () => {
    const p = make(); p.chords = [];
    for (const t of p.tracks.filter((t) => parts.has(t.role))) { t.notes = [{ pitch: 70, startTick: 0, durationTicks: 960, velocity: 80 }]; t.cc = [{ cc: 1, points: [{ tick: 0, value: 127 }] }]; }
    const r = run(p);
    expect(windTracks(r).every((t) => !t.notes.length && t.cc === undefined)).toBe(true);
    expect(r.windDiagnostics.parts.every((p) => p.state === 'planned-no-notes' || p.state === 'intentional-silence')).toBe(true);
    expect(r.windDiagnostics.parts.some((p) => p.state === 'planned-no-notes')).toBe(true);
  });

  it('a one-bar opening can be intentionally silent, without fallback or stale CC', () => {
    const p = make(); p.sections = [{ id: 'one', name: 'Verse', startBar: 1, lengthBars: 1 }];
    p.chords = [{ ...p.chords[0], startTick: 0, durationTicks: barTicks(p.timeSignature) }];
    const r = composeAllTracks(p, { seed: 1, windsComposition: 'v1', moments: false });
    expect(windTracks(r).every((t) => t.notes.length === 0 && t.cc === undefined)).toBe(true);
    expect(r.windDiagnostics.parts.every((p) => p.state === 'intentional-silence')).toBe(true);
    expect(r.windDiagnostics.jobs).toEqual([]);
  });

  it('sparse and rejected contributions retain truthful quantitative states, not automatic musical success', () => {
    const r = seeds[0];
    const sparse = r.windDiagnostics.parts.filter((p) => p.state === 'retained-sparse');
    // A short source makes sparse retained contributions without padding them.
    const p = make(); p.sections = [{ id: 'short', name: 'Verse', startBar: 1, lengthBars: 4 }];
    p.chords = p.chords.slice(0, 4);
    const short = run(p); sparse.push(...short.windDiagnostics.parts.filter((p) => p.state === 'retained-sparse'));
    expect(sparse.length).toBeGreaterThan(0);
    for (const part of sparse) expect(part.retainedNotes < 4 || part.soundingTicks < 1920).toBe(true);
    const rejected = seeds.flatMap((r) => r.windDiagnostics.events.filter((e) => e.stage === 'rejected'));
    expect(rejected.length).toBeGreaterThan(0); expect(rejected.every((e) => e.reason.length > 8)).toBe(true);
    // Stage 2 allocates ordinary dialogue around brass instead of losing it.
    // The existing long fixture still exercises real source-double loss at
    // the reserved bridge boundary; preserve the lifecycle assertion there.
    const lost = [...seeds, run(make(true))].flatMap((r) => r.windDiagnostics.jobs.filter((j) => j.state === 'generated-not-retained'));
    expect(lost.length).toBeGreaterThan(0); expect(lost.every((j) => j.generated > 0 && j.retainedAssociations === 0)).toBe(true);
  });

  it('reports the explicit no-template legacy route without claiming final-context ownership', () => {
    const p = make(); p.ensemble = { templateId: null, overrides: {}, pins: {} };
    const r = run(p); expect(r.tracks).toEqual(composeAllTracks(p, { seed: 1 }).tracks);
    expect(r.windDiagnostics.route).toBe('legacy-no-template'); expect(r.windDiagnostics.context).toBeNull();
    expect(r.windDiagnostics.parts.some((p) => p.state === 'legacy-fallback')).toBe(true);
  });

  it('honors locks, pins and non-owned tracks', () => {
    const p = make(); const flute = p.tracks.find((t) => t.role === 'flutes')!;
    flute.locked = true; flute.notes = [{ pitch: 72, startTick: 0, durationTicks: 960, velocity: 50 }];
    flute.cc = [{ cc: 11, points: [{ tick: 0, value: 44 }] }]; p.ensemble!.pins.clarinets = 'out';
    const duplicate = { ...structuredClone(p.tracks.find((t) => t.role === 'oboes')!), id: 'second-oboe' };
    p.tracks.push(duplicate);
    const r = run(p), baseline = composeAllTracks(p, { seed: 1 });
    expect(r.tracks.find((t) => t.id === duplicate.id)).toEqual(baseline.tracks.find((t) => t.id === duplicate.id));
    expect(r.windDiagnostics.ownership.preservedTrackIds).toContain(duplicate.id);
    expect(r.tracks.find((t) => t.id === flute.id)).toEqual(flute);
    expect(r.tracks.find((t) => t.role === 'clarinets')).toEqual(baseline.tracks.find((t) => t.role === 'clarinets'));
    expect(r.windDiagnostics.parts.find((p) => p.part === 'flutes')!.state).toBe('ineligible');
    expect(r.windDiagnostics.parts.find((p) => p.part === 'clarinets')!.state).toBe('ineligible');
  });

  it('reconciles every planned job with writer traces and final retained track fingerprints', () => {
    for (const r of seeds) {
      for (const j of r.windDiagnostics.jobs) {
        const es = r.windDiagnostics.events.filter((e) => e.job === j.id);
        expect(j.generated).toBe(es.filter((e) => e.stage === 'generated').length);
        expect(j.retainedAssociations).toBe(es.filter((e) => e.stage === 'retained').length);
        if (j.state === 'retained') expect(j.retainedAssociations).toBeGreaterThan(0);
      }
      for (const p of r.windDiagnostics.parts.filter((p) => p.eligibility === 'eligible')) {
        const t = r.tracks.find((t) => t.id === p.trackId)!;
        expect(p.retainedFingerprint).toBe(windFingerprint(t.notes)); expect(p.retainedNotes).toBe(t.notes.length);
      }
      expect(r.windDiagnostics.export).toMatch(/^not-observed/);
    }
  });

  it('observes actual merged and per-track MIDI, excluding keyswitches; observer never changes bytes', () => {
    const r = seeds[0], p = { ...make(), tracks: r.tracks, orchestration: r.orchestration };
    for (const prof of [null, profile]) {
      const st = stats(), bytes = buildMergedMidi(p, r.tracks, prof, st);
      expect(bytes).toEqual(buildMergedMidi(p, r.tracks, prof));
      const parsed = parseMidi(bytes);
      for (const row of st.winds!) {
        const t = r.tracks.find((t) => t.id === row.trackId)!;
        expect(row.retainedFingerprint).toBe(windFingerprint(t.notes));
        const part = prof?.parts.find((pp) => pp.source.role === t.role);
        const out = parsed.tracks.find((tr) => tr.some((e) => e.type === 'trackName' && e.text === (part?.patch ?? t.name)))!;
        const onsets = out.filter((e) => e.type === 'noteOn' && e.velocity > 0);
        expect(onsets.length).toBe(row.serializedSoundingNotes + row.serializedKeyswitches);
        expect(row.serializedSoundingNotes).toBe(t.notes.length);
        if (prof && t.notes.some((n) => n.articulation === 'legato')) expect(row.articulationFallbacks.legato).toBeGreaterThan(0);
      }
      const joined = reconcileWindExport(r.windDiagnostics, st.winds!);
      expect(joined.every((j) => j.state === 'observed')).toBe(true);
      for (const j of joined.flatMap((j) => j.jobs)) for (const scope of j.scopes) expect(['exported', 'not-retained']).toContain(scope.state);
      expect(reconcileWindExport(r.windDiagnostics, st.winds!.map((w) => ({ ...w, retainedFingerprint: 'stale' }))).every((j) => j.state === 'stale-export-evidence')).toBe(true);
      const ps = stats(), files = buildPerTrackMidi(p, r.tracks, prof, ps);
      expect(files).toEqual(buildPerTrackMidi(p, r.tracks, prof));
      expect(ps.winds!.map((w) => w.serializedSoundingNotes)).toEqual(st.winds!.map((w) => w.serializedSoundingNotes));
    }
  });

  it('reports folding, dropped notes, articulation fallback and omitted chunks from actual exports', () => {
    const p = make(), flute = p.tracks.find((t) => t.role === 'flutes')!;
    flute.notes = [{ pitch: 50, startTick: 960, durationTicks: 960, velocity: 70, articulation: 'tremolo' }];
    const st = stats(); buildMergedMidi(p, [flute], profile, st);
    expect(st.winds![0]).toMatchObject({ folded: 1, serializedSoundingNotes: 1, articulationFallbacks: { tremolo: 1 } });
    flute.highestNote = 50; const drop = stats(); const bytes = buildMergedMidi(p, [flute], profile, drop);
    expect(drop.winds![0]).toMatchObject({ dropped: 1, serializedSoundingNotes: 0, state: 'omitted-or-lost' });
    expect(parseMidi(bytes).tracks.length).toBe(1);
    flute.highestNote = 96; const fileOnly = structuredClone(profile); fileOnly.parts.find((p) => p.source.role === 'flutes')!.fileScope = 'fileOnly';
    const omit = stats(); buildMergedMidi(p, [flute], fileOnly, omit);
    expect(omit.winds![0]).toMatchObject({ omittedChunks: 1, serializedSoundingNotes: 0, state: 'omitted-or-lost' });
    const own = stats(); expect(buildPerTrackMidi(p, [flute], fileOnly, own).length).toBe(1);
    expect(own.winds![0].serializedSoundingNotes).toBe(1);
    const ksOnly = stats(); flute.notes = [{ pitch: 72, startTick: 61440, durationTicks: 960, velocity: 70 }];
    const ksBytes = buildMergedMidi(p, [flute], profile, ksOnly);
    expect(ksOnly.winds![0]).toMatchObject({ state: 'keyswitch-only', serializedSoundingNotes: 0 });
    expect(ksOnly.winds![0].serializedKeyswitches).toBeGreaterThan(0);
    expect(parseMidi(ksBytes).tracks.flat().filter((e) => e.type === 'noteOn' && e.velocity > 0).length).toBe(ksOnly.winds![0].serializedKeyswitches);
    const unmapped = structuredClone(profile); unmapped.parts = unmapped.parts.filter((p) => p.source.role !== 'flutes'); unmapped.unmapped = ['flutes'];
    const lost = stats(); buildMergedMidi(p, [flute], unmapped, lost); expect(lost.winds![0].reason).toMatch(/unmapped/);
  });
});
