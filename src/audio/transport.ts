import { preview } from './preview';
import { useStore } from '../store/store';
import { barTicks, projectEndTick } from '../shared/schema/meter';
import { beginPlay, clampSeekTick, parkPause, parkStop, secondStop } from '../engine/transport/model';
import { engine } from '../engineClient/client';

let bound = false;
export function bindTransport() {
  if (bound) return;
  bound = true;
  preview.bind({
    getProject: () => useStore.getState().project,
    loopRange: () => (useStore.getState().loop ? loopRange() : null),
    metronome: () => useStore.getState().metronome,
    mode: () => useStore.getState().previewMode,
    // Project end (spec §11): stop, park the playhead at the end — visible,
    // never scrolling into empty space.
    onEnded: () => {
      const end = Math.round(preview.position());
      useStore.getState().set({ playing: false, paused: false, startTick: end, stoppedPosition: end });
    },
  });
  let prev = useStore.getState().project;
  let prevBpm = prev.bpm;
  useStore.subscribe((s) => {
    if (s.project !== prev) {
      prev = s.project;
      // Tempo edited while the playhead is moving: re-anchor the engine so
      // the playhead stays continuous and notes keep their musical positions
      // (spec §17). A v1 tempo change is a single new BPM for the project.
      if (s.playing && s.project.bpm !== prevBpm) preview.rebase(s.project.bpm);
      prevBpm = s.project.bpm;
      preview.applyMixer(s.project);
      engine.syncAll(s.project);
    } else if (s.playing && s.project.bpm !== prevBpm) {
      prevBpm = s.project.bpm;
      preview.rebase(s.project.bpm);
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
  const dec = beginPlay({
    playing: s.playing, paused: s.paused, startTick: s.startTick,
    lastPlaybackStartPosition: s.lastPlaybackStartPosition, stoppedPosition: s.stoppedPosition,
  });
  const region = s.loop ? loopRange() : null;
  preview.play(dec.fromTick);
  engine.send({ type: 'transport/play', tick: dec.fromTick });
  // Starting playback re-engages following (spec §5), and exposes the active
  // loop region for the UI (spec §1: activeLoopRegion).
  s.set({
    playing: true, paused: false,
    lastPlaybackStartPosition: dec.lastPlaybackStartPosition,
    followSuspended: false, followSuspensionReason: null, rollFollowSuspended: false,
    loopRange: region,
  });
}

/** Pause freezes the playhead at its exact current position; Play resumes there. */
export function pause() {
  const s = useStore.getState();
  if (!s.playing) return;
  const pos = preview.position();
  preview.stop();
  engine.send({ type: 'transport/stop' });
  const dec = parkPause(pos);
  s.set({ ...dec });
}

export function stop() {
  const s = useStore.getState();
  const snap = { playing: s.playing, paused: s.paused, startTick: s.startTick, lastPlaybackStartPosition: s.lastPlaybackStartPosition, stoppedPosition: s.stoppedPosition };
  const prefs = { returnToStartOnStop: s.settings.stopReturnsToStart, secondStopReturnsToStart: s.settings.secondStopReturnsToStart };
  if (s.playing || s.paused) {
    const live = s.playing ? preview.position() : null;
    preview.stop();
    engine.send({ type: 'transport/stop' });
    // Default: park where it stopped (no automatic return). The preference
    // "Return to start position on stop" opts into going back (spec §3).
    s.set({ ...parkStop(snap, live, prefs) });
  } else {
    const again = secondStop(snap, prefs);
    if (again !== null) seek(again);
    // Otherwise a repeated Stop has no additional effect (spec §3).
  }
}

export function togglePlay() { if (useStore.getState().playing) stop(); else play(); }
export function rewind() { seek(0); }

/**
 * Relocate the playhead. While playing, the click-during-playback rule keeps
 * playback running from the new position and re-bases the "last start" there
 * (spec §8). Ticks clamp to the project end — no parking in empty space.
 */
export function seek(tick: number) {
  const s = useStore.getState();
  const t = clampSeekTick(tick, projectEndTick(s.project));
  const patch: Record<string, unknown> = { startTick: t, paused: false };
  if (s.playing) patch.lastPlaybackStartPosition = t; // clicking while playing re-bases the start (spec §8.3)
  s.set(patch as never);
  preview.seek(t);
  engine.send({ type: 'transport/seek', tick: t });
}

export function currentTick(): number {
  const s = useStore.getState();
  return s.playing ? preview.position() : s.startTick;
}

/* ---- Follow (auto-scroll) suspension ---- */

export function suspendFollow(reason: 'manual-scroll' | 'edit' | 'scrub') {
  const s = useStore.getState();
  if (s.settings.autoScrollMode === 'off') return; // nothing to suspend
  if (s.followSuspended && s.followSuspensionReason === reason) return;
  s.set({ followSuspended: true, followSuspensionReason: reason });
}

export function resumeFollow() {
  const s = useStore.getState();
  if (!s.followSuspended && s.followSuspensionReason === null) return;
  s.set({ followSuspended: false, followSuspensionReason: null });
}

/** Re-follow controllers, registered by each timeline editor (arranger, piano roll). */
type FollowController = (() => void) | null;
const followControllers: { arranger: FollowController; pianoRoll: FollowController } = { arranger: null, pianoRoll: null };
export function registerFollowController(editor: 'arranger' | 'pianoRoll', fn: FollowController) { followControllers[editor] = fn; }

/**
 * Re-follow button / keyboard shortcut (spec §5, §13): resumes following in
 * the focused editor and snaps its view back to the playhead.
 */
export function refollowPlayhead() {
  const s = useStore.getState();
  const editor = s.activeEditor === 'pianoRoll' && s.pianoRollTrackId ? 'pianoRoll' : 'arranger';
  if (editor === 'pianoRoll') s.set({ rollFollowSuspended: false });
  else resumeFollow();
  followControllers[editor]?.();
}
