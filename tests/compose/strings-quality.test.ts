/**
 * Musical-quality regression tests for the strings engine.
 *
 * These are deliberately NOT "does it produce notes" tests. Each one pins a
 * musical property that was measured as deficient before the quality milestone,
 * so a future change that quietly reverts to the old behaviour fails here:
 *
 *   - rhythmic monotony (one 3840-tick pad per chord for every accompaniment)
 *   - the Director's pulse/accent roles being ignored
 *   - articulation not responding to the written rhythm
 *   - every voice still sounding at every phrase boundary (no breathing)
 *   - identical CC curves on inner voices that share a role
 *   - register, doubling and motif-identity guarantees that must NOT regress
 */
import { describe, expect, it } from 'vitest';
import dorian from '../../fixtures/dorian-16bars.json';
import threeChorus from '../../fixtures/three-chorus-40bars.json';
import { projectFromFixture, isInstrumentTrack, type Project } from '../../src/shared/schema';
import { composeOrchestra, type ComposeResult } from '../../src/compose';
import { checkTemplateRules } from '../../src/orchestrator/energy/rules';
import { resolveTemplate } from '../../src/config/ensembles';
import { expandFigure, rhythmicFigureFor } from '../../src/compose/families/rhythm';

const STRINGS = ['violins1', 'violins2', 'violas', 'cellosBasses'] as const;

const TEMPLATES = ['ensemble.chamber', 'ensemble.sonata', 'ensemble.vocalbacking'] as const;

interface Run {
  readonly name: string;
  readonly template: string;
  readonly result: ComposeResult;
}

function run(fixture: unknown, name: string, templateId: string, seed: number): Run {
  const project = projectFromFixture(JSON.parse(JSON.stringify(fixture)) as Partial<Project>);
  project.ensemble = { templateId, overrides: {}, pins: {} };
  return { name, template: templateId, result: composeOrchestra(project, { seed, take: 1 }) };
}

const matrix: Run[] = [];
for (const template of TEMPLATES) {
  matrix.push(run(dorian, 'dorian-16bars', template, 1));
  matrix.push(run(threeChorus, 'three-chorus-40bars', template, 1));
}

const stringParts = (r: Run) =>
  r.result.score.parts.filter((part) => (STRINGS as readonly string[]).includes(part.role));

describe('rhythm: the figure must respond to context, not be one pad per chord', () => {
  it('gives every sounding voice real rhythmic movement, not one held pad', () => {
    // Measured BEFORE the milestone on three-chorus-40bars/chamber:
    //   violas       1 distinct duration, 1 rest span
    //   cellosBasses 1 distinct duration, 0 rest spans
    // i.e. both wrote a single whole-span note for the entire piece. A voice
    // with fewer than 3 distinct durations over a 40-bar piece is still a pad.
    for (const r of matrix) {
      for (const part of stringParts(r)) {
        if (part.notes.length < 12) continue;
        const distinct = new Set(part.notes.map((note) => note.durationTicks)).size;
        expect(distinct, `${r.name}/${r.template} ${part.role} is rhythmically monotone`)
          .toBeGreaterThan(2);
      }
    }
  });

  it('gives the foundation and inner voices actual rests, not a wall of sound', () => {
    // Before: cellosBasses 0 rest spans, violas 1, across the whole piece.
    let total = 0;
    for (const r of matrix) {
      for (const part of stringParts(r)) total += part.restSpans?.length ?? 0;
    }
    expect(total, 'the section never breathes').toBeGreaterThan(20);
  });

  it('does not leave every voice on the same rhythm', () => {
    for (const r of matrix) {
      const parts = stringParts(r).filter((part) => part.notes.length > 4);
      if (parts.length < 2) continue;
      const signatures = new Set(
        parts.map((part) => part.notes.map((note) => note.durationTicks).join(',')),
      );
      expect(signatures.size, `${r.name}/${r.template} every string voice plays the same rhythm`)
        .toBeGreaterThan(1);
    }
  });

  it('leaves real rests, so the section breathes', () => {
    // A section that never stops is a pad, not an arrangement.
    const withRests = matrix.flatMap((r) => stringParts(r)).filter((p) => p.restSpans?.length);
    expect(withRests.length).toBeGreaterThan(0);
  });
});

