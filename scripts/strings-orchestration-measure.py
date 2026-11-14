"""Independent SMF parser and duration-weighted MIDI measurements.
Keyswitches excluded per shipped profile zone. Conventional C4=60, no
extra Double Bass octave transpose. Quarter beats = ticks / 960 (not
necessarily felt meter beats). No audio/listening inference.
"""
import json,struct,pathlib,hashlib,statistics,math,collections,itertools
import sys
ROOT=pathlib.Path(__file__).resolve().parents[1]; AUD=ROOT/(sys.argv[1] if len(sys.argv)>1 else 'evaluation/strings-orchestration-v1/audition')
ROLES=['violins1','violins2','violas','cellosBasses','basses']
PROFILE=json.loads((ROOT/'src/export/profiles/uvi-orchestral-suite.json').read_text())['parts'][:5]

def midi(path):
 b=path.read_bytes();assert b[:4]==b'MThd';hlen=struct.unpack('>I',b[4:8])[0];fmt,nt,ppq=struct.unpack('>HHH',b[8:14]);pos=8+hlen;out=[];tempos=[]
 for ti in range(nt):
  assert b[pos:pos+4]==b'MTrk';ln=struct.unpack('>I',b[pos+4:pos+8])[0];data=b[pos+8:pos+8+ln];pos+=8+ln;i=0;t=0;running=None;name='';ons=collections.defaultdict(list);notes=[]
  def vlq():
   nonlocal i
   v=0
   while True:
    c=data[i];i+=1;v=(v<<7)|(c&127)
    if not c&128:return v
  while i<len(data):
   t+=vlq();st=data[i]
   if st>=128:i+=1
   else:st=running;assert st is not None
   if st==255:
    ty=data[i];i+=1;n=vlq();val=data[i:i+n];i+=n
    if ty==3:name=val.decode(errors='replace')
    if ty==81:tempos.append((t,int.from_bytes(val,'big')))
    continue
   if st in (240,247):n=vlq();i+=n;continue
   running=st;ty=st&240;ch=st&15;n=1 if ty in (192,208) else 2;vals=data[i:i+n];i+=n
   if ty==144 and vals[1]>0:ons[(ch,vals[0])].append((t,vals[1]))
   elif ty==128 or ty==144 and vals[1]==0:
    q=ons[(ch,vals[0])];assert q,(path,ti,t,vals)
    start,vel=q.pop(0);notes.append({'s':start,'e':t,'p':vals[0],'v':vel,'ch':ch+1})
  assert not any(ons.values()),(path,ti,'unclosed')
  out.append({'name':name,'end':t,'notes':sorted(notes,key=lambda n:(n['s'],n['p']))})
 assert pos==len(b), (path, 'trailing/truncated bytes')
 return {'ppq':ppq,'tempo':tempos,'tracks':out}

def quant(ns,q):
 a=sorted((n['p'],n['e']-n['s']) for n in ns);total=sum(w for p,w in a);target=total*q;c=0
 if not a:return None
 for p,w in a:
  c+=w
  if c>=target:return p
 return a[-1][0]

def stats(ns):
 if not ns:return None
 w=sum(n['e']-n['s'] for n in ns)
 return {'n':len(ns),'min':min(n['p'] for n in ns),'max':max(n['p'] for n in ns),'median':statistics.median(n['p'] for n in ns),'mean':statistics.mean(n['p'] for n in ns),'p10':quant(ns,.1),'p50':quant(ns,.5),'p90':quant(ns,.9),'weightedMean':sum(n['p']*(n['e']-n['s']) for n in ns)/w,'beats':w/960}

def clip(ns,a,b):return [dict(n,s=max(a,n['s']),e=min(b,n['e'])) for n in ns if n['s']<b and n['e']>a]
def merge(ns):
 out=[]
 for n in sorted(ns,key=lambda n:n['s']):
  if out and n['s']<=out[-1][1]:out[-1][1]=max(out[-1][1],n['e'])
  else:out.append([n['s'],n['e']])
 return out

