/**
 * Export profiles (Phase 5.5). A profile rewrites the MIDI export so a
 * project plays correctly on a target sample library: one part per patch,
 * keyswitch notes ahead of every articulation change, the right CC lanes,
 * optional transposition and a sampled-tremolo merge. THE PROFILE IS DATA:
 * every library/patch/keyswitch name lives in the profile JSON
 * (src/export/profiles/*.json); this module is generic machinery and knows
 * no product names.
 *
 * Ground rules (spec discipline): the profile never touches the project —
 * keyswitches and merged notes exist only in the exported file. Without a
 * profile the writers are byte-identical to the plain export. Everything is
 * deterministic: the transform is a pure function of (project, tracks,
 * profile).
 *
 * Phase 8.1: each part may declare its patch's `keyswitchZone` (the red
 * zone of silent/keyswitch keys) and `playableLow` (the patch's lowest
 * playable note). The validator checks every keyswitch against both.
 *
 * Phase 8.2: the red-zone guard FOLDS instead of dropping — a non-keyswitch
 * note below playableLow is shifted up by whole octaves until it is playable
 * (div2 notes included); it is dropped only when the fold would exceed the
 * part's hard range (the source track's highestNote — the engine's ceiling,
 * the same authority the spec cites for the bass floor) or, under an
 * octaveDoubling policy of 'forbidden', when the fold would create a new
 * unison or octave doubling with ANOTHER part at the same moment. A part may
 * also name a `legacy` source (role + layer): the Bass part reads the
 * project's own basses track and, on legacy combined cellosBasses tracks
 * that still carry layer:'cb' notes, claims those under cbLayer 'separate'.
 * Keyswitch names may also describe patch-side
 * articulations the project never writes (e.g. an accent patch key) as long
 * as some fallback chain of the same part references them.
 */
import { ARTICULATIONS, isInstrumentTrack, type CcLane, type Note, type Project, type Track } from '../shared/schema/types';
import { msToTicks, ticksToMs } from '../orchestrator/spine';
import { resolveTemplate } from '../config/ensembles';
import { hashString } from '../engine/generate';

/* ---------------- pitch convention ---------------- */

/**
 * Key names use the LIBRARY's convention (the profile's `pitchConvention`,
 * e.g. "C3=60" — names shift one octave down from the repo's own C4=60
 * `noteName`). Both directions go through the convention string:
 * C0 = 24 and C-1 = 12 under C3=60.
 */
