/**
 * Seed-audit dump (spec §9): runs the shipped engine (src/engine/generate.ts)
 * over 20 seeds x 5 structures and prints a compact per-section, per-family
 * listening map so the composer can compare takes by ear.
 *
 * Reconciliation note (Phase 0): this harness originally audited the chordgen
 * progression engine (generateProgressionDetailed / SCORE_FLOOR / chord-level
 * locks). That engine lost the patch reconciliation to flexgen and is gone
 * from the tree, so the dump now audits the surviving engine's note output.
 * When the orchestrator's spine lands (spec §8) a progression-scoring floor
 * can bring the original calibration purpose back.
 *
 * Run:  npx vitest run tests/seed-dump.test.ts
 * Out:  $CRESCODE_SEED_AUDIT_OUT if set, else <os.tmpdir()>/crescode-seed-audit.txt —
 *       never the repo root, so the tree stays clean (Phase 0 item 4d).
 */
import { expect, it } from 'vitest';
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fixture from '../fixtures/dorian-16bars.json';
import { generate } from '../src/engine/generate';
import { barTicks, projectBars, projectFromFixture, type Project, type Section } from '../src/shared/schema';

let idc = 0;
const sec = (name: string, startBar: number, lengthBars: number): Section => ({ id: `s${idc++}`, name, startBar, lengthBars });

/** The fixture supplies the standard 21 tracks; each structure overrides the form. */
function base(): Project {
  const p = projectFromFixture(JSON.parse(JSON.stringify(fixture)));
  p.bpm = 96;
  p.tempoMap = [{ tick: 0, bpm: 96 }];
  p.sections = [];
  p.chords = [];
  return p;
}

const STRUCTURES: { name: string; project: () => Project }[] = [
  { name: 'A · classic form', project: () => ({ ...base(), sections: [sec('Intro', 1, 4), sec('Verse', 5, 8), sec('Pre-Chorus', 13, 4), sec('Chorus', 17, 8), sec('Verse', 25, 8), sec('Chorus', 33, 8), sec('Outro', 41, 4)] }) },
  { name: 'B · single 16-bar verse', project: () => ({ ...base(), sections: [sec('Verse', 1, 16)] }) },
  { name: 'C · full suite', project: () => ({ ...base(), sections: [sec('Intro', 1, 4), sec('Verse', 5, 8), sec('Pre-Chorus', 13, 4), sec('Chorus', 17, 8), sec('Bridge', 25, 4), sec('Chorus', 29, 8), sec('Outro', 37, 4)] }) },
  { name: 'D · odd lengths', project: () => ({ ...base(), sections: [sec('Intro', 1, 2), sec('Verse', 3, 5), sec('Chorus', 8, 7), sec('Bridge', 15, 3), sec('Outro', 18, 3)] }) },
  {
    // was "scattered chord locks" in the chordgen era; locks are track-level now.
    name: 'E · scattered locks', project: () => {
      const p = { ...base(), sections: [sec('Verse', 1, 8), sec('Chorus', 9, 8)] };
      const violins2 = p.tracks.find((t) => t.role === 'violins2')!;
      const harp = p.tracks.find((t) => t.role === 'harp')!;
      violins2.locked = true;
      harp.locked = true;
      return p;
    },
  },
];

const FAMILIES = ['Strings', 'Brass', 'Woodwinds', 'Percussion', 'Keys', 'Audio'] as const;

function auditLine(p: Project, tracks: Track[]): string {
  const byFamily = FAMILIES.map((f) => `${f.toLowerCase()} ${tracks.filter((t) => t.family === f).reduce((a, t) => a + t.notes.length, 0)}`).join(' · ');
  const bt = barTicks(p.timeSignature);
  const perSection = [...p.sections]
    .sort((a, b) => a.startBar - b.startBar)
    .map((s) => {
      const start = (s.startBar - 1) * bt, end = start + s.lengthBars * bt;
      const notes = tracks.filter((t) => t.family !== 'Structure' && t.family !== 'Audio')
        .reduce((a, t) => a + t.notes.filter((n) => n.startTick >= start && n.startTick < end).length, 0);
      return `${s.name} ${notes}`;
    })
    .join(' · ');
  const total = tracks.reduce((a, t) => a + t.notes.length, 0);
  const locked = p.tracks.filter((t) => t.locked).map((t) => t.role).join(',');
  return `notes ${total} · ${byFamily} · by section: ${perSection}${locked ? ` · locked: ${locked}` : ''}`;
}

it('seed-audit dump: 20 seeds x 5 structures over the shipped engine', () => {
  const lines: string[] = [];
  lines.push('CRESCODE SEED AUDIT — listen and compare takes (spec §9; engine: src/engine/generate.ts)');
  lines.push('Key D Dorian · 4/4 · 96 BPM · seeds 1-20 x 5 structures · band: none (everyone in)');
  lines.push('Legend: notes <n> per family · per-section note counts · locked tracks are never rewritten');
  lines.push('');
  for (const { name, project } of STRUCTURES) {
    const p = project();
    lines.push('='.repeat(78));
    lines.push(`STRUCTURE ${name} — ${projectBars(p)} bars: ${[...p.sections].sort((a, b) => a.startBar - b.startBar).map((s) => `${s.name} ${s.lengthBars}b`).join(' | ')}`);
    lines.push('-'.repeat(78));
    for (let seed = 1; seed <= 20; seed++) {
      const tracks = generate(p, { seed });
      lines.push(`Seed ${String(seed).padStart(2)}  ${auditLine(p, tracks)}`);
      // determinism is part of the audit: same seed → byte-identical take
      expect(JSON.stringify(generate(p, { seed }))).toBe(JSON.stringify(tracks));
    }
    // locked tracks (structure E) must come back byte-identical
    for (const t of p.tracks.filter((t) => t.locked)) {
      const after = generate(p, { seed: 7 }).find((x) => x.id === t.id)!;
      expect(after.notes).toEqual(t.notes);
    }
    lines.push('');
  }
  const out = process.env.CRESCODE_SEED_AUDIT_OUT || join(tmpdir(), 'crescode-seed-audit.txt');
  writeFileSync(out, lines.join('\n'), 'utf8');
  expect(existsSync(out)).toBe(true);
  console.log(`[seed-dump] wrote ${out} (${lines.length} lines)`);
});
