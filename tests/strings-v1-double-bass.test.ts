/**
 * Strings V1 Stage 6 — the Double Bass as a fifth independently composed
 * voice: its character, the plan, the writing, the five-voice review,
 * expression, the export, the hand-off to the existing desk (and the old
 * Cello/Bass split that must not also land on it), and the isolation of
 * everything else — above all the four Stage 5 voices.
 * Structural checks only: nothing here says how the music sounds.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseMidi } from 'midi-file';
import { composeAllTracks, type ComposeResult } from '../src/orchestrator/compose';
import { buildMergedMidi, buildPerTrackMidi } from '../src/export/midi';
import { EXPORT_PROFILES } from '../src/export/profiles';
import { isInstrumentTrack, type CcLane, type Note, type Project, type Track } from '../src/shared/schema';
import { independentBassHandOff } from '../src/orchestrator/strings/bridge';
import { buildInstrumentCapabilities, triggerableArticulations } from '../src/orchestrator/strings/characters/capabilities';
import { DOUBLE_BASS, doubleBassMove, type DoubleBassRole } from '../src/orchestrator/strings/characters/double-bass';
import { soundingPitch } from '../src/orchestrator/strings/ensemble/counterpoint';
import { DOUBLE_BASS_CC_LEVEL, DOUBLE_BASS_GESTURE_DEPTH, DOUBLE_BASS_TRACK_ROLE, type StringsV1FifthVoice } from '../src/orchestrator/strings/ensemble/fifth';
import { parallelOf, type FifthOthers, type Heard } from '../src/orchestrator/strings/ensemble/fifth-hearing';
import { planFifthVoice } from '../src/orchestrator/strings/ensemble/fifth-plan';
import { DOUBLE_BASS_MONOTONY_BARS, reviewFifthVoice, type FifthFindingKind } from '../src/orchestrator/strings/ensemble/fifth-review';
import { composeDoubleBass, doubleBassGestures, writeDoubleBassVoice, type DoubleBassLevel, type DoubleBassNote } from '../src/orchestrator/strings/writers/double-bass';
import { STRING_FIXTURES, composeOptionsFor, composeStringCell, isStringTrack, projectForStringCell, type StringCell } from './strings-v1-support';

const PROFILE = EXPORT_PROFILES.find((entry) => entry.id === 'uvi-orchestral-suite')!.profile;
const BAR = 3840;
const BEAT = 960;
const DESK_TEMPLATES = ['symphony', 'cinematic', 'hybridstudio'] as const;
const NO_DESK_TEMPLATES = ['chamber', 'sonata', 'vocalbacking'] as const;
const ROLES: readonly DoubleBassRole[] = ['tacet', 'foundation', 'root-fifth', 'moving', 'plucked', 'arrival', 'response'];
/** The reference case as exported at the end of Stage 5 (evaluation/strings-v1-stage5/audition), the kept record. */
const STAGE5 = {
  celloAlone: '2894685d6f5ec1634df4fef1893f4227a25c416f',
  fourVoices: '2427d12798040bf7b85997c5154e53ad1da6ab59',
  full: '8515e35167b8d537905ccf94c2f1dc8d736b50da',
};
const STAGE4_THREE_VOICES = '2b55b808e0d3a31821853597de89d0a131decac7';

const sha1 = (data: Uint8Array): string => createHash('sha1').update(data).digest('hex');
const v1Of = (r: ComposeResult) => r.stringsDiagnostics.v1!;
const bassOf = (r: ComposeResult): StringsV1FifthVoice => v1Of(r).doubleBass!;
const playable = (tracks: readonly Track[]): Track[] => tracks.filter((t) => isInstrumentTrack(t) && t.notes.length > 0);
const trackOf = (r: ComposeResult, id: string) => r.tracks.find((t) => t.id === id) as unknown as Track & { notes: Note[]; cc: CcLane[] };
const deskOf = (r: ComposeResult) => r.tracks.find((t) => t.role === DOUBLE_BASS_TRACK_ROLE) as unknown as (Track & { notes: Note[]; cc: CcLane[] }) | undefined;

/** Every band with a desk, on every fixture, two takes; plus another seed. */
const CELLS: StringCell[] = [
  ...DESK_TEMPLATES.flatMap((template) => STRING_FIXTURES.flatMap((fixture) => [0, 1].map((take) => ({ template, fixture, seed: 1, take })))),
  { template: 'symphony', fixture: 'dorian-16bars', seed: 7, take: 2 },
  { template: 'cinematic', fixture: 'multi-chorus-16bars', seed: 3, take: 4 },
];
// Composed one case at a time with a pause between cases, so that the test worker can answer the runner while it works.
const composeRun = (cell: StringCell) => {
  const v1 = composeStringCell(cell, 'v1');
  return { cell, label: JSON.stringify(cell), project: v1.project, v1: v1.result, classic: composeStringCell(cell, 'classic').result };
};
const runs: ReturnType<typeof composeRun>[] = [];
for (const cell of CELLS) {
  runs.push(composeRun(cell));
  await new Promise<void>((resolve) => setImmediate(resolve));
}
const written = runs.filter((r) => bassOf(r.v1).written);
const main = runs.find((r) => r.cell.template === 'symphony' && r.cell.fixture === 'dorian-16bars' && r.cell.take === 0)!;
const bass = bassOf(main.v1);
const caps = buildInstrumentCapabilities('doubleBass');
const triggerable: readonly string[] = triggerableArticulations(caps);

/** What the review hears of the four voices above, rebuilt from the diagnostics the way the stage builds it. */
const hearingOf = (r: ComposeResult) => {
  const context = v1Of(r);
  const frame = { ...context.composition!.frame!, harmony: context.understanding.harmony };
  const heard = (line: readonly { tick: number; duration: number; step: number; alter: number; function: string }[]): Heard[] =>
    line.map((n) => ({ tick: n.tick, duration: n.duration, pitch: soundingPitch(frame, n), chordTone: n.function === 'chord-tone' }));
  const e = context.ensemble!;
  const others: FifthOthers = { first: heard(e.primaryLine), second: e.written ? heard(e.line) : [], viola: heard(context.viola!.line), cello: heard(context.cello!.line) };
  const b = context.doubleBass!;
  const endTick = b.plan!.spans[b.plan!.spans.length - 1].endTick;
  return { frame, others, endTick, plan: b.plan!, range: b.doubleBass!.range, theme: context.composition!.theme! };
};
const reviewOf = (r: ComposeResult, line: readonly DoubleBassNote[]) => {
  const h = hearingOf(r);
  return reviewFifthVoice({ frame: h.frame, plan: h.plan, others: h.others, bass: line, range: h.range, keyswitchZone: caps.keyswitchZone ?? null, endTick: h.endTick });
};
const kinds = (r: ComposeResult, line: readonly DoubleBassNote[]): FifthFindingKind[] => [...new Set(reviewOf(r, line).findings.map((f) => f.kind))];
const spanAt = (r: ComposeResult, tick: number): number => bassOf(r).plan!.spans.find((s) => tick >= s.startTick && tick < s.endTick)?.index ?? 0;
const made = (r: ComposeResult, tick: number, duration: number, pitch: number, extra: Partial<DoubleBassNote> = {}): DoubleBassNote =>
  ({ tick, duration, pitch, span: spanAt(r, tick), role: 'foundation', function: 'chord-tone', breathAfter: true, cell: null, themeIndex: null, ...extra });

