/**
 * Instrument capability tables (Strings V1, Stage 1) — data only, built
 * from the shipped export profile and the app's preview mapping. Nothing
 * here changes a mapping or the export.
 *
 * Three levels are kept apart for every instrument:
 *   1. technique     what a composer can describe ("short bounced notes");
 *   2. trigger       what the mapping does with the matching articulation —
 *                    its own keyswitch, another articulation's keyswitch, or
 *                    the sustain default — resolved by the export's own
 *                    resolver;
 *   3. listening     whether the resulting sound has been auditioned.
 *                    Nothing has been auditioned yet, so every entry reads
 *                    'not-auditioned'. Only a listening session may change it.
 *
 * Details the profile itself marks as unverified stay marked here.
 */
import { ARTICULATION_VOICES } from '../../../audio/mapping';
import { EXPORT_PROFILES } from '../../../export/profiles';
import uviOrchestralSuite from '../../../export/profiles/uvi-orchestral-suite.json';
import { PROFILE_SUSTAIN, keyNameToMidi, midiToKeyName, resolveArticulationKeyFor, type ExportProfile, type ProfilePart } from '../../../export/profile';
import { ARTICULATIONS, type Articulation } from '../../../shared/schema/types';
import { BASSES_ROLE } from '../../basses';

export type StringInstrumentId = 'violin1' | 'violin2' | 'viola' | 'cello' | 'doubleBass';

export const STRING_INSTRUMENT_IDS: readonly StringInstrumentId[] = ['violin1', 'violin2', 'viola', 'cello', 'doubleBass'];

/** Which track role, and which note layer of it, each instrument reads in the export profile. */
export const STRING_INSTRUMENT_SOURCES: Readonly<Record<StringInstrumentId, { readonly name: string; readonly role: string }>> = {
  violin1: { name: 'Violin I', role: 'violins1' },
  violin2: { name: 'Violin II', role: 'violins2' },
  viola: { name: 'Viola', role: 'violas' },
  cello: { name: 'Cello', role: 'cellosBasses' },
  doubleBass: { name: 'Double Bass', role: BASSES_ROLE },
};

export type TriggerKind = 'own-keyswitch' | 'other-articulation' | 'sustain-default' | 'unresolved';
export type ListeningStatus = 'not-auditioned' | 'convincing' | 'usable' | 'unconvincing';

export interface ArticulationCapability {
  readonly articulation: Articulation;
  readonly trigger: TriggerKind;
  /** The keyswitch name that actually sounds ('sustain', 'marcato', …); null when unresolved. */
  readonly sounds: string | null;
  readonly keyMidi: number | null;
  readonly keyName: string | null;
  /** The profile's fallback chain for this articulation (empty when it has none). */
  readonly fallbackChain: readonly string[];
  /** True when the profile lists the sounding key as unverified. */
  readonly keyUnverified: boolean;
  /** True when the app's preview synth gives this articulation an envelope of its own (not the sustain family). */
  readonly previewDistinct: boolean;
  readonly listening: ListeningStatus;
  /** Where this entry comes from. */
  readonly source: string;
}

/** Level 1: techniques a composer can describe, and the articulation each one asks for. */
export const STRING_TECHNIQUES: readonly { readonly technique: string; readonly description: string; readonly articulation: Articulation }[] = [
  { technique: 'sustained', description: 'plain held bow stroke', articulation: 'sustain' },
  { technique: 'legato line', description: 'connected notes under one bow', articulation: 'legato' },
  { technique: 'accented stroke', description: 'strong attack, then held', articulation: 'marcato' },
  { technique: 'short detached', description: 'short stopped notes on the string', articulation: 'staccato' },
  { technique: 'short bounced', description: 'short notes with a bouncing bow', articulation: 'spiccato' },
  { technique: 'plucked', description: 'plucked string', articulation: 'pizz' },
  { technique: 'tremolo', description: 'rapid bow repetition on one note', articulation: 'tremolo' },
  { technique: 'separate bows', description: 'one bow per note, connected', articulation: 'detache' },
  { technique: 'pulsed bow', description: 'gently separated notes in one bow', articulation: 'portato' },
  { technique: 'over the fingerboard', description: 'soft, veiled tone', articulation: 'sulTasto' },
  { technique: 'near the bridge', description: 'glassy, thin tone', articulation: 'sulPont' },
  { technique: 'muted', description: 'played with a mute', articulation: 'conSord' },
];

