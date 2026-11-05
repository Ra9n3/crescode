import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import fixture from '../fixtures/dorian-16bars.json';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { buildMergedMidi, buildPerTrackMidi, exportableTracks, parseMidiFile } from '../src/export/midi';
import { EXPORT_PROFILES } from '../src/export/profiles';
import {
  chunksForTrack, keyNameToMidi, midiToKeyName, mergeTremoloGroups,
  parseExportProfile, parsePitchConvention, resolveArticulationKeyFor, validateExportProfile,
  type ExportProfile,
} from '../src/export/profile';
import { overlapLegato } from '../src/orchestrator/expression/legato';
import { humanizeStrings } from '../src/orchestrator/expression/humanize';
import { sanitizeNotes } from '../src/engine/generate';
import { msToTicks, sectionMap, ticksToMs } from '../src/orchestrator/spine';
import { projectFromFixture, validateProject, type Note, type Project } from '../src/shared/schema';

/**
 * Phase 5.5 — export profile: UVI Orchestral Suite string ensembles. The
 * profile is DATA (src/export/profiles/uvi-orchestral-suite.json); the code
 * is generic machinery. Pins here: the pitch convention both ways, the
 * keyswitch emission rules (only on change, always ahead, project never
 * touched), the fallback chains, the layer:'cb' routing (cello vs bass
 * part), transposition, the sampled-tremolo merge, ccEnabled, the
 * no-profile byte identity (golden files), and the validator's rejections.
 */
const PROFILE = EXPORT_PROFILES[0].profile;
/** The shipped profile ships with cbLayer 'omit' (Phase 6 item 0); the 5.5
 *  bass-routing behaviour lives on under cbLayer 'separate'. */
const PROFILE_SEP: ExportProfile = { ...JSON.parse(JSON.stringify(PROFILE)), cbLayer: 'separate' };
const CONV = 'C3=60';
const BASE = (): Project => projectFromFixture(JSON.parse(JSON.stringify(fixture)));
const THREE = (): Project => projectFromFixture(JSON.parse(JSON.stringify(threeChorus)));

const composeTake = (project: Project, templateId: string, take: number) => {
  project.ensemble = { templateId, overrides: {}, pins: {} };
  project.orchestration = { take };
  const result = composeAllTracks(project, { seed: 11, moments: false });
  return { project: { ...project, tracks: result.tracks, orchestration: result.orchestration } as Project, result };
};

const instTracks = (p: Project) => exportableTracks(p, 'all');
const trackOf = (p: Project, role: string) => p.tracks.find((t) => t.role === role)!;
const partChunk = (p: Project, tracks: ReturnType<typeof instTracks>, partId: string, profile: ExportProfile = PROFILE_SEP) =>
  tracks.flatMap((t) => chunksForTrack(p, t, profile)).filter((c) => c.name === profile.parts.find((x) => x.id === partId)!.patch);

/* ---------------- convention ---------------- */
describe('pitch convention (C3=60)', () => {
  it('converts key names to midi both ways: C0=24, C-1=12, C3=60', () => {
    expect(keyNameToMidi('C0', CONV)).toBe(24);
    expect(keyNameToMidi('C-1', CONV)).toBe(12);
    expect(keyNameToMidi('C3', CONV)).toBe(60);
    expect(keyNameToMidi('C#1', CONV)).toBe(37);
    expect(keyNameToMidi('E-1', CONV)).toBe(16);
    expect(keyNameToMidi('F-1', CONV)).toBe(17);
    expect(keyNameToMidi('G-1', CONV)).toBe(19);
    expect(keyNameToMidi('A-1', CONV)).toBe(21);
    expect(keyNameToMidi('D0', CONV)).toBe(26);
    expect(keyNameToMidi('F0', CONV)).toBe(29);
    expect(keyNameToMidi('G0', CONV)).toBe(31);
    expect(keyNameToMidi('D1', CONV)).toBe(38);
    expect(keyNameToMidi('G1', CONV)).toBe(43);
    expect(keyNameToMidi('D2', CONV)).toBe(50);
    expect(midiToKeyName(24, CONV)).toBe('C0');
    expect(midiToKeyName(12, CONV)).toBe('C-1');
    expect(midiToKeyName(60, CONV)).toBe('C3');
    expect(midiToKeyName(37, CONV)).toBe('C#1');
    for (let m = 0; m <= 127; m++) expect(keyNameToMidi(midiToKeyName(m, CONV), CONV)).toBe(m); // round trip
  });
  it('rejects garbage conventions and names', () => {
    expect(parsePitchConvention('C3')).toBeNull();
    expect(parsePitchConvention('nonsense')).toBeNull();
    expect(keyNameToMidi('H4', CONV)).toBeNull();
    expect(keyNameToMidi('C', CONV)).toBeNull();
  });
});

