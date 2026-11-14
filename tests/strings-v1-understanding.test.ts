/**
 * Strings V1 Stage 1 — the musical understanding foundation: composition
 * brief, harmonic map and structural proposal. Pure analysis of the project.
 */
import { describe, expect, it } from 'vitest';
import { resolveTemplate } from '../src/config/ensembles';
import { chordSpans, energyCurve, sectionMap } from '../src/orchestrator/spine';
import {
  STRUCTURE_WEIGHTS, UNIT_CLOSING_ARRIVALS, buildHarmonicMap, buildStringsUnderstanding, harmonicRateEvents, type StringsUnderstanding,
} from '../src/orchestrator/strings/understanding';
import { freshEnsemble } from '../src/shared/schema/band';
import { barTicks, projectEndTick } from '../src/shared/schema/meter';
import type { Project } from '../src/shared/schema/types';
import { STRING_FIXTURES, STRING_TEMPLATES, projectForStringCell, type StringCell } from './strings-v1-support';

function understand(project: Project, take = 1): StringsUnderstanding {
  const template = resolveTemplate(project.ensemble);
  const sections = sectionMap(project);
  const arc = energyCurve(project, sections, take, template, template !== null);
  return buildStringsUnderstanding({ project, template, ensemble: project.ensemble ?? freshEnsemble(), spans: chordSpans(project), sections, arc, take });
}
const cell = (template: StringCell['template'], fixture: StringCell['fixture']): StringCell => ({ template, fixture, seed: 1, take: 0 });
const dorian = (): Project => projectForStringCell(cell('chamber', 'dorian-16bars'));

describe('strings understanding — determinism', () => {
  it('gives identical data for the same project and inputs', () => {
    for (const template of STRING_TEMPLATES) {
      for (const fixture of STRING_FIXTURES) {
        const a = understand(projectForStringCell(cell(template, fixture)));
        const b = understand(projectForStringCell(cell(template, fixture)));
        expect(JSON.stringify(b)).toBe(JSON.stringify(a));
      }
    }
  });

  it('keeps the project seed across takes and changes only the take identity', () => {
    const a = understand(dorian(), 1);
    const b = understand(dorian(), 2);
    expect(b.brief.facts.identity.projectSeed).toBe(a.brief.facts.identity.projectSeed);
    expect(b.brief.facts.identity.take).toBe(2);
    expect(b.brief.facts.identity.takeSeed).not.toBe(a.brief.facts.identity.takeSeed);
    // the harmony and the structure do not depend on the take
    expect(b.harmony).toEqual(a.harmony);
    expect(b.structure).toEqual(a.structure);
  });

  it('does not alter the project it reads', () => {
    const project = dorian();
    const before = JSON.stringify(project);
    understand(project);
    expect(JSON.stringify(project)).toBe(before);
  });
});

