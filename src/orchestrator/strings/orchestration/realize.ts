/** Coordinated realization of a PRE-EXISTING piece plan. V2 phrases are
 * immutable. Octave choice is per contribution, never whole-piece. All five
 * accepted expressive writers remain the owners of bowing/weight/breath.
 * No classic lower notes are used as provisional constraints. */
import type { CcLane, Note } from '../../../shared/schema/types';
import { projectEndTick } from '../../../shared/schema/meter';
import { humanizeStrings } from '../../expression/humanize';
import { overlapLegato } from '../../expression/legato';
import { buildCcLanes } from '../../expression/cc';
import type { StringsV1Composition, StringsV1VoiceInput } from '../composition';
import { adaptMaterial } from '../material/adapt';
import { chordAt, judgeLine, localScale, type LineNote, type NoteFunction, type TonalFrame } from '../material/line';
import type { PhraseNote } from '../phrases/plan';
import { pitchAtOctave0, writeVoice } from '../writers/voice';
import { writeCompanionVoice } from '../writers/companion';
import { writeViolaVoice } from '../writers/viola';
import { writeCelloVoice } from '../writers/cello';
import { writeDoubleBassVoice } from '../writers/double-bass';
import { DESKS, type Contribution, type Desk, type OrchestrationPlan } from './plan';

export interface ContributionReview {
  readonly contribution: number;
  readonly status: 'fulfilled' | 'sparse' | 'rejected';
  readonly plannedTicks: number;
  readonly generatedNotes: number;
  readonly generatedTicks: number;
  /** Before expression, and after expression respectively; neither is an
   * exported MIDI count. The evidence parser supplies that third stage. */
  readonly coverage: number;
  readonly realizedNotes: number;
  readonly realizedTicks: number;
  readonly realizedCoverage: number;
  readonly range: readonly number[];
  readonly octave: number | null;
  readonly repairs: readonly string[];
  readonly reason: string;
}
export interface DeskReview {
  readonly role: Desk;
  readonly trackId: string | null;
  readonly state: 'substantial' | 'partial' | 'intentional-sparse' | 'intentional-silence' | 'rejected-silent' | 'classic-fallback' | 'unavailable';
  readonly plannedContributions: number;
  readonly fulfilledContributions: number;
  readonly notes: number;
  readonly ticks: number;
  readonly occupancy: number;
  readonly phraseCoverage: number;
  readonly independentOnsets: number;
  readonly range: readonly number[];
}
export interface EnsembleRealization {
  readonly version: 'ensemble-v1';
  readonly accepted: boolean;
  readonly reason: string;
  readonly plan: OrchestrationPlan | null;
  /** Grid notes are the actual accepted expressive writer output. */
  readonly gridByTrackId: Readonly<Record<string, readonly Note[]>>;
  readonly notesByTrackId: Readonly<Record<string, readonly Note[]>>;
  readonly ccByTrackId: Readonly<Record<string, readonly CcLane[]>>;
  readonly contributions: readonly ContributionReview[];
  readonly desks: readonly DeskReview[];
  /** Export is deliberately checked separately on serialized MIDI, not
   * inferred from successful composition or profile capability flags. */
  readonly exportValidation: 'not-serialized-here';
}
export const occupiedTicks = (notes: readonly Note[], from = 0, to = Infinity): number => {
  const intervals = notes.map((n) => [Math.max(from, n.startTick), Math.min(to, n.startTick + n.durationTicks)])
    .filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  let end = from, ticks = 0;
  for (const [a, b] of intervals) { ticks += Math.max(0, b - Math.max(a, end)); end = Math.max(end, b); }
  return ticks;
};
const range = (notes: readonly Note[]) => notes.length ? [Math.min(...notes.map((n) => n.pitch)), Math.max(...notes.map((n) => n.pitch))] : [];
const meanPitch = (notes: readonly { pitch: number; duration: number }[]) => notes.reduce((s, n) => s + n.pitch * n.duration, 0) / Math.max(1, notes.reduce((s, n) => s + n.duration, 0));
const overlap = (n: Note, a: number, b: number) => n.startTick < b && n.startTick + n.durationTicks > a;
/** Texture safety, not a claim of perceptual masking or species counterpoint.
 * Close seconds/tritones are withheld under an exposed subject. Wide chord
 * extensions remain possible; octave reinforcement is allowed, not required. */
