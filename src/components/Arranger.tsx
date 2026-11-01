import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { barTicks, beatTicks, parseChord, projectBars, projectEndTick, secondsToTicks, type Section, type Track, type TrackFamily } from '../shared/schema';
import { chordTrackApi, chordTrackGesture, isFreshManualCreate, noteManualCreate, SMART_CLIP_ID_PREFIX, syncPickerToChordCard } from '../engine/suggestion/wire';
import { FAMILY_COLORS, tokens, velocityColor, withAlpha } from '../theme/tokens';
import { preview } from '../audio/preview';
import { currentTick, loopRange, play, refollowPlayhead, registerFollowController, resumeFollow, seek, suspendFollow } from '../audio/transport';
import { followScroll, playheadVisible, refollowScrollLeft } from '../engine/transport/follow';
import { TrackHeader } from './TrackHeader';
import { HEADER_W, Ico, ROW_H, RULER_H } from './ui';
import { I } from './icons';
import { cn } from '../utils/cn';

export const SECTION_PRESETS = ['Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Bridge', 'Outro'];
const SECTION_PALETTE = Object.values(FAMILY_COLORS);
const sectionColor = (name: string) => {
  const i = SECTION_PRESETS.findIndex((n) => name.toLowerCase().startsWith(n.toLowerCase()));
  if (i >= 0) return SECTION_PALETTE[(i + 1) % SECTION_PALETTE.length];
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 997;
  return SECTION_PALETTE[h % SECTION_PALETTE.length];
};

/**
 * Programmatic scroll writes must not look like manual scrolls. Chrome
 * coalesces scroll events, so a time-window flag cannot distinguish our own
 * writes from the user's. Instead we remember the last value the policy
 * wrote: a scroll event (or frame start) whose scrollLeft differs from it is
 * a manual scroll → suspend. Our own events match the written value exactly.
 */
let programmaticX: number | null = null;
function writeScroll(el: HTMLDivElement, x: number) {
  const maxX = el.scrollWidth - el.clientWidth;
  const v = Math.max(0, Math.min(x, maxX));
  programmaticX = v;
  el.scrollLeft = v;
}
function isOwnWrite(el: HTMLDivElement): boolean {
  return programmaticX !== null && Math.abs(el.scrollLeft - programmaticX) <= 0.5;
}

function drag(e: React.PointerEvent, move: (dx: number, ev: PointerEvent) => void, up: (moved: boolean) => void, opts: { editSuspension?: boolean } = {}) {
  e.stopPropagation();
  const x0 = e.clientX;
  let moved = false;
  const mv = (ev: PointerEvent) => { if (Math.abs(ev.clientX - x0) > 2) moved = true; move(ev.clientX - x0, ev); };
  const u = () => {
    window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', u);
    const s = useStore.getState();
    s.set({ interactionActive: false });
    // Editing during playback suspends auto-scroll and KEEPS it suspended
    // after the edit ends (spec §9) — the Re-follow badge takes over.
    if (opts.editSuspension !== false && moved && s.playing && s.settings.suspendFollowDuringEdit) suspendFollow('edit');
    up(moved);
  };
  useStore.getState().set({ interactionActive: true }); // freezes follow while a precise edit is in progress
  window.addEventListener('pointermove', mv);
  window.addEventListener('pointerup', u);
}

