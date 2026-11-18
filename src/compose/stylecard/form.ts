/**
 * Form: the section architecture and its energy curve.
 *
 * Every section length is a multiple of 4 bars, and the bar total is the sum of
 * the section lengths by construction — so "the MIDI must contain exactly that
 * many bars" is true because the form defines the bar count, not because a
 * cleanup pass trims it afterwards.
 */
import type { Rng } from './rng';

export type SectionKind =
  | 'Intro' | 'A' | 'A2' | 'A3' | 'B' | 'B2' | 'Bridge' | 'Build' | 'Climax' | 'Outro';

export interface FormSectionPlan {
  readonly kind: SectionKind;
  readonly bars: number;
  readonly energy: number;
  readonly startBar: number;
}

export interface FormPlan {
  readonly id: 'A' | 'B' | 'C' | 'D' | 'E';
  readonly sections: readonly FormSectionPlan[];
  readonly totalBars: number;
}

const SHAPES: readonly { id: FormPlan['id']; shape: readonly [SectionKind, number][] }[] = [
  { id: 'A', shape: [['Intro', 4], ['A', 8], ['B', 8], ['A2', 8], ['Climax', 8], ['Outro', 4]] },
  { id: 'B', shape: [['Intro', 4], ['A', 8], ['A2', 8], ['B', 8], ['Build', 8], ['Climax', 8], ['Outro', 4]] },
  { id: 'C', shape: [['Intro', 8], ['A', 8], ['B', 8], ['Climax', 8], ['A3', 8], ['Outro', 8]] },
  { id: 'D', shape: [['A', 8], ['B', 8], ['A2', 8], ['Bridge', 8], ['Climax', 8], ['Outro', 4]] },
  { id: 'E', shape: [['Intro', 4], ['A', 8], ['B', 8], ['Build', 4], ['Climax', 8], ['B2', 8], ['Outro', 8]] },
];

/** Energy windows per section kind, from the spec. */
const ENERGY: Record<SectionKind, [number, number]> = {
  Intro: [0.15, 0.3],
  A: [0.35, 0.5],
  A2: [0.5, 0.65],
  A3: [0.5, 0.65],
  B: [0.45, 0.6],
  B2: [0.45, 0.6],
  Bridge: [0.3, 0.45],
  Build: [0.6, 0.8],
  Climax: [0.9, 1.0],
  Outro: [0.1, 0.25],
};

export function buildForm(rng: Rng): FormPlan {
  const chosen = rng.pick(SHAPES);
  const sections: FormSectionPlan[] = [];
  let bar = 1;
  for (const [kind, bars] of chosen.shape) {
    const [low, high] = ENERGY[kind];
    sections.push({ kind, bars, energy: rng.range(low, high), startBar: bar });
    bar += bars;
  }

  // A form whose energy barely moves is not a piece; the spec fixes the floor.
  const energies = sections.map((section) => section.energy);
  if (Math.max(...energies) - Math.min(...energies) < 0.5) {
    for (let i = 0; i < sections.length; i++) {
      if (sections[i].kind === 'Climax') sections[i] = { ...sections[i], energy: 0.95 };
      if (sections[i].kind === 'Intro') sections[i] = { ...sections[i], energy: 0.2 };
    }
  }

  const totalBars = sections.reduce((sum, section) => sum + section.bars, 0);
  return { id: chosen.id, sections, totalBars };
}
