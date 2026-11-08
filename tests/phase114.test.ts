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
  KEYS_GATES, VB_SPARKLE, VB_SPARKLE_TOP,
  type KeysPart,
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

interface Run { templateId: string; take: number; fixture: string; project: Project; result: ReturnType<typeof composeAllTracks>; pianoJobs: { startBar: number; job: string; figures: string[] }[] }
const SURVEY: Run[] = [];
const composeTake = (fixture: 'three' | 'dorian', templateId: string, take: number, record = true) => {
  const p = fixture === 'three' ? THREE() : DORIAN();
  p.ensemble = { templateId, overrides: {}, pins: {} };
  p.orchestration = { take };
  const result = composeAllTracks(p, { seed: 11 });
  const project = { ...p, tracks: result.tracks, orchestration: result.orchestration } as Project;
  const run: Run = { templateId, take, fixture, project, result, pianoJobs: result.plan.keys.pianoJobs.map((j) => ({ startBar: j.startBar, job: j.job, figures: j.figures as string[] })) };
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
 *  sounded in each section (full or thinned form). Phase 11.5 UPDATE
 *  (named): the chorus sections draw per PHRASE now — the reader takes the
 *  phrase's own figure from the plan's chorusFigures; the non-chorus
 *  sections read the section pattern as before. Returns null when the
 *  section's piano never sounded. */
/** Phase 11.6 UPDATE (named): the realized reading is the JOB per section
 *  instance (the phrase figures live in the job's own list). */
const realizedPatternOf = (run: Run, sec: { name: string; startBar: number; lengthBars: number }): string | null => {
  const drawn = run.pianoJobs.find((e) => e.startBar === sec.startBar)?.job ?? null;
  if (!drawn) return null;
  const bt = barTicks(run.project.timeSignature);
  const bars = run.result.plan.keys.bars.length;
  const piano = run.project.tracks.find((t) => t.role === PIANO);
  if (!piano) return null;
  // the 11.5 chorus reading: only the DRAWN PHRASE's bars count (the
  // section's other phrases play their own figures)
  const notes: Note[] = [];
  for (const n of piano.notes) {
    const bar = Math.floor(n.startTick / bt) + 1;
    if (bar < sec.startBar || bar >= sec.startBar + sec.lengthBars || bar > bars) continue;
    if (run.result.plan.keys.bars[bar - 1]?.voices.piano !== 'job') continue;
    notes.push(n);
  }
  if (!notes.length) return null;
  void drawn;
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

  // Phase 11.5 UPDATE (named): the harp joined the keys family's own
  // movement (the per-section figure menu is 11.5's build), so the pin
  // reads the NON-KEYS tracks (the piano AND the harp filtered). The
  // harp's own 11.4 pin (byte-identical to golden103) is superseded by
  // phase115.test.ts's golden104 pin and the golden105 diff.
  it('every non-keys track in all six templates is byte-identical to golden103 (the piano and the harp filtered — the 11.5 update)', () => {
    const KEYS_ROLES = new Set(['piano', 'harp']);
    for (const templateId of TEMPLATES) {
      const short = templateId.replace('ensemble.', '');
      for (const [fixTag, fixture] of [['three', 'three'], ['dorian', 'dorian']] as const) {
        for (let take = 1; take <= 10; take++) {
          const golden = JSON.parse(readFileSync(new URL(`./golden103/${short}-${fixTag}-t${take}.json`, import.meta.url), 'utf8'));
          const run = composeTake(fixture, templateId, take, false);
          const goldenTracks = golden.tracks.filter((t: { role: string }) => !KEYS_ROLES.has(t.role));
          const current = run.project.tracks.filter((t) => !KEYS_ROLES.has(t.role));
          expect(current.map(stableTrack), `${short} ${fixTag} t${take} moved a non-keys track against golden103`)
            .toEqual(goldenTracks.map(stableTrack));
        }
      }
    }
  }, 900000);

  // Phase 11.5 UPDATE (named): the harp's figure menu changes the keys
  // windows on every template, so the cinematic/hybridstudio piano pin
  // carries the 11.5 velocity-only allowance (no pitch, timing or layer
  // change; the velocity delta is reported — the measured delta over the
  // survey is printed). The symphony has no piano and keeps its pin.
  // Phase 11.6 UPDATE (named): the cinematic and hybridstudio piano are
  // the phase's own movers now (the from-scratch piano engine writes every
  // template) — the golden103 pin is superseded by the phase116 battery's
  // golden105 pins (the non-piano tracks byte-identical everywhere).
  it('the cinematic and hybridstudio piano are the phase\u2019s own movers (they differ from golden105; the other tracks do not \u2014 pinned in phase116)', () => {
    for (const templateId of ['ensemble.cinematic', 'ensemble.hybridstudio']) {
      const short = templateId.replace('ensemble.', '');
      const g = JSON.parse(readFileSync(new URL(`./golden105/${short}-three-t1.json`, import.meta.url), 'utf8'));
      const run = composeTake('three', templateId, 1, false);
      const piano = run.project.tracks.find((t) => t.role === PIANO);
      const gp = (g.tracks as { role: string; notes: Note[] }[]).find((t) => t.role === PIANO);
      expect(piano?.notes.length, `${templateId}: the piano wrote nothing`).toBeGreaterThan(0);
      expect(JSON.stringify(piano?.notes), `${templateId}: the piano did not move`).not.toBe(JSON.stringify(gp?.notes));
    }
  }, 900000);
});

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

  // Phase 11.6 UPDATE (named): the lowFifth PATTERN is deleted; the
  // vocalbacking low band is the LH body (the root and its fifth below the
  // zone) — the band realises in the verses, the bridges and the outros.
  it('the vocalbacking low band realises in verses, bridges and outros (the LH body below the zone carries the sections the vocal sits over)', () => {
    for (const run of SURVEY.filter((r) => r.templateId === 'ensemble.vocalbacking')) {
      const bt = barTicks(run.project.timeSignature);
      const piano = run.project.tracks.find((t) => t.role === PIANO);
      const secs = sectionsOf(run.fixture === 'three' ? threeChorus : dorian);
      for (const sec of secs) {
        if (isChorusName(sec.name)) continue;
        const lo = (sec.startBar - 1) * bt;
        const hi = (sec.startBar - 1 + sec.lengthBars) * bt;
        const lowNotes = (piano?.notes ?? []).filter((n) => n.startTick >= lo && n.startTick < hi && n.pitch <= 56);
        expect(lowNotes.length, `${run.fixture} t${run.take}: the low band never realised in the ${sec.name} at b${sec.startBar}`).toBeGreaterThan(0);
      }
    }
  }, 900000);
});

