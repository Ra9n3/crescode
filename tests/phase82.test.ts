import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { projectFromFixture, validateProject, type Project } from '../src/shared/schema';
import { buildMergedMidi, buildPerTrackMidi, exportableTracks, parseMidiFile } from '../src/export/midi';
import { EXPORT_PROFILES } from '../src/export/profiles';
import { chunksForTrack, keyNameToMidi, parseExportProfile, validateExportProfile, type FoldStats, type ProfilePart } from '../src/export/profile';
import { BASSES_RANGE, BASSES_TRACK_ID, CELLO_LINE_FLOOR, splitCelloLine } from '../src/orchestrator/basses';
import { humanizeStrings } from '../src/orchestrator/expression/humanize';
import { CB_FOLLOW_MAX_MS } from '../src/orchestrator/expression/timing';
import { msToTicks, ticksToMs } from '../src/orchestrator/spine';
import { resolveTemplate } from '../src/config/ensembles';
import { measureEnergy } from '../src/orchestrator/energy';
import { sectionMap } from '../src/orchestrator/spine';
import { useStore } from '../src/store/store';

/**
 * Phase 8.2 — the separate Double Basses desk + the fold-instead-of-drop
 * red zone. The spec's test list:
 *   1. a fold lands in the playable range, and the project is unchanged;
 *   2. a note whose fold would exceed the hard range is dropped;
 *   3. a fold never creates a forbidden doubling;
 *   4. the cello track has no note below 36 in new composes;
 *   5. basses notes are in range, and the doubling gating is unchanged;
 *   6. bass notes follow the cello partner's timing;
 *   7. an old combined project loads and exports as before;
 *   8. the split Compose All is one undo step;
 *   9. the bass profile keys and zone validate; keys outside the zone are
 *      rejected;
 *  10. the no-profile export of an old project is byte-identical to 8.1.
 * Design pins: the split engages only where the octaveDoubling policy is
 * 'allowed' (the cello's octave-up answer is itself an octave doubling);
 * the template roster is NOT grown (that would change every governor cap —
 * the chamber byte-identity pin forbids it), so the energy measure counts
 * the desk under the cellosBasses role.
 */
const PROFILE = EXPORT_PROFILES[0].profile;
const CONV = 'C3=60';
const partOf = (id: string): ProfilePart => PROFILE.parts.find((p) => p.id === id)!;
const SPLIT_TEMPLATES = ['ensemble.symphony', 'ensemble.cinematic', 'ensemble.hybridstudio'];

const composeTake = (doc: unknown, templateId: string, take: number, moments = true) => {
  const p: Project = projectFromFixture(JSON.parse(JSON.stringify(doc)));
  p.ensemble = { templateId, overrides: {}, pins: {} };
  p.orchestration = { take };
  const result = composeAllTracks(p, { seed: 11, moments });
  return { project: { ...p, tracks: result.tracks, orchestration: result.orchestration } as Project, result };
};

/** A minimal legacy-shaped project: the dorian fixture with sub-floor cello
 *  notes injected (the composes never write them again — that is the point). */
const legacyCelloProject = (templateId: string): Project => {
  const p: Project = projectFromFixture(JSON.parse(JSON.stringify(dorian)));
  p.ensemble = { templateId, overrides: {}, pins: {} };
  const cb = p.tracks.find((t) => t.role === 'cellosBasses')!;
  cb.notes = [
    { pitch: 33, startTick: 1920, durationTicks: 960, velocity: 80, articulation: 'legato' },
    { pitch: 31, startTick: 3840, durationTicks: 960, velocity: 80, articulation: 'legato' },
    { pitch: 45, startTick: 5760, durationTicks: 960, velocity: 80, articulation: 'legato' },
  ];
  return p;
};

const emptyStats = (): FoldStats => ({ folded: {}, droppedHardRange: {}, droppedDoubling: {} });

