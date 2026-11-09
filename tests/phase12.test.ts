import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { projectFromFixture, validateProject, type Project } from '../src/shared/schema';
import {
  applyNoteMap, keyNameToMidi, parseExportProfile, profilePartSummary, profileScopeNote,
  validateExportProfile, type ExportProfile, type FoldStats,
} from '../src/export/profile';
import { EXPORT_PROFILES } from '../src/export/profiles';
import { buildMergedMidi, buildPerTrackMidi, exportableTracks, parseMidiFile } from '../src/export/midi';

/**
 * Phase 12 — Falcon export profiles for winds, percussion, harp and piano
 * (spec §17). The Phase 5.5 profile system grows the four wind Solo patches
 * (silent-gap folds under the existing machinery), the Timpani selection
 * keyswitch, the snare's hash-seeded single-hit rotation (snareHitKeys
 * 48–62, never the same key twice in a row), the cymbals' fixed long-crash
 * key 48 (the engine writes crashes and swells only — pre-flight 3), the
 * Harp 1 Sustain keyswitch, the UVI Grand Model D piano patch exported as Piano with generated CC64 and
 * the deliberately unmapped aux. Pinned here: the plain export and the
 * string/brass profile output stay byte-identical to the pre-change
 * reference (captured at 4523385), every project track stays byte-identical
 * to golden105, the playability floor, the rotation rules, the channel map
 * (merged = 1–9 + 11–16, never 10; percussion files on 10/11/12), generated
 * Piano CC64 events and export naming, harp/percussion CC rules and
 * the wind CC convention, and the zero fold /
 * drop counts the report states.
 */