describe('Phase 11.4: the drive variants', () => {
  // Phase 11.6 UPDATE (named): the six drive variants are deleted; the
  // register contracts they carried live in the phase116 battery (the
  // vocalbacking bands, the hand split, the one-arpeggiator rule) and in
  // the phase111 updates. The realized reading keeps the section ->
  // job mapping alive for the diversity tests.
  it('every section instance draws exactly one job, and the chorus uses at least two figures across its phrases', () => {
    for (const run of SURVEY) {
      if (!MENU_TEMPLATES.includes(run.templateId)) continue;
      const secs = sectionsOf(run.fixture === 'three' ? threeChorus : dorian);
      for (const sec of secs) {
        const job = run.pianoJobs.find((e) => e.startBar === sec.startBar);
        expect(job, `${run.templateId} ${run.fixture} t${run.take}: the section at b${sec.startBar} drew no job`).toBeTruthy();
        // the figure-carrying jobs only (the support and the melody draw
        // no figures — their choruses ride the L1 chord); the rhythm
        // job's chamber/sonata/vocalbacking menu is the pump alone (the
        // limited rhythm job — a single-figure rotation is its own shape)
        if (isChorusName(sec.name) && sec.lengthBars >= 4 && job!.figures.length > 0 && job!.job !== 'rhythm') {
          expect(job!.figures.length, `${run.templateId} ${run.fixture} t${run.take}: the chorus at b${sec.startBar} drew one figure`).toBeGreaterThanOrEqual(2);
          for (let i = 1; i < job!.figures.length; i++) {
            expect(job!.figures[i], `${run.templateId} ${run.fixture} t${run.take}: consecutive phrases repeat`).not.toBe(job!.figures[i - 1]);
          }
        }
      }
    }
  }, 900000);
});

