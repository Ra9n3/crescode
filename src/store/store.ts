import { create } from 'zustand';
import fixture from '../../fixtures/dorian-16bars.json';
import {
  applyTemplate, createAddedTrack, flipBand, freshEnsemble, isInBand, isInstrumentTrack, projectFromFixture, setPin, uid,
  MAX_TRACKS_PER_GROUP, NOTE_NAMES,
  INSTRUMENTS,
  type Chord, type LibraryGroup, type ModeName, type Note, type Project, type Section, type Track, type TrackFamily, type PitchClass,
} from '../shared/schema';
import { ENSEMBLE_BY_ID, resolveTemplate } from '../config/ensembles';
import { composeAllTracks } from '../orchestrator/compose';
import { transformProjectMode, transposeProjectKey } from '../engine/suggestion/transpose';
import type { FollowMode } from '../engine/transport/follow';

export const HISTORY_LIMIT = 200;

export type VstState = 'notScanned' | 'scanning' | 'empty' | 'loaded';
export interface PluginInfo { id: string; name: string; vendor: string; path: string }
export interface Toast { id: string; kind: 'info' | 'success' | 'error' | 'warn'; text: string; action?: { label: string; run: () => void } }

export interface Settings {
  scanDirectory: string;
  audioDevice: string;
  bufferSize: 256 | 512;
  enginePort: number;
  connectEngine: boolean;
  devMode: boolean;
  /** Content of a freshly created Smart Chord clip (chord lane double-click). */
  smartChordPlaceholder: 'empty' | 'root-note';

  /* ---- Transport & auto-scroll (persist between sessions) ---- */
  /** Stop returns the playhead to where playback started (default off — Stop parks where it stopped). */
  stopReturnsToStart: boolean;
  /** A second Stop press while already stopped relocates to the playback start (default off). */
  secondStopReturnsToStart: boolean;
  /** Clicking the ruler/arranger while playing relocates the playhead and keeps playing (default on). */
  clickDuringPlaybackMovesPlayhead: boolean;
  /** Auto-scroll mode: off / smooth (default) / page / centered / stationary. */
  autoScrollMode: FollowMode;
  /** Fraction of the visible timeline width where smooth follow kicks in / stationary pins. */
  autoScrollTriggerPoint: number;
  /** Manual scrolling during playback suspends following (default on). */
  suspendFollowOnManualScroll: boolean;
  /** Edit drags during playback suspend following and keep it suspended after (default on). */
  suspendFollowDuringEdit: boolean;
  /** A manual scroll parks the view; following re-engages when the playhead re-crosses the trigger (default on). Off: parked until Re-follow. */
  followResumeAfterScroll: boolean;
  /** Stationary playhead while recording (recording is not available in v1; reserved). */
  stationaryPlayheadDuringRecording: boolean;
  /** The piano roll follows the playhead with its own smooth scroll. */
  pianoRollFollow: boolean;
  /** Key for the Re-follow playhead shortcut (user-configurable, default F). */
  refollowKey: string;
}