describe('composition brief', () => {
  it('copies key, mode, tempo, metre, template and sections from the project', () => {
    const project = dorian();
    const { brief } = understand(project);
    expect(brief.facts.tonality).toMatchObject({ key: project.key, mode: project.mode });
    expect(brief.facts.time).toMatchObject({ bpm: project.bpm, numerator: 4, denominator: 4, compound: false, beatsPerBar: 4, barTicks: 3840, bars: 16 });
    expect(brief.facts.template.id).toBe('ensemble.chamber');
    expect(brief.facts.template.stringVoiceRoles.slice().sort()).toEqual(['cellosBasses', 'violas', 'violins1', 'violins2']);
    expect(brief.facts.template.bassDesk).toBe(false);
    expect(brief.facts.sections.map((s) => [s.name, s.startBar, s.lengthBars])).toEqual(project.sections.map((s) => [s.name, s.startBar, s.lengthBars]));
    expect(brief.facts.energy.available).toBe(true);
    expect(brief.readings.modeColour).toBe('minor-like');
  });

  it('reports the string roster and bass desk of each template as the pipeline has them', () => {
    const roles = (template: StringCell['template']) => understand(projectForStringCell(cell(template, 'dorian-16bars'))).brief.facts.template;
    expect(roles('sonata').stringVoiceRoles.slice().sort()).toEqual(['cellosBasses', 'violins1']);
    expect(roles('vocalbacking').stringVoiceRoles.slice().sort()).toEqual(['cellosBasses', 'violas', 'violins2']);
    expect(STRING_TEMPLATES.filter((t) => roles(t).bassDesk)).toEqual(['cinematic', 'hybridstudio', 'symphony']);
  });

  it('groups recurring sections and leaves what the project does not state as null', () => {
    const { brief } = understand(projectForStringCell(cell('chamber', 'three-chorus-40bars')));
    expect(brief.readings.sectionRecurrence.chorus).toHaveLength(3);
    expect(brief.readings.sectionRecurrence.verse).toHaveLength(2);
    expect(brief.vocabulary).toEqual({ melodic: null, rhythmic: null, dissonanceTolerance: null, secondTheme: null });
    expect(brief.notDerived.some((line) => line.startsWith('vocal'))).toBe(true);
    expect(JSON.stringify(brief).toLowerCase()).not.toContain('"vocalactivity"');
  });

  it('says so when no energy arc or no sections are supplied', () => {
    const project = dorian();
    const noArc = buildStringsUnderstanding({ project, template: null, ensemble: freshEnsemble(), spans: chordSpans(project), sections: sectionMap(project), take: 1 });
    expect(noArc.brief.facts.energy).toMatchObject({ available: false, min: null, max: null, mean: null, peakBar: null });
    expect(noArc.brief.facts.sections.every((s) => s.meanEnergy === null)).toBe(true);
    expect(noArc.brief.facts.template).toMatchObject({ id: null, name: null });
    const bare = { ...dorian(), sections: [] };
    const u = understand(bare);
    expect(u.brief.facts.sectionsProvided).toBe(false);
    expect(u.structure.sectionsProvided).toBe(false);
    expect(u.structure.homeSpans).toEqual([]);
    expect(u.structure.candidates.some((c) => c.evidence.some((e) => e.kind === 'section-start'))).toBe(false);
    expect(u.structure.notDerived.some((line) => line.startsWith('home spans'))).toBe(true);
  });
});

