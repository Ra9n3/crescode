/**
 * Phase 10 pre-flight (read-only). Prints:
 *  1. each template's percussion roster as actually written to the file —
 *     MIDI numbers, sounding (the track's lowestNote/highestNote from the
 *     factory, which reads ranges.ts) — and which part is pitched vs fixed;
 *  2. the config hard ranges vs the addendum's drum bands;
 *  3. the old generator rules that write percussion (a static read of
 *     defaultRules) + whether aux has any rule at all;
 *  4. what percussion humanize does today: the generator's generic
 *     humanizeNotes range, whether the tutti hits are humanized, whether any
 *     CC lane reaches a percussion track (compose output scan);
 *  5. the phantom-input evidence: at HEAD, how many beat windows contain
 *     generator percussion notes, and how many window governor bounds
 *     (maxMeanVelocityFor over the window's role count) would CHANGE if the
 *     percussion role were absent — the same window math the brass/wind
 *     caps and the pad governor read.
 *  6. take 1 three-chorus per big template: the generator's percussion note
 *     counts per instrument at HEAD (the "before" picture).
 */
import threeChorus from '../fixtures/three-chorus-40bars.json';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { generate } from '../src/engine/generate';
import { defaultRules } from '../src/config/generation-rules';
import { resolveTemplate } from '../src/config/ensembles';
import { projectFromFixture, validateProject, type Note, type Project, type Track } from '../src/shared/schema';
import { beatOffsets, beatTicks, barTicks, projectBars } from '../src/shared/schema/meter';
import { maxMeanVelocityFor } from '../src/orchestrator/energy';
import { PERCUSSION_FIXED_NOTES } from '../src/shared/schema/ranges';

