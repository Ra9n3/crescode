import { beforeAll, describe, expect, it } from 'vitest';
import { parseMidi } from 'midi-file';
import dorian from '../fixtures/dorian-16bars.json';
import long from '../fixtures/three-chorus-40bars.json';
import multi from '../fixtures/multi-chorus-16bars.json';
import { projectFromFixture, type Project, type Note } from '../src/shared/schema';
import { composeAllTracks, type ComposeResult } from '../src/orchestrator/compose';
import { transformProjectMode } from '../src/engine/suggestion/transpose';
import { chordSpans } from '../src/engine/generate';
import { chordTones } from '../src/orchestrator/voicing/chordTones';
import { barTicks, beatTicks, projectEndTick } from '../src/shared/schema/meter';
import { ticksToMs } from '../src/orchestrator/spine';
import { WIND_PARTS, WIND_PROFILES } from '../src/orchestrator/winds/profile';
import { buildMergedMidi, buildPerTrackMidi } from '../src/export/midi';
import { EXPORT_PROFILES } from '../src/export/profiles';
import type { FoldStats } from '../src/export/profile';
import { reconcileWindExport } from '../src/orchestrator/winds/production';

const make = (template = 'symphony', fixture = dorian, mode: Project['mode'] = 'Dorian') => {
  let p = projectFromFixture(structuredClone(fixture) as Partial<Project>);
  if (mode !== p.mode) p = transformProjectMode(p, mode).project;
  p.ensemble = { templateId: `ensemble.${template}`, overrides: {}, pins: {} };
  p.orchestration = { take: 0 }; return p;
};
const run = (p: Project, seed = 1) => composeAllTracks(p, { seed, windsComposition: 'v1', stringsComposition: 'v1' });
const stats = (): FoldStats => ({ folded: {}, droppedHardRange: {}, droppedDoubling: {}, winds: [] });
const score = (r: ComposeResult) => r.windDiagnostics.plan!.ensemble!;
const structure = (r: ComposeResult) => score(r).phrases.map((ph) => [ph.part, ph.bar, ph.duty, ph.notes.map((n) => [n.pitch, n.startTick, n.durationTicks])]);
let projects: Project[], results: ComposeResult[];
beforeAll(() => {
  projects = [make(), make('hybridstudio', long), make('cinematic', multi), make('symphony', dorian, 'Aeolian')];
  results = projects.map((p, i) => run(p, i === 2 ? 3 : 1));
}, 90000);

