import { describe, expect, it } from 'vitest';
import { chordTones, keepTones } from '../src/orchestrator/voicing/chordTones';
import { leadingTonePcOf, voiceLead, type VoiceSpec, type VoicingChord } from '../src/orchestrator/voicing/voiceLead';
import { mulberry32 } from '../src/engine/generate';
import { parseChord } from '../src/shared/schema/chords';
import { scalePitchClasses } from '../src/shared/schema/modes';

const ct = (symbol: string) => {
  const r = parseChord(symbol);
  if (!r.ok) throw new Error(r.error);
  return chordTones(r.chord);
};
const pcs = (symbol: string) => ct(symbol).tones.map((t) => t.pc);

const voice = (role: string, low: number, high: number, isBass = false): VoiceSpec => ({
  trackId: `trk_${role}`, role, low, high, comfortable: [low, high], isBass,
});
const chord = (id: string, startTick: number, endTick: number, symbol: string): VoicingChord => ({ id, startTick, endTick, ct: ct(symbol) });
const baseOpts = (over: Partial<Parameters<typeof voiceLead>[2]> = {}) => ({
  forbidOctaveDoubling: true, leadingTonePc: null, checkParallels: true, openSpacing: false, zoneFree: null, rng: mulberry32(1), ...over,
});

describe('chordTones: priority order (bass, third, seventh, fifth, extensions)', () => {
  it('a root-position seventh chord keeps bass/root, third, seventh, then fifth', () => {
    const t = ct('Dm7'); // D F A C
    expect(t.tones.map((x) => x.tier)).toEqual(['root', 'third', 'seventh', 'fifth']);
    expect(t.tones.map((x) => x.pc)).toEqual([2, 5, 0, 9]); // D F C A — the seventh outlives the fifth
    expect(keepTones(t, 3).map((x) => x.pc)).toEqual([2, 5, 0]); // D F C: A (fifth) dropped first
  });

  it('keep order is bass → third → seventh → fifth → extensions, and dropping follows it', () => {
    // C13 = C E G Bb D A: extensions galore
    const t = ct('C13');
    expect(t.hasSlashBass).toBe(false);
    expect(t.tones[0]).toMatchObject({ pc: 0, tier: 'root' });
    expect(t.tones.map((x) => x.tier)).toEqual(['root', 'third', 'seventh', 'fifth', 'extension', 'extension']);
    // 3 voices → bass/root, third, seventh; the fifth and extensions die first
    expect(keepTones(t, 3).map((x) => x.pc)).toEqual([0, 4, 10]);
    // 4 voices → + fifth
    expect(keepTones(t, 4).map((x) => x.pc)).toEqual([0, 4, 10, 7]);
  });

  it('a slash bass is tier 0 and goes to the lowest voice; the root drops to last resort', () => {
    const t = ct('C/E');
    expect(t.hasSlashBass).toBe(true);
    expect(t.bassPc).toBe(4);
    expect(t.tones[0]).toMatchObject({ pc: 4, tier: 'bass' });
    // with two voices: bass E + third G; the root C is the LAST keeper
    expect(keepTones(t, 2).map((x) => x.pc)).toEqual([4, 7]);
    expect(keepTones(t, 3).map((x) => x.pc)).toEqual([4, 7, 0]); // third, fifth, then root
  });

  it('sus chords promote the suspension into the third tier; 6-chords treat the 6th as the colour seventh', () => {
    expect(ct('Gsus4').tones.map((x) => x.tier)).toEqual(['root', 'third', 'fifth']);
    expect(pcs('Gsus4')).toEqual([7, 0, 2]); // G C D — no third
    expect(ct('C6').tones.map((x) => x.tier)).toEqual(['root', 'third', 'seventh', 'fifth']); // the 6th outranks the 5th
    expect(pcs('C6')).toEqual([0, 4, 9, 7]);
    expect(pcs('Am7b5')).toEqual([9, 0, 7, 3]); // keep order: A root, C third, G seventh, Eb fifth
    expect(pcs('F#7')).toEqual([6, 10, 4, 1]); // keep order: F# A# E C#
  });
});