const KEY_NAME_RE = /^([A-Ga-g])([#b]*)(-?\d+)$/;
const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Standard (C4=60) midi number of a key name — may sit outside 0..127 for
 *  extreme octaves (the caller validates after the convention shift). */
function keyNameToStandardMidi(name: string): number | null {
  const m = KEY_NAME_RE.exec(name.trim());
  if (!m) return null;
  const base = LETTER_PC[m[1].toUpperCase()];
  if (base === undefined) return null;
  let pc = base;
  for (const ch of m[2]) pc += ch === '#' ? 1 : -1;
  return (parseInt(m[3], 10) + 1) * 12 + pc;
}

/** Parses "C3=60" into the octave shift the convention applies (C3=60 → +12). */
export function parsePitchConvention(convention: string): { name: string; midi: number; shift: number } | null {
  const m = /^\s*([A-Ga-g][#b]*-?\d+)\s*=\s*(\d+)\s*$/.exec(convention);
  if (!m) return null;
  const midi = parseInt(m[2], 10);
  const std = keyNameToStandardMidi(m[1]);
  if (std === null || midi < 0 || midi > 127) return null;
  return { name: m[1], midi, shift: midi - std };
}

/** Key name → midi number under the profile's convention. */
export function keyNameToMidi(name: string, convention: string): number | null {
  const conv = parsePitchConvention(convention);
  const std = keyNameToStandardMidi(name);
  if (!conv || std === null) return null;
  const midi = std + conv.shift;
  return midi >= 0 && midi <= 127 ? midi : null;
}

/** Midi number → key name under the profile's convention (sharps for the
 *  pc spellings the table uses; flats read back fine on the way in). */
export function midiToKeyName(midi: number, convention: string): string {
  const conv = parsePitchConvention(convention);
  if (!conv || midi < 0 || midi > 127) return '';
  const std = midi - conv.shift;
  const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  return `${NAMES[((std % 12) + 12) % 12]}${Math.floor(std / 12) - 1}`;
}

/* ---------------- profile shape ---------------- */

/** Where a part's notes come from: a track role, optionally one layer. */
export interface ProfileSource {
  role: string;
  /** 'cb' = only the layer-marked notes; null = only the unmarked notes;
   *  absent = every note of the role. */
  layer?: 'cb' | null;
  /** Phase 8.2: an ADDITIONAL source this part reads — the Bass part's own
   *  role is the project's basses track, and on LEGACY combined tracks that
   *  still carry layer:'cb' notes it claims those too (cbLayer 'separate'). */
  legacy?: { role: string; layer?: 'cb' | null };
}

export interface ProfilePart {
  id: string;
  /** The patch to load on this part's channel (data, not code). */
  patch: string;
  channel: number;
  source: ProfileSource;
  /** Sounding midi floor of the patch — every keyswitch key must sit below it. */
  lowestPlayable: number;
  /** The patch's red zone (MIDI sounding): silent keys and keyswitch keys.
   *  Every keyswitch key must lie inside [low, high]. Optional (a profile
   *  without zones skips that check). */
  keyswitchZone?: { low: number; high: number };
  /** The patch's lowest playable note (MIDI sounding). The export's red-zone
   *  guard drops any non-keyswitch note below it; the validator requires
   *  every keyswitch key to sit below it. Optional (absent = no guard). */
  playableLow?: number;
  /** articulation (or 'sustain') → key NAME under the profile's convention. */
  keyswitches: Record<string, string>;
  /** articulation → chain of articulation names to try, in order. */
  fallback: Record<string, string[]>;
  transposeSemitones: number;
  keyswitchLeadMs: number;
  keyswitchLengthMs: number;
  /** 'sampled' (default): merge the measured tremolo repeats into one note
   *  and use the tremolo keyswitch. 'measured': keep the repeats, resolve
   *  the tremolo through the fallback chain (Sustain/Marcato). */
  tremoloMode: 'sampled' | 'measured';
  /** controller number → written? (default: 1, 7, 11 on; 68, 74 off). */
  ccEnabled: Record<string, boolean>;
  /** Phase 12: 'none' = the patch has NO keyswitches at all (the whole
   *  keyboard is playable): no keyswitch is emitted and the articulation
   *  resolution check is skipped. Default 'standard'. */
  keyswitchMode?: 'standard' | 'none';
  /** Phase 12: 'merged' (default) = the part rides in the merged file;
   *  'fileOnly' = the part exports only as its own per-track file on its
   *  documented channel — the merged file carries what fits and avoids the
   *  drum channel. */
  fileScope?: 'merged' | 'fileOnly';
  /** Phase 12: the patch's fixed key map — a pitch remap in the EXPORT only.
   *  fixedPitch: every note takes this one key. rotate: notes at `from`
   *  rotate deterministically through the named profile pool (hash-seeded
   *  per note, never the same key twice in a row). At most one of the two. */
  noteMap?: { fixedPitch?: number; rotate?: { from: number; pool: string } };
  /** Phase 12: whether this part's sounding pitches count as doubling
   *  candidates for ANOTHER part's fold (the octaveDoubling 'forbidden'
   *  check). Default true — the orchestral parts the template rule governs.
   *  The Phase 12 additions declare false, so the string/brass fold
   *  behaviour stays byte-identical to the pre-12 profile output. */
  doublingCandidate?: boolean;
}

export interface ExportProfile {
  id: string;
  name: string;
  pitchConvention: string;
  keyswitchVelocity: number;
  /** How the Cb layer of a LEGACY combined track exports: 'separate' (the
   *  Phase 8.2 default — the user owns a Bass patch) gives the layer:'cb'
   *  notes their own part (own channel + file); 'omit' drops the Cb-layer
   *  notes from the export entirely, so no Bass file is created for them.
   *  The Bass part itself reads the project's own basses track either way. */
  cbLayer: 'separate' | 'omit';
  /** Phase 12: named key pools for noteMap rotation (the snare's
   *  single-hit keys). Editable data; keys must be distinct (every key is a
   *  different sample). */
  pools?: Record<string, number[]>;
  /** Phase 12: track roles the profile deliberately does NOT map — their
   *  notes stay in the project and are left out of the export (the dialog
   *  and the report say so). A role is either mapped by a part or listed
   *  here, never both. */
  unmapped?: string[];
  parts: ProfilePart[];
}

/** The pseudo-articulation for the patch's default (plain Sustain) state —
 *  the terminal of every fallback chain and the read for notes without an
 *  articulation field. Not part of the project's ARTICULATIONS. */
export const PROFILE_SUSTAIN = 'sustain';
const PROFILE_ARTS = readonlyArts();
function readonlyArts(): string[] { return [...ARTICULATIONS, PROFILE_SUSTAIN]; }

/* ---------------- validation ---------------- */

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/**
 * Validates a profile document (parsed JSON). Returns human-readable errors
 * (empty = valid). Checks: known articulation names, keyswitch keys below
 * the part's lowest playable note, unique channels and unique sources, and
 * every articulation resolving through its fallback chain to a keyswitch.
 */
export function validateExportProfile(doc: unknown): string[] {
  const errors: string[] = [];
  const err = (at: string, msg: string) => errors.push(`${at}: ${msg}`);
  if (typeof doc !== 'object' || doc === null) { err('profile', 'must be an object'); return errors; }
  const d = doc as Record<string, unknown>;
  if (typeof d.id !== 'string' || !d.id.trim()) err('id', 'must be a non-empty string');
  if (typeof d.name !== 'string' || !d.name.trim()) err('name', 'must be a non-empty string');
  const conv = typeof d.pitchConvention === 'string' ? parsePitchConvention(d.pitchConvention) : null;
  if (!conv) err('pitchConvention', typeof d.pitchConvention === 'string' ? `unparseable convention ${JSON.stringify(d.pitchConvention)} (expected "C3=60" style)` : 'must be a string like "C3=60"');
  if (!isInt(d.keyswitchVelocity) || d.keyswitchVelocity < 1 || d.keyswitchVelocity > 127) err('keyswitchVelocity', 'must be an integer 1–127');
  if (d.cbLayer !== undefined && d.cbLayer !== 'separate' && d.cbLayer !== 'omit') err('cbLayer', `must be "separate" or "omit" (got ${JSON.stringify(d.cbLayer)})`);
  // Phase 12: the named key pools and the deliberately unmapped roles
  if (d.pools !== undefined) {
    if (typeof d.pools !== 'object' || d.pools === null) err('pools', 'must be an object of named key arrays');
    else for (const [name, arr] of Object.entries(d.pools as Record<string, unknown>)) {
      if (!name.trim()) { err('pools', 'pool names must be non-empty'); continue; }
      if (!Array.isArray(arr) || !arr.length) { err(`pools.${name}`, 'must be a non-empty array of midi keys'); continue; }
      if (!arr.every((k) => isInt(k) && (k as number) >= 0 && (k as number) <= 127)) { err(`pools.${name}`, 'every key must be an integer 0–127'); continue; }
      if (new Set(arr as number[]).size !== arr.length) err(`pools.${name}`, 'keys must be distinct (every key is a different sample)');
    }
  }
  if (d.unmapped !== undefined && (!Array.isArray(d.unmapped) || !d.unmapped.every((r) => typeof r === 'string' && r.trim()))) {
    err('unmapped', 'must be an array of non-empty role names');
  }
  if (!Array.isArray(d.parts) || !d.parts.length) { err('parts', 'must be a non-empty array'); return errors; }

  // Phase 12: channels are unique WITHIN each scope class — the merged file
  // and a fileOnly part's own file never share a reader, so a fileOnly part
  // may reuse a number the merged file also uses (documented per part).
  const seenChannel: Record<'merged' | 'fileOnly', Map<number, string>> = { merged: new Map(), fileOnly: new Map() };
  const seenSource = new Map<string, string>();
  d.parts.forEach((rawPart, i) => {
    const at = `parts[${i}]`;
    if (typeof rawPart !== 'object' || rawPart === null) { err(at, 'must be an object'); return; }
    const part = rawPart as Record<string, unknown>;
    if (typeof part.id !== 'string' || !part.id.trim()) err(`${at}.id`, 'must be a non-empty string');
    if (typeof part.patch !== 'string' || !part.patch.trim()) err(`${at}.patch`, 'must be a non-empty string');
    if (!isInt(part.channel) || part.channel < 1 || part.channel > 16) err(`${at}.channel`, 'must be an integer 1–16');
    else {
      const scope: 'merged' | 'fileOnly' = part.fileScope === 'fileOnly' ? 'fileOnly' : 'merged';
      const seen = seenChannel[scope];
      if (seen.has(part.channel)) err(`${at}.channel`, `channel ${part.channel} is already used by ${seen.get(part.channel)} (${scope} scope)`);
      else seen.set(part.channel, String(part.id) || at);
    }
    if (part.fileScope !== undefined && part.fileScope !== 'merged' && part.fileScope !== 'fileOnly') {
      err(`${at}.fileScope`, `must be "merged" or "fileOnly" (got ${JSON.stringify(part.fileScope)})`);
    }
    if (part.doublingCandidate !== undefined && typeof part.doublingCandidate !== 'boolean') {
      err(`${at}.doublingCandidate`, 'must be true or false');
    }

    // source
    const src = part.source;
    if (typeof src !== 'object' || src === null) { err(`${at}.source`, 'must be an object with a role'); }
    else {
      const s = src as Record<string, unknown>;
      if (typeof s.role !== 'string' || !s.role.trim()) err(`${at}.source.role`, 'must be a non-empty string');
      if (s.layer !== undefined && s.layer !== null && s.layer !== 'cb') err(`${at}.source.layer`, `must be "cb" or null (got ${JSON.stringify(s.layer)})`);
      const layerKey = s.layer === undefined ? '*' : String(s.layer);
      const sourceKey = `${String(s.role)}|${layerKey}`;
      if (seenSource.has(sourceKey)) err(`${at}.source`, `"${sourceKey}" is already claimed by ${seenSource.get(sourceKey)}`);
      else seenSource.set(sourceKey, String(part.id) || at);
      // Phase 8.2: the optional legacy claim (role + layer) — validated and
      // uniqueness-checked like a source of its own
      if (s.legacy !== undefined) {
        const l = s.legacy as Record<string, unknown>;
        if (typeof l !== 'object' || l === null || typeof l.role !== 'string' || !l.role.trim()) {
          err(`${at}.source.legacy`, 'must be { role, layer? } with a non-empty role');
        } else {
          if (l.layer !== undefined && l.layer !== null && l.layer !== 'cb') err(`${at}.source.legacy.layer`, `must be "cb" or null (got ${JSON.stringify(l.layer)})`);
          const legacyKey = `${l.role}|${l.layer === undefined ? '*' : String(l.layer)}`;
          if (seenSource.has(legacyKey)) err(`${at}.source.legacy`, `"${legacyKey}" is already claimed by ${seenSource.get(legacyKey)}`);
          else seenSource.set(legacyKey, String(part.id) || at);
        }
      }
    }

    if (!isInt(part.lowestPlayable) || part.lowestPlayable < 0 || part.lowestPlayable > 127) err(`${at}.lowestPlayable`, 'must be an integer 0–127');

    // Phase 8.1: the red zone + playable floor (both optional)
    let zone: { low: number; high: number } | null = null;
    if (part.keyswitchZone !== undefined) {
      const z = part.keyswitchZone as Record<string, unknown>;
      if (typeof z !== 'object' || z === null || !isInt(z.low) || !isInt(z.high) || (z.low as number) < 0 || (z.high as number) > 127 || (z.low as number) > (z.high as number)) {
        err(`${at}.keyswitchZone`, 'must be {low, high} integers 0–127 with low ≤ high');
      } else zone = { low: z.low as number, high: z.high as number };
    }
    if (part.playableLow !== undefined && (!isInt(part.playableLow) || (part.playableLow as number) < 0 || (part.playableLow as number) > 127)) {
      err(`${at}.playableLow`, 'must be an integer 0–127');
    }

    // Patch-side keyswitch names: a keyswitch table may describe articulations
    // the project never writes (an accent patch key, say) when a fallback chain
    // of the same part references them — pre-scan the chains for those names.
    const chainRefs = new Set<string>();
    const rawFb = part.fallback;
    if (typeof rawFb === 'object' && rawFb !== null) {
      for (const [, chain] of Object.entries(rawFb as Record<string, unknown>)) {
        if (Array.isArray(chain)) for (const e of chain) if (typeof e === 'string') chainRefs.add(e);
      }
    }

    if (!isInt(part.transposeSemitones) || Math.abs(part.transposeSemitones) > 36) err(`${at}.transposeSemitones`, 'must be an integer within ±36');
    if (typeof part.keyswitchLeadMs !== 'number' || !(part.keyswitchLeadMs > 0)) err(`${at}.keyswitchLeadMs`, 'must be a number > 0');
    if (typeof part.keyswitchLengthMs !== 'number' || !(part.keyswitchLengthMs > 0)) err(`${at}.keyswitchLengthMs`, 'must be a number > 0');
    if (part.tremoloMode !== undefined && part.tremoloMode !== 'sampled' && part.tremoloMode !== 'measured') err(`${at}.tremoloMode`, `must be "sampled" or "measured" (got ${JSON.stringify(part.tremoloMode)})`);

    // keyswitches: known names, parseable keys, below the playable floor
    const ks = part.keyswitches;
    if (typeof ks !== 'object' || ks === null) { err(`${at}.keyswitches`, 'must be an object'); return; }
    const keyOf: Record<string, number> = {};
    const keyNames = new Set(Object.keys(ks as Record<string, unknown>));
    for (const [art, keyName] of Object.entries(ks as Record<string, unknown>)) {
      if (!PROFILE_ARTS.includes(art) && !chainRefs.has(art)) { err(`${at}.keyswitches.${art}`, `unknown articulation ${JSON.stringify(art)} (expected one of ${PROFILE_ARTS.join(', ')} or a name referenced by this part's fallback chains)`); continue; }
      if (typeof keyName !== 'string') { err(`${at}.keyswitches.${art}`, 'key must be a name like "C0"'); continue; }
      const midi = conv ? keyNameToMidi(keyName, d.pitchConvention as string) : null;
      if (midi === null) { err(`${at}.keyswitches.${art}`, `unparseable key name ${JSON.stringify(keyName)}`); continue; }
      if (isInt(part.lowestPlayable) && midi >= part.lowestPlayable) err(`${at}.keyswitches.${art}`, `key ${keyName} (${midi}) is inside the part's playable range (lowest playable ${part.lowestPlayable})`);
      if (zone && (midi < zone.low || midi > zone.high)) err(`${at}.keyswitches.${art}`, `key ${keyName} (${midi}) lies outside the part's keyswitch zone [${zone.low}, ${zone.high}]`);
      if (isInt(part.playableLow) && midi >= part.playableLow) err(`${at}.keyswitches.${art}`, `key ${keyName} (${midi}) is not below the part's playableLow (${part.playableLow})`);
      keyOf[art] = midi;
    }

    // fallback chains: known names, acyclic, resolvable
    const fb = part.fallback;
    if (fb !== undefined) {
      if (typeof fb !== 'object' || fb === null) { err(`${at}.fallback`, 'must be an object'); return; }
      for (const [art, chain] of Object.entries(fb as Record<string, unknown>)) {
        if (!ARTICULATIONS.includes(art as never)) { err(`${at}.fallback.${art}`, `unknown articulation ${JSON.stringify(art)}`); continue; }
        if (!Array.isArray(chain) || !chain.length || !chain.every((e) => typeof e === 'string' && (PROFILE_ARTS.includes(e) || keyNames.has(e)))) {
          err(`${at}.fallback.${art}`, 'must be a non-empty array of articulation names (project articulations or this part\'s keyswitch names)'); continue;
        }
        const seen = new Set<string>([art]);
        for (const e of chain as string[]) {
          if (seen.has(e)) { err(`${at}.fallback.${art}`, `chain cycles at ${JSON.stringify(e)}`); break; }
          seen.add(e);
          if (keyOf[e] !== undefined) break; // resolves here
        }
      }
    }

    // every articulation resolves (with the same suppression the transform
    // uses) — skipped for keyswitchMode 'none' (no keyswitches exist there)
    if (part.keyswitchMode !== 'none') {
      for (const art of PROFILE_ARTS) {
        if (resolveArticulationKeyFor(part as unknown as ProfilePart, art, d.pitchConvention as string) === null) {
          err(`${at}`, `articulation ${JSON.stringify(art)} does not resolve to a keyswitch through its fallback chain`);
        }
      }
    }

    // Phase 12: keyswitchMode 'none' — the patch has no keyswitches at all
    if (part.keyswitchMode !== undefined && part.keyswitchMode !== 'standard' && part.keyswitchMode !== 'none') {
      err(`${at}.keyswitchMode`, `must be "standard" or "none" (got ${JSON.stringify(part.keyswitchMode)})`);
    }
    if (part.keyswitchMode === 'none') {
      const ksKeys = part.keyswitches && typeof part.keyswitches === 'object' ? Object.keys(part.keyswitches as Record<string, unknown>) : [];
      if (ksKeys.length) err(`${at}.keyswitches`, 'must be empty when keyswitchMode is "none" (the patch has no keyswitches)');
      if (part.fallback !== undefined && typeof part.fallback === 'object' && Object.keys(part.fallback as Record<string, unknown>).length) {
        err(`${at}.fallback`, 'must be empty when keyswitchMode is "none"');
      }
    }

    // Phase 12: the note map (export-only pitch remap)
    const nm = part.noteMap;
    if (nm !== undefined) {
      if (typeof nm !== 'object' || nm === null) { err(`${at}.noteMap`, 'must be an object'); }
      else {
        const m = nm as Record<string, unknown>;
        if (m.fixedPitch !== undefined && m.rotate !== undefined) err(`${at}.noteMap`, 'fixedPitch and rotate are mutually exclusive');
        if (m.fixedPitch !== undefined && (!isInt(m.fixedPitch) || (m.fixedPitch as number) < 0 || (m.fixedPitch as number) > 127)) {
          err(`${at}.noteMap.fixedPitch`, 'must be an integer 0–127');
        }
        if (m.rotate !== undefined) {
          const r = m.rotate as Record<string, unknown>;
          if (typeof r !== 'object' || r === null || !isInt(r.from) || (r.from as number) < 0 || (r.from as number) > 127) {
            err(`${at}.noteMap.rotate.from`, 'must be an integer 0–127');
          }
          if (typeof r.pool !== 'string' || !r.pool.trim()) {
            err(`${at}.noteMap.rotate.pool`, 'must name a profile pool');
          } else {
            const pool = d.pools && typeof d.pools === 'object' ? (d.pools as Record<string, unknown>)[r.pool as string] : undefined;
            if (!Array.isArray(pool)) err(`${at}.noteMap.rotate.pool`, `pool ${JSON.stringify(r.pool)} is not defined at profile level`);
            else if (pool.length < 2) err(`${at}.noteMap.rotate.pool`, 'pool must hold at least 2 keys (the no-immediate-repeat advance needs room)');
          }
        }
      }
    }

    // ccEnabled: integer keys 0–127, boolean values
    const cc = part.ccEnabled;
    if (cc !== undefined) {
      if (typeof cc !== 'object' || cc === null) err(`${at}.ccEnabled`, 'must be an object');
      else for (const [k, v] of Object.entries(cc as Record<string, unknown>)) {
        if (!/^\d+$/.test(k) || parseInt(k, 10) > 127) err(`${at}.ccEnabled.${k}`, 'controller number must be 0–127');
        if (typeof v !== 'boolean') err(`${at}.ccEnabled.${k}`, 'must be true or false');
      }
    }
  });

  // Phase 12: an unmapped role must not also be claimed by a part
  if (Array.isArray(d.unmapped)) {
    const claimed = new Set<string>();
    for (const rawPart of d.parts as Record<string, unknown>[]) {
      const src = rawPart && typeof rawPart === 'object' ? rawPart.source as Record<string, unknown> | undefined : undefined;
      if (src && typeof src.role === 'string') {
        claimed.add(src.role);
        const legacy = src.legacy as Record<string, unknown> | undefined;
        if (legacy && typeof legacy.role === 'string') claimed.add(legacy.role);
      }
    }
    for (const r of d.unmapped as string[]) {
      if (claimed.has(r)) err('unmapped', `role ${JSON.stringify(r)} is also claimed by a part — a role is either mapped or unmapped, not both`);
    }
  }

  if (d.unverified !== undefined) {
    if (!Array.isArray(d.unverified) || !d.unverified.every((v) => typeof v === 'string')) err('unverified', 'must be an array of value paths');
  }
  return errors;
}

/** Parses + validates a profile document; throws with the error list when invalid. */
export function parseExportProfile(doc: unknown): ExportProfile {
  const errors = validateExportProfile(doc);
  if (errors.length) throw new Error(`invalid export profile:\n  ${errors.join('\n  ')}`);
  const d = doc as Record<string, unknown>;
  return {
    id: d.id as string,
    name: d.name as string,
    pitchConvention: d.pitchConvention as string,
    keyswitchVelocity: d.keyswitchVelocity as number,
    cbLayer: (d.cbLayer as 'separate' | 'omit' | undefined) ?? 'separate',
    ...(d.pools !== undefined
      ? { pools: Object.fromEntries(Object.entries(d.pools as Record<string, number[]>).map(([k, v]) => [k, [...v]])) }
      : {}),
    ...(d.unmapped !== undefined ? { unmapped: [...(d.unmapped as string[])] } : {}),
    parts: (d.parts as Record<string, unknown>[]).map((part) => ({
      id: part.id as string,
      patch: part.patch as string,
      channel: part.channel as number,
      source: {
        role: (part.source as Record<string, unknown>).role as string,
        ...((part.source as Record<string, unknown>).layer !== undefined ? { layer: (part.source as Record<string, unknown>).layer as 'cb' | null } : {}),
        ...((part.source as Record<string, unknown>).legacy !== undefined
          ? {
              legacy: {
                role: ((part.source as Record<string, unknown>).legacy as Record<string, unknown>).role as string,
                ...(((part.source as Record<string, unknown>).legacy as Record<string, unknown>).layer !== undefined
                  ? { layer: ((part.source as Record<string, unknown>).legacy as Record<string, unknown>).layer as 'cb' | null }
                  : {}),
              },
            }
          : {}),
      },
      lowestPlayable: part.lowestPlayable as number,
      ...((part as Record<string, unknown>).keyswitchZone !== undefined
        ? { keyswitchZone: { low: ((part as Record<string, unknown>).keyswitchZone as { low: number }).low, high: ((part as Record<string, unknown>).keyswitchZone as { high: number }).high } }
        : {}),
      ...((part as Record<string, unknown>).playableLow !== undefined ? { playableLow: (part as Record<string, unknown>).playableLow as number } : {}),
      keyswitches: { ...(part.keyswitches as Record<string, string>) },
      fallback: Object.fromEntries(Object.entries((part.fallback as Record<string, string[]> | undefined) ?? {}).map(([k, v]) => [k, [...v]])),
      transposeSemitones: part.transposeSemitones as number,
      keyswitchLeadMs: part.keyswitchLeadMs as number,
      keyswitchLengthMs: part.keyswitchLengthMs as number,
      tremoloMode: (part.tremoloMode as 'sampled' | 'measured' | undefined) ?? 'sampled',
      ccEnabled: { ...(part.ccEnabled as Record<string, boolean> | undefined) },
      ...(part.keyswitchMode === 'none' ? { keyswitchMode: 'none' as const } : {}),
      ...(part.fileScope === 'fileOnly' ? { fileScope: 'fileOnly' as const } : {}),
      ...(part.doublingCandidate === false ? { doublingCandidate: false as const } : {}),
      ...((part as Record<string, unknown>).noteMap !== undefined
        ? {
            noteMap: {
              ...((part as Record<string, unknown>).noteMap as { fixedPitch?: number }).fixedPitch !== undefined
                ? { fixedPitch: ((part as Record<string, unknown>).noteMap as { fixedPitch: number }).fixedPitch }
                : {},
              ...((part as Record<string, unknown>).noteMap as { rotate?: { from: number; pool: string } }).rotate !== undefined
                ? { rotate: { ...((part as Record<string, unknown>).noteMap as { rotate: { from: number; pool: string } }).rotate } }
                : {},
            },
          }
        : {}),
    })),
  };
}

/* ---------------- articulation → keyswitch resolution ---------------- */

/**
 * Resolves one articulation to the keyswitch midi number it must sound
 * with, following the part's fallback chain; the chain's terminal default
 * is 'sustain'. In 'measured' tremolo mode the tremolo keyswitch is
 * suppressed — the repeats resolve through the chain instead (Sustain or
 * Marcato). Returns null only for profiles the validator would reject.
 */
export function resolveArticulationKeyFor(part: ProfilePart, articulation: string, convention: string): number | null {
  const keyMidi = (name: string): number | null => keyNameToMidi(name, convention);
  const follow = (art: string, seen: Set<string>): number | null => {
    if (seen.has(art)) return null;
    seen.add(art);
    if (!(part.tremoloMode === 'measured' && art === 'tremolo')) {
      const name = part.keyswitches[art];
      if (name !== undefined) {
        const midi = keyMidi(name);
        if (midi !== null) return midi;
      }
    }
    for (const e of part.fallback[art] ?? []) {
      const r = follow(e, seen);
      if (r !== null) return r;
    }
    return null;
  };
  const direct = follow(articulation, new Set());
  if (direct !== null) return direct;
  const sustain = part.keyswitches[PROFILE_SUSTAIN];
  return sustain !== undefined ? keyMidi(sustain) : null;
}

/* ---------------- export transform ---------------- */

/** One exportable voice: a named, channel-bound note list + CC lanes. */
export interface ExportChunk {
  /** Source track id (the per-file naming reads the project order from it). */
  trackId: string;
  name: string;
  channel: number;
  notes: Note[];
  cc?: CcLane[];
  /** Phase 12: set for fileScope 'fileOnly' parts — the merged file skips
   *  the chunk; the per-track writer keeps it. */
  fileOnly?: boolean;
}

/** The renderer tiles its measured tremolo at this step (lines/ostinato.ts);
 *  repeats spaced at most this far apart belong to one mergeable group. */
export const TREMOLO_GROUP_MAX_STEP_TICKS = 240;

/**
 * Merges the measured tremolo repeats into sustained notes, in the export
 * only. A group is consecutive repeats of one pitch (spacing ≤ the repeat
 * step); the merged note spans the first start to the last end and keeps
 * the first repeat's velocity (the arc value at the group's onset). Groups
 * are built PER PITCH (Phase 7): a part may carry two divisi lines, whose
 * repeats interleave in time — grouping per pitch merges each line
 * independently and leaves single-voice parts byte-identical.
 */
export function mergeTremoloGroups(notes: Note[]): Note[] {
  const sorted = [...notes].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
  const out: Note[] = [];
  const passthrough = (n: Note) => out.push(n);
  // one merge stream per pitch class+octave: a divisi part's two lines never share a pitch
  const byPitch = new Map<number, Note[]>();
  for (const n of sorted) {
    if (n.articulation !== 'tremolo') { passthrough(n); continue; }
    const list = byPitch.get(n.pitch) ?? [];
    list.push(n);
    byPitch.set(n.pitch, list);
  }
  for (const [, list] of [...byPitch.entries()].sort((a, b) => a[0] - b[0])) {
    let i = 0;
    while (i < list.length) {
      const first = list[i];
      let last = first;
      let j = i + 1;
      while (j < list.length && list[j].startTick - last.startTick <= TREMOLO_GROUP_MAX_STEP_TICKS) { last = list[j]; j++; }
      if (j === i + 1) passthrough(first);
      else passthrough({ pitch: first.pitch, startTick: first.startTick, durationTicks: Math.max(1, last.startTick + last.durationTicks - first.startTick), velocity: first.velocity });
      i = j;
    }
  }
  // restore the time order the writer (and the keyswitch pass) expect
  return out.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
}

/** ms → ticks as a DURATION at tick `at`, through the project's tempo map. */
const msToTicksAt = (ms: number, at: number, tempoMap: Project['tempoMap']): number => {
  const baseMs = ticksToMs(at, tempoMap);
  return msToTicks(baseMs + ms, tempoMap) - msToTicks(baseMs, tempoMap);
};

/**
 * The keyswitch notes for one part: one ahead of the first note of each
 * articulation change (and always ahead of the part's first note). The
 * lead sits ~keyswitchLeadMs before the trigger through the tempo map; the
 * keyswitch ends at or before its trigger note starts; velocity is the
 * profile's keyswitchVelocity.
 */
export function keyswitchNotesFor(part: ProfilePart, notes: Note[], project: Project, profile: ExportProfile): Note[] {
  const out: Note[] = [];
  if (!notes.length) return out;
  const sorted = [...notes].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
  let current: number | null = null;
  for (const n of sorted) {
    const art = n.articulation ?? PROFILE_SUSTAIN;
    const key = resolveArticulationKeyFor(part, art, profile.pitchConvention);
    if (key === null) continue; // validator guarantees resolution; belt + braces
    if (current !== null && current === key) continue; // emit only on change
    const leadTicks = Math.max(1, Math.round(msToTicksAt(part.keyswitchLeadMs, n.startTick, project.tempoMap)));
    const start = Math.max(0, n.startTick - leadTicks);
    let end = Math.min(n.startTick, start + Math.max(1, Math.round(msToTicksAt(part.keyswitchLengthMs, start, project.tempoMap))));
    if (end <= start) end = start + 1; // a trigger at tick 0 has no room — still fire the switch
    out.push({ pitch: key, startTick: start, durationTicks: end - start, velocity: profile.keyswitchVelocity });
    current = key;
  }
  return out;
}

/** Per-part red-zone fold counts (Phase 8.2): the optional stats sink the
 *  tests and the phase report read. Dropped = fold exceeds the hard range or
 *  (forbidden policy) would create a new unison/octave doubling. */
export interface FoldStats {
  folded: Record<string, number>;
  droppedHardRange: Record<string, number>;
  droppedDoubling: Record<string, number>;
  /** Phase 12: notes remapped by a part's noteMap (the rotated snare keys,
   *  the fixed cymbal key). Optional so pre-12 stats sinks keep type-checking. */
  remapped?: Record<string, number>;
}

const emptyFoldStats = (): FoldStats => ({ folded: {}, droppedHardRange: {}, droppedDoubling: {} });

const bump = (rec: Record<string, number>, id: string): void => { rec[id] = (rec[id] ?? 0) + 1; };

/** Sounding pitches of every MERGED doubling-candidate part's sources (own
 *  role + legacy claim), transposed and TAGGED with the part id — the fold's
 *  doubling check reads every candidate part but its own. A fileScope
 *  'fileOnly' part sounds in another FILE, and a part with
 *  doublingCandidate false (the Phase 12 additions) is not a candidate the
 *  template's rule ever governed — neither is a fold-clash source. Built
 *  lazily, once per track. */
const allPartPitches = (project: Project, profile: ExportProfile): { partId: string; start: number; end: number; pitch: number }[] => {
  const out: { partId: string; start: number; end: number; pitch: number }[] = [];
  for (const part of profile.parts) {
    if (part.fileScope === 'fileOnly' || part.doublingCandidate === false) continue;
    const sources: ProfileSource[] = [part.source];
    if (part.source.legacy) sources.push({ role: part.source.legacy.role, ...(part.source.legacy.layer !== undefined ? { layer: part.source.legacy.layer } : {}) });
    for (const t of project.tracks) {
      if (!isInstrumentTrack(t)) continue;
      for (const src of sources) {
        if (src.role !== t.role) continue;
        const visible = profile.cbLayer !== 'separate' ? t.notes.filter((n) => n.layer !== 'cb') : t.notes;
        for (const n of visible) {
          if (!noteMatchesSource(n, src)) continue;
          out.push({ partId: part.id, start: n.startTick, end: n.startTick + n.durationTicks, pitch: Math.max(0, Math.min(127, n.pitch + part.transposeSemitones)) });
        }
      }
    }
  }
  return out;
};

const noteMatchesSource = (n: Note, source: ProfileSource): boolean =>
  source.layer === 'cb' ? n.layer === 'cb'
    : source.layer === null ? n.layer !== 'cb'
      : true;

const ccForPart = (cc: CcLane[] | undefined, enabled: Record<string, boolean>): CcLane[] | undefined => {
  if (!cc) return undefined;
  const lanes = cc.filter((lane) => lane && enabled[String(lane.cc)] === true);
  return lanes.length ? lanes : undefined;
};

/* ---------------- the note map (Phase 12: export-only pitch remap) --------- */

/**
 * Applies a part's noteMap in the EXPORT only. fixedPitch: every note takes
 * that one key. rotate: the notes at `from` rotate through the named pool —
 * a hash-seeded draw per note (part id, pitch, tick, duration and the
 * note's index seed it) that never repeats the previous rotated key.
 * Deterministic: a pure function of the note sequence. Timing, velocity and
 * the note count are untouched; the project never sees any of it.
 */
export function applyNoteMap(part: ProfilePart, notes: Note[], profile: ExportProfile, stats?: FoldStats): Note[] {
  const map = part.noteMap;
  if (!map) return notes;
  if (map.fixedPitch !== undefined) {
    if (stats && notes.length) (stats.remapped ??= {})[part.id] = (stats.remapped?.[part.id] ?? 0) + notes.length;
    return notes.map((n) => ({ ...n, pitch: map.fixedPitch! }));
  }
  if (!map.rotate) return notes;
  const pool = profile.pools?.[map.rotate.pool];
  if (!pool || pool.length < 2) return notes; // validator guarantees; belt + braces
  const order = notes.map((n, i) => ({ n, i })).sort((a, b) => a.n.startTick - b.n.startTick || a.n.pitch - b.n.pitch || a.i - b.i);
  const out: Note[] = new Array(notes.length);
  let prev: number | null = null;
  let remapped = 0;
  for (const { n, i } of order) {
    if (n.pitch !== map.rotate.from) { out[i] = n; continue; }
    let idx = hashString(`${part.id}|${n.pitch}|${n.startTick}|${n.durationTicks}|${i}`) % pool.length;
    let key = pool[idx];
    if (prev !== null && key === prev) { idx = (idx + 1) % pool.length; key = pool[idx]; }
    out[i] = { ...n, pitch: key };
    prev = key;
    remapped++;
  }
  if (stats && remapped) (stats.remapped ??= {})[part.id] = (stats.remapped?.[part.id] ?? 0) + remapped;
  return out;
}

/**
 * Maps one exportable track to its export chunks. Without a profile: the
 * track itself, untouched (byte-identical writer input). With a profile:
 * one chunk per part whose source (own role, or the Phase 8.2 legacy claim)
 * matches the track's role — with cbLayer 'separate' a legacy combined
 * cellosBasses track splits by the note layer into its cello and bass
 * parts; a project's own basses track feeds the Bass part directly. Each
 * part is transposed, note-mapped (Phase 12: an export-only pitch remap —
 * the rotated snare keys, the fixed cymbal key), FOLDED into the playable
 * range (Phase 8.2: notes below
 * playableLow shift up by whole octaves — dropped only when the fold would
 * exceed the part's hard range, the source track's highestNote, or, under an
 * octaveDoubling policy of 'forbidden', create a new unison/octave doubling
 * with another part at the same moment), tremolo-merged (sampled mode) and
 * fronted by its keyswitches. Notes that no part claims pass through
 * unchanged (no part, no known floor). A role the profile lists as unmapped
 * (Phase 12) exports nothing — its notes stay in the project. The project is
 * never touched.
 */
export function chunksForTrack(project: Project, track: Track, profile: ExportProfile | null, stats?: FoldStats): ExportChunk[] {
  const fold = stats ?? emptyFoldStats();
  // cbLayer 'omit': the Cb-layer notes of a combined track are not exported
  // at all — no part claims them and they never reach a passthrough chunk.
  const omit = profile !== null && profile.cbLayer !== 'separate';
  const visible = omit ? track.notes.filter((n) => n.layer !== 'cb') : track.notes;
  const passthrough = (): ExportChunk => ({ trackId: track.id, name: track.name, channel: track.midiChannel, notes: visible, ...(track.cc !== undefined ? { cc: track.cc } : {}) });
  if (!profile) return [passthrough()];
  // Phase 12: a deliberately unmapped role stays out of the export entirely
  // (the dialog and the report say so; the project keeps its notes).
  if (profile.unmapped?.includes(track.role)) return [];

  // the part↔track match: the part's own source role, or (cbLayer
  // 'separate') its Phase 8.2 legacy claim
  const sourceFor = (part: ProfilePart): ProfileSource | null => {
    if (part.source.role === track.role) return part.source;
    if (!omit && part.source.legacy && part.source.legacy.role === track.role) {
      return { role: part.source.legacy.role, ...(part.source.legacy.layer !== undefined ? { layer: part.source.legacy.layer } : {}) };
    }
    return null;
  };
  const parts = profile.parts.filter((p) => sourceFor(p) !== null);
  if (!parts.length) return [passthrough()];

  // the fold's doubling check is needed only when the template forbids
  // octave doublings; the sounding pitches of the parts' sources are built
  // lazily, once per track, tagged by part (a part never clashes with itself)
  const template = resolveTemplate(project.ensemble);
  const forbidFoldDoubling = template?.rules.some((r) => r.type === 'octaveDoubling' && r.params.policy === 'forbidden') ?? false;
  let others: { partId: string; start: number; end: number; pitch: number }[] | null = null;
  const othersOf = (): { partId: string; start: number; end: number; pitch: number }[] => (others ??= allPartPitches(project, profile));

  const chunks: ExportChunk[] = [];
  const claimed = new Set<Note>();
  let anyMatched = false;
  for (const part of parts) {
    const eff = sourceFor(part)!;
    const matched = visible.filter((n) => noteMatchesSource(n, eff) && !claimed.has(n));
    for (const n of matched) claimed.add(n);
    if (!matched.length) continue;
    anyMatched = true;
    const transposed = part.transposeSemitones
      ? matched.map((n) => ({ ...n, pitch: Math.max(0, Math.min(127, n.pitch + part.transposeSemitones)) }))
      : matched;
    // Phase 12: the note map runs before the fold guard, so a remapped key
    // (all ≥ the patch's playable floor by construction) is never folded.
    const mapped = applyNoteMap(part, transposed, profile, fold);
    // Red-zone fold (Phase 8.2, replaces the 8.1 drop): a non-keyswitch note
    // below playableLow shifts up by whole octaves until it is playable.
    // It is dropped only when the folded pitch would exceed the part's hard
    // range (the source track's highestNote) or — octaveDoubling policy
    // 'forbidden' — when the fold would create a NEW unison or octave
    // doubling with another part at the same moment. The guard runs on the
    // transposed notes, before the merge (a folded repeat merges like any
    // other); keyswitches are generated after it, so they are never folded.
    let guarded: Note[];
    if (part.playableLow === undefined) {
      guarded = mapped;
    } else {
      guarded = [];
      for (const n of mapped) {
        if (n.pitch >= part.playableLow) { guarded.push(n); continue; }
        let p = n.pitch;
        while (p < part.playableLow) p += 12;
        if (p > track.highestNote) { bump(fold.droppedHardRange, part.id); continue; }
        if (forbidFoldDoubling) {
          const list = othersOf();
          const clash = list.some((o) => o.partId !== part.id
            && o.start < n.startTick + n.durationTicks && o.start + (o.end - o.start) > n.startTick
            && (Math.abs(o.pitch - p) === 0 || Math.abs(o.pitch - p) === 12 || Math.abs(o.pitch - p) === 24));
          if (clash) { bump(fold.droppedDoubling, part.id); continue; }
        }
        bump(fold.folded, part.id);
        guarded.push({ ...n, pitch: p });
      }
    }
    if (!guarded.length) continue; // everything dropped: no part file at all
    const merged = part.tremoloMode === 'sampled' ? mergeTremoloGroups(guarded) : guarded;
    const notes = [...keyswitchNotesFor(part, merged, project, profile), ...merged].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
    chunks.push({
      trackId: track.id, name: part.patch, channel: part.channel, notes,
      ...(part.fileScope === 'fileOnly' ? { fileOnly: true } : {}),
      ...(ccForPart(track.cc, part.ccEnabled) !== undefined ? { cc: ccForPart(track.cc, part.ccEnabled)! } : {}),
    });
  }
  const rest = visible.filter((n) => !claimed.has(n));
  if (rest.length) chunks.push({ trackId: track.id, name: track.name, channel: track.midiChannel, notes: rest, ...(track.cc !== undefined ? { cc: track.cc } : {}) });
  if (chunks.length) return chunks;
  // Every matched note was fold-dropped: the track maps to a patch that
  // cannot sound any of it — export nothing for it (a passthrough here would
  // reintroduce exactly the notes the fold exists to lift). A track whose
  // parts matched NOTHING is still unmapped: passthrough as before.
  return anyMatched ? [] : [passthrough()];
}

/* ---------------- the export dialog's per-part lines (Phase 12) ------------ */

/**
 * One human line per profile part — channel, keyswitches, note map, the
 * fold floor — plus one line per unmapped role. The export dialog renders
 * these verbatim; the tests read them as the report's channel table.
 */
export function profilePartSummary(profile: ExportProfile): string[] {
  const lines: string[] = [];
  for (const p of profile.parts) {
    const ks = p.keyswitchMode === 'none' || !Object.keys(p.keyswitches).length
      ? 'no keyswitch'
      : Object.entries(p.keyswitches).map(([art, name]) => `${name} = ${art}`).join(', ');
    const where = p.fileScope === 'fileOnly' ? `ch ${p.channel} (own file only)` : `ch ${p.channel}`;
    const map = p.noteMap?.fixedPitch !== undefined
      ? `every note → key ${p.noteMap.fixedPitch}`
      : p.noteMap?.rotate
        ? `note ${p.noteMap.rotate.from} → ${profile.pools?.[p.noteMap.rotate.pool]?.length ?? 0}-key pool ${p.noteMap.rotate.pool}, rotated per note`
        : p.playableLow !== undefined
          ? `notes below ${p.playableLow} fold up by octaves`
          : '';
    lines.push(`${where} · ${p.patch} · ${ks}${map ? ` · ${map}` : ''}`);
  }
  for (const role of profile.unmapped ?? []) {
    lines.push(`${role} — unmapped: its notes stay in the project and are left out of the export`);
  }
  return lines;
}

/**
 * The one-line statement of what the merged file cannot carry (null when
 * every part rides in the merged file).
 */
export function profileScopeNote(profile: ExportProfile): string | null {
  const fileOnly = profile.parts.filter((p) => p.fileScope === 'fileOnly');
  if (!fileOnly.length) return null;
  const list = fileOnly.map((p) => `${p.patch} (ch ${p.channel})`).join(', ');
  return `The merged file carries what fits and avoids channel 10; ${list} export as their own files — load each on its own channel or Falcon instance.`;
}
