import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { projectFromFixture, validateProject, type Note, type Project } from '../src/shared/schema';
import { buildMergedMidi, buildPerTrackMidi, exportableTracks, parseMidiFile } from '../src/export/midi';
import { EXPORT_PROFILES } from '../src/export/profiles';
import {
  chunksForTrack, keyNameToMidi, keyswitchNotesFor, midiToKeyName,
  parseExportProfile, resolveArticulationKeyFor, validateExportProfile,
  type ExportProfile, type ProfilePart,
} from '../src/export/profile';
import { msToTicks, ticksToMs } from '../src/orchestrator/spine';

/**
 * Phase 8.1 — the Falcon brass profile (a data job like 5.5). The four brass
 * parts join uvi-orchestral-suite.json on the channels after the strings,
 * with each patch's keyswitchZone (red zone) and playableLow; the validator
 * checks every keyswitch against both, and the export's red-zone guard drops
 * any non-keyswitch note below playableLow (it would trigger a keyswitch or
 * sit in a silent gap) — export only, the project is untouched. Pins here:
 * the key conversion, the emit-on-change rules, the fallback chains (marcato
 * → accent on the trumpets passes through a PATCH-SIDE keyswitch name), the
 * validator's accept/reject, the guard (crafted notes + a fully-dropped part),
 * the unique channels, the no-profile byte identity with the Phase 8 golden
 * capture, and a round-trip parse showing the brass keyswitches with their
 * 30 ms lead.
 */
const PROFILE = EXPORT_PROFILES[0].profile;
const CONV = 'C3=60';
const BRASS_IDS = ['horns', 'trombones', 'trumpets', 'tuba'] as const;
const partOf = (id: string): ProfilePart => PROFILE.parts.find((p) => p.id === id)!;

const composeTake = (doc: unknown, templateId: string, take: number, moments = true) => {
  const p: Project = projectFromFixture(JSON.parse(JSON.stringify(doc)));
  p.ensemble = { templateId, overrides: {}, pins: {} };
  p.orchestration = { take };
  const result = composeAllTracks(p, { seed: 11, moments });
  return { project: { ...p, tracks: result.tracks, orchestration: result.orchestration } as Project, result };
};

const instTracks = (p: Project) => exportableTracks(p, 'all');
const uviDoc = (): unknown => JSON.parse(readFileSync(new URL('./../src/export/profiles/uvi-orchestral-suite.json', import.meta.url), 'utf8'));

/* ---------------- 1. key conversion (the four new parts) ---------------- */
describe('brass key conversion (C3=60 → C0=24)', () => {
  it('converts every brass keyswitch name to its MIDI number', () => {
    const horns = partOf('horns');
    const trombones = partOf('trombones');
    const trumpets = partOf('trumpets');
    const tuba = partOf('tuba');
    expect(keyNameToMidi(horns.keyswitches.sustain, CONV)).toBe(24);
    expect(keyNameToMidi(horns.keyswitches.staccato, CONV)).toBe(25);
    expect(keyNameToMidi(trombones.keyswitches.sustain, CONV)).toBe(24);
    expect(keyNameToMidi(trombones.keyswitches.staccato, CONV)).toBe(25);
    expect(keyNameToMidi(trumpets.keyswitches.sustain, CONV)).toBe(48);
    expect(keyNameToMidi(trumpets.keyswitches.accent, CONV)).toBe(50);
    expect(keyNameToMidi(trumpets.keyswitches.staccato, CONV)).toBe(51);
    expect(keyNameToMidi(tuba.keyswitches.sustain, CONV)).toBe(24);
    expect(keyNameToMidi(tuba.keyswitches.staccato, CONV)).toBe(25);
  });

  it('converts the playable-from floors: B0=35, C1=36, G2=55, E0=28 — and round-trips both ways', () => {
    expect(keyNameToMidi('B0', CONV)).toBe(35);
    expect(keyNameToMidi('C1', CONV)).toBe(36);
    expect(keyNameToMidi('G2', CONV)).toBe(55);
    expect(keyNameToMidi('E0', CONV)).toBe(28);
    expect(partOf('horns').playableLow).toBe(35);
    expect(partOf('trombones').playableLow).toBe(36);
    expect(partOf('trumpets').playableLow).toBe(55);
    expect(partOf('tuba').playableLow).toBe(28);
    for (const m of [24, 25, 35, 36, 48, 50, 51, 55, 28]) {
      expect(keyNameToMidi(midiToKeyName(m, CONV), CONV)).toBe(m);
    }
    expect(midiToKeyName(24, CONV)).toBe('C0');
    expect(midiToKeyName(25, CONV)).toBe('C#0');
    expect(midiToKeyName(50, CONV)).toBe('D2');
    expect(midiToKeyName(51, CONV)).toBe('Eb2'); // the writer's flat spelling for pc 3 — parses back to 51
  });
});

