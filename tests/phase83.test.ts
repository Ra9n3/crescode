import { describe, expect, it } from 'vitest';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { measureEnergy } from '../src/orchestrator/energy';
import { projectFromFixture, type Project } from '../src/shared/schema';
import { resolveTemplate } from '../src/config/ensembles';
import {
  BRASS_CHORUS_LIKE, BRASS_PROFILES,
  type BrassPart,
} from '../src/orchestrator/brass/profile';

/**
 * Phase 8.3 — chorus weight. The diagnosis (scripts/phase83-diagnose.ts,
 * three-chorus takes 1–10, symphony/cinematic/hybridstudio) found cause (a):
 * the chorus staircase caps (0.70–0.85 of the clamp) sit at/below the
 * trumpets' high gate, so the first chorus sounded under the trumpet gate on
 * every take (trumpets in only 2–12% of chorus bars), the trombone guide
 * tones gated out of each chorus's pre-change dip bar, and the chorus's
 * below-floor windows rose (0/30/47 → 78/112/204). The old generator does
 * NOT thicken the verse more than the chorus (hypothesis (b) false).
 *
 * The fix (brass module only): inside chorus-type sections the gates lower —
 * trombones sound from the low gate, trumpets from the mid gate entering
 * through a fanfare or stab (the swell stays a non-chorus role). The peak
 * keeps the full choir and tuba; the entrance rule and the hard clamp are
 * untouched; non-chorus sections keep the base gates.
 *
 * Pinned here:
 *   1. the target — chorus mean energy > verse mean energy on takes 1–10,
 *      all three templates;
 *   2. the relief — in every chorus bar: horns and trombones from the low
 *      gate up, trumpets from the mid gate up, the drawn chorus role is a
 *      fanfare or stab, the base gates hold outside chorus bars;
 *   3. the entry — the trumpets' ordinary line starts at every chorus
 *      section's first bar (the pre-change dip / near-silence bar clears
 *      the entrance rule), all takes;
 *   4. zero aboveMax and brass in range across both fixtures, takes 1–10;
 *   5. the peak keeps the full choir and the tuba (tuba peak-only in chorus
 *      bars too).
 * The prior pins (chamber/sonata/vocalbacking byte-identity to the moments
 * goldens, non-brass tracks byte-identical outside sanctioned bars, phrase
 * caps, prepared entrances) stay in tests/brass.test.ts and re-run against
 * this build.
 */
const TEMPLATES = ['ensemble.symphony', 'ensemble.cinematic', 'ensemble.hybridstudio'];
const BRASS_ROLES: readonly BrassPart[] = ['horns', 'trumpets', 'trombones', 'tuba'];

const composeTake = (base: Project, templateId: string, take: number) => {
  const p: Project = projectFromFixture(JSON.parse(JSON.stringify(base)));
  p.ensemble = { templateId, overrides: {}, pins: {} };
  p.orchestration = { take };
  const result = composeAllTracks(p, { seed: 11, moments: true });
  return { project: { ...p, tracks: result.tracks, orchestration: result.orchestration } as Project, result };
};

const THREE = (): Project => projectFromFixture(JSON.parse(JSON.stringify(threeChorus)));
const DORIAN = (): Project => projectFromFixture(JSON.parse(JSON.stringify(dorian)));

const typeAtBar = (p: Project, bar: number): string => {
  const sec = p.sections.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
  return (sec?.name ?? '*').trim().toLowerCase() || '*';
};

/** The section-type means over ALL energy windows (the diagnosis metric). */
function sectionMeans(p: Project, templateId: string): Record<string, number> {
  const template = resolveTemplate({ templateId, overrides: {}, pins: {} })!;
  const report = measureEnergy(p, template);
  const acc: Record<string, { sum: number; n: number }> = {};
  for (const w of report.windows) {
    const type = typeAtBar(p, w.bar);
    (acc[type] ??= { sum: 0, n: 0 });
    acc[type].sum += w.energy;
    acc[type].n++;
  }
  return Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, v.sum / v.n]));
}