/* ---------------- Structure lane ---------------- */
const StructureLane = memo(function StructureLane({ ppt }: { ppt: number }) {
  const sections = useStore((s) => s.project.sections);
  const ts = useStore((s) => s.project.timeSignature);
  const selectedId = useStore((s) => s.selectedSectionId);
  const { addSection, updateSection, set, toast } = useStore.getState();
  const [temp, setTemp] = useState<Section | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const pxBar = barTicks(ts) * ppt;
  const barAt = (clientX: number) => Math.max(1, Math.floor((clientX - ref.current!.getBoundingClientRect().left) / pxBar) + 1);
  const overlaps = (id: string, start: number, len: number) => sections.some((s) => s.id !== id && start < s.startBar + s.lengthBars && s.startBar < start + len);

  const onLaneDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const b0 = barAt(e.clientX);
    const name = SECTION_PRESETS[sections.length % SECTION_PRESETS.length];
    const next = sections.filter((s) => s.startBar > b0).sort((a, b) => a.startBar - b.startBar)[0];
    const maxLen = next ? next.startBar - b0 : 999;
    if (overlaps('__new', b0, 1)) return;
    let cur: Section = { id: '__new', name, startBar: b0, lengthBars: 1 };
    setTemp(cur);
    drag(e, (_dx, ev) => {
      const b = barAt(ev.clientX);
      cur = { ...cur, startBar: b0, lengthBars: Math.max(1, Math.min(maxLen, b - b0 + 1)) };
      setTemp(cur);
    }, () => {
      setTemp(null);
      const id = addSection({ name: cur.name, startBar: cur.startBar, lengthBars: cur.lengthBars });
      set({ selectedSectionId: id, selectedChordId: null });
    });
  };

  const onSecDown = (e: React.PointerEvent, s: Section) => {
    if (e.button !== 0 || editing) return;
    set({ selectedSectionId: s.id, selectedChordId: null });
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mode = e.clientX - r.left < 7 ? 'l' : r.right - e.clientX < 7 ? 'r' : 'move';
    let cur = s;
    drag(e, (dx) => {
      const db = Math.round(dx / pxBar);
      if (mode === 'move') cur = { ...s, startBar: Math.max(1, s.startBar + db) };
      else if (mode === 'r') cur = { ...s, lengthBars: Math.max(1, s.lengthBars + db) };
      else { const st = Math.max(1, Math.min(s.startBar + s.lengthBars - 1, s.startBar + db)); cur = { ...s, startBar: st, lengthBars: s.lengthBars - (st - s.startBar) }; }
      setTemp(cur);
    }, (moved) => {
      setTemp(null);
      if (!moved || (cur.startBar === s.startBar && cur.lengthBars === s.lengthBars)) return;
      if (overlaps(s.id, cur.startBar, cur.lengthBars)) { toast('warn', 'Sections cannot overlap'); return; }
      updateSection(s.id, { startBar: cur.startBar, lengthBars: cur.lengthBars });
    });
  };

  const list = temp ? [...sections.filter((s) => s.id !== temp.id), temp] : sections;
  return (
    <div ref={ref} className="relative h-full cursor-crosshair" onPointerDown={onLaneDown} data-testid="structure-lane">
      <datalist id="section-names">{SECTION_PRESETS.map((n) => <option key={n} value={n} />)}</datalist>
      {list.map((s) => {
        const c = sectionColor(s.name);
        const sel = s.id === selectedId;
        return (
          <div
            key={s.id} data-testid="section"
            className={cn('group absolute top-[6px] flex cursor-grab items-center overflow-hidden rounded-md border px-2 text-xs font-semibold transition-shadow active:cursor-grabbing', sel && 'ring-1 ring-[var(--c-text)]')}
            style={{ left: (s.startBar - 1) * pxBar, width: Math.max(8, s.lengthBars * pxBar - 2), height: ROW_H - 12, background: withAlpha(c, 0.22), borderColor: withAlpha(c, 0.7), color: tokens.text }}
            onPointerDown={(e) => onSecDown(e, s)}
            onDoubleClick={(e) => { e.stopPropagation(); setEditing(s.id); }}
            title={`${s.name} · bars ${s.startBar}–${s.startBar + s.lengthBars - 1} · drag to move, edges to resize, double-click to rename, Delete to remove`}
          >
            <div className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize" />
            <div className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize" />
            <div className="absolute left-0 top-0 h-[3px] w-full" style={{ background: c }} />
            {editing === s.id ? (
              <input
                autoFocus list="section-names" defaultValue={s.name}
                className="w-full rounded bg-[var(--c-bg0)] px-1 text-xs text-[var(--c-text)] outline-none"
                onPointerDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null); }}
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== s.name) updateSection(s.id, { name: v }); setEditing(null); }}
              />
            ) : (
              <>
                <span className="truncate">{s.name}</span>
                <span className="ml-2 font-mono text-[10px] font-normal text-[var(--c-textDim)]">{s.lengthBars}b</span>
                <button title="Delete section" aria-label="Delete section" className="ml-auto hidden h-4 w-4 items-center justify-center rounded text-[var(--c-textDim)] hover:bg-[var(--c-bg4)] hover:text-[var(--c-danger)] group-hover:flex"
                  onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); useStore.getState().deleteSection(s.id); }}>
                  <Ico icon={I.x} className="text-[10px]" />
                </button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
});