function crowded(pitch: number, a: number, b: number, others: readonly Note[]): boolean {
  return others.some((n) => {
    if (!overlap(n, a, b)) return false;
    const d = Math.abs(n.pitch - pitch);
    return d < 3 || (d <= 12 && d % 12 === 6);
  });
}
/** Exact MIDI -> scale spelling, including inflected/borrowed chord tones. */
function spell(frame: TonalFrame, pitch: number): Pick<LineNote, 'step' | 'alter'> {
  let best = { step: 0, alter: 999 };
  for (let step = -35; step <= 35; step++) {
    const alter = pitch - pitchAtOctave0(frame, { step, alter: 0 });
    if (Math.abs(alter) < Math.abs(best.alter)) best = { step, alter };
  }
  return best;
}
interface MaterialNote extends LineNote { readonly function: NoteFunction; readonly breathAfter: boolean }

function expressive(input: StringsV1VoiceInput, source: StringsV1Composition, frame: TonalFrame, c: Contribution, notes: readonly MaterialNote[]): Note[] {
  const cap = source.orchestrationPlan!.capabilities.find((x) => x.role === c.role)!;
  const energyByBar = input.arc.map((a) => a.target);
  const primaryIntensityAt = (tick: number) => source.phrases.flatMap((p) => p.notes).find((n) => n.tick <= tick && n.tick + n.duration > tick)?.intensity ?? 0.55;
  const common = { frame, energyByBar, primaryIntensityAt, triggerable: cap.triggerable };
  const thematic = c.duty === 'foreground' || c.duty === 'answer';
  if (c.role === 'violins1' && c.duty === 'foreground') {
    const phrase = source.phrases[c.phrase];
    const material: PhraseNote[] = notes.map((n) => {
      const original = phrase.notes.find((p) => p.tick === n.tick)!;
      return { ...original, ...n };
    });
    return writeVoice({ ...common, octave: 0, phrases: [{ ...phrase, notes: material }] }).notes.map((w) => w.note);
  }
  if (c.role === 'violins1' || c.role === 'violins2') return writeCompanionVoice({ ...common,
    notes: notes.map((n) => ({ ...n, span: c.index, relationship: thematic ? 'response' : 'support' })),
  }).map((w) => w.note);
  if (c.role === 'violas') return writeViolaVoice({ ...common,
    notes: notes.map((n) => ({ ...n, span: c.index, cell: null, role: thematic ? 'reply' : 'inner-line' })),
  }).map((w) => w.note);
  if (c.role === 'cellosBasses') return writeCelloVoice({ ...common,
    notes: notes.map((n, i) => ({ ...n, span: c.index, cell: null, role: thematic ? 'theme' : c.duty === 'motion' ? 'bass-line' : 'foundation', themeIndex: thematic ? i : null,
      isFloor: !source.orchestrationPlan!.contributions.some((other) => other.role === 'basses' && other.startTick < n.tick + n.duration && other.endTick > n.tick) })),
  }).map((w) => w.note);
  return writeDoubleBassVoice({ ...common,
    notes: notes.map((n, i) => ({ tick: n.tick, duration: n.duration, pitch: pitchAtOctave0(frame, n), span: c.index, role: thematic ? 'response' : c.duty === 'motion' ? 'moving' : 'foundation',
      function: n.function === 'chord-tone' ? 'chord-tone' : n.function === 'appoggiatura' ? 'appoggiatura' : 'passing', breathAfter: n.breathAfter, cell: null, themeIndex: thematic ? i : null })),
  }).map((w) => w.note);
}

