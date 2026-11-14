/**
 * Strings V1 Stage 2 — the first composed voice: a theme, its adaptation,
 * phrases, the instrument chosen for it, the notes, the isolation of
 * everything else, and the export of the result.
 * Structural checks only: nothing here says how the music sounds.
 */
import { describe, expect, it } from 'vitest';
import { parseMidi } from 'midi-file';
import { composeAllTracks, type ComposeResult } from '../src/orchestrator/compose';
import { buildMergedMidi, buildPerTrackMidi } from '../src/export/midi';
import { EXPORT_PROFILES } from '../src/export/profiles';
import { chordSpans, sectionMap } from '../src/orchestrator/spine';
import { MODES } from '../src/shared/schema/modes';
import { freshEnsemble } from '../src/shared/schema/band';
import { isInstrumentTrack, type Project } from '../src/shared/schema';
import { buildStringsUnderstanding } from '../src/orchestrator/strings/understanding';
import { STRING_PROFILE_BY_ROLE } from '../src/orchestrator/profiles/strings';
import { STRING_INSTRUMENT_IDS, STRING_INSTRUMENT_SOURCES, buildInstrumentCapabilities, triggerableArticulations } from '../src/orchestrator/strings/characters/capabilities';
import { adaptMaterial } from '../src/orchestrator/strings/material/adapt';
import { judgeLine, localScale, type TonalFrame } from '../src/orchestrator/strings/material/line';
import { generateTheme, THEME_BARS } from '../src/orchestrator/strings/material/theme';
import { planPhrases } from '../src/orchestrator/strings/phrases/plan';
import { selectInstrument, type SelectionCandidate } from '../src/orchestrator/strings/writers/select';
import type { StringsV1Composition } from '../src/orchestrator/strings/composition';
import { devStringsAuditionOverride } from '../src/dev/stringsAudition';
import { STRING_FIXTURES, STRING_TEMPLATES, composeStringCell, isStringTrack, noteKey, projectForStringCell, type StringCell } from './strings-v1-support';

const PROFILE = EXPORT_PROFILES.find((entry) => entry.id === 'uvi-orchestral-suite')!.profile;
const MAIN: StringCell = { template: 'chamber', fixture: 'dorian-16bars', seed: 1, take: 0 };
const compositionOf = (r: ComposeResult): StringsV1Composition => r.stringsDiagnostics.v1!.composition!;

function frameOf(fixture: StringCell['fixture']): { frame: TonalFrame; project: Project; understanding: ReturnType<typeof buildStringsUnderstanding> } {
  const project = projectForStringCell({ template: 'chamber', fixture, seed: 1, take: 0 });
  const understanding = buildStringsUnderstanding({ project, template: null, ensemble: freshEnsemble(), spans: chordSpans(project), sections: sectionMap(project), take: 1 });
  return { project, understanding, frame: { key: project.key, scale: MODES[project.mode], barTicks: 3840, beatTicks: 960, beatsPerBar: 4, harmony: understanding.harmony } };
}

const main = composeStringCell(MAIN, 'v1');
const mainClassic = composeStringCell(MAIN, 'classic');
const comp = compositionOf(main.result);