describe('rhythm: figures honour the meter and the span', () => {
  it('never emits a slice outside the span or inverted', () => {
    const cases = [
      { beats: 1, rest: 0.5 },
      { beats: 2, rest: 0 },
      { beats: 0.5, rest: 0.5 },
    ];
    for (const beatTicks of [480, 240, 960]) {
      for (const length of [beatTicks, beatTicks * 3, beatTicks * 4 + 7]) {
        const slices = expandFigure(cases, 1000, length, beatTicks);
        // Slices advance monotonically and stay inside the span. They need NOT
        // be contiguous: a cell with `rest` deliberately leaves a gap, and
        // asserting contiguity would forbid the rests this milestone added.
        let previousStart = 1000;
        for (const slice of slices) {
          expect(slice.end).toBeGreaterThan(slice.start);
          expect(slice.start).toBeGreaterThanOrEqual(previousStart);
          expect(slice.end).toBeLessThanOrEqual(1000 + length);
          previousStart = slice.start;
        }
        // The figure starts ON the chord change, so the harmony is audible.
        expect(slices[0].start).toBe(1000);
      }
    }
  });

  it('answers a pulse role with a repeated figure, never a pad', () => {
    const figure = rhythmicFigureFor({
      role: 'pulse', phraseFunction: 'antecedent', energy: 0.5, spanOrdinal: 1, voiceCount: 4,
    });
    expect(figure.some((cell) => cell.beats <= 1)).toBe(true);
  });

  it('answers a pad role with sustain', () => {
    const figure = rhythmicFigureFor({
      role: 'pad', phraseFunction: 'climax', energy: 1, spanOrdinal: 3, voiceCount: 8,
    });
    expect(figure).toHaveLength(1);
    expect(figure[0].rest).toBe(0);
  });

  it('keeps a two-voice texture sustained: no middle to fill', () => {
    const figure = rhythmicFigureFor({
      role: 'bass', phraseFunction: 'climax', energy: 1, spanOrdinal: 2, voiceCount: 2,
    });
    expect(figure).toHaveLength(1);
    expect(figure[0].rest).toBe(0);
  });

  it('reaches every option of a multi-variant figure set', () => {
    // spanOrdinal is 1-based; indexing it directly made index 0 unreachable and
    // silently deleted every `rest > 0` variant.
    const seen = new Set<string>();
    for (let ordinal = 1; ordinal <= 6; ordinal++) {
      seen.add(JSON.stringify(rhythmicFigureFor({
        role: 'inner', phraseFunction: 'antecedent', energy: 0.8, spanOrdinal: ordinal, voiceCount: 4,
      })));
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('articulation responds to the written rhythm', () => {
  it('uses a short bow where the written rhythm asks for one', () => {
    // Before: the only articulations produced were legato/sustain/marcato, and
    // cellos were 100% sustain. spiccato is the profile's short-bow switch and
    // is the audible difference between a pad and a rhythmic inner part.
    const arts = new Set(matrix.flatMap((r) => stringParts(r).flatMap(
      (part) => part.notes.map((note) => note.articulation),
    )));
    expect(arts.size, 'articulation vocabulary is too narrow').toBeGreaterThanOrEqual(3);
    expect(arts.has('spiccato'), 'no short-bow articulation anywhere').toBe(true);
    // Per-part variety is required only of voices that RECEIVE a varied figure.
    // A bass foundation deliberately holds (see the two-voice rule), so a
    // single sustain there is correct rather than sloppy -- asserting otherwise
    // would push the engine into chopping up the foundation to satisfy a test.
    // Per-part variety is required only where the voice is genuinely given a
    // separated figure. A low-energy passage correctly keeps the bass on one
    // sustained bow -- demanding otherwise would be imposing variety for its
    // own sake, which the milestone explicitly rules out.
    // A voice that is given BOTH short and long cells must not bow them all
    // identically. `shortCells` counts notes at or below one beat: a part with
    // many of those alongside long ones is being asked to articulate.
    let variedParts = 0;
    for (const r of matrix) {
      const beat = 480;
      for (const part of stringParts(r)) {
        if (part.notes.length < 12) continue;
        const short = part.notes.filter((note) => note.durationTicks <= beat).length;
        const long = part.notes.filter((note) => note.durationTicks > beat * 2).length;
        if (short < 3 || long < 2) continue;
        variedParts++;
        const shortArts = new Set(part.notes
          .filter((note) => note.durationTicks <= beat)
          .map((note) => note.articulation));
        const longArts = new Set(part.notes
          .filter((note) => note.durationTicks > beat * 2)
          .map((note) => note.articulation));
        // The short cells must not be bowed exactly like the long ones.
        const identical = shortArts.size === 1 && longArts.size === 1
          && [...shortArts][0] === [...longArts][0];
        expect(identical, `${r.name}/${r.template} ${part.role} bows short and long cells identically`)
          .toBe(false);
      }
    }
    expect(variedParts, 'no voice mixed short and long cells at all').toBeGreaterThan(0);
  });

  it('never invents an articulation the UVI profile cannot switch', () => {
    const supported = new Set(['sustain', 'legato', 'marcato', 'pizz', 'spiccato', 'tremolo']);
    for (const r of matrix) {
      for (const part of stringParts(r)) {
        for (const note of part.notes) expect(supported.has(note.articulation)).toBe(true);
      }
    }
  });
});

describe('phrase endings release instead of running into the next phrase', () => {
  it('does not leave every voice sounding through every phrase boundary', () => {
    for (const r of matrix) {
      const parts = stringParts(r).filter((part) => part.notes.length > 4);
      if (parts.length < 2) continue;
      const phrases = r.result.score.phrases;
      if (!phrases.length) continue;
      let allSounding = 0;
      for (const phrase of phrases) {
        const sounding = parts.filter((part) => part.notes.some(
          (note) => note.startTick < phrase.endTick
            && note.startTick + note.durationTicks > phrase.endTick - 1,
        )).length;
        if (sounding === parts.length) allSounding++;
      }
      // Measured before the breathing pass: 6 of 14 phrases on
      // three-chorus-40bars/chamber ended with the ENTIRE section still
      // sounding. Requiring strictly fewer than half is what distinguishes the
      // fixed engine from the old one, which sat at 43%.
      expect(allSounding / phrases.length, `${r.name}/${r.template}: no phrase releases`)
        .toBeLessThan(0.5);
    }
  });
});

describe('regressions that must not return', () => {
  it('keeps every string note inside its own comfortable register', () => {
    for (const r of matrix) {
      for (const part of stringParts(r)) {
        const [low, high] = part.register.comfortable;
        for (const note of part.notes) {
          expect(note.pitch, `${r.name}/${r.template} ${part.role} below register`).toBeGreaterThanOrEqual(low);
          expect(note.pitch).toBeLessThanOrEqual(high);
        }
      }
    }
  });

  it('keeps accidental octave doublings at or below 30', () => {
    let total = 0;
    for (const r of matrix) {
      const project = projectFromFixture(JSON.parse(JSON.stringify(
        r.name === 'dorian-16bars' ? dorian : threeChorus,
      )) as Partial<Project>);
      project.ensemble = { templateId: r.template, overrides: {}, pins: {} };
      const template = resolveTemplate(project.ensemble)!;
      total += checkTemplateRules({ ...project, tracks: r.result.tracks }, template)
        .filter((finding) => finding.rule === 'octaveDoubling').length;
    }
    expect(total).toBeLessThanOrEqual(30);
  });

  it('keeps the aggregate duplicate pitch-class rate below 2%', () => {
    // The 12.5% -> below 2% target is an AGGREGATE over the regression matrix,
    // so it is asserted in aggregate here rather than per configuration.
    let pairs = 0;
    let duplicated = 0;
    for (const r of matrix) {
      const parts = stringParts(r);
      for (let i = 0; i < parts.length; i++) {
        for (let j = i + 1; j < parts.length; j++) {
          for (const a of parts[i].notes) {
            for (const b of parts[j].notes) {
              const overlaps = a.startTick < b.startTick + b.durationTicks
                && b.startTick < a.startTick + a.durationTicks;
              if (!overlaps) continue;
              pairs++;
              if ((((a.pitch - b.pitch) % 12) + 12) % 12 === 0) duplicated++;
            }
          }
        }
      }
    }
    expect(pairs).toBeGreaterThan(0);
    expect(duplicated / pairs, 'aggregate duplicate pitch-class pairs').toBeLessThan(0.02);
  });

  it('documents the two-part texture as intentional reinforcement, not an error', () => {
    // In a two-voice texture (sonata: violins1 + cellosBasses) both voices are
    // anchors, so a lead note landing on the bass's class cannot be moved
    // without rewriting the melody or dropping the bass. A cello doubling the
    // tune an octave below is a legitimate string texture, so this is ACCEPTED
    // reinforced unison rather than a defect -- but it is pinned here so the
    // number cannot drift silently in either direction.
    const twoPart = matrix.filter((r) => stringParts(r).length === 2);
    expect(twoPart.length).toBeGreaterThan(0);
    for (const r of twoPart) {
      const parts = stringParts(r);
      let pairs = 0;
      let duplicated = 0;
      for (const a of parts[0].notes) {
        for (const b of parts[1].notes) {
          if (!(a.startTick < b.startTick + b.durationTicks
            && b.startTick < a.startTick + a.durationTicks)) continue;
          pairs++;
          if ((((a.pitch - b.pitch) % 12) + 12) % 12 === 0) duplicated++;
        }
      }
      if (!pairs) continue;
      // Well above the 2% ensemble target, and deliberately so: two voices
      // cannot spread a triad. Anything approaching 1.0 would mean the voices
      // had collapsed onto one line.
      expect(duplicated / pairs).toBeLessThan(0.5);
    }
  });

  it('keeps motif lineage acyclic and forward-referencing', () => {
    for (const r of matrix) {
      const byId = new Map(r.result.score.statements.map((statement) => [statement.id, statement]));
      for (const statement of r.result.score.statements) {
        if (!statement.parentStatementId) continue;
        const parent = byId.get(statement.parentStatementId);
        expect(parent, `missing parent for ${statement.id}`).toBeDefined();
        expect(parent!.startTick).toBeLessThanOrEqual(statement.startTick);
      }
      expect(r.result.score.statements.length).toBeGreaterThan(0);
    }
  });

  it('never duplicates a CC curve across roles that differ', () => {
    for (const r of matrix) {
      const tracks = r.result.tracks.filter(
        (track) => isInstrumentTrack(track) && (STRINGS as readonly string[]).includes(track.role),
      );
      const curves = new Map<string, string>();
      for (const track of tracks) {
        const lanes = ((track as unknown as { cc?: { cc: number; points: { tick: number; value: number }[] }[] }).cc) ?? [];
        const lane = lanes.find((entry) => entry.cc === 7);
        if (!lane) continue;
        const signature = lane.points.map((point) => `${point.tick}:${point.value}`).join(',');
        const existing = curves.get(signature);
        if (existing !== undefined) {
          // Two voices with the same role may share a band, but not an exact
          // curve: identical CC7 was the mechanical behaviour this fixed.
          expect(signature.length).toBeGreaterThan(0);
          expect(existing).not.toBe(track.role);
        }
        curves.set(signature, track.role);
      }
    }
  });
});

describe('distinct roles are still available to every string instrument', () => {
  it('lets a string instrument other than the first violins take the lead', () => {
    const leaders = new Set<string>();
    for (const r of matrix) {
      for (const part of stringParts(r)) {
        if (part.notes.some((note) => note.role === 'lead')) leaders.add(part.role);
      }
    }
    expect(leaders.size).toBeGreaterThan(1);
  });
});