export interface TechniqueCapability {
  readonly technique: string;
  readonly articulation: Articulation;
  /** 'triggerable' = the mapping has a keyswitch of its own; 'substituted' = another sound plays. */
  readonly availability: 'triggerable' | 'substituted' | 'unresolved';
  readonly sounds: string | null;
  readonly listening: ListeningStatus;
}

export interface InstrumentCapabilities {
  readonly instrument: StringInstrumentId;
  readonly name: string;
  readonly trackRole: string;
  readonly profileId: string;
  readonly partId: string;
  readonly partIndex: number;
  readonly patch: string;
  /** Lowest playable key of the patch (sounding MIDI); null when the profile states none. */
  readonly playableLow: number | null;
  readonly keyswitchZone: { readonly low: number; readonly high: number } | null;
  readonly transposeSemitones: number;
  /** 'unverified' when the profile lists this part's transposition as an unverified default. */
  readonly soundingPitch: 'as-written-per-profile' | 'unverified';
  readonly tremoloMode: string;
  /** Controller numbers the export writes for this part. */
  readonly controllersWritten: readonly number[];
  readonly controllersNotWritten: readonly number[];
  readonly articulations: readonly ArticulationCapability[];
  readonly techniques: readonly TechniqueCapability[];
  /** The profile's own "unverified" notes that concern this part, verbatim. */
  readonly unverified: readonly string[];
}

const RAW_UNVERIFIED: readonly string[] = ((uviOrchestralSuite as { unverified?: unknown }).unverified as string[] | undefined) ?? [];

function partFor(profile: ExportProfile, instrument: StringInstrumentId): { part: ProfilePart; index: number } {
  const role = STRING_INSTRUMENT_SOURCES[instrument].role;
  const index = profile.parts.findIndex((p) => p.source.role === role && (instrument !== 'cello' || p.source.layer !== 'cb'));
  if (index < 0) throw new Error(`string capabilities: the export profile has no part for role "${role}"`);
  return { part: profile.parts[index], index };
}

function articulationCapability(profile: ExportProfile, part: ProfilePart, index: number, articulation: Articulation): ArticulationCapability {
  const keyMidi = resolveArticulationKeyFor(part, articulation, profile.pitchConvention);
  const own = part.keyswitches[articulation] !== undefined && !(part.tremoloMode === 'measured' && articulation === 'tremolo');
  const soundingName = keyMidi === null
    ? null
    : Object.keys(part.keyswitches).find((name) => keyNameToMidi(part.keyswitches[name], profile.pitchConvention) === keyMidi) ?? null;
  const chain = part.fallback[articulation] ?? [];
  const trigger: TriggerKind = keyMidi === null ? 'unresolved'
    : own ? 'own-keyswitch'
      : soundingName === PROFILE_SUSTAIN ? 'sustain-default'
        : 'other-articulation';
  const voice = ARTICULATION_VOICES[articulation];
  return {
    articulation,
    trigger,
    sounds: soundingName,
    keyMidi,
    keyName: keyMidi === null ? null : midiToKeyName(keyMidi, profile.pitchConvention),
    fallbackChain: [...chain],
    keyUnverified: soundingName !== null && RAW_UNVERIFIED.some((note) => note.startsWith(`parts[${index}].keyswitches.${soundingName} `)),
    previewDistinct: voice !== undefined && voice !== ARTICULATION_VOICES[PROFILE_SUSTAIN],
    listening: 'not-auditioned',
    source: own
      ? `${profile.id} parts[${index}].keyswitches.${articulation}`
      : chain.length
        ? `${profile.id} parts[${index}].fallback.${articulation} -> ${chain.join(' -> ')}`
        : `${profile.id} parts[${index}]: no keyswitch and no fallback for ${articulation}; the export resolver ends on ${PROFILE_SUSTAIN}`,
  };
}

