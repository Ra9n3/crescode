/**
 * Golden diff scope check: compose dorian-cinematic + three-symphony take 1
 * (the two golden compositions, moments:false) and byte-compare EVERY
 * per-track export against the committed tests/golden files. Expected: every
 * NON-brass track byte-identical; only the four brass tracks differ.
 */
import { readFileSync } from 'node:fs';
import { composeAllTracks } from '../src/orchestrator/compose';
import { buildPerTrackMidi, buildMergedMidi } from '../src/export/midi';
import { projectFromFixture, type Project } from '../src/shared/schema';

const compose = (fixtureFile: string, templateId: string, take: number): Project => {
  const project: Project = projectFromFixture(JSON.parse(readFileSync(fixtureFile, 'utf8')));
  project.ensemble = { templateId, overrides: {}, pins: {} };
  project.orchestration = { take };
  const result = composeAllTracks(project, { seed: 11, moments: false });
  return { ...project, tracks: result.tracks, orchestration: result.orchestration } as Project;
};

const dorian = new URL('../fixtures/dorian-16bars.json', import.meta.url).pathname;
const three = new URL('../fixtures/three-chorus-40bars.json', import.meta.url).pathname;
const golden = new URL('../tests/golden/', import.meta.url).pathname;
const BRASS = new Set(['French Horns', 'Trumpets', 'Trombones', 'Tuba']);

for (const [tag, fixture, template] of [
  ['dorian-cinematic', dorian, 'ensemble.cinematic'],
  ['three-symphony', three, 'ensemble.symphony'],
] as const) {
  const p = compose(fixture, template, 1);
  const files = buildPerTrackMidi(p, p.tracks.filter((t) => t.family !== 'Structure' && t.family !== 'Audio'));
  let same = 0; const changed: string[] = []; const missing: string[] = [];
  for (const f of files) {
    const name = `${tag}-per-${f.fileName}`;
    try {
      const old = readFileSync(golden + name);
      const equal = Buffer.compare(Buffer.from(f.data), old) === 0;
      const trackName = f.fileName.replace(/^NN /, '').replace(/\.mid$/, '');
      if (equal) same++;
      else if (BRASS.has(trackName.replace(/^\d+ /, '').trim()) || trackName.includes('Horn') || trackName.includes('Trumpet') || trackName.includes('Trombone') || trackName.includes('Tuba')) changed.push(`BRASS ${f.fileName}`);
      else changed.push(`NON-BRASS ${f.fileName}`);
    } catch { missing.push(f.fileName); }
  }
  const merged = buildMergedMidi(p, p.tracks.filter((t) => t.family !== 'Structure' && t.family !== 'Audio'));
  const mergedEqual = Buffer.compare(Buffer.from(merged), readFileSync(golden + `${tag}-merged.mid`)) === 0;
  console.log(`${tag}: ${same} identical, changed: ${changed.length ? changed.join('; ') : 'none'}; merged differs: ${!mergedEqual}; missing: ${missing.join(',') || 'none'}`);
}
