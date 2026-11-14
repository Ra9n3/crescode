/** Read the audited revision directly from git objects. Never checks out,
 * writes or substitutes a MIDI codec. Used only by the Stage 1 comparison. */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { relative } from 'node:path';
import { load as currentLoad } from './strings-orchestration-native-loader.mjs';
export { resolve } from './strings-orchestration-native-loader.mjs';
export async function load(url, context, next) {
  if (process.env.CRESCODE_WIND_BASELINE === '1' && url.startsWith('file:') && (url.endsWith('.ts') || url.endsWith('.json'))) {
    const path = relative(process.cwd(), fileURLToPath(url));
    if (path.startsWith('src/') || path.startsWith('specs/') || path.startsWith('fixtures/')) {
      const source = execFileSync('git', ['show', `96c7756c6484f85d3937d20a070818fa568d4d80:${path}`], { encoding: 'utf8' });
      return { format: 'module', source: url.endsWith('.ts') ? stripTypeScriptTypes(source, { mode: 'transform', sourceUrl: url }) : 'export default ' + source, shortCircuit: true };
    }
  }
  return currentLoad(url, context, next);
}
