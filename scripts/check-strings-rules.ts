import * as fs from 'node:fs';
import * as path from 'node:path';
import { composeAllTracks } from '../src/orchestrator/compose';
import { ALL_RULES, TEMPLATES, checkRulesForTake } from '../tests/strings-rules-checker';
import type { Project } from '../src/shared/schema/project';

const loadProject = (rel: string): Project =>
  JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8')) as Project;

const projects = [
  { name: 'aeolian', proj: loadProject('google_drive/aeolian.crescode') },
  { name: 'dorian', proj: loadProject('fixtures/dorian-16bars.json') },
];

for (const { name, proj } of projects) {
  console.log(`\n=== ${name} (takes 1-10, variety: true) ===`);
  const header = ['Rule', ...TEMPLATES.map((t) => t.replace('ensemble.', ''))].join('\t');
  console.log(header);

  const totals: Record<string, Record<string, number>> = {};
  for (const r of ALL_RULES) totals[r] = {};

  for (const tpl of TEMPLATES) {
    for (const r of ALL_RULES) totals[r][tpl] = 0;
    for (let take = 1; take <= 10; take++) {
      const p: Project = {
        ...proj,
        orchestration: { ...(proj.orchestration ?? {}), templateId: tpl, take },
      };
      try {
        const composed = composeAllTracks(p, { take, variety: true });
        const res = checkRulesForTake(composed, tpl);
        for (const r of ALL_RULES) totals[r][tpl] += res[r];
      } catch {
        // Template may not apply to fixture
      }
    }
  }

  for (const r of ALL_RULES) {
    const row = [r, ...TEMPLATES.map((t) => String(totals[r][t]))].join('\t');
    console.log(row);
  }
}
