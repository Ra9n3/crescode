/**
 * Brass renderer (Phase 8, spec §13). Realises the planner's per-bar voice
 * kinds AFTER the rules generator, so the velocity math sees every other
 * family's notes: every brass note's velocity is shaped by its bar's arc
 * norm and capped by the governor bound of every beat window it touches
 * (mean ≤ 127·clampMax·N/roles) — the same invariant the strings pads obey,
 * so a brass entrance can never push a window over the hard clamp. A final
 * safety pass (governBrassVelocities) re-checks the windows after the
 * strings' humanize/legato and lowers BRASS ALONE if anything moved.
 *
 * One voice per track (§13.1): every kind writes a single line. Sustained
 * stretches are cut at the part's phrase cap and rest at least one beat (the
 * breath mechanism, §13.2). Pitch choices are deterministic nearest-target
 * readings of the chord tones — no randomness — with a parallel-5th/8ve
 * ranking penalty for the outer-voice pair (§13.7).
 */
import { chordTones } from '../voicing/chordTones';
import { leadingTonePcOf } from '../voicing/voiceLead';
import { scalePitchClasses } from '../../shared/schema/modes';
import { PPQ, isInstrumentTrack, type Note, type Project, type Track } from '../../shared/schema/types';
import { barTicks, beatOffsets, beatTicks, projectBars } from '../../shared/schema/meter';
import { secondsToTicks } from '../spine';
import { maxMeanVelocityFor } from '../energy';
import { sanitizeNotes } from '../../engine/generate';
import { momentForBar } from '../conductor/moments';
import { humanizeHeadTicks } from '../expression/timing';
import { phrasesOf } from '../expression/cc';
import { motifLine } from '../lines/motif';
import type { OrchestratorContext } from '../module';
import { BRASS_PROFILES, type BrassPart, type BrassProfile } from './profile';
import type { BrassPlan, BrassVoiceKind } from './plan';

interface BrassCandidate {
  pitch: number;
  startTick: number;
  durationTicks: number;
  articulation: Note['articulation'];
  /** Moment notes (tutti/unison/soli) ride the whole-roster cap shape. */
  moment?: boolean;
}

const fitOctave = (pitch: number, lo: number, hi: number): number => {
  let p = pitch;
  while (p > hi) p -= 12;
  while (p < lo) p += 12;
  return Math.min(hi, Math.max(lo, p));
};

/** All chord-tone pitches of one span inside [lo, hi]. */
const tonePitches = (parsed: Parameters<typeof chordTones>[0], lo: number, hi: number): number[] => {
  const out: number[] = [];
  for (const t of chordTones(parsed).tones) {
    for (let p = lo + (((t.pc - lo) % 12) + 12) % 12; p <= hi; p += 12) out.push(p);
  }
  return out;
};

const nearest = (cands: number[], target: number): number =>
  cands.reduce((best, c) => (Math.abs(c - target) < Math.abs(best - target) ? c : best));

/** §13.7: parallel 5th/8ve penalty — a candidate creating the same 0/7
 *  outer-voice interval class as the previous chord is ranked last. */
const parallelPenalty = (prevTop: number | null, prevBottom: number | null, cand: number): boolean => {
  if (prevTop === null || prevBottom === null) return false;
  const ivPrev = (((prevTop - prevBottom) % 12) + 12) % 12;
  const ivCand = (((cand - prevBottom) % 12) + 12) % 12;
  return ivPrev === ivCand && (ivCand === 0 || ivCand === 7);
};

export interface BrassRenderInput {
  ctx: OrchestratorContext;
  plan: BrassPlan;
  /** The strings module's notes by track id (the cello line + window math). */
  stringsNotes: Record<string, Note[]>;
  /** The rules generator's + tutti-hit notes by role (window math). */
  ruleNotes: { role: string; notes: Note[] }[];
}

export interface BrassRenderResult {
  notesByTrackId: Record<string, Note[]>;
  reports: string[];
}