/* ---------------- validator ---------------- */
describe('profile validator', () => {
  it('the shipped profile validates clean (raw doc and parsed shape)', () => {
    expect(validateExportProfile(uviDoc())).toEqual([]);
    expect(validateExportProfile(EXPORT_PROFILES[0].profile)).toEqual([]);
  });
  it('rejects a keyswitch inside the playable range', () => {
    const doc = JSON.parse(JSON.stringify(uviDoc()));
    (doc.parts[0].keyswitches as Record<string, string>).sustain = 'C5'; // C5 under C3=60 = 84 ≥ 55
    const errors = validateExportProfile(doc);
    expect(errors.some((e) => e.includes('parts[0].keyswitches.sustain') && e.includes('playable range'))).toBe(true);
  });
  it('rejects unknown articulations, duplicate channels and unresolvable chains', () => {
    const doc = JSON.parse(JSON.stringify(uviDoc()));
    doc.parts[0].keyswitches.bogus = 'C0';
    doc.parts[1].channel = 1;
    delete doc.parts[2].keyswitches.sustain;
    const errors = validateExportProfile(doc);
    expect(errors.some((e) => e.includes('keyswitches.bogus') && e.includes('unknown articulation'))).toBe(true);
    expect(errors.some((e) => e.includes('parts[1].channel') && e.includes('already used'))).toBe(true);
    expect(errors.some((e) => e.includes('parts[2]') && e.includes('does not resolve'))).toBe(true);
  });
  it('keeps the UNVERIFIED markers: two spiccatos, cello marcato, bass transpose — pitchConvention confirmed', () => {
    const doc = uviDoc() as { unverified: string[] };
    expect(doc.unverified).toEqual([
      'parts[1].keyswitches.spiccato (D2, read from a small manual image)',
      'parts[2].keyswitches.spiccato (C#1, read from a small manual image)',
      'parts[3].keyswitches.marcato (A-1, read from a small manual image)',
      'parts[4].transposeSemitones (default 0)',
    ]);
  });
});

/** The raw shipped JSON document (validator input shape). */
function uviDoc(): unknown {
  // re-parse from disk so the validator sees the DOC, not the parsed profile
  return JSON.parse(readFileSync(new URL('./../src/export/profiles/uvi-orchestral-suite.json', import.meta.url), 'utf8'));
}

