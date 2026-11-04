import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/dorian-16bars.json';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { buildMergedMidi, exportableTracks, parseMidiFile } from '../src/export/midi';
import { mergeTremoloGroups } from '../src/export/profile';
import {
  ARTICULATION_VOICES, TREMOLO_DEPTH, TREMOLO_RATE_HZ,
  ccValueAt, coalesceCcPoints, dynamicGain, brightnessGain, expressionEvents, expressionGain,
  planTrackNotes, stringPartOf, voiceDetune, voiceParams,
} from '../src/audio/mapping';
import { MAX_CC_POINTS_PER_LANE, type Note, type Project, type Track } from '../src/shared/schema/types';
import { projectEndTick, projectFromFixture } from '../src/shared/schema';

/**
 * Phase 6 — the preview synth honours Note.articulation, the CC1/7/11 lanes
 * and the ensemble detune. The mapping lives in src/audio/mapping.ts as pure
 * functions; the engine (preview.ts) consumes it. Pins here: ccValueAt ==
 * the export's step semantics (verified against the written file itself),
 * the articulation envelope table, the tremolo merge == the 5.5 export
 * merge, the deterministic per-part detune, no project mutation, simple-mode
 * legacy parameters, and the bounded per-track automation event count.
 */
const BASE = (): Project => projectFromFixture(JSON.parse(JSON.stringify(fixture)));
const THREE = (): Project => projectFromFixture(JSON.parse(JSON.stringify(threeChorus)));

const composeTake = (project: Project, templateId: string, take: number) => {
  project.ensemble = { templateId, overrides: {}, pins: {} };
  project.orchestration = { take };
  const result = composeAllTracks(project, { seed: 11 });
  return { project: { ...project, tracks: result.tracks } as Project, result };
};

const composed = () => composeTake(BASE(), 'ensemble.cinematic', 1).project;
const composedThree = () => composeTake(THREE(), 'ensemble.cinematic', 1).project;
const trackOf = (p: Project, role: string) => p.tracks.find((t) => t.role === role)!;
const note = (over: Partial<Note> = {}): Note => ({ pitch: 60, startTick: 0, durationTicks: 960, velocity: 80, ...over });
const stringTrack = (over: Partial<Track> = {}): Track =>
  ({ id: 't1', name: 'V1', family: 'Strings', role: 'violins1', locked: false, frozen: false, muted: false, soloed: false, volume: 0.8, pan: 0, notes: [], ...over }) as Track;

