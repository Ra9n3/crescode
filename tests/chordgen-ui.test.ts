/**
 * Chord-generator UI/UX tests (spec §12) — scope detection, settings
 * persistence + undo, chord locking, and the Generate action boundary.
 * The store and lib modules are framework-free, so everything here runs in node.
 * (Browser-level invariants — no prompt dialog, tooltip in the DOM — live in
 * scripts/e2e-smoke.mjs.)
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { importProjectJson } from '../src/export/json';
import { runChordGenerate, __setChordGenerator } from '../src/lib/chordGenUi';
import { detectGenerationScope, scopeTooltip, songCoverage, type GenerationScope } from '../src/lib/genScope';
import { useStore } from '../src/store/store';
import {
  DEFAULT_CHORDGEN_SETTINGS, createDefaultProject, isChordLocked, projectFromFixture,
  validateProject, type Chord, type Project, type Section,
} from '../src/shared/schema';

const BT = 960 * 4; // bar in ticks at 4/4, 960 PPQ

/** Minimal valid project builder (factory tracks, given sections/chords). */
function makeProject(sections: Section[], chords: Chord[], opts: Partial<Project> = {}): Project {
  const base = projectFromFixture({ name: 'Test', tracks: [] });
  return { ...base, sections, chords, ...opts };
}

const sec = (id: string, name: string, startBar: number, lengthBars: number): Section => ({ id, name, startBar, lengthBars });
const chd = (id: string, startTick: number, durationTicks: number, symbol = 'C'): Chord => ({ id, symbol, startTick, durationTicks });

/** Two 4-bar sections → 8-bar song span at 4/4. */
const twoSections = [sec('s1', 'Verse', 1, 4), sec('s2', 'Chorus', 5, 4)];

/** Deterministic store state: one 4-bar chord over an 8-bar song → fill scope. */
function resetStore(chords: Chord[] = [chd('c1', 0, 4 * BT)]) {
  const p = makeProject(twoSections, chords);
  useStore.setState({
    project: p, past: [], future: [], lastCoalesce: null, dirty: false, filePath: null,
    selectedTrackIds: [], selectedSectionId: null, selectedChordId: null,
    toasts: [], genHighlight: null, modal: null,
  });
}

beforeEach(() => {
  resetStore();
  __setChordGenerator(null);
});