describe('Woodwinds Stage 2 first musical slice — production path', () => {
  it('plans one shared conversation with linked transformed answers and bounded two-player density', () => {
    for (const r of results) {
      const sc = score(r);
      expect(sc.version).toBe('dialogue-slice-1');
      expect(sc.decisions).toHaveLength(r.windDiagnostics.plan!.bars.length);
      const answers = sc.phrases.filter((ph) => ph.duty === 'answer');
      expect(answers.length).toBeGreaterThan(0);
      for (const answer of answers) {
        const original = sc.phrases.find((p) => p.id === answer.relatedTo)!;
        expect(original).toBeDefined(); expect(answer.part).not.toBe(original.part);
        expect(answer.bar).toBe(original.bar + 1); expect(answer.idea).toBe(original.idea);
        expect(answer.transformation).toBe('inverted-answer');
      }
      for (const d of sc.decisions) {
        expect(d.reason.length).toBeGreaterThan(15);
        const phrases = sc.phrases.filter((ph) => ph.bar === d.bar);
        expect(phrases.length).toBeLessThanOrEqual(2);
        expect(phrases.filter((p) => p.duty !== 'support').length).toBeLessThanOrEqual(1);
        for (const part of d.resting) expect(phrases.some((p) => p.part === part)).toBe(false);
      }
      expect(sc.decisions[0].reason).toMatch(/opening|reserved/);
    }
    const dialogue = score(results[1]);
    expect(dialogue.phrases.some((ph) => ph.duty === 'continuation' && ph.relatedTo)).toBe(true);
    expect(dialogue.phrases.some((ph) => ph.duty === 'arrival')).toBe(true);
  });

  it('all four players have instrument-specific pacing, and bassoon actually answers independently of cello', () => {
    const rhythmSignatures = WIND_PARTS.map((part) => {
      const phrases = results.flatMap((r) => score(r).phrases.filter((p) => p.part === part && p.duty !== 'support' && p.duty !== 'arrival'));
      expect(phrases.length, part).toBeGreaterThan(0);
      return [...new Set(phrases.map((ph) => JSON.stringify(ph.notes.map((n) => [n.startTick - ph.notes[0].startTick, n.durationTicks]))))].sort();
    });
    expect(new Set(rhythmSignatures.map((s) => JSON.stringify(s))).size).toBe(4);
    const r = results[2], bassoon = r.tracks.find((t) => t.role === 'bassoons')!, cello = r.tracks.find((t) => t.role === 'cellosBasses')!;
    const answer = score(r).phrases.find((p) => p.part === 'bassoons' && p.duty === 'answer')!;
    expect(answer).toBeDefined(); expect(new Set(answer.notes.map((n) => n.pitch)).size).toBeGreaterThan(1);
    for (const n of answer.notes) {
      expect(bassoon.notes.some((m) => m.pitch === n.pitch && m.startTick === n.startTick)).toBe(true);
      expect(cello.notes.some((m) => m.startTick === n.startTick && m.durationTicks === n.durationTicks && (m.pitch - n.pitch) % 12 === 0)).toBe(false);
    }
    expect(bassoon.notes.some((n) => n.articulation === 'staccato')).toBe(true);
  });

  it('support fills a real internal rest in the foreground without continuous four-part doubling', () => {
    let fills = 0;
    for (const r of results) for (const ph of score(r).phrases.filter((p) => p.duty === 'support')) {
      const foreground = score(r).phrases.find((p) => p.id === ph.relatedTo)!;
      for (const n of ph.notes) {
        const midpoint = n.startTick + n.durationTicks / 2;
        if (!foreground.notes.some((m) => m.startTick <= midpoint && m.startTick + m.durationTicks > midpoint)) fills++;
      }
    }
    expect(fills).toBeGreaterThan(0);
  });

  it('designed phrases survive validation intact, with grid, monophony, breath, range and bounded register trajectories', () => {
    for (const [i, r] of results.entries()) {
      const p = projects[i], bt = barTicks(p.timeSignature), beat = beatTicks(p.timeSignature);
      const lasts = new Map<string, number>();
      for (const ph of score(r).phrases) {
        const t = r.tracks.find((t) => t.role === ph.part)!, prof = WIND_PROFILES[ph.part];
        expect(ph.notes.length).toBeGreaterThan(0);
        for (const n of ph.notes) {
          expect(n.startTick % (beat / 2)).toBe(0);
          expect(n.pitch).toBeGreaterThanOrEqual(t.lowestNote); expect(n.pitch).toBeLessThanOrEqual(t.highestNote);
          expect(n.durationTicks).toBeGreaterThan(0);
          expect(t.notes.some((m) => m.pitch === n.pitch && m.startTick === n.startTick && m.durationTicks === n.durationTicks), ph.id).toBe(true);
          expect(n.startTick + n.durationTicks).toBeLessThanOrEqual(ph.bar * bt - beat);
          const prev = lasts.get(ph.part); if (prev !== undefined) expect(Math.abs(n.pitch - prev), ph.id).toBeLessThanOrEqual(7);
          lasts.set(ph.part, n.pitch);
        }
        const start = ph.notes[0].startTick, end = ph.notes.at(-1)!.startTick + ph.notes.at(-1)!.durationTicks;
        expect((ticksToMs(end, p.tempoMap) - ticksToMs(start, p.tempoMap)) / 1000).toBeLessThanOrEqual(prof.phraseCapSec);
      }
      for (const part of WIND_PARTS) {
        const notes = r.tracks.find((t) => t.role === part)!.notes;
        for (let j = 1; j < notes.length; j++) expect(notes[j - 1].startTick + notes[j - 1].durationTicks).toBeLessThanOrEqual(notes[j].startTick);
      }
    }
  });

  it('reserved source gestures also leave planned air; complete wind runs obey time caps, not just new phrases', () => {
    for (const [i, r] of results.entries()) {
      const p = projects[i], beat = beatTicks(p.timeSignature);
      for (const part of WIND_PARTS) {
        const ns = r.tracks.find((t) => t.role === part)!.notes;
        let runStart = 0, previousEnd = -Infinity;
        for (const n of ns) {
          if (n.startTick - previousEnd >= beat) runStart = n.startTick;
          const end = n.startTick + n.durationTicks;
          expect(ticksToMs(end, p.tempoMap) - ticksToMs(runStart, p.tempoMap), `${i}:${part}`).toBeLessThanOrEqual(WIND_PROFILES[part].phraseCapSec * 1000);
          const window = score(r).windows.find((w) => w.part === part && w.startTick <= n.startTick && n.startTick < w.startTick + barTicks(p.timeSignature))!;
          expect(window).toBeDefined(); expect(end).toBeLessThanOrEqual(window.endTick);
          previousEnd = end;
        }
      }
    }
  });

  it('resolves phrase attacks and endings against real normalized chords, including existing Aeolian/borrowed harmony', () => {
    for (const [i, r] of results.entries()) {
      const spans = chordSpans(projects[i]);
      for (const ph of score(r).phrases) {
        for (const n of [ph.notes[0], ph.notes.at(-1)!]) {
          const sp = spans.find((s) => s.startTick <= n.startTick && n.startTick < s.endTick)!;
          expect(chordTones(sp.parsed).tones.map((t) => t.pc)).toContain(n.pitch % 12);
        }
      }
    }
    expect(projects[3].mode).toBe('Aeolian');
    expect(projects[3].chords.map((c) => c.symbol)).toEqual(transformProjectMode(make(), 'Aeolian').project.chords.map((c) => c.symbol));
  });

  it('seed and produced take change actual assignments/rhythms/contours; complete identity repeats exactly', () => {
    expect(structure(run(projects[0]))).toEqual(structure(results[0]));
    const seed = run(projects[0], 7), next = run({ ...projects[1], orchestration: { take: 1 } });
    expect(structure(seed)).not.toEqual(structure(results[0])); expect(structure(next)).not.toEqual(structure(results[1]));
    expect(next.windDiagnostics.identity!.producedTake).toBe(2); expect(next.windDiagnostics.identity!.version).toBe('winds-v1-stage2');
    expect(score(seed).phrases.map((p) => [p.part, p.bar])).not.toEqual(score(results[0]).phrases.map((p) => [p.part, p.bar]));
  }, 30000);

  it('preserves exact non-wind tracks/CC and early reservations in all four audition contexts', () => {
    for (const [i, r] of results.entries()) {
      const classic = composeAllTracks(projects[i], { seed: i === 2 ? 3 : 1, stringsComposition: 'v1' });
      expect(r.tracks.filter((t) => t.family !== 'Woodwinds')).toEqual(classic.tracks.filter((t) => t.family !== 'Woodwinds'));
      expect(r.plan).toEqual(classic.plan);
      expect(r.windDiagnostics.context!.reservations.leads).toEqual(classic.plan.winds.leads);
    }
  }, 30000);

  it('parsed sounding pitches/onsets/durations match retained material in plain and UVI, not only note counts', () => {
    const r = results[0], p = { ...projects[0], tracks: r.tracks, orchestration: r.orchestration };
    for (const profile of [null, EXPORT_PROFILES[0].profile]) {
      const audit = stats(), merged = buildMergedMidi(p, r.tracks, profile, audit), parsed = parseMidi(merged);
      for (const row of audit.winds!) {
        const t = r.tracks.find((t) => t.id === row.trackId)!, part = profile?.parts.find((p) => p.source.role === t.role);
        const tr = parsed.tracks.find((tr) => tr.some((e) => e.type === 'trackName' && e.text === (part?.patch ?? t.name)))!;
        let tick = 0; const active = new Map<number, number>(), notes: Pick<Note, 'pitch' | 'startTick' | 'durationTicks'>[] = [];
        for (const e of tr) {
          tick += e.deltaTime;
          if ((e.type === 'noteOn' || e.type === 'noteOff') && e.noteNumber >= (part?.playableLow ?? 0)) {
            if (e.type === 'noteOn' && e.velocity > 0) active.set(e.noteNumber, tick);
            else if (active.has(e.noteNumber)) { const startTick = active.get(e.noteNumber)!; notes.push({ pitch: e.noteNumber, startTick, durationTicks: tick - startTick }); active.delete(e.noteNumber); }
          }
        }
        const sorted = (ns: typeof notes) => [...ns].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
        expect(sorted(notes)).toEqual(sorted([...row.soundingEvents]));
        expect(sorted(notes)).toEqual(sorted(t.notes.map(({ pitch, startTick, durationTicks }) => ({ pitch, startTick, durationTicks }))));
      }
      const per = stats(); buildPerTrackMidi(p, r.tracks, profile, per);
      for (const row of reconcileWindExport(r.windDiagnostics, [...audit.winds!, ...per.winds!])) {
        expect(row.state).toBe('observed');
        for (const job of row.jobs) for (const scope of job.scopes) expect(['exported', 'not-retained']).toContain(scope.state);
      }
    }
  });

  it.each([{ numerator: 3, denominator: 4 }, { numerator: 6, denominator: 8 }])('designs within meter and a slow/changing tempo map: $numerator/$denominator', (ts) => {
    const p = make(); p.timeSignature = ts;
    p.tempoMap = [{ tick: 0, bpm: 44 }, { tick: 6 * barTicks(ts), bpm: 72 }];
    const r = run(p), beat = beatTicks(ts), bt = barTicks(ts);
    expect(score(r).phrases.length).toBeGreaterThan(0);
    for (const ph of score(r).phrases) {
      const end = ph.notes.at(-1)!.startTick + ph.notes.at(-1)!.durationTicks;
      expect(end).toBeLessThanOrEqual(ph.bar * bt - beat);
      expect(ticksToMs(end, p.tempoMap) - ticksToMs(ph.notes[0].startTick, p.tempoMap)).toBeLessThanOrEqual(WIND_PROFILES[ph.part].phraseCapSec * 1000);
    }
    for (const t of r.tracks.filter((t) => t.family === 'Woodwinds')) for (const n of t.notes) expect(n.startTick + n.durationTicks).toBeLessThanOrEqual(projectEndTick(p));
  });
});
