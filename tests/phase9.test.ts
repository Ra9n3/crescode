import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { checkTemplateRules, measureEnergy } from '../src/orchestrator/energy';
import { barTicks, beatTicks } from '../src/shared/schema/meter';
import { sanitizeNotes } from '../src/engine/generate';
import { chunksForTrack, validateExportProfile } from '../src/export/profile';
import { EXPORT_PROFILES } from '../src/export/profiles';
import { projectEndTick, projectFromFixture, validateProject, type Note, type Project, type Track } from '../src/shared/schema';
import { resolveTemplate } from '../src/config/ensembles';
import { chordTones } from '../src/orchestrator/voicing/chordTones';
import { secondsToTicks, chordSpans as chordSpansOf } from '../src/orchestrator/spine';
import { humanizeHeadTicks } from '../src/orchestrator/expression/timing';
import { scalePitchClasses } from '../src/shared/schema/modes';
import { WIND_GATES, WIND_PROFILES, type WindPart } from '../src/orchestrator/winds/profile';

/**
 * Phase 9 — woodwinds: the winds module beside the strings and brass (spec
 * §14). Pinned here: the pre-flight baseline captured at the post-8.3 HEAD
 * into tests/golden90/ (chamber/sonata/vocalbacking byte-identical; the wind
 * templates' non-wind tracks identical outside the sanctioned bars — wind
 * leads, wind solis, moment bars on either side, the legato-join window),
 * the roster/range/zone rules, the addendum's soft-dynamics floors and
 * ceilings, the phrase caps and rhythm floors, the low-interval rule, one
 * lead at a time + the lead ceiling, the pickup-run contract, the lead-double
 * variation, the chorus-aware gating (upper winds sound through choruses;
 * the chorus mean never drops below the baseline), the clamp, locks/band,
 * hygiene, exports, and the wind moment joins.
 */
