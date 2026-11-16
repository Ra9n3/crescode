import type { Note, Project } from '../../shared/schema/project';
import { VOCAL_ZONE } from '../profiles/strings';

const INTRO_ORDERS: readonly (readonly string[])[] = [
  ['cellosBasses', 'violas', 'violins2', 'violins1'],
  ['cellosBasses', 'violins2', 'violas', 'violins1'],
  ['violas', 'cellosBasses', 'violins2', 'violins1'],
  ['cellosBasses', 'violas', 'violins1', 'violins2'],
];

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

  // R9: CINEMATIC INTRO (lead-free sections build as a low bed with 4 drawn entry orders + register)
  const intro = sections.find((s) => s.name.toLowerCase().includes('intro'));
  if (intro) {
    const order = INTRO_ORDERS[(take - 1) % INTRO_ORDERS.length];
    const regVariant = Math.floor((take - 1) / INTRO_ORDERS.length);
    const introBars = Math.max(1, Math.round((intro.endTick - intro.startTick) / btBar));
    order.forEach((role, idx) => {
      const tr = byRole(role);
      if (!tr) return;
      const enterBar = Math.min(introBars - 1, idx * 2);
      const enterTick = intro.startTick + enterBar * btBar;
      const hasNotes = tr.notes.some((n) => n.startTick >= intro.startTick && n.startTick < intro.endTick);
      if (!hasNotes && enterTick < intro.endTick) {
        const basePitch = role === 'cellosBasses' ? 45 : role === 'violas' ? 57 : role === 'violins2' ? 64 : 76;
        const pitch = basePitch + (regVariant % 2 === 1 && role !== 'cellosBasses' ? 12 : 0);
        tr.notes.push({
          pitch: Math.min(tr.highestNote ?? 96, Math.max(tr.lowestNote ?? 36, pitch)),
          startTick: enterTick,
          durationTicks: intro.endTick - enterTick,
          velocity: 48,
          articulation: idx % 2 === 0 ? 'conSord' : 'sulTasto',
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
