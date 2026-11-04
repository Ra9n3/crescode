import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/dorian-16bars.json';
import { resolveTemplate } from '../src/config/ensembles';
import { composeAllTracks } from '../src/orchestrator/compose';
import { chordSpans } from '../src/engine/generate';
import { chordTones } from '../src/orchestrator/voicing/chordTones';
import { leadingTonePcOf } from '../src/orchestrator/voicing/voiceLead';
import { TREMOLO_STEP_TICKS, subdivisionTicks, SHORT_NOTE_SECONDS } from '../src/orchestrator/lines/ostinato';
import { secondsToTicks, sectionMap, energyCurve } from '../src/orchestrator/spine';
import { prepareStrings } from '../src/orchestrator/render';
import { HUMANIZE_HEAD_TICKS } from '../src/orchestrator/energy/rules';
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
  /** 4.6: the ostinato style is part of the drawn texture. The trailer
   *  texture (V2+Vla 16th spiccato, both tracks) is the only 16th one —
   *  scan takes for one whose Chorus drew it and pin the 4e contract there. */
  const composeTrailerChorus = () => {
    for (let t = 0; t < 40; t++) {
      const p = BASE();
      p.ensemble = { templateId: 'ensemble.cinematic', overrides: {}, pins: {} };
      p.orchestration = { take: t };
      const composed = composeAllTracks(p, { seed: 11 });
      const tex = Object.fromEntries(composed.reports.find((r) => r.startsWith('textures'))!.split(': ')[1].split(', ').map((kv) => kv.split('='))) as Record<string, string>;
      if (tex.chorus === 'trailer') {
        return { project: { ...p, tracks: composed.tracks } as Project, result: composed, tex, take: composed.orchestration.take };
      }
    }
    throw new Error('no take in 0..39 drew a trailer chorus');
  };

  const { project, result, tex, take } = composeTrailerChorus();
  const spans = chordSpans(project);
  const step = subdivisionTicks({ numerator: 4, denominator: 4 });
  const CHORUS_FROM = 8 * BT; // the dorian fixture's Chorus starts at bar 9

  it('V2 + Vla play chord tones on the subdivision grid, spiccato-length, viola under V2 (trailer chorus)', () => {
    expect(tex.chorus).toBe('trailer');
    const v2 = track(project, 'violins2').notes.filter((n) => n.startTick >= CHORUS_FROM);
    const vla = track(project, 'violas').notes.filter((n) => n.startTick >= CHORUS_FROM);
    expect(v2.length).toBeGreaterThan(50);
    expect(vla.length).toBeGreaterThan(50);
    const lt = leadingTonePcOf(project.key, scalePitchClasses(project.key, project.mode));
    const shortCap = secondsToTicks(SHORT_NOTE_SECONDS, project.tempoMap);
    for (const n of [...v2, ...vla]) {
      expect(n.articulation).toBe('spiccato');
      expect(n.durationTicks).toBeLessThan(shortCap); // spiccato length, under 0.25 s
      // Phase 5d: humanized attacks enter late — the note sits at most one
      // humanize head past its subdivision-grid tick
      expect(n.startTick % step).toBeLessThanOrEqual(HUMANIZE_HEAD_TICKS);
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
    console.log(`Phase 4e report (4.6 trailer take ${take}, textures ${JSON.stringify(tex)}): cinematic V2+Vla chorus ostinato ${v2.length}+${vla.length} notes (rate ${step} ticks)`);
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
    }
    const verseTremolo = tremolo.filter((n) => n.startTick < 8 * BT);
    expect(verseTremolo).toHaveLength(0); // verse targets sit below 0.65: V1 leads there
  });

  it('the tremolo carries the lead: first repeat on the motif pitch at the motif onset, repeats grouped per lead note', () => {
    // rebuild the same prepared lines (deterministic) to know the motif and the fallbacks
    const p = BASE();
    p.ensemble = { templateId: 'ensemble.cinematic', overrides: {}, pins: {} };
    const composed = composeAllTracks(p, { seed: 11 });
    const composedProject = { ...p, tracks: composed.tracks };
    const template = resolveTemplate(p.ensemble)!;
    const arc = energyCurve(composedProject, sectionMap(composedProject), 1, template, true);
    const ctx = {
      project: composedProject, template, ensemble: p.ensemble!,
      spans: chordSpans(composedProject), sections: sectionMap(composedProject), arc,
    };
    const lines = prepareStrings(ctx, 1);
    const fallbackTicks: [number, number][] = lines.voiced.filter((v) => lines.fallbackSpanIds.has(v.id)).map((v) => [v.startTick, v.endTick]);
    const inFallback = (tick: number) => fallbackTicks.some(([a, b]) => tick >= a && tick < b);
    const tremoloBars = new Set(lines.assignment.filter((b) => b.byTrack[lines.lead!.trackId] === 'tremolo').map((b) => b.bar));
    expect(tremoloBars.size).toBeGreaterThan(0);

    const v1 = track(composedProject, 'violins1').notes;
    const tremolo = v1.filter((n) => n.articulation === 'tremolo');
    // Phase 5d: tremolo notes take the section base WITHOUT per-note jitter,
    // so each lead note's repeat group shifts RIGIDLY by at most one head.
    const groupOf = (ln: { startTick: number; durationTicks: number; pitch: number }) =>
      tremolo.filter((n) => n.pitch === ln.pitch && n.startTick >= ln.startTick && n.startTick < ln.startTick + ln.durationTicks + HUMANIZE_HEAD_TICKS)
        .sort((a, b) => a.startTick - b.startTick);
    let checked = 0;
    for (const ln of lines.lead!.notes) {
      const bar = Math.floor(ln.startTick / BT) + 1;
      if (!tremoloBars.has(bar) || inFallback(ln.startTick)) continue;
      // the first repeat lands ON the motif pitch at (or a humanize head
      // after) the motif onset
      const group = groupOf(ln);
      expect(group.length).toBeGreaterThan(0);
      expect(group[0].startTick).toBeGreaterThanOrEqual(ln.startTick);
      expect(group[0].startTick).toBeLessThanOrEqual(ln.startTick + HUMANIZE_HEAD_TICKS);
      // the repeats hold the lead note's pitch and keep the measured step
      for (const n of group) expect(n.pitch).toBe(ln.pitch);
      for (let i = 1; i < group.length; i++) expect(group[i].startTick - group[i - 1].startTick).toBe(TREMOLO_STEP_TICKS);
      checked++;
    }
    expect(checked).toBeGreaterThan(10); // the chorus tune really is the motif
    // the repeats never bleed across a lead-note boundary (rigid shift ≤ head)
    for (const n of tremolo) {
      if (inFallback(n.startTick)) continue;
      const host = lines.lead!.notes.find((ln) => n.startTick >= ln.startTick && n.startTick < ln.startTick + ln.durationTicks + HUMANIZE_HEAD_TICKS);
      expect(host).toBeTruthy();
    }
    // and the count is reported
    const report = composed.reports.find((r) => r.startsWith('cinematic tremolo'));
    expect(report).toMatch(/cinematic tremolo: (\d+) measured repeats carry the lead motif/);
    const reported = Number(report!.match(/(\d+)/)![1]);
    expect(reported).toBe(tremolo.length);
    console.log(`Phase 4.5 report: ${report} (lead notes rendered as tremolo groups: ${checked})`);
  });
});