describe('voiceLead: hard constraints', () => {
  const vla = voice('violas', 48, 88);
  const v2 = voice('violins2', 55, 93);
  const v1 = voice('violins1', 55, 96);
  const cb = voice('cellosBasses', 28, 84, true);
  const voicesLowFirst = [cb, vla, v2, v1];

  it('every voice sings a chord tone; the bass voice carries the slash bass', () => {
    // 3 voices for a 3-pc chord under the no-doubling rule
    const out = voiceLead([chord('c1', 0, 3840, 'C/E')], [voice('cellosBasses', 28, 84, true), voice('violas', 48, 88), voice('violins1', 55, 96)], baseOpts());
    const ps = out[0].pitches as number[];
    expect(ps[0] % 12).toBe(4); // E in the bass
    expect(ps.every((p) => [0, 4, 7].includes(p % 12))).toBe(true);
    expect(new Set(ps.map((p) => p % 12)).size).toBe(3); // no doubled pc
  });

  it('voices outnumbering tones force a minimal bass-pc doubling instead of silence', () => {
    // chamber quartet on a plain triad: 4 voices, 3 pcs → the root doubles
    const out = voiceLead([chord('c1', 0, 3840, 'Dm')], [voice('cellosBasses', 28, 84, true), voice('violas', 48, 88), voice('violins2', 55, 93), voice('violins1', 55, 96)], baseOpts());
    const ps = out[0].pitches as number[];
    expect(ps.every((p) => [2, 5, 9].includes(p % 12))).toBe(true);
    const byPc = new Map<number, number>();
    for (const p of ps) byPc.set(p % 12, (byPc.get(p % 12) ?? 0) + 1);
    const doubled = [...byPc.entries()].filter(([, n]) => n > 1);
    expect(doubled).toEqual([[2, 2]]); // exactly one doubling: the root D
  });

  it('no crossing, and no doubled leading tone where the mode has one', () => {
    const lt = leadingTonePcOf(0, scalePitchClasses(0, 'Ionian')); // B in C Ionian
    expect(lt).toBe(11);
    const chords = [chord('c1', 0, 3840, 'G7'), chord('c2', 3840, 3840, 'Cmaj7')]; // B lives in both
    const out = voiceLead(chords, voicesLowFirst, baseOpts({ leadingTonePc: lt }));
    for (const vc of out) {
      const ps = vc.pitches.filter((p): p is number => p !== null);
      expect(ps.filter((p) => p % 12 === 11).length).toBeLessThanOrEqual(1);
      for (let i = 1; i < ps.length; i++) expect(ps[i]).toBeGreaterThanOrEqual(ps[i - 1]);
    }
  });

  it('D Dorian has no leading tone — the derived rule returns null', () => {
    expect(leadingTonePcOf(2, scalePitchClasses(2, 'Dorian'))).toBeNull();
    expect(leadingTonePcOf(9, scalePitchClasses(9, 'Aeolian'))).toBeNull();
    expect(leadingTonePcOf(0, scalePitchClasses(0, 'Harmonic Minor'))).toBe(11);
  });

  it('low-interval limit: two notes under C3 sit only at octaves/unisons or fifths', () => {
    // craft a case where a third under C3 would be tempting: root+third both low
    const out = voiceLead([chord('c1', 0, 3840, 'C7')], [voice('cellosBasses', 28, 84, true), voice('violas', 36, 60)], baseOpts());
    for (const vc of out) {
      const ps = vc.pitches.filter((p): p is number => p !== null);
      for (let i = 0; i < ps.length; i++) {
        for (let j = 0; j < i; j++) {
          if (ps[j] >= 48 || ps[i] >= 48) continue;
          const d = (ps[i] - ps[j]) % 12;
          expect([0, 7]).toContain(d);
        }
      }
    }
  });

  it('vocal-zone exclusion keeps every pitch outside the zone', () => {
    const out = voiceLead([chord('c1', 0, 3840, 'Dm7')], voicesLowFirst, baseOpts({ zoneFree: [57, 81] as const }));
    for (const p of out[0].pitches) {
      expect(p === null || p < 57 || p > 81).toBe(true);
    }
  });
});

describe('voiceLead: soft behaviour and determinism', () => {
  const cb = voice('cellosBasses', 28, 84, true);
  const vla = voice('violas', 48, 88);
  const v2 = voice('violins2', 55, 93);
  const v1 = voice('violins1', 55, 96);
  const voicesLowFirst = [cb, vla, v2, v1];
  const progression = ['Dm7', 'G7', 'Dm7', 'Em7', 'Fmaj7', 'Dm9'].map((s, i) => chord(`c${i}`, i * 3840, 3840, s));

  it('is deterministic for the same seed and differs across takes', () => {
    const a = voiceLead(progression, voicesLowFirst, baseOpts({ rng: mulberry32(7) }));
    const b = voiceLead(progression, voicesLowFirst, baseOpts({ rng: mulberry32(7) }));
    expect(a).toEqual(b);
    const take2 = voiceLead(progression, voicesLowFirst, baseOpts({ rng: mulberry32(8) }));
    expect(take2).not.toEqual(a); // a new take explores a different voicing
  });

  it('prefers common tones: unchanged chords hold the exact same pitches', () => {
    const out = voiceLead([chord('c1', 0, 3840, 'Dm7'), chord('c2', 3840, 3840, 'Dm7')], voicesLowFirst, baseOpts());
    expect(out[1].pitches).toEqual(out[0].pitches);
  });

  it('runs fast enough for Compose All (a 20-chord progression, 4 voices, well under a second)', () => {
    const long = Array.from({ length: 20 }, (_, i) => chord(`c${i}`, i * 1920, 1920, i % 2 ? 'G7' : 'Dm7'));
    const t0 = performance.now();
    voiceLead(long, voicesLowFirst, baseOpts());
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
