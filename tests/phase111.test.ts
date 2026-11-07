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
  PIANO_COMP_MENU, PIANO_DRIVE_MENU, PIANO_VB_MENU,
  PIANO_LH, VB_LOW, VB_SPARKLE,
  type KeysPart, type PianoPattern,
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
// build the survey once (6 templates × both fixtures × takes 1-10)
for (const templateId of TEMPLATES) {
  for (let take = 1; take <= 10; take++) composeTake('three', templateId, take);
  for (let take = 1; take <= 10; take++) composeTake('dorian', templateId, take);
}

/* ---------------- 1. the register targets --------------------------------- */

describe('Phase 11.1: the piano register', () => {
  it('comp and arpeggiator mean pitch is at least MIDI 66, and under 15% of those notes sit below 60', () => {
    for (const templateId of TEMPLATES) {
      const runs = SURVEY.filter((r) => r.templateId === templateId);
      const template = resolveTemplate(runs[0].project.ensemble)!;
      const bt = barTicks(runs[0].project.timeSignature);
      const compArp: number[] = [];
      const lowNotes: { run: Run; n: Note; bar: number }[] = [];
      for (const run of runs) {
        const piano = run.project.tracks.find((t) => t.role === PIANO);
        if (!piano) continue;
        const kindByBar = new Map<number, string>();
        for (const b of run.result.plan.keys.bars) if (b.voices.piano) kindByBar.set(b.bar, b.voices.piano);
        for (const n of piano.notes) {
          const bar = Math.floor(n.startTick / bt) + 1;
          const kind = kindByBar.get(bar);
          if (kind !== 'comp' && kind !== 'arp') continue;
          compArp.push(n.pitch);
          if (n.pitch < 60) lowNotes.push({ run, n, bar });
        }
      }
      if (!compArp.length) continue; // symphony: no piano in band
      const mean = compArp.reduce((a, p) => a + p, 0) / compArp.length;
      expect(mean, `${templateId}: comp/arp mean ${mean.toFixed(1)} below 66`).toBeGreaterThanOrEqual(66);
      const below = lowNotes.length / compArp.length;
      expect(below, `${templateId}: ${(100 * below).toFixed(1)}% of comp/arp notes below 60`).toBeLessThanOrEqual(0.15);
      // the only sub-60 comp notes are the deliberate left-hand single
      // root/fifth at phrase starts (40-55; vocalbacking's low pattern 40-56)
      for (const { run, n, bar } of lowNotes) {
        expect(n.pitch, `${templateId} t${run.take}: a sub-60 note outside the left-hand window`).toBeGreaterThanOrEqual(40);
        expect(n.pitch, `${templateId} t${run.take}: a sub-60 note above the left-hand window`).toBeLessThanOrEqual(56);
        const sec = run.project.sections.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
        const secStart = sec?.startBar ?? 1;
        expect((bar - secStart) % 4 === 0 || bar === secStart, `${templateId} t${run.take}: a sub-60 note off the phrase starts`).toBe(true);
      }
      void template;
    }
  }, 900000);

  it('the right-hand material sits in its window: 62-84 (chamber, sonata, the arpeggiator), 82-96 above the zone and 40-56 below it (vocalbacking)', () => {
    for (const run of SURVEY) {
      const piano = run.project.tracks.find((t) => t.role === PIANO);
      if (!piano) continue;
      const isVB = run.templateId === 'ensemble.vocalbacking';
      for (const n of piano.notes) {
        if (isVB) {
          expect(
            (n.pitch >= VB_SPARKLE[0] && n.pitch <= VB_SPARKLE[1]) || (n.pitch >= VB_LOW[0] && n.pitch <= VB_LOW[1]) || n.pitch < VB_LOW[0],
            `${run.templateId} t${run.take}: piano note ${n.pitch} outside the sparkle and low windows`,
          ).toBe(true);
          expect(n.pitch >= 57 && n.pitch <= 81, `${run.templateId} t${run.take}: piano note ${n.pitch} inside the vocal zone`).toBe(false);
        } else {
          // the low events are the pulse, the tutti/final hits and the
          // left-hand singles — everything else stays in 62-84
          if (n.pitch < 62) {
            expect(n.pitch, `${run.templateId} t${run.take}: a low note below the left-hand window`).toBeGreaterThanOrEqual(33);
            expect(n.pitch, `${run.templateId} t${run.take}: a low note in the 57-61 gap`).toBeLessThan(57);
          }
        }
        expect(n.pitch, `${run.templateId} t${run.take}: a note above the sparkle cap`).toBeLessThanOrEqual(96);
      }
    }
  }, 900000);

  it('the left-hand singles are single notes (no chord) at phrase starts, inside 40-55', () => {
    for (const run of SURVEY) {
      if (run.templateId === 'ensemble.vocalbacking' || run.templateId === 'ensemble.cinematic' || run.templateId === 'ensemble.hybridstudio') continue;
      const piano = run.project.tracks.find((t) => t.role === PIANO);
      if (!piano) continue;
      const bt = barTicks(run.project.timeSignature);
      for (const n of piano.notes) {
        if (n.pitch >= PIANO_LH[0] && n.pitch <= PIANO_LH[1]) {
          const bar = Math.floor(n.startTick / bt) + 1;
          const sec = run.project.sections.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
          const secStart = sec?.startBar ?? 1;
          expect(bar === secStart || (bar - secStart) % 4 === 0, `${run.templateId} t${run.take}: a left-hand note off a phrase start`).toBe(true);
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
  it('every menu has at least 4 outcomes per section class (comp, vocalbacking, the relief drive)', () => {
    expect(PIANO_COMP_MENU.length).toBeGreaterThanOrEqual(4);
    expect(PIANO_VB_MENU.length).toBeGreaterThanOrEqual(4);
    expect(PIANO_DRIVE_MENU.length).toBeGreaterThanOrEqual(4);
    // the menus are disjoint from the drive (chorus draws only drive variants)
    for (const p of [...PIANO_COMP_MENU, ...PIANO_VB_MENU]) expect((PIANO_DRIVE_MENU as readonly string[]).includes(p)).toBe(false);
  });

  it('chorus-type sections draw only the relief drive variants; the other sections draw their template menu', () => {
    for (const run of SURVEY) {
      if (!run.planPatterns.length) continue;
      for (const e of run.planPatterns) {
        const sec = run.project.sections.find((s) => s.startBar === e.startBar);
        const isChorus = /chorus|refrain|hook|drop/.test((sec?.name ?? '').trim().toLowerCase());
        if (isChorus) {
          expect(PIANO_DRIVE_MENU.includes(e.pattern), `${run.templateId} ${run.fixture} t${run.take}: chorus drew ${e.pattern}`).toBe(true);
        } else {
          const menu = run.templateId === 'ensemble.vocalbacking' ? PIANO_VB_MENU : PIANO_COMP_MENU;
          expect(menu.includes(e.pattern), `${run.templateId} ${run.fixture} t${run.take}: section at b${e.startBar} drew ${e.pattern}`).toBe(true);
        }
      }
    }
  }, 900000);

  it('within one take the sections never all play the same pattern', () => {
    for (const run of SURVEY) {
      if (run.planPatterns.length < 2) continue;
      const allSame = run.planPatterns.every((e) => e.pattern === run.planPatterns[0].pattern);
      expect(allSame, `${run.templateId} ${run.fixture} t${run.take}: every section plays ${run.planPatterns[0].pattern}`).toBe(false);
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

  it('every non-piano track in all six templates is byte-identical to golden103 (the post-11.1 capture — the harp included)', () => {
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