describe('Phase 11.4: the realized pattern diversity (measured on the output notes)', () => {
  // Phase 11.6 UPDATE (named): the realized reading is the JOB per section
  // instance; the coverage and the caps are pinned in the phase116 battery
  // (the jobs and the figures describe) — these keep the phase114-style
  // realized-notes reading (a job counts as realised when its section's
  // bars carry piano notes under the job kind).
  it('every job in each template\u2019s rotation realises at least once over the 20 runs, and the top share stays at or under 40%', () => {
    for (const templateId of TEMPLATES) {
      if (templateId === 'ensemble.symphony') continue; // no piano in band
      const byType = new Map<string, Map<string, number>>();
      const seen: Record<string, number> = {};
      for (const run of SURVEY.filter((r) => r.templateId === templateId)) {
        const secs = sectionsOf(run.fixture === 'three' ? threeChorus : dorian);
        for (const sec of secs) {
          const drawn = realizedPatternOf(run, sec);
          if (!drawn) continue;
          seen[drawn] = (seen[drawn] ?? 0) + 1;
          const type = sec.name.trim().toLowerCase() || '*';
          if (!byType.has(type)) byType.set(type, new Map());
          const m = byType.get(type)!;
          m.set(drawn, (m.get(drawn) ?? 0) + 1);
        }
      }
      expect(Object.keys(seen).length, `${templateId}: only ${Object.keys(seen).length} jobs realised`).toBeGreaterThanOrEqual(5);
      for (const [type, m] of byType) {
        const total = [...m.values()].reduce((a, b) => a + b, 0);
        const top = Math.max(...m.values());
        expect(top / total, `${templateId} ${type}: the top job holds ${(top / total * 100).toFixed(1)}%`).toBeLessThanOrEqual(0.40 + 1e-9);
      }
    }
  }, 900000);

  it('distinct realised per-section job sequences are at least 14 of 20 runs for chamber, sonata and vocalbacking', () => {
    for (const templateId of ['ensemble.chamber', 'ensemble.sonata', 'ensemble.vocalbacking']) {
      const seqs = new Set<string>();
      for (const run of SURVEY.filter((r) => r.templateId === templateId)) {
        const secs = sectionsOf(run.fixture === 'three' ? threeChorus : dorian);
        const parts: string[] = [];
        for (const sec of secs) {
          const drawn = realizedPatternOf(run, sec);
          if (!drawn) continue;
          const figs = run.pianoJobs.find((e) => e.startBar === sec.startBar)?.figures ?? [];
          parts.push(`${sec.startBar}${drawn[0]}${figs[0]?.[0] ?? '-'}`);
        }
        seqs.add(parts.join('|'));
      }
      expect(seqs.size, `${templateId}: only ${seqs.size} distinct realised sequences`).toBeGreaterThanOrEqual(14);
    }
  }, 900000);
});

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

  // Phase 11.5 UPDATE (named): the floor's live side is the 11.5 engine
  // now; the before side reads golden104 (the 11.4 capture — its chorus
  // sums equal golden103's byte-for-byte, so the 11.1 live value is
  // unchanged). The comparison carries the safety-pass rounding bound:
  // the crushed windows' per-note floor() loses under one velocity point
  // per keys note, so the sums may wobble inside that bound without the
  // chorus being thinner.
  it('the chorus mean does not fall below the 11.4 live value (golden104), per template, with moment-covered windows excluded on BOTH sides; below-floor counts do not increase (the safety-pass rounding bound carried)', () => {
    const lines: string[] = [];
    for (const templateId of TEMPLATES) {
      const short = templateId.replace('ensemble.', '');
      const template = resolveTemplate({ templateId, overrides: {}, pins: {} })!;
      const chorusStats = (proj: Project, momentBars: Set<number>, excl: boolean) => {
        const report = measureEnergy(proj, template);
        let sum = 0, n = 0, below = 0, keysNotes = 0;
        const secs = sectionsOf(threeChorus);
        for (const w of report.windows) {
          const sec = secs.find((s) => w.bar >= s.startBar && w.bar < s.startBar + s.lengthBars);
          if (!sec || !isChorusName(sec.name)) continue;
          if (excl && momentBars.has(w.bar)) continue;
          sum += w.energy; n++;
          if (w.energy > 0 && w.energy < template.budget.energyClamp[0]) below++;
          keysNotes += w.soundingRoles.includes('piano') || w.soundingRoles.includes('harp') ? Math.max(1, Math.round(w.noteCount / 4)) : 0;
        }
        return { sum, n, below, keysNotes };
      };
      let beforeSum = 0, afterSum = 0, beforeBelow = 0, afterBelow = 0, roundingBound = 0;
      for (let take = 1; take <= 10; take++) {
        const g = JSON.parse(readFileSync(new URL(`./golden104/${short}-three-t${take}.json`, import.meta.url), 'utf8'));
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
        // the safety-pass rounding bound: each crushed keys note loses
        // under one velocity point (floor()), half on average — the windows'
        // energy may wobble by (roles/N) * 0.5 * keysNotes / count / 127
        roundingBound += (a.keysNotes * 0.5) / 127;
      }
      expect(afterSum, `${short}: the chorus mean fell below the 11.4 live value beyond the safety-pass rounding bound (${beforeSum.toFixed(1)} -> ${afterSum.toFixed(1)}, bound ${roundingBound.toFixed(2)})`)
        .toBeGreaterThanOrEqual(beforeSum - roundingBound);
      expect(afterBelow, `${short}: the chorus below-floor count rose (${beforeBelow} -> ${afterBelow})`).toBeLessThanOrEqual(beforeBelow);
      lines.push(`${short}: excl-moments ${beforeSum.toFixed(1)} -> ${afterSum.toFixed(1)} (rounding bound ${roundingBound.toFixed(2)}) | below-floor ${beforeBelow} -> ${afterBelow}`);
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