/* ---------------- fallback chains ---------------- */
describe('fallback chains', () => {
  const cello = PROFILE.parts.find((p) => p.id === 'cello')!;
  const bass = PROFILE.parts.find((p) => p.id === 'bass')!;
  const v1 = PROFILE.parts.find((p) => p.id === 'violins1')!;
  it('cello pizz → E-1 (Pizzicato Snap)', () => {
    expect(resolveArticulationKeyFor(cello, 'pizz', CONV)).toBe(16);
  });
  it('cello + bass staccato/spiccato → marcato (A-1); violins staccato falls to sustain', () => {
    expect(resolveArticulationKeyFor(cello, 'spiccato', CONV)).toBe(keyNameToMidi('A-1', CONV));
    expect(resolveArticulationKeyFor(cello, 'staccato', CONV)).toBe(keyNameToMidi('A-1', CONV));
    expect(resolveArticulationKeyFor(bass, 'spiccato', CONV)).toBe(keyNameToMidi('A-1', CONV));
    expect(resolveArticulationKeyFor(v1, 'staccato', CONV)).toBe(keyNameToMidi('C0', CONV));
  });
  it('detache/portato/sulTasto/sulPont/conSord → sustain; legato → Sustain Smooth', () => {
    for (const art of ['detache', 'portato', 'sulTasto', 'sulPont', 'conSord']) {
      expect(resolveArticulationKeyFor(v1, art, CONV)).toBe(keyNameToMidi('C0', CONV));
    }
    expect(resolveArticulationKeyFor(v1, 'legato', CONV)).toBe(keyNameToMidi('D0', CONV));
    expect(resolveArticulationKeyFor(cello, 'legato', CONV)).toBe(keyNameToMidi('D-1', CONV));
  });
  it('undefined articulation reads sustain; measured tremolo skips the tremolo key', () => {
    expect(resolveArticulationKeyFor(v1, 'sustain', CONV)).toBe(keyNameToMidi('C0', CONV));
    const measured: ExportProfile = JSON.parse(JSON.stringify(PROFILE));
    const p = measured.parts.find((x) => x.id === 'violins1')!;
    p.tremoloMode = 'measured';
    p.fallback.tremolo = ['marcato'];
    expect(resolveArticulationKeyFor(p, 'tremolo', CONV)).toBe(keyNameToMidi('A0', CONV));
    expect(validateExportProfile(measured)).toEqual([]);
  });
});

