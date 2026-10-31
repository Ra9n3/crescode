/**
 * The chord editing UI the double-click gesture opens (feature spec §4,
 * redesigned into the compact Smart Chord popup).
 *
 * A small floating picker anchored near the clip being edited — never
 * creates or moves clips: it loads the clip's chord, raw MIDI notes,
 * confidence and alternative interpretations (via loadClipEditorData), and
 * applies edits through ChordTrackAPI transactions that preserve id,
 * position, length and metadata.
 *
 * Redesign notes (compact picker):
 *  - The shell is a narrow column (344px): header strip, thin chord-name
 *    field, one compact reading line (status + reads-as chips), the
 *    immediate-selection suggestion grid, and a single micro footer. The
 *    confidence bar, pitch-class chip rows and hint paragraphs are gone —
 *    the confidence and the analysis details live on tooltips.
 *  - The popup anchors just below the edited clip when the arranger
 *    geometry is reachable (lane rect + px-per-tick, clamped to the
 *    viewport); it falls back to the docked top-right spot otherwise.
 *  - Picking a suggestion applies immediately and the popup STAYS open —
 *    the user keeps building the progression (see ChordSuggestions).
 *  - Clicking OUTSIDE the popup closes it (capture-phase pointerdown;
 *    chord-lane clicks are excluded — they manage the target themselves:
 *    a card re-targets it, empty space re-targets it to the created chord).
 *  - When the target clip changes, the popup GLIDES to the new anchor with
 *    a subtle ease; scroll/zoom re-anchors stay instant (no clip change →
 *    no transition). It stacks BELOW the track headers (header cells sit at
 *    a higher z), so scrolling never covers them.
 *
 * The user preference for new-clip content (empty vs root-note placeholder)
 * lives here as a persisted setting.
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
  clear: 'clear',
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

/** Viewport anchor for the popup: just below the edited clip inside the
 *  chord lane, clamped so the popup never leaves the window. Null = the
 *  arranger geometry is not reachable (docked fallback). */
function useAnchor(clipId: string | null, startTime: number, pxPerTick: number, project: unknown): { left: number; top: number } | null {
  const [tick, setTick] = useState(0); // arranger scroll re-anchors the popup
  useEffect(() => {
    const scroller = document.getElementById('arranger-scroll');
    if (scroller === null) return;
    const fn = () => setTick((t) => t + 1);
    scroller.addEventListener('scroll', fn, { passive: true });
    return () => scroller.removeEventListener('scroll', fn);
  }, []);
  return useMemo(() => {
    void tick;
    if (clipId === null) return null;
    try {
      const lane = document.querySelector('[data-testid="chord-lane"]');
      if (lane === null) return null;
      const r = lane.getBoundingClientRect(); // live viewport box — scroll already baked in
      const x = r.left + startTime * pxPerTick;
      const W = 344;
      return { left: Math.max(8, Math.min(x, window.innerWidth - W - 8)), top: Math.min(r.bottom + 6, window.innerHeight - 160) };
    } catch {
      return null;
    }
    // `project` re-anchors on every project edit (lane length/zoom changes)
  }, [clipId, startTime, pxPerTick, project, tick]);
}

