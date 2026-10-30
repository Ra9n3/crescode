/**
 * The chord editing UI the double-click gesture opens (feature spec §4).
 *
 * Floating inspector for one chord-lane clip — never creates or moves
 * clips: it loads the clip's chord, raw MIDI notes, confidence and
 * alternative interpretations (via loadClipEditorData), and applies edits
 * through ChordTrackAPI transactions that preserve id, position, length
 * and metadata. The user preference for new-clip content (empty vs
 * root-note placeholder) lives here as a persisted setting.
 */
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { parseChord, tickToBarBeat } from '../shared/schema';
import { chordTrackApi } from '../engine/suggestion/wire';
import { loadClipEditorData } from '../engine/suggestion/interaction';
import { spelledNoteName } from '../engine/suggestion/model';
import type { ChordAnalysisStatus } from '../engine/suggestion/parse';
import { ChordSuggestions } from './ChordSuggestions';
import { tokens } from '../theme/tokens';
import { cn } from '../utils/cn';
import { I } from './icons';
import { Ico, IconButton } from './ui';

const STATUS_LABEL: Record<ChordAnalysisStatus, string> = {
  clear: 'clear read',
  ambiguous: 'ambiguous',
  incomplete: 'incomplete',
  unknown: 'unknown',
};

const STATUS_CLASS: Record<ChordAnalysisStatus, string> = {
  clear: 'border-[var(--c-info)] text-[var(--c-info)]',
  ambiguous: 'border-[var(--c-warn)] text-[var(--c-warn)]',
  incomplete: 'border-[var(--c-textMute)] text-[var(--c-textDim)]',
  unknown: 'border-[var(--c-danger)] text-[var(--c-danger)]',
};

const trim2 = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, ''));

function PcChips({ title, pcs, className }: { title: string; pcs: number[]; className: string }) {
  if (pcs.length === 0) return null;
  return (
    <div className="flex min-w-0 items-center gap-1" title={title}>
      {pcs.map((pc) => (
        <span key={pc} className={cn('rounded border px-1 font-mono text-[10px] leading-4', className)}>{spelledNoteName(pc)}</span>
      ))}
    </div>
  );
}

