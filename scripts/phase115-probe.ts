/**
 * Phase 11.5 probe — the rules and the targets over the survey (read-only):
 *   - the hard findings and the aboveMax counts per run (the clamp);
 *   - the chorus-mean floor vs golden104 (excl moments both sides) + the
 *     below-floor counts;
 *   - the chorus peaks vs the clamp;
 *   - the block drive's share of chorus bars (realized);
 *   - the realized chorus piano figures per template;
 *   - the realized harp figures per template and per section type;
 *   - the non-chorus piano notes per run (before/after);
 *   - the vocalbacking register split and the vocal zone;
 *   - the low-interval rule (reading A and B, piano + harp);
 *   - the harp ergonomics (simultaneous notes, same pitch in a beat);
 *   - the note lengths (<= 1 bar, no ring across a tacet/soli/near-silence
 *     bar, nothing crossing a moment boundary).
 *   npx vite-node scripts/phase115-probe.ts
 */
import threeChorus from '../fixtures/three-chorus-40bars.json';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { checkTemplateRules, measureEnergy } from '../src/orchestrator/energy';
import { projectFromFixture, type Note, type Project } from '../src/shared/schema';
import { barTicks, projectBars } from '../src/shared/schema/meter';
import { resolveTemplate } from '../src/config/ensembles';
import { isChorusTypeK, KEYS_GATES, PIANO_CHORUS_FIGURE_MENU } from '../src/orchestrator/keys/profile';
import { momentForBar } from '../src/orchestrator/conductor/moments';
import { readFileSync } from 'node:fs';

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

const hardFails: string[] = [];
const aboveMaxFails: string[] = [];
const zoneFails: string[] = [];
const lowIntervalFails: string[] = [];
const ergFails: string[] = [];
const lengthFails: string[] = [];
const chorusBarFigure = new Map<string, Map<string, number>>(); // template|type -> figure -> bars
const harpUnitFigure = new Map<string, Map<string, number>>(); // template|type -> figure -> units
const harpSequence = new Map<string, Set<string>>();
const nonChorusNotes = new Map<string, number[]>();
const vbSplit = { sparkle: 0, low: 0, other: 0, total: 0 };
const floorAccum = new Map<string, { b: number; a: number; bb: number; ab: number; peak: number; n: number }>();

