import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/dorian-16bars.json';
import { exportProjectJson, importProjectJson } from '../src/export/json';
import { humanizeNotes, sanitizeNotes, buildContext } from '../src/engine/generate';
import { defaultRules } from '../src/config/generation-rules';
import {
  MAX_CC_POINTS_PER_LANE,
  isInstrumentTrack,
  projectEndTick,
  projectFromFixture,
  validateProject,
  type Note,
  type Project,
  type Track,
} from '../src/shared/schema';

const base = (): Project => projectFromFixture(JSON.parse(JSON.stringify(fixture)));
const byRole = (p: Project, role: string): Track => p.tracks.find((t) => t.role === role)!;

const expectOk = (p: unknown) => {
  const r = validateProject(p);
  if (!r.ok) console.error(r.errors);
  expect(r.ok).toBe(true);
};
const expectErr = (p: unknown, pathPart: string) => {
  const r = validateProject(p);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.errors.some((e) => e.path.includes(pathPart))).toBe(true);
};

describe('orchestration schema: additive optional fields', () => {
  it('loads the unmodified fixture unchanged and validates it', () => {
    const p = base();
    expect(p.tracks.every((t) => t.cc === undefined)).toBe(true);
    expect(p.orchestration).toBeUndefined();
    expect(p.tracks.every((t) => t.notes.every((n) => n.articulation === undefined && n.bow === undefined)) || p.tracks.every((t) => t.notes.length === 0)).toBe(true);
    expectOk(p);
  });

  it('accepts notes with articulation and bow', () => {
    const p = base();
    const v1 = byRole(p, 'violins1');
    v1.notes = [
      { pitch: 74, startTick: 0, durationTicks: 960, velocity: 70, articulation: 'legato', bow: 'down' },
      { pitch: 77, startTick: 960, durationTicks: 480, velocity: 70, articulation: 'pizz' },
      { pitch: 79, startTick: 1440, durationTicks: 2400, velocity: 70, bow: 'up' },
    ];
    expectOk(p);
  });

  it('rejects unknown articulations and bow values with a readable path', () => {
    const p = base();
    const v1 = byRole(p, 'violins1');
    v1.notes = [{ pitch: 74, startTick: 0, durationTicks: 960, velocity: 70, articulation: 'flautando' as never }];
    expectErr(p, 'articulation');
    const q = base();
    byRole(q, 'violins2').notes = [{ pitch: 74, startTick: 0, durationTicks: 960, velocity: 70, bow: 'sideways' as never }];
    expectErr(q, '.bow');
  });

  it('accepts valid CC lanes and validates order, range and the point cap', () => {
    const p = base();
    const end = projectEndTick(p);
    const v1 = byRole(p, 'violins1');
    v1.cc = [
      { cc: 1, points: [{ tick: 0, value: 0 }, { tick: 1920, value: 90 }, { tick: end, value: 0 }] },
      { cc: 11, points: [{ tick: 0, value: 100 }] },
    ];
    expectOk(p);

    // unsorted points
    const a = base();
    byRole(a, 'violas').cc = [{ cc: 1, points: [{ tick: 960, value: 10 }, { tick: 0, value: 20 }] }];
    expectErr(a, 'points[1]');

    // tick past the project end / negative
    const b = base();
    byRole(b, 'violas').cc = [{ cc: 1, points: [{ tick: end + 1, value: 10 }] }];
    expectErr(b, 'points[0].tick');
    const b2 = base();
    byRole(b2, 'violas').cc = [{ cc: 1, points: [{ tick: -5, value: 10 }] }];
    expectErr(b2, 'points[0].tick');

    // value out of range
    const c = base();
    byRole(c, 'violas').cc = [{ cc: 7, points: [{ tick: 0, value: 200 }] }];
    expectErr(c, 'points[0].value');

    // duplicate controller lane
    const d = base();
    byRole(d, 'violas').cc = [{ cc: 1, points: [{ tick: 0, value: 10 }] }, { cc: 1, points: [{ tick: 480, value: 20 }] }];
    expectErr(d, 'cc[1].cc');

    // point cap
    const e = base();
    const many = Array.from({ length: MAX_CC_POINTS_PER_LANE + 1 }, (_, i) => ({ tick: i * 2, value: i % 128 }));
    byRole(e, 'violas').cc = [{ cc: 74, points: many }];
    expectErr(e, 'points');

    // cc number out of range
    const f = base();
    byRole(f, 'violas').cc = [{ cc: 128, points: [{ tick: 0, value: 10 }] }];
    expectErr(f, 'cc[0].cc');
  });

  it('validates the orchestration state', () => {
    const p = base();
    p.orchestration = { take: 3, sectionTakes: { sec_verse: 1 }, sectionLocks: ['sec_chorus'] };
    expectOk(p);

    const bad = base();
    bad.orchestration = { take: -1 };
    expectErr(bad, 'orchestration.take');

    const bad2 = base();
    bad2.orchestration = { take: 0, sectionTakes: { sec_verse: 1.5 } };
    expectErr(bad2, 'orchestration.sectionTakes');

    const bad3 = base();
    bad3.orchestration = { take: 0, sectionLocks: ['a', 'a'] };
    expectErr(bad3, 'orchestration.sectionLocks');
  });
});

