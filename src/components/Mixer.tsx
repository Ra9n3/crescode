import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { preview } from '../audio/preview';
import { isInstrumentTrack, type Track } from '../shared/schema/types';
import { tokens } from '../theme/tokens';
import { routingInfo } from '../lib/routing';
import { cn } from '../utils/cn';
import { Fader, Knob, ScaleColumn, ToggleChip } from './ui';
import { VstButton } from './TrackHeader';

const CH_LEGEND = ['+6', '0', '−10', '−20', '−40'];
const MASTER_LEGEND = ['+6', '0', '−10', '−20', '−40', '−∞'];

/** Segmented LED ladder: peak body plus a hold marker, as printed on a desk. */
function Meter({ id, height, width }: { id: string; height: number; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!; const g = c.getContext('2d')!;
    let peakHold = 0, holdT = 0;
    // Meter ballistics: fast attack, slow release (no extra RAF — this runs inside draw()).
    let displayR = 0, displayPk = 0;
    const ATTACK = 0.6, RELEASE = 0.04;
    const SEG = 12;
    const draw = () => {
      const lv = preview.levels[id] ?? { peak: 0, rms: 0 };
      const db = (v: number) => Math.max(0, Math.min(1, (20 * Math.log10(Math.max(1e-5, v)) + 60) / 66));
      const r0 = db(lv.rms * 1.4), pk0 = db(lv.peak);
      displayR = r0 > displayR ? displayR + (r0 - displayR) * ATTACK : Math.max(r0, displayR - RELEASE);
      displayPk = pk0 > displayPk ? pk0 : Math.max(pk0, displayPk - 0.02);
      const r = displayR, pk = displayPk;
      if (pk >= peakHold) { peakHold = pk; holdT = performance.now(); } else if (performance.now() - holdT > 900) peakHold = Math.max(pk, peakHold - 0.015);
      g.clearRect(0, 0, c.width, c.height);
      g.fillStyle = '#0d0d0f'; g.fillRect(0, 0, c.width, c.height);
      const segH = c.height / SEG;
      for (let i = 0; i < SEG; i++) {
        const level = (SEG - i) / SEG;
        const lit = r >= level - 1 / SEG;
        const isHold = peakHold >= level - 1 / SEG && peakHold < level;
        g.fillStyle = lit
          ? level > 0.92 ? tokens.meterHigh : level > 0.62 ? tokens.meterMid : tokens.meterLow
          : isHold ? 'rgba(233,230,224,0.55)' : 'rgba(233,230,224,0.07)';
        g.fillRect(0, i * segH + 1, c.width, segH - 2);
      }
    };
    draw();
    return preview.subscribeLevels(draw);
  }, [id]);
  // Same recessed groove treatment as the fader slot, so both read as level windows.
  return <canvas ref={ref} width={width} height={height} className="fader-slot shrink-0 rounded-[2px]" style={{ width, height }} title="Level meter (preview playback)" data-testid="meter" />;
}

type Density = 'full' | 'compact' | 'micro';
/** Shared fader travel height — the fader and the level meter are always the same. */
const FADER_H = 112;
const SIZES: Record<Density, { knob: number; lamp: number; fader: number; meter: number; scale: number; name: number }> = {
  full: { knob: 36, lamp: 21, fader: 20, meter: 6, scale: 11, name: 11 },
  compact: { knob: 32, lamp: 19, fader: 18, meter: 5, scale: 11, name: 10 },
  micro: { knob: 26, lamp: 17, fader: 16, meter: 4, scale: 0, name: 9 },
};

/**
 * Centered level block: the fader and meter pair is horizontally centered in the
 * channel strip directly beneath the M/S buttons. The meter and fader share the exact
 * same height (FADER_H) and start at top: 0, so they are 100% vertically level.
 * The printed scale numbers sit directly to the right of the playback preview bar.
 * The dB readout sits centered directly under the meter.
 */
