/**
 * Structural proposal (Strings V1, Stage 1.1) — candidate boundaries with
 * strengths and evidence, and one conservative home span per section type.
 * It proposes; it does not select phrases. Phrase planning (a later stage)
 * chooses among the candidates once the musical material exists.
 *
 * TWO LEVELS, KEPT APART
 *   - a POSSIBLE PHRASE BOUNDARY: any tick with some evidence. All of them
 *     stay in `candidates`, whatever their strength.
 *   - a STRUCTURAL DIVISION: a candidate that may end a home span early.
 *     It is decided by a rule about the KIND of evidence (see
 *     `divisionOf`), never by a strength crossing a number.
 *
 * EVIDENCE AND INDEPENDENCE
 * Every piece of evidence names the underlying event it observes
 * (`source`) and the dimension that event belongs to. Two observations in
 * one dimension are not independent corroboration: a candidate's strength
 * counts each dimension once (its strongest item).
 *
 *   form           project edges and section starts          project fact
 *   repetition     the section's progression restarts/stops  project fact
 *   harmonic-rate  the prevailing chord rate changes         project fact
 *   harmonic-goal  an arrival chord has finished sounding    reading
 *   metre          two- and four-bar grouping                prior
 *
 * HARMONIC RATE: ONE EVENT, ONE OBSERVATION
 * Bars are grouped into runs of equal chord rate. A run of two or more
 * bars is a prevailing rate; a single bar is brief.
 *   - shift: the prevailing rate changes (brief bars may lie between).
 *     One item, at the bar line where the new prevailing rate begins.
 *   - excursion: a brief bar inside one prevailing rate (the rate leaves
 *     and comes straight back). ONE event, so ONE item, at its exit: a
 *     quickening usually drives into what follows. Its entry carries no
 *     boundary evidence, and an excursion never supports a division.
 *   - bars that only alternate (no prevailing rate) carry no rate evidence.
 *
 * POSITIONS
 * Ticks are the truth. A candidate is not forced onto a bar line: an
 * arrival chord that ends inside a bar gives a candidate inside the bar
 * (`onBarLine: false`, `tickInBar` > 0).
 *
 * No randomness: the same inputs give the same proposal.
 */
import { sectionTypeKeyOf } from '../../conductor/layers';
import type { SpineSection } from '../../spine';
import type { HarmonicMap } from './harmony';

export type StructuralEvidenceKind =
  | 'project-start' | 'project-end' | 'section-start'
  | 'loop-restart' | 'loop-break'
  | 'after-arrival' | 'harmonic-rate-shift' | 'harmonic-rate-excursion' | 'metric-grouping';

/** The independent families of evidence. Items in one dimension never corroborate each other. */
export type EvidenceDimension = 'form' | 'repetition' | 'harmonic-rate' | 'harmonic-goal' | 'metre';

export interface StructuralEvidence {
  readonly kind: StructuralEvidenceKind;
  readonly dimension: EvidenceDimension;
  /** 0..1 — how much this evidence alone suggests a boundary. Descriptive only: no decision compares it with a threshold. */
  readonly weight: number;
  /** 'project' = read directly from sections or chord timing; 'reading' = from an interpretation; 'prior' = a metric habit, independent of this song. */
  readonly basis: 'project' | 'reading' | 'prior';
  /** The underlying event this item observes. One event has one id, wherever it is observed. */
  readonly source: string;
  /** Where the underlying event lies in the project (ticks), for tracing. */
  readonly sourceSpan: { readonly startTick: number; readonly endTick: number };
  /**
   * True when this item may support a structural division: project facts of
   * repetition or of a sustained rate shift, and arrivals onto the tonic or
   * the fifth degree. False for the metric prior, for rate excursions, for
   * other arrivals, and for form (which bounds sections, not their insides).
   */
  readonly structural: boolean;
  readonly detail: string;
}

export type BoundaryLevel = 'section-boundary' | 'structural-division' | 'possible-phrase-boundary';