describe('the character', () => {
  it('states a conservative written range above the keyswitch zone and inside what the profile allows', () => {
    expect(caps.keyswitchZone).toEqual({ low: 12, high: 22 });
    expect(caps.playableLow).toBe(23);
    expect(DOUBLE_BASS.floor).toBeGreaterThan(caps.keyswitchZone!.high);
    expect(DOUBLE_BASS.floor).toBeGreaterThanOrEqual(caps.playableLow!);
    expect([DOUBLE_BASS.floor, DOUBLE_BASS.ceiling]).toEqual([28, 48]);
    expect(DOUBLE_BASS.bestRegister[0]).toBeGreaterThanOrEqual(DOUBLE_BASS.floor);
    expect(DOUBLE_BASS.bestRegister[1]).toBeLessThanOrEqual(DOUBLE_BASS.ceiling);
    expect(bass.doubleBass!.range).toEqual([28, 48]);
    // the profile gives no upper limit: the stage says so instead of claiming one
    expect(bass.doubleBass!.uncertain.join(' ')).toMatch(/no upper limit/);
    expect(bass.doubleBass!.uncertain.join(' ')).toMatch(/written pitch or an octave lower is unverified/);
  });
  it('uses only strokes the shipped profile triggers with a keyswitch of their own, and none it only substitutes', () => {
    expect([...triggerable].sort()).toEqual(['legato', 'marcato', 'pizz', 'sustain', 'tremolo']);
    for (const stroke of Object.values(DOUBLE_BASS.articulation)) expect(triggerable, stroke).toContain(stroke);
    expect(bass.doubleBass!.notTriggerable).toEqual(['staccato', 'spiccato', 'detache', 'portato']);
    for (const r of written) for (const n of bassOf(r.v1).notes) {
      expect(triggerable, r.label).toContain(n.articulation);
      expect(['staccato', 'spiccato', 'detache', 'portato'], r.label).not.toContain(n.articulation);
    }
  });
  it('moves as a bass moves: steps freely, fourths, fifths and octaves readily, sevenths and anything past an octave not at all', () => {
    expect(doubleBassMove(2)).toBe(0);
    expect(doubleBassMove(-1)).toBe(0);
    expect(doubleBassMove(7)).toBeLessThan(doubleBassMove(4)!);
    expect(doubleBassMove(12)).not.toBeNull();
    expect(doubleBassMove(10)).toBeNull();
    expect(doubleBassMove(11)).toBeNull();
    expect(doubleBassMove(14)).toBeNull();
    for (const r of written) {
      const line = bassOf(r.v1).line;
      for (let i = 1; i < line.length; i++) {
        if (line[i - 1].breathAfter || line[i - 1].tick + line[i - 1].duration !== line[i].tick) continue;
        expect(doubleBassMove(line[i].pitch - line[i - 1].pitch), `${r.label} @${line[i].tick}`).not.toBeNull();
      }
    }
  });
});

describe('where a Double Bass is written', () => {
  it('is written on Symphony, Cinematic and Hybrid Studio, on every fixture and take tried', () => {
    for (const r of runs) {
      expect(bassOf(r.v1).written, `${r.label}: ${bassOf(r.v1).reason}`).toBe(true);
      expect(bassOf(r.v1).review.unresolved, r.label).toEqual([]);
      expect(bassOf(r.v1).notes.length, r.label).toBeGreaterThan(0);
    }
  });
  it('invents no desk for Chamber, Sonata or Vocal Backing: no track, a stated reason, the track list as classic', { timeout: 300_000 }, () => {
    for (const template of NO_DESK_TEMPLATES) for (const fixture of STRING_FIXTURES) {
      const cell: StringCell = { template, fixture, seed: 1, take: 0 };
      const v1 = composeStringCell(cell, 'v1').result;
      const classic = composeStringCell(cell, 'classic').result;
      const label = `${template}/${fixture}`;
      expect(v1.tracks.some((t) => t.role === DOUBLE_BASS_TRACK_ROLE), label).toBe(false);
      expect(v1.tracks.map((t) => [t.id, t.role, t.name]), label).toEqual(classic.tracks.map((t) => [t.id, t.role, t.name]));
      const b = v1Of(v1).doubleBass;
      expect(b?.written ?? false, label).toBe(false);
      if (b) { expect(b.reason, label).toBeTruthy(); expect(b.notes, label).toEqual([]); }
      expect(independentBassHandOff(v1Of(v1)), label).toBeNull();
    }
  });
  it('says "no desk" for Chamber, whose four voices are composed', () => {
    const v1 = composeStringCell({ template: 'chamber', fixture: 'dorian-16bars', seed: 1, take: 0 }, 'v1').result;
    expect(v1Of(v1).cello!.written).toBe(true);
    expect(bassOf(v1).reason).toMatch(/no Double Basses desk/);
  });
  it('never composes one in classic mode, where the desk is the old split\'s', () => {
    for (const r of runs.slice(0, 3)) expect(r.classic.stringsDiagnostics.v1, r.label).toBeNull();
  });
  it('keeps a locked desk exactly as it is', () => {
    const cell: StringCell = { template: 'symphony', fixture: 'dorian-16bars', seed: 1, take: 0 };
    const project = projectForStringCell(cell);
    const once = composeAllTracks(project, composeOptionsFor(cell, 'v1'));
    const locked: Project = { ...project, tracks: once.tracks.map((t) => (t.role === DOUBLE_BASS_TRACK_ROLE ? { ...t, locked: true } : t)) };
    const snapshot = JSON.stringify(locked.tracks.find((t) => t.role === DOUBLE_BASS_TRACK_ROLE));
    const again = composeAllTracks(locked, composeOptionsFor(cell, 'v1'));
    expect(bassOf(again).written).toBe(false);
    expect(bassOf(again).reason).toMatch(/locked/);
    expect(JSON.stringify(deskOf(again))).toBe(snapshot);
    expect(again.tracks.filter((t) => t.role === DOUBLE_BASS_TRACK_ROLE).length).toBe(1);
  });
});