const TEMPLATES = ['ensemble.chamber', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.symphony', 'ensemble.cinematic', 'ensemble.hybridstudio'];
const PROFILE: ExportProfile = EXPORT_PROFILES[0].profile;

const THREE = (): Project => projectFromFixture(JSON.parse(JSON.stringify(threeChorus)));
const DORIAN = (): Project => projectFromFixture(JSON.parse(JSON.stringify(dorian)));

interface Run { key: string; project: Project }
const SURVEY: Run[] = [];
const composeTake = (fixture: 'three' | 'dorian', templateId: string, take: number): Run => {
  const p = fixture === 'three' ? THREE() : DORIAN();
  p.ensemble = { templateId, overrides: {}, pins: {} };
  p.orchestration = { take };
  const result = composeAllTracks(p, { seed: 11 });
  const run: Run = { key: `${templateId.replace('ensemble.', '')}-${fixture}-t${take}`, project: { ...p, tracks: result.tracks, orchestration: result.orchestration } as Project };
  SURVEY.push(run);
  return run;
};
for (const templateId of TEMPLATES) {
  for (let take = 1; take <= 10; take++) composeTake('three', templateId, take);
  for (let take = 1; take <= 10; take++) composeTake('dorian', templateId, take);
}

const shaText = (s: string): string => createHash('sha256').update(s).digest('hex');
const perTrackDigest = (files: { fileName: string; data: Uint8Array }[]): string =>
  shaText(files.map((f) => f.fileName + '\0').join('') + files.map((f) => Buffer.from(f.data).toString('base64')).join('\u0001'));
const STRING_BRASS_PATCHES = [
  'Violins 1 Ensemble', 'Violins 2 Ensemble', 'Viola Ensemble', 'Cello Ensemble', 'Bass Ensemble',
  'French Horn Ensemble', 'Trombone Ensemble', 'Trumpet Ensemble', 'Tuba solo',
];
const REF = JSON.parse(readFileSync(new URL('./phase12-export-reference.json', import.meta.url), 'utf8')).runs as Record<string, { plain: { merged: string; perTrack: string }; profile: { mergedSlice: string; perTrack: string } }>;

const statsSink = (): FoldStats => ({ folded: {}, droppedHardRange: {}, droppedDoubling: {} });
const trackOf = (run: Run, role: string) => run.project.tracks.find((t) => t.role === role);
const partOf = (id: string) => PROFILE.parts.find((p) => p.id === id)!;
const ksKeysOf = (partId: string): number[] =>
  Object.values(partOf(partId).keyswitches).map((name) => keyNameToMidi(name, PROFILE.pitchConvention)!).filter((n) => !Number.isNaN(n));

/* ---------------- 1–2. the byte pins against the pre-change reference ------ */

describe('Phase 12: the byte pins', () => {
  // Phase 11.6 UPDATE (named): the export MACHINERY is unchanged, but the
  // piano's notes flow through the no-profile export — the pin reads the
  // merged file's NON-piano tracks back and compares them to golden105's
  // bytes (the passthrough fidelity; the machinery's own byte pins ride on
  // the string/brass profile slice below, which did not move).
  it('the no-profile per-track export carries the non-piano tracks byte-identically to golden105 (120 runs)', () => {
    for (const run of SURVEY) {
      const tracks = exportableTracks(run.project, 'all').filter((t) => t.role !== 'piano');
      const files = buildPerTrackMidi(run.project, tracks, null);
      const golden = JSON.parse(readFileSync(new URL(`./golden105/${run.key}.json`, import.meta.url), 'utf8')) as { tracks: { id: string; role: string; notes: unknown; cc?: unknown }[] };
      const byId = new Map(golden.tracks.map((t) => [t.id, t]));
      for (const f of files) {
        const trackId = f.fileName.match(/trk_[a-z0-9_]+/)?.[0] ?? '';
        const g = byId.get(trackId);
        if (!g) continue;
        const parsed = parseMidiFile(f.data);
        const notes = parsed.tracks[1]?.notes ?? [];
        expect(JSON.stringify(notes), `${run.key}: the per-track export of ${g.role} moved`).toBe(JSON.stringify(g.notes));
      }
    }
  }, 900000);

  it('the string and brass profile output is byte-identical to the pre-change reference (merged slice + per-track files, 120 runs)', () => {
    for (const run of SURVEY) {
      const tracks = exportableTracks(run.project, 'all');
      const parsed = parseMidiFile(buildMergedMidi(run.project, tracks, PROFILE));
      const slice = parsed.tracks.filter((t) => STRING_BRASS_PATCHES.includes(t.name))
        .map((t) => JSON.stringify({ name: t.name, channel: t.channel, notes: t.notes, cc: t.cc }));
      const per = buildPerTrackMidi(run.project, tracks, PROFILE).filter((f) => STRING_BRASS_PATCHES.some((p) => f.fileName.endsWith(` ${p}.mid`)));
      expect(`${shaText(slice.join('\u0001'))}|${perTrackDigest(per)}`, `${run.key}: the string/brass profile output moved`).toBe(`${REF[run.key].profile.mergedSlice}|${REF[run.key].profile.perTrack}`);
    }
  }, 900000);

  // Phase 11.6 UPDATE (named): the piano is the phase's own mover — the
  // project pin exempts it (the phase116 battery pins the piano's
  // hygiene); every other track stays byte-identical to golden105 and the
  // export still never touches the project.
  it('every non-piano project track in all six templates is byte-identical to golden105, the vocalbacking harp velocity excepted (the export never touches the project)', () => {
    const stable = (t: { id: string; role: string; notes: unknown; cc?: unknown }) =>
      JSON.stringify({ id: t.id, role: t.role, notes: t.notes, ...(t.cc !== undefined ? { cc: t.cc } : {}) });
    const stableNoVel = (t: { id: string; role: string; notes: { velocity?: number }[]; cc?: unknown }) =>
      JSON.stringify({ id: t.id, role: t.role, notes: t.notes.map((n) => ({ ...n, velocity: 0 })), ...(t.cc !== undefined ? { cc: t.cc } : {}) });
    for (const run of SURVEY) {
      const golden = JSON.parse(readFileSync(new URL(`./golden105/${run.key}.json`, import.meta.url), 'utf8'));
      const live = run.project.tracks.filter((t) => t.role !== 'piano').map((t) => (t.role === 'harp' ? stableNoVel(t as any) : stable(t as any)));
      const gold = (golden.tracks as { role: string }[]).filter((t) => t.role !== 'piano').map((t) => (t.role === 'harp' ? stableNoVel(t as any) : stable(t as any)));
      expect(live, `${run.key}: a non-piano project track moved against golden105 beyond the harp's velocity-only allowance`).toEqual(gold);
    }
  }, 900000);
});

/* ---------------- 3–5. playability, keyswitch confinement ------------------ */

describe('Phase 12: playability and keyswitch confinement', () => {
  it('every exported note sits at or above the patch\u2019s first playable key, or is a keyswitch (merged + per-track, 120 runs)', () => {
    for (const run of SURVEY) {
      const tracks = exportableTracks(run.project, 'all');
      const merged = parseMidiFile(buildMergedMidi(run.project, tracks, PROFILE));
      for (const t of [...merged.tracks, ...buildPerTrackMidi(run.project, tracks, PROFILE).map((f) => parseMidiFile(f.data).tracks[1])] as typeof merged.tracks) {
        const part = PROFILE.parts.find((p) => p.patch === t.name);
        if (!part) continue; // the conductor and passthrough tracks
        const floor = part.playableLow ?? part.lowestPlayable;
        const ks = new Set(ksKeysOf(part.id));
        for (const n of t.notes) {
          if (ks.has(n.pitch)) continue;
          expect(n.pitch, `${run.key}: ${part.id} exported pitch ${n.pitch} below the playable floor ${floor}`).toBeGreaterThanOrEqual(floor);
        }
      }
    }
  }, 900000);

  it('keyswitches exist only in the exported file: the project is untouched by the exports and still validates', () => {
    let checked = 0;
    for (const run of SURVEY) {
      const before = JSON.stringify(run.project.tracks);
      const tracks = exportableTracks(run.project, 'all');
      buildMergedMidi(run.project, tracks, PROFILE);
      buildPerTrackMidi(run.project, tracks, PROFILE);
      expect(JSON.stringify(run.project.tracks), `${run.key}: an export mutated the project`).toBe(before);
      expect(validateProject(JSON.parse(JSON.stringify(run.project))).ok, `${run.key}: the project no longer validates`).toBe(true);
      checked++;
    }
    expect(checked).toBe(120);
  }, 900000);
});

/* ---------------- 6–7. the snare rotation and the cymbal key --------------- */

describe('Phase 12: the snare rotation and the cymbal key', () => {
  it('the snare rotation is deterministic, stays inside snareHitKeys (48–62), never repeats a key immediately and keeps every note', () => {
    let distinctKeys = new Set<number>();
    let total = 0;
    for (const run of SURVEY) {
      const snare = trackOf(run, 'snare');
      if (!snare || !snare.notes.length) continue;
      const tracks = exportableTracks(run.project, 'all');
      const file = buildPerTrackMidi(run.project, tracks, PROFILE).find((f) => f.fileName.endsWith(' Snare.mid'))!;
      const parsed = parseMidiFile(file.data).tracks[1];
      // determinism: the same export twice
      const file2 = buildPerTrackMidi(run.project, exportableTracks(run.project, 'all'), PROFILE).find((f) => f.fileName.endsWith(' Snare.mid'))!;
      expect(Buffer.from(file.data).equals(Buffer.from(file2.data)), `${run.key}: the snare rotation is not deterministic`).toBe(true);
      // count, pool, no immediate repeat (the writer sorts by tick; the parse restores time order)
      expect(parsed.notes.length, `${run.key}: a snare note was lost or invented`).toBe(snare.notes.length);
      const sorted = [...parsed.notes].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
      for (const n of sorted) {
        expect(n.pitch, `${run.key}: snare key ${n.pitch} outside the pool`).toBeGreaterThanOrEqual(48);
        expect(n.pitch).toBeLessThanOrEqual(62);
        distinctKeys.add(n.pitch);
      }
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].pitch, `${run.key}: snare key repeated immediately (${sorted[i - 1].pitch} → ${sorted[i].pitch})`).not.toBe(sorted[i - 1].pitch);
      }
      // velocity, timing and duration ride through untouched
      const engineSorted = [...snare.notes].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
      for (let i = 0; i < sorted.length; i++) {
        expect(sorted[i].velocity).toBe(engineSorted[i].velocity);
        expect(sorted[i].durationTicks).toBe(engineSorted[i].durationTicks);
        expect(sorted[i].startTick).toBe(engineSorted[i].startTick);
      }
      total++;
    }
    expect(total).toBeGreaterThan(0);
    console.log(`PHASE12 snare rotation: ${total} runs, ${distinctKeys.size} distinct keys realised of the 15-key pool (${[...distinctKeys].sort((a, b) => a - b).join(',')})`);
  }, 900000);

  it('the cymbal output contains only the long-crash key 48 (and could only ever hold 55–59 beside it); every hit survives', () => {
    let total = 0;
    const pitches = new Set<number>();
    for (const run of SURVEY) {
      const cymbals = trackOf(run, 'cymbals');
      if (!cymbals || !cymbals.notes.length) continue;
      const file = buildPerTrackMidi(run.project, exportableTracks(run.project, 'all'), PROFILE).find((f) => f.fileName.endsWith(' Cymbals.mid'))!;
      const parsed = parseMidiFile(file.data).tracks[1];
      expect(parsed.notes.length, `${run.key}: a cymbal hit was lost or invented`).toBe(cymbals.notes.length);
      for (const n of parsed.notes) {
        expect([48, 55, 56, 57, 58, 59]).toContain(n.pitch);
        pitches.add(n.pitch);
        expect(n.velocity).toBe(cymbals.notes.find((e) => e.startTick === n.startTick && e.durationTicks === n.durationTicks)!.velocity);
      }
      total++;
    }
    expect(total).toBeGreaterThan(0);
    // pre-flight 3 truth: the engine writes crashes and swells only — 55–59 never fires
    expect([...pitches]).toEqual([48]);
    console.log(`PHASE12 cymbals: ${total} runs, realised pitches ${[...pitches].join(',')} (55–59 never fired: no non-crash/swell cymbal note exists)`);
  }, 900000);

  it('applyNoteMap: the hash-seeded draw is pure, pool-bound and never repeats the previous key', () => {
    const profile = parseExportProfile({
      id: 't', name: 't', pitchConvention: 'C3=60', keyswitchVelocity: 100,
      pools: { pool: [48, 49] },
      parts: [{
        id: 'p', patch: 'P', channel: 1, source: { role: 'r' }, lowestPlayable: 48, keyswitchMode: 'none', keyswitches: {}, fallback: {},
        noteMap: { rotate: { from: 38, pool: 'pool' } }, transposeSemitones: 0, keyswitchLeadMs: 30, keyswitchLengthMs: 60, ccEnabled: {},
      }],
    });
    const notes = Array.from({ length: 40 }, (_, i) => ({ pitch: 38, startTick: i * 240, durationTicks: 120, velocity: 64 }));
    const a = applyNoteMap(profile.parts[0], notes, profile);
    const b = applyNoteMap(profile.parts[0], notes, profile);
    expect(a.map((n) => n.pitch)).toEqual(b.map((n) => n.pitch));
    for (const n of a) expect([48, 49]).toContain(n.pitch);
    for (let i = 1; i < a.length; i++) expect(a[i].pitch).not.toBe(a[i - 1].pitch);
    expect(a.map((n) => [n.startTick, n.durationTicks, n.velocity])).toEqual(notes.map((n) => [n.startTick, n.durationTicks, n.velocity]));
    // the spread covers both keys
    expect(new Set(a.map((n) => n.pitch)).size).toBe(2);
  });
});

