/**
 * Stage 2 audition package: several successive Compose All takes per template
 * with the identity composer, the Classic composer's first take for
 * comparison, and a plain-language description of every piece.
 *
 *   npx vite-node scripts/piano-identity-audition.ts
 *
 * Writes evaluation/piano-composition-identity-20261112/audition/. Uses the
 * application defaults (seed 1, density 1) and the production export path.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildMergedMidi, buildPerTrackMidi } from '../src/export/midi';
import { EXPORT_PROFILES } from '../src/export/profiles';
import { isInstrumentTrack, type Project } from '../src/shared/schema';
import { PIANO_TEMPLATES, runPianoCell, type PianoCell } from '../tests/piano-variation-support';

const here = path.dirname(fileURLToPath(import.meta.url));
const outRoot = path.join(here, '..', 'evaluation', 'piano-composition-identity-20261112', 'audition');
const PROFILE = EXPORT_PROFILES.find((entry) => entry.id === 'uvi-orchestral-suite')!.profile;
const CODE: Record<string, string> = { chamber: 'CH', sonata: 'SO', vocalbacking: 'VB', cinematic: 'CI', hybridstudio: 'HY' };
const NAME: Record<string, string> = { chamber: 'Chamber', sonata: 'Sonata', vocalbacking: 'Vocal Backing', cinematic: 'Cinematic', hybridstudio: 'Hybrid Studio' };
const FIXTURE = 'three-chorus-40bars' as const;
const TAKES = [0, 1, 2, 3] as const;
const pct = (value: number): string => `${Math.round(value * 100)}%`;

mkdirSync(outRoot, { recursive: true });
const lines: string[] = [
  '# Piano Composition Identity - audition package (Stage 2)', '',
  `Song: \`fixtures/${FIXTURE}.json\` (40 bars). Settings: the application defaults, seed 1 and density 1. "Take 1" is the first press of Compose All, "Take 2" the second, and so on.`, '',
  'For every take there are two files: `-piano.mid` is the Piano part alone as written into the full arrangement, `-full.mid` is the whole ensemble.',
  'The `CLASSIC` files are the previous composer on take 1 of the same song, for comparison.', '',
  'What to listen for: each take should be a different piece - its own theme, rhythm, left-hand figure and shape - while staying inside the character of its template.',
  'The "kept after adaptation" figures say how much of the theme survived once the Piano made room for the other instruments (exact / changed but recognisable / lost).', '',
];
let files = 0;
for (const template of PIANO_TEMPLATES) {
  lines.push(`## ${NAME[template]}`, '');
  const cells: { label: string; cell: PianoCell }[] = [
    ...TAKES.map((take) => ({ label: `T${take + 1}`, cell: { template, fixture: FIXTURE, standalone: false, transpose: 0, density: 1, seed: 1, take, mode: 'identity' as const } })),
    { label: 'CLASSIC', cell: { template, fixture: FIXTURE, standalone: false, transpose: 0, density: 1, seed: 1, take: 0, mode: 'classic' as const } },
  ];
  for (const { label, cell } of cells) {
    const run = runPianoCell(cell);
    if (!run.piano) throw new Error(`${template} ${label}: no Piano`);
    const out: Project = { ...run.project, tracks: run.result.tracks };
    const base = `${CODE[template]}-${label}`;
    const pianoOnly = buildPerTrackMidi(out, [run.piano], PROFILE);
    writeFileSync(path.join(outRoot, `${base}-piano.mid`), pianoOnly[0].data);
    const audible = run.result.tracks.filter((track) => isInstrumentTrack(track) && track.notes.length > 0);
    writeFileSync(path.join(outRoot, `${base}-full.mid`), buildMergedMidi(out, audible, PROFILE));
    files += 2;
    const diagnostics = run.result.pianoDiagnostics!;
    const survival = run.survival!;
    const kept = `Kept after adaptation: theme ${pct(survival.themeExact)} exact / ${pct(survival.themeTransformed)} changed / ${pct(survival.themeLost)} lost; all notes ${pct(survival.events)}.`;
    if (diagnostics.identity) {
      const identity = diagnostics.identity;
      lines.push(`### ${base} - take ${cell.take + 1}: ${identity.archetype[0].toUpperCase()}${identity.archetype.slice(1)}`, '',
        identity.description, '',
        `Protected when making room for others: ${identity.protectedTraits.map((trait) => ({ 'theme-head': 'the opening of the theme', 'rhythm-cell': 'the rhythm of the theme', 'bass-motion': 'the bass line' }[trait])).join(', ')}.`,
        `${kept} ${run.piano.notes.length} notes; playability violations: ${run.result.pianoPlayability.violations.length}.`,
        `Files: \`${base}-piano.mid\`, \`${base}-full.mid\``, '');
    } else {
      lines.push(`### ${base} - previous composer, take 1`, '',
        'The Classic composer: one fixed way of building and developing the theme per template.', '',
        `${kept} ${run.piano.notes.length} notes.`, `Files: \`${base}-piano.mid\`, \`${base}-full.mid\``, '');
    }
  }
}
writeFileSync(path.join(outRoot, 'AUDITION-INDEX.md'), `${lines.join('\n')}\n`);
console.log(`${files} MIDI files -> ${outRoot}`);
