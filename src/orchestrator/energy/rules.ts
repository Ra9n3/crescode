/**
 * Template rule checker (spec §6/§8 audit stage) — what NOTES ALONE can show,
 * plus the per-bar conductor annotation when one is handed in (D10/3b).
 * Layer-annotated rules (fillGating, maxLayers) are checked from the
 * annotation when present; without one they stay explicit "not checkable
 * yet" stubs, never silent.
 *
 * Severities: energy above max = hard (spec §6), energy below floor = soft
 * (report only), octaveDoubling forbidden = hard, climaxOnly breach = soft
 * (an energy-threshold judgment), overlapAvoid = soft ("avoid", not "never"),
 * maxLayers breach = hard (a budget), fillGating breach = hard ("only during
 * rests" is an absolute).
 *
 * D10: chord-internal octave doubling FORCED by sounding voices outnumbering
 * the chord's distinct tones is exempt from octaveDoubling findings — the
 * texture has no choice (the voicer's own mustDouble rule) and the checker,
 * without layer annotations, cannot call any particular voice "the" doubling
 * layer. A deliberate layer double — voices within the distinct-tone count —
 * is still reported exactly as before. The doubled pitch class must also be
 * a chord tone: doubling a foreign pitch class is never forced.
 *
 * climaxOnly additionally exempts SAME-TRACK SAME-ONSET pairs on chord tones:
 * one instrument's block-chord voicing inside a single chord event is a
 * register choice, not a layer decision (the rules generator's piano chords
 * voice this way). Under policy 'forbidden' that exemption does NOT apply —
 * D2's strict reading keeps in-track octave layering (the Cb+Vc case)
 * reportable there.
 */
import { measureEnergy, type EnergyReport } from './measureEnergy';
import { isInstrumentTrack, type Note, type Project, type TrackFamily } from '../../shared/schema/types';
import type { EnsembleTemplate, EnsembleRule } from '../../shared/schema/ensembleTemplate';
import { chordSpans, type ResolvedChord } from '../spine';
import { chordTones } from '../voicing/chordTones';
import { barTicks } from '../../shared/schema/meter';
import type { ConductorPlan, FillWindow } from '../conductor';
import { humanizeHeadTicks } from '../expression/timing';

export interface RuleFinding {
  /** Which rule spoke: a template rule type, 'energy', or 'maxLayers'. */
  rule: string;
  severity: 'hard' | 'soft' | 'stub';
  tick?: number;
  message: string;
}

interface RoleNote { role: string; trackId: string; family: TrackFamily; note: Note }

function collectNotes(p: Project, template: EnsembleTemplate): RoleNote[] {
  const roles = new Set(template.roster.map((r) => r.role));
  const out: RoleNote[] = [];
  for (const t of p.tracks) {
    if (!isInstrumentTrack(t) || !roles.has(t.role)) continue;
    for (const n of t.notes) out.push({ role: t.role, trackId: t.id, family: t.family, note: n });
  }
  return out.sort((a, b) => a.note.startTick - b.note.startTick);
}

const overlaps = (a: Note, b: Note) => a.startTick < b.startTick + b.durationTicks && b.startTick < a.startTick + a.durationTicks;

/** Octave-doubling instances: two notes an octave (or more, by 12s) apart,
 *  sounding together. Different tracks always count; the same track counts
 *  too (D2: the Cb+Vc octave inside `cellosBasses` is still doubling). */
// Phase 5d/5.1.3: the head humanize may add to a string attack is read
// through the tempo map at the position being checked — see
// expression/timing.ts (the old flat 60-tick constant is gone).