/* ---------------- Chords lane ---------------- */
const ChordLane = memo(function ChordLane({ ppt }: { ppt: number }) {
  const chords = useStore((s) => s.project.chords);
  const ts = useStore((s) => s.project.timeSignature);
  const selectedId = useStore((s) => s.selectedChordId);
  const [temp, setTemp] = useState<{ id: string; startTick: number; durationTicks: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const snap = beatTicks(ts);
  const bt = barTicks(ts);
  const tickAt = (x: number) => Math.max(0, Math.floor((x - ref.current!.getBoundingClientRect().left) / ppt / snap) * snap);

  // Single click on empty space — the protected workflow's manual chord
  // input: creates and selects a plain chord. NO inline editor opens here
  // (inline lane editing was removed by request — the Smart Chord popup is
  // the only chord editor); with the popup open it re-targets onto the
  // fresh chord, and the double-click gesture still converts the false
  // start into a Smart clip.
  const onLaneDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const t = tickAt(e.clientX);
    if (chords.some((c) => t >= c.startTick && t < c.startTick + c.durationTicks)) return;
    const next = chords.filter((c) => c.startTick > t).sort((a, b) => a.startTick - b.startTick)[0];
    const dur = Math.max(snap, Math.min(bt - (t % bt), next ? next.startTick - t : bt));
    const st = useStore.getState();
    const id = st.addChord({ symbol: 'C', startTick: t, durationTicks: dur });
    noteManualCreate(id); // lets the double-click gesture recognize this as its own false start
    syncPickerToChordCard(id); // the open Smart Chord picker follows the freshly created chord too
    st.set({ selectedChordId: id, selectedSectionId: null });
  };

  // Double-click gesture: on a clip → open (or re-target) the Smart Chord
  // popup — the ONLY chord editor; on empty space → create a Smart clip
  // (the controller plans span + undo transaction). A double-click whose
  // first click just created a manual chord converts that false start into
  // a Smart clip atomically (see suggestion/interaction.ts).
  const onLaneDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const t = tickAt(e.clientX);
    const hit = chordTrackApi.getChordClipAt(t);
    const fresh = hit !== null && isFreshManualCreate(hit.id);
    chordTrackGesture(hit, t, { freshFromManualCreate: fresh });
  };

  const onChordDown = (e: React.PointerEvent, c: { id: string; startTick: number; durationTicks: number }) => {
    if (e.button !== 0) return;
    syncPickerToChordCard(c.id); // the open Smart Chord picker follows the clicked card instantly
    useStore.getState().set({ selectedChordId: c.id, selectedSectionId: null });
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mode = r.right - e.clientX < 7 ? 'r' : 'move';
    let cur = c;
    drag(e, (dx) => {
      const d = Math.round(dx / ppt / snap) * snap;
      cur = mode === 'move' ? { ...c, startTick: Math.max(0, c.startTick + d) } : { ...c, durationTicks: Math.max(snap, c.durationTicks + d) };
      setTemp(cur);
    }, (moved) => {
      setTemp(null);
      if (moved && (cur.startTick !== c.startTick || cur.durationTicks !== c.durationTicks)) useStore.getState().updateChord(c.id, { startTick: cur.startTick, durationTicks: cur.durationTicks });
    });
  };

  return (
    <div ref={ref} className="relative h-full cursor-copy" onPointerDown={onLaneDown} onDoubleClick={onLaneDoubleClick} data-testid="chord-lane">
      {chords.map((c0) => {
        const c = temp && temp.id === c0.id ? { ...c0, ...temp } : c0;
        const valid = parseChord(c.symbol);
        const sel = c.id === selectedId;
        const smart = c.id.startsWith(`${SMART_CLIP_ID_PREFIX}_`);
        const col = valid.ok ? FAMILY_COLORS.Structure : tokens.danger;
        return (
          <div
            key={c.id} data-testid="chord" data-invalid={!valid.ok || undefined} data-smart={smart || undefined}
            className={cn('group absolute top-[10px] flex cursor-grab items-center overflow-hidden rounded border px-1.5 font-mono text-[12px] font-semibold', sel && 'ring-1 ring-[var(--c-text)]', smart && 'border-dashed')}
            style={{ left: c.startTick * ppt, width: Math.max(6, c.durationTicks * ppt - 2), height: ROW_H - 20, background: withAlpha(col, valid.ok ? 0.14 : 0.25), borderColor: withAlpha(col, 0.65), color: valid.ok ? tokens.text : tokens.danger }}
            onPointerDown={(e) => onChordDown(e, c)}
            title={valid.ok ? `${c.symbol} = ${valid.chord.quality}${valid.chord.bassName ? ` over ${valid.chord.bassName}` : ''} · double-click to edit in the Smart Chord popup, drag to move, right edge to resize` : `Invalid chord: ${valid.error}`}
          >
            <div className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize" />
            <span className="truncate">{c.symbol}</span>
          </div>
        );
      })}
    </div>
  );
});