describe('the plan', () => {
  it('gives every stretch of the piece one role, on the stretches the other voices were planned on', () => {
    for (const r of written) {
      const b = bassOf(r.v1);
      const spans = b.plan!.spans;
      const duo = v1Of(r.v1).ensemble!.plan!.spans;
      expect(spans.map((s) => [s.startTick, s.endTick]), r.label).toEqual(duo.map((s) => [s.startTick, s.endTick]));
      for (const s of spans) {
        expect(ROLES, r.label).toContain(s.role);
        expect(s.intention.length, r.label).toBeGreaterThan(0);
        expect(s.reason.length, r.label).toBeGreaterThan(0);
        expect(s.mustEndBy, r.label).toBeLessThanOrEqual(s.endTick);
      }
      expect(b.plan!.doubleBass.trackId, r.label).toBe(deskOf(r.v1)!.id);
    }
  });
  it('forces no role: the roles differ from piece to piece, silence is planned, and no role is in every piece', () => {
    const perRun = written.map((r) => new Set(bassOf(r.v1).plan!.spans.map((s) => s.role)));
    const all = new Set(perRun.flatMap((s) => [...s]));
    expect(all.size).toBeGreaterThanOrEqual(6);
    expect(new Set(perRun.map((s) => [...s].sort().join(','))).size).toBeGreaterThan(2);
    expect(written.some((r) => bassOf(r.v1).plan!.spans.some((s) => s.role === 'tacet'))).toBe(true);
    for (const role of ['plucked', 'response', 'root-fifth'] as const) expect(perRun.some((s) => !s.has(role)), role).toBe(true);
    // and no role fills a piece: none is planned for every stretch of any piece
    for (const r of written) for (const role of ROLES) expect(bassOf(r.v1).plan!.spans.every((s) => s.role === role), `${r.label} ${role}`).toBe(false);
    // the stretches are not of one length
    expect(new Set(written.flatMap((r) => bassOf(r.v1).plan!.spans.map((s) => s.endTick - s.startTick))).size).toBeGreaterThan(2);
  });
  it('follows the music, not a pattern: the same stretches planned at another energy get other roles', () => {
    const context = v1Of(main.v1);
    const input = (energy: number, strokes: readonly string[]) => ({
      barTicks: BAR, duo: context.ensemble!.plan!,
      cello: context.cello!.plan!.spans.map((s) => ({ span: s.index, role: s.role, played: !!context.cello!.writing.find((w) => w.span === s.index)?.played })),
      energyByBar: Array.from({ length: 16 }, () => energy), doubleBass: { trackId: 'trk_basses', name: 'Double Bass' },
      responseTicks: 8 * BEAT, triggerable: strokes,
    });
    const quiet = planFifthVoice(input(0.15, triggerable)).spans.map((s) => s.role);
    const loud = planFifthVoice(input(0.9, triggerable)).spans.map((s) => s.role);
    expect(quiet).not.toEqual(loud);
    expect(quiet.filter((role) => role === 'tacet').length).toBeGreaterThan(loud.filter((role) => role === 'tacet').length);
    expect(planFifthVoice(input(0.9, triggerable))).toEqual(planFifthVoice(input(0.9, triggerable)));
  });
  it('declines a plucked figure when the patch has no pizzicato of its own', () => {
    const context = v1Of(main.v1);
    for (const energy of [0.2, 0.5, 0.65, 0.9]) {
      const plan = planFifthVoice({
        barTicks: BAR, duo: context.ensemble!.plan!,
        cello: context.cello!.plan!.spans.map((s) => ({ span: s.index, role: 'plucked-bass', played: true })),
        energyByBar: Array.from({ length: 16 }, () => energy), doubleBass: { trackId: 'trk_basses', name: 'Double Bass' },
        responseTicks: 8 * BEAT, triggerable: ['sustain', 'legato'],
      });
      expect(plan.spans.map((s) => s.role), String(energy)).not.toContain('plucked');
    }
  });
});

describe('determinism', () => {
  it('composes the same Double Bass from the same input, and another from another take', () => {
    for (const cell of [CELLS[0], CELLS[8]]) {
      const a = composeStringCell(cell, 'v1').result;
      const b = composeStringCell(cell, 'v1').result;
      expect(JSON.stringify(bassOf(a))).toBe(JSON.stringify(bassOf(b)));
      expect(JSON.stringify(a.tracks)).toBe(JSON.stringify(b.tracks));
    }
    const take0 = runs.find((r) => r.cell.template === 'cinematic' && r.cell.fixture === 'dorian-16bars' && r.cell.take === 0)!;
    const take1 = runs.find((r) => r.cell.template === 'cinematic' && r.cell.fixture === 'dorian-16bars' && r.cell.take === 1)!;
    expect(JSON.stringify(bassOf(take0.v1).notes)).not.toBe(JSON.stringify(bassOf(take1.v1).notes));
  });
  it('writes the same line from the same plan, whatever was written before', () => {
    const h = hearingOf(main.v1);
    const levels = h.plan.spans.map(() => 0 as DoubleBassLevel);
    const energyByBar = Array.from({ length: 16 }, (_, i) => h.plan.spans.find((s) => i * BAR >= s.startTick && i * BAR < s.endTick)?.energy ?? 0.5);
    const a = composeDoubleBass({ frame: h.frame, theme: h.theme, plan: h.plan, others: h.others, range: h.range, levels, energyByBar, seed: 1 });
    const b = composeDoubleBass({ frame: h.frame, theme: h.theme, plan: h.plan, others: h.others, range: h.range, levels, energyByBar, seed: 1 });
    expect(a).toEqual(b);
  });
});

describe('range and the keyswitch zone', () => {
  it('writes every note inside the stated range, above the keyswitch zone, in every case', () => {
    for (const r of written) {
      const b = bassOf(r.v1);
      for (const n of b.notes) {
        expect(n.pitch, r.label).toBeGreaterThanOrEqual(28);
        expect(n.pitch, r.label).toBeLessThanOrEqual(48);
        expect(n.pitch, r.label).toBeGreaterThan(caps.keyswitchZone!.high);
      }
      expect(b.review.facts!.lowest, r.label).toBeGreaterThanOrEqual(28);
      expect(b.review.facts!.highest, r.label).toBeLessThanOrEqual(48);
      const desk = deskOf(r.v1)!;
      expect(Math.min(...desk.notes.map((n) => n.pitch)), r.label).toBeGreaterThanOrEqual(desk.lowestNote ?? 0);
    }
  });
  it('finds a note in the keyswitch zone, and a note outside the range', () => {
    expect(kinds(main.v1, [made(main.v1, 0, 4 * BEAT, 14)])).toContain('keyswitch-zone');
    expect(kinds(main.v1, [made(main.v1, 0, 4 * BEAT, 26)])).toContain('out-of-range');
    expect(kinds(main.v1, [made(main.v1, 0, 4 * BEAT, 50)])).toContain('out-of-range');
  });
});

