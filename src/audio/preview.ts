/**
 * Built-in preview audio (Web Audio). Used when no plugin is hosted for a
 * group (graceful degradation). Mixer state is applied here only — it never
 * touches the project MIDI or the export.
 */
import { barTicks, beatOffsets, projectEndTick, ticksToSeconds } from '../shared/schema/meter';
import { PPQ, isInstrumentTrack, type Project, type Track } from '../shared/schema/types';

export interface Level { peak: number; rms: number }
type Ctx = BaseAudioContext;

const noiseCache = new WeakMap<Ctx, AudioBuffer>();
function noise(ctx: Ctx): AudioBuffer {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    let s = 12345;
    for (let i = 0; i < d.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = (s / 0x3fffffff) - 1; }
    noiseCache.set(ctx, b);
  }
  return b;
}

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** Plays one preview-sound note. Returns a stopper for clean Stop. */
export function playVoice(ctx: Ctx, dest: AudioNode, track: Pick<Track, 'family' | 'role'>, pitch: number, velocity: number, t0: number, dur: number): (when: number) => void {
  const v = Math.pow(velocity / 127, 1.6) * 0.32;
  const env = ctx.createGain();
  env.gain.value = 0;
  env.connect(dest);
  const srcs: (AudioScheduledSourceNode)[] = [];
  const f = mtof(pitch);
  let release = 0.2;
  const role = track.role;

  const osc = (type: OscillatorType, freq: number, detune = 0, gain = 1, to: AudioNode = env) => {
    const o = ctx.createOscillator();
    o.type = type; o.frequency.value = freq; o.detune.value = detune;
    const g = ctx.createGain(); g.gain.value = gain;
    o.connect(g); g.connect(to);
    srcs.push(o);
    return o;
  };
  const noiseSrc = (filterType: BiquadFilterType, freq: number, q = 1) => {
    const n = ctx.createBufferSource(); n.buffer = noise(ctx); n.loop = true;
    const flt = ctx.createBiquadFilter(); flt.type = filterType; flt.frequency.value = freq; flt.Q.value = q;
    n.connect(flt); flt.connect(env); srcs.push(n);
  };

  if (track.family === 'Percussion') {
    if (role === 'timpani' ) {
      const o = osc('sine', f * 2);
      o.frequency.setValueAtTime(f * 2.4, t0); o.frequency.exponentialRampToValueAtTime(f * 2, t0 + 0.08);
      env.gain.setValueAtTime(0, t0); env.gain.linearRampToValueAtTime(v * 1.6, t0 + 0.005); env.gain.exponentialRampToValueAtTime(0.001, t0 + 1.4);
      release = 0.1; dur = Math.max(dur, 1.4);
    } else if (role === 'cymbals') {
      noiseSrc('highpass', 6000, 0.7);
      env.gain.setValueAtTime(0, t0); env.gain.linearRampToValueAtTime(v, t0 + 0.004); env.gain.exponentialRampToValueAtTime(0.001, t0 + 2.2);
      dur = Math.max(dur, 2.2);
    } else {
      noiseSrc('bandpass', role === 'snare' ? 1800 : 5000, role === 'snare' ? 0.8 : 2);
      if (role === 'snare') osc('triangle', 190, 0, 0.6);
      env.gain.setValueAtTime(0, t0); env.gain.linearRampToValueAtTime(v * 1.3, t0 + 0.002); env.gain.exponentialRampToValueAtTime(0.001, t0 + (role === 'snare' ? 0.22 : 0.08));
      dur = Math.max(dur, 0.25);
    }
    release = 0.05;
  } else if (track.family === 'Keys') {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(9000, f * 6); lp.connect(env);
    osc('triangle', f, 0, 0.8, lp); osc('sine', f * 2, 3, 0.25, lp);
    const decay = role === 'harp' ? 1.6 : 2.6;
    env.gain.setValueAtTime(0, t0); env.gain.linearRampToValueAtTime(v * 1.2, t0 + 0.004); env.gain.setTargetAtTime(v * 0.15, t0 + 0.01, decay / 3);
    release = role === 'harp' ? 0.6 : 0.25;
  } else {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.connect(env);
    let attack = 0.05;
    if (track.family === 'Strings') {
      lp.frequency.value = Math.min(6000, 900 + f * 3); lp.Q.value = 0.5;
      osc('sawtooth', f, -7, 0.5, lp); osc('sawtooth', f, 7, 0.5, lp); attack = 0.09; release = 0.3;
    } else if (track.family === 'Brass') {
      lp.frequency.setValueAtTime(400, t0); lp.frequency.linearRampToValueAtTime(Math.min(5000, f * 5 + 800 * (velocity / 127)), t0 + 0.08);
      osc('sawtooth', f, 0, 0.8, lp); osc('square', f / 2, 0, 0.15, lp); attack = 0.04; release = 0.18;
    } else {
      lp.frequency.value = Math.min(7000, f * 4);
      osc('triangle', f, 0, 0.9, lp); osc('sine', f * 2, 0, 0.12, lp); attack = 0.03; release = 0.12;
    }
    env.gain.setValueAtTime(0, t0); env.gain.linearRampToValueAtTime(v, t0 + attack); env.gain.setTargetAtTime(v * 0.85, t0 + attack, 0.2);
  }
  const end = t0 + dur;
  env.gain.setTargetAtTime(0, end, release / 4);
  for (const s of srcs) { s.start(t0); s.stop(end + release * 1.5 + 0.05); }
  return (when: number) => {
    try {
      env.gain.cancelScheduledValues(when);
      env.gain.setTargetAtTime(0, when, 0.015);
      for (const s of srcs) s.stop(when + 0.08);
    } catch { /* already stopped */ }
  };
}

