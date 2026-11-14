/** Dependency-free verification only. No installed packages or production
 * module changes. Node 22 strips TS syntax; this is NOT a type checker.
 * Explicit opt-in substitutes our small SMF encoder for missing midi-file.
 * Golden export hashes and an independent Python parser check its output.
 * Normal app/test/build resolution never uses this loader. */
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
export async function resolve(spec, ctx, next) {
  if (spec === 'midi-file' && process.env.CRESCODE_AUDIT_CODEC === '1')
    return { url: new URL('./strings-orchestration-smf.mjs', import.meta.url).href, shortCircuit: true };
  if (spec.startsWith('.') || spec.startsWith('/')) {
    const url = new URL(spec, ctx.parentURL ?? pathToFileURL(process.cwd() + '/'));
    for (const tail of ['', '.ts', '/index.ts', '.json']) {
      const p = fileURLToPath(url) + tail;
      if (existsSync(p) && (await fs.stat(p)).isFile()) return { url: pathToFileURL(p).href, shortCircuit: true };
    }
  }
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (url.endsWith('.ts')) return { format: 'module', source: stripTypeScriptTypes(await fs.readFile(new URL(url), 'utf8'), { mode: 'transform', sourceUrl: url }), shortCircuit: true };
  if (url.endsWith('.json')) return { format: 'module', source: 'export default ' + await fs.readFile(new URL(url), 'utf8'), shortCircuit: true };
  return next(url, ctx);
}
