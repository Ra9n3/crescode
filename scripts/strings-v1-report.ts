/**
 * Strings V1 Stage 1 development report (diagnostic only; writes nothing).
 *
 *   npx vite-node scripts/strings-v1-report.ts compare          classic versus V1 on every fingerprint cell
 *   npx vite-node scripts/strings-v1-report.ts understanding [template] [fixture]
 *   npx vite-node scripts/strings-v1-report.ts capabilities
 */
import { buildStringCapabilities, STRING_INSTRUMENT_IDS, UNRESOLVED_MAPPING_QUESTIONS } from '../src/orchestrator/strings/characters/capabilities';
import { NOTE_NAMES } from '../src/shared/schema/modes';
import {
  compareStringModes, composeStringCell, fingerprintCells, formatComparisons, type StringFixtureKey, type StringTemplateKey,
} from '../tests/strings-v1-support';

const [command = 'compare', templateArg = 'chamber', fixtureArg = 'dorian-16bars'] = process.argv.slice(2);
const pc = (n: number): string => NOTE_NAMES[((n % 12) + 12) % 12];

if (command === 'compare') {
  const reports = fingerprintCells().map(compareStringModes);
  const different = reports.filter((r) => !r.totals.identical);
  console.log(formatComparisons(different.length ? different : reports.slice(0, 2)));
  console.log(`\n${reports.length} cells compared: ${reports.length - different.length} identical, ${different.length} different`);
  console.log(`string tracks changed: ${reports.reduce((s, r) => s + r.totals.stringTracksChanged, 0)}; cells with changed consumed information: ${reports.filter((r) => r.totals.consumedChanged).length}; downstream tracks changed: ${reports.reduce((s, r) => s + r.totals.downstreamTracksChanged, 0)}`);
} else if (command === 'understanding') {
  const { result } = composeStringCell({ template: templateArg as StringTemplateKey, fixture: fixtureArg as StringFixtureKey, seed: 1, take: 0 }, 'v1');
  const u = result.stringsDiagnostics.v1!.understanding;
  const f = u.brief.facts;
  console.log(`BRIEF  key ${pc(f.tonality.key)} ${f.tonality.mode} (${u.brief.readings.modeColour}), ${f.time.bpm} bpm, ${f.time.numerator}/${f.time.denominator}, ${f.time.bars} bars, take ${f.identity.take}`);
  console.log(`  template ${f.template.id}; string voices ${f.template.stringVoiceRoles.join(', ')}; bass desk ${f.template.bassDesk}`);
  for (const s of f.sections) console.log(`  section ${s.name} #${s.occurrence}: bars ${s.startBar}-${s.startBar + s.lengthBars - 1}, mean energy ${s.meanEnergy}, peak ${s.peakEnergy}`);
  console.log(`  energy ${f.energy.min}..${f.energy.max}, peak bar ${f.energy.peakBar}, near-silence bars [${f.energy.nearSilenceBars.join(', ')}]`);
  console.log(`  not derived: ${u.brief.notDerived.length} items (vocabulary fields are null)`);
  console.log('HARMONIC MAP');
  for (const c of u.harmony.chords.slice(0, 8)) {
    const join = u.harmony.joins[c.fact.index];
    console.log(`  bar ${c.fact.startBar} ${c.fact.symbol.padEnd(7)} tension ${c.reading.tension.toFixed(2)} [${c.reading.tensionSources.join('; ')}]`);
    if (join) console.log(`     -> ${join.reading.rootMotion}, bass ${join.reading.bassMoveSemitones}, common ${join.reading.commonTones.map(pc).join(' ')}, guide ${join.reading.guideTones.map((g) => `${pc(g.pc)}>${pc(g.toPc)}`).join(' ')}, suspensions ${join.reading.suspensions.map((s) => `${pc(s.heldPc)}>${pc(s.resolvesToPc)}`).join(' ') || 'none'}, arrival ${join.reading.arrival ? `${join.reading.arrival.kind} ${join.reading.arrival.strength}` : 'none'}`);
  }
  console.log(`  ... ${u.harmony.chords.length} chords; rhythm changes at bars [${u.harmony.rhythm.changes.map((c) => c.bar).join(', ')}]; pedals ${u.harmony.pedals.map((p) => `${p.role} ${pc(p.pc)} chords ${p.fromIndex}-${p.toIndex}`).join('; ') || 'none'}`);
  console.log(`STRUCTURAL PROPOSAL (${u.structure.status})`);
  for (const c of u.structure.candidates) console.log(`  bar ${String(c.bar).padStart(2)} strength ${c.strength.toFixed(2)}  ${c.evidence.map((e) => `${e.kind}(${e.weight})`).join(' + ')}`);
  console.log(`  loops: ${u.structure.loops.map((l) => `${l.sectionId} ${l.periodBars} bars x${l.cycles}`).join('; ') || 'none'}`);
  console.log(`  arrivals: ${u.structure.arrivals.map((a) => `bar ${a.tick / f.time.barTicks + 1} ${a.kind} ${a.strength}`).join('; ') || 'none'}`);
  for (const h of u.structure.homeSpans) console.log(`  home span ${h.typeKey}: ${h.bars} bars from tick ${h.startTick} (${h.basis})`);
} else if (command === 'capabilities') {
  const table = buildStringCapabilities();
  for (const id of STRING_INSTRUMENT_IDS) {
    const c = table[id];
    console.log(`${c.name} — ${c.patch} (part ${c.partIndex}); playable from ${c.playableLow}; keyswitch zone ${c.keyswitchZone?.low}-${c.keyswitchZone?.high}; sounding pitch ${c.soundingPitch}; controllers ${c.controllersWritten.join(',')} written, ${c.controllersNotWritten.join(',')} not`);
    for (const a of c.articulations) console.log(`   ${a.articulation.padEnd(9)} ${a.trigger.padEnd(18)} sounds ${String(a.sounds).padEnd(8)} key ${String(a.keyName).padEnd(4)}${a.keyUnverified ? ' (key unverified)' : ''}  preview ${a.previewDistinct ? 'distinct' : 'sustain'}  listening ${a.listening}`);
    for (const note of c.unverified) console.log(`   unverified: ${note}`);
  }
  for (const q of UNRESOLVED_MAPPING_QUESTIONS) console.log(`open: ${q.question} — ${q.verifyBy}`);
} else {
  console.log('usage: strings-v1-report.ts compare | understanding [template] [fixture] | capabilities');
}