for (const templateId of TEMPLATES) {
  const short = templateId.replace('ensemble.', '');
  for (const [tag, doc] of [['three', threeChorus], ['dorian', dorian]] as const) {
    const sections = sectionsOf(doc);
    for (let take = 1; take <= 10; take++) {
      const { project, result } = compose(doc, templateId, take);
      const template = resolveTemplate(project.ensemble)!;
      const bt = barTicks(project.timeSignature);
      const beat = bt / 4;
      const bars = projectBars(project);
      const plan = result.plan.keys;

      // the rules
      const findings = checkTemplateRules(project, template, result.plan).filter((f) => f.severity === 'hard');
      if (findings.length) hardFails.push(`${short}-${tag}-t${take}: ${findings.map((f) => f.message).join('; ')}`);
      const rep = measureEnergy(project, template);
      const above = rep.violations.filter((v) => v.kind === 'aboveMax');
      if (above.length) aboveMaxFails.push(`${short}-${tag}-t${take}: ${above.length}`);

      // the zone, the low-interval rule, the ergonomics, the lengths
      for (const role of ['piano', 'harp'] as const) {
        const t = project.tracks.find((x) => x.role === role);
        if (!t) continue;
        const sorted = [...t.notes].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
        for (const n of sorted) {
          const bar = Math.floor(n.startTick / bt) + 1;
          if (templateId === 'ensemble.vocalbacking' && n.pitch >= 57 && n.pitch <= 81) zoneFails.push(`${short}-${tag}-t${take}: ${role} note ${n.pitch} in the zone`);
          if (n.durationTicks > bt) lengthFails.push(`${short}-${tag}-t${take}: ${role} note ${n.pitch} rings ${n.durationTicks} > 1 bar`);
          // the ring boundary: a note must not cross into a tacet/soli/near-silence bar or any moment bar
          const startBar = Math.floor(n.startTick / bt) + 1;
          const endTick = n.startTick + n.durationTicks;
          for (let b = startBar; b <= bars; b++) {
            const bs = (b - 1) * bt;
            if (bs >= endTick) break;
            if (b === startBar) continue;
            const m = momentForBar(result.plan.moments ?? [], b);
            const near = project.tracks.length ? (result as unknown as { plan: { arc?: { nearSilence?: boolean }[] } }).plan?.arc?.[b - 1]?.nearSilence : false;
            if (m || near) { lengthFails.push(`${short}-${tag}-t${take}: ${role} note ${n.pitch} rings across bar ${b} (${m?.kind ?? 'near-silence'})`); break; }
          }
        }
        // the low-interval pairs (simultaneous)
        for (let i = 0; i < sorted.length; i++) {
          for (let j = i + 1; j < sorted.length; j++) {
            const A = sorted[i]; const B = sorted[j];
            if (B.startTick >= A.startTick + A.durationTicks) break;
            if (B.startTick + B.durationTicks <= A.startTick) continue;
            const gap = Math.abs(A.pitch - B.pitch);
            const lo = Math.min(A.pitch, B.pitch); const hi = Math.max(A.pitch, B.pitch);
            if (gap < 7 && hi < 48) lowIntervalFails.push(`${short}-${tag}-t${take}: ${role} pair ${lo}/${hi} gap ${gap} both < 48`);
            // the harp ergonomics: no same pitch twice within a beat window
            if (role === 'harp' && gap === 0) {
              const wA = Math.floor(A.startTick / beat); const wB = Math.floor(B.startTick / beat);
              if (wA === wB && Math.floor(A.startTick / bt) === Math.floor(B.startTick / bt)) ergFails.push(`${short}-${tag}-t${take}: harp pitch ${A.pitch} twice in beat ${wA}`);
            }
          }
        }
        // the harp ergonomics: simultaneous count
        if (role === 'harp') {
          const onsets = [...new Set(sorted.map((n) => n.startTick))].sort((a, b) => a - b);
          for (const o of onsets) {
            let count = 0;
            for (const n of sorted) {
              if (n.startTick > o) break;
              if (n.startTick + n.durationTicks > o) count++;
            }
            if (count > 8) ergFails.push(`${short}-${tag}-t${take}: ${count} simultaneous harp notes at tick ${o}`);
          }
        }
      }

      // the realized chorus piano figures (from the plan's phrase figures +
      // the notes actually sounding in the phrase)
      if (MENU_TEMPLATES.includes(templateId)) {
        for (const sec of sections) {
          if (!isChorusTypeK(sec.name)) continue;
          const figs = plan.chorusFigures.find((e) => e.startBar === sec.startBar)?.figures ?? [];
          const nPhrases = Math.max(1, Math.ceil(sec.lengthBars / 4));
          for (let ph = 0; ph < nPhrases; ph++) {
            const fig = figs[Math.min(ph, figs.length - 1)] ?? '?';
            const b0 = sec.startBar + ph * 4;
            const b1 = Math.min(b0 + 4, sec.startBar + sec.lengthBars);
            let sounded = false;
            const piano = project.tracks.find((t) => t.role === 'piano');
            for (const n of piano?.notes ?? []) {
              const bar = Math.floor(n.startTick / bt) + 1;
              if (bar >= b0 && bar < b1) { sounded = true; break; }
            }
            if (!sounded) continue;
            const key = `${short}|chorus`;
            if (!chorusBarFigure.has(key)) chorusBarFigure.set(key, new Map());
            const m = chorusBarFigure.get(key)!;
            m.set(fig, (m.get(fig) ?? 0) + (b1 - b0));
          }
        }
        // the non-chorus piano notes per run
        let count = 0;
        const piano = project.tracks.find((t) => t.role === 'piano');
        for (const n of piano?.notes ?? []) {
          const bar = Math.min(bars, Math.max(1, Math.floor(n.startTick / bt) + 1));
          const sec = sections.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
          if (sec && !isChorusTypeK(sec.name)) count++;
        }
        if (!nonChorusNotes.has(short)) nonChorusNotes.set(short, []);
        nonChorusNotes.get(short)!.push(count);
      }

      // the realized harp figures (from the notes sounding in each 2-bar unit)
      if (HARP_TEMPLATES.includes(templateId)) {
        const harp = project.tracks.find((t) => t.role === 'harp');
        const seq: string[] = [];
        for (const sec of sections) {
          const figs = plan.harpFigures.find((e) => e.startBar === sec.startBar)?.figures ?? [];
          const type = sec.name.trim().toLowerCase();
          const nUnits = Math.max(1, Math.ceil(sec.lengthBars / 2));
          for (let u = 0; u < nUnits; u++) {
            const fig = figs[Math.min(u, figs.length - 1)] ?? '?';
            const b0 = sec.startBar + u * 2;
            const b1 = Math.min(b0 + 2, sec.startBar + sec.lengthBars);
            let sounded = false;
            for (const n of harp?.notes ?? []) {
              const bar = Math.floor(n.startTick / bt) + 1;
              if (bar >= b0 && bar < b1) { sounded = true; break; }
            }
            if (!sounded) continue;
            const key = `${short}|${type}`;
            if (!harpUnitFigure.has(key)) harpUnitFigure.set(key, new Map());
            const m = harpUnitFigure.get(key)!;
            m.set(fig, (m.get(fig) ?? 0) + 1);
            seq.push(`${type}:${fig}`);
          }
        }
        if (!harpSequence.has(short)) harpSequence.set(short, new Set());
        harpSequence.get(short)!.add(seq.join(' '));
      }

      // the vocalbacking register split
      if (templateId === 'ensemble.vocalbacking') {
        const piano = project.tracks.find((t) => t.role === 'piano');
        for (const n of piano?.notes ?? []) {
          vbSplit.total++;
          if (n.pitch >= 82) vbSplit.sparkle++;
          else if (n.pitch < 57) vbSplit.low++;
          else vbSplit.other++;
        }
      }

      // the chorus-mean floor vs golden104 (three-chorus only, 10 takes)
      if (tag === 'three') {
        const golden = JSON.parse(readFileSync(new URL(`../tests/golden104/${short}-three-t${take}.json`, import.meta.url), 'utf8'));
        const base = projectFromFixture(JSON.parse(JSON.stringify(threeChorus)));
        base.ensemble = { templateId, overrides: {}, pins: {} };
        const momentBars = new Set<number>();
        for (const m of golden.moments ?? []) for (let b = m.startBar; b <= m.endBar; b++) momentBars.add(b);
        const beforeTracks = (golden.tracks as { id: string; role: string; notes: Note[] }[]).map((gt) => {
          const donor = base.tracks.find((x) => x.id === gt.id);
          if (donor) return { ...donor, notes: gt.notes };
          return { id: gt.id, role: gt.role, name: gt.role, family: 'Strings', kind: 'instrument', locked: false, notes: gt.notes, lowestNote: 21, highestNote: 108, volume: 0.8, pan: 0 } as unknown as typeof base.tracks[number];
        });
        const chorusStats = (proj: Project) => {
          const r = measureEnergy(proj, template);
          let sum = 0, n = 0, below = 0, peak = 0;
          for (const w of r.windows) {
            const sec = sections.find((s) => w.bar >= s.startBar && w.bar < s.startBar + s.lengthBars);
            if (!sec || !isChorusTypeK(sec.name)) continue;
            if (!momentBars.has(w.bar)) { sum += w.energy; n++; if (w.energy > 0 && w.energy < template.budget.energyClamp[0]) below++; }
            peak = Math.max(peak, w.energy);
          }
          return { sum, n, below, peak };
        };
        const before = chorusStats({ ...base, tracks: beforeTracks } as Project);
        const after = chorusStats(project);
        if (!floorAccum.has(short)) floorAccum.set(short, { b: 0, a: 0, bb: 0, ab: 0, peak: 0, n: 0 });
        const acc = floorAccum.get(short)!;
        acc.b += before.sum; acc.a += after.sum; acc.bb += before.below; acc.ab += after.below;
        acc.peak = Math.max(acc.peak, after.peak); acc.n += after.n;
      }
    }
  }
}

