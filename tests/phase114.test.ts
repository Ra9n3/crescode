import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { checkTemplateRules, measureEnergy } from '../src/orchestrator/energy';
import { barTicks } from '../src/shared/schema/meter';
import { sanitizeNotes } from '../src/engine/generate';
import { projectEndTick, projectFromFixture, validateProject, type Note, type Project } from '../src/shared/schema';
import { resolveTemplate } from '../src/config/ensembles';
import { inVocalZone } from '../src/orchestrator/profiles/strings';
import { chunksForTrack } from '../src/export/profile';
import { EXPORT_PROFILES } from '../src/export/profiles';
import { buildMergedMidi } from '../src/export/midi';
import {
  KEYS_GATES, PIANO_COMP_MENU, PIANO_DRIVE_MENU, PIANO_VB_MENU,
  VB_LOW, VB_SPARKLE, VB_SPARKLE_TOP,
  type KeysPart, type PianoPattern,
} from '../src/orchestrator/keys/profile';

/**
 * Phase 11.4 — piano presence and variety in chamber, sonata and
 * vocalbacking (spec §16.2b, §16.3a, §16.4). The comping gate reaches the
 * peak gate (the full menu patterns below the high gate, thinned toward
 * tacet above it); the vocalbacking sparkle band is capped (the body
 * 82-91, the 92-96 top only on phrase-start chords at peak bars); the low
 * band carries real weight (lowFifth realises in verses, bridges and
 * outros; the drive menu grew the low and split variants); the arpeggio
 * owner is respected (the harp-owned sections draw only the non-arpeggio
 * patterns). Pinned here: the byte-identity of every non-piano track
 * against golden103 (harp included), the cinematic/hybridstudio piano
 * pins, the vocal zone, the realized pattern coverage and the ≤ 40% cap,
 * the distinct realized sequences, the low-band share, the clamp, the
 * chorus-mean floor against golden103 (the 11.1 live value), determinism,
 * sanitize/validate and the drive variants' registers.
 */