export function ChordEditor() {
  const clipId = useStore((s) => s.suggestionClipId);
  const project = useStore((s) => s.project);
  const placeholderPref = useStore((s) => s.settings.smartChordPlaceholder);
  // Minimized = header only; Apply closes or minimizes per the user setting.
  const [minimized, setMinimized] = useState(false);
  // Bumped when THIS panel renames the clip, so the overlay's drift baseline
  // follows the overlay's own edits (external edits still warn on Apply).
  const [renameRev, setRenameRev] = useState(0);

  // Reload on every project edit so the inspector always shows the live clip.
  const data = useMemo(
    () => (clipId === null ? null : loadClipEditorData(chordTrackApi, clipId)),
    [clipId, project],
  );

  // Undo/delete while open: the clip is gone — close instead of showing a ghost.
  useEffect(() => {
    if (clipId !== null && data === null) useStore.getState().set({ suggestionClipId: null });
  }, [clipId, data]);

  const symRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (clipId === null) return;
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (symRef.current !== null && document.activeElement === symRef.current) {
        symRef.current.blur(); // first Esc leaves the symbol draft
        return;
      }
      useStore.getState().set({ suggestionClipId: null });
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [clipId]);

  if (clipId === null || data === null) return null;
  const { clip, analysis } = data;
  const notes = clip.rawMidiNotes ?? [];

  const rename = (symbol: string) => {
    chordTrackApi.beginUndoTransaction('Rename Chord');
    try {
      chordTrackApi.renameChordClip(clip.id, symbol);
      chordTrackApi.commitUndoTransaction();
      setRenameRev((r) => r + 1);
    } catch (err) {
      chordTrackApi.cancelUndoTransaction();
      useStore.getState().toast('error', err instanceof Error ? err.message : String(err));
    }
  };

  // Apply finished: close or minimize the overlay, per the persisted setting.
  const onApplied = () => {
    if (useStore.getState().settings.smartChordApply === 'minimize') setMinimized(true);
    else useStore.getState().set({ suggestionClipId: null });
  };

  const pos = tickToBarBeat(clip.startTime, project.timeSignature);
  const bars = clip.lengthTicks / data.grid.ticksPerBar;
  const confidence = analysis !== null ? analysis.confidence : Math.round(clip.chord.confidence * 100);

  return (
    <div className="fixed right-3 top-[70px] z-40 flex max-h-[calc(100vh-100px)] w-[540px] flex-col overflow-y-auto rounded-xl border border-[var(--c-lineStrong)] bg-[var(--c-bg1)] shadow-2xl animate-[pop_.16s_ease]" data-testid="chord-editor">
      {/* header */}
      <div className="flex items-center gap-2 border-b border-[var(--c-line)] px-3 py-2">
        <Ico icon={I.magic} className="text-[var(--c-accent)]" />
        <span className="text-sm font-bold">Smart Chords</span>
        <span className="font-mono text-[10px] text-[var(--c-textMute)]" title={`clip ${clip.id} · ticks [${clip.startTime}, ${clip.startTime + clip.lengthTicks})`}>
          bar {pos.bar} · beat {pos.beat} · {trim2(bars)} bar{bars === 1 ? '' : 's'}
        </span>
        <span className="ml-auto" />
        <IconButton icon={minimized ? I.caret : I.minus} tip={minimized ? 'Expand the chord editor' : 'Minimize the chord editor'} testId="chord-editor-minimize" onClick={() => setMinimized((m) => !m)} />
        <IconButton icon={I.trash} tip="Delete this clip (Delete)" onClick={() => { useStore.getState().deleteChord(clip.id); useStore.getState().set({ suggestionClipId: null }); }} />
        <IconButton icon={I.x} tip="Close chord editor (Esc)" onClick={() => useStore.getState().set({ suggestionClipId: null })} />
      </div>

      {minimized ? (
        <div className="px-3 py-1.5 text-[10px] text-[var(--c-textMute)]">
          Minimized — the chord keeps playing; expand to edit or apply.
        </div>
      ) : (
        <>
          {/* symbol — renames through the API; position/length are never touched */}
          <div className="flex items-center gap-2 px-3 pt-2.5">
            <SymbolInput key={`${clip.id}:${clip.chord.spelling}`} ref={symRef} initial={clip.chord.spelling} onCommit={rename} />
          </div>

      {/* reading */}
      <div className="flex flex-col gap-2 px-3 py-2.5">
        {analysis === null ? (
          <div className="rounded-md border border-[var(--c-line)] bg-[var(--c-bg2)] px-2.5 py-2 text-[11px] leading-relaxed text-[var(--c-textDim)]">
            {notes.length === 0
              ? 'Typed chord — no MIDI backing in this clip. Confidence 100 (user-authored). Double-click empty lane space to add a Smart clip with MIDI.'
              : 'Typed chord.'}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[15px] font-bold">{analysis.chord?.spelling ?? '—'}</span>
              {analysis.chord !== null && <span className="text-[10px] uppercase tracking-wider text-[var(--c-textMute)]">{analysis.chord.quality}</span>}
              <span className={cn('ml-auto rounded border px-1.5 text-[10px] font-semibold uppercase tracking-wider', STATUS_CLASS[analysis.status])}>{STATUS_LABEL[analysis.status]}</span>
            </div>
            <div className="flex items-center gap-2" title={`analysis confidence ${analysis.confidence}/100`}>
              <span className="text-[10px] uppercase tracking-wider text-[var(--c-textMute)]">confidence</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded bg-[var(--c-bg4)]">
                <div className="h-full rounded" style={{ width: `${Math.max(0, Math.min(100, confidence))}%`, background: confidence >= 60 ? tokens.accent : confidence >= 35 ? tokens.warn : tokens.danger }} />
              </div>
              <span className="w-7 text-right font-mono text-[10px] text-[var(--c-textDim)]">{confidence}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <PcChips title="Chord tones present in the clip" pcs={analysis.matchedPitchClasses} className="border-[var(--c-info)] text-[var(--c-info)]" />
              <PcChips title="Chord tones missing from the clip" pcs={analysis.missingPitchClasses} className="border-dashed border-[var(--c-textMute)] text-[var(--c-textMute)]" />
              <PcChips title="Notes the chord does not explain" pcs={analysis.extraPitchClasses} className="border-[var(--c-warn)] text-[var(--c-warn)]" />
            </div>
            {analysis.alternatives.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-[var(--c-textMute)]">Also reads as — click to name the clip</span>
                {analysis.alternatives.slice(0, 4).map((alt, i) => (
                  <button key={`${alt.chord.spelling}-${i}`} onClick={() => rename(alt.chord.spelling)}
                    className="flex items-center gap-2 rounded border border-[var(--c-line)] bg-[var(--c-bg2)] px-2 py-1 text-left hover:border-[var(--c-accent)]"
                    title={`Apply ${alt.chord.spelling} (one undo step)`}>
                    <span className="font-mono text-[12px] font-semibold">{alt.chord.spelling}</span>
                    <span className="text-[10px] text-[var(--c-textMute)]">{alt.chord.quality}</span>
                    <span className="ml-auto font-mono text-[10px] text-[var(--c-textDim)]">{Math.round(alt.confidence * 100)}%</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* suggestions overlay — chord grid, customization, MIDI preview, Apply */}
      <ChordSuggestions clip={clip} renameRev={renameRev} onApplied={onApplied} />

      {/* footer: notes + preference */}
      <div className="mt-auto flex flex-col gap-1.5 border-t border-[var(--c-line)] px-3 py-2">
        <div className="flex items-center gap-2 font-mono text-[10px] text-[var(--c-textMute)]">
          <Ico icon={I.notes} />
          {notes.length === 0
            ? 'clip is empty'
            : `${notes.length} note${notes.length === 1 ? '' : 's'}${analysis?.bassPitchClass !== null && analysis?.bassPitchClass !== undefined ? ` · bass ${spelledNoteName(analysis.bassPitchClass)}` : ''}`}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-[var(--c-textMute)]">New clips start</span>
          {(['empty', 'root-note'] as const).map((v) => (
            <button key={v} data-testid={`placeholder-${v}`}
              onClick={() => useStore.getState().setSettings({ smartChordPlaceholder: v })}
              className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold', placeholderPref === v ? 'bg-[var(--c-accent)] text-[var(--c-accentText)]' : 'text-[var(--c-textDim)] hover:bg-[var(--c-bg4)]')}>
              {v === 'empty' ? 'Empty' : 'Root note'}
            </button>
          ))}
        </div>
        <div className="text-[10px] leading-relaxed text-[var(--c-textMute)]">
          Enter applies a symbol · Esc closes · Delete removes the clip · every change is one undo step.
        </div>
      </div>
        </>
      )}
    </div>
  );
}

/** Symbol field with live validation through the shared parser — one chord
 *  grammar in crescode, so the editor cannot store an unparseable name. */
const SymbolInput = forwardRef<HTMLInputElement, { initial: string; onCommit: (symbol: string) => void }>(
  function SymbolInput({ initial, onCommit }, ref) {
    const [value, setValue] = useState(initial);
    const valid = parseChord(value).ok;
    const commit = () => {
      const v = value.trim();
      if (!valid && v.length > 0) return; // keep the draft; the color says why
      if (v.length === 0 || v === initial) return;
      onCommit(v);
    };
    return (
      <input
        ref={ref} autoFocus value={value} spellCheck={false} data-testid="chord-editor-symbol"
        className={cn('w-full rounded border bg-[var(--c-bg0)] px-2 py-1.5 font-mono text-[14px] font-semibold outline-none',
          valid ? 'border-[var(--c-lineStrong)]' : 'border-[var(--c-danger)]')}
        style={{ color: valid ? tokens.text : tokens.danger }}
        aria-label="Chord symbol"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        onBlur={commit}
      />
    );
  },
);