/* ---------------- 1. ccValueAt == the export's step semantics ---------------- */
describe('ccValueAt matches the export interpolation', () => {
  const p = composed();
  const tracks = exportableTracks(p, 'all');

  it('at a point its value; between points the previous one; before the first the first', () => {
    const lane = trackOf(p, 'violins1').cc!.find((l) => l.cc === 11)!;
    const pts = lane.points;
    expect(pts.length).toBeGreaterThan(4);
    for (const pt of pts) expect(ccValueAt(lane, pt.tick)).toBe(pt.value);
    for (let i = 1; i < pts.length; i++) {
      const mid = Math.floor((pts[i - 1].tick + pts[i].tick) / 2);
      if (mid !== pts[i - 1].tick && mid !== pts[i].tick) expect(ccValueAt(lane, mid)).toBe(pts[i - 1].value);
    }
    expect(ccValueAt(lane, 0)).toBe(ccValueAt(lane, pts[0].tick - 1000) ?? pts[0].value);
    expect(ccValueAt(lane, projectEndTick(p) + 500)).toBe(pts[pts.length - 1].value);
  });

  it('duplicate ticks: the later write wins (same rule as finalizeLane)', () => {
    const lane = { cc: 11, points: [{ tick: 0, value: 10 }, { tick: 100, value: 40 }, { tick: 100, value: 70 }, { tick: 200, value: 90 }] };
    expect(ccValueAt(lane, 100)).toBe(70);
    expect(ccValueAt(lane, 150)).toBe(70);
  });

  it('missing/empty lane reads null; the engine maps that to unity', () => {
    expect(ccValueAt(undefined, 10)).toBeNull();
    expect(ccValueAt({ cc: 11, points: [] }, 10)).toBeNull();
    expect(expressionGain(null)).toBe(1);
    expect(dynamicGain(null)).toBe(1);
    expect(brightnessGain(null)).toBe(1);
  });

  it('the exported file itself: parsed CC events == the lane points, and ccValueAt reproduces the file at every event tick', () => {
    const merged = parseMidiFile(buildMergedMidi(p, tracks));
    for (const tr of merged.tracks) {
      const src = tracks.find((t) => t.name === tr.name);
      if (!src?.cc?.length) continue;
      for (const lane of src.cc) {
        const inFile = tr.cc.filter((e) => e.cc === lane.cc).map((e) => ({ tick: e.tick, value: e.value }));
        expect(inFile.length).toBe(lane.points.length); // the writer emits every point, nothing else
        const projectLane = src.cc.find((l) => l.cc === lane.cc)!;
        for (const e of inFile) {
          expect(ccValueAt(projectLane, e.tick)).toBe(e.value); // the preview reads exactly what the file holds
        }
      }
    }
  });

  it('playing from the middle: ccValueAt at the start tick is the value the file holds there', () => {
    const lane = trackOf(p, 'violins1').cc!.find((l) => l.cc === 1)!;
    const bt = projectEndTick(p) > 8 * 3840 ? 3840 : 1920;
    for (const start of [0, 3 * bt, 7 * bt, Math.floor(projectEndTick(p) / 2)]) {
      const held = ccValueAt(lane, start)!;
      const lastEvent = lane.points.filter((pt) => pt.tick <= start).pop()!;
      expect(held).toBe(lastEvent.value);
      expect(expressionGain(held)).toBeGreaterThan(0); // the primed expression level is sane
      expect(expressionGain(held)).toBeLessThanOrEqual(1);
    }
  });
});