interface Strip { gain: GainNode; pan: StereoPannerNode; analyser: AnalyserNode }
interface Segment { ctxTime: number; tick: number }

class PreviewEngine {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private masterAnalyser: AnalyserNode | null = null;
  private metroGain: GainNode | null = null;
  private strips = new Map<string, Strip>();
  private voices: { stop: (w: number) => void; end: number }[] = [];
  private sources: AudioScheduledSourceNode[] = [];
  private timer: number | null = null;
  private segments: Segment[] = [];
  private cursor = 0;
  private getProject: () => Project = () => { throw new Error('not bound'); };
  private loopRange: () => [number, number] | null = () => null;
  private metronomeOn: () => boolean = () => false;
  private onEnded: () => void = () => {};
  frozen = new Map<string, { buffer: AudioBuffer; hash: string }>();
  refBuffer: AudioBuffer | null = null;
  refPeaks: Float32Array | null = null;
  levels: Record<string, Level> = {};
  private levelSubs = new Set<() => void>();
  private raf = 0;
  latencyHint: number = 512 / 48000;
  sinkId = 'default';
  playing = false;

  bind(o: { getProject: () => Project; loopRange: () => [number, number] | null; metronome: () => boolean; onEnded: () => void }) {
    this.getProject = o.getProject; this.loopRange = o.loopRange; this.metronomeOn = o.metronome; this.onEnded = o.onEnded;
  }

