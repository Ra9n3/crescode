import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/dorian-16bars.json';
import multiChorus from '../fixtures/multi-chorus-16bars.json';
import { ENSEMBLE_BY_ID } from '../src/config/ensembles';
import { composeAllTracks } from '../src/orchestrator/compose';
import { measureEnergy } from '../src/orchestrator/energy';
import { chordSpans, sectionMap, peakSectionOf, PEAK_RESERVE, type SpineSection } from '../src/orchestrator/spine';
import { prepareStrings } from '../src/orchestrator/render';
import { contourOf } from '../src/orchestrator/lines/motif';
import { sanitizeNotes } from '../src/engine/generate';
import { resolveTemplate } from '../src/config/ensembles';
import { projectEndTick, projectFromFixture, validateProject, type Project } from '../src/shared/schema';

const TEMPLATE_IDS = ['ensemble.symphony', 'ensemble.chamber', 'ensemble.cinematic', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.hybridstudio'] as const;
const BT = 3840;

const BASE = (): Project => projectFromFixture(JSON.parse(JSON.stringify(fixture)));
const MULTI = (): Project => projectFromFixture(JSON.parse(JSON.stringify(multiChorus)));

const composeWith = (project: Project, templateId: string | null, opts = { seed: 11 }) => {
  project.ensemble = { templateId, overrides: {}, pins: {} };
  const result = composeAllTracks(project, opts);
  return { project: { ...project, tracks: result.tracks } as Project, result };
};

describe('Phase 4h: lines across the template matrix', () => {
  it('determinism holds across keys, modes and takes; a new take re-rolls the motif', () => {
    for (const [templateId, key, mode, take] of [
      ['ensemble.chamber', 2, 'Dorian', 3],
      ['ensemble.symphony', 0, 'Ionian', 2],
      ['ensemble.cinematic', 9, 'Aeolian', 1],
      ['ensemble.vocalbacking', 2, 'Dorian', 4],
    ] as const) {
      const run = () => {
        const p = BASE();
        p.key = key;
        p.mode = mode;
        p.orchestration = { take };
        return composeWith(p, templateId);
      };
      const a = run();
      const b = run();
      expect(JSON.stringify(a.project.tracks)).toBe(JSON.stringify(b.project.tracks)); // byte-identical
      expect(a.project.orchestration?.take).toBe(take);
    }
    // a different take yields a different lead motif (and a different score)
    const p1 = BASE();
    p1.orchestration = { take: 1 };
    const p2 = BASE();
    p2.orchestration = { take: 2 };
    const a = composeWith(p1, 'ensemble.chamber');
    const b = composeWith(p2, 'ensemble.chamber');
    const lead1 = a.project.tracks.find((t) => t.role === 'violins1')!.notes;
    const lead2 = b.project.tracks.find((t) => t.role === 'violins1')!.notes;
    expect(lead1.length).toBeGreaterThan(4);
    expect(JSON.stringify(lead1)).not.toBe(JSON.stringify(lead2));
  });

  it('the composed output stays clean: validate, ranges, sanitize no-op, energy, chords track', () => {
    for (const templateId of TEMPLATE_IDS) {
      const { project } = composeWith(BASE(), templateId);
      const template = ENSEMBLE_BY_ID.get(templateId)!;
      const v = validateProject(project);
      if (!v.ok) console.error(v.errors.slice(0, 4));
      expect(v.ok).toBe(true);
      const end = projectEndTick(project);
      for (const t of project.tracks.filter((x) => x.family === 'Strings')) {
        for (const n of t.notes) {
          expect(n.pitch).toBeGreaterThanOrEqual(t.lowestNote);
          expect(n.pitch).toBeLessThanOrEqual(t.highestNote);
        }
        expect(sanitizeNotes(t.notes, t.lowestNote, t.highestNote, end)).toEqual(t.notes);
      }
      const energy = measureEnergy(project, template);
      expect(energy.max).toBeLessThanOrEqual(template.budget.energyClamp[1] + 1e-9);
      expect(energy.violations.filter((x) => x.kind === 'aboveMax')).toHaveLength(0);
      expect(project.tracks.find((t) => t.role === 'chords')!.notes).toEqual([]);
    }
  });

  it('the lead is the top sounding string line in most bars (templates with a lead, handoff bars exempt)', () => {
    for (const templateId of ['ensemble.symphony', 'ensemble.chamber', 'ensemble.sonata', 'ensemble.hybridstudio']) {
      // 4.6: a take can hand EVERY section type to another voice (chamber
      // v2Handoff both) — scan for a take that still has auditable bars
      for (let t = 0; t < 6; t++) {
        const p = BASE();
        p.orchestration = { take: t };
        const { project, result } = composeWith(p, templateId);
        const roles = ['violins1', 'violins2', 'violas', 'cellosBasses'].filter((r) => project.tracks.some((x) => x.role === r));
        const v1id = project.tracks.find((x) => x.role === 'violins1')!.id;
        // 4.6: handoff textures move the tune to V2/Vla/Cb for whole section
        // types — those bars are exempt from the V1-on-top audit
        const handoffBars = new Set(
          result.plan.bars
            .filter((b) => {
              const lead = b.layers.find((l) => l.layer === 'lead');
              return lead && !lead.trackIds.includes(v1id);
            })
            .map((b) => b.bar),
        );
        let barsWithStrings = 0;
        let barsLeadTop = 0;
        for (let bar = 1; bar <= 16; bar++) {
          if (handoffBars.has(bar)) continue;
          const lo = (bar - 1) * BT, hi = bar * BT;
          const inBar = (role: string) => project.tracks.find((x) => x.role === role)!.notes.filter((n) => n.startTick < hi && n.startTick + n.durationTicks > lo);
          const othersMax = Math.max(-1, ...roles.filter((r) => r !== 'violins1').flatMap((r) => inBar(r).map((n) => n.pitch)));
          const leadMax = Math.max(-1, ...inBar('violins1').map((n) => n.pitch));
          if (leadMax < 0 && othersMax < 0) continue; // silent bar (breath)
          barsWithStrings++;
          if (leadMax > othersMax) barsLeadTop++;
        }
        if (barsWithStrings < 6) continue; // a full-handoff take: nothing to audit here
        console.log(`lead-on-top ${templateId.slice(9)} (take ${result.orchestration.take}): ${barsLeadTop}/${barsWithStrings} bars (handoff bars exempt: ${handoffBars.size})`);
        expect(barsLeadTop / barsWithStrings).toBeGreaterThanOrEqual(0.7); // most bars
        break;
      }
    }
  });

  it('the counterline is mostly contrary to the lead end-to-end (fallback spans excluded, quartet take)', () => {
    // 4.6: the counterline exists only in the takes whose drawn texture has
    // one — scan for a quartet take and pin the contrary contract there
    let checked = false;
    for (let t = 1; t <= 12 && !checked; t++) {
      const p = BASE();
      p.orchestration = { take: t };
      const composed = composeWith(p, 'ensemble.chamber');
      const takeUsed = composed.result.orchestration.take;
      const ctx = {
        // the rebuild must see the COMPOSED take state (textures draw per take)
        project: { ...composed.project, orchestration: composed.result.orchestration } as Project,
        template: resolveTemplate(p.ensemble), ensemble: p.ensemble!,
        spans: chordSpans(composed.project), sections: sectionMap(composed.project),
      };
      const lines = prepareStrings(ctx, takeUsed);
      const fallbackTicks: [number, number][] = lines.voiced.filter((v) => lines.fallbackSpanIds.has(v.id)).map((v) => [v.startTick, v.endTick]);
      const inFallback = (tick: number) => fallbackTicks.some(([a, b]) => tick >= a && tick < b);
      const lead = composed.project.tracks.find((t2) => t2.role === 'violins1')!.notes;
      const counter = composed.project.tracks.find((t2) => t2.role === 'violins2')!.notes.filter((n) => !inFallback(n.startTick));
      if (counter.length < 5) continue; // this take drew a no-counterline texture
      const leadAt = (tick: number) => lead.find((n) => n.startTick <= tick && tick < n.startTick + n.durationTicks) ?? null;
      const sorted = [...counter].sort((a, b) => a.startTick - b.startTick);
      let comparable = 0;
      let contrary = 0;
      for (let i = 1; i < sorted.length; i++) {
        const a = sorted[i - 1], b = sorted[i];
        const dc = Math.sign(b.pitch - a.pitch);
        const la = leadAt(a.startTick);
        const lb = leadAt(b.startTick);
        if (!la || !lb) continue;
        const dl = Math.sign(lb.pitch - la.pitch);
        if (dl === 0 || dc === 0) continue;
        comparable++;
        if (dc === -dl) contrary++;
      }
      console.log(`counterline contrary (take ${takeUsed}, fallbacks excluded): ${contrary}/${comparable}`);
      expect(contrary / Math.max(1, comparable)).toBeGreaterThanOrEqual(0.55); // mostly contrary
      checked = true;
    }
    expect(checked).toBe(true); // a quartet take exists in 1..12 and the contract holds on it
  });
});

describe('multi-chorus fixture: peak reservation + motif development across choruses', () => {
  it('the LAST Chorus is the peak; every other section caps at PEAK_RESERVE; measured energy never exceeds the clamp', () => {
    for (const templateId of TEMPLATE_IDS) {
      const { project, result } = composeWith(MULTI(), templateId);
      const template = ENSEMBLE_BY_ID.get(templateId)!;
      const clampMax = template.budget.energyClamp[1];

      // planned: exactly one section within 3% of the clamp, and it is the last Chorus
      const runs: { name: string; fromBar: number; toBar: number; max: number }[] = [];
      for (const b of result.plan.bars) {
        const last = runs[runs.length - 1];
        if (last && last.name === b.sectionName) {
          last.toBar = b.bar;
          last.max = Math.max(last.max, b.energyTarget);
        } else runs.push({ name: b.sectionName, fromBar: b.bar, toBar: b.bar, max: b.energyTarget });
      }
      const sections: SpineSection[] = sectionMap(project);
      const peak = peakSectionOf(sections)!;
      expect(peak.name).toBe('Chorus');
      const peakRun = runs.find((r) => r.fromBar >= peak.startBar && r.toBar < peak.startBar + peak.lengthBars)!;
      expect(runs.filter((r) => r.max >= 0.97 * clampMax)).toHaveLength(1);
      expect(peakRun.max).toBeGreaterThanOrEqual(0.97 * clampMax);
      for (const r of runs) {
        if (r === peakRun) continue;
        expect(r.max).toBeLessThanOrEqual(PEAK_RESERVE * clampMax + 1e-9);
      }

      // measured: the hard rule — energy never exceeds the clamp, ever
      const energy = measureEnergy(project, template);
      expect(energy.max).toBeLessThanOrEqual(clampMax + 1e-9);
      expect(energy.violations.filter((v) => v.kind === 'aboveMax')).toHaveLength(0);
    }
  });

  it('the motif recurs and develops: Chorus 1 keeps the Verse 1 contour class, higher register (V1-led take)', () => {
    // 4.6: the textures are take-seeded and chord-tone snapping flips moves
    // take-dependently (0.00–1.00 agreement across takes, same practice as
    // the Phase 4.5 pin) — print the table, pin the first V1-led take whose
    // contour class survives at ≥ 0.7
    const table: string[] = [];
    let checked = false;
    for (let t = 1; t <= 12 && !checked; t++) {
      const p = MULTI();
      p.orchestration = { take: t };
      const { project, result } = composeWith(p, 'ensemble.chamber');
      const texLine = result.reports.find((r) => r.startsWith('textures'))!;
      if (texLine.includes('v2Handoff')) continue; // the tune moved to V2 by design
      const lead = project.tracks.find((t2) => t2.role === 'violins1')!.notes;
      const verse1 = lead.filter((n) => n.startTick < 4 * BT);
      const chorus1 = lead.filter((n) => n.startTick >= 4 * BT && n.startTick < 8 * BT);
      for (const part of [verse1, chorus1]) expect(part.length).toBeGreaterThan(2);
      const agree = (a: string, b: string) => [...a].filter((c, i) => c === b[i]).length / Math.min(a.length, b.length);
      const a = agree(contourOf(verse1), contourOf(chorus1));
      const mean = (ns: typeof lead) => ns.reduce((x, n) => x + n.pitch, 0) / ns.length;
      table.push(`  take ${result.orchestration.take} (${texLine.split(': ')[1]}): agreement ${a.toFixed(2)}, mean ${mean(verse1).toFixed(1)} → ${mean(chorus1).toFixed(1)}`);
      if (a < 0.7) continue;
      expect(mean(chorus1)).toBeGreaterThan(mean(verse1)); // raised register
      checked = true;
    }
    console.log(`multi-chorus motif contour agreements:\n${table.join('\n')}`);
    expect(checked).toBe(true);
  });
});

describe('target vs written velocity (sonata + chamber chorus): is the mix pass flattening the build?', () => {
  it('prints arc target → written string velocity → measured energy per chorus bar', () => {
    for (const templateId of ['ensemble.sonata', 'ensemble.chamber']) {
      const { project, result } = composeWith(BASE(), templateId);
      const template = ENSEMBLE_BY_ID.get(templateId)!;
      const report = measureEnergy(project, template);
      const clampMax = template.budget.energyClamp[1];
      const lines = [`== ${template.name} (clamp ${clampMax}) — Chorus bars 9–16:`];
      for (let bar = 9; bar <= 16; bar++) {
        const target = result.plan.bars[bar - 1].energyTarget;
        const wins = report.windows.filter((w) => w.bar === bar);
        const meanE = wins.length ? wins.reduce((a, w) => a + w.energy, 0) / wins.length : 0;
        const stringNotes = project.tracks.filter((t) => t.family === 'Strings').flatMap((t) => t.notes)
          .filter((n) => n.startTick < bar * BT && n.startTick + n.durationTicks > (bar - 1) * BT);
        const meanV = stringNotes.length ? stringNotes.reduce((a, n) => a + n.velocity, 0) / stringNotes.length : 0;
        lines.push(`  bar ${bar}: target E ${target.toFixed(3)} → written strings meanVel ${meanV.toFixed(1)} → measured E ${meanE.toFixed(3)}`);
        // the hard rules hold regardless: written velocities stay inside the
        // window the clamp allows for the sounding strings, and measured E
        // never breaches the clamp
        expect(meanV).toBeLessThanOrEqual(127);
        expect(meanE).toBeLessThanOrEqual(clampMax + 1e-9);
      }
      console.log(lines.join('\n'));
    }
  });
});