/** Builds the capability table of one instrument from an export profile. */
export function buildInstrumentCapabilities(instrument: StringInstrumentId, profile: ExportProfile = EXPORT_PROFILES[0].profile): InstrumentCapabilities {
  const { part, index } = partFor(profile, instrument);
  const articulations = ARTICULATIONS.map((a) => articulationCapability(profile, part, index, a));
  const byArticulation = new Map(articulations.map((a) => [a.articulation, a]));
  const controllers = Object.entries(part.ccEnabled).map(([cc, on]) => ({ cc: Number(cc), on })).sort((a, b) => a.cc - b.cc);
  const unverified = RAW_UNVERIFIED.filter((note) => note.startsWith(`parts[${index}].`));
  return {
    instrument,
    name: STRING_INSTRUMENT_SOURCES[instrument].name,
    trackRole: STRING_INSTRUMENT_SOURCES[instrument].role,
    profileId: profile.id,
    partId: part.id,
    partIndex: index,
    patch: part.patch,
    playableLow: part.playableLow ?? null,
    keyswitchZone: part.keyswitchZone ? { ...part.keyswitchZone } : null,
    transposeSemitones: part.transposeSemitones,
    soundingPitch: unverified.some((note) => note.startsWith(`parts[${index}].transposeSemitones`)) ? 'unverified' : 'as-written-per-profile',
    tremoloMode: part.tremoloMode,
    controllersWritten: controllers.filter((c) => c.on).map((c) => c.cc),
    controllersNotWritten: controllers.filter((c) => !c.on).map((c) => c.cc),
    articulations,
    techniques: STRING_TECHNIQUES.map((t) => {
      const capability = byArticulation.get(t.articulation)!;
      return {
        technique: t.technique,
        articulation: t.articulation,
        availability: capability.trigger === 'own-keyswitch' ? 'triggerable' as const : capability.trigger === 'unresolved' ? 'unresolved' as const : 'substituted' as const,
        sounds: capability.sounds,
        listening: capability.listening,
      };
    }),
    unverified,
  };
}

export function buildStringCapabilities(profile: ExportProfile = EXPORT_PROFILES[0].profile): Record<StringInstrumentId, InstrumentCapabilities> {
  return Object.fromEntries(STRING_INSTRUMENT_IDS.map((id) => [id, buildInstrumentCapabilities(id, profile)])) as Record<StringInstrumentId, InstrumentCapabilities>;
}

/** The articulations an instrument can trigger with a keyswitch of its own. */
export function triggerableArticulations(capabilities: InstrumentCapabilities): Articulation[] {
  return capabilities.articulations.filter((a) => a.trigger === 'own-keyswitch').map((a) => a.articulation);
}

/** Mapping questions that source reading cannot settle; each needs the named later check. */
export const UNRESOLVED_MAPPING_QUESTIONS: readonly { readonly question: string; readonly verifyBy: string }[] = [
  { question: 'Does the Bass Ensemble patch sound at written pitch or an octave lower?', verifyBy: 'play a test file through the UVI instrument' },
  { question: 'Are the keyswitch keys the profile marks as unverified correct (Violin II spiccato, Viola spiccato, Cello marcato)?', verifyBy: 'play a test file through the UVI instrument' },
  { question: 'Is the top of the cello keyswitch zone (35) correct, so that C2 = 36 is the lowest playable cello key?', verifyBy: 'play a test file through the UVI instrument' },
  { question: 'Is the Violin I playable floor (48) correct?', verifyBy: 'play a test file through the UVI instrument' },
  { question: 'Does upper-string staccato, which the export resolves to the sustain keyswitch, sound acceptable as short notes?', verifyBy: 'listening audition' },
  { question: 'Which triggerable articulations sound convincing on each instrument, at which speeds and registers?', verifyBy: 'listening audition, recorded per instrument' },
];
