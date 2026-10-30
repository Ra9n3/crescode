import { Icon, type IconifyIcon } from '@iconify/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../utils/cn';
import { useStore } from '../store/store';
import { I } from './icons';

/** Layout constants shared by headers, lanes and the alignment test. */
export const ROW_H = 58;
export const HEADER_W = 300;
export const RULER_H = 30;

/** Non-passive wheel listener so controls can turn with the scroll wheel (Shift = fine). */
function useWheelAdjust(ref: React.RefObject<HTMLElement | null>, onStep: (dir: 1 | -1, fine: boolean) => void) {
  const cb = useRef(onStep);
  cb.current = onStep;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fn = (e: WheelEvent) => { e.preventDefault(); cb.current(e.deltaY < 0 ? 1 : -1, e.shiftKey); };
    el.addEventListener('wheel', fn, { passive: false });
    return () => el.removeEventListener('wheel', fn);
  }, [ref]);
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function Ico({ icon, className, style }: { icon: IconifyIcon; className?: string; style?: React.CSSProperties }) {
  return <Icon icon={icon} className={cn('shrink-0', className)} style={style} />;
}

/* ---------------------------------------------------------------- panels */

/** Script word on a silkscreen rule — the signature detail of the reference unit. */
export function PanelTitle({ children, className, light }: { children: ReactNode; className?: string; light?: boolean }) {
  return (
    <div className={cn('panel-title', light && 'plate', className)}>
      <span className="script">{children}</span>
    </div>
  );
}

type BtnProps = {
  icon: IconifyIcon; tip: string; onClick?: (e: React.MouseEvent) => void; active?: boolean; disabled?: boolean;
  activeColor?: string; className?: string; size?: 'sm' | 'md' | 'lg'; label?: string; testId?: string; primary?: boolean;
};

/** Hardware button: bevelled, silkscreen label, always with a tooltip. */
export function IconButton({ icon, tip, onClick, active, disabled, activeColor, className, size = 'md', label, testId, primary }: BtnProps) {
  const sz = size === 'sm' ? 'h-6 min-w-6 text-[13px]' : size === 'lg' ? 'h-9 min-w-9 text-lg' : 'h-7 min-w-7 text-[15px]';
  return (
    <button
      type="button" title={tip} aria-label={tip} data-testid={testId} disabled={disabled} data-on={active || undefined}
      onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
      onPointerDown={(e) => e.stopPropagation()}
      className={cn('hw inline-flex items-center justify-center gap-1.5 px-1.5 transition-colors duration-150', primary && 'hw-primary', 'disabled:opacity-35 disabled:cursor-not-allowed', sz, className)}
      style={active && activeColor ? { color: activeColor, boxShadow: `inset 0 1px 0 rgba(255,255,255,0.16), 0 0 8px -1px ${activeColor}` } : undefined}
    >
      <Ico icon={icon} />
      {label && <span className="text-[11px] font-semibold uppercase tracking-[0.1em]">{label}</span>}
    </button>
  );
}

/** Square lamp button (L / M / S / freeze): graphite face always, with a corner LED dot when on. */
export function ToggleChip({ on, onClick, label, tip, color, size = 21 }: { on: boolean; onClick: () => void; label: string; tip: string; color: string; size?: number }) {
  return (
    <button
      type="button" title={tip} aria-label={tip} aria-pressed={on} data-on={on || undefined}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onPointerDown={(e) => e.stopPropagation()}
      className="lamp flex items-center justify-center rounded-[2px] font-bold leading-none transition-all duration-150"
      style={{ width: size, height: size, fontSize: Math.max(8, size - 10), color: on ? 'var(--c-text)' : 'var(--c-textMute)', '--lamp-color': color } as React.CSSProperties}
    >{label}</button>
  );
}

