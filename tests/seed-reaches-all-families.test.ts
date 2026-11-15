import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import fixture from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { projectFromFixture } from '../src/shared/schema';
import { ENSEMBLE_BY_ID } from '../src/config/ensembles';

const TEMPLATES = [
  'ensemble.symphony',
  'ensemble.chamber',
  'ensemble.cinematic',
  'ensemble.sonata',
  'ensemble.vocalbacking',
  'ensemble.hybridstudio',
] as const;
const BASE = () => projectFromFixture(JSON.parse(JSON.stringify(fixture)));
const PERC_SET = new Set(['timpani','snare','cymbals','aux']);
const KEYS_SET = new Set(['harp','piano']);
const PIN_TEMPLATES = new Set(['ensemble.chamber','ensemble.sonata','ensemble.vocalbacking']);

describe('arrangement seed reaches all families', () => {
  it('same arrangementSeed twice gives identical output for all 6 templates', () => {
    for (const tid of TEMPLATES) {
      const p1 = BASE(); p1.ensemble = { templateId: tid, overrides: {}, pins: {} }; p1.orchestration = { take: 0 };
      const r1 = composeAllTracks(p1, { seed: 1, arrangementSeed: 42, density: 1, humanize: false, moments: true });
      const p2 = BASE(); p2.ensemble = { templateId: tid, overrides: {}, pins: {} }; p2.orchestration = { take: 0 };
      const r2 = composeAllTracks(p2, { seed: 1, arrangementSeed: 42, density: 1, humanize: false, moments: true });
      expect(JSON.stringify(r1.tracks.map(t => ({ id: t.id, notes: t.notes, cc: t.cc }))))
        .toBe(JSON.stringify(r2.tracks.map(t => ({ id: t.id, notes: t.notes, cc: t.cc }))));
    }
  });

  it('arrangementSeed 0 equals the existing pinned golden output', () => {
    for (const tid of TEMPLATES) {
      const short = tid.replace('ensemble.', '');
      const golden = JSON.parse(readFileSync(new URL(`./golden96/${short}-dorian-t1.json`, import.meta.url), 'utf8'));
      const p = BASE(); p.ensemble = { templateId: tid, overrides: {}, pins: {} }; p.orchestration = { take: 1 };
      const r = composeAllTracks(p, { seed: 11, arrangementSeed: 0, moments: true });
      if (PIN_TEMPLATES.has(tid)) {
        const norm = (t: any) => JSON.stringify({ id: t.id, role: t.role, notes: t.notes, cc: t.cc });
        const gTracks = golden.tracks.filter((t: any) => !KEYS_SET.has(t.role));
        const curTracks = r.tracks.filter(t => !KEYS_SET.has(t.role));
        expect(curTracks.map(norm)).toEqual(gTracks.map(norm));
      } else {
        for (const t of r.tracks) {
          if (PERC_SET.has(t.role)) continue;
          if (KEYS_SET.has(t.role)) continue;
          const g = golden.tracks.find((x: { id: string }) => x.id === t.id);
          expect(JSON.stringify({ notes: t.notes, cc: t.cc }), `${tid} ${t.role} diverged`)
            .toBe(JSON.stringify({ notes: (g as any).notes, cc: (g as any).cc }));
        }
      }
    }
  });

  it('arrangementSeed 10 vs 1000 differ for strings, and for brass/winds/keys where in roster', () => {
    for (const tid of TEMPLATES) {
      const template = ENSEMBLE_BY_ID.get(tid)!;
      const hasBrass = template.roster.some(r => ['horns','trumpets','trombones','tuba'].includes(r.role));
      const hasWinds = template.roster.some(r => ['flutes','oboes','clarinets','bassoons'].includes(r.role));
      const hasKeys = template.roster.some(r => ['harp','piano'].includes(r.role));
      const p10 = BASE(); p10.ensemble = { templateId: tid, overrides: {}, pins: {} }; p10.orchestration = { take: 0 };
      const r10 = composeAllTracks(p10, { seed: 1, arrangementSeed: 10, density: 1, humanize: false, moments: true });
      const p1000 = BASE(); p1000.ensemble = { templateId: tid, overrides: {}, pins: {} }; p1000.orchestration = { take: 0 };
      const r1000 = composeAllTracks(p1000, { seed: 1, arrangementSeed: 1000, density: 1, humanize: false, moments: true });
      const strings10 = r10.tracks.filter(t => t.family==='Strings').flatMap(t=>t.notes);
      const strings1000 = r1000.tracks.filter(t => t.family==='Strings').flatMap(t=>t.notes);
      expect(JSON.stringify(strings10) !== JSON.stringify(strings1000), `${tid} strings differ`).toBe(true);
      if (hasBrass) {
        const b10=r10.tracks.filter(t=>t.family==='Brass').flatMap(t=>t.notes);
        const b1000=r1000.tracks.filter(t=>t.family==='Brass').flatMap(t=>t.notes);
        expect(JSON.stringify(b10) !== JSON.stringify(b1000), `${tid} brass differ`).toBe(true);
      }
      if (hasWinds) {
        const w10=r10.tracks.filter(t=>t.family==='Woodwinds').flatMap(t=>t.notes);
        const w1000=r1000.tracks.filter(t=>t.family==='Woodwinds').flatMap(t=>t.notes);
        expect(JSON.stringify(w10) !== JSON.stringify(w1000), `${tid} winds differ`).toBe(true);
      }
      if (hasKeys) {
        const k10=r10.tracks.filter(t=>t.role==='harp' || t.role==='piano').flatMap(t=>t.notes);
        const k1000=r1000.tracks.filter(t=>t.role==='harp' || t.role==='piano').flatMap(t=>t.notes);
        if (k10.length || k1000.length) expect(JSON.stringify(k10) !== JSON.stringify(k1000), `${tid} keys differ`).toBe(true);
      }
    }
  });
});