def windows(ns,gap=480):
 out=[]
 for n in sorted(ns,key=lambda n:n['s']):
  if out and n['s']-out[-1][1]<gap:out[-1][1]=max(out[-1][1],n['e'])
  else:out.append([n['s'],n['e']])
 return [[round(a/960,3),round(b/960,3)] for a,b in out]

def relations(a,b,start=0,end=61440):
 events=sorted(set([start,end]+[t for n in a+b for t in [n['s'],n['e']] if start<t<end]));d=collections.Counter();gaps=[]
 for x,y in zip(events,events[1:]):
  aa=[n['p'] for n in a if n['s']<=x<n['e']];bb=[n['p'] for n in b if n['s']<=x<n['e']]
  if not aa or not bb:continue
  v=statistics.mean(aa)-statistics.mean(bb);dur=y-x;d['joint']+=dur;d['above']+=dur*(v>0);d['unison']+=dur*(v==0);d['below']+=dur*(v<0);d['within4']+=dur*(abs(v)<=4);d['gap']+=v*dur;gaps.extend([(v,dur)])
 if not d['joint']:return None
 c=0;med=0
 for v,w in sorted(gaps):
  c+=w
  if c>=d['joint']/2:med=v;break
 return {'jointBeats':round(d['joint']/960,3),'abovePct':round(100*d['above']/d['joint'],1),'unisonPct':round(100*d['unison']/d['joint'],1),'belowPct':round(100*d['below']/d['joint'],1),'within4Pct':round(100*d['within4']/d['joint'],1),'meanGap':round(d['gap']/d['joint'],2),'medianGap':med}


def canon(ns):return ';'.join(sorted(':'.join(map(str,[n['s'],n['e'],n['p'],n['v'],n['ch']])) for n in ns))
def sourcecanon(ns):return sorted((round(n['startTick']),round(n['startTick']+n['durationTicks']),n['pitch'],n['velocity']) for n in ns)
def actualcanon(ns):return sorted((n['s'],n['e'],n['p'],n['v']) for n in ns)
manifest=json.loads((AUD/'midi-manifest.json').read_text()); allchecked=0
for entry in manifest:
 path=AUD/entry['file'];raw=path.read_bytes()
 assert len(raw)==entry['bytes'] and hashlib.sha256(raw).hexdigest()==entry['sha256'],path
 parsed=midi(path);assert parsed['ppq']==960;assert len(parsed['tracks'])==1+len(entry['chunks'])
 for expected,actual in zip(entry['chunks'],parsed['tracks'][1:]):
  assert expected['name']==actual['name']
  assert expected['notes']==len(actual['notes'])
  assert expected['noteHash']==hashlib.sha256(canon(actual['notes']).encode()).hexdigest(),(path,expected['name'])
  assert all(n['e']>n['s']>=0 and 0<=n['p']<=127 and 1<=n['v']<=127 for n in actual['notes'])
  allchecked+=len(actual['notes'])
