/**
 * Phase 12 pre-flight (read-only). Answers pre-flight 2 and 3 from the
 * golden105 corpus itself (6 templates x 2 fixtures x takes 1-10 = 120
 * files — the exact composed data every export reads):
 *   2. wind notes inside each patch's silent gap (flute 52-58, oboe 57-58,
 *      clarinet 40-49, bassoon 28-34) — the fold candidates — plus the
 *      sub-playableLow totals and the fold targets vs the hard ranges.
 *   3. percussion notes by role: pitch sets, articulation distribution
 *      (crash = unmarked/marcato, swell/roll = tremolo, short = staccato),
 *      durations and velocities — in particular whether the engine ever
 *      writes a cymbal note that is neither a crash nor a swell (the only
 *      case where the 55-59 short pool could ever fire).
 * Plus the CC-lane presence per family (pre-flight 1: wind CC under the
 * brass convention) and the shipped track.midiChannel defaults.
 *   npx vite-node scripts/phase12-preflight.ts
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSTRUMENTS } from '../src/shared/schema/ranges';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, '..', 'tests', 'golden105');

interface GNote { pitch: number; startTick: number; durationTicks: number; velocity: number; articulation?: string; layer?: string }
interface GTrack { id: string; role: string; notes: GNote[]; cc?: { cc: number; points: { tick: number; value: number }[] }[] }
interface GFile { templateId: string; fixture: string; take: number; tracks: GTrack[] }

const TEMPLATES = ['chamber', 'sonata', 'vocalbacking', 'symphony', 'cinematic', 'hybridstudio'];
const GAPS: Record<string, [number, number]> = { flutes: [52, 58], oboes: [57, 58], clarinets: [40, 49], bassoons: [28, 34] };
const PLAYABLE_LOW: Record<string, number> = { flutes: 59, oboes: 59, clarinets: 50, bassoons: 35 };
const HARD_TOP: Record<string, number> = { flutes: 96, oboes: 93, clarinets: 91, bassoons: 75 };
const WIND_ROLES = Object.keys(GAPS);
const PERC_ROLES = ['timpani', 'snare', 'cymbals', 'aux'];
const KEY_ROLES = ['harp', 'piano'];
const artOf = (n: GNote): string => n.articulation ?? 'unmarked';

const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
if (files.length !== 120) throw new Error(`expected 120 golden105 files, found ${files.length}`);

/* ---- aggregates ---- */
const windGapByTemplate: Record<string, Record<string, number>> = {};
const windGapPitches: Record<string, number> = {};
const windBelowLow: Record<string, number> = {};
const windTotal: Record<string, Record<string, number>> = {};
const windCC: Record<string, number> = {};
const percByTemplate: Record<string, Record<string, { n: number; pitches: Set<number>; arts: Record<string, number>; velLo: number; velHi: number; durLo: number; durHi: number; durs: number[] }>> = {};
const percCC: Record<string, number> = {};
const keyInfo: Record<string, { n: number; lo: number; hi: number; ccTracks: number; arts: Set<string> }> = {};
const channelDefaults = new Map<number, number>();
let auxTracks = 0;

const zeroArts = (): Record<string, number> => ({});
for (const f of files) {
  const g = JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as GFile;
  const tpl = g.templateId.replace('ensemble.', '');
  for (const t of g.tracks) {
    for (const n of t.notes) void n;
    // channel defaults (per role, from the file order = the project order)
    void channelDefaults;
    if (WIND_ROLES.includes(t.role)) {
      windTotal[tpl] ??= {}; windTotal[tpl][t.role] = (windTotal[tpl][t.role] ?? 0) + t.notes.length;
      if (t.cc?.length) windCC[t.role] = (windCC[t.role] ?? 0) + 1;
      for (const n of t.notes) {
        const [lo, hi] = GAPS[t.role];
        if (n.pitch >= lo && n.pitch <= hi) {
          windGapByTemplate[tpl] ??= {}; windGapByTemplate[tpl][t.role] = (windGapByTemplate[tpl][t.role] ?? 0) + 1;
          const key = `${t.role}:${n.pitch}`;
          windGapPitches[key] = (windGapPitches[key] ?? 0) + 1;
        }
        if (n.pitch < PLAYABLE_LOW[t.role]) windBelowLow[t.role] = (windBelowLow[t.role] ?? 0) + 1;
      }
    }
    if (PERC_ROLES.includes(t.role)) {
      if (t.role === 'aux' && t.notes.length) auxTracks++;
      if (t.cc?.length) percCC[t.role] = (percCC[t.role] ?? 0) + 1;
      const agg = (percByTemplate[tpl] ??= {})[t.role] ??= { n: 0, pitches: new Set<number>(), arts: zeroArts(), velLo: 128, velHi: 0, durLo: Infinity, durHi: 0, durs: [] };
      for (const n of t.notes) {
        agg.n++;
        agg.pitches.add(n.pitch);
        const a = artOf(n);
        agg.arts[a] = (agg.arts[a] ?? 0) + 1;
        agg.velLo = Math.min(agg.velLo, n.velocity);
        agg.velHi = Math.max(agg.velHi, n.velocity);
        agg.durLo = Math.min(agg.durLo, n.durationTicks);
        agg.durHi = Math.max(agg.durHi, n.durationTicks);
        if (t.role === 'cymbals') agg.durs.push(n.durationTicks);
      }
    }
    if (KEY_ROLES.includes(t.role)) {
      const k = (keyInfo[t.role] ??= { n: 0, lo: 128, hi: 0, ccTracks: 0, arts: new Set<string>() });
      for (const n of t.notes) { k.n++; k.lo = Math.min(k.lo, n.pitch); k.hi = Math.max(k.hi, n.pitch); if (n.articulation) k.arts.add(n.articulation); }
      if (t.cc?.length) k.ccTracks++;
    }
  }
}

