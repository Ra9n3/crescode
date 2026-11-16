import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { composeAllTracks } from '../src/orchestrator/compose';
import { DOUBLING_WEIGHTS, feasibleStrategiesForSection, selectSectionDoubling } from '../src/orchestrator/strings/doubling';
import { sectionEnergyTarget } from '../src/orchestrator/render';
import { assignStringLayers } from '../src/orchestrator/conductor/layers';
import { resolveTemplate } from '../src/config/ensembles';
import { orchestrationSeedFor } from '../src/orchestrator/spine';
import type { Project } from '../src/shared/schema/project';

const loadAeolian = (): Project => {
  const raw = fs.readFileSync(path.resolve(__dirname, '../google_drive/aeolian.crescode'), 'utf8');
  return JSON.parse(raw) as Project;
};

const noteSignature = (p: Project): string =>
  JSON.stringify(
    p.tracks
      .filter((t) => t.family === 'Strings')
      .map((t) => ({ id: t.id, notes: t.notes.map((n) => [n.pitch, n.startTick, n.durationTicks, n.velocity, n.articulation ?? null]) })),
  );

describe('strings doubling (E2-FIX)', () => {
  it('identity: variety:false is byte-identical across runs (0 diffs)', () => {
    const base = loadAeolian();
    const r1 = composeAllTracks(base, { take: 1, variety: false });
    const r2 = composeAllTracks(base, { take: 1, variety: false });
    expect(noteSignature(r1)).toBe(noteSignature(r2));
  });

  it('same seed twice byte-identical (variety:true)', () => {
    const base = loadAeolian();
    const r1 = composeAllTracks(base, { take: 3, variety: true });
    const r2 = composeAllTracks(base, { take: 3, variety: true });
    expect(noteSignature(r1)).toBe(noteSignature(r2));
  });

  it('celloOctave is removed from DOUBLING_WEIGHTS and weights sum to 1.0', () => {
    expect('celloOctave' in DOUBLING_WEIGHTS).toBe(false);
    const sum = Object.values(DOUBLING_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 6);
  });

  it('audibility: doubled bars / lead bars >= 80% when strategy != none across takes 1-10', () => {
    const base = loadAeolian();
    const btBar = 1920; // 4/4 at 480 PPQ
    const sections = base.sections.map((sec: any) => ({
      ...sec,
      startTick: sec.startTick ?? sec.startBar * btBar,
      endTick: sec.endTick ?? (sec.startBar + sec.lengthBars) * btBar,
    }));

    let nonNoneSections = 0;
    for (let take = 1; take <= 10; take++) {
      const composed = composeAllTracks(base, { take, variety: true });
      const v1 = composed.tracks.find((t) => t.role === 'violins1' || t.id === 'violins1');
      if (!v1) continue;

      const ctx = {
        project: { ...base, orchestration: { ...(base.orchestration ?? {}), take } },
        ensemble: { pins: {}, overrides: {} },
        spans: [],
        sections,
        variety: true,
      } as any;
      assignStringLayers(ctx, true);

      for (const sec of sections) {
        const energy = sectionEnergyTarget(sec.name);
        const leadBars: number[] = [];
        for (let b = sec.startBar; b < sec.startBar + sec.lengthBars; b++) {
          const s = (b - 1) * btBar;
          const e = s + btBar;
          if (v1.notes.some((n) => n.startTick < e && n.startTick + n.durationTicks > s)) {
            leadBars.push(b);
          }
        }
        const stringIds = composed.tracks.filter((t) => t.family === 'Strings').map((t) => t.id);
        const dp = selectSectionDoubling(ctx, sec, leadBars.length > 0, energy, stringIds, orchestrationSeedFor(base, { take }));
        if (dp.strategy === 'none') continue;
        if (energy < 0.70) {
          expect(dp.strategy).not.toBe('full');
        }
        nonNoneSections++;
        for (const deskId of dp.desks) {
          const desk = composed.tracks.find((t) => t.id === deskId);
          expect(desk).toBeDefined();
          let doubledBars = 0;
          for (const b of leadBars) {
            const s = (b - 1) * btBar;
            const e = s + btBar;
            const deskNotes = desk!.notes.filter((n) => n.startTick < e && n.startTick + n.durationTicks > s);
            const v1Notes = v1.notes.filter((n) => n.startTick < e && n.startTick + n.durationTicks > s);
            // Must have notes and not be a unison copy of v1
            if (deskNotes.length > 0 && deskNotes.some((dn, idx) => dn.pitch !== v1Notes[idx]?.pitch)) {
              doubledBars++;
            }
          }
          const ratio = leadBars.length > 0 ? doubledBars / leadBars.length : 1;
          expect(ratio).toBeGreaterThanOrEqual(0.8);
        }
      }
    }
    expect(nonNoneSections).toBeGreaterThan(0);
  });

  it('full is hard-gated to energy >= 0.70', () => {
    const base = loadAeolian();
    const btBar = 1920;
    const sections = base.sections.map((s) => ({
      ...s,
      startBar: Math.floor(s.startTick / btBar) + 1,
      lengthBars: Math.max(1, Math.round((s.endTick - s.startTick) / btBar)),
    }));
    const ctx = {
      project: base,
      ensemble: { pins: {}, overrides: {} },
      spans: [],
      sections,
      variety: true,
    } as any;
    assignStringLayers(ctx, true);
    const verse = sections.find((s) => s.name.toLowerCase().includes('verse'));
    if (verse) {
      const feasible = feasibleStrategiesForSection(ctx, verse, true, 0.55, ['violins1', 'violins2', 'violas', 'cellosBasses']);
      expect(feasible).not.toContain('full');
    }
  });
});
