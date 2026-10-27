import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { barTicks, beatTicks, noteName, projectEndTick, PPQ, type Note } from '../shared/schema';
import { sanitizeNotes } from '../engine/generate';
import { tokens, velocityColor, withAlpha } from '../theme/tokens';
import { currentTick } from '../audio/transport';
import { cn } from '../utils/cn';
import { I } from './icons';
import { Ico, IconButton, Select } from './ui';

const KEY_H = 15;
const KEYS_W = 66;
const VEL_H = 90;
const SNAPS = [
  { value: 0, label: 'Off' }, { value: PPQ * 4, label: '1/1' }, { value: PPQ * 2, label: '1/2' }, { value: PPQ, label: '1/4' },
  { value: PPQ / 2, label: '1/8' }, { value: PPQ / 4, label: '1/16' }, { value: PPQ / 8, label: '1/32' }, { value: PPQ / 3, label: '1/8T' },
];
const isBlack = (p: number) => [1, 3, 6, 8, 10].includes(p % 12);

export function PianoRoll() {
  const trackId = useStore((s) => s.pianoRollTrackId)!;
  const project = useStore((s) => s.project);
  const track = project.tracks.find((t) => t.id === trackId);
  const [notes, setNotes] = useState<Note[]>(() => track?.notes.map((n) => ({ ...n })) ?? []);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [tool, setTool] = useState<'select' | 'draw'>('draw');
  const [snap, setSnap] = useState(PPQ / 4);
  const [ppt, setPpt] = useState(0.12);
  const lastLen = useRef(PPQ);
  const scroller = useRef<HTMLDivElement>(null);
  const velRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const playRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (track) setNotes(track.notes.map((n) => ({ ...n }))); }, [track?.notes]); // eslint-disable-line react-hooks/exhaustive-deps

  const lo = track ? track.lowestNote : 0, hi = track ? track.highestNote : 127;
  const rows = hi - lo + 1;
  const end = projectEndTick(project);
  const bt = barTicks(project.timeSignature), beat = beatTicks(project.timeSignature);
  const width = end * ppt;
  const height = rows * KEY_H;
  const q = (t: number) => (snap ? Math.round(t / snap) * snap : Math.round(t));
  const qFloor = (t: number) => (snap ? Math.floor(t / snap) * snap : Math.round(t));

  const commit = (next: Note[]) => {
    const clean = sanitizeNotes(next, lo, hi, end);
    setNotes(clean);
    useStore.getState().setNotes(trackId, clean);
    setSel(new Set());
  };

  useEffect(() => {
    if (!track) return;
    const sc = scroller.current!;
    const avg = notes.length ? notes.reduce((a, n) => a + n.pitch, 0) / notes.length : (lo + hi) / 2;
    sc.scrollTop = Math.max(0, (hi - avg) * KEY_H - sc.clientHeight / 2);
    let raf = 0;
    const loop = () => { if (playRef.current) playRef.current.style.transform = `translateX(${currentTick() * ppt}px)`; raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [trackId, ppt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopImmediatePropagation(); if (sel.size) commit(notes.filter((_, i) => !sel.has(i))); }
      if (e.key === 'Escape') { e.stopImmediatePropagation(); useStore.getState().set({ pianoRollTrackId: null }); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); e.stopImmediatePropagation(); setSel(new Set(notes.map((_, i) => i))); }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  });

  const pos = (e: { clientX: number; clientY: number }) => {
    const r = gridRef.current!.getBoundingClientRect();
    return { tick: Math.max(0, (e.clientX - r.left) / ppt), pitch: Math.max(lo, Math.min(hi, hi - Math.floor((e.clientY - r.top) / KEY_H))) };
  };

  const dragLoop = (move: (ev: PointerEvent) => void, up: () => void) => {
    const mv = (ev: PointerEvent) => move(ev);
    const u = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', u); up(); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', u);
  };

  const onGridDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = pos(e);
    if (tool === 'select' && e.detail < 2) { setSel(new Set()); return; }
    const start = Math.min(end - 1, qFloor(p.tick));
    const n: Note = { pitch: p.pitch, startTick: start, durationTicks: Math.max(1, Math.min(end - start, snap || lastLen.current, lastLen.current)), velocity: 96 };
    const base = [...notes, n];
    const idx = base.length - 1;
    setNotes(base); setSel(new Set([idx]));
    dragLoop((ev) => {
      const t = pos(ev).tick;
      const len = Math.max(snap || 10, q(t) - start);
      base[idx] = { ...n, durationTicks: Math.min(end - start, len) };
      setNotes([...base]);
    }, () => { lastLen.current = base[idx].durationTicks; commit(base); });
  };

  const onNoteDown = (e: React.PointerEvent, i: number) => {
    e.stopPropagation();
    if (e.button === 2) { commit(notes.filter((_, j) => j !== i)); return; }
    const selected = sel.has(i) ? sel : e.shiftKey ? new Set([...sel, i]) : new Set([i]);
    setSel(selected);
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const resize = r.right - e.clientX < 6;
    const p0 = pos(e);
    const orig = notes.map((n) => ({ ...n }));
    let moved = false;
    dragLoop((ev) => {
      const p = pos(ev);
      const dt = snap ? Math.round((p.tick - p0.tick) / snap) * snap : Math.round(p.tick - p0.tick);
      const dp = p.pitch - p0.pitch;
      if (dt || dp) moved = true;
      setNotes(orig.map((n, j) => {
        if (!selected.has(j)) return n;
        if (resize) return { ...n, durationTicks: Math.max(snap || 10, Math.min(end - n.startTick, n.durationTicks + dt)) };
        const st = Math.max(0, Math.min(end - n.durationTicks, n.startTick + dt));
        return { ...n, startTick: st, pitch: Math.max(lo, Math.min(hi, n.pitch + dp)) };
      }));
    }, () => {
      setNotes((cur) => { if (moved) { const c = sanitizeNotes(cur, lo, hi, end); useStore.getState().setNotes(trackId, c); return c; } return cur; });
      if (moved) setSel(new Set());
    });
  };

  const onVelDown = (e: React.PointerEvent, i: number) => {
    e.stopPropagation();
    const targets = sel.has(i) ? sel : new Set([i]);
    const r = velRef.current!.getBoundingClientRect();
    const apply = (clientY: number) => {
      const v = Math.max(1, Math.min(127, Math.round((1 - (clientY - r.top) / VEL_H) * 127)));
      setNotes((cur) => cur.map((n, j) => (targets.has(j) ? { ...n, velocity: v } : n)));
    };
    apply(e.clientY);
    dragLoop((ev) => apply(ev.clientY), () => setNotes((cur) => { useStore.getState().setNotes(trackId, cur); return cur; }));
  };

  const gridBg = useMemo(() => ({
    backgroundImage: `linear-gradient(to right, ${tokens.barLine} 1px, transparent 1px), linear-gradient(to right, ${tokens.beatLine} 1px, transparent 1px)${snap && snap * ppt > 6 ? `, linear-gradient(to right, ${withAlpha('#ffffff', 0.018)} 1px, transparent 1px)` : ''}`,
    backgroundSize: `${bt * ppt}px 100%, ${beat * ppt}px 100%${snap && snap * ppt > 6 ? `, ${snap * ppt}px 100%` : ''}`,
  }), [bt, beat, ppt, snap]);

  if (!track) return null;
  return (
    <div className="fixed inset-x-3 top-[70px] bottom-[340px] z-40 flex flex-col overflow-hidden rounded-xl border border-[var(--c-lineStrong)] bg-[var(--c-bg1)] shadow-2xl animate-[pop_.18s_ease]" data-testid="piano-roll">
      <div className="flex items-center gap-2 border-b border-[var(--c-line)] px-3 py-2">
        <span className="h-3 w-3 rounded-sm" style={{ background: track.color }} />
        <Ico icon={I.piano} className="text-[var(--c-textDim)]" />
        <span className="text-sm font-bold">{track.name}</span>
        <span className="font-mono text-[10px] text-[var(--c-textMute)]">{noteName(lo)}–{noteName(hi)} · {notes.length} notes{track.locked ? ' · locked (Compose All keeps it)' : ''}</span>
        <div className="mx-2 h-5 w-px bg-[var(--c-line)]" />
        <IconButton icon={I.pencil} tip="Draw tool — click to add, drag to set length" active={tool === 'draw'} activeColor={tokens.accent} onClick={() => setTool('draw')} />
        <IconButton icon={I.cursor} tip="Select tool — double-click empty space to add" active={tool === 'select'} activeColor={tokens.accent} onClick={() => setTool('select')} />
        <div className="flex items-center gap-1 text-[11px] text-[var(--c-textDim)]"><Ico icon={I.magnet} /><Select<number> tip="Snap to grid" value={snap} options={SNAPS} onChange={setSnap} mono /></div>
        <IconButton icon={I.minus} tip="Zoom out" onClick={() => setPpt((p) => Math.max(0.02, p / 1.25))} />
        <IconButton icon={I.plus} tip="Zoom in" onClick={() => setPpt((p) => Math.min(1, p * 1.25))} />
        <IconButton icon={I.trash} tip="Delete selected notes (Delete)" disabled={!sel.size} onClick={() => commit(notes.filter((_, i) => !sel.has(i)))} />
        <span className="ml-auto text-[10px] text-[var(--c-textMute)]">Right-click deletes · Shift-click multi-select · drag right edge to resize · Ctrl+A all</span>
        <IconButton icon={I.x} tip="Close piano roll (Esc) — edits are already on the timeline" onClick={() => useStore.getState().set({ pianoRollTrackId: null })} />
      </div>
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto" onScroll={(e) => { if (velRef.current) velRef.current.parentElement!.scrollLeft = e.currentTarget.scrollLeft; }}>
        <div className="relative flex" style={{ width: KEYS_W + width, height }}>
          <div className="sticky left-0 z-10 shrink-0 border-r-2 border-[#0e0e10]" style={{ width: KEYS_W, height }}>
            {/* Vintage keyboard: aged ivory whites with seams and worn front edges,
                glossy black keys inset over them, felt at the top, printed C labels. */}
            {Array.from({ length: rows }, (_, r) => {
              const p = hi - r;
              const black = isBlack(p);
              return (
                <div key={p} className="relative" style={{ height: KEY_H }} data-key={p} title={`${noteName(p)}${black ? ' (black)' : ''}`}>
                  {/* white key: aged ivory, brighter at the back, worn front edge on the right */}
                  <div className="absolute inset-0" style={{
                    background: 'linear-gradient(180deg, rgba(255,255,255,0.55), rgba(0,0,0,0) 45%), linear-gradient(90deg, #c6bfae 0%, #efe8d8 9%, #f6f0e2 46%, #e7e0cf 86%, #cdc6b5 100%)',
                    borderBottom: '1px solid rgba(16,16,18,0.62)',
                    boxShadow: black ? 'inset 3px 0 5px -3px rgba(0,0,0,0.35)' : 'inset -5px 0 6px -5px rgba(0,0,0,0.30)',
                  }} />
                  {/* front face of the white key */}
                  <div className="absolute right-0 top-0 h-full w-[3px]" style={{ background: 'linear-gradient(90deg, #b3ab99, #8d8574)' }} />
                  {black && (
                    <>
                      {/* shadow the black key throws onto the white key */}
                      <div className="absolute left-[54%] top-[1px] h-[calc(100%-2px)] w-[6px]" style={{ background: 'linear-gradient(90deg, rgba(0,0,0,0.45), rgba(0,0,0,0))' }} />
                      {/* the black key itself: glossy, inset from the back edge, catching light at the tip */}
                      <div className="absolute left-0 top-0 h-full rounded-r-[2px]"
                        style={{
                          width: '54%',
                          background: 'linear-gradient(180deg, rgba(255,255,255,0.16), rgba(0,0,0,0) 30%), linear-gradient(90deg, #0b0b0d 0%, #141417 38%, #202024 76%, #2d2d32 94%, #45454b 100%)',
                          boxShadow: '1px 0 4px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.10), inset 0 -1px 0 rgba(255,255,255,0.06)',
                        }}>
                        <div className="absolute right-[2px] top-[14%] h-[72%] w-[1.5px] rounded-full" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.6), rgba(255,255,255,0.05))' }} />
                      </div>
                    </>
                  )}
                  {p % 12 === 0 && (
                    <span className="absolute right-[7px] top-1/2 -translate-y-1/2 text-[8px] font-semibold tracking-[0.04em]"
                      style={{ fontFamily: 'var(--font-mono)', color: '#57503f', textShadow: '0 1px 0 rgba(255,255,255,0.5)' }}>
                      {noteName(p)}
                    </span>
                  )}
                </div>
              );
            })}
            {/* felt under the fallboard */}
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[5px]" style={{ background: 'linear-gradient(180deg, #0e0e10 0%, #2b2320 60%, #3a302b 100%)', boxShadow: '0 2px 5px rgba(0,0,0,0.55)' }} />
          </div>
          <div ref={gridRef} className={cn('relative', tool === 'draw' ? 'cursor-crosshair' : 'cursor-default')} style={{ width, height }} onPointerDown={onGridDown} onContextMenu={(e) => e.preventDefault()}>
            {Array.from({ length: rows }, (_, r) => (
              <div key={r} className="absolute left-0 w-full border-b" style={{ top: r * KEY_H, height: KEY_H, background: isBlack(hi - r) ? tokens.pianoBlack : tokens.pianoWhite, borderColor: tokens.lineSoft }} />
            ))}
            <div className="absolute inset-0" style={gridBg} />
            {notes.map((n, i) => (
              <div key={i} onPointerDown={(e) => onNoteDown(e, i)} onContextMenu={(e) => e.preventDefault()}
                title={`${noteName(n.pitch)} · vel ${n.velocity} · start ${n.startTick} · len ${n.durationTicks}`}
                className={cn('absolute cursor-move rounded-[3px] border', sel.has(i) && 'ring-1 ring-[var(--c-text)]')}
                style={{ left: n.startTick * ppt, top: (hi - n.pitch) * KEY_H + 1, width: Math.max(3, n.durationTicks * ppt - 1), height: KEY_H - 2, background: velocityColor(track.color, n.velocity), borderColor: withAlpha(track.color, 0.9) }}>
                <div className="absolute right-0 top-0 h-full w-[6px] cursor-ew-resize" />
              </div>
            ))}
            <div ref={playRef} className="pointer-events-none absolute left-0 top-0 h-full w-px bg-[var(--c-playhead)]" />
          </div>
        </div>
      </div>
      <div className="flex border-t border-[var(--c-lineStrong)] bg-[var(--c-bg2)]" style={{ height: VEL_H + 8 }}>
        <div className="flex shrink-0 items-center justify-center border-r border-[var(--c-line)] text-[9px] font-semibold uppercase tracking-widest text-[var(--c-textMute)]" style={{ width: KEYS_W }}>Vel</div>
        <div className="min-w-0 flex-1 overflow-hidden">
          <div ref={velRef} className="relative mt-1" style={{ width, height: VEL_H, ...gridBg }}>
            {notes.map((n, i) => (
              <div key={i} onPointerDown={(e) => onVelDown(e, i)} title={`Velocity ${n.velocity} — drag to change`}
                className="absolute bottom-0 cursor-ns-resize" style={{ left: n.startTick * ppt, width: Math.max(4, Math.min(10, n.durationTicks * ppt)), height: (n.velocity / 127) * VEL_H }}>
                <div className="absolute left-0 top-0 h-[3px] w-full rounded-sm" style={{ background: sel.has(i) ? tokens.text : track.color }} />
                <div className="absolute bottom-0 left-0 h-full w-[2px]" style={{ background: withAlpha(track.color, 0.6) }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