describe('harmony', () => {
  it('stands on the harmony\'s own bass where it meets a new chord, and is the lowest voice whenever it sounds', () => {
    let attacked = 0;
    let onBass = 0;
    for (const r of written) {
      const f = bassOf(r.v1).review.facts!;
      expect(f.lowestVoiceShare, r.label).toBe(1);
      expect(f.pairs.cello.belowShare, r.label).toBe(0);
      attacked += f.chordStartsAttacked;
      onBass += f.chordStartsOnBass;
      expect(f.chordStartsOnBass, r.label).toBeGreaterThanOrEqual(f.chordStartsAttacked - 1);
    }
    expect(attacked).toBeGreaterThan(100);
    expect(onBass / attacked).toBeGreaterThan(0.97);
  });
  it('treats every note foreign to the chord: a passing note is short, on a weak beat, reached and left by step', () => {
    let passing = 0;
    for (const r of written) {
      const line = bassOf(r.v1).line;
      line.forEach((n, i) => {
        if (n.function !== 'passing') return;
        passing++;
        const where = `${r.label} @${n.tick}`;
        expect(n.duration, where).toBeLessThanOrEqual(BEAT);
        expect(n.tick % BAR, where).not.toBe(0);
        const before = line[i - 1];
        const after = line[i + 1];
        expect(before.tick + before.duration, where).toBe(n.tick);
        expect(after.tick, where).toBe(n.tick + n.duration);
        expect(Math.abs(n.pitch - before.pitch), where).toBeLessThanOrEqual(2);
        expect(Math.abs(after.pitch - n.pitch), where).toBeLessThanOrEqual(2);
        expect(n.pitch, where).not.toBe(before.pitch);
      });
    }
    expect(passing).toBeGreaterThan(10);
  });
  it('finds a held note that is foreign to the chord, and a bass that is not the chord\'s', () => {
    const first = bass.line[0];
    const foreign = kinds(main.v1, [{ ...first, pitch: first.pitch + 1, function: 'chord-tone' }]);
    expect(foreign.some((k) => k === 'against-harmony' || k === 'untreated-dissonance' || k === 'clash')).toBe(true);
    // D minor seventh in bar 1: its fifth under everything at the head of the chord is not its bass
    const onBass = bass.line.find((n) => n.function === 'chord-bass' && n.tick % BAR === 0)!;
    const moved = kinds(main.v1, [{ ...onBass, pitch: onBass.pitch + 7 > 48 ? onBass.pitch - 5 : onBass.pitch + 7, function: 'chord-tone' }]);
    expect(moved.some((k) => k === 'not-the-bass' || k === 'above-voice' || k === 'against-harmony')).toBe(true);
  });
  it('passes the review it was written under: reading the finished line again finds nothing', () => {
    for (const r of written) expect(reviewOf(r.v1, bassOf(r.v1).line).findings, r.label).toEqual([]);
  });
});

describe('independence from the four voices above', () => {
  it('is not the old split: the composed notes are not the classic desk\'s', () => {
    for (const r of written) {
      const b = bassOf(r.v1);
      const classicDesk = deskOf(r.classic)!;
      expect(b.replacedClassicNotes, r.label).toEqual(classicDesk.notes);
      expect(JSON.stringify(b.notes), r.label).not.toBe(JSON.stringify(classicDesk.notes));
      const classicKeys = new Set(classicDesk.notes.map((n) => `${n.startTick}:${n.pitch}`));
      const same = b.notes.filter((n) => classicKeys.has(`${n.startTick}:${n.pitch}`)).length;
      expect(same / b.notes.length, r.label).toBeLessThan(0.5);
    }
  });
  it('is not the Cello an octave lower: neither its pitches nor its rhythm follow the Cello', () => {
    for (const r of written) {
      const h = hearingOf(r.v1);
      const line = bassOf(r.v1).line;
      const celloAt = new Map(h.others.cello.map((n) => [n.tick, n.pitch]));
      const octaveCopies = line.filter((n) => celloAt.get(n.tick) === n.pitch + 12).length;
      expect(octaveCopies / line.length, r.label).toBeLessThan(0.5);
      const bassOnsets = new Set(line.map((n) => n.tick));
      const celloOnsets = new Set(h.others.cello.map((n) => n.tick));
      const shared = [...bassOnsets].filter((t) => celloOnsets.has(t)).length;
      // shadowing = each follows the other: most of the bass's attacks are the Cello's AND most of the Cello's are the bass's
      expect(shared / bassOnsets.size > 0.6 && shared / celloOnsets.size > 0.6, r.label).toBe(false);
      expect(bassOf(r.v1).review.facts!.pairs.cello.unisonShare, r.label).toBeLessThan(0.5);
      expect(bassOf(r.v1).review.facts!.celloOctaveShare, r.label).toBeLessThan(0.5);
    }
  });
  it('shares neither line nor rhythm with the violins or the Viola', () => {
    for (const r of written) {
      const h = hearingOf(r.v1);
      const line = bassOf(r.v1).line;
      const f = bassOf(r.v1).review.facts!;
      for (const voice of ['first', 'second', 'viola'] as const) {
        if (!h.others[voice].length) continue;
        expect(f.pairs[voice].unisonShare, `${r.label} ${voice}`).toBe(0);
        expect(f.pairs[voice].belowShare, `${r.label} ${voice}`).toBe(0);
        const onsets = new Set(h.others[voice].map((n) => n.tick));
        const shared = line.filter((n) => onsets.has(n.tick)).length;
        expect(shared / line.length > 0.6 && shared / onsets.size > 0.6, `${r.label} ${voice}`).toBe(false);
        // contour: it does not move in the same direction as that voice note for note
        const pitchAt = new Map(h.others[voice].map((n) => [n.tick, n.pitch]));
        const together = line.filter((n) => pitchAt.has(n.tick));
        const samePc = together.filter((n) => (pitchAt.get(n.tick)! - n.pitch) % 12 === 0).length;
        expect(samePc / Math.max(1, line.length), `${r.label} ${voice}`).toBeLessThan(0.6);
      }
    }
  });
  it('runs in no parallel fifths or octaves with the leading voice, and in none at all on a note it chose freely', () => {
    for (const r of written) {
      const h = hearingOf(r.v1);
      const line = bassOf(r.v1).line;
      for (let i = 1; i < line.length; i++) {
        const before = line[i - 1];
        const n = line[i];
        if (before.tick + before.duration !== n.tick) continue;
        const parallel = parallelOf(h.others, before.tick, before.pitch, n.tick, n.pitch);
        if (!parallel) continue;
        const where = `${r.label} @${n.tick} ${parallel.interval} with ${parallel.against}`;
        if (parallel.interval === 'octaves' && parallel.against === 'cello') continue; // the two bass instruments in octaves: counted, see the facts
        expect(parallel.against, where).not.toBe('first');
        expect(n.function, where).toBe('chord-bass');
      }
      // what was kept on the harmony's own bass is written down, case by case
      for (const text of bassOf(r.v1).review.facts!.parallelsOnTheHarmonysBass) expect(text, r.label).toMatch(/parallel (fifths|octaves) with (the second voice|the Viola|the Cello)/);
    }
  });
  it('has rhythms of its own that change over a piece, and rests', () => {
    for (const r of written) {
      const f = bassOf(r.v1).review.facts!;
      expect(f.rhythms.length, r.label).toBeGreaterThanOrEqual(2);
      expect(f.rolesWritten.length, r.label).toBeGreaterThanOrEqual(2);
      expect(f.silentBeats, r.label).toBeGreaterThan(0);
      expect(f.longestUnbrokenBeats, r.label).toBeLessThanOrEqual(DOUBLE_BASS.maxUnbrokenBeats);
      // congestion: what the five voices attack inside one beat is reported; the Double Bass itself adds at most two
      expect(f.mostAttacksInABeat, r.label).toBeGreaterThan(0);
      const own = new Map<number, number>();
      for (const n of bassOf(r.v1).line) own.set(Math.floor(n.tick / BEAT), (own.get(Math.floor(n.tick / BEAT)) ?? 0) + 1);
      expect(Math.max(...own.values()), r.label).toBeLessThanOrEqual(2);
    }
  });
});

