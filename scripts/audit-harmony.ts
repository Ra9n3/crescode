/**
 * Musical audit (Phase 4.1, spec §19) — development-only tool that generates
 * a corpus of progressions in a human-readable format for REVIEW, not for
 * calibration. Automated tests cannot establish that a progression sounds
 * good; this makes it easy to inspect:
 *
 *   - chord roots        (every symbol)
 *   - structural         (foundation in braces: {E minor})
 *   - chord colors       (the symbol itself vs its foundation)
 *   - phrase boundaries  (‖ at each planned arrival)
 *   - section boundaries (headers with bar ranges)
 *   - repeated-section relationships (shared-foundation ratio footer)
 *
 * The corpus covers multiple keys, all twelve modes, several section
 * structures, complexity 1/2/3, borrowing none/some/more and 30+ seeds.
 * A correction that improves E Aeolian but damages Dorian, Lydian or Whole
 * Tone harmony is not acceptable — read broadly.
 *
 * Usage:  npm run audit                 (writes audit-corpus.txt)
 *         npx vite-node scripts/audit-harmony.ts [--out path]
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { generateChordProgression } from '../src/engine/harmony/generation';
import { planSongHarmony } from '../src/engine/harmony/plan';
import { foundationLabel, getHarmonicFoundation } from '../src/engine/harmony/foundation';
import { barToTick, barTicks } from '../src/shared/schema/meter';
import { MODE_NAMES, type ModeName } from '../src/shared/schema/modes';
import { projectFromFixture, type Project, type Section } from '../src/shared/schema';

const BT = 960 * 4;
const here = path.dirname(fileURLToPath(import.meta.url));
const outArg = process.argv.indexOf('--out');
const outFile = outArg >= 0 ? process.argv[outArg + 1] : path.join(here, '..', 'audit-corpus.txt');

const sec = (id: string, name: string, startBar: number, lengthBars: number): Section =>
  ({ id, name, startBar, lengthBars });

function makeProject(sections: Section[], opts: Partial<Project> = {}): Project {
  const base = projectFromFixture({ name: 'Audit', tracks: [] });
  return { ...base, sections, chords: [], ...opts };
}

/** The song's phrase boundaries as [startTick, endTick] spans. */
function phraseSpans(p: Project, seed: number): Array<{ start: number; end: number }> {
  const plan = planSongHarmony(p.sections.length > 0 ? p : { ...p, sections: [sec('(song)', 'Song', 1, 12)] }, { seed });
  return plan.sections.flatMap((s) =>
    s.phrases.map((ph) => ({ start: ph.startTick, end: ph.startTick + ph.durationTicks })));
}

