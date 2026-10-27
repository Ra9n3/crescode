import { useEffect } from 'react';
import { useStore } from './store/store';
import { applyThemeVars } from './theme/tokens';
import { bindTransport, togglePlay } from './audio/transport';
import { engine } from './engineClient/client';
import { clearRecovery, openProject, readRecovery, saveProject, writeRecovery } from './lib/files';
import { preview } from './audio/preview';
import { TopBar } from './components/TopBar';
import { Arranger, runAlignmentTest } from './components/Arranger';
import { Mixer } from './components/Mixer';
import { PianoRoll } from './components/PianoRoll';
import { RoutingPanel, VstBrowser } from './components/Panels';
import { StatusBar, fillRandomNotes } from './components/StatusBar';
import { Dialogs, guardUnsaved } from './components/Dialogs';
import { Toasts } from './components/ui';
import { restoreFrozenBuffers } from './lib/routing';
import { isInstrumentTrack } from './shared/schema';

applyThemeVars();
bindTransport();
// Test hooks for the automated UI smoke test (scripts/e2e-smoke.mjs).
(window as unknown as { scorchTest: unknown }).scorchTest = { store: useStore, runAlignmentTest, fillRandomNotes };

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      const s = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); s.redo(); return; }
      if (mod && k === 's') { e.preventDefault(); void saveProject(e.shiftKey); return; }
      if (mod && k === 'o') { e.preventDefault(); guardUnsaved(() => void openProject()); return; }
      if (s.modal || s.pianoRollTrackId) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.selectedChordId) { s.deleteChord(s.selectedChordId); s.set({ selectedChordId: null }); }
        else if (s.selectedSectionId) { s.deleteSection(s.selectedSectionId); s.set({ selectedSectionId: null }); }
        else if (s.selectedTrackIds.length) {
          const added = s.selectedTrackIds.filter((id) => { const t = s.project.tracks.find((x) => x.id === id); return t && isInstrumentTrack(t) && !/^trk_\d\d_/.test(t.id); });
          if (added.length) { added.forEach((id) => s.removeTrack(id)); s.set({ selectedTrackIds: [] }); }
          else s.toast('info', 'Default tracks cannot be deleted; only tracks you added');
        }
        return;
      }
      if (mod) return;
      const ids = s.selectedTrackIds.filter((id) => s.project.tracks.some((t) => t.id === id && t.family !== 'Structure'));
      if (k === 'l' && ids.length) s.updateTracks(ids, (t) => ({ locked: isInstrumentTrack(t) ? !t.locked : t.locked }));
      if (k === 'm' && ids.length) s.updateTracks(ids, (t) => ({ muted: !t.muted }));
      if (k === 's' && ids.length) s.updateTracks(ids, (t) => ({ soloed: !t.soloed }));
      if (k === 'x') s.set({ mixerOpen: !s.mixerOpen });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export default function App() {
  useShortcuts();
  const mixerOpen = useStore((s) => s.mixerOpen);
  const routingOpen = useStore((s) => s.routingOpen);
  const modal = useStore((s) => s.modal);
  const roll = useStore((s) => s.pianoRollTrackId);

  useEffect(() => {
    const rec = readRecovery();
    if (rec) {
      useStore.getState().toast('warn', `Recovered unsaved work from ${new Date(rec.at).toLocaleString()}.`, {
        label: 'Restore',
        run: () => { useStore.getState().loadProject(rec.project); useStore.getState().set({ dirty: true }); void restoreFrozenBuffers(); },
      });
    }
    const autosave = setInterval(writeRecovery, 20000);
    const unsub = useStore.subscribe((s, prev) => { if (s.project !== prev.project && s.dirty) scheduleRecovery(); });
    const before = (e: BeforeUnloadEvent) => { if (useStore.getState().dirty) { writeRecovery(); e.preventDefault(); } };
    window.addEventListener('beforeunload', before);
    const onUnload = () => { preview.stop(); preview.clearFreezeCache(); engine.stopClient(); };
    window.addEventListener('unload', onUnload);
    if (useStore.getState().settings.connectEngine) engine.start();
    /* Instant-press golden glow: any quick tap on a button flashes data-pressed
       long enough to be seen, while held presses keep :active glowing. */
    const pressed = new WeakSet<HTMLElement>();
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (el.matches('button, [role="button"], [data-testid="vst-btn"], [data-testid="mixer-strip"] [data-testid]') && !el.classList.contains('fader-cap')) {
        el.setAttribute('data-pressed', 'true');
        pressed.add(el);
      }
    };
    const onUp = (e: MouseEvent) => { const el = e.target as HTMLElement; if (pressed.has(el)) setTimeout(() => { pressed.delete(el); el.removeAttribute('data-pressed'); }, 110); };
    const onLeave = (e: MouseEvent) => { const el = e.target as HTMLElement; if (pressed.has(el)) { pressed.delete(el); el.removeAttribute('data-pressed'); } };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('mouseup', onUp, true);
    window.addEventListener('mouseleave', onLeave, true);
    return () => { clearInterval(autosave); unsub(); window.removeEventListener('beforeunload', before); window.removeEventListener('unload', onUnload); window.removeEventListener('mousedown', onDown, true); window.removeEventListener('mouseup', onUp, true); window.removeEventListener('mouseleave', onLeave, true); };
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--c-bg0)] font-sans text-[var(--c-text)] antialiased">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Arranger />
        {routingOpen && <RoutingPanel />}
      </div>
      {mixerOpen && <Mixer />}
      <StatusBar />
      {roll && <PianoRoll key={roll} />}
      {modal === 'vst' && <VstBrowser />}
      <Dialogs />
      <Toasts />
    </div>
  );
}

let recTimer: number | null = null;
function scheduleRecovery() {
  if (recTimer) clearTimeout(recTimer);
  recTimer = window.setTimeout(() => { if (useStore.getState().dirty) writeRecovery(); else clearRecovery(); }, 3000);
}