describe('harmonic map', () => {
  it('matches the source chord timing and identity, chord by chord', () => {
    for (const fixture of STRING_FIXTURES) {
      const project = projectForStringCell(cell('symphony', fixture));
      const spans = chordSpans(project);
      const { harmony } = understand(project);
      expect(harmony.facts.chordCount).toBe(spans.length);
      expect(harmony.chords.map((c) => [c.fact.id, c.fact.symbol, c.fact.startTick, c.fact.endTick, c.fact.rootPc]))
        .toEqual(spans.map((s) => [s.id, s.symbol, s.startTick, s.endTick, ((s.parsed.root % 12) + 12) % 12]));
      for (const [i, c] of harmony.chords.entries()) {
        expect([...c.fact.pitchClasses].sort()).toEqual([...new Set(spans[i].parsed.pitchClasses.map((pc) => ((pc % 12) + 12) % 12))].sort());
        expect(c.reading.tension).toBeGreaterThanOrEqual(0);
        expect(c.reading.tension).toBeLessThanOrEqual(1);
        expect(c.reading.stability).toBeCloseTo(1 - c.reading.tension, 6);
        expect(c.reading.tensionSources.length > 0).toBe(c.reading.tension > 0);
      }
      expect(harmony.joins).toHaveLength(Math.max(0, spans.length - 1));
      for (const join of harmony.joins) expect(join.fact.tick).toBe(spans[join.fact.toIndex].startTick);
      expect(harmony.rhythm.bars.reduce((sum, b) => sum + b.chordStarts, 0)).toBe(spans.length);
    }
  });

  it('reads Dm7 to G7 and back in D Dorian by the stated rules', () => {
    const { harmony } = understand(dorian());
    expect(harmony.chords.slice(0, 3).map((c) => c.fact.symbol)).toEqual(['Dm7', 'G7', 'Dm7']);
    const [dm7, g7] = harmony.chords;
    expect(dm7.reading).toMatchObject({ isTonicRoot: true, rootDegree: 0, pitchClassesOutsideScale: [], tensionSources: ['contains a seventh'] });
    expect(g7.reading.tensionSources).toEqual(['contains a tritone', 'contains a seventh', 'root is not the tonic']);
    const out = harmony.joins[0].reading;
    expect(out.rootMotion).toBe('fifth-down');
    expect([...out.commonTones].sort()).toEqual([2, 5]);
    expect(out.guideTones).toEqual(expect.arrayContaining([
      { pc: 5, role: 'third', toPc: 5, moveSemitones: 0 },
      { pc: 0, role: 'seventh', toPc: 11, moveSemitones: -1 },
    ]));
    expect(out.suspensions).toContainEqual({ heldPc: 0, resolvesToPc: 11, stepSemitones: 1, resolutionRole: 'third' });
    expect(out.arrival).toMatchObject({ kind: 'fifth-fall' });
    const back = harmony.joins[1].reading;
    expect(back.arrival).toMatchObject({ kind: 'plagal', strength: 0.6 });
    expect(back.tensionChange).toBeLessThan(0);
  });

  it('finds a dominant arrival, bass motion and pedal opportunities in a plain progression', () => {
    const project: Project = {
      ...dorian(), key: 0, mode: 'Ionian' as Project['mode'], sections: [{ id: 's', name: 'Verse', startBar: 1, lengthBars: 4 }] as Project['sections'],
      chords: ['C', 'F/C', 'G7', 'C'].map((symbol, i) => ({ id: `c${i}`, symbol, startTick: i * 3840, durationTicks: 3840 })) as Project['chords'],
    };
    const { harmony, structure } = understand(project);
    expect(harmony.joins[2].reading.arrival).toMatchObject({ kind: 'dominant-to-tonic', strength: 1 });
    expect(harmony.joins[0].reading).toMatchObject({ bassHeld: true, bassMoveSemitones: 0 });
    expect(harmony.joins[1].reading.bassMoveSemitones).toBe(-5);
    expect(harmony.pedals).toContainEqual({ pc: 0, role: 'held-bass', fromIndex: 0, toIndex: 1, startTick: 0, endTick: 7680 });
    expect(harmony.pedals.some((p) => p.role === 'tonic' && p.fromIndex === 0 && p.toIndex === 1)).toBe(true);
    expect(harmony.pedals.some((p) => p.role === 'fifth-degree' && p.fromIndex === 2 && p.toIndex === 3)).toBe(true);
    expect(structure.arrivals).toContainEqual(expect.objectContaining({ tick: 3 * 3840, chordIndex: 3, kind: 'dominant-to-tonic' }));
  });

  it('reports missing harmony instead of inventing it', () => {
    const project = dorian();
    const empty = buildHarmonicMap({ project, spans: [], endTick: projectEndTick(project) });
    expect(empty.facts.chordCount).toBe(0);
    expect(empty.chords).toEqual([]);
    expect(empty.joins).toEqual([]);
    expect(empty.pedals).toEqual([]);
    expect(empty.rhythm.medianChordTicks).toBeNull();
    expect(empty.facts.uncoveredSpans).toEqual([{ startTick: 0, endTick: projectEndTick(project) }]);
    const gapped = { ...project, chords: project.chords.filter((_, i) => i !== 1) };
    const withGap = understand(gapped).harmony;
    expect(withGap.facts.uncoveredSpans.length + withGap.joins.filter((j) => j.fact.gapTicks > 0).length).toBeGreaterThan(0);
  });
});

/** A project with whole chords laid end to end. `chords` are [symbol, length in bars]; sections are [name, bars]. */
function song(spec: { key?: number; mode?: string; metre?: [number, number]; chords: [string, number][]; sections: [string, number][] }): Project {
  const base = dorian();
  const timeSignature = { numerator: spec.metre?.[0] ?? 4, denominator: spec.metre?.[1] ?? 4 } as Project['timeSignature'];
  const bar = barTicks(timeSignature);
  let tick = 0;
  const chords = spec.chords.map(([symbol, bars], i) => {
    const chord = { id: `c${i}`, symbol, startTick: tick, durationTicks: Math.round(bars * bar) };
    tick += chord.durationTicks;
    return chord;
  });
  let startBar = 1;
  const sections = spec.sections.map(([name, lengthBars], i) => {
    const section = { id: `s${i}`, name, startBar, lengthBars };
    startBar += lengthBars;
    return section;
  });
  return { ...base, key: (spec.key ?? 0) as Project['key'], mode: (spec.mode ?? 'Ionian') as Project['mode'], timeSignature, chords: chords as Project['chords'], sections: sections as Project['sections'] };
}
const bars = (symbols: string): [string, number][] => symbols.split(' ').map((symbol) => [symbol, 1]);
const kindsAt = (structure: StringsUnderstanding['structure'], tick: number): string[] => structure.candidates.find((c) => c.tick === tick)?.evidence.map((e) => e.kind) ?? [];