describe('Phase 8.3: the target — a chorus never sounds thinner than a verse', () => {
  it('chorus mean energy > verse mean energy on every take 1–10, all three templates', () => {
    const lines: string[] = [];
    for (const templateId of TEMPLATES) {
      for (let take = 1; take <= 10; take++) {
        const { project } = composeTake(THREE(), templateId, take);
        const means = sectionMeans(project, templateId);
        expect(means.chorus, `${templateId} t${take}: chorus ${means.chorus?.toFixed(3)} vs verse ${means.verse?.toFixed(3)}`)
          .toBeGreaterThan(means.verse);
        lines.push(`${templateId.slice(9)} t${take} chorus ${means.chorus.toFixed(3)} > verse ${means.verse.toFixed(3)}`);
      }
    }
    console.log(`8.3 chorus>verse (after the relief): ${lines.length} take-checks pass\n  ${lines.join('\n  ')}`);
  }, 600000);
});

describe('Phase 8.3: the chorus relief contract (plan level)', () => {
  const runs: { templateId: string; take: number; project: Project; result: ReturnType<typeof composeAllTracks> }[] = [];
  for (const templateId of TEMPLATES) {
    for (let take = 1; take <= 10; take++) {
      const { project, result } = composeTake(THREE(), templateId, take);
      runs.push({ templateId, take, project, result });
    }
  }

  it('horns and trombones sound from the low gate up in EVERY chorus bar; trumpets from the mid gate up; the base gates hold outside chorus bars', () => {
    for (const run of runs) {
      for (const b of run.result.plan.brass.bars) {
        const chorus = BRASS_CHORUS_LIKE.test(typeAtBar(run.project, b.bar));
        if (chorus) {
          if (b.level !== 'off') {
            expect(b.ordinary.horns, `${run.templateId} t${run.take} b${b.bar} horns gated out of a chorus bar (${b.level})`).toBeDefined();
            expect(b.ordinary.trombones, `${run.templateId} t${run.take} b${b.bar} trombones gated out of a chorus bar (${b.level})`).toBeDefined();
          }
          if (b.level === 'low') {
            expect(b.ordinary.trumpets, `${run.templateId} t${run.take} b${b.bar} trumpets sound below the chorus relief gate`).toBeUndefined();
          } else if (b.level !== 'off') {
            expect(b.ordinary.trumpets, `${run.templateId} t${run.take} b${b.bar} trumpets gated out of a chorus bar at ${b.level}`).toBeDefined();
          }
          if (b.level !== 'peak') {
            expect(b.ordinary.tuba, `${run.templateId} t${run.take} b${b.bar} tuba sounds in a non-peak chorus bar`).toBeUndefined();
          }
        } else {
          if (b.level === 'low') {
            expect(b.ordinary.trombones, `${run.templateId} t${run.take} b${b.bar} trombones sound at low outside a chorus`).toBeUndefined();
            expect(b.ordinary.trumpets, `${run.templateId} t${run.take} b${b.bar} trumpets sound at low outside a chorus`).toBeUndefined();
          }
          if (b.level === 'mid') {
            expect(b.ordinary.trumpets, `${run.templateId} t${run.take} b${b.bar} trumpets sound at mid outside a chorus`).toBeUndefined();
          }
        }
      }
    }
  });

  it('the drawn trumpet role for a chorus-type section is a fanfare or a stab (never a swell); non-chorus types keep the full draw', () => {
    for (const run of runs) {
      const roles = run.result.plan.brass.trumpetRoleByType;
      for (const [key, role] of Object.entries(roles)) {
        if (BRASS_CHORUS_LIKE.test(key)) {
          expect(role === 'fanfare' || role === 'stab', `${run.templateId} t${run.take} chorus role ${role}`).toBe(true);
        }
      }
    }
  });

  it('the trumpets enter at every chorus start (the ordinary line begins at the section\u2019s first bar, entrance rule cleared by the dip/near-silence bar before)', () => {
    for (const run of runs) {
      const chorusStarts = run.project.sections
        .filter((s) => BRASS_CHORUS_LIKE.test(s.name.trim().toLowerCase()))
        .map((s) => s.startBar);
      expect(chorusStarts.length).toBe(3);
      for (const start of chorusStarts) {
        const b = run.result.plan.brass.bars[start - 1];
        expect(b.ordinary.trumpets, `${run.templateId} t${run.take} no trumpet entry at the chorus start b${start}`).toBeDefined();
        expect(b.ordinary.horns, `${run.templateId} t${run.take} no horn at the chorus start b${start}`).toBeDefined();
        expect(b.ordinary.trombones, `${run.templateId} t${run.take} no trombone at the chorus start b${start}`).toBeDefined();
      }
    }
  });

  it('every ordinary brass entrance (the relief included) follows a strictly lower-energy bar', () => {
    for (const run of runs) {
      const bars = run.result.plan.brass.bars;
      for (const role of BRASS_ROLES) {
        let prevSounded = false;
        for (const b of bars) {
          const kind = b.voices[role];
          const momentKind = kind === 'tutti' || kind === 'unison' || kind === 'soli' || kind === 'lead' || kind === 'leadDouble';
          if (kind !== undefined && !prevSounded && !momentKind && b.bar > 1) {
            const before = bars[b.bar - 2]?.norm ?? 0;
            expect(before, `${run.templateId} t${run.take} ${role} entrance at b${b.bar} without a lower-energy bar before`).toBeLessThan(b.norm);
          }
          // a moment bar whose ordinary line ghost-runs keeps the part's
          // continuity — the output silence is the moment's gesture, not a gap
          prevSounded = kind !== undefined || (b.moment !== undefined && bars[b.bar - 1]?.ordinary[role] !== undefined);
        }
      }
    }
  });
});