function renderRun(p: Project, seed: number, label: string): string {
  const r = generateChordProgression(p, { scope: { type: 'all' }, seed });
  const lines: string[] = [];
  lines.push('='.repeat(78));
  lines.push(`${label} / seed ${seed}`);
  lines.push('='.repeat(78));

  const spans = phraseSpans(p, seed);
  const bt = barTicks(p.timeSignature);

  // Group events by section span (synthetic '(song)' covers sectionless runs).
  const songEnd = Math.max(
    ...p.sections.map((s) => (s.startBar - 1 + s.lengthBars) * bt),
    ...r.chords.map((c) => c.startTick + c.durationTicks),
  );
  const sectionSpans: Array<{ name: string; start: number; end: number; id: string }> = p.sections.map((s) => ({
    name: s.name, id: s.id,
    start: barToTick(s.startBar, p.timeSignature),
    end: (s.startBar - 1 + s.lengthBars) * bt,
  }));
  if (sectionSpans.length === 0) {
    sectionSpans.push({ name: 'Song', id: '(song)', start: 0, end: songEnd });
  }
  // Extend the last section to the song end so tail events have a home.
  sectionSpans[sectionSpans.length - 1].end = Math.max(sectionSpans[sectionSpans.length - 1].end, songEnd);

  for (const s of sectionSpans) {
    const startBar = Math.round(s.start / bt) + 1;
    const endBar = Math.round(s.end / bt);
    lines.push(`${s.name} (bars ${startBar}\u2013${endBar}):`);
    const sectionPhrases = spans.filter((sp) => sp.start >= s.start && sp.start < s.end);
    const usable = sectionPhrases.length > 0
      ? sectionPhrases
      : [{ start: s.start, end: s.end }];
    for (const ph of usable) {
      const events = r.chords.filter((c) =>
        c.startTick >= ph.start && c.startTick < ph.end
        && c.startTick >= s.start && c.startTick < s.end);
      if (events.length === 0) continue;
      // Chord-chart style: `| Em{E minor} | Cmaj7{C major} ‖`. Sustained
      // multi-bar events carry a continuation marker per extra bar.
      const parts: string[] = [];
      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        const f = getHarmonicFoundation(ev.symbol, { root: p.key, mode: p.mode });
        parts.push(`${ev.symbol}{${f ? foundationLabel(f) : '?'}}`);
        const extraBars = Math.floor((ev.startTick + ev.durationTicks - 1) / bt)
          - Math.floor(ev.startTick / bt);
        for (let k = 0; k < extraBars && i < events.length - 1; k++) parts.push('\u2014');
      }
      lines.push(`  | ${parts.join(' | ')} \u2016`);
    }
  }

  // Repeated-section relationships.
  if (r.report.sectionFoundationOverlap.length > 0) {
    for (const o of r.report.sectionFoundationOverlap) {
      const a = p.sections.find((s) => s.id === o.a)?.name ?? o.a;
      const b = p.sections.find((s) => s.id === o.b)?.name ?? o.b;
      lines.push(`  \u21ac shared structural foundations, ${a} \u2194 ${b}: ${(o.overlap * 100).toFixed(0)}%`);
    }
  }
  const gen = r.report.generatedChordCount;
  if (gen > 0) {
    const tonicPct = Math.round((r.report.tonicReinforcementEvents / gen) * 100);
    const avgRoots = r.report.distinctRootsPerPhrase.length > 0
      ? (r.report.distinctRootsPerPhrase.reduce((s, v) => s + v, 0) / r.report.distinctRootsPerPhrase.length).toFixed(1)
      : '0';
    lines.push(`  \u00b7 events ${gen}, tonic-reinforcing ${tonicPct}%, avg distinct roots/phrase ${avgRoots}, families [${r.report.cadenceFamiliesUsed.join(', ')}]`);
    if (r.report.borrowedSymbols.length > 0) {
      lines.push(`  \u00b7 borrowed colors: ${r.report.borrowedSymbols.join(', ')}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

let out = '';
out += 'Crescode \u2014 Phase 4.1 musical audit corpus\n';
out += 'Structural harmony {foundation} vs chord color; \u2016 marks a planned phrase arrival.\n';
out += `Generated ${new Date().toISOString()}\n\n`;

let runs = 0;

// 1) Deep E Aeolian sweep across structures \u00d7 30 seeds (spec \u00a719: \u2265 30 seeds).
const eAeolian = 4;
const structures: Array<[string, Section[]]> = [
  ['Verse-Chorus', [sec('a', 'Verse', 1, 8), sec('b', 'Chorus', 9, 8)]],
  ['Full form', [sec('i', 'Intro', 1, 4), sec('a', 'Verse', 5, 8), sec('b', 'Chorus', 13, 8), sec('d', 'Bridge', 21, 4), sec('b2', 'Chorus 2', 25, 8), sec('o', 'Outro', 33, 4)]],
  ['Sectionless', []],
];
for (const [label, sections] of structures) {
  const p = makeProject(sections, { key: eAeolian, mode: 'Aeolian' });
  for (let seed = 1; seed <= 30; seed++) {
    out += renderRun(p, seed, `Key E / Aeolian / ${label}`);
    runs += 1;
  }
}

// 2) Mode \u00d7 key grid with rotating complexity and borrowing.
const keys = [0, 2, 3, 6, 9];
const complexities = [1, 2, 3] as const;
const borrowings = ['none', 'some', 'more'] as const;
let gi = 0;
for (const mode of MODE_NAMES) {
  for (const key of keys) {
    const complexity = complexities[gi % 3];
    const borrowing = borrowings[gi % 3];
    gi += 1;
    const p = makeProject(
      [sec('a', 'Verse', 1, 8), sec('b', 'Chorus', 9, 8)],
      {
        key, mode,
        chordGenSettings: { ...makeProject([], {}).chordGenSettings!, complexity, borrowing },
      },
    );
    for (const seed of [7, 42]) {
      const keyName = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'][key];
      out += renderRun(p, seed, `Key ${keyName} / ${mode} / Verse-Chorus / complexity ${complexity} / borrowing ${borrowing}`);
      runs += 1;
    }
  }
}

// 3) Settings sweep on one key: complexity \u00d7 borrowing \u00d7 4 seeds.
{
  const p0 = makeProject([], {});
  for (const complexity of complexities) {
    for (const borrowing of borrowings) {
      const p = makeProject(
        [sec('a', 'Verse', 1, 8), sec('b', 'Chorus', 9, 8)],
        { key: 2, mode: 'Dorian', chordGenSettings: { ...p0.chordGenSettings!, complexity, borrowing } },
      );
      for (let seed = 1; seed <= 4; seed++) {
        out += renderRun(p, seed, `Key D / Dorian / sweep / complexity ${complexity} / borrowing ${borrowing}`);
        runs += 1;
      }
    }
  }
}

writeFileSync(outFile, out);
console.log(`Audit corpus written: ${outFile}`);
console.log(`Runs: ${runs} (30-seed E Aeolian sweep, 12-mode \u00d7 5-key grid, settings sweep)`);
console.log('\nSample \u2014 E Aeolian seed 42, Verse-Chorus:');
console.log(renderRun(makeProject([sec('a', 'Verse', 1, 8), sec('b', 'Chorus', 9, 8)], { key: 4, mode: 'Aeolian' }), 42, 'Key E / Aeolian / Verse-Chorus'));