describe('the review', () => {
  it('finds the Cello copied an octave lower (shadowing), and the Cello copied at pitch', () => {
    const h = hearingOf(main.v1);
    const low = (p: number): number => { let q = p - 12; while (q > 48) q -= 12; while (q < 28) q += 12; return q; };
    const copy = h.others.cello.map((n) => made(main.v1, n.tick, n.duration, low(n.pitch), { role: 'moving', breathAfter: false }));
    expect(kinds(main.v1, copy)).toContain('cello-shadow');
    const lowCello = h.others.cello.filter((n) => n.pitch <= 48 && n.duration >= BEAT);
    expect(lowCello.length).toBeGreaterThan(4);
    const atPitch = lowCello.map((n) => made(main.v1, n.tick, n.duration, n.pitch, { role: 'moving', breathAfter: false }));
    const found = kinds(main.v1, atPitch);
    expect(found.some((k) => k === 'cello-unison' || k === 'cello-shadow')).toBe(true);
  });
  it('finds a Double Bass above the Cello', () => {
    const h = hearingOf(main.v1);
    const target = h.others.cello.find((n) => n.pitch <= 45 && n.duration >= 2 * BEAT)!;
    expect(kinds(main.v1, [made(main.v1, target.tick, target.duration, Math.min(48, target.pitch + 3))])).toContain('above-voice');
  });
  it('finds a bowed note too short to speak, an unbroken bow, a bar repeated without end, and a leap no bass makes', () => {
    const real = bass.line[0];
    expect(kinds(main.v1, [{ ...real, duration: BEAT / 4, role: 'moving' }])).toContain('too-short');
    // a plucked note may be that short
    expect(kinds(main.v1, [{ ...real, duration: BEAT / 4, role: 'plucked' }])).not.toContain('too-short');
    const chain = Array.from({ length: 10 }, (_, i) => made(main.v1, i * BAR, BAR, 38, { breathAfter: false }));
    const chainKinds = kinds(main.v1, chain);
    expect(chainKinds).toContain('no-breath');
    const repeated = Array.from({ length: DOUBLE_BASS_MONOTONY_BARS + 1 }, (_, i) => [made(main.v1, i * BAR, 2 * BEAT, 38, { role: 'root-fifth' }), made(main.v1, i * BAR + 2 * BEAT, 2 * BEAT, 33, { role: 'root-fifth' })]).flat();
    // monotony is heard inside one stretch: read the same bars as one long stretch
    const h = hearingOf(main.v1);
    const oneStretch = { ...h.plan, spans: [{ ...h.plan.spans[0], endTick: h.endTick, mustEndBy: h.endTick }] };
    const asOne = reviewFifthVoice({ frame: h.frame, plan: oneStretch, others: h.others, bass: repeated.map((n) => ({ ...n, span: 0 })), range: h.range, keyswitchZone: caps.keyswitchZone ?? null, endTick: h.endTick });
    expect(asOne.findings.map((f) => f.kind)).toContain('monotony');
    const varied = repeated.map((n, i) => ({ ...n, span: 0, pitch: i === 4 ? 36 : n.pitch }));
    expect(reviewFifthVoice({ frame: h.frame, plan: oneStretch, others: h.others, bass: varied, range: h.range, keyswitchZone: caps.keyswitchZone ?? null, endTick: h.endTick }).findings.map((f) => f.kind)).not.toContain('monotony');
    const leap = [made(main.v1, 0, 2 * BEAT, 30, { breathAfter: false }), made(main.v1, 2 * BEAT, 2 * BEAT, 47)];
    expect(kinds(main.v1, leap)).toContain('bass-leap');
  });
  it('finds parallel fifths with a voice above', () => {
    // a line a fifth under the first voice, note for note
    const h = hearingOf(main.v1);
    const run = h.others.first.filter((n, i, all) => i > 0 && all[i - 1].tick + all[i - 1].duration === n.tick).slice(0, 12);
    const under = (p: number): number => { let q = p - 7; while (q > 48) q -= 12; return q; };
    const all = h.others.first.slice(0, 14).map((n) => made(main.v1, n.tick, n.duration, under(n.pitch), { role: 'moving', breathAfter: false }));
    expect(run.length).toBeGreaterThan(3);
    expect(kinds(main.v1, all).some((k) => k === 'parallel-fifths' || k === 'parallel-octaves')).toBe(true);
  });
  it('answers a finding by writing that stretch plainer, then silent — never by touching another voice — and stops', () => {
    const corrected = written.filter((r) => bassOf(r.v1).review.passes.some((p) => p.action));
    expect(corrected.length).toBeGreaterThan(0);
    for (const r of written) {
      const b = bassOf(r.v1);
      const spans = b.plan!.spans.length;
      expect(b.review.passes.length, r.label).toBeLessThanOrEqual(2 * spans + 1);
      expect(b.review.passes[b.review.passes.length - 1].action, r.label).toBeNull();
      expect(b.review.passes[b.review.passes.length - 1].findings, r.label).toEqual([]);
      const perSpan = new Map<string, number>();
      for (const p of b.review.passes) {
        if (!p.action) continue;
        expect(p.findings.length, r.label).toBeGreaterThan(0);
        const stretch = /^stretch (\d+)/.exec(p.action)![1];
        perSpan.set(stretch, (perSpan.get(stretch) ?? 0) + 1);
      }
      // bounded and monotonic: a stretch goes down at most twice, and never up again
      for (const [stretch, times] of perSpan) expect(times, `${r.label} stretch ${stretch}`).toBeLessThanOrEqual(2);
      for (const w of b.writing) {
        const lowered = perSpan.get(String(w.span + 1)) ?? 0;
        if (lowered === 0) expect(w.level, `${r.label} stretch ${w.span + 1}`).toBe('preferred');
        else expect(w.level, `${r.label} stretch ${w.span + 1}`).not.toBe('preferred');
        if (w.level === 'silent') expect(w.notes, r.label).toEqual([]);
      }
    }
  });
  it('can silence the Double Bass altogether: every stretch at its last level is empty, and plainer is never busier', () => {
    const h = hearingOf(main.v1);
    const energyByBar = Array.from({ length: 16 }, (_, i) => h.plan.spans.find((s) => i * BAR >= s.startTick && i * BAR < s.endTick)?.energy ?? 0.5);
    const at = (level: DoubleBassLevel) => composeDoubleBass({ frame: h.frame, theme: h.theme, plan: h.plan, others: h.others, range: h.range, levels: h.plan.spans.map(() => level), energyByBar, seed: 1 });
    expect(at(2).notes).toEqual([]);
    expect(at(2).spans.every((s) => !s.played)).toBe(true);
    expect(at(1).notes.length).toBeLessThanOrEqual(at(0).notes.length);
    for (const s of at(1).spans) expect(['moving', 'response', 'plucked'], `stretch ${s.span + 1}`).not.toContain(s.played ? s.wrote : 'tacet');
  });
  it('leaves the four voices above exactly as their own stages returned them', () => {
    for (const r of runs) {
      const c = v1Of(r.v1).composition!;
      const e = v1Of(r.v1).ensemble!;
      const v = v1Of(r.v1).viola!;
      const k = v1Of(r.v1).cello!;
      expect(trackOf(r.v1, c.trackId!).notes, r.label).toEqual(c.notes);
      if (e.written) expect(trackOf(r.v1, e.companion!.trackId).notes, r.label).toEqual(e.notes);
      expect(trackOf(r.v1, v.viola!.trackId).notes, r.label).toEqual(v.notes);
      expect(trackOf(r.v1, v.viola!.trackId).cc, r.label).toEqual(v.cc);
      expect(trackOf(r.v1, k.cello!.trackId).notes, r.label).toEqual(k.notes);
      expect(trackOf(r.v1, k.cello!.trackId).cc, r.label).toEqual(k.cc);
    }
  });
});