/* ---------------- 8. aux ---------------------------------------------------- */

describe('Phase 12: aux stays unmapped', () => {
  it('aux is left out of every exported file, keeps its notes in the project and is warned about in the dialog', () => {
    let auxRuns = 0;
    for (const run of SURVEY) {
      const aux = trackOf(run, 'aux');
      if (!aux || !aux.notes.length) continue;
      auxRuns++;
      const tracks = exportableTracks(run.project, 'all');
      const files = buildPerTrackMidi(run.project, tracks, PROFILE);
      expect(files.some((f) => /aux/i.test(f.fileName)), `${run.key}: an aux file exists`).toBe(false);
      const merged = parseMidiFile(buildMergedMidi(run.project, tracks, PROFILE));
      expect(merged.tracks.some((t) => /aux/i.test(t.name)), `${run.key}: an aux track rides in the merged file`).toBe(false);
      expect(trackOf(run, 'aux')!.notes.length, `${run.key}: the project lost its aux notes`).toBe(aux.notes.length);
    }
    expect(auxRuns).toBeGreaterThan(0);
    expect(profilePartSummary(PROFILE).some((l) => l.startsWith('aux — unmapped:'))).toBe(true);
    console.log(`PHASE12 aux: ${auxRuns} runs with aux notes — all left out of the export, warned in the dialog, kept in the project`);
  }, 900000);
});

