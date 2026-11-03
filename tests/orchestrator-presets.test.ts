import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/dorian-16bars.json';
import { ENSEMBLE_BY_ID } from '../src/config/ensembles';
import { composeAllTracks } from '../src/orchestrator/compose';
import { chordSpans } from '../src/engine/generate';
import { chordTones } from '../src/orchestrator/voicing/chordTones';
import { leadingTonePcOf } from '../src/orchestrator/voicing/voiceLead';
import { TREMOLO_STEP_TICKS, subdivisionTicks, SHORT_NOTE_SECONDS } from '../src/orchestrator/lines/ostinato';
import { secondsToTicks } from '../src/orchestrator/spine';
import { scalePitchClasses } from '../src/shared/schema/modes';
import { projectFromFixture, type Project } from '../src/shared/schema';

const BASE = (): Project => projectFromFixture(JSON.parse(JSON.stringify(fixture)));
const compose = (templateId: string) => {
  const p = BASE();
  p.ensemble = { templateId, overrides: {}, pins: {} };
  const result = composeAllTracks(p, { seed: 11 });
  return { project: { ...p, tracks: result.tracks }, result };
};
const track = (p: Project, role: string) => p.tracks.find((t) => t.role === role)!;
const BT = 3840; // 4/4 bar at 960 PPQ

describe('cinematic preset (4e): ostinato + measured tremolo', () => {
  const { project, result } = compose('ensemble.cinematic');
  const spans = chordSpans(project);
  const step = subdivisionTicks({ numerator: 4, denominator: 4 });

  it('V2 + Vla play chord tones on the subdivision grid, spiccato-length, viola under V2', () => {
    const v2 = track(project, 'violins2').notes;
    const vla = track(project, 'violas').notes;
    expect(v2.length).toBeGreaterThan(50);
    expect(vla.length).toBeGreaterThan(50);
    const lt = leadingTonePcOf(project.key, scalePitchClasses(project.key, project.mode));
    const shortCap = secondsToTicks(SHORT_NOTE_SECONDS, project.tempoMap);
    for (const n of [...v2, ...vla]) {
      expect(n.articulation).toBe('spiccato');
      expect(n.durationTicks).toBeLessThan(shortCap); // spiccato length, under 0.25 s
      expect(n.startTick % step).toBe(0); // on the finest regular subdivision grid
      const chord = spans.find((s) => n.startTick >= s.startTick && n.startTick < s.endTick)!;
      const tones = new Set(chordTones(chord.parsed).tones.map((t) => t.pc));
      expect(tones.has(((n.pitch % 12) + 12) % 12)).toBe(true); // chord tones…
      if (lt !== null) expect(((n.pitch % 12) + 12) % 12).not.toBe(lt); // …minus the leading tone
    }
    // the viola stays under violin II wherever they coincide
    for (const a of v2) {
      for (const b of vla) {
        if (a.startTick === b.startTick) expect(b.pitch).toBeLessThan(a.pitch);
      }
    }
    void result;
  });

  it('V1 plays measured tremolo only where the arc energy ≥ 0.65, and leads below it', () => {
    const v1 = track(project, 'violins1').notes;
    const tremolo = v1.filter((n) => n.articulation === 'tremolo');
    expect(tremolo.length).toBeGreaterThan(30);
    console.log(`Phase 4e report: cinematic V1 tremolo adds ${tremolo.length} repeated notes (rate ${TREMOLO_STEP_TICKS} ticks)`);
    for (const n of tremolo) {
      expect(n.durationTicks).toBeLessThanOrEqual(TREMOLO_STEP_TICKS);
      const bar = Math.floor(n.startTick / BT) + 1;
      const target = result.plan.bars[bar - 1].energyTarget;
      expect(target).toBeGreaterThanOrEqual(0.65); // only above the threshold
      // measured repeats: within one chord span, the repeats hold ONE pitch
      const span = spans.find((s) => n.startTick >= s.startTick && n.startTick < s.endTick)!;
      const spanTremolo = tremolo.filter((m) => m.startTick >= span.startTick && m.startTick < span.endTick);
      expect(new Set(spanTremolo.map((m) => m.pitch)).size).toBe(1);
    }
    const verseTremolo = tremolo.filter((n) => n.startTick < 8 * BT);
    expect(verseTremolo).toHaveLength(0); // verse targets sit below 0.65: V1 leads there
  });
});

describe('symphony preset (4e): cellosBasses pizz-pulse', () => {
  const { project } = compose('ensemble.symphony');
  it('short pizz notes on the strong beats (1 and 3), nothing else', () => {
    const cb = track(project, 'cellosBasses').notes;
    expect(cb.length).toBeGreaterThan(10);
    for (const n of cb) {
      expect(n.articulation).toBe('pizz');
      expect([0, 2 * 960]).toContain(n.startTick % BT); // beats 1 and 3 in 4/4
      expect(n.durationTicks).toBeLessThan(960);
    }
  });
});

describe('Vocal Backing preset (4e): wide legato only', () => {
  const { project } = compose('ensemble.vocalbacking');
  it('every string note is a sustained pad note — no lead, ostinato, tremolo or stabs', () => {
    for (const role of ['violins2', 'violas', 'cellosBasses']) {
      for (const n of track(project, role).notes) {
        expect(n.articulation).toBe('legato');
        expect(n.durationTicks).toBeGreaterThanOrEqual(480); // nothing shorter than an eighth
      }
    }
  });
});

describe('Vc+Cb layering (4f): octave below where policy and range allow', () => {
  it('dorian fixture (no leading tone): symphony cellosBasses carries the Cb octave', () => {
    const { project, result } = compose('ensemble.symphony');
    const cb = track(project, 'cellosBasses');
    const report = result.reports.find((r) => r.startsWith('Vc+Cb layering'));
    // either layered (every note has its octave-below partner) or reported+skipped
    if (report?.includes('holds a Cb line')) {
      const pitches = new Set(cb.notes.map((n) => `${n.startTick}:${n.pitch}`));
      for (const n of cb.notes) {
        expect(pitches.has(`${n.startTick}:${n.pitch - 12}`) || pitches.has(`${n.startTick}:${n.pitch + 12}`)).toBe(true);
      }
      expect(Math.min(...cb.notes.map((n) => n.pitch)) - 12).toBeGreaterThanOrEqual(cb.lowestNote);
    } else {
      expect(report).toMatch(/skipped/);
    }
    console.log('Phase 4f report (symphony · dorian):', report);
  });

  it('chamber and sonata (doubling not allowed): no same-track octave pairs in cellosBasses', () => {
    for (const id of ['ensemble.chamber', 'ensemble.sonata']) {
      const { project } = compose(id);
      const cb = track(project, 'cellosBasses').notes;
      for (const a of cb) {
        for (const b of cb) {
          if (a === b) continue;
          if (a.startTick < b.startTick + b.durationTicks && b.startTick < a.startTick + a.durationTicks) {
            expect(Math.abs(a.pitch - b.pitch)).not.toBe(12);
          }
        }
      }
    }
  });
});
