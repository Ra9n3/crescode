import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/dorian-16bars.json';
import { ENSEMBLE_BY_ID } from '../src/config/ensembles';
import { composeAllTracks } from '../src/orchestrator/compose';
import { measureEnergy } from '../src/orchestrator/energy';
import { projectFromFixture, type Project } from '../src/shared/schema';
import type { ConductorPlan } from '../src/orchestrator/conductor';

/**
 * Phase 3 listening maps (Phase 3.5 edition): for every template, per section,
 * the mean energy per bar (mean of the bar's beat windows, silence = 0) and —
 * per STRING TRACK — the layer it plays, with the bars it rests (the
 * conductor's breaths). The numbers land in PHASE3_5_REPORT.md verbatim.
 */
const TEMPLATE_IDS = ['ensemble.symphony', 'ensemble.chamber', 'ensemble.cinematic', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.hybridstudio'] as const;

/** Run-length compress a bar-token list into "pad 1–7, REST 8 (reason)" strings. */
const compressRuns = (tokens: string[], bars: number[]): string => {
  const runs: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    let j = i;
    while (j < tokens.length && tokens[j] === tokens[i]) j++;
    const label = tokens[i] === 'pad' ? 'pad' : `REST (${tokens[i].replace('REST:', '')})`;
    runs.push(i === j - 1 ? `${label} ${bars[i]}` : `${label} ${bars[i]}–${bars[j - 1]}`);
    i = j;
  }
  return runs.join(', ');
};

/** Per string track: the bar tokens ('pad' or 'REST:<reason>') from the plan's breaths. */
const stringLayerByTrack = (plan: ConductorPlan, stringsTrackIds: string[], bars: number[]): Map<string, string[]> => {
  const out = new Map<string, string[]>();
  for (const id of stringsTrackIds) {
    out.set(
      id,
      bars.map((bar) => {
        const bp = plan.bars[bar - 1];
        const breath = plan.breaths.find((b) => b.trackIds.includes(id) && b.startTick <= bp.startTick && bp.endTick <= b.endTick);
        return breath ? `REST:${breath.reason}${breath.nearSilence ? '+nearSilence' : ''}` : 'pad';
      }),
    );
  }
  return out;
};

describe('PHASE3 listening map', () => {
  it('prints per-template, per-section mean energy per bar + per-string-track layers', () => {
    for (const id of TEMPLATE_IDS) {
      const p: Project = projectFromFixture(JSON.parse(JSON.stringify(fixture)));
      p.ensemble = { templateId: id, overrides: {}, pins: {} };
      const res = composeAllTracks(p, { seed: 11 });
      const project = { ...p, tracks: res.tracks };
      const template = ENSEMBLE_BY_ID.get(id)!;
      const report = measureEnergy(project, template);

      const lines: string[] = [];
      lines.push(`${template.name} (clamp ${template.budget.energyClamp.join('–')}, maxLayers ${template.budget.maxLayers}, policy ${(template.rules.find((r) => r.type === 'octaveDoubling')?.params as { policy?: string } | undefined)?.policy ?? 'none'})`);
      lines.push(`  measureEnergy: max ${report.max.toFixed(3)} · strings notes ${res.stringsTrackIds.reduce((acc, t) => acc + (project.tracks.find((x) => x.id === t)?.notes.length ?? 0), 0)}`);
      const sections = res.plan.bars.reduce<{ name: string; bars: number[] }[]>((acc, b) => {
        const last = acc[acc.length - 1];
        if (last && last.name === b.sectionName) last.bars.push(b.bar);
        else acc.push({ name: b.sectionName, bars: [b.bar] });
        return acc;
      }, []);
      for (const sec of sections) {
        const energies = sec.bars.map((bar) => {
          const wins = report.windows.filter((w) => w.bar === bar);
          return wins.length ? wins.reduce((a, w) => a + w.energy, 0) / wins.length : 0;
        });
        lines.push(`  ${sec.name} (bars ${sec.bars[0]}–${sec.bars[sec.bars.length - 1]}):`);
        lines.push(`    mean E/bar: [${energies.map((e) => e.toFixed(3)).join(', ')}]`);
        // per string track: the layer it plays (pad) and the bars it rests
        const byTrack = stringLayerByTrack(res.plan, res.stringsTrackIds, sec.bars);
        const roleOf = (tid: string) => project.tracks.find((t) => t.id === tid)?.role ?? tid;
        const groups = new Map<string, string[]>();
        for (const [tid, tokens] of byTrack) {
          const key = tokens.join('|');
          groups.set(key, [...(groups.get(key) ?? []), roleOf(tid)]);
        }
        for (const [key, roles] of groups) {
          lines.push(`    ${roles.sort().join('+')}: ${compressRuns(key.split('|'), sec.bars)}`);
        }
      }
      console.log(lines.join('\n'));
    }
    expect(TEMPLATE_IDS).toHaveLength(6);
  });
});
