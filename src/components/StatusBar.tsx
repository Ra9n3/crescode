import { useEffect, useState } from 'react';
import { useStore } from '../store/store';
import { preview } from '../audio/preview';
import { loadedInstanceCount } from '../lib/routing';
import { barTicks, createAddedTrack, isInstrumentTrack, projectEndTick, type Note, type TrackFamily } from '../shared/schema';
import { mulberry32 } from '../engine/generate';
import { runAlignmentTest } from './Arranger';
import { I } from './icons';
import { Ico } from './ui';
import { cn } from '../utils/cn';

function fmtBytes(b: number) { return b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(0)} MB`; }

/** Dev helper: fills instrument tracks with `total` random in-range notes (seeded). */
export function fillRandomNotes(total = 5000) {
  const s = useStore.getState();
  const p = s.project;
  const inst = p.tracks.filter(isInstrumentTrack);
  const r = mulberry32(Date.now() & 0xffff);
  const end = projectEndTick(p);
  const per = Math.ceil(total / inst.length);
  const step = Math.max(60, Math.floor(end / per));
  s.edit((q) => ({
    ...q,
    tracks: q.tracks.map((t) => {
      if (!isInstrumentTrack(t)) return t;
      const notes: Note[] = [];
      for (let i = 0; i < per; i++) {
        const st = Math.min(end - 30, i * step + Math.floor(r() * step * 0.3));
        notes.push({ pitch: t.lowestNote + Math.floor(r() * (t.highestNote - t.lowestNote + 1)), startTick: st, durationTicks: Math.max(30, Math.min(end - st, Math.floor(step * (0.3 + r() * 0.6)))), velocity: 30 + Math.floor(r() * 97) });
      }
      return { ...t, notes };
    }),
  }));
  s.toast('info', `Dev: filled ${inst.length} tracks with ${per * inst.length} random notes`);
}

function DevMenu() {
  const [open, setOpen] = useState(false);
  const s = useStore.getState();
  const item = (label: string, fn: () => void) => <button className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--c-bg4)]" onClick={() => { setOpen(false); fn(); }}>{label}</button>;
  return (
    <div className="relative">
      <button title="Developer tools" onClick={() => setOpen(!open)} className="flex items-center gap-1 rounded px-1.5 text-[var(--c-warn)] hover:bg-[var(--c-bg3)]"><Ico icon={I.bug} /> Dev</button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onPointerDown={() => setOpen(false)} />
          <div className="absolute bottom-7 left-0 z-40 w-64 rounded-lg border border-[var(--c-lineStrong)] bg-[var(--c-bg2)] p-1 shadow-2xl">
            {item('Fill tracks with 5,000 random notes', () => fillRandomNotes(5000))}
            {item('Add 10 tracks (alignment test)', () => {
              const fams: TrackFamily[] = ['Strings', 'Brass', 'Woodwinds', 'Percussion', 'Keys'];
              s.edit((p) => { let tracks = p.tracks; for (let i = 0; i < 10; i++) tracks = [...tracks, createAddedTrack(fams[i % 5], tracks)]; return { ...p, tracks }; });
            })}
            {item('Run header/lane alignment test', async () => {
              const r = await runAlignmentTest();
              s.toast(r.ok ? 'success' : 'error', r.ok ? `Alignment PASS — ${r.checked} header/lane pairs equal before & after scrolling` : `Alignment FAIL: ${r.failures.slice(0, 3).join('; ')}`);
            })}
            {item('Run 50× undo / 50× redo check', () => {
              const st = useStore.getState();
              const start = JSON.stringify(st.project);
              for (let i = 0; i < 50; i++) st.updateTrack(st.project.tracks[3 + (i % 15)].id, { volume: Math.round(((i % 10) / 10) * 100) / 100 + 0.05 });
              const after = JSON.stringify(useStore.getState().project);
              for (let i = 0; i < 50; i++) useStore.getState().undo();
              const back = JSON.stringify(useStore.getState().project) === start;
              for (let i = 0; i < 50; i++) useStore.getState().redo();
              const fwd = JSON.stringify(useStore.getState().project) === after;
              s.toast(back && fwd ? 'success' : 'error', `Undo/redo 50 steps: ${back ? 'undo PASS' : 'undo FAIL'} · ${fwd ? 'redo PASS' : 'redo FAIL'}`);
            })}
            {item('Clear all notes', () => s.edit((p) => ({ ...p, tracks: p.tracks.map((t) => (t.locked ? t : { ...t, notes: [] })) })))}
            {(['notScanned', 'scanning', 'empty', 'loaded'] as const).map((k) => item(`Open VST browser forced: ${k}`, () => s.set({ vstForced: k, modal: 'vst', vstTargetTrackId: useStore.getState().project.tracks[3]?.id ?? null })))}
          </div>
        </>
      )}
    </div>
  );
}

export function StatusBar() {
  const p = useStore((s) => s.project);
  const engineConnected = useStore((s) => s.engineConnected);
  const devMode = useStore((s) => s.settings.devMode);
  const playing = useStore((s) => s.playing);
  const [mem, setMem] = useState<string>('—');
  useEffect(() => {
    const t = setInterval(() => {
      const m = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      setMem(m ? fmtBytes(m.usedJSHeapSize + preview.frozenBytes()) : `${fmtBytes(preview.frozenBytes())} frozen`);
    }, 1500);
    return () => clearInterval(t);
  }, []);
  const notes = p.tracks.reduce((a, t) => a + t.notes.length, 0);
  const instances = loadedInstanceCount(p);
  const frozen = p.tracks.filter((t) => t.frozen).length;
  return (
    <footer className="panel relative flex h-7 shrink-0 items-center gap-4 border-t border-[#0c0c0e] px-3 text-[10px] text-[var(--c-textMute)]">
      <div className="absolute inset-x-0 top-0 h-px bg-[rgba(255,255,255,0.08)]" aria-hidden />
      <span className={cn('flex items-center gap-1.5', engineConnected ? 'text-[var(--c-success)]' : 'text-[var(--c-warn)]')} title={engineConnected ? 'scorch-engine connected (127.0.0.1)' : 'Engine disconnected — playback uses the built-in preview sound. Export is unaffected.'}>
        <span className={cn('h-1.5 w-1.5 rounded-full', engineConnected ? 'bg-[var(--c-success)]' : 'bg-[var(--c-warn)]')} />
        {engineConnected ? 'Engine connected' : 'Engine disconnected · preview sound'}
      </span>
      <span title="Loaded instrument instances (library groups with at least one unfrozen track, plus the shared preview synth)"><Ico icon={I.cpu} className="mr-1 inline" />{instances} instance{instances === 1 ? '' : 's'}</span>
      <span title="Memory: JS heap + frozen audio"><Ico icon={I.memory} className="mr-1 inline" />{mem}</span>
      <span title="Frozen tracks"><Ico icon={I.snowflake} className="mr-1 inline" />{frozen} frozen</span>
      <span className="printed">{notes.toLocaleString()} notes</span>
      <span className="printed">{p.sections.length} sections · {p.chords.length} chords · {Math.round(projectEndTick(p) / barTicks(p.timeSignature))} bars</span>
      {playing && <span className="text-[var(--c-success)]">● playing</span>}
      <div className="flex-1" />
      {devMode && <DevMenu />}
      <span>960 PPQ · local only</span>
    </footer>
  );
}
