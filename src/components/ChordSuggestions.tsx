/**
 * The Smart Chord picker — the compact floating grid the double-click gesture
 * opens (popup redesign: small, immediate, no Apply button).
 *
 * Layering (unchanged): this component only RENDERS state and routes intent.
 * The chord list comes from the background engine (chordSuggestionsAt,
 * read-only), note math from the pure voicing module, every composition rule
 * from the pure overlay + picker modules, and the single write path is the
 * "Apply Smart Chord" undo transaction through the ChordTrackAPI — guarded by
 * the drift check, so a clip that disappeared, moved, was renamed or
 * note-edited is warned about and never overwritten automatically.
 *
 * What changed in the redesign:
 *  - IMMEDIATE SELECTION: clicking a tile applies that chord to the clip
 *    right away (one undo step per pick) — there is no Apply button and no
 *    confirmation step. The popup stays open so a progression can be played
 *    in tile by tile; the ring marks the chord currently on the timeline.
 *  - COMPACT GRID: 8 tight tiles (symbol + short functional label) with a
 *    small "+N" reveal instead of a scrolling panel. The engine's ranking,
 *    colors, scores and explanations are untouched — the full explanation
 *    lives on the tile's hover tooltip.
 *  - ADVANCED: extension / bass / octave live in a small expandable panel
 *    that is closed by default; a change composes through the same path as a
 *    tile pick and applies to the clip's CURRENT chord immediately.
 *
 * Non-blocking by construction: no backdrop, no focus trap — the DAW stays
 * fully interactive while the overlay floats; Esc (handled by the parent
 * ChordEditor) or the header X closes it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { chordSuggestionsAt, chordTrackApi } from '../engine/suggestion/wire';
import { createSuggestionRecalculator } from '../engine/suggestion/recalc';
import { voicingLabel } from '../engine/suggestion/voicing';
import {
  applyChordComposition, categoryLabelOf, composeForSuggestion, currentChordOf,
  nextVisibleCount, NO_OVERRIDES, PICKER_INITIAL_COUNT,
  type PickerOverrides,
} from '../engine/suggestion/picker';
import {
  bassChoicesFor, extensionChoicesFor, extensionIdOf, takeClipSnapshot,
  type ClipDrift, type ClipSnapshot,
} from '../engine/suggestion/overlay';
import { projectKeyOf } from '../engine/suggestion/model';
import type { ChordSuggestion } from '../engine/suggestion/engine';
import type { ChordClip } from '../engine/suggestion/types';
import { tokens } from '../theme/tokens';
import { cn } from '../utils/cn';
import { I } from './icons';
import { Ico, Select } from './ui';

/** Spec §5 colors — the compatibility band lives on the BORDER only: cards
 *  use the software's default graphite background with white text (user
 *  styling request), so a band is read from its green/yellow/red edge. */
const CARD_COLOR = {
  green: { border: 'rgba(143,194,106,0.55)' },
  yellow: { border: 'rgba(232,200,106,0.5)' },
  red: { border: 'rgba(224,75,52,0.5)' },
} as const;

const DRIFT_TEXT: Record<ClipDrift, string> = {
  missing: 'no longer exists',
  moved: 'was moved',
  renamed: 'was renamed',
  edited: 'had its notes edited',
};

/** Read-only engine re-run for the current clip — never throws. */
function computeSuggestions(clip: ChordClip): ChordSuggestion[] {
  try {
    return chordSuggestionsAt(clip.startTime, { excludeClipId: clip.id });
  } catch {
    return [] as ChordSuggestion[];
  }
}

/** Hover tooltip — the full musical explanation stays one hover away. */
function cardTitle(s: ChordSuggestion): string {
  const lines = [
    `${s.score100}/100 · ${s.reasonCodes.join(' · ') || 'no rules matched'}`,
    s.contextExplanation,
  ];
  if (s.scoreBreakdown.length > 1) {
    lines.push(s.scoreBreakdown.map((b) => `${b.rule} ${b.delta >= 0 ? '+' : ''}${b.delta}`).join('   '));
  }
  for (const a of s.alternativeContextResults ?? []) lines.push(`${a.contextLabel}: ${a.score100}/100 (${a.color})`);
  return lines.join('\n');
}

export interface ChordSuggestionsProps {
  clip: ChordClip;
}