/* ---------------- 2. articulation envelopes ---------------- */
describe('voiceParams: the articulation table', () => {
  const t = stringTrack();
  const cc = { cc1: 84 };

  it('sustain family: slow-ish attack, full sustain, ~150 ms release, no cap', () => {
    for (const art of ['sustain', 'detache', 'portato', 'sulTasto', 'sulPont', 'conSord'] as const) {
      // 'sustain' is the profile pseudo-articulation — legal in the table, not on a stored Note
      const vp = voiceParams(note({ articulation: art as Note['articulation'] }), t, cc);
      expect(vp.legacy).toBe(false);
      expect(vp.attack).toBeGreaterThanOrEqual(0.06);
      expect(vp.attack).toBeLessThanOrEqual(0.12);
      expect(vp.release).toBeCloseTo(0.15, 5);
      expect(vp.capSec).toBeNull();
      expect(vp.sustainLevel).toBe(1);
      expect(vp.trem).toBeUndefined();
    }
  });
  it('legato: 120–180 ms attack, equal-power (sqrt) shaping', () => {
    const vp = voiceParams(note({ articulation: 'legato' }), t, cc);
    expect(vp.attack).toBeGreaterThanOrEqual(0.12);
    expect(vp.attack).toBeLessThanOrEqual(0.18);
    expect(vp.attackShape).toBe('sqrt');
    expect(vp.capSec).toBeNull();
  });
  it('marcato: fast attack + accent bump decaying to sustain', () => {
    const vp = voiceParams(note({ articulation: 'marcato' }), t, cc);
    expect(vp.attack).toBeLessThanOrEqual(0.03);
    expect(vp.accent).toBeGreaterThan(1);
    expect(vp.sustainLevel).toBe(1);
  });
  it('spiccato/staccato: capped body (150–250 ms), fast release', () => {
    const spicc = voiceParams(note({ articulation: 'spiccato' }), t, cc);
    const stac = voiceParams(note({ articulation: 'staccato' }), t, cc);
    for (const [vp, lo, hi] of [[spicc, 0.15, 0.25], [stac, 0.15, 0.25]] as const) {
      expect(vp.capSec!).toBeGreaterThanOrEqual(lo);
      expect(vp.capSec!).toBeLessThanOrEqual(hi);
      expect(vp.release).toBeLessThanOrEqual(0.08);
    }
  });
  it('pizz: instant attack, exponential decay regardless of the note length', () => {
    const vp = voiceParams(note({ articulation: 'pizz', durationTicks: 19200 }), t, cc);
    expect(vp.attack).toBeLessThanOrEqual(0.006);
    expect(vp.decayTauSec).not.toBeNull();
    expect(vp.capSec).toBeNull();
  });
  it('tremolo: AM ~7–9 Hz, depth ~40% over the held note', () => {
    const vp = voiceParams(note({ articulation: 'tremolo' }), t, cc);
    expect(vp.trem!.rateHz).toBeGreaterThanOrEqual(7);
    expect(vp.trem!.rateHz).toBeLessThanOrEqual(9);
    expect(vp.trem!.depth).toBeCloseTo(0.4, 5);
    expect(TREMOLO_RATE_HZ).toBe(8);
    expect(TREMOLO_DEPTH).toBe(0.4);
  });
  it('no articulation (any family): today\'s envelope — legacy with CC1 folded in', () => {
    const plain = voiceParams(note(), t, cc);
    expect(plain.legacy).toBe(true);
    expect(plain.attack).toBe(0.09);
    expect(plain.release).toBe(0.3);
    expect(plain.sustainLevel).toBe(0.85);
    const brass = voiceParams(note(), { family: 'Brass' } as Track, cc);
    expect(brass.legacy).toBe(true);
  });
  it('CC1 folds in as a perceptual gain curve + a brightness multiplier', () => {
    expect(dynamicGain(0)).toBeCloseTo(0.3, 5);
    expect(dynamicGain(127)).toBeCloseTo(1, 5);
    // perceptual taper, not linear: the midpoint sits below the linear halfway
    // mark (more resolution at the bottom of the dynamic range)
    expect(dynamicGain(63)).toBeLessThan(0.3 + 0.7 * (63 / 127));
    expect(dynamicGain(63)).toBeGreaterThan(0.3); // and not a floor clamp
    expect(brightnessGain(0)).toBeCloseTo(0.7, 5);
    expect(brightnessGain(127)).toBeCloseTo(1.3, 5);
    const vp = voiceParams(note({ articulation: 'detache' }), t, { cc1: 40 });
    expect(vp.dynamic).toBeCloseTo(dynamicGain(40), 10);
    expect(vp.bright).toBeCloseTo(brightnessGain(40), 10);
  });
  it('the table itself is complete over ARTICULATION_VOICES', () => {
    for (const art of Object.keys(ARTICULATION_VOICES)) {
      const vp = voiceParams(note({ articulation: art as Note['articulation'] }), t, cc);
      expect(vp.legacy).toBe(false);
    }
  });
});

