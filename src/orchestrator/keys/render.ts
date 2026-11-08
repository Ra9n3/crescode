/**
 * Keys renderer (Phase 11.6c). The harp retains its Phase 11.5 bed, roots,
 * glissandos and closing descent. The piano keeps a held two-hand anchor,
 * then renders planned arrivals, punctuation, power and RH figures. Tutti
 * remains a low root; the closing bar may carry a rolled RH arrival. Role tags
 * are copied onto each piano event, and collisions are repaired musically.
 *
 * The piano concurrency cap runs on written and jittered schedules. Held
 * body's lowest LH note is protected; other voices may yield at a new onset.
 * The golden105 piano-role beat map preserves harp's historical velocity
 * bounds; compose absorbs new piano energy, while the final safety pass keeps
 * the known vocalbacking-only harp velocity residual.
 */
import { chordTones } from '../voicing/chordTones';
import { scalePitchClasses } from '../../shared/schema/modes';
import { PPQ, isInstrumentTrack, type Note, type NoteRoleTag, type Project, type Track } from '../../shared/schema/types';
import { barTicks, beatOffsets, beatTicks, projectBars } from '../../shared/schema/meter';
import { hashString, sanitizeNotes } from '../../engine/generate';
import { msToTicks } from '../spine';
import { humanizeHeadTicks } from '../expression/timing';
import { maxMeanVelocityFor } from '../energy';
import { momentForBar } from '../conductor/moments';
import { inVocalZone } from '../profiles/strings';
import { cellGrid } from '../lines/ostinato';
import type { OrchestratorContext } from '../module';
import {
  HARP_FIGURE_UNIT_BARS, KEYS_GATES, KEYS_PARTS, KEYS_PROFILES, PIANO_ARRIVAL_PHRASE_BARS, PIANO_CONCURRENCY,
  PIANO_HAND_GAP, PIANO_LH, PIANO_PUNCTUATION_SHARE, PIANO_RH, PIANO_UP_MAX_SHARE, VB_LOW, VB_RH, VB_SPARKLE_BODY, VB_SPARKLE_PEAK,
  isChorusTypeK, keysRosterOf, type HarpFigure, type KeysPart,
} from './profile';
import type { KeysBarPlan, KeysPlan, PianoAnswerPlan } from './plan';

/** Ordinary keys shaping ceiling and the existing chorus relief level. */
export const KEYS_VELOCITY_CEILING = 84;
export const RELIEF_VELOCITY = 92;

interface KeysCandidate {
  pitch: number;
  startTick: number;
  durationTicks: number;
  articulation?: Note['articulation'];
  moment?: boolean;
  ramp?: number;
  layer?: Note['layer'];
  relief?: boolean;
  soft?: boolean;
  velScale?: number;
  roleTag?: NoteRoleTag;
  hand?: 'lh' | 'rh';
  /** The held anchor's lowest LH body voice is never shortened for collision repair. */
  heldBodyLowest?: boolean;
  /** Chord-tone/octave alternatives used before releasing a colliding event. */
  collisionAlternatives?: number[];
  /** Punctuation may yield to an exact-pitch harp overlap. */
  yieldToHarp?: boolean;
  bar?: number;
  punctuationReason?: string;
  /** RH seventh alternatives must remain above the current root voice. */
  rootPc?: number;
  seventhPc?: number;
  rootPitch?: number;
  /** True when this new piano event has no golden105 role-presence window. */
  absorb?: boolean;
  /** All notes of one held piano strike share an id. */
  strikeId?: string;
  /** Cascade notes may sustain across bars to their harmonic-span end. */
  holdToSpan?: boolean;
  v?: number;
  drop?: boolean;
}

const pcOf = (p: number): number => ((p % 12) + 12) % 12;

export interface KeysRenderInput {
  ctx: OrchestratorContext;
  plan: KeysPlan;
  /** The strings module's notes by track id (window math). */
  stringsNotes: Record<string, Note[]>;
  /** The rendered brass notes by track id (window math). */
  brassNotes: Record<string, Note[]>;
  /** The rendered wind notes by track id (window math). */
  windNotes: Record<string, Note[]>;
  /** The rendered percussion notes by track id (window math). */
  percNotes: Record<string, Note[]>;
  /** The rules generator's notes for roles no module owns. */
  ruleNotes: { role: string; notes: Note[] }[];
}

export interface PianoOctaveRepairCandidate {
  pitch: number;
  startTick: number;
  durationTicks: number;
  alternatives: number[];
  roleTag: NoteRoleTag;
  hand?: 'lh' | 'rh';
  heldBodyLowest?: boolean;
}

export interface KeysRenderResult {
  notesByTrackId: Record<string, Note[]>;
  reports: string[];
  /** Aligned with the piano note list; used after final string humanization. */
  pianoOctaveRepairCandidates: PianoOctaveRepairCandidate[];
  /** Beat windows containing piano notes; compose caps those notes alone. */
  absorbWindows: { start: number; end: number }[];
}

/**
 * Enforce total and register-band polyphony without chopping one voice out
 * of a held chord. On pressure, shorten an earlier strike group as a unit;
 * if the incoming strike cannot fit by itself, drop that whole group.
 */
function enforcePianoConcurrency(candidates: KeysCandidate[]): number {
  const keyOf = (c: KeysCandidate) => c.strikeId ?? `single:${c.startTick}:${c.pitch}`;
  const byKey = new Map<string, KeysCandidate[]>();
  for (const c of candidates) {
    const key = keyOf(c);
    const group = byKey.get(key) ?? [];
    group.push(c);
    byKey.set(key, group);
  }
  const droppedGroups = new Set<string>();
  const cutoffByGroup = new Map<string, number>();
  const live: KeysCandidate[] = [];
  const onsets = [...new Set(candidates.filter((c) => !c.drop).map((c) => c.startTick))].sort((a, b) => a - b);
  let droppedCount = 0;

  const trimGroup = (key: string, at: number) => {
    cutoffByGroup.set(key, Math.min(cutoffByGroup.get(key) ?? Number.MAX_SAFE_INTEGER, at));
    for (const c of byKey.get(key) ?? []) {
      if (c.startTick >= at) {
        if (!c.drop) { c.drop = true; droppedCount++; }
      } else if (c.startTick + c.durationTicks > at) {
        c.durationTicks = at - c.startTick;
      }
    }
    if ((byKey.get(key) ?? []).every((c) => c.drop)) droppedGroups.add(key);
  };

  for (const tick of onsets) {
    for (let i = live.length - 1; i >= 0; i--) {
      if (live[i].drop || live[i].startTick + live[i].durationTicks <= tick) live.splice(i, 1);
    }
    const starting = candidates.filter((c) => !c.drop && c.startTick === tick).sort((a, b) => a.pitch - b.pitch);
    for (const c of starting) {
      const key = keyOf(c);
      if (droppedGroups.has(key) || c.drop || (cutoffByGroup.has(key) && c.startTick >= cutoffByGroup.get(key)!)) {
        if (!c.drop) { c.drop = true; droppedCount++; }
        droppedGroups.add(key);
        continue;
      }
      let guard = 0;
      while (guard++ < 32) {
        const low = live.filter((x) => x.pitch < 55).length;
        const high = live.length - low;
        const exceeds = live.length + 1 > PIANO_CONCURRENCY.total
          || (c.pitch < 55 ? low + 1 > PIANO_CONCURRENCY.below55 : high + 1 > PIANO_CONCURRENCY.at55);
        if (!exceeds) break;
        const activeGroups = [...new Set(live.map(keyOf))];
        if (!activeGroups.length) {
          trimGroup(key, tick);
          break;
        }
        // Prefer releasing an older strike; if the incoming strike already
        // began under jitter, cut it as a whole rather than one chord voice.
        const protectsHeldBody = (candidateKey: string) => (byKey.get(candidateKey) ?? []).some((note) => note.heldBodyLowest);
        const victim = activeGroups
          .filter((candidateKey) => candidateKey !== key && !protectsHeldBody(candidateKey))
          .sort((a, b) => Math.min(...(byKey.get(a) ?? []).map((n) => n.startTick)) - Math.min(...(byKey.get(b) ?? []).map((n) => n.startTick)))[0]
          ?? (activeGroups.includes(key) && !protectsHeldBody(key) ? key : undefined);
        if (!victim) {
          // The lowest voice of an already-held body may never be truncated.
          // When every live group is protected, omit the incoming note instead.
          if (protectsHeldBody(key)) { c.drop = true; droppedCount++; }
          else trimGroup(key, tick);
          break;
        }
        trimGroup(victim, tick);
        for (let i = live.length - 1; i >= 0; i--) {
          if (live[i].drop || live[i].startTick + live[i].durationTicks <= tick) live.splice(i, 1);
        }
      }
      if (!c.drop && !droppedGroups.has(key)) live.push(c);
    }
  }
  return droppedCount;
}

function pianoStrikeId(c: KeysCandidate): string {
  return c.strikeId ?? `piano:${c.startTick}:${c.pitch}`;
}

function capPianoPunctuation(candidates: KeysCandidate[], shareLimit: number): { baseStrikes: number; punctuationStrikes: number; dropped: number } {
  const active = candidates.filter((c) => !c.drop);
  const baseIds = new Set(active.filter((c) => c.roleTag !== 'punctuation' && c.roleTag !== 'flourish').map(pianoStrikeId));
  const groups = new Map<string, KeysCandidate[]>();
  for (const c of active) {
    if (c.roleTag !== 'punctuation') continue;
    const id = pianoStrikeId(c);
    groups.set(id, [...(groups.get(id) ?? []), c]);
  }
  const priority = (c: KeysCandidate): number => c.punctuationReason === 'cadence' ? 4
    : c.punctuationReason === 'preChorus' ? 3
      : c.punctuationReason === 'phraseEnd' ? 2 : 1;
  const ordered = [...groups.entries()].sort((a, b) => {
    const p = Math.max(...b[1].map(priority)) - Math.max(...a[1].map(priority));
    return p || Math.min(...a[1].map((c) => c.bar ?? 0)) - Math.min(...b[1].map((c) => c.bar ?? 0));
  });
  const maxPunctuation = Math.floor(baseIds.size * shareLimit / Math.max(1e-9, 1 - shareLimit) + 1e-9);
  let dropped = 0;
  for (const [, group] of ordered.slice(maxPunctuation)) {
    for (const c of group) { c.drop = true; dropped++; }
  }
  return { baseStrikes: baseIds.size, punctuationStrikes: Math.min(groups.size, maxPunctuation), dropped };
}

function intervalsOverlap(a: Pick<KeysCandidate, 'startTick' | 'durationTicks'>, b: Pick<KeysCandidate, 'startTick' | 'durationTicks'>): boolean {
  return a.startTick < b.startTick + b.durationTicks && b.startTick < a.startTick + a.durationTicks;
}

function samePitchOverlapPairs(candidates: KeysCandidate[]): number {
  let pairs = 0;
  for (let i = 0; i < candidates.length; i++) {
    const a = candidates[i];
    for (let j = i + 1; j < candidates.length; j++) {
      const b = candidates[j];
      if (a.pitch === b.pitch && intervalsOverlap(a, b)) pairs++;
    }
  }
  return pairs;
}