describe('thematic participation', () => {
  const entries = written.flatMap((r) => bassOf(r.v1).thematic.map((t) => ({ r, t })));
  it('answers with the theme\'s head somewhere, and not everywhere', () => {
    expect(entries.length).toBeGreaterThan(0);
    expect(written.some((r) => bassOf(r.v1).thematic.length === 0)).toBe(true);
  });
  it('keeps the melodic identity of what it quotes, not the rhythm alone: the head\'s own steps, in notes twice as long', () => {
    for (const { r, t } of entries) {
      expect(t.kind, r.label).toBe('head-in-augmentation');
      expect(t.notesOfHead, r.label).toBeGreaterThanOrEqual(3);
      expect(t.notesOfHead, r.label).toBeLessThanOrEqual(t.headLength);
      // every written interval is the theme's interval; the first may be folded by an octave to stay in the bass
      expect(t.writtenSteps.length, r.label).toBe(t.notesOfHead - 1);
      t.writtenSteps.forEach((step, i) => expect(((step - t.themeSteps[i]) % 7 + 7) % 7, `${r.label} step ${i}`).toBe(0));
      expect(t.writtenSteps.slice(1), r.label).toEqual(t.themeSteps.slice(1, t.writtenSteps.length));
      t.writtenBeats.forEach((beats, i) => expect(beats, `${r.label} beat ${i}`).toBe(t.factor * t.themeBeats[i]));
      for (const p of t.pitches) { expect(p, r.label).toBeGreaterThanOrEqual(28); expect(p, r.label).toBeLessThanOrEqual(48); }
      const notes = bassOf(r.v1).line.filter((n) => n.role === 'response' && n.themeIndex !== null);
      expect(notes.length, r.label).toBeGreaterThanOrEqual(t.notesOfHead);
      expect(bassOf(r.v1).review.facts!.thematicNotes, r.label).toBeGreaterThanOrEqual(t.notesOfHead);
    }
  });
  it('says why, where a planned answer was not written', () => {
    for (const r of written) for (const w of bassOf(r.v1).writing) {
      if (w.role !== 'response' || w.wrote === 'response') continue;
      expect(w.decision.length, r.label).toBeGreaterThan(10);
      if (w.level === 'preferred') expect(Object.keys(w.rejections).length, r.label).toBeGreaterThan(0);
    }
  });
});

describe('expression', () => {
  it('has CC1 and CC11 curves of its own: not the Cello\'s, not the classic desk\'s, not a flat line', () => {
    for (const r of written) {
      const b = bassOf(r.v1);
      const lane = (lanes: readonly CcLane[], cc: number) => lanes.find((l) => l.cc === cc);
      const celloCc = v1Of(r.v1).cello!.cc;
      const classicCc = deskOf(r.classic)!.cc;
      expect(b.expression!.ownLanes, r.label).toEqual([1, 11]);
      for (const cc of [1, 11]) {
        const own = lane(b.cc, cc)!;
        expect(own, `${r.label} CC${cc}`).toBeDefined();
        expect(JSON.stringify(own.points), `${r.label} CC${cc}`).not.toBe(JSON.stringify(lane(celloCc, cc)?.points));
        expect(JSON.stringify(own.points), `${r.label} CC${cc}`).not.toBe(JSON.stringify(lane(classicCc, cc)?.points));
        expect(new Set(own.points.map((p) => p.value)).size, `${r.label} CC${cc}`).toBeGreaterThan(4);
        for (let i = 0; i < own.points.length; i++) {
          expect(own.points[i].value, r.label).toBeGreaterThanOrEqual(1);
          expect(own.points[i].value, r.label).toBeLessThanOrEqual(127);
          expect(Number.isInteger(own.points[i].value), r.label).toBe(true);
          if (i > 0) expect(own.points[i].tick, r.label).toBeGreaterThan(own.points[i - 1].tick);
        }
      }
      expect(JSON.stringify(lane(b.cc, 1)!.points), r.label).not.toBe(JSON.stringify(lane(b.cc, 11)!.points));
      expect(b.expression!.sharedLanes.some((cc) => cc === 1 || cc === 11), r.label).toBe(false);
      expect(deskOf(r.v1)!.cc, r.label).toEqual(b.cc);
    }
    expect(DOUBLE_BASS_CC_LEVEL[0]).toBeLessThan(DOUBLE_BASS_CC_LEVEL[1]);
  });
  it('shapes each bowed gesture by its role: a line grows to its goal, a long tone swells late, an arrival is struck and let go', () => {
    const shapes = new Set<string>();
    for (const r of written) {
      const b = bassOf(r.v1);
      const ids = doubleBassGestures(b.line);
      expect(b.expression!.gestures.length, r.label).toBe(new Set(ids.filter((g) => g >= 0)).size);
      b.line.forEach((n, i) => expect(ids[i] === -1, `${r.label} @${n.tick}`).toBe(n.role === 'plucked'));
      for (const g of b.expression!.gestures) {
        shapes.add(g.shape);
        expect(g.depth, r.label).toBe(DOUBLE_BASS_GESTURE_DEPTH[g.role as Exclude<DoubleBassRole, 'tacet'>]);
        expect(g.goalTick, r.label).toBeGreaterThanOrEqual(g.startTick);
        expect(g.goalTick, r.label).toBeLessThanOrEqual(g.endTick);
        if (g.shape.startsWith('struck')) expect(g.goalTick, r.label).toBe(g.startTick);
        if (g.shape.startsWith('one slow swell')) expect(g.goalTick, r.label).toBeGreaterThan(g.startTick + (g.endTick - g.startTick) / 2 - 1);
      }
      // the curve is really there: within a gesture of two beats or more CC1 is not constant
      const cc1 = b.cc.find((l) => l.cc === 1)!;
      for (const g of b.expression!.gestures.filter((x) => x.endTick - x.startTick >= 4 * BEAT)) {
        const inside = cc1.points.filter((p) => p.tick >= g.startTick && p.tick <= g.endTick).map((p) => p.value);
        expect(Math.max(...inside) - Math.min(...inside), `${r.label} gesture @${g.startTick}`).toBeGreaterThanOrEqual(3);
      }
    }
    expect(shapes.size).toBeGreaterThanOrEqual(3);
  });
  it('gives velocities, lengths and strokes by role: bowed notes long enough to speak, plucked notes short, loudness following the piece', () => {
    for (const r of written) {
      const b = bassOf(r.v1);
      expect(b.voiceNotes.length, r.label).toBe(b.line.length);
      expect(b.notes.length, r.label).toBe(b.line.length);
      for (const w of b.voiceNotes) {
        const where = `${r.label} @${w.source.tick}`;
        expect(w.note.startTick, where).toBe(w.source.tick);
        expect(w.note.pitch, where).toBe(w.source.pitch);
        expect(w.note.velocity, where).toBeGreaterThanOrEqual(30);
        expect(w.note.velocity, where).toBeLessThanOrEqual(112);
        if (w.source.role === 'plucked') {
          expect(w.note.articulation, where).toBe('pizz');
          expect(w.note.durationTicks, where).toBeLessThanOrEqual(BEAT);
        } else {
          expect(['sustain', 'legato', 'marcato', 'tremolo'], where).toContain(w.note.articulation);
          expect(w.source.duration, where).toBeGreaterThanOrEqual(DOUBLE_BASS.minBowedBeats * BEAT);
          expect(w.note.durationTicks, where).toBeGreaterThanOrEqual(BEAT / 2);
        }
        expect(w.shaping.length, where).toBeGreaterThan(0);
      }
      expect(new Set(b.notes.map((n) => n.velocity)).size, r.label).toBeGreaterThan(3);
      for (const n of b.notes) { expect(n.velocity, r.label).toBeGreaterThanOrEqual(1); expect(n.velocity, r.label).toBeLessThanOrEqual(127); expect(n.layer, r.label).toBeUndefined(); }
    }
  });
  it('writes no stroke the patch cannot trigger: without marcato, tremolo or pizzicato the same notes come out sustained or legato', () => {
    const h = hearingOf(main.v1);
    const energyByBar = Array.from({ length: 16 }, () => 0.95);
    const plain = writeDoubleBassVoice({ frame: h.frame, notes: bass.line.filter((n) => n.role !== 'plucked'), energyByBar, triggerable: ['sustain', 'legato'] });
    for (const w of plain) expect(['sustain', 'legato']).toContain(w.note.articulation);
    const full = writeDoubleBassVoice({ frame: h.frame, notes: bass.line.filter((n) => n.role !== 'plucked'), energyByBar, triggerable });
    expect(full.some((w) => w.note.articulation === 'marcato' || w.note.articulation === 'tremolo')).toBe(true);
  });
});

