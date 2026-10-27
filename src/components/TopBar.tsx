import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { MODE_NAMES, NOTE_NAMES, tickToBarBeat, ticksToSeconds, createDefaultProject, type ModeName, type PitchClass } from '../shared/schema';
import { currentTick, rewind, stop, togglePlay } from '../audio/transport';
import { openProject, saveProject } from '../lib/files';
import { guardUnsaved } from './Dialogs';
import { I } from './icons';
import { Ico, IconButton, NumberField, Select, ToggleSwitch } from './ui';
import { cn } from '../utils/cn';

function Timecode() {
  const ref = useRef<HTMLDivElement>(null);
  const ref2 = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const p = useStore.getState().project;
      const t = currentTick();
      const bb = tickToBarBeat(t, p.timeSignature);
      if (ref.current) ref.current.textContent = `${String(bb.bar).padStart(3, '0')}.${bb.beat}.${String(bb.tick).padStart(3, '0')}`;
      const sec = ticksToSeconds(t, p.bpm);
      if (ref2.current) ref2.current.textContent = `${Math.floor(sec / 60)}:${(sec % 60).toFixed(2).padStart(5, '0')}`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="screen flex h-[32px] shrink-0 items-center gap-1.5 px-1.5" title="Position: bar.beat.tick and minutes:seconds">
      <div className="flex flex-col leading-none">
        <span className="printed text-[6.5px]">bar.beat</span>
        <div ref={ref} className="mt-0.5 text-[12px] font-medium tracking-normal text-[var(--c-accent)]" style={{ fontFamily: 'var(--font-mono)' }}>001.1.000</div>
      </div>
      <div className="h-3.5 w-px bg-[rgba(233,230,224,0.12)]" />
      <div className="flex flex-col leading-none">
        <span className="printed text-[6.5px]">time</span>
        <div ref={ref2} className="mt-0.5 text-[12px] font-medium tracking-normal text-[var(--c-info)]" style={{ fontFamily: 'var(--font-mono)' }}>0:00.00</div>
      </div>
    </div>
  );
}

function ComposeButton() {
  const [open, setOpen] = useState(false);
  const opts = useStore((s) => s.composeOptions);
  const set = useStore((s) => s.set);
  const lockedCount = useStore((s) => s.project.tracks.filter((t) => t.locked).length);
  const compose = () => {
    const ms = useStore.getState().composeAll();
    useStore.getState().toast('success', `Composed in ${ms.toFixed(0)} ms${lockedCount ? ` · ${lockedCount} locked track${lockedCount > 1 ? 's' : ''} kept` : ''}`);
  };
  return (
    <div className="relative flex shrink-0">
      <button
        data-testid="compose-all" title="Compose All — generate MIDI for every unlocked instrument track using your rules config"
        onClick={compose}
        className="hw hw-primary engrave flex h-8 items-center gap-1.5 rounded-l-[4px] px-3 text-[11px] font-bold uppercase tracking-[0.1em] transition-transform active:translate-y-[1px]"
      >
        <Ico icon={I.magic} className="text-sm" /> Compose All
      </button>
      <button title="Generation options (seed, density, humanize)" aria-label="Generation options" onClick={() => setOpen(!open)}
        className="hw hw-primary flex h-8 items-center rounded-r-[4px] border-l border-[#4a3212] px-1">
        <Ico icon={I.caret} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onPointerDown={() => setOpen(false)} />
          <div className="panel-raised absolute right-0 top-10 z-40 w-[268px] rounded-md border border-[#0e0e10] p-3 text-xs shadow-2xl animate-[pop_.15s_ease]">
            <div className="panel-title mb-3"><span className="script">Generation</span></div>
            <label className="mb-2 flex items-center justify-between"><span className="printed">seed</span>
              <div className="flex items-center gap-1">
                <NumberField value={opts.seed} min={0} max={999999} onCommit={(v) => set({ composeOptions: { ...opts, seed: Math.round(v) } })} tip="Random seed — the same seed gives identical output" width={64} />
                <IconButton icon={I.dice} tip="Randomise seed" onClick={() => set({ composeOptions: { ...opts, seed: Math.floor(Math.random() * 999999) } })} />
              </div>
            </label>
            <label className="mb-2 flex items-center justify-between"><span className="printed">density</span>
              <div className="flex items-center gap-2">
                <input type="range" min={0.1} max={1} step={0.05} value={opts.density} onChange={(e) => set({ composeOptions: { ...opts, density: parseFloat(e.target.value) } })} title="Density multiplier applied to every rule" className="w-24 accent-[var(--c-accent)]" />
                <span className="w-8 text-right" style={{ fontFamily: 'var(--font-mono)' }}>{Math.round(opts.density * 100)}%</span>
              </div>
            </label>
            <div className="flex items-center justify-between" title="Small seeded timing (<15 ms) and velocity variation">
              <span className="printed">humanize</span>
              <ToggleSwitch on={opts.humanize} tip="Humanize timing and velocity" onChange={(humanize) => set({ composeOptions: { ...opts, humanize } })} />
            </div>
            <p className="mt-3 leading-relaxed text-[var(--c-textMute)]">Locked tracks are never changed. Rules live in <span style={{ fontFamily: 'var(--font-mono)' }}>src/config/generation-rules.ts</span>.</p>
          </div>
        </>
      )}
    </div>
  );
}

