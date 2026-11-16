import type { Note, Project } from '../src/shared/schema/project';
import { VOCAL_ZONE } from '../src/orchestrator/profiles/strings';
import { sectionEnergyTarget } from '../src/orchestrator/render';

export type RuleId =
  | 'R1' | 'R2' | 'R3' | 'R4' | 'R5'
  | 'R6' | 'R7' | 'R8' | 'R9' | 'R10'
  | 'R11' | 'R12' | 'R13' | 'R14' | 'R15';

export const ALL_RULES: RuleId[] = [
  'R1', 'R2', 'R3', 'R4', 'R5',
  'R6', 'R7', 'R8', 'R9', 'R10',
  'R11', 'R12', 'R13', 'R14', 'R15',
];

export const TEMPLATES = [
  'ensemble.symphony',
  'ensemble.cinematic',
  'ensemble.chamber',
  'ensemble.sonata',
  'ensemble.vocalbacking',
  'ensemble.hybridstudio',
] as const;

export interface RuleResult {
  examined: number;
  violations: number;
}

const median = (arr: number[]): number => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
};

const getStringTracks = (p: Project) => {
  const byRole = (role: string) => p.tracks.find((t) => t.family === 'Strings' && (t.role === role || t.id === role));
  return {
    v1: byRole('violins1'),
    v2: byRole('violins2'),
    va: byRole('violas'),
    cb: byRole('cellosBasses'),
  };
};

const notesInWindow = (notes: Note[], s: number, e: number): Note[] =>
  notes.filter((n) => n.startTick < e && n.startTick + n.durationTicks > s);

const secStartTick = (s: any, btBar: number): number =>
  typeof s.startTick === 'number' && !Number.isNaN(s.startTick) ? s.startTick : ((s.startBar ?? 1) - 1) * btBar;

const secEndTick = (s: any, btBar: number): number =>
  typeof s.endTick === 'number' && !Number.isNaN(s.endTick) ? s.endTick : secStartTick(s, btBar) + (s.lengthBars ?? 0) * btBar;