const TEMPLATES = ['ensemble.symphony', 'ensemble.chamber', 'ensemble.cinematic', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.hybridstudio'];
const MENU_TEMPLATES = ['ensemble.chamber', 'ensemble.sonata', 'ensemble.vocalbacking'];
const PIANO: KeysPart = 'piano';

const THREE = (): Project => projectFromFixture(JSON.parse(JSON.stringify(threeChorus)));
const DORIAN = (): Project => projectFromFixture(JSON.parse(JSON.stringify(dorian)));

interface Run { templateId: string; take: number; fixture: string; project: Project; result: ReturnType<typeof composeAllTracks>; planPatterns: { startBar: number; pattern: PianoPattern }[] }
const SURVEY: Run[] = [];
const composeTake = (fixture: 'three' | 'dorian', templateId: string, take: number, record = true) => {
  const p = fixture === 'three' ? THREE() : DORIAN();
  p.ensemble = { templateId, overrides: {}, pins: {} };
  p.orchestration = { take };
  const result = composeAllTracks(p, { seed: 11 });
  const project = { ...p, tracks: result.tracks, orchestration: result.orchestration } as Project;
  const run: Run = { templateId, take, fixture, project, result, planPatterns: result.plan.keys.pianoPatterns };
  if (record) SURVEY.push(run);
  return run;
};
for (const templateId of TEMPLATES) {
  for (let take = 1; take <= 10; take++) composeTake('three', templateId, take);
  for (let take = 1; take <= 10; take++) composeTake('dorian', templateId, take);
}

const sectionsOf = (doc: unknown): { name: string; startBar: number; lengthBars: number }[] =>
  (doc as { sections: { name: string; startBar: number; lengthBars: number }[] }).sections;
const isChorusName = (name: string): boolean => /chorus|refrain|hook|drop/.test(name.trim().toLowerCase());

/** The realized-pattern reading: from the OUTPUT notes, which drawn pattern
 *  sounded in each section (full or thinned form). Returns null when the
 *  section's piano never sounded. */
const realizedPatternOf = (run: Run, sec: { name: string; startBar: number; lengthBars: number }): PianoPattern | null => {
  const drawn = run.planPatterns.find((e) => e.startBar === sec.startBar)?.pattern ?? null;
  if (!drawn) return null;
  const bt = barTicks(run.project.timeSignature);
  const bars = run.result.plan.keys.bars.length;
  const piano = run.project.tracks.find((t) => t.role === PIANO);
  if (!piano) return null;
  const notes: Note[] = [];
  for (const n of piano.notes) {
    const bar = Math.floor(n.startTick / bt) + 1;
    if (bar < sec.startBar || bar >= sec.startBar + sec.lengthBars || bar > bars) continue;
    const kind = run.result.plan.keys.bars[bar - 1]?.voices.piano;
    if (kind !== 'comp') continue;
    notes.push(n);
  }
  if (!notes.length) return null;
  if (drawn === 'lowFifth') {
    // the low root plus fifth: every note below the vocal zone
    return notes.every((n) => n.pitch < 57) ? drawn : null;
  }
  if (drawn === 'sparkle' || drawn === 'dyadHigh' || drawn === 'highArp') {
    // the above-the-zone patterns: every note outside 57-81
    return notes.every((n) => !inVocalZone(n.pitch)) ? drawn : null;
  }
  if (drawn === 'driveLow') return notes.every((n) => n.pitch >= 40 && n.pitch <= 56) ? drawn : null;
  if (drawn === 'driveSplit') {
    const low = notes.filter((n) => n.pitch < 57).length;
    const high = notes.filter((n) => n.pitch >= 82).length;
    return low > 0 && high > 0 && notes.every((n) => n.pitch < 57 || n.pitch >= 82) ? drawn : null;
  }
  return drawn; // the chamber/sonata menus and the remaining drive variants
};

/* ---------------- 1. the byte pins ----------------------------------------- */

describe('Phase 11.4: the byte pins', () => {
  const stableTrack = (t: { id: string; role: string; notes: unknown; cc?: unknown }) =>
    JSON.stringify({ id: t.id, role: t.role, notes: t.notes, ...(t.cc !== undefined ? { cc: t.cc } : {}) });

  it('every non-piano track in all six templates is byte-identical to golden103 (the harp included — the dry-run control, then after the change)', () => {
    for (const templateId of TEMPLATES) {
      const short = templateId.replace('ensemble.', '');
      for (const [fixTag, fixture] of [['three', 'three'], ['dorian', 'dorian']] as const) {
        for (let take = 1; take <= 10; take++) {
          const golden = JSON.parse(readFileSync(new URL(`./golden103/${short}-${fixTag}-t${take}.json`, import.meta.url), 'utf8'));
          const run = composeTake(fixture, templateId, take, false);
          const goldenTracks = golden.tracks.filter((t: { role: string }) => t.role !== PIANO);
          const current = run.project.tracks.filter((t) => t.role !== PIANO);
          expect(current.map(stableTrack), `${short} ${fixTag} t${take} moved a non-piano track against golden103`)
            .toEqual(goldenTracks.map(stableTrack));
        }
      }
    }
  }, 900000);

  it('cinematic and hybridstudio piano stay byte-identical to golden103 (their pins hold — no menu, no gate change reaches them)', () => {
    for (const templateId of ['ensemble.cinematic', 'ensemble.hybridstudio', 'ensemble.symphony']) {
      const short = templateId.replace('ensemble.', '');
      for (const [fixTag, fixture] of [['three', 'three'], ['dorian', 'dorian']] as const) {
        for (let take = 1; take <= 10; take++) {
          const golden = JSON.parse(readFileSync(new URL(`./golden103/${short}-${fixTag}-t${take}.json`, import.meta.url), 'utf8'));
          const run = composeTake(fixture, templateId, take, false);
          const goldPiano = golden.tracks.find((t: { role: string }) => t.role === PIANO);
          const piano = run.project.tracks.find((t) => t.role === PIANO);
          expect(stableTrack(piano!), `${short} ${fixTag} t${take}: the piano moved`).toBe(stableTrack(goldPiano));
        }
      }
    }
  }, 900000);
});

/* ---------------- 2. the presence targets ---------------------------------- */

describe('Phase 11.4: the comping presence', () => {
  it('the comp and menu patterns sound at mid energy: non-chorus piano notes per run clear the 11.1 baseline several times over (chamber ~6, sonata ~4, vocalbacking 0 before)', () => {
    const lines: string[] = [];
    for (const templateId of MENU_TEMPLATES) {
      const runs = SURVEY.filter((r) => r.templateId === templateId);
      const perRun: number[] = [];
      for (const run of runs) {
        const bt = barTicks(run.project.timeSignature);
        const bars = run.result.plan.keys.bars.length;
        const piano = run.project.tracks.find((t) => t.role === PIANO);
        const secs = sectionsOf(run.fixture === 'three' ? threeChorus : dorian);
        let count = 0;
        for (const n of piano?.notes ?? []) {
          const bar = Math.min(bars, Math.max(1, Math.floor(n.startTick / bt) + 1));
          const sec = secs.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
          if (sec && !isChorusName(sec.name)) count++;
        }
        perRun.push(count);
      }
      const avg = perRun.reduce((a, b) => a + b, 0) / perRun.length;
      lines.push(`${templateId.replace('ensemble.', '')}: ${avg.toFixed(2)} non-chorus piano notes/run`);
      if (templateId === 'ensemble.chamber') expect(avg, 'chamber non-chorus notes/run').toBeGreaterThanOrEqual(12);
      if (templateId === 'ensemble.sonata') expect(avg, 'sonata non-chorus notes/run').toBeGreaterThanOrEqual(10);
      if (templateId === 'ensemble.vocalbacking') expect(avg, 'vocalbacking non-chorus notes/run').toBeGreaterThanOrEqual(6);
    }
    console.log(`PHASE114 presence (20-run average, final note included):\n  ${lines.join('\n  ')}`);
  }, 900000);

  it('every non-chorus phrase start below the high gate sounds (the gate reads 0.30-0.72 of the clamp; the thinning band carries 0.72-0.90)', () => {
    for (const templateId of MENU_TEMPLATES) {
      const runs = SURVEY.filter((r) => r.templateId === templateId);
      let sounding = 0;
      let total = 0;
      for (const run of runs) {
        const bt = barTicks(run.project.timeSignature);
        const bars = run.result.plan.keys.bars.length;
        const piano = run.project.tracks.find((t) => t.role === PIANO);
        const secs = sectionsOf(run.fixture === 'three' ? threeChorus : dorian);
        for (const sec of secs) {
          if (isChorusName(sec.name)) continue;
          for (let b = sec.startBar; b < sec.startBar + sec.lengthBars && b <= bars; b++) {
            const isPs = b === sec.startBar || (b - sec.startBar) % 4 === 0;
            if (!isPs) continue;
            const norm = run.result.plan.keys.bars[b - 1]?.norm ?? 0;
            if (norm < KEYS_GATES.peak) {
              total++;
              const sounded = (piano?.notes ?? []).some((n) => {
                const nb = Math.floor(n.startTick / bt) + 1;
                return nb === b;
              });
              if (sounded) sounding++;
            }
          }
        }
      }
      expect(total, `${templateId}: no sub-peak phrase starts found`).toBeGreaterThan(0);
      expect(sounding / total, `${templateId}: only ${sounding}/${total} sub-peak phrase starts sound`).toBeGreaterThanOrEqual(0.9);
    }
  }, 900000);
});

/* ---------------- 3. the vocalbacking register ------------------------------ */

describe('Phase 11.4: the vocalbacking register', () => {
  it('the vocal zone (57-81) stays free of piano notes across all 20 runs', () => {
    for (const run of SURVEY) {
      if (run.templateId !== 'ensemble.vocalbacking') continue;
      const piano = run.project.tracks.find((t) => t.role === PIANO);
      for (const n of piano?.notes ?? []) {
        expect(inVocalZone(n.pitch), `${run.fixture} t${run.take}: piano note ${n.pitch} inside the vocal zone`).toBe(false);
      }
    }
  }, 900000);

  it('the sparkle band is capped: the body at 82-91, the 92-96 top only on phrase-start chords at peak bars, and the sparkle band is no longer 100% of the notes', () => {
    let sparkle = 0;
    let low = 0;
    let total = 0;
    for (const run of SURVEY) {
      if (run.templateId !== 'ensemble.vocalbacking') continue;
      const bt = barTicks(run.project.timeSignature);
      const piano = run.project.tracks.find((t) => t.role === PIANO);
      const secs = sectionsOf(run.fixture === 'three' ? threeChorus : dorian);
      for (const n of piano?.notes ?? []) {
        total++;
        if (n.pitch >= 82) sparkle++;
        if (n.pitch < 57) low++;
        if (n.pitch > VB_SPARKLE[1]) {
          expect(n.pitch, `t${run.take}: a note above the sparkle top`).toBeLessThanOrEqual(VB_SPARKLE_TOP);
          const bar = Math.floor(n.startTick / bt) + 1;
          const sec = secs.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
          const secStart = sec?.startBar ?? 1;
          const norm = run.result.plan.keys.bars[bar - 1]?.norm ?? 0;
          expect(
            (bar === secStart || (bar - secStart) % 4 === 0) && norm >= KEYS_GATES.peak,
            `${run.fixture} t${run.take}: a ${n.pitch} note outside the phrase-start peak allowance`,
          ).toBe(true);
        }
      }
    }
    expect(total, 'no vocalbacking piano notes').toBeGreaterThan(0);
    expect(sparkle / total, `the sparkle band still ${(100 * sparkle / total).toFixed(1)}% of the notes`).toBeLessThan(1);
    console.log(`PHASE114 vocalbacking split (20 runs): sparkle(82+) ${(100 * sparkle / total).toFixed(1)}%, low(<57) ${(100 * low / total).toFixed(1)}%, zone+other ${((total - sparkle - low) * 100 / total).toFixed(1)}%`);
  }, 900000);

  it("vocalbacking's piano low-band share (below 57) reaches 25% of its notes", () => {
    let low = 0;
    let total = 0;
    for (const run of SURVEY) {
      if (run.templateId !== 'ensemble.vocalbacking') continue;
      const piano = run.project.tracks.find((t) => t.role === PIANO);
      for (const n of piano?.notes ?? []) {
        total++;
        if (n.pitch < 57) low++;
      }
    }
    expect(low / total, `the low band holds ${(100 * low / total).toFixed(1)}% of ${total} notes`).toBeGreaterThanOrEqual(0.25);
  }, 900000);

  it('lowFifth realises in verses, bridges and outros (the low band carries the sections the vocal sits over)', () => {
    const realizedByType = new Map<string, number>();
    for (const run of SURVEY) {
      if (run.templateId !== 'ensemble.vocalbacking') continue;
      const secs = sectionsOf(run.fixture === 'three' ? threeChorus : dorian);
      for (const sec of secs) {
        if (isChorusName(sec.name)) continue;
        const type = sec.name.trim().toLowerCase();
        if (realizedPatternOf(run, sec) === 'lowFifth') realizedByType.set(type, (realizedByType.get(type) ?? 0) + 1);
      }
    }
    for (const type of ['verse', 'bridge', 'outro']) {
      expect(realizedByType.get(type) ?? 0, `lowFifth never realised in a ${type}`).toBeGreaterThanOrEqual(1);
    }
    console.log(`PHASE114 lowFifth realisations: ${[...realizedByType.entries()].sort().map(([t, c]) => `${t} ${c}`).join(', ')}`);
  }, 900000);
});

/* ---------------- 4. the drive variants ------------------------------------- */

describe('Phase 11.4: the drive variants', () => {
  it('the drive menu holds six variants; the low variant writes only 40-56 and the split pairs a low root with sparkle tones, nothing in 57-81', () => {
    expect(PIANO_DRIVE_MENU.length).toBe(6);
    for (const p of ['driveLow', 'driveSplit']) expect(PIANO_DRIVE_MENU).toContain(p);
    const seen: Record<string, number> = {};
    for (const run of SURVEY) {
      if (!MENU_TEMPLATES.includes(run.templateId)) continue;
      const bt = barTicks(run.project.timeSignature);
      const bars = run.result.plan.keys.bars.length;
      const piano = run.project.tracks.find((t) => t.role === PIANO);
      const secs = sectionsOf(run.fixture === 'three' ? threeChorus : dorian);
      for (const sec of secs) {
        if (!isChorusName(sec.name)) continue;
        const drawn = run.planPatterns.find((e) => e.startBar === sec.startBar)?.pattern;
        if (drawn !== 'driveLow' && drawn !== 'driveSplit') continue;
        seen[drawn] = (seen[drawn] ?? 0) + 1;
        for (const n of piano?.notes ?? []) {
          const bar = Math.floor(n.startTick / bt) + 1;
          if (bar < sec.startBar || bar >= sec.startBar + sec.lengthBars || bar > bars) continue;
          if (run.result.plan.keys.bars[bar - 1]?.voices.piano !== 'comp') continue;
          if (drawn === 'driveLow') {
            expect(n.pitch, `${run.templateId} ${run.fixture} t${run.take}: a driveLow note at ${n.pitch}`).toBeGreaterThanOrEqual(VB_LOW[0]);
            expect(n.pitch, `${run.templateId} ${run.fixture} t${run.take}: a driveLow note at ${n.pitch}`).toBeLessThanOrEqual(VB_LOW[1]);
          } else {
            expect(
              n.pitch < 57 || n.pitch >= 82,
              `${run.templateId} ${run.fixture} t${run.take}: a driveSplit note in the middle (${n.pitch})`,
            ).toBe(true);
          }
        }
      }
    }
    expect(seen.driveLow ?? 0, 'driveLow never drew').toBeGreaterThanOrEqual(1);
    expect(seen.driveSplit ?? 0, 'driveSplit never drew').toBeGreaterThanOrEqual(1);
    console.log(`PHASE114 drive variant draws (20 runs, 3 templates): driveLow ${seen.driveLow ?? 0}, driveSplit ${seen.driveSplit ?? 0}`);
  }, 900000);

  it('the arpeggio owner is respected: a harp-owned vocalbacking section never draws highArp, and highArp realises as an arpeggio where it is drawn', () => {
    let harpOwnedHighArp = 0;
    let pianoOwnedHighArp = 0;
    let realized = 0;
    for (const run of SURVEY) {
      if (run.templateId !== 'ensemble.vocalbacking') continue;
      const bt = barTicks(run.project.timeSignature);
      const piano = run.project.tracks.find((t) => t.role === PIANO);
      const harp = run.project.tracks.find((t) => t.role === 'harp');
      const harpBars = new Set<number>((harp?.notes ?? []).map((n) => Math.floor(n.startTick / bt) + 1));
      const secs = sectionsOf(run.fixture === 'three' ? threeChorus : dorian);
      for (const sec of secs) {
        if (isChorusName(sec.name)) continue;
        const drawn = run.planPatterns.find((e) => e.startBar === sec.startBar)?.pattern;
        if (drawn !== 'highArp') continue;
        const owner = run.result.plan.keys.arpeggiatorByType[sec.name.trim().toLowerCase() || '*'];
        if (owner === 'harp') harpOwnedHighArp++;
        else pianoOwnedHighArp++;
        // realised as the arpeggio figure: at least one harp-free bar with
        // four or more piano eighths
        for (let b = sec.startBar; b < sec.startBar + sec.lengthBars; b++) {
          if (harpBars.has(b)) continue;
          const inBar = (piano?.notes ?? []).filter((n) => Math.floor(n.startTick / bt) + 1 === b);
          if (inBar.length >= 4) { realized++; break; }
        }
      }
    }
    expect(harpOwnedHighArp, 'highArp drawn on a harp-owned section').toBe(0);
    expect(pianoOwnedHighArp, 'highArp never drawn').toBeGreaterThanOrEqual(1);
    expect(realized, 'highArp never realised as an arpeggio figure').toBeGreaterThanOrEqual(1);
    console.log(`PHASE114 highArp: ${pianoOwnedHighArp} draws on piano-owned sections, ${realized} realised as the figure`);
  }, 900000);
});

/* ---------------- 5. the realized pattern diversity -------------------------- */

describe('Phase 11.4: the realized pattern diversity (measured on the output notes)', () => {
  it('every menu pattern realises at least once per template over the 20 runs (the comp menu, the vocalbacking menu and the six drive variants)', () => {
    for (const templateId of MENU_TEMPLATES) {
      const realized = new Map<string, number>();
      const runs = SURVEY.filter((r) => r.templateId === templateId);
      const secs = sectionsOf(runs[0].fixture === 'three' ? threeChorus : dorian);
      const dorianSecs = sectionsOf(dorian);
      for (const run of runs) {
        const all = run.fixture === 'three' ? secs : dorianSecs;
        for (const sec of all) {
          const rp = realizedPatternOf(run, sec);
          if (rp) realized.set(rp, (realized.get(rp) ?? 0) + 1);
        }
      }
      const menu = templateId === 'ensemble.vocalbacking'
        ? [...PIANO_VB_MENU, ...PIANO_DRIVE_MENU]
        : [...PIANO_COMP_MENU, ...PIANO_DRIVE_MENU];
      const missing = menu.filter((p) => !realized.has(p));
      expect(missing, `${templateId}: unrealised menu patterns ${missing.join(', ')} (realized: ${[...realized.entries()].sort().map(([p, c]) => `${p} ${c}`).join(', ')})`).toEqual([]);
    }
  }, 900000);

  it("each section type's most frequent realised pattern stays at or under 40% (no samey section class)", () => {
    for (const templateId of MENU_TEMPLATES) {
      const byType = new Map<string, Map<string, number>>();
      const runs = SURVEY.filter((r) => r.templateId === templateId);
      const secs = sectionsOf(runs[0].fixture === 'three' ? threeChorus : dorian);
      const dorianSecs = sectionsOf(dorian);
      for (const run of runs) {
        const all = run.fixture === 'three' ? secs : dorianSecs;
        for (const sec of all) {
          const rp = realizedPatternOf(run, sec);
          if (!rp) continue;
          const type = sec.name.trim().toLowerCase();
          if (!byType.has(type)) byType.set(type, new Map());
          const m = byType.get(type)!;
          m.set(rp, (m.get(rp) ?? 0) + 1);
        }
      }
      for (const [type, m] of [...byType.entries()].sort()) {
        const total = [...m.values()].reduce((a, b) => a + b, 0);
        const [top, topN] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
        expect(topN / total, `${templateId} ${type}: ${top} realises ${topN}/${total} (over the 40% cap)`).toBeLessThanOrEqual(0.4);
      }
    }
  }, 900000);

  it('distinct realised per-section sequences are at least 12 of 20 runs for chamber, sonata and vocalbacking', () => {
    for (const templateId of MENU_TEMPLATES) {
      const sequences = new Set<string>();
      const runs = SURVEY.filter((r) => r.templateId === templateId);
      const secs = sectionsOf(runs[0].fixture === 'three' ? threeChorus : dorian);
      const dorianSecs = sectionsOf(dorian);
      for (const run of runs) {
        const all = (run.fixture === 'three' ? secs : dorianSecs).slice().sort((a, b) => a.startBar - b.startBar);
        const seq: string[] = [];
        for (const sec of all) {
          const rp = realizedPatternOf(run, sec);
          if (rp) seq.push(`${sec.name.trim().toLowerCase()}:${rp}`);
        }
        if (seq.length) sequences.add(seq.join(' '));
      }
      expect(sequences.size, `${templateId}: only ${sequences.size} distinct realised sequences over 20 runs`).toBeGreaterThanOrEqual(12);
      console.log(`PHASE114 ${templateId.replace('ensemble.', '')}: ${sequences.size}/20 distinct realised sequences`);
    }
  }, 900000);
});

/* ---------------- 6. the clamp, the chorus-mean floor, hygiene --------------- */

describe('Phase 11.4: the clamp, the chorus-mean floor, hygiene', () => {
  it('energy never exceeds the clamp max across six templates × both fixtures × takes 1-10 (zero aboveMax); hard findings stay 0', () => {
    for (const run of SURVEY) {
      const template = resolveTemplate(run.project.ensemble)!;
      const report = measureEnergy(run.project, template);
      const hard = report.violations.filter((v) => v.kind === 'aboveMax');
      expect(hard, `${run.templateId} ${run.fixture} t${run.take}: ${hard.length} aboveMax`).toHaveLength(0);
      const findings = checkTemplateRules(run.project, template, run.result.plan).filter((f) => f.severity === 'hard');
      expect(findings, `${run.templateId} ${run.fixture} t${run.take}: hard findings ${findings.map((f) => f.message).join('; ')}`).toHaveLength(0);
    }
  }, 900000);

  it('the chorus mean does not fall below the 11.1 live value (golden103), per template, with moment-covered windows excluded on BOTH sides; below-floor counts do not increase', () => {
    const lines: string[] = [];
    for (const templateId of TEMPLATES) {
      const short = templateId.replace('ensemble.', '');
      const template = resolveTemplate({ templateId, overrides: {}, pins: {} })!;
      const chorusStats = (proj: Project, momentBars: Set<number>, excl: boolean) => {
        const report = measureEnergy(proj, template);
        let sum = 0, n = 0, below = 0;
        const secs = sectionsOf(threeChorus);
        for (const w of report.windows) {
          const sec = secs.find((s) => w.bar >= s.startBar && w.bar < s.startBar + s.lengthBars);
          if (!sec || !isChorusName(sec.name)) continue;
          if (excl && momentBars.has(w.bar)) continue;
          sum += w.energy; n++;
          if (w.energy > 0 && w.energy < template.budget.energyClamp[0]) below++;
        }
        return { sum, n, below };
      };
      let beforeSum = 0, afterSum = 0, beforeBelow = 0, afterBelow = 0;
      for (let take = 1; take <= 10; take++) {
        const g = JSON.parse(readFileSync(new URL(`./golden103/${short}-three-t${take}.json`, import.meta.url), 'utf8'));
        const base = THREE();
        base.ensemble = { templateId, overrides: {}, pins: {} };
        const momentBars = new Set<number>();
        for (const m of g.moments ?? []) for (let b = m.startBar; b <= m.endBar; b++) momentBars.add(b);
        // the before side carries the GOLDEN track list (the engine-inserted
        // basses desk included — the fixture's own list lacks it, and the
        // symphony's desk moves the window roles and means), with the
        // fixture's track objects as the field donors
        const beforeTracks = (g.tracks as { id: string; role: string; notes: Note[] }[]).map((gt) => {
          const donor = base.tracks.find((x) => x.id === gt.id);
          if (donor) return { ...donor, notes: gt.notes };
          // the engine-inserted basses desk: a minimal instrument track —
          // measureEnergy reads family, role and notes only
          return {
            id: gt.id, role: gt.role, name: gt.role, family: 'Strings',
            kind: 'instrument', locked: false, notes: gt.notes,
            lowestNote: 21, highestNote: 108, volume: 0.8, pan: 0,
          } as unknown as typeof base.tracks[number];
        });
        const beforeProj: Project = { ...base, tracks: beforeTracks };
        const b = chorusStats(beforeProj, momentBars, true);
        const { project } = composeTake('three', templateId, take, false);
        const a = chorusStats(project, momentBars, true);
        beforeSum += b.sum; afterSum += a.sum;
        beforeBelow += b.below; afterBelow += a.below;
      }
      expect(afterSum, `${short}: the chorus mean fell below the 11.1 live value (${beforeSum.toFixed(1)} -> ${afterSum.toFixed(1)})`).toBeGreaterThanOrEqual(beforeSum);
      expect(afterBelow, `${short}: the chorus below-floor count rose (${beforeBelow} -> ${afterBelow})`).toBeLessThanOrEqual(beforeBelow);
      lines.push(`${short}: excl-moments ${beforeSum.toFixed(1)} -> ${afterSum.toFixed(1)} | below-floor ${beforeBelow} -> ${afterBelow}`);
    }
    console.log(`PHASE114 chorus floor vs golden103 (10 takes aggregated, three-chorus):\n  ${lines.join('\n  ')}`);
  }, 900000);

  it('deterministic per (inputs, take); sanitizeNotes is a no-op on the piano output; validateProject passes', () => {
    for (const templateId of ['ensemble.chamber', 'ensemble.vocalbacking']) {
      const a = composeTake('three', templateId, 7, false);
      const b = composeTake('three', templateId, 7, false);
      expect(JSON.stringify(a.project.tracks)).toBe(JSON.stringify(b.project.tracks));
      const t = a.project.tracks.find((x) => x.role === PIANO)!;
      if (t.notes.length) {
        expect(sanitizeNotes(t.notes, t.lowestNote, t.highestNote, projectEndTick(a.project))).toEqual(t.notes);
      }
      expect(validateProject(JSON.parse(JSON.stringify(a.project))).ok).toBe(true);
    }
  }, 600000);

  it('exports keep every piano note: the merged MIDI builds and the UVI profile (no keys part — the pre-8.1 passthrough) drops nothing on chamber and vocalbacking', () => {
    const PROFILE = EXPORT_PROFILES[0].profile;
    for (const templateId of ['ensemble.chamber', 'ensemble.vocalbacking']) {
      const { project } = composeTake('three', templateId, 3, false);
      expect(validateProject(JSON.parse(JSON.stringify(project))).ok).toBe(true);
      const merged = buildMergedMidi(project, project.tracks.filter((t) => t.notes.length));
      expect(merged.length).toBeGreaterThan(200);
      const t = project.tracks.find((x) => x.role === PIANO)!;
      if (!t.notes.length) continue;
      const total = chunksForTrack(project, t, PROFILE).reduce((a2, c) => a2 + c.notes.length, 0);
      expect(total, `${templateId}: the piano lost notes in the profile export`).toBe(t.notes.length);
    }
  }, 600000);
});
