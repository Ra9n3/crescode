/**
 * Client for the scorch-engine WebSocket protocol (docs/PROTOCOL.md).
 * Connects to 127.0.0.1 only. Version handshake, heartbeat, auto-reconnect.
 * When the engine is not running, the app keeps working with the built-in
 * preview sound (graceful degradation).
 */
import { useStore, type PluginInfo } from '../store/store';
import { isInstrumentTrack, type Project } from '../shared/schema/types';

export const PROTOCOL_VERSION = 1;

type Msg = { type: string; id: string; [k: string]: unknown };

/** Strips ".vst3", "64-bit", "(x64)" and similar suffixes from plugin names. */
export function cleanPluginName(raw: string): string {
  return raw
    .replace(/\.vst3$/i, '')
    .replace(/[\s_-]*(\(|\[)?\s*(x64|x86_64|64[\s-]?bit|32[\s-]?bit|vst3?)\s*(\)|\])?$/gi, '')
    .replace(/[\s_-]*(\(|\[)?\s*(x64|x86_64|64[\s-]?bit|vst3?)\s*(\)|\])?$/gi, '')
    .trim();
}

class EngineClient {
  private ws: WebSocket | null = null;
  private seq = 0;
  private hb: number | null = null;
  private retry: number | null = null;
  private backoff = 500;
  private lastPong = 0;
  private wanted = false;
  private pending = new Map<string, (m: Msg) => void>();

  get connected() { return !!this.ws && this.ws.readyState === WebSocket.OPEN && useStore.getState().engineConnected; }

  start() {
    this.wanted = true;
    this.open();
  }
  stopClient() {
    this.wanted = false;
    if (this.retry) clearTimeout(this.retry);
    if (this.hb) clearInterval(this.hb);
    this.ws?.close();
    this.ws = null;
    useStore.getState().set({ engineConnected: false });
  }

  private open() {
    if (!this.wanted) return;
    const port = useStore.getState().settings.enginePort;
    let ws: WebSocket;
    try { ws = new WebSocket(`ws://127.0.0.1:${port}`); } catch { this.scheduleReconnect(); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.backoff = 500;
      this.send({ type: 'engine/hello', protocolVersion: PROTOCOL_VERSION, client: 'scorch-ui' });
    };
    ws.onmessage = (ev) => {
      let m: Msg;
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      this.handle(m);
    };
    ws.onclose = () => {
      const wasConnected = useStore.getState().engineConnected;
      useStore.getState().set({ engineConnected: false });
      if (wasConnected) useStore.getState().toast('warn', 'Engine disconnected — using preview sound. Reconnecting…');
      if (this.hb) clearInterval(this.hb);
      this.scheduleReconnect();
    };
    ws.onerror = () => undefined;
  }

  private scheduleReconnect() {
    if (!this.wanted) return;
    if (this.retry) clearTimeout(this.retry);
    this.retry = window.setTimeout(() => this.open(), this.backoff);
    this.backoff = Math.min(8000, this.backoff * 2);
  }

  send(body: Omit<Msg, 'id'> & { id?: string }, onReply?: (m: Msg) => void): string | null {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return null;
    const id = body.id ?? `ui-${++this.seq}`;
    if (onReply) this.pending.set(id, onReply);
    this.ws.send(JSON.stringify({ ...body, id }));
    return id;
  }

  private handle(m: Msg) {
    const st = useStore.getState();
    const reply = this.pending.get(m.id);
    if (reply) { this.pending.delete(m.id); reply(m); }
    switch (m.type) {
      case 'engine/hello': {
        if (m.protocolVersion !== PROTOCOL_VERSION) { st.toast('error', `Engine protocol v${m.protocolVersion} does not match UI v${PROTOCOL_VERSION}`); this.ws?.close(); return; }
        st.set({ engineConnected: true });
        st.toast('success', 'Audio engine connected');
        this.lastPong = Date.now();
        this.hb = window.setInterval(() => {
          if (Date.now() - this.lastPong > 6000) { this.ws?.close(); return; }
          this.send({ type: 'engine/ping' });
        }, 2000);
        this.syncAll(st.project);
        break;
      }
      case 'engine/pong': this.lastPong = Date.now(); break;
      case 'scan/progress': st.set({ vstState: 'scanning', scanProgress: { loaded: Number(m.loaded), total: Number(m.total) } }); break;
      case 'scan/result': {
        const plugins = ((m.plugins as PluginInfo[]) ?? []).map((p) => ({ ...p, name: cleanPluginName(p.name) }));
        st.set({ plugins, failedPlugins: (m.failed as string[]) ?? [], vstState: plugins.length ? 'loaded' : 'empty' });
        break;
      }
      case 'plugin/loaded': {
        const gid = String(m.groupId);
        st.set({ pluginLoading: { ...st.pluginLoading, [gid]: m.ok ? undefined : 'error' } });
        if (!m.ok) st.toast('error', `Plugin failed to load: ${m.error ?? 'unknown error'} — using preview sound`);
        break;
      }
      case 'plugin/state': st.updateGroup(String(m.groupId), { pluginState: String(m.state) }); break;
      case 'engine/error': st.toast('error', String(m.message)); break;
    }
  }

  scan(directory: string): boolean {
    return !!this.send({ type: 'scan/start', directory });
  }
  loadPlugin(groupId: string, pluginId: string, state: string | null) {
    useStore.getState().set({ pluginLoading: { ...useStore.getState().pluginLoading, [groupId]: 'loading' } });
    return !!this.send({ type: 'plugin/load', groupId, pluginId, state });
  }
  openEditor(groupId: string) { return !!this.send({ type: 'plugin/openEditor', groupId }); }

  /** Pushes the sequence and mixer state for engine-hosted playback. */
  syncAll(p: Project) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const groups = p.libraryGroups.map((g) => ({
      groupId: g.id,
      channels: p.tracks.filter((t) => t.libraryGroupId === g.id && isInstrumentTrack(t)).map((t) => ({ channel: t.midiChannel, trackId: t.id, notes: t.notes })),
    }));
    this.send({ type: 'midi/setSequence', ppq: 960, bpm: p.bpm, timeSignature: p.timeSignature, groups });
    this.send({
      type: 'mixer/setState', masterVolume: p.masterVolume,
      tracks: p.tracks.map((t) => ({ trackId: t.id, groupId: t.libraryGroupId, channel: t.midiChannel, volume: t.volume, pan: t.pan, mute: t.muted, solo: t.soloed })),
    });
  }
}

export const engine = new EngineClient();
