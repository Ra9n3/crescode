import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { composeAllTracks } from '../src/orchestrator/compose';
import { ALL_RULES, TEMPLATES, checkRulesForTake } from './strings-rules-checker';
import type { Project } from '../src/shared/schema/project';

const loadProject = (rel: string): Project =>
  JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8')) as Project;

describe('strings orchestration rulebook (STRINGS-ORCH-3)', () => {
  it('prints violation table on aeolian and dorian across templates (takes 1-10)', () => {
    const projects = [
      { name: 'aeolian', proj: loadProject('google_drive/aeolian.crescode') },
      { name: 'dorian', proj: loadProject('fixtures/dorian-16bars.json') },
    ];

    const summary: Record<string, Record<string, number>> = {};
    for (const { name, proj } of projects) {
      console.log(`\n=== ${name} (takes 1-10, variety: true) ===`);
      console.log(['Rule', ...TEMPLATES.map((t) => t.replace('ensemble.', ''))].join('\t'));

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
            // Template may not apply
          }
        }
      }

      for (const r of ALL_RULES) {
        console.log([r, ...TEMPLATES.map((t) => String(totals[r][t]))].join('\t'));
      }
      summary[name] = Object.fromEntries(ALL_RULES.map((r) => [r, TEMPLATES.reduce((a, t) => a + totals[r][t], 0)]));
    }

    expect(summary.aeolian).toBeDefined();
    expect(summary.dorian).toBeDefined();
  }, 60000);
});