export interface BoundaryCandidate {
  readonly tick: number;
  /** 1-indexed bar that contains this tick (bars + 1 at the project end). */
  readonly bar: number;
  /** Ticks after that bar's bar line; 0 on a bar line. */
  readonly tickInBar: number;
  readonly onBarLine: boolean;
  /** 0..1 — the strongest weight of each dimension, combined as 1 − Π(1 − weight). Orders candidates; decides nothing. */
  readonly strength: number;
  /** The dimensions present, each counted once. */
  readonly dimensions: readonly EvidenceDimension[];
  readonly level: BoundaryLevel;
  /** Why the level is what it is. */
  readonly levelReason: string;
  readonly evidence: readonly StructuralEvidence[];
}

export interface ArrivalCandidate {
  /** Where the arrival chord starts: a possible phrase goal, not a boundary. */
  readonly tick: number;
  readonly bar: number;
  readonly tickInBar: number;
  readonly chordIndex: number;
  readonly kind: string;
  readonly strength: number;
  readonly rule: string;
}

export interface ProgressionLoop {
  readonly sectionId: string;
  readonly periodBars: number;
  /** Complete repetitions of the first period, counted from the section start. */
  readonly cycles: number;
  /** True when the repetitions fill the whole section. */
  readonly fillsSection: boolean;
}

/** One harmonic-rate event: a fact about chord timing, observed once. */
export interface HarmonicRateEvent {
  readonly kind: 'shift' | 'excursion';
  readonly id: string;
  /** First and last bar (1-indexed) of the bars that depart: the brief bar(s) of an excursion, or the brief bars between two prevailing rates of a shift (fromBar > toBar when none lie between). */
  readonly fromBar: number;
  readonly toBar: number;
  /** Chord starts per bar before, during (excursion only) and after. */
  readonly rateBefore: number | null;
  readonly rateDuring: number | null;
  readonly rateAfter: number | null;
  /** The tick that carries this event's single piece of evidence; null when it would fall on the project end. */
  readonly evidenceTick: number | null;
}

export interface HomeSpan {
  readonly typeKey: string;
  readonly sectionId: string;
  readonly startTick: number;
  readonly endTick: number;
  readonly bars: number;
  /** 'full-section' is the default; 'divided' needs a structural division inside the section. */
  readonly decision: 'full-section' | 'divided';
  /** The dividing candidate's tick and the evidence sources that justified it; null for a full section. */
  readonly dividedBy: { readonly tick: number; readonly sources: readonly string[] } | null;
  /** Possible phrase boundaries strictly inside the home span: kept, not acted on. */
  readonly interiorCandidateTicks: readonly number[];
  readonly basis: string;
}

export interface StructuralProposal {
  readonly version: 2;
  readonly status: 'proposal';
  readonly candidates: readonly BoundaryCandidate[];
  readonly arrivals: readonly ArrivalCandidate[];
  readonly loops: readonly ProgressionLoop[];
  readonly rateEvents: readonly HarmonicRateEvent[];
  /** One per section type, from its first occurrence. Empty when the project has no sections. */
  readonly homeSpans: readonly HomeSpan[];
  readonly sectionsProvided: boolean;
  readonly notDerived: readonly string[];
}

/**
 * Evidence weights. They only order candidates for a later reader; no
 * decision in this module compares a strength with a number.
 */
export const STRUCTURE_WEIGHTS = {
  projectEdge: 1,
  sectionStart: 1,
  loopRestart: 0.6,
  loopBreak: 0.5,
  afterArrival: 0.5,
  harmonicRateShift: 0.3,
  /** Half a shift: one bar's quickening is ambiguous between a lead-in and an ornament. */
  harmonicRateExcursion: 0.15,
  groupOfFour: 0.2,
  groupOfTwo: 0.1,
} as const;

/** Arrivals that can close or open a harmonic unit: onto the tonic, or onto the fifth degree. A fifth-fall elsewhere is sequence motion. */
export const UNIT_CLOSING_ARRIVALS: readonly string[] = ['dominant-to-tonic', 'plagal', 'step-to-tonic', 'return-to-tonic', 'onto-fifth-degree'];