/* ---------------- 1+2. the fold ---------------- */
describe('the red-zone fold (export only)', () => {
  it('1. a fold lands in the playable range and the project is unchanged', () => {
    const p = legacyCelloProject('ensemble.chamber');
    const before = JSON.stringify(p);
    const cb = p.tracks.find((t) => t.role === 'cellosBasses')!;
    const stats = emptyStats();
    const chunks = chunksForTrack(p, cb, PROFILE, stats);
    const cello = partOf('cello');
    const chunk = chunks.find((c) => c.channel === cello.channel)!;
    expect(chunk).toBeDefined();
    // 33 → 45, 31 → 43: one octave up into the playable range; 45 stays
    expect(stats.folded.cello).toBe(2);
    expect(chunk.notes.some((n) => n.pitch === 45 && n.startTick === 1920)).toBe(true);
    expect(chunk.notes.some((n) => n.pitch === 43 && n.startTick === 3840)).toBe(true);
    expect(chunk.notes.some((n) => n.pitch === 45 && n.startTick === 5760)).toBe(true);
    expect(chunk.notes.every((n) => n.pitch < cello.lowestPlayable || n.velocity === PROFILE.keyswitchVelocity || n.pitch >= cello.playableLow!)).toBe(true);
    expect(JSON.stringify(p)).toBe(before); // the project never moved
    expect(validateProject(JSON.parse(JSON.stringify(p))).ok).toBe(true);
  });

  it('2. a note whose fold would exceed the hard range (the source track highestNote) is dropped', () => {
    const p = legacyCelloProject('ensemble.chamber');
    const cb = p.tracks.find((t) => t.role === 'cellosBasses')!;
    cb.highestNote = 44; // 31 folds to 43 ≤ 44 — kept; make one note overshoot
    cb.notes = [{ pitch: 32, startTick: 1920, durationTicks: 960, velocity: 80, articulation: 'legato' }]; // 32 → 44 ≤ 44: kept
    const stats = emptyStats();
    const chunks = chunksForTrack(p, cb, PROFILE, stats);
    expect(stats.folded.cello).toBe(1);
    expect(chunks.find((c) => c.channel === partOf('cello').channel)!.notes.some((n) => n.pitch === 44)).toBe(true);
    // now a note whose fold overshoots: 33 → 45 > 44
    cb.notes = [{ pitch: 33, startTick: 1920, durationTicks: 960, velocity: 80, articulation: 'legato' }];
    const stats2 = emptyStats();
    const chunks2 = chunksForTrack(p, cb, PROFILE, stats2);
    expect(stats2.droppedHardRange.cello).toBe(1);
    expect(stats2.folded.cello).toBeUndefined();
    expect(chunks2).toEqual([]); // everything dropped: no part file at all
    // the no-profile export still carries the note as written
    const parsed = parseMidiFile(buildMergedMidi(p, exportableTracks(p, 'all')));
    expect(parsed.tracks.some((t) => t.notes.some((n) => n.pitch === 33))).toBe(true);
  });

  it('3. a fold never creates a forbidden doubling (octaveDoubling policy forbidden)', () => {
    const p = legacyCelloProject('ensemble.sonata'); // sonata: policy forbidden
    const viola = p.tracks.find((t) => t.role === 'violas')!;
    viola.notes = [{ pitch: 57, startTick: 1920, durationTicks: 960, velocity: 80, articulation: 'legato' }]; // A3: the fold 33→45 would octave-double it
    const stats = emptyStats();
    const chunks = chunksForTrack(p, p.tracks.find((t) => t.role === 'cellosBasses')!, PROFILE, stats);
    expect(stats.droppedDoubling.cello).toBe(1);
    const chunk = chunks.find((c) => c.channel === partOf('cello').channel)!;
    expect(chunk.notes.some((n) => n.pitch === 45 && n.startTick === 1920)).toBe(false);
    // the untouched notes still fold (no conflict at their moments)
    expect(stats.folded.cello).toBe(1); // 31 → 43 (no viola note there)
    // under an 'allowed' policy the same fold exports
    const allowed = legacyCelloProject('ensemble.cinematic'); // policy allowed
    const viola2 = allowed.tracks.find((t) => t.role === 'violas')!;
    viola2.notes = [{ pitch: 57, startTick: 1920, durationTicks: 960, velocity: 80, articulation: 'legato' }];
    const stats2 = emptyStats();
    chunksForTrack(allowed, allowed.tracks.find((t) => t.role === 'cellosBasses')!, PROFILE, stats2);
    expect(stats2.droppedDoubling.cello).toBeUndefined();
    expect(stats2.folded.cello).toBe(2);
  });
});