describe('the export', () => {
  const events = (data: Uint8Array) => parseMidi(data).tracks.flat() as unknown as { type: string; channel?: number; noteNumber?: number; velocity?: number; controllerType?: number; text?: string }[];
  const KEYSWITCH: Record<string, number> = { sustain: 12, legato: 14, pizz: 17, tremolo: 19, marcato: 21 };
  it('states the keyswitches this stage relies on as the shipped profile has them', () => {
    for (const [stroke, key] of Object.entries(KEYSWITCH)) {
      const a = caps.articulations.find((x) => x.articulation === stroke)!;
      expect(a.keyMidi, stroke).toBe(key);
      expect(['own-keyswitch', 'sustain-default'], stroke).toContain(a.trigger);
    }
    expect(caps.patch).toBe('Bass Ensemble');
    expect(caps.controllersWritten).toEqual([1, 7, 11]);
  });
  it('goes out on the desk\'s own channel and part, as the classic desk does, with the profile\'s keyswitches and controllers only', () => {
    for (const r of written) {
      const desk = deskOf(r.v1)!;
      const project: Project = { ...r.project, tracks: r.v1.tracks };
      const classicProject: Project = { ...r.project, tracks: r.classic.tracks };
      const file = buildPerTrackMidi(project, [desk], PROFILE);
      const classicFile = buildPerTrackMidi(classicProject, [deskOf(r.classic)!], PROFILE);
      expect(file.length, r.label).toBe(1);
      const ev = events(file[0].data);
      const classicEv = events(classicFile[0].data);
      const channels = (list: typeof ev) => [...new Set(list.filter((e) => e.channel !== undefined).map((e) => e.channel))];
      expect(channels(ev).length, r.label).toBe(1);
      expect(channels(ev), r.label).toEqual(channels(classicEv));
      expect(ev.filter((e) => e.type === 'trackName').map((e) => e.text), r.label).toEqual(classicEv.filter((e) => e.type === 'trackName').map((e) => e.text));
      expect(ev.find((e) => e.type === 'trackName')!.text, r.label).toBe('Bass Ensemble');
      const on = ev.filter((e) => e.type === 'noteOn' && (e.velocity ?? 0) > 0);
      const sounding = on.filter((e) => e.noteNumber! > caps.keyswitchZone!.high);
      const switches = on.filter((e) => e.noteNumber! <= caps.keyswitchZone!.high);
      expect(sounding.length, r.label).toBe(desk.notes.length);
      expect(sounding.map((e) => e.noteNumber).sort(), r.label).toEqual(desk.notes.map((n) => n.pitch).sort());
      for (const e of sounding) { expect(e.noteNumber, r.label).toBeGreaterThanOrEqual(28); expect(e.noteNumber, r.label).toBeLessThanOrEqual(48); }
      const used = new Set(desk.notes.map((n) => KEYSWITCH[n.articulation!]));
      expect(new Set(switches.map((e) => e.noteNumber)), r.label).toEqual(used);
      for (const e of switches) { expect(e.noteNumber, r.label).toBeGreaterThanOrEqual(12); expect(e.noteNumber, r.label).toBeLessThanOrEqual(22); }
      const controllers = new Set(ev.filter((e) => e.type === 'controller').map((e) => e.controllerType));
      for (const cc of controllers) expect([1, 7, 11], `${r.label} CC${cc}`).toContain(cc);
      expect(controllers.has(1) && controllers.has(11), r.label).toBe(true);
    }
  });
  it('appears once in the full export: one Double Bass part, one Cello part, the same parts on the same channels as classic', () => {
    for (const r of written) {
      const parts = (tracks: readonly Track[]) => parseMidi(buildMergedMidi({ ...r.project, tracks: [...tracks] }, playable(tracks), PROFILE)).tracks.map((t) => {
        const list = t as unknown as { type: string; channel?: number; text?: string }[];
        return `${list.find((e) => e.type === 'trackName')?.text}@${[...new Set(list.filter((e) => e.channel !== undefined).map((e) => e.channel))].join('/')}`;
      });
      const mine = parts(r.v1.tracks);
      expect(mine.filter((p) => p.startsWith('Bass Ensemble')).length, r.label).toBe(1);
      expect(mine.filter((p) => p.startsWith('Cello Ensemble')).length, r.label).toBe(1);
      expect(mine, r.label).toEqual(parts(r.classic.tracks));
    }
  });
});

