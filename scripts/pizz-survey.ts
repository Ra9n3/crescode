/**
 * 4.8 review survey: texture distribution over many takes, per section type.
 *   npx vite-node scripts/pizz-survey.ts [takes] [templateId] [fixture]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { composeAllTracks } from '../src/orchestrator/compose';
import { projectFromFixture, type Project } from '../src/shared/schema';

const here = path.dirname(fileURLToPath(import.meta.url));
const takeArg = parseInt(process.argv[2] ?? '400', 10);
const templateId = process.argv[3] ?? 'ensemble.cinematic';
const fixtureFile = process.argv[4] ?? path.join(here, '..', 'fixtures', 'three-chorus-40bars.json');

const mk = (): Project => projectFromFixture(JSON.parse(readFileSync(fixtureFile, 'utf8')));

const counts: Record<string, Record<string, number>> = {};
const takes: number[] = [];
for (let t = 0; t < takeArg; t++) {
  const project = mk();
  project.ensemble = { templateId, overrides: {}, pins: {} };
  project.orchestration = { take: t };
  const result = composeAllTracks(project, { seed: 11 });
  takes.push(result.orchestration.take);
  const line = result.reports.find((r) => r.startsWith('textures'));
  if (!line) continue;
  for (const kv of line.split(': ')[1].split(', ')) {
    const [type, id] = kv.split('=');
    counts[type] ??= {};
    counts[type][id] = (counts[type][id] ?? 0) + 1;
  }
}
const total = Math.max(1, takes.length);
console.log(`takes ${total} (orchestration.take ${Math.min(...takes)}..${Math.max(...takes)}), template ${templateId}`);
for (const [type, byId] of Object.entries(counts)) {
  const sum = Object.values(byId).reduce((a, b) => a + b, 0);
  const parts = Object.entries(byId).sort((a, b) => b[1] - a[1]).map(([id, n]) => `${id} ${n} (${((100 * n) / sum).toFixed(1)}%)`);
  console.log(`${type}: n=${sum} | ${parts.join(' · ')}`);
}