describe('scope detection (spec §2, §11 — interval coverage, PPQ ticks)', () => {
  it('empty song → whole song, tooltip "Generate chords for entire song"', () => {
    const p = makeProject(twoSections, []);
    expect(detectGenerationScope(p, null)).toEqual({ type: 'all' });
    expect(scopeTooltip(detectGenerationScope(p, null), p)).toBe('Generate chords for entire song');
  });

  it('no sections and no chords at all is still an empty song', () => {
    const p = makeProject([], []);
    expect(songCoverage(p).kind).toBe('empty-song');
    expect(detectGenerationScope(p, null)).toEqual({ type: 'all' });
  });

  it('fully populated song (chords tile the section span) → whole song, "Regenerate entire song"', () => {
    const p = makeProject(twoSections, [chd('c1', 0, 4 * BT), chd('c2', 4 * BT, 4 * BT)]);
    expect(detectGenerationScope(p, null)).toEqual({ type: 'all' });
    expect(scopeTooltip(detectGenerationScope(p, null), p)).toBe('Regenerate entire song');
  });

  it('gap at the end (partially populated) → fill empty spaces only', () => {
    const p = makeProject(twoSections, [chd('c1', 0, 4 * BT)]);
    expect(detectGenerationScope(p, null)).toEqual({ type: 'empty' });
    expect(scopeTooltip(detectGenerationScope(p, null), p)).toBe('Fill empty chord spaces');
  });

  it('gap BETWEEN two chords is detected — coverage is interval-based, not chord counts', () => {
    const p = makeProject(twoSections, [chd('c1', 0, 2 * BT), chd('c2', 6 * BT, 2 * BT)]);
    const cov = songCoverage(p);
    expect(cov.kind).toBe('partial');
    expect(cov.gapCount).toBe(1);
    expect(detectGenerationScope(p, null)).toEqual({ type: 'empty' });
  });

  it('leading gap before the first chord counts too', () => {
    const p = makeProject(twoSections, [chd('c1', 4 * BT, 4 * BT)]);
    expect(songCoverage(p).gapCount).toBe(1);
    expect(detectGenerationScope(p, null)).toEqual({ type: 'empty' });
  });

  it('overlapping chords do not fake coverage', () => {
    const p = makeProject(twoSections, [chd('c1', 0, 4 * BT), chd('c2', 0, 8 * BT)]);
    expect(detectGenerationScope(p, null)).toEqual({ type: 'all' });
  });

  it('deleting a chord turns a full song back into fill-mode; refilling reverses it', () => {
    const full = makeProject(twoSections, [chd('c1', 0, 4 * BT), chd('c2', 4 * BT, 4 * BT)]);
    expect(detectGenerationScope(full, null)).toEqual({ type: 'all' });
    const broken = makeProject(twoSections, [chd('c1', 0, 4 * BT)]);
    expect(detectGenerationScope(broken, null)).toEqual({ type: 'empty' });
    const repaired = makeProject(twoSections, [chd('c1', 0, 4 * BT), chd('c2', 4 * BT, 4 * BT), chd('c3', 6 * BT, 2 * BT)]);
    expect(detectGenerationScope(repaired, null)).toEqual({ type: 'all' });
  });

  it('a selected section always takes precedence over song-wide coverage', () => {
    const full = makeProject(twoSections, [chd('c1', 0, 4 * BT), chd('c2', 4 * BT, 4 * BT)]);
    const scope = detectGenerationScope(full, 's2');
    expect(scope).toEqual({ type: 'section', sectionId: 's2' });
    expect(scopeTooltip(scope, full)).toBe('Regenerate selected section: Chorus');
  });

  it('an unknown selected section id falls back to song-wide behavior', () => {
    const full = makeProject(twoSections, [chd('c1', 0, 4 * BT), chd('c2', 4 * BT, 4 * BT)]);
    expect(detectGenerationScope(full, 'nope')).toEqual({ type: 'all' });
  });

  it('a selected chord is ignored — scope stays song-wide (spec §2)', () => {
    const p = makeProject(twoSections, [chd('c1', 0, 4 * BT), chd('c2', 4 * BT, 4 * BT)]);
    useStore.setState({ project: p, selectedChordId: 'c1', selectedSectionId: null });
    expect(detectGenerationScope(useStore.getState().project, useStore.getState().selectedSectionId)).toEqual({ type: 'all' });
  });

  it('non-4/4 meters: span and coverage follow barTicks (3/4 and 6/8)', () => {
    const ts34 = { numerator: 3, denominator: 4 };
    const bt34 = 960 * 3;
    const p34 = makeProject([sec('s1', 'Waltz', 1, 4)], [chd('c1', 0, 2 * bt34), chd('c2', 2 * bt34, 2 * bt34)], { timeSignature: ts34 });
    expect(songCoverage(p34).spanTicks).toBe(4 * bt34);
    expect(detectGenerationScope(p34, null)).toEqual({ type: 'all' });

    const ts68 = { numerator: 6, denominator: 8 };
    const bt68 = Math.round((960 * 4 * 6) / 8);
    const p68 = makeProject([sec('s1', 'Ballad', 1, 2)], [chd('c1', 0, bt68)], { timeSignature: ts68 });
    expect(songCoverage(p68).spanTicks).toBe(2 * bt68);
    expect(detectGenerationScope(p68, null)).toEqual({ type: 'empty' });
  });
});

describe('scope → tooltip mapping (spec §4)', () => {
  const p = makeProject(twoSections, [chd('c1', 0, 4 * BT)]);
  const cases: [GenerationScope, string][] = [
    [{ type: 'all' }, 'Regenerate entire song'],
    [{ type: 'empty' }, 'Fill empty chord spaces'],
    [{ type: 'section', sectionId: 's1' }, 'Regenerate selected section: Verse'],
  ];
  it.each(cases)('tooltip for %j', (scope, text) => {
    expect(scopeTooltip(scope, p)).toBe(text);
  });
  it('empty song tooltip differs from regenerate', () => {
    const empty = makeProject([], []);
    expect(scopeTooltip({ type: 'all' }, empty)).toBe('Generate chords for entire song');
  });
});