function LevelBlock({ z, showScale, labels, db, meterId, scaleTestId, readoutTestId, onChange, value, tip, blockRef }: {
  z: typeof SIZES.full; showScale: boolean; labels: string[]; db: string; meterId: string;
  scaleTestId: string; readoutTestId: string; value: number; tip: string; onChange: (v: number) => void;
  blockRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div ref={blockRef} className="flex w-full shrink-0 items-start justify-center gap-1" style={{ height: FADER_H + 14 }} data-testid="level-block">
      <Fader value={value} tip={tip} height={FADER_H} width={z.fader} onChange={onChange} />
      <div className="relative flex flex-col items-center" style={{ width: z.meter }}>
        <Meter id={meterId} height={FADER_H} width={z.meter} />
        <span
          className="pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap font-mono font-semibold leading-none tabular-nums text-[var(--c-plateInk)]"
          data-testid={readoutTestId}
          style={{ top: FADER_H + 4, fontSize: 7.5, opacity: 0.85 }}
        >
          {db}
        </span>
      </div>
      {showScale && z.scale > 0 && (
        <ScaleColumn height={FADER_H} labels={labels} width={z.scale} testId={scaleTestId} />
      )}
    </div>
  );
}

const ChannelStrip = memo(function ChannelStrip({ track, selected, number, density, showScale, levelRef }: { track: Track; selected: boolean; number: number; density: Density; showScale: boolean; levelRef?: React.Ref<HTMLDivElement> }) {
  const update = useStore((s) => s.updateTrack);
  const project = useStore((s) => s.project);
  const info = routingInfo(project, track);
  const z = SIZES[density];
  const micro = density === 'micro';
  const db = track.volume <= 0.0001 ? '-∞' : (20 * Math.log10(track.volume)).toFixed(1);
  return (
    <div
      className={cn('plate flex min-w-0 flex-1 flex-col items-center justify-between gap-1 overflow-hidden border-r border-[rgba(0,0,0,0.15)] pb-2 pt-0 transition-shadow', density === 'micro' ? 'px-0.5' : 'px-1')}
      onClick={() => useStore.getState().set({ selectedTrackIds: [track.id] })} data-testid="mixer-strip" data-strip={track.id} data-selected={selected || undefined}
      style={{ '--strip-color': track.color } as React.CSSProperties}
    >
      <div className="h-[4px] w-full shrink-0 rounded-b border-b border-[rgba(0,0,0,0.38)]" style={{ backgroundImage: `linear-gradient(180deg, ${track.color}, ${track.color}cc)`, boxShadow: '0 1px 1px rgba(0,0,0,0.25)' }} />
      <div className="mt-0.5 w-full shrink-0 text-center">
        <span className="printed text-[10px] tracking-[0.22em] text-[var(--c-plateInk)]">{String(number).padStart(2, '0')}</span>
      </div>
      <div className="w-full shrink-0">
        {track.family !== 'Audio'
          ? <div className={cn('flex justify-center', micro && 'overflow-hidden')}><VstButton track={track} compact iconOnly={micro} /></div>
          : <div className="flex h-[22px] items-center justify-center"><span className="printed">ref</span></div>}
      </div>
      <div className="flex shrink-0 flex-col items-center">
        <Knob value={track.pan} onChange={(v) => update(track.id, { pan: v }, `pan-${track.id}`)} tip="Pan (preview only)" size={z.knob} capColor={track.color} />
        {!micro && <span className="printed text-[8px]">pan</span>}
      </div>
      <div className="flex shrink-0 items-center justify-center gap-1">
        <ToggleChip on={track.muted} label="M" tip="Mute (preview only)" color={tokens.mute} size={z.lamp} onClick={() => update(track.id, { muted: !track.muted })} />
        <ToggleChip on={track.soloed} label="S" tip="Solo (preview only)" color={tokens.solo} size={z.lamp} onClick={() => update(track.id, { soloed: !track.soloed })} />
        {isInstrumentTrack(track) && <ToggleChip on={track.locked} label="L" tip="Lock track" color={tokens.lock} size={z.lamp} onClick={() => update(track.id, { locked: !track.locked })} />}
      </div>
      <LevelBlock
        z={z} showScale={showScale} labels={CH_LEGEND} db={micro ? db : `${db} dB`} meterId={track.id}
        scaleTestId="strip-scale" readoutTestId="meter-db" value={track.volume} tip="Volume (preview only)"
        onChange={(v) => update(track.id, { volume: v }, `vol-${track.id}`)} blockRef={levelRef}
      />
      <div className="w-full shrink-0 px-0.5">
        <div
          className={cn('engrave w-full truncate text-center font-bold uppercase tracking-[0.06em]', track.muted && 'opacity-40')}
          style={{ fontSize: z.name, color: 'var(--c-plateInk)', textShadow: '0 1px 0 rgba(255,255,255,0.5)' }}
          title={track.name}
          data-testid="strip-name"
        >
          {track.name}
        </div>
        <div className="mt-0.5 flex w-full items-center justify-between gap-1 px-0.5">
          {!micro && <span className="printed text-[8px]">ch</span>}
          <span className="text-[9px] font-semibold tracking-[0.08em] text-[var(--c-plateInk)]" style={{ fontFamily: 'var(--font-mono)' }}>{String(track.midiChannel).padStart(2, '0')}</span>
          <span className="printed truncate text-[8px]" title={`Group: ${info.groupName ?? 'none'}`}>{info.preview ? 'prv' : 'vst'}</span>
        </div>
      </div>
    </div>
  );
});

