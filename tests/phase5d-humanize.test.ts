import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/dorian-16bars.json';
import { ENSEMBLE_BY_ID, resolveTemplate } from '../src/config/ensembles';
import { composeAllTracks } from '../src/orchestrator/compose';
import { BASS_TIMING_MS, CB_FOLLOW_MAX_MS, TIMING_JITTER_MS, VELOCITY_JITTER, VIOLIN_TIMING_MS, humanizeStrings } from '../src/orchestrator/expression/humanize';
import { maxMeanVelocityFor, measureEnergy } from '../src/orchestrator/energy';
import { stringsModule, stringVoiceTracks, prepareStrings, maybeLayerCellosBasses } from '../src/orchestrator/render';
import { chordSpans, sectionMap, energyCurve, orchestrationSeedFor, ticksToMs } from '../src/orchestrator/spine';
import { sanitizeNotes } from '../src/engine/generate';
import { projectEndTick, projectFromFixture, validateProject, type Project } from '../src/shared/schema';
import type { Note } from '../src/shared/schema/types';
import type { OrchestratorContext } from '../src/orchestrator/module';

/**
 * Phase 5d — humanize (notes), deterministic per D8:
 *   - timing: POSITIVE offsets, correlated within a section (per-section base
 *     + small per-note jitter), violins/violas +5..18 ms, cellosBasses
 *     +12..28 ms through the tempo map; the START only (ends kept);
 *     Cb doubles trail their cello partner by a few ms; tremolo takes the
 *     section base without per-note jitter;
 *   - velocity: a small jitter that never lifts a note above the governor
 *     cap of its windows;
 *   - the clamp still holds after humanize (the mix governor re-runs);
 *   - sanitizeNotes is a no-op on the composed result, validateProject passes.
 */
const BASE = (): Project => projectFromFixture(JSON.parse(JSON.stringify(fixture)));

/** Rebuilds the PRE-humanize strings notes exactly the way compose does. */
const preHumanizeStrings = (project: Project, templateId: string, take: number) => {
  project.ensemble = { templateId, overrides: {}, pins: {} };
  const orchestration = { take };
  const template = resolveTemplate(project.ensemble)!;
  const ctx: OrchestratorContext = {
    project: { ...project, orchestration }, template, ensemble: project.ensemble!,
    spans: chordSpans(project), sections: sectionMap(project),
  };
  const seed = orchestrationSeedFor(project, orchestration);
  const voiceTracks = stringVoiceTracks(ctx);
  const arc = energyCurve(project, ctx.sections, take, template, true);
  ctx.arc = arc;
  ctx.lines = prepareStrings(ctx, take);
  const plans = stringsModule.roles(ctx).map((pl) => ({ ...pl, breathByTrack: {} }));
  const notesByTrackId: Record<string, Note[]> = {};
  for (const t of voiceTracks) notesByTrackId[t.id] = [];
  for (const pl of plans) {
    const patch = stringsModule.render(ctx, pl, seed);
    for (const [id, notes] of Object.entries(patch.notesByTrackId)) {
      notesByTrackId[id] = [...(notesByTrackId[id] ?? []), ...notes];
    }
  }
  maybeLayerCellosBasses(ctx, notesByTrackId, voiceTracks.map((t) => t.id));
  return { notesByTrackId, ctx, arc, template, voiceTrackIds: voiceTracks.map((t) => t.id) };
};

/** The offset a composed note carries, in ms through the tempo map. */
const offsetMs = (project: Project, before: number, after: number): number =>
  ticksToMs(after, project.tempoMap) - ticksToMs(before, project.tempoMap);

/** One tick in ms — the quantization an ms offset picks up when it lands on ticks. */
const tickMs = (project: Project): number => ticksToMs(1, project.tempoMap);

