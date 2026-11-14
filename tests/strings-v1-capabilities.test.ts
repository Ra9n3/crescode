/**
 * Strings V1 Stage 1 — instrument capability tables.
 * Every entry must trace to the shipped export profile, and nothing may be
 * marked as verified by listening.
 */
import { describe, expect, it } from 'vitest';
import profileDocument from '../src/export/profiles/uvi-orchestral-suite.json';
import { EXPORT_PROFILES } from '../src/export/profiles';
import { keyNameToMidi, resolveArticulationKeyFor } from '../src/export/profile';
import { ARTICULATIONS } from '../src/shared/schema/types';
import {
  STRING_INSTRUMENT_IDS, STRING_TECHNIQUES, UNRESOLVED_MAPPING_QUESTIONS, buildStringCapabilities, triggerableArticulations,
} from '../src/orchestrator/strings/characters/capabilities';

const profile = EXPORT_PROFILES[0].profile;
const raw = profileDocument as unknown as { parts: { id: string; patch: string; keyswitches: Record<string, string>; fallback?: Record<string, string[]>; playableLow?: number }[]; unverified: string[] };
const table = buildStringCapabilities();
const entry = (instrument: keyof typeof table, articulation: string) => table[instrument].articulations.find((a) => a.articulation === articulation)!;

describe('string instrument capability tables', () => {
  it('cover the five string instruments with their own profile part', () => {
    expect(STRING_INSTRUMENT_IDS).toEqual(['violin1', 'violin2', 'viola', 'cello', 'doubleBass']);
    expect(STRING_INSTRUMENT_IDS.map((id) => table[id].patch)).toEqual(['Violins 1 Ensemble', 'Violins 2 Ensemble', 'Viola Ensemble', 'Cello Ensemble', 'Bass Ensemble']);
    expect(new Set(STRING_INSTRUMENT_IDS.map((id) => table[id].partIndex)).size).toBe(5);
  });

  it('traces every articulation entry to the raw profile and to the export resolver', () => {
    for (const id of STRING_INSTRUMENT_IDS) {
      const capabilities = table[id];
      const rawPart = raw.parts[capabilities.partIndex];
      const part = profile.parts[capabilities.partIndex];
      expect(rawPart.patch).toBe(capabilities.patch);
      expect(capabilities.articulations.map((a) => a.articulation)).toEqual([...ARTICULATIONS]);
      for (const a of capabilities.articulations) {
        expect(a.keyMidi, `${id} ${a.articulation}`).toBe(resolveArticulationKeyFor(part, a.articulation, profile.pitchConvention));
        expect(a.trigger === 'own-keyswitch', `${id} ${a.articulation}`).toBe(rawPart.keyswitches[a.articulation] !== undefined);
        expect(a.fallbackChain).toEqual(rawPart.fallback?.[a.articulation] ?? []);
        expect(a.source).toContain(`${profile.id} parts[${capabilities.partIndex}]`);
        if (a.sounds !== null) expect(keyNameToMidi(rawPart.keyswitches[a.sounds], profile.pitchConvention)).toBe(a.keyMidi);
      }
      expect(capabilities.playableLow).toBe(rawPart.playableLow ?? null);
    }
  });

  it('is instrument-specific: only violins and viola can trigger spiccato', () => {
    const own = ['sustain', 'legato', 'marcato', 'pizz', 'tremolo'];
    for (const id of ['violin1', 'violin2', 'viola'] as const) {
      expect(triggerableArticulations(table[id]).sort()).toEqual([...own, 'spiccato'].sort());
      expect(entry(id, 'staccato')).toMatchObject({ trigger: 'sustain-default', sounds: 'sustain', fallbackChain: [] });
    }
    for (const id of ['cello', 'doubleBass'] as const) {
      expect(triggerableArticulations(table[id]).sort()).toEqual([...own].sort());
      expect(entry(id, 'spiccato')).toMatchObject({ trigger: 'other-articulation', sounds: 'marcato' });
      expect(entry(id, 'staccato')).toMatchObject({ trigger: 'other-articulation', sounds: 'marcato' });
    }
    for (const id of STRING_INSTRUMENT_IDS) {
      for (const articulation of ['detache', 'portato', 'sulTasto', 'sulPont', 'conSord']) {
        expect(entry(id, articulation)).toMatchObject({ trigger: 'sustain-default', sounds: 'sustain' });
      }
    }
  });

  it('keeps technique, trigger and listening apart, and marks nothing as auditioned', () => {
    for (const id of STRING_INSTRUMENT_IDS) {
      expect(table[id].techniques.map((t) => t.technique)).toEqual(STRING_TECHNIQUES.map((t) => t.technique));
      for (const a of table[id].articulations) expect(a.listening).toBe('not-auditioned');
      for (const t of table[id].techniques) {
        expect(t.listening).toBe('not-auditioned');
        expect(t.availability).toBe(entry(id, t.articulation).trigger === 'own-keyswitch' ? 'triggerable' : 'substituted');
      }
    }
    expect(table.cello.techniques.find((t) => t.technique === 'short bounced')).toMatchObject({ availability: 'substituted', sounds: 'marcato' });
    expect(table.violin1.techniques.find((t) => t.technique === 'short bounced')).toMatchObject({ availability: 'triggerable', sounds: 'spiccato' });
  });

  it('preserves what the profile marks as unverified', () => {
    expect(entry('violin2', 'spiccato').keyUnverified).toBe(true);
    expect(entry('viola', 'spiccato').keyUnverified).toBe(true);
    expect(entry('cello', 'marcato').keyUnverified).toBe(true);
    // cello spiccato and staccato sound the unverified marcato key
    expect(entry('cello', 'spiccato').keyUnverified).toBe(true);
    expect(entry('violin1', 'spiccato').keyUnverified).toBe(false);
    expect(table.doubleBass.soundingPitch).toBe('unverified');
    expect(table.cello.soundingPitch).toBe('as-written-per-profile');
    expect(table.cello.unverified.some((note) => note.includes('keyswitchZone.high'))).toBe(true);
    expect(table.violin1.unverified.some((note) => note.includes('playableLow'))).toBe(true);
    for (const id of STRING_INSTRUMENT_IDS) {
      for (const note of table[id].unverified) expect(raw.unverified).toContain(note);
    }
    expect(UNRESOLVED_MAPPING_QUESTIONS.length).toBeGreaterThanOrEqual(5);
    expect(UNRESOLVED_MAPPING_QUESTIONS.every((q) => q.verifyBy.length > 0)).toBe(true);
  });

  it('reads register floors and controllers from the profile', () => {
    expect(table.cello.playableLow).toBe(36);
    expect(table.cello.keyswitchZone).toEqual({ low: 12, high: 35 });
    for (const id of STRING_INSTRUMENT_IDS) {
      expect(table[id].controllersWritten).toEqual([1, 7, 11]);
      expect(table[id].controllersNotWritten).toEqual([68, 74]);
      expect(table[id].tremoloMode).toBe('sampled');
    }
  });
});
