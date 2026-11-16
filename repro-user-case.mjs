import { projectFromFixture } from './src/shared/schema/index.ts';
import { composeAllTracks } from './src/orchestrator/compose.ts';
import fs from 'fs';

const raw = JSON.parse(fs.readFileSync('./google_drive/aeolian.crescode','utf8'));
console.log('=== 1) Default / demo project named "Dorian 16 Bars" ===');
console.log('src/store/store.ts line 2 imports fixture from ../../fixtures/dorian-16bars.json');
console.log('fixtures/dorian-16bars.json:');
const fixtureDefault = JSON.parse(fs.readFileSync('./fixtures/dorian-16bars.json','utf8'));
console.log(`  name="${fixtureDefault.name}" bpm=${fixtureDefault.bpm} key=${fixtureDefault.key} mode=${fixtureDefault.mode}`);
console.log(`  sections=${JSON.stringify(fixtureDefault.sections)}`);
console.log(`  bars total=${fixtureDefault.sections.reduce((a,s)=>a+s.lengthBars,0)} chords=${fixtureDefault.chords.length}`);
console.log('Comparison with attached file (aeolian.crescode):');
console.log(`  attached name="${raw.name}" bpm=${raw.bpm} key=${raw.key} mode=${raw.mode}`);
console.log(`  attached sections=${JSON.stringify(raw.sections)}`);
console.log(`  attached bars total=${raw.sections.reduce((a,s)=>a+s.lengthBars,0)} chords=${raw.chords.length}`);
console.log(`  Difference: fixture is D Dorian 16 bars (2 sections 8+8, 18 chords, startTick 0), attached is D Aeolian 24 bars (3 sections intro1-8 Verse9-16 Chorus17-24, 22 chords, first chord at 30720=bar17? actually_intro chords at 0 with Dm6/Gm/C/Faug7)`);
console.log('');

console.log('=== 2) Load attached file as is ===');
console.log(`template=${raw.ensemble.templateId} orchestration.take=${raw.orchestration?.take} (persisted)`);
console.log(`sections (sorted by startBar):`);
for (let s of [...raw.sections].sort((a,b)=>a.startBar-b.startBar)) console.log(`  ${s.name} ${s.startBar}-${s.startBar+s.lengthBars-1} (length ${s.lengthBars}) id=${s.id}`);
console.log(`chord count=${raw.chords.length}`);
for (let c of [...raw.chords].sort((a,b)=>a.startTick-b.startTick)) console.log(`  tick ${c.startTick} ${c.symbol}`);
console.log('');

// Helper to do compose like store.ts:401
function doCompose(project, opts) {
  // store.ts composeAll does: arrangementSeed = max(0, (composeOptions.seed ??1)-1) => seed 1 => 0, variety:true
  // then composeAllTracks(project, {...composeOptions, arrangementSeed:0, variety})
  // and then edit project tracks+orchestration
  const composeOptions = { seed: 1, density: 1, humanize: true, ...opts };
  const res = composeAllTracks(project, { ...composeOptions, arrangementSeed: Math.max(0, (composeOptions.seed??1)-1), variety: composeOptions.variety });
  // mimic store edit: new project with res.tracks + res.orchestration
  const newProject = { ...project, tracks: res.tracks, orchestration: res.orchestration };
  return { newProject, res };
}

// Need to projectFromFixture? But file already is Project shape; we should use it directly, but compose uses projectFromFixture elsewhere for fixtures without tracks.
// For user file, we want to keep tracks (they are existing notes before compose) — compose will overwrite unlocked in-band.
// So we should use raw as Project directly (not projectFromFixture which would strip? ). Let's just use structuredClone.
let project0 = structuredClone(raw);
// Ensure ensemble exists
project0.ensemble = project0.ensemble ?? { templateId: 'ensemble.cinematic', overrides:{}, pins:{} };

console.log('=== 3) Reproduce what app does when Compose All is pressed twice (variety:true) ===');
let p1 = structuredClone(project0);
console.log(`Initial persisted take=${p1.orchestration.take} seed=1 variety:true`);
let { newProject: p_after1, res: r1 } = doCompose(p1, { variety: true });
console.log(`After 1st Compose All: take=${p_after1.orchestration.take} (effectiveTake=${p_after1.orchestration.take}) tracks report: ${r1.reports.slice(0,3).join(' | ')}`);
console.log(`  textures: ${r1.reports.find(x=>x.startsWith('textures'))}`);
console.log(`  ostinato style: ${r1.reports.find(x=>x.startsWith('ostinato')) ?? 'none'}`);
let { newProject: p_after2, res: r2 } = doCompose(p_after1, { variety: true });
console.log(`After 2nd Compose All: take=${p_after2.orchestration.take} textures=${r2.reports.find(x=>x.startsWith('textures'))}`);
console.log(`  ostinato style: ${r2.reports.find(x=>x.startsWith('ostinato')) ?? 'none'}`);
console.log('Reports full:');
for (let rep of r2.reports) console.log('  '+rep);
console.log('');

