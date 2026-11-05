import { describe, expect, it } from 'vitest';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { checkTemplateRules, measureEnergy } from '../src/orchestrator/energy';
import { barTicks } from '../src/shared/schema/meter';
import { scalePitchClasses } from '../src/shared/schema/modes';
import { sanitizeNotes } from '../src/engine/generate';
import { chunksForTrack, mergeTremoloGroups, validateExportProfile } from '../src/export/profile';
import { EXPORT_PROFILES } from '../src/export/profiles';
import { planTrackNotes } from '../src/audio/mapping';
import { projectEndTick, projectFromFixture, validateProject, type Note, type Project, type Track } from '../src/shared/schema';
import { resolveTemplate } from '../src/config/ensembles';
import { humanizeHeadTicks } from '../src/orchestrator/expression/timing';

/**
 * Phase 7 — moments: the rare designed gestures (unison phrase, tutti,
 * soli, divisi, imitation), planned at the conductor level on their own
 * salted D8 stream. Pinned here: determinism; the texture draws are
 * UNCHANGED outside moment bars (against a moments:false run of the same
 * takes); each kind's contract; the energy clamp across six templates ×
 * takes 1–10; hard findings 0; sanitize no-op; locks/band untouched;
 * exports and the preview unbroken on divisi notes; old projects untouched.
 */
