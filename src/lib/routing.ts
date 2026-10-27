import { useStore } from '../store/store';
import { preview } from '../audio/preview';
import { engine, cleanPluginName } from '../engineClient/client';
import type { Project, Track } from '../shared/schema/types';

export interface RoutingInfo { groupName: string | null; pluginName: string | null; preview: boolean; loading: boolean; error: boolean }

/** What the track actually plays through. Without a hosted plugin it is the built-in preview sound. */
export function routingInfo(p: Project, t: Track): RoutingInfo {
  const s = useStore.getState();
  const g = t.libraryGroupId ? p.libraryGroups.find((x) => x.id === t.libraryGroupId) : undefined;
  const plugin = g?.pluginId ? s.plugins.find((x) => x.id === g.pluginId)?.name ?? cleanPluginName(g.pluginId.split(/[\\/]/).pop() ?? g.pluginId) : null;
  const state = g ? s.pluginLoading[g.id] : undefined;
  const hosted = !!(g?.pluginId && s.engineConnected && state !== 'error');
  return { groupName: g?.name ?? null, pluginName: plugin, preview: !hosted, loading: state === 'loading', error: state === 'error' };
}

/** A group's instance is loaded when it has at least one unfrozen track. */
export function groupLoaded(p: Project, groupId: string): boolean {
  const members = p.tracks.filter((t) => t.libraryGroupId === groupId);
  return members.length > 0 && members.some((t) => !t.frozen);
}

export function loadedInstanceCount(p: Project): number {
  const groups = p.libraryGroups.filter((g) => groupLoaded(p, g.id)).length;
  const ungrouped = p.tracks.some((t) => t.family !== 'Structure' && t.family !== 'Audio' && !t.libraryGroupId && !t.frozen) ? 1 : 0;
  return groups + ungrouped;
}

export async function freezeTrack(trackId: string) {
  const s = useStore.getState();
  const t = s.project.tracks.find((x) => x.id === trackId);
  if (!t || t.frozen || s.freezeProgress[trackId] !== undefined) return;
  s.set({ freezeProgress: { ...s.freezeProgress, [trackId]: 0 } });
  engine.send({ type: 'track/freeze', trackId, groupId: t.libraryGroupId });
  try {
    await preview.freeze(s.project, t, (f) => useStore.getState().set({ freezeProgress: { ...useStore.getState().freezeProgress, [trackId]: f } }));
    useStore.getState().updateTrack(trackId, { frozen: true });
  } catch (e) {
    useStore.getState().toast('error', `Freeze failed for ${t.name}: ${(e as Error).message}`);
  } finally {
    const fp = { ...useStore.getState().freezeProgress };
    delete fp[trackId];
    useStore.getState().set({ freezeProgress: fp });
  }
}

export function unfreezeTrack(trackId: string) {
  preview.unfreeze(trackId);
  const t = useStore.getState().project.tracks.find((x) => x.id === trackId);
  engine.send({ type: 'track/unfreeze', trackId, groupId: t?.libraryGroupId ?? null });
  useStore.getState().updateTrack(trackId, { frozen: false });
}

export function toggleFreeze(trackId: string) {
  const t = useStore.getState().project.tracks.find((x) => x.id === trackId);
  if (!t) return;
  if (t.frozen) unfreezeTrack(trackId); else void freezeTrack(trackId);
}

/** Frozen audio is session-only; tracks marked frozen without a buffer are re-rendered on demand. */
export async function restoreFrozenBuffers() {
  for (const t of useStore.getState().project.tracks) {
    if (t.frozen && !preview.frozen.has(t.id)) {
      useStore.getState().set({ freezeProgress: { ...useStore.getState().freezeProgress, [t.id]: 0 } });
      await preview.freeze(useStore.getState().project, t, () => undefined);
      const fp = { ...useStore.getState().freezeProgress }; delete fp[t.id];
      useStore.getState().set({ freezeProgress: fp });
    }
  }
}
