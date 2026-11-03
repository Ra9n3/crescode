import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/dorian-16bars.json';
import { ENSEMBLE_BY_ID } from '../src/config/ensembles';
import { composeAllTracks } from '../src/orchestrator/compose';
import { measureEnergy } from '../src/orchestrator/energy';
import { projectFromFixture, type Project } from '../src/shared/schema';

/**
 * Phase 3 listening maps: for every template, per section, the mean energy
 * per bar (mean of the bar's beat windows, silence = 0) and which layers
 * play. The numbers land in PHASE3_REPORT.md verbatim.
 */
const TEMPLATE_IDS = ['ensemble.symphony', 'ensemble.chamber', 'ensemble.cinematic', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.hybridstudio'] as const;

describe('PHASE3 listening map', () => {
  it('prints per-template, per-section mean energy per bar + layers', () => {
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
        const layerByBar = sec.bars.map((bar) => {
          const bp = res.plan.bars[bar - 1];
          const breaths = res.plan.breaths.filter((b) => b.startTick <= bp.startTick && bp.endTick <= b.endTick);
          if (!bp.layers.length) return 'no-strings';
          if (breaths.length && breaths.every((b) => b.trackIds.length >= bp.layers[0].trackIds.length)) {
            return `REST (${breaths[0].reason}${breaths[0].nearSilence ? '+nearSilence' : ''})`;
          }
          if (breaths.length) return `pad (partial breath: ${breaths[0].roles.join('+')})`;
          return `pad(${bp.layers[0].trackIds.length}v) E→${bp.energyTarget.toFixed(2)}`;
        });
        lines.push(`  ${sec.name} (bars ${sec.bars[0]}–${sec.bars[sec.bars.length - 1]}):`);
        lines.push(`    mean E/bar: [${energies.map((e) => e.toFixed(3)).join(', ')}]`);
        lines.push(`    layers:     [${layerByBar.join(' | ')}]`);
      }
      console.log(lines.join('\n'));
    }
    expect(TEMPLATE_IDS).toHaveLength(6);
  });
});