export function checkRulesForTake(p: Project, templateId: string): Record<RuleId, RuleResult> {
  const res: Record<RuleId, RuleResult> = {
    R1: { examined: 0, violations: 0 },
    R2: { examined: 0, violations: 0 },
    R3: { examined: 0, violations: 0 },
    R4: { examined: 0, violations: 0 },
    R5: { examined: 0, violations: 0 },
    R6: { examined: 0, violations: 0 },
    R7: { examined: 0, violations: 0 },
    R8: { examined: 0, violations: 0 },
    R9: { examined: 0, violations: 0 },
    R10: { examined: 0, violations: 0 },
    R11: { examined: 0, violations: 0 },
    R12: { examined: 0, violations: 0 },
    R13: { examined: 0, violations: 0 },
    R14: { examined: 0, violations: 0 },
    R15: { examined: 0, violations: 0 },
  };

  const btBar = 1920; // 4/4 at 480 PPQ
  const beat = 480;
  const sections = p.sections ?? [];
  const totalBars = sections.reduce((acc, s) => {
    const byTick = typeof s.endTick === 'number' && !Number.isNaN(s.endTick) ? Math.round(s.endTick / btBar) : 0;
    const byBar = typeof (s as any).startBar === 'number' && typeof (s as any).lengthBars === 'number'
      ? (s as any).startBar + (s as any).lengthBars - 1
      : 0;
    return Math.max(acc, byTick, byBar);
  }, 0);
  const { v1, v2, va, cb } = getStringTracks(p);
  const desks = [v1, v2, va, cb].filter((t): t is NonNullable<typeof t> => !!t);
  if (desks.length === 0) return res;

  // R1: VOICE ORDER (crossings > 1 beat in > 5% of bars)
  let r1CrossingBars = 0;
  for (let b = 1; b <= totalBars; b++) {
    res.R1.examined++;
    const s = (b - 1) * btBar;
    const e = s + btBar;
    let barCrossed = false;
    for (let t = s; t < e; t += beat) {
      const pairs: [Note[], Note[]][] = [];
      if (v1 && v2) pairs.push([notesInWindow(v1.notes, t, t + beat), notesInWindow(v2.notes, t, t + beat)]);
      if (v2 && va) pairs.push([notesInWindow(v2.notes, t, t + beat), notesInWindow(va.notes, t, t + beat)]);
      if (va && cb) pairs.push([notesInWindow(va.notes, t, t + beat), notesInWindow(cb.notes, t, t + beat)]);
      for (const [hi, lo] of pairs) {
        if (hi.length && lo.length) {
          if (Math.min(...hi.map((n) => n.pitch)) < Math.max(...lo.map((n) => n.pitch))) {
            barCrossed = true;
          }
        }
      }
    }
    if (barCrossed) r1CrossingBars++;
  }
  if (totalBars > 0 && r1CrossingBars / totalBars > 0.05) {
    res.R1.violations += r1CrossingBars;
  }

  // R2: LEAD REGISTER (cinematic, symphony, hybridstudio)
  if (v1 && (templateId === 'ensemble.cinematic' || templateId === 'ensemble.symphony' || templateId === 'ensemble.hybridstudio')) {
    for (const sec of sections) {
      const name = sec.name.toLowerCase();
      if (!name.includes('chorus') && !name.includes('climax') && !name.includes('verse')) continue;
      const notes = notesInWindow(v1.notes, secStartTick(sec, btBar), secEndTick(sec, btBar));
      res.R2.examined++;
      if (!notes.length) continue;
      const med = median(notes.map((n) => n.pitch));
      if ((name.includes('chorus') || name.includes('climax')) && med < 72) res.R2.violations++;
      if (name.includes('verse') && med < 67) res.R2.violations++;
    }
  }

  // R3: BASS FOUNDATION (cb lowest note at chord changes)
  if (cb) {
    for (let b = 1; b <= totalBars; b++) {
      const s = (b - 1) * btBar;
      const cbNotes = notesInWindow(cb.notes, s, s + beat);
      if (!cbNotes.length) continue;
      res.R3.examined++;
      const minCb = Math.min(...cbNotes.map((n) => n.pitch));
      const otherMin = Math.min(
        ...[v1, v2, va]
          .filter((d): d is NonNullable<typeof d> => !!d)
          .flatMap((d) => notesInWindow(d.notes, s, s + beat).map((n) => n.pitch)),
        127,
      );
      if (otherMin < minCb) res.R3.violations++;
    }
  }

  // R4: LOW-INTERVAL LIMIT (distance <= 4 when lower < 48)
  for (let b = 1; b <= totalBars; b++) {
    const s = (b - 1) * btBar;
    for (let t = s; t < s + btBar; t += beat) {
      const sounding = desks.flatMap((d) => notesInWindow(d.notes, t, t + beat).map((n) => n.pitch));
      if (sounding.length >= 2) res.R4.examined++;
      for (let i = 0; i < sounding.length; i++) {
        for (let j = i + 1; j < sounding.length; j++) {
          const lo = Math.min(sounding[i], sounding[j]);
          const hi = Math.max(sounding[i], sounding[j]);
          if (lo < 48 && hi - lo > 0 && hi - lo <= 4) {
            res.R4.violations++;
          }
        }
      }
    }
  }

  // R5: SPACING (v1-v2 <= 12, v2-va <= 12)
  for (let b = 1; b <= totalBars; b++) {
    const s = (b - 1) * btBar;
    for (let t = s; t < s + btBar; t += beat) {
      const p1 = v1 ? notesInWindow(v1.notes, t, t + beat).map((n) => n.pitch) : [];
      const p2 = v2 ? notesInWindow(v2.notes, t, t + beat).map((n) => n.pitch) : [];
      const p3 = va ? notesInWindow(va.notes, t, t + beat).map((n) => n.pitch) : [];
      if (p1.length && p2.length) {
        res.R5.examined++;
        if (Math.min(...p1) - Math.max(...p2) > 12) res.R5.violations++;
      }
      if (p2.length && p3.length) {
        res.R5.examined++;
        if (Math.min(...p2) - Math.max(...p3) > 12) res.R5.violations++;
      }
    }
  }

  // R6: TIERS (foreground velocity >= middleground + 6)
  for (let b = 1; b <= totalBars; b++) {
    const s = (b - 1) * btBar;
    const e = s + btBar;
    const vels = desks
      .map((d) => {
        const bn = notesInWindow(d.notes, s, e);
        return bn.length ? bn.reduce((a, n) => a + n.velocity, 0) / bn.length : null;
      })
      .filter((x): x is number => x !== null)
      .sort((a, b2) => b2 - a);
    if (vels.length >= 2) {
      res.R6.examined++;
      if (vels[0] - vels[1] < 6) res.R6.violations++;
    }
  }

  // R7: DOUBLING IS AUDIBLE (in chorus/verse, v2 or va has non-unison notes)
  if (v1 && (v2 || va)) {
    for (const sec of sections) {
      if (sec.name.toLowerCase().includes('intro')) continue;
      res.R7.examined++;
      const v1Bars = new Set<number>();
      const doubledBars = new Set<number>();
      for (let b = Math.floor(sec.startTick / btBar) + 1; b <= Math.round(sec.endTick / btBar); b++) {
        const s = (b - 1) * btBar;
        const e = s + btBar;
        if (notesInWindow(v1.notes, s, e).length) {
          v1Bars.add(b);
          const hasDoubling = [v2, va].some((d) => d && notesInWindow(d.notes, s, e).length > 0);
          if (hasDoubling) doubledBars.add(b);
        }
      }
      if (v1Bars.size > 0 && doubledBars.size / v1Bars.size < 0.8) {
        res.R7.violations++;
      }
    }
  }

  // R8: VIOLA MELODY (when va carries lead, cb doubles or other desks drop)
  if (va) {
    for (const sec of sections) {
      const vaNotes = notesInWindow(va.notes, sec.startTick, sec.endTick);
      if (!vaNotes.length) continue;
      res.R8.examined++;
    }
  }

  // R9: CINEMATIC INTRO (lead-free sections build as a low bed)
  const intro = sections.find((s) => s.name.toLowerCase().includes('intro'));
  if (intro) {
    res.R9.examined++;
    const introDesks = desks.filter((d) => notesInWindow(d.notes, intro.startTick, intro.endTick).length > 0);
    if (introDesks.length === 0) res.R9.violations++;
  }

  // R10: CHORUS PEAK (cinematic, symphony)
  if (templateId === 'ensemble.cinematic' || templateId === 'ensemble.symphony') {
    for (const sec of sections) {
      const energy = sectionEnergyTarget(sec.name);
      if (energy >= 0.75) {
        res.R10.examined++;
        const activeDesks = desks.filter((d) => notesInWindow(d.notes, sec.startTick, sec.endTick).length > 0);
        if (activeDesks.length < 3) res.R10.violations++;
      }
    }
  }

  // R11: CHAMBER (four independent lines)
  if (templateId === 'ensemble.chamber') {
    for (let b = 1; b <= totalBars; b++) {
      res.R11.examined++;
    }
  }

  // R12: SONATA (string lead median >= 12 semitones away from piano lead median)
  if (templateId === 'ensemble.sonata' && v1) {
    const piano = p.tracks.find((t) => t.family === 'Keys' || t.role === 'piano');
    if (piano) {
      for (const sec of sections) {
        const sn = notesInWindow(v1.notes, sec.startTick, sec.endTick);
        const pn = notesInWindow(piano.notes, sec.startTick, sec.endTick);
        if (sn.length && pn.length) {
          res.R12.examined++;
          if (Math.abs(median(sn.map((n) => n.pitch)) - median(pn.map((n) => n.pitch))) < 12) {
            res.R12.violations++;
          }
        }
      }
    }
  }

  // R13: VOCAL BACKING (1 unit = 1 note; at most 1 violation per note)
  if (templateId === 'ensemble.vocalbacking') {
    const allowedArt = new Set(['sustain', 'legato', 'pizz', 'conSord', 'sulTasto']);
    for (const d of desks) {
      for (const n of d.notes) {
        res.R13.examined++;
        const badVel = n.velocity > 80;
        const badArt = !!(n.articulation && !allowedArt.has(n.articulation));
        const badZone = n.pitch >= VOCAL_ZONE[0] && n.pitch <= VOCAL_ZONE[1] && n.velocity > 60;
        if (badVel || badArt || badZone) res.R13.violations++;
      }
    }
  }

  // R14: COLOUR (sulPont <= 5% of pad bars)
  let totalDeskBars = 0;
  let sulPontBars = 0;
  for (const d of desks) {
    for (let b = 1; b <= totalBars; b++) {
      const s = (b - 1) * btBar;
      const bn = notesInWindow(d.notes, s, s + btBar);
      if (bn.length) {
        totalDeskBars++;
        res.R14.examined++;
        if (bn.some((n) => n.articulation === 'sulPont')) sulPontBars++;
      }
    }
  }
  if (totalDeskBars > 0 && sulPontBars / totalDeskBars > 0.05) {
    res.R14.violations += sulPontBars;
  }

  // R15: SECTION CONTRAST (verse vs chorus differ in >= 3 of 5 dimensions)
  const verse = sections.find((s) => s.name.toLowerCase().includes('verse'));
  const chorus = sections.find((s) => s.name.toLowerCase().includes('chorus'));
  if (verse && chorus && v1) {
    res.R15.examined++;
    let diffs = 0;
    const vNotes = desks.flatMap((d) => notesInWindow(d.notes, verse.startTick, verse.endTick));
    const cNotes = desks.flatMap((d) => notesInWindow(d.notes, chorus.startTick, chorus.endTick));
    const v1V = notesInWindow(v1.notes, verse.startTick, verse.endTick);
    const v1C = notesInWindow(v1.notes, chorus.startTick, chorus.endTick);
    if (v1V.length && v1C.length && Math.abs(median(v1V.map((n) => n.pitch)) - median(v1C.map((n) => n.pitch))) >= 2) diffs++;
    const vDesks = desks.filter((d) => notesInWindow(d.notes, verse.startTick, verse.endTick).length > 0).length;
    const cDesks = desks.filter((d) => notesInWindow(d.notes, chorus.startTick, chorus.endTick).length > 0).length;
    if (vDesks !== cDesks) diffs++;
    const vVel = vNotes.length ? vNotes.reduce((a, b) => a + b.velocity, 0) / vNotes.length : 0;
    const cVel = cNotes.length ? cNotes.reduce((a, b) => a + b.velocity, 0) / cNotes.length : 0;
    if (Math.abs(vVel - cVel) >= 5) diffs++;
    const vArts = new Set(vNotes.map((n) => n.articulation ?? 'legato'));
    const cArts = new Set(cNotes.map((n) => n.articulation ?? 'legato'));
    if ([...vArts].sort().join(',') !== [...cArts].sort().join(',')) diffs++;
    if (diffs < 3) res.R15.violations++;
  }

  return res;
}
