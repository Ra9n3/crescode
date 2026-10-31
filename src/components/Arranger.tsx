import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { barTicks, beatTicks, parseChord, projectBars, projectEndTick, secondsToTicks, type Section, type Track, type TrackFamily } from '../shared/schema';
import { chordTrackApi, chordTrackGesture, isFreshManualCreate, noteManualCreate, SMART_CLIP_ID_PREFIX, syncPickerToChordCard } from '../engine/suggestion/wire';
import { FAMILY_COLORS, tokens, velocityColor, withAlpha } from '../theme/tokens';
import { preview } from '../audio/preview';
import { currentTick, seek } from '../audio/transport';
import { TrackHeader } from './TrackHeader';
import { ChordRenameInput } from './ChordRenameInput';
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

function drag(e: React.PointerEvent, move: (dx: number, ev: PointerEvent) => void, up: (moved: boolean) => void) {
  e.stopPropagation();
  const x0 = e.clientX;
  let moved = false;
  const mv = (ev: PointerEvent) => { if (Math.abs(ev.clientX - x0) > 2) moved = true; move(ev.clientX - x0, ev); };
  const u = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', u); up(moved); };
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
  const [editing, setEditing] = useState<string | null>(null);
  // Text-entry rename (double-click on an existing chord name) vs the manual
  // chord input (single click on empty space — the protected workflow).
  const [renaming, setRenaming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const snap = beatTicks(ts);
  const bt = barTicks(ts);
  const tickAt = (x: number) => Math.max(0, Math.floor((x - ref.current!.getBoundingClientRect().left) / ppt / snap) * snap);

  const onLaneDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const t = tickAt(e.clientX);
    if (chords.some((c) => t >= c.startTick && t < c.startTick + c.durationTicks)) return;
    const next = chords.filter((c) => c.startTick > t).sort((a, b) => a.startTick - b.startTick)[0];
    const dur = Math.max(snap, Math.min(bt - (t % bt), next ? next.startTick - t : bt));
    const st = useStore.getState();
    const id = st.addChord({ symbol: 'C', startTick: t, durationTicks: dur });
    noteManualCreate(id); // lets the double-click gesture recognize this as its own false start
    st.set({ selectedChordId: id, selectedSectionId: null });
    setRenaming(false);
    setEditing(id);
  };

  // Double-click gesture: on a clip → open the chord editor AND the inline
  // text-entry rename input at the clip (text-based chord entry & renaming);
  // on empty space → create a Smart Chord clip (the controller plans span +
  // undo transaction). A double-click whose first click just created a manual
  // chord converts that false start into a Smart clip atomically (see
  // suggestion/interaction.ts).
  const onLaneDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const t = tickAt(e.clientX);
    const hit = chordTrackApi.getChordClipAt(t);
    const fresh = hit !== null && isFreshManualCreate(hit.id);
    if (editing && !fresh) return; // don't hijack a double-click while renaming
    if (fresh) closeEdit(); // the false start's inline input goes away with it
    chordTrackGesture(hit, t, { freshFromManualCreate: fresh });
    // Existing clip: open the inline rename editor at the clip. It loads the
    // current chord name, and its commit preserves start/length/lane — never
    // creates a clip. The Smart Chord panel stays available alongside it.
    if (hit !== null && !fresh) {
      setRenaming(true);
      setEditing(hit.id);
      useStore.getState().set({ chordRenameId: hit.id });
    }
  };

  const closeEdit = () => {
    setEditing(null);
    setRenaming(false);
    useStore.getState().set({ chordRenameId: null });
  };
  const closeRename = closeEdit;

  const onChordDown = (e: React.PointerEvent, c: { id: string; startTick: number; durationTicks: number }) => {
    if (e.button !== 0 || editing === c.id) return;
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
            title={valid.ok ? `${c.symbol} = ${valid.chord.quality}${valid.chord.bassName ? ` over ${valid.chord.bassName}` : ''} · double-click to rename by text, drag to move, right edge to resize` : `Invalid chord: ${valid.error}`}
          >
            <div className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize" />
            {editing === c.id && !renaming ? (
              <input
                autoFocus defaultValue={c.symbol} spellCheck={false} data-testid="chord-input"
                className="w-full min-w-[40px] rounded bg-[var(--c-bg0)] px-1 text-[12px] outline-none"
                onFocus={(e) => e.target.select()}
                onChange={(e) => { e.target.style.color = parseChord(e.target.value).ok ? tokens.text : tokens.danger; }}
                onPointerDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Tab') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') closeEdit(); }}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (!v) useStore.getState().deleteChord(c.id);
                  else if (v !== c.symbol) useStore.getState().updateChord(c.id, { symbol: v });
                  closeEdit();
                }}
              />
            ) : <span className="truncate">{c.symbol}</span>}
          </div>
        );
      })}
      {/* Inline text-entry rename editor — floats AT the renamed clip. */}
      {editing !== null && renaming && (() => {
        const c = chords.find((x) => x.id === editing);
        return c !== undefined ? <ChordRenameInput key={c.id} clip={c} ppt={ppt} onDone={closeRename} /> : null;
      })()}
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
  return (
    <div ref={ref} className="panel sticky top-0 z-[25] h-full cursor-pointer border-b border-[#0f0f11]" style={{ width }}
      title="Click or drag to move the playhead"
      onPointerDown={(e) => { seekAt(e.clientX); drag(e, (_d, ev) => seekAt(ev.clientX), () => undefined); }}>
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

function Playhead({ ppt, scroller }: { ppt: number; scroller: React.RefObject<HTMLDivElement | null> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const t = currentTick();
      const x = HEADER_W + t * ppt;
      if (ref.current) ref.current.style.transform = `translateX(${x}px)`;
      const sc = scroller.current;
      if (sc && useStore.getState().playing) {
        const vis = sc.scrollLeft + sc.clientWidth;
        if (x > vis - 40 || x < sc.scrollLeft + HEADER_W) sc.scrollLeft = Math.max(0, x - HEADER_W - 80);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ppt, scroller]);
  return <div ref={ref} className="pointer-events-none absolute left-0 top-0 z-[22] h-full w-px bg-[var(--c-playhead)] shadow-[0_0_6px_var(--c-playhead)]"><div className="sticky top-0 -ml-[5px] h-0 w-0 border-x-[5.5px] border-t-[8px] border-x-transparent border-t-[var(--c-playhead)]" /></div>;
}

/* ---------------- Add track ---------------- */
function AddTrack() {
  const [open, setOpen] = useState(false);
  const fams: TrackFamily[] = ['Strings', 'Brass', 'Woodwinds', 'Percussion', 'Keys'];
  return (
    <div className="panel sticky left-0 z-20 flex items-center border-r border-[#0f0f11] px-3" style={{ width: HEADER_W }}>
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

  // Ctrl+wheel zoom anchored at the mouse position.
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
      requestAnimationFrame(() => { el.scrollLeft = Math.max(0, tickAtMouse * next - mx); });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const openRoll = useCallback((t: Track) => { if (t.family !== 'Structure' && t.family !== 'Audio') useStore.getState().set({ pianoRollTrackId: t.id }); }, []);

  return (
    <div
      ref={scroller} className="relative min-h-0 flex-1 overflow-auto bg-[var(--c-bg0)]" data-testid="arranger-scroll" id="arranger-scroll"
      style={{ backgroundImage: 'radial-gradient(130% 55% at 50% -12%, rgba(233,184,76,0.055), transparent 62%)' }}
    >
      <div className="relative grid" style={{ gridTemplateColumns: `${HEADER_W}px ${width}px`, gridTemplateRows: `${RULER_H}px repeat(${tracks.length}, ${ROW_H}px) 56px`, width: HEADER_W + width }}>
        <div className="panel sticky left-0 top-0 z-30 flex items-center justify-between border-b border-r border-[#0f0f11] px-3" style={{ width: HEADER_W }}>
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