describe('symphony preset (4e): cellosBasses pizz-pulse', () => {
  /** 4.6: the Cb axis (pizz vs sustained) is part of the drawn texture —
   *  scan takes for one whose every section type drew a pizz-bass texture. */
  const composeAllPizz = () => {
    for (let t = 0; t < 24; t++) {
      const p = BASE();
      p.ensemble = { templateId: 'ensemble.symphony', overrides: {}, pins: {} };
      p.orchestration = { take: t };
      const composed = composeAllTracks(p, { seed: 11 });
      const tex = Object.fromEntries(composed.reports.find((r) => r.startsWith('textures'))!.split(': ')[1].split(', ').map((kv) => kv.split('='))) as Record<string, string>;
      if (Object.values(tex).every((v) => v.endsWith('PizzBass'))) {
        return { project: { ...p, tracks: composed.tracks } as Project, take: composed.orchestration.take };
      }
    }
    throw new Error('no take drew an all-pizz-bass symphony plan');
  };

  it('short pizz notes on the strong beats (1 and 3), nothing else, in an all-pizz take', () => {
    const { project, take } = composeAllPizz();
    const cb = track(project, 'cellosBasses').notes;
    expect(cb.length).toBeGreaterThan(10);
    for (const n of cb) {
      expect(n.articulation).toBe('pizz');
      // beats 1 and 3 in 4/4 — humanized attacks may sit up to one head late
      const off = n.startTick % BT;
      expect(off <= HUMANIZE_HEAD_TICKS || (off >= 2 * 960 && off <= 2 * 960 + HUMANIZE_HEAD_TICKS)).toBe(true);
      expect(n.durationTicks).toBeLessThan(960);
    }
    console.log(`symphony pizz-pulse verified on take ${take}`);
  });

  it('the sustained-bass textures really are sustained: no pizz in the cellosBasses (4.6 axis)', () => {
    let seen = false;
    for (let t = 0; t < 24 && !seen; t++) {
      const p = BASE();
      p.ensemble = { templateId: 'ensemble.symphony', overrides: {}, pins: {} };
      p.orchestration = { take: t };
      const composed = composeAllTracks(p, { seed: 11 });
      const tex = Object.fromEntries(composed.reports.find((r) => r.startsWith('textures'))!.split(': ')[1].split(', ').map((kv) => kv.split('='))) as Record<string, string>;
      if (Object.values(tex).every((v) => v.endsWith('SustainedBass'))) {
        seen = true;
        for (const n of track({ ...p, tracks: composed.tracks } as Project, 'cellosBasses').notes) {
          expect(n.articulation).toBe('legato');
        }
      }
    }
    expect(seen).toBe(true); // the sustained axis exists in the palette and lands
  });
});