export function ChordEditor() {
  const clipId = useStore((s) => s.suggestionClipId);
  const chordRenameId = useStore((s) => s.chordRenameId);
  const project = useStore((s) => s.project);
  const pxPerTick = useStore((s) => s.pxPerTick);
  const placeholderPref = useStore((s) => s.settings.smartChordPlaceholder);
  // Minimized = header only; the picker itself never closes on apply —
  // the user closes it (Esc / X) when done building the progression.
  const [minimized, setMinimized] = useState(false);

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
  const editorRef = useRef<HTMLDivElement>(null);

  // Click outside closes the picker — capture phase, so inner
  // stopPropagation (drag starts, lane gestures) can never swallow it.
  // Clicks inside the popup never close it; clicks on the chord lane are
  // excluded too because they manage the popup's target themselves (a card
  // re-targets it, empty space re-targets it onto the created chord).
  useEffect(() => {
    if (clipId === null) return;
    const fn = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      const ed = editorRef.current;
      if (ed !== null && ed.contains(t)) return;
      const lane = document.querySelector('[data-testid="chord-lane"]');
      if (lane !== null && lane.contains(t)) return;
      useStore.getState().set({ suggestionClipId: null });
    };
    window.addEventListener('pointerdown', fn, true);
    return () => window.removeEventListener('pointerdown', fn, true);
  }, [clipId]);

  // Re-target glide: when the popup follows another chord (card click or a
  // freshly created one), it moves to the new anchor with a subtle ease.
  // The position is STAGED: a clip change turns the transition on first and
  // applies the new anchor a frame later, so the browser actually animates;
  // scroll and zoom re-anchors change position WITHOUT a clip change — they
  // apply instantly, so the popup never chases the scrollbar.
  const anchor = useAnchor(clipId, data?.clip.startTime ?? 0, pxPerTick, project);
  const [pos, setPos] = useState(anchor);
  const [glide, setGlide] = useState(false);
  const glideRef = useRef(false);
  const latestAnchorRef = useRef(anchor);
  const prevClipRef = useRef<string | null>(null);
  useEffect(() => {
    latestAnchorRef.current = anchor;
    if (glideRef.current) return; // a glide owns the position this frame
    setPos(anchor);
  }, [anchor]);
  useEffect(() => {
    const prev = prevClipRef.current;
    prevClipRef.current = clipId;
    if (clipId === null || prev === null || prev === clipId) {
      glideRef.current = false;
      setGlide(false);
      setPos(latestAnchorRef.current);
      return;
    }
    glideRef.current = true;
    setGlide(true);
    const move = setTimeout(() => setPos(latestAnchorRef.current), 20); // one frame later: transition runs
    const stop = setTimeout(() => { glideRef.current = false; setGlide(false); }, 300);
    return () => { clearTimeout(move); clearTimeout(stop); };
  }, [clipId]);

  // Esc: first press leaves the symbol draft, second press closes the picker.
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
    } catch (err) {
      chordTrackApi.cancelUndoTransaction();
      useStore.getState().toast('error', err instanceof Error ? err.message : String(err));
    }
  };

  const barBeat = tickToBarBeat(clip.startTime, project.timeSignature);
  const confidence = analysis !== null ? analysis.confidence : Math.round(clip.chord.confidence * 100);

  return (
    <div
      ref={editorRef}
      className={cn('fixed z-40 flex max-h-[calc(100vh-100px)] w-[344px] flex-col overflow-y-auto rounded-lg border border-[var(--c-lineStrong)] bg-[var(--c-bg1)] shadow-2xl animate-[pop_.16s_ease]',
        pos === null && 'right-3 top-[70px]',
        glide && pos !== null && 'transition-[left,top] duration-200 ease-out')}
      style={pos !== null ? { left: pos.left, top: pos.top } : undefined}
      data-testid="chord-editor"
    >
      {/* header — one thin strip: identity, position, window controls */}
      <div className="flex items-center gap-1.5 border-b border-[var(--c-line)] px-2 py-1">
        <Ico icon={I.magic} className="text-[11px] text-[var(--c-accent)]" />
        <span className="font-mono text-[9px] text-[var(--c-textMute)]" title={`clip ${clip.id} · ticks [${clip.startTime}, ${clip.startTime + clip.lengthTicks})`}>
          bar {barBeat.bar} · beat {barBeat.beat}
        </span>
        <span className="ml-auto" />
        <IconButton icon={minimized ? I.caret : I.minus} size="sm" tip={minimized ? 'Expand the chord picker' : 'Minimize the chord picker'} testId="chord-editor-minimize" onClick={() => setMinimized((m) => !m)} />
        <IconButton icon={I.trash} size="sm" tip="Delete this clip (Delete)" onClick={() => { useStore.getState().deleteChord(clip.id); useStore.getState().set({ suggestionClipId: null }); }} />
        <IconButton icon={I.x} size="sm" tip="Close chord picker (Esc)" onClick={() => useStore.getState().set({ suggestionClipId: null })} />
      </div>

      {minimized ? (
        <div className="px-2 py-1 text-[9px] text-[var(--c-textMute)]">
          Minimized — expand to keep building the progression.
        </div>
      ) : (
        <>
          {/* chord name — thin field, renames through the API; position/length
              are never touched. No autofocus while the lane's inline rename
              editor owns the keyboard; external renames (the picker's own
              picks, undo, the lane input) sync into the field WITHOUT
              remounting, so keyboard focus is never stolen mid-workflow. */}
          <div className="px-1.5 pt-1.5">
            <SymbolInput ref={symRef} initial={clip.chord.spelling} autoFocus={chordRenameId !== clip.id} onCommit={rename} />
          </div>

          {/* reading — one compact line: current chord · status; confidence
              and analysis details on the chip's tooltip (redesign §6) */}
          <div className="flex items-center gap-1.5 px-1.5 pt-1 text-[10px] leading-tight">
            {analysis === null ? (
              <span className="text-[var(--c-textMute)]" title="Typed chord — no MIDI backing in this clip. Confidence 100 (user-authored).">
                {notes.length === 0 ? 'typed · empty clip' : 'typed chord'}
              </span>
            ) : (
              <>
                <span className="font-mono text-[11px] font-bold">{analysis.chord?.spelling ?? '—'}</span>
                {analysis.chord !== null && <span className="uppercase tracking-wider text-[var(--c-textMute)]">{analysis.chord.quality}</span>}
                <span className={cn('rounded border px-1 text-[8px] font-semibold uppercase tracking-wider', STATUS_CLASS[analysis.status])}
                  title={`read confidence ${confidence}/100${analysis.matchedPitchClasses.length ? ` · tones: ${analysis.matchedPitchClasses.map(spelledNoteName).join(' ')}` : ''}${analysis.missingPitchClasses.length ? ` · missing: ${analysis.missingPitchClasses.map(spelledNoteName).join(' ')}` : ''}${analysis.extraPitchClasses.length ? ` · unexplained: ${analysis.extraPitchClasses.map(spelledNoteName).join(' ')}` : ''}`}>
                  {STATUS_LABEL[analysis.status]}
                </span>
                {analysis.alternatives.length > 0 && (
                  <span className="ml-auto flex min-w-0 items-center gap-1" title="Also reads as — click to name the clip">
                    {analysis.alternatives.slice(0, 3).map((alt, i) => (
                      <button key={`${alt.chord.spelling}-${i}`} type="button" onClick={() => rename(alt.chord.spelling)}
                        className="rounded border border-[var(--c-line)] px-1 font-mono text-[9px] leading-4 text-[var(--c-textDim)] hover:border-[var(--c-accent)] hover:text-[var(--c-text)]"
                        title={`Apply ${alt.chord.spelling} (one undo step)`}>
                        {alt.chord.spelling}
                      </button>
                    ))}
                  </span>
                )}
              </>
            )}
          </div>

          {/* suggestions — the compact immediate-selection grid */}
          <ChordSuggestions clip={clip} />

          {/* footer — one micro line: clip content · new-clip preference */}
          <div className="mt-auto flex items-center gap-1.5 border-t border-[var(--c-line)] px-1.5 py-1 font-mono text-[9px] text-[var(--c-textMute)]">
            <Ico icon={I.notes} className="text-[10px]" />
            <span title="MIDI notes on the Chords track inside this clip">
              {notes.length === 0 ? 'empty' : `${notes.length} note${notes.length === 1 ? '' : 's'}`}
            </span>
            <span className="ml-auto flex items-center gap-1" title="Content of a freshly created Smart Chord clip (double-click on empty lane)">
              <span className="font-sans uppercase tracking-wider">new clip</span>
              {(['empty', 'root-note'] as const).map((v) => (
                <button key={v} type="button" data-testid={`placeholder-${v}`}
                  onClick={() => useStore.getState().setSettings({ smartChordPlaceholder: v })}
                  className={cn('rounded px-1 py-px font-semibold', placeholderPref === v ? 'bg-[var(--c-bg4)] text-[var(--c-text)]' : 'text-[var(--c-textDim)] hover:bg-[var(--c-bg4)]')}>
                  {v === 'empty' ? 'Empty' : 'Root'}
                </button>
              ))}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

/** Symbol field with live validation through the shared parser — one chord
 *  grammar in crescode, so the editor cannot store an unparseable name.
 *  `autoFocus` yields the keyboard to the lane's inline rename editor while
 *  that is open on the same clip. Thin, compact (redesign §2). An `initial`
 *  change syncs into the field only while the user is NOT typing in it —
 *  the picker's immediate applies and undo never grab the keyboard. */
const SymbolInput = forwardRef<HTMLInputElement, { initial: string; autoFocus?: boolean; onCommit: (symbol: string) => void }>(
  function SymbolInput({ initial, autoFocus = true, onCommit }, ref) {
    const [value, setValue] = useState(initial);
    const editingRef = useRef(false);
    useEffect(() => {
      if (!editingRef.current) setValue(initial);
    }, [initial]);
    const valid = parseChord(value).ok;
    const commit = () => {
      const v = value.trim();
      if (!valid && v.length > 0) return; // keep the draft; the color says why
      if (v.length === 0 || v === initial) return;
      onCommit(v);
    };
    return (
      <input
        ref={ref} autoFocus={autoFocus} value={value} spellCheck={false} data-testid="chord-editor-symbol"
        className={cn('w-full rounded border bg-[var(--c-bg0)] px-1.5 py-1 font-mono text-[13px] font-semibold outline-none',
          valid ? 'border-[var(--c-lineStrong)]' : 'border-[var(--c-danger)]')}
        style={{ color: valid ? tokens.text : tokens.danger }}
        aria-label="Chord symbol"
        onFocus={() => { editingRef.current = true; }}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        onBlur={() => { editingRef.current = false; commit(); }}
      />
    );
  },
);