/* ---------------- layer:'cb' routing + keyswitches on a real export ---------------- */
describe('profile export (dorian, cinematic take 1)', () => {
  const { project } = composeTake(BASE(), 'ensemble.cinematic', 1);
  const tracks = instTracks(project);
  const beforeJson = JSON.stringify(project);

  it('no-profile export is byte-identical to the golden capture', () => {
    const goldenDir = new URL('./golden/', import.meta.url);
    const merged = buildMergedMidi(project, tracks);
    expect(Buffer.compare(Buffer.from(merged), readFileSync(new URL('dorian-cinematic-merged.mid', goldenDir)))).toBe(0);
    for (const f of buildPerTrackMidi(project, tracks)) {
      expect(Buffer.compare(Buffer.from(f.data), readFileSync(new URL(`dorian-cinematic-per-${f.fileName}`, goldenDir)))).toBe(0);
    }
  });

  it('the export never touches the project; validateProject still passes', () => {
    buildMergedMidi(project, tracks, PROFILE);
    buildPerTrackMidi(project, tracks, PROFILE);
    expect(JSON.stringify(project)).toBe(beforeJson);
    expect(validateProject(JSON.parse(JSON.stringify(project))).ok).toBe(true);
    const cb = trackOf(project, 'cellosBasses');
    expect(cb.notes.some((n) => n.layer === 'cb')).toBe(true);
  });

  it('layer cb routes to Bass (ch5), unmarked cellosBasses notes route to Cello (ch4); parts on channels 1–5', () => {
    const cb = trackOf(project, 'cellosBasses');
    const cbLayer = cb.notes.filter((n) => n.layer === 'cb');
    const cbRest = cb.notes.filter((n) => n.layer !== 'cb');
    expect(cbLayer.length).toBeGreaterThan(0);
    const cello = partChunk(project, tracks, 'cello');
    const bass = partChunk(project, tracks, 'bass');
    expect(cello).toHaveLength(1);
    expect(bass).toHaveLength(1);
    // every layer note lands in the bass part, every unmarked note in the cello part
    const bassNotes = bass[0].notes.filter((n) => n.pitch >= 28);
    const celloNotes = cello[0].notes.filter((n) => n.pitch >= 28);
    expect(bassNotes.length).toBe(cbLayer.length);
    expect(celloNotes.length).toBe(cbRest.length);
    expect(bass[0].channel).toBe(5);
    expect(cello[0].channel).toBe(4);
    for (const [i, part] of PROFILE_SEP.parts.entries()) {
      const chunk = partChunk(project, tracks, part.id)[0];
      expect(chunk.channel).toBe(i + 1);
    }
  });

  it('keyswitches: velocity 100, only on change, always ahead of the note, ending before it starts', () => {
    for (const part of PROFILE_SEP.parts) {
      const chunk = partChunk(project, tracks, part.id)[0];
      const ks = chunk.notes.filter((n) => n.pitch < part.lowestPlayable);
      const playing = chunk.notes.filter((n) => n.pitch >= part.lowestPlayable);
      // recompute the expected keyswitch sequence from the playing notes
      const expected: { key: number; start: number; trigger: Note }[] = [];
      let current: number | null = null;
      for (const n of [...playing].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch)) {
        const key = resolveArticulationKeyFor(part, n.articulation ?? 'sustain', CONV);
        if (key === null || (current !== null && current === key)) continue;
        const baseMs = ticksToMs(n.startTick, project.tempoMap);
        const leadTicks = Math.max(1, Math.round(msToTicks(baseMs + 30, project.tempoMap) - msToTicks(baseMs, project.tempoMap)));
        expected.push({ key, start: Math.max(0, n.startTick - leadTicks), trigger: n });
        current = key;
      }
      expect(ks.map((k) => k.pitch)).toEqual(expected.map((e) => e.key));
      expect(ks.map((k) => k.startTick)).toEqual(expected.map((e) => e.start));
      for (const e of expected) {
        const k = ks.find((x) => x.pitch === e.key && x.startTick === e.start)!;
        expect(k.velocity).toBe(PROFILE_SEP.keyswitchVelocity);
        if (e.trigger.startTick > 0) expect(k.startTick).toBeLessThan(e.trigger.startTick); // always ahead
        expect(k.startTick + k.durationTicks).toBeLessThanOrEqual(e.trigger.startTick); // ends before it starts
      }
    }
  });

  it('the keyswitch lead rides the tempo map (30 ms before the note, at any tempo)', () => {
    const p: Project = JSON.parse(JSON.stringify(project));
    p.tempoMap = [{ tick: 0, bpm: 100 }, { tick: 4 * 3840, bpm: 180 }]; // double-time from bar 5
    const v1 = trackOf(p, 'violins1');
    const chunk = chunksForTrack(p, v1, PROFILE)[0];
    const ks = chunk.notes.filter((n) => n.pitch < PROFILE.parts[0].lowestPlayable);
    for (const k of ks) {
      const trigger = chunk.notes.filter((n) => n.pitch >= PROFILE.parts[0].lowestPlayable && n.startTick >= k.startTick)
        .sort((a, b) => a.startTick - b.startTick)[0];
      const expectedLead = msToTicks(ticksToMs(trigger.startTick, p.tempoMap) + 30, p.tempoMap) - msToTicks(ticksToMs(trigger.startTick, p.tempoMap), p.tempoMap);
      expect(k.startTick).toBe(Math.max(0, trigger.startTick - Math.round(expectedLead)));
    }
    expect(ks.length).toBeGreaterThan(0);
    // the same 30 ms really does land on different tick counts on both sides of the tempo change
    const before = ks.filter((k) => k.startTick < 4 * 3840);
    const after = ks.filter((k) => k.startTick >= 4 * 3840);
    expect(before.length + after.length).toBe(ks.length);
  });

  it('round-trip parse shows the keyswitches, the CC lanes and one channel per part', () => {
    const parsed = parseMidiFile(buildMergedMidi(project, tracks, PROFILE_SEP));
    const byName = Object.fromEntries(parsed.tracks.map((t) => [t.name, t]));
    for (const part of PROFILE_SEP.parts) {
      const t = byName[part.patch];
      expect(t).toBeTruthy();
      expect(t.channel).toBe(part.channel);
      expect(t.notes.some((n) => n.pitch < part.lowestPlayable && n.velocity === PROFILE.keyswitchVelocity)).toBe(true);
    }
    expect(byName['Violins 1 Ensemble'].cc.length).toBeGreaterThan(0);
    expect(byName['Cello Ensemble'].cc.some((c) => c.cc === 7 && c.tick === 0 && c.value === 90)).toBe(true);
  });

  it('per-part files: the cellosBasses track splits into two files, one per part', () => {
    const files = buildPerTrackMidi(project, tracks, PROFILE_SEP);
    const names = files.map((f) => f.fileName);
    expect(names.filter((n) => n.includes('Cello Ensemble') || n.includes('Bass Ensemble'))).toEqual([
      expect.stringContaining('Cello Ensemble'),
      expect.stringContaining('Bass Ensemble'),
    ]);
    expect(new Set(names).size).toBe(names.length); // no name collisions
  });
});

