/** Optional observer used by the actual MIDI builders, never a second exporter.
 * Profile evidence is attached by object identity, so keyswitches cannot be
 * confused with sounding notes merely because they share a pitch or velocity.
 */
import { hashString } from '../engine/generate';
import type { Note, Track } from '../shared/schema/types';
import type { ExportChunk, FoldStats } from './profile';
export interface WindExportObservation {
  readonly trackId: string;
  readonly role: string;
  readonly scope: 'merged' | 'per-track';
  readonly retainedFingerprint: string;
  readonly retainedNotes: number;
  readonly serializedSoundingNotes: number;
  readonly serializedKeyswitches: number;
  readonly soundingEvents: readonly Pick<Note, 'pitch' | 'startTick' | 'durationTicks'>[];
  readonly folded: number;
  readonly dropped: number;
  readonly omittedChunks: number;
  readonly articulationFallbacks: Readonly<Record<string, number>>;
  readonly unresolvedArticulations: number;
  readonly state: 'exported' | 'silent' | 'keyswitch-only' | 'omitted-or-lost';
  readonly reason: string;
}
export interface WindChunkEvidence {
  readonly keyswitches: readonly Note[];
  readonly articulationFallbacks: Readonly<Record<string, number>>;
  readonly unresolvedArticulations: number;
}
export const windChunkEvidence = new WeakMap<ExportChunk, WindChunkEvidence>();
const hash = (value: unknown): string => hashString(JSON.stringify(value)).toString(16).padStart(8, '0');
export function observeWindExport(track: Track, chunks: readonly ExportChunk[], scope: WindExportObservation['scope'], endTick: number,
  folded: number, dropped: number, stats: FoldStats | undefined, unmapped: boolean): void {
  if (!stats?.winds || !['flutes', 'oboes', 'clarinets', 'bassoons'].includes(track.role)) return;
  let sounding = 0, keyswitches = 0, omittedChunks = 0, unresolvedArticulations = 0;
  const articulationFallbacks: Record<string, number> = {};
  const soundingEvents: Pick<Note, 'pitch' | 'startTick' | 'durationTicks'>[] = [];
  for (const c of chunks) {
    if (scope === 'merged' && c.fileOnly) { omittedChunks++; continue; }
    const evidence = windChunkEvidence.get(c);
    unresolvedArticulations += evidence?.unresolvedArticulations ?? 0;
    for (const [art, count] of Object.entries(evidence?.articulationFallbacks ?? {})) articulationFallbacks[art] = (articulationFallbacks[art] ?? 0) + count;
    const ks = new Set(evidence?.keyswitches ?? []);
    for (const n of c.notes) {
      // Identical clipping rule to noteEvents. Observations are published only
      // after writeMidi completes successfully; parsing is tested separately.
      if (Math.min(endTick, Math.round(n.startTick + n.durationTicks)) <= Math.max(0, Math.round(n.startTick))) continue;
      if (ks.has(n)) keyswitches++; else {
        sounding++; soundingEvents.push({ pitch: n.pitch, startTick: Math.max(0, Math.round(n.startTick)), durationTicks: Math.min(endTick, Math.round(n.startTick + n.durationTicks)) - Math.max(0, Math.round(n.startTick)) });
      }
    }
  }
  stats.winds.push({ trackId: track.id, role: track.role, scope, retainedFingerprint: hash(track.notes), retainedNotes: track.notes.length,
    serializedSoundingNotes: sounding, serializedKeyswitches: keyswitches, soundingEvents, folded, dropped, omittedChunks,
    articulationFallbacks, unresolvedArticulations,
    state: sounding ? 'exported' : keyswitches ? 'keyswitch-only' : track.notes.length ? 'omitted-or-lost' : 'silent',
    reason: unmapped ? 'profile deliberately unmapped role' : omittedChunks ? 'fileOnly chunks omitted from merged MIDI' : dropped ? 'profile fold guard dropped notes' : !sounding && track.notes.length ? 'no sounding events survived profile/chunk/time boundaries' : sounding ? 'sounding note-ons serialized; not a musical-substance verdict' : 'no retained sounding notes' });
}
