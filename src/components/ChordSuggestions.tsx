/**
 * The Smart Chord overlay's suggestion browser — the custom floating UI the
 * double-click gesture opens (feature spec: chord grid, customization
 * controls, MIDI generation preview, Apply).
 *
 * Layering: this component only RENDERS state and routes intent. The chord
 * list comes from the background engine (chordSuggestionsAt, read-only),
 * note math from the pure voicing module, every dropdown rule from the pure
 * overlay module, and the single write path is the "Apply Smart Chord" undo
 * transaction through the ChordTrackAPI — guarded by the drift check, so a
 * clip that disappeared, moved, was renamed or note-edited since the overlay
 * opened is warned about and never overwritten automatically.
 *
 * Non-blocking by construction: no backdrop, no focus trap — the DAW stays
 * fully interactive while the overlay floats; Esc (handled by the parent
 * ChordEditor) or the header X closes it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { chordSuggestionsAt, chordTrackApi } from '../engine/suggestion/wire';
import { createSuggestionRecalculator } from '../engine/suggestion/recalc';
import { voiceChordSymbol, voicingLabel } from '../engine/suggestion/voicing';
import {
  applyChordToClip, bassChoicesFor, buildChordSymbol,
  extensionChoicesFor, extensionIdOf, filterSuggestions, takeClipSnapshot,
  type BassSelection, type ClipDrift, type ClipSnapshot, type ExtensionId,
  type SuggestionColorFilter, type SuggestionSort,
} from '../engine/suggestion/overlay';
import { keySignatureLabel, projectKeyOf } from '../engine/suggestion/model';
import type { ChordSuggestion } from '../engine/suggestion/engine';
import type { ChordClip } from '../engine/suggestion/types';
import type { PitchClass } from '../shared/schema';
import { tokens } from '../theme/tokens';
import { cn } from '../utils/cn';
import { I } from './icons';
import { Button, Ico, Select } from './ui';

/** Spec §5 colors — the engine's green/yellow/red bands over graphite. */
const CARD_COLOR = {
  green: { bg: 'rgba(143,194,106,0.15)', border: 'rgba(143,194,106,0.55)', text: tokens.success },
  yellow: { bg: 'rgba(232,200,106,0.13)', border: 'rgba(232,200,106,0.5)', text: tokens.warn },
  red: { bg: 'rgba(224,75,52,0.12)', border: 'rgba(224,75,52,0.5)', text: tokens.danger },
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
  /** Called after a successful Apply (parent closes or minimizes per pref). */
  onApplied: () => void;
}