results=[]
for folder in sorted(p for p in AUD.iterdir() if p.is_dir() and (p/'evidence.json').is_file()):
 e=json.loads((folder/'evidence.json').read_text());o=e['orchestration'];end=e['endTick'];m=midi(folder/'02_strings__uvi.mid')
 entry=next(x for x in manifest if x['file']==folder.name+'/02_strings__uvi.mid')
 tracks={r:[] for r in ROLES};checks={}
 for expected,tr in zip(entry['chunks'],m['tracks'][1:]):
  role=expected['role'];part=next(p for p in PROFILE if p['source']['role']==role);z=part['keyswitchZone'];ks=[n for n in tr['notes'] if z['low']<=n['p']<=z['high']];ns=[n for n in tr['notes'] if not z['low']<=n['p']<=z['high']]
  tracks[role].extend(ns)
  src=next(t for t in e['tracks'] if t['role']==role)['notes']
  match=sourcecanon(src)==actualcanon(ns)
  checks[role]={'keyswitchesExcluded':len(ks),'musicalNotes':len(ns),'sourceMatchesActualMidi':match}
  if o['accepted'] and any(c['role']==role for c in o['plan']['capabilities']):
   assert match,(folder,role,'source vs MIDI mismatch')
   cap=next(c for c in o['plan']['capabilities'] if c['role']==role)
   assert all(cap['range'][0]<=n['p']<=cap['range'][1] for n in ns)
  for k in ks:assert z['low']<=k['p']<=z['high']
 sums={}
 for role,ns in tracks.items():
  ns.sort(key=lambda n:(n['s'],n['p']));occ=sum(b-a for a,b in merge(ns))
  onset_independent=sum(not any(abs(other['s']-n['s'])<60 for r,notes in tracks.items() if r!=role for other in notes) for n in ns)/max(1,len(ns))
  sums[role]={'stats':stats(ns),'occupancyPct':100*occ/end,'firstOnsetQuarterBeat':ns[0]['s']/960 if ns else None,
   'quarterTrajectory':[stats(clip(ns,round(i*end/4),round((i+1)*end/4))) for i in range(4)],
   'sections':[{'name':s['name'],'startBar':s['startBar'],'stats':stats(clip(ns,round((s['startBar']-1)*e['meter']['numerator']*960*4/e['meter']['denominator']),round((s['startBar']-1+s['lengthBars'])*e['meter']['numerator']*960*4/e['meter']['denominator'])))} for s in e['sections']],
   'activityWindowsQuarterBeats':windows(ns),'rhythmicallyIndependentOnsets':onset_independent,
   'opening':[dict(n,startQuarterBeat=n['s']/960,durationQuarterBeats=(n['e']-n['s'])/960) for n in ns if n['s']<min(end,7680)]}
 openingEnd=min(end,7680);cuts=sorted({0,openingEnd}|{t for ns in tracks.values() for n in ns for t in [n['s'],n['e']] if 0<t<openingEnd});texture=collections.Counter()
 for a,b in zip(cuts,cuts[1:]):texture[sum(any(n['s']<=a<n['e'] for n in ns) for ns in tracks.values())]+=b-a
 exportedContributions=[]
 if o['accepted']:
  for c in o['plan']['contributions']:
   ns=clip(tracks[c['role']],c['startTick'],c['endTick']);ticks=sum(b-a for a,b in merge(ns));review=next(r for r in o['contributions'] if r['contribution']==c['index'])
   noteons=sum(c['startTick']<=n['s']<c['endTick'] for n in tracks[c['role']])
   assert ticks==review['realizedTicks'] and noteons==review['realizedNotes'],(folder,c['index'],'exported contribution realization differs')
   exportedContributions.append({'contribution':c['index'],'role':c['role'],'duty':c['duty'],'plannedTicks':c['endTick']-c['startTick'],'generatedNotes':review['generatedNotes'],'generatedTicks':review['generatedTicks'],'realizedNotes':review['realizedNotes'],'realizedTicks':review['realizedTicks'],'exportedNotes':noteons,'exportedTicks':ticks,'exportedCoverage':ticks/(c['endTick']-c['startTick']),'status':review['status']})
 results.append({'tag':folder.name,'accepted':o['accepted'],'reason':o['reason'],'plannedOpening':o['plan']['opening'] if o['plan'] else None,
  'checks':checks,'tracks':sums,'pairs':{f'{a}/{b}':relations(tracks[a],tracks[b],end=end) for a,b in itertools.combinations(ROLES,2)},
  'actualOpeningDesks':[r for r in ROLES if clip(tracks[r],0,openingEnd)],'openingTextureDurationQuarterBeats':{str(k):v/960 for k,v in sorted(texture.items())},
  'roleAssessments':o['desks'],'contributionReviews':o['contributions'],'exportedContributions':exportedContributions})