console.log('=== variety:false path (same two presses) ===');
let q1 = structuredClone(project0);
let { newProject: q_after1, res: qr1 } = doCompose(q1, { variety: false });
console.log(`After 1st variety:false take=${q_after1.orchestration.take} textures=${qr1.reports.find(x=>x.startsWith('textures'))}`);
let { newProject: q_after2, res: qr2 } = doCompose(q_after1, { variety: false });
console.log(`After 2nd variety:false take=${q_after2.orchestration.take} textures=${qr2.reports.find(x=>x.startsWith('textures'))}`);
for (let rep of qr2.reports) console.log('  '+rep);
console.log('');

// For step 4, use p_after2 (variety:true twice) and also q_after2
function analyzeAndGrid(project, label) {
  console.log(`=== 4) GRIDS for ${label} (take=${project.orchestration.take}) bars 9-24 ===`);
  const bt = 1920; // 4/4 480 PPQ
  const tracksByRole = {};
  for (let t of project.tracks) {
    if (['violins1','violins2','violas','cellosBasses','basses','horns','trombones','flutes'].includes(t.role)) {
      tracksByRole[t.role] = t;
    }
  }
  console.log('Track ids:', Object.entries(tracksByRole).map(([r,t])=>`${r}=${t.id} notes=${t.notes.length}`).join(', '));

  // Helpers for grid
  function gridForBars(track, startBar, endBar) {
    const startTick = (startBar-1)*bt;
    const endTick = endBar*bt;
    const notes = track.notes.filter(n=> n.startTick < endTick && n.startTick + n.durationTicks > startTick);
    // Collect pitches sorted descending
    const pitches = [...new Set(notes.map(n=>n.pitch))].sort((a,b)=>b-a);
    if (pitches.length===0) {
      console.log(`  ${track.role} (${track.id}) pitch —: no notes in ${startBar}-${endBar}`);
      return;
    }
    const cols = (endBar - startBar +1)*16; // 16 sixteenths per bar
    const colTicks = 120; // 16th
    // Build grid: rows pitch, cols time
    console.log(`  ${track.role} (${track.id}) ${startBar}-${endBar} ${notes.length} notes pitches ${pitches.join(',')} `);
    // Header with bar numbers
    let header = '       ';
    for (let bar=startBar; bar<=endBar; bar++) {
      header += `|${String(bar).padStart(7)}${' '.repeat(8)}`;
    }
    console.log(header);
    let sub = '       ';
    for (let c=0; c<cols; c++) {
      if (c%16===0) sub += '|';
      else if (c%4===0) sub += ':';
      else sub += '.';
    }
    console.log(sub);
    for (let pitch of pitches) {
      let row = `${String(pitch).padStart(3)} ${pitchToName(pitch).padEnd(3)} `;
      for (let col=0; col<cols; col++) {
        const tick = startTick + col*colTicks;
        const tickNext = tick+colTicks;
        // note sounding at tick (start <= tick < end)
        const sounding = notes.some(n=> n.startTick <= tick && tick < n.startTick + n.durationTicks && n.pitch===pitch);
        const onset = notes.some(n=> n.startTick >= tick && n.startTick < tickNext && n.pitch===pitch);
        if (onset) row += 'X';
        else if (sounding) row += '-';
        else row += ' ';
        if ((col+1)%16===0) row += '|';
      }
      console.log(row);
    }
    // Also list notes raw for debug
    console.log(`    notes: ${notes.slice(0,20).map(n=> `${n.startTick}:${n.pitch}:${n.durationTicks}:${n.articulation}`).join(' | ')}${notes.length>20?' ...':''}`);
  }

  function pitchToName(p) {
    const names=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    return names[p%12]+Math.floor(p/12-1);
  }

  for (let role of ['horns','trombones','flutes','violins1','violas','violins2','cellosBasses','basses']) {
    if (!tracksByRole[role]) continue;
    gridForBars(tracksByRole[role], 9,12);
    gridForBars(tracksByRole[role], 13,16);
    gridForBars(tracksByRole[role], 17,20);
    gridForBars(tracksByRole[role], 21,24);
  }

  // Analysis for pattern checks
  // Bars 17-24 dense horn etc: we need shared onsets >70% across 7 families
  console.log(`\n--- Analysis ${label} bars 17-24 shared onsets ---`);
  const startTick17 = 16*bt;
  const endTick24 = 24*bt;
  const roles = ['violins1','violins2','violas','basses','horns','trombones','flutes']; // 7 as described (Double Basses = basses)
  // Collect onset ticks per role (quantize to 16th? Use 120 tick grid, but also consider humanize jitter: need tolerance)
  // We'll quantize to nearest 120, or use actual tick with 30ms tolerance? Humanize adds ~5-30 ticks (~1-6ms)
  // Use 20 tick tolerance for shared.
  const onsetsByRole = {};
  for (let r of roles) {
    const tr = tracksByRole[r];
    if (!tr) { onsetsByRole[r]=[]; continue; }
    const ons = tr.notes.filter(n=> n.startTick>=startTick17 && n.startTick<endTick24).map(n=> n.startTick);
    onsetsByRole[r]=ons;
    console.log(`  ${r} ${ons.length} onsets in 17-24: ${ons.slice(0,30).join(',')}${ons.length>30?'...':''}`);
  }
  // For each unique onset tick (rounded to 60 ticks), count how many roles have a note starting within +-30 ticks
  const allOnsets = [...new Set(Object.values(onsetsByRole).flat().map(t=> Math.round(t/30)*30 ))].sort((a,b)=>a-b);
  // Actually better to cluster: for each onset, check sharing
  let sharedCount = 0;
  for (let tick of allOnsets) {
    let sharingRoles = 0;
    for (let r of roles) {
      if (onsetsByRole[r].some(o=> Math.abs(o - tick) < 35)) sharingRoles++;
    }
    if (sharingRoles >= Math.ceil(roles.length*0.7)) {
      sharedCount++;
      // console.log(`    tick ${tick} sharing ${sharingRoles}/${roles.length}`);
    }
  }
  console.log(`  Shared onsets >70% (>=5 families within 35 ticks): ${sharedCount} distinct ticks in 17-24`);
  // Horns dense single-pitch line bars9-16
  console.log(`\n--- Analysis ${label} bars 9-16 horns dense line ---`);
  const start9 = 8*bt, end16 = 16*bt;
  const horns = tracksByRole['horns'];
  if (horns) {
    const hn = horns.notes.filter(n=> n.startTick>=start9 && n.startTick<end16);
    console.log(`  horns bars9-16 ${hn.length} notes avg dur ${(hn.reduce((a,n)=>a+n.durationTicks,0)/hn.length|0)} ticks pitches ${[...new Set(hn.map(n=>n.pitch))].join(',')}`);
    console.log(`    details: ${hn.map(n=> `${n.startTick}:${n.pitch}:${n.durationTicks}:${n.articulation}`).join(' | ')}`);
    const singlePitch = new Set(hn.map(n=>n.pitch)).size===1;
    const dense = hn.length >= 16; // dense tiny notes threshold
    console.log(`  dense single-pitch? ${dense && singlePitch} (dense=${dense} singlePitch=${singlePitch} len=${hn.length})`);
  }
  // Violins II / violas dotted short
  for (let r of ['violins2','violas']) {
    const tr = tracksByRole[r];
    if (!tr) continue;
    const ns = tr.notes.filter(n=> n.startTick>=start9 && n.startTick<end16);
    console.log(`  ${r} bars9-16 ${ns.length} notes avg dur ${(ns.reduce((a,n)=>a+n.durationTicks,0)/ns.length|0)} arts ${[...new Set(ns.map(n=>n.articulation))].join(',')} pitches ${[...new Set(ns.map(n=>n.pitch))].join(',')}`);
    console.log(`    ${ns.map(n=> `${n.startTick}:${n.pitch}:${n.durationTicks}:${n.articulation}`).join(' | ')}`);
  }
  // bars5-8 long sustains
  console.log(`\n--- Analysis ${label} bars5-8 long sustains (violins1 etc) ---`);
  const start5=4*bt, end8=8*bt;
  for (let r of ['violins1','violins2','violas','horns']) {
    const tr = tracksByRole[r]; if(!tr) continue;
    const ns = tr.notes.filter(n=> n.startTick>=start5 && n.startTick<end8);
    console.log(`  ${r} bars5-8 ${ns.length} notes avg dur ${(ns.length? ns.reduce((a,n)=>a+n.durationTicks,0)/ns.length|0:0)} ${ns.map(n=> `${n.startTick}:${n.pitch}:${n.durationTicks}`).join(' | ')}`);
  }
}