/* ---------------- 2. profile shape: roles, channels, zones ---------------- */
describe('the brass parts in the shipped profile', () => {
  it('uses the brass module\'s Crescode roles, the Falcon patch names, and the channels after the strings', () => {
    expect(PROFILE.parts.map((p) => p.id)).toEqual(['violins1', 'violins2', 'violas', 'cello', 'bass', 'horns', 'trombones', 'trumpets', 'tuba']);
    expect(BRASS_IDS.map((id) => partOf(id).source)).toEqual([
      { role: 'horns' }, { role: 'trombones' }, { role: 'trumpets' }, { role: 'tuba' },
    ]);
    expect(BRASS_IDS.map((id) => partOf(id).patch)).toEqual(['French Horn Ensemble', 'Trombone Ensemble', 'Trumpet Ensemble', 'Tuba solo']);
    expect(BRASS_IDS.map((id) => partOf(id).channel)).toEqual([6, 7, 8, 9]);
    expect(PROFILE.parts.slice(0, 5).map((p) => p.channel)).toEqual([1, 2, 3, 4, 5]);
  });

  it('every part (strings included) carries keyswitchZone + playableLow; every keyswitch lies inside its zone and below playableLow', () => {
    for (const part of PROFILE.parts) {
      expect(part.keyswitchZone, `${part.id} keyswitchZone`).toBeDefined();
      expect(part.playableLow, `${part.id} playableLow`).toBeDefined();
      for (const [art, name] of Object.entries(part.keyswitches)) {
        const midi = keyNameToMidi(name, CONV)!;
        expect(midi, `${part.id}.${art} (${name}) inside the zone`).toBeGreaterThanOrEqual(part.keyswitchZone!.low);
        expect(midi, `${part.id}.${art} (${name}) inside the zone`).toBeLessThanOrEqual(part.keyswitchZone!.high);
        expect(midi, `${part.id}.${art} (${name}) below playableLow`).toBeLessThan(part.playableLow!);
        expect(midi, `${part.id}.${art} (${name}) below lowestPlayable`).toBeLessThan(part.lowestPlayable);
      }
    }
    // the user's strings table, as fields
    expect(partOf('cello').keyswitchZone).toEqual({ low: 12, high: 24 });
    expect(partOf('violas').keyswitchZone).toEqual({ low: 24, high: 47 });
    expect(partOf('violins2').keyswitchZone).toEqual({ low: 36, high: 50 });
    expect(partOf('violins1').keyswitchZone).toEqual({ low: 24, high: 38 });
    expect(partOf('cello').playableLow).toBe(36);
    expect(partOf('violas').playableLow).toBe(48);
    expect(partOf('violins2').playableLow).toBe(60);
    expect(partOf('violins1').playableLow).toBe(48);
  });

  it('brass defaults match the strings: cc 1/7/11 on, 68/74 off, transpose 0, no tremoloMode (not applicable for brass)', () => {
    const doc = uviDoc() as { parts: Record<string, unknown>[] };
    for (const id of BRASS_IDS) {
      const raw = doc.parts.find((p) => p.id === id)!;
      expect(raw.tremoloMode, `${id} tremoloMode absent`).toBeUndefined();
      expect(raw.transposeSemitones).toBe(0);
      expect(raw.ccEnabled).toEqual({ '1': true, '7': true, '11': true, '68': false, '74': false });
    }
    const parsed = parseExportProfile(uviDoc());
    for (const id of BRASS_IDS) expect(parsed.parts.find((p) => p.id === id)!.tremoloMode).toBe('sampled');
  });
});