describe('the theme', () => {
  it('has an explicit identity and is not reducible to chord tones', () => {
    const theme = comp.theme!;
    expect(theme.notes.length).toBeGreaterThanOrEqual(6);
    expect(theme.lengthTicks).toBe(THEME_BARS * 3840);
    const id = theme.identity;
    expect(id.intervals).toHaveLength(theme.notes.length - 1);
    expect(id.rhythm.reduce((a, b) => a + b, 0)).toBe(THEME_BARS * 4);
    expect(id.leap.steps).toBeGreaterThanOrEqual(3);
    expect(id.leap.fromIndex).toBeLessThan(theme.headCount - 1);
    expect(id.dissonances.length).toBeGreaterThan(0);
    expect(theme.notes.some((n) => n.function !== 'chord-tone')).toBe(true);
    expect(theme.notes.some((n) => n.function === 'chord-tone')).toBe(true);
    expect(id.protectedFeatures.length).toBeGreaterThan(0);
    expect(id.preferredFeatures.length).toBeGreaterThan(0);
    expect(id.character.length).toBeGreaterThan(0);
    // every dissonance resolves by step
    for (const d of id.dissonances) expect(Math.abs(theme.notes[d.resolvesToIndex].step - theme.notes[d.index].step)).toBe(1);
  });

  it('is sound by the line rules, deterministic per seed, and differs between seeds', () => {
    const { frame } = frameOf('dorian-16bars');
    const a = generateTheme({ frame, homeTick: 0, seed: 11 });
    const b = generateTheme({ frame, homeTick: 0, seed: 11 });
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(judgeLine(frame, a.theme.notes, { finalStable: true }).ok).toBe(true);
    const shapes = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => { const t = generateTheme({ frame, homeTick: 0, seed }); return t.ok ? t.theme.notes.map((n) => `${n.step}${n.alter}:${n.duration}`).join(' ') : ''; }));
    expect(shapes.size).toBeGreaterThan(1);
  });

  it('reports a metre it has no rhythm vocabulary for instead of guessing', () => {
    const { frame } = frameOf('dorian-16bars');
    const result = generateTheme({ frame: { ...frame, beatsPerBar: 5, barTicks: 4800 }, homeTick: 0, seed: 1 });
    expect(result.ok).toBe(false);
  });

  it('keeps a chord tone of a borrowed chord in the local scale', () => {
    const { frame, understanding } = frameOf('dorian-16bars');
    const borrowed = understanding.harmony.chords.find((c) => c.reading.pitchClassesOutsideScale.length > 0)!;
    const local = localScale(frame, borrowed);
    for (const pc of borrowed.fact.pitchClasses) expect(local.has(pc), `${borrowed.fact.symbol} pc ${pc}`).toBe(true);
  });
});

describe('harmonic adaptation', () => {
  const { frame } = frameOf('dorian-16bars');
  const themed = generateTheme({ frame, homeTick: 0, seed: 11 });
  if (!themed.ok) throw new Error('no theme');
  const theme = themed.theme;
  const request = (targetTick: number, shifts: number[]) => ({
    frame, material: theme.notes, headCount: theme.headCount, leapIndex: theme.identity.leap.fromIndex, homeTick: 0, targetTick, shifts, before: [], after: [], finalStable: true,
  });

  it('restates the theme literally over its own harmony', () => {
    const r = adaptMaterial(request(0, [0]));
    expect(r.ok && r.strategy).toBe('literal');
    expect(r.ok && r.moved).toEqual([]);
  });

  it('keeps rhythm, head directions and the leap in every result, and names its strategy', () => {
    let adapted = 0;
    for (let barIndex = 0; barIndex < 14; barIndex++) {
      const r = adaptMaterial(request(barIndex * 3840, [0, 1, -1, 2, -2, 3, -3]));
      if (!r.ok) { expect(r.reasons.length).toBeGreaterThan(0); continue; }
      adapted++;
      expect(['literal', 'transposition', 'reinterpretation', 'stepwise-moves', 'tail-rewrite']).toContain(r.strategy);
      expect(r.notes.map((n) => n.duration)).toEqual(theme.notes.map((n) => n.duration));
      expect(r.notes.map((n) => n.tick - barIndex * 3840)).toEqual(theme.notes.map((n) => n.tick));
      for (let i = 1; i < theme.headCount; i++) expect(Math.sign(r.notes[i].step - r.notes[i - 1].step)).toBe(Math.sign(theme.notes[i].step - theme.notes[i - 1].step));
      const leap = theme.identity.leap.fromIndex;
      expect(r.notes[leap + 1].step - r.notes[leap].step).toBe(theme.notes[leap + 1].step - theme.notes[leap].step);
      expect(judgeLine(frame, r.notes, { finalStable: true }).ok).toBe(true);
      // a plain transposition moves no single note; moved notes are reported otherwise
      if (r.strategy === 'transposition' || r.strategy === 'literal' || r.strategy === 'reinterpretation') expect(r.moved).toEqual([]);
      else expect(r.moved.length).toBeGreaterThan(0);
    }
    expect(adapted).toBeGreaterThan(3);
  });

  it('rejects, with reasons, material that cannot be made sound', () => {
    // a line of one held note that belongs to neither chord and has nowhere to resolve
    const stuck = [{ tick: 0, duration: 3840, step: 1, alter: 0 }];
    const r = adaptMaterial({ frame, material: stuck, headCount: 1, leapIndex: -1, homeTick: null, targetTick: 3840, shifts: [0], before: [], after: [], finalStable: true });
    // G7 holds neither E as a sound ending... the result is either a moved note or a rejection, never a silent pass
    if (r.ok) expect(r.strategy).not.toBe('literal');
    else expect(r.reasons.length).toBeGreaterThan(0);
    const impossible = adaptMaterial({ frame, material: theme.notes, headCount: theme.headCount, leapIndex: theme.identity.leap.fromIndex, homeTick: 0, targetTick: 0, shifts: [], before: [], after: [], finalStable: true });
    expect(impossible.ok).toBe(false);
  });
});

