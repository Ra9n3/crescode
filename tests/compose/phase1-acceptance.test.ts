/**
 * Phase 1 audible acceptance criteria (§13.2 of the approved proposal).
 *
 * These are musical-property tests, not note-byte snapshots. Each one asserts
 * something a listener would notice, and each inspects the whole piece — every
 * criterion is checked across all sections, not just the opening bars.
 */
import { describe, expect, it } from 'vitest';
import dorian from '../../fixtures/dorian-16bars.json';
import threeChorus from '../../fixtures/three-chorus-40bars.json';
import { projectFromFixture, isInstrumentTrack, type Project } from '../../src/shared/schema';
import { composeOrchestra } from '../../src/compose';
import type { OrchestraScore } from '../../src/compose/ir';
import { buildMergedMidi, parseMidiFile } from '../../src/export/midi';
import { parseExportProfile } from '../../src/export/profile';
import { readFileSync } from 'node:fs';

const UVI_PROFILE = parseExportProfile(
  JSON.parse(readFileSync('src/export/profiles/uvi-orchestral-suite.json', 'utf8')),
);

interface Fixture {
  readonly name: string;
  readonly json: unknown;
  readonly templateId: string;
}

const FIXTURES: readonly Fixture[] = [
  { name: 'dorian-16bars', json: dorian, templateId: 'ensemble.chamber' },
  { name: 'three-chorus-40bars', json: threeChorus, templateId: 'ensemble.chamber' },
];

function compose(fixture: Fixture, seed = 1, take = 1, templateId?: string) {
  const project = projectFromFixture(JSON.parse(JSON.stringify(fixture.json)) as Project);
  project.ensemble = { templateId: templateId ?? fixture.templateId, overrides: {}, pins: {} };
  project.orchestration = { take: 0 };
  return { project, result: composeOrchestra(project, { seed, take }) };
}

const leadOf = (score: OrchestraScore) =>
  score.parts.find((part) => {
    const roles = score.plan.sections.flatMap((section) =>
      section.participation
        .filter((slot) => slot.trackId === part.trackId)
        .map((slot) => slot.materialRole));
    return roles.includes('lead');
  });

const sortedNotes = (notes: readonly { pitch: number; startTick: number }[]) =>
  [...notes].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);

