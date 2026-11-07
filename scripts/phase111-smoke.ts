/**
 * Phase 11.1 smoke (read-only): composes one take per affected template
 * and prints the piano's sanity (count, register, roles) — catches runtime
 * errors before the survey runs.
 */
import threeChorus from '../fixtures/three-chorus-40bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { projectFromFixture, type Project } from '../src/shared/schema';

for (const templateId of ['ensemble.chamber', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.cinematic']) {
  const p: Project = projectFromFixture(JSON.parse(JSON.stringify(threeChorus)));
  p.ensemble = { templateId, overrides: {}, pins: {} };
  p.orchestration = { take: 1 };
  const result = composeAllTracks(p, { seed: 11 });
  const piano = result.tracks.find((t) => t.role === 'piano');
  const harp = result.tracks.find((t) => t.role === 'harp');
  const pitches = (piano?.notes ?? []).map((n) => n.pitch);
  const menu = result.plan.keys.pianoPatterns.map((e) => `b${e.startBar}=${e.pattern}`).join(', ');
  const zone = (piano?.notes ?? []).filter((n) => n.pitch >= 57 && n.pitch <= 81).length;
  console.log(`${templateId.replace('ensemble.', '')}: piano ${piano?.notes.length ?? 0} notes  range ${pitches.length ? Math.min(...pitches) : '-'}-${pitches.length ? Math.max(...pitches) : '-'}  zone-notes ${zone}  menu ${menu || '(none)'}`);
  console.log(`  harp: ${harp?.notes.length ?? 0} notes`);
  console.log(`  reports: ${result.reports.filter((r) => r.startsWith('keys')).join(' | ')}`);
}