const TEMPLATES = ['ensemble.symphony', 'ensemble.chamber', 'ensemble.cinematic', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.hybridstudio'];
const WIND_TEMPLATES = ['ensemble.symphony', 'ensemble.cinematic', 'ensemble.hybridstudio'];
const PIN_TEMPLATES = ['ensemble.chamber', 'ensemble.sonata', 'ensemble.vocalbacking'];
const WIND_ROLES: readonly WindPart[] = ['flutes', 'oboes', 'clarinets', 'bassoons'];
const PROFILE = EXPORT_PROFILES[0].profile;

const THREE = (): Project => projectFromFixture(JSON.parse(JSON.stringify(threeChorus)));
const DORIAN = (): Project => projectFromFixture(JSON.parse(JSON.stringify(dorian)));

const composeTake = (base: Project, templateId: string, take: number, moments = true, seed = 11) => {
  const p = base;
  p.ensemble = { templateId, overrides: {}, pins: {} };
  p.orchestration = { take };
  const result = composeAllTracks(p, { seed, moments });
  return { project: { ...p, tracks: result.tracks, orchestration: result.orchestration } as Project, result };
};

const trackOf = (p: Project, role: string): Track => p.tracks.find((t) => t.role === role)!;
const btBarOf = (p: Project) => barTicks(p.timeSignature);
const rosterOf = (templateId: string): WindPart[] => {
  const t = resolveTemplate({ templateId, overrides: {}, pins: {} })!;
  return WIND_ROLES.filter((r) => t.roster.some((x) => x.role === r));
};

interface Run { templateId: string; take: number; fixture: string; project: Project; result: ReturnType<typeof composeAllTracks> }
const SURVEY: Run[] = [];
for (const templateId of TEMPLATES) {
  for (let take = 1; take <= 10; take++) {
    const { project, result } = composeTake(THREE(), templateId, take);
    SURVEY.push({ templateId, take, fixture: 'three', project, result });
  }
  for (let take = 1; take <= 10; take++) {
    const { project, result } = composeTake(DORIAN(), templateId, take);
    SURVEY.push({ templateId, take, fixture: 'dorian', project, result });
  }
}
const windSurvey = SURVEY.filter((r) => (WIND_TEMPLATES as string[]).includes(r.templateId));
const windTracksOf = (p: Project): Track[] => p.tracks.filter((t) => (WIND_ROLES as string[]).includes(t.role) && t.notes.length > 0);
const isSoft = (a: Note['articulation'] | undefined) => a === 'sustain' || a === 'legato';
const windNotesSoundingAt = (p: Project, bar: number, parts: string[]): boolean => {
  const btBar = btBarOf(p);
  const s = (bar - 1) * btBar, e = bar * btBar;
  return p.tracks.filter((t) => parts.includes(t.role)).some((t) => t.notes.some((n) => n.startTick < e && n.startTick + n.durationTicks > s));
};
const secTypeAt = (bar: number): string => {
  const secs = [{ name: 'Verse', startBar: 1, lengthBars: 4 }, { name: 'Chorus', startBar: 5, lengthBars: 8 }, { name: 'Verse', startBar: 13, lengthBars: 4 }, { name: 'Chorus', startBar: 17, lengthBars: 8 }, { name: 'Bridge', startBar: 25, lengthBars: 4 }, { name: 'Chorus', startBar: 29, lengthBars: 8 }, { name: 'Outro', startBar: 37, lengthBars: 4 }];
  const s = secs.find((x) => bar >= x.startBar && bar < x.startBar + x.lengthBars);
  return s ? s.name.toLowerCase() : '*';
};
const dorianSecTypeAt = (bar: number): string => (bar <= 8 ? 'verse' : 'chorus');
const secTypeOf = (run: Run, bar: number): string => (run.fixture === 'three' ? secTypeAt(bar) : dorianSecTypeAt(bar));
const barsOf = (run: Run): number => (run.fixture === 'three' ? 40 : 16);

/* ---------------- 1+2. roster, ranges, zones, dynamics ------------------- */

describe('Phase 9: roster, ranges, zones', () => {
  it('wind notes appear only on rostered wind tracks, inside the hard ranges and the writing windows; templates without winds stay silent', () => {
    for (const run of SURVEY) {
      const roster = new Set(run.result.plan.winds.bars.flatMap((b) => Object.keys(b.voices)));
      for (const t of windTracksOf(run.project)) {
        expect(roster.has(t.role), `${run.templateId} ${run.fixture} t${run.take} ${t.role} wrote without a plan`).toBe(true);
        const prof = WIND_PROFILES[t.role as WindPart];
        for (const n of t.notes) {
          expect(n.pitch).toBeGreaterThanOrEqual(t.lowestNote);
          expect(n.pitch).toBeLessThanOrEqual(t.highestNote);
          // the writing window: the sweet spot, plus the clarinet's dark colour zone
          const lo = t.role === 'clarinets' ? 50 : prof.sweet[0];
          expect(n.pitch, `${run.templateId} ${run.fixture} t${run.take} ${t.role} note ${n.pitch}`).toBeGreaterThanOrEqual(lo);
          expect(n.pitch).toBeLessThanOrEqual(prof.sweet[1]);
        }
      }
      for (const t of run.project.tracks.filter((x) => (WIND_ROLES as string[]).includes(x.role))) {
        if (!(WIND_TEMPLATES as string[]).includes(run.templateId)) {
          expect(t.notes.length, `${run.templateId} ${t.role} must be silent without a wind roster`).toBe(0);
          expect(t.cc, `${run.templateId} ${t.role} must have no cc without a wind roster`).toBeUndefined();
        }
      }
    }
  });

  it('no soft dynamics in the strained zones; the addendum floors and ceiling hold (oboe ≥ 63, bassoon ≥ 41, flute soft ≤ 84)', () => {
    let checked = 0;
    for (const run of windSurvey) {
      for (const role of WIND_ROLES) {
        const t = trackOf(run.project, role);
        const prof = WIND_PROFILES[role];
        for (const n of t.notes) {
          if (isSoft(n.articulation)) {
            expect(n.pitch, `${run.templateId} t${run.take} ${role} soft ${n.pitch} in the strained zone (≥ ${prof.strainedBottom})`).toBeLessThan(prof.strainedBottom);
            if (prof.softCeiling !== null) expect(n.pitch, `${run.templateId} t${run.take} ${role} soft above ${prof.softCeiling}`).toBeLessThanOrEqual(prof.softCeiling);
            if (prof.softFloor !== null) expect(n.pitch, `${run.templateId} t${run.take} ${role} soft below ${prof.softFloor}`).toBeGreaterThanOrEqual(prof.softFloor);
            checked++;
          } else if (n.pitch >= prof.strainedBottom) {
            // strained-zone notes are loud-only: they ride high-energy bars
            const bar = Math.min(barsOf(run), Math.floor(n.startTick / btBarOf(run.project)) + 1);
            const norm = run.result.plan.winds.bars[bar - 1]?.norm ?? 0;
            expect(norm, `${run.templateId} t${run.take} ${role} strained ${n.pitch} at norm ${norm.toFixed(2)}`).toBeGreaterThanOrEqual(WIND_GATES.high - 1e-9);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('the clarinet 65–68 ban: no lead, counterline or pickup-run note there; the flute never leads from 60–66', () => {
    for (const run of windSurvey) {
      for (const b of run.result.plan.winds.bars) {
        for (const [part, kind] of Object.entries(b.voices) as [WindPart, string][]) {
          if (!['lead', 'counter', 'leadDouble'].includes(kind)) continue;
          const t = trackOf(run.project, part);
          const inBar = t.notes.filter((n) => n.startTick >= (b.bar - 1) * btBarOf(run.project) && n.startTick < b.bar * btBarOf(run.project));
          for (const n of inBar) {
            if (part === 'clarinets') expect(n.pitch >= 65 && n.pitch <= 68, `${run.templateId} t${run.take} clarinet ${kind} in the 65–68 ban (${n.pitch})`).toBe(false);
            if (part === 'flutes') expect(n.pitch >= 60 && n.pitch <= 66, `${run.templateId} t${run.take} flute ${kind} in the 60–66 ban (${n.pitch})`).toBe(false);
          }
        }
      }
      // pickup runs too
      for (const r of run.result.plan.winds.pickupRuns) {
        if (r.part === 'clarinets') expect(r.downbeatPitch >= 65 && r.downbeatPitch <= 68, `clarinet pickup landing in the 65–68 ban`).toBe(false);
      }
    }
  });
});

/* ---------------- 3+4. phrase caps, breaths, rhythm floors --------------- */

describe('Phase 9: phrase caps and rhythm floors', () => {
  it('every continuous wind stretch respects the part cap (seconds and the addendum bar bounds) and rests ≥ 1 beat after a cut', () => {
    for (const run of windSurvey) {
      const beat = beatTicks(run.project.timeSignature);
      for (const role of WIND_ROLES) {
        const t = trackOf(run.project, role);
        if (!t.notes.length) continue;
        const prof = WIND_PROFILES[role];
        const capByBars = prof.phraseCapBars !== null ? prof.phraseCapBars * btBarOf(run.project) : Infinity;
        const capTicks = Math.max(beat, Math.min(capByBars, Math.round(prof.phraseCapSec * 1000 * (run.project.tempoMap[0].bpm / 60000) * (btBarOf(run.project) / 4))));
        // gesture kinds, the cello-riding double and the brass-windowing
        // cut-over (which mirrors the tune's own phrasing) are exempt
        const brassActiveBars = new Set(
          run.result.plan.brass.bars
            .filter((b) => Object.values(b.ordinary).some((k) => k === 'fanfare' || k === 'stab')
              || run.result.plan.brass.leads.some((l) => b.bar >= l.startBar && b.bar <= l.endBar))
            .map((b) => b.bar),
        );
        const exemptBars = new Set(
          run.result.plan.winds.bars
            .filter((b) => ['tutti', 'unison', 'soli', 'lead', 'bassDouble'].includes(b.voices[role] ?? '') || brassActiveBars.has(b.bar))
            .map((b) => b.bar),
        );
        const sorted = [...t.notes].sort((a, b) => a.startTick - b.startTick);
        let runStart: number | null = null;
        let prevEnd = -Infinity;
        for (const n of sorted) {
          const bar = Math.floor(n.startTick / btBarOf(run.project)) + 1;
          if (exemptBars.has(bar)) { runStart = null; prevEnd = n.startTick + n.durationTicks; continue; }
          if (n.startTick - prevEnd >= beat || runStart === null) runStart = n.startTick;
          const span = n.startTick + n.durationTicks - runStart;
          expect(span, `${run.templateId} ${run.fixture} t${run.take} ${role} run ${span} > cap ${capTicks}`).toBeLessThanOrEqual(capTicks);
          prevEnd = n.startTick + n.durationTicks;
        }
      }
    }
  });

  it('the bassoon never moves faster than eighths; oboes and clarinets repeat same-pitch 16ths only below 120 BPM; flutes may always', () => {
    let bassoonPairs = 0;
    for (const run of windSurvey) {
      const eighth = beatTicks(run.project.timeSignature) / 2;
      const sixteenth = beatTicks(run.project.timeSignature) / 4;
      for (const role of WIND_ROLES) {
        const t = trackOf(run.project, role);
        const sorted = [...t.notes].sort((a, b) => a.startTick - b.startTick);
        if (role === 'bassoons') {
          for (let i = 1; i < sorted.length; i++) {
            const gap = sorted[i].startTick - sorted[i - 1].startTick;
            if (gap <= sixteenth + 1) {
              expect(gap, `${run.templateId} t${run.take} bassoon onset gap ${gap} < an eighth (${eighth})`).toBeGreaterThanOrEqual(eighth - 1);
              bassoonPairs++;
            }
          }
        } else {
          const bpm = run.project.tempoMap[0].bpm;
          for (let i = 1; i < sorted.length; i++) {
            const a = sorted[i - 1], b = sorted[i];
            if (a.pitch === b.pitch && b.startTick - a.startTick <= sixteenth + 1 && b.startTick - a.startTick > 1) {
              if (role === 'flutes') continue; // 16ths at any tempo
              expect(bpm, `${run.templateId} t${run.take} ${role} repeated 16ths at ${bpm} BPM`).toBeLessThan(120);
            }
          }
        }
      }
    }
    void bassoonPairs;
  });
});

/* ---------------- 5. the low-interval rule -------------------------------- */

describe('Phase 9: the bassoon low-interval rule', () => {
  it('every sub-48 bassoon note sits a unison, octave or 5th+ from every other low voice sounding with it', () => {
    let checked = 0;
    for (const run of windSurvey) {
      const lowTracks = run.project.tracks.filter((t) => ['cellosBasses', 'basses', 'trombones', 'tuba', 'bassoons'].includes(t.role));
      for (const b of lowTracks) {
        for (const n of b.notes) {
          if (b.role !== 'bassoons' || n.pitch >= 48) continue;
          for (const o of lowTracks) {
            if (o.id === b.id) continue;
            for (const m of o.notes) {
              // the strict WRITTEN overlap — the renderer's own semantics at
              // wind-render time; a transient overlap no longer than the
              // legato-join crossfade window is the entry crossfade class
              if (m.startTick >= n.startTick + n.durationTicks || m.startTick + m.durationTicks <= n.startTick) continue;
              const overlap = Math.min(n.startTick + n.durationTicks, m.startTick + m.durationTicks) - Math.max(n.startTick, m.startTick);
              const joinWindow = humanizeHeadTicks(run.project.tempoMap, n.startTick) + Math.ceil(secondsToTicks(0.035, run.project.tempoMap));
              if (overlap <= joinWindow) continue;
              if (Math.min(n.pitch, m.pitch) >= 48) continue;
              const d = Math.abs(n.pitch - m.pitch);
              const ok = d === 0 || d % 12 === 0 || d >= 7;
              expect(ok, `${run.templateId} t${run.take} bassoon ${n.pitch} vs ${o.role} ${m.pitch} (d=${d}) under 48`).toBe(true);
              checked++;
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
  });
});

/* ---------------- 6. one lead at a time + the lead ceiling ---------------- */

describe('Phase 9: the wind lead', () => {
  it('wind leads live in bridge interiors, 2–4 bars, never with the brass lead or a moment; the other winds stay under the lead ceiling', () => {
    let leads = 0;
    for (const run of windSurvey) {
      const btBar = btBarOf(run.project);
      for (const l of run.result.plan.winds.leads) {
        leads++;
        const sec = run.result.plan.bars.length && l.startBar <= barsOf(run) ? secTypeOf(run, l.startBar) : '*';
        expect(sec, `${run.templateId} t${run.take} wind lead in a ${sec}`).toMatch(/bridge|middle/);
        expect(l.startBar, 'the lead never opens the section (the soli/imitation openings stay free)').toBeGreaterThan(secStartOf(run, l.startBar));
        expect(l.endBar, 'the lead never takes the section\'s last bar (the pre-chorus dip stays free)').toBeLessThan(secEndOf(run, l.startBar));
        const span = l.endBar - l.startBar + 1;
        expect(span).toBeGreaterThanOrEqual(2);
        expect(span).toBeLessThanOrEqual(4);
        for (let b = l.startBar; b <= l.endBar; b++) {
          expect(run.result.plan.brass.leads.some((x) => b >= x.startBar && b <= x.endBar), `wind lead shares bar ${b} with the brass lead`).toBe(false);
          expect(run.result.plan.moments.some((m) => b >= m.startBar && b <= m.endBar), `wind lead shares bar ${b} with a moment`).toBe(false);
          // the lead ceiling: every other wind voice stays at/below the lead's lowest pitch
          const leadTrack = trackOf(run.project, l.part);
          const leadNotes = leadTrack.notes.filter((n) => n.startTick < b * btBar && n.startTick + n.durationTicks > (b - 1) * btBar);
          if (!leadNotes.length) continue;
          const ceiling = Math.min(...leadNotes.map((n) => n.pitch));
          for (const part of WIND_ROLES) {
            if (part === l.part) continue;
            const t = trackOf(run.project, part);
            for (const n of t.notes.filter((x) => x.startTick >= (b - 1) * btBar && x.startTick < b * btBar)) {
              expect(n.pitch, `${run.templateId} t${run.take} ${part} ${n.pitch} over the wind lead ceiling ${ceiling} at bar ${b}`).toBeLessThanOrEqual(ceiling);
            }
          }
        }
      }
    }
    expect(leads).toBeGreaterThan(0);
  });
});

const secStartOf = (run: Run, bar: number): number => {
  const secs = run.fixture === 'three'
    ? [{ n: 1, s: 1, l: 4 }, { n: 5, s: 5, l: 8 }, { n: 13, s: 13, l: 4 }, { n: 17, s: 17, l: 8 }, { n: 25, s: 25, l: 4 }, { n: 29, s: 29, l: 8 }, { n: 37, s: 37, l: 4 }]
    : [{ n: 1, s: 1, l: 8 }, { n: 9, s: 9, l: 8 }];
  return secs.find((x) => bar >= x.s && bar < x.s + x.l)?.s ?? 1;
};
const secEndOf = (run: Run, bar: number): number => {
  const secs = run.fixture === 'three'
    ? [{ s: 1, l: 4 }, { s: 5, l: 8 }, { s: 13, l: 4 }, { s: 17, l: 8 }, { s: 25, l: 4 }, { s: 29, l: 8 }, { s: 37, l: 4 }]
    : [{ s: 1, l: 8 }, { s: 9, l: 8 }];
  const x = secs.find((y) => bar >= y.s && bar < y.s + y.l);
  return x ? x.s + x.l - 1 : barsOf(run);
};

/* ---------------- 7+8. pickup runs, lead-double variation ----------------- */

describe('Phase 9: pickup runs and lead doubles', () => {
  it('pickup runs are rare (≤ 2 per piece), land on a chord tone at the chorus downbeat, and ride scale tones', () => {
    let runs = 0;
    for (const run of windSurvey) {
      const perTake = run.result.plan.winds.pickupRuns.length;
      expect(perTake, `${run.templateId} ${run.fixture} t${run.take} has ${perTake} pickup runs`).toBeLessThanOrEqual(2);
      const scalePcs = new Set(scalePitchClasses(run.project.key, run.project.mode));
      for (const r of run.result.plan.winds.pickupRuns) {
        runs++;
        // the renderer skips a run whose bar or downbeat a gesture owns
        const momentBar = run.result.plan.moments.find((m) => r.bar >= m.startBar && r.bar <= m.endBar);
        const momentDown = run.result.plan.moments.find((m) => r.downbeatBar >= m.startBar && r.downbeatBar <= m.endBar);
        const leadHere = run.result.plan.winds.leads.some((l) => r.bar >= l.startBar && r.bar <= l.endBar);
        if (momentBar || momentDown?.kind === 'unison' || momentDown?.kind === 'soli' || leadHere) continue;
        const t = trackOf(run.project, r.part);
        // the landing note (or the tutti hit standing in for it) is a chord tone of the downbeat
        const landing = t.notes.find((n) => n.startTick === r.downbeatTick);
        if (landing) {
          const tones = planChordTonesAt(run, r.downbeatTick);
          expect(tones.has(((landing.pitch % 12) + 12) % 12), `${run.templateId} t${run.take} pickup run lands on ${landing.pitch}, chord tones ${[...tones]}`).toBe(true);
          // the landing equals the planned pitch unless a tutti hit stands in
          const hitStandingIn = run.result.plan.moments.some((m) => m.kind === 'tutti' && r.downbeatBar >= m.startBar && r.downbeatBar <= m.endBar)
            && run.result.plan.winds.bars[r.downbeatBar - 1]?.voices[r.part] === 'tutti';
          if (!hitStandingIn) expect(landing.pitch).toBe(r.downbeatPitch);
        }
        // the run's own notes are scale tones rising into the landing
        for (const n of t.notes.filter((x) => x.startTick >= r.startTick && x.startTick < r.downbeatTick)) {
          expect(scalePcs.has(((n.pitch % 12) + 12) % 12), `${run.templateId} t${run.take} run note ${n.pitch} off-scale`).toBe(true);
        }
        void r;
      }
    }
    expect(runs).toBeGreaterThan(0);
  });

  it('the lead double is drawn per section and varies across sections and takes (never one constant choice)', () => {
    const variants = new Set<string>();
    for (const run of windSurvey) {
      for (const [typeKey, d] of Object.entries(run.result.plan.winds.leadDoubleByType)) {
        variants.add(`${typeKey}=${d.part ?? 'none'}/${d.mode}`);
      }
    }
    expect(variants.size, `lead-double choices collapsed to ${[...variants].join(' ')}`).toBeGreaterThan(6);
    // within one template the chorus double is not the same on every take
    for (const templateId of WIND_TEMPLATES) {
      const set = new Set<string>();
      for (const run of windSurvey.filter((r) => r.templateId === templateId && r.fixture === 'three')) {
        const d = run.result.plan.winds.leadDoubleByType['chorus'];
        if (d) set.add(`${d.part ?? 'none'}/${d.mode}`);
      }
      expect(set.size, `${templateId} chorus double never varies`).toBeGreaterThan(1);
    }
  });
});

/** The chord-tone pcs at a tick (from the composed chord spans). */
const planChordTonesAt = (run: Run, tick: number): Set<number> => {
  const sp = chordSpansOf(run.project).find((s) => s.startTick <= tick && tick < s.endTick);
  const tones = new Set<number>();
  if (sp) for (const t of chordTones(sp.parsed).tones) tones.add(((t.pc % 12) + 12) % 12);
  return tones;
};

/* ---------------- 9. the clamp -------------------------------------------- */

describe('Phase 9: the hard clamp', () => {
  it('energy never exceeds the clamp max across six templates × takes 1–10 × both fixtures', () => {
    for (const run of SURVEY) {
      const template = resolveTemplate(run.project.ensemble)!;
      const report = measureEnergy(run.project, template);
      const breaches = report.violations.filter((v) => v.kind === 'aboveMax');
      expect(breaches, `${run.templateId} ${run.fixture} t${run.take}: ${breaches.length} clamp breaches`).toHaveLength(0);
    }
  });
});

/* ---------------- 10+11. the baseline pins -------------------------------- */

const stableTracks = (result: ReturnType<typeof composeAllTracks>): string =>
  JSON.stringify({
    tracks: result.tracks.map((t) => ({ id: t.id, role: t.role, notes: t.notes, ...(t.cc !== undefined ? { cc: t.cc } : {}) })),
  });

describe('Phase 9: the moments-on baseline pins (golden90, captured at the post-8.3 HEAD)', () => {
  it('chamber, sonata and vocalbacking are byte-identical to the baseline (3 templates × 2 fixtures × takes 1–10)', () => {
    // Phase 11: the keys tracks (harp, piano) are excluded — the keys module
    // owns their sound from Phase 11 on (the sanctioned change); the pin
    // here is the WINDS-phase contract for every other track.
    const KEYS_SET = new Set<string>(['harp', 'piano']);
    const stableTrack = (t: { id: string; role: string; notes: unknown; cc?: unknown }) =>
      JSON.stringify({ id: t.id, role: t.role, notes: t.notes, ...(t.cc !== undefined ? { cc: t.cc } : {}) });
    for (const templateId of PIN_TEMPLATES) {
      const short = templateId.replace('ensemble.', '');
      for (const [fixTag, base] of [['three', THREE], ['dorian', DORIAN]] as const) {
        for (let take = 1; take <= 10; take++) {
          const golden = JSON.parse(readFileSync(new URL(`./golden90/${short}-${fixTag}-t${take}.json`, import.meta.url), 'utf8'));
          const { result } = composeTake(base(), templateId, take);
          const goldenTracks = golden.tracks.filter((t: { role: string }) => !KEYS_SET.has(t.role));
          const current = result.tracks.filter((t) => !KEYS_SET.has(t.role));
          expect(current.map(stableTrack), `${short} ${fixTag} t${take} diverged from the baseline`)
            .toEqual(goldenTracks.map(stableTrack));
        }
      }
    }
  });

  it('symphony, cinematic, hybridstudio: every non-wind, non-percussion track matches the baseline outside the sanctioned bars (wind leads, wind solis, moments, brass leads)', () => {
    // Phase 10: the percussion tracks (timpani, snare, cymbals, aux) are
    // excluded — the percussion module owns their sound from Phase 10 on
    // (the sanctioned change); the pin here is the WINDS' contract.
    const PERC_ROLES = ['timpani', 'snare', 'cymbals', 'aux'];
    for (const templateId of WIND_TEMPLATES) {
      const short = templateId.replace('ensemble.', '');
      for (const [fixTag, base] of [['three', THREE], ['dorian', DORIAN]] as const) {
        for (let take = 1; take <= 10; take++) {
          const golden = JSON.parse(readFileSync(new URL(`./golden90/${short}-${fixTag}-t${take}.json`, import.meta.url), 'utf8'));
          const { result } = composeTake(base(), templateId, take);
          // excluded from the pin: the wind-lead bars (the strings drop to
          // pad), every MOMENT bar on EITHER side (a wind may carry the soli),
          // the brass-lead bars and the horn-soli bars
          const leadBars = new Set<number>();
          for (const l of result.plan.winds.leads) for (let b = l.startBar; b <= l.endBar; b++) leadBars.add(b);
          for (const l of result.plan.brass.leads) for (let b = l.startBar; b <= l.endBar; b++) leadBars.add(b);
          for (const l of golden.leads ?? []) for (let b = l.startBar; b <= l.endBar; b++) leadBars.add(b);
          for (const m of result.plan.moments) for (let b = m.startBar; b <= m.endBar; b++) leadBars.add(b);
          for (const m of golden.moments ?? []) for (let b = m.startBar; b <= m.endBar; b++) leadBars.add(b);
          const btBar = btBarOf(THREE());
          const joinOf = new Map<number, number>();
          for (const b of leadBars) {
            const bs = (b - 1) * btBar;
            joinOf.set(b, humanizeHeadTicks(base().tempoMap, bs) + Math.ceil(secondsToTicks(0.035, base().tempoMap)));
          }
          const inSanctioned = (n: Note) => {
            const end = n.startTick + n.durationTicks;
            if (leadBars.has(Math.floor(n.startTick / btBar) + 1) || leadBars.has(Math.floor((end - 1) / btBar) + 1)) return true;
            const endBar = Math.floor(end / btBar) + 1;
            const join = joinOf.get(endBar);
            if (join !== undefined && end - (endBar - 1) * btBar <= join) return true;
            return false;
          };
          const sig = (n: Note) => `${n.pitch}:${n.startTick}:${n.durationTicks}:${n.velocity}:${n.articulation ?? ''}:${n.layer ?? ''}`;
          for (const t of result.tracks) {
            if ((WIND_ROLES as string[]).includes(t.role)) continue;
            if (PERC_ROLES.includes(t.role)) continue; // Phase 10 owns these now (see above)
            if (t.role === 'harp' || t.role === 'piano') continue; // Phase 11 owns these now (see above)
            const g = golden.tracks.find((x: { id: string }) => x.id === t.id);
            expect(g, `${short} ${fixTag} t${take} missing golden track ${t.role}`).toBeDefined();
            const cur = t.notes.filter((n) => !inSanctioned(n)).map(sig).sort();
            const base = (g.notes as Note[]).filter((n: Note) => !inSanctioned(n)).map(sig).sort();
            expect(cur, `${short} ${fixTag} t${take} non-wind track ${t.role} diverged outside sanctioned bars`).toEqual(base);
          }
        }
      }
    }
  }, 300000);
});

/* ---------------- 12. locks and band -------------------------------------- */

describe('Phase 9: locks and band', () => {
  it('locked and out-of-band wind tracks are never written', () => {
    const base = THREE();
    base.ensemble = { templateId: 'ensemble.symphony', overrides: { oboes: 'out' }, pins: {} };
    const flutes = trackOf(base, 'flutes');
    flutes.locked = true;
    flutes.notes = [{ pitch: 84, startTick: 0, durationTicks: 100, velocity: 40 }];
    const oboes = trackOf(base, 'oboes');
    oboes.notes = [{ pitch: 72, startTick: 0, durationTicks: 100, velocity: 40 }];
    base.orchestration = { take: 3 };
    const result = composeAllTracks(base, { seed: 11 });
    const project = { ...base, tracks: result.tracks, orchestration: result.orchestration } as Project;
    expect(trackOf(project, 'flutes').notes).toEqual([{ pitch: 84, startTick: 0, durationTicks: 100, velocity: 40 }]);
    expect(trackOf(project, 'oboes').notes).toEqual([{ pitch: 72, startTick: 0, durationTicks: 100, velocity: 40 }]);
  });
});

/* ---------------- 13. hygiene --------------------------------------------- */

describe('Phase 9: hygiene', () => {
  it('sanitizeNotes is a no-op on wind output; the preview plans every wind note; determinism holds; hard findings are 0', () => {
    const { project, result } = composeTake(THREE(), 'ensemble.cinematic', 3);
    const end = projectEndTick(project);
    for (const role of WIND_ROLES) {
      const t = trackOf(project, role);
      expect(sanitizeNotes(t.notes, t.lowestNote, t.highestNote, end), `sanitize no-op ${role}`).toEqual(t.notes);
    }
    const again = composeTake(THREE(), 'ensemble.cinematic', 3);
    expect(stableTracks(result)).toBe(stableTracks(again.result));
    const findings = checkTemplateRules(project, resolveTemplate(project.ensemble)!, result.plan);
    expect(findings.filter((f) => f.severity === 'hard')).toEqual([]);
    expect(validateProject(JSON.parse(JSON.stringify(project))).ok).toBe(true);
  });

  it('the UVI profile and the no-profile export both pass the winds through untouched', () => {
    const { project } = composeTake(THREE(), 'ensemble.symphony', 1);
    const before = JSON.stringify(project);
    expect(validateExportProfile(PROFILE)).toEqual([]);
    for (const role of WIND_ROLES) {
      const t = trackOf(project, role);
      const chunks = chunksForTrack(project, t, PROFILE);
      expect(chunks.length, `${role} chunk count`).toBe(1); // one passthrough chunk: no wind part in the profile
      expect(chunks[0].notes).toEqual(t.notes);
      expect(chunks[0].channel).toBe(t.midiChannel);
    }
    expect(JSON.stringify(project)).toBe(before);
    expect(validateProject(JSON.parse(JSON.stringify(project))).ok).toBe(true);
  });
});

/* ---------------- 15. the chorus-aware gating ----------------------------- */

describe('Phase 9: the chorus-aware gate', () => {
  it('in chorus-type sections the upper winds sound for most of the bars; the bassoon sounds wherever the cellos play', () => {
    for (const run of windSurvey.filter((r) => r.fixture === 'three')) {
      let chorusBars = 0, withUpper = 0, celloBars = 0, bassoonBars = 0;
      const hasBassoon = rosterOf(run.templateId).includes('bassoons');
      const btBar = btBarOf(run.project);
      const momentBars = new Set<number>();
      for (const m of run.result.plan.moments) for (let b = m.startBar; b <= m.endBar; b++) momentBars.add(b);
      for (let bar = 1; bar <= barsOf(run); bar++) {
        if (secTypeOf(run, bar) !== 'chorus') continue;
        if (momentBars.has(bar)) continue; // a moment's own contract governs its bars
        chorusBars++;
        if (windNotesSoundingAt(run.project, bar, ['flutes', 'oboes', 'clarinets'])) withUpper++;
        const celloHere = run.project.tracks.find((t) => t.role === 'cellosBasses')?.notes.some((n) => n.layer !== 'cb' && n.startTick < bar * btBar && n.startTick + n.durationTicks > (bar - 1) * btBar) ?? false;
        if (celloHere) {
          celloBars++;
          if (!hasBassoon || windNotesSoundingAt(run.project, bar, ['bassoons'])) bassoonBars++;
        }
      }
      expect(withUpper / chorusBars, `${run.templateId} t${run.take} upper-wind chorus presence ${(withUpper / chorusBars).toFixed(2)}`).toBeGreaterThan(0.7);
      if (hasBassoon) expect(bassoonBars / celloBars, `${run.templateId} t${run.take} bassoon chorus presence`).toBeGreaterThan(0.85);
    }
  });

  it('the chorus mean energy never drops below the baseline (per template, takes 1–10 aggregated, three-chorus)', () => {
    // Phase 10 re-scope: the LIVE reference moved to the phase 10 battery.
    // The winds' own guarantee — adding the winds did not thin the chorus —
    // is pinned capture-vs-capture: golden90 (post-8.3, pre-winds) vs
    // golden96 (post-9, pre-percussion). The percussion phase legitimately
    // re-owned the kit's sound (the generator's every-beat timpani and
    // every-bar crash are gone by design), so a live compose can no longer
    // serve as the winds' "after" side.
    for (const templateId of WIND_TEMPLATES) {
      const short = templateId.replace('ensemble.', '');
      const template = resolveTemplate({ templateId, overrides: {}, pins: {} })!;
      const chorusMeanOfDir = (dir: string): number => {
        const base = THREE();
        base.ensemble = { templateId, overrides: {}, pins: {} };
        let mean = 0, n = 0;
        for (let take = 1; take <= 10; take++) {
          const g = JSON.parse(readFileSync(new URL(`./${dir}/${short}-three-t${take}.json`, import.meta.url), 'utf8'));
          const proj: Project = { ...base, tracks: base.tracks.map((x) => ({ ...x, notes: (g.tracks.find((y: { id: string }) => y.id === x.id)?.notes ?? []) })) };
          const report = measureEnergy(proj, template);
          for (const w of report.windows) {
            if (secTypeAt(w.bar) !== 'chorus') continue;
            mean += w.energy; n++;
          }
        }
        return mean / Math.max(1, n);
      };
      const before = chorusMeanOfDir('golden90');
      const after = chorusMeanOfDir('golden96');
      expect(after, `${short}: the winds' chorus mean ${after.toFixed(3)} < pre-winds ${before.toFixed(3)}`)
        .toBeGreaterThanOrEqual(before);
      console.log(`PHASE9 chorus mean ${short} (captures): pre-winds ${before.toFixed(3)} -> with winds ${after.toFixed(3)}`);
    }
  });
});

/* ---------------- 16. the wind moment joins -------------------------------- */

describe('Phase 9: the wind moment joins', () => {
  it('the tutti hit reaches the winds; the unison join raises flutes/oboes an octave and drops the bassoon with the cellos (D2)', () => {
    let tuttiChecked = 0, unisonChecked = 0;
    for (const run of windSurvey) {
      const btBar = btBarOf(run.project);
      for (const m of run.result.plan.moments.filter((x) => x.kind === 'tutti')) {
        const downbeat = (m.startBar - 1) * btBar;
        for (const role of WIND_ROLES) {
          if (!rosterOf(run.templateId).includes(role)) continue;
          const planned = run.result.plan.winds.bars[m.startBar - 1]?.voices[role] === 'tutti';
          if (!planned) continue;
          const hit = trackOf(run.project, role).notes.find((n) => n.startTick === downbeat && n.articulation === 'marcato');
          expect(hit, `${run.templateId} t${run.take} ${role} misses the tutti hit`).toBeDefined();
          tuttiChecked++;
        }
      }
      for (const m of run.result.plan.moments.filter((x) => x.kind === 'unison')) {
        const bar = m.startBar;
        // a dud moment: the carrier's own line has no notes in the bar (the
        // near-silence breath or a handoff moved the tune) — the strings'
        // unison is equally empty there and the winds mirror it
        const carrierNotes = run.project.tracks.find((t) => t.id === m.carrierTrackId)?.notes ?? [];
        const carrierSounds = carrierNotes.some((n) => n.startTick < bar * btBar && n.startTick + n.durationTicks > (bar - 1) * btBar);
        if (!carrierSounds) continue;
        for (const role of ['flutes', 'oboes', 'bassoons'] as const) {
          if (!rosterOf(run.templateId).includes(role)) continue;
          const planned = run.result.plan.winds.bars[bar - 1]?.voices[role] === 'unison';
          if (!planned) continue;
          const join = trackOf(run.project, role).notes.filter((n) => n.startTick >= (bar - 1) * btBar && n.startTick < bar * btBar);
          expect(join.length, `${run.templateId} t${run.take} ${role} unison join empty`).toBeGreaterThan(0);
          for (const n of join) {
            expect(n.pitch).toBeGreaterThanOrEqual(WIND_PROFILES[role].sweet[0]);
            expect(n.pitch).toBeLessThanOrEqual(WIND_PROFILES[role].sweet[1]);
          }
          unisonChecked++;
        }
        // the clarinets rest on unison bars
        if (rosterOf(run.templateId).includes('clarinets')) {
          const planned = run.result.plan.winds.bars[bar - 1]?.voices.clarinets;
          expect(planned, 'the clarinets rest on unison bars').toBeUndefined();
        }
      }
    }
    expect(tuttiChecked).toBeGreaterThan(0);
    expect(unisonChecked).toBeGreaterThan(0);
  });

  it('a wind soli, when drawn, plays the carrier line alone on the wind tracks', () => {
    let checked = 0;
    for (const run of windSurvey) {
      for (const m of run.result.plan.moments.filter((x) => x.kind === 'soli' && x.flavor === 'lead')) {
        const carrierRole = (WIND_ROLES as string[]).includes(run.project.tracks.find((t) => t.id === m.carrierTrackId)?.role ?? '')
          ? (run.project.tracks.find((t) => t.id === m.carrierTrackId)?.role as WindPart)
          : null;
        if (!carrierRole) continue; // a string/horn carrier: not a wind soli
        const bar = m.startBar;
        const t = trackOf(run.project, carrierRole);
        const notes = t.notes.filter((n) => n.startTick >= (bar - 1) * btBarOf(run.project) && n.startTick < bar * btBarOf(run.project));
        expect(notes.length, `${run.templateId} t${run.take} wind soli carrier ${carrierRole} silent`).toBeGreaterThan(0);
        for (const part of WIND_ROLES) {
          if (part === carrierRole) continue;
          if (!rosterOf(run.templateId).includes(part)) continue;
          const planned = run.result.plan.winds.bars[bar - 1]?.voices[part];
          expect(planned, `${run.templateId} t${run.take} ${part} not silent under the wind soli`).toBeUndefined();
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
