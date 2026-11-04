/* Phase 4.8 report generator: the pattern table for takes 1..10 + measured counts. */
import fixture from '../fixtures/dorian-16bars.json';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { sectionTypeKeyOf, textureForType } from '../src/orchestrator/conductor/layers';
import { cellGrid } from '../src/orchestrator/lines/ostinato';
import { beatTicks } from '../src/shared/schema/meter';
import { chordSpans, sectionMap, energyCurve } from '../src/orchestrator/spine';
import { resolveTemplate } from '../src/config/ensembles';
import { projectFromFixture, type Project } from '../src/shared/schema';

const BASE = (): Project => projectFromFixture(JSON.parse(JSON.stringify(fixture)));
const THREE = (): Project => projectFromFixture(JSON.parse(JSON.stringify(threeChorus)));

const composeTake = (project: Project, templateId: string, take: number) => {
  project.ensemble = { templateId, overrides: {}, pins: {} };
  project.orchestration = { take };
  const result = composeAllTracks(project, { seed: 11 });
  return { project: { ...project, tracks: result.tracks, orchestration: result.orchestration } as Project, result };
};

const textureCtx = (project: Project) => {
  const template = resolveTemplate(project.ensemble)!;
  const arc = energyCurve(project, sectionMap(project), project.orchestration!.take, template, true);
  return { project, template, ensemble: project.ensemble!, spans: chordSpans(project), sections: sectionMap(project), arc };
};

const OST_TEX = new Set(['singleOstinato', 'interlockingOstinato', 'pizzPulse', 'trailer']);
const isOst = (a: string | undefined) => a === 'spiccato' || a === 'pizz';

/* --- takes 1..10 pattern table (three-chorus cinematic: verse + chorus rows) --- */
console.log('PATTERN TABLE — three-chorus cinematic, takes 1..10 (result takes)');
console.log('| take | section | texture | cell | contour | accent | density | pairing |');
console.log('|---|---|---|---|---|---|---|---|');
const BAR = 3840;
for (let input = 0; input < 10; input++) {
  const { project, result } = composeTake(THREE(), 'ensemble.cinematic', input);
  const ctx = textureCtx(project);
  const types = [...new Set(ctx.sections.map((s) => sectionTypeKeyOf(s.name)))];
  for (const type of types) {
    const tex = textureForType(ctx, type);
    if (!OST_TEX.has(tex.id)) continue;
    const s = tex.style;
    // observed onsets per bar of this section type (top ostinato track or the solo one)
    const secs = sectionMap(project).filter((sec) => sectionTypeKeyOf(sec.name) === type);
    let minBar = Infinity;
    let maxBar = -Infinity;
    for (const sec of secs) {
      for (let b = sec.startBar; b < sec.startBar + sec.lengthBars; b++) {
        const n = project.tracks.find((t) => t.role === 'violins2')!.notes.filter((x) => isOst(x.articulation) && x.startTick >= (b - 1) * BAR && x.startTick < b * BAR).length
          + project.tracks.find((t) => t.role === 'violas')!.notes.filter((x) => isOst(x.articulation) && x.startTick >= (b - 1) * BAR && x.startTick < b * BAR).length;
        if (n > 0) { minBar = Math.min(minBar, b); maxBar = Math.max(maxBar, b); }
      }
    }
    const densityObs = minBar === Infinity ? 'silent' : `${minBar}-${maxBar}`;
    console.log(`| ${result.orchestration.take} | ${type} | ${tex.id} | ${s.cell} | ${s.contour} | ${s.accent} | ${s.density} | ${s.pairing} |`);
    void densityObs;
  }
}

/* --- measured counts across 40 takes, both fixtures --- */
for (const [label, mk] of [['dorian', BASE], ['three-chorus', THREE]] as const) {
  const cells = new Map<string, number>();
  const contours = new Map<string, number>();
  const accents = new Map<string, number>();
  const densities = new Map<string, number>();
  const pairings = new Map<string, number>();
  let draws = 0;
  let hocketBars = 0;
  let thinBars = 0;
  let fullBars = 0;
  for (let t = 0; t < 40; t++) {
    const { project } = composeTake(mk(), 'ensemble.cinematic', t);
    const ctx = textureCtx(project);
    const types = [...new Set(ctx.sections.map((s) => sectionTypeKeyOf(s.name)))];
    for (const type of types) {
      const tex = textureForType(ctx, type);
      if (!OST_TEX.has(tex.id)) continue;
      const s = tex.style;
      draws++;
      cells.set(s.cell, (cells.get(s.cell) ?? 0) + 1);
      contours.set(s.contour, (contours.get(s.contour) ?? 0) + 1);
      accents.set(s.accent, (accents.get(s.accent) ?? 0) + 1);
      densities.set(s.density, (densities.get(s.density) ?? 0) + 1);
      pairings.set(s.pairing, (pairings.get(s.pairing) ?? 0) + 1);
      if (tex.id !== 'interlockingOstinato') continue;
      const grid = cellGrid(project.timeSignature, s.cell, s.rate);
      const beat = beatTicks(project.timeSignature);
      const slot = Math.floor(beat / grid.perBeat);
      void slot;
      for (const sec of sectionMap(project).filter((x) => sectionTypeKeyOf(x.name) === type)) {
        for (let b = sec.startBar; b < sec.startBar + sec.lengthBars; b++) {
          const count = (role: string) => project.tracks.find((tr) => tr.role === role)!.notes.filter((x) => isOst(x.articulation) && x.startTick >= (b - 1) * BAR && x.startTick < b * BAR).length;
          const v2 = count('violins2');
          const vla = count('violas');
          if (v2 === 0 && vla === 0) continue;
          if (s.pairing === 'hocket') hocketBars++;
          else if (vla === 0) thinBars++;
          else fullBars++;
        }
      }
    }
  }
  const fmt = (m: Map<string, number>) => [...m.entries()].map(([k, v]) => `${k}=${v}`).join(', ');
  console.log(`\n[${label}] ostinato style draws: ${draws}`);
  console.log(`  cells:     ${fmt(cells)}`);
  console.log(`  contours:  ${fmt(contours)}`);
  console.log(`  accents:   ${fmt(accents)}`);
  console.log(`  densities: ${fmt(densities)}`);
  console.log(`  pairings:  ${fmt(pairings)}`);
  console.log(`  two-track bars: ${hocketBars} hocketed, ${thinBars} density-thin, ${fullBars} density-full`);
}
