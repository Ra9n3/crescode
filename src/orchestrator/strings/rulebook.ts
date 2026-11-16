import type { Note, Project } from '../../shared/schema/project';
import { VOCAL_ZONE } from '../profiles/strings';

const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const SOFT_INTRO_BOWING = ['conSord', 'sulTasto'] as const;

const median = (arr: number[]): number => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
};

export function applyStringsRulebookVariety(project: Project, take: number): void {
  const templateId = project.orchestration?.templateId ?? 'ensemble.symphony';
  const btBar = Math.round(project.timeSignature.numerator * 480 * (4 / project.timeSignature.denominator));
  const sections = project.sections ?? [];

  const byRole = (role: string) =>
    project.tracks.find((t) => t.family === 'Strings' && (t.role === role || t.id === role));
  const v1 = byRole('violins1');
  const v2 = byRole('violins2');
  const va = byRole('violas');
  const cb = byRole('cellosBasses');
  const desks = [v1, v2, va, cb].filter((t): t is NonNullable<typeof t> => !!t);
  if (!desks.length) return;

  // R2: LEAD REGISTER (cinematic, symphony, hybridstudio)
  if (v1 && (templateId === 'ensemble.cinematic' || templateId === 'ensemble.symphony' || templateId === 'ensemble.hybridstudio')) {
    for (const sec of sections) {
      const name = sec.name.toLowerCase();
      const sTick = sec.startTick;
      const eTick = sec.endTick;
      const notes = v1.notes.filter((n) => n.startTick < eTick && n.startTick + n.durationTicks > sTick);
      if (!notes.length) continue;
      const target = (name.includes('chorus') || name.includes('climax')) ? 72 : name.includes('verse') ? 67 : 0;
      if (target > 0 && median(notes.map((n) => n.pitch)) < target) {
        for (const n of notes) {
          if (n.pitch + 12 <= (v1.highestNote ?? 96)) n.pitch += 12;
        }
      }
    }
  }

  // R9: INTRO VARIETY WITH GUARDRAILS (seeded per take, no fixed recipes)
  const intro = sections.find((s) => s.name.toLowerCase().includes('intro'));
  if (intro) {
    const rng = mulberry32((take * 2654435761) >>> 0);
    const introBars = Math.max(1, Math.round((intro.endTick - intro.startTick) / btBar));
    const roleOrder = ['cellosBasses', 'violas', 'violins2', 'violins1'] as const;
    const entryBars: number[] = roleOrder.map(() => 1 + Math.floor(rng() * Math.min(6, introBars)));
    // Guardrail (a): at least 2 distinct entry bars across desks
    if (new Set(entryBars).size < 2 && introBars >= 2) {
      entryBars[entryBars.length - 1] = (entryBars[0] % Math.min(6, introBars)) + 1;
    }
    const bandOffsets = { low: 0, mid: 7, high: 12 } as const;
    const bands = ['low', 'mid', 'high'] as const;
    let prevPitch = 0;

    roleOrder.forEach((role, idx) => {
      const tr = byRole(role);
      if (!tr) return;
      const enterBar = entryBars[idx];
      const enterTick = intro.startTick + (enterBar - 1) * btBar;
      const hasNotes = tr.notes.some((n) => n.startTick >= intro.startTick && n.startTick < intro.endTick);
      if (!hasNotes && enterTick < intro.endTick) {
        const band = bands[Math.floor(rng() * bands.length)];
        const basePitch = role === 'cellosBasses' ? 40 : role === 'violas' ? 52 : role === 'violins2' ? 60 : 72;
        let pitch = Math.min(tr.highestNote ?? 96, Math.max(tr.lowestNote ?? 36, basePitch + bandOffsets[band]));
        // Guardrail (c): R1 voice order & R4 low-interval limit
        if (pitch < prevPitch) pitch = Math.min(tr.highestNote ?? 96, prevPitch);
        if (prevPitch > 0 && prevPitch < 48 && pitch - prevPitch > 0 && pitch - prevPitch <= 4) {
          pitch = Math.min(tr.highestNote ?? 96, prevPitch + 7);
        }
        prevPitch = pitch;
        const art = SOFT_INTRO_BOWING[Math.floor(rng() * SOFT_INTRO_BOWING.length)];
        tr.notes.push({
          pitch,
          startTick: enterTick,
          durationTicks: intro.endTick - enterTick,
          velocity: 48,
          articulation: art,
        });
      }
    });
  }

  // R13: VOCAL BACKING
  if (templateId === 'ensemble.vocalbacking') {
    const allowedArt = new Set(['sustain', 'legato', 'pizz', 'conSord', 'sulTasto']);
    for (const d of desks) {
      for (const n of d.notes) {
        if (n.velocity > 80) n.velocity = 78;
        if (n.articulation && !allowedArt.has(n.articulation)) n.articulation = 'legato';
        if (n.pitch >= VOCAL_ZONE[0] && n.pitch <= VOCAL_ZONE[1] && n.velocity > 60) {
          n.velocity = 58;
        }
      }
    }
  }

  // R14: COLOUR (cap sulPont <= 5% of pad bars)
  let totalNotes = 0;
  let sulPontNotes: Note[] = [];
  for (const d of desks) {
    for (const n of d.notes) {
      totalNotes++;
      if (n.articulation === 'sulPont') sulPontNotes.push(n);
    }
  }
  const maxSulPont = Math.floor(totalNotes * 0.04);
  if (sulPontNotes.length > maxSulPont) {
    for (let i = maxSulPont; i < sulPontNotes.length; i++) {
      sulPontNotes[i].articulation = 'legato';
    }
  }

  // R6: TIERS (ensure v1 foreground velocity >= middleground + 6)
  if (v1) {
    for (const n of v1.notes) {
      if (n.velocity < 78) n.velocity = Math.min(115, n.velocity + 10);
    }
    for (const d of [v2, va, cb].filter((x): x is NonNullable<typeof x> => !!x)) {
      for (const n of d.notes) {
        if (n.velocity > 70) n.velocity = 68;
      }
    }
  }
}
