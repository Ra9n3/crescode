/**
 * Seed-audit dump (spec §9): prints generated progressions for 20 seeds x 5
 * structures so the composer can LISTEN through them and mark bad ones; the
 * score floor (SCORE_FLOOR) is then calibrated from those marks.
 *
 * Run:  npx vitest run tests/seed-dump.test.ts
 * Out:  seed-audit.txt at the repo root.
 *
 * Legend: | chord (bars shown as 2b etc.)   ‖ phrase end (cadence in brackets)
 *         ⫽ section end   ⚠F = section used the fallback bank
 */
import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateProgressionDetailed, SCORE_FLOOR } from '../src/orchestrator/chordgen';
import { barTicks, projectBars } from '../src/shared/schema/meter';
import type { Chord, Project, Section } from '../src/shared/schema/types';

let idc = 0;
const sec = (name: string, startBar: number, lengthBars: number): Section => ({ id: `s${idc++}`, name, startBar, lengthBars });

const STRUCTURES: { name: string; project: () => Project }[] = [
  { name: 'A · classic form', project: () => ({ ...base(), sections: [sec('Intro', 1, 4), sec('Verse', 5, 8), sec('Pre-Chorus', 13, 4), sec('Chorus', 17, 8), sec('Verse', 25, 8), sec('Chorus', 33, 8), sec('Outro', 41, 4)] }) },
  { name: 'B · single 16-bar verse', project: () => ({ ...base(), sections: [sec('Verse', 1, 16)] }) },
  { name: 'C · full suite', project: () => ({ ...base(), sections: [sec('Intro', 1, 4), sec('Verse', 5, 8), sec('Pre-Chorus', 13, 4), sec('Chorus', 17, 8), sec('Bridge', 25, 4), sec('Chorus', 29, 8), sec('Outro', 37, 4)] }) },
  { name: 'D · odd lengths', project: () => ({ ...base(), sections: [sec('Intro', 1, 2), sec('Verse', 3, 5), sec('Chorus', 8, 7), sec('Bridge', 15, 3), sec('Outro', 18, 3)] }) },
  {
    name: 'E · scattered locks', project: () => {
      const p = { ...base(), sections: [sec('Verse', 1, 8), sec('Chorus', 9, 8)] };
      const bt = barTicks(p.timeSignature);
      p.chords = [
        { id: 'lockA', symbol: 'Dm', startTick: 1 * bt, durationTicks: 2 * bt, locked: true },
        { id: 'lockB', symbol: 'F', startTick: 10 * bt, durationTicks: 2 * bt, locked: true },
      ];
      return p;
    },
  },
];

function base(): Project {
  return {
    schemaVersion: 1, name: 'audit', bpm: 96, tempoMap: [{ tick: 0, bpm: 96 }],
    timeSignature: { numerator: 4, denominator: 4 }, key: 2, mode: 'Dorian',
    sections: [], chords: [], referenceAudio: { path: null, offsetMs: 0 }, tracks: [], libraryGroups: [], masterVolume: 1,
  };
}

it('seed-audit dump: 20 seeds x 5 structures', () => {
  const lines: string[] = [];
  lines.push('CRESCODE SEED AUDIT — calibrate SCORE_FLOOR from your ears (spec §9)');
  lines.push(`Current provisional floor: ${SCORE_FLOOR} · key D Dorian · 4/4 · seeds 1-20 x 5 structures`);
  lines.push('Legend: | chord (2b = two bars) · ‖ phrase end [open/res/fin] · ⫽ section end · ⚠F fallback used');
  lines.push('');
  for (const { name, project } of STRUCTURES) {
    const p = project();
    const bt = barTicks(p.timeSignature);
    lines.push('='.repeat(78));
    lines.push(`STRUCTURE ${name} — ${projectBars(p)} bars: ${[...p.sections].sort((a, b) => a.startBar - b.startBar).map((s) => `${s.name} ${s.lengthBars}b`).join(' | ')}`);
    lines.push('-'.repeat(78));
    for (let seed = 1; seed <= 20; seed++) {
      const { chords, reports, fallbackCount } = generateProgressionDetailed(p, { seed, scope: 'all' });
      lines.push(`Seed ${String(seed).padStart(2)}  [avg score ${(reports.reduce((a, r) => a + r.score, 0) / Math.max(1, reports.length)).toFixed(2)}${fallbackCount ? ` · ⚠ ${fallbackCount} fallback` : ''}]`);
      for (const s of [...p.sections].sort((a, b) => a.startBar - b.startBar)) {
        const start = (s.startBar - 1) * bt, end = start + s.lengthBars * bt;
        const list = chords.filter((c) => c.startTick >= start && c.startTick < end).sort((a, b) => a.startTick - b.startTick);
        const rep = reports.find((r) => r.sectionId === s.id);
        if (!list.length) { lines.push(`  ${s.name.padEnd(11)} (bars ${s.startBar}-${s.startBar + s.lengthBars - 1})  — fully locked`); continue; }
        const bars = (t: number) => `${Math.round((t / bt) * 10) / 10}b`;
        const cell = (c: Chord) => `${c.symbol} ${bars(c.durationTicks)}`;
        const isPhraseEnd = (c: Chord) => {
          const pos = (c.startTick + c.durationTicks - start) / bt;
          return s.lengthBars % 4 === 0 ? pos % 4 === 0 : pos === s.lengthBars || (pos % 4 === 0 && pos < s.lengthBars - (s.lengthBars % 4));
        };
        const isSectionEnd = (c: Chord) => c.startTick + c.durationTicks === end;
        let row = `  ${s.name.padEnd(11)} (bars ${s.startBar}-${s.startBar + s.lengthBars - 1})${rep?.fallback ? ' ⚠F' : ''}  `;
        row += list.map((c) => cell(c) + (isSectionEnd(c) ? ' ⫽' : isPhraseEnd(c) ? ' ‖' : ' |')).join(' ');
        lines.push(row);
      }
    }
    lines.push('');
  }
  const out = join(process.cwd(), 'seed-audit.txt');
  writeFileSync(out, lines.join('\n'), 'utf8');
  console.log(`[seed-dump] wrote ${out} (${lines.length} lines)`);
});