describe('Phase 5d (1): timing offsets are positive, in-range, correlated, ends kept', () => {
  it('every offset lands in its role range (violins/violas +5..18 ms, bass +12..28 ms), ends never move', () => {
    for (const templateId of ['ensemble.symphony', 'ensemble.chamber', 'ensemble.cinematic']) {
      const p = BASE();
      const pre = preHumanizeStrings(p, templateId, 0);
      const humanized = humanizeStrings({
        project: pre.ctx.project, template: pre.template, sections: pre.ctx.sections, notesByTrackId: pre.notesByTrackId,
      });
      const roleOf = new Map(p.tracks.map((t) => [t.id, t.role]));
      for (const [id, notes] of Object.entries(humanized)) {
        const role = roleOf.get(id)!;
        const range = role === 'cellosBasses' ? BASS_TIMING_MS : VIOLIN_TIMING_MS;
        // a Cb double carries its partner's offset plus the follow — its own
        // offset may legitimately reach past the bass range top by the follow
        const isDoubleBefore = (b: Note) => role === 'cellosBasses'
          && pre.notesByTrackId[id].some((m) => m !== b && m.pitch === b.pitch + 12 && m.startTick === b.startTick);
        // match by (pitch, end) — humanize keeps both; the pool makes each
        // before-note match at most once (sanitize may drop exact duplicates)
        const pool = new Map<string, Note[]>();
        for (const b of pre.notesByTrackId[id]) {
          const k = `${b.pitch}:${b.startTick + b.durationTicks}`;
          (pool.get(k) ?? pool.set(k, []).get(k)!).push(b);
        }
        for (const a of notes) {
          const k = `${a.pitch}:${a.startTick + a.durationTicks}`;
          const b = pool.get(k)?.shift();
          expect(b, `no pre-humanize note matches ${k}`).toBeTruthy();
          expect(a.pitch).toBe(b!.pitch); // pitch untouched
          expect(a.startTick + a.durationTicks).toBe(b!.startTick + b!.durationTicks); // END kept
          const ms = offsetMs(p, b!.startTick, a.startTick);
          const q = tickMs(p); // the tick quantization of the drawn offset
          const top = range[1] + (isDoubleBefore(b!) ? CB_FOLLOW_MAX_MS : 0);
          expect(ms).toBeGreaterThanOrEqual(range[0] - q - 1e-6);
          expect(ms).toBeLessThanOrEqual(top + q + 1e-6);
          expect(a.durationTicks).toBeGreaterThanOrEqual(1); // never zero-length
        }
      }
    }
  });

  it('offsets correlate within a section: the per-note jitter stays within ±TIMING_JITTER_MS of the section base', () => {
    const p = BASE();
    const pre = preHumanizeStrings(p, 'ensemble.chamber', 0);
    const humanized = humanizeStrings({
      project: pre.ctx.project, template: pre.template, sections: pre.ctx.sections, notesByTrackId: pre.notesByTrackId,
    });
    const bt = 3840;
    const secOf = (tick: number) => (tick < 8 * bt ? 0 : 1);
    for (const [id, notes] of Object.entries(humanized)) {
      // match by (pitch, end) as in the range test
      const pool = new Map<string, Note[]>();
      for (const b of pre.notesByTrackId[id]) {
        const k = `${b.pitch}:${b.startTick + b.durationTicks}`;
        (pool.get(k) ?? pool.set(k, []).get(k)!).push(b);
      }
      const perSection: Record<number, number[]> = {};
      for (const a of notes) {
        const b = pool.get(`${a.pitch}:${a.startTick + a.durationTicks}`)?.shift();
        if (!b) continue;
        const ms = offsetMs(p, b.startTick, a.startTick);
        (perSection[secOf(b.startTick)] ??= []).push(ms);
      }
      for (const offsets of Object.values(perSection)) {
        // the per-section base plus a ±TIMING_JITTER_MS draw: the SPREAD of
        // the offsets within one section is bounded by twice the jitter
        // (plus the tick quantization of two rounded offsets)
        const spread = Math.max(...offsets) - Math.min(...offsets);
        expect(spread).toBeLessThanOrEqual(2 * TIMING_JITTER_MS + 2 * tickMs(p) + 1e-6);
      }
    }
  });

  it('tremolo notes take the section base only: every tremolo note in a section carries the SAME offset', () => {
    // find a cinematic take with tremolo bars
    let done = false;
    for (let take = 0; take < 24 && !done; take++) {
      const p = BASE();
      const pre = preHumanizeStrings(p, 'ensemble.cinematic', take);
      const trem = pre.notesByTrackId[pre.voiceTrackIds.find((id) => p.tracks.find((t) => t.id === id)?.role === 'violins1')!]
        ?.filter((n) => n.articulation === 'tremolo') ?? [];
      if (trem.length < 10) continue;
      done = true;
      const humanized = humanizeStrings({
        project: pre.ctx.project, template: pre.template, sections: pre.ctx.sections, notesByTrackId: pre.notesByTrackId,
      });
      const v1id = pre.voiceTrackIds.find((id) => p.tracks.find((t) => t.id === id)?.role === 'violins1')!;
      const before = [...pre.notesByTrackId[v1id]].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
      const after = humanized[v1id];
      const offsets = new Set<number>();
      for (let i = 0; i < before.length; i++) {
        if (before[i].articulation !== 'tremolo') continue;
        offsets.add(Math.round(offsetMs(p, before[i].startTick, after[i].startTick) * 1000) / 1000);
      }
      expect(offsets.size).toBe(1); // one base, zero jitter
    }
    expect(done).toBe(true);
  });

  it('Cb doubles trail their cello partner by 1..CB_FOLLOW_MAX_MS ms', () => {
    const p = BASE();
    const pre = preHumanizeStrings(p, 'ensemble.symphony', 0); // policy 'allowed': doubles exist
    const humanized = humanizeStrings({
      project: pre.ctx.project, template: pre.template, sections: pre.ctx.sections, notesByTrackId: pre.notesByTrackId,
    });
    const cbId = pre.voiceTrackIds.find((id) => p.tracks.find((t) => t.id === id)?.role === 'cellosBasses')!;
    const pool = new Map<string, Note[]>();
    for (const b of pre.notesByTrackId[cbId]) {
      const k = `${b.pitch}:${b.startTick + b.durationTicks}`;
      (pool.get(k) ?? pool.set(k, []).get(k)!).push(b);
    }
    const beforeOf = (a: Note): Note | undefined => pool.get(`${a.pitch}:${a.startTick + a.durationTicks}`)?.shift();
    const after = humanized[cbId];
    let checked = 0;
    for (const a of after) {
      const me = beforeOf(a);
      if (!me) continue;
      // my partner: the pre note one octave up starting at my written tick
      const partnerBefore = pre.notesByTrackId[cbId].find((m) => m !== me && m.pitch === me.pitch + 12 && m.startTick === me.startTick);
      if (!partnerBefore) continue;
      const partnerAfter = after.find((m) => m.pitch === partnerBefore.pitch && m.startTick + m.durationTicks === partnerBefore.startTick + partnerBefore.durationTicks
        && m.startTick >= partnerBefore.startTick);
      if (!partnerAfter) continue;
      const follow = offsetMs(p, partnerAfter.startTick, a.startTick); // double start − partner start
      expect(follow).toBeGreaterThan(0);
      expect(follow).toBeLessThanOrEqual(CB_FOLLOW_MAX_MS + 2 * tickMs(p) + 1e-6); // + rounding
      checked++;
    }
    expect(checked).toBeGreaterThan(0); // the symphony really doubled something here
  });
});

