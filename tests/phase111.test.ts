import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { measureEnergy } from '../src/orchestrator/energy';
import { barTicks } from '../src/shared/schema/meter';
import { sanitizeNotes } from '../src/engine/generate';
import { projectEndTick, projectFromFixture, validateProject, type Note, type Project } from '../src/shared/schema';
import { resolveTemplate } from '../src/config/ensembles';
import { defaultRules } from '../src/config/generation-rules';
import { inVocalZone } from '../src/orchestrator/profiles/strings';
import {
  KEYS_GATES, VB_LOW, VB_SPARKLE,
  type KeysPart,
} from '../src/orchestrator/keys/profile';

/**
 * Phase 11.1 — piano register and variety (spec §16.2a, §16.3a). The piano
 * sits where a piano sounds good against strings (right-hand material
 * centred 62-84, top voice 72-84; vocalbacking writes ABOVE the vocal zone
 * 82-96 or below it 40-56 — the zone stays free), and every take draws its
 * own per-section pattern from the menu (chamber/sonata 7 patterns,
 * vocalbacking 4, the chorus relief drive's 4 voicing variants). Pinned
 * here: the register targets, the distinct-track counts, the vocal zone,
 * the byte-identity of every non-piano track against golden103 (harp
 * included — golden103 is the post-11.1 capture; golden102 predates the
 * keys module and pins the non-keys tracks in phase11.test.ts), the clamp,
 * the within-take pattern variety, determinism, sanitize/validate, and the
 * guard on the generator's 16 retired rules (spec §16.10).
 */
