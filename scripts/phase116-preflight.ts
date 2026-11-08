/**
 * Phase 11.6 pre-flight (run at the CLEAN c04fb2e HEAD — the BEFORE state,
 * byte-equal to golden105). Read-only survey over the five piano templates:
 *
 *  1. the arc: chorus / non-chorus norm distributions per template — how
 *     often the thinning band (>= 0.72) and the tacet band (>= 0.90) are
 *     reached, per template;
 *  2. the BEFORE numbers for the report's not-chopped table: beat
 *     continuity, short chord strikes, voice-length spread, the below-55 /
 *     below-60 chorus shares, concurrency;
 *  3. the BEFORE voicing tables: bass-note rule (third/fifth/seventh in
 *     bass), smallest adjacent interval, span, the 56-63 gap, the strings
 *     overlap share (chamber, sonata);
 *  4. the old-presence map: how many beat windows the CURRENT engine's
 *     piano fills, per kind — the absorb-classification baseline;
 *  5. the chorus-mean floor baseline (moments excluded) and below-floor
 *     counts, the numbers the 11.6 floor test will measure against.
 *
 * npx vite-node scripts/phase116-preflight.ts
 */
import threeChorus from '../fixtures/three-chorus-40bars.json';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { measureEnergy } from '../src/orchestrator/energy';
import { chordSpans } from '../src/engine/generate';
import { chordTones } from '../src/orchestrator/voicing/chordTones';
import { barTicks, beatTicks, projectBars } from '../src/shared/schema/meter';
import { PPQ, projectFromFixture, type Note, type Project } from '../src/shared/schema';
import { resolveTemplate } from '../src/config/ensembles';
import { isChorusTypeK } from '../src/orchestrator/keys/profile';

