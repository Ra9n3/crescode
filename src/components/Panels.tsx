import { useEffect, useMemo, useState } from 'react';
import { useStore, type PluginInfo, type VstState } from '../store/store';
import { engine, cleanPluginName } from '../engineClient/client';
import { groupLoaded, freezeTrack, unfreezeTrack, routingInfo } from '../lib/routing';
import { isInstrumentTrack, MAX_TRACKS_PER_GROUP } from '../shared/schema';
import { cn } from '../utils/cn';
import { I } from './icons';
import { Button, Ico, IconButton, Modal, Select } from './ui';

/** DEV-only sample data, used solely when the dev switch forces the "Loaded" state. */
const DEV_SAMPLE_RAW = ['BBC Symphony Orchestra (64-bit).vst3', 'Kontakt 7.vst3', 'Pianoteq 8 x64.vst3', 'Vital.vst3', 'Labs 64bit.vst3', 'Opus.vst3', 'Surge XT.vst3'];
const devSample: PluginInfo[] = DEV_SAMPLE_RAW.map((r) => ({ id: `dev:${r}`, name: cleanPluginName(r), vendor: 'DEV sample', path: `C:\\DEV\\${r}` }));

export function VstBrowser() {
  const s = useStore();
  const track = s.project.tracks.find((t) => t.id === s.vstTargetTrackId);
  const state: VstState = s.vstForced ?? s.vstState;
  const [q, setQ] = useState('');
  const [target, setTarget] = useState<string>(track?.libraryGroupId ?? 'new');
  const [fakeCount, setFakeCount] = useState(0);
  const close = () => s.set({ modal: null, vstTargetTrackId: null });

  useEffect(() => {
    if (s.vstForced !== 'scanning') return;
    setFakeCount(0);
    const t = setInterval(() => setFakeCount((c) => (c >= 48 ? 0 : c + 1)), 120);
    return () => clearInterval(t);
  }, [s.vstForced]);

  const list = s.vstForced === 'loaded' && !s.plugins.length ? devSample : s.plugins;
  const filtered = useMemo(() => list.filter((p) => `${p.name} ${p.vendor}`.toLowerCase().includes(q.toLowerCase())), [list, q]);
  const progress = s.vstForced === 'scanning' ? { loaded: fakeCount, total: 48 } : s.scanProgress;

  const scan = () => {
    if (!engine.scan(s.settings.scanDirectory)) {
      s.toast('error', 'The audio engine (crescode-engine) is not connected, so VST3s cannot be scanned. Everything else works; tracks play the built-in preview sound.');
      return;
    }
    s.set({ vstState: 'scanning', scanProgress: { loaded: 0, total: 0 } });
  };

  const assign = (pl: PluginInfo) => {
    if (!track) return;
    const st = useStore.getState();
    let gid = target;
    if (gid === 'new') gid = st.createGroup(pl.name, pl.id);
    else st.updateGroup(gid, { pluginId: pl.id, pluginState: null });
    if (!st.routeTrack(track.id, gid)) return;
    if (!engine.loadPlugin(gid, pl.id, null)) st.toast('info', `${pl.name} assigned to ${track.name}. Engine offline — playing the built-in preview sound until it connects.`);
    close();
  };

  const group = track?.libraryGroupId ? s.project.libraryGroups.find((g) => g.id === track.libraryGroupId) : null;
  const info = track ? routingInfo(s.project, track) : null;

  return (
    <Modal title={`VST3 Browser${track ? ` — ${track.name}` : ''}`} icon={I.plugBold} onClose={close} width={620}
      footer={
        <>
          {s.settings.devMode && (
            <div className="mr-auto flex items-center gap-1 rounded-md border border-dashed border-[var(--c-warn)] px-1.5 py-1" title="Developer switch: force each browser state for testing">
              <Ico icon={I.bug} className="text-[var(--c-warn)]" />
              {(['auto', 'notScanned', 'scanning', 'empty', 'loaded'] as const).map((k) => (
                <button key={k} onClick={() => s.set({ vstForced: k === 'auto' ? null : k })}
                  className={cn('rounded px-1.5 py-0.5 text-[10px]', (s.vstForced ?? 'auto') === k ? 'bg-[var(--c-warn)] text-[var(--c-accentText)]' : 'text-[var(--c-textDim)] hover:bg-[var(--c-bg4)]')}>{k}</button>
              ))}
            </div>
          )}
          <Button onClick={close}>Close</Button>
        </>
      }>
      <div className="mb-3 flex items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-md border border-[var(--c-line)] bg-[var(--c-bg2)] px-2 focus-within:border-[var(--c-accent)]">
          <Ico icon={I.search} className="text-[var(--c-textMute)]" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Search plugins…" className="h-8 flex-1 bg-transparent text-xs outline-none" aria-label="Search plugins" />
        </div>
        <IconButton icon={I.repeat} tip="Rescan plugins" onClick={scan} disabled={state === 'scanning'} />
      </div>

      {track && (
        <div className="mb-3 flex items-center gap-2 rounded-md bg-[var(--c-bg2)] px-3 py-2 text-xs">
          <span className="text-[var(--c-textMute)]">Assign to</span>
          <Select<string> tip="Assign the chosen plugin to a new library group or an existing one" value={target} onChange={setTarget}
            options={[{ value: 'new', label: '＋ New group' }, ...s.project.libraryGroups.map((g) => ({ value: g.id, label: `${g.name} (${s.project.tracks.filter((t) => t.libraryGroupId === g.id).length}/${MAX_TRACKS_PER_GROUP})` }))]} />
          <span className="ml-auto truncate text-[var(--c-textDim)]">Now: {info?.pluginName ?? 'No plugin'}{group ? ` · ${group.name}` : ''} · CH {track.midiChannel}{info?.preview ? ' · preview sound' : ''}</span>
        </div>
      )}

      <div className="min-h-[260px] rounded-lg border border-[var(--c-line)] bg-[var(--c-bg0)]">
        {state === 'scanning' && (
          <div className="flex h-[260px] flex-col items-center justify-center gap-3 text-sm" data-testid="vst-scanning">
            <Ico icon={I.spinner} className="animate-spin text-3xl text-[var(--c-accent)]" />
            <div>Scanning... <span className="font-mono">{progress.loaded}</span> of <span className="font-mono">{progress.total || '?'}</span> plugins loaded</div>
            <div className="h-1 w-56 overflow-hidden rounded-full bg-[var(--c-bg3)]"><div className="h-full bg-[var(--c-accent)] transition-all" style={{ width: `${progress.total ? (progress.loaded / progress.total) * 100 : 10}%` }} /></div>
          </div>
        )}
        {state === 'empty' && (
          <div className="flex h-[260px] flex-col items-center justify-center gap-3 text-sm text-[var(--c-textDim)]" data-testid="vst-empty">
            <div>No VST3s found.</div>
            <div className="font-mono text-[10px] text-[var(--c-textMute)]">{s.settings.scanDirectory}</div>
            <Button onClick={() => s.set({ modal: 'settings' })}>Change Directory</Button>
          </div>
        )}
        {state === 'notScanned' && (
          <div className="flex h-[260px] flex-col items-center justify-center gap-3 text-sm text-[var(--c-textDim)]" data-testid="vst-notscanned">
            <div>No scan performed.</div>
            <Button primary onClick={scan}>Scan Plugins</Button>
            <p className="max-w-sm text-center text-[11px] leading-relaxed text-[var(--c-textMute)]">Scanning runs inside the native crescode-engine. {s.engineConnected ? 'Engine connected.' : 'Engine not connected — tracks use the built-in preview sound. Export is never affected.'}</p>
          </div>
        )}
        {state === 'loaded' && (
          <div className="max-h-[320px] overflow-auto p-1" data-testid="vst-loaded">
            {s.vstForced === 'loaded' && !s.plugins.length && <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--c-warn)]">DEV sample data — not real plugins</div>}
            {filtered.map((p) => (
              <button key={p.id} onClick={() => assign(p)} disabled={!track} title={track ? `Assign ${p.name} to ${track.name}` : 'Open from a track header to assign'}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs transition-colors hover:bg-[var(--c-bg3)] disabled:opacity-50">
                <Ico icon={I.plug} className="text-[var(--c-accent)]" />
                <span className="flex-1 font-medium">{p.name}</span>
                <span className="text-[10px] text-[var(--c-textMute)]">{p.vendor}</span>
              </button>
            ))}
            {!filtered.length && <div className="p-6 text-center text-xs text-[var(--c-textMute)]">No plugins match "{q}"</div>}
          </div>
        )}
      </div>
      {s.failedPlugins.length > 0 && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-[var(--c-danger)]">{s.failedPlugins.length} plugin(s) failed and will be skipped</summary>
          <ul className="mt-1 space-y-0.5 pl-4 font-mono text-[10px] text-[var(--c-textMute)]">{s.failedPlugins.map((f) => <li key={f}>{f}</li>)}</ul>
        </details>
      )}
      {track && (
        <div className="mt-3 flex items-center gap-2">
          <Button disabled={!group?.pluginId || !s.engineConnected} tip={!s.engineConnected ? 'Requires the audio engine' : !group?.pluginId ? 'No plugin assigned' : 'Open the plugin’s own editor window'} onClick={() => group && engine.openEditor(group.id)}>
            <Ico icon={I.window} /> Open plugin editor
          </Button>
          <Button disabled={!track.libraryGroupId} tip="Remove routing — the track plays the built-in preview sound" onClick={() => { useStore.getState().routeTrack(track.id, null); close(); }}>Use preview sound</Button>
        </div>
      )}
    </Modal>
  );
}

