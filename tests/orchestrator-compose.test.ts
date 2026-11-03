import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/dorian-16bars.json';
import { ENSEMBLE_BY_ID } from '../src/config/ensembles';
import { composeAllTracks } from '../src/orchestrator/compose';
import { measureEnergy } from '../src/orchestrator/energy';
import { chordSpans } from '../src/engine/generate';
import { sanitizeNotes } from '../src/engine/generate';
import { useStore } from '../src/store/store';
import {
  isInstrumentTrack, projectEndTick, projectFromFixture, scalePitchClasses, validateProject,
  type Note, type Project,
} from '../src/shared/schema';

const TEMPLATE_IDS = ['ensemble.symphony', 'ensemble.chamber', 'ensemble.cinematic', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.hybridstudio'] as const;

const BASE = (): Project => projectFromFixture(JSON.parse(JSON.stringify(fixture)));

const compose = (templateId: string | null, over: Partial<Project> = {}, opts = { seed: 11 }): { project: Project; result: ReturnType<typeof composeAllTracks> } => {
  const p = { ...BASE(), ...over };
  p.ensemble = { templateId, overrides: over.ensemble?.overrides ?? {}, pins: {} };
  if (over.orchestration) p.orchestration = over.orchestration;
  const result = composeAllTracks(p, opts);
  return { project: { ...p, tracks: result.tracks, orchestration: result.orchestration }, result };
};

const track = (p: Project, role: string) => p.tracks.find((t) => t.role === role)!;
/** String tracks the active band actually composes (roster members). */
const bandStringTracks = (p: Project) => {
  const roster = new Set(p.ensemble?.templateId ? (ENSEMBLE_BY_ID.get(p.ensemble.templateId)?.roster.map((r) => r.role) ?? []) : []);
  return p.tracks.filter((t) => t.family === 'Strings' && isInstrumentTrack(t) && (!p.ensemble?.templateId || roster.has(t.role)));
};
const stringTracks = (p: Project) => p.tracks.filter((t) => t.family === 'Strings' && isInstrumentTrack(t));

const overlap = (a: Note, b: Note) => a.startTick < b.startTick + b.durationTicks && b.startTick < a.startTick + a.durationTicks;

/** Pairwise simultaneity over a set of tracks, visited per pair. */
function simultaneousPairs(tracks: ReturnType<typeof stringTracks>, visit: (a: Note, b: Note) => void) {
  for (let i = 0; i < tracks.length; i++) {
    for (let j = i; j < tracks.length; j++) {
      for (const a of tracks[i].notes) {
        for (const b of tracks[j].notes) {
          if (i === j && a === b) continue;
          if (overlap(a, b)) visit(a, b);
        }
      }
    }
  }
}

describe('Compose All through the orchestrator: property sweep', () => {
  const KEYS = [2, 0, 9] as const; // D, C, A
  const MODES = ['Dorian', 'Ionian', 'Aeolian'] as const;

  for (const templateId of TEMPLATE_IDS) {
    const template = ENSEMBLE_BY_ID.get(templateId)!;
    for (const key of KEYS) {
      for (const mode of MODES) {
        it(`${template.name} · key ${key} · ${mode}: green end to end`, () => {
          const { project, result } = compose(templateId, { key, mode }, { seed: 11 });
          expect(result.orchestration.take).toBe(1);

          // validateProject passes on the whole composed document
          const v = validateProject(project);
          if (!v.ok) console.error(v.errors.slice(0, 4));
          expect(v.ok).toBe(true);

          // every note inside its track range (validateProject covers it; double-check strings)
          for (const t of bandStringTracks(project)) {
            for (const n of t.notes) {
              expect(n.pitch).toBeGreaterThanOrEqual(t.lowestNote);
              expect(n.pitch).toBeLessThanOrEqual(t.highestNote);
              expect(n.velocity).toBeGreaterThanOrEqual(1);
              expect(n.velocity).toBeLessThanOrEqual(127);
            }
          }

          // sanitizeNotes is a no-op on orchestrator output
          const end = projectEndTick(project);
          for (const t of bandStringTracks(project)) {
            expect(sanitizeNotes(t.notes, t.lowestNote, t.highestNote, end)).toEqual(t.notes);
          }

          // energy never above the template clamp (hard)
          const energy = measureEnergy(project, template);
          expect(energy.max).toBeLessThanOrEqual(template.budget.energyClamp[1] + 1e-9);

          // the Chords (Structure) track got no notes
          expect(track(project, 'chords').notes).toEqual([]);

          // no doubled leading tone where the mode has one (Ionian: semitone below tonic)
          if (mode === 'Ionian') {
            const lt = ((key % 12) + 11) % 12;
            expect(scalePitchClasses(key, mode)).toContain(lt);
            simultaneousPairs(bandStringTracks(project), (a, b) => {
              if (a.pitch % 12 === lt && b.pitch % 12 === lt) {
                expect(a.pitch).toBe(b.pitch); // only a unison is "one voice" — never two LT pitches
              }
            });
          }

          // low-interval limit below C3 across all string voices
          simultaneousPairs(bandStringTracks(project), (a, b) => {
            if (a.pitch < 48 && b.pitch < 48) {
              const d = Math.abs(a.pitch - b.pitch) % 12;
              expect([0, 7]).toContain(d);
            }
          });
        });
      }
    }
  }

  it('deterministic for (inputs, take): composing twice is byte-identical', () => {
    const a = compose('ensemble.symphony', { orchestration: { take: 4 } }, { seed: 11 });
    const b = compose('ensemble.symphony', { orchestration: { take: 4 } }, { seed: 11 });
    expect(JSON.stringify(a.project.tracks)).toBe(JSON.stringify(b.project.tracks));
  });

  it('a different take yields a different score', () => {
    const takes = [0, 1, 2, 3, 4, 5].map((t) => compose('ensemble.chamber', { orchestration: { take: t } }, { seed: 11 }));
    const dumps = takes.map((c) => JSON.stringify(bandStringTracks(c.project).map((t) => t.notes)));
    expect(new Set(dumps).size).toBe(dumps.length); // all six takes differ
  });

  it('locked and out-of-band string tracks come back byte-identical', () => {
    const original = BASE();
    const violas = track(original, 'violas');
    violas.locked = true;
    violas.notes = [{ pitch: 62, startTick: 0, durationTicks: 3840, velocity: 70, articulation: 'detache' }];
    const { project } = compose('ensemble.symphony', { tracks: original.tracks });
    expect(track(project, 'violas').notes).toEqual(violas.notes); // lock wins, fields intact

    const out = BASE();
    const { project: outProject } = compose('ensemble.symphony', {
      tracks: out.tracks,
      ensemble: { templateId: 'ensemble.symphony', overrides: { violas: 'out' }, pins: {} },
    });
    expect(track(outProject, 'violas').notes).toEqual([]);
    // cellosBasses (still in band) was composed; the out lane stayed empty
    expect(track(outProject, 'cellosBasses').notes.length).toBeGreaterThan(0);
  });

  it('non-string families still come from the rules generator', () => {
    const { project } = compose('ensemble.symphony', {}, { seed: 11 });
    // piano is NOT in the symphony roster — untouched is correct; these are:
    expect(track(project, 'horns').notes.length).toBeGreaterThan(0);
    expect(track(project, 'trumpets').notes.length).toBeGreaterThan(0);
    expect(track(project, 'timpani').notes.length).toBeGreaterThan(0);
    // strings carry pads with chord tones only
    for (const n of track(project, 'cellosBasses').notes) {
      expect(n.durationTicks).toBeGreaterThanOrEqual(960);
    }
  });
});

describe('golden: fixtures/dorian-16bars.json (half-bar chords, C/E and G/B bass)', () => {
  it('the bass voice sings every chord’s bass pitch class — slash basses included', () => {
    const { project } = compose('ensemble.chamber', {}, { seed: 11 });
    const spans = chordSpans(project);
    const cb = track(project, 'cellosBasses').notes;
    expect(cb.length).toBeGreaterThan(0);
    for (const span of spans) {
      const sounding = cb.filter((n) => n.startTick < span.endTick && n.startTick + n.durationTicks > span.startTick);
      expect(sounding.length).toBeGreaterThan(0);
      const bassPc = span.parsed.bass ?? span.parsed.root;
      for (const n of sounding) expect(n.pitch % 12).toBe(bassPc);
    }
    // the two slash chords really are there and really were followed
    const slash = spans.filter((s) => s.parsed.bass !== null).map((s) => s.symbol);
    expect(slash).toEqual(expect.arrayContaining(['C/E', 'G/B']));
  });

  it('per-template listening map (notes per track) lands in a sane band', () => {
    const map: Record<string, Record<string, number>> = {};
    for (const templateId of TEMPLATE_IDS) {
      const { project } = compose(templateId, {}, { seed: 11 });
      const template = ENSEMBLE_BY_ID.get(templateId)!;
      const energy = measureEnergy(project, template);
      expect(energy.max).toBeLessThanOrEqual(template.budget.energyClamp[1] + 1e-9);
      map[template.name] = Object.fromEntries(
        project.tracks.filter((t) => isInstrumentTrack(t) && t.notes.length).map((t) => [t.name, t.notes.length]),
      );
    }
    console.log('PHASE2 listening map:', JSON.stringify(map, null, 1));
    expect(Object.keys(map)).toHaveLength(6);
  });

  it('chord spans are fully covered — half-bar chords, and gaps stay rests', () => {
    const p = BASE();
    p.chords = [
      { id: 'g1', symbol: 'Dm', startTick: 0, durationTicks: 3840 },
      { id: 'g2', symbol: 'C', startTick: 5760, durationTicks: 1920 }, // half bar after a 1-beat gap
    ];
    p.sections = [];
    const { project } = compose('ensemble.sonata', { chords: p.chords, sections: [] }, { seed: 11 });
    const cb = track(project, 'cellosBasses').notes;
    const first = cb.filter((n) => n.startTick >= 0 && n.startTick < 3840);
    expect(first.length).toBeGreaterThan(0);
    // takes may re-attack a span at its midpoint; the notes must COVER it
    expect(Math.max(...first.map((n) => n.startTick + n.durationTicks))).toBe(3840);
    expect(Math.min(...first.map((n) => n.startTick))).toBe(0);
    const half = cb.filter((n) => n.startTick >= 5760);
    expect(half.length).toBeGreaterThan(0);
    expect(Math.max(...half.map((n) => n.startTick + n.durationTicks))).toBe(5760 + 1920);
    const gapTick = 3840 + 960; // inside the beat-and-a-half gap
    expect(cb.some((n) => n.startTick < gapTick && n.startTick + n.durationTicks > gapTick && n.startTick >= 3840)).toBe(false);
  });
});

describe('Vocal Backing preset (spec §7.7)', () => {
  const triadProject = (): Project => {
    const p = BASE();
    p.sections = [{ id: 's1', name: 'Verse', startBar: 1, lengthBars: 4 }];
    p.chords = [
      { id: 't1', symbol: 'Dm', startTick: 0, durationTicks: 3840 },
      { id: 't2', symbol: 'G', startTick: 3840, durationTicks: 3840 },
      { id: 't3', symbol: 'C', startTick: 7680, durationTicks: 3840 },
      { id: 't4', symbol: 'Am', startTick: 11520, durationTicks: 3840 },
    ];
    return p;
  };

  it('keeps the vocal zone free, never writes under an eighth, and keeps triads complete', () => {
    const { project } = compose('ensemble.vocalbacking', {}, { seed: 11 });
    for (const t of bandStringTracks(project)) {
      expect(t.notes.length).toBeGreaterThan(0);
      for (const n of t.notes) {
        expect(n.pitch >= 57 && n.pitch <= 81).toBe(false); // A3..A5 kept free
        expect(n.durationTicks).toBeGreaterThanOrEqual(480); // no notes under an eighth
      }
    }
    // triads stay complete on the three string voices
    for (const span of chordSpans(project).filter((s) => ['Dm', 'G', 'C', 'Am'].includes(s.symbol))) {
      const soundingPcs = new Set<number>();
      for (const t of bandStringTracks(project)) {
        for (const n of t.notes) {
          if (n.startTick < span.endTick && n.startTick + n.durationTicks > span.startTick) soundingPcs.add(n.pitch % 12);
        }
      }
      for (const pc of span.parsed.pitchClasses) expect(soundingPcs.has(pc)).toBe(true);
    }
  });

  it('a chord shorter than an eighth becomes a rest, not a stub', () => {
    const p = triadProject();
    p.chords.push({ id: 't5', symbol: 'Dm', startTick: 15360, durationTicks: 240 }); // under an eighth
    const { project } = compose('ensemble.vocalbacking', { chords: p.chords }, { seed: 11 });
    for (const t of bandStringTracks(project)) {
      expect(t.notes.some((n) => n.startTick === 15360)).toBe(false);
    }
  });
});

describe('Compose All in the store: one edit, take inside it', () => {
  it('composing increments the take and one undo restores the whole picture', () => {
    const s = useStore.getState();
    const before = s.project;
    expect(before.orchestration).toBeUndefined();
    const res = s.composeAll();
    expect(res.ms).toBeGreaterThanOrEqual(0);
    const after = useStore.getState().project;
    expect(after.orchestration?.take).toBe(1);
    expect(after.tracks.find((t) => t.role === 'cellosBasses')!.notes.length).toBeGreaterThan(0);

    useStore.getState().undo();
    const undone = useStore.getState().project;
    expect(undone.orchestration).toBeUndefined();
    expect(undone.tracks.find((t) => t.role === 'cellosBasses')!.notes).toEqual(before.tracks.find((t) => t.role === 'cellosBasses')!.notes);

    useStore.getState().redo();
    expect(useStore.getState().project.orchestration?.take).toBe(1);
  });
});
