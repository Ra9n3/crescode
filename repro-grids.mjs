import fs from 'fs';
import { projectFromFixture } from './src/shared/schema/index.ts';
import { composeAllTracks } from './src/orchestrator/compose.ts';

const raw = JSON.parse(fs.readFileSync('./google_drive/aeolian.crescode','utf8'));
function doCompose(project, opts){
  const composeOptions = { seed: 1, density: 1, humanize: true, ...opts };
  const res = composeAllTracks(project, { ...composeOptions, arrangementSeed: Math.max(0, (composeOptions.seed??1)-1), variety: composeOptions.variety });
  return { newProject: { ...project, tracks: res.tracks, orchestration: res.orchestration }, res };
}
let p1 = structuredClone(raw);
let { newProject: p_after1 } = doCompose(p1, { variety: true });
let { newProject: p_after2, res: r2 } = doCompose(p_after1, { variety: true });
let q1 = structuredClone(raw);
let { newProject: q_after1 } = doCompose(q1, { variety: false });
let { newProject: q_after2, res: qr2 } = doCompose(q_after1, { variety: false });

function pitchToName(p){ const names=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']; return names[p%12]+Math.floor(p/12-1); }

function gridForProject(project, label, outPath){
  const bt=1920;
  const colTicks=120;
  let out = `=== ${label} take=${project.orchestration.take} ===\n`;
  out += `textures: ${project===p_after2? r2.reports.find(x=>x.startsWith('textures')) : qr2.reports.find(x=>x.startsWith('textures'))}\n`;
  const order = ['horns','trombones','flutes','violins1','violas'];
  for (let role of order){
    const track = project.tracks.find(t=>t.role===role);
    if (!track) { out+=`\n${role}: missing\n`; continue; }
    out+= `\n== ${role} (${track.id}) total notes ${track.notes.length} ==\n`;
    for (let window of [[9,12],[13,16],[17,20],[21,24]]){
      const [sBar,eBar]=window;
      const sTick=(sBar-1)*bt, eTick=eBar*bt;
      const notes = track.notes.filter(n=> n.startTick < eTick && n.startTick+n.durationTicks > sTick);
      out+= `\n ${role} bars ${sBar}-${eBar} ${notes.length} notes\n`;
      if (notes.length===0){ out+=`  (tacet)\n`; continue; }
      const pitches=[...new Set(notes.map(n=>n.pitch))].sort((a,b)=>b-a);
      const cols=(eBar-sBar+1)*16;
      let header='     ';
      for(let bar=sBar; bar<=eBar; bar++) header+=`| bar${String(bar).padStart(2)}      `;
      out+=header+'\n';
      let sub='     ';
      for(let c=0;c<cols;c++){ if(c%16===0) sub+='|'; else if(c%4===0) sub+=':'; else sub+='.'; }
      out+=sub+'\n';
      for(let pitch of pitches){
        let row=`${String(pitch).padStart(3)} ${pitchToName(pitch).padEnd(3)} `;
        for(let col=0; col<cols; col++){
          const tick=sTick+col*colTicks;
          const tickNext=tick+colTicks;
          const onset=notes.some(n=> n.startTick>=tick && n.startTick<tickNext && n.pitch===pitch);
          const sounding=notes.some(n=> n.startTick<=tick && tick < n.startTick+n.durationTicks && n.pitch===pitch);
          if(onset) row+='X';
          else if(sounding) row+='-';
          else row+=' ';
          if((col+1)%16===0) row+='|';
        }
        out+=row+'\n';
      }
      out+=`  raw: ${notes.map(n=> `${n.startTick}:${n.pitch}:${n.durationTicks}:${n.articulation}`).join(' | ')}\n`;
    }
  }
  // Shared onsets analysis
  out+= `\n--- Shared onsets analysis bars17-24 ---\n`;
  const roles7=['violins1','violins2','violas','basses','horns','trombones','flutes'];
  const s17=16*bt, e24=24*bt;
  const onsetsByRole={};
  for(let r of roles7){
    const tr=project.tracks.find(t=>t.role===r);
    const ons=tr? tr.notes.filter(n=> n.startTick>=s17 && n.startTick<e24).map(n=>n.startTick) : [];
    onsetsByRole[r]=ons;
    out+=` ${r} ${ons.length} onsets: ${ons.join(',')}\n`;
  }
  const allOnsets=[...new Set(Object.values(onsetsByRole).flat().map(t=> Math.round(t/30)*30 ))].sort((a,b)=>a-b);
  let sharedTicks=[];
  for(let tick of allOnsets){
    let sharing=0;
    for(let r of roles7) if(onsetsByRole[r].some(o=> Math.abs(o-tick)<35)) sharing++;
    if(sharing>=5) sharedTicks.push({tick, sharing});
  }
  out+=` shared ticks >=5 families (35 tick tolerance): ${sharedTicks.length} => ${sharedTicks.map(s=> `${s.tick}(${s.sharing})`).join(', ')}\n`;
  // Horns dense check
  const horns=project.tracks.find(t=>t.role==='horns');
  const s9=8*bt, e16=16*bt;
  const hn=horns.notes.filter(n=> n.startTick>=s9 && n.startTick<e16);
  out+=` horns bars9-16 ${hn.length} notes singlePitch=${new Set(hn.map(n=>n.pitch)).size===1} avgDur=${hn.length? Math.round(hn.reduce((a,n)=>a+n.durationTicks,0)/hn.length):0}\n`;
  out+=`  ${hn.map(n=> `${n.startTick}:${n.pitch}:${n.durationTicks}:${n.articulation}`).join(' | ')}\n`;
  fs.writeFileSync(outPath, out);
  console.log(`wrote ${outPath}`);
}
gridForProject(p_after2, 'variety:true after 2nd ComposeAll (take9)', 'grid-variety-true-take9.txt');
gridForProject(q_after2, 'variety:false after 2nd ComposeAll (take9)', 'grid-variety-false-take9.txt');

// Also for take1-10 variety:true summary file
{
  let out='Take 1-10 variety:true analysis\n';
  function testTake(take){
    let proj=structuredClone(raw);
    proj.orchestration.take=take-1;
    let { newProject } = doCompose(proj, { variety:true });
    const bt=1920;
    const horns=newProject.tracks.find(t=>t.role==='horns');
    const s9=8*bt, e16=16*bt;
    const hn=horns.notes.filter(n=> n.startTick>=s9 && n.startTick<e16);
    const singlePitch=new Set(hn.map(n=>n.pitch)).size===1;
    const dense=hn.length>=16 && singlePitch;
    const roles7=['violins1','violins2','violas','basses','horns','trombones','flutes'];
    const s17=16*bt, e24=24*bt;
    const onsetsByRole={};
    for(let r of roles7){
      const tr=newProject.tracks.find(t=>t.role===r);
      onsetsByRole[r]= tr? tr.notes.filter(n=> n.startTick>=s17 && n.startTick<e24).map(n=>n.startTick):[];
    }
    const allOnsets=[...new Set(Object.values(onsetsByRole).flat().map(t=> Math.round(t/30)*30 ))].sort((a,b)=>a-b);
    let sharedDistinct=0, maxSharing=0;
    for(let tick of allOnsets){
      let sharing=0;
      for(let r of roles7) if(onsetsByRole[r].some(o=> Math.abs(o-tick)<35)) sharing++;
      if(sharing>=5) sharedDistinct++;
      if(sharing>maxSharing) maxSharing=sharing;
    }
    return {take, dense, len:hn.length, singlePitch, sharedDistinct, maxSharing};
  }
  for(let t=1; t<=10; t++){
    const r=testTake(t);
    out+= `take${r.take}: hornsDense=${r.dense} len=${r.len} single=${r.singlePitch} sharedTicks>=5=${r.sharedDistinct} maxSharing=${r.maxSharing}/7\n`;
  }
  fs.writeFileSync('take1-10-analysis.txt', out);
  console.log(out);
}
