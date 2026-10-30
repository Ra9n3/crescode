import { create } from 'zustand';
import fixture from '../../fixtures/dorian-16bars.json';
import {
  createAddedTrack, projectFromFixture, uid, MAX_TRACKS_PER_GROUP,
  type Chord, type LibraryGroup, type Note, type Project, type Section, type Track, type TrackFamily,
} from '../shared/schema';
import { generate } from '../engine/generate';

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
  /** What the Smart Chord overlay does after a successful Apply. */
  smartChordApply: 'close' | 'minimize';
}

const SETTINGS_KEY = 'crescode.settings.v1';
const loadSettings = (): Settings => {
  const d: Settings = { scanDirectory: 'C:\\Program Files\\Common Files\\VST3', audioDevice: 'default', bufferSize: 512, enginePort: 47800, connectEngine: false, devMode: true, smartChordPlaceholder: 'root-note', smartChordApply: 'close' };
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
  loop: boolean;
  loopRange: [number, number] | null;
  metronome: boolean;
  startTick: number;

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
  setNotes: (id: string, notes: Note[]) => void;
  addTrack: (family: TrackFamily) => void;
  removeTrack: (id: string) => void;
  addSection: (s: Omit<Section, 'id'>) => string;
  updateSection: (id: string, patch: Partial<Section>, coalesce?: string) => void;
  deleteSection: (id: string) => void;
  addChord: (c: Omit<Chord, 'id'>) => string;
  updateChord: (id: string, patch: Partial<Chord>, coalesce?: string) => void;
  deleteChord: (id: string) => void;
  createGroup: (name: string, pluginId: string | null) => string;
  updateGroup: (id: string, patch: Partial<LibraryGroup>) => void;
  deleteGroup: (id: string) => void;
  routeTrack: (trackId: string, groupId: string | null) => boolean;
  composeAll: () => number;

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
  playing: false, loop: false, loopRange: null, metronome: false, startTick: 0,
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
    const tracks = generate(project, { ...composeOptions, lockedTrackIds: project.tracks.filter((t) => t.locked).map((t) => t.id) });
    get().edit((p) => ({ ...p, tracks: p.tracks.map((t) => tracks.find((g) => g.id === t.id) ?? t) }));
    return performance.now() - t0;
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
