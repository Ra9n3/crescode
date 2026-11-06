/**
 * Winds renderer (Phase 9, spec §14). Realises the planner's per-bar voice
 * kinds AFTER the brass renderer, so the velocity math and the brass
 * windowing (§14.6) see every other family's notes: every wind note's
 * velocity is shaped by its bar's arc norm and capped by the governor bound
 * of every beat window it touches (mean ≤ 127·clampMax·N/roles) — the same
 * invariant the strings and brass obey, so a wind entrance can never push a
 * window over the hard clamp. A final safety pass (governWindsVelocities)
 * re-checks the windows after the strings' humanize/legato and lowers WINDS
 * ALONE if anything moved.
 *
 * One voice per track (§14.1): every kind writes a single line; harmony is
 * spread across the four wind tracks (a per-bar pre-pass assigns distinct
 * registers). Sustained stretches are cut at the part's phrase cap (seconds
 * through the tempo map, the addendum's bar bounds included) and rest at
 * least one beat; consecutive same-pitch sustained notes merge into one
 * note (the addendum). The bassoon's cello double rides the CELLO line's
 * own phrasing (the brass low-double precedent, §13.9) — no independent
 * cap clock there.
 *
 * Pitch choices are deterministic nearest-target readings of the chord
 * tones; the leading tone never sounds in the winds at all (the hard rule
 * wins over every role, §14.5); the lead ceiling holds (§14.5).
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
import { motifLine } from '../lines/motif';
import { cellGrid } from '../lines/ostinato';
import { textureForType, sectionTypeNameAtBar } from '../conductor/layers';
import type { OrchestratorContext } from '../module';
import { WIND_PROFILES, windRosterOf, type WindPart, type WindProfile } from './profile';
import type { WindPlan, WindVoiceKind } from './plan';

interface WindCandidate {
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

const isSoft = (a: Note['articulation'] | undefined): boolean => a === 'sustain' || a === 'legato';

/** BPM at a tick through the tempo map (the repeated-16ths rule, §14.2). */
const bpmAtTick = (tick: number, tempoMap: { tick: number; bpm: number }[]): number => {
  let bpm = tempoMap[0]?.bpm ?? 120;
  for (const e of tempoMap) {
    if (e.tick <= tick) bpm = e.bpm;
    else break;
  }
  return bpm;
};

const HARMONY_ORDER: readonly WindPart[] = ['flutes', 'oboes', 'clarinets', 'bassoons'];

export interface WindRenderInput {
  ctx: OrchestratorContext;
  plan: WindPlan;
  /** The strings module's notes by track id (the cello line + ostinato onsets). */
  stringsNotes: Record<string, Note[]>;
  /** The rendered brass notes by track id (the windowing + window math). */
  brassNotes: Record<string, Note[]>;
  /** The rules generator's + tutti-hit notes by role (window math). */
  ruleNotes: { role: string; notes: Note[] }[];
}

export interface WindRenderResult {
  notesByTrackId: Record<string, Note[]>;
  reports: string[];
}

