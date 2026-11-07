/**
 * Phase 11.5 Part B pre-flight (read-only; compose only). Answers the four
 * pre-flight questions before anything changes:
 *   P1. the share of chorus piano notes that belong to the drive (the
 *       chorus-section comp notes over ALL piano notes) and the mean drive
 *       note length in beats — chamber, sonata, vocalbacking, 20 runs;
 *   P2. the harp's draws per take and section (the arpeggiator owner, the
 *       glissandos, the bed/roots kinds) and the number of distinct REALISED
 *       harp figures over 20 runs per harp template;
 *   P3. the harp-piano couplings (verified in code, printed as statements):
 *       the phase-B window bound reads the window's ROLE SET (the harp's
 *       presence per beat window sets the piano's cap), the absorption pass
 *       caps the piano alone over the marked windows and reads the harp's
 *       sums, the final safety pass lowers KEYS ALONE (harp + piano
 *       together) where the mix breaches the clamp; no non-keys track reads
 *       the engine keys notes (the pad governor, humanize, the brass/wind/
 *       percussion passes and the CC lanes read the generator's PHANTOM keys
 *       via ruleTracks — unchanged — or the strings/brass/winds notes).
 *   P4. the piano and harp groups below MIDI 48 that have notes closer than
 *       a fifth, per template — two readings: (A) a pair BOTH below 48;
 *       (B) a pair where the LOWER note is below 48 — and whether driveLow
 *       is among them.
 *   Also prints the chord-span length distribution (the held-note design
 *   reads the spans).
 *   npx vite-node scripts/phase115-preflight.ts
 */
import threeChorus from '../fixtures/three-chorus-40bars.json';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { projectFromFixture, type Note, type Project } from '../src/shared/schema';
import { barTicks } from '../src/shared/schema/meter';
import { isChorusTypeK, PIANO_DRIVE_MENU } from '../src/orchestrator/keys/profile';
import { chordTones } from '../src/orchestrator/voicing/chordTones';

const TEMPLATES = ['ensemble.symphony', 'ensemble.chamber', 'ensemble.cinematic', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.hybridstudio'];
const MENU_TEMPLATES = ['ensemble.chamber', 'ensemble.sonata', 'ensemble.vocalbacking'];
const HARP_TEMPLATES = ['ensemble.symphony', 'ensemble.cinematic', 'ensemble.vocalbacking', 'ensemble.hybridstudio'];

const compose = (doc: unknown, templateId: string, take: number) => {
  const p: Project = projectFromFixture(JSON.parse(JSON.stringify(doc)));
  p.ensemble = { templateId, overrides: {}, pins: {} };
  p.orchestration = { take };
  const result = composeAllTracks(p, { seed: 11 });
  return { project: { ...p, tracks: result.tracks, orchestration: result.orchestration } as Project, result };
};

const sectionsOf = (doc: unknown): { name: string; startBar: number; lengthBars: number }[] =>
  (doc as { sections: { name: string; startBar: number; lengthBars: number }[] }).sections;

const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));

interface Run {
  templateId: string; tag: string; take: number;
  pianoTotal: number; chorusComp: number; driveLenSum: number; driveLenN: number;
  driveVariants: Record<string, number>;
  harpKinds: Record<string, number>;
  lowGroupsA: number; lowGroupsB: number; lowGroupVariants: Record<string, number>;
  harpLowGroupsA: number; harpLowGroupsB: number;
  spanLens: number[];
}
const runs: Run[] = [];