interface PianoCollisionAudit { shifted: number; shortened: number; dropped: number; harpYields: string[]; remainingSamePitchPairs: number }
function repairPianoOverlaps(
  candidates: KeysCandidate[],
  harpNotes: Note[],
  lo: number,
  hi: number,
  otherNotes: Note[] = [],
  forbidOctaveDoubling = false,
  ctx?: OrchestratorContext,
  btBar = 0,
): PianoCollisionAudit {
  const heldPriority = (c: KeysCandidate): number => c.heldBodyLowest ? 0 : c.roleTag === 'anchor' ? 1 : 2;
  const ordered = candidates.filter((c) => !c.drop).sort((a, b) =>
    a.startTick - b.startTick || heldPriority(a) - heldPriority(b) || a.pitch - b.pitch);
  const accepted: KeysCandidate[] = [];
  const failedGroups = new Set<string>();
  const harpYields: string[] = [];
  let shifted = 0, shortened = 0, dropped = 0;
  const needsWholeChord = (c: KeysCandidate) => c.roleTag === 'arrival' || c.roleTag === 'punctuation' || c.roleTag === 'shift';
  const isMotionOverlay = (c: KeysCandidate) => c.hand === 'rh'
    && ['lift', 'settle', 'bed', 'atmosphere', 'answer', 'flourish'].includes(c.roleTag ?? '');
  const isLowPriorityForOctaves = (c: KeysCandidate) => isMotionOverlay(c) || c.roleTag === 'power';
  const octaveInterval = (a: number, b: number) => Math.abs(a - b) > 0 && Math.abs(a - b) % 12 === 0;
  const harpCollisionAt = (c: KeysCandidate, pitch: number) => c.yieldToHarp === true && harpNotes.some((h) =>
    h.pitch === pitch && intervalsOverlap(c, { startTick: h.startTick, durationTicks: h.durationTicks }));
  const forbiddenOctaveIsHard = (c: KeysCandidate, pitch: number, other: KeysCandidate | Note, sameTrack: boolean): boolean => {
    if (!ctx) return true;
    const tick = Math.max(c.startTick, other.startTick);
    const chordAt = (at: number) => ctx.spans.find((span) => span.startTick <= at && at < span.endTick);
    const forcedAt = (at: number): boolean => {
      const span = chordAt(at);
      if (!span) return false;
      const tonePcs = chordTones(span.parsed).tones.map((tone) => pcOf(tone.pc));
      if (!tonePcs.includes(pcOf(pitch))) return false;
      const head = humanizeHeadTicks(ctx.project.tempoMap, at);
      const pianoAt = [
        ...accepted.filter((candidate) => candidate !== c && !candidate.drop).map((candidate) => ({
          pitch: candidate.pitch,
          startTick: candidate.startTick,
          durationTicks: candidate.durationTicks,
        })),
        { pitch, startTick: c.startTick, durationTicks: c.durationTicks },
      ];
      const sounding = [...otherNotes, ...pianoAt].filter((note) =>
        note.startTick <= at + head && note.startTick + note.durationTicks > at).length;
      return sounding > tonePcs.length;
    };
    const head = humanizeHeadTicks(ctx.project.tempoMap, tick);
    if (forcedAt(tick) || forcedAt(tick - head)) return false;
    if (!sameTrack && btBar > 0) {
      const shortDuration = Math.min(c.durationTicks, other.durationTicks);
      const longDuration = Math.max(c.durationTicks, other.durationTicks);
      if (shortDuration <= btBar / 2 && longDuration > shortDuration) {
        const shortPitch = c.durationTicks <= other.durationTicks ? pitch : other.pitch;
        const span = chordAt(tick);
        if (span && chordTones(span.parsed).tones.some((tone) => pcOf(tone.pc) === pcOf(shortPitch))) return false;
      }
    }
    return true;
  };
  const pianoConflictsAt = (c: KeysCandidate, pitch: number): boolean => {
    const conflictsWithAccepted = accepted.some((other) => {
      if (!intervalsOverlap(c, other)) return false;
      const interval = Math.abs(other.pitch - pitch);
      if (interval === 0) return true;
      if (c.hand === 'rh' && other.hand === 'rh' && [11, 13].includes(interval)) return true;
      return forbidOctaveDoubling && (isLowPriorityForOctaves(c) || isLowPriorityForOctaves(other))
        && octaveInterval(pitch, other.pitch) && forbiddenOctaveIsHard(c, pitch, other, true);
    });
    return conflictsWithAccepted;
  };

  for (const c of ordered) {
    const id = pianoStrikeId(c);
    if (failedGroups.has(id)) { c.drop = true; dropped++; continue; }
    if (forbidOctaveDoubling && !isLowPriorityForOctaves(c)) {
      const displaced = accepted.filter((other) => isLowPriorityForOctaves(other)
        && octaveInterval(c.pitch, other.pitch) && intervalsOverlap(c, other)
        && forbiddenOctaveIsHard(c, c.pitch, other, true));
      for (const other of displaced) {
        if (other.startTick < c.startTick) {
          other.durationTicks = c.startTick - other.startTick;
          shortened++;
        } else {
          other.drop = true;
          const at = accepted.indexOf(other);
          if (at >= 0) accepted.splice(at, 1);
          dropped++;
        }
      }
    }
    const original = c.pitch;
    const harpAtOriginal = harpCollisionAt(c, original);
    const choices = [...new Set([original, ...(c.collisionAlternatives ?? [])])]
      .filter((pitch) => pitch >= lo && pitch <= hi);
    let selected: number | undefined;
    for (const pitch of choices) {
      if (c.seventhPc !== undefined && c.rootPc !== undefined && pcOf(pitch) === c.seventhPc) {
        const activeRoot = accepted.find((other) => other.strikeId === c.strikeId && pcOf(other.pitch) === c.rootPc)?.pitch;
        const rootPitch = activeRoot ?? c.rootPitch;
        if (rootPitch !== undefined && pitch <= rootPitch) continue;
      }
      if (c.yieldToHarp && harpCollisionAt(c, pitch)) continue;
      if (!pianoConflictsAt(c, pitch)) { selected = pitch; break; }
    }

    if (selected !== undefined) {
      c.pitch = selected;
      if (selected !== original) shifted++;
      if (harpAtOriginal && c.yieldToHarp) harpYields.push(`b${c.bar ?? '?'}:${original}->${selected}`);
      accepted.push(c);
      continue;
    }

    if (harpAtOriginal && c.yieldToHarp) {
      c.drop = true;
      if (needsWholeChord(c)) failedGroups.add(id);
      dropped++;
      harpYields.push(`b${c.bar ?? '?'}:${original}->dropped`);
      continue;
    }

    const samePitchConflicts = accepted.filter((other) => other.pitch === original && intervalsOverlap(c, other));
    if (samePitchConflicts.some((other) => other.heldBodyLowest)) {
      c.drop = true;
      if (needsWholeChord(c)) failedGroups.add(id);
      dropped++;
      continue;
    }
    for (const earlier of samePitchConflicts) {
      const remaining = c.startTick - earlier.startTick;
      if (remaining <= 0) {
        earlier.drop = true;
        const at = accepted.indexOf(earlier);
        if (at >= 0) accepted.splice(at, 1);
      } else {
        earlier.durationTicks = remaining;
      }
      shortened++;
    }
    if (pianoConflictsAt(c, original)) {
      c.drop = true;
      if (needsWholeChord(c)) failedGroups.add(id);
      dropped++;
    } else {
      accepted.push(c);
    }
  }

  for (const c of candidates) {
    if (failedGroups.has(pianoStrikeId(c)) && !c.drop) { c.drop = true; dropped++; }
  }
  const final = candidates.filter((c) => !c.drop);
  if (forbidOctaveDoubling && ctx && final.length) {
    const hasHardOctave = (candidate: KeysCandidate, pitch: number): boolean => final.some((other) => other !== candidate && !other.drop
      && intervalsOverlap(candidate, other) && octaveInterval(pitch, other.pitch)
      && forbiddenOctaveIsHard(candidate, pitch, other, true));
    const hasPianoPitchCollision = (candidate: KeysCandidate, pitch: number): boolean => final.some((other) => {
      if (other === candidate || other.drop || !intervalsOverlap(candidate, other)) return false;
      const interval = Math.abs(pitch - other.pitch);
      return interval === 0 || (candidate.hand === 'rh' && other.hand === 'rh' && [11, 13].includes(interval));
    });
    const repairRank = (candidate: KeysCandidate): number => {
      if (candidate.heldBodyLowest) return 0;
      if (candidate.roleTag === 'anchor' && candidate.hand === 'lh') return 1;
      if (candidate.roleTag === 'anchor' && candidate.hand === 'rh') return 2;
      if (candidate.roleTag === 'arrival') return 3;
      if (candidate.roleTag === 'punctuation') return 4;
      if (candidate.roleTag === 'power') return 5;
      return 6;
    };
    // Resolve piano-internal hard octaves after overlap repair. Cross-track
    // checks run later in compose, after strings receive their final timing.
    for (let pass = 0; pass < final.length * 2; pass++) {
      const hardPairs: { a: KeysCandidate; b: KeysCandidate }[] = [];
      for (let i = 0; i < final.length; i++) {
        const a = final[i];
        for (let j = i + 1; j < final.length; j++) {
          const b = final[j];
          if (intervalsOverlap(a, b) && octaveInterval(a.pitch, b.pitch)
            && forbiddenOctaveIsHard(a, a.pitch, b, true)) hardPairs.push({ a, b });
        }
      }
      if (!hardPairs.length) break;
      let repaired = false;
      for (const pair of hardPairs) {
        const victims = [pair.a, pair.b].sort((a, b) => repairRank(b) - repairRank(a));
        for (const victim of victims) {
          const choices = [...new Set(victim.collisionAlternatives ?? [])]
            .filter((pitch) => pitch >= lo && pitch <= hi && pitch !== victim.pitch);
          const alternative = choices.find((pitch) => !hasPianoPitchCollision(victim, pitch) && !hasHardOctave(victim, pitch));
          if (alternative === undefined) continue;
          victim.pitch = alternative;
          shifted++;
          repaired = true;
          break;
        }
        if (repaired) break;
      }
      if (!repaired) break;
    }
  }
  return { shifted, shortened, dropped, harpYields, remainingSamePitchPairs: samePitchOverlapPairs(final) };
}

