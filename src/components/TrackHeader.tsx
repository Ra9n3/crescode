import { memo } from 'react';
import { useStore } from '../store/store';
import type { Track } from '../shared/schema/types';
import { routingInfo, toggleFreeze } from '../lib/routing';
import { preview } from '../audio/preview';
import { pickFile } from '../lib/files';
import { detectGenerationScope, scopeTooltip } from '../lib/genScope';
import { runChordGenerate } from '../lib/chordGenUi';
import { cn } from '../utils/cn';
import { I } from './icons';
import { HEADER_W, Ico, IconButton, Knob, MiniSlider, NumberField, ROW_H, ToggleChip } from './ui';
import { metalStrip, tokens } from '../theme/tokens';

export async function loadReferenceAudio() {
  const f = await pickFile('.wav,.mp3,.flac,audio/wav,audio/mpeg,audio/flac');
  if (!f) return;
  const s = useStore.getState();
  try {
    const dur = await preview.loadReference(await f.arrayBuffer());
    s.edit((p) => ({ ...p, referenceAudio: { ...p.referenceAudio, path: f.name } }));
    s.set({ refVersion: Date.now() });
    s.toast('success', `Loaded ${f.name} (${dur.toFixed(1)} s)`);
  } catch (e) {
    s.toast('error', `Could not decode ${f.name}: ${(e as Error).message || 'unsupported format'}`);
  }
}

export const VstButton = memo(function VstButton({ track, compact, iconOnly }: { track: Track; compact?: boolean; iconOnly?: boolean }) {
  const project = useStore((s) => s.project);
  useStore((s) => s.pluginLoading);
  useStore((s) => s.engineConnected);
  const info = routingInfo(project, track);
  const label = info.pluginName ?? info.groupName ?? 'No plugin';
  const tip = `${info.loading ? 'Loading plugin… ' : info.error ? 'Plugin failed to load — playing preview sound. ' : ''}`
    + `Plugin: ${info.pluginName ?? 'none'} · Group: ${info.groupName ?? 'none'} · Ch ${track.midiChannel}${info.preview ? ' · Playing built-in PREVIEW sound' : ''}. Click to choose a VST3.`;
  return (
    <button
      type="button" title={tip} aria-label={tip} data-testid="vst-btn"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); useStore.getState().set({ modal: 'vst', vstTargetTrackId: track.id }); }}
      className={cn(
        'screen flex h-[22px] min-w-0 items-center gap-1 px-1.5 text-[11px] transition-colors',
        info.error ? 'text-[var(--c-danger)]' : 'text-[var(--c-textDim)] hover:text-[var(--c-text)]',
        compact ? 'max-w-[86px]' : 'max-w-[112px]',
      )}
    >
      <Ico icon={info.loading ? I.spinner : info.error ? I.warn : I.plug} className={cn('text-xs', info.loading && 'animate-spin')} />
      {!iconOnly && <span className={cn('truncate', !info.pluginName && !info.groupName && 'italic')}>{label}</span>}
      {!iconOnly && info.preview && <span className="printed ml-auto shrink-0 text-[8px] text-[var(--c-warn)]" title="Built-in preview sound">prv</span>}
    </button>
  );
});

function Strip({ color }: { color: string }) {
  return (
    <div className="absolute left-0 top-0 h-full w-[4px]" style={{ background: metalStrip(color) }} aria-hidden>
      <div className="absolute inset-y-0 left-full w-px opacity-60" style={{ background: color }} />
    </div>
  );
}

/** Generate + Settings for the Chords track header (spec §1, §2, §4).
 *  Generate: primary hardware action — executes immediately, never opens a
 *  dialog; its tooltip states the auto-detected scope and follows the project
 *  and selection live. Settings: small gear beside it, opens the settings
 *  panel only. */
export const ChordGenButtons = memo(function ChordGenButtons() {
  const project = useStore((s) => s.project);
  const selectedSectionId = useStore((s) => s.selectedSectionId);
  const tip = scopeTooltip(detectGenerationScope(project, selectedSectionId), project);
  return (
    <div className="flex shrink-0 items-center gap-1.5 self-center" data-testid="chordgen-controls">
      <button
        type="button" data-testid="chordgen-generate" title={tip} aria-label={tip}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); runChordGenerate(); }}
        className="hw hw-primary flex h-[27px] items-center gap-1.5 rounded px-3 text-[11px] font-bold uppercase tracking-[0.1em]"
      >
        <Ico icon={I.magic} className="text-[13px]" /> Generate
      </button>
      <IconButton icon={I.gear} tip="Chord generator settings" testId="chordgen-settings" size="sm"
        onClick={() => useStore.getState().set({ modal: 'chordgenSettings' })} />
    </div>
  );
});