describe('chord locking state (spec §5)', () => {
  it('missing or false locked = unlocked, true = locked (backward compatible)', () => {
    expect(isChordLocked({ id: 'a', symbol: 'C', startTick: 0, durationTicks: 1 })).toBe(false);
    expect(isChordLocked({ id: 'a', symbol: 'C', startTick: 0, durationTicks: 1, locked: false })).toBe(false);
    expect(isChordLocked({ id: 'a', symbol: 'C', startTick: 0, durationTicks: 1, locked: true })).toBe(true);
  });

  it('locking and unlocking from the store are single undoable steps', () => {
    const s = useStore.getState();
    const id = s.project.chords[0].id;
    const historyAfterOpen = useStore.getState().past.length;
    s.updateChord(id, { locked: true });
    expect(useStore.getState().past.length).toBe(historyAfterOpen + 1);
    expect(useStore.getState().project.chords[0].locked).toBe(true);
    useStore.getState().undo();
    expect(useStore.getState().project.chords[0].locked === true).toBe(false);
    useStore.getState().redo();
    expect(useStore.getState().project.chords[0].locked).toBe(true);
  });

  it('validator accepts locked booleans and old chords without the field', () => {
    const p = makeProject(twoSections, [chd('c1', 0, BT), { ...chd('c2', BT, BT), locked: true }]);
    expect(validateProject(p).ok).toBe(true);
  });

  it('validator rejects a non-boolean locked field', () => {
    const p = makeProject(twoSections, [{ ...chd('c1', 0, BT), locked: 'yes' } as unknown as Chord]);
    const r = validateProject(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.path === 'chords[0].locked')).toBe(true);
  });
});

describe('settings persistence (spec §6, §7)', () => {
  it('new projects carry engine defaults in the factory', () => {
    expect(createDefaultProject().chordGenSettings).toEqual(DEFAULT_CHORDGEN_SETTINGS);
  });

  it('projects without the field load fine and read as defaults (validate + normalize)', () => {
    const old = makeProject(twoSections, []);
    delete (old as Partial<Project>).chordGenSettings;
    expect(validateProject(old).ok).toBe(true);
    const r = importProjectJson(JSON.stringify({ ...old, exportedAt: new Date().toISOString() }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.project.chordGenSettings).toEqual(DEFAULT_CHORDGEN_SETTINGS);
  });

  it('a partial settings object in a file is merged onto defaults', () => {
    const doc = makeProject(twoSections, []);
    doc.chordGenSettings = { seed: 777 } as Project['chordGenSettings'];
    const r = importProjectJson(JSON.stringify(doc));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.project.chordGenSettings?.seed).toBe(777);
      expect(r.project.chordGenSettings?.complexity).toBe(DEFAULT_CHORDGEN_SETTINGS.complexity);
    }
  });

  it('setChordGenSettings merges patches into the project and persists them', () => {
    const s = useStore.getState();
    s.setChordGenSettings({ complexity: 3 });
    expect(useStore.getState().project.chordGenSettings?.complexity).toBe(3);
    expect(useStore.getState().project.chordGenSettings?.borrowing).toBe('some'); // untouched key intact
    s.setChordGenSettings({ seed: 4242 });
    const gs = useStore.getState().project.chordGenSettings;
    expect(gs?.complexity).toBe(3);
    expect(gs?.seed).toBe(4242);
  });

  it('settings changes participate in undo/redo (spec §9)', () => {
    const s = useStore.getState();
    const before = s.project.chordGenSettings ?? DEFAULT_CHORDGEN_SETTINGS;
    s.setChordGenSettings({ cadence: 'strong', borrowing: 'more' });
    expect(useStore.getState().project.chordGenSettings?.cadence).toBe('strong');
    useStore.getState().undo();
    expect(useStore.getState().project.chordGenSettings).toEqual(before);
    useStore.getState().redo();
    expect(useStore.getState().project.chordGenSettings?.cadence).toBe('strong');
  });

  it('rapid slider drags with a coalesce key merge into ONE undo step', () => {
    const s = useStore.getState();
    const history = useStore.getState().past.length;
    s.setChordGenSettings({ variation: 0.2 }, 'chordgen-variation');
    s.setChordGenSettings({ variation: 0.9 }, 'chordgen-variation'); // same key, < 800 ms apart
    expect(useStore.getState().project.chordGenSettings?.variation).toBe(0.9);
    expect(useStore.getState().past.length).toBe(history + 1);
  });

  it('reset to defaults is one undo step (spec §6)', () => {
    const s = useStore.getState();
    s.setChordGenSettings({ complexity: 3, seed: 999, cadence: 'soft' });
    const history = useStore.getState().past.length;
    s.setChordGenSettings(DEFAULT_CHORDGEN_SETTINGS);
    expect(useStore.getState().project.chordGenSettings).toEqual(DEFAULT_CHORDGEN_SETTINGS);
    expect(useStore.getState().past.length).toBe(history + 1);
  });

  it('the seed lives in the project settings and survives round-trip (spec §8)', () => {
    const s = useStore.getState();
    s.setChordGenSettings({ seed: 31337 });
    const exported = JSON.parse(JSON.stringify(useStore.getState().project));
    const r = importProjectJson(JSON.stringify(exported));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.project.chordGenSettings?.seed).toBe(31337);
  });

  it('validator rejects unknown keys and out-of-range values', () => {
    const bad1 = makeProject(twoSections, []);
    (bad1 as Record<string, unknown>).chordGenSettings = { nope: 1 };
    expect(validateProject(bad1).ok).toBe(false);
    const bad2 = makeProject(twoSections, []);
    bad2.chordGenSettings = { ...DEFAULT_CHORDGEN_SETTINGS, complexity: 7 };
    expect(validateProject(bad2).ok).toBe(false);
    const bad3 = makeProject(twoSections, []);
    bad3.chordGenSettings = { ...DEFAULT_CHORDGEN_SETTINGS, seed: -5 };
    expect(validateProject(bad3).ok).toBe(false);
  });
});

