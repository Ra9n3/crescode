import type { Note } from '../../shared/schema/types';
import type { WindPart } from './profile';

/** Event counts are operations, not additive note totals (merging may join jobs). */
export interface WindTraceEvent {
  part: WindPart;
  job: string;
  stage: 'adjusted' | 'not-generated' | 'generated' | 'rejected' | 'discarded' | 'retained';
  reason: string;
  note?: Pick<Note, 'pitch' | 'startTick' | 'durationTicks'>;
}
export const windJobKey = (part: WindPart, bar: number, kind: string): string => `${part}:${bar}:${kind}`;