/* ---------------- ccEnabled, transpose, tremolo modes ---------------- */
describe('profile options', () => {
  const { project } = composeTake(THREE(), 'ensemble.cinematic', 1);
  const tracks = instTracks(project);

  it('ccEnabled is respected: 68/74 off by default, CC7 stays a single point at tick 0 (90)', () => {
    const merged = parseMidiFile(buildMergedMidi(project, tracks, PROFILE));
    const v1 = merged.tracks.find((t) => t.name === 'Violins 1 Ensemble')!;
    const ccs = new Set(v1.cc.map((c) => c.cc));
    expect(ccs.has(1)).toBe(true);
    expect(ccs.has(7)).toBe(true);
    expect(ccs.has(11)).toBe(true);
    expect(ccs.has(68)).toBe(false);
    expect(ccs.has(74)).toBe(false);
    expect(v1.cc.filter((c) => c.cc === 7)).toHaveLength(1);
    expect(v1.cc.find((c) => c.cc === 7)).toMatchObject({ tick: 0, value: 90 });
  });
  it('enabling 68/74 in the profile writes those lanes', () => {
    const p: ExportProfile = JSON.parse(JSON.stringify(PROFILE));
    p.parts[0].ccEnabled = { '1': true, '7': true, '11': true, '68': true, '74': true };
    const chunk = chunksForTrack(project, trackOf(project, 'violins1'), p)[0];
    const ccs = new Set(chunk.cc!.map((l) => l.cc));
    expect(ccs.has(68)).toBe(true);
    expect(ccs.has(74)).toBe(true);
    expect(validateExportProfile(p)).toEqual([]);
  });
  it('transposeSemitones is applied per part, in the export only', () => {
    const p: ExportProfile = JSON.parse(JSON.stringify(PROFILE));
    p.parts[0].transposeSemitones = 12; // violins part up an octave
    p.parts[0].tremoloMode = 'measured'; // no merge: 1:1 with the written notes
    const v1 = trackOf(project, 'violins1');
    expect(v1.notes.length).toBeGreaterThan(0);
    const chunk = chunksForTrack(project, v1, p)[0];
    // playing notes (≥ the original floor 55) are all +12; the keyswitches sit below 55 untouched
    const playing = chunk.notes.filter((n) => n.pitch >= 55);
    expect(playing.length).toBe(v1.notes.length);
    expect(playing.map((n) => n.pitch).sort((a, b) => a - b)).toEqual(v1.notes.map((n) => Math.min(127, n.pitch + 12)).sort((a, b) => a - b));
    expect(playing.every((n) => n.pitch >= 67)).toBe(true); // the shift really moved everything
    expect(validateExportProfile(p)).toEqual([]);
  });

  it('tremolo sampled merges the repeats; measured keeps them and skips the tremolo key', () => {
    const trem = trackOf(project, 'violins1').notes.filter((n) => n.articulation === 'tremolo');
    expect(trem.length).toBeGreaterThan(50); // the cinematic measured repeats exist on this take
    // sampled (the shipped profile): the repeats collapse into groups
    const sampled = chunksForTrack(project, trackOf(project, 'violins1'), PROFILE)[0];
    const sampledTrem = sampled.notes.filter((n) => n.pitch >= 55 && n.durationTicks > 240);
    expect(sampledTrem.length).toBeGreaterThan(0);
    // every merged group spans first start → last end and nothing self-overlaps
    expect(sampled.notes.filter((n) => n.pitch >= 55).length).toBeLessThan(
      trackOf(project, 'violins1').notes.filter((n) => n.pitch >= 55).length,
    );
    // the group merge itself, pinned on synthetic repeats
    const groups = mergeTremoloGroups([
      { pitch: 60, startTick: 0, durationTicks: 240, velocity: 80, articulation: 'tremolo' },
      { pitch: 60, startTick: 240, durationTicks: 240, velocity: 80, articulation: 'tremolo' },
      { pitch: 60, startTick: 480, durationTicks: 240, velocity: 80, articulation: 'tremolo' },
      { pitch: 62, startTick: 720, durationTicks: 240, velocity: 80, articulation: 'tremolo' },
    ]);
    expect(groups).toEqual([
      { pitch: 60, startTick: 0, durationTicks: 720, velocity: 80 },
      { pitch: 62, startTick: 720, durationTicks: 240, velocity: 80, articulation: 'tremolo' },
    ]);
    // measured: repeats stay, and they resolve to marcato, not the tremolo key
    const measured: ExportProfile = JSON.parse(JSON.stringify(PROFILE));
    const p0 = measured.parts.find((x) => x.id === 'violins1')!;
    p0.tremoloMode = 'measured';
    p0.fallback.tremolo = ['marcato'];
    const chunk = chunksForTrack(project, trackOf(project, 'violins1'), measured)[0];
    const ks = chunk.notes.filter((n) => n.pitch < p0.lowestPlayable);
    expect(chunk.notes.filter((n) => n.pitch >= 55).length).toBe(trackOf(project, 'violins1').notes.filter((n) => n.pitch >= 55).length);
    expect(ks.some((n) => n.pitch === keyNameToMidi('G0', CONV))).toBe(false);
    expect(ks.some((n) => n.pitch === keyNameToMidi('A0', CONV))).toBe(true);
  });
});