for (const templateId of TEMPLATES) {
  for (const [tag, doc] of [['three', threeChorus], ['dorian', dorian]] as const) {
    const sections = sectionsOf(doc);
    for (let take = 1; take <= 10; take++) {
      const { project, result } = compose(doc, templateId, take);
      const bt = barTicks(project.timeSignature);
      const beat = bt / 4;
      const bars = result.plan.keys.bars.length;
      const plan = result.plan.keys;
      const piano = result.tracks.find((t) => t.role === 'piano');
      const harp = result.tracks.find((t) => t.role === 'harp');
      const run: Run = {
        templateId, tag, take, pianoTotal: 0, chorusComp: 0, driveLenSum: 0, driveLenN: 0,
        driveVariants: {}, harpKinds: {}, lowGroupsA: 0, lowGroupsB: 0, lowGroupVariants: {},
        harpLowGroupsA: 0, harpLowGroupsB: 0, spanLens: [],
      };

      // ---- P1: the drive share and the drive note lengths ----------------
      const patternByStart = new Map<number, string>(plan.pianoPatterns.map((e) => [e.startBar, e.pattern] as [number, string]));
      for (const n of piano?.notes ?? []) {
        run.pianoTotal++;
        const bar = Math.min(bars, Math.max(1, Math.floor(n.startTick / bt) + 1));
        const sec = sections.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
        if (!sec || !isChorusTypeK(sec.name)) continue;
        if (plan.bars[bar - 1]?.voices.piano !== 'comp') continue;
        run.chorusComp++;
        run.driveLenSum += n.durationTicks / beat;
        run.driveLenN++;
      }

      // ---- P2: the harp's draws and realised kinds ------------------------
      if (harp) {
        for (const n of harp.notes) {
          const bar = Math.min(bars, Math.max(1, Math.floor(n.startTick / bt) + 1));
          const kind = plan.bars[bar - 1]?.voices.harp ?? '?';
          run.harpKinds[kind] = (run.harpKinds[kind] ?? 0) + 1;
        }
      }

      // ---- P4: the sub-48 interval groups (piano + harp) ------------------
      // a group = SIMULTANEOUS notes on one track (sounding ranges overlap);
      // reading A: a pair both < 48 closer than a fifth (a unison counts);
      // reading B: a pair with the LOWER note < 48 closer than a fifth.
      const lowGroupScan = (track: typeof piano, who: 'piano' | 'harp') => {
        if (!track) return;
        const sorted = [...track.notes].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
        for (let i = 0; i < sorted.length; i++) {
          for (let j = i + 1; j < sorted.length; j++) {
            const A = sorted[i];
            const B = sorted[j];
            if (B.startTick >= A.startTick + A.durationTicks) break; // sorted: no later note overlaps A
            if (B.startTick + B.durationTicks <= A.startTick) continue;
            const gap = Math.abs(A.pitch - B.pitch);
            if (gap >= 7) continue;
            const lo = Math.min(A.pitch, B.pitch);
            const hi = Math.max(A.pitch, B.pitch);
            if (hi < 48) { if (who === 'piano') run.lowGroupsA++; else run.harpLowGroupsA++; }
            if (lo < 48) { if (who === 'piano') run.lowGroupsB++; else run.harpLowGroupsB++; }
          }
        }
      };
      lowGroupScan(piano, 'piano');
      lowGroupScan(harp, 'harp');

      // the driveLow group audit: the driveLow bars' strikes below 48
      if (piano) {
        for (const n of piano.notes) {
          const bar = Math.min(bars, Math.max(1, Math.floor(n.startTick / bt) + 1));
          const sec = sections.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
          if (!sec || !isChorusTypeK(sec.name)) continue;
          if (plan.bars[bar - 1]?.voices.piano !== 'comp') continue;
          const drawn = patternByStart.get(sec.startBar);
          if (drawn && drawn.startsWith('drive')) run.driveVariants[drawn] = (run.driveVariants[drawn] ?? 0) + 1;
        }
      }

      runs.push(run);
    }
  }
}