export function realizeOrchestration(input: StringsV1VoiceInput, source: StringsV1Composition): EnsembleRealization {
  const plan = source.orchestrationPlan ?? null;
  // The split may have materialized a bass desk not present in the input
  // project. Expression needs the completed roster, not a fabricated range.
  const project = input.orchestrationTracks ? { ...input.project, tracks: [...input.orchestrationTracks, ...input.project.tracks.filter((t) => !input.orchestrationTracks!.some((s) => s.id === t.id))] } : input.project;
  const frame: TonalFrame | null = source.frame ? { ...source.frame, harmony: input.understanding.harmony } : null;
  const grid: Record<string, Note[]> = {}, reviews: ContributionReview[] = [];
  const fallback = (reason: string): EnsembleRealization => ({ version: 'ensemble-v1', accepted: false, reason, plan, gridByTrackId: grid, notesByTrackId: {}, ccByTrackId: {}, contributions: reviews,
    desks: DESKS.map((role) => {
      const track = (input.orchestrationTracks ?? input.voiceTracks).find((t) => t.role === role && !t.locked && (input.voiceTracks.some((v) => v.id === t.id) || role === 'basses'));
      const notes = track?.notes ?? [], ticks = occupiedTicks(notes);
      return { role, trackId: track?.id ?? null, state: track ? 'classic-fallback' : 'unavailable', plannedContributions: plan?.contributions.filter((c) => c.role === role).length ?? 0, fulfilledContributions: 0,
        notes: notes.length, ticks, occupancy: ticks / Math.max(1, projectEndTick(input.project)), phraseCoverage: 0, independentOnsets: 0, range: range(notes) };
    }), exportValidation: 'not-serialized-here' });
  if (!plan || !frame || !source.theme) return fallback(source.reason ?? 'no coordinated thematic source');
  for (const cap of plan.capabilities) grid[cap.trackId] = [];
  // Foreground owns its space; then the floor; then the middle. The planned
  // registers can put a supporting violin ABOVE a cello/viola foreground.
  const priority = (c: Contribution) => c.duty === 'foreground' ? 0 : c.duty === 'answer' ? 1 : c.duty === 'foundation' || c.duty === 'motion' ? 2 : 3;
  const ordered = [...plan.contributions].sort((a, b) => priority(a) - priority(b) || a.startTick - b.startTick || a.index - b.index);
  for (const c of ordered) {
    const cap = plan.capabilities.find((x) => x.role === c.role)!;
    const repairs: string[] = [];
    let material: MaterialNote[] = [], octave: number | null = null;
    const others = Object.entries(grid).filter(([id]) => id !== cap.trackId).flatMap(([, notes]) => notes);
    let failure = '';
    if (c.duty === 'foreground' || c.duty === 'answer') {
      let line: readonly LineNote[] = source.phrases[c.phrase].notes.filter((n) => n.tick >= c.startTick && n.tick + n.duration <= c.endTick);
      if (c.duty === 'answer') {
        const head = source.theme.notes.slice(0, source.theme.headCount);
        const factor = c.role === 'basses' ? 2 : 1;
        const fragment = head.filter((n) => (n.tick - head[0].tick + n.duration) * factor <= c.endTick - c.startTick).map((n) => ({ ...n, tick: (n.tick - head[0].tick) * factor, duration: n.duration * factor }));
        if (fragment.length >= 2) {
          const adapted = adaptMaterial({ frame, material: fragment, headCount: fragment.length, leapIndex: -1, homeTick: source.theme.home.startTick, targetTick: c.startTick, shifts: [0, -1, 1, -2, 2, -3, 3], before: [], after: [], finalStable: true });
          if (adapted.ok) { line = adapted.notes; repairs.push(`answer ${adapted.strategy}; ${fragment.length}/${head.length} head notes, duration factor ${factor}`); }
          else failure = `answer rejected by harmonic adaptation: ${adapted.reasons.join('; ')}`;
        } else failure = 'breath too short for two unsqueezed head notes';
      }
      const judged = judgeLine(frame, line, { finalStable: true });
      if (!line.length || !judged.ok) failure ||= `thematic line rejected: ${judged.problems.map((p) => p.text).join('; ') || 'empty'}`;
      if (!failure) {
        const candidates: { octave: number; cost: number }[] = [];
        for (let oct = -4; oct <= 3; oct++) {
          const pitches = line.map((n) => ({ pitch: pitchAtOctave0(frame, n) + 12 * oct, duration: n.duration }));
          if (pitches.some((n) => n.pitch < cap.range[0] || n.pitch > cap.range[1])) continue;
          const outside = pitches.reduce((s, n) => s + (n.pitch < c.tessitura[0] || n.pitch > c.tessitura[1] ? n.duration : 0), 0) / pitches.reduce((s, n) => s + n.duration, 0);
          const collision = line.reduce((s, n, i) => s + (crowded(pitches[i].pitch, n.tick, n.tick + n.duration, others) ? n.duration : 0), 0) / pitches.reduce((s, n) => s + n.duration, 0);
          candidates.push({ octave: oct, cost: outside * 8 + Math.abs(meanPitch(pitches) - c.target) + collision * 24 });
        }
        candidates.sort((a, b) => a.cost - b.cost || a.octave - b.octave);
        if (!candidates.length) failure = 'no whole-gesture octave fits physical/capability limits; never fold individual thematic notes';
        else {
          octave = candidates[0].octave;
          material = line.map((n, i) => ({ ...n, step: n.step + 7 * octave!, function: judged.functions[i], breathAfter: i === line.length - 1 || !!source.phrases[c.phrase].notes.find((p) => p.tick === n.tick)?.breathAfter }));
          if (material.some((n) => { const p = pitchAtOctave0(frame, n); return p < c.tessitura[0] || p > c.tessitura[1]; })) repairs.push('preferred tessitura broadened to physical window to keep the complete thematic gesture');
        }
      }
    } else {
      // Support is split at EVERY harmony boundary; nothing is held through
      // an incompatible borrowed/chromatic chord. Motion uses chord tones,
      // with contrary/oblique preference against the subject's last move.
      let previous: number | null = null;
      const boundaries = [...new Set([c.startTick, c.endTick, ...frame.harmony.chords.flatMap((h) => [h.fact.startTick, h.fact.endTick]).filter((t) => t > c.startTick && t < c.endTick),
        ...Array.from({ length: Math.ceil((c.endTick - c.startTick) / frame.barTicks) }, (_, i) => Math.ceil(c.startTick / frame.barTicks) * frame.barTicks + i * frame.barTicks).filter((t) => t > c.startTick && t < c.endTick)])].sort((a, b) => a - b);
      for (let j = 0; j < boundaries.length - 1; j++) {
        const a = boundaries[j], b = boundaries[j + 1], chord = chordAt(frame, a);
        if (!chord || b - a < frame.beatTicks / 2) { repairs.push(`no supported harmony/room at ${a}; left silent`); continue; }
        const motion = c.duty === 'motion' && b - a >= 3 * frame.beatTicks;
        const times = motion ? [a, b - frame.beatTicks, b] : [a, b];
        for (let k = 0; k < times.length - 1; k++) {
          const from = times[k], to = times[k + 1];
          const preferredPc = c.duty === 'foundation' || c.duty === 'motion' && k === 0 ? chord.fact.bassPc : null;
          const candidates: { pitch: number; cost: number }[] = [];
          for (let pitch = cap.range[0]; pitch <= cap.range[1]; pitch++) {
            if (!chord.fact.pitchClasses.includes(pitch % 12) || crowded(pitch, from, to, others)) continue;
            const outside = pitch < c.tessitura[0] || pitch > c.tessitura[1];
            const melody = source.phrases[c.phrase].notes.filter((n) => n.tick <= from).slice(-2);
            const direction = melody.length > 1 ? Math.sign(melody[1].step - melody[0].step) : 0;
            const sameMotion = previous !== null && direction !== 0 && Math.sign(pitch - previous) === direction;
            candidates.push({ pitch, cost: Math.abs(pitch - c.target) + (previous === null ? 0 : Math.abs(pitch - previous) * 0.65) + (outside ? 8 : 0) + (preferredPc !== null && pitch % 12 !== preferredPc ? 12 : 0) + (sameMotion ? 2 : 0) });
          }
          candidates.sort((a, b) => a.cost - b.cost || a.pitch - b.pitch);
          if (!candidates.length) { repairs.push(`no spaced chord tone at ${from}; rejected this event instead of forcing a clash`); continue; }
          const pitch = candidates[0].pitch;
          const spelled = spell(frame, pitch);
          // A chord tone outside the mode is legal here precisely because the
          // CURRENT chord requests it, never because mode restrictions relaxed.
          if (!localScale(frame, chord).has(pitch % 12)) throw new Error('orchestration spelling violated local harmony');
          material.push({ ...spelled, tick: from, duration: to - from, function: 'chord-tone', breathAfter: to === c.endTick });
          previous = pitch;
        }
      }
    }
    let written = failure ? [] : expressive(input, source, frame, c, material);
    if (written.some((n) => !cap.triggerable.includes(n.articulation ?? '') || n.pitch < cap.range[0] || n.pitch > cap.range[1] || n.startTick < c.startTick || n.startTick + n.durationTicks > c.endTick || n.durationTicks <= 0)) {
      failure = 'expressive writer exceeded planned window, physical range or triggerable articulation'; written = [];
    }
    const ticks = occupiedTicks(written), expected = c.endTick - c.startTick;
    const coverage = ticks / expected;
    const minimum = c.duty === 'answer' ? 0.2 : c.duty === 'foreground' ? 0.55 : 0.35;
    const status = !written.length || coverage < minimum ? 'rejected' : coverage < 0.7 || written.length <= 2 ? 'sparse' : 'fulfilled';
    if (status === 'rejected') written = [];
    grid[cap.trackId].push(...written);
    reviews.push({ contribution: c.index, status, plannedTicks: expected, generatedNotes: written.length, generatedTicks: occupiedTicks(written), coverage: status === 'rejected' ? 0 : coverage, realizedNotes: 0, realizedTicks: 0, realizedCoverage: 0, range: range(written), octave, repairs,
      reason: failure || (status === 'rejected' ? `role coverage ${coverage.toFixed(3)} below ${minimum}` : status === 'sparse' ? 'bounded/sustained role met its minimum, but explicitly sparse' : 'role-relative duration and note material realized') });
  }
  if (!plan.contributions.some((c) => c.duty === 'foreground') || plan.contributions.some((c) => c.duty === 'foreground' && reviews.find((r) => r.contribution === c.index)?.status === 'rejected'))
    return fallback('a planned foreground failed: atomic classic ensemble fallback, not V2 orchestration success');
  for (const id of Object.keys(grid)) grid[id].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
  const humanized = humanizeStrings({ project, template: input.template, sections: input.sections, notesByTrackId: grid,
    otherNotes: input.orchestrationOtherNotes?.map((t) => ({ role: t.role, notes: t.notes.map((n) => ({ ...n })) })) });
  const expressed = overlapLegato({ project, sections: input.sections, notesByTrackId: humanized });
  // Expression may overlap a join, but may not create an unplanned entrance,
  // fill a planned silence, or cross a contribution/harmony boundary.
  const final: Record<string, Note[]> = {};
  for (const cap of plan.capabilities) final[cap.trackId] = (expressed[cap.trackId] ?? []).map((n) => {
    const contribution = plan.contributions.find((c) => c.role === cap.role && n.startTick >= c.startTick && n.startTick < c.endTick);
    const chord = chordAt(frame, n.startTick);
    const end = Math.min(n.startTick + n.durationTicks, contribution?.endTick ?? n.startTick, contribution && ['foundation', 'support', 'motion'].includes(contribution.duty) ? chord?.fact.endTick ?? Infinity : Infinity);
    return { ...n, durationTicks: Math.max(0, end - n.startTick) };
  }).filter((n) => n.durationTicks > 0);
  const endTick = projectEndTick(input.project);
  if (Object.entries(final).some(([id, notes]) => notes.some((n) => !Number.isFinite(n.pitch + n.startTick + n.durationTicks) || n.startTick < 0 || n.startTick + n.durationTicks > endTick) || occupiedTicks(notes) < occupiedTicks(grid[id]) * 0.8))
    return fallback('post-expression duration/bounds gate failed; classic ensemble retained');
  const realizedReviews = reviews.map((r) => {
    const c = plan.contributions.find((c) => c.index === r.contribution)!;
    const id = plan.capabilities.find((cap) => cap.role === c.role)!.trackId;
    const ns = final[id].filter((n) => n.startTick >= c.startTick && n.startTick < c.endTick);
    const ticks = occupiedTicks(ns, c.startTick, c.endTick);
    return { ...r, realizedNotes: ns.length, realizedTicks: ticks, realizedCoverage: ticks / r.plannedTicks };
  });
  if (plan.contributions.some((c) => c.duty === 'foreground' && realizedReviews.find((r) => r.contribution === c.index)!.realizedCoverage < 0.55))
    return fallback('post-expression foreground coverage gate failed; classic ensemble retained');
  const carrierByBar = input.arc.map((a) => {
    const c = plan.contributions.find((c) => c.duty === 'foreground' && c.startTick < a.endTick && c.endTick > a.startTick);
    return c ? plan.capabilities.find((x) => x.role === c.role)!.trackId : null;
  });
  const cc = buildCcLanes({ project, template: input.template, sections: input.sections, arc: input.arc, notesByTrackId: final, carrierByBar });
  const desks: DeskReview[] = DESKS.map((role) => {
    const cap = plan.capabilities.find((c) => c.role === role), planned = plan.contributions.filter((c) => c.role === role);
    const rs = reviews.filter((r) => planned.some((c) => c.index === r.contribution));
    const notes = cap ? final[cap.trackId] ?? [] : [], ticks = occupiedTicks(notes);
    const plannedPhrases = new Set(planned.map((c) => c.phrase)), realizedPhrases = new Set(planned.filter((c) => reviews.find((r) => r.contribution === c.index)?.status !== 'rejected').map((c) => c.phrase));
    const others = Object.entries(final).filter(([id]) => id !== cap?.trackId).flatMap(([, ns]) => ns);
    return { role, trackId: cap?.trackId ?? null,
      state: !cap ? 'unavailable' : !planned.length ? 'intentional-silence' : !notes.length ? 'rejected-silent' : rs.some((r) => r.status === 'rejected') ? 'partial' : notes.length <= 2 || ticks / endTick < 0.1 ? 'intentional-sparse' : 'substantial',
      plannedContributions: planned.length, fulfilledContributions: rs.filter((r) => r.status !== 'rejected').length,
      notes: notes.length, ticks, occupancy: ticks / Math.max(1, endTick), phraseCoverage: realizedPhrases.size / Math.max(1, plannedPhrases.size),
      independentOnsets: notes.filter((n) => !others.some((o) => Math.abs(o.startTick - n.startTick) < frame.beatTicks / 16 && o.pitch === n.pitch)).length / Math.max(1, notes.length), range: range(notes) };
  });
  return { version: 'ensemble-v1', accepted: true, reason: 'foreground accepted; supporting rejections/sparsity remain explicit, not relabelled as full realization', plan, gridByTrackId: grid, notesByTrackId: final, ccByTrackId: cc, contributions: realizedReviews.sort((a, b) => a.contribution - b.contribution), desks, exportValidation: 'not-serialized-here' };
}