export function renderWinds(input: WindRenderInput): WindRenderResult {
  const { ctx, plan, stringsNotes, brassNotes, ruleNotes } = input;
  const { project, template } = ctx;
  const notesByTrackId: Record<string, Note[]> = {};
  const reports: string[] = [];
  if (!template || !plan.bars.length || !ctx.spans.length) {
    // no plan: the module is silent — but every rostered wind track it owns
    // must still be CLAIMED (an empty list) so the generator's phantom wind
    // notes never leak into the final score at assembly
    if (template) {
      for (const part of windRosterOf(ctx)) {
        const t = ctx.project.tracks.find((x) => x.role === part && x.family === 'Woodwinds' && isInstrumentTrack(x) && !x.locked);
        if (t) notesByTrackId[t.id] = [];
      }
    }
    return { notesByTrackId, reports };
  }

  const btBar = barTicks(project.timeSignature);
  const beat = beatTicks(project.timeSignature);
  const eighth = PPQ / 2;
  const bars = projectBars(project);
  const endTick = bars * btBar;
  const clampMax = template.budget.energyClamp[1];
  const N = template.roster.length;
  const capAll = maxMeanVelocityFor(N, clampMax, N);
  const rosterRoles = new Set(template.roster.map((r) => r.role));
  const scale = scalePitchClasses(project.key, project.mode);
  const scalePcs = new Set(scale);
  const ltPc = leadingTonePcOf(project.key, scale);
  const take = project.orchestration?.take ?? 0;

  const planByBar = new Map(plan.bars.map((b) => [b.bar, b]));
  const momentVelocity = (bar: number): number => {
    const E = Math.min(clampMax, Math.max(0, ctx.arc?.[bar - 1]?.target ?? 0));
    return Math.max(1, Math.min(capAll, Math.round(1 + (capAll - 1) * E)));
  };

  // the cello line the bassoon doubles (§14.5): the cellosBasses voice, Cb layer excluded
  const celloTrack = project.tracks.find((t) => t.role === 'cellosBasses' && isInstrumentTrack(t));
  const celloNotes = celloTrack ? (stringsNotes[celloTrack.id] ?? []).filter((n) => n.layer !== 'cb') : [];
  // the FULL low picture (Cb doubles + the low brass) for the low-interval
  // guard — the fresh Cb doubles still ride the cello list at this point
  // (the 8.2 split materializes the desk later), so the separate basses
  // track is deliberately NOT read here: its pre-compose notes are stale on
  // a re-compose and would make the guard non-deterministic
  const lowBrassNotes = Object.entries(brassNotes)
    .filter(([id]) => ['trombones', 'tuba'].includes(project.tracks.find((t) => t.id === id)?.role ?? ''))
    .flatMap(([, notes]) => notes);
  const lowOthers: { startTick: number; durationTicks: number; pitch: number }[] = [
    ...(celloTrack ? (stringsNotes[celloTrack.id] ?? []) : []),
    ...lowBrassNotes,
  ].map((n) => ({ startTick: n.startTick, durationTicks: n.durationTicks, pitch: n.pitch }));

  // the tune carriers' lines (pure texture plan) for the lead double + cut-over
  const leads = ctx.lines?.leads ?? [];
  const carrierByBar = ctx.lines?.carrierByBar ?? [];
  const lineNotesAtBar = (bar: number): Note[] => {
    const carrier = carrierByBar[bar - 1];
    if (!carrier) return [];
    const line = leads.find((l) => l.trackId === carrier);
    if (!line) return [];
    const s = (bar - 1) * btBar;
    return line.notes.filter((n) => n.startTick < bar * btBar && n.startTick + n.durationTicks > s);
  };
  const brassTrackNotes = (role: string): Note[] => {
    const t = project.tracks.find((x) => x.role === role && x.family === 'Brass');
    return t ? (brassNotes[t.id] ?? []) : [];
  };
  // the brass lead's line for the cut-over (§14.6)
  const brassLeadAtBar = (bar: number): Note[] => {
    const bp = ctx.brassPlan?.bars[bar - 1];
    if (!bp || !Object.values(bp.voices).includes('lead')) return [];
    const s = (bar - 1) * btBar;
    return brassTrackNotes('trumpets').filter((n) => n.startTick < bar * btBar && n.startTick + n.durationTicks > s);
  };
  // the tune's notes this bar (the brass lead when the brass owns it, else the strings' carrier)
  const tuneAtBar = (bar: number): Note[] => {
    const b = brassLeadAtBar(bar);
    return b.length ? b : lineNotesAtBar(bar);
  };
  // the brass plan's active bars (§14.6) — read from the brass plan's
  // ORDINARY line + lead spans only, both moments-independent, so the
  // windowing behaves identically with and without the moments (the
  // draw-identity pin); the rendered moment kinds never drive it
  const brassActiveAtBar = (bar: number): boolean => {
    const bp = ctx.brassPlan?.bars[bar - 1];
    const ordinaryActive = !!bp && Object.values(bp.ordinary).some((k) => k === 'fanfare' || k === 'stab');
    return ordinaryActive || (!!ctx.brassPlan?.leads.some((l) => bar >= l.startBar && bar <= l.endBar));
  };
  const brassOnsetsAtBar = (bar: number): number[] => {
    const s = (bar - 1) * btBar;
    const e = bar * btBar;
    const out: number[] = [];
    for (const role of ['horns', 'trumpets', 'trombones', 'tuba']) {
      for (const n of brassTrackNotes(role)) {
        if (n.startTick >= s && n.startTick < e) out.push(n.startTick);
      }
    }
    return out.sort((a, b) => a - b);
  };

  // the wind lead's motif lines (built once per span, like the brass lead)
  const windLeadLineByTrackId: Record<string, Note[]> = {};
  for (const span of plan.leads) {
    const track = project.tracks.find((t) => t.role === span.part && t.family === 'Woodwinds' && isInstrumentTrack(t));
    if (!track) continue;
    const prof = WIND_PROFILES[span.part];
    // the lead ceiling: soft dynamics never leave the part's soft window;
    // the clarinet's 65–68 lead ban lifts the window's floor past the band
    const banFloor = prof.leadBan ? prof.leadBan[1] + 1 : prof.sweet[0];
    const loFit = Math.max(track.lowestNote, prof.sweet[0], span.part === 'clarinets' ? banFloor : prof.sweet[0]);
    const hi = prof.softCeiling !== null ? Math.min(prof.sweet[1], prof.softCeiling) : prof.sweet[1];
    const leadBars = new Set<number>();
    for (let b = span.startBar; b <= span.endBar; b++) leadBars.add(b);
    const line = motifLine({ project, spans: ctx.spans, sections: ctx.sections, leadBars, comfortable: [loFit, Math.min(track.highestNote, hi)], take });
    if (line.length) windLeadLineByTrackId[track.id] = [...(windLeadLineByTrackId[track.id] ?? []), ...line];
  }

  // the lead ceiling (§14.5): the tune's lowest pitch this bar (the wind
  // lead's own line when it carries the tune) — null when no lead sounds
  const ceilingAtBar = (bar: number): number | null => {
    const lead = plan.leads.find((l) => bar >= l.startBar && bar <= l.endBar);
    let line: Note[];
    if (lead) {
      const s = (bar - 1) * btBar;
      const t = project.tracks.find((x) => x.role === lead.part && x.family === 'Woodwinds');
      const notes = t ? (windLeadLineByTrackId[t.id] ?? []) : [];
      line = notes.filter((n) => n.startTick < bar * btBar && n.startTick + n.durationTicks > s);
    } else {
      line = tuneAtBar(bar);
    }
    if (!line.length) return null;
    return line.reduce((m, n) => Math.min(m, n.pitch), Infinity);
  };

  // the harmony spread (§14.5): a per-(bar, span) pre-pass assigns each
  // 'harmony' part a DISTINCT chord-tone slot — the top voice under the
  // lead ceiling, the inner voices spread below, the bassoon at the bottom
  const harmonyKey = (bar: number, spanIdx: number, part: WindPart): string => `${bar}:${spanIdx}:${part}`;
  const harmonyPick = new Map<string, number>();
  for (const pb of plan.bars) {
    const harParts = HARMONY_ORDER.filter((p) => pb.voices[p] === 'harmony');
    if (!harParts.length) continue;
    const barStart = (pb.bar - 1) * btBar;
    const barEnd = pb.bar * btBar;
    const ceiling = ceilingAtBar(pb.bar);
    for (let si = 0; si < ctx.spans.length; si++) {
      const sp = ctx.spans[si];
      if (sp.startTick >= barEnd || sp.endTick <= barStart) continue;
      const lo = Math.min(...harParts.map((p) => WIND_PROFILES[p].sweet[0])); // harmony stays in the sweet windows (the dark zone is colour-only)
      const hi = Math.max(...harParts.map((p) => WIND_PROFILES[p].sweet[1]));
      let tones = [...new Set(tonePitches(sp.parsed, lo, hi))].sort((a, b) => a - b);
      if (ltPc !== null) tones = tones.filter((p) => (((p % 12) + 12) % 12) !== ltPc);
      if (ceiling !== null) {
        const under = tones.filter((p) => p <= ceiling);
        if (under.length) tones = under;
      }
      if (!tones.length) continue;
      let idx = tones.length - 1;
      for (const p of harParts) {
        if (p === 'bassoons') { harmonyPick.set(harmonyKey(pb.bar, si, p), tones[0]); continue; }
        const slot = tones[Math.max(0, idx)];
        harmonyPick.set(harmonyKey(pb.bar, si, p), slot);
        idx -= 2; // spread the inner voices a tone apart
      }
    }
  }

  const spanAt = (tick: number) =>
    ctx.spans.find((sp) => sp.startTick <= tick && tick < sp.endTick) ?? ctx.spans[0];

  /* ---------------- phase A: candidates per part (no velocities yet) ------ */

  interface PartCandidates {
    part: WindPart;
    profile: WindProfile;
    track: Track;
    candidates: WindCandidate[];
  }
  const parts: PartCandidates[] = [];

  // every rostered wind track is CLAIMED up front (an empty list when the
  // part never sounds) — the generator's phantom wind notes must never
  // reach the final score through the assembly's generator fallback
  for (const part of windRosterOf(ctx)) {
    const t = project.tracks.find((x) => x.role === part && x.family === 'Woodwinds' && isInstrumentTrack(x) && !x.locked);
    if (t) notesByTrackId[t.id] = [];
  }

  for (const part of ['flutes', 'oboes', 'clarinets', 'bassoons'] as WindPart[]) {
    const prof = WIND_PROFILES[part];
    const track = project.tracks.find((t) => t.role === part && t.family === 'Woodwinds' && isInstrumentTrack(t) && !t.locked);
    if (!track) continue;
    if (!plan.bars.some((b) => b.voices[part] !== undefined) && !plan.leads.some((l) => l.part === part)) continue;
    const [sweetLo, sweetHi] = prof.sweet;
    // the writing window: the sweet spot, plus the clarinet's dark colour
    // zone (§14.2); SOFT notes never leave the part's soft window
    const colourLo = part === 'clarinets' ? Math.max(track.lowestNote, 50) : sweetLo;
    const softHi = prof.softCeiling ?? sweetHi;
    const candidates: WindCandidate[] = [];

    // Per-GROUP state: the last pitch per kind group — 'sus' (colour/
    // harmony), 'line' (leadDouble/counter/lead/cut-over), 'rep' (ostinato),
    // 'hit' (tutti) — so a moment gesture never moves an ordinary role's
    // voice-leading target. The PHRASE CAP is a PART-level clock (§14.2)
    // over sounding runs; the bassoon's cello double ('dbl') rides the
    // CELLO line's own phrasing — no independent clock (§13.9 precedent).
    type GroupKey = 'sus' | 'dbl' | 'line' | 'rep' | 'hit';
    interface GroupState { prevPitch: number | null }
    const groups: Record<GroupKey, GroupState> = {
      sus: { prevPitch: null },
      dbl: { prevPitch: null },
      line: { prevPitch: null },
      rep: { prevPitch: null },
      hit: { prevPitch: null },
    };
    const capByBars = prof.phraseCapBars !== null ? prof.phraseCapBars * btBar : Infinity;
    const capTicks = Math.max(beat, Math.min(capByBars, secondsToTicks(prof.phraseCapSec, project.tempoMap)));
    let partRunStart: number | null = null; // the sounding run's first onset
    let partPrevEnd = -Infinity; // the last (real or ghosted) note end
    let partRestUntil = -Infinity; // after a cap cut: the part rests at least one beat

    let ghosting = false; // ghost mode: advance the state, emit nothing
    // fresh: the gesture starts a new phrase (the wind lead, the pickup run).
    // exempt: the moment gestures (tutti/unison/soli) neither consult nor
    // advance the part clock — they are rare designed hits, and the clock
    // must stay byte-identical with and without the moments.
    const push = (group: GroupKey, pitch: number, start: number, dur: number, articulation: Note['articulation'], moment = false, mode: 'run' | 'fresh' | 'exempt' = 'run') => {
      // the leading tone is NEVER doubled across families: the winds open
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
      if (!ghosting) candidates.push({ pitch, startTick: start2, durationTicks: end2 - start2, articulation, ...(moment ? { moment: true } : {}) });
      st.prevPitch = pitch;
    };
    // chord-tone pools with the leading tone removed (the picker never sees it)
    const noLt = (cands: number[]): number[] => (ltPc === null ? cands : cands.filter((p) => (((p % 12) + 12) % 12) !== ltPc));
    // the soft-dynamics window (§14.2): a SOFT note may never leave it
    const softLo = prof.softFloor ?? colourLo;
    const artFor = (pitch: number, soft: Note['articulation'], hard: Note['articulation']): Note['articulation'] =>
      pitch >= softLo && pitch <= softHi ? soft : hard;
    /** The sustained-role picker window: inside the sweet spot (the clarinet's
     *  dark colour zone excepted), soft-capped (§14.2). */
    const susWindow = (): [number, number] => [colourLo, Math.min(sweetHi, softHi)];

    const writeKind = (kind: WindVoiceKind, bar: number, barStart: number, barEnd: number, norm: number) => {
      if (kind === 'colour' || kind === 'harmony') {
        // one sustained chord tone per span piece; harmony reads the
        // per-(bar, span) spread pre-pass; the ceiling holds (§14.5)
        const ceiling = ceilingAtBar(bar);
        for (let si = 0; si < ctx.spans.length; si++) {
          const sp = ctx.spans[si];
          const s = Math.max(sp.startTick, barStart);
          const e = Math.min(sp.endTick, barEnd);
          if (e - s < 1) continue;
          const st = groups.sus;
          const target = st.prevPitch ?? (sweetLo + sweetHi) / 2;
          const [wLo, wHi] = susWindow();
          const pool = noLt(tonePitches(sp.parsed, wLo, wHi));
          if (!pool.length) continue;
          let pick: number;
          const preset = harmonyPick.get(harmonyKey(bar, si, part));
          if (kind === 'harmony' && preset !== undefined) {
            pick = fitOctave(preset, wLo, wHi);
            if (ceiling !== null && pick > ceiling) {
              pick = fitOctave(pick, wLo, Math.max(wLo, Math.min(wHi, ceiling - 1)));
              if (pick > ceiling) continue;
            }
          } else {
            const under = ceiling !== null ? pool.filter((p) => p <= ceiling) : pool;
            if (!under.length) continue;
            pick = nearest(under, target);
          }
          push('sus', pick, s, e - s, artFor(pick, 'sustain', 'marcato'));
        }
      } else if (kind === 'leadDouble') {
        // double the strings' lead at the octave above or in unison (§14.5):
        // the drawn choice rides the PURE carrier line (moment-independent)
        const secHere = ctx.sections.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
        const choice = secHere ? plan.leadDoubleByType[secHere.name.trim().toLowerCase() || '*'] : undefined;
        if (!choice || choice.part !== part) return;
        const interval = (choice.mode === 'none' ? 'octaveAbove' : choice.mode) === 'octaveAbove' ? 12 : 0;
        for (const n of lineNotesAtBar(bar)) {
          const s = Math.max(n.startTick, barStart);
          const e = Math.min(n.startTick + n.durationTicks, barEnd);
          if (e - s < 1) continue;
          const pitch = fitOctave(n.pitch + interval, sweetLo, sweetHi);
          const art = isSoft(n.articulation) ? artFor(pitch, 'legato', 'marcato') : (n.articulation ?? 'legato');
          push('line', pitch, s, e - s, art);
        }
      } else if (kind === 'counter') {
        // the clarinet rides the strings' counterline line (the imitation
        // answers already replace it on their bars — §14.5); the 65–68 ban
        // drops those notes (the addendum); no line in the bar → colour
        const line = ctx.lines?.counter;
        const notes = line ? line.notes.filter((n) => n.startTick < barEnd && n.startTick + n.durationTicks > barStart) : [];
        if (!notes.length) {
          writeKind('colour', bar, barStart, barEnd, norm);
          return;
        }
        for (const n of notes) {
          const s = Math.max(n.startTick, barStart);
          const e = Math.min(n.startTick + n.durationTicks, barEnd);
          if (e - s < 1) continue;
          const pitch = fitOctave(n.pitch, sweetLo, sweetHi);
          if (prof.leadBan && pitch >= prof.leadBan[0] && pitch <= prof.leadBan[1]) continue;
          push('line', pitch, s, e - s, artFor(pitch, 'legato', 'marcato'));
        }
      } else if (kind === 'bassDouble') {
        // the bassoon doubles the cello line at unison or an octave up
        // (§14.5), riding the CELLO line's own phrasing (no independent cap
        // clock, §13.9); sub-eighth cello motion merges into one held
        // segment; below MIDI 48 the interval with every other low voice is
        // a unison/octave or a 5th or wider — the potential cello octave-up
        // answer of a sub-36 note counts too (the split runs later, §8.2).
        // The guard reads the WRITTEN overlap only (no head tolerance): at
        // wind-render time the cello list is pre-humanize/pre-legato, and a
        // segment's bar holds only notes that START in it — so the decision
        // never depends on a moment's replacement of a NEIGHBOURING bar.
        const segs: { start: number; end: number; pitch: number }[] = [];
        {
          const sorted = [...celloNotes].sort((a, b) => a.startTick - b.startTick);
          for (const n of sorted) {
            const last = segs[segs.length - 1];
            if (last && n.startTick - last.start < eighth) {
              last.end = Math.max(last.end, n.startTick + n.durationTicks);
            } else {
              segs.push({ start: n.startTick, end: n.startTick + n.durationTicks, pitch: n.pitch });
            }
          }
        }
        let celloSounds = false;
        if (process.env.SUPDBG) {
          const here = segs.filter((sg) => sg.start < barEnd && sg.end > barStart);
          console.log(`SUPDBG2 ${part} bar ${bar} kind=${kind} segs=[${here.map((sg) => `${sg.pitch}@${sg.start}+${sg.end - sg.start}`).join(' ')}] celloList=${celloNotes.length}`);
        }
        for (const seg of segs) {
          if (seg.start >= barEnd || seg.start + (seg.end - seg.start) <= barStart) continue;
          celloSounds = true;
          const s = Math.max(seg.start, barStart);
          const e = Math.min(seg.end, barEnd);
          const pitch = fitOctave(seg.pitch, sweetLo, sweetHi);
          // the low-interval rule at write time (§14.5)
          const clash = lowOthers.some((c) => {
            if (c.startTick === seg.start && c.pitch === seg.pitch) return false; // the cello's own note
            if (c.startTick >= e || c.startTick + c.durationTicks <= s) return false;
            if (Math.min(pitch, c.pitch) >= 48) return false;
            const d = Math.abs(pitch - c.pitch);
            return !(d === 0 || d % 12 === 0 || d >= 7);
          });
          // the potential octave-up answer of a sub-36 cello note (8.2)
          const answerClash = seg.pitch < 36 && (() => {
            const ans = seg.pitch + 12;
            if (Math.min(pitch, ans) >= 48) return false;
            const d = Math.abs(pitch - ans);
            return !(d === 0 || d % 12 === 0 || d >= 7);
          })();
          if (clash || answerClash) {
            if (process.env.SUPDBG) console.log(`SUPDBG ${part} bar ${bar} seg ${seg.pitch}@${seg.start} -> ${pitch}: ${answerClash ? 'answer' : 'interval'} clash`);
            continue;
          }
          push('dbl', pitch, s, e - s, e - s < beat ? 'staccato' : artFor(pitch, 'sustain', 'marcato'));
        }
        if (!celloSounds) {
          // the cellos rest here: the sustained root (§14.5)
          const sp = spanAt(barStart);
          const pool = noLt(tonePitches(sp.parsed, sweetLo, sweetHi));
          if (pool.length) {
            const rootPc = ((chordTones(sp.parsed).bassPc % 12) + 12) % 12;
            const rootPool = pool.filter((p) => (((p % 12) + 12) % 12) === rootPc);
            const pick = nearest(rootPool.length ? rootPool : pool, groups.dbl.prevPitch ?? (sweetLo + sweetHi) / 2);
            push('dbl', pick, barStart, barEnd - barStart, artFor(pick, 'sustain', 'marcato'));
          }
        }
      } else if (kind === 'ostinato') {
        // staccato chord-tone figures INSIDE the ostinato's rhythm cell
        // (§14.5): the onsets are the texture's drawn CELL GRID itself —
        // moment-independent by construction (the rendered strings' ostinato
        // is tacet on soli bars, so reading its notes would make the ghost
        // state moment-dependent); flutes/clarinets may use 16ths, the
        // addendum's repeated-note rules apply, bassoons eighths or slower
        const secHere = ctx.sections.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
        if (!secHere) return;
        const tex = textureForType(ctx, sectionTypeNameAtBar(ctx, bar));
        if (bar - secHere.startBar < tex.style.enterAfter) return; // the cell enters 1–2 bars in, like the strings'
        const grid = cellGrid(project.timeSignature, tex.style.cell, tex.style.rate);
        const slotTicks = grid.slots.map((slotIdx) => barStart + Math.floor(slotIdx / grid.perBeat) * beat + (slotIdx % grid.perBeat) * Math.floor(beat / grid.perBeat));
        const uniq = [...new Set(slotTicks)].sort((a, b) => a - b);
        if (!uniq.length) return;
        const bpm = bpmAtTick(barStart, project.tempoMap);
        const step = uniq.length > 1 ? uniq[1] - uniq[0] : PPQ / 4;
        const picked = uniq.filter((_, i) => i % 2 === 0); // every other attack keeps the figure light
        let prevPitch: number | null = groups.rep.prevPitch;
        let prevOnset: number | null = null;
        for (const onset of picked) {
          // the bassoon never moves faster than eighths (§14.2)
          if (prevOnset !== null && onset - prevOnset < eighth) { prevOnset = onset; continue; }
          const sp = spanAt(onset);
          const [wLo, wHi] = susWindow();
          const pool = noLt(tonePitches(sp.parsed, wLo, wHi));
          if (!pool.length) { prevOnset = onset; continue; }
          let pitch = nearest(pool, prevPitch ?? (sweetLo + sweetHi) / 2);
          // repeated SAME-pitch 16ths (§14.2): flutes any tempo; oboes and
          // clarinets only below 120 BPM — otherwise take the next tone
          if (prevPitch === pitch && step <= PPQ / 4 && !prof.repeated16thsAnyTempo && bpm >= 120) {
            const alt = pool.filter((p) => p !== pitch);
            if (!alt.length) { prevOnset = onset; continue; }
            pitch = nearest(alt, pitch);
          }
          const dur = Math.min(step, barEnd - onset);
          push('rep', pitch, onset, dur, 'staccato');
          prevPitch = pitch;
          prevOnset = onset;
        }
      } else if (kind === 'lead') {
        // the wind lead (§14.5): the motif drawn in the part's soft window
        const line = windLeadLineByTrackId[track.id];
        if (line) {
          for (const n of line) {
            if (n.startTick < barStart || n.startTick >= barEnd) continue;
            push('line', n.pitch, n.startTick, Math.min(n.durationTicks, barEnd - n.startTick), n.articulation ?? 'legato', false, 'fresh');
          }
        }
      } else if (kind === 'tutti') {
        // the roster hit (§14.7): the chord's bass pitch class, octave-fitted
        // into the sweet spot, marcato, the moment's drawn shape
        const moment = momentForBar(ctx.moments, bar);
        if (moment?.kind === 'tutti') {
          const rootPc = ((chordTones(spanAt(barStart).parsed).bassPc % 12) + 12) % 12;
          const pitch = sweetLo + (((rootPc - sweetLo) % 12) + 12) % 12;
          const hitLen = moment.shape === 'breath' ? beat : moment.shape === 'decay' ? beat * 2 : btBar;
          push('hit', pitch, barStart, Math.min(hitLen, barEnd - barStart), 'marcato', true, 'exempt');
        }
      } else if (kind === 'unison') {
        // §14.7: flutes and oboes join an octave above the unison line,
        // bassoons join with the cellos (the cellos' own spread offset)
        const moment = momentForBar(ctx.moments, bar);
        const line = moment?.kind === 'unison' && moment.carrierTrackId ? leads.find((l) => l.trackId === moment.carrierTrackId) : undefined;
        if (line) {
          const offset = part === 'bassoons' ? (moment?.offsetByRole?.cellosBasses ?? -12) : 12;
          for (const n of line.notes) {
            if (n.startTick >= barEnd || n.startTick + n.durationTicks <= barStart) continue;
            const s = Math.max(n.startTick, barStart);
            const e = Math.min(n.startTick + n.durationTicks, barEnd);
            const pitch = fitOctave(n.pitch + offset, sweetLo, sweetHi);
            const art = isSoft(n.articulation) ? artFor(pitch, 'legato', 'marcato') : (n.articulation ?? 'legato');
            push('line', pitch, s, e - s, art, true, 'exempt');
          }
        }
      } else if (kind === 'soli') {
        // the wind plays the soli carrier line built beside the DP (§14.7)
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
      const planBar = planByBar.get(bar);
      if (!planBar) continue;
      const kind = planBar.voices[part];
      const ordinaryKind = planBar.ordinary[part];
      const barStart = (bar - 1) * btBar;
      const barEnd = bar * btBar;
      const norm = planBar.norm;
      // A moment overriding this part's ordinary line (tutti/unison replace
      // it, a soli silences it) ghost-runs the ordinary kind first: the cap
      // clock and the voice-leading targets advance EXACTLY as they would
      // without the moments, so every ordinary note outside moment bars is
      // byte-identical to a moment-less run.
      const momentDriven = planBar.moment !== undefined && kind !== ordinaryKind;
      if (momentDriven && ordinaryKind !== undefined) {
        ghosting = true;
        writeKind(ordinaryKind, bar, barStart, barEnd, norm);
        ghosting = false;
      }
      if (!kind) continue;

      // §14.6 windowing (ordinary bars only — the moments carry their own
      // contracts): when the brass plays a fanfare, stab or lead, the flutes
      // cut OVER the brass at the octave above the tune; the other winds
      // play in the gaps between the brass hits or rest. The brass part is
      // never changed. The cut-over emits STATE-FREE (no part clock, no
      // voice-leading group) so the ordinary line's state — and therefore
      // every later bar — stays byte-identical with and without the moments.
      const brassActive = brassActiveAtBar(bar);
      if (brassActive && !planBar.moment && part === 'flutes' && kind !== undefined) {
        // the ordinary line's state advances exactly as the moment-driven
        // ghost would (the two runs stay byte-identical outside moment bars)
        const ord = planBar.ordinary[part];
        if (ord !== undefined) {
          ghosting = true;
          writeKind(ord, bar, barStart, barEnd, norm);
          ghosting = false;
        }
        // the cut-over: the tune's notes at the octave above, fitted; notes
        // above MIDI 84 only when the bar's energy allows them (§14.6), and
        // always as hard attacks there (the soft ceiling holds) — emitted
        // STATE-FREE (no part clock, no voice-leading group)
        const capHi = norm >= 0.72 ? Math.min(sweetHi, 91) : Math.min(sweetHi, softHi);
        for (const n of tuneAtBar(bar)) {
          const s = Math.max(n.startTick, barStart);
          const e = Math.min(n.startTick + n.durationTicks, barEnd);
          if (e - s < 1) continue;
          const pitch = fitOctave(n.pitch + 12, sweetLo, capHi);
          if (ltPc !== null && (((pitch % 12) + 12) % 12) === ltPc) continue;
          candidates.push({ pitch, startTick: s, durationTicks: e - s, articulation: artFor(pitch, 'legato', 'marcato') });
        }
        continue;
      }

      const start = candidates.length;
      writeKind(kind, bar, barStart, barEnd, norm);
      const produced = candidates.splice(start);
      let kept = produced;
      if (brassActive && !planBar.moment) {
        // the other winds: attacked notes never attack with the brass (the
        // gaps between the hits); a held note may simply continue under them.
        // The BASSOON's cello double is structural (it rides the cello line's
        // own phrasing, like the brass low-double) — it never yields to the
        // hits, so the chorus's "bassoon wherever the cellos play" holds.
        const brassOnsets = brassOnsetsAtBar(bar);
        const structural = planBar.voices[part] === 'bassDouble';
        kept = kept.filter((c) => {
          if (structural) return true;
          if (isSoft(c.articulation) && c.durationTicks >= beat) return true;
          return !brassOnsets.some((o) => c.startTick >= o && c.startTick < o + eighth);
        });
      }
      // §14.5 lead ceiling: on a wind-lead bar the other winds stay under
      // the soloist (the leadDouble/cut-over are the intended exceptions)
      const leadHere = plan.leads.find((l) => bar >= l.startBar && bar <= l.endBar);
      if (leadHere && part !== leadHere.part && !planBar.moment) {
        const ceiling = ceilingAtBar(bar);
        if (ceiling !== null) kept = kept.filter((c) => c.pitch <= ceiling);
      }
      candidates.push(...kept);
    }

    // the pickup run (§14.5): replaces the ordinary line on its bar; ends
    // on a chord tone at the downbeat
    for (const run of plan.pickupRuns.filter((r) => r.part === part)) {
      if (run.bar < 1 || run.bar > bars || run.downbeatBar > bars) continue;
      const momentBar = momentForBar(ctx.moments, run.bar);
      const momentDown = momentForBar(ctx.moments, run.downbeatBar);
      const leadHere = plan.leads.find((l) => run.bar >= l.startBar && run.bar <= l.endBar);
      if (momentBar || momentDown?.kind === 'unison' || momentDown?.kind === 'soli' || leadHere) continue; // a gesture owns the bar
      const barStart = (run.bar - 1) * btBar;
      const barEnd = run.bar * btBar;
      // drop the ordinary candidates of the pickup bar (the run replaces
      // them) and of the downbeat's first beat (the landing owns it)
      const downStart = (run.downbeatBar - 1) * btBar;
      for (let i = candidates.length - 1; i >= 0; i--) {
        const c = candidates[i];
        if (c.moment) continue;
        if ((c.startTick >= barStart && c.startTick < barEnd) || (c.startTick >= downStart && c.startTick < run.downbeatTick + beat)) candidates.splice(i, 1);
      }
      // the diatonic run: scale tones rising into the landing, staying inside
      // the part's sweet window (the out-of-sweet high-energy rule), the
      // clarinet's 65–68 ban respected, ≤ 8 sixteenths
      const landing = run.downbeatPitch;
      const step16 = PPQ / 4;
      const maxNotes = Math.min(8, Math.floor((run.downbeatTick - run.startTick) / step16));
      const walked: number[] = [landing];
      let pc = landing;
      for (let i = 1; i < maxNotes; i++) {
        let p = pc - 1;
        while (p > landing - 25 && p >= sweetLo && !scalePcs.has(((p % 12) + 12) % 12)) p--;
        if (p <= landing - 25 || p < sweetLo) break;
        pc = p;
        if (prof.leadBan && p >= prof.leadBan[0] && p <= prof.leadBan[1]) continue; // skipped degree
        walked.unshift(p);
        if (landing - p >= 14) break;
      }
      if (walked.length < 3) continue;
      const runNotes: { pitch: number; startTick: number }[] = [];
      const n = walked.length;
      for (let i = 0; i < n; i++) {
        const startTick = run.downbeatTick - (n - i) * step16;
        if (startTick < run.startTick) continue;
        runNotes.push({ pitch: walked[i], startTick });
      }
      if (runNotes.length < 2) continue;
      const planRunBar = planByBar.get(run.bar);
      if (planRunBar) {
        // the dropped ordinary line already advanced the state (it was
        // written unghosted above and spliced out) — the run rides fresh
        for (const rn of runNotes) {
          push('line', rn.pitch, rn.startTick, step16, 'legato', false, 'fresh');
        }
      }
      // the landing note at the downbeat — unless a tutti hit lands there
      const hitHere = momentDown?.kind === 'tutti' && planByBar.get(run.downbeatBar)?.voices[part] === 'tutti';
      if (!hitHere) {
        push('line', landing, run.downbeatTick, beat, 'marcato', false, 'fresh');
      }
    }

    // §14.2 flutter-tongue: the drawn peak bar's sustained note becomes
    // 'tremolo' (stored as data, rare)
    for (const bar of plan.flutterBars[part] ?? []) {
      const barStart = (bar - 1) * btBar;
      const barEnd = bar * btBar;
      for (const c of candidates) {
        if (c.startTick >= barStart && c.startTick < barEnd && c.articulation === 'sustain') {
          c.articulation = 'tremolo';
          break;
        }
      }
    }

    parts.push({ part, profile: prof, track, candidates });
  }

  /* --------- phase A.5: the sustained pads merge (§14.2, addendum) -------- */

  for (const p of parts) {
    const merged: WindCandidate[] = [];
    for (const c of [...p.candidates].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch)) {
      const last = merged[merged.length - 1];
      if (
        last && last.pitch === c.pitch && isSoft(last.articulation) && isSoft(c.articulation)
        && c.startTick <= last.startTick + last.durationTicks && !c.moment && !last.moment
      ) {
        last.durationTicks = Math.min(endTick, Math.max(last.durationTicks, c.startTick + c.durationTicks - last.startTick));
      } else {
        merged.push({ ...c });
      }
    }
    p.candidates = merged;
  }

  /* ---------------- phase B: velocities over ALL wind roles -------------- */

  const others = [
    ...ruleNotes.filter((r) => rosterRoles.has(r.role)),
    ...Object.entries(stringsNotes)
      .map(([id, notes]) => ({ role: project.tracks.find((t) => t.id === id)?.role ?? '', notes }))
      .filter((r) => rosterRoles.has(r.role)),
    ...Object.entries(brassNotes)
      .map(([id, notes]) => ({ role: project.tracks.find((t) => t.id === id)?.role ?? '', notes }))
      .filter((r) => rosterRoles.has(r.role)),
  ];
  const allWinds = parts.map((p) => ({ role: p.part, notes: p.candidates }));
  const windows: { start: number; end: number; bound: number }[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const barStart = bar * btBar;
    for (const off of beatOffsets(project.timeSignature)) {
      const start = barStart + off;
      if (start >= endTick) continue;
      const end = Math.min(endTick, start + beat);
      const roles = new Set<string>();
      for (const r of others) if (r.notes.some((n) => n.startTick < end && n.startTick + n.durationTicks > start)) roles.add(r.role);
      for (const r of allWinds) if (r.notes.some((n) => n.startTick < end && n.startTick + n.durationTicks > start)) roles.add(r.role);
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
    if (count) reports.push(`winds ${part}: ${count} notes (sweet ${sweetLo}-${sweetHi}${profile.softCeiling !== null ? `, soft ≤ ${profile.softCeiling}` : ''}${profile.softFloor !== null ? `, soft ≥ ${profile.softFloor}` : ''}, cap ${profile.phraseCapSec}s${profile.phraseCapBars !== null ? `/${profile.phraseCapBars} bars` : ''})`);
  }

  return { notesByTrackId, reports };
}

/**
 * The final winds safety pass (§14.8): re-checks every beat window over the
 * FINAL notes (the strings' humanize/legato may have moved attacks across
 * window boundaries) and lowers WINDS ALONE where the mix would breach the
 * hard clamp. With properly capped velocities this never fires — it is the
 * clamp's guarantee, not a shaper.
 */
export function governWindsVelocities(input: {
  project: Project;
  template: NonNullable<OrchestratorContext['template']>;
  winds: { role: string; notes: Note[] }[];
  otherNotes: { role: string; notes: Note[] }[];
}): void {
  const { project, template, winds, otherNotes } = input;
  const clampMax = template.budget.energyClamp[1];
  const N = template.roster.length;
  const rosterRoles = new Set(template.roster.map((r) => r.role));
  const btBar = barTicks(project.timeSignature);
  const bars = projectBars(project);
  const endTick = bars * btBar;
  const bt = beatTicks(project.timeSignature);
  const others = otherNotes.filter((r) => rosterRoles.has(r.role));
  const windRoles = winds.filter((r) => rosterRoles.has(r.role) && r.notes.length);
  if (!windRoles.length) return;
  for (let bar = 0; bar < bars; bar++) {
    const barStart = bar * btBar;
    for (let off = 0; off < btBar; off += bt) {
      const start = barStart + off;
      if (start >= endTick) continue;
      const end = Math.min(endTick, start + bt);
      const roles = new Set<string>();
      let otherSum = 0;
      let windSum = 0;
      let count = 0;
      for (const r of others) {
        for (const n of r.notes) {
          if (n.startTick < end && n.startTick + n.durationTicks > start) { roles.add(r.role); otherSum += n.velocity; count++; }
        }
      }
      for (const r of windRoles) {
        for (const n of r.notes) {
          if (n.startTick < end && n.startTick + n.durationTicks > start) { roles.add(r.role); windSum += n.velocity; count++; }
        }
      }
      if (!roles.size || !count || !windSum) continue;
      const energy = (roles.size / N) * (((otherSum + windSum) / count) / 127);
      if (energy <= clampMax + 1e-9) continue;
      const allowedTotal = (127 * clampMax * N * count) / roles.size;
      const targetWinds = Math.max(0, allowedTotal - otherSum);
      const scale = targetWinds / windSum;
      if (scale >= 1) continue;
      for (const r of windRoles) {
        for (const n of r.notes) {
          if (n.startTick < end && n.startTick + n.durationTicks > start) {
            n.velocity = Math.max(1, Math.floor(n.velocity * scale));
          }
        }
      }
    }
  }
}
