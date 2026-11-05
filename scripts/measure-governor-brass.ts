/**
 * Phase 8 brass pre-flight measurement (run at the pre-brass HEAD).
 * For symphony / cinematic / hybridstudio × three-chorus + dorian × takes 1–10:
 * recompute the mix governor's per-beat-window math (the exact formula from
 * energy/mix.ts) over the composed project, once WITH the rules generator's
 * brass notes and once with them stripped. If every window where the governor
 * fired (perPad < some pad velocity) yields the SAME perPad with and without
 * brass, the governor's effect on the strings is brass-independent — a brass
 * module that caps its velocities can never move a string note.
 */
import { readFileSync } from 'node:fs';
import { composeAllTracks } from '../src/orchestrator/compose';
import { governPadVelocities } from '../src/orchestrator/energy/mix';
import { maxMeanVelocityFor } from '../src/orchestrator/energy';
import { projectFromFixture, isInstrumentTrack, type Note, type Project, type Track } from '../src/shared/schema';
import { resolveTemplate } from '../src/config/ensembles';
import { barTicks, beatOffsets, beatTicks, projectBars } from '../src/shared/schema/meter';

const THREE = JSON.parse(readFileSync(new URL('../fixtures/three-chorus-40bars.json', import.meta.url), 'utf8'));
const DORIAN = JSON.parse(readFileSync(new URL('../fixtures/dorian-16bars.json', import.meta.url), 'utf8'));
const BRASS_ROLES = ['horns', 'trumpets', 'trombones', 'tuba'];

const composeTake = (doc: unknown, templateId: string, take: number): { project: Project; result: ReturnType<typeof composeAllTracks> } => {
  const p: Project = projectFromFixture(JSON.parse(JSON.stringify(doc)));
  p.ensemble = { templateId, overrides: {}, pins: {} };
  p.orchestration = { take };
  const result = composeAllTracks(p, { seed: 11 });
  return { project: { ...p, tracks: result.tracks, orchestration: result.orchestration } as Project, result };
};

const noteKey = (n: Note) => `${n.pitch}:${n.startTick}:${n.durationTicks}:${n.velocity}:${n.articulation ?? ''}:${n.layer ?? ''}`;

interface Win { start: number; end: number; perPad: number; energy: number }
function windowsOf(project: Project, tracks: Track[], templateId: string): Win[] {
  const template = resolveTemplate({ templateId, overrides: {}, pins: {} } as Project['ensemble'])!;
  const ts = project.timeSignature;
  const btBar = barTicks(ts);
  const bars = projectBars(project);
  const endTick = bars * btBar;
  const bt = beatTicks(ts);
  const clampMax = template.budget.energyClamp[1];
  const N = template.roster.length;
  const rosterRoles = new Set(template.roster.map((r) => r.role));
  const stringsTrackIds = new Set(tracks.filter((t) => t.family === 'Strings').map((t) => t.id));
  const pads: Note[] = tracks.filter((t) => stringsTrackIds.has(t.id) && rosterRoles.has(t.role)).flatMap((t) => t.notes);
  const others = tracks
    .filter((t) => isInstrumentTrack(t) && !stringsTrackIds.has(t.id) && rosterRoles.has(t.role))
    .map((t) => ({ role: t.role, notes: t.notes }));
  const padRoles = new Set(tracks.filter((t) => stringsTrackIds.has(t.id) && rosterRoles.has(t.role)).map((t) => t.role));
  const out: Win[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const barStart = bar * btBar;
    const offsets = beatOffsets(ts);
    for (let b = 0; b < offsets.length; b++) {
      const start = barStart + offsets[b];
      if (start >= endTick) continue;
      const end = Math.min(endTick, start + bt);
      const roles = new Set<string>(padRoles);
      let otherSum = 0, otherCount = 0, padSum = 0, padCount = 0;
      for (const n of pads) if (n.startTick < end && n.startTick + n.durationTicks > start) { padSum += n.velocity; padCount++; }
      for (const t of others) {
        let sounded = false;
        for (const n of t.notes) if (n.startTick < end && n.startTick + n.durationTicks > start) { otherSum += n.velocity; otherCount++; sounded = true; }
        if (sounded) roles.add(t.role);
      }
      if (roles.size === 0 || otherCount + padCount === 0) { out.push({ start, end, perPad: Infinity, energy: 0 }); continue; }
      const energy = (roles.size / N) * (((otherSum + padSum) / (otherCount + padCount)) / 127);
      const allowedPadSum = (127 * clampMax * N * (otherCount + padCount)) / roles.size - otherSum;
      const perPad = energy > clampMax + 1e-9 && padCount > 0 ? Math.max(1, Math.floor(allowedPadSum / padCount)) : Infinity;
      out.push({ start, end, perPad, energy });
    }
  }
  return out;
}

