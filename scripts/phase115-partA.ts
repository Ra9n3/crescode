/**
 * Phase 11.5 Part A — the read-only survey of the vocalbacking STRINGS
 * (no src or golden change; compose only). Answers the four Part A
 * questions from the phase spec:
 *   A1. every draw that exists for vocalbacking's strings — textures,
 *       ostinato cell, voicing, rhythm, lines — with the outcome count of each;
 *   A2. the distinct REALISED string textures per section type over 20 runs
 *       (two fixtures x takes 1-10), vocalbacking vs cinematic;
 *   A3. which template constraints limit the variation (the single-texture
 *       palette, the empty moment availability, the vocal zone) and which
 *       draws exist but never fire (the eight ostinato style draws, the
 *       line draws, the moment kinds);
 *   A4. whether the low variation is intentional per the spec (the palette
 *       and availability table comments; quoted in the phase report).
 *   npx vite-node scripts/phase115-partA.ts
 */
import threeChorus from '../fixtures/three-chorus-40bars.json';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { projectFromFixture, type Project } from '../src/shared/schema';
import { barTicks } from '../src/shared/schema/meter';

const TEMPLATES = ['ensemble.vocalbacking', 'ensemble.cinematic'] as const;
type Tid = (typeof TEMPLATES)[number];

const compose = (doc: unknown, templateId: string, take: number) => {
  const p: Project = projectFromFixture(JSON.parse(JSON.stringify(doc)));
  p.ensemble = { templateId, overrides: {}, pins: {} };
  p.orchestration = { take };
  const result = composeAllTracks(p, { seed: 11 });
  return { project: { ...p, tracks: result.tracks, orchestration: result.orchestration } as Project, result };
};

const sectionsOf = (doc: unknown): { name: string; startBar: number; lengthBars: number; startTick: number; endTick: number }[] => {
  const bt = 480; // both fixtures are 4/4
  return (doc as { sections: { name: string; startBar: number; lengthBars: number }[] }).sections.map((s) => ({
    ...s,
    startTick: (s.startBar - 1) * bt,
    endTick: (s.startBar - 1 + s.lengthBars) * bt,
  }));
};

/* ---- A1: the static draw inventory (read from the module tables) -------- */
console.log('=== A1. the draw inventory for the vocalbacking strings (code tables) ===');
console.log(`texture palette      : 1 outcome  — padBed (weight 1; plan {} = every string voice on pad, wide legato)`);
console.log(`ostinato style draws : consumed per section type after the pick, never read by a pad —`);
console.log(`  shape              : 3 outcomes  (repeat / arpeggio / rootFifth)`);
console.log(`  enterAfter         : 2 outcomes  (1|2 bars before the ostinato enters)`);
console.log(`  ostinato track     : 2 outcomes  (violins2 / violas)`);
console.log(`  rhythm cell        : 5 outcomes  (straight 30 / syncopated 20 / gallop 12 / offBeat 18 / sparse 20)`);
console.log(`  contour            : 4 outcomes  (ascending / descending / pingPong / pedal — 25 each)`);
console.log(`  accent             : 3 outcomes  (downbeat 40 / offBeat 30 / flat 30)`);
console.log(`  density            : 2 outcomes  (rise 55 / dip 45)`);
console.log(`  pairing            : 2 outcomes  (interlock 55 / hocket 45; reported 'unison' for padBed)`);
console.log(`voicing (the DP)     : continuous seeded jitter — roundRng(seed, round) tie-breaks per candidate,`);
console.log(`                       per-voice base leans (+-5), take jitter (+-0.5 cost); outcomes = pitch tuples`);
console.log(`lines (motif)        : drawn only for a tune carrier — the padBed plan names none: never invoked`);
console.log(`lines (counterline)  : drawn only where a texture plans 'counterline' — padBed plans none: never invoked`);
console.log(`moments              : availability table ['ensemble.vocalbacking'] = [] — no kind draws at all`);
console.log(`ostinato (rhythm)    : the padBed plan has no ostinato layer — the cell never renders`);

/* ---- A2: the realised textures over 20 runs ------------------------------ */
console.log('\n=== A2. distinct realised string textures per section type (20 runs = 2 fixtures x takes 1-10) ===');
console.log('a run realises a texture when it sounds the section: texture id (+ the drawn ostinato style where one');
console.log('exists) + the moment kinds covering the section\'s bars; the pitch-palette column counts the DP\'s distinct');
console.log('voicings inside the SAME pad texture (per-track unique pitch sets of the section\'s notes).');

interface Row { tex: string; style: string; momentKinds: string; }
const byType = new Map<string, { template: Tid; texRows: Map<string, number>; pitchPalettes: Set<string> }>();

