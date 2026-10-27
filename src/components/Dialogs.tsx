import { Fragment, useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { useStore } from '../store/store';
import { buildMergedMidi, buildPerTrackMidi, exportableTracks, parseMidiFile } from '../export/midi';
import { exportJson, getRecent, openProjectText, pickFile, saveFile, saveFilesToFolder, saveProject } from '../lib/files';
import { isInstrumentTrack, noteName, PERCUSSION_FIXED_NOTES, projectBars } from '../shared/schema';
import { preview } from '../audio/preview';
import { engine } from '../engineClient/client';
import { cn } from '../utils/cn';
import { I } from './icons';
import { Button, Ico, Modal, NumberField, Select, ToggleSwitch } from './ui';

/* ---------- unsaved-changes guard ---------- */
const useConfirm = create<{ pending: null | (() => void) }>(() => ({ pending: null }));
export function guardUnsaved(fn: () => void) {
  if (!useStore.getState().dirty) { fn(); return; }
  useConfirm.setState({ pending: fn });
}
function UnsavedDialog() {
  const pending = useConfirm((s) => s.pending);
  if (!pending) return null;
  const close = () => useConfirm.setState({ pending: null });
  return (
    <Modal title="Unsaved changes" icon={I.warn} onClose={close} width={420}
      footer={<>
        <Button onClick={close}>Cancel</Button>
        <Button danger onClick={() => { close(); pending(); }}>Discard</Button>
        <Button primary onClick={async () => { if (await saveProject()) { close(); pending(); } }}>Save</Button>
      </>}>
      <p className="text-sm text-[var(--c-textDim)]">Your project has unsaved changes. Save before continuing?</p>
    </Modal>
  );
}

/* ---------- export / import ---------- */
type Fmt = 'midi' | 'midiPer' | 'json';
function ExportDialog() {
  const s = useStore();
  const p = s.project;
  const inst = p.tracks.filter(isInstrumentTrack);
  const [fmt, setFmt] = useState<Fmt>('midi');
  const [mode, setMode] = useState<'all' | 'selected' | 'unlocked'>('all');
  const [picked, setPicked] = useState<string[]>(() => (s.selectedTrackIds.length ? s.selectedTrackIds : inst.map((t) => t.id)));
  const [report, setReport] = useState<string | null>(null);
  const tracks = exportableTracks(p, mode, picked);
  const close = () => s.set({ modal: null });

  const doExport = async () => {
    setReport(null);
    if (fmt === 'json') {
      const n = await exportJson(p);
      if (n) { s.toast('success', `Exported ${n}`); setReport(`Wrote ${n} — full project, schemaVersion ${p.schemaVersion}, with exportedAt.`); }
      return;
    }
    if (!tracks.length) { s.toast('warn', 'No tracks selected for export'); return; }
    if (fmt === 'midi') {
      const data = buildMergedMidi(p, tracks);
      const n = await saveFile(`${p.name || 'Scorch'}.mid`, data as BlobPart, 'audio/midi', 'mid');
      if (!n) return;
      const parsed = parseMidiFile(data);
      const count = parsed.tracks.reduce((a, t) => a + t.notes.length, 0);
      setReport(`Wrote ${n}: Type ${parsed.format}, ${parsed.ppq} PPQ, ${parsed.bpm} BPM, ${parsed.tracks.length - 1} instrument tracks + conductor, ${count} notes, ${projectBars(p)} bars, markers: ${parsed.markers.map((m) => m.text).join(', ') || 'none'}.`);
      s.toast('success', `Exported ${n}`);
    } else {
      const files = buildPerTrackMidi(p, tracks);
      const where = await saveFilesToFolder(files);
      if (!where) return;
      setReport(`Wrote ${files.length} files to ${where}: ${files.map((f) => f.fileName).join(', ')}. All end at bar ${projectBars(p) + 1}.`);
      s.toast('success', `Exported ${files.length} MIDI files`);
    }
  };

  const importJson = () => guardUnsaved(async () => {
    const f = await pickFile('.json,.scorch,application/json');
    if (f && openProjectText(await f.text(), f.name)) close();
  });

  const Radio = ({ v, label, desc }: { v: Fmt; label: string; desc: string }) => (
    <button onClick={() => setFmt(v)} className={cn('flex-1 rounded-lg border p-3 text-left transition-colors', fmt === v ? 'border-[var(--c-accent)] bg-[var(--c-bg3)]' : 'border-[var(--c-line)] hover:bg-[var(--c-bg2)]')}>
      <div className="text-xs font-semibold">{label}</div>
      <div className="mt-1 text-[10px] leading-snug text-[var(--c-textMute)]">{desc}</div>
    </button>
  );

  return (
    <Modal title="Export / Import" icon={I.exportIc} onClose={close} width={640}
      footer={<>
        <Button onClick={importJson} className="mr-auto" tip="Load a project JSON — validation errors are listed clearly"><Ico icon={I.upload} /> Import project JSON</Button>
        <Button onClick={close}>Close</Button>
        <Button primary onClick={() => void doExport()}><Ico icon={I.download} /> Export</Button>
      </>}>
      <div className="mb-4 flex gap-2">
        <Radio v="midi" label="MIDI · single file" desc="Type 1, 960 PPQ. Conductor track (tempo, meter, key, section markers) + one track per instrument." />
        <Radio v="midiPer" label="MIDI · per track" desc='One file per instrument ("04 Violins I.mid"), all the same length. Pick a folder.' />
        <Radio v="json" label="Project JSON" desc="The full project with schemaVersion and exportedAt." />
      </div>
      {fmt !== 'json' && (
        <>
          <div className="mb-2 flex items-center gap-3 text-xs">
            <span className="text-[var(--c-textMute)]">Tracks</span>
            {(['all', 'selected', 'unlocked'] as const).map((m) => (
              <label key={m} className="flex cursor-pointer items-center gap-1.5">
                <input type="radio" checked={mode === m} onChange={() => setMode(m)} className="accent-[var(--c-accent)]" />
                {m === 'all' ? 'All tracks' : m === 'selected' ? 'Selected tracks' : 'All except locked'}
              </label>
            ))}
            <span className="ml-auto font-mono text-[var(--c-textDim)]">{tracks.length} track(s)</span>
          </div>
          {mode === 'selected' && (
            <div className="mb-3 grid max-h-40 grid-cols-3 gap-1 overflow-auto rounded-md border border-[var(--c-line)] p-2">
              {inst.map((t) => (
                <div key={t.id} className="flex min-h-7 items-center gap-1.5 text-[11px]">
                  <ToggleSwitch size="sm" on={picked.includes(t.id)} tip={`Include ${t.name} in the selected-track export`} onChange={(on) => setPicked(on ? [...picked, t.id] : picked.filter((x) => x !== t.id))} />
                  <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: t.color }} />
                  <span className="truncate">{t.name}</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-[var(--c-textMute)]">Routing and mixer state never alter the MIDI: grouped tracks export separately; volume, pan, mute and solo are ignored.</p>
        </>
      )}
      {report && <div className="mt-3 rounded-md border border-[var(--c-success)] bg-[var(--c-bg2)] p-3 text-[11px] leading-relaxed" data-testid="export-report"><Ico icon={I.check} className="mr-1 inline text-[var(--c-success)]" />{report}</div>}
    </Modal>
  );
}

function ImportErrorsDialog() {
  const errors = useStore((s) => s.importErrors);
  const close = () => useStore.getState().set({ modal: null, importErrors: [] });
  return (
    <Modal title="Import failed — project is not valid" icon={I.warn} onClose={close} width={600} footer={<Button onClick={close}>OK</Button>}>
      <p className="mb-3 text-xs text-[var(--c-textDim)]">Nothing was changed. Fix these problems and try again:</p>
      <ul className="max-h-[50vh] space-y-1 overflow-auto">
        {errors.map((e, i) => (
          <li key={i} className="rounded border-l-2 border-[var(--c-danger)] bg-[var(--c-bg2)] px-2 py-1.5 text-xs">
            {e.path && <span className="mr-2 font-mono text-[10px] text-[var(--c-textMute)]">{e.path}</span>}{e.message}
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/* ---------- settings ---------- */
function SettingsDialog() {
  const s = useStore();
  const st = s.settings;
  const [devices, setDevices] = useState<{ value: string; label: string }[]>([{ value: 'default', label: 'System default output' }]);
  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices?.().then((list) => {
      const outs = list.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default').map((d, i) => ({ value: d.deviceId, label: d.label || `Output ${i + 1}` }));
      setDevices([{ value: 'default', label: 'System default output' }, ...outs]);
    }).catch(() => undefined);
  }, []);
  const snare = s.project.tracks.find((t) => t.role === 'snare');
  const cym = s.project.tracks.find((t) => t.role === 'cymbals');
  const setFixed = (role: string, note: number) => s.edit((p) => ({ ...p, tracks: p.tracks.map((t) => (t.role === role ? { ...t, lowestNote: note, highestNote: note, notes: t.notes.map((n) => ({ ...n, pitch: note })) } : t)) }));
  const applyAudio = (patch: Partial<typeof st>) => {
    s.setSettings(patch);
    const next = { ...st, ...patch };
    void preview.setDevice(next.bufferSize / 48000, next.audioDevice);
    s.set({ playing: false });
    engine.send({ type: 'audio/setDevice', device: next.audioDevice, bufferSize: next.bufferSize });
  };
  const Row = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
    <div className="flex items-start gap-4 border-b border-[var(--c-lineSoft)] py-3">
      <div className="w-44 shrink-0"><div className="text-xs font-semibold">{label}</div>{hint && <div className="mt-0.5 text-[10px] leading-snug text-[var(--c-textMute)]">{hint}</div>}</div>
      <div className="flex flex-1 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
  return (
    <Modal title="Settings" icon={I.gear} onClose={() => s.set({ modal: null })} width={620} footer={<Button primary onClick={() => s.set({ modal: null })}>Done</Button>}>
      <Row label="VST3 scan directory" hint="Default C:\Program Files\Common Files\VST3">
        <input value={st.scanDirectory} onChange={(e) => s.setSettings({ scanDirectory: e.target.value })} onKeyDown={(e) => e.stopPropagation()} className="h-8 flex-1 rounded-md border border-[var(--c-line)] bg-[var(--c-bg2)] px-2 font-mono text-xs outline-none focus:border-[var(--c-accent)]" aria-label="Scan directory" />
        <Button onClick={() => s.setSettings({ scanDirectory: 'C:\\Program Files\\Common Files\\VST3' })}>Reset</Button>
      </Row>
      <Row label="Audio device" hint="Preview output. In the native engine: ASIO preferred, WASAPI fallback.">
        <Select<string> tip="Audio output device" value={st.audioDevice} options={devices} onChange={(v) => applyAudio({ audioDevice: v })} className="flex-1" />
      </Row>
      <Row label="Buffer size" hint="Lower = less latency, more CPU">
        {([256, 512] as const).map((b) => <Button key={b} primary={st.bufferSize === b} onClick={() => applyAudio({ bufferSize: b })}>{b} samples</Button>)}
      </Row>
      <Row label="Audio engine" hint="Native scorch-engine for VST3 hosting (127.0.0.1 only). Off = built-in preview sound.">
        <div className="flex items-center gap-2 text-xs"><ToggleSwitch on={st.connectEngine} tip="Connect to the local audio engine" onChange={(on) => { s.setSettings({ connectEngine: on }); if (on) engine.start(); else engine.stopClient(); }} /> Connect</div>
        <NumberField value={st.enginePort} min={1024} max={65535} tip="Engine port on 127.0.0.1" width={60} onCommit={(v) => s.setSettings({ enginePort: Math.round(v) })} />
        <span className={cn('text-[11px]', s.engineConnected ? 'text-[var(--c-success)]' : 'text-[var(--c-textMute)]')}>{s.engineConnected ? 'Connected' : 'Engine disconnected'}</span>
      </Row>
      <Row label="Percussion fixed notes" hint="Unpitched tracks use one configurable note">
        <span className="text-xs">Snare</span><NumberField value={snare?.lowestNote ?? PERCUSSION_FIXED_NOTES.snare} min={0} max={127} tip="Snare MIDI note" width={40} onCommit={(v) => setFixed('snare', Math.round(v))} />
        <span className="font-mono text-[10px] text-[var(--c-textMute)]">{noteName(snare?.lowestNote ?? 38)}</span>
        <span className="ml-3 text-xs">Cymbals</span><NumberField value={cym?.lowestNote ?? PERCUSSION_FIXED_NOTES.cymbals} min={0} max={127} tip="Cymbals MIDI note" width={40} onCommit={(v) => setFixed('cymbals', Math.round(v))} />
        <span className="font-mono text-[10px] text-[var(--c-textMute)]">{noteName(cym?.lowestNote ?? 49)}</span>
      </Row>
      <Row label="Developer tools" hint="Shows the dev menu in the status bar and the VST browser state switch">
        <div className="flex items-center gap-2 text-xs"><ToggleSwitch on={st.devMode} tip="Enable developer tools" onChange={(on) => s.setSettings({ devMode: on })} /> Enabled</div>
      </Row>
    </Modal>
  );
}

function AboutDialog() {
  const close = () => useStore.getState().set({ modal: null });
  const keys: [string, string][] = [['Space', 'Play / Stop'], ['Delete', 'Delete selected section / chord / notes'], ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / Redo'], ['L / M / S', 'Lock / Mute / Solo selected tracks'], ['Ctrl+wheel', 'Zoom timeline'], ['Ctrl+S / Ctrl+O', 'Save / Open'], ['X', 'Toggle mixer'], ['Double-click lane', 'Open piano roll']];
  return (
    <Modal title="About Scorch" icon={I.flame} onClose={close} width={520} footer={<Button primary onClick={close}>Close</Button>}>
      <div className="mb-4">
        <div className="text-lg font-bold">Scorch <span className="font-mono text-xs font-normal text-[var(--c-textMute)]">v1.0.0 · schema v1</span></div>
        <p className="mt-1 text-xs leading-relaxed text-[var(--c-textDim)]">Orchestral MIDI generator with a DAW-style arranger. All musical decisions come from your editable rules config — the engine only interprets it. Local only: no accounts, no cloud, no network calls. Your audio never leaves your machine.</p>
      </div>
      <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--c-textMute)]">Keyboard</div>
      <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
        {keys.map(([k, v]) => <Fragment key={k}><kbd className="rounded border border-[var(--c-line)] bg-[var(--c-bg2)] px-1.5 font-mono text-[10px]">{k}</kbd><span className="text-[var(--c-textDim)]">{v}</span></Fragment>)}
      </div>
    </Modal>
  );
}

function RecentDialog() {
  const list = useMemo(() => getRecent(), []);
  const close = () => useStore.getState().set({ modal: null });
  return (
    <Modal title="Recent projects" icon={I.clock} onClose={close} width={480} footer={<Button onClick={close}>Close</Button>}>
      {!list.length && <p className="py-6 text-center text-xs text-[var(--c-textMute)]">No recent projects yet. Save or open a project and it appears here.</p>}
      <div className="space-y-1">
        {list.map((r) => (
          <button key={r.file + r.savedAt} onClick={() => guardUnsaved(() => { if (openProjectText(r.json, r.file)) close(); })}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-[var(--c-bg3)]">
            <Ico icon={I.notes} className="text-[var(--c-accent)]" />
            <div className="flex-1"><div className="text-xs font-semibold">{r.name || r.file}</div><div className="font-mono text-[10px] text-[var(--c-textMute)]">{r.file}</div></div>
            <span className="text-[10px] text-[var(--c-textMute)]">{new Date(r.savedAt).toLocaleString()}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function Dialogs() {
  const modal = useStore((s) => s.modal);
  return (
    <>
      {modal === 'export' && <ExportDialog />}
      {modal === 'settings' && <SettingsDialog />}
      {modal === 'about' && <AboutDialog />}
      {modal === 'import' && <ImportErrorsDialog />}
      {modal === 'recent' && <RecentDialog />}
      <UnsavedDialog />
    </>
  );
}