/* ---------------- 3. keyswitches: only on change, ahead of the note ---------------- */
describe('brass keyswitch emission', () => {
  const base = projectFromFixture(JSON.parse(JSON.stringify(dorian)));

  it('emits one switch ahead of the first note of each articulation change — never for a repeated key', () => {
    const trumpets = partOf('trumpets');
    const notes: Note[] = [
      { pitch: 64, startTick: 960, durationTicks: 480, velocity: 90, articulation: 'sustain' },
      { pitch: 67, startTick: 1440, durationTicks: 480, velocity: 90 }, // still sustain: no switch
      { pitch: 69, startTick: 1920, durationTicks: 240, velocity: 95, articulation: 'staccato' },
      { pitch: 72, startTick: 2400, durationTicks: 480, velocity: 90, articulation: 'sustain' },
      { pitch: 76, startTick: 2880, durationTicks: 240, velocity: 99, articulation: 'marcato' }, // → accent key
    ];
    const ks = keyswitchNotesFor(trumpets, notes, base, PROFILE);
    expect(ks.map((k) => k.pitch)).toEqual([48, 51, 48, 50]); // sustain, staccato, sustain, accent(marcato)
    expect(ks.every((k) => k.velocity === PROFILE.keyswitchVelocity)).toBe(true);
    for (const k of ks) {
      const trigger = notes.filter((n) => n.startTick >= k.startTick + k.durationTicks).sort((a, b) => a.startTick - b.startTick)[0];
      expect(k.startTick, 'strictly ahead').toBeLessThan(trigger.startTick);
      expect(k.startTick + k.durationTicks, 'ends at or before its trigger').toBeLessThanOrEqual(trigger.startTick);
    }
    // the lead is the profile's 30 ms through the tempo map
    for (const [k, trigger] of [[ks[0], notes[0]], [ks[1], notes[2]], [ks[2], notes[3]], [ks[3], notes[4]]] as const) {
      const baseMs = ticksToMs(trigger.startTick, base.tempoMap);
      const leadTicks = Math.max(1, Math.round(msToTicks(baseMs + 30, base.tempoMap) - msToTicks(baseMs, base.tempoMap)));
      expect(k.startTick).toBe(trigger.startTick - leadTicks);
    }
  });

  it('on a real export the brass chunks follow the emit-on-change rules with no switch past its trigger', () => {
    const { project } = composeTake(threeChorus, 'ensemble.cinematic', 1);
    const tracks = instTracks(project);
    for (const id of BRASS_IDS) {
      const part = partOf(id);
      const source = tracks.find((t) => t.role === part.source.role);
      if (!source || !source.notes.length) continue; // a silent part has no chunk
      const chunk = chunksForTrack(project, source, PROFILE).find((c) => c.channel === part.channel)!;
      expect(chunk, `${id} exports on its own channel`).toBeDefined();
      const keys = new Set(Object.values(part.keyswitches).map((n) => keyNameToMidi(n, CONV)!));
      const ks = chunk.notes.filter((n) => keys.has(n.pitch) && n.velocity === PROFILE.keyswitchVelocity);
      expect(ks.length, `${id} has keyswitches`).toBeGreaterThan(0);
      const playing = chunk.notes.filter((n) => !keys.has(n.pitch) || n.velocity !== PROFILE.keyswitchVelocity);
      // recompute the expected switch sequence from the playing notes
      let current: number | null = null;
      const expected: number[] = [];
      for (const n of [...playing].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch)) {
        const key = resolveArticulationKeyFor(part, n.articulation ?? 'sustain', CONV);
        if (key === null || (current !== null && current === key)) continue;
        expected.push(key);
        current = key;
      }
      expect(ks.map((k) => k.pitch)).toEqual(expected);
      for (const k of ks) {
        const trigger = playing.filter((n) => n.startTick >= k.startTick + k.durationTicks).sort((a, b) => a.startTick - b.startTick)[0];
        expect(trigger, `${id} keyswitch ${k.pitch}@${k.startTick} has a trigger`).toBeDefined();
        expect(k.startTick).toBeLessThan(trigger!.startTick);
      }
    }
  });
});