export function renderKeys(input: KeysRenderInput): KeysRenderResult {
  const { ctx, plan, stringsNotes, brassNotes, windNotes, percNotes, ruleNotes } = input;
  const { project, template } = ctx;
  const notesByTrackId: Record<string, Note[]> = {};
  const reports: string[] = [];
  let pianoOctaveRepairCandidates: PianoOctaveRepairCandidate[] = [];
  // every rostered keys track is CLAIMED up front (an empty list when the
  // part never sounds) — the generator's phantom keys notes must never
  // reach the final score through the assembly's generator fallback
  const roster = keysRosterOf(ctx);
  const trackOf = new Map<KeysPart, Track>();
  for (const part of roster) {
    const t = ctx.project.tracks.find((x) => x.role === part && x.family === 'Keys' && isInstrumentTrack(x) && !x.locked);
    if (t) {
      trackOf.set(part, t);
      notesByTrackId[t.id] = [];
    }
  }
  if (!template || !plan.bars.length || !ctx.spans.length) return { notesByTrackId, reports, pianoOctaveRepairCandidates, absorbWindows: [] };

  const btBar = barTicks(project.timeSignature);
  const beat = beatTicks(project.timeSignature);
  const eighth = PPQ / 2;
  const sixteenth = PPQ / 4;
  const bars = projectBars(project);
  const endTick = bars * btBar;
  const clampMax = template.budget.energyClamp[1];
  const N = template.roster.length;
  const scale = scalePitchClasses(project.key, project.mode);
  const scalePcs = new Set(scale.map((pc) => ((pc % 12) + 12) % 12));
  const zoneFree = template.id === 'ensemble.vocalbacking';
  const forbidOctaveDoubling = template.rules.some((rule) =>
    rule.type === 'octaveDoubling' && rule.params.policy === 'forbidden');
  const planByBar = new Map(plan.bars.map((b) => [b.bar, b]));
  const glissByBar = new Map<number, KeysPlan['glisses'][number]>();
  for (const g of plan.glisses) {
    const startBar = Math.floor(g.startTick / btBar) + 1;
    for (let b = startBar; b <= g.targetBar; b++) glissByBar.set(b, g);
  }

  const momentVelocity = (bar: number): number => {
    const E = Math.min(clampMax, Math.max(0, ctx.arc?.[bar - 1]?.target ?? 0));
    const capAll = maxMeanVelocityFor(N, clampMax, N);
    return Math.max(1, Math.min(capAll, Math.round(1 + (capAll - 1) * E)));
  };
  const spanAt = (tick: number) =>
    ctx.spans.find((sp) => sp.startTick <= tick && tick < sp.endTick) ?? ctx.spans[0];
  /** §16.5 (11.5) the harmonic span's end at a tick — the held notes'
   *  sustain target (the bar line caps it, at most 1 bar). */
  const spanEndOf = (tick: number): number => {
    const sp = spanAt(tick);
    return sp ? sp.endTick : Number.MAX_SAFE_INTEGER;
  };

  // the tacet starts (bar-aligned): damping boundaries — no keys note rings
  // across a near-silence bar or a soli moment (§16.6)
  const tacetStarts: number[] = [];
  for (let bar = 1; bar <= bars; bar++) {
    const m = momentForBar(ctx.moments, bar);
    const near = ctx.arc?.[bar - 1]?.nearSilence;
    if (m?.kind === 'soli' || near) tacetStarts.push((bar - 1) * btBar);
  }
  const dampingEnd = (start: number): number => {
    let end = endTick;
    for (const t of tacetStarts) {
      if (t > start && t < end) end = t;
    }
    return end;
  };

  /** The chord's tone pitch classes (any tier) at a tick. */
  const chordPcsAt = (tick: number): { pcs: Set<number>; rootPc: number } => {
    const sp = spanAt(tick);
    const ct = chordTones(sp.parsed);
    const rootTone = ct.tones.find((t) => t.tier === 'root');
    const rootPc = (((rootTone?.pc ?? ct.bassPc) % 12) + 12) % 12;
    const pcs = new Set<number>([...ct.tones.map((t) => ((t.pc % 12) + 12) % 12), rootPc]);
    return { pcs, rootPc };
  };

  /** The lowest pitch in [lo, hi] carrying the pitch class (null when the
   *  window is narrower than an octave and misses it). */
  const foldPc = (pc: number, lo: number, hi: number): number | null => {
    for (let p = Math.max(0, lo); p <= hi; p++) if (pcOf(p) === pc) return p;
    return null;
  };

  /** Harp vocal-zone displacement: move down by octaves first, then up;
   *  drop a note only if the track range cannot clear the zone. */
  const zoneShift = (pitch: number, lo: number, hi: number): number | null => {
    if (!zoneFree || !inVocalZone(pitch)) return pitch;
    let p = pitch;
    while (inVocalZone(p) && p - 12 >= lo) p -= 12;
    if (!inVocalZone(p)) return p;
    p = pitch;
    while (inVocalZone(p) && p + 12 <= hi) p += 12;
    return inVocalZone(p) ? null : p;
  };

  /* ---------------- held piano hand model ------------------------------- */
  const harpFiguresByStart = new Map<number, HarpFigure[]>(plan.harpFigures.map((e) => [e.startBar, e.figures]));
  const lhLo = zoneFree ? VB_LOW[0] : PIANO_LH[0];
  const lhHi = zoneFree ? VB_LOW[1] : PIANO_LH[1];
  const pianoTrack = trackOf.get('piano');
  const pianoLo = pianoTrack?.lowestNote ?? 21;
  const pianoHi = pianoTrack?.highestNote ?? 108;
  const take = project.orchestration?.take ?? 0;

  /** The strings-overlap rule (chamber, sonata): low viola/cello sound in
   *  the bar raises the RH floor to 72. */
  const stringsLowCache = new Map<number, boolean>();
  const stringsLowAt = (bar: number): boolean => {
    if (stringsLowCache.has(bar)) return stringsLowCache.get(bar)!;
    const start = (bar - 1) * btBar;
    const end = bar * btBar;
    // String humanization/legato runs after keys. Look back a sixteenth so
    // a low note whose pre-humanized release sits on the barline is still
    // treated as sounding when the final strings renderer lengthens it.
    const overlapLookback = PPQ / 4;
    let found = false;
    for (const [id, notes] of Object.entries(stringsNotes)) {
      const role = project.tracks.find((t) => t.id === id)?.role;
      if (role !== 'violas' && role !== 'cellosBasses') continue;
      if (notes.some((n) => n.startTick < end && n.startTick + n.durationTicks > start - overlapLookback && n.pitch <= 71)) {
        found = true;
        break;
      }
    }
    stringsLowCache.set(bar, found);
    return found;
  };

  /** Assign complete, one-bar answers only after the actual strings line is
   *  available. Full violins1-rest bars are conservative answer windows, so
   *  the later positive humanize/legato passes cannot create a lead overlap. */
  const assignPianoAnswers = (): void => {
    plan.bars.forEach((bar) => { delete bar.pianoAnswer; });
    plan.pianoRoleCounts.answer = 0;
    const activePianoBars = plan.pianoRoleCounts.anchor;
    const answerCap = Math.floor(activePianoBars * 0.15 + 1e-9);
    const answerEnabled = template.id === 'ensemble.chamber' || template.id === 'ensemble.sonata';
    const leadNotes = Object.entries(stringsNotes)
      .filter(([id]) => project.tracks.find((track) => track.id === id)?.role === 'violins1')
      .flatMap(([, notes]) => notes)
      .sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
    const makeAnswer = (bar: KeysBarPlan, section: typeof ctx.sections[number]): PianoAnswerPlan | null => {
      const windowStart = (bar.bar - 1) * btBar;
      const windowEnd = Math.min(endTick, bar.bar * btBar);
      if (leadNotes.some((note) => note.startTick < windowEnd && note.startTick + note.durationTicks > windowStart)) return null;
      const noteCount = Math.min(4, Math.floor((windowEnd - windowStart) / beat));
      if (noteCount < 3) return null;
      const floor = stringsLowAt(bar.bar) ? 72 : 64;
      const ceiling = Math.min(PIANO_RH[1], pianoHi, bar.pianoRarePeak ? 88 : 84);
      if (ceiling < floor) return null;
      const sectionStartTick = (section.startBar - 1) * btBar;
      const sectionEndTick = Math.min(endTick, (section.startBar + section.lengthBars - 1) * btBar);
      const sectionLead = leadNotes.filter((note) => note.startTick < sectionEndTick
        && note.startTick + note.durationTicks > sectionStartTick);
      const priorLead = sectionLead.filter((note) => note.startTick + note.durationTicks <= windowStart);

      if (priorLead.length) {
        const diatonic = priorLead.filter((note) => scalePcs.has(pcOf(note.pitch))).slice(-noteCount);
        if (diatonic.length !== noteCount) return null;
        const sourcePitches = diatonic.map((note) => note.pitch);
        const shifts = [12, 24, 0, 36, -12, 48, -24, 60, -36, -48];
        const sharedShift = shifts.find((shift) => sourcePitches.every((pitch) => pitch + shift >= floor && pitch + shift <= ceiling));
        let pitches: number[];
        if (sharedShift !== undefined) pitches = sourcePitches.map((pitch) => pitch + sharedShift);
        else {
          pitches = [];
          for (const source of sourcePitches) {
            const options: number[] = [];
            for (let shift = -60; shift <= 60; shift += 12) {
              const pitch = source + shift;
              if (pitch >= floor && pitch <= ceiling) options.push(pitch);
            }
            if (!options.length) return null;
            options.sort((a, b) => Math.abs(a - (source + 12)) - Math.abs(b - (source + 12)) || a - b);
            pitches.push(options[0]);
          }
        }
        return { kind: 'leadEcho', pitches, windowEndTick: windowEnd };
      }

      // There is no preceding lead phrase to quote in this section: use one
      // diatonic chord tone per beat, still as a single line (never a voicing).
      const pitches: number[] = [];
      for (let index = 0; index < noteCount; index++) {
        const onset = windowStart + index * beat;
        const chord = chordPcsAt(onset);
        const options: number[] = [];
        for (let pitch = floor; pitch <= ceiling; pitch++) {
          if (chord.pcs.has(pcOf(pitch)) && scalePcs.has(pcOf(pitch))) options.push(pitch);
        }
        if (!options.length) return null;
        const distinct = options.filter((pitch) => pitch !== pitches.at(-1));
        const choices = distinct.length ? distinct : options;
        pitches.push(choices[hashString(`piano-answer-fragment:${take}:${bar.bar}:${index}`) % choices.length]);
      }
      return { kind: 'chordToneFragment', pitches, windowEndTick: windowEnd };
    };

    type AnswerChoice = { bar: KeysBarPlan; section: typeof ctx.sections[number]; phrase: number; answer: PianoAnswerPlan };
    const byPhrase = new Map<string, AnswerChoice[]>();
    if (answerEnabled && pianoTrack && answerCap > 0) {
      for (const bar of plan.bars) {
        if (bar.pianoRole !== 'anchor' || bar.voices.piano !== 'anchor' || bar.pianoPower
          || bar.pianoRepeatedChord || bar.moment) continue;
        const section = ctx.sections.find((candidate) => bar.bar >= candidate.startBar && bar.bar < candidate.startBar + candidate.lengthBars);
        if (!section) continue;
        const phrase = Math.floor((bar.bar - section.startBar) / PIANO_ARRIVAL_PHRASE_BARS);
        const answer = makeAnswer(bar, section);
        if (!answer) continue;
        const key = `${section.id}:${phrase}`;
        byPhrase.set(key, [...(byPhrase.get(key) ?? []), { bar, section, phrase, answer }]);
      }
    }
    const phraseChoices = [...byPhrase.values()].map((choices) =>
      choices.sort((a, b) => b.bar.bar - a.bar.bar)[0]);
    phraseChoices.sort((a, b) => Number(isChorusTypeK(b.section.name)) - Number(isChorusTypeK(a.section.name))
      || hashString(`piano-answer:${take}:${a.section.id}:${a.phrase}`) - hashString(`piano-answer:${take}:${b.section.id}:${b.phrase}`));
    const selected = phraseChoices.slice(0, answerCap);
    for (const choice of selected) {
      if (choice.bar.pianoFigure === 'arpUp') plan.pianoMotionStats.upBars = Math.max(0, plan.pianoMotionStats.upBars - 1);
      delete choice.bar.pianoFigure;
      delete choice.bar.pianoFigureFamily;
      delete choice.bar.pianoFigureRole;
      delete choice.bar.pianoArrival;
      delete choice.bar.pianoPunctuation;
      choice.bar.pianoAnswer = choice.answer;
    }
    plan.pianoRoleCounts.answer = selected.length;

    const takeLabel = project.orchestration?.take ?? 0;
    const roles = `anchor=${plan.pianoRoleCounts.anchor}, answer=${plan.pianoRoleCounts.answer}`;
    const roleIndex = plan.reports.findIndex((line) => line.startsWith(`keys piano roles (take ${takeLabel}):`));
    if (roleIndex >= 0) plan.reports[roleIndex] = `keys piano roles (take ${takeLabel}): ${roles} planned bars`;
    const arrivalsIndex = plan.reports.findIndex((line) => line.startsWith(`keys piano arrivals (take ${takeLabel},`));
    if (arrivalsIndex >= 0) plan.reports[arrivalsIndex] = `keys piano arrivals (take ${takeLabel}, four-bar phrase grid): ${plan.bars.filter((bar) => bar.pianoArrival).map((bar) => `b${bar.bar}=${bar.pianoArrival}`).join(', ') || 'none'}`;
    const punctuationIndex = plan.reports.findIndex((line) => line.startsWith(`keys piano punctuation plan (take ${takeLabel},`));
    if (punctuationIndex >= 0) plan.reports[punctuationIndex] = `keys piano punctuation plan (take ${takeLabel}, V-I cadence/phrase end/pre-chorus/pump): ${plan.bars.filter((bar) => bar.pianoPunctuation).map((bar) => `b${bar.bar}=${bar.pianoPunctuation}`).join(', ') || 'none'}`;
    const planIndex = plan.reports.findIndex((line) => line.startsWith(`keys plan (take ${takeLabel}):`));
    if (planIndex >= 0) {
      const firstBars = plan.bars.filter((bar) => Object.values(bar.voices).some((voice) => voice !== undefined)).slice(0, 12);
      plan.reports[planIndex] = `keys plan (take ${takeLabel}): roles ${roles} bars; ${firstBars.map((bar) => `b${bar.bar}[${bar.level}] ${Object.entries(bar.voices).map(([part, kind]) => part === 'piano' ? `piano:${bar.pianoAnswer ? 'answer' : bar.pianoRole ?? kind}` : `${part}:${kind}`).join(' | ')}`).join(' | ')}`;
    }
    const mapIndex = plan.reports.findIndex((line) => line.startsWith(`keys piano map (take ${takeLabel},`));
    if (mapIndex >= 0) {
      const map = plan.bars.filter((bar) => bar.pianoJob).map((bar) => {
        const figure = bar.pianoAnswer ? `answer:${bar.pianoAnswer.kind}` : bar.pianoFigure ?? '—';
        const yielded = bar.pianoFigureYieldedFrom ? `,yielded:${bar.pianoFigureYieldedFrom}` : '';
        return `b${bar.bar}=${bar.pianoJob}/${figure}${yielded}/${bar.energySlope}`;
      }).join(' ');
      plan.reports[mapIndex] = `keys piano map (take ${takeLabel}, ${PIANO_ARRIVAL_PHRASE_BARS}-bar answer phrases): ${map}`;
    }
    const upIndex = plan.reports.findIndex((line) => line.startsWith(`keys piano up-arps (take ${takeLabel}):`));
    if (upIndex >= 0) plan.reports[upIndex] = `keys piano up-arps (take ${takeLabel}): ${plan.pianoMotionStats.upBars}/${plan.pianoMotionStats.motionBars} motion bars, cap ${Math.floor(PIANO_UP_MAX_SHARE * 100)}% (limit ${plan.pianoMotionStats.upLimit})`;
    const answerKindCounts = {
      leadEcho: selected.filter((choice) => choice.answer.kind === 'leadEcho').length,
      chordToneFragment: selected.filter((choice) => choice.answer.kind === 'chordToneFragment').length,
    };
    const share = activePianoBars ? (100 * selected.length / activePianoBars).toFixed(1) : '0.0';
    plan.reports.push(`keys piano answer plan (take ${takeLabel}): leadEcho=${answerKindCounts.leadEcho}, chordToneFragment=${answerKindCounts.chordToneFragment} planned bars; ${selected.length}/${activePianoBars} piano bars (${share}%, cap 15%)`);
    plan.reports.push(`keys piano answer windows (take ${takeLabel}): ${selected.map((choice) => `b${choice.bar.bar}=${choice.answer.kind}`).join(', ') || 'none'}`);
  };
  assignPianoAnswers();

  /** Strike at the bar start and every chord-span boundary within the bar. */
  const spanStrikes = (onset: number, until: number): number[] => {
    const out: number[] = [];
    let cur = onset;
    while (cur < until) {
      out.push(cur);
      const next = Math.min(spanEndOf(cur), until);
      if (next <= cur) break;
      cur = next;
    }
    return out;
  };

  /** LH body: root only, a root octave, or an open perfect fifth. The
   *  section/bar position and take rotate among the legal shapes; the root
   *  stays lowest, and no LH tone crosses 55 (56 in vocalbacking). */
  const lhBodyAt = (onset: number, bar: number, sectionStart: number): number[] => {
    const { pcs, rootPc } = chordPcsAt(onset);
    const root = foldPc(rootPc, Math.max(lhLo, pianoLo), Math.min(lhHi, pianoHi));
    if (root === null) return [];
    const slot = ((bar - sectionStart + take) % 3 + 3) % 3;
    if (forbidOctaveDoubling) return [root];
    if (slot === 2 && root + 12 <= Math.min(lhHi, pianoHi)) return [root, root + 12];
    const fifthPc = pcOf(rootPc + 7);
    if ((slot === 1 || slot === 2) && pcs.has(fifthPc) && root + 7 <= Math.min(lhHi, pianoHi)) return [root, root + 7];
    return [root];
  };

  /** Structural RH chord pcs. The written root (never a slash bass) is
   *  retained with a third/suspension, fifth and, for seventh symbols, a
   *  seventh. A power/no-third symbol gets a scale-quality third so the RH
   *  remains a triad as requested. */
  const chordPcsForRh = (tick: number): { rootPc: number; pcs: number[]; seventhPc?: number } => {
    const parsed = spanAt(tick).parsed;
    const rootPc = pcOf(parsed.root);
    const baseIntervals = parsed.intervals.filter((i) => i >= 0 && i < 12);
    let third = [3, 4, 2, 5].find((i) => baseIntervals.includes(i));
    if (third === undefined) {
      const scaleThird = [3, 4].find((i) => scalePcs.has(pcOf(rootPc + i)));
      if (scaleThird !== undefined) third = scaleThird;
      else {
        const q = parsed.quality.toLowerCase();
        third = q.startsWith('m') || q.includes('minor') || q.includes('dim') ? 3 : 4;
      }
    }
    const fifth = [6, 7, 8].find((i) => baseIntervals.includes(i)) ?? 7;
    const seventh = [10, 11].find((i) => baseIntervals.includes(i))
      ?? (parsed.quality.toLowerCase().includes('dim7') && baseIntervals.includes(9) ? 9 : undefined);
    const pcs = [rootPc, pcOf(rootPc + third), pcOf(rootPc + fifth)];
    const seventhPc = seventh === undefined ? undefined : pcOf(rootPc + seventh);
    if (seventhPc !== undefined) pcs.push(seventhPc);
    return { rootPc, pcs: [...new Set(pcs)], ...(seventhPc !== undefined ? { seventhPc } : {}) };
  };

  /** Choose an ascending RH triad/seventh in the allowed register. No pair
   *  is 11 or 13 semitones apart. A seventh is kept only above a root voice;
   *  otherwise the complete triad is the fallback. */
  const rhChordAt = (tick: number, rhFloor: number, lhTop: number, ceiling = pianoHi, requireOctave = true): number[] => {
    const chord = chordPcsForRh(tick);
    const lo = Math.max(rhFloor, lhTop + PIANO_HAND_GAP, pianoLo);
    const hi = Math.min(pianoHi, ceiling, 127);
    if (hi < lo) return [];
    const score = (notes: number[]) => {
      const span = notes[notes.length - 1] - notes[0];
      return (notes[0] - lo) * 4 + (span - 12) + Math.max(0, span - 24) * 2;
    };
    const findVoicings = (pcs: number[], requireSeventh: boolean): number[][] => {
      const options = pcs.map((pc) => {
        const pitches: number[] = [];
        for (let p = lo; p <= hi; p++) if (pcOf(p) === pc) pitches.push(p);
        return pitches;
      });
      const voicings: number[][] = [];
      const walk = (remaining: number[], chosen: number[]) => {
        if (!remaining.length) {
          if (chosen.length < 3 || (requireOctave && chosen[chosen.length - 1] - chosen[0] < 12)) return;
          for (let i = 0; i < chosen.length; i++) {
            for (let j = i + 1; j < chosen.length; j++) {
              const gap = chosen[j] - chosen[i];
              if (gap === 11 || gap === 13) return;
            }
          }
          if (requireSeventh) {
            const root = chosen.find((pitch) => pcOf(pitch) === chord.rootPc);
            const seventh = chosen.find((pitch) => pcOf(pitch) === chord.seventhPc);
            if (root === undefined || seventh === undefined || seventh <= root) return;
          }
          voicings.push(chosen);
          return;
        }
        for (let i = 0; i < remaining.length; i++) {
          const optionIndex = remaining[i];
          for (const pitch of options[optionIndex]) {
            if (chosen.length && pitch - chosen[chosen.length - 1] < 3) continue;
            walk(remaining.filter((_, j) => j !== i), [...chosen, pitch]);
          }
        }
      };
      walk(pcs.map((_, i) => i), []);
      return voicings;
    };
    const withSeventh = chord.seventhPc === undefined ? [] : findVoicings(chord.pcs, true);
    const triadPcs = chord.pcs.filter((pc) => pc !== chord.seventhPc);
    const voicings = withSeventh.length ? withSeventh : findVoicings(triadPcs, false);
    if (!voicings.length) return [];
    voicings.sort((a, b) => score(a) - score(b) || a[0] - b[0]);
    return voicings[0];
  };

  /* ---------------- phase A: candidates per part (no velocities yet) ------ */

  const candidatesByPart: Partial<Record<KeysPart, KeysCandidate[]>> = {};
  for (const part of KEYS_PARTS) {
    const track = trackOf.get(part);
    if (!track) continue;
    const prof = KEYS_PROFILES[part];
    const candidates: KeysCandidate[] = [];
    candidatesByPart[part] = candidates;
    const lo = track.lowestNote;
    const hi = track.highestNote;

    /** True when this bar sits in the chorus relief (a chorus-type section
     *  at the LOW gate and above — the plan's own reading, recomputed). */
    const reliefAt = (bar: number, norm: number): boolean => {
      const sec = ctx.sections.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
      return isChorusTypeK(sec?.name) && norm >= KEYS_GATES.low;
    };

    /** The figure's chord-tone pool: the chord tones over about two octaves
     *  from the window floor's nearest root, inside the sweet spot and the
     *  track's range, zone-shifted and deduped ascending (§16.2). The
     *  PIANO (§16.2a) additionally moves a candidate up out of the strings'
     *  octave band and shifts the zone UP first (§16.3a). */
    const figurePool = (tick: number, winLo: number, winHi: number): number[] => {
      const { pcs, rootPc } = chordPcsAt(tick);
      const base0 = foldPc(rootPc, Math.max(winLo, lo), Math.min(winHi, hi));
      if (base0 === null) return [];
      const out: number[] = [];
      for (let p = base0; p <= Math.min(winHi, hi, base0 + 24); p++) {
        if (!pcs.has(pcOf(p))) continue;
        const shifted = zoneShift(p, lo, hi);
        if (shifted === null) continue;
        if (!out.includes(shifted)) out.push(shifted);
      }
      return out.sort((a, b) => a - b);
    };

    for (let bar = 1; bar <= bars; bar++) {
      const planBar = planByBar.get(bar);
      if (!planBar) continue;
      const kind = planBar.voices[part];
      if (!kind) continue;
      const barStart = (bar - 1) * btBar;
      const barEnd = bar * btBar;
      const damp = (start: number, dur: number): number => Math.max(1, Math.min(dur, dampingEnd(start) - start));

      // the gliss run (harp): 16ths of the key's diatonic scale only, from
      // the drawn start to the landing chord tone at the target downbeat;
      // plain notes, no new articulation. In vocalbacking the zone's scale
      // tones drop out of the run (the sweep keeps its direction).
      if (kind === 'gliss') {
        const g = glissByBar.get(bar);
        if (g) {
          const { pcs } = chordPcsAt(g.targetTick);
          const winLo = Math.max(prof.sweet[0], lo);
          const winHi = Math.min(prof.sweet[1], hi);
          let target: number | null = null;
          let bestDist = Infinity;
          for (let p = winLo; p <= winHi; p++) {
            if (!pcs.has(pcOf(p))) continue;
            const shifted = zoneShift(p, lo, hi);
            if (shifted === null) continue;
            const d = Math.abs(shifted - 72);
            if (d < bestDist) {
              bestDist = d;
              target = shifted;
            }
          }
          if (target !== null) {
            const n = Math.max(1, Math.round((g.targetTick - g.startTick) / sixteenth));
            const run: number[] = [];
            if (g.dir === 'up') {
              const below: number[] = [];
              for (let p = target - 1; p >= lo && below.length < n; p--) {
                if (!scalePcs.has(pcOf(p))) continue;
                if (zoneFree && inVocalZone(p)) continue; // the zone's tones drop out of the run
                below.push(p);
              }
              run.push(...below.reverse(), target);
            } else {
              const above: number[] = [];
              for (let p = target + 1; p <= hi && above.length < n; p++) {
                if (!scalePcs.has(pcOf(p))) continue;
                if (zoneFree && inVocalZone(p)) continue; // the zone's tones drop out of the run
                above.push(p);
              }
              run.push(...above.reverse(), target);
            }
            run.forEach((pitch, i) => {
              const isLanding = i === run.length - 1;
              const onset = isLanding ? g.targetTick : g.startTick + i * sixteenth;
              if (onset >= barEnd || onset < barStart) return;
              candidates.push({
                pitch,
                startTick: onset,
                durationTicks: isLanding ? damp(onset, barEnd - onset) : sixteenth,
                ...(isLanding ? {} : { ramp: n > 1 ? i / (n - 1) : 0.5 }),
              });
            });
          }
        }
        continue;
      }

      if (part === 'harp') {
        if (kind === 'bed' || kind === 'final') {
          // §16.6 (Phase 11.5): the bed realises the section's DRAWN FIGURE —
          // the plan's balanced rotation (offset from the piano's) with the
          // hash-stepped two-bar unit walk. The eighth-cycle figures keep the
          // Phase 11 blur (each note rings until the next onset, capped at
          // one bar, damped before a tacet); the held chord figures sustain
          // to the harmonic span or the bar line (§16.5 — pedal emulation by
          // length, re-taken at the half-bar line so every written note
          // stays inside the figuration exemption). The final bar keeps the
          // descending close. In the chorus relief the bed rides the relief
          // intensity floor.
          const relief = kind === 'bed' && reliefAt(bar, planBar.norm);
          const secHere = ctx.sections.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
          const unit = secHere ? Math.floor((bar - secHere.startBar) / HARP_FIGURE_UNIT_BARS) : 0;
          const figs = secHere ? harpFiguresByStart.get(secHere.startBar) : undefined;
          const figure: HarpFigure | 'finalDescent' = kind === 'final' ? 'finalDescent' : figs?.[Math.min(unit, (figs?.length ?? 1) - 1)] ?? 'arpUp';
          /** §16.6 (11.5) the held ring: to the harmonic span or the bar line
           *  (at most 1 bar), re-taken so every written segment stays
           *  STRICTLY SHORTER than half a bar (959 ticks): the figuration
           *  exemption needs the shorter note ≤ half a bar AND the other
           *  note strictly longer — a 960-vs-960 pair (the piano's half-bar
           *  holds, the string pads) would fall through to the doubling
           *  audit, and the forbidden-doubling templates read it as a hard
           *  finding. The 1-tick-shy segments keep every harp hold exempt
           *  against the piano's 960-tick holds and the longer string pads.
           *  `until` caps the ring earlier (the next strike of the same
           *  figure — the pedal continues through the re-strike). */
          const pushHeldHarp = (onset: number, pitch: number, opts: { relief?: boolean; soft?: boolean; until?: number } = {}) => {
            const cap = Math.min(opts.until ?? barEnd, barEnd);
            const total = Math.max(1, Math.min(spanEndOf(onset), cap) - onset);
            const segLen = Math.floor(btBar / 2) - 1;
            const nSeg = Math.floor(total / segLen);
            const emit = (start: number, len: number) => {
              candidates.push({ pitch, startTick: start, durationTicks: damp(start, len), ...(relief || opts.relief ? { relief: true } : {}), ...(opts.soft ? { soft: true } : {}) });
            };
            // whole segments only — a 1-2 tick tail note would inflate the
            // beat windows' sounding count (and the ring ends a couple of
            // ticks early, inaudible)
            if (nSeg === 0) emit(onset, total);
            else for (let i = 0; i < nSeg; i++) emit(onset + i * segLen, segLen);
          };
          /** The harp's strike grid inside [onset, until): the onset plus
           *  every harmonic-span change — a held ring re-strikes the new
           *  chord there (a ring never outlives its own harmony). */
          const spanStrikesHarp = (onset: number, until: number): number[] => {
            const out: number[] = [];
            let cur = onset;
            while (cur < until) {
              out.push(cur);
              const next = Math.min(spanEndOf(cur), until);
              if (next <= cur) break;
              cur = next;
            }
            return out;
          };
          if (figure === 'arpUp' || figure === 'arpDown' || figure === 'pendulum' || figure === 'brokenThirds' || figure === 'finalDescent') {
            const order = (i: number, L: number): number =>
              figure === 'arpDown' ? L - 1 - (i % L)
                : figure === 'pendulum' ? (() => { const c = i % Math.max(2, 2 * L - 2); return c < L ? c : 2 * L - 2 - c; })()
                  : figure === 'brokenThirds' ? (() => { const evens = Math.ceil(L / 2); const k = i % L; return k < evens ? k * 2 : (k - evens) * 2 + 1; })()
                    : (kind === 'final' ? (L - 1 - (i % L) + L) % L : i % L);
            const nSlots = Math.max(1, Math.floor((barEnd - barStart) / eighth));
            for (let i = 0; i < nSlots; i++) {
              const onset = barStart + i * eighth;
              const pool = figurePool(onset, prof.sweet[0], prof.sweet[1]);
              if (!pool.length) continue;
              const pitch = pool[order(i, pool.length) % pool.length];
              const next = onset + eighth;
              candidates.push({ pitch, startTick: onset, durationTicks: damp(onset, Math.min(next, barEnd) - onset), ...(relief ? { relief: true } : {}) });
            }
          } else if (figure === 'offBeatPairs') {
            // pairs of eighths starting on the off-beats: (and-of-1, 2),
            // (and-of-2, 3), (and-of-3, 4) and (and-of-4, 1) — the walk
            // starts on every off-beat eighth and runs to the bar line (the
            // last pair's tail rings into the next bar's downbeat and is
            // damped there); the downbeat itself rests, the walk never
            // repeats a pitch inside a beat
            let k = 0;
            for (const slot of [1, 2, 3, 4, 5, 6, 7]) {
              const onset = barStart + slot * eighth;
              if (onset >= barEnd) break;
              const pool = figurePool(onset, prof.sweet[0], prof.sweet[1]);
              if (!pool.length) continue;
              candidates.push({ pitch: pool[k % pool.length], startTick: onset, durationTicks: damp(onset, Math.min(onset + eighth, barEnd) - onset), ...(relief ? { relief: true } : {}) });
              k++;
            }
          } else if (figure === 'pluckSparkle') {
            // high-octave dry pluck sparkle: the chord tones folded into the
            // top octave of the track's HARD range (the config range wins),
            // dry plucks on every eighth (short, no ring), soft at low
            // energy — the walk never repeats a pitch inside a beat
            for (let i = 0; i < 8; i++) {
              const onset = barStart + i * eighth;
              if (onset >= barEnd) break;
              const { pcs: pcsHere } = chordPcsAt(onset);
              const tones: number[] = [];
              for (let p = Math.max(prof.sweet[0], hi - 12); p <= hi; p++) if (pcsHere.has(pcOf(p))) tones.push(p);
              if (!tones.length) continue;
              candidates.push({
                pitch: tones[i % tones.length], startTick: onset, durationTicks: damp(onset, Math.min(eighth, barEnd - onset)),
                ...(relief ? { relief: true } : {}), ...(planBar.norm < KEYS_GATES.mid ? { soft: true } : {}),
              });
            }
          } else if (figure === 'wideRoll' || figure === 'rolledChord' || figure === 'lowRootFifth') {
            // the held chord figures. The tone selection folds the root into
            // the figure's window and walks the chord's pitch classes
            // ascending; below MIDI 48 a kept tone must clear a fifth above
            // the last kept one (the low-interval rule — the harp writes
            // 5th-or-wider intervals or single notes down there). The wide
            // roll spreads two octaves, the rolled chord stays compact (the
            // vocalbacking rolls live below the vocal zone), the low root
            // and fifth re-strikes on beat 3 (the pedal continues through
            // the re-strike). Every strike is chord-fresh and the held ring
            // re-strikes at each harmonic-span change (a ring never outlives
            // its own chord).
            const rollLo = zoneFree ? 36 : Math.max(prof.sweet[0], 36);
            const rollHi = zoneFree ? 56 : (figure === 'wideRoll' ? Math.min(prof.sweet[1], hi) : Math.min(prof.sweet[1], hi, 83));
            const buildRoll = (pcs: Set<number>, rootPc: number, spread: boolean): number[] => {
              const base0 = foldPc(rootPc, Math.max(rollLo, lo), Math.min(rollHi, hi));
              if (base0 === null) return [];
              const tones: number[] = [];
              const voiced = new Set<number>();
              for (let off = 0; off < (spread ? 24 : 12) && tones.length < 4; off++) {
                const pc = ((rootPc + off) % 12 + 12) % 12;
                if (!pcs.has(pc)) continue;
                if (off < 12 && voiced.has(pc)) continue;
                let p = base0 + off;
                let wrapped = false;
                while (p > Math.min(rollHi, hi)) { p -= 12; wrapped = true; }
                if (p < Math.max(rollLo, lo)) continue;
                if (off >= 12 && !wrapped) break; // the second octave only above the window's first
                if (off < 12) voiced.add(pc);
                const last = tones[tones.length - 1];
                if (last !== undefined && p < 48 && last < 48 && Math.abs(p - last) < 7) continue;
                tones.push(p);
              }
              // the low-interval rule reads the SIMULTANEOUS set — the
              // sorted adjacency, not the walk order; the groups below 48
              // (both ends) sit a fifth or wider apart
              tones.sort((a, b) => a - b);
              const kept: number[] = [];
              for (const t of tones) {
                const last = kept[kept.length - 1];
                if (last === undefined || t - last >= 7 || last >= 48 || t >= 48) kept.push(t);
              }
              // the harp's held rolls keep the bed's own two-voice window
              // presence (two notes sounding per beat window — the footprint
              // the Phase 11 window math saw): the rolled chord holds its
              // lowest pair, the wide roll holds the extremes (the
              // two-octave spread IS the pair)
              if (spread) return kept.length > 1 ? [kept[0], kept[kept.length - 1]] : kept;
              return kept.slice(0, 2);
            };
            const harpStrikes = spanStrikesHarp(barStart, barEnd);
            if (figure === 'lowRootFifth') {
              harpStrikes.forEach((onset, k) => {
                const { rootPc: rootHere } = chordPcsAt(onset);
                const rootNote = foldPc(rootHere, Math.max(36, lo), zoneFree ? 56 : 55);
                if (rootNote === null) return;
                const fifth = rootNote + 7 <= (zoneFree ? 56 : 55) ? rootNote + 7 : rootNote - 7 >= Math.max(23, lo) ? rootNote - 7 : rootNote + 12 <= hi ? rootNote + 12 : rootNote;
                const pair = fifth !== rootNote ? [rootNote, fifth] : [rootNote];
                const until = k + 1 < harpStrikes.length ? harpStrikes[k + 1] : barEnd;
                for (const p of pair) pushHeldHarp(onset, p, { until });
              });
            } else {
              harpStrikes.forEach((onset, k) => {
                const { pcs: pcsHere, rootPc: rootHere } = chordPcsAt(onset);
                const tones = buildRoll(pcsHere, rootHere, figure === 'wideRoll');
                const until = k + 1 < harpStrikes.length ? harpStrikes[k + 1] : barEnd;
                tones.forEach((p, i) => pushHeldHarp(k === 0 ? barStart + i * sixteenth : onset + i * sixteenth, p, { until, ...(relief ? { relief: true } : {}) }));
              });
            }
          }
        } else if (kind === 'roots') {
          // the low plucked roots: the chord's root in the bottom octave, a
          // soft quarter-length pluck on the phrase start (§16.2); in the
          // chorus relief it is the non-arpeggiating harp's drive line — the
          // root on EVERY QUARTER (the grid analogue, one voice, never an
          // arpeggio) riding the relief velocity (§16.4)
          const relief = reliefAt(bar, planBar.norm);
          const { rootPc } = chordPcsAt(barStart);
          const pitch = foldPc(rootPc, Math.max(prof.low[0], lo), Math.min(prof.low[1], hi));
          if (pitch !== null) {
            const hits = relief ? [0, 1, 2, 3] : [0];
            for (const h of hits) {
              const onset = barStart + h * beat;
              if (onset >= barEnd) break;
              candidates.push({ pitch, startTick: onset, durationTicks: damp(onset, Math.min(beat, barEnd - onset)), ...(relief ? { relief: true } : {}) });
            }
          }
        }
      } else if (part === 'piano') {
        const roleTag = planBar.pianoRole;
        if (!roleTag) continue;

        const chamberSonata = template.id === 'ensemble.chamber' || template.id === 'ensemble.sonata';
        const chamberSonataOverlap = chamberSonata && stringsLowAt(bar);
        const vbPhraseArrival = template.id === 'ensemble.vocalbacking' && planBar.pianoArrival !== undefined;
        const rhFloor = Math.max(zoneFree ? VB_RH[0] : PIANO_RH[0], chamberSonataOverlap ? 72 : 0, vbPhraseArrival ? 82 : 0);
        const rhCeiling = chamberSonata ? (planBar.pianoRarePeak ? 88 : 84) : pianoHi;
        const powerLowAt = (tick: number): number | null => {
          if (!planBar.pianoPower) return null;
          const chord = chordPcsAt(tick);
          if (template.id === 'ensemble.vocalbacking') {
            // Keep vocalbacking's 57-81 register gap while retaining a true
            // octave dyad: use a chord/scale tone in the only low octave range
            // whose upper octave remains at or below MIDI 56.
            for (let pitch = Math.max(lhLo, pianoLo); pitch <= Math.min(44, pianoHi); pitch++) {
              if (chord.pcs.has(pcOf(pitch))) return pitch;
            }
            for (let pitch = Math.max(lhLo, pianoLo); pitch <= Math.min(44, pianoHi); pitch++) {
              if (scalePcs.has(pcOf(pitch))) return pitch;
            }
          }
          return foldPc(chord.rootPc, Math.max(lhLo, pianoLo), Math.min(lhHi, pianoHi));
        };
        const powerHighAt = (tick: number): number | null => {
          const low = powerLowAt(tick);
          const upperLimit = template.id === 'ensemble.vocalbacking' ? 56 : 67;
          if (low === null) return null;
          if (!forbidOctaveDoubling) return low + 12 <= Math.min(pianoHi, upperLimit) ? low + 12 : null;
          const chord = chordPcsAt(tick);
          const fifthPc = pcOf(chord.rootPc + 7);
          const lo = Math.max(lhLo, pianoLo, template.id === 'ensemble.vocalbacking' ? 45 : 0);
          const hi = Math.min(lhHi, pianoHi, upperLimit);
          const fifths: number[] = [];
          for (let pitch = lo; pitch <= hi; pitch++) {
            if (pcOf(pitch) === fifthPc && pitch !== low && Math.abs(pitch - low) % 12 !== 0) fifths.push(pitch);
          }
          const chordTonesInRange: number[] = [];
          for (let pitch = lo; pitch <= hi; pitch++) {
            if (pitch !== low && chord.pcs.has(pcOf(pitch)) && Math.abs(pitch - low) % 12 !== 0) chordTonesInRange.push(pitch);
          }
          const options = fifths.length ? fifths : chordTonesInRange;
          return options.sort((a, b) => Number(b > low) - Number(a > low) || Math.abs(a - low) - Math.abs(b - low) || a - b)[0] ?? null;
        };
        const powerAlternativesAt = (tick: number): number[] => {
          if (!forbidOctaveDoubling) return [];
          const chord = chordPcsAt(tick);
          const lo = Math.max(lhLo, pianoLo, template.id === 'ensemble.vocalbacking' ? 40 : 0);
          const hi = Math.min(lhHi, pianoHi, template.id === 'ensemble.vocalbacking' ? 44 : 55);
          const preferredPcs = [chord.rootPc, pcOf(chord.rootPc + 7), ...chord.pcs];
          const pitches: number[] = [];
          for (const pc of [...new Set(preferredPcs)]) {
            for (let pitch = lo; pitch <= hi; pitch++) if (pcOf(pitch) === pc && !pitches.includes(pitch)) pitches.push(pitch);
          }
          return pitches;
        };
        const lhCollisionAlternativesAt = (tick: number, original: number): number[] => {
          if (!forbidOctaveDoubling) return [];
          const rootPc = chordPcsAt(tick).rootPc;
          const allowedPcs = [rootPc, pcOf(rootPc + 7)];
          const choices: number[] = [];
          for (const pc of allowedPcs) {
            for (let pitch = Math.max(lhLo, pianoLo); pitch <= Math.min(lhHi, pianoHi); pitch++) {
              if (pitch !== original && pcOf(pitch) === pc) choices.push(pitch);
            }
          }
          return choices.sort((a, b) => Math.abs(a - original) - Math.abs(b - original) || a - b);
        };
        const powerTops = planBar.pianoPower
          ? spanStrikes(barStart, barEnd).map((tick) => powerHighAt(tick) ?? powerLowAt(tick) ?? 0)
          : [];
        const rhFloorForBar = Math.max(rhFloor, ...(powerTops.length ? [Math.max(...powerTops) + PIANO_HAND_GAP] : []));
        const rhAlternatives = (tick: number, floor: number, ceiling: number, pitches: number[]) => {
          const chordPcs = chordPcsAt(tick).pcs;
          const pool = figurePool(tick, floor, ceiling);
          const bases = [...new Set([...pitches, ...pool])];
          const octaveOptions = bases.flatMap((pitch) => [-24, -12, 12, 24, 36].map((delta) => pitch + delta));
          return [...new Set([...bases, ...octaveOptions])]
            .filter((pitch) => pitch >= floor && pitch <= ceiling && pitch >= pianoLo && pitch <= pianoHi && chordPcs.has(pcOf(pitch)));
        };
        const rhVoicingMeta = (tick: number, pitches: number[]) => {
          const chord = chordPcsForRh(tick);
          const rootPitch = pitches.find((pitch) => pcOf(pitch) === chord.rootPc);
          return chord.seventhPc !== undefined && rootPitch !== undefined
            ? { rootPc: chord.rootPc, seventhPc: chord.seventhPc, rootPitch }
            : {};
        };
        const arrivalRollOrder = (tick: number, pitches: number[]): number[] => {
          const rootPc = chordPcsForRh(tick).rootPc;
          return [...pitches].sort((a, b) => Number(pcOf(a) === rootPc) - Number(pcOf(b) === rootPc) || a - b);
        };

        // Tutti remains a low root. The closing chord adds the explicitly
        // allowed rolled RH arrival, replacing the former root-only ending.
        if (kind === 'final' || kind === 'tutti') {
          const moment = momentForBar(ctx.moments, bar);
          if (kind === 'tutti' && moment?.kind !== 'tutti') continue;
          const hitLen = kind === 'final'
            ? Math.min(beat * 2, barEnd - barStart)
            : moment?.shape === 'breath' ? beat
              : moment?.shape === 'decay' ? beat * 2 : btBar;
          const hitEnd = Math.min(barEnd, barStart + hitLen);
          const strikes = spanStrikes(barStart, hitEnd);
          let closingRoot: number | null = null;
          strikes.forEach((onset, index) => {
            const until = Math.min(index + 1 < strikes.length ? strikes[index + 1] : hitEnd, hitEnd);
            const { rootPc } = chordPcsAt(onset);
            const pitch = foldPc(rootPc, Math.max(36, pianoLo), Math.min(lhHi, pianoHi));
            if (pitch === null) return;
            if (onset === barStart) closingRoot = pitch;
            candidates.push({
              pitch, startTick: onset, durationTicks: Math.max(1, until - onset),
              articulation: 'marcato', ...(kind === 'tutti' ? { moment: true } : {}),
              roleTag, hand: 'lh', heldBodyLowest: true, bar,
              strikeId: `piano:${bar}:${onset}`,
            });
          });
          if (kind === 'final' && planBar.pianoArrival === 'closingChord' && closingRoot !== null) {
            const rh = rhChordAt(barStart, rhFloor, closingRoot, rhCeiling, false);
            const holdEnd = Math.min(endTick, spanEndOf(barStart), barEnd);
            const rollWindow = Math.max(1, Math.min(eighth, holdEnd - barStart));
            const strikeId = `piano-arrival:${bar}:closingChord`;
            const rootPc = chordPcsForRh(barStart).rootPc;
            arrivalRollOrder(barStart, rh).forEach((pitch) => {
              const onset = pcOf(pitch) === rootPc ? barStart + Math.max(1, Math.floor(rollWindow / 2)) : barStart;
              candidates.push({
                pitch, startTick: onset, durationTicks: Math.max(1, holdEnd - onset),
                roleTag: 'arrival', hand: 'rh', bar, strikeId,
                ...rhVoicingMeta(onset, rh),
                collisionAlternatives: rhAlternatives(onset, rhFloor, rhCeiling, rh),
              });
            });
          }
          continue;
        }

        if (kind !== 'anchor') continue;
        const sec = ctx.sections.find((candidate) => bar >= candidate.startBar && bar < candidate.startBar + candidate.lengthBars);
        const sectionStart = sec?.startBar ?? 1;
        const relief = reliefAt(bar, planBar.norm);
        const strikes = spanStrikes(barStart, barEnd);
        strikes.forEach((onset, index) => {
          const strikeEnd = Math.min(index + 1 < strikes.length ? strikes[index + 1] : barEnd, spanEndOf(onset), barEnd);
          if (strikeEnd <= onset) return;
          const body = lhBodyAt(onset, bar, sectionStart);
          if (!body.length) return;
          const lhTop = body[body.length - 1];
          const arrivalHere = planBar.pianoArrival !== undefined && onset === barStart;
          const rh = rhChordAt(onset, rhFloorForBar, Math.max(lhTop, powerHighAt(onset) ?? 0), rhCeiling, !arrivalHere);
          const bodyStrikeId = `piano-body:${bar}:${onset}`;
          const rhStrikeId = `piano-rh-anchor:${bar}:${onset}`;
          for (let i = 0; i < body.length; i++) {
            if (planBar.pianoPower) continue; // power replaces the held LH body, never doubles its lowest pitch
            candidates.push({
              pitch: body[i], startTick: onset, durationTicks: strikeEnd - onset,
              ...(relief ? { relief: true } : {}), roleTag, hand: 'lh',
              ...(i === 0 ? { heldBodyLowest: true } : {}), bar, strikeId: bodyStrikeId,
              collisionAlternatives: lhCollisionAlternativesAt(onset, body[i]),
            });
          }
          if (!planBar.pianoRepeatedChord && !arrivalHere && !planBar.pianoAnswer) {
            for (const pitch of rh) candidates.push({
              pitch, startTick: onset, durationTicks: strikeEnd - onset,
              ...(relief ? { relief: true } : {}), roleTag, hand: 'rh', bar, strikeId: rhStrikeId,
              ...rhVoicingMeta(onset, rh),
              collisionAlternatives: rhAlternatives(onset, rhFloorForBar, rhCeiling, rh),
            });
          } else if (arrivalHere) {
            const rollWindow = Math.max(1, Math.min(eighth, strikeEnd - onset));
            const arrivalStrike = `piano-arrival:${bar}:${onset}`;
            const rootPc = chordPcsForRh(onset).rootPc;
            arrivalRollOrder(onset, rh).forEach((pitch) => {
              const rolledOnset = pcOf(pitch) === rootPc ? onset + Math.max(1, Math.floor(rollWindow / 2)) : onset;
              candidates.push({
                pitch, startTick: rolledOnset, durationTicks: Math.max(1, strikeEnd - rolledOnset),
                ...(relief ? { relief: true } : {}), roleTag: 'arrival', hand: 'rh', bar,
                strikeId: arrivalStrike,
                ...rhVoicingMeta(rolledOnset, rh),
                collisionAlternatives: rhAlternatives(rolledOnset, rhFloorForBar, rhCeiling, rh),
              });
            });
          }
        });

        if (planBar.pianoPower) {
          const step = planBar.pianoPower === 'eighth' ? eighth : beat;
          const grid = Array.from({ length: Math.ceil(btBar / step) }, (_, i) => barStart + i * step)
            .filter((onset) => onset < barEnd);
          const thin = planBar.norm >= KEYS_GATES.high && planBar.pianoPower === 'quarter';
          const chosen = grid.filter((_, i) => !thin || i <= 2);
          let lastLowOnset = Number.NEGATIVE_INFINITY;
          chosen.forEach((onset, index) => {
            const until = Math.min(chosen[index + 1] ?? barEnd, spanEndOf(onset), barEnd, dampingEnd(onset));
            if (until <= onset) return;
            const low = powerLowAt(onset);
            if (low === null) return;
            const high = powerHighAt(onset);
            const pitches = index === 0
              ? [low, ...(high !== null ? [high] : [])]
              : index % 2 === 1 ? (high !== null ? [high] : []) : [low];
            if (pitches.includes(low) && onset - lastLowOnset < beat) return;
            if (pitches.includes(low)) lastLowOnset = onset;
            const strikeId = `piano-power:${bar}:${onset}`;
            for (const pitch of pitches) candidates.push({
              pitch, startTick: onset, durationTicks: until - onset,
              ...(index === 0 ? { articulation: 'marcato' as const } : {}),
              roleTag: 'power', hand: 'lh', bar, strikeId,
              collisionAlternatives: powerAlternativesAt(onset),
              ...(planBar.norm >= KEYS_GATES.high && planBar.pianoPower === 'eighth' ? { velScale: 0.78 } : {}),
            });
          });
        }

        if (planBar.pianoRepeatedChord) {
          const onsets = [...new Set([...strikes, ...Array.from({ length: Math.ceil(btBar / beat) }, (_, i) => barStart + i * beat).filter((tick) => tick < barEnd)])]
            .sort((a, b) => a - b);
          onsets.forEach((onset, index) => {
            const body = lhBodyAt(onset, bar, sectionStart);
            const rh = rhChordAt(onset, rhFloor, body[body.length - 1] ?? 0, rhCeiling);
            const until = Math.min(onsets[index + 1] ?? barEnd, spanEndOf(onset), barEnd);
            const strikeId = `piano-repeated:${bar}:${onset}`;
            rh.forEach((pitch) => candidates.push({
              pitch, startTick: onset, durationTicks: Math.max(1, until - onset),
              roleTag: 'bed', hand: 'rh', bar, strikeId,
              ...rhVoicingMeta(onset, rh),
              collisionAlternatives: rhAlternatives(onset, rhFloor, rhCeiling, rh),
            }));
          });
        }

        if (planBar.pianoPunctuation) {
          const preferredPuncOnset = Math.min(barEnd - 1, barStart + (planBar.pianoPunctuation === 'pump' ? beat : beat * 3));
          const bodyOnsets = [...new Set(candidates.filter((candidate) => candidate.hand === 'lh' && candidate.heldBodyLowest
            && candidate.startTick >= barStart && candidate.startTick < barEnd).map((candidate) => candidate.startTick))].sort((a, b) => a - b);
          const bodyAtPreferred = candidates.some((candidate) => candidate.hand === 'lh' && candidate.heldBodyLowest
            && candidate.startTick <= preferredPuncOnset && candidate.startTick + candidate.durationTicks > preferredPuncOnset);
          const puncOnset = Math.min(barEnd - 1, bodyAtPreferred ? preferredPuncOnset
            : bodyOnsets.find((onset) => onset >= preferredPuncOnset) ?? bodyOnsets.at(-1) ?? preferredPuncOnset);
          const heldBody = candidates.some((candidate) => candidate.hand === 'lh' && candidate.heldBodyLowest
            && candidate.startTick <= puncOnset && candidate.startTick + candidate.durationTicks > puncOnset);
          const rosterRoles = new Set(template.roster.map((entry) => entry.role));
          const stringTracks = project.tracks.filter((track) => track.family === 'Strings' && isInstrumentTrack(track) && rosterRoles.has(track.role));
          const stringRest = stringTracks.every((track) => !(stringsNotes[track.id] ?? []).some((note) =>
            note.startTick < barEnd && note.startTick + note.durationTicks > barStart));
          if (heldBody || stringRest) {
            const lhTop = heldBody ? Math.max(...candidates.filter((candidate) => candidate.hand === 'lh' && candidate.startTick <= puncOnset
              && candidate.startTick + candidate.durationTicks > puncOnset).map((candidate) => candidate.pitch)) : 0;
            const puncFloor = template.id === 'ensemble.vocalbacking' ? Math.max(82, rhFloorForBar) : rhFloorForBar;
            const puncCeiling = template.id === 'ensemble.vocalbacking' ? Math.min(rhCeiling, VB_SPARKLE_PEAK[1]) : rhCeiling;
            const chord = rhChordAt(puncOnset, puncFloor, lhTop, puncCeiling, false);
            const duration = Math.max(1, Math.min(Math.floor(eighth / 2), barEnd - puncOnset, endTick - puncOnset));
            const strikeId = `piano-punctuation:${bar}:${puncOnset}`;
            chord.forEach((pitch) => candidates.push({
              pitch, startTick: puncOnset, durationTicks: duration, articulation: 'staccato',
              roleTag: 'punctuation', hand: 'rh', bar, strikeId, yieldToHarp: true,
              ...rhVoicingMeta(puncOnset, chord),
              punctuationReason: planBar.pianoPunctuation,
              ...(zoneFree ? { soft: true, velScale: 0.55 } : { velScale: 0.78 }),
              collisionAlternatives: rhAlternatives(puncOnset, puncFloor, puncCeiling, chord),
            }));
          }
        }

        // Motion figures are RH overlays: the LH root/body and the held RH
        // anchor above continue through their harmonic-span release. Every
        // overlay is chord-tone, hand-gap, track-range, and VB-sparkle bounded.
        const figure = planBar.pianoFigure;
        if (figure) {
          const figureRole = planBar.pianoFigureRole ?? 'anchor';
          const sparkleTop = zoneFree
            ? (planBar.pianoSparkleTop === 96 ? VB_SPARKLE_PEAK[1] : VB_SPARKLE_BODY[1])
            : PIANO_RH[1];
          const figureLo = Math.max(zoneFree ? VB_SPARKLE_BODY[0] : PIANO_RH[0], rhFloorForBar, pianoLo);
          const figureHi = Math.min(sparkleTop, pianoHi, PIANO_RH[1], rhCeiling);
          const poolAt = (tick: number, lo = figureLo): number[] => {
            const high = Math.max(lo, figureHi);
            const pool = figurePool(tick, lo, high).filter((pitch) => pitch >= lo && pitch <= high);
            if (pool.length) return pool;
            return rhChordAt(tick, lo, Math.max(0, lo - PIANO_HAND_GAP), rhCeiling).filter((pitch) => pitch >= lo && pitch <= high);
          };
          const pushFigure = (pitch: number, onset: number, until: number, soft = false, holdToSpan = false) => {
            const limit = holdToSpan ? endTick : barEnd;
            if (onset < barStart || onset >= barEnd || until <= onset || pitch < figureLo || pitch > figureHi) return;
            const alternatives = [...new Set([...poolAt(onset), pitch - 12, pitch + 12])]
              .filter((candidate) => candidate >= figureLo && candidate <= figureHi && candidate >= pianoLo && candidate <= pianoHi);
            candidates.push({
              pitch,
              startTick: onset,
              durationTicks: damp(onset, Math.min(until, limit) - onset),
              roleTag: figureRole, hand: 'rh', bar,
              strikeId: `piano-figure:${bar}:${figure}:${onset}`,
              collisionAlternatives: alternatives,
              ...(soft ? { soft: true } : {}),
              ...(holdToSpan ? { holdToSpan: true } : {}),
            });
          };
          const figureSlots = Math.ceil((barEnd - barStart) / eighth);
          const noteToNextEighth = (onset: number) => Math.min(barEnd, spanEndOf(onset), onset + eighth);

          if (figure === 'arpUp' || figure === 'arpDown' || figure === 'arpPendulum' || figure === 'alberti') {
            for (let i = 0; i < figureSlots; i++) {
              const onset = barStart + i * eighth;
              if (onset >= barEnd) break;
              const pool = poolAt(onset);
              if (!pool.length) continue;
              let pitch: number;
              if (figure === 'alberti') {
                const mid = Math.floor((pool.length - 1) / 2);
                const order = [0, pool.length - 1, mid, pool.length - 1];
                pitch = pool[order[i % order.length]];
              } else {
                const cycle = figure === 'arpDown'
                  ? pool.length - 1 - (i % pool.length)
                  : figure === 'arpPendulum'
                    ? pool.length === 1 ? 0 : (() => { const period = 2 * pool.length - 2; const k = i % period; return k < pool.length ? k : period - k; })()
                    : i % pool.length;
                pitch = pool[cycle];
              }
              pushFigure(pitch, onset, noteToNextEighth(onset));
            }
          } else if (figure === 'cascade') {
            // A slow two-note cascade over each harmony: the first attack is
            // at the span start, the second at its midpoint. Each note rings
            // to the actual span end, even when that falls in a later bar.
            ctx.spans.filter((span) => span.startTick < barEnd && span.endTick > barStart)
              .forEach((span, spanIndex) => {
                const spanEnd = Math.min(span.endTick, endTick);
                const midpoint = span.startTick + Math.floor((spanEnd - span.startTick) / (2 * eighth)) * eighth;
                const attacks = [span.startTick, ...(midpoint > span.startTick && midpoint < spanEnd ? [midpoint] : [])];
                let previousPitch: number | undefined;
                attacks.forEach((onset, attackIndex) => {
                  if (onset < barStart || onset >= barEnd) return;
                  const pool = poolAt(onset);
                  if (!pool.length) return;
                  const choices = attackIndex > 0 ? pool.filter((pitch) => pitch !== previousPitch) : pool;
                  if (!choices.length) return; // do not cut a held cascade with a same-pitch re-strike
                  const pitch = choices[(spanIndex + attackIndex) % choices.length];
                  previousPitch = pitch;
                  pushFigure(pitch, onset, spanEnd, false, true);
                });
              });
          } else if (figure === 'wideBroken') {
            // The anchor's LH root is the first event; after a deliberate gap,
            // three high chord tones answer on eighth slots 3, 5, and 7.
            for (const slot of [3, 5, 7]) {
              const onset = barStart + slot * eighth;
              if (onset >= barEnd) continue;
              const pool = poolAt(onset);
              if (!pool.length) continue;
              pushFigure(pool[(slot + sectionStart) % pool.length], onset, noteToNextEighth(onset));
            }
          } else if (figure === 'ostinatoCell' && planBar.pianoCell) {
            let grid = cellGrid(project.timeSignature, planBar.pianoCell, 'eighths');
            if (template.id !== 'ensemble.vocalbacking' && grid.slots.length < 3) grid = cellGrid(project.timeSignature, 'straight', 'eighths');
            const slotsPerBar = Math.max(1, beatOffsets(project.timeSignature).length * grid.perBeat);
            const slotTicks = btBar / slotsPerBar;
            const count = template.id === 'ensemble.vocalbacking'
              ? Math.min(4, grid.slots.length)
              : Math.min(4, Math.max(3, grid.slots.length));
            const selectedSlots: number[] = [];
            for (let i = 0; i < count; i++) {
              const index = count === 1 ? 0 : Math.round(i * (grid.slots.length - 1) / (count - 1));
              const slot = grid.slots[index];
              if (slot !== undefined && !selectedSlots.includes(slot)) selectedSlots.push(slot);
            }
            selectedSlots.forEach((slot, index) => {
              const onset = barStart + slot * slotTicks;
              if (onset >= barEnd) return;
              const pool = poolAt(onset);
              if (!pool.length) return;
              pushFigure(pool[index % pool.length], onset, Math.min(barEnd, spanEndOf(onset), onset + slotTicks));
            });
          } else if (figure === 'highSparkle' && planBar.norm < KEYS_GATES.mid) {
            const lo = Math.max(84, figureLo);
            const onset = Math.min(barEnd - 1, barStart + eighth);
            const pool = poolAt(onset, lo);
            if (pool.length) {
              const pick = hashString(`piano-sparkle:${take}:${bar}:${planBar.pianoFigure}`) % pool.length;
              pushFigure(pool[pick], onset, noteToNextEighth(onset), true);
            }
          }
        }

        if (planBar.pianoAnswer) {
          const { pitches, windowEndTick } = planBar.pianoAnswer;
          pitches.forEach((pitch, index) => {
            const onset = barStart + index * beat;
            const until = Math.min(windowEndTick, index + 1 < pitches.length ? barStart + (index + 1) * beat : windowEndTick);
            if (onset >= until || onset >= barEnd) return;
            const alternatives: number[] = [];
            for (let alternative = rhFloorForBar; alternative <= Math.min(rhCeiling, pianoHi); alternative++) {
              if (alternative !== pitch && scalePcs.has(pcOf(alternative))) alternatives.push(alternative);
            }
            alternatives.sort((a, b) => Math.abs(a - pitch) - Math.abs(b - pitch) || a - b);
            candidates.push({
              pitch, startTick: onset, durationTicks: until - onset,
              roleTag: 'answer', hand: 'rh', bar,
              strikeId: `piano-answer:${bar}:${index}`,
              collisionAlternatives: alternatives,
            });
          });
        }
      }
    }
  }

  const pianoCandidates = candidatesByPart.piano ?? [];
  const flourishTemplates = new Set(['ensemble.chamber', 'ensemble.sonata', 'ensemble.cinematic', 'ensemble.hybridstudio']);
  const externalOctaveNotes: Note[] = [];
  const maxLegatoTicks = forbidOctaveDoubling ? msToTicks(30, project.tempoMap) : 0;
  if (forbidOctaveDoubling) {
    const flourishRosterRoles = new Set(template.roster.map((entry) => entry.role));
    const appendExternalTracks = (tracks: Record<string, Note[]>) => {
      for (const [trackId, notes] of Object.entries(tracks)) {
        const role = project.tracks.find((track) => track.id === trackId)?.role;
        if (role && role !== 'piano' && flourishRosterRoles.has(role)) externalOctaveNotes.push(...notes);
      }
    };
    appendExternalTracks(stringsNotes);
    appendExternalTracks(brassNotes);
    appendExternalTracks(windNotes);
    appendExternalTracks(percNotes);
    appendExternalTracks(notesByTrackId);
    for (const entry of ruleNotes) if (entry.role !== 'piano' && flourishRosterRoles.has(entry.role)) externalOctaveNotes.push(...entry.notes);
  }
  const hasExternalHardOctave = (pitch: number, startTick: number, durationTicks: number): boolean => {
    if (!forbidOctaveDoubling) return false;
    return externalOctaveNotes.some((other) => {
      const interval = Math.abs(pitch - other.pitch);
      if (!interval || interval % 12 !== 0) return false;
      const tick = Math.max(startTick, other.startTick);
      if (startTick >= other.startTick + other.durationTicks + maxLegatoTicks
        || other.startTick >= startTick + durationTicks) return false;
      const shortDuration = Math.min(durationTicks, other.durationTicks);
      const longDuration = Math.max(durationTicks, other.durationTicks);
      if (shortDuration <= btBar / 2 && longDuration > shortDuration) {
        const shortPitch = durationTicks <= other.durationTicks ? pitch : other.pitch;
        const span = ctx.spans.find((candidate) => candidate.startTick <= tick && tick < candidate.endTick);
        if (span && chordTones(span.parsed).tones.some((tone) => pcOf(tone.pc) === pcOf(shortPitch))) return false;
      }
      return true;
    });
  };
  for (const planBar of plan.bars.filter((bar) => bar.pianoFlourish)) {
    const targetBar = planBar.pianoFlourish!.targetBar;
    const arrivalNotes = pianoCandidates.filter((candidate) => candidate.bar === targetBar && candidate.hand === 'rh'
      && candidate.roleTag === 'arrival' && !candidate.drop);
    const targetPitch = arrivalNotes.length ? Math.max(...arrivalNotes.map((candidate) => candidate.pitch)) : null;
    const chamberSonata = template.id === 'ensemble.chamber' || template.id === 'ensemble.sonata';
    const rhCeiling = Math.min(chamberSonata ? 84 : 96, pianoHi, pianoTrack?.highestNote ?? 108);
    const rhFloor = Math.max(PIANO_RH[0], pianoLo, pianoTrack?.lowestNote ?? 0);
    const diatonic = targetPitch === null ? [] : Array.from({ length: Math.max(0, targetPitch - rhFloor + 1) }, (_, index) => rhFloor + index)
      .filter((pitch) => pitch <= targetPitch && pitch <= rhCeiling && scalePcs.has(pcOf(pitch)));
    const runPitches = targetPitch !== null && targetPitch <= rhCeiling && diatonic.at(-1) === targetPitch
      ? diatonic.slice(-8) : [];
    const runWindowTicks = Math.min(2 * beat, btBar);
    if (!flourishTemplates.has(template.id) || targetPitch === null || runPitches.length !== 8 || runWindowTicks < 8) {
      delete planBar.pianoFlourish;
      continue;
    }

    const barEnd = planBar.bar * btBar;
    const runStart = barEnd - runWindowTicks;
    const runEvents = runPitches.map((pitch, index) => {
      const startTick = runStart + Math.floor(index * runWindowTicks / runPitches.length);
      const endTick = runStart + Math.floor((index + 1) * runWindowTicks / runPitches.length);
      return { pitch, startTick, durationTicks: Math.max(1, endTick - startTick) };
    });
    // A piano-owned flourish must not introduce a forbidden octave with a
    // rostered part. Drop only this optional run when no collision-free walk
    // exists; the source tracks and the downbeat arrival remain untouched.
    if (runEvents.some((event) => hasExternalHardOctave(event.pitch, event.startTick, event.durationTicks))) {
      delete planBar.pianoFlourish;
      continue;
    }
    // The preceding RH chord/figure releases at the written run start; LH
    // candidates are deliberately untouched. No previous RH event can ring
    // into the monophonic scale walk.
    for (const candidate of pianoCandidates) {
      if (candidate.bar !== planBar.bar || candidate.hand !== 'rh' || candidate.drop) continue;
      if (candidate.startTick >= runStart) {
        candidate.drop = true;
      } else if (candidate.startTick + candidate.durationTicks > runStart) {
        candidate.durationTicks = runStart - candidate.startTick;
        if (candidate.durationTicks < 1) candidate.drop = true;
      }
    }
    for (const [index, event] of runEvents.entries()) {
      pianoCandidates.push({
        ...event,
        roleTag: 'flourish', hand: 'rh', bar: planBar.bar,
        strikeId: `piano-flourish:${planBar.bar}:${index}`, collisionAlternatives: [],
      });
    }
  }

  // Raise one complete RH chord strike in the final chorus, if every note
  // clears the template ceiling and the shift creates no piano RH collision.
  if (flourishTemplates.has(template.id) && pianoTrack) {
    const choruses = ctx.sections.filter((section) => isChorusTypeK(section.name)).sort((a, b) => a.startBar - b.startBar);
    const lastChorus = choruses.at(-1);
    if (lastChorus) {
      const upper = Math.min(template.id === 'ensemble.chamber' || template.id === 'ensemble.sonata' ? 84 : 96,
        pianoHi, pianoTrack.highestNote);
      const flourishLandingBars = new Set(plan.bars.filter((bar) => bar.pianoFlourish)
        .map((bar) => bar.pianoFlourish!.targetBar));
      const groups = new Map<string, KeysCandidate[]>();
      for (const candidate of pianoCandidates) {
        if (candidate.drop || candidate.hand !== 'rh' || !candidate.strikeId
          || !['anchor', 'arrival'].includes(candidate.roleTag ?? '')
          || candidate.bar === undefined || candidate.bar < lastChorus.startBar
          || candidate.bar >= lastChorus.startBar + lastChorus.lengthBars) continue;
        const groupBar = planByBar.get(candidate.bar);
        if (groupBar?.voices.piano === 'final' || groupBar?.pianoArrival === 'closingChord') continue;
        if (candidate.roleTag === 'arrival' && flourishLandingBars.has(candidate.bar)) continue;
        groups.set(candidate.strikeId, [...(groups.get(candidate.strikeId) ?? []), candidate]);
      }
      const orderedGroups = [...groups.entries()].filter(([, group]) => group.length >= 2)
        .sort((a, b) => Math.max(...b[1].map((candidate) => candidate.startTick)) - Math.max(...a[1].map((candidate) => candidate.startTick))
          || a[0].localeCompare(b[0]));
      const hasForbiddenCollision = (group: KeysCandidate[]): boolean => {
        const groupSet = new Set(group);
        for (const candidate of group) {
          const shiftedPitch = candidate.pitch + 12;
          if (shiftedPitch > upper || shiftedPitch > pianoTrack.highestNote) return true;
          for (const other of pianoCandidates) {
            if (groupSet.has(other) || other.drop || !intervalsOverlap(candidate, other)) continue;
            const interval = Math.abs(shiftedPitch - other.pitch);
            if (interval === 0 || (other.hand === 'rh' && [11, 13].includes(interval))) return true;
          }
        }
        return false;
      };
      const selected = orderedGroups.find(([, group]) => !hasForbiddenCollision(group));
      if (selected) {
        for (const candidate of selected[1]) {
          candidate.pitch += 12;
          candidate.roleTag = 'shift';
          candidate.collisionAlternatives = (candidate.collisionAlternatives ?? [])
            .map((pitch) => pitch + 12).filter((pitch) => pitch <= upper && pitch <= pianoTrack.highestNote);
          if (candidate.rootPitch !== undefined) candidate.rootPitch += 12;
        }
      }
    }
  }

  const flourishTake = project.orchestration?.take ?? 0;
  const flourishPlanIndex = plan.reports.findIndex((line) => line.startsWith(`keys piano flourishes planned (take ${flourishTake}):`));
  if (flourishPlanIndex >= 0) {
    plan.reports[flourishPlanIndex] = `keys piano flourishes planned (take ${flourishTake}): ${plan.bars.filter((bar) => bar.pianoFlourish).map((bar) => `b${bar.bar}->b${bar.pianoFlourish!.targetBar}`).join(', ') || 'none'}`;
  }

  /** An answer is an indivisible line: if concurrency or a collision pass
   *  cuts any beat (especially its held final note), omit the whole answer. */
  const dropIncompleteAnswerLines = (candidates: KeysCandidate[]): number => {
    let dropped = 0;
    for (const bar of plan.bars) {
      const answer = bar.pianoAnswer;
      if (!answer) continue;
      const group = candidates.filter((candidate) => candidate.roleTag === 'answer' && candidate.bar === bar.bar && !candidate.drop)
        .sort((a, b) => a.startTick - b.startTick);
      const start = (bar.bar - 1) * btBar;
      const complete = answer.pitches.length >= 3 && answer.pitches.length <= 5
        && group.length === answer.pitches.length
        && group.every((candidate, index) => candidate.startTick + candidate.durationTicks
          === Math.min(answer.windowEndTick, start + (index + 1) * beat));
      if (!complete) {
        for (const candidate of group) { candidate.drop = true; dropped++; }
      }
    }
    return dropped;
  };

  /* ---------------- written-schedule polyphony cap ---------------------- */
  const pianoRaw = candidatesByPart.piano;
  const punctuationLimit = template.id === 'ensemble.vocalbacking'
    ? PIANO_PUNCTUATION_SHARE.vocalbacking : PIANO_PUNCTUATION_SHARE.default;
  if (pianoRaw?.length) {
    const dropped = enforcePianoConcurrency(pianoRaw);
    const punctuationCap = capPianoPunctuation(pianoRaw, punctuationLimit);
    const droppedAnswerNotes = dropIncompleteAnswerLines(pianoRaw);
    candidatesByPart.piano = pianoRaw.filter((c) => !c.drop);
    reports.push(`keys piano: written cap enforced over ${pianoRaw.length} notes (${dropped + droppedAnswerNotes} dropped)`);
    const punctuationTotal = punctuationCap.baseStrikes + punctuationCap.punctuationStrikes;
    const punctuationPct = punctuationTotal ? (100 * punctuationCap.punctuationStrikes / punctuationTotal).toFixed(1) : '0.0';
    reports.push(`keys piano punctuation cap: ${punctuationCap.punctuationStrikes}/${punctuationTotal} strike groups (${punctuationPct}%, limit ${Math.round(punctuationLimit * 100)}%; ${punctuationCap.dropped} notes removed)`);
  }

  /* ---------------- phase B: velocities over the whole mix ---------------- */

  const rosterRoles = new Set(template.roster.map((r) => r.role));
  const byRole = (notesById: Record<string, Note[]>) =>
    Object.entries(notesById)
      .map(([id, notes]) => ({ role: project.tracks.find((t) => t.id === id)?.role ?? '', notes }))
      .filter((r) => rosterRoles.has(r.role));
  const others = [
    ...ruleNotes.filter((r) => rosterRoles.has(r.role)),
    ...byRole(stringsNotes),
    ...byRole(brassNotes),
    ...byRole(windNotes),
    ...byRole(percNotes),
  ];
  const allKeys = KEYS_PARTS.map((p) => ({ role: p, notes: candidatesByPart[p] ?? [] })).filter((r) => r.notes.length);
  // The plan supplies the immutable golden105 piano-role beat map. Mark a
  // new held strike as baseline presence if any beat window it overlaps had
  // the old piano role; otherwise it is new energy for piano-only absorption.
  const goldenPianoRoleBeats = new Set(plan.golden105PianoRoleBeats);
  const winOf = (tick: number): { bar: number; winStart: number } => {
    const bar = Math.min(bars, Math.max(1, Math.floor(tick / btBar) + 1));
    const barStart = (bar - 1) * btBar;
    const idx = Math.min(3, Math.floor((tick - barStart) / beat));
    return { bar, winStart: barStart + idx * beat };
  };
  const pianoCands = candidatesByPart.piano ?? [];
  for (const c of pianoCands) {
    const w0 = winOf(c.startTick);
    const wEnd = winOf(Math.max(c.startTick, c.startTick + c.durationTicks - 1));
    let baselinePresence = false;
    for (let bar = w0.bar; bar <= wEnd.bar && !baselinePresence; bar++) {
      const barStart = (bar - 1) * btBar;
      const from = bar === w0.bar ? w0.winStart : barStart;
      const to = bar === wEnd.bar ? wEnd.winStart : barStart + btBar - beat;
      for (let windowStart = from; windowStart <= to; windowStart += beat) {
        if (goldenPianoRoleBeats.has(windowStart)) { baselinePresence = true; break; }
      }
    }
    c.absorb = !baselinePresence;
  }

  interface AbsorbWindow { start: number; end: number; bound: number; pianoIdx: number[] }
  const windows: AbsorbWindow[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const barStart = bar * btBar;
    for (let off = 0; off < btBar; off += beat) {
      const start = barStart + off;
      if (start >= endTick) continue;
      const end = Math.min(endTick, start + beat);
      const roles = new Set<string>();
      for (const r of others) if (r.notes.some((n) => n.startTick < end && n.startTick + n.durationTicks > start)) roles.add(r.role);
      const pianoIdx: number[] = [];
      for (const r of allKeys) {
        const cands = r.notes;
        for (let i = 0; i < cands.length; i++) {
          const c = cands[i];
          if (c.startTick < end && c.startTick + c.durationTicks > start) {
            // Match the old role set exactly: baseline piano strikes count
            // as a piano role; newly added strikes remain outside the bound
            // and are capped by compose's piano-only absorption pass.
            if (!(r.role === 'piano' && c.absorb)) roles.add(r.role);
            if (r.role === 'piano') pianoIdx.push(i);
          }
        }
      }
      windows.push({ start, end, bound: roles.size ? maxMeanVelocityFor(N, clampMax, roles.size) : 127, pianoIdx });
    }
  }
  const boundAt = (tick: number): number => {
    let b = 127;
    for (const w of windows) {
      if (tick >= w.start && tick < w.end) b = Math.min(b, w.bound);
    }
    return b;
  };

  // pass 1: shaped velocities, using the golden105 role-presence windows
  // for the harp-compatible bounds (new piano presence is absorbed later).
  for (const part of KEYS_PARTS) {
    const candidates = candidatesByPart[part];
    if (!candidates) continue;
    for (const c of candidates) {
      const bar = Math.min(bars, Math.max(1, Math.floor(c.startTick / btBar) + 1));
      const bound = boundAt(Math.min(endTick - 1, c.startTick));
      const norm = planByBar.get(bar)?.norm ?? 0;
      let v: number;
      if (c.moment) v = Math.min(momentVelocity(bar), bound);
      else if (c.relief) {
        // The high-drive vocalbacking harp relief is kept within its golden105
        // velocity-only allowance; piano and other templates retain the absolute level.
        const reliefBase = part === 'harp' && template.id === 'ensemble.vocalbacking' && norm >= 0.9 ? 86 : RELIEF_VELOCITY;
        v = Math.max(1, Math.round(reliefBase * (c.ramp !== undefined ? 0.45 + 0.35 * c.ramp : 1) * (c.velScale ?? 1)));
      } else {
        const shaped = Math.max(1, Math.round(1 + (Math.min(bound, KEYS_VELOCITY_CEILING) - 1) * Math.min(1, Math.max(0, norm))));
        const accent = c.articulation === 'marcato' ? 8 : 0;
        const rampScale = c.ramp !== undefined ? 0.45 + 0.35 * c.ramp : 1;
        // §16.6 (11.5): the high-octave dry pluck sparkle softens at low
        // energy (0.7 below the mid gate — soft, dry, never leading)
        const softScale = c.soft && norm < KEYS_GATES.mid ? 0.7 : 1;
        v = Math.max(1, Math.round(Math.min(bound, shaped + accent) * rampScale * softScale));
      }
      c.v = Math.max(1, Math.min(127, c.relief || c.moment ? v : Math.min(v, bound)));
    }
  }

  // pass 2: micro-timing and final note events. The written note end is
  // unchanged by jitter, so all notes in a strike keep a common release.
  const renderedRoleCounts: Record<NoteRoleTag, number> = {
    anchor: 0, lift: 0, settle: 0, bed: 0, atmosphere: 0, arrival: 0, punctuation: 0, power: 0, answer: 0, flourish: 0, shift: 0,
  };
  for (const part of KEYS_PARTS) {
    const track = trackOf.get(part);
    const candidates = candidatesByPart[part];
    if (!track || !candidates) continue;
    const prof = KEYS_PROFILES[part];
    const [msLo, msHi] = prof.timingMs;
    const ordered = [...candidates].filter((c) => !c.drop).sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
    for (const c of ordered) {
      const writtenStart = c.startTick;
      const writtenEnd = writtenStart + c.durationTicks;
      const bar = Math.min(bars, Math.max(1, Math.floor(writtenStart / btBar) + 1));
      const h = hashString(`${track.id}|${writtenStart}|${c.pitch}`);
      const ms = msLo + (h / 0xffffffff) * (msHi - msLo);
      const jitter = Math.max(0, Math.round(msToTicks(ms, project.tempoMap)));
      const barStart = (bar - 1) * btBar;
      const barEnd = Math.min(endTick, bar * btBar);
      c.startTick = Math.max(barStart, Math.min(barEnd - 1, writtenStart + jitter));
      c.durationTicks = Math.max(1, Math.min(c.holdToSpan ? endTick : barEnd, writtenEnd) - c.startTick);
    }

    if (part === 'piano') {
      const before = ordered.length;
      const dropped = enforcePianoConcurrency(ordered);
      capPianoPunctuation(ordered, punctuationLimit);
      const harpTrack = trackOf.get('harp');
      const harpNotes = harpTrack ? (notesByTrackId[harpTrack.id] ?? []) : [];
      const collisionAudit = repairPianoOverlaps(
        ordered,
        harpNotes,
        track.lowestNote,
        track.highestNote,
        [],
        forbidOctaveDoubling,
        ctx,
        btBar,
      );
      dropIncompleteAnswerLines(ordered);
      const finalCandidates = ordered.filter((c) => !c.drop);
      const pianoOutputCandidates = [...finalCandidates].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
      const notes: Note[] = pianoOutputCandidates.map((c) => ({
        pitch: c.pitch,
        startTick: c.startTick,
        durationTicks: c.durationTicks,
        velocity: c.v ?? 1,
        roleTag: c.roleTag ?? 'anchor',
        ...(c.articulation !== undefined ? { articulation: c.articulation } : {}),
        ...(c.layer !== undefined ? { layer: c.layer } : {}),
      }));
      pianoOctaveRepairCandidates = pianoOutputCandidates.map((candidate) => ({
        pitch: candidate.pitch,
        startTick: candidate.startTick,
        durationTicks: candidate.durationTicks,
        alternatives: [...(candidate.collisionAlternatives ?? [])],
        roleTag: candidate.roleTag ?? 'anchor',
        ...(candidate.hand ? { hand: candidate.hand } : {}),
        ...(candidate.heldBodyLowest ? { heldBodyLowest: true } : {}),
      }));
      notesByTrackId[track.id] = notes;
      for (const n of notes) renderedRoleCounts[n.roleTag ?? 'anchor']++;
      reports.push(`keys piano: post-jitter cap enforced over ${before} notes (${dropped} dropped)`);
      reports.push(`keys piano collision repair: shifted ${collisionAudit.shifted}, shortened ${collisionAudit.shortened}, dropped ${collisionAudit.dropped}; same-pitch pairs remaining ${collisionAudit.remainingSamePitchPairs}`);
      reports.push(`keys piano punctuation harp yields (take ${project.orchestration?.take ?? 0}): ${collisionAudit.harpYields.join(', ') || 'none'}`);
      const punctuationStrikes = new Set(finalCandidates.filter((c) => c.roleTag === 'punctuation').map(pianoStrikeId)).size;
      const totalStrikes = new Set(finalCandidates.map(pianoStrikeId)).size;
      const punctuationShare = totalStrikes ? (100 * punctuationStrikes / totalStrikes).toFixed(1) : '0.0';
      reports.push(`keys piano punctuation vs total strikes: ${punctuationStrikes}/${totalStrikes} (${punctuationShare}%); limit ${Math.round(punctuationLimit * 100)}%`);
    } else {
      const notes: Note[] = ordered.map((c) => ({
        pitch: c.pitch,
        startTick: c.startTick,
        durationTicks: c.durationTicks,
        velocity: c.v ?? 1,
        ...(c.articulation !== undefined ? { articulation: c.articulation } : {}),
        ...(c.layer !== undefined ? { layer: c.layer } : {}),
      }));
      notesByTrackId[track.id] = sanitizeNotes(notes, track.lowestNote, track.highestNote, endTick);
    }
    const count = notesByTrackId[track.id].length;
    if (count) reports.push(`keys ${part}: ${count} notes (range ${track.lowestNote}-${track.highestNote}, lag ${msLo}-${msHi} ms)`);
  }
  reports.push(`keys piano role events (take ${project.orchestration?.take ?? 0}): ${Object.entries(renderedRoleCounts).map(([role, count]) => `${role}=${count}`).join(', ')}`);
  reports.push(`keys piano flourish/shift events (take ${project.orchestration?.take ?? 0}): flourish=${renderedRoleCounts.flourish}, shift=${renderedRoleCounts.shift}`);
  const answerNotes = Object.values(notesByTrackId).flat().filter((note) => note.roleTag === 'answer');
  const answerNoteCounts = { leadEcho: 0, chordToneFragment: 0 };
  const answerBars = new Set<number>();
  for (const note of answerNotes) {
    const bar = Math.floor(note.startTick / btBar) + 1;
    const kind = planByBar.get(bar)?.pianoAnswer?.kind;
    if (kind) answerNoteCounts[kind]++;
    answerBars.add(bar);
  }
  reports.push(`keys piano answer role events (take ${project.orchestration?.take ?? 0}): leadEcho=${answerNoteCounts.leadEcho} notes, chordToneFragment=${answerNoteCounts.chordToneFragment} notes; completed lines=${answerBars.size}`);

  return {
    notesByTrackId,
    reports,
    pianoOctaveRepairCandidates,
    absorbWindows: windows.filter((w) => w.pianoIdx.length > 0).map((w) => ({ start: w.start, end: w.end })),
  };
}