export function Mixer() {
  const tracks = useStore((s) => s.project.tracks);
  const project = useStore((s) => s.project);
  const selected = useStore((s) => s.selectedTrackIds);
  const edit = useStore((s) => s.edit);
  const master = project.masterVolume;
  const masterDb = master <= 0.0001 ? '-∞' : (20 * Math.log10(master)).toFixed(1);
  const strips = tracks.filter((t) => t.family !== 'Structure');
  const bandRef = useRef<HTMLDivElement>(null);
  const [bandW, setBandW] = useState(1200);
  useEffect(() => {
    const el = bandRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBandW(el.clientWidth));
    ro.observe(el);
    setBandW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const stripW = Math.max(1, Math.floor(bandW / Math.max(1, strips.length)));
  const density: Density = stripW >= 70 ? 'full' : stripW >= 56 ? 'compact' : 'micro';
  // The printed numbers need room beside the meter; below that they would clip.
  const showScale = stripW >= 66;
  const z = SIZES[density];
  // Mirror the channel fader row exactly: pin the master's level block to the
  // measured y of the first channel's, so every fader and meter on the desk is level.
  const firstLevelRef = useRef<HTMLDivElement>(null);
  const [levelTop, setLevelTop] = useState(0);
  useLayoutEffect(() => {
    const read = () => setLevelTop(firstLevelRef.current?.offsetTop ?? 0);
    read();
    const t = window.setTimeout(read, 60);
    window.addEventListener('resize', read);
    return () => { window.clearTimeout(t); window.removeEventListener('resize', read); };
  }, [bandW, strips.length, density]);
  return (
    <div className="plate panel--chassis flex h-[300px] shrink-0 border-t border-[#0c0c0e] animate-[rise_.2s_ease]" data-testid="mixer">
      {/* every channel is flexed to share the full width — never scrolls */}
      <div ref={bandRef} className="flex min-w-0 flex-1 overflow-hidden" data-testid="mixer-channels">
        {strips.map((t, i) => <ChannelStrip key={t.id} track={t} number={tracks.findIndex((x) => x.id === t.id) + 1} selected={selected.includes(t.id)} density={density} showScale={showScale} levelRef={i === 0 ? firstLevelRef : undefined} />)}
      </div>
      {/* master: exactly one channel wide, with the same fader travel and meter, level with them */}
      <div
        className="plate relative flex shrink-0 flex-col items-center border-l-2 border-[rgba(0,0,0,0.28)] px-1 pb-2 pt-1 shadow-[inset_1px_0_0_rgba(255,255,255,0.5)]"
        style={{ width: stripW }} data-testid="master-strip"
      >
        <div className="panel-title w-full px-1"><span className="script" style={{ fontSize: 12 }}>Master</span></div>
        <div className="absolute left-0 right-0" style={{ top: levelTop }}>
          <LevelBlock
            z={z} showScale={showScale} labels={MASTER_LEGEND} db={`${masterDb} dB`} meterId="master"
            scaleTestId="meter-scale" readoutTestId="master-meter-db" value={master} tip="Master fader (preview only)"
            onChange={(v) => edit((p) => ({ ...p, masterVolume: v }), 'master')}
          />
        </div>
        <span className="printed absolute bottom-1.5 right-1 text-[6px] tracking-[0.1em]" style={{ opacity: 0.75 }} title="Crescode unit serial number">SN 0001</span>
      </div>
    </div>
  );
}