/* ---------------- 4. fallback chains ---------------- */
describe('brass fallback chains', () => {
  it('horns/trombones/tuba: marcato, spiccato and pizz fall back to staccato (C#0=25)', () => {
    for (const id of ['horns', 'trombones', 'tuba'] as const) {
      const part = partOf(id);
      for (const art of ['marcato', 'spiccato', 'pizz']) {
        expect(resolveArticulationKeyFor(part, art, CONV), `${id} ${art}`).toBe(25);
      }
    }
  });
  it('trumpets: marcato falls back to ACCENT (D2=50); spiccato and pizz to staccato (D#2=51)', () => {
    const trumpets = partOf('trumpets');
    expect(resolveArticulationKeyFor(trumpets, 'marcato', CONV)).toBe(50);
    expect(resolveArticulationKeyFor(trumpets, 'spiccato', CONV)).toBe(51);
    expect(resolveArticulationKeyFor(trumpets, 'pizz', CONV)).toBe(51);
  });
  it('everything else — legato, tremolo and the color articulations — falls back to sustain', () => {
    for (const id of BRASS_IDS) {
      const part = partOf(id);
      const sustain = keyNameToMidi(part.keyswitches.sustain, CONV)!;
      for (const art of ['legato', 'tremolo', 'detache', 'portato', 'sulTasto', 'sulPont', 'conSord']) {
        expect(resolveArticulationKeyFor(part, art, CONV), `${id} ${art}`).toBe(sustain);
      }
      expect(resolveArticulationKeyFor(part, 'sustain', CONV)).toBe(sustain);
    }
  });
  it('the validator enforces the chain entries: deleting the accent key makes the trumpets\' marcato chain reference an unknown name', () => {
    const doc = uviDoc() as { parts: Record<string, unknown>[] };
    const trumpets = doc.parts.find((p) => p.id === 'trumpets') as { keyswitches: Record<string, string> };
    delete trumpets.keyswitches.accent;
    const errors = validateExportProfile(doc);
    // the marcato chain ['accent'] now references a name that is neither a project
    // articulation nor a keyswitch of the part — rejected as a bad chain (resolution
    // itself still terminates at sustain, so the terminal fallback is intact)
    expect(errors.some((e) => e.includes('parts[7].fallback.marcato') && e.includes('must be a non-empty array'))).toBe(true);
  });
});