const round = (value: number): number => Math.round(value * 1000) / 1000;

/** What sounds in one bar, as text: chord symbols with their offsets inside the bar. */
function barSignature(map: HarmonicMap, bar: number): string {
  const start = (bar - 1) * map.facts.barTicks;
  const end = start + map.facts.barTicks;
  return map.chords
    .filter((c) => c.fact.startTick < end && c.fact.endTick > start)
    .map((c) => `${c.fact.symbol}@${Math.max(0, c.fact.startTick - start)}`)
    .join('|');
}

function loopOf(map: HarmonicMap, section: SpineSection): ProgressionLoop | null {
  const signatures = Array.from({ length: section.lengthBars }, (_, i) => barSignature(map, section.startBar + i));
  if (signatures.some((s) => s === '')) return null;
  // a period of one bar, or a period whose bars are all alike, is static
  // harmony or a vamp: it has no restart that could bound a phrase
  for (let period = 2; period * 2 <= section.lengthBars; period++) {
    if (new Set(signatures.slice(0, period)).size === 1) continue;
    let cycles = 1;
    while ((cycles + 1) * period <= section.lengthBars
      && Array.from({ length: period }, (_, i) => signatures[cycles * period + i] === signatures[i]).every(Boolean)) cycles++;
    if (cycles >= 2) return { sectionId: section.id, periodBars: period, cycles, fillsSection: cycles * period === section.lengthBars };
  }
  return null;
}

export interface StructureInput {
  readonly harmony: HarmonicMap;
  readonly sections: readonly SpineSection[];
  /** False when the project has no sections (the section map then holds one whole-song section). */
  readonly sectionsProvided: boolean;
}

/**
 * Harmonic-rate events from the chord starts per bar. See the file header:
 * a shift and an excursion are each one event with one observation.
 */
export function harmonicRateEvents(rates: readonly number[], barTicks: number, endTick: number): HarmonicRateEvent[] {
  // runs of equal rate
  const runs: { start: number; length: number; rate: number }[] = [];
  rates.forEach((rate, i) => {
    const last = runs[runs.length - 1];
    if (last && last.rate === rate) last.length++;
    else runs.push({ start: i, length: 1, rate });
  });
  const prevailing = runs.map((r, i) => ({ ...r, index: i })).filter((r) => r.length >= 2);
  const events: HarmonicRateEvent[] = [];
  const tickOf = (barIndex: number): number | null => (barIndex * barTicks < endTick ? barIndex * barTicks : null);
  // between consecutive prevailing runs: a shift when their rates differ, else excursions for the brief bars between
  for (let i = 0; i + 1 < prevailing.length; i++) {
    const before = prevailing[i];
    const after = prevailing[i + 1];
    const between = runs.slice(before.index + 1, after.index);
    if (before.rate !== after.rate) {
      events.push({
        kind: 'shift', id: `rate-shift:bar${after.start + 1}`,
        fromBar: before.start + before.length + 1, toBar: after.start,
        rateBefore: before.rate, rateDuring: null, rateAfter: after.rate, evidenceTick: tickOf(after.start),
      });
    } else if (between.length === 1) {
      const brief = between[0];
      events.push({
        kind: 'excursion', id: `rate-excursion:bar${brief.start + 1}`,
        fromBar: brief.start + 1, toBar: brief.start + 1,
        rateBefore: before.rate, rateDuring: brief.rate, rateAfter: after.rate, evidenceTick: tickOf(brief.start + 1),
      });
    }
    // several alternating brief bars inside one prevailing rate: no single event, no evidence
  }
  // a lone brief bar before the first or after the last prevailing run
  const first = prevailing[0];
  const last = prevailing[prevailing.length - 1];
  if (first && first.index === 1) {
    events.unshift({ kind: 'excursion', id: 'rate-excursion:bar1', fromBar: 1, toBar: 1, rateBefore: null, rateDuring: runs[0].rate, rateAfter: first.rate, evidenceTick: tickOf(1) });
  }
  if (last && last.index === runs.length - 2) {
    const brief = runs[runs.length - 1];
    events.push({ kind: 'excursion', id: `rate-excursion:bar${brief.start + 1}`, fromBar: brief.start + 1, toBar: brief.start + 1, rateBefore: last.rate, rateDuring: brief.rate, rateAfter: null, evidenceTick: tickOf(brief.start + 1) });
  }
  // a brief bar, then one last bar back at the prevailing rate (…, R, R, x, R): the same excursion, cut short by the end
  if (last && last.index === runs.length - 3 && runs[runs.length - 1].rate === last.rate) {
    const brief = runs[runs.length - 2];
    events.push({ kind: 'excursion', id: `rate-excursion:bar${brief.start + 1}`, fromBar: brief.start + 1, toBar: brief.start + 1, rateBefore: last.rate, rateDuring: brief.rate, rateAfter: null, evidenceTick: tickOf(brief.start + 1) });
  }
  return events.sort((a, b) => a.fromBar - b.fromBar || a.id.localeCompare(b.id));
}

