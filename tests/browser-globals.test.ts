/**
 * Browser hygiene: no direct Node-global access in src/ (the Compose All
 * regression: two leftover `process.env.SUPDBG` debug guards in the winds
 * renderer threw "process is not defined" in the user's browser — but only on
 * symphony and cinematic, the only rosters with a bassoon, the only part the
 * guards' bassDouble branch serves).
 *
 * Why every other layer stayed green: the unit suite runs in Node, where
 * `process` exists (the guards were inert there); the e2e smoke runs the
 * production build, where Vite statically replaces `process.env.*` (also
 * inert). Only the dev server serves the literal expression, so only a real
 * user on `npm run dev` could see the crash. A static scan is the one layer
 * that covers all three.
 *
 * Rule: src/ is browser code — a bare `process.` reference is forbidden even
 * behind a same-line typeof guard (a guard on a neighbouring line would pass
 * the scan while still crashing). Prefer import.meta.env for environment
 * flags; if a Node global is ever genuinely needed in src/, isolate it behind
 * an allow-listed accessor and record the justification here.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// `typeof process` is safe (typeof an undeclared reference never throws) and
// the sanctioned escape hatch; a bare `process.` is the crash.
const FORBIDDEN = [/(?<!typeof\s+)process\s*\./];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

describe('browser hygiene: no Node globals in src/', () => {
  it('src/ never references process.* directly (typeof-process guards exempt)', () => {
    const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');
    const offenders = walk(root).flatMap((f) => {
      const lines = readFileSync(f, 'utf8').split('\n');
      return lines
        .map((line, i) => ({ line: i + 1, text: line }))
        .filter(({ text }) => FORBIDDEN.some((re) => re.test(text)))
        .map(({ line, text }) => `${f}:${line} ${text.trim()}`);
    });
    expect(offenders).toEqual([]);
  });
});