for (const templateId of TEMPLATES) {
  for (const [tag, doc] of [['three', threeChorus], ['dorian', dorian]] as const) {
    const secs = sectionsOf(doc);
    for (let take = 1; take <= 10; take++) {
      const { project, result } = compose(doc, templateId, take);
      const bt = barTicks(project.timeSignature);
      // the drawn texture id + ostinato style per section type, from the plan reports
      const texLine = result.reports.find((l) => l.startsWith('textures (take ')) ?? '';
      const styleRep = result.reports.find((l) => l.startsWith('ostinato style (take ')) ?? '';
      const texOf = new Map<string, string>();
      for (const pair of texLine.replace(/^textures \(take \d+\): /, '').split(', ')) {
        const [k, v] = pair.split('=');
        if (k && v) texOf.set(k, v);
      }
      const styleOf = new Map<string, string>();
      if (styleRep) {
        for (const pair of styleRep.replace(/^ostinato style \(take \d+\): /, '').split(', ')) {
          const [k, v] = pair.split('=');
          if (k && v) styleOf.set(k, v);
        }
      }
      const moments = result.plan.moments ?? [];
      const stringsTracks = project.tracks.filter((t) => t.family === 'Strings');
      for (const sec of secs) {
        const type = sec.name.trim().toLowerCase();
        const tex = texOf.get(type) ?? 'padBed';
        const style = styleOf.get(type) ?? 'none';
        const kinds = moments
          .filter((m) => m.startBar <= sec.startBar + sec.lengthBars - 1 && m.endBar >= sec.startBar)
          .map((m) => m.kind)
          .sort()
          .join('+') || '—';
        const key = `${templateId}|${type}`;
        if (!byType.has(key)) byType.set(key, { template: templateId as Tid, texRows: new Map(), pitchPalettes: new Set() });
        const row = byType.get(key)!;
        const texKey = `${tex}${style !== 'none' ? ` [${style}]` : ''}${kinds !== '—' ? ` +${kinds}` : ''}`;
        row.texRows.set(texKey, (row.texRows.get(texKey) ?? 0) + 1);
        // the realised pitch palette: per-track unique pitches sounding inside the section
        const pal: Record<string, number[]> = {};
        for (const t of stringsTracks) {
          const pitches = [...new Set((t.notes ?? []).filter((n) => n.startTick >= sec.startTick && n.startTick < sec.endTick).map((n) => n.pitch))].sort((a, b) => a - b);
          if (pitches.length) pal[t.role] = pitches;
        }
        row.pitchPalettes.add(JSON.stringify(pal));
      }
    }
  }
}

for (const templateId of TEMPLATES) {
  console.log(`\n${templateId}:`);
  for (const [key, row] of [...byType.entries()].filter(([k]) => k.startsWith(templateId)).sort()) {
    const type = key.split('|')[1];
    const distinct = row.texRows.size;
    const total = [...row.texRows.values()].reduce((a, b) => a + b, 0);
    const detail = [...row.texRows.entries()].map(([k, v]) => `${k} x${v}`).join(' | ');
    console.log(`  ${type.padEnd(8)} distinct realised textures ${distinct}/${total}   distinct pitch palettes ${row.pitchPalettes.size}/${total}`);
    if (distinct > 1) console.log(`      ${detail}`);
  }
}

/* ---- A3: the constraint summary (computed facts, quoted in the report) --- */
console.log('\n=== A3. the constraints and the never-firing draws (vocalbacking) ===');
{
  // verify from the runs: the pad is the only rendered layer family, nothing shorter than an eighth exists,
  // and no string note sits inside the vocal zone
  let shortest = Infinity;
  let zoneNotes = 0;
  let layers = new Set<string>();
  for (const templateId of ['ensemble.vocalbacking'] as const) {
    for (const [tag, doc] of [['three', threeChorus], ['dorian', dorian]] as const) {
      for (let take = 1; take <= 10; take++) {
        const { project, result } = compose(doc, templateId, take);
        const bt = barTicks(project.timeSignature);
        for (const t of project.tracks.filter((x) => x.family === 'Strings')) {
          for (const n of t.notes ?? []) {
            shortest = Math.min(shortest, n.durationTicks);
            if (n.pitch >= 57 && n.pitch <= 81) zoneNotes++;
            layers.add(n.articulation ?? '(none)');
          }
        }
        void result; void bt;
      }
    }
  }
  console.log(`observed over 20 runs: shortest string note ${shortest} ticks (an eighth = 240), zone notes ${zoneNotes}, articulations ${JSON.stringify([...layers].sort())}`);
  console.log(`limits: the palette holds ONE texture (padBed, weight 1); the moment availability table is empty;`);
  console.log(`the DP is zone-free (57-81) with open spacing and an eighth duration floor; the clamp shapes velocities only.`);
  console.log(`never fire: the eight ostinato style draws (shape, enterAfter, ost track, cell, contour, accent, density,`);
  console.log(`pairing), the motif and counterline line draws, and every moment kind.`);
}