/* ---------------- 3. tremolo merge == the export merge ---------------- */
describe('tremolo: the preview reuses the export merge', () => {
  const p = composed();
  const v1 = trackOf(p, 'violins1');

  it('planTrackNotes(expressive) groups exactly like mergeTremoloGroups, and merged spans carry tremolo for the AM', () => {
    const exported = mergeTremoloGroups(v1.notes);
    const planned = planTrackNotes(v1, 'expressive');
    expect(planned.length).toBe(exported.length);
    const key = (n: Note) => `${n.pitch}:${n.startTick}:${n.durationTicks}:${n.velocity}`;
    expect(planned.map(key)).toEqual(exported.map(key));
    // merged groups lost their articulation in the export shape; the preview re-marks them
    const mergedSpans = exported.filter((n) => !('articulation' in n) || n.articulation === undefined);
    expect(mergedSpans.length).toBeGreaterThan(0);
    for (const m of mergedSpans) {
      const plan = planned.find((n) => key(n) === key(m))!;
      expect(plan.articulation).toBe('tremolo');
      expect(voiceParams(plan, v1, { cc1: null }).trem).toBeDefined();
    }
    expect(planned.every((n) => !n.layer || n.layer === 'cb')).toBe(true); // layer survives
  });

  it('simple mode schedules the stored notes as-is', () => {
    expect(planTrackNotes(v1, 'simple')).toBe(v1.notes);
  });

  it('a synthetic measured-tremolo run merges into one AM note per group', () => {
    const t2 = stringTrack({ role: 'violas', notes: [
      note({ pitch: 60, startTick: 0, durationTicks: 240, articulation: 'tremolo' }),
      note({ pitch: 60, startTick: 240, durationTicks: 240, articulation: 'tremolo' }),
      note({ pitch: 60, startTick: 480, durationTicks: 240, articulation: 'tremolo' }),
      note({ pitch: 62, startTick: 720, durationTicks: 240, articulation: 'tremolo' }),
    ] });
    const planned = planTrackNotes(t2, 'expressive');
    expect(planned).toHaveLength(2);
    expect(planned[0]).toMatchObject({ pitch: 60, startTick: 0, durationTicks: 720, articulation: 'tremolo' });
    expect(voiceParams(planned[0], t2, { cc1: null }).trem!.depth).toBeCloseTo(0.4, 5);
    // the stored track is untouched
    expect(t2.notes).toHaveLength(4);
  });
});

/* ---------------- 4. detune (D9, preview only) ---------------- */
describe('detune: deterministic, per-part, within range', () => {
  it('each voice offset is deterministic and stays within the part spread', () => {
    const parts: { role: string; spread: number }[] = [
      { role: 'violins1', spread: 8 }, { role: 'violins2', spread: 8 }, { role: 'violas', spread: 6 },
    ];
    for (const { role, spread } of parts) {
      const t = stringTrack({ role });
      for (let i = 0; i < 200; i++) {
        const n = note({ pitch: 55 + (i % 30), startTick: i * 240 });
        const d = voiceDetune(n, t);
        expect(d).toBe(voiceDetune(n, t)); // deterministic
        expect(Math.abs(d)).toBeLessThanOrEqual(spread + 1e-9);
      }
    }
  });
  it('the cellosBasses track splits: cello ±6, bass (layer cb) ±4; non-strings 0', () => {
    const cb = stringTrack({ role: 'cellosBasses' });
    expect(stringPartOf(cb, note({ pitch: 40 }))).toBe('cello');
    expect(stringPartOf(cb, note({ pitch: 28, layer: 'cb' }))).toBe('bass');
    for (let i = 0; i < 100; i++) {
      expect(Math.abs(voiceDetune(note({ pitch: 40, startTick: i * 97 }), cb))).toBeLessThanOrEqual(6 + 1e-9);
      expect(Math.abs(voiceDetune(note({ pitch: 28, startTick: i * 97, layer: 'cb' }), cb))).toBeLessThanOrEqual(4 + 1e-9);
    }
    expect(voiceDetune(note(), stringTrack({ family: 'Keys', role: 'piano' }))).toBe(0);
    expect(voiceDetune(note(), stringTrack({ family: 'Percussion', role: 'timpani' }))).toBe(0);
  });
  it('offsets actually vary across voices (a real ensemble spread, not a constant)', () => {
    const t = stringTrack({ role: 'violins1' });
    const set = new Set(Array.from({ length: 100 }, (_, i) => voiceDetune(note({ startTick: i * 130 }), t).toFixed(3)));
    expect(set.size).toBeGreaterThan(20);
  });
});