describe('sanitizeNotes carries the optional fields', () => {
  const v1 = (): [number, number, number] => {
    const p = base();
    const t = byRole(p, 'violins1'); // G3..C7
    return [t.lowestNote, t.highestNote, projectEndTick(p)];
  };

  it('keeps articulation through an octave shift into range', () => {
    const [lo, hi, end] = v1();
    const n: Note = { pitch: 43, startTick: 0, durationTicks: 960, velocity: 64, articulation: 'marcato' }; // G2, below G3
    const out = sanitizeNotes([n], lo, hi, end);
    expect(out[0].pitch).toBe(55); // shifted up to G3
    expect(out[0].articulation).toBe('marcato');
  });

  it('keeps bow through a clamp and an end trim', () => {
    const [lo, hi, end] = v1();
    const n: Note = { pitch: 120, startTick: end - 100, durationTicks: 960, velocity: 64, bow: 'up' };
    const out = sanitizeNotes([n], lo, hi, end);
    expect(out).toHaveLength(1);
    expect(out[0].pitch).toBe(hi);
    expect(out[0].durationTicks).toBe(100);
    expect(out[0].bow).toBe('up');
  });

  it("the earlier note's fields win the same-pitch overlap merge", () => {
    const [lo, hi, end] = v1();
    // True merge (same start): the later duplicate is dropped, the earlier
    // note keeps its own articulation.
    const a: Note = { pitch: 72, startTick: 0, durationTicks: 1920, velocity: 60, articulation: 'sulTasto' };
    const b: Note = { pitch: 72, startTick: 0, durationTicks: 960, velocity: 60, articulation: 'pizz' };
    const out = sanitizeNotes([a, b], lo, hi, end);
    expect(out).toHaveLength(1);
    expect(out[0].durationTicks).toBe(1920);
    expect(out[0].articulation).toBe('sulTasto');

    // Truncation (partial overlap): both survive back-to-back, each keeping
    // its own fields — nothing is silently re-attributed.
    const c: Note = { pitch: 72, startTick: 0, durationTicks: 1920, velocity: 60, articulation: 'sulTasto' };
    const d: Note = { pitch: 72, startTick: 960, durationTicks: 960, velocity: 60, articulation: 'pizz' };
    const both = sanitizeNotes([c, d], lo, hi, end);
    expect(both).toEqual([
      { pitch: 72, startTick: 0, durationTicks: 960, velocity: 60, articulation: 'sulTasto' },
      { pitch: 72, startTick: 960, durationTicks: 960, velocity: 60, articulation: 'pizz' },
    ]);
  });

  it('notes without the fields stay exactly as before (no undefined keys)', () => {
    const [lo, hi, end] = v1();
    const out = sanitizeNotes([{ pitch: 72, startTick: 0, durationTicks: 960, velocity: 64 }], lo, hi, end);
    expect(Object.keys(out[0]).sort()).toEqual(['durationTicks', 'pitch', 'startTick', 'velocity']);
  });

  it('the piano-roll edit path keeps articulation (copy + drag + sanitize)', () => {
    // PianoRoll works on copies ({ ...n }) and runs sanitizeNotes after a drag
    // (src/components/PianoRoll.tsx). The same sequence must keep fields.
    const [lo, hi, end] = v1();
    const onTrack: Note[] = [{ pitch: 74, startTick: 480, durationTicks: 960, velocity: 80, articulation: 'detache', bow: 'down' }];
    const edited = onTrack.map((n) => ({ ...n, startTick: n.startTick + 240 })); // user drags the note
    const cleaned = sanitizeNotes(edited, lo, hi, end);
    expect(cleaned[0].articulation).toBe('detache');
    expect(cleaned[0].bow).toBe('down');
    expect(cleaned[0].startTick).toBe(720);
  });

  it('humanizeNotes carries the fields too', () => {
    const p = base();
    const ctx = buildContext(p, { seed: 1, density: 1, humanize: true, lockedTrackIds: [] }, [], defaultRules);
    const rng = (() => { let s = 7; return () => { s = (s * 48271) % 2147483647; return s / 2147483647; }; })();
    const out = humanizeNotes([{ pitch: 72, startTick: 960, durationTicks: 480, velocity: 80, articulation: 'spiccato' }], ctx, rng, defaultRules);
    expect(out[0].articulation).toBe('spiccato');
  });
});