/* ---------------- Reference audio lane ---------------- */
const AudioLane = memo(function AudioLane({ ppt }: { ppt: number }) {
  const offsetMs = useStore((s) => s.project.referenceAudio.offsetMs);
  const bpm = useStore((s) => s.project.bpm);
  const ver = useStore((s) => s.refVersion);
  const canvas = useRef<HTMLCanvasElement>(null);
  const buf = preview.refBuffer;
  const widthPx = buf ? secondsToTicks(buf.duration, bpm) * ppt : 0;
  const left = secondsToTicks(offsetMs / 1000, bpm) * ppt;
  useEffect(() => {
    const c = canvas.current; const peaks = preview.refPeaks;
    if (!c || !peaks || !widthPx) return;
    const w = Math.min(16000, Math.ceil(widthPx)); const h = ROW_H - 8;
    c.width = w; c.height = h;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, w, h);
    g.fillStyle = tokens.waveform;
    for (let x = 0; x < w; x++) {
      const i0 = Math.floor((x / w) * peaks.length), i1 = Math.max(i0 + 1, Math.floor(((x + 1) / w) * peaks.length));
      let m = 0; for (let i = i0; i < i1; i++) if (peaks[i] > m) m = peaks[i];
      const bh = Math.max(1, m * (h - 2));
      g.fillRect(x, (h - bh) / 2, 1, bh);
    }
  }, [widthPx, ver]);
  if (!buf) return <div className="flex h-full items-center pl-3 text-[11px] text-[var(--c-textMute)]">Load a reference track from the header — then use the offset to line bars up by ear (turn on the metronome).</div>;
  return (
    <div className="relative h-full overflow-hidden">
      <div className="absolute top-[4px] rounded" style={{ left, width: widthPx, height: ROW_H - 8, background: withAlpha(tokens.waveform, 0.08), borderLeft: `2px solid ${tokens.waveform}` }}>
        <canvas ref={canvas} className="h-full w-full" />
      </div>
    </div>
  );
});

/* ---------------- MIDI note lane ---------------- */
const NoteLane = memo(function NoteLane({ track, ppt }: { track: Track; ppt: number }) {
  const { lo, span } = useMemo(() => {
    if (!track.notes.length) return { lo: 0, span: 1 };
    let a = 127, b = 0;
    for (const n of track.notes) { if (n.pitch < a) a = n.pitch; if (n.pitch > b) b = n.pitch; }
    return { lo: a - 1, span: Math.max(6, b - a + 3) };
  }, [track.notes]);
  const h = ROW_H - 10;
  const nh = Math.max(2, Math.min(6, h / span));
  return (
    <div className="pointer-events-none absolute inset-0">
      {track.notes.map((n, i) => (
        <div key={i} className="absolute rounded-[1.5px]"
          style={{ left: n.startTick * ppt, width: Math.max(1.5, n.durationTicks * ppt - 0.5), top: 5 + ((lo + span - n.pitch) / span) * h - nh / 2, height: nh, background: velocityColor(track.color, n.velocity) }} />
      ))}
      {track.frozen && (
        <div className="absolute inset-0 flex items-center justify-end pr-3" style={{ background: `repeating-linear-gradient(135deg, ${withAlpha(tokens.freeze, 0.1)} 0 8px, transparent 8px 16px)`, borderTop: `1px solid ${withAlpha(tokens.freeze, 0.4)}`, borderBottom: `1px solid ${withAlpha(tokens.freeze, 0.4)}` }}>
          <span className="sticky right-3 flex items-center gap-1 rounded bg-[var(--c-bg0)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--c-freeze)]"><Ico icon={I.snowflake} /> Frozen</span>
        </div>
      )}
    </div>
  );
});