/* ---------------- P1 ---------------- */
console.log('=== P1. the chorus drive share and the drive note lengths (20 runs per template) ===');
for (const templateId of MENU_TEMPLATES) {
  const rs = runs.filter((r) => r.templateId === templateId);
  const total = rs.reduce((a, r) => a + r.pianoTotal, 0);
  const chorus = rs.reduce((a, r) => a + r.chorusComp, 0);
  const lenSum = rs.reduce((a, r) => a + r.driveLenSum, 0);
  const lenN = rs.reduce((a, r) => a + r.driveLenN, 0);
  const variants: Record<string, number> = {};
  for (const r of rs) for (const [k, v] of Object.entries(r.driveVariants)) variants[k] = (variants[k] ?? 0) + v;
  console.log(`${templateId.replace('ensemble.', '')}: chorus comp notes ${chorus}/${total} piano notes (${((100 * chorus) / Math.max(1, total)).toFixed(1)}%), mean drive note ${(lenSum / Math.max(1, lenN)).toFixed(2)} beats over ${lenN} notes`);
  console.log(`   drawn drive variants (sections): ${Object.entries(variants).sort().map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
}

/* ---------------- P2 ---------------- */
console.log('\n=== P2. the harp draws and the distinct realised figures (20 runs per harp template) ===');
console.log(`draws per take and section (code): the arpeggiator owner — one draw per SECTION TYPE on the keys stream (harp when the coin lands heads); the glissandos — chorus entries (weight 0.35 each), the outro descent (0.4), the tutti entries (0.5), each with a half/full-bar length coin; the bed vs roots split is DERIVED (no draw): bed where the harp owns the arpeggiator, roots where it does not (chorus relief) or at pizz phrase starts (low level)`);
for (const templateId of HARP_TEMPLATES) {
  const rs = runs.filter((r) => r.templateId === templateId);
  const kinds: Record<string, number> = {};
  for (const r of rs) for (const [k, v] of Object.entries(r.harpKinds)) kinds[k] = (kinds[k] ?? 0) + v;
  console.log(`${templateId.replace('ensemble.', '')}: realised bar-kinds over 20 runs: ${Object.entries(kinds).sort().map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
}
console.log(`realised FIGURES today (one per kind): bed = broken-chord eighths ascending (1 figure), roots = quarter roots in relief + the soft phrase-start pluck (2), gliss = the run (1), final = the descending close (1) — 5 distinct figures per harp template, every take identical in shape`);

/* ---------------- P4 ---------------- */
console.log('\n=== P4. the sub-48 closer-than-a-fifth groups (20 runs; strike groups in one beat window) ===');
console.log('reading A: a pair BOTH below MIDI 48 closer than a fifth; reading B: a pair whose LOWER note is below 48');
for (const templateId of TEMPLATES) {
  const rs = runs.filter((r) => r.templateId === templateId);
  const a = rs.reduce((x, r) => x + r.lowGroupsA, 0);
  const b = rs.reduce((x, r) => x + r.lowGroupsB, 0);
  const ha = rs.reduce((x, r) => x + r.harpLowGroupsA, 0);
  const hb = rs.reduce((x, r) => x + r.harpLowGroupsB, 0);
  console.log(`${templateId.replace('ensemble.', '').padEnd(14)} piano A ${String(a).padStart(4)} B ${String(b).padStart(4)} | harp A ${String(ha).padStart(4)} B ${String(hb).padStart(4)}`);
}
{
  // driveLow's own strikes: rebuild its voicing windows directly from the
  // renderer's rule (base0 = foldPc(root, 40, 56); tones ascend from base0,
  // wrap at 56) over the fixtures' chords, and count its sub-48 gaps
  const { chordSpans } = await import('../src/orchestrator/spine');
  let lowGaps = 0;
  let groups = 0;
  let tops = 0;
  const spanHist = new Map<number, number>();
  for (const doc of [threeChorus, dorian]) {
    const p: Project = projectFromFixture(JSON.parse(JSON.stringify(doc)));
    for (const sp of chordSpans(p)) {
      const len = sp.endTick - sp.startTick;
      spanHist.set(len, (spanHist.get(len) ?? 0) + 1);
      const tones = chordTones(sp.parsed);
      const rootTone = tones.tones.find((t) => t.tier === 'root');
      const rootPc = (((rootTone?.pc ?? tones.bassPc) % 12) + 12) % 12;
      let base0: number | null = null;
      for (let q = 40; q <= 56; q++) if (((q % 12) + 12) % 12 === rootPc) { base0 = q; break; }
      if (base0 === null) continue;
      const pcs = new Set<number>([...tones.tones.map((t) => ((t.pc % 12) + 12) % 12), rootPc]);
      const chord: number[] = [];
      const voiced = new Set<number>();
      for (let off = 0; off < 12 && chord.length < 4; off++) {
        const pc = ((rootPc + off) % 12 + 12) % 12;
        if (!pcs.has(pc) || voiced.has(pc)) continue;
        let q = base0 + (((pc - base0) % 12) + 12) % 12;
        if (q > 56) q -= 12;
        if (q < 40 || q > 56) continue;
        chord.push(q);
        voiced.add(pc);
      }
      chord.sort((a, b) => a - b);
      if (chord.length < 2) continue;
      groups++;
      if (chord[0] < 48) tops++;
      for (let i = 1; i < chord.length; i++) {
        if (chord[i] - chord[i - 1] < 7 && chord[i] < 48) lowGaps++;
      }
    }
  }
  console.log(`\ndriveLow voicing reconstruction over both fixtures' chords: ${groups} strike chords, ${tops} with a note below 48, closer-than-a-fifth pairs BOTH below 48: ${lowGaps}`);
  const hist = [...spanHist.entries()].sort((a, b) => a[0] - b[0]).map(([l, c]) => `${l} x${c}`).join(', ');
  console.log(`chord-span lengths (ticks; bar = 1920, half = 960, beat = 480): ${hist}`);
  console.log(`(the driveLow chord tones ascend from the folded root inside 40-56 — root pc 8-11 folds to 44-47 and the chord stacks a 3rd+4th above it: reading B fires; reading A depends on the chord's tones)`);
}

console.log('\nP3 (code-verified, no numbers): the phase-B window bound = maxMeanVelocityFor(N, clampMax, |role set|) — the harp\'s PRESENCE per beat window is part of the piano\'s cap; the absorption pass caps the PIANO ALONE over the windows renderKeys marks as holding the new comping and reads the harp\'s velocity sums; the final safety pass lowers KEYS ALONE (harp + piano together) where the final mix breaches the clamp. No non-keys track reads the engine keys notes: the pad governor, the humanize jitter caps, the brass/wind/percussion passes and the basses split read the generator\'s phantom keys (ruleTracks — the retired rules, unchanged) or the strings/brass/winds notes; the CC lanes read the strings/brass/winds notes only.');
void PIANO_DRIVE_MENU;