  ensure(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: this.latencyHint });
      const sink = (this.ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> }).setSinkId;
      if (sink && this.sinkId !== 'default') sink.call(this.ctx, this.sinkId).catch(() => undefined);
      this.master = this.ctx.createGain();
      this.masterAnalyser = this.ctx.createAnalyser(); this.masterAnalyser.fftSize = 1024;
      this.master.connect(this.masterAnalyser); this.masterAnalyser.connect(this.ctx.destination);
      this.metroGain = this.ctx.createGain(); this.metroGain.gain.value = 0.5; this.metroGain.connect(this.ctx.destination);
      this.strips.clear();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  async setDevice(latencyHint: number, sinkId: string) {
    this.latencyHint = latencyHint; this.sinkId = sinkId;
    if (this.playing) this.stop();
    if (this.ctx) { await this.ctx.close().catch(() => undefined); this.ctx = null; }
  }

  strip(trackId: string): Strip {
    const ctx = this.ensure();
    let s = this.strips.get(trackId);
    if (!s) {
      const gain = ctx.createGain(); const pan = ctx.createStereoPanner(); const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      gain.connect(pan); pan.connect(analyser); analyser.connect(this.master!);
      s = { gain, pan, analyser };
      this.strips.set(trackId, s);
    }
    return s;
  }

  /** Applies volume / pan / mute / solo / master. Preview only. */
  applyMixer(p: Project) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const anySolo = p.tracks.some((x) => x.soloed);
    for (const tr of p.tracks) {
      if (tr.family === 'Structure') continue;
      const s = this.strip(tr.id);
      const g = tr.muted || (anySolo && !tr.soloed) ? 0 : tr.volume;
      s.gain.gain.setTargetAtTime(g, t, 0.015);
      s.pan.pan.setTargetAtTime(tr.pan, t, 0.015);
    }
    this.master!.gain.setTargetAtTime(p.masterVolume, t, 0.015);
  }

  position(): number {
    if (!this.ctx || !this.playing || !this.segments.length) return this.cursor;
    const now = this.ctx.currentTime;
    let seg = this.segments[0];
    for (const s of this.segments) if (s.ctxTime <= now) seg = s;
    const p = this.getProject();
    return Math.max(0, seg.tick + ((now - seg.ctxTime) * p.bpm * PPQ) / 60);
  }

  play(fromTick: number) {
    const ctx = this.ensure();
    this.stop(true);
    const p = this.getProject();
    this.applyMixer(p);
    this.playing = true;
    const t0 = ctx.currentTime + 0.08;
    this.segments = [{ ctxTime: t0, tick: fromTick }];
    this.cursor = fromTick;
    this.startBuffers(t0, fromTick);
    this.timer = window.setInterval(() => this.schedule(), 25);
    this.schedule();
    this.startLevels();
  }

  private startBuffers(when: number, tick: number) {
    const ctx = this.ctx!;
    const p = this.getProject();
    const sec = ticksToSeconds(tick, p.bpm);
    for (const tr of p.tracks) {
      const fz = tr.frozen ? this.frozen.get(tr.id) : undefined;
      if (fz && sec < fz.buffer.duration) {
        const src = ctx.createBufferSource(); src.buffer = fz.buffer; src.connect(this.strip(tr.id).gain);
        src.start(when, sec); this.sources.push(src);
      }
    }
    const ref = p.tracks.find((t) => t.family === 'Audio');
    if (this.refBuffer && ref) {
      const audioPos = sec - p.referenceAudio.offsetMs / 1000;
      const src = ctx.createBufferSource(); src.buffer = this.refBuffer; src.connect(this.strip(ref.id).gain);
      if (audioPos >= 0) { if (audioPos < this.refBuffer.duration) src.start(when, audioPos); }
      else src.start(when - audioPos, 0);
      this.sources.push(src);
    }
  }

  private schedule() {
    if (!this.ctx || !this.playing) return;
    const p = this.getProject();
    const ctx = this.ctx;
    const tps = (p.bpm * PPQ) / 60;
    const seg = this.segments[this.segments.length - 1];
    const horizon = ctx.currentTime + 0.15;
    const endTick = projectEndTick(p);
    const loop = this.loopRange();
    const limit = loop ? loop[1] : endTick;
    let target = seg.tick + (horizon - seg.ctxTime) * tps;
    const wrap = target >= limit;
    if (wrap) target = limit;
    if (target > this.cursor) this.scheduleRange(p, this.cursor, target, seg, tps);
    this.cursor = Math.max(this.cursor, target);
    if (wrap) {
      const at = seg.ctxTime + (limit - seg.tick) / tps;
      if (loop) {
        this.segments.push({ ctxTime: at, tick: loop[0] });
        if (this.segments.length > 8) this.segments.shift();
        this.cursor = loop[0];
        this.startBuffers(at, loop[0]);
      } else if (ctx.currentTime >= at) {
        this.stop();
        this.cursor = 0;
        this.onEnded();
      }
    }
    const now = ctx.currentTime;
    this.voices = this.voices.filter((v) => v.end > now);
  }

  private scheduleRange(p: Project, from: number, to: number, seg: Segment, tps: number) {
    const ctx = this.ctx!;
    const at = (tick: number) => seg.ctxTime + (tick - seg.tick) / tps;
    for (const tr of p.tracks) {
      if (!isInstrumentTrack(tr) || (tr.frozen && this.frozen.has(tr.id))) continue;
      const dest = this.strip(tr.id).gain;
      for (const n of tr.notes) {
        if (n.startTick >= from && n.startTick < to) {
          const when = Math.max(ctx.currentTime, at(n.startTick));
          const dur = n.durationTicks / tps;
          this.voices.push({ stop: playVoice(ctx, dest, tr, n.pitch, n.velocity, when, dur), end: when + dur + 2.5 });
        }
      }
    }
    if (this.metronomeOn()) {
      const bt = barTicks(p.timeSignature);
      const offs = beatOffsets(p.timeSignature);
      for (let b = Math.floor(from / bt) * bt; b < to; b += bt) {
        offs.forEach((o, i) => {
          const tick = b + o;
          if (tick >= from && tick < to) this.click(at(tick), i === 0);
        });
      }
    }
  }

  private click(when: number, accent: boolean) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = accent ? 1760 : 1180; o.type = 'square';
    g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(accent ? 0.35 : 0.2, when + 0.001); g.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
    o.connect(g); g.connect(this.metroGain!); o.start(when); o.stop(when + 0.06);
  }

  stop(keepCursor = false) {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.ctx) {
      const now = this.ctx.currentTime;
      for (const v of this.voices) v.stop(now);
      for (const s of this.sources) { try { s.stop(now + 0.02); } catch { /* not started */ } }
    }
    if (!keepCursor) this.cursor = this.position();
    this.voices = []; this.sources = []; this.segments = [];
    this.playing = false;
    this.stopLevels();
  }

  seek(tick: number) { this.cursor = Math.max(0, tick); if (this.playing) this.play(this.cursor); }

  /* ---------- meters ---------- */
  subscribeLevels(fn: () => void) { this.levelSubs.add(fn); return () => { this.levelSubs.delete(fn); }; }
  private startLevels() {
    cancelAnimationFrame(this.raf);
    const buf = new Float32Array(1024);
    const measure = (a: AnalyserNode): Level => {
      const d = buf.subarray(0, a.fftSize);
      a.getFloatTimeDomainData(d);
      let pk = 0, sum = 0;
      for (let i = 0; i < d.length; i++) { const x = Math.abs(d[i]); if (x > pk) pk = x; sum += x * x; }
      return { peak: pk, rms: Math.sqrt(sum / d.length) };
    };
    const tick = () => {
      for (const [id, s] of this.strips) this.levels[id] = measure(s.analyser);
      if (this.masterAnalyser) this.levels.master = measure(this.masterAnalyser);
      this.levelSubs.forEach((f) => f());
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
  private stopLevels() {
    cancelAnimationFrame(this.raf);
    for (const k of Object.keys(this.levels)) this.levels[k] = { peak: 0, rms: 0 };
    this.levelSubs.forEach((f) => f());
  }

  /* ---------- reference audio ---------- */
  async loadReference(file: ArrayBuffer): Promise<number> {
    const ctx = this.ensure();
    const buf = await ctx.decodeAudioData(file.slice(0));
    this.refBuffer = buf;
    const n = Math.min(40000, Math.ceil(buf.duration * 200));
    const peaks = new Float32Array(n);
    const ch = buf.getChannelData(0);
    const ch2 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : ch;
    const step = ch.length / n;
    for (let i = 0; i < n; i++) {
      let m = 0;
      const s = Math.floor(i * step), e = Math.min(ch.length, Math.floor((i + 1) * step));
      for (let j = s; j < e; j += 4) { const v = Math.max(Math.abs(ch[j]), Math.abs(ch2[j])); if (v > m) m = v; }
      peaks[i] = m;
    }
    this.refPeaks = peaks;
    return buf.duration;
  }
  clearReference() { this.refBuffer = null; this.refPeaks = null; }

  /* ---------- freeze (offline render; non-realtime is correct here) ---------- */
  async freeze(p: Project, track: Track, onProgress: (f: number) => void): Promise<void> {
    const sr = 44100;
    const endSec = ticksToSeconds(projectEndTick(p), p.bpm) + 3;
    const off = new OfflineAudioContext(2, Math.ceil(endSec * sr), sr);
    const tps = (p.bpm * PPQ) / 60;
    for (const n of track.notes) playVoice(off, off.destination, track, n.pitch, n.velocity, n.startTick / tps, n.durationTicks / tps);
    const steps = 10;
    for (let i = 1; i < steps; i++) {
      const t = (endSec * i) / steps;
      off.suspend(Math.round(t * 128) / 128).then(() => { onProgress(i / steps); void off.resume(); }).catch(() => undefined);
    }
    const buffer = await off.startRendering();
    this.frozen.set(track.id, { buffer, hash: freezeHash(track) });
    onProgress(1);
  }
  unfreeze(trackId: string) { this.frozen.delete(trackId); }
  clearFreezeCache() { this.frozen.clear(); }
  frozenBytes(): number { let b = 0; for (const f of this.frozen.values()) b += f.buffer.length * f.buffer.numberOfChannels * 4; return b; }
}

export const freezeHash = (t: Track) => `${t.notes.length}:${t.notes.reduce((h, n) => (h * 31 + n.pitch * 7 + n.startTick + n.durationTicks * 3 + n.velocity) % 1e9, 7)}`;

export const preview = new PreviewEngine();