describe('Generate action boundary (spec §2, §8 — no dialog, no seed advance)', () => {
  it('with no generator connected: subtle info toast, zero project changes, seed untouched', () => {
    const projectBefore = JSON.stringify(useStore.getState().project);
    const seedBefore = useStore.getState().project.chordGenSettings?.seed;
    runChordGenerate();
    expect(JSON.stringify(useStore.getState().project)).toBe(projectBefore);
    expect(useStore.getState().project.chordGenSettings?.seed).toBe(seedBefore);
    const toasts = useStore.getState().toasts;
    expect(toasts.length).toBe(1);
    expect(toasts[0].kind).toBe('info');
    expect(toasts[0].text).toContain('not connected');
    for (const t of toasts) useStore.getState().dismissToast(t.id);
  });

  it('the connected path is wired: ONE undo step, seed advances, highlight triggers', () => {
    const seedBefore = useStore.getState().project.chordGenSettings?.seed ?? 1;
    const history = useStore.getState().past.length;
    __setChordGenerator((p, scope, seed) => {
      expect(seed).toBe(seedBefore);
      expect(scope.type).toBe('empty'); // resetStore leaves a 4-bar gap
      return [...p.chords, { id: 'gen1', symbol: 'G', startTick: 4 * BT, durationTicks: BT, locked: false }];
    });
    runChordGenerate();
    const st = useStore.getState();
    expect(st.project.chords.some((c) => c.id === 'gen1')).toBe(true);
    expect(st.past.length).toBe(history + 1); // exactly ONE undo step
    expect(st.project.chordGenSettings?.seed).toBe((seedBefore + 1) >>> 0); // advanced by one
    expect(st.genHighlight?.chordIds).toEqual(['gen1']);
  });

  it('the generated chord is unlocked by default (spec §5)', () => {
    __setChordGenerator((p) => [...p.chords, { id: 'gen2', symbol: 'Am', startTick: 4 * BT, durationTicks: BT }]);
    runChordGenerate();
    const last = useStore.getState().project.chords[useStore.getState().project.chords.length - 1];
    expect(isChordLocked(last)).toBe(false);
  });
});