export function ChordSuggestions({ clip, onApplied }: ChordSuggestionsProps) {
  const project = useStore((s) => s.project);
  const toast = useStore((s) => s.toast);
  const applyMode = useStore((s) => s.settings.smartChordApply);

  const key = useMemo(() => projectKeyOf(project), [project]);
  // The background engine, re-run read-only whenever the project moves; the
  // clip itself never acts as its own harmonic context. RAPID EDITS ARE
  // DEBOUNCED: a burst of project swaps (slider drags, neighbor typing)
  // coalesces into ONE engine run 120ms after the last change — the overlay
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

  // --- grid controls (spec §1: sort by score, filter/search allowed) -------
  const [query, setQuery] = useState('');
  const [colorF, setColorF] = useState<SuggestionColorFilter>('all');
  const [sort, setSort] = useState<SuggestionSort>('score');
  const filtered = useMemo(
    () => filterSuggestions(suggestions, { query, color: colorF, sort }),
    [suggestions, query, colorF, sort],
  );

  // --- selection: the clip's own chord when present, else the top ranked ---
  const [selectedSpelling, setSelectedSpelling] = useState<string | null>(null);
  useEffect(() => {
    setSelectedSpelling((cur) => {
      if (cur !== null && suggestions.some((s) => s.chord.spelling === cur)) return cur;
      const own = suggestions.find((s) => s.chord.spelling === clip.chord.spelling);
      return (own ?? suggestions[0])?.chord.spelling ?? null;
    });
  }, [suggestions, clip.id, clip.chord.spelling]);
  const selected = suggestions.find((s) => s.chord.spelling === selectedSpelling) ?? suggestions[0] ?? null;

  // --- customization controls (spec §2) — resets on every selection --------
  const [extOverride, setExtOverride] = useState<ExtensionId | null>(null);
  const [bassOverride, setBassOverride] = useState<string | null>(null);
  const [octaveOverride, setOctaveOverride] = useState<number | null>(null);
  useEffect(() => {
    setExtOverride(null);
    setBassOverride(null);
    setOctaveOverride(null);
  }, [selectedSpelling]);

  const extChoices = useMemo(() => (selected !== null ? extensionChoicesFor(selected.chord.quality) : []), [selected]);
  const bassChoices = useMemo(() => (selected !== null ? bassChoicesFor(selected.chord) : []), [selected]);
  const preferredExt: ExtensionId = extOverride ?? (selected !== null ? extensionIdOf(selected.chord.quality) : 'none');
  const ext: ExtensionId = extChoices.some((c) => c.id === preferredExt) ? preferredExt : extChoices[0]?.id ?? 'none';
  const bassSel: BassSelection = useMemo(() => {
    if (bassOverride === null || bassOverride === 'auto') return 'auto';
    if (bassOverride === 'root') return 'root';
    const pc = Number(bassOverride.slice(3));
    return { pc: (Number.isInteger(pc) && pc >= 0 && pc <= 11 ? pc : 0) as PitchClass };
  }, [bassOverride]);
  const octave = octaveOverride ?? 0;

  // --- live MIDI generation (spec §3) — recalculated immediately ----------
  const composed = useMemo(
    () => (selected !== null ? buildChordSymbol(selected.chord, ext, bassSel, key) : null),
    [selected, ext, bassSel, key],
  );
  const voicing = useMemo(
    () => (composed !== null && composed.ok ? voiceChordSymbol(composed.symbol, { octaveOffset: octave }) : null),
    [composed, octave],
  );
  const previewName = composed !== null && composed.ok ? composed.symbol : selected?.chord.spelling ?? '—';

  // --- Apply (spec §4) — one undoable transaction, drift-guarded -----------
  const [snapshot, setSnapshot] = useState<ClipSnapshot | null>(null);
  useEffect(() => {
    setSnapshot(takeClipSnapshot(clip));
    // clip.id: open/reopen · clip.chord.spelling: any committed rename (the
    // panel's symbol field, the lane's inline text entry, or Apply itself)
    // refreshes the baseline — the drift guard still catches moves, note
    // edits and deletions.
  }, [clip.id, clip.chord.spelling]); // eslint-disable-line react-hooks/exhaustive-deps -- `clip` is intentionally read fresh on those two events only

  const canApply = composed !== null && composed.ok && voicing !== null && voicing.ok;

  const onApply = () => {
    if (!canApply || composed === null || !composed.ok || voicing === null || !voicing.ok) return;
    const outcome = applyChordToClip(chordTrackApi, clip.id, composed.symbol, voicing, snapshot);
    if (!outcome.ok) {
      if (outcome.drift === 'error') {
        toast('error', `Apply failed — the timeline was restored. (${outcome.error ?? 'unknown error'})`);
      } else if (outcome.drift === 'locked') {
        toast('warn', 'Smart Chord not applied — the chord lane is locked (or missing). Unlock the Chords track to write chords.');
      } else {
        toast('warn', `Smart Chord not applied — the clip ${DRIFT_TEXT[outcome.drift]} since the overlay opened. Nothing was overwritten; re-open the clip and apply again.`);
      }
      return;
    }
    setSnapshot(outcome.snapshot);
    onApplied();
  };

  const keyText = `${keySignatureLabel(key) ?? key.mode} · ${suggestions.length} suggestions`;

  return (
    <div className="flex flex-col" data-testid="chord-suggestions">
      {/* ---- chord grid (spec §1) ---- */}
      <div className="flex items-center gap-1.5 border-t border-[var(--c-line)] px-3 pt-2">
        <Ico icon={I.magic} className="text-[11px] text-[var(--c-accent)]" />
        <span className="text-[10px] font-bold uppercase tracking-[0.12em]">Suggestions</span>
        <span className="truncate font-mono text-[9px] text-[var(--c-textMute)]" title={`Project key context — ${keyText}`}>{keyText}</span>
      </div>
      <div className="flex items-center gap-1.5 px-3 py-1.5">
        <div className="screen flex h-6 items-center gap-1.5 rounded-[3px] px-2">
          <Ico icon={I.search} className="text-[10px] text-[var(--c-textMute)]" />
          <input
            data-testid="suggestion-search" value={query} spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="filter…"
            aria-label="Filter suggestions by chord name or quality"
            className="w-16 bg-transparent text-[11px] text-[var(--c-text)] outline-none placeholder:text-[var(--c-textMute)]"
          />
        </div>
        {(['all', 'green', 'yellow', 'red'] as const).map((c) => (
          <button key={c} type="button" data-testid={`suggestion-filter-${c}`}
            title={c === 'all' ? 'Show every suggestion' : `Show only ${c} (score ${c === 'green' ? '75–100' : c === 'yellow' ? '45–74' : '0–44'})`}
            onClick={() => setColorF(c)}
            className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors',
              colorF === c ? 'bg-[var(--c-bg4)] text-[var(--c-text)]' : 'text-[var(--c-textMute)] hover:bg-[var(--c-bg4)]')}>
            {c === 'all' ? 'All' : c.charAt(0).toUpperCase() + c.slice(1)}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-1">
          <Select
            value={sort} onChange={setSort} tip="Sort order" mono className="h-6" testId="suggestion-sort"
            options={[{ value: 'score', label: 'Score' }, { value: 'name', label: 'Name' }]}
          />
          <span className="w-10 text-right font-mono text-[9px] text-[var(--c-textMute)]">{filtered.length}/{suggestions.length}</span>
        </span>
      </div>
      <div className="max-h-[228px] overflow-y-auto px-3 pb-2">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-between rounded-md border border-dashed border-[var(--c-line)] px-2.5 py-2 text-[11px] text-[var(--c-textDim)]">
            No suggestions match the filter.
            <button type="button" className="font-semibold text-[var(--c-accent)] hover:underline"
              onClick={() => { setQuery(''); setColorF('all'); }}>
              Clear
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5" data-testid="suggestion-grid">
            {filtered.map((s, i) => {
              const sel = selected !== null && s.chord.spelling === selected.chord.spelling;
              const col = CARD_COLOR[s.color];
              return (
                <button key={`${s.chord.spelling}-${i}`} type="button"
                  data-testid={`suggestion-card-${i}`} data-color={s.color} data-spelling={s.chord.spelling} data-quality={s.chord.quality}
                  title={cardTitle(s)}
                  onClick={() => setSelectedSpelling(s.chord.spelling)}
                  className={cn('flex flex-col gap-0.5 rounded-md border px-2 py-1.5 text-left transition-all hover:brightness-125',
                    sel && 'ring-1 ring-[var(--c-accent)]')}
                  style={{ background: col.bg, borderColor: sel ? tokens.accent : col.border }}>
                  <span className="flex items-baseline gap-1">
                    <span className="min-w-0 truncate font-mono text-[13px] font-bold leading-tight" style={{ color: col.text }}>{s.chord.spelling}</span>
                    <span className="ml-auto font-mono text-[9px] text-[var(--c-textDim)]">{s.score100}</span>
                  </span>
                  <span className="truncate text-[9px] leading-tight text-[var(--c-textDim)]">{s.contextExplanation}</span>
                  {(s.ambiguity?.length ?? 0) > 0 && (
                    <span className="truncate text-[9px] leading-tight" style={{ color: tokens.warn }}
                      title={(s.ambiguity ?? []).map((a) => `${a.position} chord reads ${a.primary.displayName} or ${a.alternative.displayName}`).join('\n')}>
                      ↯ {(s.ambiguity ?? [])[0]!.position} ambiguous
                    </span>
                  )}
                  {(s.alternativeContextResults?.length ?? 0) > 0 && (
                    <span className="truncate text-[9px] leading-tight text-[var(--c-textMute)]"
                      title={(s.alternativeContextResults ?? []).map((a) => `${a.contextLabel}: ${a.score100}/100 (${a.color})`).join('\n')}>
                      ≈ {s.alternativeContextResults![0]!.contextLabel}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ---- customization controls (spec §2) ---- */}
      <div className="grid grid-cols-[1.2fr_1.2fr_76px] gap-1.5 border-t border-[var(--c-line)] px-3 py-2">
        <label className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[9px] uppercase tracking-[0.12em] text-[var(--c-textMute)]">Bass note</span>
          <Select
            value={bassOverride ?? 'auto'} mono className="h-6" testId="suggestion-bass"
            tip="Slash bass / inversion — Auto keeps the analyzed bass"
            options={bassChoices.map((c) => ({ value: c.id, label: c.label }))}
            onChange={(v) => setBassOverride(v === 'auto' ? null : v)}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[9px] uppercase tracking-[0.12em] text-[var(--c-textMute)]">Extension</span>
          <Select
            value={ext} mono className="h-6" testId="suggestion-extension"
            tip="Extension above the triad — root and quality are preserved unless the extension makes them invalid"
            options={extChoices.map((c) => ({ value: c.id, label: c.label }))}
            onChange={(v) => setExtOverride(v)}
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[9px] uppercase tracking-[0.12em] text-[var(--c-textMute)]">Octave</span>
          <Select
            value={octave} mono className="h-6" testId="suggestion-octave"
            tip="Voicing anchor octave (default C4, centered)"
            options={[-2, -1, 0, 1, 2].map((o) => ({ value: o, label: `C${4 + o}` }))}
            onChange={(v) => setOctaveOverride(v === 0 ? null : v)}
          />
        </label>
      </div>

      {/* ---- live preview (spec §2/§3) ---- */}
      <div className="px-3 pb-2">
        <div data-testid="suggestion-preview" data-name={previewName} className="flex items-center gap-2 rounded-md border border-[var(--c-line)] bg-[var(--c-bg0)] px-2.5 py-1.5">
          <span className="min-w-0 truncate font-mono text-[14px] font-bold" title={`Chord name — normalized spelling: ${previewName}`}>{previewName}</span>
          {selected !== null && <span className="shrink-0 text-[9px] uppercase tracking-wider text-[var(--c-textMute)]">{selected.chord.quality}</span>}
          <span className="ml-auto min-w-0 truncate text-right font-mono text-[10px] text-[var(--c-textDim)]"
            title={voicing !== null && voicing.ok ? `MIDI [${voicing.notes.map((n) => n.midi).join(', ')}] — close voicing, bass ${voicing.bassNote}` : undefined}>
            {voicing !== null && voicing.ok ? voicingLabel(voicing.notes) : '—'}
          </span>
          {voicing !== null && voicing.ok && (
            <span className="shrink-0 rounded border border-[var(--c-line)] px-1 font-mono text-[9px] text-[var(--c-textMute)]" title="note count">
              {voicing.notes.length}
            </span>
          )}
        </div>
        {composed !== null && !composed.ok && (
          <div className="mt-1 text-[10px]" style={{ color: tokens.danger }}>{composed.error}</div>
        )}
      </div>

      {/* ---- Apply (spec §4) ---- */}
      <div className="flex items-center gap-2 border-t border-[var(--c-line)] px-3 py-2">
        <Button primary testId="apply-chord" disabled={!canApply} onClick={onApply}
          tip="Write the voicing into the clip, rename it, one undo step ('Apply Smart Chord')">
          Apply
        </Button>
        <span className="flex items-center gap-1">
          <span className="text-[9px] uppercase tracking-[0.12em] text-[var(--c-textMute)]">On apply</span>
          {(['close', 'minimize'] as const).map((m) => (
            <button key={m} type="button" data-testid={`apply-mode-${m}`}
              onClick={() => useStore.getState().setSettings({ smartChordApply: m })}
              className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold',
                applyMode === m ? 'bg-[var(--c-accent)] text-[var(--c-accentText)]' : 'text-[var(--c-textDim)] hover:bg-[var(--c-bg4)]')}>
              {m === 'close' ? 'Close' : 'Minimize'}
            </button>
          ))}
        </span>
        <span className="ml-auto text-[9px] text-[var(--c-textMute)]">one undo step</span>
      </div>
    </div>
  );
}