analyzeAndGrid(p_after2, 'variety:true after 2nd press');
analyzeAndGrid(q_after2, 'variety:false after 2nd press');

// Step 5: vary take 1-10 variety:true fixed project (original file, not after compose)
console.log('\n=== 5) Keep project fixed and vary only take 1-10 variety:true ===');
function testTake(take) {
  let proj = structuredClone(raw);
  proj.orchestration = { take };
  // Use same compose path but with persistedTake = take+1? Actually compose increments take.
  // To isolate take effect, we set orchestration.take = take-1, so after compose it becomes take
  // But easier: directly set project.orchestration.take = take-1 then compose once
  proj.orchestration.take = take-1;
  let { newProject } = doCompose(proj, { variety: true });
  // Now newProject has take==take, and tracks for that take
  // Analyze horns bars9-16 dense line and shared onsets 17-24
  const bt=1920;
  const horns = newProject.tracks.find(t=>t.role==='horns');
  const start9=8*bt, end16=16*bt;
  const hn = horns.notes.filter(n=> n.startTick>=start9 && n.startTick<end16);
  const singlePitch = new Set(hn.map(n=>n.pitch)).size===1;
  const dense = hn.length >= 16; // threshold 16 tiny notes in 8 bars
  const hornsDense = dense && singlePitch;
  // shared onsets
  const start17=16*bt, end24=24*bt;
  const roles = ['violins1','violins2','violas','basses','horns','trombones','flutes'];
  const onsetsByRole={};
  for (let r of roles) {
    const tr = newProject.tracks.find(t=>t.role===r);
    const ons = tr ? tr.notes.filter(n=> n.startTick>=start17 && n.startTick<end24).map(n=>n.startTick) : [];
    onsetsByRole[r]=ons;
  }
  const allOnsets = [...new Set(Object.values(onsetsByRole).flat().map(t=> Math.round(t/30)*30 ))].sort((a,b)=>a-b);
  let sharedDistinct=0;
  for (let tick of allOnsets) {
    let sharing=0;
    for (let r of roles) if (onsetsByRole[r].some(o=> Math.abs(o-tick)<35)) sharing++;
    if (sharing>=5) sharedDistinct++;
  }
  // also count sharing threshold 70% = >=5 of 7
  // For (b) need 5 or more families sharing onsets above 70% — interpret as >=5 families sharing same tick
  // We report sharedDistinct as number of shared ticks
  // Determine if "5 or more families sharing" means at least one shared tick with 5+ families? Or count takes where sharedDistinct >= something? Prompt says "How many takes show (b) 5 or more families sharing onsets above 70% in bars 17-24?"
  // Likely means takes where there exists a tick with >=5 families onset within 35 ticks (i.e. sharedCount>0). We'll compute both.
  const hasShared5 = sharedDistinct>0;
  // Also compute max sharing
  let maxSharing=0;
  for (let tick of allOnsets) {
    let sharing=0;
    for (let r of roles) if (onsetsByRole[r].some(o=> Math.abs(o-tick)<35)) sharing++;
    if (sharing>maxSharing) maxSharing=sharing;
  }
  return { take, hornsDense, hnLen: hn.length, singlePitch, maxSharing, sharedDistinct, hasShared5 };
}
let results=[];
for (let t=1; t<=10; t++) results.push(testTake(t));
for (let r of results) console.log(`take${r.take}: hornsDense=${r.hornsDense} (len=${r.hnLen} single=${r.singlePitch}) maxSharing=${r.maxSharing}/7 sharedTicks=${r.sharedDistinct} hasShared5=${r.hasShared5}`);
console.log(`Summary (a) dense horn line bars9-16: ${results.filter(r=>r.hornsDense).length}/10 takes`);
console.log(`Summary (b) 5+ families sharing >70% in 17-24 (at least one shared tick): ${results.filter(r=>r.hasShared5).length}/10 takes`);
console.log(`Detailed takes with (b): ${results.filter(r=>r.hasShared5).map(r=>r.take).join(',')}`);

// Also need to say whether pattern reproduced in the user's real case (p_after2)
console.log('\n=== 6) If reproduced: file/line/layer/rng ===');
// We need to detect if pattern is reproduced. Let's decide based on analysis above.
// For variety:true after 2 presses, we already have horns dense and shared.
// We'll heuristic: if hornsDense true for p_after2 or shared distinct >5

// Check p_after2 horns dense
function checkDense(project) {
  const horns = project.tracks.find(t=>t.role==='horns');
  const bt=1920; const start9=8*bt, end16=16*bt;
  const hn = horns.notes.filter(n=> n.startTick>=start9 && n.startTick<end16);
  return { len: hn.length, single: new Set(hn.map(n=>n.pitch)).size===1, dense: hn.length>=16 && new Set(hn.map(n=>n.pitch)).size===1 };
}
console.log('p_after2 horns check', checkDense(p_after2));
console.log('q_after2 horns check', checkDense(q_after2));

// Print current code version check
console.log('\n=== 7) Is every change since cf60a6f included? ===');
console.log('Current HEAD includes 98c57b5 PAD, 11352eb PIZZ, 74310dc evidence — all after cf60a6f, so YES if running on this branch. We will verify by checking git log.');