export interface PianoOctaveRepairReport { shifted: number; remainingHardPairs: number }

/** Revoice piano candidates against the final other-part timing. Strings are
 * humanized and legato-extended after the keys module runs, so this pass must
 * see their completed notes rather than their pre-humanized input. */
export function repairPianoOctavesAfterHumanize(input: {
  ctx: OrchestratorContext;
  template: NonNullable<OrchestratorContext['template']>;
  pianoTrackId: string;
  pianoNotes: Note[];
  candidates: PianoOctaveRepairCandidate[];
  otherNotes: { role: string; trackId: string; notes: Note[] }[];
}): PianoOctaveRepairReport {
  const { ctx, template, pianoTrackId, pianoNotes, candidates, otherNotes } = input;
  const forbidden = template.rules.some((rule) => rule.type === 'octaveDoubling' && rule.params.policy === 'forbidden');
  if (!forbidden || !pianoNotes.length) return { shifted: 0, remainingHardPairs: 0 };
  const pianoTrack = ctx.project.tracks.find((track) => track.id === pianoTrackId);
  if (!pianoTrack) return { shifted: 0, remainingHardPairs: 0 };

  interface RepairNote { note: Note; trackId: string; candidate?: PianoOctaveRepairCandidate }
  const piano = pianoNotes.map((note, index): RepairNote => ({ note, trackId: pianoTrackId, candidate: candidates[index] }));
  const rosterRoles = new Set(template.roster.map((entry) => entry.role));
  const external: RepairNote[] = otherNotes
    .filter((entry) => entry.role !== 'piano' && rosterRoles.has(entry.role))
    .flatMap((entry) => entry.notes.map((note) => ({ note, trackId: entry.trackId })));
  const all = [...piano, ...external];
  const btBar = barTicks(ctx.project.timeSignature);
  const spanAt = (tick: number) => ctx.spans.find((span) => span.startTick <= tick && tick < span.endTick) ?? null;
  const octaveInterval = (a: number, b: number) => Math.abs(a - b) > 0 && Math.abs(a - b) % 12 === 0;

  const isHardOctave = (a: RepairNote, b: RepairNote, override?: { target: RepairNote; pitch: number }): boolean => {
    const pitchA = override?.target === a ? override.pitch : a.note.pitch;
    const pitchB = override?.target === b ? override.pitch : b.note.pitch;
    if (!intervalsOverlap(a.note, b.note) || !octaveInterval(pitchA, pitchB)) return false;
    const tick = Math.max(a.note.startTick, b.note.startTick);
    const forcedAt = (at: number): boolean => {
      const span = spanAt(at);
      if (!span) return false;
      const tonePcs = chordTones(span.parsed).tones.map((tone) => tone.pc);
      if (!tonePcs.includes(pcOf(pitchA))) return false;
      const head = humanizeHeadTicks(ctx.project.tempoMap, at);
      const sounding = all.filter((item) => item.note.startTick <= at + head
        && item.note.startTick + item.note.durationTicks > at).length;
      return sounding > tonePcs.length;
    };
    const head = humanizeHeadTicks(ctx.project.tempoMap, tick);
    if (forcedAt(tick) || forcedAt(tick - head)) return false;
    if (a.trackId !== b.trackId) {
      const shortNote = a.note.durationTicks <= b.note.durationTicks ? a.note : b.note;
      const longNote = shortNote === a.note ? b.note : a.note;
      const chord = spanAt(tick);
      if (shortNote.durationTicks <= btBar / 2 && longNote.durationTicks > shortNote.durationTicks
        && chord && chordTones(chord.parsed).tones.some((tone) => tone.pc === pcOf(shortNote.pitch))) return false;
    }
    return true;
  };
  const pianoByStart = [...piano].sort((a, b) => a.note.startTick - b.note.startTick);
  const externalByStart = [...external].sort((a, b) => a.note.startTick - b.note.startTick);
  const hardPairs = (): { a: RepairNote; b: RepairNote }[] => {
    const pairs: { a: RepairNote; b: RepairNote }[] = [];
    for (let i = 0; i < pianoByStart.length; i++) {
      const a = pianoByStart[i];
      for (let j = i + 1; j < pianoByStart.length && pianoByStart[j].note.startTick < a.note.startTick + a.note.durationTicks; j++) {
        const b = pianoByStart[j];
        if (isHardOctave(a, b)) pairs.push({ a, b });
      }
      for (const b of externalByStart) {
        if (b.note.startTick >= a.note.startTick + a.note.durationTicks) break;
        if (isHardOctave(a, b)) pairs.push({ a, b });
      }
    }
    return pairs;
  };
  const isRh = (item: RepairNote): boolean => item.candidate?.hand === 'rh'
    || (item.candidate?.hand === undefined && item.note.pitch >= (template.id === 'ensemble.vocalbacking' ? 82 : 64));
  const hasPianoPitchCollision = (candidate: RepairNote, pitch: number): boolean => piano.some((other) => {
    if (other === candidate || !intervalsOverlap(candidate.note, other.note)) return false;
    const interval = Math.abs(pitch - other.note.pitch);
    return interval === 0 || (isRh(candidate) && isRh(other) && [11, 13].includes(interval));
  });
  const repairRank = (item: RepairNote): number => {
    if (item.candidate?.heldBodyLowest) return 0;
    if (item.candidate?.roleTag === 'anchor' && item.candidate.hand === 'lh') return 1;
    if (item.candidate?.roleTag === 'anchor' && item.candidate.hand === 'rh') return 2;
    if (item.candidate?.roleTag === 'arrival') return 3;
    if (item.candidate?.roleTag === 'punctuation') return 4;
    if (item.candidate?.roleTag === 'power') return 5;
    return 6;
  };
  const externalConflict = (candidate: RepairNote): boolean => externalByStart.some((other) => isHardOctave(candidate, other));
  const snapshotPitches = () => piano.map((item) => item.note.pitch);
  const restorePitches = (snapshot: number[]) => piano.forEach((item, index) => { item.note.pitch = snapshot[index]; });
  const tryRevoice = (candidate: RepairNote, pitch: number, visited: Set<RepairNote>): boolean => {
    if (visited.has(candidate) || visited.size >= 4) return false;
    const original = snapshotPitches();
    candidate.note.pitch = pitch;
    if (hasPianoPitchCollision(candidate, pitch) || externalConflict(candidate)) {
      restorePitches(original);
      return false;
    }
    const nextVisited = new Set(visited);
    nextVisited.add(candidate);
    let guard = 0;
    while (guard++ < piano.length) {
      const blocker = piano.find((other) => other !== candidate && isHardOctave(candidate, other));
      if (!blocker) return true;
      if (nextVisited.has(blocker) || !blocker.candidate) {
        restorePitches(original);
        return false;
      }
      const choices = [...new Set(blocker.candidate.alternatives)]
        .filter((alternative) => alternative !== blocker.note.pitch && alternative >= pianoTrack.lowestNote && alternative <= pianoTrack.highestNote);
      let blockerResolved = false;
      for (const alternative of choices) {
        const branch = snapshotPitches();
        if (tryRevoice(blocker, alternative, nextVisited) && !isHardOctave(candidate, blocker)) {
          blockerResolved = true;
          break;
        }
        restorePitches(branch);
      }
      if (!blockerResolved) {
        restorePitches(original);
        return false;
      }
    }
    restorePitches(original);
    return false;
  };

  const emergencyBodyAlternatives = (item: RepairNote): number[] => {
    if (item.candidate?.roleTag !== 'anchor' || item.candidate.hand !== 'lh') return [];
    const span = spanAt(item.note.startTick);
    if (!span) return [];
    const thirdPcs = chordTones(span.parsed).tones.filter((tone) => tone.tier === 'third').map((tone) => tone.pc);
    const low = Math.max(40, pianoTrack.lowestNote);
    const high = Math.min(template.id === 'ensemble.vocalbacking' ? 56 : 55, pianoTrack.highestNote);
    const pitches: number[] = [];
    for (const pc of thirdPcs) for (let pitch = low; pitch <= high; pitch++) {
      if (pcOf(pitch) === pc && pitch !== item.note.pitch) pitches.push(pitch);
    }
    return pitches.sort((a, b) => Math.abs(a - item.note.pitch) - Math.abs(b - item.note.pitch) || a - b);
  };
  let shifted = 0;
  for (let pass = 0; pass < piano.length * 2; pass++) {
    const pairs = hardPairs();
    if (!pairs.length) break;
    let repaired = false;
    for (const pair of pairs) {
      const victims = pair.b.trackId === pianoTrackId
        ? [pair.a, pair.b].sort((a, b) => repairRank(b) - repairRank(a))
        : [pair.a];
      for (const victim of victims) {
        const meta = victim.candidate;
        if (!meta) continue;
        const repairChoices = [...new Set([...meta.alternatives, ...emergencyBodyAlternatives(victim)])]
          .filter((pitch) => pitch !== victim.note.pitch && pitch >= pianoTrack.lowestNote && pitch <= pianoTrack.highestNote);
        for (const alternative of repairChoices) {
          const before = snapshotPitches();
          if (!tryRevoice(victim, alternative, new Set())) continue;
          let changed = 0;
          piano.forEach((item, index) => {
            if (item.note.pitch !== before[index]) {
              if (item.candidate) item.candidate.pitch = item.note.pitch;
              changed++;
            }
          });
          shifted += changed;
          repaired = true;
          break;
        }
        if (repaired) break;
      }
      if (repaired) break;
    }
    if (!repaired) break;
  }
  const remainingPairs = hardPairs();
  return { shifted, remainingHardPairs: remainingPairs.length };
}

