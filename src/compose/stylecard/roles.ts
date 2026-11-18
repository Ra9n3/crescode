/**
 * Roles per section, from the section's energy.
 *
 * The point of the ladder is that the texture changes as the piece builds: a
 * quiet Intro is a pad plus a bass, the Climax is a doubled melody over a
 * driving accompaniment. Instruments enter one at a time in Intro and Build.
 */
import type { SectionKind } from './form';
import type { Rng } from './rng';

export type Role = 'MELODY' | 'COUNTER' | 'PAD' | 'OSTINATO' | 'BASS' | 'PIZZ' | 'DOUBLE' | 'REST';

export type PatternName =
  | 'sustained' | 'halfPulse' | 'quarterPulse' | 'eighths' | 'syncopated'
  | 'arpeggio' | 'waltz' | 'pizzQuarters' | 'tremolo' | 'spiccato16';

export interface SectionRoles {
  readonly vln1: Role;
  readonly vln2: Role;
  readonly vla: Role;
  readonly vc: Role;
  readonly cb: Role;
  readonly pattern: PatternName;
  readonly air: boolean;
}

const climb = (rng: Rng): PatternName => rng.pick(['halfPulse', 'quarterPulse', 'eighths', 'arpeggio'] as const);

export function rolesForSection(
  rng: Rng,
  kind: SectionKind,
  energy: number,
  beatsPerBar: number,
  previousPattern: PatternName | null,
): SectionRoles {
  const threeFour = beatsPerBar === 3;
  const vcMelody = energy < 0.3 && rng.chance(0.3);

  // Intro and Build stagger their entrances: the first bar must still sound,
  // so the later voices rest here and the orchestrator brings them in.
  const staggered = kind === 'Intro' || kind === 'Build';

  if (energy < 0.3) {
    return {
      vln1: vcMelody ? 'REST' : 'MELODY',
      vln2: 'PAD',
      vla: 'PAD',
      vc: vcMelody ? 'MELODY' : 'BASS',
      cb: staggered ? 'REST' : 'REST',
      pattern: 'sustained',
      air: true,
    };
  }
  if (energy < 0.6) {
    let pattern = different(rng, previousPattern, [
      'halfPulse', 'quarterPulse', 'eighths', 'arpeggio',
      ...(threeFour ? ['waltz' as const] : []),
    ]);
    return {
      vln1: 'MELODY',
      vln2: 'OSTINATO',
      vla: rng.chance(0.5) ? 'COUNTER' : 'PAD',
      vc: 'BASS',
      cb: energy > 0.45 ? 'BASS' : 'REST',
      pattern,
      air: false,
    };
  }
  if (energy <= 0.85) {
    const pattern = different(rng, previousPattern, [
      'eighths', 'arpeggio', 'quarterPulse', 'syncopated',
    ]);
    return {
      vln1: 'MELODY',
      vln2: 'OSTINATO',
      vla: 'COUNTER',
      vc: 'BASS',
      cb: 'BASS',
      pattern,
      air: false,
    };
  }
  // Above 0.85: the full texture.
  const pattern = different(rng, previousPattern, ['spiccato16', 'tremolo', 'eighths', 'arpeggio']);
  return {
    vln1: 'MELODY',
    vln2: rng.chance(0.5) ? 'DOUBLE' : 'OSTINATO',
    vla: 'OSTINATO',
    vc: 'BASS',
    cb: 'BASS',
    pattern,
    air: false,
  };
}

/** Never reuse the same accompaniment pattern twice running. */
function different(rng: Rng, previous: PatternName | null, options: readonly PatternName[]): PatternName {
  const filtered = previous ? options.filter((option) => option !== previous) : options;
  const pool = filtered.length ? filtered : options;
  void climb;
  return rng.pick(pool);
}