/* ---------------- Ruler & playhead ---------------- */
const Ruler = memo(function Ruler({ ppt, bars, width }: { ppt: number; bars: number; width: number }) {
  const ts = useStore((s) => s.project.timeSignature);
  const loop = useStore((s) => s.loop);
  const selSec = useStore((s) => s.selectedSectionId);
  const sections = useStore((s) => s.project.sections);
  const pxBar = barTicks(ts) * ppt;
  const every = pxBar < 18 ? 8 : pxBar < 30 ? 4 : pxBar < 50 ? 2 : 1;
  const ref = useRef<HTMLDivElement>(null);
  const loopR = useMemo(() => {
    const s = sections.find((x) => x.id === selSec);
    return s ? [(s.startBar - 1) * pxBar, s.lengthBars * pxBar] : [0, bars * pxBar];
  }, [sections, selSec, pxBar, bars]);
  const seekAt = (x: number) => seek((x - ref.current!.getBoundingClientRect().left) / ppt);
  const onPointerDown = (e: React.PointerEvent) => {
    const s = useStore.getState();
    // "Click during playback moves playhead" preference (spec §14): when off,
    // clicks while playing leave the transport alone.
    if (s.playing && !s.settings.clickDuringPlaybackMovesPlayhead) return;
    seekAt(e.clientX);
    drag(e, (_d, ev) => {
      seekAt(ev.clientX);
      // Scrubbing during playback suspends following (spec §12) — the drag
      // itself must not fight the user's hand.
      const s2 = useStore.getState();
      if (s2.playing && !s2.followSuspended) suspendFollow('scrub');
    }, (moved) => {
      const s3 = useStore.getState();
      // A plain click while playing re-locates and RESUMES following from
      // the new position (spec §8.4); a scrub stays suspended (§12.4).
      if (!moved && s3.playing) resumeFollow();
    }, { editSuspension: false });
  };
  const onDoubleClick = (e: React.MouseEvent) => {
    // Optional shortcut (spec §2): double-click the ruler to start playback
    // from the clicked position.
    const s = useStore.getState();
    if (s.playing) return;
    seekAt(e.clientX);
    play();
  };
  return (
    <div ref={ref} data-testid="ruler" className="panel sticky top-0 z-[25] h-full cursor-pointer border-b border-[#0f0f11]" style={{ width }}
      title="Click or drag to move the playhead · double-click to play from here"
      onPointerDown={onPointerDown} onDoubleClick={onDoubleClick}>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[rgba(233,230,224,0.35)]" aria-hidden />
      {loop && <div className="absolute bottom-0 h-[5px] rounded-sm bg-[var(--c-info)] opacity-70" style={{ left: loopR[0], width: loopR[1] }} />}
      {Array.from({ length: Math.ceil(width / pxBar) }, (_, b) => (
        <div key={b} className="absolute top-0 h-full" style={{ left: b * pxBar }}>
          {b % every === 0 && <span className={cn('absolute left-1 top-1.5 text-[10px] font-semibold tabular-nums tracking-[0.06em]', b < bars ? 'text-[var(--c-textDim)]' : 'text-[var(--c-textMute)]')}>{b + 1}</span>}
          <div className="absolute bottom-0 w-px bg-[var(--c-lineStrong)]" style={{ height: b % every === 0 ? 12 : 6 }} />
        </div>
      ))}
      <div className="absolute top-0 h-full bg-[var(--c-bg0)] opacity-50" style={{ left: bars * pxBar, right: 0 }} title="Past the project end" />
    </div>
  );
});

/**
 * The playhead: one authoritative rAF loop drives the line's transform AND
 * the follow (auto-scroll) policy. The React component never re-renders
 * while playing — the store is read via getState() inside the loop (spec
 * §16: no arranger re-renders during scrolling).
 */