/* ---------------- 4+5. the composed desks ---------------- */
describe('the composed cello and basses desks', () => {
  const survey: { templateId: string; fixture: string; take: number; project: Project }[] = [];
  for (const templateId of SPLIT_TEMPLATES) {
    for (const [fixTag, doc] of [['dorian', dorian], ['three', threeChorus]] as const) {
      for (let take = 1; take <= 3; take++) {
        const { project } = composeTake(doc, templateId, take);
        survey.push({ templateId, fixture: fixTag, take, project });
      }
    }
  }

  it('4. the cello track has no note below 36 in new composes; the basses desk exists and is in range', () => {
    for (const { templateId, fixture, take, project } of survey) {
      const cb = project.tracks.find((t) => t.role === 'cellosBasses')!;
      const bs = project.tracks.find((t) => t.role === 'basses')!;
      expect(bs, `${templateId} ${fixture} t${take} basses desk exists`).toBeDefined();
      const cbMin = Math.min(...cb.notes.map((n) => n.pitch));
      expect(cbMin, `${templateId} ${fixture} t${take} cello floor`).toBeGreaterThanOrEqual(CELLO_LINE_FLOOR);
      for (const n of bs.notes) {
        expect(n.pitch, `${templateId} ${fixture} t${take} basses range`).toBeGreaterThanOrEqual(BASSES_RANGE[0]);
        expect(n.pitch, `${templateId} ${fixture} t${take} basses range`).toBeLessThanOrEqual(BASSES_RANGE[1]);
      }
      expect(bs.notes.length, `${templateId} ${fixture} t${take} the desk sounds`).toBeGreaterThan(0);
      expect(bs.id).toBe(BASSES_TRACK_ID);
      // the basses sits right after the cellos in score order
      const roles = project.tracks.map((t) => t.role);
      expect(roles.indexOf('basses')).toBe(roles.indexOf('cellosBasses') + 1);
      expect(validateProject(JSON.parse(JSON.stringify(project))).ok).toBe(true);
    }
  });

  it('5. the doubling gating is unchanged: the leading tone and the sub-28 floor are never answered or doubled', () => {
    // unit: the split's own gates (the cello's octave-up answers)
    const { notes, result } = splitCelloLine(
      undefined,
      [
        { pitch: 35, startTick: 0, durationTicks: 480, velocity: 80 }, // B1: the LT of C — never answered
        { pitch: 33, startTick: 960, durationTicks: 480, velocity: 80 }, // answered
        { pitch: 26, startTick: 1920, durationTicks: 480, velocity: 80, layer: 'div2' }, // div2: moved, never answered
      ],
      [{ startTick: 960, durationTicks: 480, pitch: 38 }], // a low voice a 7th under the 45 answer → allowed (≥ 5th)
      [{ tick: 0, bpm: 120 }],
      11, // ltPc for C
    );
    expect(result.octaveUpCount).toBe(1); // 45 - 38 = 7 ≥ 7 → not muddy: answered
    expect(result.octaveUpSuppressed).toBe(1); // the LT note 35 is never answered
    const ups = notes.filter((n) => n.layer === undefined && n.pitch >= 36 && n.pitch < 48);
    expect(ups.map((n) => n.pitch)).toEqual([45]); // only 33's answer
    // a truly muddy pair: the low voice a 2nd under the answer
    const muddy = splitCelloLine(undefined, [{ pitch: 33, startTick: 0, durationTicks: 480, velocity: 80 }], [{ startTick: 0, durationTicks: 480, pitch: 46 }]);
    expect(muddy.result.octaveUpCount).toBe(0);
    expect(muddy.result.octaveUpSuppressed).toBe(1);
    // the Cb doubles' own gates (policy, LT, floor) stay as Phase 4.5 built
    // them — pinned end-to-end by the leading-tone test in orchestrator-presets
    // and the range checks above; here: the sub-28 floor at the desk
    const composed = composeTake(threeChorus, 'ensemble.symphony', 1).project;
    const bs = composed.tracks.find((t) => t.role === 'basses')!;
    expect(bs.notes.every((n) => n.pitch >= BASSES_RANGE[0])).toBe(true);
  });

  it('6. bass notes follow the cello partner timing: the desk trails by 1–3 ms', () => {
    // unit: a marked note trails its unmarked +12 partner through humanize
    const p: Project = projectFromFixture(JSON.parse(JSON.stringify(dorian)));
    const cbId = p.tracks.find((t) => t.role === 'cellosBasses')!.id;
    const humanized = humanizeStrings({
      project: p,
      template: null,
      sections: sectionMap(p),
      notesByTrackId: {
        [cbId]: [
          { pitch: 43, startTick: 960, durationTicks: 480, velocity: 80, articulation: 'legato' },
          { pitch: 31, startTick: 960, durationTicks: 480, velocity: 80, articulation: 'legato', layer: 'cb' },
        ],
      },
    });
    const partner = humanized[cbId].find((n) => n.pitch === 43)!;
    const trail = humanized[cbId].find((n) => n.layer === 'cb')!;
    const followMs = ticksToMs(trail.startTick, p.tempoMap) - ticksToMs(partner.startTick, p.tempoMap);
    expect(followMs).toBeGreaterThan(0);
    expect(followMs).toBeLessThanOrEqual(CB_FOLLOW_MAX_MS + 2 * ticksToMs(1, p.tempoMap) + 1e-6);
    // integration: every basses note with a cello partner trails it
    for (const { project, templateId, fixture, take } of survey) {
      const cb = project.tracks.find((t) => t.role === 'cellosBasses')!;
      const bs = project.tracks.find((t) => t.role === 'basses')!;
      const head = (tick: number) => msToTicks(ticksToMs(tick, project.tempoMap) + 40, project.tempoMap) - msToTicks(ticksToMs(tick, project.tempoMap), project.tempoMap);
      let pairs = 0;
      for (const d of bs.notes) {
        const partner = cb.notes.find((n) => n.pitch === d.pitch + 12 && n.startTick >= d.startTick - head(d.startTick) && n.startTick <= d.startTick);
        if (!partner) continue;
        pairs++;
        const delta = d.startTick - partner.startTick;
        expect(delta, `${templateId} ${fixture} t${take} the desk trails its partner`).toBeGreaterThanOrEqual(0);
      }
      expect(pairs, `${templateId} ${fixture} t${take} partnered desk notes exist`).toBeGreaterThan(0);
    }
  });
});