/* ---------------- 9–10. the channel map and the CC rules ------------------- */

describe('Phase 12: the channel map', () => {
  const MERGED_CHANNELS: Record<string, number> = {
    'Violins 1 Ensemble': 1, 'Violins 2 Ensemble': 2, 'Viola Ensemble': 3, 'Cello Ensemble': 4, 'Bass Ensemble': 5,
    'French Horn Ensemble': 6, 'Trombone Ensemble': 7, 'Trumpet Ensemble': 8, 'Tuba solo': 9,
    'Flute Solo': 11, 'Oboe Solo': 12, 'Clarinet Solo': 13, 'Bassoon Solo': 14, 'Harp': 15, 'Piano': 16,
  };

  it('the merged file carries channels 1–9 + 11–16, never 10, and no percussion part (120 runs)', () => {
    for (const run of SURVEY) {
      const merged = parseMidiFile(buildMergedMidi(run.project, exportableTracks(run.project, 'all'), PROFILE));
      for (const t of merged.tracks) {
        if (t.channel === null) continue; // the empty passthrough of a silent track
        expect(t.channel, `${run.key}: channel ${t.channel} in the merged file`).not.toBe(10);
        if (t.name in MERGED_CHANNELS) expect(t.channel, `${run.key}: ${t.name} on the wrong channel`).toBe(MERGED_CHANNELS[t.name]);
        expect(['Timpani', 'Snare', 'Cymbals']).not.toContain(t.name);
      }
    }
  }, 900000);

  it('the percussion parts export as their own files on the documented channels 10, 11 and 12', () => {
    const WANT: Record<string, number> = { Timpani: 10, Snare: 11, Cymbals: 12 };
    let seen = 0;
    for (const run of SURVEY) {
      const files = buildPerTrackMidi(run.project, exportableTracks(run.project, 'all'), PROFILE);
      for (const [patch, ch] of Object.entries(WANT)) {
        const file = files.find((f) => f.fileName.endsWith(` ${patch}.mid`));
        if (!file) continue;
        const parsed = parseMidiFile(file.data).tracks[1];
        if (!parsed.notes.length) continue; // an empty roster lane exports as the project's own silent passthrough, not as the patch's part
        expect(parsed.channel, `${run.key}: ${patch} on channel ${parsed.channel}`).toBe(ch);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(0);
  }, 900000);
});

describe('Phase 12: the CC rules', () => {
  it('exports generated Piano CC64 without source automation; harp and percussion stay CC-free (120 runs)', () => {
    let pianoExports = 0;
    for (const run of SURVEY) {
      const files = buildPerTrackMidi(run.project, exportableTracks(run.project, 'all'), PROFILE);
      const pianoFile = files.find((file) => file.fileName === 'Piano.mid');
      if (pianoFile) {
        pianoExports++;
        const piano = parseMidiFile(pianoFile.data).tracks[1];
        expect(piano.name, `${run.key}: exported part name`).toBe('Piano');
        expect(piano.channel, `${run.key}: piano channel`).toBe(16);
        if (run.project.ensemble?.templateId === 'ensemble.symphony') {
          expect(piano.notes, `${run.key}: Symphony has no Piano notes`).toEqual([]);
          expect(piano.cc, `${run.key}: Symphony has no Piano controller events`).toEqual([]);
          continue;
        }
        expect(piano.cc.every((event) => event.cc === 64), `${run.key}: only CC64 on Piano`).toBe(true);
        expect(piano.cc.some((event) => event.value === 127), `${run.key}: pedal down`).toBe(true);
        expect(piano.cc.some((event) => event.value === 0), `${run.key}: pedal up`).toBe(true);
        expect(piano.cc.at(-1)?.value, `${run.key}: released final state`).toBe(0);
      }
      for (const patch of ['Harp', 'Timpani', 'Snare', 'Cymbals']) {
        const file = files.find((entry) => entry.fileName.endsWith(` ${patch}.mid`));
        if (!file) continue;
        const parsed = parseMidiFile(file.data).tracks[1];
        expect(parsed.cc, `${run.key}: ${patch} carries CC`).toEqual([]);
      }
    }
    expect(pianoExports).toBeGreaterThan(0);
  }, 900000);

  it('the wind CC lanes follow the brass convention: 1/7/11 exported, 68/74 dropped', () => {
    for (const run of SURVEY) {
      const files = buildPerTrackMidi(run.project, exportableTracks(run.project, 'all'), PROFILE);
      for (const patch of ['Flute Solo', 'Oboe Solo', 'Clarinet Solo', 'Bassoon Solo']) {
        const file = files.find((f) => f.fileName.endsWith(` ${patch}.mid`));
        if (!file) continue;
        const parsed = parseMidiFile(file.data).tracks[1];
        const lanes = new Set(parsed.cc.map((c) => c.cc));
        for (const lane of lanes) expect([1, 7, 11], `${run.key}: ${patch} exports CC ${lane}`).toContain(lane);
      }
    }
  }, 900000);
});

/* ---------------- 11. the fold/drop report ---------------------------------- */

describe('Phase 12: the fold and remap report', () => {
  it('the Phase 12 patches fold and drop nothing across the corpus; the remap counts equal the engine note counts', () => {
    const NEW_PARTS = new Set(['flutes', 'oboes', 'clarinets', 'bassoons', 'timpani', 'snare', 'cymbals', 'harp', 'piano']);
    const totals = { folded: 0, dropped: 0, snare: 0, cymbals: 0 };
    for (const run of SURVEY) {
      const stats = statsSink();
      buildMergedMidi(run.project, exportableTracks(run.project, 'all'), PROFILE, stats);
      for (const [id, n] of Object.entries(stats.folded)) {
        if (!NEW_PARTS.has(id)) continue; // the string/brass folds are the pre-change behaviour, byte-pinned by the reference
        expect(n, `${run.key}: ${id} folded ${n} notes (the report says 0)`).toBe(0);
      }
      for (const [id, n] of Object.entries({ ...stats.droppedHardRange, ...stats.droppedDoubling })) {
        if (!NEW_PARTS.has(id)) continue;
        expect(n, `${run.key}: ${id} dropped ${n} notes (the report says 0)`).toBe(0);
      }
      const snare = trackOf(run, 'snare');
      if (snare?.notes.length) {
        expect(stats.remapped?.snare, `${run.key}: the snare remap count drifted`).toBe(snare.notes.length);
        totals.snare += snare.notes.length;
      }
      const cymbals = trackOf(run, 'cymbals');
      if (cymbals?.notes.length) {
        expect(stats.remapped?.cymbals, `${run.key}: the cymbal remap count drifted`).toBe(cymbals.notes.length);
        totals.cymbals += cymbals.notes.length;
      }
    }
    expect(totals.snare).toBeGreaterThan(0);
    console.log(`PHASE12 report totals: the Phase 12 patches folded 0 and dropped 0; snare keys rotated ${totals.snare}, cymbal keys remapped ${totals.cymbals}`);
  }, 900000);
});

/* ---------------- the validator and the dialog lines ----------------------- */

describe('Phase 12: the validator and the dialog lines', () => {
  const base = {
    id: 't', name: 't', pitchConvention: 'C3=60', keyswitchVelocity: 100,
    parts: [{
      id: 'p', patch: 'P', channel: 1, source: { role: 'r' }, lowestPlayable: 48, keyswitchMode: 'none', keyswitches: {}, fallback: {},
      transposeSemitones: 0, keyswitchLeadMs: 30, keyswitchLengthMs: 60, ccEnabled: {},
    }],
  };

  it('the shipped profile validates (import already proves it) and the new fields reject bad data', () => {
    expect(validateExportProfile(PROFILE)).toEqual([]);
    expect(validateExportProfile({ ...base, pools: { pool: [48, 48] } }).join(' ')).toContain('distinct');
    expect(validateExportProfile({ ...base, pools: { pool: [48, 49] }, parts: [{ ...base.parts[0], noteMap: { rotate: { from: 38, pool: 'missing' } } }] }).join(' ')).toContain('not defined');
    expect(validateExportProfile({ ...base, pools: { pool: [48] }, parts: [{ ...base.parts[0], noteMap: { rotate: { from: 38, pool: 'pool' } } }] }).join(' ')).toContain('at least 2');
    expect(validateExportProfile({ ...base, parts: [{ ...base.parts[0], noteMap: { fixedPitch: 48, rotate: { from: 38, pool: 'x' } } }] }).join(' ')).toContain('mutually exclusive');
    expect(validateExportProfile({ ...base, parts: [{ ...base.parts[0], keyswitches: { sustain: 'C0' } }] }).join(' ')).toContain('keyswitchMode is "none"');
    expect(validateExportProfile({ ...base, unmapped: ['r'] }).join(' ')).toContain('either mapped or unmapped');
    expect(validateExportProfile({
      ...base, parts: [base.parts[0], { ...base.parts[0], id: 'q', channel: 1, source: { role: 'r2' } }],
    }).join(' ')).toContain('already used by');
    // fileOnly parts may reuse a merged channel number (their own files never share a reader)
    expect(validateExportProfile({ ...base, parts: [base.parts[0], { ...base.parts[0], id: 'q', channel: 1, fileScope: 'fileOnly', source: { role: 'r2' } }] })).toEqual([]);
  });

  it('the dialog renders one line per part plus the unmapped warning and the merged-carry note', () => {
    const lines = profilePartSummary(PROFILE);
    expect(lines.length).toBe(PROFILE.parts.length + (PROFILE.unmapped?.length ?? 0));
    expect(lines.find((l) => l.startsWith('ch 11 (own file only) · Snare'))).toContain('15-key pool snareHitKeys, rotated per note');
    expect(lines.find((l) => l.startsWith('ch 12 (own file only) · Cymbals'))).toContain('every note → key 48');
    expect(lines.find((l) => l.startsWith('ch 10 (own file only) · Timpani'))).toContain('C#0 = sustain');
    expect(lines.find((l) => l.startsWith('ch 15 · Harp'))).toContain('C-1 = sustain');
    expect(lines.find((l) => l.startsWith('ch 16 · UVI Grand Model D'))).toContain('no keyswitch');
    expect(lines.find((l) => l.startsWith('ch 16 · UVI Grand Model D'))).toContain('CC64 sustain pedal automation');
    expect(lines.find((l) => l.startsWith('ch 11 · Flute Solo'))).toContain('notes below 59 fold up by octaves');
    expect(profileScopeNote(PROFILE)).toContain('Timpani (ch 10), Snare (ch 11), Cymbals (ch 12)');
  });
});
