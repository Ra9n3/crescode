/**
 * CLI test harness: loads the fixture, runs the generator, prints per-track
 * note counts and a bar-by-bar text summary.
 *   npm run harness            (seed 1)
 *   npm run harness -- 42      (custom seed)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { generate } from '../src/engine/generate';
import { barTicks, isInstrumentTrack, noteName, projectBars, projectFromFixture, validateProject, NOTE_NAMES, type Project } from '../src/shared/schema';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv.find((a) => a.endsWith('.json')) ?? path.join(here, '..', 'fixtures', 'dorian-16bars.json');
const seedArg = process.argv.slice(2).find((a) => /^\d+$/.test(a));
const seed = seedArg ? parseInt(seedArg, 10) : 1;

const project: Project = projectFromFixture(JSON.parse(readFileSync(file, 'utf8')));
const t0 = performance.now();
const tracks = generate(project, { seed, humanize: true, density: 1 });
const ms = performance.now() - t0;
const out = { ...project, tracks };
const v = validateProject(out);

console.log(`\nCrescode harness — ${project.name}`);
console.log(`${NOTE_NAMES[project.key]} ${project.mode} · ${project.bpm} BPM · ${project.timeSignature.numerator}/${project.timeSignature.denominator} · ${projectBars(project)} bars · seed ${seed}`);
console.log(`Generated in ${ms.toFixed(1)} ms · validation: ${v.ok ? 'OK' : `${v.errors.length} errors`}\n`);
if (!v.ok) v.errors.slice(0, 20).forEach((e) => console.log(`  ! ${e.path}: ${e.message}`));

console.log('Per-track note counts');
console.log('─'.repeat(52));
for (const t of tracks.filter(isInstrumentTrack)) {
  const range = t.notes.length ? `${noteName(Math.min(...t.notes.map((n) => n.pitch)))}–${noteName(Math.max(...t.notes.map((n) => n.pitch)))}` : '';
  console.log(`${t.name.padEnd(16)} ${String(t.notes.length).padStart(5)}   ${range}`);
}

const bt = barTicks(project.timeSignature);
const bars = projectBars(project);
const inst = tracks.filter(isInstrumentTrack);
console.log('\nBar-by-bar summary (notes starting in each bar)');
console.log('Bar  Section    Chord(s)         ' + inst.map((t) => t.name.slice(0, 4).padStart(5)).join(''));
for (let b = 0; b < bars; b++) {
  const sec = project.sections.find((s) => b + 1 >= s.startBar && b + 1 < s.startBar + s.lengthBars)?.name ?? '';
  const chords = project.chords.filter((c) => c.startTick < (b + 1) * bt && c.startTick + c.durationTicks > b * bt).map((c) => c.symbol).join(' ');
  const counts = inst.map((t) => String(t.notes.filter((n) => n.startTick >= b * bt && n.startTick < (b + 1) * bt).length || '·').padStart(5)).join('');
  console.log(`${String(b + 1).padStart(3)}  ${sec.padEnd(10)} ${chords.padEnd(16)} ${counts}`);
}
console.log('');
process.exit(v.ok && ms < 1000 ? 0 : 1);