describe('structural proposal — candidates and evidence', () => {
  it('proposes candidates on valid project ticks, with traceable evidence, and selects no phrases', () => {
    for (const template of ['chamber', 'symphony'] as const) {
      for (const fixture of STRING_FIXTURES) {
        const project = projectForStringCell(cell(template, fixture));
        const bar = barTicks(project.timeSignature);
        const end = projectEndTick(project);
        const { structure, harmony } = understand(project);
        expect(structure.status).toBe('proposal');
        expect(Object.keys(structure)).not.toContain('phrases');
        const ticks = structure.candidates.map((c) => c.tick);
        expect(ticks).toEqual([...new Set(ticks)].sort((a, b) => a - b));
        expect(ticks[0]).toBe(0);
        expect(ticks[ticks.length - 1]).toBe(end);
        const sectionStarts = new Set(sectionMap(project).map((s) => s.startTick));
        for (const c of structure.candidates) {
          expect(Number.isInteger(c.tick) && c.tick >= 0 && c.tick <= end).toBe(true);
          expect(c.bar).toBe(Math.floor(c.tick / bar) + 1);
          expect(c.tickInBar).toBe(c.tick % bar);
          expect(c.onBarLine).toBe(c.tick % bar === 0);
          expect(c.evidence.length).toBeGreaterThan(0);
          // strength counts each dimension once, by its strongest item
          const perDimension = c.dimensions.map((d) => Math.max(...c.evidence.filter((e) => e.dimension === d).map((e) => e.weight)));
          expect(c.strength).toBeCloseTo(1 - perDimension.reduce((p, w) => p * (1 - w), 1), 3);
          expect([...c.dimensions].sort()).toEqual([...new Set(c.evidence.map((e) => e.dimension))].sort());
          expect(c.levelReason.length).toBeGreaterThan(0);
          for (const e of c.evidence) {
            expect(e.detail.length).toBeGreaterThan(0);
            expect(e.source.length).toBeGreaterThan(0);
            expect(e.sourceSpan.startTick).toBeGreaterThanOrEqual(0);
            expect(e.sourceSpan.endTick).toBeLessThanOrEqual(end);
            expect(e.sourceSpan.startTick).toBeLessThanOrEqual(e.sourceSpan.endTick);
            expect(['project', 'reading', 'prior']).toContain(e.basis);
            if (e.kind === 'section-start') expect(sectionStarts.has(c.tick)).toBe(true);
            if (e.kind === 'metric-grouping') expect([e.basis, e.dimension, e.structural]).toEqual(['prior', 'metre', false]);
            if (e.kind === 'harmonic-rate-excursion') expect([e.basis, e.structural]).toEqual(['project', false]);
            if (e.kind === 'harmonic-rate-shift' || e.kind === 'harmonic-rate-excursion') {
              expect(structure.rateEvents.find((r) => r.id === e.source)?.evidenceTick).toBe(c.tick);
            }
            if (e.kind === 'after-arrival') {
              const index = Number(/^arrival:chord(\d+)$/.exec(e.source)?.[1]);
              const arrival = structure.arrivals.find((a) => a.chordIndex === index);
              expect(arrival).toBeDefined();
              // the candidate sits exactly where the arrival chord ends; the source span is that chord
              expect(harmony.chords[index].fact.endTick).toBe(c.tick);
              expect(e.sourceSpan).toEqual({ startTick: harmony.chords[index].fact.startTick, endTick: harmony.chords[index].fact.endTick });
              expect(e.weight).toBeCloseTo(STRUCTURE_WEIGHTS.afterArrival * arrival!.strength, 3);
              expect(e.basis).toBe('reading');
              expect(e.structural).toBe(UNIT_CLOSING_ARRIVALS.includes(arrival!.kind));
            }
          }
        }
        // one underlying event is observed once in the whole proposal
        const sources = structure.candidates.flatMap((c) => c.evidence.map((e) => e.source));
        expect(sources.length).toBe(new Set(sources).size);
        for (const start of sectionStarts) expect(structure.candidates.find((c) => c.tick === start)).toMatchObject({ strength: 1, level: 'section-boundary' });
        for (const a of structure.arrivals) {
          expect(harmony.chords[a.chordIndex].fact.startTick).toBe(a.tick);
          expect([a.bar, a.tickInBar]).toEqual([Math.floor(a.tick / bar) + 1, a.tick % bar]);
        }
      }
    }
  });

  it('is deterministic and does not depend on the template', () => {
    for (const fixture of STRING_FIXTURES) {
      const first = JSON.stringify(understand(projectForStringCell(cell('chamber', fixture))).structure);
      expect(JSON.stringify(understand(projectForStringCell(cell('chamber', fixture))).structure)).toBe(first);
      for (const template of STRING_TEMPLATES) expect(JSON.stringify(understand(projectForStringCell(cell(template, fixture))).structure)).toBe(first);
    }
  });

  it('marks loop restarts only where the progression really repeats', () => {
    const looped = understand(song({ key: 2, mode: 'Dorian', chords: bars('Dm Bb F C Dm Bb F C'), sections: [['Verse', 8]] })).structure;
    expect(looped.loops).toEqual([{ sectionId: 's0', periodBars: 4, cycles: 2, fillsSection: true }]);
    expect(kindsAt(looped, 4 * 3840)).toContain('loop-restart');
    const broken = understand(song({ key: 2, mode: 'Dorian', chords: bars('Dm C Dm C Dm C Bb A'), sections: [['Verse', 8]] })).structure;
    expect(broken.loops).toEqual([{ sectionId: 's0', periodBars: 2, cycles: 3, fillsSection: false }]);
    expect(kindsAt(broken, 6 * 3840)).toContain('loop-break');
    // static harmony has no loop restart: only metre and the project edges remain
    const still = understand(song({ key: 2, mode: 'Dorian', chords: bars('Dm Dm Dm Dm Dm Dm Dm Dm'), sections: [['Verse', 8]] })).structure;
    expect(still.loops).toEqual([]);
    expect(still.candidates.flatMap((c) => c.evidence.map((e) => e.kind)).filter((k) => k.startsWith('loop'))).toEqual([]);
    expect(still.candidates.length).toBeGreaterThan(2);
  });

  it('places a candidate inside a bar when an arrival chord ends there', () => {
    // bar 2: F then G (half a bar each); bar 3: C for half a bar, then Am
    const project = song({ chords: [['C', 1], ['F', 0.5], ['G', 0.5], ['C', 0.5], ['Am', 0.5], ['F', 1]], sections: [['Verse', 4]] });
    const { structure, harmony } = understand(project);
    expect(harmony.chords[3].fact).toMatchObject({ symbol: 'C', startTick: 7680, endTick: 9600 });
    expect(structure.arrivals).toContainEqual(expect.objectContaining({ tick: 7680, bar: 3, tickInBar: 0, chordIndex: 3, kind: 'dominant-to-tonic' }));
    const inside = structure.candidates.find((c) => c.tick === 9600)!;
    expect(inside).toMatchObject({ bar: 3, tickInBar: 1920, onBarLine: false, level: 'possible-phrase-boundary' });
    expect(inside.evidence.map((e) => [e.kind, e.source])).toEqual([['after-arrival', 'arrival:chord3']]);
    // the arrival on G starts inside bar 2 and is kept at its own tick
    expect(structure.arrivals).toContainEqual(expect.objectContaining({ tick: 5760, bar: 2, tickInBar: 1920, kind: 'onto-fifth-degree' }));
    expect(structure.homeSpans[0].interiorCandidateTicks).toContain(9600);
  });
});