describe('Vocal Backing preset (4e): wide legato only', () => {
  const { project } = compose('ensemble.vocalbacking');
  it('every string note is a sustained pad note — no lead, ostinato, tremolo or stabs', () => {
    for (const role of ['violins2', 'violas', 'cellosBasses']) {
      for (const n of track(project, role).notes) {
        expect(n.articulation).toBe('legato');
        // nothing shorter than an eighth as WRITTEN — humanize trims the
        // attack head only (start moves, end kept)
        expect(n.durationTicks).toBeGreaterThanOrEqual(480 - HUMANIZE_HEAD_TICKS);
      }
    }
  });
});

describe('Vc+Cb layering (4f, per note since 4.5): octave below where policy and range allow', () => {
  const ltPcOf = (p: Project) => leadingTonePcOf(p.key, scalePitchClasses(p.key, p.mode));

  it('symphony dorian: the Cb doubles every note that stays in range; skips are per note and reported', () => {
    const { project, result } = compose('ensemble.symphony');
    const cb = track(project, 'cellosBasses');
    const report = result.reports.find((r) => r.startsWith(`Vc+Cb layering (ensemble.symphony)`));
    expect(report).toBeTruthy();
    const m = report!.match(/(\d+)\/(\d+) notes doubled/)!;
    const doubled = Number(m[1]);
    const total = Number(m[2]);
    console.log(`Phase 4.5 report (symphony · dorian): ${report}`);
    expect(total).toBeGreaterThan(0);
    // every doubled note has its octave partner (the Cb trails its cello
    // partner by a humanize follow of a few ms — match within the head);
    // every note stays in the hard range
    const isDouble = (n: { startTick: number; pitch: number }) =>
      cb.notes.some((m) => m.pitch === n.pitch + 12 && m.startTick >= n.startTick - HUMANIZE_HEAD_TICKS && m.startTick <= n.startTick);
    expect(cb.notes.filter(isDouble).length).toBe(doubled);
    for (const n of cb.notes) {
      expect(n.pitch).toBeGreaterThanOrEqual(cb.lowestNote);
      expect(n.pitch).toBeLessThanOrEqual(cb.highestNote);
    }
    // the skipped notes really are the ones that would fall below (dorian: no leading tone)
    const lt = ltPcOf(project);
    expect(lt).toBeNull();
    const skipped = cb.notes.filter((n) => !isDouble(n) && n.pitch - 12 < cb.lowestNote).length;
    expect(total - doubled).toBe(skipped);
    expect(report).toMatch(/under the track's low E1/);
  });

  it('a leading tone is never doubled, note by note (cinematic on C Ionian)', () => {
    const p = BASE();
    p.key = 0; // C
    p.mode = 'Ionian';
    p.ensemble = { templateId: 'ensemble.cinematic', overrides: {}, pins: {} };
    const composed = composeAllTracks(p, { seed: 11 });
    const project = { ...p, tracks: composed.tracks } as Project;
    const cb = track(project, 'cellosBasses');
    const report = composed.reports.find((r) => r.startsWith('Vc+Cb layering (ensemble.cinematic)'))!;
    const doubledNotes = cb.notes.filter((n) => cb.notes.some((m) => m !== n && m.pitch === n.pitch + 12 && m.startTick >= n.startTick - HUMANIZE_HEAD_TICKS && m.startTick <= n.startTick));
    const lt = ltPcOf(project);
    expect(lt).toBe(11); // B in C Ionian
    for (const n of doubledNotes) expect(((n.pitch % 12) + 12) % 12).not.toBe(lt); // the hard rule wins per note
    console.log(`Phase 4.5 report (cinematic · C Ionian): ${report}`);
  });

  it('chamber and sonata (doubling not allowed): no same-track octave pairs in cellosBasses, reported as skipped', () => {
    for (const id of ['ensemble.chamber', 'ensemble.sonata']) {
      const { project, result } = compose(id);
      const report = result.reports.find((r) => r.startsWith(`Vc+Cb layering (${id})`));
      expect(report).toMatch(/skipped — the octaveDoubling policy is (climaxOnly|forbidden)/);
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

  it('reports the doubled/total counts per template (dorian fixture)', () => {
    for (const id of ['ensemble.symphony', 'ensemble.chamber', 'ensemble.cinematic', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.hybridstudio']) {
      const { result } = compose(id);
      const report = result.reports.find((r) => r.startsWith(`Vc+Cb layering (${id})`));
      expect(report).toBeTruthy();
      console.log(`Phase 4.5 report (dorian · ${id.slice(9)}): ${report}`);
    }
  });
});
