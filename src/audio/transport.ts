import { preview } from './preview';
import { useStore } from '../store/store';
import { barTicks, projectEndTick } from '../shared/schema/meter';
import { engine } from '../engineClient/client';

let bound = false;
export function bindTransport() {
  if (bound) return;
  bound = true;
  preview.bind({
    getProject: () => useStore.getState().project,
    loopRange: () => (useStore.getState().loop ? loopRange() : null),
    metronome: () => useStore.getState().metronome,
    onEnded: () => useStore.getState().set({ playing: false, startTick: 0 }),
  });
  let prev = useStore.getState().project;
  useStore.subscribe((s) => {
    if (s.project !== prev) {
      prev = s.project;
      preview.applyMixer(s.project);
      engine.syncAll(s.project);
    }
  });
}

/** Loop the selected section, otherwise the whole project. */
export function loopRange(): [number, number] {
  const s = useStore.getState();
  const p = s.project;
  const sec = p.sections.find((x) => x.id === s.selectedSectionId);
  const bt = barTicks(p.timeSignature);
  if (sec) return [(sec.startBar - 1) * bt, (sec.startBar - 1 + sec.lengthBars) * bt];
  return [0, projectEndTick(p)];
}

export function play() {
  const s = useStore.getState();
  if (s.playing) return;
  preview.play(s.startTick);
  engine.send({ type: 'transport/play', tick: s.startTick });
  s.set({ playing: true });
}
export function stop() {
  const s = useStore.getState();
  if (!s.playing) { s.set({ startTick: 0 }); preview.seek(0); engine.send({ type: 'transport/seek', tick: 0 }); return; }
  preview.stop();
  engine.send({ type: 'transport/stop' });
  s.set({ playing: false, startTick: Math.round(preview.position()) });
}
export function togglePlay() { if (useStore.getState().playing) stop(); else play(); }
export function rewind() { seek(0); }
export function seek(tick: number) {
  const t = Math.max(0, Math.round(tick));
  useStore.getState().set({ startTick: t });
  preview.seek(t);
  engine.send({ type: 'transport/seek', tick: t });
}
export function currentTick(): number {
  return useStore.getState().playing ? preview.position() : useStore.getState().startTick;
}
