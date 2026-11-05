/**
 * Phase 8.1 report numbers: channels per part; guard-dropped counts per part
 * on cinematic + symphony (three-chorus, take 1 and the takes 1–10 sweep —
 * brass target zero); keyswitch counts per brass part on cinematic take 1
 * (moments on, the shipped default); the bars 25–32 articulation sequence.
 *   npx vite-node scripts/phase81-report.ts
 */
import { readFileSync } from 'node:fs';
import { composeAllTracks } from '../src/orchestrator/compose';
import { projectFromFixture, type Project } from '../src/shared/schema';
import { barTicks } from '../src/shared/schema/meter';
import { buildMergedMidi, exportableTracks, parseMidiFile } from '../src/export/midi';
import { EXPORT_PROFILES } from '../src/export/profiles';
import { chunksForTrack, keyNameToMidi } from '../src/export/profile';

const THREE = JSON.parse(readFileSync(new URL('../fixtures/three-chorus-40bars.json', import.meta.url), 'utf8'));
const PROFILE = EXPORT_PROFILES[0].profile;
const CONV = PROFILE.pitchConvention;

const compose = (doc: unknown, templateId: string, take: number) => {
  const p: Project = projectFromFixture(JSON.parse(JSON.stringify(doc)));
  p.ensemble = { templateId, overrides: {}, pins: {} };
  p.orchestration = { take };
  const result = composeAllTracks(p, { seed: 11 });
  return { p, result, project: { ...p, tracks: result.tracks, orchestration: result.orchestration } as Project };
};

/** The guard's exact predicate over one part's matched notes (transpose is 0
 *  everywhere, so the project pitches ARE the exported pitches). */
const droppedByPart = (project: Project, tracks: ReturnType<typeof exportableTracks>) => {
  const omit = PROFILE.cbLayer !== 'separate';
  const drops: Record<string, number> = {};
  const notes: Record<string, number> = {};
  for (const part of PROFILE.parts) {
    const source = tracks.find((t) => t.role === part.source.role);
    if (!source) { drops[part.id] = 0; notes[part.id] = 0; continue; }
    const matched = source.notes.filter((n) =>
      (part.source.layer === 'cb' ? n.layer === 'cb' : part.source.layer === null ? n.layer !== 'cb' : true)
      && !(omit && part.source.layer === 'cb'));
    notes[part.id] = matched.length;
    drops[part.id] = matched.filter((n) => n.pitch < part.playableLow!).length;
  }
  return { drops, notes };
};

console.log('=== channels per part ===');
for (const part of PROFILE.parts) {
  console.log(`${`ch${part.channel}`.padEnd(5)} ${part.id.padEnd(10)} ${part.patch}  zone ${part.keyswitchZone!.low}–${part.keyswitchZone!.high}  playableLow ${part.playableLow}`);
}

console.log('\n=== guard-dropped counts per part (three-chorus) ===');
for (const templateId of ['ensemble.cinematic', 'ensemble.symphony']) {
  const short = templateId.replace('ensemble.', '');
  // take 1, per part
  const { project } = compose(THREE, templateId, 1);
  const { drops, notes } = droppedByPart(project, exportableTracks(project, 'all'));
  const fmt = (rec: Record<string, number>) => PROFILE.parts.map((p) => `${p.id} ${rec[p.id]}`).join('  ');
  console.log(`${short} t1  matched: ${fmt(notes)}`);
  console.log(`${short} t1  dropped: ${fmt(drops)}`);
  // sweep takes 1–10: strings + brass totals
  const sum: Record<string, number> = {};
  for (let take = 1; take <= 10; take++) {
    const { project: pj } = compose(THREE, templateId, take);
    const d = droppedByPart(pj, exportableTracks(pj, 'all')).drops;
    for (const [k, v] of Object.entries(d)) sum[k] = (sum[k] ?? 0) + v;
  }
  console.log(`${short} t1–10 dropped totals: ${fmt(sum)}`);
}

console.log('\n=== keyswitch counts per brass part (cinematic take 1, moments on) ===');
{
  const { project } = compose(THREE, 'ensemble.cinematic', 1);
  const tracks = exportableTracks(project, 'all');
  const parsed = parseMidiFile(buildMergedMidi(project, tracks, PROFILE));
  for (const id of ['horns', 'trombones', 'trumpets', 'tuba']) {
    const part = PROFILE.parts.find((p) => p.id === id)!;
    const source = tracks.find((t) => t.role === part.source.role);
    const noteCount = source?.notes.length ?? 0;
    const track = parsed.tracks.find((t) => t.name === part.patch && t.channel === part.channel);
    const keys = new Set(Object.values(part.keyswitches).map((n) => keyNameToMidi(n, CONV)!));
    const ks = track?.notes.filter((n) => keys.has(n.pitch) && n.velocity === PROFILE.keyswitchVelocity) ?? [];
    const ksByArt: Record<string, number> = {};
    for (const [art, name] of Object.entries(part.keyswitches)) {
      const k = keyNameToMidi(name, CONV)!;
      const c = ks.filter((x) => x.pitch === k).length;
      if (c) ksByArt[art] = c;
    }
    console.log(`${id.padEnd(10)} notes ${String(noteCount).padStart(3)}  keyswitches ${String(ks.length).padStart(3)}  {${Object.entries(ksByArt).map(([a, c]) => `${a}:${c}`).join(', ')}}`);
  }
}

console.log('\n=== articulation sequence, bars 25–32 (cinematic take 1, three-chorus) ===');
{
  const { project } = compose(THREE, 'ensemble.cinematic', 1);
  const bt = barTicks(project.timeSignature);
  const brass = ['horns', 'trumpets', 'trombones', 'tuba'];
  for (let bar = 25; bar <= 32; bar++) {
    const lo = (bar - 1) * bt;
    const cells: string[] = [];
    for (const role of brass) {
      const t = project.tracks.find((x) => x.role === role);
      const inBar = (t?.notes ?? []).filter((n) => n.startTick >= lo && n.startTick < lo + bt)
        .sort((a, b) => a.startTick - b.startTick);
      if (!inBar.length) continue;
      const seq = inBar.map((n) => `${n.articulation ?? 'sustain'}${n.pitch}`).join(',');
      const offs = inBar.map((n) => Math.round((n.startTick - lo) / (bt / 4))).join(',');
      cells.push(`${role}[${inBar.length}: ${seq} @${offs}]`);
    }
    console.log(`bar ${bar}: ${cells.length ? cells.join('  ') : '(brass rests)'}`);
  }
}
