/**
 * Template rule checker (spec §6/§8 audit stage) — what NOTES ALONE can show.
 * Layer-annotated rules (fillGating, maxLayers, unisonOrnament) need the
 * Phase-7 per-bar conductor layer plan and are explicit "not checkable yet"
 * stubs here, never silent.
 *
 * Severities: energy above max = hard (spec §6), energy below floor = soft
 * (report only), octaveDoubling forbidden = hard, climaxOnly breach = soft
 * (an energy-threshold judgment), overlapAvoid = soft ("avoid", not "never").
 */
import { measureEnergy, type EnergyReport } from './measureEnergy';
import { isInstrumentTrack, type Note, type Project, type TrackFamily } from '../../shared/schema/types';
import type { EnsembleTemplate, EnsembleRule } from '../../shared/schema/ensembleTemplate';

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

function checkOctaveDoubling(p: Project, template: EnsembleTemplate, rule: EnsembleRule, report: EnergyReport): RuleFinding[] {
  const { policy, energyThreshold } = rule.params as { policy: string; energyThreshold?: number };
  if (policy === 'allowed') return [];
  const doublings = octaveDoublings(collectNotes(p, template));
  const findings: RuleFinding[] = [];
  for (const d of doublings) {
    if (policy === 'climaxOnly') {
      const w = energyAtTick(report, d.tick);
      const e = w?.energy ?? 0;
      if (w && e >= (energyThreshold ?? 1) - 1e-9) continue; // inside a climax: allowed
      findings.push({
        rule: 'octaveDoubling', severity: 'soft', tick: d.tick,
        message: `${d.a.role} + ${d.b.role} an octave apart at energy ${e.toFixed(3)} < climax threshold ${energyThreshold} (bar ${w?.bar ?? '?'})`,
      });
    } else {
      findings.push({
        rule: 'octaveDoubling', severity: 'hard', tick: d.tick,
        message: `${d.a.role} + ${d.b.role} double at the octave (policy forbids)`,
      });
    }
  }
  return findings;
}

export function checkTemplateRules(p: Project, template: EnsembleTemplate): RuleFinding[] {
  const findings: RuleFinding[] = [];

  // Budget: maxLayers needs per-bar layer annotations → explicit stub.
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
        findings.push(...checkOctaveDoubling(p, template, rule, report));
        break;
      case 'overlapAvoid':
        findings.push(...checkOverlapAvoid(p, template, rule, report));
        break;
      case 'fillGating':
        findings.push({
          rule: 'fillGating', severity: 'stub',
          message: 'fillGating: not checkable yet — needs layer annotations (which tracks are "fills") from the conductor',
        });
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