describe('phrases', () => {
  it('are tick-based, of unequal length, end before their window, and reach a harmonic goal', () => {
    expect(comp.phrases.length).toBeGreaterThan(0);
    for (const p of comp.phrases) {
      expect(p.startTick).toBeGreaterThanOrEqual(p.window.startTick);
      expect(p.endTick).toBeLessThanOrEqual(p.window.endTick);
      expect(p.breathTicks).toBeGreaterThan(0);
      expect(p.segments[0].kind).toBe('statement');
      expect(p.climax.tick).toBeGreaterThanOrEqual(p.startTick);
      expect(p.climax.tick).toBeLessThan(p.endTick);
      expect(p.goal.evidence.length).toBeGreaterThan(0);
      expect(p.landmarks.length).toBeGreaterThanOrEqual(3);
    }
    expect(new Set(comp.phrases.map((p) => p.endTick - p.startTick)).size).toBe(comp.phrases.length);
    // lengths come from the material: neither phrase is a whole number of four bars
    for (const p of comp.phrases) expect((p.endTick - p.startTick) % (4 * 3840)).not.toBe(0);
    const last = comp.phrases[comp.phrases.length - 1];
    expect(last.goal.ending).toBe('closed');
    expect(((last.notes[last.notes.length - 1].step % 7) + 7) % 7).toBe(0);
  });

  it('are sound lines, state the theme first and develop its head', () => {
    const { frame } = frameOf('dorian-16bars');
    const theme = comp.theme!;
    for (const p of comp.phrases) {
      expect(judgeLine(frame, p.notes, { finalStable: true }).ok).toBe(true);
      const statement = p.notes.filter((n) => n.segment === 'statement');
      expect(statement.map((n) => n.duration)).toEqual(theme.notes.map((n) => n.duration));
      const kinds = p.segments.map((s) => s.kind);
      expect(kinds[kinds.length - 1]).toBe('ending');
      for (const s of p.segments.filter((x) => x.kind === 'development')) {
        const notes = p.notes.filter((n) => n.tick >= s.startTick && n.tick < s.endTick);
        expect(notes.map((n) => n.duration)).toEqual(theme.notes.slice(0, theme.headCount).map((n) => n.duration));
        const leap = theme.identity.leap.fromIndex;
        expect(notes[leap + 1].step - notes[leap].step).toBe(theme.identity.leap.steps);
      }
    }
    expect(comp.phrases.some((p) => p.segments.some((s) => s.kind === 'development'))).toBe(true);
  });

  it('respects the conductor\'s near-silent bars and leaves a window silent rather than forcing the theme', () => {
    // the dorian fixture has a near-silence bar before the chorus: no V1 note sounds in it
    const silentBars = comp.windows.length ? [comp.windows[0].endTick, comp.windows[1]?.startTick ?? comp.windows[0].endTick] : [0, 0];
    for (const w of comp.voiceNotes) expect(w.note.startTick + w.note.durationTicks <= silentBars[0] || w.note.startTick >= silentBars[1]).toBe(true);
    const { frame, understanding } = frameOf('dorian-16bars');
    const planned = planPhrases({ frame, theme: comp.theme!, structure: understanding.structure, windows: [{ startTick: 0, endTick: 3840 }] });
    expect(planned.phrases).toEqual([]);
    expect(planned.silentWindows[0].reason).toContain('shorter than the theme');
  });
});

