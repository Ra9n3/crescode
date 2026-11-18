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
    // The Piano is the only composer left, so it carries every template that
    // rosters one. Symphony has no Piano in its roster, so 0 is correct there.
    expect(summaries.filter((s) => s.templateId !== 'ensemble.symphony').every((s) => s.pianoNotes > 0)).toBe(true);
  });
});