function octaveDoublings(notes: RoleNote[]): { tick: number; a: RoleNote; b: RoleNote }[] {
  const out: { tick: number; a: RoleNote; b: RoleNote }[] = [];
  for (let i = 0; i < notes.length; i++) {
    for (let j = i + 1; j < notes.length; j++) {
      const A = notes[i], B = notes[j];
      if (B.note.startTick >= A.note.startTick + A.note.durationTicks) break; // sorted by start: no later note overlaps A
      if (!overlaps(A.note, B.note)) continue;
      const d = Math.abs(A.note.pitch - B.note.pitch);
      if (d > 0 && d % 12 === 0) out.push({ tick: Math.max(A.note.startTick, B.note.startTick), a: A, b: B });
    }
  }
  return out;
}

function energyAtTick(report: EnergyReport, tick: number): EnergyReport['windows'][number] | null {
  for (const w of report.windows) if (tick >= w.startTick && tick < w.endTick) return w;
  return null;
}

function resolveTarget(p: Project, template: EnsembleTemplate, target: string): RoleNote[] {
  const fam = target.toLowerCase();
  const roleSet = new Set(template.roster.map((r) => r.role));
  const notes = collectNotes(p, template);
  return notes.filter((rn) => rn.family.toLowerCase() === fam || (roleSet.has(target) && rn.role === target));
}