export function ChordSuggestions({ clip }: ChordSuggestionsProps) {
  const project = useStore((s) => s.project);
  const toast = useStore((s) => s.toast);

  const key = useMemo(() => projectKeyOf(project), [project]);
  // The background engine, re-run read-only whenever the project moves; the
  // clip itself never acts as its own harmonic context. RAPID EDITS ARE
  // DEBOUNCED: a burst of project swaps (slider drags, neighbor typing)
  // coalesces into ONE engine run 120ms after the last change — the picker
  // stays live without putting the engine on the edit hot path.
  const [suggestions, setSuggestions] = useState<ChordSuggestion[]>(() => computeSuggestions(clip));
  const clipRef = useRef(clip);
  clipRef.current = clip;
  const recalcRef = useRef<ReturnType<typeof createSuggestionRecalculator> | null>(null);
  if (recalcRef.current === null) {
    recalcRef.current = createSuggestionRecalculator(() => setSuggestions(computeSuggestions(clipRef.current)));
  }
  useEffect(() => {
    recalcRef.current?.request();
    return () => recalcRef.current?.cancel(); // a newer request replaces this one
  }, [clip.startTime, clip.id, project]);

  // --- paging: 8 tiles first, "+N" reveals the next row (never a scrollbar)
  const [visibleCount, setVisibleCount] = useState(PICKER_INITIAL_COUNT);
  useEffect(() => { setVisibleCount(PICKER_INITIAL_COUNT); }, [clip.id]);
  const visible = useMemo(
    () => suggestions.slice(0, Math.min(visibleCount, suggestions.length)),
    [suggestions, visibleCount],
  );

  // --- the tile that matches the clip's LIVE chord carries the ring --------
  const appliedSpelling = clip.chord.spelling;

  // --- drift-guard baseline (unchanged from the Apply redesign) ------------
  const [snapshot, setSnapshot] = useState<ClipSnapshot | null>(null);
  useEffect(() => {
    setSnapshot(takeClipSnapshot(clip));
    // clip.id: open/reopen · clip.chord.spelling: any committed rename (the
    // picker itself, the panel's symbol field, the lane's inline text entry)
    // refreshes the baseline — the drift guard still catches moves, note
    // edits and deletions.
  }, [clip.id, clip.chord.spelling]); // eslint-disable-line react-hooks/exhaustive-deps -- `clip` is intentionally read fresh on those two events only

  /** One undoable write, shared by tile picks and Advanced changes. */
  const writeChord = (spelling: string, overrides: PickerOverrides) => {
    const chord = currentChordOf(spelling);
    if (chord === null) {
      toast('error', `"${spelling}" is not a readable chord — nothing was changed.`);
      return;
    }
    const outcome = applyChordComposition(chordTrackApi, clip.id, chord, key, snapshot, overrides);
    if (!outcome.ok) {
      if (outcome.drift === 'error') {
        toast('error', `Apply failed — the timeline was restored. (${outcome.error ?? 'unknown error'})`);
      } else if (outcome.drift === 'locked') {
        toast('warn', 'Smart Chord not applied — the chord lane is locked (or missing). Unlock the Chords track to write chords.');
      } else {
        toast('warn', `Smart Chord not applied — the clip ${DRIFT_TEXT[outcome.drift]} since the picker opened. Nothing was overwritten; re-open the clip and pick again.`);
      }
      return;
    }
    setSnapshot(outcome.snapshot);
  };

  const onPick = (s: ChordSuggestion) => writeChord(s.chord.spelling, NO_OVERRIDES);

  // --- Advanced controls (collapsed by default) ----------------------------
  const [advancedOpen, setAdvancedOpen] = useState(false);
  useEffect(() => { setAdvancedOpen(false); }, [clip.id]);
  const [overrides, setOverrides] = useState<PickerOverrides>(NO_OVERRIDES);
  useEffect(() => { setOverrides(NO_OVERRIDES); }, [clip.chord.spelling]); // eslint-disable-line react-hooks/exhaustive-deps -- resets per committed chord, `clip` read fresh

  const current = currentChordOf(appliedSpelling);
  const extChoices = useMemo(() => (current !== null ? extensionChoicesFor(current.quality) : []), [current]);
  const bassChoices = useMemo(() => (current !== null ? bassChoicesFor(current) : []), [current]);
  const extValue = overrides.ext ?? extensionIdOf(current?.quality ?? 'major');
  const preview = useMemo(
    () => (current !== null ? composeForSuggestion(current, key, overrides) : null),
    [current, key, overrides],
  );

  const onOverrideChange = (patch: Partial<PickerOverrides>) => {
    const next = { ...overrides, ...patch };
    setOverrides(next);
    writeChord(appliedSpelling, next); // Advanced edits the current chord immediately
  };

  return (
    <div className="flex flex-col" data-testid="chord-suggestions">
      {/* ---- compact tile grid (redesign §3) ---- */}
      <div className="px-1.5 pt-1.5">
        {visible.length === 0 ? (
          <div className="rounded-md border border-dashed border-[var(--c-line)] px-2 py-1.5 text-[10px] text-[var(--c-textDim)]">
            No suggestions for this context.
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-1" data-testid="suggestion-grid">
            {visible.map((s, i) => {
              const applied = s.chord.spelling === appliedSpelling;
              const col = CARD_COLOR[s.color];
              const amb = s.ambiguity?.[0];
              return (
                <button key={`${s.chord.spelling}-${i}`} type="button"
                  data-testid={`suggestion-card-${i}`} data-color={s.color} data-spelling={s.chord.spelling} data-quality={s.chord.quality}
                  title={cardTitle(s)}
                  onClick={() => onPick(s)}
                  className={cn('relative flex flex-col gap-px rounded border bg-[var(--c-bg0)] px-1.5 py-1 text-left transition-all hover:brightness-125',
                    applied && 'ring-1 ring-[var(--c-accent)]')}
                  style={{ borderColor: applied ? tokens.accent : col.border }}>
                  <span className="w-full truncate font-mono text-[13px] font-bold leading-tight" style={{ color: tokens.textBright }}>{s.chord.spelling}</span>
                  <span className="w-full truncate text-[8px] uppercase leading-tight tracking-[0.06em]" style={{ color: tokens.textBright, opacity: 0.66 }}>
                    {categoryLabelOf(s.colorCategory)}
                  </span>
                  {amb !== undefined && (
                    <span className="absolute right-0.5 top-0.5 text-[8px] leading-none" style={{ color: tokens.warn }}
                      title={`${amb.position} chord reads ${amb.primary.displayName} or ${amb.alternative.displayName} — the ranking may shift`}>
                      ↯
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ---- one tiny row: reveal more · advanced ---- */}
      <div className="flex items-center gap-1 px-1.5 py-1">
        {visible.length < suggestions.length && (
          <button type="button" data-testid="suggestion-more"
            title={`Reveal ${Math.min(4, suggestions.length - visible.length)} more ranked suggestions (${visible.length} of ${suggestions.length} shown)`}
            onClick={() => setVisibleCount((c) => nextVisibleCount(c, suggestions.length))}
            className="rounded px-1.5 py-0.5 text-[9px] font-semibold text-[var(--c-textDim)] transition-colors hover:bg-[var(--c-bg4)] hover:text-[var(--c-text)]">
            +{Math.min(4, suggestions.length - visible.length)} more · {visible.length}/{suggestions.length}
          </button>
        )}
        <button type="button" data-testid="suggestion-advanced" aria-pressed={advancedOpen}
          title="Voicing details — extension, slash bass, octave (applied to the current chord immediately)"
          onClick={() => setAdvancedOpen((o) => !o)}
          className={cn('ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-semibold transition-colors',
            advancedOpen ? 'bg-[var(--c-bg4)] text-[var(--c-text)]' : 'text-[var(--c-textDim)] hover:bg-[var(--c-bg4)] hover:text-[var(--c-text)]')}>
          <Ico icon={I.sliders} className="text-[10px]" />
          Advanced
        </button>
      </div>

      {/* ---- advanced panel: closed by default, opens in place ------------ */}
      {advancedOpen && (
        <div data-testid="suggestion-advanced-panel" className="flex flex-col gap-1 border-t border-[var(--c-line)] px-1.5 pb-1.5 pt-1">
          <div className="grid grid-cols-3 gap-1">
            <Select
              value={overrides.bass ?? 'auto'} mono className="h-5.5 w-full text-[10px]" testId="suggestion-bass"
              tip="Slash bass / inversion — Auto keeps the analyzed bass"
              options={bassChoices.map((c) => ({ value: c.id, label: c.label }))}
              onChange={(v) => onOverrideChange({ bass: v === 'auto' ? null : v })}
            />
            <Select
              value={extValue} mono className="h-5.5 w-full text-[10px]" testId="suggestion-extension"
              tip="Extension above the triad — root and quality are preserved unless the extension makes them invalid"
              options={extChoices.map((c) => ({ value: c.id, label: c.label }))}
              onChange={(v) => onOverrideChange({ ext: v })}
            />
            <Select
              value={overrides.octave ?? 0} mono className="h-5.5 w-full text-[10px]" testId="suggestion-octave"
              tip="Voicing anchor octave (default C4, centered)"
              options={[-2, -1, 0, 1, 2].map((o) => ({ value: o, label: `C${4 + o}` }))}
              onChange={(v) => onOverrideChange({ octave: v === 0 ? null : v })}
            />
          </div>
          {preview !== null && preview.ok && (
            <div data-testid="suggestion-preview" data-name={preview.symbol}
              className="flex items-center gap-1.5 font-mono text-[9px] text-[var(--c-textDim)]"
              title={preview.voicing !== null && preview.voicing.ok ? `MIDI [${preview.voicing.notes.map((n) => n.midi).join(', ')}] — close voicing, bass ${preview.voicing.bassNote}` : undefined}>
              <span className="font-bold text-[var(--c-text)]">{preview.symbol}</span>
              <span className="truncate">{voicingLabel(preview.voicing.notes)}</span>
              <span className="ml-auto shrink-0">{preview.voicing.notes.length} notes</span>
            </div>
          )}
          {preview !== null && !preview.ok && (
            <div className="text-[9px]" style={{ color: tokens.danger }}>{preview.error}</div>
          )}
          {current === null && (
            <div className="text-[9px]" style={{ color: tokens.danger }}>Current clip name is not a readable chord.</div>
          )}
        </div>
      )}
    </div>
  );
}
