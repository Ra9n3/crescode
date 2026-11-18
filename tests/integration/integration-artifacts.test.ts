/**
 * Wrapper that runs the integration artifact generator.
 *
 * The repo has no `tsx`, so artifact generators run as vitest files (the same
 * pattern Phase 1 uses). This one writes to `artifacts/integration/`.
 */
import { describe, expect, it } from 'vitest';
import { generateIntegrationArtifacts } from '../../scripts/compose-integration-artifacts';

describe('integration artifacts', () => {
  it('writes MIDI for the integrated Compose All output', () => {
    const summaries = generateIntegrationArtifacts();
    for (const s of summaries) {
      console.log(`${s.case}/${s.templateId}: merged=${s.mergedBytes}B ppq=${s.ppq} ` +
        `strings=${s.stringNotes} piano=${s.pianoNotes} keyswitches=${s.keyswitches} ` +
        `inRange=${s.allNotesInRange} files=${s.perTrackFiles}`);
    }
    expect(summaries).toHaveLength(3);
    expect(summaries.every((s) => s.allNotesInRange)).toBe(true);
    expect(summaries.every((s) => s.stringNotes > 0)).toBe(true);
  });
});