/* ---- report ---- */
console.log(`\n=== golden105 corpus: ${files.length} files, instrument roles in INSTRUMENTS: ${INSTRUMENTS.length} ===`);
console.log(`roles: ${INSTRUMENTS.map((i) => i.role).join(', ')}`);

console.log('\n--- Pre-flight 2: wind notes inside each patch\'s silent gap (fold candidates) ---');
for (const role of WIND_ROLES) {
  const [lo, hi] = GAPS[role];
  const total = Object.values(windTotal).reduce((a, m) => a + (m[role] ?? 0), 0);
  const gapTotal = Object.entries(windGapByTemplate).reduce((a, [, m]) => a + (m[role] ?? 0), 0);
  const pitches = Object.entries(windGapPitches).filter(([k]) => k.startsWith(`${role}:`)).map(([k, v]) => `${k.split(':')[1]}×${v}`).join(', ') || '—';
  const perTpl = TEMPLATES.map((t) => `${t}=${windGapByTemplate[t]?.[role] ?? 0}`).join(' ');
  console.log(`${role}: gap ${lo}-${hi}, engine notes total ${total}, in-gap ${gapTotal} (${perTpl}); gap pitches: ${pitches}; below playableLow ${PLAYABLE_LOW[role]}: ${windBelowLow[role] ?? 0}; fold target ${PLAYABLE_LOW[role] + 12}.. ≤ hard top ${HARD_TOP[role]}`);
}

console.log('\n--- Pre-flight 3: percussion by role and template ---');
for (const role of PERC_ROLES) {
  console.log(`\n[${role}]`);
  for (const tpl of TEMPLATES) {
    const agg = percByTemplate[tpl]?.[role];
    if (!agg || agg.n === 0) { console.log(`  ${tpl}: 0 notes`); continue; }
    const arts = Object.entries(agg.arts).map(([a, c]) => `${a}=${c}`).join(', ');
    const durs = role === 'cymbals' ? ` durations(ticks) distinct: ${[...new Set(agg.durs)].sort((a, b) => a - b).join(',')}` : '';
    console.log(`  ${tpl}: ${agg.n} notes, pitches {${[...agg.pitches].join(',')}}, vel ${agg.velLo}-${agg.velHi}, dur ${agg.durLo}-${agg.durHi}${durs}, arts: ${arts}`);
  }
}

console.log('\n--- CC lanes present (tracks with non-empty cc) ---');
console.log(`winds: ${JSON.stringify(windCC)}`);
console.log(`percussion: ${JSON.stringify(percCC)}`);
console.log(`keys: harp cc tracks ${keyInfo.harp?.ccTracks ?? 0}, piano cc tracks ${keyInfo.piano?.ccTracks ?? 0}`);
console.log(`keys ranges: harp ${keyInfo.harp ? `${keyInfo.harp.lo}-${keyInfo.harp.hi} (${keyInfo.harp.n} notes, arts: ${[...keyInfo.harp.arts].join(',') || 'unmarked'})` : 'none'}, piano ${keyInfo.piano ? `${keyInfo.piano.lo}-${keyInfo.piano.hi} (${keyInfo.piano.n} notes, arts: ${[...keyInfo.piano.arts].join(',') || 'unmarked'})` : 'none'}`);
console.log(`aux tracks with notes: ${auxTracks}`);
