/**
 * Stage 2A audition material: the same songs and settings rendered by the checkout this script
 * runs in. Run it once in a checkout of commit 932356f ("before") and once in the Stage 2A tree
 * ("after"):
 *
 *   STAGE2A_SIDE=before|after STAGE2A_OUT=<dir> npx vite-node scripts/piano-stage2a-audition.ts
 *
 * It writes MIDI files and, on the "after" side, an index with the role and transition decisions.
 * It makes no statement about how anything sounds.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildMergedMidi, buildPerTrackMidi } from '../src/export/midi';
import { EXPORT_PROFILES } from '../src/export/profiles';
import { isInstrumentTrack, type Project, type Track } from '../src/shared/schema';
import { PIANO_TEMPLATES, runPianoCell, type PianoCell } from '../tests/piano-variation-support';

const SIDE = process.env.STAGE2A_SIDE === 'before' ? 'before' : 'after';
const outRoot = path.join(process.env.STAGE2A_OUT ?? path.join(process.cwd(), 'evaluation', 'piano-stage2a-20261112', 'audition'), SIDE);
const PROFILE = EXPORT_PROFILES.find((entry) => entry.id === 'uvi-orchestral-suite')!.profile;
const CODE: Record<string, string> = { chamber: 'CH', sonata: 'SO', vocalbacking: 'VB', cinematic: 'CI', hybridstudio: 'HY' };
const NAME: Record<string, string> = { chamber: 'Chamber', sonata: 'Sonata', vocalbacking: 'Vocal Backing', cinematic: 'Cinematic', hybridstudio: 'Hybrid Studio' };
const FIXTURE = 'three-chorus-40bars' as const;
const BAR = 3840;
/** Two takes per template; the index names the identity of each. */
const TAKES = [0, 2] as const;

/** Bars are 1-based and inclusive. Song form: Verse 1, Chorus 5, Verse 13, Chorus 17, Bridge 25, Chorus 29, Outro 37. */
const BOUNDARIES = [
  { id: 'verse-to-chorus', from: 3, to: 6, text: 'Verse into Chorus (boundary after bar 4; the conductor marks bar 4 as a near-silence bar)' },
  { id: 'chorus-to-verse', from: 11, to: 14, text: 'Chorus into Verse (boundary after bar 12)' },
  { id: 'verse-to-chorus-2', from: 15, to: 18, text: 'Second Verse into Chorus (boundary after bar 16)' },
  { id: 'chorus-to-bridge', from: 23, to: 26, text: 'Second Chorus into the Bridge (boundary after bar 24)' },
  { id: 'bridge-to-chorus', from: 27, to: 30, text: 'Bridge into the last Chorus (boundary after bar 28)' },
] as const;
const PASSAGES: Record<string, { id: string; from: number; to: number; text: string }[]> = {
  chamber: [{ id: 'lead-passage', from: 5, to: 12, text: 'First Chorus with the written lead active' }],
  sonata: [{ id: 'lead-passage', from: 5, to: 12, text: 'First Chorus with the written lead active' }],
  cinematic: [{ id: 'tutti', from: 29, to: 36, text: 'Last Chorus, full orchestra' }],
  hybridstudio: [{ id: 'tutti', from: 29, to: 36, text: 'Last Chorus, full ensemble' }],
  vocalbacking: [
    { id: 'verse-chorus', from: 13, to: 24, text: 'Second Verse and Chorus (sung sections)' },
    { id: 'bridge', from: 25, to: 28, text: 'Bridge' },
  ],
};

function crop(tracks: readonly Track[], fromBar: number, toBar: number): Track[] {
  const start = (fromBar - 1) * BAR;
  const end = toBar * BAR;
  return tracks.map((track) => {
    if (!isInstrumentTrack(track)) return track;
    const notes = track.notes
      .filter((note) => note.startTick >= start && note.startTick < end)
      .map((note) => ({ ...note, startTick: note.startTick - start, durationTicks: Math.min(note.durationTicks, end - note.startTick) }));
    const cc = track.cc?.map((lane) => {
      const before = lane.points.filter((point) => point.tick <= start).at(-1);
      const inside = lane.points.filter((point) => point.tick > start && point.tick < end).map((point) => ({ ...point, tick: point.tick - start }));
      return { ...lane, points: [...(before ? [{ ...before, tick: 0 }] : []), ...inside] };
    });
    return { ...track, notes, ...(cc ? { cc } : {}) } as Track;
  });
}

function write(dir: string, base: string, project: Project, tracks: readonly Track[], pianoId: string): string[] {
  mkdirSync(path.join(outRoot, dir), { recursive: true });
  const out: Project = { ...project, tracks: tracks as Track[] };
  const piano = tracks.find((track) => track.id === pianoId)!;
  const names: string[] = [];
  writeFileSync(path.join(outRoot, dir, `${base}-piano.mid`), buildPerTrackMidi(out, [piano as never], PROFILE)[0].data);
  names.push(`${base}-piano.mid`);
  const audible = tracks.filter((track) => isInstrumentTrack(track) && track.notes.length > 0);
  if (audible.length > 1) {
    writeFileSync(path.join(outRoot, dir, `${base}-ensemble.mid`), buildMergedMidi(out, audible as never, PROFILE));
    names.push(`${base}-ensemble.mid`);
  }
  return names;
}

