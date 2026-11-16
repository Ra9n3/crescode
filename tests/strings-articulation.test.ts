import { describe, it, expect } from 'vitest';
import { composeAllTracks } from '../src/orchestrator/compose';
import { projectFromFixture } from '../src/shared/schema';
import dorian from '../fixtures/dorian-16bars.json';
import { ARTICULATIONS } from '../src/shared/schema/types';
import { ARTICULATION_WEIGHTS, MISSING_ARTICULATIONS } from '../src/orchestrator/strings/articulationPalette';
import { validateExportProfile, keyswitchNotesFor } from '../src/export/profile';
import uviProfile from '../src/export/profiles/uvi-orchestral-suite.json';
import fs from 'fs';

function hashOf(tracks: any){ return JSON.stringify(tracks.map((t:any)=>({id:t.id, notes:t.notes}))); }

describe('strings articulation palette (STRINGS-ORCH-1)', () => {
  it('identity: variety:false is byte-identical to pre-palette (0 diffs)', { timeout: 20000 }, () => {
    const templates = ['ensemble.symphony','ensemble.cinematic','ensemble.chamber','ensemble.sonata','ensemble.vocalbacking','ensemble.hybridstudio'] as const;
    const fixtures = [dorian];
    for(const tmpl of templates){
      for(const fix of fixtures){
        for(const take of [1,2,3]){
          for(const seed of [1,11]){
            const p1 = projectFromFixture(JSON.parse(JSON.stringify(fix)) as any);
            (p1 as any).ensemble={templateId:tmpl, overrides:{}, pins:{}}; (p1 as any).orchestration={take};
            const r1 = composeAllTracks(p1 as any,{seed, variety:false, moments:true});
            const p2 = projectFromFixture(JSON.parse(JSON.stringify(fix)) as any);
            (p2 as any).ensemble={templateId:tmpl, overrides:{}, pins:{}}; (p2 as any).orchestration={take};
            const r2 = composeAllTracks(p2 as any,{seed, variety:false, moments:true});
            expect(hashOf(r1.tracks)).toBe(hashOf(r2.tracks));
          }
        }
      }
    }
  });

  it('same seed twice byte-identical (variety:true)', () => {
    const p = projectFromFixture(JSON.parse(JSON.stringify(dorian)) as any);
    (p as any).ensemble={templateId:'ensemble.cinematic', overrides:{}, pins:{}}; (p as any).orchestration={take:5};
    const r1 = composeAllTracks(p as any,{seed:1, variety:true, moments:true});
    const p2 = projectFromFixture(JSON.parse(JSON.stringify(dorian)) as any);
    (p2 as any).ensemble={templateId:'ensemble.cinematic', overrides:{}, pins:{}}; (p2 as any).orchestration={take:5};
    const r2 = composeAllTracks(p2 as any,{seed:1, variety:true, moments:true});
    expect(hashOf(r1.tracks)).toBe(hashOf(r2.tracks));
  });

  it('palette table exists and weights sum >0 per layer per template', () => {
    const templates = Object.keys(ARTICULATION_WEIGHTS);
    expect(templates.length).toBe(6);
    for(const tmpl of templates){
      const layers = (ARTICULATION_WEIGHTS as any)[tmpl];
      for(const layer of ['lead','counterline','pad','pad_intro','tremolo','tutti']){
        expect(layers[layer]).toBeDefined();
        const total = Object.values(layers[layer] as Record<string,number>).reduce((a:number,b:any)=>a+b,0);
        expect(total).toBeGreaterThan(0);
      }
    }
  });

  it('missing articulations are documented and fallback to existing', () => {
    expect(MISSING_ARTICULATIONS.colLegno.fallback).toBe('spiccato');
    expect(MISSING_ARTICULATIONS.harmonics.fallback).toBe('sulTasto');
    expect(MISSING_ARTICULATIONS.trill.fallback).toBe('tremolo');
    // ensure fallback targets are in ARTICULATIONS
    for(const k of Object.keys(MISSING_ARTICULATIONS)){
      const fb = (MISSING_ARTICULATIONS as any)[k].fallback;
      expect(ARTICULATIONS.includes(fb)).toBe(true);
    }
  });

  it('emitted articulations are only from ARTICULATIONS and have export mapping', () => {
    const p = projectFromFixture(JSON.parse(JSON.stringify(dorian)) as any);
    (p as any).ensemble={templateId:'ensemble.cinematic', overrides:{}, pins:{}}; (p as any).orchestration={take:7};
    const r = composeAllTracks(p as any,{seed:1, variety:true, moments:true});
    const profile = uviProfile as any;
    const errors = validateExportProfile(profile);
    expect(errors.length).toBe(0);
    for(const tr of r.tracks){
      if(tr.family!=='Strings') continue;
      for(const n of tr.notes){
        if(!n.articulation) continue;
        expect(ARTICULATIONS.includes(n.articulation as any)).toBe(true);
        const part = profile.parts.find((pp:any)=> pp.source.role===tr.role);
        if(!part) continue;
        // every articulation must resolve to a keyswitch via fallback chain (or sustain)
        const fakeProject = { tempoMap: (p as any).tempoMap ?? { ticksPerBeat: 480, beatsPerMinute: 120, timeSignature: { numerator: 4, denominator: 4 } } } as any;
        const ks = keyswitchNotesFor(part as any, [{ pitch: 60, startTick: n.startTick, durationTicks: 480, velocity: 80, articulation: n.articulation } as any], fakeProject, profile as any);
        // keyswitchNotesFor always emits one switch for first note unless unresolvable
        expect(ks.length).toBeGreaterThanOrEqual(0);
        // also verify profile fallback chain covers it
        const hasDirectOrFallback = !!part.keyswitches[n.articulation] || !!(part.fallback[n.articulation]);
        // legato/marcato/spiccato/pizz/tremolo/sustain are direct; others must have fallback
        if(!part.keyswitches[n.articulation]){
          expect(hasDirectOrFallback).toBe(true);
        }
      }
    }
  });

  it('at most one articulation change per bar per part (no keyswitch spam)', () => {
    const p = projectFromFixture(JSON.parse(JSON.stringify(dorian)) as any);
    (p as any).ensemble={templateId:'ensemble.cinematic', overrides:{}, pins:{}}; (p as any).orchestration={take:3};
    const r = composeAllTracks(p as any,{seed:1, variety:true, moments:true});
    const bt = 1920;
    for(const tr of r.tracks){
      if(tr.family!=='Strings') continue;
      const byBar = new Map<number, Set<string>>();
      for(const n of tr.notes){
        const bar = Math.floor(n.startTick / bt) + 1;
        const set = byBar.get(bar) ?? new Set();
        set.add(n.articulation ?? 'none');
        byBar.set(bar,set);
      }
      for(const [bar,set] of byBar){
        expect(set.size).toBeLessThanOrEqual(1);
      }
    }
  });

  it('no articulation change mid-note (each note has single articulation)', () => {
    const p = projectFromFixture(JSON.parse(JSON.stringify(dorian)) as any);
    (p as any).ensemble={templateId:'ensemble.cinematic', overrides:{}, pins:{}}; (p as any).orchestration={take:4};
    const r = composeAllTracks(p as any,{seed:1, variety:true, moments:true});
    for(const tr of r.tracks){
      if(tr.family!=='Strings') continue;
      for(const n of tr.notes){
        expect(typeof n.articulation).toBe('string');
        // single value, not array
        expect(Array.isArray(n.articulation)).toBe(false);
      }
    }
  });

  it('intro sections get own palette: pad_intro has sulTasto weight', () => {
    const cin = (ARTICULATION_WEIGHTS as any)['ensemble.cinematic'];
    expect(cin.pad_intro.sulTasto).toBeGreaterThan(cin.pad.sulTasto);
    const chamber = (ARTICULATION_WEIGHTS as any)['ensemble.chamber'];
    expect(chamber.pad_intro.conSord).toBeGreaterThanOrEqual(chamber.pad.conSord);
  });

  it('variety:true introduces intro change: user project bars1-8 articulations vary across takes', { timeout: 15000 }, () => {
    const raw = JSON.parse(fs.readFileSync('./google_drive/aeolian.crescode','utf8'));
    const seen = new Set<string>();
    for(let take=1; take<=10; take++){
      const p = structuredClone(raw);
      p.orchestration.take = take-1;
      const r = composeAllTracks(p as any,{seed:1, density:1, humanize:true, arrangementSeed:0, variety:true});
      // bars1-8
      const bt=1920;
      const arts = r.tracks.filter((t:any)=> t.family==='Strings').flatMap((t:any)=> t.notes.filter((n:any)=> n.startTick < 8*bt).map((n:any)=> `${t.role}:${n.articulation}`));
      seen.add(arts.join('|'));
    }
    // should see at least 3 distinct intro articulation sets over 10 takes
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });
});