const TEMPLATES = ['ensemble.chamber', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.cinematic', 'ensemble.hybridstudio'];

const compose = (doc: unknown, templateId: string, take: number) => {
  const p: Project = projectFromFixture(JSON.parse(JSON.stringify(doc)));
  p.ensemble = { templateId, overrides: {}, pins: {} };
  p.orchestration = { take };
  const result = composeAllTracks(p, { seed: 11 });
  const project: Project = { ...p, tracks: result.tracks, orchestration: result.orchestration };
  return { project, result };
};

const secOf = (doc: typeof threeChorus | typeof dorian, bar: number) => {
  const secs = doc.sections as { name: string; startBar: number; lengthBars: number }[];
  return secs.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
};

const pcOf = (p: number): number => ((p % 12) + 12) % 12;

interface Agg {
  runs: number;
  chorusWindows: number; chorusHigh: number; chorusPeak: number;
  nonChorusBars: number; nonChorusActive: number;
  pianoNotes: number; chorusNotes: number; chorusBelow55: number; chorusBelow60: number;
  beats: number; beatsCovered: number;
  strikes: number; shortStrikes: number; spreadStrikes: number;
  bassRoot: number; bassFifth: number; bassThird: number; bassSeventh: number; bassOther: number;
  minInterval: Record<string, number>;
  spanUnderOctave: number; lowClosePair: number;
  notes56to63: number; notes57to81: number;
  stringsBars: number; stringsStrikes: number; stringsOverlap: number;
  maxSimult: number; over8: number; overLow: number;
  kinds: Record<string, number>;
}

const blank = (): Agg => ({
  runs: 0, chorusWindows: 0, chorusHigh: 0, chorusPeak: 0, nonChorusBars: 0, nonChorusActive: 0,
  pianoNotes: 0, chorusNotes: 0, chorusBelow55: 0, chorusBelow60: 0,
  beats: 0, beatsCovered: 0, strikes: 0, shortStrikes: 0, spreadStrikes: 0,
  bassRoot: 0, bassFifth: 0, bassThird: 0, bassSeventh: 0, bassOther: 0,
  minInterval: {}, spanUnderOctave: 0, lowClosePair: 0, notes56to63: 0, notes57to81: 0,
  stringsBars: 0, stringsStrikes: 0, stringsOverlap: 0, maxSimult: 0, over8: 0, overLow: 0, kinds: {},
});

const lines: string[] = [];
const floorLines: string[] = [];
const spanDumps: string[] = [];
const bassDumps: string[] = [];
const spreadDumps: string[] = [];

for (const templateId of TEMPLATES) {
  const short = templateId.replace('ensemble.', '');
  const template = resolveTemplate({ templateId, overrides: {}, pins: {} })!;
  const a = blank();
  let floorSum = 0, floorBelow = 0, keysNotesSum = 0;

  for (const [fixTag, doc] of [['three', threeChorus], ['dorian', dorian]] as const) {
    const sixteenth = PPQ / 4;
    for (let take = 1; take <= 10; take++) {
      a.runs++;
      const { project, result } = compose(doc, templateId, take);
      const btBar = barTicks(project.timeSignature);
      const beat = beatTicks(project.timeSignature);
      const bars = projectBars(project);
      const spans = chordSpans(project);
      const keysPlan = result.plan.keys;
      const normAt = new Map<number, number>(keysPlan.bars.map((b) => [b.bar, b.norm]));
      const kindAt = new Map<number, string>();
      for (const b of keysPlan.bars) {
        const k = b.voices.piano;
        if (k) kindAt.set(b.bar, k);
      }
      const momentBars = new Set<number>();
      for (const m of result.plan.moments) for (let b = m.startBar; b <= m.endBar; b++) momentBars.add(b);
      const piano = project.tracks.find((t) => t.role === 'piano');
      const violas = project.tracks.find((t) => t.role === 'violas');
      const cellos = project.tracks.find((t) => t.role === 'cellosBasses');
      const pNotes: Note[] = piano?.notes ?? [];
      const vNotes: Note[] = violas?.notes ?? [];
      const cNotes: Note[] = cellos?.notes ?? [];

      // --- 1. the arc + 4. the old-presence map ---
      for (let bar = 1; bar <= bars; bar++) {
        const sec = secOf(doc, bar);
        const chorus = isChorusTypeK(sec?.name);
        const norm = normAt.get(bar) ?? 0;
        const kind = kindAt.get(bar);
        if (kind) a.kinds[kind] = (a.kinds[kind] ?? 0) + 1;
        if (chorus) {
          if (!momentBars.has(bar)) {
            a.chorusWindows += 4;
            if (norm >= 0.72) a.chorusHigh += 4;
            if (norm >= 0.9) a.chorusPeak += 4;
          }
        } else {
          a.nonChorusBars++;
          if (kind) a.nonChorusActive++;
        }
      }

      // --- 2/3. the piano numbers ---
      const chorusBar = (n: Note) => {
        const bar = Math.floor(n.startTick / btBar) + 1;
        return isChorusTypeK(secOf(doc, bar)?.name);
      };
      for (const n of pNotes) {
        a.pianoNotes++;
        if (chorusBar(n)) {
          a.chorusNotes++;
          if (n.pitch < 55) a.chorusBelow55++;
          if (n.pitch < 60) a.chorusBelow60++;
        }
        if (n.pitch >= 56 && n.pitch <= 63) a.notes56to63++;
        if (n.pitch >= 57 && n.pitch <= 81) a.notes57to81++;
      }
      // beat continuity in piano-active bars
      const activeBars = new Set(pNotes.map((n) => Math.floor(n.startTick / btBar) + 1));
      for (const bar of activeBars) {
        const s = (bar - 1) * btBar;
        for (let i = 0; i < 4; i++) {
          const ws = s + i * beat;
          if (ws >= bars * btBar) break;
          a.beats++;
          if (pNotes.some((n) => n.startTick <= ws + 24 && n.startTick + n.durationTicks > ws && n.durationTicks >= beat - 1)) a.beatsCovered++;
        }
      }
      // strikes: onset groups with a 60-tick tolerance (the jitter splits
      // one strike's voices across adjacent ticks; the roll's 60-tick
      // stagger is one strike too)
      const sortedNotes = [...pNotes].sort((x, y) => x.startTick - y.startTick);
      const byOnset = new Map<number, Note[]>();
      for (const n of sortedNotes) {
        let key: number | null = null;
        for (const k of byOnset.keys()) { if (Math.abs(k - n.startTick) <= 60) { key = k; break; } }
        if (key === null) { byOnset.set(n.startTick, [n]); continue; }
        byOnset.get(key)!.push(n);
      }
      const stringsLowBars = new Set<number>();
      const overlapApplies = templateId === 'ensemble.chamber' || templateId === 'ensemble.sonata';
      for (let bar = 1; bar <= bars; bar++) {
        if (!overlapApplies) break;
        const s = (bar - 1) * btBar, e = bar * btBar;
        const low = [...vNotes, ...cNotes].some((n) => n.startTick < e && n.startTick + n.durationTicks > s && n.pitch <= 71);
        if (low) stringsLowBars.add(bar);
      }
      for (const [onset, group] of [...byOnset.entries()].sort((x, y) => x[0] - y[0])) {
        if (group.length < 2) continue;
        // the sounding set at the strike: the onset group plus every held
        // note still ringing (the measure the doubling audit and the ear use)
        const sounding = pNotes.filter((n) => n.startTick < onset + 60 && n.startTick + n.durationTicks >= onset);
        const pitches = [...new Set(sounding.map((g) => g.pitch))].sort((x, y) => x - y);
        const maxDur = Math.max(...group.map((g) => g.durationTicks));
        const minDur = Math.min(...group.map((g) => g.durationTicks));
        if (group.length >= 3) {
          a.strikes++;
          if (maxDur <= beat) a.shortStrikes++;
          if (maxDur - minDur > sixteenth) { a.spreadStrikes++; if (spreadDumps.length < 6 && (short === 'vocalbacking' || short === 'chamber')) spreadDumps.push(`${short} ${fixTag} t${take} b${Math.floor(onset / btBar) + 1}: [${group.map((g) => `${g.pitch}:${g.durationTicks}`).join(' ')}]`); }
          if (pitches[pitches.length - 1] - pitches[0] < 12 && spanDumps.length < 8 && (short === 'vocalbacking' || short === 'chamber')) spanDumps.push(`${short} ${fixTag} t${take} b${Math.floor(onset / btBar) + 1}: [${pitches.join(',')}] dur=[${sounding.filter((n) => pitches.includes(n.pitch)).map((n) => n.durationTicks).join(',')}]`);
          const bar = Math.floor(onset / btBar) + 1;
          const sp = spans.find((s) => s.startTick <= onset && onset < s.endTick) ?? spans[0];
          const ct = chordTones(sp.parsed);
          const rootTone = ct.tones.find((t) => t.tier === 'root');
          const rootPc = pcOf(rootTone?.pc ?? ct.bassPc);
          const bassPc = pcOf(pitches[0]);
          const iv = ((bassPc - rootPc) % 12 + 12) % 12;
          if (iv === 0) a.bassRoot++;
          else if (iv === 7) a.bassFifth++;
          else if (iv === 3 || iv === 4) { a.bassThird++; if (bassDumps.length < 8 && short === 'vocalbacking') bassDumps.push(`${short} ${fixTag} t${take} b${Math.floor(onset / btBar) + 1}: bass ${pitches[0]} iv=${iv} [${pitches.join(',')}] dur=[${sounding.filter((n) => pitches.includes(n.pitch)).map((n) => n.durationTicks).join(',')}]`); }
          else if (iv === 10 || iv === 11) a.bassSeventh++;
          else a.bassOther++;
          if (pitches[pitches.length - 1] - pitches[0] < 12) a.spanUnderOctave++;
          if (pitches[0] < 60 && pitches[1] - pitches[0] < 7) a.lowClosePair++;
          if (stringsLowBars.has(bar)) {
            a.stringsStrikes++;
            const rhBottom = pitches.find((p) => p >= 60);
            if (rhBottom !== undefined && rhBottom <= 71) a.stringsOverlap++;
          }
        }
        for (let i = 1; i < pitches.length; i++) {
          const iv = pitches[i] - pitches[i - 1];
          const label = iv <= 2 ? '<3' : iv === 3 || iv === 4 ? '3-4' : iv === 5 || iv === 6 ? '5-6' : iv === 7 || iv === 8 || iv === 9 ? '7-9' : '10+';
          a.minInterval[label] = (a.minInterval[label] ?? 0) + 1;
        }
      }
      // concurrency (sweep at every onset)
      const onsets = [...byOnset.keys()].sort((x, y) => x - y);
      for (const t of onsets) {
        const sounding = pNotes.filter((n) => n.startTick <= t && n.startTick + n.durationTicks > t).length;
        a.maxSimult = Math.max(a.maxSimult, sounding);
        if (sounding > 8) a.over8++;
        const lowN = pNotes.filter((n) => n.startTick <= t && n.startTick + n.durationTicks > t && n.pitch < 55).length;
        if (lowN > 2) a.overLow++;
      }
      a.notes57to81; // vb zone check (report only)

      // --- 5. the floor baseline (three-chorus only, the floor test's own scope) ---
      if (fixTag === 'three') {
        const report = measureEnergy(project, template);
        for (const w of report.windows) {
          const sec = secOf(doc, w.bar);
          if (!sec || !isChorusTypeK(sec.name) || momentBars.has(w.bar)) continue;
          floorSum += w.energy;
          if (w.energy > 0 && w.energy < template.budget.energyClamp[0]) floorBelow++;
        }
        keysNotesSum += pNotes.filter((n) => chorusBar(n)).length;
      }
    }
  }

  const pct = (x: number, y: number) => (y ? ((x / y) * 100).toFixed(1) + '%' : 'n/a');
  lines.push(
    `${short} (${a.runs} runs):`,
    `  arc: chorus windows ${a.chorusWindows}, >=0.72: ${pct(a.chorusHigh, a.chorusWindows)}, >=0.90: ${pct(a.chorusPeak, a.chorusWindows)} | non-chorus bars ${a.nonChorusBars}, piano-active ${a.nonChorusActive}`,
    `  kinds: ${Object.entries(a.kinds).map(([k, v]) => `${k}=${v}`).join(', ')}`,
    `  beat continuity: ${pct(a.beatsCovered, a.beats)} | short strikes: ${pct(a.shortStrikes, a.strikes)} | spread >16th: ${pct(a.spreadStrikes, a.strikes)}`,
    `  chorus below-55: ${pct(a.chorusBelow55, a.chorusNotes)}, below-60: ${pct(a.chorusBelow60, a.chorusNotes)} | notes 56-63: ${a.notes56to63}, 57-81: ${a.notes57to81}`,
    `  bass: root ${pct(a.bassRoot, a.strikes)}, fifth ${pct(a.bassFifth, a.strikes)}, THIRD ${pct(a.bassThird, a.strikes)}, SEVENTH ${pct(a.bassSeventh, a.strikes)}, other ${pct(a.bassOther, a.strikes)}`,
    `  span<8ve: ${a.spanUnderOctave}/${a.strikes} | low-close-pair: ${a.lowClosePair}/${a.strikes}`,
    `  intervals: ${Object.entries(a.minInterval).map(([k, v]) => `${k}=${v}`).join(', ')}`,
    `  strings overlap (chamber/sonata): ${a.stringsOverlap}/${a.stringsStrikes} strikes`,
    `  concurrency: max ${a.maxSimult}, windows>8: ${a.over8}, low>2: ${a.overLow}`,
  );
  floorLines.push(`${short}: excl-moments chorus energy sum ${floorSum.toFixed(2)}, below-floor ${floorBelow}, chorus piano notes ${keysNotesSum}`);
}

console.log('=== PHASE 11.6 PRE-FLIGHT (BEFORE, at c04fb2e) ===\n' + lines.join('\n'));
console.log('\n=== floor baseline (three-chorus, t1-10, moments excluded) ===\n' + floorLines.join('\n'));
if (spanDumps.length) console.log('\nspan<8ve dumps:\n  ' + spanDumps.join('\n  '));
if (bassDumps.length) console.log('\nbass dumps:\n  ' + bassDumps.join('\n  '));
if (spreadDumps.length) console.log('\nspread dumps:\n  ' + spreadDumps.join('\n  '));
if (spreadDumps.length) console.log('\nspread dumps:\n  ' + spreadDumps.join('\n  '));