const SETTINGS_KEY = 'crescode.settings.v1';
const loadSettings = (): Settings => {
  const d: Settings = {
    scanDirectory: 'C:\\Program Files\\Common Files\\VST3', audioDevice: 'default', bufferSize: 512, enginePort: 47800, connectEngine: false, devMode: true, smartChordPlaceholder: 'root-note',
    stopReturnsToStart: false, secondStopReturnsToStart: false, clickDuringPlaybackMovesPlayhead: true,
    autoScrollMode: 'smooth', autoScrollTriggerPoint: 0.75,
    suspendFollowOnManualScroll: true, suspendFollowDuringEdit: true, followResumeAfterScroll: true,
    stationaryPlayheadDuringRecording: false, pianoRollFollow: true, refollowKey: 'f',
  };
  try { return { ...d, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') }; } catch { return d; }
};

export interface ComposeOptions { seed: number; density: number; humanize: boolean }

interface State {
  project: Project;
  past: Project[];
  future: Project[];
  lastCoalesce: { key: string; at: number } | null;
  dirty: boolean;
  filePath: string | null;

  selectedTrackIds: string[];
  selectedSectionId: string | null;
  selectedChordId: string | null;
  /** The clip the Smart Chord editor has open (null = closed). Set by the
   *  double-click gesture; read by the suggestion UI and MIDI injection. */
  suggestionClipId: string | null;
  pxPerTick: number;
  mixerOpen: boolean;
  routingOpen: boolean;
  pianoRollTrackId: string | null;
  modal: null | 'export' | 'settings' | 'about' | 'vst' | 'import' | 'recent';
  vstTargetTrackId: string | null;
  importErrors: { path: string; message: string }[];

  playing: boolean;
  /** Playback is frozen at an exact position; Play resumes from there. */
  paused: boolean;
  /** Recording state (v1 has no recording — the transport exposes it for the spec'd state model). */
  isRecording: boolean;
  loop: boolean;
  /** The active loop region while playing ([startTick, endTick]); null when loop is off. */
  loopRange: [number, number] | null;
  metronome: boolean;
  /** Preview-synth mode (Phase 6): 'expressive' honours articulation, CC1/7/11
   *  and the ensemble detune; 'simple' is the pre-Phase-6 sound. UI only —
   *  never stored in the project. */
  previewMode: 'simple' | 'expressive';
  /** Parked playhead position (ticks) — authoritative when not playing. */
  startTick: number;
  /** Where the current/last playback run started (ticks). */
  lastPlaybackStartPosition: number;
  /** Where the last Stop parked the playhead (ticks). */
  stoppedPosition: number;

  /* ---- Follow (auto-scroll) runtime state ---- */
  /** Manual scroll / edit / scrub suspended the arranger's auto-scroll. */
  followSuspended: boolean;
  followSuspensionReason: 'manual-scroll' | 'edit' | 'scrub' | null;
  /** A pointer-driven edit interaction (drag) is in progress — freezes follow. */
  interactionActive: boolean;
  /** Which timeline editor the Re-follow shortcut applies to. */
  activeEditor: 'arranger' | 'pianoRoll';
  /** Piano roll's own follow suspension (independent of the arranger's). */
  rollFollowSuspended: boolean;

  composeOptions: ComposeOptions;
  settings: Settings;
  toasts: Toast[];

  vstState: VstState;
  vstForced: VstState | null;
  scanProgress: { loaded: number; total: number };
  plugins: PluginInfo[];
  failedPlugins: string[];
  engineConnected: boolean;
  freezeProgress: Record<string, number>;
  refVersion: number;
  pluginLoading: Record<string, 'loading' | 'error' | undefined>;

  /** Push an undoable edit. `coalesce` merges rapid edits with the same key (slider drags) into one step. */
  edit: (fn: (p: Project) => Project, coalesce?: string) => void;
  undo: () => void;
  redo: () => void;
  loadProject: (p: Project, filePath?: string | null) => void;
  markSaved: (filePath?: string | null) => void;

  updateTrack: (id: string, patch: Partial<Track>, coalesce?: string) => void;
  updateTracks: (ids: string[], fn: (t: Track) => Partial<Track>) => void;
  /** Track-header IN/OUT band button: flips the track's instrument in or out
   *  of the current composition as ONE undoable edit. Going out empties the
   *  lane (lock wins on locked tracks); a project-settings pin refuses the
   *  flip with a toast. */
  toggleInBand: (trackId: string) => void;
  /** Band picker: switch to a template (or null = no band, everyone in).
   *  Starting a new composition — header choices reset, out-of-band unlocked
   *  lanes empty, pins ride over — as ONE undoable edit. */
  switchTemplate: (templateId: string | null) => void;
  /** Project-settings pin (Settings → Band): 'in'/'out' rides over EVERY
   *  band, null removes the pin. Pinning out empties the lane of every
   *  unlocked track with the role (lock wins) as ONE undoable edit; the pin
   *  retires any track-header tweak beneath it. */
  setBandPin: (role: string, pin: 'in' | 'out' | null) => void;
  setNotes: (id: string, notes: Note[]) => void;
  addTrack: (family: TrackFamily) => void;
  removeTrack: (id: string) => void;
  addSection: (s: Omit<Section, 'id'>) => string;
  updateSection: (id: string, patch: Partial<Section>, coalesce?: string) => void;
  deleteSection: (id: string) => void;
  addChord: (c: Omit<Chord, 'id'>) => string;
  updateChord: (id: string, patch: Partial<Chord>, coalesce?: string) => void;
  deleteChord: (id: string) => void;
  /** Set the project's tonic; the whole chord track transposes with it
   *  (same degrees, same qualities, re-spelled for the new key) as ONE
   *  undoable edit. A pure tonic change with interval 0 (mode-only moves)
   *  rewrites nothing. */
  setProjectKey: (tonic: PitchClass) => void;
  /** Set the project's mode; every chord whose root is diatonic in the old
   *  mode keeps its scale degree and is re-rendered diatonically in the new
   *  one (C Ionian → C Aeolian: C→Cm, Em→Eb, G7→Gm7) as ONE undoable edit.
   *  Chromatic (borrowed) roots and unparseable symbols are left alone. */
  setProjectMode: (mode: ModeName) => void;
  createGroup: (name: string, pluginId: string | null) => string;
  updateGroup: (id: string, patch: Partial<LibraryGroup>) => void;
  deleteGroup: (id: string) => void;
  routeTrack: (trackId: string, groupId: string | null) => boolean;
  /** Generate MIDI for every unlocked instrument track IN the band (no band
   *  chosen = everyone). Locked and out-of-band lanes are left exactly as
   *  they are. ONE undoable edit; returns timing and who was left alone. */
  composeAll: () => { ms: number; bandSkipped: number; lockedKept: number };

  set: (patch: Partial<State>) => void;
  setSettings: (patch: Partial<Settings>) => void;
  toast: (kind: Toast['kind'], text: string, action?: Toast['action']) => void;
  dismissToast: (id: string) => void;
}

const initialProject = (): Project => projectFromFixture(JSON.parse(JSON.stringify(fixture)) as Partial<Project>);
const mapTrack = (p: Project, id: string, fn: (t: Track) => Track): Project => ({ ...p, tracks: p.tracks.map((t) => (t.id === id ? fn(t) : t)) });

export const useStore = create<State>((set, get) => ({
  project: initialProject(),
  past: [], future: [], lastCoalesce: null, dirty: false, filePath: null,
  selectedTrackIds: [], selectedSectionId: null, selectedChordId: null, suggestionClipId: null,
  pxPerTick: 0.06, mixerOpen: true, routingOpen: false, pianoRollTrackId: null, modal: null, vstTargetTrackId: null, importErrors: [],
  playing: false, paused: false, isRecording: false, loop: false, loopRange: null, metronome: false, previewMode: 'expressive', startTick: 0,
  lastPlaybackStartPosition: 0, stoppedPosition: 0,
  followSuspended: false, followSuspensionReason: null, interactionActive: false, activeEditor: 'arranger', rollFollowSuspended: false,
  composeOptions: { seed: 1, density: 1, humanize: true },
  settings: loadSettings(),
  toasts: [],
  vstState: 'notScanned', vstForced: null, scanProgress: { loaded: 0, total: 0 }, plugins: [], failedPlugins: [],
  engineConnected: false, freezeProgress: {}, pluginLoading: {}, refVersion: 0,

  edit: (fn, coalesce) => {
    const { project, past, lastCoalesce } = get();
    const next = fn(project);
    if (next === project) return;
    const now = Date.now();
    const merge = coalesce && lastCoalesce && lastCoalesce.key === coalesce && now - lastCoalesce.at < 800;
    set({
      project: next,
      past: merge ? past : [...past, project].slice(-HISTORY_LIMIT),
      future: [],
      dirty: true,
      lastCoalesce: coalesce ? { key: coalesce, at: now } : null,
    });
  },
  undo: () => {
    const { past, project, future } = get();
    if (!past.length) return;
    set({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future], dirty: true, lastCoalesce: null });
  },
  redo: () => {
    const { past, project, future } = get();
    if (!future.length) return;
    set({ project: future[0], future: future.slice(1), past: [...past, project], dirty: true, lastCoalesce: null });
  },
  loadProject: (p, filePath = null) => set({ project: p, past: [], future: [], dirty: false, filePath, selectedTrackIds: [], selectedChordId: null, selectedSectionId: null, suggestionClipId: null, pianoRollTrackId: null }),
  markSaved: (filePath) => set((s) => ({ dirty: false, filePath: filePath === undefined ? s.filePath : filePath })),

  updateTrack: (id, patch, coalesce) => get().edit((p) => mapTrack(p, id, (t) => ({ ...t, ...patch })), coalesce),

  // Band in/out (track header): flipBand owns the semantics — going out
  // empties the lane of every unlocked track with the role, lock wins on
  // locked tracks, pins refuse the header. One edit() step, so Ctrl+Z
  // restores the notes and the membership together.
  toggleInBand: (trackId) => {
    const p = get().project;
    const res = flipBand(p, trackId, resolveTemplate(p.ensemble));
    if (!res.ok) {
      if (res.reason === 'pinned') {
        const name = p.tracks.find((t) => t.id === trackId)?.name ?? res.role;
        get().toast('warn', `"${name}" is pinned by project settings — change the pin in Settings, not here.`);
      }
      return;
    }
    const name = p.tracks.find((t) => t.id === trackId)?.name ?? res.role;
    const wasLocked = p.tracks.find((t) => t.id === trackId)?.locked;
    get().edit(() => res.project);
    if (res.nowIn) {
      get().toast('success', `${name} back in the band — Compose All will write for it again`);
      return;
    }
    // Going OUT can both keep a locked track's notes and empty sibling lanes —
    // say both, truthfully, in one line.
    const cleared = res.clearedTrackIds.length;
    const bits = [
      wasLocked ? 'this track is locked, so its notes stay' : '',
      cleared ? `${cleared} unlocked lane${cleared > 1 ? 's' : ''} cleared (Ctrl+Z brings the notes back)` : '',
    ].filter(Boolean);
    get().toast('success', `${name} out of the band${bits.length ? ` — ${bits.join(' · ')}` : ''}`);
  },

  // Band picker (▾ next to Compose All): applyTemplate owns the semantics —
  // new templateId, header choices reset, pins ride over, out-of-band
  // unlocked lanes empty. One edit() step, so Ctrl+Z restores the whole
  // previous composition.
  switchTemplate: (templateId) => {
    const p = get().project;
    const template = templateId ? (ENSEMBLE_BY_ID.get(templateId) ?? null) : null;
    const res = applyTemplate(p, template);
    if (res.project === p) return;
    const name = template?.name ?? 'No band';
    get().edit(() => res.project);
    get().toast('success', res.sweptTrackIds.length
      ? `${name} — ${res.inRoles.length} instruments in the band; ${res.sweptTrackIds.length} out lane${res.sweptTrackIds.length > 1 ? 's' : ''} cleared (Ctrl+Z restores)`
      : `${name} — ${res.inRoles.length} instruments in the band`);
  },
  // Project-settings pin (Settings → Band): setPin owns the semantics — the
  // pin rides over every band, pinning out empties the role's unlocked lanes
  // (lock wins), and the pin retires the header tweak beneath it. One edit()
  // step, so Ctrl+Z restores notes + pins together.
  setBandPin: (role, pin) => {
    const p = get().project;
    const res = setPin(p, role, pin);
    if (!res.ok) {
      if (res.reason === 'notBand') get().toast('warn', `"${role}" is not an instrument the band manages — Structure and Audio lanes are always there.`);
      return; // 'noop': the pin already says that — nothing to record
    }
    const name = INSTRUMENTS.find((d) => d.role === role)?.name ?? role;
    get().edit(() => res.project);
    get().toast('success', res.pin === 'in'
      ? `${name} pinned in for every band — Compose All always writes for it, even bands that leave it out`
      : res.pin === 'out'
        ? `${name} pinned out of every band${res.clearedTrackIds.length ? ` — ${res.clearedTrackIds.length} lane${res.clearedTrackIds.length > 1 ? 's' : ''} cleared (Ctrl+Z brings the notes back)` : ''}`
        : `${name} unpinned — the active band decides again`);
  },

  updateTracks: (ids, fn) => get().edit((p) => ({ ...p, tracks: p.tracks.map((t) => (ids.includes(t.id) ? { ...t, ...fn(t) } : t)) })),
  setNotes: (id, notes) => get().edit((p) => mapTrack(p, id, (t) => ({ ...t, notes }))),
  addTrack: (family) => get().edit((p) => ({ ...p, tracks: [...p.tracks, createAddedTrack(family, p.tracks)] })),
  removeTrack: (id) => get().edit((p) => ({ ...p, tracks: p.tracks.filter((t) => t.id !== id) })),

  addSection: (s) => { const id = uid('sec'); get().edit((p) => ({ ...p, sections: [...p.sections, { ...s, id }] })); return id; },
  updateSection: (id, patch, c) => get().edit((p) => ({ ...p, sections: p.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) }), c),
  deleteSection: (id) => get().edit((p) => ({ ...p, sections: p.sections.filter((s) => s.id !== id) })),
  addChord: (c) => { const id = uid('chd'); get().edit((p) => ({ ...p, chords: [...p.chords, { ...c, id }] })); return id; },
  updateChord: (id, patch, c) => get().edit((p) => ({ ...p, chords: p.chords.map((x) => (x.id === id ? { ...x, ...patch } : x)) }), c),
  deleteChord: (id) => get().edit((p) => ({ ...p, chords: p.chords.filter((c) => c.id !== id) })),

  // Key change → the whole chord track follows (transpose.ts owns the
  // theory): chord symbols re-spell for the new tonic, the Chords track's
  // MIDI notes shift by the same interval, and everything lands as ONE
  // undoable edit so Ctrl+Z restores key + chords together.
  setProjectKey: (tonic) => {
    const p = get().project;
    if (tonic === p.key) return;
    const res = transposeProjectKey(p, tonic);
    get().edit(() => res.project);
    if (res.interval !== 0) {
      const n = res.changed;
      get().toast('success', `Key → ${NOTE_NAMES[tonic]} ${p.mode}${n ? ` · ${n} chord${n === 1 ? '' : 's'} transposed ${res.interval >= 0 ? '+' : ''}${res.interval} st` : ' · no chords to transpose'}`);
    }
  },

  // Mode change → the chord track re-renders diatonically (transpose.ts owns
  // the theory): same scale degrees, new mode's chords, per-chord note
  // shifts, ONE undoable edit so Ctrl+Z restores mode + chords together.
  setProjectMode: (mode) => {
    const p = get().project;
    if (mode === p.mode) return;
    const res = transformProjectMode(p, mode);
    get().edit(() => res.project);
    const n = res.changed;
    get().toast('success', `Mode → ${NOTE_NAMES[p.key]} ${mode}${n ? ` · ${n} chord${n === 1 ? '' : 's'} transformed` : ' · no diatonic chords to transform'}`);
  },

  createGroup: (name, pluginId) => {
    const id = uid('grp');
    get().edit((p) => ({ ...p, libraryGroups: [...p.libraryGroups, { id, name, pluginId, pluginState: null }] }));
    return id;
  },
  updateGroup: (id, patch) => get().edit((p) => ({ ...p, libraryGroups: p.libraryGroups.map((g) => (g.id === id ? { ...g, ...patch } : g)) })),
  deleteGroup: (id) => get().edit((p) => ({
    ...p,
    libraryGroups: p.libraryGroups.filter((g) => g.id !== id),
    tracks: p.tracks.map((t) => (t.libraryGroupId === id ? { ...t, libraryGroupId: null } : t)),
  })),
  routeTrack: (trackId, groupId) => {
    const p = get().project;
    const t = p.tracks.find((x) => x.id === trackId);
    if (!t) return false;
    if (groupId === null) { get().updateTrack(trackId, { libraryGroupId: null }); return true; }
    const members = p.tracks.filter((x) => x.libraryGroupId === groupId && x.id !== trackId);
    if (members.length >= MAX_TRACKS_PER_GROUP) {
      get().toast('error', `A library group holds at most ${MAX_TRACKS_PER_GROUP} tracks — "${t.name}" was not added.`);
      return false;
    }
    const used = new Set(members.map((m) => m.midiChannel));
    const channel = used.has(t.midiChannel) ? Array.from({ length: 16 }, (_, i) => i + 1).find((c) => !used.has(c))! : t.midiChannel;
    get().updateTrack(trackId, { libraryGroupId: groupId, midiChannel: channel });
    return true;
  },

  composeAll: () => {
    const { project, composeOptions } = get();
    const t0 = performance.now();
    const ensemble = project.ensemble ?? freshEnsemble();
    const template = resolveTemplate(project.ensemble);
    const bandSkipped = project.tracks.filter((t) => isInstrumentTrack(t) && !t.locked && !isInBand(t.role, ensemble, template)).length;
    const lockedKept = project.tracks.filter((t) => t.locked).length;
    // Orchestrator compose: strings via the strings module (one global DP),
    // everything else through the rules generator — and the take increments
    // INSIDE the same edit, so one Ctrl+Z restores notes and take together.
    const res = composeAllTracks(project, composeOptions);
    get().edit((p) => ({
      ...p,
      tracks: p.tracks.map((t) => res.tracks.find((g) => g.id === t.id) ?? t),
      orchestration: res.orchestration,
    }));
    return { ms: performance.now() - t0, bandSkipped, lockedKept };
  },

  set: (patch) => set(patch),
  setSettings: (patch) => {
    const settings = { ...get().settings, ...patch };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    set({ settings });
  },
  toast: (kind, text, action) => {
    const id = uid('t');
    set((s) => ({ toasts: [...s.toasts, { id, kind, text, action }].slice(-5) }));
    setTimeout(() => get().dismissToast(id), action ? 12000 : kind === 'error' ? 7000 : 3500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const getProject = () => useStore.getState().project;