/* ---------------- 7+10. the old combined project ---------------- */
describe('an old combined project loads and exports as before', () => {
  const legacy = (): Project => {
    const p: Project = projectFromFixture(JSON.parse(JSON.stringify(dorian)));
    p.ensemble = { templateId: 'ensemble.cinematic', overrides: {}, pins: {} };
    p.orchestration = { take: 1 };
    const golden = JSON.parse(readFileSync(new URL('./golden-moments/cinematic-dorian-t1.json', import.meta.url), 'utf8'));
    p.tracks = p.tracks.map((t) => {
      const g = golden.tracks.find((x: { id: string }) => x.id === t.id);
      if (!g) return t;
      return { ...t, notes: g.notes, ...(g.cc !== undefined ? { cc: g.cc } : {}) };
    });
    return p;
  };

  it('7. it loads (validateProject), and the profile export routes the layer notes to the Bass file on channel 5', () => {
    const p = legacy();
    expect(validateProject(JSON.parse(JSON.stringify(p))).ok).toBe(true);
    const cb = p.tracks.find((t) => t.role === 'cellosBasses')!;
    const cbLayer = cb.notes.filter((n) => n.layer === 'cb');
    expect(cbLayer.length).toBeGreaterThan(0);
    const chunks = chunksForTrack(p, cb, PROFILE);
    const bass = chunks.find((c) => c.channel === partOf('bass').channel)!;
    const cello = chunks.find((c) => c.channel === partOf('cello').channel)!;
    expect(bass).toBeDefined();
    expect(cello).toBeDefined();
    expect(bass.notes.filter((n) => n.pitch >= partOf('bass').playableLow!).length).toBe(cbLayer.length);
    expect(cello.notes.every((n) => n.pitch < partOf('cello').lowestPlayable || n.velocity === PROFILE.keyswitchVelocity || n.pitch >= partOf('cello').playableLow!)).toBe(true);
    expect(JSON.stringify(p)).toBe(JSON.stringify(legacy()));
  });

  it('10. its no-profile export is byte-identical to the Phase 8.1 reference (merged + every per-track file)', () => {
    const p = legacy();
    const goldenDir = new URL('./golden82/', import.meta.url);
    const tracks = exportableTracks(p, 'all');
    expect(Buffer.compare(Buffer.from(buildMergedMidi(p, tracks)), readFileSync(new URL('dorian-cinematic-merged.mid', goldenDir)))).toBe(0);
    for (const f of buildPerTrackMidi(p, tracks)) {
      expect(Buffer.compare(Buffer.from(f.data), readFileSync(new URL(`dorian-cinematic-per-${f.fileName}`, goldenDir)))).toBe(0);
    }
  });
});

