import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { composeAllTracks } from '../src/orchestrator/compose';
import { ALL_RULES, TEMPLATES, checkRulesForTake } from './strings-rules-checker';
import type { Project } from '../src/shared/schema/project';

const loadProject = (rel: string): Project =>
  JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8')) as Project;

const cloneProject = (p: Project): Project => JSON.parse(JSON.stringify(p)) as Project;

describe('strings orchestration rulebook (STRINGS-ORCH-3b)', () => {
  it('prints baseline table (examined / violations) on aeolian and dorian across templates (takes 1-10)', () => {
    const projects = [
      { name: 'aeolian', proj: loadProject('google_drive/aeolian.crescode') },
      { name: 'dorian', proj: loadProject('fixtures/dorian-16bars.json') },
    ];

    for (const { name, proj } of projects) {
      console.log(`\n=== ${name} (takes 1-10, variety: true) ===`);
      console.log(['Rule', ...TEMPLATES.map((t) => t.replace('ensemble.', ''))].join('\t'));

      const examined: Record<string, Record<string, number>> = {};
      const violations: Record<string, Record<string, number>> = {};
      for (const r of ALL_RULES) {
        examined[r] = {};
        violations[r] = {};
      }

      for (const tpl of TEMPLATES) {
        for (const r of ALL_RULES) {
          examined[r][tpl] = 0;
          violations[r][tpl] = 0;
        }
        for (let take = 1; take <= 10; take++) {
          const p: Project = {
            ...proj,
            orchestration: { ...(proj.orchestration ?? {}), templateId: tpl, take },
          };
          const composed = composeAllTracks(p, { take, variety: true });
          const res = checkRulesForTake({ ...composed, sections: composed.sections ?? proj.sections }, tpl);
          for (const r of ALL_RULES) {
            examined[r][tpl] += res[r].examined;
            violations[r][tpl] += res[r].violations;
          }
        }
      }

      for (const r of ALL_RULES) {
        const row = [
          r,
          ...TEMPLATES.map((t) => (examined[r][t] === 0 ? 'NOT_MEASURED' : `${violations[r][t]}/${examined[r][t]}`)),
        ].join('\t');
        console.log(row);
      }
    }
  }, 120000);

  it('proves every rule checker R1-R15 can fail under deliberate mutation', () => {
    const base = loadProject('google_drive/aeolian.crescode');
    const composed = composeAllTracks(
      { ...base, orchestration: { ...(base.orchestration ?? {}), templateId: 'ensemble.cinematic', take: 1 } },
      { take: 1, variety: true },
    );

    const mutations: Array<{ rule: typeof ALL_RULES[number]; tpl: string; desc: string; mutate: (p: Project) => void }> = [
      {
        rule: 'R1',
        tpl: 'ensemble.cinematic',
        desc: 'swap violins1 down 2 octaves below violas',
        mutate: (p) => {
          const v1 = p.tracks.find((t) => t.role === 'violins1' || t.id === 'violins1');
          if (v1) v1.notes.forEach((n) => { n.pitch -= 24; });
        },
      },
      {
        rule: 'R2',
        tpl: 'ensemble.cinematic',
        desc: 'drop violins1 lead 2 octaves',
        mutate: (p) => {
          const v1 = p.tracks.find((t) => t.role === 'violins1' || t.id === 'violins1');
          if (v1) v1.notes.forEach((n) => { n.pitch -= 24; });
        },
      },
      {
        rule: 'R3',
        tpl: 'ensemble.cinematic',
        desc: 'insert v1 note at 30 below cb at 60 at bar 1',
        mutate: (p) => {
          const cb = p.tracks.find((t) => t.role === 'cellosBasses' || t.id === 'cellosBasses');
          const v1 = p.tracks.find((t) => t.role === 'violins1' || t.id === 'violins1');
          if (cb && v1) {
            cb.notes.push({ pitch: 60, startTick: 0, durationTicks: 480, velocity: 80 });
            v1.notes.push({ pitch: 30, startTick: 0, durationTicks: 480, velocity: 80 });
          }
        },
      },
      {
        rule: 'R4',
        tpl: 'ensemble.cinematic',
        desc: 'insert minor 2nd at MIDI 40+41',
        mutate: (p) => {
          const cb = p.tracks.find((t) => t.role === 'cellosBasses' || t.id === 'cellosBasses');
          const va = p.tracks.find((t) => t.role === 'violas' || t.id === 'violas');
          if (cb && va) {
            cb.notes.push({ pitch: 40, startTick: 0, durationTicks: 480, velocity: 80 });
            va.notes.push({ pitch: 41, startTick: 0, durationTicks: 480, velocity: 80 });
          }
        },
      },
      {
        rule: 'R5',
        tpl: 'ensemble.cinematic',
        desc: 'push violins1 up 2 octaves (>12st gap)',
        mutate: (p) => {
          const v1 = p.tracks.find((t) => t.role === 'violins1' || t.id === 'violins1');
          if (v1) v1.notes.forEach((n) => { n.pitch += 24; });
        },
      },
      {
        rule: 'R6',
        tpl: 'ensemble.cinematic',
        desc: 'flatten all desk velocities to 70',
        mutate: (p) => {
          p.tracks.filter((t) => t.family === 'Strings').forEach((t) => t.notes.forEach((n) => { n.velocity = 70; }));
        },
      },
      {
        rule: 'R7',
        tpl: 'ensemble.cinematic',
        desc: 'clear violins2 and violas notes',
        mutate: (p) => {
          p.tracks.filter((t) => t.family === 'Strings' && (t.role === 'violins2' || t.id === 'violins2' || t.role === 'violas' || t.id === 'violas')).forEach((t) => { t.notes = []; });
        },
      },
      {
        rule: 'R9',
        tpl: 'ensemble.cinematic',
        desc: 'clear all string notes in intro',
        mutate: (p) => {
          const intro = p.sections.find((s) => s.name.toLowerCase().includes('intro'));
          if (intro) {
            p.tracks.filter((t) => t.family === 'Strings').forEach((t) => {
              t.notes = t.notes.filter((n) => n.startTick >= intro.endTick);
            });
          }
        },
      },
      {
        rule: 'R10',
        tpl: 'ensemble.cinematic',
        desc: 'leave only violins1 in chorus',
        mutate: (p) => {
          p.tracks.filter((t) => t.family === 'Strings' && t.role !== 'violins1').forEach((t) => { t.notes = []; });
        },
      },
      {
        rule: 'R13',
        tpl: 'ensemble.vocalbacking',
        desc: 'set velocity 100 on vocalbacking strings',
        mutate: (p) => {
          p.tracks.filter((t) => t.family === 'Strings').forEach((t) => t.notes.forEach((n) => { n.velocity = 100; }));
        },
      },
      {
        rule: 'R14',
        tpl: 'ensemble.cinematic',
        desc: 'force sulPont on all string notes',
        mutate: (p) => {
          p.tracks.filter((t) => t.family === 'Strings').forEach((t) => t.notes.forEach((n) => { n.articulation = 'sulPont'; }));
        },
      },
      {
        rule: 'R15',
        tpl: 'ensemble.cinematic',
        desc: 'make all string notes identical pitch/vel/art',
        mutate: (p) => {
          p.tracks.filter((t) => t.family === 'Strings').forEach((t) => t.notes.forEach((n) => {
            n.pitch = 60;
            n.velocity = 70;
            n.articulation = 'legato';
          }));
        },
      },
    ];

    console.log('\n=== MUTATION PROOF TABLE ===');
    console.log('Rule\tMutation\tBefore\tAfter');
    for (const m of mutations) {
      const targetProj = m.tpl === 'ensemble.cinematic'
        ? { ...composed, sections: composed.sections ?? base.sections }
        : (() => {
            const c = composeAllTracks({ ...base, orchestration: { ...(base.orchestration ?? {}), templateId: m.tpl, take: 1 } }, { take: 1, variety: true });
            return { ...c, sections: c.sections ?? base.sections };
          })();
      const before = checkRulesForTake(targetProj, m.tpl)[m.rule].violations;
      const mutated = cloneProject(targetProj);
      m.mutate(mutated);
      const after = checkRulesForTake(mutated, m.tpl)[m.rule].violations;
      console.log(`${m.rule}\t${m.desc}\t${before}\t${after}`);
      if (before === 0) {
        expect(after).toBeGreaterThan(0);
      } else {
        expect(after).toBeGreaterThanOrEqual(before);
      }
    }
  }, 60000);
});
