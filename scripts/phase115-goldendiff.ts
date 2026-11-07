/**
 * Phase 11.5: the golden104 -> golden105 diff report — which tracks moved.
 * Expected: ONLY the piano tracks of chamber, sonata and vocalbacking; the
 * harp and every other track byte-identical everywhere; the cinematic,
 * hybridstudio and symphony pianos byte-identical too (their pins hold).
 *   npx vite-node scripts/phase114-goldendiff.ts
 */
import { readFileSync } from 'node:fs';

const TEMPLATES = ['ensemble.symphony', 'ensemble.chamber', 'ensemble.cinematic', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.hybridstudio'];
const stable = (t: { id: string; role: string; notes: unknown; cc?: unknown }) =>
  JSON.stringify({ id: t.id, role: t.role, notes: t.notes, ...(t.cc !== undefined ? { cc: t.cc } : {}) });

const movedByRole: Record<string, number> = {};
const movedByTemplate: Record<string, number> = {};
let checks = 0;
for (const templateId of TEMPLATES) {
  const short = templateId.replace('ensemble.', '');
  for (const fixTag of ['three', 'dorian']) {
    for (let take = 1; take <= 10; take++) {
      const a = JSON.parse(readFileSync(new URL(`../tests/golden104/${short}-${fixTag}-t${take}.json`, import.meta.url), 'utf8'));
      const b = JSON.parse(readFileSync(new URL(`../tests/golden105/${short}-${fixTag}-t${take}.json`, import.meta.url), 'utf8'));
      const byId = new Map<string, string>((a.tracks as { id: string }[]).map((t) => [t.id, stable(t as never)]));
      for (const t of b.tracks as { id: string; role: string }[]) {
        checks++;
        if (byId.get(t.id) !== stable(t as never)) {
          movedByRole[t.role] = (movedByRole[t.role] ?? 0) + 1;
          movedByTemplate[short] = (movedByTemplate[short] ?? 0) + 1;
        }
      }
    }
  }
}
console.log(`golden104 vs golden105: ${checks} track comparisons (6 templates × 2 fixtures × 10 takes × every track)`);
console.log(`moved tracks by role: ${Object.entries(movedByRole).map(([r, c]) => `${r} ${c}`).join(', ') || 'NONE'}`);
console.log(`moved tracks by template: ${Object.entries(movedByTemplate).map(([r, c]) => `${r} ${c}`).join(', ') || 'NONE'}`);
const pianoOnly = Object.keys(movedByRole).every((r) => r === 'piano');
const menuTemplatesOnly = Object.keys(movedByTemplate).every((t) => ['chamber', 'sonata', 'vocalbacking'].includes(t));
console.log(`piano-only: ${pianoOnly ? 'YES' : 'NO'} | menu templates only: ${menuTemplatesOnly ? 'YES' : 'NO'}`);