/* ---------------- cbLayer: omit (Phase 6 item 0) ---------------- */
describe('cbLayer omit (default): no Bass part, no Cb-layer notes in the export', () => {
  const { project } = composeTake(BASE(), 'ensemble.cinematic', 1);
  const tracks = instTracks(project);
  const beforeJson = JSON.stringify(project);

  it('the shipped profile (omit) creates no Bass chunk and drops the cb notes everywhere', () => {
    const cb = trackOf(project, 'cellosBasses');
    expect(cb.notes.filter((n) => n.layer === 'cb').length).toBeGreaterThan(0);
    const chunks = chunksForTrack(project, cb, PROFILE);
    expect(chunks.map((c) => c.name)).toEqual(['Cello Ensemble']); // no Bass Ensemble chunk
    expect(chunks[0].notes.some((n) => n.layer === 'cb')).toBe(false);
    // every exported cello note is an unmarked note; the layer notes are gone entirely
    expect(chunks[0].notes.filter((n) => n.pitch >= 28).length).toBe(cb.notes.filter((n) => n.layer !== 'cb').length);
    expect(chunks[0].channel).toBe(4);
  });

  it('merged + per-part outputs have no Bass Ensemble track/file', () => {
    const merged = parseMidiFile(buildMergedMidi(project, tracks, PROFILE));
    expect(merged.tracks.some((t) => t.name === 'Bass Ensemble')).toBe(false);
    expect(merged.tracks.some((t) => t.name === 'Cello Ensemble')).toBe(true);
    const names = buildPerTrackMidi(project, tracks, PROFILE).map((f) => f.fileName);
    expect(names.some((n) => n.includes('Bass Ensemble'))).toBe(false);
    expect(new Set(names).size).toBe(names.length);
  });

  it('a profile document without cbLayer defaults to omit; the validator stays clean', () => {
    const noFlag = JSON.parse(JSON.stringify(uviDoc())) as Record<string, unknown>;
    delete noFlag.cbLayer;
    expect(validateExportProfile(noFlag)).toEqual([]);
    const parsed = parseExportProfile(noFlag);
    expect(parsed.cbLayer).toBe('omit');
    const chunks = chunksForTrack(project, trackOf(project, 'cellosBasses'), parsed);
    expect(chunks.map((c) => c.name)).toEqual(['Cello Ensemble']);
  });

  it('the validator rejects a bad cbLayer; the export still never touches the project', () => {
    const bad = JSON.parse(JSON.stringify(uviDoc())) as Record<string, unknown>;
    bad.cbLayer = 'split';
    expect(validateExportProfile(bad).some((e) => e.includes('cbLayer'))).toBe(true);
    buildMergedMidi(project, tracks, PROFILE);
    buildPerTrackMidi(project, tracks, PROFILE);
    expect(JSON.stringify(project)).toBe(beforeJson);
  });

  it('the no-profile export stays byte-identical to the golden capture', () => {
    const goldenDir = new URL('./golden/', import.meta.url);
    const merged = buildMergedMidi(project, tracks);
    expect(Buffer.compare(Buffer.from(merged), readFileSync(new URL('dorian-cinematic-merged.mid', goldenDir)))).toBe(0);
  });
});