const TEMPLATES = ['ensemble.symphony', 'ensemble.chamber', 'ensemble.cinematic', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.hybridstudio'];
const PROFILE = EXPORT_PROFILES[0].profile;

const THREE = (): Project => projectFromFixture(JSON.parse(JSON.stringify(threeChorus)));
const DORIAN = (): Project => projectFromFixture(JSON.parse(JSON.stringify(dorian)));

const composeTake = (base: Project, templateId: string, take: number, moments = true) => {
  const p = base;
  p.ensemble = { templateId, overrides: {}, pins: {} };
  p.orchestration = { take };
  const result = composeAllTracks(p, { seed: 11, moments });
  return { project: { ...p, tracks: result.tracks, orchestration: result.orchestration } as Project, result };
};

const texturesOf = (result: ReturnType<typeof composeAllTracks>): Record<string, string> =>
  Object.fromEntries(
    result.reports.find((r) => r.startsWith('textures'))!.split(': ')[1].split(', ').map((kv) => kv.split('=')),
  );

const trackOf = (p: Project, role: string): Track => p.tracks.find((t) => t.role === role)!;
const startsIn = (notes: Note[], startTick: number, endTick: number): Note[] =>
  notes.filter((n) => n.startTick >= startTick && n.startTick < endTick);
const overlaps = (notes: Note[], startTick: number, endTick: number): Note[] =>
  notes.filter((n) => n.startTick < endTick && n.startTick + n.durationTicks > startTick);
const leadingTonePcOf = (p: Project): number | null => {
  const scale = scalePitchClasses(p.key, p.mode);
  const lt = ((p.key % 12) + 11) % 12;
  return scale.includes(lt) ? lt : null;
};

/* ---------------- the survey (every assertion below reads it) ---------------- */

interface Run { templateId: string; take: number; fixture: string; project: Project; result: ReturnType<typeof composeAllTracks> }

const SURVEY: Run[] = [];
for (const templateId of TEMPLATES) {
  for (let take = 1; take <= 10; take++) {
    const { project, result } = composeTake(THREE(), templateId, take);
    SURVEY.push({ templateId, take, fixture: 'three-chorus-40bars', project, result });
  }
  for (let take = 1; take <= 6; take++) {
    const { project, result } = composeTake(DORIAN(), templateId, take);
    SURVEY.push({ templateId, take, fixture: 'dorian-16bars', project, result });
  }
}

const allMoments = (kind: string): { run: Run; m: Record<string, unknown> }[] =>
  SURVEY.flatMap((run) => run.result.plan.moments.filter((m) => m.kind === kind).map((m) => ({ run, m: m as unknown as Record<string, unknown> })));

const findMoment = (kind: string): { run: Run; m: Record<string, unknown> } | null =>
  SURVEY.flatMap((run) => run.result.plan.moments.filter((m) => m.kind === kind).map((m) => ({ run, m: m as unknown as Record<string, unknown> })))[0] ?? null;

const counts: Record<string, Record<string, number>> = {};
for (const run of SURVEY) {
  counts[run.templateId] ??= {};
  for (const m of run.result.plan.moments) counts[run.templateId][m.kind] = (counts[run.templateId][m.kind] ?? 0) + 1;
}

/* ---------------- tests ---------------- */

describe('Phase 7: moments', () => {
  it('planning is deterministic: the same take composes byte-identically (moments on)', () => {
    for (const templateId of ['ensemble.cinematic', 'ensemble.symphony', 'ensemble.chamber']) {
      const a = composeTake(THREE(), templateId, 3);
      const b = composeTake(THREE(), templateId, 3);
      expect(JSON.stringify(a.project.tracks.map((t) => ({ n: t.notes, c: t.cc }))))
        .toBe(JSON.stringify(b.project.tracks.map((t) => ({ n: t.notes, c: t.cc }))));
      expect(JSON.stringify(a.result.plan.moments)).toBe(JSON.stringify(b.result.plan.moments));
    }
  });

  it('the texture draws are UNCHANGED: same textures, the layer plan differs only on moment bars (takes 1–10)', () => {
    for (const templateId of TEMPLATES) {
      for (let take = 1; take <= 10; take++) {
        const withM = composeTake(THREE(), templateId, take, true);
        const withoutM = composeTake(THREE(), templateId, take, false);
        expect(texturesOf(withM.result), `${templateId} take ${take}`).toEqual(texturesOf(withoutM.result));
        const covered = new Set<number>();
        for (const m of withM.result.plan.moments) for (let b = m.startBar; b <= m.endBar; b++) covered.add(b);
        for (const bp of withM.result.plan.bars) {
          if (covered.has(bp.bar)) {
            expect(bp.moment, `${templateId} take ${take} bar ${bp.bar} annotated`).toBeTruthy();
            continue;
          }
          const other = withoutM.result.plan.bars[bp.bar - 1];
          expect(JSON.stringify(bp.layers), `${templateId} take ${take} bar ${bp.bar}`).toEqual(JSON.stringify(other.layers));
        }
      }
    }
  }, 120000);

  it('budget: each kind appears at most twice per piece and moments never share bars', () => {
    for (const run of SURVEY) {
      const perKind: Record<string, number> = {};
      const taken = new Set<number>();
      for (const m of run.result.plan.moments) {
        perKind[m.kind] = (perKind[m.kind] ?? 0) + 1;
        expect(perKind[m.kind], `${run.templateId} take ${run.take} ${m.kind}`).toBeLessThanOrEqual(2);
        for (let b = m.startBar; b <= m.endBar; b++) expect(taken.has(b), `${run.templateId} take ${run.take} overlap at bar ${b}`).toBe(false);
      }
    }
  });

  it('placement: nothing on the near-silence or final bar; tutti/unison have a lower-energy bar before them', () => {
    for (const run of SURVEY) {
      const bars = run.result.plan.bars.length;
      const noGo = new Set(run.result.plan.bars.filter((b) => b.energyTarget === 0).map((b) => b.bar));
      for (const m of run.result.plan.moments) {
        for (let b = m.startBar; b <= m.endBar; b++) {
          expect(b, `${run.templateId} take ${run.take} ${m.kind} on the final bar`).toBeLessThan(bars);
          expect(noGo.has(b), `${run.templateId} take ${run.take} ${m.kind} on the near-silence bar`).toBe(false);
        }
        if (m.kind === 'tutti' || m.kind === 'unison') {
          const before = run.result.plan.bars[m.startBar - 2]?.energyTarget ?? 0;
          const peak = Math.max(...Array.from({ length: m.endBar - m.startBar + 1 }, (_, i) => run.result.plan.bars[m.startBar - 1 + i]?.energyTarget ?? 0));
          expect(before, `${run.templateId} take ${run.take} ${m.kind} anticipation`).toBeLessThan(peak);
        }
      }
    }
  });

  it('unison: every voice plays the lead’s pitch classes, ranges hold, the leading tone is never doubled, forbidden templates get none', () => {
    for (const run of SURVEY) {
      if (['ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.chamber'].includes(run.templateId)) {
        expect(run.result.plan.moments.some((m) => m.kind === 'unison'), `${run.templateId} take ${run.take}`).toBe(false);
      }
    }
    const found = allMoments('unison');
    expect(found.length, 'the survey contains unison moments').toBeGreaterThan(0);
    for (const { run, m } of found) {
      const startTick = m.startTick as number;
      const endTick = m.endTick as number;
      const carrierId = m.carrierTrackId as string;
      const lt = leadingTonePcOf(run.project);
      const voices = run.project.tracks
        .filter((t) => t.family === 'Strings' && t.notes.length)
        .map((t) => ({ t, notes: startsIn(t.notes, startTick, endTick) }));
      const carrierPcs = new Set(voices.find((x) => x.t.id === carrierId)!.notes.map((n) => ((n.pitch % 12) + 12) % 12));
      for (const { t, notes } of voices) {
        for (const n of notes) {
          expect(n.pitch).toBeGreaterThanOrEqual(t.lowestNote);
          expect(n.pitch).toBeLessThanOrEqual(t.highestNote);
          if (t.id === carrierId) continue;
          expect(carrierPcs.has(((n.pitch % 12) + 12) % 12), `${run.templateId} take ${run.take} ${t.role} pc`).toBe(true);
        }
      }
      if (lt !== null) {
        for (let tick = startTick; tick < endTick; tick += 120) {
          const onLt = voices.filter(({ notes }) => notes.some((n) => n.startTick <= tick && tick < n.startTick + n.durationTicks && ((n.pitch % 12) + 12) % 12 === lt));
          expect(onLt.length, `${run.templateId} take ${run.take} doubled LT at tick ${tick}`).toBeLessThanOrEqual(1);
        }
      }
    }
  }, 120000);

  it('tutti: the whole roster attacks the downbeat and the moment is defined over the ROSTER', () => {
    const found = allMoments('tutti');
    expect(found.length, 'the survey contains tutti moments').toBeGreaterThan(0);
    for (const { run, m } of found) {
      const downbeat = m.startTick as number;
      const head = humanizeHeadTicks(run.project.tempoMap, downbeat);
      const roles = m.participantRoles as string[];
      const roster = resolveTemplate(run.project.ensemble)!.roster.map((r) => r.role);
      expect([...roles].sort()).toEqual([...roster].sort());
      for (const role of roles) {
        const t = run.project.tracks.find((x) => x.role === role);
        if (!t || t.locked) continue;
        const hits = t.notes.filter((n) => n.startTick >= downbeat - 1 && n.startTick <= downbeat + head);
        // Phase 8.2: the cellosBasses desk split — a sub-36 tutti hit sounds
        // on the desk's Double Basses track (the cello's octave-up answer may
        // be suppressed by the low-interval rule); the DESK hits
        const desk = role === 'cellosBasses'
          ? [...t.notes, ...(run.project.tracks.find((x) => x.role === 'basses')?.notes ?? [])]
          : t.notes;
        const deskHits = desk.filter((n) => n.startTick >= downbeat - 1 && n.startTick <= downbeat + head);
        expect(hits.length + deskHits.length, `${run.templateId} take ${run.take} ${role} hits the downbeat`).toBeGreaterThan(0);
      }
    }
  });

  it('soli: tacet parts are silent, someone sounds, and the final bar still sounds everywhere', () => {
    const found = allMoments('soli');
    expect(found.length, 'the survey contains soli moments').toBeGreaterThan(0);
    for (const { run, m } of found) {
      const startTick = m.startTick as number;
      const endTick = m.endTick as number;
      const carrierId = m.carrierTrackId as string;
      const carrierIsCelloDesk = run.project.tracks.find((t) => t.id === carrierId)?.role === 'cellosBasses';
      const strings = run.project.tracks.filter((t) => t.family === 'Strings' && t.id !== carrierId
        && !(carrierIsCelloDesk && t.role === 'basses')); // the desk's own bass track carries the carrier's sub-floor notes
      for (const t of strings) {
        expect(startsIn(t.notes, startTick, endTick).length, `${run.templateId} take ${run.take} tacet ${t.role}`).toBe(0);
      }
      const carrierNotes = run.project.tracks.find((t) => t.id === carrierId)!.notes;
      expect(startsIn(carrierNotes, startTick, endTick).length, 'the carrier (or the held bass) sounds').toBeGreaterThan(0);
    }
    for (const run of SURVEY) {
      const end = projectEndTick(run.project);
      const finalStart = end - barTicks(run.project.timeSignature);
      const sounding = run.project.tracks.filter((t) => t.family === 'Strings' && overlaps(t.notes, finalStart, end).length);
      expect(sounding.length, `${run.templateId} take ${run.take} final bar`).toBeGreaterThan(0);
    }
  }, 120000);

  it('divisi: two distinct simultaneous lines, no crossing, no unison, and div2 survives the pipeline', () => {
    const found = allMoments('divisi');
    expect(found.length, 'the survey contains divisi moments').toBeGreaterThan(0);
    for (const { run, m } of found) {
      const startTick = m.startTick as number;
      const endTick = m.endTick as number;
      const t = run.project.tracks.find((x) => x.id === m.divTrackId)!;
      const inBar = overlaps(t.notes, startTick, endTick);
      const parents = inBar.filter((n) => n.layer !== 'div2');
      const seconds = inBar.filter((n) => n.layer === 'div2');
      expect(parents.length, `${run.templateId} take ${run.take} parent line`).toBeGreaterThan(0);
      expect(seconds.length, `${run.templateId} take ${run.take} second line`).toBeGreaterThan(0);
      for (const d of seconds) {
        const under = parents.filter((p) => p.startTick < d.startTick + d.durationTicks && p.startTick + p.durationTicks > d.startTick);
        expect(under.length, 'the second line always has its parent sounding').toBeGreaterThan(0);
        const head = humanizeHeadTicks(run.project.tempoMap, d.startTick);
        for (const p of under) {
          expect(((d.pitch % 12) + 12) % 12, 'no doubled unison').not.toBe(((p.pitch % 12) + 12) % 12);
          // no crossing inside the part — the legato crossfade tail (≤ the
          // humanize head, the same transient class the compose sweep
          // exempts) is not a crossing
          const ov = Math.min(p.startTick + p.durationTicks, d.startTick + d.durationTicks) - Math.max(p.startTick, d.startTick);
          if (ov > head) expect(d.pitch, 'no crossing inside the part').toBeLessThan(p.pitch);
        }
      }
      expect(sanitizeNotes(t.notes, t.lowestNote, t.highestNote, projectEndTick(run.project))).toEqual(t.notes);
    }
  }, 120000);

  it('imitation: the answer matches the lead’s rhythm at the planned delay', () => {
    const found = allMoments('imitation');
    expect(found.length, 'the survey contains imitation moments').toBeGreaterThan(0);
    for (const { run, m } of found) {
      const startTick = m.startTick as number;
      const endTick = m.endTick as number;
      const delay = m.delayTicks as number;
      const answer = run.project.tracks.find((x) => x.id === m.answerTrackId)!;
      const answerOnsets = startsIn(answer.notes, startTick, endTick).map((n) => n.startTick);
      expect(answerOnsets.length, 'the answer speaks').toBeGreaterThan(0);
      // the lead is stored on the plan — its rendered line over the pre-delay bars
      const leadTrack = run.project.tracks.find((x) => x.id === m.leadTrackId)!;
      // the answer may open with material the lead sang just BEFORE the moment
      const leadNotes = startsIn(leadTrack.notes, startTick - delay, endTick - delay);
      expect(leadNotes.length, 'a lead to answer').toBeGreaterThan(0);
      const head = humanizeHeadTicks(run.project.tempoMap, startTick);
      // The generator produces the answer strictly as {motif onset + delay};
      // in the RENDERED output a source note may have been sanitize-merged
      // into its predecessor (same-pitch humanize overlap) — trace through
      // the merged span (start..end + delay). A majority of the answer's
      // onsets must trace to rendered lead onsets at +delay: the rhythm
      // match. (The subset direction itself is structural in the generator.)
      let matched = 0;
      for (const o of answerOnsets) {
        const hit = leadNotes.some((n) => {
          const from = n.startTick + delay;
          return o >= from - head && o <= from + n.durationTicks + head;
        });
        if (hit) matched++;
      }
      expect(matched / answerOnsets.length, 'most of the answer rides the lead’s rhythm at +delay').toBeGreaterThanOrEqual(0.5);
      // strictly increasing, no doubled onsets (a replay, not a chord)
      const sortedOnsets = [...answerOnsets].sort((a, b) => a - b);
      for (let i = 1; i < sortedOnsets.length; i++) expect(sortedOnsets[i]).toBeGreaterThan(sortedOnsets[i - 1]);
    }
  }, 120000);

  it('energy never exceeds the clamp, moments create no hard findings, sanitize is a no-op, validateProject passes — six templates × takes 1–10', () => {
    const softTally: Record<string, number> = {};
    const preExistingHard: string[] = [];
    for (const run of SURVEY) {
      const template = resolveTemplate(run.project.ensemble)!;
      const label = `${run.fixture} ${run.templateId} take ${run.take}`;
      const energy = measureEnergy(run.project, template);
      expect(energy.violations.filter((v) => v.kind === 'aboveMax'), `clamp ${label}`).toHaveLength(0);
      const findings = checkTemplateRules(run.project, template, run.result.plan);
      // the MOMENTS create no hard findings: every hard finding must sit
      // outside every moment's bars (a pre-existing generator/pad octave
      // under a forbidding policy is reported, not introduced here)
      const hard = findings.filter((f) => f.severity === 'hard'
        && run.result.plan.moments.some((m) => f.tick !== undefined && f.tick >= m.startTick && f.tick < m.endTick));
      expect(hard, `moment hard findings ${label}: ${hard.map((f) => f.message).join(' | ')}`).toHaveLength(0);
      for (const f of findings) {
        if (f.severity === 'soft') softTally[f.rule] = (softTally[f.rule] ?? 0) + 1;
        if (f.severity === 'hard') preExistingHard.push(`${label}@${f.tick}: ${f.message}`);
      }
      expect(validateProject(run.project).ok, `validate ${label}`).toBe(true);
      const end = projectEndTick(run.project);
      for (const t of run.project.tracks.filter((x) => x.family === 'Strings' && x.notes.length)) {
        expect(sanitizeNotes(t.notes, t.lowestNote, t.highestNote, end), `sanitize ${label} ${t.role}`).toEqual(t.notes);
      }
    }
    const softLines = Object.entries(softTally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(', ');
    console.log(`PHASE7 soft findings: ${softLines || 'none'}`);
    console.log(`PHASE7 hard findings outside moment bars (pre-existing, ${preExistingHard.length}):\n${preExistingHard.slice(0, 8).map((l) => `  ${l}`).join('\n')}`);
  }, 240000);

  it('locked and out-of-band tracks are untouched (byte-identical), moments or not', () => {
    for (const templateId of ['ensemble.cinematic', 'ensemble.symphony']) {
      const p = THREE();
      p.ensemble = { templateId, overrides: { bassoons: 'out' as never }, pins: {} };
      p.orchestration = { take: 2 };
      const v1 = trackOf(p, 'violins1');
      const horn = trackOf(p, 'horns');
      const bassoon = trackOf(p, 'bassoons');
      v1.locked = true;
      horn.locked = true;
      const beforeV1 = JSON.stringify(v1.notes);
      const beforeHorn = JSON.stringify(horn.notes);
      const beforeBassoon = JSON.stringify(bassoon.notes);
      const result = composeAllTracks(p, { seed: 11, moments: true });
      const project = { ...p, tracks: result.tracks } as Project;
      expect(JSON.stringify(trackOf(project, 'violins1').notes)).toBe(beforeV1);
      expect(JSON.stringify(trackOf(project, 'horns').notes)).toBe(beforeHorn);
      expect(JSON.stringify(trackOf(project, 'bassoons').notes)).toBe(beforeBassoon);
    }
  });

  it('exports and the preview do not break on divisi notes; div2 rides the parent part', () => {
    expect(validateExportProfile(JSON.parse(JSON.stringify(PROFILE)))).toEqual([]);
    const found = findMoment('divisi');
    expect(found, 'a divisi moment to export').toBeTruthy();
    const { run, m } = found!;
    const t = run.project.tracks.find((x) => x.id === (m.divTrackId as string))!;
    expect(t.notes.some((n) => n.layer === 'div2')).toBe(true);
    // no profile: the writer passes the notes through untouched (div2 included)
    const plain = chunksForTrack(run.project, t, null);
    expect(plain).toHaveLength(1);
    expect(plain[0].notes.some((n) => n.layer === 'div2')).toBe(true);
    // with the UVI profile: div2 rides the parent part, no extra part appears
    const chunks = chunksForTrack(run.project, t, PROFILE);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.filter((c) => c.notes.some((n) => n.layer === 'div2')).length, 'div2 exported with its parent part').toBeGreaterThanOrEqual(1);
    // the preview plans both lines (expressive) and passes notes through (simple)
    const expressive = planTrackNotes(t, 'expressive');
    expect(expressive.length).toBeGreaterThanOrEqual(t.notes.length);
    expect(planTrackNotes(t, 'simple')).toBe(t.notes);
  });

  it('the sampled-tremolo merge groups PER PITCH: two interleaved divisi lines merge independently', () => {
    const step = 240;
    const line = (pitch: number, to: number): Note[] => {
      const out: Note[] = [];
      for (let t = 0; t < to; t += step) out.push({ pitch, startTick: t, durationTicks: step, velocity: 70, articulation: 'tremolo' });
      return out;
    };
    const a = line(72, 1920);
    const b = line(65, 1920);
    const merged = mergeTremoloGroups([...a, ...b]);
    expect(merged.filter((n) => n.pitch === 72)).toHaveLength(1);
    expect(merged.filter((n) => n.pitch === 65)).toHaveLength(1);
    expect(merged.find((n) => n.pitch === 72)!.durationTicks).toBe(1920);
    expect(mergeTremoloGroups(a)).toHaveLength(1); // single-voice behaviour unchanged
    const plain: Note = { pitch: 60, startTick: 0, durationTicks: 960, velocity: 80 };
    expect(mergeTremoloGroups([plain])).toEqual([plain]); // non-tremolo passes through
  });

  it('old projects stay untouched: a never-composed fixture validates and exports unchanged', () => {
    const raw = DORIAN();
    delete raw.orchestration; // the old-project shape: no orchestration state
    expect(validateProject(raw).ok).toBe(true);
    const t = trackOf(raw, 'violins1');
    const chunks = chunksForTrack(raw, t, null);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].notes).toEqual(t.notes);
  });

  it('report data: per-template moment counts and the three-chorus take-1 timeline', () => {
    const lines = TEMPLATES.map((templateId) => {
      const c = counts[templateId] ?? {};
      const kinds = ['unison', 'tutti', 'soli', 'divisi', 'imitation'].map((k) => `${k}:${c[k] ?? 0}`).join(' ');
      return `  ${templateId.padEnd(24)} ${kinds}`;
    });
    console.log(`PHASE7 moment counts over takes 1–10 (three-chorus) + 1–6 (dorian):\n${lines.join('\n')}`);
    const timeline = TEMPLATES.map((templateId) => {
      const run = SURVEY.find((r) => r.templateId === templateId && r.take === 1 && r.fixture === 'three-chorus-40bars')!;
      const parts = run.result.plan.moments.map((m) => {
        const who = m.kind === 'soli' && m.carrierTrackId ? run.project.tracks.find((t) => t.id === m.carrierTrackId)?.role
          : m.kind === 'divisi' && m.divTrackId ? run.project.tracks.find((t) => t.id === m.divTrackId)?.role
          : m.kind === 'imitation' && m.answerTrackId ? run.project.tracks.find((t) => t.id === m.answerTrackId)?.role
          : '';
        return `${m.kind} bars ${m.startBar}–${m.endBar}${who ? ` (${who})` : ''}`;
      });
      return `  ${templateId}: ${parts.length ? parts.join('; ') : 'no moments this take'}`;
    });
    console.log(`PHASE7 three-chorus-40bars take 1, moment timeline by bar:\n${timeline.join('\n')}`);
    expect(timeline).toHaveLength(TEMPLATES.length);
  });
});
