/**
 * Phase 9 pre-flight probes (read-only):
 *  1. wind rosters + hard ranges per template (MIDI sounding);
 *  2. is governPadVelocities inert at HEAD? (if it never lowers a pad, the
 *     winds module taking wind notes OUT of its otherNotes cannot move a
 *     pad — string byte-identity holds architecturally, the Phase 8 argument)
 *  3. the old generator's wind rules per section type (which labels write winds);
 *  4. chorus gate arithmetic: the chorus staircase band vs the proposed wind gates.
 */
import threeChorus from '../fixtures/three-chorus-40bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { projectFromFixture, type Note, type Project } from '../src/shared/schema';
import { resolveTemplate } from '../src/config/ensembles';
import { governPadVelocities } from '../src/orchestrator/energy/mix';
import { isInBand } from '../src/shared/schema/band';

const WIND_ROLES = ['flutes', 'oboes', 'clarinets', 'bassoons'];

const clone = (p: Project): Project => JSON.parse(JSON.stringify(p));

for (const templateId of ['ensemble.symphony', 'ensemble.cinematic', 'ensemble.hybridstudio', 'ensemble.chamber', 'ensemble.sonata', 'ensemble.vocalbacking']) {
  const template = resolveTemplate({ templateId, overrides: {}, pins: {} })!;
  const roster = template.roster.map((r) => r.role);
  const winds = roster.filter((r) => WIND_ROLES.includes(r));
  console.log(`\n=== ${templateId} ===`);
  console.log('wind roster:', winds.length ? winds.join(', ') : '(none)');

  // hard ranges from the default fixture tracks
  if (winds.length) {
    const p = projectFromFixture(JSON.parse(JSON.stringify(threeChorus)));
    p.ensemble = { templateId, overrides: {}, pins: {} };
    for (const role of winds) {
      const t = p.tracks.find((x) => x.role === role)!;
      console.log(`  ${role}: ${t.lowestNote}-${t.highestNote} (in band: ${isInBand(role, p.ensemble!, template)})`);
    }
  }

  // governor inertness at HEAD (compose with winds in the generator)
  let fired = 0; let checked = 0;
  for (let take = 1; take <= 3; take++) {
    const base = projectFromFixture(JSON.parse(JSON.stringify(threeChorus)));
    base.ensemble = { templateId, overrides: {}, pins: {} };
    base.orchestration = { take };
    const result = composeAllTracks(base, { seed: 11 });
    const project: Project = { ...base, tracks: clone(result.tracks), orchestration: result.orchestration };
    const stringsTrackIds = result.stringsTrackIds;
    const template2 = resolveTemplate(project.ensemble)!;
    const rosterRoles = new Set(template2.roster.map((r) => r.role));
    const before = new Map<string, Note[]>();
    for (const id of stringsTrackIds) before.set(id, (project.tracks.find((t) => t.id === id)?.notes ?? []).map((n) => ({ ...n })));
    const padAfter = new Map<string, Note[]>(stringsTrackIds.map((id) => [id, (project.tracks.find((t) => t.id === id)?.notes ?? []).map((n) => ({ ...n }))]));
    governPadVelocities({
      project,
      template: template2,
      rosterRoles,
      padNotes: padAfter,
      otherNotes: project.tracks
        .filter((t) => !stringsTrackIds.includes(t.id))
        .map((t) => ({ role: t.role, notes: t.notes })),
    });
    for (const [id, notes] of padAfter) {
      const b = before.get(id) ?? [];
      checked += notes.length;
      for (let i = 0; i < notes.length; i++) if (notes[i].velocity !== b[i]?.velocity) fired++;
    }
  }
  console.log(`governPadVelocities at HEAD: ${fired} pad velocities lowered / ${checked} checked (3 takes) — ${fired === 0 ? 'INERT' : 'FIRES'}`);
}

// the old generator's wind labels
const { defaultRules } = await import('../src/config/generation-rules');
console.log('\n=== old generator wind rules ===');
for (const [sec, def] of Object.entries(defaultRules.sections)) {
  for (const part of def.parts) {
    const roles = (part.match as { roles?: string[] }).roles ?? [];
    if (roles.some((r) => WIND_ROLES.includes(r))) {
      console.log(`  ${sec}: "${part.label}" role=${part.role}${(part as { doubleOf?: { role: string; interval: number } }).doubleOf ? ` doubleOf=${JSON.stringify((part as { doubleOf: { role: string; interval: number } }).doubleOf)}` : ''}`);
    }
  }
}