function Playhead({ ppt, scroller }: { ppt: number; scroller: React.RefObject<HTMLDivElement | null> }) {
  const ref = useRef<HTMLDivElement>(null);

  // Manual scrolling during playback suspends auto-scroll (spec §5): the
  // scroll event fires for wheel, scrollbar, keyboard, minimap — any scroll
  // that is not one of our own writes suspends. With the optional
  // "resume when the playhead re-enters the view" preference (default off),
  // scrolling back onto the playhead resumes following.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => {
      const s = useStore.getState();
      if (!s.playing) return;
      if (isOwnWrite(el)) return; // the follow policy's own write
      programmaticX = null;
      if (s.followSuspended) {
        if (s.followSuspensionReason === 'manual-scroll' && s.settings.followResumeOnVisible) {
          if (playheadVisible({ playheadTick: currentTick(), pxPerTick: s.pxPerTick, headerPx: HEADER_W, scrollLeft: el.scrollLeft, clientWidth: el.clientWidth })) resumeFollow();
        }
        return;
      }
      if (s.settings.suspendFollowOnManualScroll && s.settings.autoScrollMode !== 'off') suspendFollow('manual-scroll');
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [scroller]);

  // Re-follow control (badge button / keyboard shortcut) — the transport
  // module can snap the view without owning the scroll container.
  useEffect(() => {
    registerFollowController('arranger', () => {
      const sc = scroller.current;
      if (!sc) return;
      const s = useStore.getState();
      const mode = s.settings.autoScrollMode;
      if (mode === 'off') return;
      writeScroll(sc, refollowScrollLeft({
        mode, trigger: s.settings.autoScrollTriggerPoint, playheadTick: currentTick(), pxPerTick: s.pxPerTick,
        headerPx: HEADER_W, scrollLeft: sc.scrollLeft, clientWidth: sc.clientWidth, loop: s.loop ? loopRange() : null,
      }));
    });
    return () => registerFollowController('arranger', null);
  }, [ppt, scroller]);

  useEffect(() => {
    let raf = 0;
    let glide: { from: number; to: number; t0: number } | null = null;
    let prevPlaying = false;
    const loop = () => {
      const s = useStore.getState();
      const t = currentTick();
      const x = HEADER_W + t * ppt;
      if (ref.current) ref.current.style.transform = `translateX(${x}px)`;
      const sc = scroller.current;
      if (sc) {
        // A scrollLeft that nobody of ours wrote is a manual scroll that
        // happened between frames — suspend BEFORE the policy overwrites it.
        if (s.playing && programmaticX !== null && Math.abs(sc.scrollLeft - programmaticX) > 0.5) {
          programmaticX = null;
          if (!s.followSuspended && s.settings.suspendFollowOnManualScroll && s.settings.autoScrollMode !== 'off') suspendFollow('manual-scroll');
        }
        const justStarted = s.playing && !prevPlaying;
        prevPlaying = s.playing;
        if (s.playing && !s.followSuspended && !s.interactionActive) {
          const mode = s.settings.autoScrollMode;
          if (mode !== 'off') {
            const v = {
              mode, trigger: s.settings.autoScrollTriggerPoint, playheadTick: t, pxPerTick: ppt,
              headerPx: HEADER_W, scrollLeft: sc.scrollLeft, clientWidth: sc.clientWidth, loop: s.loop ? loopRange() : null,
            };
            if (justStarted && !playheadVisible(v)) {
              // Playback starting with the playhead off-screen: jump once so
              // the user sees where playback begins.
              glide = null;
              writeScroll(sc, refollowScrollLeft(v));
            } else {
              const res = followScroll(v);
              if (res.scrollLeft !== null && res.scrollLeft !== sc.scrollLeft) {
                if (res.wrapBack) {
                  // Loop wrap / seek back: glide the view back (spec §7.5)
                  // instead of a hard jump; the policy keeps the target fresh.
                  if (!glide) glide = { from: sc.scrollLeft, to: res.scrollLeft, t0: performance.now() };
                } else {
                  glide = null;
                  writeScroll(sc, res.scrollLeft);
                }
              }
            }
          }
        }
        if (glide) {
          const k = Math.min(1, (performance.now() - glide.t0) / 180);
          const eased = 1 - Math.pow(1 - k, 3);
          writeScroll(sc, Math.round(glide.from + (glide.to - glide.from) * eased));
          if (k >= 1) glide = null;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ppt, scroller]);

  return <div ref={ref} data-testid="playhead" className="pointer-events-none absolute left-0 top-0 z-[22] h-full w-px bg-[var(--c-playhead)] shadow-[0_0_6px_var(--c-playhead)]"><div className="sticky top-0 -ml-[5px] h-0 w-0 border-x-[5.5px] border-t-[8px] border-x-transparent border-t-[var(--c-playhead)]" /></div>;
}

/** Non-blocking badge shown while auto-scroll is suspended (spec §5, §9). */
function FollowBadge() {
  const suspended = useStore((s) => s.followSuspended);
  const reason = useStore((s) => s.followSuspensionReason);
  const refollowKey = useStore((s) => s.settings.refollowKey);
  if (!suspended) return null;
  const label = reason === 'edit' ? 'Follow suspended — editing' : reason === 'scrub' ? 'Follow suspended — scrubbing' : 'Follow suspended';
  return (
    <div data-testid="follow-suspended" className="absolute bottom-3 right-4 z-[60] flex items-center gap-2.5 rounded-full border border-[var(--c-lineStrong)] bg-[var(--c-bg2)]/95 py-1.5 pl-3 pr-1.5 shadow-2xl animate-[pop_.15s_ease]">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--c-warn)] opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--c-warn)]" />
      </span>
      <span className="whitespace-nowrap text-[11px] font-semibold text-[var(--c-textDim)]">{label}</span>
      <button data-testid="refollow-btn" onClick={refollowPlayhead}
        title="Re-follow playhead — resume auto-scroll and jump back to the playhead"
        className="hw flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[10px] font-bold uppercase tracking-[0.08em]">
        Re-follow
        <kbd className="rounded border border-[var(--c-line)] bg-[var(--c-bg0)] px-1 font-mono text-[9px] uppercase">{refollowKey}</kbd>
      </button>
    </div>
  );
}

