/**
 * Inline text entry + renaming for one chord-lane clip (feature spec:
 * "text-based chord entry and renaming").
 *
 * Opened by double-clicking an existing chord name on the chord lane, this
 * editor floats AT the clip ("at or near the chord clip"): the input is
 * preloaded with the clip's current chord name, every keystroke runs through
 * the pure textentry module (grammar → ambiguity → triad-only completions →
 * key normalization → live MIDI preview), and a commit is ONE "Rename Chord"
 * undo transaction through the ChordTrackAPI that rewrites the clip's MIDI
 * and its displayed name while preserving start time, length, lane and
 * metadata. The clip is never recreated, moved or resized here.
 *
 * Non-destructive edge cases (spec §6):
 *  - invalid text      → inline validation message, clip untouched;
 *  - ambiguous text    → both readings are offered and the user MUST choose
 *                        one (Enter is a no-op until they do);
 *  - substantial user MIDI the analyzer cannot read as a chord → a warning
 *                        with explicit confirm before anything is replaced;
 *  - a failed DAW op   → the transaction was cancelled (timeline restored),
 *                        reported as an error toast, input stays open.
 *
 * Non-blocking by construction: no backdrop, no focus trap — the DAW stays
 * interactive; blur, Escape or a successful commit close the editor.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { chordTrackApi } from '../engine/suggestion/wire';
import { projectKeyOf } from '../engine/suggestion/model';
import {
  applyChordTextToClip, interpretChordText, suggestChordCompletions, voiceChordText,
} from '../engine/suggestion/textentry';
import { takeClipSnapshot, type ClipDrift, type ClipSnapshot } from '../engine/suggestion/overlay';
import { voicingLabel } from '../engine/suggestion/voicing';
import { tokens } from '../theme/tokens';
import { cn } from '../utils/cn';
import { ROW_H } from './ui';

const DRIFT_TEXT: Record<ClipDrift, string> = {
  missing: 'no longer exists',
  moved: 'was moved',
  renamed: 'was renamed',
  edited: 'had its notes edited',
};

type Row =
  | { kind: 'interpretation'; symbol: string; quality: string }
  | { kind: 'completion'; symbol: string; quality: string; diatonic: boolean; exact: boolean };

export interface ChordRenameInputProps {
  clip: { id: string; symbol: string; startTick: number; durationTicks: number };
  /** Lane pixels per tick — anchors the editor over the clip. */
  ppt: number;
  /** Close the editor (after commit, cancel or Escape). */
  onDone: () => void;
}