describe('instrument selection', () => {
  it('chooses an existing unlocked string track by measured suitability, with every candidate evaluated', () => {
    const chosen = comp.selection!.chosen!;
    const track = main.project.tracks.find((t) => t.id === chosen.trackId)!;
    expect(track.family).toBe('Strings');
    expect(track.locked).toBeFalsy();
    expect(comp.selection!.evaluations.length).toBe(main.project.tracks.filter((t) => isStringTrack(t) && t.role !== 'basses').length);
    const suitable = comp.selection!.evaluations.filter((e) => e.suitable);
    expect(Math.max(...suitable.map((e) => e.score))).toBe(chosen.score);
    // in this composition the classic tune sat on Violin II: the voice replaces it there, not on Violin I
    expect(chosen.role).toBe('violins2');
    expect(chosen.competition).toBe(0);
  });

  it('does not always choose the same instrument, never the bass carrier, and never creates a track', { timeout: 300_000 }, () => {
    const roles = new Set<string>();
    for (const template of STRING_TEMPLATES) {
      for (const fixture of STRING_FIXTURES) {
        const { project, result } = composeStringCell({ template, fixture, seed: 1, take: 0 }, 'v1');
        const c = compositionOf(result);
        if (!c.written) continue;
        const track = project.tracks.find((t) => t.id === c.trackId);
        expect(track, `${template}/${fixture}`).toBeDefined();
        roles.add(track!.role);
        const evaluation = c.selection!.evaluations.find((e) => e.trackId === c.trackId)!;
        expect(evaluation.suitable).toBe(true);
        expect(evaluation.replaces).not.toMatch(/^classic layers by bar: bass ×\d+$/);
        const profile = STRING_PROFILE_BY_ROLE.get(track!.role)!;
        for (const n of c.notes) { expect(n.pitch).toBeGreaterThanOrEqual(profile.comfortable[0]); expect(n.pitch).toBeLessThanOrEqual(profile.comfortable[1]); }
        expect(result.tracks.map((t) => t.id).sort()).toEqual(composeStringCell({ template, fixture, seed: 1, take: 0 }, 'classic').result.tracks.map((t) => t.id).sort());
      }
    }
    expect(roles.size).toBeGreaterThan(1);
  });

  it('follows the line and the context, not a fixed preference', () => {
    const candidate = (trackId: string, role: string, singing: [number, number], layers: string[]): SelectionCandidate =>
      ({ trackId, role, name: role, comfortable: [48, 88], playableLow: 48, singing, character: '', triggerable: ['legato', 'sustain'], classicLayers: layers });
    const line = (base: number) => ({ notes: [0, 2, 4, 5].map((s, i) => ({ tick: i * 960, duration: 960, pitchAtOctave0: base + s })), bars: [1] });
    const high = candidate('a', 'high', [72, 88], ['pad']);
    const low = candidate('b', 'low', [50, 62], ['pad']);
    const pick = (l: ReturnType<typeof line>, carrier: string | null) => selectInstrument({ candidates: [high, low], line: l, carrierByBar: [carrier], classicNotesByTrackId: {} }).chosen!.trackId;
    expect(pick(line(74), null)).toBe('a');
    // the same line an octave lower is tried at every octave; with both able to place it, the track that already carried the tune wins
    expect(pick(line(74), 'b')).toBe('b');
    const bass = candidate('c', 'bassline', [50, 62], ['bass', 'bass']);
    const none = selectInstrument({ candidates: [bass], line: line(52), carrierByBar: [null], classicNotesByTrackId: {} });
    expect(none.chosen).toBeNull();
    expect(none.reason).toContain('foundation');
  });
});