const TEMPLATES = ['ensemble.symphony', 'ensemble.chamber', 'ensemble.cinematic', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.hybridstudio'];
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
// build the survey once (6 templates × both fixtures × takes 1-10)
for (const templateId of TEMPLATES) {
  for (let take = 1; take <= 10; take++) composeTake('three', templateId, take);
  for (let take = 1; take <= 10; take++) composeTake('dorian', templateId, take);
}

/* ---------------- 1. the register targets --------------------------------- */

describe('Phase 11.1: the piano register', () => {
  // Phase 11.4 UPDATE (named): the drive menu grew the deliberate
  // low-register variants (driveLow, driveSplit — the chorus is no longer
  // always high), so their bars leave the mean-pitch population (their
  // register is asserted in phase114.test.ts); the sub-60 comp/arp notes
  // are the deliberate low band (the left-hand singles, the vocalbacking
  // lowFifth and the body-window rescues) inside 40-56 — no longer
  // phrase-start-only — and the ≤ 15% share cap now applies to the
  // templates WITHOUT the low-band menu (vocalbacking's low-band weight is
  // a Phase 11.4 target, asserted there).
  // Phase 11.5 UPDATE (named): the chorus relief now realises the 11.5
  // figures, whose held left-hand pedals live in 40-55 on every chorus bar
  // (the figures' own register, asserted in phase115.test.ts) — the
  // mean-pitch population reads the comp/arp notes OUTSIDE the chorus
  // sections (the drive-variant exclusion folds into it).
  // Phase 11.6 UPDATE (named): the mean-pitch register is superseded by
  // the hand model — the LH body lives in 40-55 (vocalbacking 40-56) and
  // the RH starts at 64 (vocalbacking 82); the bands are pinned in
  // phase116.test.ts and re-asserted here on the sub-60 population.
  it('every sub-60 piano note sits in the low window 40-56 (the LH body band; the hand-split gap 56-63 stays empty outside the octave form)', () => {
    for (const run of SURVEY) {
      const piano = run.project.tracks.find((t) => t.role === PIANO);
      const bt = barTicks(run.project.timeSignature);
      for (const n of piano?.notes ?? []) {
        if (n.pitch >= 60) continue;
        // the tutti and the final anchors sit at the floor of 36
        const bt0 = barTicks(run.project.timeSignature);
        const bar0 = Math.floor(n.startTick / bt0) + 1;
        const kind0 = run.result.plan.keys.bars[bar0 - 1]?.voices.piano;
        if (kind0 === 'tutti' || kind0 === 'final') {
          expect(n.pitch, `${run.templateId} t${run.take}: a moment hit below the floor of 36`).toBeGreaterThanOrEqual(36);
          continue;
        }
        expect(n.pitch, `${run.templateId} t${run.take}: a sub-60 note below the low window`).toBeGreaterThanOrEqual(40);
        if (n.pitch > 56) {
          // the octave form's upper note crosses the gap with its partner
          const barNotes = (piano?.notes ?? []).filter((o) => Math.floor(o.startTick / bt) === Math.floor(n.startTick / bt));
          const partner = barNotes.some((o) => o.pitch === n.pitch - 12 && Math.abs(o.startTick - n.startTick) <= bt / 2);
          expect(partner, `${run.templateId} t${run.take}: a ${n.pitch} note in the gap without its octave partner`).toBe(true);
          continue;
        }
        expect(n.pitch, `${run.templateId} t${run.take}: a sub-60 note above the low window`).toBeLessThanOrEqual(56);
      }
    }
  }, 900000);

  // Phase 11.6 UPDATE (named): the RH window moves to 64+ (vocalbacking
  // 82+); the sparkle cap (the 92-96 top only on the phrase-start chords
  // of peak bars) and the vocal zone carry over unchanged.
  it('the right-hand material starts at 64 (vocalbacking 82), the sparkle body caps at 91 with the 92-96 top only on phrase-start chords at peak bars, and the notes cap at 96', () => {
    for (const run of SURVEY) {
      const piano = run.project.tracks.find((t) => t.role === PIANO);
      if (!piano) continue;
      const isVB = run.templateId === 'ensemble.vocalbacking';
      const bt = barTicks(run.project.timeSignature);
      for (const n of piano.notes) {
        if (isVB) {
          expect(n.pitch >= VB_SPARKLE[0] || n.pitch <= VB_LOW[1], `${run.templateId} t${run.take}: piano note ${n.pitch} outside the sparkle and low windows`).toBe(true);
          expect(n.pitch >= 57 && n.pitch <= 81, `${run.templateId} t${run.take}: piano note ${n.pitch} inside the vocal zone`).toBe(false);
          if (n.pitch > VB_SPARKLE[1]) {
            const bar = Math.floor(n.startTick / bt) + 1;
            const sec = run.project.sections.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
            const secStart = sec?.startBar ?? 1;
            const norm = run.result.plan.keys.bars[bar - 1]?.norm ?? 0;
            expect(
              (bar === secStart || (bar - secStart) % 4 === 0) && norm >= KEYS_GATES.peak,
              `${run.templateId} t${run.take}: a ${n.pitch} note outside the phrase-start peak allowance`,
            ).toBe(true);
          }
        } else if (n.pitch >= 56 && n.pitch <= 63) {
          // the hand-split gap: only the octave form's upper note crosses
          // it (its exact-octave partner sounds in the same strike)
          const barNotes = piano.notes.filter((o) => Math.floor(o.startTick / bt) === Math.floor(n.startTick / bt));
          const partner = barNotes.some((o) => o.pitch === n.pitch - 12 && Math.abs(o.startTick - n.startTick) <= bt / 2);
          expect(partner, `${run.templateId} t${run.take}: a ${n.pitch} note in the gap without its octave partner`).toBe(true);
        } else {
          expect(n.pitch >= 64 || n.pitch <= 55, `${run.templateId} t${run.take}: piano note ${n.pitch} outside the hand bands`).toBe(true);
        }
        expect(n.pitch, `${run.templateId} t${run.take}: a note above the sparkle cap`).toBeLessThanOrEqual(96);
      }
    }
  }, 900000);

  // Phase 11.5 UPDATE (named): the chorus relief now realises the 11.5
  // figures, whose held left-hand pedals live in 40-55 on every chorus bar
  // (the figures' own register, asserted in phase115.test.ts) — the
  // mean-pitch population reads the comp/arp notes OUTSIDE the chorus
  // sections (the drive-variant exclusion folds into it).
  // Phase 11.6 UPDATE (named): the mean-pitch register is superseded by
  // the hand model — the LH body lives in 40-55 (vocalbacking 40-56) and
  // the RH starts at 64 (vocalbacking 82); the bands are pinned in
  // phase116.test.ts and re-asserted here on the sub-60 population.
  it('every sub-60 piano note sits in the low window 40-56 (the LH body band; the hand-split gap 56-63 stays empty outside the octave form)', () => {
    for (const run of SURVEY) {
      const piano = run.project.tracks.find((t) => t.role === PIANO);
      const bt = barTicks(run.project.timeSignature);
      for (const n of piano?.notes ?? []) {
        if (n.pitch >= 60) continue;
        // the tutti and the final anchors sit at the floor of 36
        const bt0 = barTicks(run.project.timeSignature);
        const bar0 = Math.floor(n.startTick / bt0) + 1;
        const kind0 = run.result.plan.keys.bars[bar0 - 1]?.voices.piano;
        if (kind0 === 'tutti' || kind0 === 'final') {
          expect(n.pitch, `${run.templateId} t${run.take}: a moment hit below the floor of 36`).toBeGreaterThanOrEqual(36);
          continue;
        }
        expect(n.pitch, `${run.templateId} t${run.take}: a sub-60 note below the low window`).toBeGreaterThanOrEqual(40);
        if (n.pitch > 56) {
          // the octave form's upper note crosses the gap with its partner
          const barNotes = (piano?.notes ?? []).filter((o) => Math.floor(o.startTick / bt) === Math.floor(n.startTick / bt));
          const partner = barNotes.some((o) => o.pitch === n.pitch - 12 && Math.abs(o.startTick - n.startTick) <= bt / 2);
          expect(partner, `${run.templateId} t${run.take}: a ${n.pitch} note in the gap without its octave partner`).toBe(true);
          continue;
        }
        expect(n.pitch, `${run.templateId} t${run.take}: a sub-60 note above the low window`).toBeLessThanOrEqual(56);
      }
    }
  }, 900000);

  // Phase 11.5 UPDATE (named): the chorus relief now realises the 11.5
  // figures, whose held left-hand pedals live in 40-55 on every chorus bar
  // (the figures' own register, asserted in phase115.test.ts) — the
  // mean-pitch population reads the comp/arp notes OUTSIDE the chorus
  // sections (the drive-variant exclusion folds into it).
  // Phase 11.6 UPDATE (named): the mean-pitch register is superseded by
  // the hand model — the LH body lives in 40-55 (vocalbacking 40-56) and
  // the RH starts at 64 (vocalbacking 82); the bands are pinned in
  // phase116.test.ts and re-asserted here on the sub-60 population.
  it('every sub-60 piano note sits in the low window 40-56 (the LH body band; the hand-split gap 56-63 stays empty outside the octave form)', () => {
    for (const run of SURVEY) {
      const piano = run.project.tracks.find((t) => t.role === PIANO);
      const bt = barTicks(run.project.timeSignature);
      for (const n of piano?.notes ?? []) {
        if (n.pitch >= 60) continue;
        // the tutti and the final anchors sit at the floor of 36
        const bt0 = barTicks(run.project.timeSignature);
        const bar0 = Math.floor(n.startTick / bt0) + 1;
        const kind0 = run.result.plan.keys.bars[bar0 - 1]?.voices.piano;
        if (kind0 === 'tutti' || kind0 === 'final') {
          expect(n.pitch, `${run.templateId} t${run.take}: a moment hit below the floor of 36`).toBeGreaterThanOrEqual(36);
          continue;
        }
        expect(n.pitch, `${run.templateId} t${run.take}: a sub-60 note below the low window`).toBeGreaterThanOrEqual(40);
        if (n.pitch > 56) {
          // the octave form's upper note crosses the gap with its partner
          const barNotes = (piano?.notes ?? []).filter((o) => Math.floor(o.startTick / bt) === Math.floor(n.startTick / bt));
          const partner = barNotes.some((o) => o.pitch === n.pitch - 12 && Math.abs(o.startTick - n.startTick) <= bt / 2);
          expect(partner, `${run.templateId} t${run.take}: a ${n.pitch} note in the gap without its octave partner`).toBe(true);
          continue;
        }
        expect(n.pitch, `${run.templateId} t${run.take}: a sub-60 note above the low window`).toBeLessThanOrEqual(56);
      }
    }
  }, 900000);

  // Phase 11.6 UPDATE (named): the RH window moves to 64+ (vocalbacking
  // 82+); the sparkle cap (the 92-96 top only on the phrase-start chords
  // of peak bars) and the vocal zone carry over unchanged.
  it('the right-hand material starts at 64 (vocalbacking 82), the sparkle body caps at 91 with the 92-96 top only on phrase-start chords at peak bars, and the notes cap at 96', () => {
    for (const run of SURVEY) {
      const piano = run.project.tracks.find((t) => t.role === PIANO);
      if (!piano) continue;
      const isVB = run.templateId === 'ensemble.vocalbacking';
      const bt = barTicks(run.project.timeSignature);
      for (const n of piano.notes) {
        if (isVB) {
          expect(n.pitch >= VB_SPARKLE[0] || n.pitch <= VB_LOW[1], `${run.templateId} t${run.take}: piano note ${n.pitch} outside the sparkle and low windows`).toBe(true);
          expect(n.pitch >= 57 && n.pitch <= 81, `${run.templateId} t${run.take}: piano note ${n.pitch} inside the vocal zone`).toBe(false);
          if (n.pitch > VB_SPARKLE[1]) {
            const bar = Math.floor(n.startTick / bt) + 1;
            const sec = run.project.sections.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
            const secStart = sec?.startBar ?? 1;
            const norm = run.result.plan.keys.bars[bar - 1]?.norm ?? 0;
            expect(
              (bar === secStart || (bar - secStart) % 4 === 0) && norm >= KEYS_GATES.peak,
              `${run.templateId} t${run.take}: a ${n.pitch} note outside the phrase-start peak allowance`,
            ).toBe(true);
          }
        } else if (n.pitch >= 56 && n.pitch <= 63) {
          // the hand-split gap: only the octave form's upper note crosses
          // it (its exact-octave partner sounds in the same strike)
          const barNotes = piano.notes.filter((o) => Math.floor(o.startTick / bt) === Math.floor(n.startTick / bt));
          const partner = barNotes.some((o) => o.pitch === n.pitch - 12 && Math.abs(o.startTick - n.startTick) <= bt / 2);
          expect(partner, `${run.templateId} t${run.take}: a ${n.pitch} note in the gap without its octave partner`).toBe(true);
        } else {
          expect(n.pitch >= 64 || n.pitch <= 55, `${run.templateId} t${run.take}: piano note ${n.pitch} outside the hand bands`).toBe(true);
        }
        expect(n.pitch, `${run.templateId} t${run.take}: a note above the sparkle cap`).toBeLessThanOrEqual(96);
      }
    }
  }, 900000);

  // Phase 11.5 UPDATE (named): the chorus relief now realises the 11.5
  // figures, whose held left-hand pedals live in 40-55 on every chorus bar
  // (the figures' own register, asserted in phase115.test.ts) — the
  // mean-pitch population reads the comp/arp notes OUTSIDE the chorus
  // sections (the drive-variant exclusion folds into it).
  // Phase 11.6 UPDATE (named): the mean-pitch register is superseded by
  // the hand model — the LH body lives in 40-55 (vocalbacking 40-56) and
  // the RH starts at 64 (vocalbacking 82); the bands are pinned in
  // phase116.test.ts and re-asserted here on the sub-60 population.
  it('every sub-60 piano note sits in the low window 40-56 (the LH body band; the hand-split gap 56-63 stays empty outside the octave form)', () => {
    for (const run of SURVEY) {
      const piano = run.project.tracks.find((t) => t.role === PIANO);
      const bt = barTicks(run.project.timeSignature);
      for (const n of piano?.notes ?? []) {
        if (n.pitch >= 60) continue;
        // the tutti and the final anchors sit at the floor of 36
        const bt0 = barTicks(run.project.timeSignature);
        const bar0 = Math.floor(n.startTick / bt0) + 1;
        const kind0 = run.result.plan.keys.bars[bar0 - 1]?.voices.piano;
        if (kind0 === 'tutti' || kind0 === 'final') {
          expect(n.pitch, `${run.templateId} t${run.take}: a moment hit below the floor of 36`).toBeGreaterThanOrEqual(36);
          continue;
        }
        expect(n.pitch, `${run.templateId} t${run.take}: a sub-60 note below the low window`).toBeGreaterThanOrEqual(40);
        if (n.pitch > 56) {
          // the octave form's upper note crosses the gap with its partner
          const barNotes = (piano?.notes ?? []).filter((o) => Math.floor(o.startTick / bt) === Math.floor(n.startTick / bt));
          const partner = barNotes.some((o) => o.pitch === n.pitch - 12 && Math.abs(o.startTick - n.startTick) <= bt / 2);
          expect(partner, `${run.templateId} t${run.take}: a ${n.pitch} note in the gap without its octave partner`).toBe(true);
          continue;
        }
        expect(n.pitch, `${run.templateId} t${run.take}: a sub-60 note above the low window`).toBeLessThanOrEqual(56);
      }
    }
  }, 900000);



  // Phase 11.5 UPDATE (named): the chorus relief now realises the 11.5
  // figures, whose held left-hand pedals (the broken and Alberti basses)
  // sit in 40-55 on EVERY chorus bar, not only phrase starts — the
  // assertion exempts the chorus sections (their low register is the
  // 11.5 figure register, asserted in phase115.test.ts).
  // Phase 11.6 UPDATE (named): the left-hand body is the fifth-or-single
  // form at every span strike (no phrase-start gate any more); the closed
  // triads and the thirds below 55 are banned (pinned in phase116).
  it('the left-hand notes are single notes or open fifths (at most two notes below 55 sound at once, never a third or a fourth below 55)', () => {
    for (const run of SURVEY) {
      if (run.templateId === 'ensemble.vocalbacking') continue;
      const piano = run.project.tracks.find((t) => t.role === PIANO);
      if (!piano) continue;
      const bt = barTicks(run.project.timeSignature);
      const byBar = new Map<number, Note[]>();
      for (const n of piano.notes) {
        const bar = Math.floor(n.startTick / bt) + 1;
        const arr = byBar.get(bar) ?? [];
        arr.push(n);
        byBar.set(bar, arr);
      }
      for (const [, barNotes] of byBar) {
        for (const onset of [...new Set(barNotes.map((n) => n.startTick))]) {
          const low = barNotes.filter((n) => n.pitch < 55 && n.startTick < onset + 60 && n.startTick + n.durationTicks >= onset);
          expect(low.length, `${run.templateId} t${run.take}: ${low.length} notes below 55 at once`).toBeLessThanOrEqual(2);
          const sorted = low.map((n) => n.pitch).sort((a, b) => a - b);
          for (let i = 1; i < sorted.length; i++) {
            const iv = sorted[i] - sorted[i - 1];
            expect(iv === 3 || iv === 4, `${run.templateId} t${run.take}: a third below 55 (${sorted[i - 1]}+${sorted[i]})`).toBe(false);
          }
        }
      }
    }
  }, 900000);
});

/* ---------------- 2. the vocal zone --------------------------------------- */

describe('Phase 11.1: the vocal zone', () => {
  it('vocalbacking keeps ZERO piano notes inside 57-81 (the sparkle register and the low root/fifth replace the octave-down fallback)', () => {
    for (const run of SURVEY) {
      if (run.templateId !== 'ensemble.vocalbacking') continue;
      const piano = run.project.tracks.find((t) => t.role === PIANO);
      for (const n of piano?.notes ?? []) {
        expect(inVocalZone(n.pitch), `${run.templateId} ${run.fixture} t${run.take}: piano note ${n.pitch} inside the vocal zone`).toBe(false);
      }
    }
  }, 900000);
});

/* ---------------- 3. the pattern menu and the variety --------------------- */

describe('Phase 11.1: the pattern menu', () => {
  // Phase 11.6 UPDATE (named): the menus are the JOB menus (at least 5
  // outcomes per template) and the per-job FIGURE menus; the comp, the
  // vocalbacking and the relief-drive menus are deleted.
  it('every template draws from a job menu of at least 5 outcomes, and the figure menus are non-empty', () => {
    for (const templateId of TEMPLATES) {
      const jobs = new Set<string>();
      const figures = new Set<string>();
      for (const run of SURVEY.filter((r) => r.templateId === templateId)) {
        if (!run.pianoJobs.length) continue; // the symphony: no piano in band
        void templateId;
        for (const j of run.pianoJobs) {
          jobs.add(j.job);
          for (const f of j.figures) figures.add(f);
        }
      }
      if (!jobs.size) continue; // the symphony: no piano in band
      expect(jobs.size, `${templateId}: only ${jobs.size} distinct jobs drew`).toBeGreaterThanOrEqual(5);
      expect(figures.size, `${templateId}: no figures drew`).toBeGreaterThanOrEqual(3);
    }
  });

  it('within one take the sections never all play the same job', () => {
    for (const run of SURVEY) {
      if (run.pianoJobs.length < 2) continue;
      const allSame = run.pianoJobs.every((j) => j.job === run.pianoJobs[0].job);
      expect(allSame, `${run.templateId} ${run.fixture} t${run.take}: every section plays the ${run.pianoJobs[0].job} job`).toBe(false);
    }
  }, 900000);

  it('distinct piano tracks across takes 1-10 are at least 7 for chamber, sonata and vocalbacking on both fixtures (all six reported)', () => {
    const lines: string[] = [];
    for (const templateId of TEMPLATES) {
      for (const fixture of ['three', 'dorian'] as const) {
        const seen = new Set<string>();
        for (const run of SURVEY.filter((r) => r.templateId === templateId && r.fixture === fixture)) {
          const t = run.project.tracks.find((x) => x.role === PIANO);
          if (!t) continue;
          seen.add(JSON.stringify({ notes: t.notes, cc: t.cc ?? null }));
        }
        lines.push(`${templateId.replace('ensemble.', '')} ${fixture}: ${seen.size}`);
        if (['ensemble.chamber', 'ensemble.sonata', 'ensemble.vocalbacking'].includes(templateId)) {
          expect(seen.size, `${templateId} ${fixture}: only ${seen.size} distinct piano tracks`).toBeGreaterThanOrEqual(7);
        }
      }
    }
    console.log(`PHASE111 distinct piano tracks (takes 1-10):\n  ${lines.join('\n  ')}`);
  }, 900000);
});

/* ---------------- 4. the byte pins ---------------------------------------- */

describe('Phase 11.1: the byte pins', () => {
  const stableTrack = (t: { id: string; role: string; notes: unknown; cc?: unknown }) =>
    JSON.stringify({ id: t.id, role: t.role, notes: t.notes, ...(t.cc !== undefined ? { cc: t.cc } : {}) });

  // Phase 11.5 UPDATE (named): the harp joined the keys family's own
  // movement (the 11.5 figure menu), so the pin reads the NON-KEYS tracks.
  // The harp's golden103 pin is superseded by phase115.test.ts's golden104
  // pin and the golden105 diff.
  it('every non-keys track in all six templates is byte-identical to golden103 (the post-11.1 capture — the 11.5 update: the piano and the harp filtered)', () => {
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

  it('golden103 differs from golden102 on the keys tracks only (the engine keys replaced the generator keys; the piano re-registered)', () => {
    for (const templateId of TEMPLATES) {
      const short = templateId.replace('ensemble.', '');
      const g102 = JSON.parse(readFileSync(new URL(`./golden102/${short}-three-t1.json`, import.meta.url), 'utf8'));
      const g103 = JSON.parse(readFileSync(new URL(`./golden103/${short}-three-t1.json`, import.meta.url), 'utf8'));
      const byId102 = new Map<string, string>(g102.tracks.map((t: { id: string; role: string; notes: unknown; cc?: unknown }) => [t.id, stableTrack(t)]));
      for (const t of g103.tracks as { id: string; role: string; notes: unknown; cc?: unknown }[]) {
        const before = byId102.get(t.id);
        if (before === undefined) continue;
        if (t.role === 'harp' || t.role === 'piano') continue; // the keys module's own delta
        expect(stableTrack(t), `${short} t1: non-keys track ${t.role} differs between golden102 and golden103`).toBe(before);
      }
    }
  }, 300000);
});

/* ---------------- 5. the clamp, determinism, hygiene ---------------------- */

describe('Phase 11.1: the clamp, determinism, hygiene', () => {
  it('energy never exceeds the clamp max across six templates × both fixtures × takes 1-10 (zero aboveMax); hard findings stay 0', () => {
    for (const run of SURVEY) {
      const template = resolveTemplate(run.project.ensemble)!;
      const report = measureEnergy(run.project, template);
      const hard = report.violations.filter((v) => v.kind === 'aboveMax');
      expect(hard, `${run.templateId} ${run.fixture} t${run.take}: ${hard.length} aboveMax`).toHaveLength(0);
    }
  }, 900000);

  it('deterministic per (inputs, take); sanitizeNotes is a no-op on the piano output; validateProject passes', () => {
    for (const templateId of ['ensemble.chamber', 'ensemble.vocalbacking', 'ensemble.cinematic']) {
      const a = composeTake('three', templateId, 4, false);
      const b = composeTake('three', templateId, 4, false);
      expect(JSON.stringify(a.project.tracks)).toBe(JSON.stringify(b.project.tracks));
      const t = a.project.tracks.find((x) => x.role === PIANO)!;
      if (t.notes.length) {
        expect(sanitizeNotes(t.notes, t.lowestNote, t.highestNote, projectEndTick(a.project))).toEqual(t.notes);
      }
      expect(validateProject(JSON.parse(JSON.stringify(a.project))).ok).toBe(true);
    }
  }, 600000);
});

/* ---------------- 6. the guard on the 16 retired rules -------------------- */

describe('Phase 11.1: the guard on the generator\'s retired rules', () => {
  // spec §16.10 "Phantom input (named)": the generator still writes exactly
  // these 16 wind/percussion/keys rules as the phantom input. The set is
  // pinned with the generator's own spelling: a NEW wind, percussion or
  // keys rule fails here, and so does a SILENT REMOVAL of a listed one.
  const WIND_ROLES = new Set(['clarinets', 'flutes', 'oboes', 'bassoons']);
  const PERC_ROLES = new Set(['timpani', 'snare', 'cymbals']);
  const KEYS_ROLES = new Set(['harp', 'piano']);
  const EXPECTED = {
    winds: ['Clarinet line', 'Flutes double Vln I', 'Oboes', 'Bassoons bass', 'Oboe solo'],
    percussion: ['Timpani downbeat', 'Snare roll fill', 'Timpani', 'Snare', 'Cymbal crash'],
    keys: ['Harp arpeggio', 'Piano chords', 'Piano', 'Harp arp', 'Harp final', 'Keys sustain (any family Keys)'],
  };
  const classify = (match: { roles?: string[]; families?: string[]; trackNames?: string[] }): 'winds' | 'percussion' | 'keys' | null => {
    const roles = match.roles ?? [];
    if (roles.some((r) => WIND_ROLES.has(r))) return 'winds';
    if (roles.some((r) => PERC_ROLES.has(r))) return 'percussion';
    // the retired KEYS rules target the rostered harp/piano roles or the
    // Keys family outright; the generic 'keys' ROLE is not retired (§16.6 —
    // a user-added generic keys track stays with the generator)
    if (roles.some((r) => KEYS_ROLES.has(r))) return 'keys';
    if ((match.families ?? []).some((f) => f === 'Keys')) return 'keys';
    return null;
  };

  it('the generator writes exactly the 16 retired rules of spec §16.10 — no more, none missing', () => {
    const found: Record<'winds' | 'percussion' | 'keys', string[]> = { winds: [], percussion: [], keys: [] };
    for (const [secName, sec] of Object.entries(defaultRules.sections)) {
      for (const part of sec.parts) {
        const fam = classify(part.match);
        if (fam) found[fam].push(`${secName}:${part.label}`);
      }
    }
    const specRef = 'docs/ORCHESTRATOR_SPEC.md §16.10 "Phantom input (named)"';
    for (const fam of ['winds', 'percussion', 'keys'] as const) {
      const labels = found[fam].map((s) => s.split(':')[1]).sort();
      const want = [...EXPECTED[fam]].sort();
      expect(labels, `the retired ${fam} rules drifted — every change needs a spec update and sound re-approval (see ${specRef}); found: ${labels.join(', ')}`).toEqual(want);
    }
    expect(found.winds.length, 'the wind rule count moved').toBe(5);
    expect(found.percussion.length, 'the percussion rule count moved').toBe(5);
    expect(found.keys.length, 'the keys rule count moved').toBe(6);
  });
});