/** Chrome toggle switch: metal stem with a ball end. */
export function ToggleSwitch({ on, tip, onChange, size = 'md', testId }: { on: boolean; tip: string; onChange: (v: boolean) => void; size?: 'sm' | 'md'; testId?: string }) {
  const h = size === 'sm' ? 22 : 30;
  const stemH = size === 'sm' ? 11 : 15;
  const ball = size === 'sm' ? 7 : 9;
  return (
    <button type="button" title={tip} aria-label={tip} role="switch" aria-checked={on} aria-pressed={on} onClick={(e) => { e.stopPropagation(); onChange(!on); }}
      className="toggle-slot relative shrink-0 rounded-[4px] transition-all duration-150" data-on={on} data-testid={testId ?? 'toggle-switch'} style={{ height: h, width: 16 }}>
      <div className="chrome-stem absolute left-1/2 -translate-x-1/2 rounded-full transition-all duration-150" style={{ height: stemH, width: 5, top: on ? 2 : h - stemH - 2 }} />
      <div className="chrome-ball absolute left-1/2 -translate-x-1/2 rounded-full transition-all duration-150" style={{ height: ball, width: ball, top: on ? 1 : h - ball - 1 }} />
    </button>
  );
}

export function Modal({ title, onClose, children, width = 560, footer, icon }: { title: string; onClose: () => void; children: ReactNode; width?: number; footer?: ReactNode; icon?: IconifyIcon }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--c-overlay)] backdrop-blur-[2px] animate-[fade_.15s_ease]" onPointerDown={onClose}>
      <div className="panel flex max-h-[86vh] flex-col overflow-hidden rounded-lg border border-[#0d0d0f] shadow-[0_24px_60px_rgba(0,0,0,0.7)] animate-[pop_.18s_ease]" style={{ width }} onPointerDown={(e) => e.stopPropagation()}>
        <div className="relative flex items-center gap-2 border-b border-[#0e0e10] px-4 py-3">
          <div className="absolute inset-x-0 top-0 h-px bg-[rgba(255,255,255,0.08)]" />
          {icon && <Ico icon={icon} className="text-[var(--c-textDim)]" />}
          <h2 className="script flex-1 text-[19px] leading-none text-[var(--c-text)]" style={{ fontFamily: 'var(--font-script)' }}>{title}</h2>
          <IconButton icon={I.x} tip="Close (Esc)" onClick={onClose} />
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-[#0e0e10] px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Button({ children, onClick, primary, disabled, tip, className, danger }: { children: ReactNode; onClick?: () => void; primary?: boolean; disabled?: boolean; tip?: string; className?: string; danger?: boolean }) {
  return (
    <button
      type="button" title={tip} disabled={disabled} onClick={onClick}
      className={cn(
        'hw inline-flex h-8 items-center justify-center gap-2 px-3 text-[11px] font-semibold uppercase tracking-[0.11em] transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-40',
        primary && 'hw-primary', danger && 'border-[#5c241c]',
        danger && 'text-[var(--c-danger)]',
        className,
      )}
    >{children}</button>
  );
}

/* ---------------------------------------------------------------- knobs & sliders */

/** Rotary knob with a spoked tick ring and a 12-o'clock detent. Drag up/down (Shift = fine),
    scroll wheel to turn, double-click to centre. Sits on the panel with a contact shadow. */