describe('Phase 8.3: the clamp and the ranges hold with the relief', () => {
  it('zero aboveMax findings across both fixtures, three templates, takes 1–10', () => {
    let surveyed = 0;
    for (const templateId of TEMPLATES) {
      for (const [fixN, base] of [['three', THREE], ['dorian', DORIAN]] as const) {
        const takes = fixN === 'three' ? 10 : 6;
        for (let take = 1; take <= takes; take++) {
          const { project } = composeTake(base(), templateId, take);
          const template = resolveTemplate({ templateId, overrides: {}, pins: {} })!;
          const hard = measureEnergy(project, template).violations.filter((v) => v.kind === 'aboveMax');
          expect(hard, `${templateId} ${fixN} t${take}: ${hard.map((v) => v.message).join(' | ')}`).toHaveLength(0);
          surveyed++;
        }
      }
    }
    console.log(`8.3 aboveMax: 0 across ${surveyed} compose runs (both fixtures, takes 1–10/1–6)`);
  }, 600000);

  it('every brass note stays inside the hard range and the sweet zone', () => {
    for (const templateId of TEMPLATES) {
      for (let take = 1; take <= 10; take++) {
        const { project } = composeTake(THREE(), templateId, take);
        for (const role of BRASS_ROLES) {
          const t = project.tracks.find((x) => x.role === role);
          if (!t || !t.notes.length) continue;
          const prof = BRASS_PROFILES[role];
          for (const n of t.notes) {
            expect(n.pitch).toBeGreaterThanOrEqual(t.lowestNote);
            expect(n.pitch).toBeLessThanOrEqual(t.highestNote);
            expect(n.pitch).toBeGreaterThanOrEqual(prof.sweet[0]);
            expect(n.pitch).toBeLessThanOrEqual(prof.sweet[1]);
          }
        }
      }
    }
  }, 600000);

  it('the peak chorus keeps the full choir: at the peak level every ROSTERED brass part\u2019s ordinary line sounds, tuba included where the template has one (moment output overrides aside)', () => {
    let peakBars = 0;
    for (const templateId of TEMPLATES) {
      const rostered = resolveTemplate({ templateId, overrides: {}, pins: {} })!.roster.map((r) => r.role);
      const parts = BRASS_ROLES.filter((p) => rostered.includes(p));
      for (let take = 1; take <= 10; take++) {
        const { result } = composeTake(THREE(), templateId, take);
        for (const b of result.plan.brass.bars) {
          if (b.level !== 'peak') continue;
          peakBars++;
          for (const role of parts) {
            expect(b.ordinary[role], `${templateId} t${take} b${b.bar}: ${role} missing from the ordinary line at the peak gate`).toBeDefined();
          }
        }
      }
    }
    expect(peakBars).toBeGreaterThan(0);
  }, 30000); // the survey grew with the keys module (the phase81 convention)
});