/**
 * Phase 11.6a piano-only absorption. The historical window governors did not
 * see the newly written held piano/figure layers, so the piano absorbs any
 * remaining clamp excess while harp and other tracks stay untouched. Compute
 * every window's cap from the original piano velocities, then apply the
 * strictest overlapping cap once per note. This avoids window-order effects:
 * a transient note in an earlier beat cannot change the later velocity of a
 * sustained anchor or figure. The final keys governor remains the hard guard.
 */
export interface PianoAbsorptionReport { windows: number; loweredWindows: number; loweredNotes: number }

export function absorbPianoVelocities(input: {
  template: NonNullable<OrchestratorContext['template']>;
  piano: { role: string; notes: Note[] };
  harp: { role: string; notes: Note[] } | null;
  otherNotes: { role: string; notes: Note[] }[];
  windows: { start: number; end: number }[];
}): PianoAbsorptionReport {
  const { template, piano, harp, otherNotes, windows } = input;
  const clampMax = template.budget.energyClamp[1];
  const N = template.roster.length;
  const rosterRoles = new Set(template.roster.map((r) => r.role));
  const others = otherNotes.filter((r) => rosterRoles.has(r.role));
  const harpNotes = harp && rosterRoles.has(harp.role) ? harp.notes : [];
  const scaleByIndex = piano.notes.map(() => 1);
  const cappedWindows: number[][] = [];
  const loweredNoteSet = new Set<Note>();
  // Solve every beat against the original piano velocities, then apply each
  // note's strictest overlapping cap once. Sequentially mutating held notes
  // made a moment-only string tail in an earlier beat change a later piano
  // figure's velocity, even though that figure's own mix window was identical.
  for (const w of windows) {
    const roles = new Set<string>();
    let otherSum = 0;
    let otherCount = 0;
    let harpSum = 0;
    let harpCount = 0;
    const pianoIdx: number[] = [];
    for (const r of others) {
      for (const n of r.notes) {
        if (n.startTick < w.end && n.startTick + n.durationTicks > w.start) { roles.add(r.role); otherSum += n.velocity; otherCount++; }
      }
    }
    for (const n of harpNotes) {
      if (n.startTick < w.end && n.startTick + n.durationTicks > w.start) { roles.add('harp'); harpSum += n.velocity; harpCount++; }
    }
    piano.notes.forEach((n, i) => {
      if (n.startTick < w.end && n.startTick + n.durationTicks > w.start) { roles.add('piano'); pianoIdx.push(i); }
    });
    const count = otherCount + harpCount + pianoIdx.length;
    if (!count || !roles.size || !pianoIdx.length) continue;
    const allowedKeys = (127 * clampMax * N * count) / roles.size - otherSum;
    const pianoAllowed = allowedKeys - harpSum;
    const pianoSum = pianoIdx.reduce((a, i) => a + piano.notes[i].velocity, 0);
    if (pianoSum <= pianoAllowed) continue;
    const cap = Math.max(0, pianoAllowed) / pianoSum;
    for (const i of pianoIdx) scaleByIndex[i] = Math.min(scaleByIndex[i], cap);
    cappedWindows.push(pianoIdx);
  }
  const loweredIndices = new Set<number>();
  piano.notes.forEach((n, i) => {
    const next = Math.max(1, Math.floor(n.velocity * scaleByIndex[i]));
    if (next < n.velocity) {
      loweredIndices.add(i);
      loweredNoteSet.add(n);
    }
    n.velocity = next;
  });
  const loweredWindows = cappedWindows.filter((indices) => indices.some((i) => loweredIndices.has(i))).length;
  return { windows: windows.length, loweredWindows, loweredNotes: loweredNoteSet.size };
}