function Field({ label, children, tip }: { label: string; children: React.ReactNode; tip: string }) {
  return (
    <div className="flex flex-col gap-[2px]" title={tip}>
      <span className="printed text-[7.5px]">{label}</span>
      {children}
    </div>
  );
}

export function TopBar() {
  const p = useStore((s) => s.project);
  const edit = useStore((s) => s.edit);
  const set = useStore((s) => s.set);
  const playing = useStore((s) => s.playing);
  const loop = useStore((s) => s.loop);
  const metronome = useStore((s) => s.metronome);
  const mixerOpen = useStore((s) => s.mixerOpen);
  const routingOpen = useStore((s) => s.routingOpen);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const dirty = useStore((s) => s.dirty);
  const filePath = useStore((s) => s.filePath);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);

  return (
    <header className="panel panel--chassis relative flex h-[58px] shrink-0 items-center gap-1.5 border-b border-[#0c0c0e] px-2.5">
      <div className="absolute inset-x-0 top-0 h-px bg-[rgba(255,255,255,0.09)]" />

      {/* Brand & Project Name */}
      <div className="flex shrink-0 items-center gap-1">
        <div className="flex flex-col leading-none">
          <div className="script text-[18px] leading-none text-[var(--c-text)]" style={{ fontFamily: 'var(--font-script)' }}>Scorch</div>
          <div className="printed mt-0.5 text-[6.5px]">orchestral midi</div>
        </div>
        <input
          value={p.name} onChange={(e) => edit((q) => ({ ...q, name: e.target.value }), 'name')} onKeyDown={(e) => e.stopPropagation()}
          title="Project name" aria-label="Project name"
          className="screen h-6 w-[72px] rounded-[3px] px-1 text-[10px] text-[var(--c-text)] outline-none"
        />
        <span title={filePath ?? 'Not saved yet'} className={cn('printed text-[8px]', dirty ? 'text-[var(--c-accent)]' : 'text-[var(--c-textMute)]')}>{dirty ? '●' : ''}</span>
      </div>

      {/* File & Edit Actions */}
      <div className="panel-raised flex shrink-0 items-center gap-0.5 rounded-md border border-[#0e0e10] p-0.5">
        <IconButton size="sm" icon={I.file} tip="New project" onClick={() => guardUnsaved(() => useStore.getState().loadProject(createDefaultProject()))} />
        <IconButton size="sm" icon={I.folder} tip="Open project (.scorch / .json) — Ctrl+O" onClick={() => guardUnsaved(() => void openProject())} />
        <IconButton size="sm" icon={I.save} tip="Save project — Ctrl+S (Shift for Save As)" onClick={(e) => void saveProject(e.shiftKey)} />
        <IconButton size="sm" icon={I.clock} tip="Recent projects" onClick={() => set({ modal: 'recent' })} />
        <IconButton size="sm" icon={I.exportIc} tip="Export / Import (JSON, MIDI)" onClick={() => set({ modal: 'export' })} testId="export-btn" />
        <div className="mx-0.5 h-3.5 w-px bg-[rgba(233,230,224,0.12)]" />
        <IconButton size="sm" icon={I.undo} tip="Undo — Ctrl+Z" onClick={undo} disabled={!canUndo} />
        <IconButton size="sm" icon={I.redo} tip="Redo — Ctrl+Shift+Z" onClick={redo} disabled={!canRedo} />
      </div>

      {/* Project Settings */}
      <div className="panel-raised flex shrink-0 items-end gap-1 rounded-md border border-[#0e0e10] px-1.5 py-0.5" title="Project settings — stored in the project">
        <Field label="tempo" tip="Tempo (BPM)"><NumberField value={p.bpm} min={20} max={400} tip="Tempo (BPM)" width={34} suffix="bpm" onCommit={(v) => edit((q) => ({ ...q, bpm: v, tempoMap: [{ tick: 0, bpm: v }] }))} /></Field>
        <Field label="key" tip="Key (12 pitch classes)"><Select<number> mono tip="Key" value={p.key} options={NOTE_NAMES.map((n, i) => ({ value: i, label: n }))} onChange={(v) => edit((q) => ({ ...q, key: v as PitchClass }))} className="w-[38px] px-0.5 text-[10px]" /></Field>
        <Field label="mode" tip="Mode (full table)"><Select<string> tip="Mode" value={p.mode} options={MODE_NAMES.map((m) => ({ value: m, label: m }))} onChange={(v) => edit((q) => ({ ...q, mode: v as ModeName }))} className="w-[78px] px-0.5 text-[10px]" /></Field>
        <Field label="meter" tip="Time signature">
          <div className="flex items-center gap-0.5">
            <Select<number> mono tip="Time signature numerator" value={p.timeSignature.numerator} options={Array.from({ length: 15 }, (_, i) => ({ value: i + 1, label: String(i + 1) }))} onChange={(v) => edit((q) => ({ ...q, timeSignature: { ...q.timeSignature, numerator: v } }))} className="w-7 px-0.5 text-center text-[10px]" />
            <span className="text-[var(--c-textMute)]">/</span>
            <Select<number> mono tip="Time signature denominator" value={p.timeSignature.denominator} options={[2, 4, 8, 16].map((d) => ({ value: d, label: String(d) }))} onChange={(v) => edit((q) => ({ ...q, timeSignature: { ...q.timeSignature, denominator: v } }))} className="w-7 px-0.5 text-center text-[10px]" />
          </div>
        </Field>
      </div>

      <div className="flex-1 min-w-0" />
      <Timecode />

      {/* Transport Controls */}
      <div className="panel-raised flex shrink-0 items-center gap-0.5 rounded-md border border-[#0e0e10] p-0.5">
        <IconButton size="sm" icon={I.rewind} tip="Rewind to bar 1" onClick={rewind} />
        <IconButton icon={playing ? I.stop : I.play} tip={playing ? 'Stop — Space' : 'Play — Space'} onClick={togglePlay} active={playing} activeColor="var(--c-success)" size="md" testId="play-btn" />
        <IconButton size="sm" icon={I.stop} tip="Stop (press again to return to start)" onClick={stop} />
        <IconButton size="sm" icon={I.record} tip="Record — not available: Scorch generates MIDI, it does not record" disabled />
        <IconButton size="sm" icon={I.repeat} tip={loop ? 'Loop on (selected section or whole song)' : 'Loop off — loops the selected section or whole song'} onClick={() => set({ loop: !loop })} active={loop} activeColor="var(--c-info)" />
        <IconButton size="sm" icon={I.metronome} tip={metronome ? 'Metronome on' : 'Metronome off'} onClick={() => set({ metronome: !metronome })} active={metronome} activeColor="var(--c-warn)" />
      </div>

      <div className="flex-1 min-w-0" />

      {/* Right Controls: shrink-0 and ml-auto guarantee these NEVER clip or push off the window bounds */}
      <div className="flex shrink-0 items-center gap-1.5 ml-auto pr-3">
        <ComposeButton />
        <div className="panel-raised flex shrink-0 items-center gap-0.5 rounded-md border border-[#0e0e10] p-0.5">
          <IconButton
            icon={I.sliders}
            tip={mixerOpen ? "Hide mixer (X)" : "Show mixer (X)"}
            onClick={() => set({ mixerOpen: !mixerOpen })}
            active={mixerOpen}
            activeColor="var(--c-accent)"
            testId="mixer-toggle"
          />
          <IconButton
            icon={I.graph}
            tip={routingOpen ? "Close routing panel" : "Routing panel — library groups"}
            onClick={() => set({ routingOpen: !routingOpen })}
            active={routingOpen}
            activeColor="var(--c-accent)"
            testId="routing-toggle"
          />
          <IconButton icon={I.gear} tip="Settings" onClick={() => set({ modal: 'settings' })} />
          <IconButton icon={I.info} tip="About Scorch" onClick={() => set({ modal: 'about' })} />
        </div>
      </div>
    </header>
  );
}