describe('the written voice', () => {
  it('is one line: no two notes sound together on the grid, and breaths are written', () => {
    const notes = comp.voiceNotes.map((w) => w.note);
    for (let i = 1; i < notes.length; i++) expect(notes[i].startTick).toBeGreaterThanOrEqual(notes[i - 1].startTick + notes[i - 1].durationTicks);
    expect(comp.voiceNotes.filter((w) => w.shaping.some((s) => s.startsWith('bow lifts'))).length).toBeGreaterThan(0);
    expect(comp.voiceNotes.filter((w) => w.shaping.some((s) => s.startsWith('leaned'))).length).toBeGreaterThan(0);
    expect(comp.gestures.length).toBeGreaterThan(0);
  });

  it('writes only articulations the export can trigger for the chosen instrument', () => {
    const role = main.project.tracks.find((t) => t.id === comp.trackId)!.role;
    const instrument = STRING_INSTRUMENT_IDS.find((id) => STRING_INSTRUMENT_SOURCES[id].role === role)!;
    const triggerable = triggerableArticulations(buildInstrumentCapabilities(instrument));
    for (const n of comp.notes) expect(triggerable).toContain(n.articulation);
  });

  it('is louder at the high point of a phrase than at its held ending', () => {
    for (const p of comp.phrases) {
      const written = comp.voiceNotes.filter((w) => w.phrase === p.index);
      const top = written.find((w) => w.source.tick === p.climax.tick)!;
      const ending = written[written.length - 1];
      expect(ending.source.segment).toBe('ending');
      expect(top.note.velocity).toBeGreaterThan(ending.note.velocity);
    }
  });
});

describe('replacement and isolation', () => {
  const trackOf = (r: ComposeResult, id: string) => r.tracks.find((t) => t.id === id)!;

  it('is deterministic: the same request gives the same composition', () => {
    const again = composeStringCell(MAIN, 'v1');
    expect(again.result.tracks).toEqual(main.result.tracks);
    expect(JSON.stringify(compositionOf(again.result))).toBe(JSON.stringify(comp));
  });

  it('replaces the classic part on the chosen track: no classic note remains and nothing is layered', () => {
    const v1Track = trackOf(main.result, comp.trackId!);
    const classicTrack = trackOf(mainClassic.result, comp.trackId!);
    expect(v1Track.notes).toEqual(comp.notes);
    expect(v1Track.notes.length).toBe(comp.voiceNotes.length);
    expect(comp.replacedClassicNotes).toEqual(classicTrack.notes);
    const classicKeys = new Set(classicTrack.notes.map(noteKey));
    expect(v1Track.notes.filter((n) => classicKeys.has(noteKey(n)))).toEqual([]);
    expect(new Set(v1Track.notes.map(noteKey)).size).toBe(v1Track.notes.length);
    expect(v1Track.cc).toEqual(comp.cc);
    expect(v1Track.notes).not.toEqual(classicTrack.notes);
  });

  it('leaves every track but the composed voices (two violins, Viola, Cello, Double Bass) — the other strings and every other family — exactly as classic', { timeout: 600_000 }, () => {
    for (const template of STRING_TEMPLATES) {
      for (const fixture of STRING_FIXTURES) {
        for (const take of [0, 3]) {
          const cell = { template, fixture, seed: 1, take };
          const classic = composeStringCell(cell, 'classic').result;
          const v1 = composeStringCell(cell, 'v1').result;
          // Stage 3: the second voice's track (the other violin) is the one further track V1 may write
          const ensemble = v1.stringsDiagnostics.v1!.ensemble!;
          // Stage 4: and the Viola's track
          const third = v1.stringsDiagnostics.v1!.viola!;
          const ids = new Set([compositionOf(v1).trackId, ensemble.written ? ensemble.companion!.trackId : null, third.written ? third.viola!.trackId : null,
            // Stage 5: and the Cello's track
            v1.stringsDiagnostics.v1!.cello?.written ? v1.stringsDiagnostics.v1!.cello.cello!.trackId : null,
            // Stage 6: and the Double Bass desk
            v1.stringsDiagnostics.v1!.doubleBass?.written ? v1.stringsDiagnostics.v1!.doubleBass.doubleBass!.trackId : null]);
          expect(v1.tracks.filter((t) => !ids.has(t.id)), `${template}/${fixture}/${take}`).toEqual(classic.tracks.filter((t) => !ids.has(t.id)));
          expect(v1.pianoScore.events).toEqual(classic.pianoScore.events);
          expect(v1.plan).toEqual(classic.plan);
          expect(v1.orchestration).toEqual(classic.orchestration);
        }
      }
    }
  });

  it('handles missing or unsuitable material by leaving the classic strings in place', () => {
    const cases: [string, (p: Project) => void, RegExp][] = [
      ['every string track locked', (p) => { for (const t of p.tracks) if (t.family === 'Strings') t.locked = true; }, /no unlocked string track/],
      ['only the bass carrier unlocked', (p) => { for (const t of p.tracks) if (t.family === 'Strings' && t.role !== 'cellosBasses') t.locked = true; }, /foundation/],
      ['five beats in a bar', (p) => { p.timeSignature = { numerator: 5, denominator: 4 }; }, /no theme rhythm vocabulary/],
      ['a six-note scale', (p) => { p.mode = 'Whole Tone'; }, /not a seven-note scale/],
    ];
    for (const [label, change, reason] of cases) {
      const build = (): Project => { const p = projectForStringCell(MAIN); change(p); return p; };
      const classic = composeAllTracks(build(), { seed: 1, stringsComposition: 'classic' });
      const v1 = composeAllTracks(build(), { seed: 1, stringsComposition: 'v1' });
      const c = compositionOf(v1);
      expect(c.written, label).toBe(false);
      expect(c.reason, label).toMatch(reason);
      expect(v1.stringsDiagnostics.v1!.passThrough, label).toBe(true);
      expect(v1.tracks, label).toEqual(classic.tracks);
    }
  });

  it('stays classic for every caller that does not ask for V1, and the dev switch is off outside a dev page', () => {
    expect(devStringsAuditionOverride()).toEqual({});
    const omitted = composeAllTracks(projectForStringCell(MAIN), { seed: 1 });
    expect(omitted.stringsDiagnostics.mode).toBe('classic');
    expect(omitted.tracks).toEqual(mainClassic.result.tracks);
  });
});