/* ---------------- 5. validator accept/reject (zones + playableLow) ---------------- */
describe('profile validator: keyswitchZone + playableLow', () => {
  it('accepts the shipped nine-part profile (doc and parsed)', () => {
    expect(validateExportProfile(uviDoc())).toEqual([]);
    expect(validateExportProfile(EXPORT_PROFILES[0].profile)).toEqual([]);
  });
  it('rejects a key outside its zone', () => {
    const doc = uviDoc() as { parts: Record<string, unknown>[] };
    const trumpets = doc.parts.find((p) => p.id === 'trumpets') as { keyswitches: Record<string, string> };
    trumpets.keyswitches.sustain = 'C1'; // 36: below lowestPlayable 55, but outside the zone [48, 52]
    const errors = validateExportProfile(doc);
    expect(errors.some((e) => e.includes('keyswitches.sustain') && e.includes('outside the part\'s keyswitch zone'))).toBe(true);
  });
  it('rejects a key at or above playableLow', () => {
    const doc = uviDoc() as { parts: Record<string, unknown>[] };
    const tuba = doc.parts.find((p) => p.id === 'tuba') as { playableLow: number };
    tuba.playableLow = 24; // the sustain key C0 = 24 is no longer below the floor
    const errors = validateExportProfile(doc);
    expect(errors.some((e) => e.includes('keyswitches.sustain') && e.includes('not below the part\'s playableLow'))).toBe(true);
  });
  it('rejects a malformed zone', () => {
    const doc = uviDoc() as { parts: Record<string, unknown>[] };
    const horns = doc.parts.find((p) => p.id === 'horns') as { keyswitchZone: { low: number; high: number } };
    horns.keyswitchZone = { low: 29, high: 24 };
    expect(validateExportProfile(doc).some((e) => e.includes('keyswitchZone') && e.includes('low ≤ high'))).toBe(true);
    horns.keyswitchZone = { low: 0.5, high: 30 } as unknown as { low: number; high: number };
    expect(validateExportProfile(doc).some((e) => e.includes('keyswitchZone'))).toBe(true);
  });
  it('rejects a non-integer playableLow and an unreferenced bogus keyswitch name on a brass part', () => {
    const doc = uviDoc() as { parts: Record<string, unknown>[] };
    const horns = doc.parts.find((p) => p.id === 'horns') as Record<string, unknown>;
    horns.playableLow = 35.5;
    expect(validateExportProfile(doc).some((e) => e.includes('playableLow'))).toBe(true);
    delete horns.playableLow;
    (horns.keyswitches as Record<string, string>).glash = 'C0';
    expect(validateExportProfile(doc).some((e) => e.includes('keyswitches.glash') && e.includes('unknown articulation'))).toBe(true);
  });
});

/* ---------------- 6. unique channels ---------------- */
describe('channels', () => {
  it('the nine channels are unique (1–9); a duplicate is rejected naming the owner', () => {
    expect(new Set(PROFILE.parts.map((p) => p.channel)).size).toBe(PROFILE.parts.length);
    const doc = uviDoc() as { parts: Record<string, unknown>[] };
    const horns = doc.parts.find((p) => p.id === 'horns') as { channel: number };
    horns.channel = 4;
    const errors = validateExportProfile(doc);
    expect(errors.some((e) => e.includes('parts[5].channel') && e.includes('already used'))).toBe(true);
  });
});