console.log('=== the rules ===');
console.log(`hard findings: ${hardFails.length === 0 ? '0 (clean)' : hardFails.slice(0, 6).join('\n')}`);
console.log(`aboveMax: ${aboveMaxFails.length === 0 ? '0 (clean)' : aboveMaxFails.slice(0, 6).join('\n')}`);
console.log(`vocal zone (piano+harp, VB): ${zoneFails.length === 0 ? '0 notes (clean)' : zoneFails.slice(0, 6).join('\n')}`);
console.log(`low-interval pairs (both < 48, < 7 apart): ${lowIntervalFails.length === 0 ? '0 (clean)' : lowIntervalFails.slice(0, 6).join('\n')}`);
console.log(`harp ergonomics: ${ergFails.length === 0 ? '0 (clean)' : ergFails.slice(0, 6).join('\n')}`);
console.log(`note lengths: ${lengthFails.length === 0 ? '0 (clean)' : lengthFails.slice(0, 6).join('\n')}`);

console.log('\n=== the chorus piano figures (realized bars per figure, 20 runs per template) ===');
for (const [key, m] of [...chorusBarFigure.entries()].sort()) {
  const total = [...m.values()].reduce((a, b) => a + b, 0);
  const block = (m.get('driveBlock') ?? 0) + (m.get('driveInvert') ?? 0) + (m.get('driveOpen') ?? 0) + (m.get('driveTight') ?? 0) + (m.get('driveLow') ?? 0) + (m.get('driveSplit') ?? 0);
  console.log(`${key}: ${[...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')} | block share ${((100 * block) / total).toFixed(1)}% | distinct ${m.size}/${PIANO_CHORUS_FIGURE_MENU.length - 1 + 6}`);
}