(AUD/'midi-measurements.json').write_text(json.dumps({'filesValidated':len(manifest),'allNoteOnsValidatedIncludingKeyswitches':allchecked,'cases':results},indent=2)+'\n')
rows=['# Actual MIDI measurements','',f'{len(manifest)} files validated by independent Python parsing; {allchecked} note-ons matched against the production profile chunks (including keyswitches for transport validation). Musical metrics below EXCLUDE keyswitches. All note-offs paired; 960 PPQ. Conventional C4=60; shipped profile calls MIDI 60 C3. Bass transpose remains the shipped zero; no additional -12 applied.','', 'Duration-weighted P50 (not note-count median); dash means no exported musical notes. Percent crossing/within4 is conditional on joint sounding, using simultaneous mean pitch per desk. Proximity is not proof of perceptual masking.','', '| Controlled seed | Planned thematic opening | Actual first 8 quarter-beat desks | P50 I / II / Va / Vc / B | Occupancy % I / II / Va / Vc / B |','|---|---|---|---|---|']
for i in range(1,9):
 r=next(r for r in results if r['tag']==f'symphony-dorian-seed{i}-take0')
 rows.append('| '+str(i)+' | '+str(r['plannedOpening']['foreground'])+' | '+', '.join(r['actualOpeningDesks'])+' | '+' / '.join(str(r['tracks'][role]['stats']['p50']) if r['tracks'][role]['stats'] else '—' for role in ROLES)+' | '+' / '.join(f"{r['tracks'][role]['occupancyPct']:.1f}" for role in ROLES)+' |')
rows+=['','## Controlled register trajectories (quarter-piece P50)','', '| Seed | I | II | Viola | Cello | Bass |','|---|---|---|---|---|---|']
for i in range(1,9):
 r=next(r for r in results if r['tag']==f'symphony-dorian-seed{i}-take0')
 rows.append('| '+str(i)+' | '+' | '.join('/'.join(str(q['p50']) if q else '—' for q in r['tracks'][role]['quarterTrajectory']) for role in ROLES)+' |')
rows+=['','## Simultaneous lower spacing and hierarchy','', '| Seed | Cello/Bass joint q-beats; median gap | Viola BELOW Cello % | Violin I BELOW II % |','|---|---|---|---|']
for i in range(1,9):
 r=next(r for r in results if r['tag']==f'symphony-dorian-seed{i}-take0');p=r['pairs']['cellosBasses/basses'];v=r['pairs']['violas/cellosBasses'];u=r['pairs']['violins1/violins2']
 rows.append(f"| {i} | {str(p['jointBeats'])+'; '+str(p['medianGap']) if p else 'no joint sound'} | {v['belowPct'] if v else '—'} | {u['belowPct'] if u else '—'} |")
rows+=['','## Cases and limitations','', '| Case | Ensemble accepted? | Actual opening desks | Sparse / silence / fallback |','|---|---|---|---|']
for r in results:
 rows.append('| '+r['tag']+' | '+str(r['accepted'])+' | '+', '.join(r['actualOpeningDesks'])+' | '+'; '.join(d['role']+': '+d['state'] for d in r['roleAssessments'] if d['state']!='substantial')+' |')
rows+=['','See midi-measurements.json for duration-weighted P10/P50/P90/mean, full ranges, section trajectories, entrance times, exact opening pitches/rhythms, independent-onset fractions, all ten simultaneous desk pairs, and role-relative realization reviews. Planned opening foreground is a compositional intention; actual opening desks and durations are measured independently. No audio or listening approval is implied.']
(AUD/'MIDI_MEASUREMENTS.md').write_text('\n'.join(rows)+'\n')
print(f'PASS {len(manifest)} MIDI files; {allchecked} note-ons; {len(results)} measured production cases; paired offsets and mapped-content hashes verified')
for row in rows[7:16]:print(row)
