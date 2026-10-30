import { parseChord } from './chords';
import { MODES } from './modes';
import { projectEndTick } from './meter';
import { noteName } from './modes';
import type { Project } from './types';

export interface ValidationError { path: string; message: string }
export type ValidationResult = { ok: true; errors: [] } | { ok: false; errors: ValidationError[] };

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const FAMILIES = ['Structure', 'Audio', 'Strings', 'Brass', 'Woodwinds', 'Percussion', 'Keys'];
export const MAX_TRACKS_PER_GROUP = 16;

/** Validates a project document. Never throws; returns every problem found with a readable message. */
export function validateProject(input: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const err = (path: string, message: string) => errors.push({ path, message });
  if (!input || typeof input !== 'object') return { ok: false, errors: [{ path: '', message: 'Project must be a JSON object' }] };
  const p = input as Project;

  if (!isInt(p.schemaVersion) || p.schemaVersion < 1) err('schemaVersion', 'schemaVersion must be a positive integer');
  if (typeof p.name !== 'string') err('name', 'name must be text');
  if (!isNum(p.bpm) || p.bpm < 20 || p.bpm > 400) err('bpm', `BPM must be between 20 and 400 (got ${p.bpm})`);
  if (!Array.isArray(p.tempoMap) || p.tempoMap.length < 1) err('tempoMap', 'tempoMap must contain at least one entry');
  else if (p.tempoMap.length > 1) err('tempoMap', 'Tempo changes are not supported in v1 (tempoMap must have exactly one entry)');
  else if (p.tempoMap[0].tick !== 0) err('tempoMap[0].tick', 'The tempo entry must start at tick 0');
  const ts = p.timeSignature;
  if (!ts || !isInt(ts.numerator) || ts.numerator < 1 || ts.numerator > 32) err('timeSignature.numerator', 'Time signature numerator must be 1–32');
  if (!ts || ![1, 2, 4, 8, 16, 32].includes(ts.denominator)) err('timeSignature.denominator', 'Time signature denominator must be 1, 2, 4, 8, 16 or 32');
  if (!isInt(p.key) || p.key < 0 || p.key > 11) err('key', `key must be a pitch class 0–11 (got ${p.key})`);
  if (!(p.mode in MODES)) err('mode', `Unknown mode "${p.mode}"`);
  if (!isNum(p.masterVolume) || p.masterVolume < 0 || p.masterVolume > 1.5) err('masterVolume', 'masterVolume must be 0–1.5');
  if (!p.referenceAudio || typeof p.referenceAudio !== 'object') err('referenceAudio', 'referenceAudio is required');
  else if (!isNum(p.referenceAudio.offsetMs)) err('referenceAudio.offsetMs', 'offsetMs must be a number');

  if (!Array.isArray(p.sections)) err('sections', 'sections must be an array');
  if (!Array.isArray(p.chords)) err('chords', 'chords must be an array');
  if (!Array.isArray(p.tracks)) err('tracks', 'tracks must be an array');
  if (!Array.isArray(p.libraryGroups)) err('libraryGroups', 'libraryGroups must be an array');
  if (errors.length && (!Array.isArray(p.sections) || !Array.isArray(p.chords) || !Array.isArray(p.tracks) || !Array.isArray(p.libraryGroups) || !ts)) {
    return { ok: false, errors };
  }

  const ids = new Set<string>();
  const dupe = (path: string, id: string) => { if (ids.has(id)) err(path, `Duplicate id "${id}"`); ids.add(id); };

  p.sections.forEach((s, i) => {
    const at = `sections[${i}]`;
    dupe(`${at}.id`, s.id);
    if (!s.name || typeof s.name !== 'string') err(`${at}.name`, 'Section needs a name');
    if (!isInt(s.startBar) || s.startBar < 1) err(`${at}.startBar`, `Section "${s.name}": startBar must be ≥ 1`);
    if (!isInt(s.lengthBars) || s.lengthBars < 1) err(`${at}.lengthBars`, `Section "${s.name}": lengthBars must be ≥ 1`);
  });
  const sorted = [...p.sections].sort((a, b) => a.startBar - b.startBar);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startBar < sorted[i - 1].startBar + sorted[i - 1].lengthBars) err('sections', `Sections "${sorted[i - 1].name}" and "${sorted[i].name}" overlap`);
  }

  p.chords.forEach((c, i) => {
    const at = `chords[${i}]`;
    dupe(`${at}.id`, c.id);
    const r = parseChord(c.symbol);
    if (!r.ok) err(`${at}.symbol`, `Invalid chord symbol: ${r.error}`);
    if (!isInt(c.startTick) || c.startTick < 0) err(`${at}.startTick`, 'Chord startTick must be an integer ≥ 0');
    if (!isInt(c.durationTicks) || c.durationTicks < 1) err(`${at}.durationTicks`, 'Chord durationTicks must be ≥ 1');
  });

  const groupIds = new Set<string>();
  p.libraryGroups.forEach((g, i) => {
    dupe(`libraryGroups[${i}].id`, g.id);
    groupIds.add(g.id);
    if (g.pluginState !== null && typeof g.pluginState !== 'string') err(`libraryGroups[${i}].pluginState`, 'pluginState must be a base64 string or null');
  });

  const endTick = projectEndTick(p);
  const groupChannels = new Map<string, Map<number, string>>();
  p.tracks.forEach((t, i) => {
    const at = `tracks[${i}]`;
    const nm = `Track "${t.name}"`;
    dupe(`${at}.id`, t.id);
    if (!FAMILIES.includes(t.family)) err(`${at}.family`, `${nm}: unknown family "${t.family}"`);
    if (typeof t.role !== 'string' || !t.role) err(`${at}.role`, `${nm}: role is required`);
    if (!isInt(t.midiChannel) || t.midiChannel < 1 || t.midiChannel > 16) err(`${at}.midiChannel`, `${nm}: MIDI channel must be 1–16 (got ${t.midiChannel})`);
    if (!isNum(t.volume) || t.volume < 0 || t.volume > 1.5) err(`${at}.volume`, `${nm}: volume must be 0–1.5 (got ${t.volume})`);
    if (!isNum(t.pan) || t.pan < -1 || t.pan > 1) err(`${at}.pan`, `${nm}: pan must be between −1 and 1 (got ${t.pan})`);
    if (!isInt(t.lowestNote) || !isInt(t.highestNote) || t.lowestNote < 0 || t.highestNote > 127 || t.lowestNote > t.highestNote)
      err(`${at}.range`, `${nm}: range must satisfy 0 ≤ lowestNote ≤ highestNote ≤ 127`);
    if (t.libraryGroupId !== null) {
      if (!groupIds.has(t.libraryGroupId)) err(`${at}.libraryGroupId`, `${nm} references library group "${t.libraryGroupId}", which does not exist`);
      else {
        const m = groupChannels.get(t.libraryGroupId) ?? new Map<number, string>();
        if (m.has(t.midiChannel)) err(`${at}.midiChannel`, `${nm} and "${m.get(t.midiChannel)}" share channel ${t.midiChannel} in the same library group`);
        m.set(t.midiChannel, t.name);
        groupChannels.set(t.libraryGroupId, m);
        if (m.size > MAX_TRACKS_PER_GROUP) err(`${at}.libraryGroupId`, `Library group "${t.libraryGroupId}" has more than ${MAX_TRACKS_PER_GROUP} tracks`);
      }
    }
    if (!Array.isArray(t.notes)) { err(`${at}.notes`, `${nm}: notes must be an array`); return; }
    let reported = 0;
    t.notes.forEach((n, j) => {
      if (reported > 5) return;
      const np = `${at}.notes[${j}]`;
      const before = errors.length;
      if (!isInt(n.pitch) || n.pitch < 0 || n.pitch > 127) err(np, `${nm}: note pitch must be 0–127 (got ${n.pitch})`);
      else if (n.pitch < t.lowestNote || n.pitch > t.highestNote) err(np, `${nm}: note ${noteName(n.pitch)} is outside the track range ${noteName(t.lowestNote)}–${noteName(t.highestNote)}`);
      if (!isInt(n.startTick) || n.startTick < 0) err(np, `${nm}: note startTick must be an integer ≥ 0`);
      if (!isInt(n.durationTicks) || n.durationTicks < 1) err(np, `${nm}: note has zero or negative length`);
      if (!isInt(n.velocity) || n.velocity < 1 || n.velocity > 127) err(np, `${nm}: velocity must be 1–127 (got ${n.velocity})`);
      if (isInt(n.startTick) && isInt(n.durationTicks) && n.startTick + n.durationTicks > endTick) err(np, `${nm}: note at tick ${n.startTick} extends past the project end (tick ${endTick})`);
      if (errors.length > before) reported++;
    });
  });

  return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
}