const lines: string[] = [
  '# Stage 2A audition package - decisions behind the "after" files', '',
  `Song: \`fixtures/${FIXTURE}.json\`, 40 bars, 100 bpm (one bar = 2.4 s). Seed 1, density 1.`,
  'Form: Verse 1-4, Chorus 5-12, Verse 13-16, Chorus 17-24, Bridge 25-28, Chorus 29-36, Outro 37-40.', '',
  'The `before` folder has the same file names rendered by commit 932356f; the `after` folder is Stage 2A.',
  '`-piano.mid` is the Piano track alone; `-ensemble.mid` is every sounding track.',
  '`solo` = the project contains only the Piano. `full` = the template ensemble.', '',
  'The tables below report what the composer decided and what a check of the final score found in the same bar.',
  '"Found in the final score" is a statement about written notes (count, placement, direction). The balance column compares written',
  'MIDI velocities. Neither is a statement about how the result sounds or how loud it is on a given instrument library.', '',
  'Excerpts exist for both takes (T1 and T3). Excerpt files start at their first bar, so bar 1 of the file is the first bar named.', '',
];
let files = 0;
for (const template of PIANO_TEMPLATES) {
  lines.push(`## ${NAME[template]}`, '');
  for (const take of TAKES) {
    for (const standalone of [true, false]) {
      const cell: PianoCell = { template, fixture: FIXTURE, standalone, transpose: 0, density: 1, seed: 1, take, mode: 'identity' };
      const run = runPianoCell(cell);
      if (!run.piano) throw new Error(`${template} take ${take}: no Piano`);
      const arrangement = standalone ? 'solo' : 'full';
      const base = `${CODE[template]}-T${take + 1}-${arrangement}`;
      const written = write(`full-pieces/${template}`, base, run.project, run.result.tracks, run.piano.id);
      files += written.length;
      const diagnostics = run.result.pianoDiagnostics!;
      const performance = (diagnostics as { performance?: {
        evidence: string;
        roles: { role: string; reason: string; sectionName: string; startBar: number; endBar: number;
          presentation: { note: string; balanceNote?: string | null; balance?: { note: string; difference: number; trim: number; withinTarget: boolean; final: { difference: number } } | null } }[];
        transitions: { bar: number; boundary: string; gesture: string; independentGesture: string; changedByArrangement: boolean; reason: string; fallbackFrom?: string }[];
        transitionRendering?: { bar: number; rendered: boolean; found: string }[];
      } }).performance;
      lines.push(`### ${base} - take ${take + 1}, ${arrangement}${diagnostics.identity ? `, identity "${diagnostics.identity.archetype}"` : ''}`, '',
        `Files: ${written.map((name) => `\`full-pieces/${template}/${name}\``).join(', ')}`, '');
      if (diagnostics.identity) lines.push(diagnostics.identity.description, '');
      if (performance) {
        if (!standalone) {
          lines.push('| bars | section | role | Piano minus lead, mean note velocity in the bars of the lead (final = exported track) | why |', '|---|---|---|---|---|');
          for (const role of performance.roles) {
            const balance = role.presentation.balance;
            const signed = (value: number) => `${value >= 0 ? '+' : ''}${value}`;
            const text = balance
              ? `**${signed(balance.difference)} before, ${signed(balance.final.difference)} final** (trim ${balance.trim}${balance.withinTarget ? '' : '; EXCEPTION'}). ${balance.note}`
              : role.presentation.balanceNote ?? (role.role === 'supporting' ? 'no written lead in this phrase' : 'not applied (not a supporting phrase)');
            lines.push(`| ${role.startBar}-${role.endBar} | ${role.sectionName} | ${role.role} | ${text} | ${role.reason} |`);
          }
          lines.push('');
        } else {
          lines.push(`Orchestral evidence: ${performance.evidence}. Every phrase is featured; the adapted pass is the independent composition.`, '');
        }
        lines.push('| last bar | boundary | decision | found in the final score | why |', '|---|---|---|---|---|');
        for (const decision of performance.transitions) {
          const rendering = performance.transitionRendering?.find((entry) => entry.bar === decision.bar);
          const first = decision.fallbackFrom ? ` (first selected: ${decision.fallbackFrom})` : decision.changedByArrangement ? ` (independent: ${decision.independentGesture})` : '';
          lines.push(`| ${decision.bar} | ${decision.boundary} | ${decision.gesture}${first} | ${rendering ? `${rendering.rendered ? 'matches' : 'DOES NOT MATCH'}: ${rendering.found}` : '-'} | ${decision.reason} |`);
        }
        lines.push('');
      }
      for (const excerpt of [...BOUNDARIES, ...(standalone ? [] : PASSAGES[template])]) {
        const dir = BOUNDARIES.some((entry) => entry.id === excerpt.id) ? `boundaries/${excerpt.id}` : `passages/${template}`;
        const names = write(dir, `${base}-${excerpt.id}-bars${excerpt.from}-${excerpt.to}`, run.project, crop(run.result.tracks, excerpt.from, excerpt.to), run.piano.id);
        files += names.length;
        lines.push(`- Excerpt, bars ${excerpt.from}-${excerpt.to}: ${excerpt.text}. ${names.map((name) => `\`${dir}/${name}\``).join(', ')}`);
      }
      lines.push('');
    }
  }
}
if (SIDE === 'after') writeFileSync(path.join(outRoot, '..', 'AUDITION-INDEX.md'), `${lines.join('\n')}\n`);
console.log(`${SIDE}: ${files} MIDI files -> ${outRoot}`);