describe('structural proposal — harmonic rate', () => {
  const ids = (rates: number[]) => harmonicRateEvents(rates, 3840, rates.length * 3840).map((e) => [e.kind, e.id, e.evidenceTick]);

  it('reads one busy bar as one event with one observation, at its exit', () => {
    expect(ids([1, 1, 1, 2, 1, 1, 1, 1])).toEqual([['excursion', 'rate-excursion:bar4', 4 * 3840]]);
    // key C: bar 4 holds two chords (G then C), every other bar one
    const project = song({ chords: [['C', 1], ['Am', 1], ['F', 1], ['G', 0.5], ['C', 0.5], ['Am', 1], ['Dm', 1], ['F', 1], ['G', 1]], sections: [['Verse', 8]] });
    const { structure, harmony } = understand(project);
    expect(harmony.rhythm.bars.map((b) => b.chordStarts)).toEqual([1, 1, 1, 2, 1, 1, 1, 1]);
    // the harmonic map still states both edges as facts; the proposal counts the event once
    expect(harmony.rhythm.changes.map((c) => c.bar)).toEqual([4, 5]);
    expect(structure.rateEvents).toEqual([expect.objectContaining({ kind: 'excursion', fromBar: 4, toBar: 4, rateBefore: 1, rateDuring: 2, rateAfter: 1, evidenceTick: 4 * 3840 })]);
    const rateEvidence = structure.candidates.flatMap((c) => c.evidence.filter((e) => e.dimension === 'harmonic-rate').map((e) => [c.tick, e.kind, e.source]));
    expect(rateEvidence).toEqual([[4 * 3840, 'harmonic-rate-excursion', 'rate-excursion:bar4']]);
    // its entry (the bar line of bar 4) carries no rate evidence
    expect(kindsAt(structure, 3 * 3840)).not.toContain('harmonic-rate-excursion');
    // at the exit a closing arrival (G to C) has just finished and the four-bar prior agrees:
    // three items, strength above one half, and still no division — none is a project fact of repetition or of a lasting change
    const exit = structure.candidates.find((c) => c.tick === 4 * 3840)!;
    expect(exit.evidence.map((e) => e.kind).sort()).toEqual(['after-arrival', 'harmonic-rate-excursion', 'metric-grouping']);
    expect(exit.strength).toBeGreaterThan(0.5);
    expect(exit.level).toBe('possible-phrase-boundary');
    expect(structure.homeSpans[0]).toMatchObject({ decision: 'full-section', startTick: 0, endTick: 8 * 3840, bars: 8 });
  });

  it('keeps distinct lasting transitions distinct', () => {
    expect(ids([1, 1, 1, 1, 2, 2, 2, 2, 1, 1, 1, 1])).toEqual([['shift', 'rate-shift:bar5', 4 * 3840], ['shift', 'rate-shift:bar9', 8 * 3840]]);
    // a transitional bar between two prevailing rates belongs to the one shift
    expect(ids([1, 1, 1, 3, 2, 2, 2])).toEqual([['shift', 'rate-shift:bar5', 4 * 3840]]);
    // two separate busy bars are two events
    expect(ids([1, 1, 2, 1, 1, 1, 2, 1, 1])).toEqual([['excursion', 'rate-excursion:bar3', 3 * 3840], ['excursion', 'rate-excursion:bar7', 7 * 3840]]);
    const project = song({
      chords: [...bars('C F G Am'), ...'C Am F G C Am F G'.split(' ').map((s): [string, number] => [s, 0.5]), ...bars('F Dm Em G')],
      sections: [['Verse', 12]],
    });
    const { structure } = understand(project);
    const shifts = structure.candidates.flatMap((c) => c.evidence.filter((e) => e.kind === 'harmonic-rate-shift').map((e) => [c.tick, e.source, e.basis, e.structural]));
    expect(shifts).toEqual([[4 * 3840, 'rate-shift:bar5', 'project', true], [8 * 3840, 'rate-shift:bar9', 'project', true]]);
  });

  it('finds no rate event in steady or merely alternating harmony', () => {
    expect(ids([1, 1, 1, 1, 1, 1, 1, 1])).toEqual([]);
    expect(ids([2, 1, 2, 1, 2, 1, 2, 1])).toEqual([]);
    expect(ids([1, 0, 1, 0, 1, 0])).toEqual([]);
    expect(ids([1, 1, 1, 2, 3, 2, 1, 1, 1])).toEqual([]);
    // a busy last bar is recorded, but its exit is the project end: no evidence tick
    expect(ids([1, 1, 1, 2])).toEqual([['excursion', 'rate-excursion:bar4', null]]);
    expect(ids([1, 1, 1, 2, 1])).toEqual([['excursion', 'rate-excursion:bar4', 4 * 3840]]);
    expect(ids([])).toEqual([]);
  });
});

