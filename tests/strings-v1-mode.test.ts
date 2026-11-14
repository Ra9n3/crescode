/**
 * Strings V1 — isolation of the strings composition mode.
 * Classic is the default; V1 (Stage 3) replaces at most the two violin tracks
 * with its composed voice and leaves everything else equal to classic; the
 * Piano mode switch is independent; nothing outside the strings module
 * moved, except the dev-only audition switch read by the store.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { composeAllTracks, type ComposeResult } from '../src/orchestrator/compose';
import { DEFAULT_STRINGS_COMPOSITION_MODE, resolveStringsCompositionMode } from '../src/orchestrator/strings/mode';
import { BASS_HAND_OFF_POINTS, independentBassHandOff } from '../src/orchestrator/strings/bridge';
import { STRING_TEMPLATES, composeOptionsFor, composeStringCell, projectForStringCell, type StringCell } from './strings-v1-support';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string): string => readFileSync(path.join(root, relative), 'utf8');

const CELLS: StringCell[] = [
  ...STRING_TEMPLATES.map((template) => ({ template, fixture: 'dorian-16bars' as const, seed: 1, take: 0 })),
  { template: 'symphony', fixture: 'three-chorus-40bars', seed: 1, take: 2 },
  { template: 'chamber', fixture: 'multi-chorus-16bars', seed: 5, take: 1 },
];

/** Everything a caller can observe of a composition, including the ephemeral Piano score. */
const observable = (r: ComposeResult) => ({
  tracks: r.tracks, orchestration: r.orchestration, stringsTrackIds: r.stringsTrackIds, plan: r.plan, reports: r.reports,
  pianoScore: r.pianoScore.events, pianoRealized: r.pianoRealizedScoreEvents,
});

/** The observable composition without the one track V1 composed, and without the report lines (the controller summary names that track). */
/** The tracks V1 composed in a result: the first voice and, from Stage 3, the second voice on the other violin. */
const v1VoiceIds = (r: ComposeResult): string[] => {
  const context = r.stringsDiagnostics.v1;
  return [context?.composition?.trackId ?? null, context?.ensemble?.written ? context.ensemble.companion!.trackId : null, context?.viola?.written ? context.viola.viola!.trackId : null, context?.cello?.written ? context.cello.cello!.trackId : null, context?.doubleBass?.written ? context.doubleBass.doubleBass!.trackId : null].filter((id): id is string => id !== null);
};
const exceptV1Voice = (r: ComposeResult, trackIds: readonly string[] = v1VoiceIds(r)) => {
  const { reports: _reports, ...rest } = observable(r);
  return { ...rest, tracks: r.tracks.filter((t) => !trackIds.includes(t.id)) };
};