export function renderBrass(input: BrassRenderInput): BrassRenderResult {
  const { ctx, plan, stringsNotes, ruleNotes } = input;
  const { project, template } = ctx;
  const notesByTrackId: Record<string, Note[]> = {};
  const reports: string[] = [];
  if (!template || !plan.bars.length || !ctx.spans.length) return { notesByTrackId, reports };

  const btBar = barTicks(project.timeSignature);
  const beat = beatTicks(project.timeSignature);
  const bars = projectBars(project);
  const endTick = bars * btBar;
  const clampMax = template.budget.energyClamp[1];
  const N = template.roster.length;
  const capAll = maxMeanVelocityFor(N, clampMax, N);
  const rosterRoles = new Set(template.roster.map((r) => r.role));
  const scale = scalePitchClasses(project.key, project.mode);
  const ltPc = leadingTonePcOf(project.key, scale);
  const take = project.orchestration?.take ?? 0;

  const planByBar = new Map(plan.bars.map((b) => [b.bar, b]));
  const momentVelocity = (bar: number): number => {
    const E = Math.min(clampMax, Math.max(0, ctx.arc?.[bar - 1]?.target ?? 0));
    return Math.max(1, Math.min(capAll, Math.round(1 + (capAll - 1) * E)));
  };

  // the cello line the low brass double (§13.4): the cellosBasses voice, Cb layer excluded
  const celloTrack = project.tracks.find((t) => t.role === 'cellosBasses' && isInstrumentTrack(t));
  const celloNotes = celloTrack ? (stringsNotes[celloTrack.id] ?? []).filter((n) => n.layer !== 'cb') : [];
  // the FULL low picture (Cb doubles included) for the low-interval guard
  const celloAllNotes = celloTrack ? (stringsNotes[celloTrack.id] ?? []) : [];
  // the tune carriers' lines (pure texture plan) for fanfare/stab windows
  const leads = ctx.lines?.leads ?? [];
  const carrierByBar = ctx.lines?.carrierByBar ?? [];
  const leadNotesAtBar = (bar: number): Note[] => {
    const carrier = carrierByBar[bar - 1];
    if (!carrier) return [];
    const line = leads.find((l) => l.trackId === carrier);
    if (!line) return [];
    const s = (bar - 1) * btBar;
    return line.notes.filter((n) => n.startTick < bar * btBar && n.startTick + n.durationTicks > s);
  };

  const spanAt = (tick: number) =>
    ctx.spans.find((sp) => sp.startTick <= tick && tick < sp.endTick) ?? ctx.spans[0];

  /* ---------------- phase A: candidates per part (no velocities yet) ------ */

  interface PartCandidates {
    part: BrassPart;
    profile: BrassProfile;
    track: Track;
    candidates: BrassCandidate[];
  }
  const parts: PartCandidates[] = [];

  for (const part of ['horns', 'trumpets', 'trombones', 'tuba'] as BrassPart[]) {
    const prof = BRASS_PROFILES[part];
    const track = project.tracks.find((t) => t.role === part && t.family === 'Brass' && isInstrumentTrack(t) && !t.locked);
    if (!track) continue;
    const kindOfBar = (bar: number): BrassVoiceKind | undefined => planByBar.get(bar)?.voices[part];
    if (!plan.bars.some((b) => b.voices[part] !== undefined)) continue;
    const candidates: BrassCandidate[] = [];
    const [sweetLo, sweetHi] = prof.sweet;

    // Per-GROUP state (§13.2/§13.5): the last pitch per kind group — 'sus'
    // (pad/guide/swell), 'dbl' (lowDouble), 'line' (lead/leadDouble/unison/
    // soli), 'rep' (ostinato/fanfare), 'hit' (stab/tutti) — so a moment
    // gesture never moves an ordinary role's voice-leading target.
    // The PHRASE CAP is a PART-level clock (§13.2: the part rests after the
    // cap), advanced by SOUNDING BAR — the ordinary kind ghost-runs through
    // moment bars, so the clock is identical with and without the moments.
    type GroupKey = 'sus' | 'dbl' | 'line' | 'rep' | 'hit';
    interface GroupState { prevPitch: number | null }
    const groups: Record<GroupKey, GroupState> = {
      sus: { prevPitch: null },
      dbl: { prevPitch: null },
      line: { prevPitch: null },
      rep: { prevPitch: null },
      hit: { prevPitch: null },
    };
    const capTicks = Math.max(beat, secondsToTicks(prof.phraseCapSec, project.tempoMap));
    let partRunStart: number | null = null; // the sounding run's first onset
    let partPrevEnd = -Infinity; // the last (real or ghosted) note end
    let partRestUntil = -Infinity; // after a cap cut: the part rests at least one beat
    // §13.7 outer-voice tracking (ordinary kinds only): the top voice vs the low-voice line
    let prevTop: number | null = null;
    let prevBottom: number | null = null;

    let ghosting = false; // ghost mode: advance the state, emit nothing
    // fresh: the gesture starts a new phrase (the brass lead — planned into
    // the cap budget — resets the clock at its first note). exempt: the
    // moment gestures (tutti/unison/soli) neither consult nor advance the
    // part clock — they are rare designed hits, and the clock must stay
    // byte-identical with and without the moments (the draw-identity pin).
    const push = (group: GroupKey, pitch: number, start: number, dur: number, articulation: Note['articulation'], moment = false, mode: 'run' | 'fresh' | 'exempt' = 'run') => {
      // the leading tone is NEVER doubled across families: the brass opens
      // where the leading tone crosses (the hard rule wins over every role)
      if (ltPc !== null && (((pitch % 12) + 12) % 12) === ltPc) return;
      const st = groups[group];
      const s = Math.max(0, Math.round(start));
      const e = Math.min(endTick, Math.round(start + dur));
      if (e - s < 1) return;
      let start2 = s;
      let end2 = e;
      // the cap-free doubling group neither consults nor advances the part
      // clock (it rides the cello line's own phrasing, whose notes are
      // replaced on moment bars — the clock must stay moment-independent)
      if (mode !== 'exempt' && group !== 'dbl') {
        if (mode === 'fresh') { partRunStart = s; partRestUntil = -Infinity; }
        start2 = Math.max(s, partRestUntil);
        if (start2 >= e) return;
        if (start2 - partPrevEnd >= beat || partRunStart === null || mode === 'fresh') partRunStart = start2;
        const limit = partRunStart + capTicks;
        end2 = Math.min(e, limit);
        partPrevEnd = end2;
        if (end2 >= limit) partRestUntil = limit + beat; // cap reached: breathe
      }
      // the doubling never attacks for less than an eighth (§13.2): a cap
      // rest eating a segment's head leaves a stub — drop it, the part rests
      if (group === 'dbl' && end2 - start2 < PPQ / 2) return;
      if (!ghosting) candidates.push({ pitch, startTick: start2, durationTicks: end2 - start2, articulation, ...(moment ? { moment: true } : {}) });
      st.prevPitch = pitch;
    };
    // chord-tone pools with the leading tone removed (the picker never sees it)
    const noLt = (cands: number[]): number[] => (ltPc === null ? cands : cands.filter((p) => (((p % 12) + 12) % 12) !== ltPc));

    const writeKind = (kind: BrassVoiceKind, bar: number, barStart: number, barEnd: number) => {
      if (kind === 'pad' || kind === 'guide' || kind === 'swell') {
        // one sustained chord tone per span piece; the pad takes the tone
        // nearest the previous pitch (first: the sweet middle), the guide
        // takes the next keep-priority tone (third/seventh) with the parallel
        // penalty, the swell holds one tone and is marked 'sustain'
        for (const sp of ctx.spans) {
          const s = Math.max(sp.startTick, barStart);
          const e = Math.min(sp.endTick, barEnd);
          if (e - s < 1) continue;
          const st = groups.sus;
          const target = st.prevPitch ?? (sweetLo + sweetHi) / 2;
          let pick: number;
          if (kind === 'guide') {
            const tones = chordTones(sp.parsed).tones;
            const guidePcs = tones.filter((t) => t.tier !== 'bass' && t.tier !== 'root').map((t) => t.pc);
            const pcs = guidePcs.length ? guidePcs : tones.map((t) => t.pc);
            const guideCands: number[] = [];
            for (const pc of pcs) for (let p = sweetLo + (((pc - sweetLo) % 12) + 12) % 12; p <= sweetHi; p += 12) guideCands.push(p);
            const pool = noLt(guideCands);
            if (!pool.length) continue;
            const sorted = [...pool].sort((a, b) => Math.abs(a - target) - Math.abs(b - target));
            pick = sorted.find((c) => !parallelPenalty(prevTop, prevBottom, c)) ?? sorted[0];
          } else {
            const pool = noLt(tonePitches(sp.parsed, sweetLo, sweetHi));
            if (!pool.length) continue;
            pick = nearest(pool, target);
          }
          push('sus', pick, s, e - s, 'sustain');
          if (part === 'horns' || part === 'trumpets') prevTop = pick;
          else prevBottom = pick;
        }
      } else if (kind === 'lowDouble') {
        // double the cello line at unison or an octave lower, octave-fitted
        // into the sweet spot; both low parts follow the SAME line, so any
        // sub-48 pair stays a unison/octave by construction (§13.4). The line
        // opens where the cello crosses the leading tone. The doubling role
        // rides the CELLO line's own phrasing — no independent cap clock and
        // no outer-voice tracking (its state must stay moment-independent,
        // because the cello notes it reads are replaced on moment bars).
        const head = humanizeHeadTicks(project.tempoMap, barStart);
        // the doubling never moves faster than eighths (§13.2): cello notes
        // closer together than an eighth merge into one held segment
        const dblSegs: { start: number; end: number; pitch: number }[] = [];
        {
          const eighth = PPQ / 2;
          const sorted = [...celloNotes].sort((a, b) => a.startTick - b.startTick);
          for (const n of sorted) {
            const last = dblSegs[dblSegs.length - 1];
            if (last && n.startTick - last.start < eighth) {
              // sub-eighth motion: the doubling holds through it (the first
              // pitch wins, the segment extends)
              last.end = Math.max(last.end, n.startTick + n.durationTicks);
            } else {
              dblSegs.push({ start: n.startTick, end: n.startTick + n.durationTicks, pitch: n.pitch });
            }
          }
        }
        for (const seg of dblSegs) {
          const n = { startTick: seg.start, durationTicks: seg.end - seg.start, pitch: seg.pitch };
          if (n.startTick >= barEnd || n.startTick + n.durationTicks <= barStart) continue;
          const s = Math.max(n.startTick, barStart);
          const e = Math.min(n.startTick + n.durationTicks, barEnd);
          const pitch = fitOctave(n.pitch, sweetLo, sweetHi);
          // §13.4 low-interval rule at write time: against every OTHER low
          // note that will sound in this window (± the humanize head — the
          // strings shift after this render; Cb doubles included), a sub-48
          // pair is a unison/octave or a 5th or wider — otherwise the
          // doubling opens
          const clash = celloAllNotes.some((c) => !(c.startTick === n.startTick && c.pitch === n.pitch)
            && c.startTick - head < e && c.startTick + c.durationTicks + head > s
            && Math.min(pitch, c.pitch) < 48
            && (() => { const d = Math.abs(pitch - c.pitch); return !(d === 0 || d % 12 === 0 || d >= 7); })());
          if (clash) continue;
          push('dbl', pitch, s, e - s, e - s < beat ? 'staccato' : 'sustain');
        }
      } else if (kind === 'fanfare') {
        // the lead's rhythm on chord tones (§13.4)
        for (const n of leadNotesAtBar(bar)) {
          const pool = noLt(tonePitches(spanAt(n.startTick).parsed, sweetLo, sweetHi));
          if (!pool.length) continue;
          const target = groups.rep.prevPitch ?? (sweetLo + sweetHi) / 2;
          const s = Math.max(n.startTick, barStart);
          const e = Math.min(n.startTick + n.durationTicks, barEnd);
          push('rep', nearest(pool, target), s, e - s, 'marcato');
        }
      } else if (kind === 'stab') {
        // marcato on downbeats and phrase ends, inside the lead's gaps (§13.4)
        const secHere = ctx.sections.find((x) => bar >= x.startBar && x.startBar + x.lengthBars > bar);
        const onsets: number[] = [barStart];
        if (secHere) {
          for (const ph of phrasesOf(secHere)) {
            if (bar === ph.to - 1) onsets.push(barStart + beatOffsets(project.timeSignature).slice(-1)[0]);
          }
        }
        const leadHere = leadNotesAtBar(bar);
        for (const onset of onsets) {
          if (leadHere.some((n) => n.startTick <= onset && onset < n.startTick + n.durationTicks)) continue;
          const pool = noLt(tonePitches(spanAt(onset).parsed, sweetLo, sweetHi));
          if (!pool.length) continue;
          const target = groups.hit.prevPitch ?? (sweetLo + sweetHi) / 2;
          push('hit', nearest(pool, target), onset, Math.min(beat, barEnd - onset), 'marcato');
        }
      } else if (kind === 'ostinato') {
        // the trailer's pinned grid: straight sixteenths (§13.4); horns and
        // trumpets only — the planner never assigns trombones/tuba here
        const step = PPQ / 4;
        const pool = noLt(tonePitches(spanAt(barStart).parsed, sweetLo, sweetHi));
        if (pool.length) {
          const pitch = nearest(pool, groups.rep.prevPitch ?? (sweetLo + sweetHi) / 2);
          for (let t = barStart; t < barEnd; t += step) {
            push('rep', pitch, t, Math.min(step, barEnd - t), 'spiccato');
          }
        }
      } else if (kind === 'lead' || kind === 'leadDouble') {
        // the brass lead (§13.5): the motif drawn in the trumpet sweet spot;
        // the horns double at the octave below where D2 allows; the leading
        // tone never sounds (push opens the line there)
        const span = plan.leads.find((l) => bar >= l.startBar && bar <= l.endBar);
        if (span) {
          const leadBars = new Set<number>();
          for (let b = span.startBar; b <= span.endBar; b++) leadBars.add(b);
          const line = motifLine({ project, spans: ctx.spans, sections: ctx.sections, leadBars, comfortable: BRASS_PROFILES.trumpets.sweet, take });
          for (const n of line) {
            if (n.startTick < barStart || n.startTick >= barEnd) continue;
            const pitch = kind === 'lead' ? n.pitch : fitOctave(n.pitch - 12, sweetLo, sweetHi);
            push('line', pitch, n.startTick, Math.min(n.durationTicks, barEnd - n.startTick), n.articulation ?? 'legato', false, 'fresh');
          }
        }
      } else if (kind === 'tutti') {
        // the roster hit (§13.6): the chord's bass pitch class, octave-fitted
        // into the sweet spot, marcato, the moment's drawn shape. The hit
        // opens where the bass pitch class IS the leading tone.
        const moment = momentForBar(ctx.moments, bar);
        if (moment?.kind === 'tutti') {
          const rootPc = ((chordTones(spanAt(barStart).parsed).bassPc % 12) + 12) % 12;
          const pitch = sweetLo + (((rootPc - sweetLo) % 12) + 12) % 12;
          const hitLen = moment.shape === 'breath' ? beat : moment.shape === 'decay' ? beat * 2 : btBar;
          push('hit', pitch, barStart, Math.min(hitLen, barEnd - barStart), 'marcato', true, 'exempt');
        }
      } else if (kind === 'unison') {
        // the horns join the strings' unison line at the fitting octave (§13.6)
        const moment = momentForBar(ctx.moments, bar);
        const line = moment?.kind === 'unison' && moment.carrierTrackId ? leads.find((l) => l.trackId === moment.carrierTrackId) : undefined;
        if (line) {
          for (const n of line.notes) {
            if (n.startTick >= barEnd || n.startTick + n.durationTicks <= barStart) continue;
            const s = Math.max(n.startTick, barStart);
            const e = Math.min(n.startTick + n.durationTicks, barEnd);
            push('line', fitOctave(n.pitch, sweetLo, sweetHi), s, e - s, n.articulation ?? 'legato', true, 'exempt');
          }
        }
      } else if (kind === 'soli') {
        // the horn plays the soli carrier line built beside the DP (§13.6)
        const line = ctx.lines?.soliLineByTrackId[track.id];
        if (line) {
          for (const n of line) {
            if (n.startTick < barStart || n.startTick >= barEnd) continue;
            push('line', n.pitch, n.startTick, Math.min(n.durationTicks, barEnd - n.startTick), n.articulation ?? 'legato', true, 'exempt');
          }
        }
      }
    };

    for (let bar = 1; bar <= bars; bar++) {
      const kind = kindOfBar(bar);
      const planBar = planByBar.get(bar);
      const ordinaryKind = planBar?.ordinary[part];
      const barStart = (bar - 1) * btBar;
      const barEnd = bar * btBar;
      // A moment overriding this part's ordinary line (tutti/unison replace
      // it, a soli silences it) ghost-runs the ordinary kind first: the cap
      // clock, the voice-leading targets and the outer-voice tracking advance
      // EXACTLY as they would without the moments, so every ordinary note
      // outside moment bars is byte-identical to a moment-less run.
      const momentDriven = planBar?.moment !== undefined && kind !== ordinaryKind;
      if (momentDriven && ordinaryKind !== undefined) {
        ghosting = true;
        writeKind(ordinaryKind, bar, barStart, barEnd);
        ghosting = false;
      }
      if (kind) writeKind(kind, bar, barStart, barEnd);
    }
    parts.push({ part, profile: prof, track, candidates });
  }

  /* ---------------- phase B: velocities over ALL brass roles -------------- */

  const others = [
    ...ruleNotes.filter((r) => rosterRoles.has(r.role)),
    ...Object.entries(stringsNotes)
      .map(([id, notes]) => ({ role: project.tracks.find((t) => t.id === id)?.role ?? '', notes }))
      .filter((r) => rosterRoles.has(r.role)),
  ];
  const allBrass = parts.map((p) => ({ role: p.part, notes: p.candidates }));
  const windows: { start: number; end: number; bound: number }[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const barStart = bar * btBar;
    for (const off of beatOffsets(project.timeSignature)) {
      const start = barStart + off;
      if (start >= endTick) continue;
      const end = Math.min(endTick, start + beat);
      const roles = new Set<string>();
      for (const r of others) if (r.notes.some((n) => n.startTick < end && n.startTick + n.durationTicks > start)) roles.add(r.role);
      for (const r of allBrass) if (r.notes.some((n) => n.startTick < end && n.startTick + n.durationTicks > start)) roles.add(r.role);
      windows.push({ start, end, bound: roles.size ? maxMeanVelocityFor(N, clampMax, roles.size) : 127 });
    }
  }
  const boundAt = (tick: number): number => {
    let b = 127;
    for (const w of windows) {
      if (tick >= w.start && tick < w.end) b = Math.min(b, w.bound);
    }
    return b;
  };

  for (const { part, profile, track, candidates } of parts) {
    const [sweetLo, sweetHi] = profile.sweet;
    const notes: Note[] = candidates.map((c) => {
      const bar = Math.min(bars, Math.max(1, Math.floor(c.startTick / btBar) + 1));
      const bound = boundAt(Math.min(endTick - 1, c.startTick));
      const norm = planByBar.get(bar)?.norm ?? 0;
      const shaped = Math.max(1, Math.round(1 + (bound - 1) * Math.min(1, Math.max(0, norm))));
      const v = c.moment ? Math.min(momentVelocity(bar), bound) : shaped;
      return {
        pitch: c.pitch, startTick: c.startTick, durationTicks: c.durationTicks,
        velocity: Math.max(1, Math.min(127, Math.min(v, bound))),
        ...(c.articulation !== undefined ? { articulation: c.articulation } : {}),
      };
    });
    notesByTrackId[track.id] = sanitizeNotes(notes, track.lowestNote, track.highestNote, endTick);
    const count = notesByTrackId[track.id].length;
    if (count) reports.push(`brass ${part}: ${count} notes (sweet ${sweetLo}-${sweetHi}${profile.softCeiling !== null ? `, soft ≤ ${profile.softCeiling}` : ''}, cap ${profile.phraseCapSec}s)`);
  }

  return { notesByTrackId, reports };
}

