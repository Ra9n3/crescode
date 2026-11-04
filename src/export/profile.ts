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
 */
import { ARTICULATIONS, type CcLane, type Note, type Project, type Track } from '../shared/schema/types';
import { msToTicks, ticksToMs } from '../orchestrator/spine';

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
}

export interface ProfilePart {
  id: string;
  /** The patch to load on this part's channel (data, not code). */
  patch: string;
  channel: number;
  source: ProfileSource;
  /** Sounding midi floor of the patch — every keyswitch key must sit below it. */
  lowestPlayable: number;
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
}

export interface ExportProfile {
  id: string;
  name: string;
  pitchConvention: string;
  keyswitchVelocity: number;
  /** How the Cb layer of a layered track exports: 'separate' gives the
   *  layer:'cb' notes their own part (own channel + file); 'omit' — the
   *  default — drops the Cb-layer notes from the export entirely, so no
   *  Bass part or file is created. */
  cbLayer: 'separate' | 'omit';
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
  if (!Array.isArray(d.parts) || !d.parts.length) { err('parts', 'must be a non-empty array'); return errors; }

  const seenChannel = new Map<number, string>();
  const seenSource = new Map<string, string>();
  d.parts.forEach((rawPart, i) => {
    const at = `parts[${i}]`;
    if (typeof rawPart !== 'object' || rawPart === null) { err(at, 'must be an object'); return; }
    const part = rawPart as Record<string, unknown>;
    if (typeof part.id !== 'string' || !part.id.trim()) err(`${at}.id`, 'must be a non-empty string');
    if (typeof part.patch !== 'string' || !part.patch.trim()) err(`${at}.patch`, 'must be a non-empty string');
    if (!isInt(part.channel) || part.channel < 1 || part.channel > 16) err(`${at}.channel`, 'must be an integer 1–16');
    else if (seenChannel.has(part.channel)) err(`${at}.channel`, `channel ${part.channel} is already used by ${seenChannel.get(part.channel)}`);
    else seenChannel.set(part.channel, String(part.id) || at);

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
    }

    if (!isInt(part.lowestPlayable) || part.lowestPlayable < 0 || part.lowestPlayable > 127) err(`${at}.lowestPlayable`, 'must be an integer 0–127');
    if (!isInt(part.transposeSemitones) || Math.abs(part.transposeSemitones) > 36) err(`${at}.transposeSemitones`, 'must be an integer within ±36');
    if (typeof part.keyswitchLeadMs !== 'number' || !(part.keyswitchLeadMs > 0)) err(`${at}.keyswitchLeadMs`, 'must be a number > 0');
    if (typeof part.keyswitchLengthMs !== 'number' || !(part.keyswitchLengthMs > 0)) err(`${at}.keyswitchLengthMs`, 'must be a number > 0');
    if (part.tremoloMode !== undefined && part.tremoloMode !== 'sampled' && part.tremoloMode !== 'measured') err(`${at}.tremoloMode`, `must be "sampled" or "measured" (got ${JSON.stringify(part.tremoloMode)})`);

    // keyswitches: known names, parseable keys, below the playable floor
    const ks = part.keyswitches;
    if (typeof ks !== 'object' || ks === null) { err(`${at}.keyswitches`, 'must be an object'); return; }
    const keyOf: Record<string, number> = {};
    for (const [art, keyName] of Object.entries(ks as Record<string, unknown>)) {
      if (!PROFILE_ARTS.includes(art)) { err(`${at}.keyswitches.${art}`, `unknown articulation ${JSON.stringify(art)} (expected one of ${PROFILE_ARTS.join(', ')})`); continue; }
      if (typeof keyName !== 'string') { err(`${at}.keyswitches.${art}`, 'key must be a name like "C0"'); continue; }
      const midi = conv ? keyNameToMidi(keyName, d.pitchConvention as string) : null;
      if (midi === null) { err(`${at}.keyswitches.${art}`, `unparseable key name ${JSON.stringify(keyName)}`); continue; }
      if (isInt(part.lowestPlayable) && midi >= part.lowestPlayable) err(`${at}.keyswitches.${art}`, `key ${keyName} (${midi}) is inside the part's playable range (lowest playable ${part.lowestPlayable})`);
      keyOf[art] = midi;
    }

    // fallback chains: known names, acyclic, resolvable
    const fb = part.fallback;
    if (fb !== undefined) {
      if (typeof fb !== 'object' || fb === null) { err(`${at}.fallback`, 'must be an object'); return; }
      for (const [art, chain] of Object.entries(fb as Record<string, unknown>)) {
        if (!ARTICULATIONS.includes(art as never)) { err(`${at}.fallback.${art}`, `unknown articulation ${JSON.stringify(art)}`); continue; }
        if (!Array.isArray(chain) || !chain.length || !chain.every((e) => typeof e === 'string' && PROFILE_ARTS.includes(e))) {
          err(`${at}.fallback.${art}`, 'must be a non-empty array of articulation names'); continue;
        }
        const seen = new Set<string>([art]);
        for (const e of chain as string[]) {
          if (seen.has(e)) { err(`${at}.fallback.${art}`, `chain cycles at ${JSON.stringify(e)}`); break; }
          seen.add(e);
          if (keyOf[e] !== undefined) break; // resolves here
        }
      }
    }

    // every articulation resolves (with the same suppression the transform uses)
    for (const art of PROFILE_ARTS) {
      if (resolveArticulationKeyFor(part as unknown as ProfilePart, art, d.pitchConvention as string) === null) {
        err(`${at}`, `articulation ${JSON.stringify(art)} does not resolve to a keyswitch through its fallback chain`);
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
    cbLayer: (d.cbLayer as 'separate' | 'omit' | undefined) ?? 'omit',
    parts: (d.parts as Record<string, unknown>[]).map((part) => ({
      id: part.id as string,
      patch: part.patch as string,
      channel: part.channel as number,
      source: { role: (part.source as Record<string, unknown>).role as string, ...((part.source as Record<string, unknown>).layer !== undefined ? { layer: (part.source as Record<string, unknown>).layer as 'cb' | null } : {}) },
      lowestPlayable: part.lowestPlayable as number,
      keyswitches: { ...(part.keyswitches as Record<string, string>) },
      fallback: Object.fromEntries(Object.entries((part.fallback as Record<string, string[]> | undefined) ?? {}).map(([k, v]) => [k, [...v]])),
      transposeSemitones: part.transposeSemitones as number,
      keyswitchLeadMs: part.keyswitchLeadMs as number,
      keyswitchLengthMs: part.keyswitchLengthMs as number,
      tremoloMode: (part.tremoloMode as 'sampled' | 'measured' | undefined) ?? 'sampled',
      ccEnabled: { ...(part.ccEnabled as Record<string, boolean> | undefined) },
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
}

/** The renderer tiles its measured tremolo at this step (lines/ostinato.ts);
 *  repeats spaced at most this far apart belong to one mergeable group. */
export const TREMOLO_GROUP_MAX_STEP_TICKS = 240;

/**
 * Merges the measured tremolo repeats into sustained notes, in the export
 * only. A group is consecutive repeats of one pitch (spacing ≤ the repeat
 * step); the merged note spans the first start to the last end and keeps
 * the first repeat's velocity (the arc value at the group's onset).
 */
export function mergeTremoloGroups(notes: Note[]): Note[] {
  const sorted = [...notes].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
  const out: Note[] = [];
  let i = 0;
  while (i < sorted.length) {
    const first = sorted[i];
    if (first.articulation !== 'tremolo') { out.push(first); i++; continue; }
    let last = first;
    let j = i + 1;
    while (j < sorted.length) {
      const m = sorted[j];
      if (m.articulation === 'tremolo' && m.pitch === last.pitch && m.startTick - last.startTick <= TREMOLO_GROUP_MAX_STEP_TICKS) { last = m; j++; }
      else break;
    }
    if (j === i + 1) out.push(first);
    else out.push({ pitch: first.pitch, startTick: first.startTick, durationTicks: Math.max(1, last.startTick + last.durationTicks - first.startTick), velocity: first.velocity });
    i = j;
  }
  return out;
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

const noteMatchesSource = (n: Note, source: ProfileSource): boolean =>
  source.layer === 'cb' ? n.layer === 'cb'
    : source.layer === null ? n.layer !== 'cb'
      : true;

const ccForPart = (cc: CcLane[] | undefined, enabled: Record<string, boolean>): CcLane[] | undefined => {
  if (!cc) return undefined;
  const lanes = cc.filter((lane) => lane && enabled[String(lane.cc)] === true);
  return lanes.length ? lanes : undefined;
};

/**
 * Maps one exportable track to its export chunks. Without a profile: the
 * track itself, untouched (byte-identical writer input). With a profile:
 * one chunk per part whose source matches the track's role — with
 * cbLayer 'separate' the cellosBasses track splits by the note layer into
 * its cello and bass parts; with 'omit' (the default) the Cb-layer notes
 * are not exported at all and no Bass part exists. Each part is
 * transposed, tremolo-merged (sampled mode) and fronted by its
 * keyswitches. Notes that no part claims pass through unchanged.
 */
export function chunksForTrack(project: Project, track: Track, profile: ExportProfile | null): ExportChunk[] {
  // cbLayer 'omit' (the default): the Cb-layer notes are not exported at all —
  // no part claims them and they never reach a passthrough chunk either.
  const omit = profile !== null && profile.cbLayer !== 'separate';
  const visible = omit ? track.notes.filter((n) => n.layer !== 'cb') : track.notes;
  const passthrough = (): ExportChunk => ({ trackId: track.id, name: track.name, channel: track.midiChannel, notes: visible, ...(track.cc !== undefined ? { cc: track.cc } : {}) });
  if (!profile) return [passthrough()];
  const parts = profile.parts.filter((p) => p.source.role === track.role && !(omit && p.source.layer === 'cb'));
  if (!parts.length) return [passthrough()];

  const chunks: ExportChunk[] = [];
  const claimed = new Set<Note>();
  for (const part of parts) {
    const matched = visible.filter((n) => noteMatchesSource(n, part.source) && !claimed.has(n));
    for (const n of matched) claimed.add(n);
    if (!matched.length) continue;
    const transposed = part.transposeSemitones
      ? matched.map((n) => ({ ...n, pitch: Math.max(0, Math.min(127, n.pitch + part.transposeSemitones)) }))
      : matched;
    const merged = part.tremoloMode === 'sampled' ? mergeTremoloGroups(transposed) : transposed;
    const notes = [...keyswitchNotesFor(part, merged, project, profile), ...merged].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
    chunks.push({ trackId: track.id, name: part.patch, channel: part.channel, notes, ...(ccForPart(track.cc, part.ccEnabled) !== undefined ? { cc: ccForPart(track.cc, part.ccEnabled)! } : {}) });
  }
  const rest = visible.filter((n) => !claimed.has(n));
  if (rest.length) chunks.push({ trackId: track.id, name: track.name, channel: track.midiChannel, notes: rest, ...(track.cc !== undefined ? { cc: track.cc } : {}) });
  return chunks.length ? chunks : [passthrough()];
}