console.log('\n=== the non-chorus piano notes per run (20-run average, final note included) ===');
for (const [k, arr] of nonChorusNotes) console.log(`${k}: ${(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2)}`);

console.log('\n=== the vocalbacking piano register split (20 runs) ===');
console.log(`sparkle(82+) ${(100 * vbSplit.sparkle / vbSplit.total).toFixed(1)}%, low(<57) ${(100 * vbSplit.low / vbSplit.total).toFixed(1)}%, other ${((vbSplit.other * 100) / vbSplit.total).toFixed(1)}% of ${vbSplit.total}`);

console.log('\n=== the harp figures (realized units per figure, per template and section type, 20 runs) ===');
for (const [key, m] of [...harpUnitFigure.entries()].sort()) {
  const total = [...m.values()].reduce((a, b) => a + b, 0);
  const [top, topN] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
  console.log(`${key}: distinct ${m.size}/9, top ${top} ${(100 * topN / total).toFixed(1)}% | ${[...m.entries()].sort().map(([k, v]) => `${k} ${v}`).join(', ')}`);
}
console.log('\n=== the harp distinct realized sequences (of 20 runs) ===');
for (const [k, s] of harpSequence) console.log(`${k}: ${s.size}/20`);

console.log('\n=== the chorus floor vs golden104 (10 takes aggregated, three-chorus) ===');
for (const [k, acc] of floorAccum) {
  const template = resolveTemplate({ templateId: `ensemble.${k}`, overrides: {}, pins: {} })!;
  console.log(`${k}: excl-moments ${acc.b.toFixed(2)} -> ${acc.a.toFixed(2)} (delta ${(acc.a - acc.b).toFixed(3)}) | below-floor ${acc.bb} -> ${acc.ab} | peak ${acc.peak.toFixed(3)} vs clamp ${template.budget.energyClamp[1]} (windows ${acc.n})`);
}
void KEYS_GATES;