/**
 * The final brass safety pass (§13.8): re-checks every beat window over the
 * FINAL notes (the strings' humanize/legato may have moved attacks across
 * window boundaries) and lowers BRASS ALONE where the mix would breach the
 * hard clamp. With properly capped velocities this never fires — it is the
 * clamp's guarantee, not a shaper.
 */
export function governBrassVelocities(input: {
  project: Project;
  template: NonNullable<OrchestratorContext['template']>;
  brass: { role: string; notes: Note[] }[];
  otherNotes: { role: string; notes: Note[] }[];
}): void {
  const { project, template, brass, otherNotes } = input;
  const clampMax = template.budget.energyClamp[1];
  const N = template.roster.length;
  const rosterRoles = new Set(template.roster.map((r) => r.role));
  const btBar = barTicks(project.timeSignature);
  const bars = projectBars(project);
  const endTick = bars * btBar;
  const bt = beatTicks(project.timeSignature);
  const others = otherNotes.filter((r) => rosterRoles.has(r.role));
  const brassRoles = brass.filter((r) => rosterRoles.has(r.role) && r.notes.length);
  if (!brassRoles.length) return;
  for (let bar = 0; bar < bars; bar++) {
    const barStart = bar * btBar;
    for (const off of beatOffsets(project.timeSignature)) {
      const start = barStart + off;
      if (start >= endTick) continue;
      const end = Math.min(endTick, start + bt);
      const roles = new Set<string>();
      let otherSum = 0;
      let brassSum = 0;
      let count = 0;
      for (const r of others) {
        for (const n of r.notes) {
          if (n.startTick < end && n.startTick + n.durationTicks > start) { roles.add(r.role); otherSum += n.velocity; count++; }
        }
      }
      for (const r of brassRoles) {
        for (const n of r.notes) {
          if (n.startTick < end && n.startTick + n.durationTicks > start) { roles.add(r.role); brassSum += n.velocity; count++; }
        }
      }
      if (!roles.size || !count || !brassSum) continue;
      const energy = (roles.size / N) * (((otherSum + brassSum) / count) / 127);
      if (energy <= clampMax + 1e-9) continue;
      const allowedTotal = (127 * clampMax * N * count) / roles.size;
      const targetBrass = Math.max(0, allowedTotal - otherSum);
      const scale = targetBrass / brassSum;
      if (scale >= 1) continue;
      for (const r of brassRoles) {
        for (const n of r.notes) {
          if (n.startTick < end && n.startTick + n.durationTicks > start) {
            n.velocity = Math.max(1, Math.floor(n.velocity * scale));
          }
        }
      }
    }
  }
}