/* ---------------- Add track ---------------- */
function AddTrack() {
  const [open, setOpen] = useState(false);
  const fams: TrackFamily[] = ['Strings', 'Brass', 'Woodwinds', 'Percussion', 'Keys'];
  return (
    <div className="panel sticky left-0 z-[42] flex items-center border-r border-[#0f0f11] px-3" style={{ width: HEADER_W }}>
      <div className="relative">
        <button title="Add an instrument track" data-testid="add-track" onClick={() => setOpen(!open)} className="hw flex h-8 items-center gap-2 px-3 text-[11px] font-semibold uppercase tracking-[0.11em]">
          <Ico icon={I.plus} /> Add Track
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-30" onPointerDown={() => setOpen(false)} />
            <div className="absolute bottom-10 left-0 z-40 w-44 rounded-lg border border-[var(--c-lineStrong)] bg-[var(--c-bg2)] p-1 shadow-2xl animate-[pop_.12s_ease]">
              {fams.map((f) => (
                <button key={f} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--c-bg4)]" onClick={() => { useStore.getState().addTrack(f); setOpen(false); }}>
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: FAMILY_COLORS[f] }} />{f}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------- Arranger ---------------- */
export function Arranger() {
  const tracks = useStore((s) => s.project.tracks);
  const ts = useStore((s) => s.project.timeSignature);
  const sections = useStore((s) => s.project.sections);
  const chords = useStore((s) => s.project.chords);
  const ppt = useStore((s) => s.pxPerTick);
  const selected = useStore((s) => s.selectedTrackIds);
  const scroller = useRef<HTMLDivElement>(null);
  const bars = projectBars({ sections, chords, timeSignature: ts });
  const bt = barTicks(ts);
  const [vw, setVw] = useState(1200);
  useLayoutEffect(() => {
    const el = scroller.current!;
    const ro = new ResizeObserver(() => setVw(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const width = Math.max(vw - HEADER_W, (bars + 8) * bt * ppt);
  const pxBar = bt * ppt, pxBeat = beatTicks(ts) * ppt;
  const grid = useMemo(() => ({
    backgroundImage: `linear-gradient(to right, ${tokens.barLine} 1px, transparent 1px), linear-gradient(to right, ${tokens.beatLine} 1px, transparent 1px)`,
    backgroundSize: `${pxBar}px 100%, ${pxBeat}px 100%`,
  }), [pxBar, pxBeat]);

  // Ctrl+wheel zoom anchored at the mouse position. While following during
  // playback, the view re-anchors around the playhead instead (spec §6): the
  // musical position never jumps, the playhead stays visible, suspension is
  // preserved (manual view position kept via the mouse anchor).
  useEffect(() => {
    const el = scroller.current!;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const s = useStore.getState();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left - HEADER_W;
      const tickAtMouse = (el.scrollLeft + mx) / s.pxPerTick;
      const next = Math.max(0.004, Math.min(0.6, s.pxPerTick * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      s.set({ pxPerTick: next });
      requestAnimationFrame(() => {
        const s2 = useStore.getState();
        if (s2.playing && !s2.followSuspended && !s2.interactionActive && s2.settings.autoScrollMode !== 'off') {
          writeScroll(el, refollowScrollLeft({
            mode: s2.settings.autoScrollMode, trigger: s2.settings.autoScrollTriggerPoint, playheadTick: currentTick(),
            pxPerTick: next, headerPx: HEADER_W, scrollLeft: el.scrollLeft, clientWidth: el.clientWidth,
            loop: s2.loop ? loopRange() : null,
          }));
        } else {
          writeScroll(el, Math.max(0, tickAtMouse * next - mx));
        }
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const openRoll = useCallback((t: Track) => { if (t.family !== 'Structure' && t.family !== 'Audio') useStore.getState().set({ pianoRollTrackId: t.id }); }, []);

  return (
    /* The wrapper owns the overlay layer: the badge must not scroll with the
       timeline, so it sits as a sibling of the scroll container. */
    <div className="relative min-h-0 flex-1" onPointerDownCapture={() => { const s = useStore.getState(); if (s.activeEditor !== 'arranger') s.set({ activeEditor: 'arranger' }); }}>
      <div
        ref={scroller} className="absolute inset-0 overflow-auto bg-[var(--c-bg0)]" data-testid="arranger-scroll" id="arranger-scroll"
        style={{ backgroundImage: 'radial-gradient(130% 55% at 50% -12%, rgba(233,184,76,0.055), transparent 62%)' }}
      >
        <div className="relative grid" style={{ gridTemplateColumns: `${HEADER_W}px ${width}px`, gridTemplateRows: `${RULER_H}px repeat(${tracks.length}, ${ROW_H}px) 56px`, width: HEADER_W + width }}>
          <div className="panel sticky left-0 top-0 z-[42] flex items-center justify-between border-b border-r border-[#0f0f11] px-3" style={{ width: HEADER_W }}>
            <span className="printed">tracks · {tracks.length}</span>
            <span className="text-[10px] tracking-[0.06em] text-[var(--c-textMute)]" title="Project length">{bars} bars · {ts.numerator}/{ts.denominator}</span>
          </div>
          <Ruler ppt={ppt} bars={bars} width={width} />
          {tracks.map((t, i) => (
            <Row key={t.id} track={t} index={i} selected={selected.includes(t.id)} ppt={ppt} grid={grid} onOpen={openRoll} endPx={projectEndTick({ sections, chords, timeSignature: ts }) * ppt} />
          ))}
          <AddTrack />
          <div style={grid} />
          <Playhead ppt={ppt} scroller={scroller} />
        </div>
      </div>
      <FollowBadge />
    </div>
  );
}

const Row = memo(function Row({ track, index, selected, ppt, grid, onOpen, endPx }: { track: Track; index: number; selected: boolean; ppt: number; grid: React.CSSProperties; onOpen: (t: Track) => void; endPx: number }) {
  return (
    <>
      <TrackHeader track={track} index={index} selected={selected} />
      <div
        data-track-lane={track.id}
        className={cn('relative border-b border-[var(--c-lineSoft)]', selected && 'bg-[var(--c-bg1)]')}
        style={{ ...grid, height: ROW_H }}
        onPointerDown={() => { if (track.family !== 'Structure') useStore.getState().set({ selectedTrackIds: [track.id] }); }}
        onDoubleClick={() => onOpen(track)}
        title={track.family !== 'Structure' && track.family !== 'Audio' ? 'Double-click to open the piano roll' : undefined}
      >
        <div className="pointer-events-none absolute top-0 h-full bg-[var(--c-bg0)] opacity-60" style={{ left: endPx, right: 0 }} />
        {track.role === 'structure' ? <StructureLane ppt={ppt} />
          : track.role === 'chords' ? <ChordLane ppt={ppt} />
          : track.family === 'Audio' ? <AudioLane ppt={ppt} />
          : <NoteLane track={track} ppt={ppt} />}
      </div>
    </>
  );
});

/** Automated alignment check: every header's top must equal its lane's top, before and after scrolling. */
export async function runAlignmentTest(): Promise<{ ok: boolean; checked: number; failures: string[] }> {
  const sc = document.getElementById('arranger-scroll');
  if (!sc) return { ok: false, checked: 0, failures: ['arranger not mounted'] };
  const failures: string[] = [];
  let checked = 0;
  const ids = useStore.getState().project.tracks.map((t) => t.id);
  const check = (label: string) => {
    for (const id of ids) {
      const h = sc.querySelector(`[data-track-header="${id}"]`); const l = sc.querySelector(`[data-track-lane="${id}"]`);
      if (!h || !l) { failures.push(`${label}: missing ${id}`); continue; }
      const a = h.getBoundingClientRect(), b = l.getBoundingClientRect();
      checked++;
      if (Math.abs(a.top - b.top) > 0.5 || Math.abs(a.height - b.height) > 0.5) failures.push(`${label}: ${id} header ${a.top.toFixed(1)} vs lane ${b.top.toFixed(1)}`);
    }
  };
  const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
  const y0 = sc.scrollTop, x0 = sc.scrollLeft;
  check('initial');
  for (const [y, x] of [[137, 0], [sc.scrollHeight, 400], [55, 1200], [0, 0]]) {
    sc.scrollTop = y; sc.scrollLeft = x; await frame(); await frame();
    check(`scroll(${x},${y})`);
  }
  sc.scrollTop = y0; sc.scrollLeft = x0;
  return { ok: failures.length === 0, checked, failures };
}