let fired = 0, firedWithBrass = 0, differing = 0, loweredNotes = 0, loweredInBrassWindowsDiff = 0;
for (const templateId of ['ensemble.symphony', 'ensemble.cinematic', 'ensemble.hybridstudio']) {
  for (const [tag, doc] of [['three', THREE], ['dorian', DORIAN]] as const) {
    for (let take = 1; take <= 10; take++) {
      const { project, result } = composeTake(doc, templateId, take);
      const template = resolveTemplate({ templateId, overrides: {}, pins: {} } as Project['ensemble'])!;
      const rosterRoles = new Set(template.roster.map((r) => r.role));
      const withBrass = windowsOf(project, result.tracks, templateId);
      const stripped: Track[] = result.tracks.map((t) =>
        isInstrumentTrack(t) && BRASS_ROLES.includes(t.role) && !t.locked ? { ...t, notes: [] as Note[] } : t,
      );
      const without = windowsOf(project, stripped, templateId);
      const stringsIds = new Set(result.tracks.filter((t) => t.family === 'Strings').map((t) => t.id));
      const pads: Note[] = result.tracks.filter((t) => stringsIds.has(t.id)).flatMap((t) => t.notes);
      for (let i = 0; i < withBrass.length; i++) {
        const a = withBrass[i], b = without[i];
        if (a.perPad !== Infinity) {
          fired++;
          const brassHere = result.tracks
            .filter((t) => isInstrumentTrack(t) && BRASS_ROLES.includes(t.role))
            .some((t) => t.notes.some((n) => n.startTick < a.end && n.startTick + n.durationTicks > a.start));
          if (brassHere) {
            firedWithBrass++;
            if (a.perPad !== b.perPad) {
              differing++;
              const hit = pads.filter((n) => n.startTick < a.end && n.startTick + n.durationTicks > a.start && n.velocity >= a.perPad).length;
              loweredInBrassWindowsDiff += hit;
            }
          }
        }
        if (a.perPad !== Infinity) loweredNotes += pads.filter((n) => n.startTick < a.end && n.startTick + n.durationTicks > a.start && n.velocity >= a.perPad).length;
      }
    }
  }
}
console.log(`governor windows fired: ${fired}, fired with brass sounding: ${firedWithBrass}`);
console.log(`fired windows whose perPad DEPENDS on brass: ${differing} (pad notes affected: ${loweredInBrassWindowsDiff})`);
console.log(`total pad notes at/under a fired cap: ${loweredNotes}`);
let maxRatio = 0;
for (const templateId2 of ['ensemble.symphony', 'ensemble.cinematic', 'ensemble.hybridstudio']) {
  for (const [tag2, doc2] of [['three', THREE], ['dorian', DORIAN]] as const) {
    for (let take2 = 1; take2 <= 10; take2++) {
      const { project: p2, result: r2 } = composeTake(doc2, templateId2, take2);
      const tpl2 = resolveTemplate({ templateId: templateId2, overrides: {}, pins: {} } as Project['ensemble'])!;
      for (const w of windowsOf(p2, r2.tracks, templateId2)) maxRatio = Math.max(maxRatio, w.energy / tpl2.budget.energyClamp[1]);
    }
  }
}
console.log(`max window energy / clampMax across the survey: ${maxRatio.toFixed(3)}`);
void governPadVelocities; void maxMeanVelocityFor;
