/** Phase 5.5 report numbers: keyswitch counts + articulation sequences (bars 1-8), tremolo merge counts. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { composeAllTracks } from '../src/orchestrator/compose';
import { buildMergedMidi, parseMidiFile } from '../src/export/midi';
import { EXPORT_PROFILES } from '../src/export/profiles';
import { resolveArticulationKeyFor } from '../src/export/profile';
import { projectFromFixture, type Project } from '../src/shared/schema';

const here = path.dirname(fileURLToPath(import.meta.url));
const profile = EXPORT_PROFILES[0].profile;
const BT = 3840;

const compose = (fixtureFile: string, templateId: string, take: number): Project => {
  const project: Project = projectFromFixture(JSON.parse(readFileSync(fixtureFile, 'utf8')));
  project.ensemble = { templateId, overrides: {}, pins: {} };
  project.orchestration = { take };
  const result = composeAllTracks(project, { seed: 11 });
  return { ...project, tracks: result.tracks, orchestration: result.orchestration } as Project;
};

const dorian = path.join(here, '..', 'fixtures', 'dorian-16bars.json');
const three = path.join(here, '..', 'fixtures', 'three-chorus-40bars.json');

for (const [tag, fixture, template] of [
  ['dorian cinematic (take 1)', dorian, 'ensemble.cinematic'],
  ['dorian symphony (take 1)', dorian, 'ensemble.symphony'],
  ['three-chorus cinematic (take 1)', three, 'ensemble.cinematic'],
] as const) {
  const p = compose(fixture, template, 1);
  const tracks = p.tracks.filter((t) => t.family !== 'Structure' && t.family !== 'Audio');
  const parsed = parseMidiFile(buildMergedMidi(p, tracks, profile));
  console.log(`\n=== ${tag} ===`);
  for (const part of profile.parts) {
    const resolve = (a: string) => resolveArticulationKeyFor(part, a, profile.pitchConvention);
    const source = p.tracks.find((t) => t.role === part.source.role);
    if (!source) { console.log(`${part.id}: no source track`); continue; }
    const notes = source.notes.filter((n) => (part.source.layer === 'cb' ? n.layer === 'cb' : part.source.layer === null ? n.layer !== 'cb' : true));
    const sorted = [...notes].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
    // segments of resolved articulation over bars 1-8
    const segs: { art: string; bar: number; count: number }[] = [];
    let current: number | null = null;
    for (const n of sorted) {
      const art = n.articulation ?? 'sustain';
      const key = resolve(art);
      if (key === null) continue;
      if (current === key && segs.length) { segs[segs.length - 1].count++; continue; }
      segs.push({ art, bar: Math.floor(n.startTick / BT) + 1, count: 1 });
      current = key;
    }
    const ks = parsed.tracks.find((t) => t.channel === part.channel)!.notes.filter((n) => n.pitch < part.lowestPlayable);
    const bar8 = segs.filter((s) => s.bar <= 8);
    console.log(`${part.id} (ch${part.channel}): keyswitches=${ks.length} | bars1-8: ${bar8.map((s) => `b${s.bar} ${s.art}×${s.count}`).join(' · ') || '(silent)'}`);
  }
  // tremolo merge on this project (KS counted in the five part tracks only)
  const tremBefore = tracks.reduce((a, t) => a + t.notes.filter((n) => n.articulation === 'tremolo').length, 0);
  const parsedPlain = parseMidiFile(buildMergedMidi(p, tracks));
  const partNames = new Set(profile.parts.map((x) => x.patch));
  const totalPlain = parsedPlain.tracks.reduce((a, t) => a + t.notes.length, 0);
  const totalMerged = parsed.tracks.reduce((a, t) => a + t.notes.length, 0);
  const ksCount = parsed.tracks.filter((t) => partNames.has(t.name)).reduce((a, t) => a + t.notes.filter((n) => n.velocity === 100 && profile.parts.some((x) => x.patch === t.name && n.pitch < x.lowestPlayable)).length, 0);
  const ksByPart = profile.parts.map((x) => `${x.id}:${parsed.tracks.find((t) => t.channel === x.channel)!.notes.filter((n) => n.pitch < x.lowestPlayable).length}`).join(' ');
  const groups = tremBefore - (totalPlain + ksCount - totalMerged);
  console.log(`tremolo repeats ${tremBefore} -> ${groups} merged groups (removed ${tremBefore - groups}) | notes plain=${totalPlain} profiled=${totalMerged} (+${ksCount} keyswitches: ${ksByPart})`);
}