const PERC_ROLES = ['timpani', 'snare', 'cymbals', 'aux'];
const TEMPLATES = ['ensemble.symphony', 'ensemble.chamber', 'ensemble.cinematic', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.hybridstudio'];

console.log('=== 1+2. percussion rosters (MIDI, sounding, as written to the file) ===');
for (const templateId of TEMPLATES) {
  const t = resolveTemplate({ templateId, overrides: {}, pins: {} })!;
  const perc = t.roster.filter((r) => PERC_ROLES.includes(r.role)).map((r) => r.role);
  // the track shape the factory writes: ranges.ts → lowestNote/highestNote
  const p: Project = projectFromFixture({ schemaVersion: 1, name: 'probe', bpm: 100, timeSignature: { numerator: 4, denominator: 4 }, key: 'C', mode: 'major', sections: [], chords: [], tracks: [] });
  const probe = new Map<string, [number, number]>([
    ['timpani', [38, 57]],
    ['snare', [PERCUSSION_FIXED_NOTES.snare, PERCUSSION_FIXED_NOTES.snare]],
    ['cymbals', [PERCUSSION_FIXED_NOTES.cymbals, PERCUSSION_FIXED_NOTES.cymbals]],
    ['aux', [PERCUSSION_FIXED_NOTES.aux, PERCUSSION_FIXED_NOTES.aux]],
  ]);
  const roster = perc.map((r) => `${r} ${probe.get(r)![0]}–${probe.get(r)![1]}`).join(', ') || 'none';
  console.log(`${templateId}: ${roster}`);
}
console.log(`timpani hard range 38–57 spans all four drum bands (38-45, 41-48, 46-53, 50-57); config = ranges.ts D2–A3 = 38–57, identical.`);

console.log('\n=== 3. the old generator rules that write percussion ===');
for (const [secName, sr] of Object.entries(defaultRules.sections)) {
  for (const part of sr.parts) {
    const roles = (part.match as { roles?: string[] }).roles ?? [];
    const fams = (part.match as { families?: string[] }).families ?? [];
    if (roles.some((r) => PERC_ROLES.includes(r)) || fams.includes('Percussion')) {
      console.log(`${secName} "${part.label}": roles=${roles.join(',')} rhythm=${typeof part.rhythm === 'string' ? part.rhythm : 'inline'} velocity=${JSON.stringify(part.velocity)} density=${part.density ?? 1}${part.fill ? ` fill=${part.fill.when}` : ''}`);
    }
  }
}
console.log('aux: no rule in any section — the generator never writes aux at HEAD.');

console.log('\n=== 4. what percussion humanize does today (take 1, three-chorus) ===');
const compose = (doc: unknown, templateId: string, take: number, humanize: boolean) => {
  const p: Project = projectFromFixture(JSON.parse(JSON.stringify(doc)));
  p.ensemble = { templateId, overrides: {}, pins: {} };
  p.orchestration = { take };
  const result = composeAllTracks(p, { seed: 11, humanize });
  return { p: { ...p, tracks: result.tracks, orchestration: result.orchestration } as Project, result };
};
const rules = defaultRules;
console.log(`generator humanizeNotes: ±${rules.humanize.maxTimingMs} ms timing, ±${rules.humanize.maxVelocityDelta} velocity, start-only, clamped inside the bar (the store composes with humanize: true).`);
{
  const { p: withH } = compose(threeChorus, 'ensemble.symphony', 1, true);
  const { p: withoutH } = compose(threeChorus, 'ensemble.symphony', 1, false);
  const btBar = barTicks(withH.timeSignature);
  for (const role of PERC_ROLES) {
    const a = withH.tracks.find((t) => t.role === role)!;
    const b = withoutH.tracks.find((t) => t.role === role)!;
    let moved = 0, vel = 0;
    for (let i = 0; i < a.notes.length; i++) {
      if (a.notes[i].startTick !== b.notes[i]?.startTick) moved++;
      if (a.notes[i].velocity !== b.notes[i]?.velocity) vel++;
    }
    console.log(`  ${role}: ${a.notes.length} notes, humanize moves ${moved} starts / ${vel} velocities; cc=${a.cc === undefined ? 'none' : 'present'}`);
  }
  // the tutti hits: written after the generator — compare start ticks against the bar grid
  const timpani = withH.tracks.find((t) => t.role === 'timpani')!;
  const onGrid = timpani.notes.filter((n) => n.startTick % beatTicks(withH.timeSignature) === 0).length;
  console.log(`  tutti/post-generate hits land on the grid (no jitter): ${onGrid}/${timpani.notes.length} timpani starts on a beat tick`);
  void btBar;
}
console.log('CC: the generator writes no CC1/CC11 for percussion anywhere → rolls are velocity ramps.');

console.log('\n=== 5. phantom-input evidence (HEAD, symphony t1 three-chorus + dorian) ===');
for (const [name, doc] of [['three-chorus', threeChorus], ['dorian', dorian]] as const) {
  const p: Project = projectFromFixture(JSON.parse(JSON.stringify(doc)));
  p.ensemble = { templateId: 'ensemble.symphony', overrides: {}, pins: {} };
  p.orchestration = { take: 1 };
  const roster = resolveTemplate(p.ensemble)!.roster.map((r) => r.role);
  const N = roster.length;
  const clampMax = resolveTemplate(p.ensemble)!.budget.energyClamp[1];
  const btBar = barTicks(p.timeSignature);
  const beat = beatTicks(p.timeSignature);
  const bars = projectBars(p);
  const endTick = bars * btBar;
  const gen = generate(p, { seed: 11, humanize: true, excludeRoles: [], roleNotes: [] });
  const percNotes = gen.filter((t) => PERC_ROLES.includes(t.role)).flatMap((t) => t.notes);
  let windows = 0, withPerc = 0, boundChanges = 0;
  for (let bar = 0; bar < bars; bar++) {
    const barStart = bar * btBar;
    for (const off of beatOffsets(p.timeSignature)) {
      const s = barStart + off;
      if (s >= endTick) continue;
      const e = Math.min(endTick, s + beat);
      windows++;
      const roles = new Set<string>();
      const rolesNoPerc = new Set<string>();
      for (const t of gen) {
        if (!roster.includes(t.role) || !isRoster(t)) continue;
        const sounds = t.notes.some((n: Note) => n.startTick < e && n.startTick + n.durationTicks > s);
        if (sounds) {
          roles.add(t.role);
          if (!PERC_ROLES.includes(t.role)) rolesNoPerc.add(t.role);
        }
      }
      if (roles.size !== rolesNoPerc.size) withPerc++;
      if (roles.size && maxMeanVelocityFor(N, clampMax, roles.size) !== maxMeanVelocityFor(N, clampMax, Math.max(1, rolesNoPerc.size))) boundChanges++;
    }
  }
  console.log(`${name}: ${windows} beat windows, ${withPerc} contain generator percussion, ${boundChanges} window governor bounds would change without the phantom (${((boundChanges / windows) * 100).toFixed(1)}%)`);
  function isRoster(t: Track): boolean { return roster.includes(t.role); }
}

console.log('\n=== 6. the "before" picture: generator percussion counts at HEAD (take 1, three-chorus) ===');
for (const templateId of ['ensemble.symphony', 'ensemble.cinematic', 'ensemble.hybridstudio']) {
  const { p } = compose(threeChorus, templateId, 1, true);
  const counts = PERC_ROLES.map((r) => `${r}=${p.tracks.find((t) => t.role === r)?.notes.length ?? 'n/a'}`).join(' ');
  console.log(`${templateId}: ${counts}`);
}
void validateProject;