/**
 * Whether the evidence at one tick amounts to a structural division.
 *
 * It does when the song's own material shows it twice, independently:
 *   1. a project fact that the harmonic ground changes or recurs there —
 *      the progression restarts or stops repeating (repetition), or the
 *      prevailing chord rate shifts (harmonic-rate); and
 *   2. a second, different dimension of structural evidence — an arrival
 *      onto the tonic or the fifth degree that has just finished sounding
 *      (harmonic-goal), or the other project fact.
 *
 * Never enough alone or together: the metric prior, a rate excursion, an
 * arrival of any kind without a project fact, a non-closing arrival.
 */
function divisionOf(evidence: readonly StructuralEvidence[]): { readonly divides: boolean; readonly reason: string; readonly sources: readonly string[] } {
  const structural = evidence.filter((e) => e.structural);
  const facts = structural.filter((e) => e.basis === 'project');
  const dimensions = [...new Set(structural.map((e) => e.dimension))];
  if (facts.length === 0) {
    const have = evidence.map((e) => e.kind).join(', ');
    return { divides: false, sources: [], reason: `no project fact of repetition or of a sustained rate shift here (only: ${have})` };
  }
  if (dimensions.length < 2) {
    return { divides: false, sources: [], reason: `${facts[0].kind} is not corroborated by an independent dimension (a closing arrival, or the other project fact)` };
  }
  return { divides: true, sources: structural.map((e) => e.source), reason: `${dimensions.join(' + ')}: ${structural.map((e) => e.kind).join(' with ')}` };
}

