/**
 * Fuzz round 2: (a) feed composed results FORWARD (re-compose on composed
 * projects — the user hits Compose All repeatedly), (b) randomized project
 * mutations. Any throw here = the user's dead button.
 */
import { composeAllTracks } from '../src/orchestrator/compose';
import { projectFromFixture } from '../src/shared/schema/factory';
import { applyTemplate } from '../src/shared/schema/band';
import { ENSEMBLE_BY_ID } from '../src/config/ensembles';
import fixture from '../fixtures/dorian-16bars.json';
import type { Project } from '../src/shared/schema/types';

let fails = 0;

function attempt(label: string, fn: () => void) {
  try {
    fn();
  } catch (e) {
    fails++;
    console.log(`THROW  ${label}`);
    console.log((e as Error).stack?.split('\n').slice(0, 8).join('\n'));
  }
}

const TPLS = ['ensemble.symphony', 'ensemble.cinematic', 'ensemble.hybridstudio', 'ensemble.chamber', 'ensemble.sonata', 'ensemble.vocalbacking'];

const step = (p: Project, tplId: string | null, opts: { seed: number; humanize?: boolean; density?: number }): Project => {
  const r = composeAllTracks(tplId === null ? p : applyTemplate(p, ENSEMBLE_BY_ID.get(tplId)!).project, opts);
  return { ...p, tracks: r.tracks, orchestration: r.orchestration, ensemble: tplId === null ? p.ensemble : applyTemplate(p, ENSEMBLE_BY_ID.get(tplId)!).project.ensemble };
};

/* ---- a) re-compose on composed projects, all ping-pong orders ---- */
for (const a of TPLS) {
  for (const b of TPLS) {
    attempt(`recompose ${a} -> ${b} -> ${a}`, () => {
      let p = projectFromFixture(JSON.parse(JSON.stringify(fixture)) as Partial<Project>);
      p = step(p, a, { seed: 4242 });
      p = step(p, b, { seed: 4242 });
      step(p, a, { seed: 4242 });
    });
  }
}

/* ---- b) randomized mutations ---- */
// deterministic PRNG so the run is reproducible
let s = 987654321;
const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
const MODES = ['Ionian', 'Dorian', 'Phrygian', 'Lydian', 'Mixolydian', 'Aeolian', 'Locrian'];
const SECTION_NAMES = ['Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Bridge', 'Drop', 'Hook', 'Refrain', 'Outro', 'Cinematic Rise'];

for (let iter = 0; iter < 3000; iter++) {
  attempt(`random iter ${iter}`, () => {
    const p = projectFromFixture(JSON.parse(JSON.stringify(fixture)) as Partial<Project>);
    // key/mode/tempo/meter
    p.key = Math.floor(rnd() * 12);
    p.mode = pick(MODES) as Project['mode'];
    p.bpm = 40 + Math.floor(rnd() * 260);
    p.tempoMap = [{ tick: 0, bpm: p.bpm }];
    const denoms = [4, 4, 4, 8, 2];
    p.timeSignature = { numerator: pick([2, 3, 4, 5, 6, 7, 9]), denominator: pick(denoms) };
    // sections: 0..5 random ones (may overlap/gap)
    const nSec = Math.floor(rnd() * 6);
    p.sections = Array.from({ length: nSec }, (_, i) => ({
      id: `sec${i}`, name: pick(SECTION_NAMES), startBar: 1 + Math.floor(rnd() * 14), lengthBars: 1 + Math.floor(rnd() * 8), color: '',
    }));
    // chords: 0..16 random ones
    const nCh = Math.floor(rnd() * 17);
    p.chords = Array.from({ length: nCh }, (_, i) => ({
      id: `ch${i}`, bar: 1 + Math.floor(rnd() * 16), lengthBars: 1 + Math.floor(rnd() * 4),
      root: pick('CDEFGAB'.split('')) as Project['chords'][number]['root'], symbol: pick(['', '7', 'maj7', 'm7', 'dim', 'sus4', 'Xb9']),
    }));
    // locks / pins / overrides / takes
    if (rnd() < 0.3) for (const t of p.tracks) if (rnd() < 0.15) t.locked = true;
    if (rnd() < 0.3) for (const t of p.tracks) if (rnd() < 0.15) t.muted = true;
    if (rnd() < 0.3) for (const t of p.tracks) if (rnd() < 0.15) t.soloed = true;
    const pins: Record<string, 'in' | 'out'> = {};
    for (const role of ['timpani', 'snare', 'cymbals', 'aux', 'tuba', 'oboes', 'piano', 'harp']) if (rnd() < 0.2) pins[role] = pick(['in', 'out'] as const);
    const ovr: Record<string, 'in' | 'out'> = {};
    for (const role of ['violins1', 'cellosBasses', 'flutes']) if (rnd() < 0.2) ovr[role] = pick(['in', 'out'] as const);
    p.ensemble = { templateId: null, overrides: ovr, pins };
    p.orchestration = { take: Math.floor(rnd() * 50), ...(rnd() < 0.5 ? { sectionTakes: { sec0: Math.floor(rnd() * 20) } } : {}), ...(rnd() < 0.5 ? { sectionLocks: [pick(['sec0', 'sec1', 'ghost'])] } : {}) };
    if (rnd() < 0.2) p.libraryGroups = [];
    if (rnd() < 0.2) (p as { libraryGroups?: unknown }).libraryGroups = [{ id: 'g1', name: 'G' }] as never;
    // stale notes/cc
    if (rnd() < 0.5) for (const t of p.tracks) if (rnd() < 0.5) t.notes = Array.from({ length: Math.floor(rnd() * 20) }, () => ({ pitch: Math.floor(rnd() * 128), startTick: Math.floor(rnd() * 8000), durationTicks: 1 + Math.floor(rnd() * 500), velocity: 1 + Math.floor(rnd() * 127) }));
    if (rnd() < 0.4) for (const t of p.tracks) if (rnd() < 0.5) t.cc = [{ controller: pick([1, 7, 11]), points: [{ tick: 0, value: Math.floor(rnd() * 128) }] }];
    // compose on a random band, then switch to another and compose again
    const t1 = pick(TPLS);
    const t2 = pick(TPLS);
    const opts = { seed: Math.floor(rnd() * 1e6), ...(rnd() < 0.5 ? { humanize: true } : {}), ...(rnd() < 0.5 ? { density: rnd() } : {}) };
    let q = step(p, t1, opts);
    q = step(q, t2, opts);
    // one more straight re-compose on the same band
    composeAllTracks(q, opts);
  });
}

console.log(fails === 0 ? `\nALL CLEAN` : `\n${fails} throws`);