/* ---------------- 7. the red-zone guard ---------------- */
describe('red-zone guard (export only)', () => {
  const composed = composeTake(threeChorus, 'ensemble.cinematic', 1);

  const injectSubFloorNotes = (project: Project): Project => {
    const p: Project = JSON.parse(JSON.stringify(project));
    const horns = p.tracks.find((t) => t.role === 'horns')!;
    horns.notes.push(
      { pitch: 30, startTick: 19200, durationTicks: 480, velocity: 80, articulation: 'sustain' }, // < 35
      { pitch: 41, startTick: 38400, durationTicks: 480, velocity: 80, articulation: 'sustain' }, // kept
      { pitch: 60, startTick: 57600, durationTicks: 480, velocity: 80, articulation: 'sustain' }, // kept
    );
    const tuba = p.tracks.find((t) => t.role === 'tuba')!;
    tuba.notes.push({ pitch: 25, startTick: 19200, durationTicks: 480, velocity: 80, articulation: 'sustain' }); // < 28
    return p;
  };

  it('drops exactly the non-keyswitch notes below playableLow; keyswitches and the project survive', () => {
    const before = JSON.stringify(composed.project);
    const p = injectSubFloorNotes(composed.project);
    expect(JSON.stringify(composed.project)).toBe(before); // the injection worked on a copy
    const tracks = instTracks(p);
    const horns = partOf('horns');
    const hornChunk = chunksForTrack(p, tracks.find((t) => t.role === 'horns')!, PROFILE).find((c) => c.channel === horns.channel)!;
    expect(hornChunk.notes.some((n) => n.pitch === 30)).toBe(false); // dropped
    for (const [pitch, start] of [[41, 38400], [60, 57600]] as const) {
      expect(hornChunk.notes.some((n) => n.pitch === pitch && n.startTick === start), `injected ${pitch}@${start} kept`).toBe(true);
    }
    const keys = new Set(Object.values(horns.keyswitches).map((n) => keyNameToMidi(n, CONV)!));
    expect(hornChunk.notes.some((n) => keys.has(n.pitch)), 'keyswitches are never dropped').toBe(true);
    // the no-profile export keeps everything; the project is untouched by both
    const plain = buildMergedMidi(p, tracks);
    const parsed = parseMidiFile(plain);
    const hornTrack = parsed.tracks.find((t) => t.notes.some((n) => n.pitch === 30));
    expect(hornTrack, 'no-profile export keeps the sub-floor note').toBeDefined();
    expect(JSON.stringify(p)).not.toBe(before); // p carries the injections
    expect(JSON.stringify(composed.project)).toBe(before); // …while the composed project never moved
    expect(validateProject(JSON.parse(JSON.stringify(composed.project))).ok).toBe(true);
    // dropped notes never leak into a passthrough/rest chunk of the profile export
    const merged = parseMidiFile(buildMergedMidi(p, tracks, PROFILE));
    const hornChunks = merged.tracks.filter((t) => t.channel === horns.channel);
    expect(hornChunks.every((t) => t.notes.every((n) => !keys.has(n.pitch) || n.velocity !== PROFILE.keyswitchVelocity ? n.pitch >= horns.playableLow! : true))).toBe(true);
  });

  it('a part whose every note is below playableLow exports NOTHING (the passthrough would reintroduce the dropped notes)', () => {
    const p = injectSubFloorNotes(composed.project);
    const tuba = p.tracks.find((t) => t.role === 'tuba')!;
    tuba.notes = [{ pitch: 25, startTick: 0, durationTicks: 480, velocity: 80, articulation: 'sustain' }]; // only sub-floor notes
    const chunks = chunksForTrack(p, tuba, PROFILE);
    expect(chunks).toEqual([]);
    const merged = parseMidiFile(buildMergedMidi(p, instTracks(p), PROFILE));
    expect(merged.tracks.some((t) => t.name === 'Tuba solo')).toBe(false);
  });
});

/* ---------------- 8. no-profile export byte-identical to Phase 8 ---------------- */
describe('no-profile export stays byte-identical to the Phase 8 golden capture', () => {
  it('dorian cinematic take 1 (moments:false harness): merged + every per-track file', () => {
    const { project } = composeTake(dorian, 'ensemble.cinematic', 1, false);
    const goldenDir = new URL('./golden/', import.meta.url);
    const tracks = instTracks(project);
    expect(Buffer.compare(Buffer.from(buildMergedMidi(project, tracks)), readFileSync(new URL('dorian-cinematic-merged.mid', goldenDir)))).toBe(0);
    for (const f of buildPerTrackMidi(project, tracks)) {
      expect(Buffer.compare(Buffer.from(f.data), readFileSync(new URL(`dorian-cinematic-per-${f.fileName}`, goldenDir)))).toBe(0);
    }
  });
  it('three-chorus symphony take 1 (moments:false harness): merged + every per-track file', () => {
    const { project } = composeTake(threeChorus, 'ensemble.symphony', 1, false);
    const goldenDir = new URL('./golden/', import.meta.url);
    const tracks = instTracks(project);
    expect(Buffer.compare(Buffer.from(buildMergedMidi(project, tracks)), readFileSync(new URL('three-symphony-merged.mid', goldenDir)))).toBe(0);
    for (const f of buildPerTrackMidi(project, tracks)) {
      expect(Buffer.compare(Buffer.from(f.data), readFileSync(new URL(`three-symphony-per-${f.fileName}`, goldenDir)))).toBe(0);
    }
  });
});