export function Knob({ value, onChange, tip, size = 26, def = 0, ticks = 11, capColor }: { value: number; onChange: (v: number) => void; tip: string; size?: number; def?: number; ticks?: number; capColor?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const angle = Math.max(-1, Math.min(1, value)) * 135;
  const label = Math.abs(value) < 0.005 ? 'C' : value < 0 ? `L${Math.round(-value * 100)}` : `R${Math.round(value * 100)}`;
  const detentIdx = (ticks - 1) / 2;
  const spokes = Array.from({ length: ticks }, (_, i) => {
    const a = (-135 + (270 * i) / (ticks - 1)) * (Math.PI / 180);
    const near = Math.abs(-135 + (270 * i) / (ticks - 1) - angle) < 14;
    return { x1: 20 + Math.sin(a) * 15.2, y1: 20 - Math.cos(a) * 15.2, x2: 20 + Math.sin(a) * 18.6, y2: 20 - Math.cos(a) * 18.6, near, detent: i === detentIdx };
  });
  useWheelAdjust(ref, (dir, fine) => onChange(clamp(Math.round((value + dir * (fine ? 0.01 : 0.05)) * 100) / 100, -1, 1)));
  return (
    <div
      ref={ref}
      title={`${tip}: ${label} — drag (Shift = fine) or scroll, double-click to centre`} aria-label={tip} role="slider" aria-valuenow={value}
      className="cursor-ns-resize select-none touch-none" style={{ width: size, height: size }}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
        ref.current?.setPointerCapture(e.pointerId);
        const y0 = e.clientY, v0 = value;
        const move = (ev: PointerEvent) => onChange(clamp(Math.round((v0 + (y0 - ev.clientY) / (ev.shiftKey ? 640 : 80)) * 100) / 100, -1, 1));
        const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
      }}
      onDoubleClick={(e) => { e.stopPropagation(); onChange(def); }}
    >
      <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden>
        <defs>
          <radialGradient id="knobBody" cx="38%" cy="28%" r="78%">
            <stop offset="0%" stopColor="#55555c" /><stop offset="55%" stopColor="#3a3a3f" /><stop offset="100%" stopColor="#232327" />
          </radialGradient>
          <linearGradient id="knobRing" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8e8e95" /><stop offset="100%" stopColor="#49494f" />
          </linearGradient>
          <filter id="knobShadow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="1.2" /></filter>
        </defs>
        {/* contact shadow — top-left light source, so the shadow falls bottom-right */}
        <ellipse cx="20.6" cy="22" rx="13.6" ry="13.1" fill="rgba(0,0,0,0.55)" filter="url(#knobShadow)" />
        {spokes.map((s, i) => <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.detent || s.near ? 'var(--knob-tick-hi)' : 'var(--knob-tick)'} strokeWidth={s.detent ? 1.9 : s.near ? 1.7 : 1} strokeLinecap="round" />)}
        <circle cx="20" cy="20" r="13.4" fill="url(#knobRing)" />
        <circle cx="20" cy="20" r="11.6" fill="url(#knobBody)" stroke="#141416" strokeWidth="0.8" />
        {capColor && <circle cx="20" cy="20" r="11.6" fill={capColor} opacity="0.2" />}
        <g transform={`rotate(${angle} 20 20)`}>
          <line x1="20" y1="10.2" x2="20" y2="16.6" stroke="rgba(233,230,224,0.92)" strokeWidth="1.9" strokeLinecap="round" />
        </g>
        <path d="M12 12.5 A 11.6 11.6 0 0 1 27 10.6" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1.1" strokeLinecap="round" />
      </svg>
    </div>
  );
}

/** Slim hardware slider (track volume in the header). */
export function MiniSlider({ value, min, max, onChange, def, tip, width = 64, color, format }: { value: number; min: number; max: number; onChange: (v: number) => void; def: number; tip: string; width?: number; color?: string; format?: (v: number) => string }) {
  const ref = useRef<HTMLDivElement>(null);
  const frac = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const fromEvent = (e: React.PointerEvent | PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return min + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (max - min);
  };
  useWheelAdjust(ref, (dir, fine) => onChange(clamp(value + dir * (max - min) * (fine ? 0.01 : 0.05), min, max)));
  return (
    <div
      ref={ref} title={`${tip}: ${format ? format(value) : value.toFixed(2)} — drag or scroll, double-click resets`} aria-label={tip} role="slider" aria-valuenow={value}
      className="group relative h-[18px] cursor-ew-resize touch-none" style={{ width }}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        onChange(fromEvent(e));
        const move = (ev: PointerEvent) => onChange(fromEvent(ev));
        const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
      }}
      onDoubleClick={(e) => { e.stopPropagation(); onChange(def); }}
    >
      <div className="fader-slot absolute top-1/2 h-[5px] w-full -translate-y-1/2 rounded-full" />
      <div className="absolute top-1/2 h-[5px] -translate-y-1/2 rounded-full opacity-80" style={{ width: `${frac * 100}%`, background: color ?? 'var(--c-textDim)' }} />
      <div className="fader-cap fader-cap--mini absolute top-1/2 h-[13px] w-[9px] -translate-y-1/2" style={{ left: `calc(${frac * 100}% - 4.5px)` }} />
    </div>
  );
}

