/**
 * File operations. Uses the File System Access API (native Windows save/open
 * and folder pickers) when available, otherwise falls back to downloads and
 * <input type=file>. Everything stays on the local machine.
 */
import { exportProjectJson, importProjectJson } from '../export/json';
import { useStore } from '../store/store';
import type { Project } from '../shared/schema/types';

type Picker = { showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle>; showDirectoryPicker?: (o?: unknown) => Promise<FileSystemDirectoryHandle> };
const w = window as unknown as Picker;

export function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Save one file through the native save dialog when possible. Returns the chosen file name, or null if cancelled. */
export async function saveFile(suggested: string, data: BlobPart, type: string, ext: string): Promise<string | null> {
  if (w.showSaveFilePicker) {
    try {
      const h = await w.showSaveFilePicker({ suggestedName: suggested, types: [{ description: ext.toUpperCase(), accept: { [type]: [`.${ext}`] } }] });
      const ws = await h.createWritable();
      await ws.write(new Blob([data], { type }));
      await ws.close();
      return h.name;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null;
    }
  }
  download(suggested, data, type);
  return suggested;
}

/** Save several files into a folder picked by the user (per-track MIDI). */
export async function saveFilesToFolder(files: { fileName: string; data: Uint8Array }[]): Promise<string | null> {
  if (w.showDirectoryPicker) {
    try {
      const dir = await w.showDirectoryPicker({ mode: 'readwrite' });
      for (const f of files) {
        const h = await dir.getFileHandle(f.fileName, { create: true });
        const ws = await h.createWritable();
        await ws.write(new Blob([f.data as BlobPart], { type: 'audio/midi' }));
        await ws.close();
      }
      return dir.name;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null;
    }
  }
  for (const f of files) { download(f.fileName, f.data as BlobPart, 'audio/midi'); await new Promise((r) => setTimeout(r, 120)); }
  return 'Downloads';
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/* ---------- recent projects & autosave ---------- */
const RECENT_KEY = 'crescode.recent.v1';
const RECOVERY_KEY = 'crescode.recovery.v1';
export interface RecentEntry { name: string; file: string; savedAt: string; json: string }

export function getRecent(): RecentEntry[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); } catch { return []; }
}
function pushRecent(e: RecentEntry) {
  const list = [e, ...getRecent().filter((r) => r.file !== e.file)].slice(0, 8);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 2))); }
}

export async function saveProject(saveAs = false): Promise<boolean> {
  const s = useStore.getState();
  const p = s.project;
  const json = JSON.stringify(p, null, 2);
  const suggested = (!saveAs && s.filePath) || `${p.name || 'Untitled'}.crescode`;
  const name = await saveFile(suggested, json, 'application/json', 'crescode');
  if (!name) return false;
  s.markSaved(name);
  pushRecent({ name: p.name, file: name, savedAt: new Date().toISOString(), json });
  localStorage.removeItem(RECOVERY_KEY);
  s.toast('success', `Saved ${name}`);
  return true;
}

export function openProjectText(text: string, fileName: string): boolean {
  const s = useStore.getState();
  const r = importProjectJson(text);
  if (!r.ok) { s.set({ importErrors: r.errors, modal: 'import' }); return false; }
  s.loadProject(r.project, fileName);
  pushRecent({ name: r.project.name, file: fileName, savedAt: new Date().toISOString(), json: JSON.stringify(r.project) });
  s.toast('success', `Opened ${fileName}`);
  return true;
}

export async function openProject(): Promise<void> {
  const f = await pickFile('.crescode,.json,application/json');
  if (!f) return;
  openProjectText(await f.text(), f.name);
}

export function exportJson(p: Project) {
  return saveFile(`${p.name || 'project'}.json`, exportProjectJson(p), 'application/json', 'json');
}

export function writeRecovery() {
  const s = useStore.getState();
  if (!s.dirty) return;
  try { localStorage.setItem(RECOVERY_KEY, JSON.stringify({ at: new Date().toISOString(), project: s.project })); } catch { /* quota */ }
}
export function readRecovery(): { at: string; project: Project } | null {
  try { const r = localStorage.getItem(RECOVERY_KEY); return r ? JSON.parse(r) : null; } catch { return null; }
}
export function clearRecovery() { localStorage.removeItem(RECOVERY_KEY); }