export function ChordRenameInput({ clip, ppt, onDone }: ChordRenameInputProps) {
  const project = useStore((s) => s.project);
  const toast = useStore((s) => s.toast);
  const key = useMemo(() => projectKeyOf(project), [project]);

  const [value, setValue] = useState(clip.symbol);
  const [active, setActive] = useState(0);
  const [warn, setWarn] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const snapshotRef = useRef<ClipSnapshot | null>(null);

  // Drift baseline + focus: captured once when the editor opens.
  useEffect(() => {
    const live = chordTrackApi.getChordClipById(clip.id);
    snapshotRef.current = live === null ? null : takeClipSnapshot(live);
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [clip.id]);

  const interp = useMemo(() => interpretChordText(value), [value]);
  const completions = useMemo(
    () => (interp.status === 'ok' ? suggestChordCompletions(value, key) : []),
    [interp, value, key],
  );
  const preview = useMemo(
    () => (interp.status === 'ok' ? voiceChordText(value, key) : null),
    [interp, value, key],
  );

  const rows: Row[] = interp.status === 'ambiguous'
    ? interp.interpretations.map((c) => ({ kind: 'interpretation', symbol: c.spelling, quality: c.quality }))
    : completions.map((c) => ({ kind: 'completion', symbol: c.symbol, quality: c.quality, diatonic: c.diatonic, exact: c.exact }));
  const showRows = value.trim().length > 0 && (interp.status === 'ambiguous' || interp.status === 'ok') && rows.length > 0;
  const changed = value.trim() !== clip.symbol;
  const valid = interp.status !== 'invalid';

  const close = onDone;

  const commit = (text: string, confirmUnsafe = false) => {
    const outcome = applyChordTextToClip(chordTrackApi, clip.id, text, key, { snapshot: snapshotRef.current, confirmUnsafe });
    if (outcome.ok) {
      close();
      return;
    }
    switch (outcome.reason) {
      case 'invalid':
        toast('error', outcome.error);
        break;
      case 'ambiguous':
        break; // the two readings are on screen — the user must choose one
      case 'unrecognized-midi':
        setWarn(outcome.message);
        break;
      case 'locked':
        toast('warn', outcome.message);
        break;
      case 'drift':
        toast('warn', `Chord not renamed — the clip ${DRIFT_TEXT[outcome.drift]} since the editor opened. Nothing was overwritten.`);
        break;
      case 'error':
        toast('error', `Rename failed — the timeline was restored. (${outcome.error})`);
        break;
    }
  };

  const onEnter = () => {
    if (interp.status === 'ambiguous' || warn !== null) return; // must choose / confirm
    const row = showRows && active >= 0 && active < rows.length ? rows[active] : null;
    const text = row !== null && row.kind === 'completion' ? row.symbol : value;
    if (!changed && text.trim() === clip.symbol) {
      close(); // nothing to do — close without a pointless transaction
      return;
    }
    commit(text);
  };

  return (
    <div
      className="absolute z-[45]"
      style={{ left: clip.startTick * ppt, top: 10 }}
      data-testid="chord-rename"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef} autoFocus value={value} spellCheck={false} data-testid="chord-rename-input"
        className={cn('block rounded border bg-[var(--c-bg0)] px-1.5 font-mono text-[12px] font-semibold outline-none',
          valid ? 'border-[var(--c-lineStrong)]' : 'border-[var(--c-danger)]')}
        style={{ width: Math.max(clip.durationTicks * ppt + 8, 150), height: ROW_H - 20, color: valid ? tokens.text : tokens.danger }}
        aria-label="Chord name — type to rename"
        onChange={(e) => { setValue(e.target.value); setActive(0); setWarn(null); }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') { onEnter(); return; }
          if (e.key === 'Escape') { close(); return; }
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, rows.length - 1)); return; }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
        }}
        onBlur={() => {
          // Deferred by a tick: the blur fires from whatever mousedown moved
          // focus (often a button elsewhere). Closing synchronously would
          // unmount this editor mid-gesture and swallow that click. `value`
          // and `interp` are the same tick's values, so the deferred commit
          // sees exactly what the user left in the field.
          setTimeout(() => {
            if (warn !== null) { close(); return; } // the warning needs an explicit choice
            if (valid && changed && interp.status === 'ok') commit(value);
            else close();
          }, 0);
        }}
      />

      {showRows && (
        <div className="absolute left-0 top-full z-[45] mt-1 w-[280px] overflow-hidden rounded-md border border-[var(--c-lineStrong)] bg-[var(--c-bg1)] shadow-2xl" data-testid="chord-rename-dropdown">
          {interp.status === 'ambiguous' && (
            <div className="border-b border-[var(--c-line)] px-2.5 pb-1 pt-1.5 text-[9px] font-bold uppercase tracking-[0.12em]" style={{ color: tokens.warn }}>
              Ambiguous — choose a reading
            </div>
          )}
          {rows.map((row, i) => (
            <button
              key={`${row.symbol}-${i}`} type="button"
              data-testid={`chord-rename-option-${i}`} data-symbol={row.symbol}
              onMouseDown={(e) => e.preventDefault()} // keep the input focused until the choice lands
              onClick={() => { setValue(row.symbol); commit(row.symbol); }}
              className={cn('flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-[var(--c-bg3)]',
                i === active && 'bg-[var(--c-bg2)]')}
            >
              <span className="font-mono text-[13px] font-bold">{row.symbol}</span>
              <span className="text-[9px] uppercase tracking-wider text-[var(--c-textMute)]">{row.quality}</span>
              {row.kind === 'completion' && row.exact && <span className="text-[9px] text-[var(--c-accent)]">exact</span>}
              {row.kind === 'completion' && row.diatonic && <span className="ml-auto text-[9px] text-[var(--c-textDim)]">in key</span>}
            </button>
          ))}
          {preview !== null && preview.ok && (
            <div className="flex items-center gap-2 border-t border-[var(--c-line)] bg-[var(--c-bg0)] px-2.5 py-1.5" data-testid="chord-rename-preview" data-name={preview.voicing.symbol}>
              <span className="text-[9px] uppercase tracking-wider text-[var(--c-textMute)]">→ {preview.voicing.symbol}</span>
              <span className="ml-auto truncate font-mono text-[10px] text-[var(--c-textDim)]" title="MIDI preview — close voicing">
                {voicingLabel(preview.voicing.notes)}
              </span>
            </div>
          )}
        </div>
      )}

      {!valid && value.trim().length > 0 && (
        <div className="absolute left-0 top-full z-[45] mt-1 w-[280px] rounded-md border px-2.5 py-1.5 text-[11px]"
          data-testid="chord-rename-error"
          style={{ borderColor: tokens.danger, color: tokens.danger, background: 'var(--c-bg1)' }}>
          {interp.error}
        </div>
      )}

      {warn !== null && (
        <div className="absolute left-0 top-full z-[45] mt-1 w-[300px] rounded-md border px-2.5 py-2"
          data-testid="chord-rename-warn"
          style={{ borderColor: tokens.warn, background: 'var(--c-bg1)' }}>
          <div className="text-[11px] leading-snug" style={{ color: tokens.warn }}>{warn}</div>
          <div className="mt-1.5 flex gap-1.5">
            <button type="button" data-testid="chord-rename-confirm"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => commit(value, true)}
              className="rounded px-2 py-0.5 text-[10px] font-bold"
              style={{ background: tokens.warn, color: '#1a1408' }}>
              Replace anyway
            </button>
            <button type="button" data-testid="chord-rename-cancel"
              onMouseDown={(e) => e.preventDefault()}
              onClick={close}
              className="rounded border border-[var(--c-lineStrong)] px-2 py-0.5 text-[10px] font-semibold text-[var(--c-textDim)]">
              Keep my MIDI
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