describe('Phase 5d (2): velocity jitter is cap-safe and the clamp still holds', () => {
  it('a dense window never gains velocity above the governor cap (unit)', () => {
    const p = BASE();
    p.ensemble = { templateId: 'ensemble.chamber', overrides: {}, pins: {} };
    p.orchestration = { take: 0 };
    const template = resolveTemplate(p.ensemble)!;
    const ids = ['violins1', 'violins2', 'violas', 'cellosBasses'].map((r) => p.tracks.find((t) => t.role === r)!.id);
    const notesByTrackId: Record<string, Note[]> = Object.fromEntries(ids.map((id) => [id, [{
      pitch: 60, startTick: 0, durationTicks: 3840, velocity: 90, articulation: 'legato' as const,
    }]]));
    // a fifth roster role sounds in the same window (the piano)
    const piano = p.tracks.find((t) => t.role === 'piano')!;
    const otherNotes = [{ role: 'piano', notes: [{ pitch: 48, startTick: 0, durationTicks: 3840, velocity: 90 }] }];
    void piano;
    const humanized = humanizeStrings({ project: p, template, sections: sectionMap(p), notesByTrackId, otherNotes });
    // five roster roles sound (4 strings + piano? chamber roster counts) — every
    // humanized velocity stays at or below the cap for the window's role count
    const roles = 5; // chamber roster size
    const cap = maxMeanVelocityFor(template.roster.length, template.budget.energyClamp[1], roles);
    for (const id of ids) {
      for (const n of humanized[id]) {
        expect(n.velocity).toBeLessThanOrEqual(cap);
        expect(n.velocity).toBeGreaterThanOrEqual(90 - VELOCITY_JITTER); // small jitter, both ways
        expect(n.velocity).toBeLessThanOrEqual(90 + VELOCITY_JITTER);
      }
    }
  });

  it('after humanize the mix governor re-runs: measureEnergy <= clamp on all six templates', () => {
    for (const templateId of ['ensemble.symphony', 'ensemble.chamber', 'ensemble.cinematic', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.hybridstudio']) {
      const p = BASE();
      p.ensemble = { templateId, overrides: {}, pins: {} };
      p.orchestration = { take: 3 };
      const result = composeAllTracks(p, { seed: 11 });
      const project = { ...p, tracks: result.tracks } as Project;
      const template = ENSEMBLE_BY_ID.get(templateId)!;
      const energy = measureEnergy(project, template);
      expect(energy.max).toBeLessThanOrEqual(template.budget.energyClamp[1] + 1e-9);
      expect(energy.violations.filter((v) => v.kind === 'aboveMax')).toHaveLength(0);
    }
  });
});

describe('Phase 5d (3): engine invariants on the humanized score', () => {
  it('sanitizeNotes is a no-op, validateProject passes, nothing starts before 0 or ends past the project end', () => {
    for (const templateId of ['ensemble.symphony', 'ensemble.cinematic', 'ensemble.vocalbacking']) {
      const p = BASE();
      p.ensemble = { templateId, overrides: {}, pins: {} };
      p.orchestration = { take: 2 };
      const result = composeAllTracks(p, { seed: 11 });
      const project = { ...p, tracks: result.tracks } as Project;
      expect(validateProject(project).ok).toBe(true);
      const end = projectEndTick(project);
      for (const t of project.tracks.filter((x) => x.family === 'Strings' && x.notes.length)) {
        expect(sanitizeNotes(t.notes, t.lowestNote, t.highestNote, end)).toEqual(t.notes);
        for (const n of t.notes) {
          expect(n.startTick).toBeGreaterThanOrEqual(0);
          expect(n.startTick + n.durationTicks).toBeLessThanOrEqual(end);
        }
      }
    }
  });

  it('the same take humanizes byte-identically', () => {
    for (const take of [0, 4]) {
      const a = (() => {
        const p = BASE();
        const pre = preHumanizeStrings(p, 'ensemble.cinematic', take);
        return JSON.stringify(humanizeStrings({ project: pre.ctx.project, template: pre.template, sections: pre.ctx.sections, notesByTrackId: pre.notesByTrackId }));
      })();
      const b = (() => {
        const p = BASE();
        const pre = preHumanizeStrings(p, 'ensemble.cinematic', take);
        return JSON.stringify(humanizeStrings({ project: pre.ctx.project, template: pre.template, sections: pre.ctx.sections, notesByTrackId: pre.notesByTrackId }));
      })();
      expect(a).toBe(b);
    }
  });
});