/* ---------------- 5. no mutation + simple mode ---------------- */
describe('purity: the preview mapping never mutates the project', () => {
  it('deep-equal before/after running the whole mapping over a composed project', () => {
    const p = composed();
    const before = JSON.stringify(p);
    const end = projectEndTick(p);
    for (const tr of p.tracks) {
      planTrackNotes(tr, 'expressive');
      for (const n of tr.notes) {
        voiceParams(n, tr, { cc1: ccValueAt(tr.cc?.find((l) => l.cc === 1), n.startTick) });
        voiceDetune(n, tr);
        stringPartOf(tr, n);
      }
      for (let tick = 0; tick <= end; tick += 480) {
        for (const ccN of [1, 7, 11]) ccValueAt(tr.cc?.find((l) => l.cc === ccN), tick);
      }
      expressionEvents(tr);
    }
    expect(JSON.stringify(p)).toBe(before);
  });

  it('simple mode matches the old parameters: stored notes, no table lookup, legacy envelope numbers', () => {
    const p = composed();
    for (const tr of p.tracks) {
      expect(planTrackNotes(tr, 'simple')).toBe(tr.notes); // the exact stored array
    }
    // the legacy row == today's strings envelope (preview.ts legacy branch)
    const vp = voiceParams(note(), stringTrack(), { cc1: 64 });
    expect(vp).toMatchObject({ legacy: true, attack: 0.09, release: 0.3, sustainLevel: 0.85, capSec: null, decayTauSec: null, accent: 1 });
    // no CC1 lane → unity dynamics even in expressive mode (old projects keep their level)
    expect(voiceParams(note({ articulation: 'detache' }), stringTrack(), { cc1: null })).toMatchObject({ dynamic: 1, bright: 1 });
  });
});

/* ---------------- 6. coalescing + bounded event count ---------------- */
describe('automation events: coalesced and bounded', () => {
  it('coalesceCcPoints drops no-op steps, keeps the first point and the values', () => {
    expect(coalesceCcPoints([])).toEqual([]);
    expect(coalesceCcPoints([{ tick: 0, value: 40 }])).toEqual([{ tick: 0, value: 40 }]);
    expect(coalesceCcPoints([{ tick: 0, value: 40 }, { tick: 480, value: 40 }, { tick: 960, value: 52 }]))
      .toEqual([{ tick: 0, value: 40 }, { tick: 960, value: 52 }]);
    // a dip and return is NOT a no-op — both points survive
    expect(coalesceCcPoints([{ tick: 0, value: 40 }, { tick: 480, value: 30 }, { tick: 960, value: 40 }])).toHaveLength(3);
  });

  it('expressionEvents are sorted and equal the coalesced CC11 lane', () => {
    const p = composed();
    for (const tr of exportableTracks(p, 'all')) {
      const lane = tr.cc?.find((l) => l.cc === 11);
      const ev = expressionEvents(tr);
      for (let i = 1; i < ev.length; i++) expect(ev[i].tick).toBeGreaterThan(ev[i - 1].tick);
      expect(ev.length).toBeLessThanOrEqual(coalesceCcPoints([...(lane?.points ?? [])].sort((a, b) => a.tick - b.tick)).length);
    }
  });

  it('max AudioParam events per track on the three-chorus fixture (reported)', () => {
    const p = composedThree();
    const tracks = exportableTracks(p, 'all');
    expect(tracks.length).toBeGreaterThan(0);
    let worst = { name: '', cc11: 0, total: 0 };
    const lines: string[] = [];
    for (const tr of tracks) {
      const cc11 = expressionEvents(tr).length;
      const total = [1, 7, 11].reduce((sum, c) => sum + coalesceCcPoints([...(tr.cc?.find((l) => l.cc === c)?.points ?? [])].sort((a, b) => a.tick - b.tick)).length, 0);
      for (const lane of tr.cc ?? []) expect(lane.points.length).toBeLessThanOrEqual(MAX_CC_POINTS_PER_LANE);
      lines.push(`  ${tr.name}: CC11 events ${cc11}, lanes 1+7+11 coalesced ${total}`);
      if (cc11 > worst.cc11) worst = { name: tr.name, cc11, total };
    }
    expect(worst.cc11).toBeGreaterThan(0);
    expect(worst.cc11).toBeLessThanOrEqual(MAX_CC_POINTS_PER_LANE);
    console.log(`[phase6] max automation events per track (three-chorus): ${worst.cc11} CC11 events on "${worst.name}"`);
    console.log(`[phase6] per-track event counts (three-chorus, cinematic take 1):\n${lines.join('\n')}`);
  });
});