describe('strings composition mode switch', () => {
  it('resolves an omitted or unknown option to classic', () => {
    expect(DEFAULT_STRINGS_COMPOSITION_MODE).toBe('classic');
    expect(resolveStringsCompositionMode(undefined)).toBe('classic');
    expect(resolveStringsCompositionMode(null)).toBe('classic');
    expect(resolveStringsCompositionMode('classic')).toBe('classic');
    expect(resolveStringsCompositionMode('v1')).toBe('v1');
    expect(resolveStringsCompositionMode('V1' as never)).toBe('classic');
  });

  it('selects classic when the option is omitted, and explicit classic is identical', { timeout: 120_000 }, () => {
    for (const cell of CELLS) {
      const omitted = composeStringCell(cell, undefined).result;
      const classic = composeStringCell(cell, 'classic').result;
      expect(omitted.stringsDiagnostics.mode).toBe('classic');
      expect(omitted.stringsDiagnostics.v1).toBeNull();
      expect(classic.stringsDiagnostics.mode).toBe('classic');
      expect(observable(classic)).toEqual(observable(omitted));
      expect(classic.stringsDiagnostics.consumed).toEqual(omitted.stringsDiagnostics.consumed);
    }
  });

  it('V1 replaces at most the two violin tracks, the Viola track, the Cello track and the Double Bass desk and leaves everything else equal to classic', { timeout: 120_000 }, () => {
    for (const cell of CELLS) {
      const classic = composeStringCell(cell, 'classic').result;
      const v1 = composeStringCell(cell, 'v1').result;
      expect(v1.stringsDiagnostics.mode).toBe('v1');
      const context = v1.stringsDiagnostics.v1!;
      expect(context).toMatchObject({ mode: 'v1', stage: 6 });
      expect(context.understanding.structure.status).toBe('proposal');
      expect(context.composition).not.toBeNull();
      expect(context.passThrough).toBe(!context.composition!.written);
      expect(exceptV1Voice(v1)).toEqual(exceptV1Voice(classic, v1VoiceIds(v1)));
      expect(v1VoiceIds(v1).length).toBeLessThanOrEqual(5);
      // the information other families consume is the classic information
      expect(v1.stringsDiagnostics.consumed).toEqual(classic.stringsDiagnostics.consumed);
    }
  });

  it('keeps the diagnostics off the persisted shape of the result', () => {
    const { result } = composeStringCell(CELLS[0], 'v1');
    expect(Object.keys(result)).not.toContain('stringsDiagnostics');
    expect(JSON.stringify(result)).not.toContain('stringsDiagnostics');
  });

  it('leaves the Piano mode selection unaffected', { timeout: 120_000 }, () => {
    const cell: StringCell = { template: 'chamber', fixture: 'dorian-16bars', seed: 1, take: 0 };
    const run = (piano: 'classic' | 'identity' | undefined, strings: 'classic' | 'v1' | undefined): ComposeResult =>
      composeAllTracks(projectForStringCell(cell), { ...composeOptionsFor(cell, strings), ...(piano ? { pianoComposition: piano } : {}) });
    const piano = (r: ComposeResult) => r.tracks.find((t) => t.role === 'piano')!;
    for (const pianoMode of ['classic', 'identity', undefined] as const) {
      const base = run(pianoMode, undefined);
      const withV1 = run(pianoMode, 'v1');
      expect(exceptV1Voice(withV1)).toEqual(exceptV1Voice(base, v1VoiceIds(withV1)));
      expect(observable(run(pianoMode, 'classic'))).toEqual(observable(base));
    }
    // the Piano switch still does what it did: omitted = identity, and classic differs from identity
    expect(piano(run(undefined, 'v1')).notes).toEqual(piano(run('identity', undefined)).notes);
    expect(piano(run('classic', 'v1')).notes).not.toEqual(piano(run('identity', 'v1')).notes);
  });
});