describe('the new fields survive save / load and project JSON export', () => {
  it('round-trips articulation, bow, cc and orchestration through the project JSON', () => {
    const p = base();
    const v1 = byRole(p, 'violins1');
    v1.notes = [{ pitch: 74, startTick: 0, durationTicks: 960, velocity: 70, articulation: 'tremolo', bow: 'down' }];
    v1.cc = [{ cc: 1, points: [{ tick: 0, value: 0 }, { tick: 3840, value: 100 }] }];
    p.orchestration = { take: 2, sectionTakes: { sec_verse: 5 }, sectionLocks: ['sec_verse'] };

    const doc = exportProjectJson(p); // exportedAt is added
    const back = importProjectJson(doc);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const q = byRole(back.project, 'violins1');
    expect(q.notes[0]).toEqual({ pitch: 74, startTick: 0, durationTicks: 960, velocity: 70, articulation: 'tremolo', bow: 'down' });
    expect(q.cc).toEqual([{ cc: 1, points: [{ tick: 0, value: 0 }, { tick: 3840, value: 100 }] }]);
    expect(back.project.orchestration).toEqual({ take: 2, sectionTakes: { sec_verse: 5 }, sectionLocks: ['sec_verse'] });
  });

  it('a document carrying the fields passes validateProject untouched (undo/redo parity)', () => {
    // The store's undo/redo snapshots whole Project objects, so the fields ride
    // along by construction; the thing that must hold is that a loaded or
    // restored document still validates as-is.
    const p = base();
    byRole(p, 'cellosBasses').notes = [{ pitch: 40, startTick: 0, durationTicks: 3840, velocity: 64, articulation: 'conSord' }];
    p.orchestration = { take: 1 };
    const snapshot = JSON.parse(JSON.stringify(p)); // what a history entry holds
    expectOk(snapshot);
  });

  it('instrument tracks exist to host the fields (sanity for the track.cc pass-through)', () => {
    const p = base();
    expect(p.tracks.filter(isInstrumentTrack).length).toBeGreaterThan(15);
    expect(byRole(p, 'violins1').cc).toBeUndefined();
  });
});