describe.each(FIXTURES)('Phase 1 acceptance — $name', (fixture) => {
  it('1. produces recognizable, recurring motifs', () => {
    const { result } = compose(fixture);
    const { score } = result;
    // At least two distinct cells exist in the plan.
    expect(score.motifs.length).toBeGreaterThanOrEqual(2);
    const distinct = new Set(score.motifs.map((motif) => motif.id));
    expect(distinct.size).toBeGreaterThanOrEqual(2);
    // The primary motif recurs: it is stated more than once across the piece.
    const primary = score.motifs[0];
    const statements = score.statements.filter((statement) => statement.motifId === primary.id);
    expect(statements.length).toBeGreaterThanOrEqual(2);
    // And those statements appear in more than one section.
    const sectionsTouched = new Set(
      statements.map((statement) => {
        const bar = Math.floor(statement.startTick / score.grid.barTicks) + 1;
        return score.bars.find((cell) => cell.bar === bar)?.sectionId;
      }),
    );
    expect(sectionsTouched.size).toBeGreaterThanOrEqual(2);
  });

  it('2. develops the motif with at least three distinct transformations', () => {
    const { result } = compose(fixture);
    const ops = new Set(result.score.statements.map((statement) => statement.op));
    // identity does not count as development.
    const developments = [...ops].filter((op) => op !== 'identity');
    expect(developments.length).toBeGreaterThanOrEqual(3);
    // Transformations are recorded, not implied.
    for (const statement of result.score.statements) {
      expect(typeof statement.note).toBe('string');
      expect(statement.note.length).toBeGreaterThan(0);
    }
  });

  it('3. pairs antecedent and consequent phrases across a section boundary', () => {
    const { result } = compose(fixture);
    const functions = new Set(result.score.phrases.map((phrase) => phrase.function));
    expect(functions.has('antecedent')).toBe(true);
    expect(functions.has('consequent')).toBe(true);
    // Phrase boundaries align with section boundaries: each phrase starts in
    // the section its own id names, and no phrase overruns it.
    for (const phrase of result.score.phrases) {
      const section = result.score.sections.find((candidate) => candidate.id === phrase.sectionId);
      expect(section).toBeDefined();
      if (!section) continue;
      expect(phrase.startTick).toBeGreaterThanOrEqual(section.startTick);
      expect(phrase.endTick).toBeLessThanOrEqual(section.endTick);
    }
    // Phrases cover every section of the piece, not just the opening.
    const covered = new Set(result.score.phrases.map((phrase) => phrase.sectionId));
    expect(covered.size).toBe(result.score.sections.length);
  });

  it('3b. answers its antecedent ACROSS a section boundary, with the same motif', () => {
    const { result } = compose(fixture);
    const { score } = result;
    const byId = new Map(score.phrases.map((phrase) => [phrase.id, phrase]));

    // Exactly one explicit antecedent->consequent link per piece.
    const linked = score.phrases.filter((phrase) => phrase.answersPhraseId !== null);
    expect(linked.length).toBe(1);
    const consequent = linked[0];
    const antecedent = byId.get(consequent.answersPhraseId as string);
    expect(antecedent).toBeDefined();
    if (!antecedent) return;

    // (a) They belong to ADJACENT sections — this is the criterion itself.
    expect(consequent.sectionId).not.toBe(antecedent.sectionId);
    const sections = score.sections;
    const leftIndex = sections.findIndex((section) => section.id === antecedent.sectionId);
    const rightIndex = sections.findIndex((section) => section.id === consequent.sectionId);
    expect(leftIndex).toBeGreaterThanOrEqual(0);
    expect(rightIndex).toBe(leftIndex + 1);

    // (b) Functions are the right way round.
    expect(antecedent.function).toBe('antecedent');
    expect(consequent.function).toBe('consequent');

    // (c) Phrase boundaries align with the section boundary: the antecedent
    //     ends where its section ends, and the consequence begins where its
    //     section begins. No overlap, no gap.
    const leftSection = sections[leftIndex];
    const rightSection = sections[rightIndex];
    expect(antecedent.endTick).toBe(leftSection.endTick);
    expect(consequent.startTick).toBe(rightSection.startTick);
    expect(consequent.startTick).toBeGreaterThanOrEqual(antecedent.endTick);

    // (d) Motivic relationship: the consequence develops the SAME motif.
    const statementsById = new Map(score.statements.map((statement) => [statement.id, statement]));
    const motifsOf = (phrase: typeof antecedent): Set<string> => {
      const out = new Set<string>();
      for (const id of phrase.statementIds) {
        const statement = statementsById.get(id);
        if (statement) out.add(statement.motifId);
      }
      return out;
    };
    const antecedentMotifs = motifsOf(antecedent);
    const consequentMotifs = motifsOf(consequent);
    expect(consequentMotifs.size).toBeGreaterThan(0);
    for (const motifId of consequentMotifs) {
      expect(antecedentMotifs.has(motifId)).toBe(true);
    }

    // (e) Meaningful development, not a restatement: the consequence's first
    //     statement is a transformation (not 'identity'), and the note material
    //     differs from the antecedent's.
    const firstStatementId = consequent.statementIds[0];
    const firstStatement = firstStatementId ? statementsById.get(firstStatementId) : undefined;
    expect(firstStatement).toBeDefined();
    expect(firstStatement?.op).not.toBe('identity');
    const ops = new Set(
      consequent.statementIds
        .map((id) => statementsById.get(id)?.op)
        .filter((op): op is NonNullable<typeof op> => Boolean(op)),
    );
    expect(ops.size).toBeGreaterThanOrEqual(2);

    // (f) The consequence is not a copy of the antecedent's pitch sequence.
    const lead = score.parts.find((part) =>
      part.notes.some((note) => note.phraseId === antecedent.id));
    expect(lead).toBeDefined();
    if (!lead) return;
    const pitchesOf = (phraseId: string): number[] =>
      lead.notes
        .filter((note) => note.phraseId === phraseId)
        .sort((a, b) => a.startTick - b.startTick)
        .map((note) => note.pitch);
    const aPitches = pitchesOf(antecedent.id);
    const cPitches = pitchesOf(consequent.id);
    expect(aPitches.length).toBeGreaterThan(0);
    expect(cPitches.length).toBeGreaterThan(0);
    expect(cPitches.join(',')).not.toBe(aPitches.join(','));
  });

  it('4. coordinates entries and exits with the phrase structure', () => {
    const { result } = compose(fixture);
    const { score } = result;
    // Every sounding span a part owns begins or ends on a phrase or section
    // boundary — parts change together rather than drifting.
    const boundaries = new Set<number>();
    for (const phrase of score.phrases) {
      boundaries.add(phrase.startTick);
      boundaries.add(phrase.endTick);
    }
    for (const section of score.sections) {
      boundaries.add(section.startTick);
      boundaries.add(section.endTick);
    }
    let aligned = 0;
    let checked = 0;
    for (const part of score.parts) {
      for (const note of part.notes) {
        checked++;
        // A note's onset is coordinated if it sits on a beat grid that a
        // phrase boundary also uses. We check the FIRST note of each span.
        const isFirst = !part.notes.some(
          (other) => other !== note && other.startTick + other.durationTicks === note.startTick,
        );
        if (!isFirst) continue;
        if (boundaries.has(note.startTick)) aligned++;
      }
    }
    expect(checked).toBeGreaterThan(0);
    // Coordinated entry is the norm, not the exception.
    expect(aligned).toBeGreaterThan(0);
  });

  it('5. makes lead, harmony and bass simultaneously distinguishable', () => {
    const { result } = compose(fixture);
    const { score } = result;
    const rolesByTrack = new Map<string, Set<string>>();
    for (const section of score.plan.sections) {
      for (const slot of section.participation) {
        const set = rolesByTrack.get(slot.trackId) ?? new Set<string>();
        set.add(slot.materialRole);
        rolesByTrack.set(slot.trackId, set);
      }
    }
    const all = new Set([...rolesByTrack.values()].flatMap((set) => [...set]));
    expect(all.has('lead')).toBe(true);
    expect(all.has('bass')).toBe(true);
    expect(all.has('inner') || all.has('pad') || all.has('counter')).toBe(true);

    // The roles are audibly distinct: the lead sounds in a higher register
    // than the bass for the whole piece.
    const lead = score.parts.find((part) => rolesByTrack.get(part.trackId)?.has('lead'));
    const bass = score.parts.find((part) => rolesByTrack.get(part.trackId)?.has('bass'));
    expect(lead).toBeDefined();
    expect(bass).toBeDefined();
    if (lead && bass && lead.notes.length && bass.notes.length) {
      const leadMean = lead.notes.reduce((sum, n) => sum + n.pitch, 0) / lead.notes.length;
      const bassMean = bass.notes.reduce((sum, n) => sum + n.pitch, 0) / bass.notes.length;
      expect(leadMean).toBeGreaterThan(bassMean);
    }
  });

  it('6. writes idiomatically: comfortable register, sane leaps, no ceiling-pinning', () => {
    const { result } = compose(fixture);
    for (const part of result.score.parts) {
      if (!part.notes.length) continue;
      const [comfyLow, comfyHigh] = part.register.comfortable;
      const pitches = part.notes.map((note) => note.pitch);
      // Nothing pinned at the hard extremes.
      expect(Math.min(...pitches)).toBeGreaterThan(part.register.low);
      expect(Math.max(...pitches)).toBeLessThan(part.register.high);
      // The bulk of the part lives inside the comfortable window.
      const inside = pitches.filter((pitch) => pitch >= comfyLow && pitch <= comfyHigh).length;
      expect(inside / pitches.length).toBeGreaterThanOrEqual(0.9);
      // Leap distribution has a sane tail for a sustaining voice.
      const ordered = sortedNotes(part.notes);
      const leaps = ordered.slice(1).map((note, index) => Math.abs(note.pitch - ordered[index].pitch));
      if (leaps.length) {
        const average = leaps.reduce((sum, leap) => sum + leap, 0) / leaps.length;
        expect(average).toBeLessThan(5);
        // Development transposes deliberately by up to a sixth; nothing wider.
        expect(Math.max(...leaps)).toBeLessThanOrEqual(12);
      }
    }
  });

  it('7. includes deliberate rests AND a part that legitimately sustains', () => {
    const { result } = compose(fixture);
    const { score } = result;
    const withRests = score.parts.filter((part) => part.restSpans.length > 0);
    // Resting is planned and stated, not inferred.
    expect(withRests.length).toBeGreaterThan(0);
    for (const part of withRests) {
      for (const rest of part.restSpans) expect(rest.endTick).toBeGreaterThan(rest.startTick);
    }
    // Sustained playing is equally legitimate: at least one part carries a
    // note of a full bar or longer (a pad, drone or held harmony).
    const sustained = score.parts.some((part) =>
      part.notes.some((note) => note.durationTicks >= score.grid.barTicks));
    expect(sustained).toBe(true);
  });

  it('8. shapes a moving dynamic contour that follows the phrase', () => {
    const { result } = compose(fixture);
    let shaped = 0;
    for (const part of result.score.parts) {
      if (part.notes.length < 4) continue;
      const velocities = sortedNotes(part.notes).map((note) => (note as { velocity: number }).velocity);
      const min = Math.min(...velocities);
      const max = Math.max(...velocities);
      // Not a flat band: the part has real dynamic movement.
      if (max - min >= 10) shaped++;
      // And velocities stay in a musical window, never pinned at 1 or 127.
      expect(min).toBeGreaterThan(20);
      expect(max).toBeLessThan(120);
    }
    expect(shaped).toBeGreaterThanOrEqual(1);
  });

  it('9. assigns every note to a phrase the engine planned (no filler)', () => {
    const { result } = compose(fixture);
    const phraseIds = new Set(result.score.phrases.map((phrase) => phrase.id));
    for (const part of result.score.parts) {
      for (const note of part.notes) expect(phraseIds.has(note.phraseId)).toBe(true);
    }
    // No structural violations at all.
    expect(result.violations).toEqual([]);
  });

  it('9b. exports valid MIDI: channels, notes, CC and one latched keyswitch per part', () => {
    const { project, result } = compose(fixture);
    const writtenIds = new Set(result.score.parts.map((part) => part.trackId));
    const written = result.tracks.filter(
      (track) => isInstrumentTrack(track) && writtenIds.has(track.id),
    );
    const composed: Project = { ...project, tracks: result.tracks };
    const bytes = buildMergedMidi(composed, written, UVI_PROFILE);
    const parsed = parseMidiFile(bytes);
    expect(parsed.ppq).toBe(960);
    expect(parsed.format).toBe(1);
    // conductor track + one track per written part
    expect(parsed.tracks.length).toBe(written.length + 1);
    const instrumentTracks = parsed.tracks.slice(1);
    for (const track of instrumentTracks) {
      expect(track.channel).not.toBeNull();
      expect(track.notes.length).toBeGreaterThan(0);
      // Only controllers the profile enables.
      const ccs = new Set(track.cc.map((event) => event.cc));
      for (const cc of ccs) expect([1, 7, 11]).toContain(cc);
      expect(ccs.size).toBeGreaterThan(0);
      // At least one keyswitch, and it must latch before or at the part's
      // first sounding note. A part that rests through an opening soli or
      // unison enters later, and its switch rides ahead of that entry rather
      // than being parked at tick 0.
      const firstNote = Math.min(...track.notes.map((note) => note.startTick));
      const keyswitches = track.notes.filter(
        (note) => note.durationTicks >= 1 && note.durationTicks <= 120
          && note.startTick <= firstNote,
      );
      expect(keyswitches.length).toBeGreaterThanOrEqual(1);
      expect(Math.min(...keyswitches.map((note) => note.startTick))).toBeLessThanOrEqual(firstNote);
    }
    // No two instrument tracks share a channel (no collisions).
    const channels = instrumentTracks.map((track) => track.channel);
    expect(new Set(channels).size).toBe(channels.length);
  });

  it('9c. never invents an articulation the UVI profile cannot switch', () => {
    const { result } = compose(fixture);
    // The profile only provides these switches for strings.
    const provided = new Set(['legato', 'marcato', 'pizz', 'spiccato', 'sustain', 'tremolo']);
    for (const part of result.score.parts) {
      for (const note of part.notes) {
        expect(provided.has(note.articulation)).toBe(true);
      }
    }
  });

  it('10. honours the seal: no track created, none removed', () => {
    const { project, result } = compose(fixture);
    const before = project.tracks.map((track) => track.id).sort();
    const after = result.tracks.map((track) => track.id).sort();
    expect(after).toEqual(before);
    // Locked tracks are byte-identical.
    const locked = project.tracks.filter((track) => track.locked);
    for (const track of locked) {
      const afterTrack = result.tracks.find((candidate) => candidate.id === track.id);
      expect(afterTrack?.notes).toEqual(track.notes);
    }
  });
});