export const TrackHeader = memo(function TrackHeader({ track, index, selected }: { track: Track; index: number; selected: boolean }) {
  const updateTrack = useStore((s) => s.updateTrack);
  const freeze = useStore((s) => s.freezeProgress[track.id]);
  const refOffset = useStore((s) => (track.family === 'Audio' ? s.project.referenceAudio.offsetMs : 0));
  const refPath = useStore((s) => (track.family === 'Audio' ? s.project.referenceAudio.path : null));
  const edit = useStore((s) => s.edit);
  const select = (e: React.MouseEvent) => {
    const s = useStore.getState();
    const ids = e.ctrlKey || e.metaKey ? (s.selectedTrackIds.includes(track.id) ? s.selectedTrackIds.filter((x) => x !== track.id) : [...s.selectedTrackIds, track.id]) : [track.id];
    s.set({ selectedTrackIds: ids });
  };
  const base = cn(
    'panel sticky left-0 z-20 flex h-full items-stretch border-b border-r border-[#0f0f11] pl-[10px] pr-2 transition-[filter]',
    selected && 'brightness-[1.35]',
  );
  const style = { width: HEADER_W, height: ROW_H };

  if (track.family === 'Structure' || track.family === 'Audio') {
    return (
      <div className={base} style={style} onClick={select} data-track-header={track.id}>
        <Strip color={track.color} />
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
          <div className="flex items-center gap-2">
            <Ico icon={track.role === 'structure' ? I.dots : track.role === 'chords' ? I.notes : I.wave} className="text-[var(--c-textMute)]" />
            <span className="truncate text-[13px] font-bold">{track.name}</span>
          </div>
          <div className="truncate text-[10px] text-[var(--c-textMute)]">
            {track.role === 'structure' && 'Drag to create · double-click to rename'}
            {track.role === 'chords' && 'Click to place · type a symbol · right-click a chord to lock'}
            {track.family === 'Audio' && (refPath ? refPath : 'No audio loaded (wav / mp3 / flac)')}
          </div>
        </div>
        {track.role === 'chords' && <ChordGenButtons />}
        {track.family === 'Audio' && (
          <div className="flex items-center gap-1">
            <IconButton icon={I.upload} tip="Load reference audio (wav, mp3, flac)" onClick={() => void loadReferenceAudio()} />
            <div className="flex flex-col items-center gap-0.5">
              <NumberField value={refOffset} min={-600000} max={600000} step={10} width={50} suffix="ms" tip="Audio offset in ms (positive = audio starts later). Arrow keys nudge by 10 ms." onCommit={(v) => edit((p) => ({ ...p, referenceAudio: { ...p.referenceAudio, offsetMs: Math.round(v) } }))} />
            </div>
            <div className="flex flex-col items-center gap-1">
              <ToggleChip on={track.muted} label="M" tip="Mute reference audio (M)" color={tokens.mute} onClick={() => updateTrack(track.id, { muted: !track.muted })} />
            </div>
            <MiniSlider value={track.volume} min={0} max={1.5} def={0.8} width={40} tip="Reference volume" onChange={(v) => updateTrack(track.id, { volume: Math.round(v * 100) / 100 }, `vol-${track.id}`)} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={base} style={style} onClick={select} data-track-header={track.id} data-testid="track-header">
      <Strip color={track.color} />
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-[5px] py-1.5">
        <div className="flex items-center gap-1.5">
          <span className="w-4 shrink-0 text-right font-mono text-[10px] text-[var(--c-textMute)]">{index + 1}</span>
          <span className={cn('min-w-0 flex-1 truncate text-[13px] font-bold', track.muted && 'opacity-50')} title={`${track.name} · role "${track.role}"`}>{track.name}</span>
          <ToggleChip on={track.locked} label="L" tip={track.locked ? 'Locked — Compose All keeps this track (L)' : 'Lock track (L)'} color={tokens.lock} onClick={() => updateTrack(track.id, { locked: !track.locked })} />
          <ToggleChip on={track.muted} label="M" tip="Mute (M) — preview only, still generated & exported" color={tokens.mute} onClick={() => updateTrack(track.id, { muted: !track.muted })} />
          <ToggleChip on={track.soloed} label="S" tip="Solo (S) — preview only" color={tokens.solo} onClick={() => updateTrack(track.id, { soloed: !track.soloed })} />
          <button
            title={freeze !== undefined ? `Rendering… ${Math.round(freeze * 100)}%` : track.frozen ? 'Frozen — click to unfreeze' : 'Freeze: render to audio and play that instead'}
            aria-label="Freeze" onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); toggleFreeze(track.id); }}
            className="relative flex h-[22px] w-[22px] items-center justify-center overflow-hidden rounded border text-[12px]"
            style={track.frozen ? { background: tokens.freeze, color: tokens.accentText, borderColor: tokens.freeze } : { borderColor: tokens.line, color: tokens.textDim, background: tokens.bg2 }}
          >
            {freeze !== undefined && <div className="absolute bottom-0 left-0 h-full bg-[var(--c-freeze)] opacity-40" style={{ width: `${freeze * 100}%` }} />}
            <Ico icon={freeze !== undefined ? I.spinner : I.snowflake} className={cn(freeze !== undefined && 'animate-spin')} />
          </button>
        </div>
        <div className="flex items-center gap-1.5 pl-[22px]">
          <VstButton track={track} />
          <span className="printed px-1 text-[9px]" title={`MIDI channel ${track.midiChannel}`}>ch{String(track.midiChannel).padStart(2, '0')}</span>
          <MiniSlider value={track.volume} min={0} max={1.5} def={0.8} width={52} color={track.color} tip="Volume (preview only)" format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => updateTrack(track.id, { volume: Math.round(v * 100) / 100 }, `vol-${track.id}`)} />
          <Knob value={track.pan} tip="Pan (preview only)" size={20} onChange={(v) => updateTrack(track.id, { pan: v }, `pan-${track.id}`)} />
        </div>
      </div>
    </div>
  );
});