/* ---------------- 9. round-trip parse: brass keyswitches with the right lead ---------------- */
describe('round-trip parse of a profile export with brass', () => {
  it('the brass keyswitch notes survive the write/parse with their ~30 ms lead through the tempo map', () => {
    const { project } = composeTake(threeChorus, 'ensemble.cinematic', 1);
    const tracks = instTracks(project);
    const parsed = parseMidiFile(buildMergedMidi(project, tracks, PROFILE));
    let brassPartsSeen = 0;
    for (const id of BRASS_IDS) {
      const part = partOf(id);
      const source = tracks.find((t) => t.role === part.source.role);
      if (!source || !source.notes.length) continue;
      brassPartsSeen++;
      const track = parsed.tracks.find((t) => t.name === part.patch && t.channel === part.channel)!;
      expect(track, `${part.patch} parsed on channel ${part.channel}`).toBeDefined();
      const chunk = chunksForTrack(project, source, PROFILE).find((c) => c.channel === part.channel)!;
      const expected = keyswitchNotesFor(part, chunk.notes.filter((n) => !new Set(Object.values(part.keyswitches).map((k) => keyNameToMidi(k, CONV)!)).has(n.pitch)), project, PROFILE);
      const keys = new Set(Object.values(part.keyswitches).map((n) => keyNameToMidi(n, CONV)!));
      const got = track.notes.filter((n) => keys.has(n.pitch) && n.velocity === PROFILE.keyswitchVelocity);
      expect(got.map((k) => [k.pitch, k.startTick])).toEqual(expected.map((k) => [k.pitch, k.startTick]));
      expect(got.length, `${part.id} keyswitch count ${got.length}`).toBeGreaterThan(0);
      for (const k of got) {
        const trigger = track.notes.filter((n) => (!keys.has(n.pitch) || n.velocity !== PROFILE.keyswitchVelocity) && n.startTick >= k.startTick + k.durationTicks).sort((a, b) => a.startTick - b.startTick)[0];
        expect(trigger, 'a trigger after every keyswitch').toBeDefined();
        const leadMs = ticksToMs(trigger!.startTick, project.tempoMap) - ticksToMs(k.startTick, project.tempoMap);
        const baseMs = ticksToMs(trigger!.startTick, project.tempoMap);
        const wantTicks = Math.max(1, Math.round(msToTicks(baseMs + 30, project.tempoMap) - msToTicks(baseMs, project.tempoMap)));
        if (k.startTick === 0) continue; // clamped at the file start — no room for the lead
        expect(leadMs).toBeCloseTo(ticksToMs(trigger!.startTick, project.tempoMap) - ticksToMs(trigger!.startTick - wantTicks, project.tempoMap), 5);
      }
    }
    expect(brassPartsSeen, 'cinematic take 1 writes all four brass parts').toBe(4);
  });
});

/* ---------------- 10. the brass red-zone target: zero drops ---------------- */
describe('brass guard drops: the target is zero for trumpets and horns (and holds for all four)', () => {
  it('every brass note in three-chorus symphony/cinematic/hybridstudio takes 1–10 and dorian cinematic takes 1–10 sits at or above its part\'s playableLow', () => {
    let brassNotes = 0;
    for (const [doc, templateIds] of [[threeChorus, ['ensemble.symphony', 'ensemble.cinematic', 'ensemble.hybridstudio']], [dorian, ['ensemble.cinematic']]] as const) {
      for (const templateId of templateIds) {
        for (let take = 1; take <= 10; take++) {
          const { project } = composeTake(doc, templateId, take);
          for (const id of BRASS_IDS) {
            const part = partOf(id);
            const t = project.tracks.find((x) => x.role === part.source.role);
            for (const n of t?.notes ?? []) {
              brassNotes++;
              expect(n.pitch >= part.playableLow!, `${templateId} t${take} ${id} note ${n.pitch} below playableLow ${part.playableLow}`).toBe(true);
            }
          }
        }
      }
    }
    expect(brassNotes, 'the survey actually exercised brass notes').toBeGreaterThan(0);
  });
});