describe('strings V1 is not exposed and nothing else moved', () => {
  it('is not referenced by the app store, the components or any Piano test or script', () => {
    const files = [
      'src/store/store.ts',
      ...readdirSync(path.join(root, 'src/components')).map((f) => `src/components/${f}`),
      ...readdirSync(path.join(root, 'tests')).filter((f) => f.startsWith('piano-') && f.endsWith('.ts')).map((f) => `tests/${f}`),
      ...readdirSync(path.join(root, 'scripts')).filter((f) => f.startsWith('piano-')).map((f) => `scripts/${f}`),
    ].filter((f) => /\.(ts|tsx)$/.test(f));
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) expect(read(file), file).not.toContain('stringsComposition');
  });

  // Until Stage 5 nothing was handed to the desk. Stage 6 composes the Double Bass and hands its notes to the existing
  // desk at the end of the V1 block; the classic split's own code (the documented points) is still there and untouched.
  it('documents Double Bass hand-off points that still exist in compose.ts; the classic split itself is not rewired', { timeout: 120_000 }, () => {
    const compose = read('src/orchestrator/compose.ts');
    for (const point of BASS_HAND_OFF_POINTS) expect(compose, point.anchor).toContain(point.anchor);
    expect(compose).not.toContain('independentBassHandOff');
    expect(independentBassHandOff(null)).toBeNull();
    expect(compose).toContain('composeStringsV1DoubleBass');
    for (const cell of CELLS) {
      const context = composeStringCell(cell, 'v1').result.stringsDiagnostics.v1!;
      const handed = independentBassHandOff(context);
      if (context.doubleBass?.written) expect(handed).toEqual({ notes: context.doubleBass.notes });
      else expect(handed).toBeNull();
    }
  });

  // The protected baseline commit. Skipped when the commit is not in the local object store.
  const refOf = (): string | null => {
    for (const ref of ['2e24908', 'FETCH_HEAD']) {
      try {
        const sha = execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: root, encoding: 'utf8' }).trim();
        if (sha.startsWith('2e24908')) return sha;
      } catch { /* not available */ }
    }
    return null;
  };
  const baseline = refOf();

  it.skipIf(!baseline)('leaves every frozen file identical to the Piano baseline 2e24908', () => {
    const frozen = [
      'src/orchestrator/keys', 'src/orchestrator/brass', 'src/orchestrator/winds', 'src/orchestrator/percussion',
      'src/orchestrator/conductor', 'src/orchestrator/expression', 'src/orchestrator/lines', 'src/orchestrator/voicing',
      'src/orchestrator/energy', 'src/orchestrator/spine', 'src/orchestrator/profiles', 'src/orchestrator/render.ts', 'src/orchestrator/basses.ts',
      'src/engine', 'src/export', 'src/store', 'src/audio', 'src/config', 'src/shared', 'specs', 'fixtures',
      'package.json', 'package-lock.json',
    ];
    const listed = execFileSync('git', ['ls-tree', '-r', baseline!, '--', ...frozen], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\n').filter(Boolean).map((line) => { const [meta, file] = line.split('\t'); return { sha: meta.split(' ')[2], file }; });
    expect(listed.length).toBeGreaterThan(100);
    const hashes = execFileSync('git', ['hash-object', '--stdin-paths'], { cwd: root, encoding: 'utf8', input: listed.map((l) => l.file).join('\n'), maxBuffer: 64 * 1024 * 1024 })
      .split('\n').filter(Boolean);
    const changed = listed.filter((l, i) => hashes[i] !== l.sha).map((l) => l.file);
    // Stage 2: the store reads the dev-only audition switch. That is the ONLY permitted change, and
    // it is checked line by line: removing exactly these lines gives back the baseline file.
    expect(changed).toEqual(['src/store/store.ts']);
    const before = execFileSync('git', ['show', `${baseline}:src/store/store.ts`], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const restored = read('src/store/store.ts')
      .replace("import { devStringsAuditionOverride } from '../dev/stringsAudition';\n", '')
      .replace(/^const stringsDiagnosticsOfResult = .*\n/m, '')
      .replace(/^ *\/\/ dev-only audition switch .*\n/m, '')
      .replace(/^ *const auditionOverride = devStringsAuditionOverride\(\);\n/m, '')
      .replace('composeAllTracks(project, { ...composeOptions, ...auditionOverride })', 'composeAllTracks(project, composeOptions)')
      .replace(/^ *if \(Object\.keys\(auditionOverride\)\.length > 0\) console\.info\(.*\n/m, '');
    expect(restored).toBe(before);
  });

  it.skipIf(!baseline)('leaves every pre-existing test, snapshot and golden file identical to the baseline', () => {
    const listed = execFileSync('git', ['ls-tree', '-r', baseline!, '--', 'tests', 'evaluation', 'docs'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\n').filter(Boolean).map((line) => { const [meta, file] = line.split('\t'); return { sha: meta.split(' ')[2], file }; });
    expect(listed.length).toBeGreaterThan(500);
    const hashes = execFileSync('git', ['hash-object', '--stdin-paths'], { cwd: root, encoding: 'utf8', input: listed.map((l) => l.file).join('\n'), maxBuffer: 64 * 1024 * 1024 })
      .split('\n').filter(Boolean);
    expect(listed.filter((l, i) => hashes[i] !== l.sha).map((l) => l.file)).toEqual([]);
  });
});