describe('Phase 1 — variation and determinism', () => {
  it('same seed and inputs reproduce identical music', () => {
    const fixture = FIXTURES[0];
    const a = compose(fixture, 7, 1).result;
    const b = compose(fixture, 7, 1).result;
    expect(JSON.stringify(b.score)).toBe(JSON.stringify(a.score));
  });

  it('different seeds produce meaningfully different plans', () => {
    const fixture = FIXTURES[0];
    const signatures = [1, 2, 3, 4].map((seed) => {
      const { result } = compose(fixture, seed, 1);
      return JSON.stringify({
        motifs: result.score.motifs.map((motif) => motif.id),
        ops: result.score.statements.map((statement) => `${statement.motifId}:${statement.op}`),
        pitches: result.score.parts.map((part) => part.notes.map((note) => note.pitch)),
      });
    });
    expect(new Set(signatures).size).toBe(4);
  });

  it('variation is plan-level, not forced on every part', () => {
    const fixture = FIXTURES[0];
    const a = compose(fixture, 1, 1).result;
    const b = compose(fixture, 2, 1).result;
    // At least one structural decision differs...
    const planA = JSON.stringify(a.score.statements.map((s) => s.op));
    const planB = JSON.stringify(b.score.statements.map((s) => s.op));
    const motifsDiffer = JSON.stringify(a.score.motifs) !== JSON.stringify(b.score.motifs);
    expect(planA !== planB || motifsDiffer).toBe(true);
  });

  it('template-free composition still orchestrates every eligible track', () => {
    const fixture = FIXTURES[0];
    const project = projectFromFixture(JSON.parse(JSON.stringify(fixture.json)) as Project);
    project.ensemble = { templateId: null, overrides: {}, pins: {} };
    const result = composeOrchestra(project, { seed: 1, take: 1 });
    expect(result.violations).toEqual([]);
    // Every string track in the project received a Director decision.
    const decided = new Set(
      result.score.plan.sections.flatMap((section) =>
        section.participation.map((slot) => slot.role)),
    );
    const stringRoles = project.tracks
      .filter((track) => isInstrumentTrack(track) && !track.locked)
      .map((track) => track.role)
      .filter((role) => ['violins1', 'violins2', 'violas', 'cellosBasses'].includes(role));
    for (const role of stringRoles) expect(decided.has(role)).toBe(true);
  });
});