describe('the hand-off to the existing desk, and the old split', () => {
  it('supplies its notes to the desk the classic pipeline created: same track, same place in the list, nothing added', () => {
    for (const r of written) {
      const desk = deskOf(r.v1)!;
      const classicDesk = deskOf(r.classic)!;
      expect(r.v1.tracks.map((t) => [t.id, t.role, t.name]), r.label).toEqual(r.classic.tracks.map((t) => [t.id, t.role, t.name]));
      expect(r.v1.tracks.filter((t) => t.role === DOUBLE_BASS_TRACK_ROLE).length, r.label).toBe(1);
      const { notes: _n, cc: _c, ...kept } = desk as unknown as Record<string, unknown>;
      const { notes: _cn, cc: _cc, ...keptClassic } = classicDesk as unknown as Record<string, unknown>;
      expect(kept, r.label).toEqual(keptClassic);
      expect(desk.notes, r.label).toEqual(bassOf(r.v1).notes);
      expect(independentBassHandOff(v1Of(r.v1)), r.label).toEqual({ notes: bassOf(r.v1).notes });
      expect(bassOf(r.v1).doubleBass!.trackId, r.label).toBe(desk.id);
    }
  });
  it('never lets the old Cello/Bass split land on V1 output as well: the desk holds the composed notes and nothing else, the Cello none of the desk\'s', () => {
    for (const r of written) {
      const b = bassOf(r.v1);
      const desk = deskOf(r.v1)!;
      const k = v1Of(r.v1).cello!;
      // one note at a time on the desk: nothing of the split's is layered under or over the composed line
      const sorted = [...desk.notes].sort((x, y) => x.startTick - y.startTick);
      expect(new Set(sorted.map((n) => n.startTick)).size, r.label).toBe(sorted.length);
      expect(desk.notes.length, r.label).toBe(b.line.length);
      const composed = new Set(b.line.map((n) => `${n.tick}:${n.pitch}`));
      for (const n of desk.notes) expect(composed.has(`${n.startTick}:${n.pitch}`), `${r.label} @${n.startTick}`).toBe(true);
      // no note is marked for the export to route to another part
      expect(desk.notes.filter((n) => n.layer !== undefined), r.label).toEqual([]);
      expect(trackOf(r.v1, k.cello!.trackId).notes.filter((n) => n.layer !== undefined), r.label).toEqual([]);
      // the Cello track is the composed Cello, not the split's cello half
      expect(trackOf(r.v1, k.cello!.trackId).notes, r.label).toEqual(k.notes);
      // the Cello was written against the classic desk, before this stage ran, and still says so
      expect(k.doubleBass.notes, r.label).toBe(b.replacedClassicNotes.length);
      expect(r.v1.reports.filter((line) => /Double Bass as fifth voice/.test(line)).length, r.label).toBe(1);
    }
  });
  it('keeps the desk classic, note for note, wherever the Double Bass was not written', () => {
    const cell: StringCell = { template: 'symphony', fixture: 'dorian-16bars', seed: 1, take: 0 };
    const project = projectForStringCell(cell);
    const cello = project.tracks.find((t) => t.role === 'cellos' || t.role === 'cellosBasses')!;
    cello.locked = true;
    const v1 = composeAllTracks(project, composeOptionsFor(cell, 'v1'));
    const classicProject = projectForStringCell(cell);
    classicProject.tracks.find((t) => t.id === cello.id)!.locked = true;
    const classic = composeAllTracks(classicProject, composeOptionsFor(cell, 'classic'));
    expect(bassOf(v1).written).toBe(false);
    expect(bassOf(v1).reason).toMatch(/Cello was not composed/);
    expect(v1.tracks.filter((t) => t.role === DOUBLE_BASS_TRACK_ROLE)).toEqual(classic.tracks.filter((t) => t.role === DOUBLE_BASS_TRACK_ROLE));
  });
});

describe('isolation', () => {
  it('changes the desk and nothing else relative to Stage 5: every other family, the Piano and the plan equal classic', { timeout: 900_000 }, () => {
    for (const r of runs) {
      const context = v1Of(r.v1);
      const ids = [context.composition!.trackId, context.ensemble!.written ? context.ensemble!.companion!.trackId : null, context.viola!.viola!.trackId, context.cello!.cello!.trackId, deskOf(r.v1)!.id];
      expect(r.v1.tracks.filter((t) => !ids.includes(t.id)), r.label).toEqual(r.classic.tracks.filter((t) => !ids.includes(t.id)));
      expect(r.v1.tracks.filter((t) => !isStringTrack(t)), r.label).toEqual(r.classic.tracks.filter((t) => !isStringTrack(t)));
      expect(r.v1.pianoScore.events, r.label).toEqual(r.classic.pianoScore.events);
      expect(r.v1.plan, r.label).toEqual(r.classic.plan);
      expect(r.v1.stringsDiagnostics.consumed, r.label).toEqual(r.classic.stringsDiagnostics.consumed);
    }
  });
  it('reproduces the kept Stage 4 and Stage 5 reference files byte for byte (chamber, D Dorian, 16 bars, seed 1, take 0)', () => {
    const cell: StringCell = { template: 'chamber', fixture: 'dorian-16bars', seed: 1, take: 0 };
    const v1 = composeStringCell(cell, 'v1');
    const context = v1Of(v1.result);
    const project: Project = { ...v1.project, tracks: v1.result.tracks };
    const celloId = context.cello!.cello!.trackId;
    const upper = [context.composition!.trackId!, context.ensemble!.companion!.trackId, context.viola!.viola!.trackId];
    const violinOne = upper.slice(0, 2).find((id) => v1.result.tracks.find((t) => t.id === id)?.role === 'violins1')!;
    const violinTwo = upper.slice(0, 2).find((id) => id !== violinOne)!;
    const only = (ids: readonly string[]) => playable(v1.result.tracks).filter((t) => ids.includes(t.id));
    expect(sha1(buildPerTrackMidi(project, only([celloId]), PROFILE)[0].data)).toBe(STAGE5.celloAlone);
    expect(sha1(buildMergedMidi(project, only([violinOne, violinTwo, upper[2]]), PROFILE))).toBe(STAGE4_THREE_VOICES);
    expect(sha1(buildMergedMidi(project, only([violinOne, violinTwo, upper[2], celloId]), PROFILE))).toBe(STAGE5.fourVoices);
    expect(sha1(buildMergedMidi(project, playable(v1.result.tracks), PROFILE))).toBe(STAGE5.full);
  });
});