export function RoutingPanel() {
  const p = useStore((s) => s.project);
  const sel = useStore((s) => s.selectedTrackIds);
  const st = useStore.getState();
  const [over, setOver] = useState<string | null>(null);
  const inst = p.tracks.filter(isInstrumentTrack);
  const drop = (gid: string | null) => (e: React.DragEvent) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData('text/track'); if (id) st.routeTrack(id, gid); };
  const groupSelected = () => {
    const ids = sel.filter((id) => inst.some((t) => t.id === id));
    if (!ids.length) { st.toast('info', 'Select tracks first (Ctrl+click headers), e.g. Violins I and Violins II'); return; }
    const names = ids.map((id) => p.tracks.find((t) => t.id === id)!.name);
    const gid = st.createGroup(names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0], null);
    ids.forEach((id) => st.routeTrack(id, gid));
    st.toast('success', `Grouped ${names.join(' & ')} — one instance, separate channels`);
  };
  const Chip = ({ id }: { id: string }) => {
    const t = p.tracks.find((x) => x.id === id)!;
    return (
      <div draggable onDragStart={(e) => e.dataTransfer.setData('text/track', id)} title="Drag onto a group to route"
        className="flex cursor-grab items-center gap-1.5 rounded border border-[var(--c-line)] bg-[var(--c-bg2)] px-1.5 py-1 text-[11px]">
        <span className="h-2 w-2 rounded-sm" style={{ background: t.color }} />
        <span className="flex-1 truncate">{t.name}</span>
        {t.frozen && <Ico icon={I.snowflake} className="text-[var(--c-freeze)]" />}
        <span className="font-mono text-[9px] text-[var(--c-textMute)]">CH{t.midiChannel}</span>
        <select title="Move to group" aria-label="Move to group" value={t.libraryGroupId ?? ''} onChange={(e) => st.routeTrack(id, e.target.value || null)} className="w-4 bg-transparent text-[var(--c-textMute)] outline-none">
          <option value="">No group</option>
          {p.libraryGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>
    );
  };
  return (
    <aside className="panel flex w-[300px] shrink-0 flex-col border-l border-[#0c0c0e] animate-[slidein_.2s_ease]" data-testid="routing-panel">
      <div className="flex items-center gap-2 border-b border-[var(--c-line)] px-3 py-2.5">
        <Ico icon={I.graph} className="text-[var(--c-accent)]" />
        <span className="script flex-1 text-[17px] leading-none" style={{ fontFamily: "var(--font-script)" }}>Routing</span>
        <IconButton icon={I.plus} tip="New empty group" onClick={() => st.createGroup(`Group ${p.libraryGroups.length + 1}`, null)} />
        <IconButton icon={I.x} tip="Close routing panel" onClick={() => st.set({ routingOpen: false })} />
      </div>
      <div className="border-b border-[var(--c-line)] p-2">
        <Button className="w-full" onClick={groupSelected} tip="Put all selected tracks into one new group (one instance, own channels)">Group selected tracks ({sel.filter((id) => inst.some((t) => t.id === id)).length})</Button>
      </div>
      <div className="flex-1 space-y-2 overflow-auto p-2">
        {p.libraryGroups.map((g) => {
          const members = p.tracks.filter((t) => t.libraryGroupId === g.id);
          const loaded = groupLoaded(p, g.id);
          const ri = members[0] ? routingInfo(p, members[0]) : null;
          return (
            <div key={g.id} onDragOver={(e) => { e.preventDefault(); setOver(g.id); }} onDragLeave={() => setOver(null)} onDrop={drop(g.id)}
              className={cn('panel-raised rounded-md border p-2 transition-colors', over === g.id ? 'border-[var(--c-accent)]' : 'border-[#0f0f11]')}>
              <div className="mb-1.5 flex items-center gap-1.5">
                <input value={g.name} onChange={(e) => st.updateGroup(g.id, { name: e.target.value })} onKeyDown={(e) => e.stopPropagation()} className="min-w-0 flex-1 bg-transparent text-xs font-semibold outline-none" title="Group name" aria-label="Group name" />
                <span className={cn('printed rounded-[3px] px-1.5 py-0.5', loaded ? 'bg-[var(--c-success)] text-[#1b2412]' : 'bg-[var(--c-bg4)] text-[var(--c-textMute)]')} title={loaded ? 'Instance loaded' : 'Unloaded — every track in the group is frozen (or the group is empty)'}>{loaded ? 'loaded' : 'unloaded'}</span>
                <IconButton size="sm" icon={I.snowflake} tip={members.every((m) => m.frozen) && members.length ? 'Unfreeze whole group' : 'Freeze whole group'} onClick={() => {
                  const all = members.length > 0 && members.every((m) => m.frozen);
                  members.forEach((m) => (all ? unfreezeTrack(m.id) : void freezeTrack(m.id)));
                }} disabled={!members.length} />
                <IconButton size="sm" icon={I.trash} tip="Delete group (tracks return to preview sound)" onClick={() => st.deleteGroup(g.id)} />
              </div>
              <div className="mb-1.5 flex items-center gap-1 text-[10px] text-[var(--c-textDim)]">
                <Ico icon={I.plug} /> {ri?.pluginName ?? (g.pluginId ? cleanPluginName(g.pluginId) : 'No plugin')}
                {(!ri || ri.preview) && <span className="ml-auto text-[9px] font-bold uppercase text-[var(--c-warn)]">preview sound</span>}
                <span className="ml-1 font-mono text-[var(--c-textMute)]">{members.length}/{MAX_TRACKS_PER_GROUP}</span>
              </div>
              <div className="space-y-1">{members.map((m) => <Chip key={m.id} id={m.id} />)}</div>
              {!members.length && <div className="rounded border border-dashed border-[var(--c-line)] p-2 text-center text-[10px] text-[var(--c-textMute)]">Drop tracks here</div>}
            </div>
          );
        })}
        <div onDragOver={(e) => { e.preventDefault(); setOver('none'); }} onDragLeave={() => setOver(null)} onDrop={drop(null)}
          className={cn('rounded-lg border border-dashed p-2', over === 'none' ? 'border-[var(--c-accent)]' : 'border-[var(--c-line)]')}>
          <div className="printed mb-1.5">no group · preview sound</div>
          <div className="space-y-1">{inst.filter((t) => !t.libraryGroupId).map((t) => <Chip key={t.id} id={t.id} />)}</div>
        </div>
      </div>
    </aside>
  );
}