/** Even label stops for a printed legend of n marks (0% at top → 100% at bottom). */
export function legendStops(n: number): number[] {
  return Array.from({ length: n }, (_, i) => (i / (n - 1)) * 100);
}

/** Vertical desk fader: grab the cap for a relative drag, click the empty track to jump,
    scroll to nudge (Shift = fine). The coloured throw fills from the bottom up to the cap.
    Renders only the track and the cap — level numbers live beside the meter. */
const CAP_H = 16;

export function Fader({ value, max = 1.5, onChange, tip, height = 130, width = 22 }: { value: number; max?: number; onChange: (v: number) => void; tip: string; height?: number; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const setFromY = (clientY: number, grab = 0) => {
    const r = ref.current!.getBoundingClientRect();
    const travel = r.height - CAP_H;
    const capCenterY = clientY - grab;
    const fracY = travel > 0 ? 1 - (capCenterY - r.top - CAP_H / 2) / travel : 0;
    onChange(Math.round(clamp(fracY, 0, 1) * max * 100) / 100);
  };
  const frac = Math.max(0, Math.min(1, value / max));
  const db = value <= 0.0001 ? '-∞' : (20 * Math.log10(value)).toFixed(1);
  const capW = Math.max(16, Math.min(22, width + 2));
  useWheelAdjust(ref, (dir, fine) => onChange(clamp(Math.round((value + dir * (fine ? 0.01 : 0.05)) * 100) / 100, 0, max)));
  return (
    <div
      ref={ref} title={`${tip}: ${db} dB — grab the cap (Shift = fine), click the track to jump, or scroll`} role="slider" aria-label={tip} aria-valuenow={value}
      className="relative shrink-0 cursor-ns-resize touch-none overflow-hidden" style={{ height, width }}
      onPointerDown={(e) => {
        e.preventDefault();
        ref.current?.setPointerCapture(e.pointerId);
        const cap = (e.target as HTMLElement).closest('[data-fader-cap]') as HTMLElement | null;
        let grab = 0;
        if (cap) { const cr = cap.getBoundingClientRect(); grab = e.clientY - (cr.top + cr.height / 2); }
        else setFromY(e.clientY);
        const mv = (ev: PointerEvent) => setFromY(ev.clientY, grab);
        const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
        window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
      }}
      onDoubleClick={() => onChange(0.8)}
    >
      <div className="fader-slot absolute left-1/2 h-full w-[6px] -translate-x-1/2 rounded-[2px]" />
      {/* lit throw — grows from the bottom, ends at the cap center */}
      <div className="absolute left-1/2 w-[6px] -translate-x-1/2 rounded-[2px]" style={{ bottom: 0, height: `calc(${frac} * (100% - ${CAP_H}px) + ${CAP_H / 2}px)`, background: 'linear-gradient(180deg, rgba(233,230,224,0.16), rgba(233,230,224,0.04))' }} />
      {/* SSL / Standard Wedge cap: stays strictly within the track height at frac 0 and frac 1 */}
      <div data-fader-cap className="fader-cap absolute left-1/2 -translate-x-1/2" style={{ bottom: `calc(${frac} * (100% - ${CAP_H}px))`, height: CAP_H, width: capW }} />
    </div>
  );
}

/** Printed dB scale column (silkscreen numbers), strictly bounded inside the meter height (no bleeding). */
export function ScaleColumn({ height, labels, width = 12, testId = 'strip-scale', align = 'left' }: { height: number; labels: string[]; width?: number; testId?: string; align?: 'left' | 'right' }) {
  const n = labels.length;
  const stops = legendStops(n);
  return (
    <div className="relative shrink-0" style={{ height, width }} aria-hidden data-testid={testId}>
      {labels.map((l, i) => {
        const isFirst = i === 0;
        const isLast = i === n - 1;
        const posStyle: React.CSSProperties = isFirst
          ? { top: 1, transform: 'none' }
          : isLast
          ? { bottom: 1, top: 'auto', transform: 'none' }
          : { top: `${stops[i]}%`, transform: 'translateY(-50%)' };

        return (
          <span
            key={`${l}-${i}`}
            className="printed absolute leading-none tabular-nums"
            data-scale={l}
            style={{
              [align]: 0,
              ...posStyle,
              fontSize: 5.5,
              opacity: 0.65,
              color: 'var(--c-plateInk)',
              letterSpacing: '0.01em',
            }}
          >
            {l}
          </span>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- toasts */

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  const color = { info: 'var(--c-info)', success: 'var(--c-success)', error: 'var(--c-danger)', warn: 'var(--c-warn)' };
  return (
    <div className="pointer-events-none fixed bottom-10 right-4 z-[60] flex w-[360px] flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className="panel-raised pointer-events-auto flex items-start gap-2 rounded-md border border-[#0e0e10] px-3 py-2.5 text-xs shadow-xl animate-[slidein_.2s_ease]" style={{ borderLeft: `3px solid ${color[t.kind]}` }}>
          <Ico icon={t.kind === 'error' || t.kind === 'warn' ? I.warn : I.check} className="mt-px text-sm" style={{ color: color[t.kind] }} />
          <div className="flex-1 leading-relaxed">{t.text}
            {t.action && <button className="ml-2 font-semibold uppercase tracking-[0.08em] text-[var(--c-accent)] hover:underline" onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>}
          </div>
          <IconButton icon={I.x} tip="Dismiss" size="sm" onClick={() => dismiss(t.id)} />
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- fields */

export function Select<T extends string | number>({ value, options, onChange, tip, className, mono }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; tip: string; className?: string; mono?: boolean }) {
  return (
    <select
      title={tip} aria-label={tip} value={String(value)}
      onChange={(e) => { const o = options.find((x) => String(x.value) === e.target.value); if (o) onChange(o.value); }}
      className={cn('screen h-7 rounded-[3px] px-2 text-[11px] uppercase tracking-[0.08em] text-[var(--c-text)] outline-none hover:brightness-125', mono && 'font-mono tracking-normal normal-case', className)}
    >
      {options.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
    </select>
  );
}

/** Recessed numeric field that commits on blur/Enter and nudges with arrows. */
export function NumberField({ value, onCommit, min, max, step = 1, tip, width = 56, suffix }: { value: number; onCommit: (v: number) => void; min: number; max: number; step?: number; tip: string; width?: number; suffix?: string }) {
  const [txt, setTxt] = useState(String(value));
  useEffect(() => setTxt(String(value)), [value]);
  const commit = (v: number) => { const c = Math.max(min, Math.min(max, v)); if (!Number.isNaN(c)) onCommit(c); setTxt(String(Number.isNaN(c) ? value : c)); };
  return (
    <div className="screen flex items-center rounded-[3px]" title={tip}>
      <input
        aria-label={tip} value={txt} style={{ width }} onChange={(e) => setTxt(e.target.value)}
        onBlur={() => commit(parseFloat(txt))}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'ArrowUp') { e.preventDefault(); commit(value + step); }
          if (e.key === 'ArrowDown') { e.preventDefault(); commit(value - step); }
        }}
        className="h-7 bg-transparent px-2 text-center font-mono text-xs text-[var(--c-text)] outline-none"
      />
      {suffix && <span className="printed pr-2">{suffix}</span>}
    </div>
  );
}