describe('export of the composed voice', () => {
  const project: Project = { ...main.project, tracks: main.result.tracks };
  const playable = main.result.tracks.filter((t) => isInstrumentTrack(t) && t.notes.length > 0);

  it('exports the chosen track through the shipped profile with its notes, one keyswitch family and its controllers', () => {
    const voice = playable.filter((t) => t.id === comp.trackId);
    const files = buildPerTrackMidi(project, voice, PROFILE);
    expect(files.length).toBeGreaterThan(0);
    const parsed = parseMidi(Buffer.from(files[0].data));
    expect(parsed.header.ticksPerBeat).toBe(960);
    const ons = parsed.tracks.flatMap((t) => t.filter((e) => e.type === 'noteOn' && (e as { velocity: number }).velocity > 0)) as unknown as { noteNumber: number }[];
    const pitches = new Set(comp.notes.map((n) => n.pitch));
    expect(ons.filter((e) => pitches.has(e.noteNumber)).length).toBe(comp.notes.length);
    const role = voice[0].role;
    const instrument = STRING_INSTRUMENT_IDS.find((id) => STRING_INSTRUMENT_SOURCES[id].role === role)!;
    const zone = buildInstrumentCapabilities(instrument).keyswitchZone!;
    const switches = ons.filter((e) => !pitches.has(e.noteNumber));
    expect(switches.length).toBeGreaterThan(0);
    for (const s of switches) { expect(s.noteNumber).toBeGreaterThanOrEqual(zone.low); expect(s.noteNumber).toBeLessThanOrEqual(zone.high); }
    const controllers = new Set(parsed.tracks.flatMap((t) => t.filter((e) => e.type === 'controller').map((e) => (e as unknown as { controllerType: number }).controllerType)));
    expect(controllers.has(1)).toBe(true);
    expect(controllers.has(11)).toBe(true);
  });

  it('exports the whole composition as one playable file', () => {
    const merged = parseMidi(Buffer.from(buildMergedMidi(project, playable, PROFILE)));
    expect(merged.tracks.length).toBeGreaterThan(playable.length - 1);
    const plain = parseMidi(Buffer.from(buildMergedMidi(project, playable.filter((t) => t.id === comp.trackId), null)));
    const ons = plain.tracks.flatMap((t) => t.filter((e) => e.type === 'noteOn' && (e as { velocity: number }).velocity > 0));
    expect(ons.length).toBe(comp.notes.length);
  });
});