function checkOverlapAvoid(p: Project, template: EnsembleTemplate, rule: EnsembleRule, report: EnergyReport): RuleFinding[] {
  const { actor, against, windowTicks } = rule.params as { actor: string; against: string; windowTicks: number };
  const act = resolveTarget(p, template, actor);
  const agn = resolveTarget(p, template, against);
  const againstOnsets = [...new Set(agn.map((r) => r.note.startTick))].sort((a, b) => a - b);
  const findings: RuleFinding[] = [];
  const seen = new Set<string>();
  for (const a of act) {
    for (const b of againstOnsets) {
      const d = Math.abs(a.note.startTick - b);
      if (d > windowTicks) {
        if (b > a.note.startTick + windowTicks) break; // sorted: nothing closer ahead
        continue;
      }
      const key = `${a.role}|${a.note.startTick}|${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const w = energyAtTick(report, Math.min(a.note.startTick, b));
      findings.push({
        rule: 'overlapAvoid', severity: 'soft', tick: Math.min(a.note.startTick, b),
        message: `${a.role} enters ${d} ticks from a ${against} entrance (window ${windowTicks}) at bar ${w?.bar ?? '?'} beat ${w?.beat ?? '?'}`,
      });
    }
  }
  return findings;
}

function checkOctaveDoubling(p: Project, template: EnsembleTemplate, rule: EnsembleRule, report: EnergyReport, spans: ResolvedChord[]): RuleFinding[] {
  const { policy, energyThreshold } = rule.params as { policy: string; energyThreshold?: number };
  if (policy === 'allowed') return [];
  const notes = collectNotes(p, template);
  const doublings = octaveDoublings(notes);
  const findings: RuleFinding[] = [];

  // D10: is this doubling arithmetic necessity? A chord must cover the tick,
  // the doubled pitch class must be one of its tones, and more voices must
  // be sounding than the chord has distinct tones.
  const chordAt = (tick: number): ResolvedChord | null => {
    for (const s of spans) {
      if (tick < s.startTick) return null; // sorted, non-overlapping
      if (tick < s.endTick) return s;
    }
    return null;
  };
  const voicesAt = (tick: number): number => {
    // Phase 5d/5.1.3: a humanized attack may start up to one humanize head
    // (tempo-map ticks at this position) after its written tick — it was
    // still written FOR this tick
    const head = humanizeHeadTicks(p.tempoMap, tick);
    let count = 0;
    for (const rn of notes) {
      if (rn.note.startTick > tick + head) break; // sorted by start
      if (rn.note.startTick + rn.note.durationTicks > tick) count++;
    }
    return count;
  };
  const forcedDoubling = (tick: number, pitch: number): boolean => {
    const chord = chordAt(tick);
    if (!chord) return false;
    const tonePcs = chordTones(chord.parsed).tones.map((t) => t.pc);
    const doubledPc = ((pitch % 12) + 12) % 12;
    return tonePcs.includes(doubledPc) && voicesAt(tick) > tonePcs.length;
  };
  // Phase 5d: the orchestrator humanizes string attacks LATE by up to a few
  // dozen ticks (start only), so a pair's max(start) tick can sit past the
  // grid position the notes were written for. The audit reads the written-for
  // position — the pair's EARLIEST start — and one head earlier too: a
  // doubling exempt there is exempt here.
  const exemptAt = (d: { tick: number; a: RoleNote; b: RoleNote }, pitch: number): boolean => {
    const head = humanizeHeadTicks(p.tempoMap, d.tick);
    return forcedDoubling(d.tick, pitch) || forcedDoubling(d.tick - head, pitch);
  };
  const climaxAt = (tick: number): boolean => {
    const head = humanizeHeadTicks(p.tempoMap, tick);
    for (const t of [tick, tick - head]) {
      const w = energyAtTick(report, t);
      if (w && w.energy >= (energyThreshold ?? 1) - 1e-9) return true;
    }
    return false;
  };
  // climaxOnly only: one instrument voicing a single chord event in blocks
  // (same track, same onset, chord tones) is a register choice, not a layer.
  const blockChordVoicing = (pair: { tick: number; a: RoleNote; b: RoleNote }): boolean =>
    policy === 'climaxOnly' &&
    pair.a.trackId === pair.b.trackId &&
    pair.a.note.startTick === pair.b.note.startTick &&
    chordAt(pair.tick) !== null &&
    chordTones(chordAt(pair.tick)!.parsed).tones.some((t) => t.pc === ((pair.a.note.pitch % 12) + 12) % 12);

  for (const d of doublings) {
    if (exemptAt(d, d.a.note.pitch)) continue; // D10 exemption, humanize-aware
    if (blockChordVoicing(d)) continue; // one event, one instrument, chord tones
    if (policy === 'climaxOnly') {
      const w = energyAtTick(report, d.tick);
      const e = w?.energy ?? 0;
      if (climaxAt(d.tick)) continue; // inside a climax: allowed (head-aware reading below)
      findings.push({
        rule: 'octaveDoubling', severity: 'soft', tick: d.tick,
        message: `${d.a.role} + ${d.b.role} an octave apart at energy ${e.toFixed(3)} < climax threshold ${energyThreshold} (bar ${w?.bar ?? '?'})`,
      });
    } else {
      // Figuration exemption: a SHORT chord-tone note (≤ half a bar) under a
      // LONGER note on another track is a broken-chord figure passing through
      // the register (the rules generator's harp arpeggios under the string
      // pads), not a sustained layer double — the forbidding policy targets
      // stacked pads (the Cb+Vc case), which keep their full length here.
      const shortN = d.a.note.durationTicks <= d.b.note.durationTicks ? d.a.note : d.b.note;
      const longN = shortN === d.a.note ? d.b.note : d.a.note;
      const chordHere = chordAt(d.tick);
      if (d.a.trackId !== d.b.trackId && shortN.durationTicks <= barTicks(p.timeSignature) / 2 && longN.durationTicks > shortN.durationTicks
        && chordHere !== null && chordTones(chordHere.parsed).tones.some((t) => t.pc === ((shortN.pitch % 12) + 12) % 12)) continue;
      findings.push({
        rule: 'octaveDoubling', severity: 'hard', tick: d.tick,
        message: `${d.a.role} + ${d.b.role} double at the octave (policy forbids)`,
      });
    }
  }
  return findings;
}

/**
 * maxLayers (3b): every bar of the plan must hold at most the template's
 * concurrent-layer budget. Hard: a budget breach is not shipped.
 */
function checkMaxLayers(plan: ConductorPlan, template: EnsembleTemplate): RuleFinding[] {
  const out: RuleFinding[] = [];
  for (const bar of plan.bars) {
    if (bar.layers.length > template.budget.maxLayers) {
      out.push({
        rule: 'maxLayers', severity: 'hard', tick: bar.startTick,
        message: `Bar ${bar.bar}: ${bar.layers.length} concurrent layers (${bar.layers.map((l) => l.layer).join(', ')}) exceed the budget ${template.budget.maxLayers}`,
      });
    }
  }
  return out;
}

const matchesFamilyOrRole = (target: string, role: string, family: string): boolean =>
  target.toLowerCase() === family.toLowerCase() || target === role;

/**
 * fillGating (3b): every fill window the plan reserves for this rule's actor
 * must sit inside a breath of the duringRestsOf parts that is at least
 * minGapTicks long. Hard: "only during rests" is the template's absolute.
 */
function checkFillGating(plan: ConductorPlan, rule: EnsembleRule): RuleFinding[] {
  const { fills: fillTarget, duringRestsOf, minGapTicks } = rule.params as { fills: string; duringRestsOf: string; minGapTicks: number };
  const out: RuleFinding[] = [];
  const covered = (fill: FillWindow): boolean =>
    plan.breaths.some(
      (b) =>
        b.reason === 'fillGating' &&
        matchesFamilyOrRole(duringRestsOf, b.duringRestsOf, b.duringRestsOf) &&
        b.startTick <= fill.startTick &&
        fill.endTick <= b.endTick &&
        b.endTick - b.startTick >= minGapTicks,
    );
  for (const fill of plan.fills.filter((f) => matchesFamilyOrRole(fillTarget, f.target, f.target))) {
    if (!covered(fill)) {
      out.push({
        rule: 'fillGating', severity: 'hard', tick: fill.startTick,
        message: `${fill.target} fill at ${fill.startTick}..${fill.endTick} has no ${duringRestsOf} rest ≥ ${minGapTicks} ticks around it`,
      });
    }
  }
  return out;
}

export function checkTemplateRules(p: Project, template: EnsembleTemplate, annotation?: ConductorPlan): RuleFinding[] {
  const findings: RuleFinding[] = [];
  const spans = chordSpans(p);

  // Budget: maxLayers from the conductor's per-bar plan when one is handed in;
  // without the annotation it stays an explicit stub (never silent).
  if (annotation) findings.push(...checkMaxLayers(annotation, template));
  else
    findings.push({
      rule: 'maxLayers', severity: 'stub',
      message: `maxLayers ${template.budget.maxLayers}: not checkable yet — needs the per-bar conductor layer plan (Phase 7)`,
    });

  // Energy clamp violations, phrased as rule findings.
  const report = measureEnergy(p, template);
  for (const v of report.violations) {
    findings.push({
      rule: 'energy', severity: v.severity, tick: v.startTick,
      message: v.kind === 'aboveMax' ? v.message : `${v.message} (soft report — never padded, never failed)`,
    });
  }

  for (const rule of template.rules) {
    switch (rule.type) {
      case 'octaveDoubling':
        findings.push(...checkOctaveDoubling(p, template, rule, report, spans));
        break;
      case 'overlapAvoid':
        findings.push(...checkOverlapAvoid(p, template, rule, report));
        break;
      case 'fillGating':
        findings.push(
          ...(annotation
            ? checkFillGating(annotation, rule)
            : [{ rule: 'fillGating', severity: 'stub' as const, message: 'fillGating: not checkable yet — needs layer annotations (which tracks are "fills") from the conductor' }]),
        );
        break;
      case 'unisonOrnament':
        findings.push({
          rule: 'unisonOrnament', severity: 'stub',
          message: 'unisonOrnament: not checkable yet — needs layer annotations (unison groups) from the conductor',
        });
        break;
      default:
        findings.push({ rule: rule.type, severity: 'stub', message: `${rule.type}: unknown rule type — not checkable` });
    }
  }

  return findings;
}
