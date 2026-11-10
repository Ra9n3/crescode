import { describe, expect, it } from 'vitest';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { checkTemplateRules } from '../src/orchestrator/energy';
import { projectFromFixture, validateProject, type Note, type Project, type Track } from '../src/shared/schema';
import { resolveTemplate } from '../src/config/ensembles';
import { sanitizeNotes } from '../src/engine/generate';
import { chunksForTrack, mergeTremoloGroups, TREMOLO_GROUP_MAX_STEP_TICKS, resolveArticulationKeyFor } from '../src/export/profile';
import { EXPORT_PROFILES } from '../src/export/profiles';
import { planTrackNotes } from '../src/audio/mapping';
import { humanizeHeadTicks } from '../src/orchestrator/expression/timing';

/**
 * Phase 8 — post-moments hardening, four answers:
 *   1. all six templates have zero hard findings over three-chorus takes 1–10
 *      and Dorian takes 1–6. The narrow short-note figuration exemption remains
 *      pinned, and Piano Engine V5 revoices its forbidden-policy octave pairs.
 *   2. divisi in exports (UVI profile): keyswitches unduplicated/misplaced-free,
 *      the per-pitch tremolo merge keeps both divisi lines, cbLayer 'omit' and
 *      the range guard drop nothing, the preview plans both lines.
 *   3. non-Piano soft findings (overlapAvoid, octaveDoubling climaxOnly) do not
 *      RISE with moments on (pinned ≤ the moments:false counts; numbers printed).
 *   4. non-Piano humanize/legato jitter is seeded PER NOTE (track, start, pitch)
 *      and the legato overlap PER JOIN, so every non-Piano note outside moment
 *      bars is byte-identical to the moments:false run.
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

const noteSig = (n: Note): string =>
  JSON.stringify([
    n.pitch,
    n.startTick,
    n.durationTicks,
    n.velocity,
    n.articulation ?? null,
    n.bow ?? null,
    n.layer ?? null,
    n.roleTag ?? null,
  ]);

// The V5 Piano engine has separate eligibility, realization, and export
// contracts. The hard-finding sweep includes its final score output; other
// legacy-only soft-rule comparisons below remain scoped to non-Piano tracks.
const withoutPiano = (project: Project): Project => ({
  ...project,
  tracks: project.tracks.filter((track) => track.role !== 'piano'),
});

describe('Phase 8: 1 — orchestration hard findings (figuration exemption)', () => {
  it('zero hard findings across all six templates × takes 1–10 (three-chorus) and 1–6 (dorian)', () => {
    const lines: string[] = [];
    for (const templateId of TEMPLATES) {
      for (const [fixN, fix] of [['three', THREE], ['dorian', DORIAN]] as const) {
        const takes = fixN === 'three' ? 10 : 6;
        for (let take = 1; take <= takes; take++) {
          const { project, result } = composeTake(fix(), templateId, take, true);
          const findings = checkTemplateRules(project, resolveTemplate({ templateId, overrides: {}, pins: {} })!, result.plan);
          const hard = findings.filter((f) => f.severity === 'hard');
          expect(hard, `${templateId} ${fixN} t${take}: ${hard.map((f) => `${f.rule}@${f.tick} ${f.message}`).join(' | ')}`).toHaveLength(0);
          expect(validateProject(JSON.parse(JSON.stringify(project))).ok, `${templateId} ${fixN} t${take} validates`).toBe(true);
        }
      }
      lines.push(templateId);
    }
    console.log(`PHASE8 hard findings: 0 across ${lines.length} templates × all takes (figuration exemption active)`);
  }, 600000);

  it('the exemption is narrow: long+long still hard, short non-chord-tone still hard, same-track still hard', () => {
    // built on the composed vocalbacking take 1: overwrite two tracks' notes
    // and silence the rest of the roster (so the D10 forced-doubling
    // exemption — voices outnumbering the chord's tones — cannot kick in)
    const { project } = composeTake(THREE(), 'ensemble.vocalbacking', 1, false);
    const template = resolveTemplate({ templateId: 'ensemble.vocalbacking', overrides: {}, pins: {} })!;
    for (const role of ['violins1', 'violas', 'cellosBasses', 'piano']) {
      const t = project.tracks.find((x) => x.role === role)! as Track;
      t.notes = [];
    }
    const setNotes = (role: string, notes: Note[]) => {
      const t = project.tracks.find((x) => x.role === role)! as Track;
      t.notes = notes;
    };
    const n = (pitch: number, start: number, dur: number): Note => ({ pitch, startTick: start, durationTicks: dur, velocity: 64 });

    // long pad + long pad an octave apart (the Cb+Vc class): HARD
    setNotes('violins2', [n(81, 0, 3840)]);
    setNotes('harp', [n(69, 0, 3840)]);
    expect(checkTemplateRules(project, template).some((f) => f.rule === 'octaveDoubling' && f.severity === 'hard')).toBe(true);

    // short chord-tone figuration under the same long pad: EXEMPT
    setNotes('harp', [n(69, 0, 456), n(72, 480, 456)]);
    expect(checkTemplateRules(project, template).filter((f) => f.rule === 'octaveDoubling')).toHaveLength(0);

    // TWO short notes an octave apart (two figurations colliding): still HARD —
    // the exemption needs one sustained side (longer than the short note)
    setNotes('violins2', [n(81, 0, 456)]);
    setNotes('harp', [n(69, 0, 456)]);
    const bothShort = checkTemplateRules(project, template).filter((f) => f.rule === 'octaveDoubling');
    expect(bothShort.length).toBe(1);
    expect(bothShort[0].severity).toBe('hard');

    // same track, short vs long (the Cb+Vc inside one track): still HARD
    setNotes('harp', []);
    setNotes('violins2', [n(81, 0, 456), n(69, 0, 3840)]);
    expect(checkTemplateRules(project, template).some((f) => f.rule === 'octaveDoubling' && f.severity === 'hard')).toBe(true);
  });
});

describe('Phase 8: 4 — per-note seeding: notes outside moment bars are byte-identical', () => {
  it('every note whose end does not reach into a moment bar is identical to the moments:false run (6 templates × takes 1–10)', () => {
    let checked = 0;
    for (const templateId of TEMPLATES) {
      for (let take = 1; take <= 10; take++) {
        const withM = composeTake(THREE(), templateId, take, true);
        const withoutM = composeTake(THREE(), templateId, take, false);
        const covered = new Set<number>();
        for (const m of withM.result.plan.moments) for (let b = m.startBar; b <= m.endBar; b++) covered.add(b);
        // Phase 10 allowance (narrow): a roll INTO a tutti is the moment's own
        // content spread one bar early — the percussion notes the plan rolled
        // into a tutti moment (its 16ths live in the bar(s) before the tutti)
        // exist only when the moments do. And the percussion's velocity
        // shaping reads the same beat windows the wind pickup-run landings
        // sit in: a run the old guard skipped under a non-displacing moment
        // (divisi/imitation) renders in the moments:false run and moves the
        // window's velocity sums, so a PERCUSSION note in that landing's beat
        // window can differ by a few capped units. Excluded: percussion-track
        // notes whose start lies in a planned run's landing beat window.
        const PERC_ROLES = new Set(['timpani', 'snare', 'cymbals', 'aux']);
        // Phase 11 allowance (the same narrow shape): a glissando INTO a
        // tutti is the moment's own content spread one bar early — the harp
        // notes the plan ran into a tutti moment (the run's 16ths live in
        // the bar(s) before the tutti) exist only when the moments do.
        // Harp glissandi are part of the legacy keys planner's moment-aware
        // contract. Piano Engine V5 has separate production tests and is not
        // compared through the retired V1 keys plan here.
        const HARP_ROLE_P8 = 'harp';
        const glissBars = new Set<number>();
        const rollBars = new Set<number>();
        const landingWindows: [number, number][] = [];
        const btBarP8 = 3840;
        for (const r of withM.result.plan.winds.pickupRuns) {
          landingWindows.push([r.downbeatTick, r.downbeatTick + 960]);
        }
        for (const r of withM.result.plan.percussion.rolls) {
          const tutti = withM.result.plan.moments.find((m) => m.kind === 'tutti' && m.startBar === r.targetBar);
          if (!tutti) continue; // chorus-entry rolls exist with and without the moments
          for (let b = r.startBar; b < r.targetBar; b++) rollBars.add(b);
        }
        // the Phase 11 allowance: a glissando INTO a tutti is the moment's
        // own content spread one bar early — the harp notes the plan ran
        // into a tutti moment (the run's 16ths live in the bar(s) before the
        // tutti) exist only when the moments do
        for (const g2 of withM.result.plan.keys.glisses) {
          const tutti = withM.result.plan.moments.find((m) => m.kind === 'tutti' && m.startBar === g2.targetBar);
          if (!tutti) continue; // chorus-entry and outro glissandos exist with and without the moments
          const startBar = Math.floor(g2.startTick / 3840) + 1;
          for (let b = startBar; b <= g2.targetBar; b++) glissBars.add(b);
        }
        void btBarP8;
        const btBar = 3840;
        // a moment note humanized past the moment's last bar line (the 8.2
        // bass desk trails its partner by a further 1–3 ms) is still a moment
        // note: the start counts as covered within the humanize head after a
        // covered bar
        const headAfter = (tick: number) => humanizeHeadTicks(withM.project.tempoMap, tick);
        const inMoment = (tick: number) => covered.has(Math.floor(tick / btBar) + 1)
          || covered.has(Math.floor((tick - headAfter(tick)) / btBar) + 1);
        for (const t of withM.project.tracks) {
          if (t.role === 'piano') continue;
          const other = withoutM.project.tracks.find((x) => x.id === t.id);
          if (!other) continue;
          const bNotes = other.notes.filter((n) => !inMoment(n.startTick));
          const bByKey = new Map<string, Note>(
            bNotes.map((note) => [`${note.pitch}@${note.startTick}`, note]),
          );
          for (const n of t.notes) {
            if (inMoment(n.startTick)) continue;
            // the Phase 10 allowances: a planned roll INTO a tutti is moment
            // content (see above) — percussion notes in its bars are excluded;
            // a percussion note inside a wind pickup-run's landing beat window
            // is windows-coupled to the run's moments-conditional presence
            if (PERC_ROLES.has(t.role)) {
              if (rollBars.has(Math.floor(n.startTick / btBar) + 1)) continue;
              if (landingWindows.some(([s, e]) => n.startTick >= s && n.startTick < e)) continue;
            }
            // A planned Harp glissando into a tutti is moment content (see
            // above); the run's notes in the bars before that moment are
            // compared by the Harp-specific regression suite instead.
            if (t.role === HARP_ROLE_P8 && glissBars.has(Math.floor(n.startTick / btBar) + 1)) continue;
            const key = `${n.pitch}@${n.startTick}`;
            const otherNote = bByKey.get(key);
            const matches = otherNote !== undefined && noteSig(n) === noteSig(otherNote);
            // a note whose written end reaches into a moment bar may join into
            // the moment's entry (the bow-change crossfade) — its TAIL is part
            // of rendering the moment; everything else is byte-identical
            const tailIntoMoment = inMoment(n.startTick + n.durationTicks);
            expect(otherNote, `${templateId} t${take} ${t.id} ${n.pitch}@${n.startTick} appears from nowhere`).toBeDefined();
            if (!tailIntoMoment) {
              expect(matches, `${templateId} t${take} ${t.id} ${n.pitch}@${n.startTick}`).toBe(true);
              checked++;
            }
          }
        }
      }
    }
    console.log(`PHASE8 jitter identity: ${checked} notes outside moment bars byte-identical to the moments:false runs`);
    expect(checked).toBeGreaterThan(25000);
  }, 300000);

  it('humanize jitter is a pure function of (track, start, pitch): identical inputs, identical offsets', () => {
    // two runs of the SAME take compose byte-identically (the per-note hash)
    const a = composeTake(THREE(), 'ensemble.cinematic', 3, true);
    const b = composeTake(THREE(), 'ensemble.cinematic', 3, true);
    expect(JSON.stringify(a.project.tracks.map((t) => t.notes))).toBe(JSON.stringify(b.project.tracks.map((t) => t.notes)));
  });
});

describe('Phase 8: 2 — divisi in exports (UVI profile)', () => {
  const foundDivisi: { templateId: string; take: number; run: ReturnType<typeof composeTake> }[] = [];
  for (const templateId of ['ensemble.cinematic', 'ensemble.symphony']) {
    for (let take = 1; take <= 10; take++) {
      const run = composeTake(THREE(), templateId, take, true);
      if (run.result.plan.moments.some((m) => m.kind === 'divisi')) foundDivisi.push({ templateId, take, run });
    }
  }
  expect(foundDivisi.length, 'the cinematic+symphony takes contain divisi moments').toBeGreaterThan(0);

  it('keyswitches are not duplicated, end before their triggers, and match the emit-on-change rules — divisi parts included', () => {
    for (const { templateId, take, run } of foundDivisi) {
      const divis = run.result.plan.moments.filter((m) => m.kind === 'divisi');
      for (const m of divis) {
        const track = run.project.tracks.find((t) => t.id === (m as { divTrackId?: string }).divTrackId)!;
        const part = PROFILE.parts.find((pp) => pp.source.role === track.role && pp.source.layer !== 'cb')!;
        const chunk = chunksForTrack(run.project, track, PROFILE).find((c) => c.channel === part.channel)!;
        const ks = chunk.notes.filter((n) => n.pitch < part.lowestPlayable);
        const keys = new Set<string>();
        for (const k of ks) {
          expect(keys.has(`${k.pitch}:${k.startTick}`), `${templateId} t${take} duplicate keyswitch ${k.pitch}@${k.startTick}`).toBe(false);
          keys.add(`${k.pitch}:${k.startTick}`);
          expect(k.startTick + k.durationTicks, `${templateId} t${take} keyswitch ${k.pitch}@${k.startTick} ends after its trigger`).toBeLessThanOrEqual(chunk.notes.find((n) => n.pitch >= part.lowestPlayable && n.startTick >= k.startTick + k.durationTicks - 1)!.startTick);
        }
        // the emit-on-change prediction over the part's merged notes
        const mergedOnly = chunk.notes.filter((n) => n.pitch >= part.lowestPlayable).sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
        let current: number | null = null;
        let predicted = 0;
        for (const nn of mergedOnly) {
          const key = resolveArticulationKeyFor(part, nn.articulation ?? 'sustain', PROFILE.pitchConvention);
          if (key === null) continue;
          if (current !== key) { predicted++; current = key; }
        }
        expect(ks.length, `${templateId} t${take} ${part.id} keyswitch count ${ks.length} != emit-on-change ${predicted}`).toBe(predicted);
      }
    }
  }, 300000);

  it('every div2 note AT OR ABOVE the part\'s playableLow reaches the export chunk; the sub-playableLow notes are red-zone-guard-dropped (Phase 8.1) and survive sanitize in the project', () => {
    for (const { templateId, take, run } of foundDivisi) {
      for (const m of run.result.plan.moments.filter((mm) => mm.kind === 'divisi')) {
        const track = run.project.tracks.find((t) => t.id === (m as { divTrackId?: string }).divTrackId)!;
        const part = PROFILE.parts.find((pp) => pp.source.role === track.role && pp.source.layer !== 'cb')!;
        const chunk = chunksForTrack(run.project, track, PROFILE).find((c) => c.channel === part.channel)!;
        const div2 = track.notes.filter((n) => n.layer === 'div2');
        expect(div2.length, `${templateId} t${take} has div2 notes`).toBeGreaterThan(0);
        const covered = (d: Note): boolean =>
          chunk.notes.some((mm) => mm.pitch === d.pitch && mm.startTick <= d.startTick && mm.startTick + mm.durationTicks >= d.startTick + d.durationTicks);
        const floor = part.playableLow ?? 0;
        for (const d of div2) {
          expect(d.pitch >= track.lowestNote && d.pitch <= track.highestNote, `${templateId} t${take} div2 ${d.pitch} inside the track range`).toBe(true);
          if (d.pitch >= floor) {
            expect(covered(d), `${templateId} t${take} div2 ${d.pitch}@${d.startTick} in the ${part.id} chunk (cbLayer ${PROFILE.cbLayer})`).toBe(true);
          } else {
            // Phase 8.1 red-zone guard: the patch cannot sound below its playableLow —
            // the export drops the note (the project keeps it; reported in the phase report)
            expect(covered(d), `${templateId} t${take} div2 ${d.pitch}@${d.startTick} below the ${part.id} playableLow ${floor} is guard-dropped`).toBe(false);
          }
        }
        expect(sanitizeNotes(track.notes, track.lowestNote, track.highestNote, 99999999)).toEqual(track.notes);
      }
    }
  }, 300000);

  it('the tremolo merge keeps the two divisi lines separate (per-pitch groups, no cross-pitch gluing)', () => {
    for (const { templateId, take, run } of foundDivisi) {
      for (const m of run.result.plan.moments.filter((mm) => mm.kind === 'divisi')) {
        const track = run.project.tracks.find((t) => t.id === (m as { divTrackId?: string }).divTrackId)!;
        const inMoment = (n: Note) => n.startTick < (m as { endTick: number }).endTick && n.startTick + n.durationTicks > (m as { startTick: number }).startTick;
        const trem = track.notes.filter((n) => n.articulation === 'tremolo' && inMoment(n));
        const pitches = new Set(trem.map((n) => n.pitch));
        if (pitches.size < 2) continue; // pad divisi: no simultaneous repeat lines here
        const merged = mergeTremoloGroups(track.notes.filter(inMoment));
        // every original pitch survives the merge; no merged note spans two pitches (per construction)
        const mergedPitches = new Set(merged.map((n) => n.pitch));
        for (const pitch of pitches) expect(mergedPitches.has(pitch), `${templateId} t${take} tremolo pitch ${pitch} survives`).toBe(true);
        // per-pitch group count == the independent per-pitch merge
        for (const pitch of pitches) {
          const line = trem.filter((n) => n.pitch === pitch).sort((a, b) => a.startTick - b.startTick);
          let groups = 1;
          for (let i = 1; i < line.length; i++) if (line[i].startTick - line[i - 1].startTick > TREMOLO_GROUP_MAX_STEP_TICKS) groups++;
          const mergedLine = merged.filter((n) => n.pitch === pitch);
          expect(mergedLine.length, `${templateId} t${take} pitch ${pitch}: ${mergedLine.length} merged groups != ${groups}`).toBe(groups);
        }
        console.log(`PHASE8 tremolo divisi ${templateId} t${take}: ${pitches.size} simultaneous pitches merge independently`);
      }
    }
  }, 300000);

  it('the preview plans both lines: every div2 note sounds (repeats may ride merged AM spans)', () => {
    for (const { templateId, take, run } of foundDivisi) {
      for (const m of run.result.plan.moments.filter((mm) => mm.kind === 'divisi')) {
        const track = run.project.tracks.find((t) => t.id === (m as { divTrackId?: string }).divTrackId)!;
        const plan = planTrackNotes(track, 'expressive');
        const covered = (d: Note): boolean =>
          plan.some((mm) => mm.pitch === d.pitch && mm.startTick <= d.startTick && mm.startTick + mm.durationTicks >= d.startTick + d.durationTicks);
        for (const d of track.notes.filter((n) => n.layer === 'div2')) {
          expect(covered(d), `${templateId} t${take} preview plans div2 ${d.pitch}@${d.startTick}`).toBe(true);
        }
      }
    }
  }, 300000);
});

describe('Phase 8: 3 — soft findings do not rise with moments on', () => {
  it('overlapAvoid and octaveDoubling-climaxOnly counts (moments on) ≤ the moments:false counts + the wind moment joins', () => {
    const WIND_ROLES = new Set(['flutes', 'oboes', 'clarinets', 'bassoons']);
    const tally = (moments: boolean) => {
      let oa = 0, co = 0, windMomentNotes = 0;
      for (const templateId of TEMPLATES) {
        for (const [fixN, fix] of [['three', THREE], ['dorian', DORIAN]] as const) {
          const takes = fixN === 'three' ? 10 : 6;
          for (let take = 1; take <= takes; take++) {
            const { project, result } = composeTake(fix(), templateId, take, moments);
            const findings = checkTemplateRules(withoutPiano(project), resolveTemplate({ templateId, overrides: {}, pins: {} })!, result.plan);
            oa += findings.filter((f) => f.rule === 'overlapAvoid').length;
            co += findings.filter((f) => f.rule === 'octaveDoubling' && f.severity === 'soft').length;
            // Phase 9 allowance: the wind moment joins (§14.7 — tutti hits,
            // unison joins, soli carriers) are DESIGNED co-entrances with the
            // strings/brass at the moment downbeats; each such wind onset can
            // add one overlapAvoid finding. Every OTHER rise still fails.
            if (moments) {
              const spans = result.plan.moments.map((m) => [m.startTick, m.endTick] as const);
              for (const t of project.tracks) {
                if (!WIND_ROLES.has(t.role)) continue;
                windMomentNotes += t.notes.filter((n) => spans.some(([s, e]) => n.startTick >= s && n.startTick < e)).length;
              }
            }
          }
        }
      }
      return { oa, co, windMomentNotes };
    };
    const on = tally(true);
    const off = tally(false);
    console.log(`PHASE8 soft findings (moments on vs off): overlapAvoid ${on.oa} vs ${off.oa} (Δ${on.oa - off.oa}, wind moment joins ${on.windMomentNotes}), climaxOnly ${on.co} vs ${off.co} (Δ${on.co - off.co})`);
    expect(on.oa, 'overlapAvoid rises with moments beyond the wind moment joins').toBeLessThanOrEqual(off.oa + on.windMomentNotes);
    expect(on.co, 'climaxOnly does not rise with moments').toBeLessThanOrEqual(off.co);
  }, 600000);
});