export function buildStructuralProposal(input: StructureInput): StructuralProposal {
  const { harmony, sections, sectionsProvided } = input;
  const bar = harmony.facts.barTicks;
  const endTick = harmony.facts.endTick;
  const evidenceAt = new Map<number, StructuralEvidence[]>();
  const add = (tick: number, evidence: StructuralEvidence): void => {
    if (!Number.isInteger(tick) || tick < 0 || tick > endTick) return;
    evidenceAt.set(tick, [...(evidenceAt.get(tick) ?? []), evidence]);
  };
  const at = (tick: number) => ({ startTick: tick, endTick: tick });

  add(0, { kind: 'project-start', dimension: 'form', weight: STRUCTURE_WEIGHTS.projectEdge, basis: 'project', source: 'project:start', sourceSpan: at(0), structural: false, detail: 'start of the project' });
  add(endTick, { kind: 'project-end', dimension: 'form', weight: STRUCTURE_WEIGHTS.projectEdge, basis: 'project', source: 'project:end', sourceSpan: at(endTick), structural: false, detail: 'end of the project' });

  const loops: ProgressionLoop[] = [];
  for (const section of sections) {
    if (sectionsProvided) {
      add(section.startTick, {
        kind: 'section-start', dimension: 'form', weight: STRUCTURE_WEIGHTS.sectionStart, basis: 'project', source: `section:${section.id}`,
        sourceSpan: { startTick: section.startTick, endTick: section.endTick }, structural: false,
        detail: `section "${section.name}" starts (bar ${section.startBar})`,
      });
    }
    const loop = loopOf(harmony, section);
    if (loop) {
      loops.push(loop);
      const period = loop.periodBars * bar;
      for (let cycle = 1; cycle < loop.cycles; cycle++) {
        const tick = section.startTick + cycle * period;
        add(tick, {
          kind: 'loop-restart', dimension: 'repetition', weight: STRUCTURE_WEIGHTS.loopRestart, basis: 'project', source: `loop:${section.id}:restart${cycle + 1}`,
          sourceSpan: { startTick: tick - period, endTick: tick + period }, structural: true,
          detail: `the ${loop.periodBars}-bar progression of "${section.name}" restarts (repetition ${cycle + 1} of ${loop.cycles})`,
        });
      }
      if (!loop.fillsSection) {
        const tick = section.startTick + loop.cycles * period;
        add(tick, {
          kind: 'loop-break', dimension: 'repetition', weight: STRUCTURE_WEIGHTS.loopBreak, basis: 'project', source: `loop:${section.id}:break`,
          sourceSpan: { startTick: section.startTick, endTick: tick }, structural: true,
          detail: `the ${loop.periodBars}-bar progression of "${section.name}" stops repeating after ${loop.cycles} repetitions`,
        });
      }
    }
    // metric grouping: a habit of the metre, independent of this song's material
    for (let offset = 2; offset < section.lengthBars; offset += 2) {
      const four = offset % 4 === 0;
      const tick = section.startTick + offset * bar;
      add(tick, {
        kind: 'metric-grouping', dimension: 'metre', weight: four ? STRUCTURE_WEIGHTS.groupOfFour : STRUCTURE_WEIGHTS.groupOfTwo, basis: 'prior',
        source: `metre:${section.id}:+${offset}`, sourceSpan: at(tick), structural: false,
        detail: `${offset} bars after the start of "${section.name}" (${four ? 'four' : 'two'}-bar grouping)`,
      });
    }
  }

  const arrivals: ArrivalCandidate[] = [];
  for (const join of harmony.joins) {
    const arrival = join.reading.arrival;
    if (!arrival) continue;
    const chord = harmony.chords[join.fact.toIndex];
    arrivals.push({
      tick: chord.fact.startTick, bar: Math.floor(chord.fact.startTick / bar) + 1, tickInBar: chord.fact.startTick % bar,
      chordIndex: chord.fact.index, kind: arrival.kind, strength: arrival.strength, rule: arrival.rule,
    });
    // a boundary may follow once the arrival chord has sounded: exactly where that chord ends, on a bar line or not
    const closes = UNIT_CLOSING_ARRIVALS.includes(arrival.kind);
    add(chord.fact.endTick, {
      kind: 'after-arrival', dimension: 'harmonic-goal', weight: round(STRUCTURE_WEIGHTS.afterArrival * arrival.strength), basis: 'reading',
      source: `arrival:chord${chord.fact.index}`, sourceSpan: { startTick: chord.fact.startTick, endTick: chord.fact.endTick }, structural: closes,
      detail: `the ${arrival.kind} arrival on ${chord.fact.symbol} (chord ${chord.fact.index}, ticks ${chord.fact.startTick}-${chord.fact.endTick}) has finished sounding: ${arrival.rule}`,
    });
  }

  const rateEvents = harmonicRateEvents(harmony.rhythm.bars.map((b) => b.chordStarts), bar, endTick);
  for (const event of rateEvents) {
    if (event.evidenceTick === null) continue;
    const span = { startTick: (Math.min(event.fromBar, event.toBar + 1) - 1) * bar, endTick: Math.min(endTick, Math.max(event.toBar, event.fromBar - 1) * bar) };
    if (event.kind === 'shift') {
      add(event.evidenceTick, {
        kind: 'harmonic-rate-shift', dimension: 'harmonic-rate', weight: STRUCTURE_WEIGHTS.harmonicRateShift, basis: 'project', source: event.id, sourceSpan: span, structural: true,
        detail: `the prevailing chord rate changes from ${event.rateBefore} to ${event.rateAfter} per bar and stays there (from bar ${event.evidenceTick / bar + 1})`,
      });
    } else {
      add(event.evidenceTick, {
        kind: 'harmonic-rate-excursion', dimension: 'harmonic-rate', weight: STRUCTURE_WEIGHTS.harmonicRateExcursion, basis: 'project', source: event.id, sourceSpan: span, structural: false,
        detail: `bar ${event.fromBar} alone has ${event.rateDuring} chord starts inside a rate of ${event.rateBefore ?? event.rateAfter} per bar; one event, observed once, at its exit`,
      });
    }
  }

  const sectionEdges = new Set<number>([0, endTick, ...(sectionsProvided ? sections.flatMap((s) => [s.startTick, s.endTick]) : [])]);
  const candidates: BoundaryCandidate[] = [...evidenceAt.entries()]
    .sort(([a], [b]) => a - b)
    .map(([tick, evidence]) => {
      const dimensions = [...new Set(evidence.map((e) => e.dimension))];
      // one contribution per dimension: observations inside a dimension do not corroborate each other
      const strength = round(1 - dimensions.reduce((product, d) => product * (1 - Math.max(...evidence.filter((e) => e.dimension === d).map((e) => e.weight))), 1));
      const division = divisionOf(evidence);
      const level: BoundaryLevel = sectionEdges.has(tick) ? 'section-boundary' : division.divides ? 'structural-division' : 'possible-phrase-boundary';
      return {
        tick,
        bar: Math.floor(tick / bar) + 1,
        tickInBar: tick % bar,
        onBarLine: tick % bar === 0,
        strength,
        dimensions,
        level,
        levelReason: level === 'section-boundary' ? 'a section or project edge (project fact)' : division.reason,
        evidence,
      };
    });

  const homeSpans: HomeSpan[] = [];
  if (sectionsProvided) {
    const seen = new Set<string>();
    for (const section of [...sections].sort((a, b) => a.startBar - b.startBar)) {
      const typeKey = sectionTypeKeyOf(section.name);
      if (seen.has(typeKey)) continue;
      seen.add(typeKey);
      const inside = candidates.filter((c) => c.tick > section.startTick && c.tick < section.endTick);
      // the full section is the default; only a structural division shortens it
      const division = inside.find((c) => c.level === 'structural-division');
      const end = division?.tick ?? section.endTick;
      homeSpans.push({
        typeKey,
        sectionId: section.id,
        startTick: section.startTick,
        endTick: end,
        bars: (end - section.startTick) / bar,
        decision: division ? 'divided' : 'full-section',
        dividedBy: division ? { tick: division.tick, sources: division.evidence.filter((e) => e.structural).map((e) => e.source) } : null,
        interiorCandidateTicks: inside.filter((c) => c.tick < end).map((c) => c.tick),
        basis: division
          ? `first occurrence of "${section.name}", divided at tick ${division.tick}: ${division.levelReason}`
          : `first occurrence of "${section.name}", whole section: ${inside.length ? `none of its ${inside.length} interior candidate(s) is a structural division` : 'no interior candidate'}`,
      });
    }
  }

  return {
    version: 2,
    status: 'proposal',
    candidates,
    arrivals,
    loops,
    rateEvents,
    homeSpans,
    sectionsProvided,
    notDerived: [
      'final phrases and their segments: selected by phrase planning once material exists',
      'phrase closure: an arrival is a harmonic reading; whether a phrase ends there depends on melody, which does not exist yet',
      'pickups, tails, overlaps and elisions: a candidate marks where an arrival chord ends, not where a melody would breathe',
      'phrase goals: arrivals are listed as opportunities, none is chosen',
      'home span length inside an undivided section: the whole section is the default, not a claim that it is one phrase',
      ...(sectionsProvided ? [] : ['home spans: the project has no sections']),
    ],
  };
}