/* ---------------- 8. one undo step ---------------- */
describe('the split Compose All in the store', () => {
  it('adds the Double Basses track in ONE undo step (with the notes and the take)', () => {
    const s = useStore.getState();
    const p: Project = JSON.parse(JSON.stringify(projectFromFixture(JSON.parse(JSON.stringify(threeChorus)))));
    p.ensemble = { templateId: 'ensemble.cinematic', overrides: {}, pins: {} };
    p.orchestration = undefined;
    s.set({ project: p, past: [], future: [] });
    useStore.getState().composeAll();
    const after = useStore.getState().project;
    expect(after.tracks.some((t) => t.role === 'basses')).toBe(true);
    expect(useStore.getState().past.length).toBe(1); // ONE undo step
    useStore.getState().undo();
    const undone = useStore.getState().project;
    expect(undone.tracks.some((t) => t.role === 'basses')).toBe(false);
    expect(undone.orchestration).toBeUndefined();
    expect(undone.tracks.find((t) => t.role === 'cellosBasses')!.notes).toEqual(p.tracks.find((t) => t.role === 'cellosBasses')!.notes);
    useStore.getState().redo();
    expect(useStore.getState().project.tracks.some((t) => t.role === 'basses')).toBe(true);
  });

  it('a locked cello track: no split, no basses track', () => {
    const p: Project = JSON.parse(JSON.stringify(projectFromFixture(JSON.parse(JSON.stringify(threeChorus)))));
    p.ensemble = { templateId: 'ensemble.cinematic', overrides: {}, pins: {} };
    p.orchestration = { take: 1 };
    p.tracks = p.tracks.map((t) => (t.role === 'cellosBasses' ? { ...t, locked: true } : t));
    const r = composeAllTracks(p, { seed: 11 });
    expect(r.tracks.some((t) => t.role === 'basses')).toBe(false);
  });
});

/* ---------------- 9. the bass part validates ---------------- */
describe('the bass profile data', () => {
  it('9. the bass keys sit inside the verified zone 12–22 and below playableLow 23; outside keys are rejected', () => {
    const bass = partOf('bass');
    expect(bass.keyswitchZone).toEqual({ low: 12, high: 22 });
    expect(bass.playableLow).toBe(23);
    for (const midi of Object.values(bass.keyswitches).map((n) => keyNameToMidi(n, CONV)!)) {
      expect(midi).toBeGreaterThanOrEqual(12);
      expect(midi).toBeLessThanOrEqual(22);
      expect(midi).toBeLessThan(23);
    }
    // outside the zone → rejected
    const doc = JSON.parse(readFileSync(new URL('../src/export/profiles/uvi-orchestral-suite.json', import.meta.url), 'utf8')) as { parts: Record<string, unknown>[] };
    const rawBass = doc.parts.find((x) => x.id === 'bass') as { keyswitches: Record<string, string> };
    rawBass.keyswitches.sustain = 'C0'; // 24 > 22: outside the zone AND above playableLow
    const errors = validateExportProfile(doc);
    expect(errors.some((e) => e.includes('parts[4].keyswitches.sustain') && e.includes("outside the part's keyswitch zone"))).toBe(true);
    expect(errors.some((e) => e.includes('parts[4].keyswitches.sustain') && e.includes('not below'))).toBe(true);
    // the shipped profile parses clean
    expect(parseExportProfile(JSON.parse(readFileSync(new URL('../src/export/profiles/uvi-orchestral-suite.json', import.meta.url), 'utf8'))).parts.find((x) => x.id === 'bass')).toBeDefined();
  });
});

/* ---------------- the D3 energy pin ---------------- */
describe('roster energy (D3): the desk adds no loudness', () => {
  it('the energy peak stays within the clamp with the desk counted under the cellosBasses role', () => {
    for (const templateId of SPLIT_TEMPLATES) {
      for (const [fixTag, doc] of [['dorian', dorian], ['three', threeChorus]] as const) {
        for (let take = 1; take <= 3; take++) {
          const { project } = composeTake(doc, templateId, take);
          const template = resolveTemplate(project.ensemble)!;
          const report = measureEnergy(project, template);
          expect(report.violations.filter((v) => v.kind === 'aboveMax'), `${templateId} ${fixTag} t${take}`).toEqual([]);
        }
      }
    }
  });
});