/* ---------------- profile-free / old-file discipline ---------------- */
describe('schema discipline', () => {
  it('sanitizeNotes, humanize and legato overlap preserve layer:cb', () => {
    const layered: Note[] = [
      { pitch: 40, startTick: 0, durationTicks: 960, velocity: 80, articulation: 'legato' },
      { pitch: 28, startTick: 0, durationTicks: 960, velocity: 80, articulation: 'legato', layer: 'cb' },
      { pitch: 41, startTick: 960, durationTicks: 960, velocity: 80, articulation: 'legato' },
      { pitch: 29, startTick: 962, durationTicks: 958, velocity: 80, articulation: 'legato', layer: 'cb' },
    ];
    const sanitized = sanitizeNotes(layered, 12, 96, 38400);
    expect(sanitized.filter((n) => n.layer === 'cb')).toHaveLength(2);
    const p = BASE();
    const cbId = trackOf(p, 'cellosBasses').id;
    const humanized = humanizeStrings({ project: p, template: null, sections: sectionMap(p), notesByTrackId: { [cbId]: layered } });
    expect(humanized[cbId].filter((n) => n.layer === 'cb')).toHaveLength(2);
    const overlapped = overlapLegato({ project: p, sections: sectionMap(p), notesByTrackId: { [cbId]: layered } });
    expect(overlapped[cbId].filter((n) => n.layer === 'cb')).toHaveLength(2);
  });
  it('old files (no layer field) load unchanged; validateProject rejects a bad layer value', () => {
    const { project } = composeTake(BASE(), 'ensemble.cinematic', 1);
    const stripped = JSON.parse(JSON.stringify(project));
    for (const t of stripped.tracks) for (const n of t.notes ?? []) delete n.layer;
    const v = validateProject(stripped);
    expect(v.ok).toBe(true);
    const bad = JSON.parse(JSON.stringify(project));
    const cbBad = bad.tracks.find((t: { role: string }) => t.role === 'cellosBasses');
    expect(cbBad.notes.length).toBeGreaterThan(0);
    cbBad.notes[0].layer = 'vla';
    expect(validateProject(bad).ok).toBe(false);
  });
  it('the export is deterministic: two builds give identical bytes', () => {
    const { project } = composeTake(THREE(), 'ensemble.symphony', 3);
    const tracks = instTracks(project);
    expect(Buffer.compare(Buffer.from(buildMergedMidi(project, tracks, PROFILE)), Buffer.from(buildMergedMidi(project, tracks, PROFILE)))).toBe(0);
    expect(Buffer.compare(Buffer.from(buildMergedMidi(project, tracks)), Buffer.from(buildMergedMidi(project, tracks)))).toBe(0);
  });
  it('a profile with no bass part (no cb notes) leaves the cello part carrying the whole track', () => {
    const { project } = composeTake(BASE(), 'ensemble.chamber', 1); // octaveDoubling climaxOnly → no cb layer
    const cb = trackOf(project, 'cellosBasses');
    expect(cb.notes.filter((n) => n.layer === 'cb')).toHaveLength(0);
    const chunks = chunksForTrack(project, cb, PROFILE);
    expect(chunks.map((c) => c.name)).toEqual(['Cello Ensemble']); // no Bass Ensemble chunk at all
    expect(chunks[0].notes.filter((n) => n.pitch >= 28).length).toBe(cb.notes.length);
  });
});