describe('structural proposal — home spans', () => {
  it('keeps the whole verse and the whole chorus of the reported example', () => {
    const project = dorian();
    const { structure } = understand(project);
    expect(structure.homeSpans.map((h) => [h.typeKey, h.startTick, h.endTick, h.bars, h.decision, h.dividedBy])).toEqual([
      ['verse', 0, 30720, 8, 'full-section', null],
      ['chorus', 30720, 61440, 8, 'full-section', null],
    ]);
    // the bar-4 candidate that used to cut the verse is still there, as a possible phrase boundary
    const bar4 = structure.candidates.find((c) => c.tick === 11520)!;
    expect(bar4.level).toBe('possible-phrase-boundary');
    expect(bar4.evidence.map((e) => e.kind)).toEqual(['after-arrival']);
    // the two-chord bar 4 is one excursion, observed at bar 5 only
    expect(structure.rateEvents.map((e) => [e.id, e.evidenceTick])).toEqual([['rate-excursion:bar4', 15360], ['rate-excursion:bar15', 57600]]);
    expect(structure.homeSpans[0].interiorCandidateTicks).toEqual([7680, 11520, 15360, 19200, 23040, 26880]);
    expect(structure.candidates.filter((c) => c.level === 'structural-division')).toEqual([]);
  });

  it('gives every section type of the fixtures its first occurrence, whole', () => {
    for (const fixture of STRING_FIXTURES) {
      const project = projectForStringCell(cell('chamber', fixture));
      const { structure } = understand(project);
      const sections = sectionMap(project);
      expect(structure.homeSpans.map((h) => h.typeKey).sort()).toEqual([...new Set(sections.map((s) => s.name.trim().toLowerCase()))].sort());
      for (const home of structure.homeSpans) {
        const first = sections.find((s) => s.name.trim().toLowerCase() === home.typeKey)!;
        expect([home.sectionId, home.startTick, home.endTick, home.decision]).toEqual([first.id, first.startTick, first.endTick, 'full-section']);
        expect(home.bars).toBe(first.lengthBars);
        expect(home.basis.length).toBeGreaterThan(0);
        expect(home.interiorCandidateTicks.every((t) => t > home.startTick && t < home.endTick)).toBe(true);
      }
    }
  });

  it('falls back to the whole section when interior evidence is weak or ambiguous', () => {
    const whole = (project: Project) => {
      const { structure } = understand(project);
      expect(structure.homeSpans[0]).toMatchObject({ decision: 'full-section', startTick: 0, bars: 8, dividedBy: null });
      return structure;
    };
    // a full cadence at the four-bar point: reading + prior, strength 0.6, no project fact
    const cadence = whole(song({ chords: bars('C F G C Am Dm Em G'), sections: [['Verse', 8]] }));
    const mid = cadence.candidates.find((c) => c.tick === 4 * 3840)!;
    expect(mid.evidence.map((e) => e.kind).sort()).toEqual(['after-arrival', 'metric-grouping']);
    expect(mid.strength).toBeCloseTo(0.6, 3);
    expect(mid.level).toBe('possible-phrase-boundary');
    expect(mid.levelReason).toContain('no project fact');
    // a progression that restarts on its own, with no closing arrival before the restart
    const openLoop = whole(song({ key: 2, mode: 'Dorian', chords: bars('Dm Bb F C Dm Bb F C'), sections: [['Verse', 8]] }));
    const restart = openLoop.candidates.find((c) => c.tick === 4 * 3840)!;
    expect(restart.evidence.map((e) => e.kind).sort()).toEqual(['loop-restart', 'metric-grouping']);
    expect(restart.level).toBe('possible-phrase-boundary');
    expect(restart.levelReason).toContain('not corroborated');
    // a restart preceded only by a fifth-fall that reaches neither tonic nor fifth degree
    const sequence = whole(song({ key: 2, mode: 'Dorian', chords: bars('Dm F C G Dm F C G'), sections: [['Verse', 8]] }));
    expect(sequence.candidates.find((c) => c.tick === 4 * 3840)!.evidence.map((e) => [e.kind, e.structural])).toContainEqual(['loop-restart', true]);
    expect(sequence.candidates.find((c) => c.tick === 4 * 3840)!.level).toBe('possible-phrase-boundary');
    // a lasting rate shift alone
    whole(song({ chords: [...bars('C Am F Dm'), ...'Em Am Dm G Em F Dm G'.split(' ').map((s): [string, number] => [s, 0.5])], sections: [['Verse', 8]] }));
    // static harmony
    whole(song({ chords: bars('C C C C C C C C'), sections: [['Verse', 8]] }));
  });

  it('divides at a restart that follows a closing arrival', () => {
    const { structure } = understand(song({ chords: bars('C F G C C F G C'), sections: [['Verse', 8]] }));
    const division = structure.candidates.find((c) => c.tick === 4 * 3840)!;
    expect(division.level).toBe('structural-division');
    expect(division.evidence.filter((e) => e.structural).map((e) => [e.kind, e.dimension, e.basis, e.source])).toEqual([
      ['loop-restart', 'repetition', 'project', 'loop:s0:restart2'],
      ['after-arrival', 'harmonic-goal', 'reading', 'arrival:chord3'],
    ]);
    expect(structure.homeSpans[0]).toMatchObject({
      decision: 'divided', startTick: 0, endTick: 4 * 3840, bars: 4,
      dividedBy: { tick: 4 * 3840, sources: ['loop:s0:restart2', 'arrival:chord3'] },
    });
    expect(structure.homeSpans[0].interiorCandidateTicks.every((t) => t < 4 * 3840)).toBe(true);
    // an open ending on the fifth degree before the restart also closes the unit
    const half = understand(song({ chords: bars('C Am F G C Am F G'), sections: [['Verse', 8]] })).structure;
    expect(half.homeSpans[0]).toMatchObject({ decision: 'divided', bars: 4 });
  });

  it('divides where a lasting rate shift follows a closing arrival', () => {
    const { structure } = understand(song({
      chords: [...bars('C Am F C'), ...'Am Dm G Em F Dm G Em'.split(' ').map((s): [string, number] => [s, 0.5])],
      sections: [['Verse', 8]],
    }));
    const division = structure.candidates.find((c) => c.tick === 4 * 3840)!;
    expect(division.evidence.filter((e) => e.structural).map((e) => e.kind).sort()).toEqual(['after-arrival', 'harmonic-rate-shift']);
    expect(division.level).toBe('structural-division');
    expect(structure.homeSpans[0]).toMatchObject({ decision: 'divided', endTick: 4 * 3840, bars: 4 });
  });

  it('follows the material, not a fixed length: unequal sections and other metres', () => {
    // 3/4: a five-bar intro, a six-bar verse of two closed three-bar units, a seven-bar chorus
    const waltz = song({
      metre: [3, 4],
      chords: [...bars('C Am Dm Em F'), ...bars('C G C C G C'), ...bars('Am F Dm Em F Dm G')],
      sections: [['Intro', 5], ['Verse', 6], ['Chorus', 7]],
    });
    const w = understand(waltz);
    expect(w.brief.facts.time).toMatchObject({ numerator: 3, barTicks: 2880, bars: 18 });
    expect(w.structure.loops).toEqual([{ sectionId: 's1', periodBars: 3, cycles: 2, fillsSection: true }]);
    expect(w.structure.homeSpans.map((h) => [h.typeKey, h.startTick, h.endTick, h.bars, h.decision])).toEqual([
      ['intro', 0, 5 * 2880, 5, 'full-section'],
      ['verse', 5 * 2880, 8 * 2880, 3, 'divided'],
      ['chorus', 11 * 2880, 18 * 2880, 7, 'full-section'],
    ]);
    expect(w.structure.candidates.every((c) => c.tick % 2880 === 0)).toBe(true);
    expect(w.structure.candidates[w.structure.candidates.length - 1].tick).toBe(18 * 2880);
    // 6/8: the same shapes, bar length from the metre
    const compound = understand(song({ metre: [6, 8], chords: [...bars('C Am Dm Em F'), ...bars('C G C C G C')], sections: [['Intro', 5], ['Verse', 6]] }));
    const bar = compound.brief.facts.time.barTicks;
    expect(compound.brief.facts.time).toMatchObject({ numerator: 6, denominator: 8, compound: true });
    expect(compound.structure.homeSpans.map((h) => [h.typeKey, h.startTick / bar, h.endTick / bar, h.decision])).toEqual([['intro', 0, 5, 'full-section'], ['verse', 5, 8, 'divided']]);
    // 5/4, one nine-bar section without repetition: the whole section
    const five = understand(song({ metre: [5, 4], chords: bars('C Am F G Em Dm F Am G'), sections: [['Verse', 9]] }));
    expect(five.structure.homeSpans[0]).toMatchObject({ bars: 9, decision: 'full-section', endTick: 9 * five.brief.facts.time.barTicks });
  });
});