/**
 * The final keys safety pass (§16.8): re-checks every beat window over the
 * FINAL notes (the strings' humanize/legato may have moved attacks across
 * window boundaries) and lowers KEYS ALONE where the mix would breach the
 * hard clamp. With properly capped velocities this never fires — it is the
 * clamp's guarantee, not a shaper.
 */
export function governKeysVelocities(input: {
  project: Project;
  template: NonNullable<OrchestratorContext['template']>;
  keys: { role: string; notes: Note[] }[];
  otherNotes: { role: string; notes: Note[] }[];
}): void {
  const { project, template, keys, otherNotes } = input;
  const clampMax = template.budget.energyClamp[1];
  const N = template.roster.length;
  const rosterRoles = new Set(template.roster.map((r) => r.role));
  const btBar = barTicks(project.timeSignature);
  const bars = projectBars(project);
  const endTick = bars * btBar;
  const bt = beatTicks(project.timeSignature);
  const others = otherNotes.filter((r) => rosterRoles.has(r.role));
  const keysRoles = keys.filter((r) => rosterRoles.has(r.role) && r.notes.length);
  if (!keysRoles.length) return;
  for (let bar = 0; bar < bars; bar++) {
    const barStart = bar * btBar;
    for (let off = 0; off < btBar; off += bt) {
      const start = barStart + off;
      if (start >= endTick) continue;
      const end = Math.min(endTick, start + bt);
      const roles = new Set<string>();
      let otherSum = 0;
      let keysSum = 0;
      let count = 0;
      for (const r of others) {
        for (const n of r.notes) {
          if (n.startTick < end && n.startTick + n.durationTicks > start) { roles.add(r.role); otherSum += n.velocity; count++; }
        }
      }
      for (const r of keysRoles) {
        for (const n of r.notes) {
          if (n.startTick < end && n.startTick + n.durationTicks > start) { roles.add(r.role); keysSum += n.velocity; count++; }
        }
      }
      if (!roles.size || !count || !keysSum) continue;
      const energy = (roles.size / N) * (((otherSum + keysSum) / count) / 127);
      if (energy <= clampMax + 1e-9) continue;
      const allowedTotal = (127 * clampMax * N * count) / roles.size;
      const targetKeys = Math.max(0, allowedTotal - otherSum);
      const scale = targetKeys / keysSum;
      if (scale >= 1) continue;
      for (const r of keysRoles) {
        for (const n of r.notes) {
          if (n.startTick < end && n.startTick + n.durationTicks > start) {
            n.velocity = Math.max(1, Math.floor(n.velocity * scale));
          }
        }
      }
    }
  }
}
