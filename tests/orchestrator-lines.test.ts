import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/dorian-16bars.json';
import { chordSpans, sectionMap } from '../src/orchestrator/spine';
import { motifLine, contourOf } from '../src/orchestrator/lines/motif';
import { counterlineLine } from '../src/orchestrator/lines/counterline';
import { chordTones } from '../src/orchestrator/voicing/chordTones';
import { barTicks, beatTicks } from '../src/shared/schema/meter';
import { projectFromFixture, type Note, type Project } from '../src/shared/schema';

const BASE = (): Project => projectFromFixture(JSON.parse(JSON.stringify(fixture)));
const VLN1: [number, number] = [55, 88]; // violins1 comfortable window
const VLN2: [number, number] = [55, 86]; // violins2 comfortable window

const allBars = (n = 16) => new Set(Array.from({ length: n }, (_, i) => i + 1));
const motif = (p: Project, take = 1) => motifLine({ project: p, spans: chordSpans(p), sections: sectionMap(p), leadBars: allBars(), comfortable: VLN1, take });

const BT = barTicks({ numerator: 4, denominator: 4 });
const beat = beatTicks({ numerator: 4, denominator: 4 });
const isStrongOnset = (tick: number) => tick % BT === 0 || tick % BT === 2 * beat; // beats 1 and 3 in 4/4

describe('motif (4c): scale-degree cell, meter-relative rhythm, per-take development', () => {
  it('same take → identical motif; a new take re-rolls it', () => {
    const a = motif(BASE(), 1);
    const b = motif(BASE(), 1);
    expect(a.length).toBeGreaterThan(8);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(motif(BASE(), 2))).not.toBe(JSON.stringify(a));
  });

  it('notes sit in the comfortable window, inside the song, in verse and chorus', () => {
    const m = motif(BASE());
    for (const n of m) {
      expect(n.pitch).toBeGreaterThanOrEqual(VLN1[0]);
      expect(n.pitch).toBeLessThanOrEqual(VLN1[1]);
      expect(n.startTick).toBeGreaterThanOrEqual(0);
      expect(n.startTick + n.durationTicks).toBeLessThanOrEqual(16 * BT);
      expect(n.articulation).toBe('legato');
    }
    expect(m.some((n) => n.startTick < 8 * BT)).toBe(true); // verse material
    expect(m.some((n) => n.startTick >= 8 * BT)).toBe(true); // chorus material
  });

  it('strong beats land on chord tones; weak beats stay in the mode', () => {
    const p = BASE();
    const spans = chordSpans(p);
    for (const n of motif(p)) {
      if (!isStrongOnset(n.startTick)) continue;
      const chord = spans.find((s) => n.startTick >= s.startTick && n.startTick < s.endTick);
      if (!chord) continue; // a strong beat inside a deliberate gap is a rest, not a wrong note
      const tones = new Set(chordTones(chord.parsed).tones.map((t) => t.pc));
      expect(tones.has(((n.pitch % 12) + 12) % 12)).toBe(true);
    }
  });

  it('the motif recurs and develops: chorus 1 keeps the contour class, higher register', () => {
    const m = motif(BASE());
    const verse = m.filter((n) => n.startTick < 8 * BT);
    const chorus = m.filter((n) => n.startTick >= 8 * BT);
    const cv = contourOf(verse);
    const cc = contourOf(chorus);
    expect(cv.length).toBeGreaterThan(3);
    const agree = [...cv].filter((c, i) => c === cc[i]).length / Math.min(cv.length, cc.length);
    expect(agree).toBeGreaterThanOrEqual(0.7); // same contour class (snapping may nudge isolated onsets)
    const mean = (ns: Note[]) => ns.reduce((a, n) => a + n.pitch, 0) / ns.length;
    expect(mean(chorus)).toBeGreaterThan(mean(verse)); // raised register
  });

  it('final non-chorus section develops by fragmentation or augmentation', () => {
    const p = BASE();
    p.sections = [
      { id: 'v', name: 'Verse', startBar: 1, lengthBars: 8 },
      { id: 'b', name: 'Bridge', startBar: 9, lengthBars: 4 },
      { id: 'o', name: 'Outro', startBar: 13, lengthBars: 4 },
    ];
    const m = motif(p);
    const verse = m.filter((n) => n.startTick < 8 * BT);
    const outro = m.filter((n) => n.startTick >= 12 * BT);
    expect(verse.length).toBeGreaterThan(0);
    expect(outro.length).toBeGreaterThan(0);
    const perBar = (ns: Note[], bars: number) => ns.length / bars;
    const meanDur = (ns: Note[]) => ns.reduce((a, n) => a + n.durationTicks, 0) / ns.length;
    const fragmented = perBar(outro, 4) <= perBar(verse, 8) * 1.05;
    const augmented = meanDur(outro) >= meanDur(verse) * 1.4;
    expect(fragmented || augmented).toBe(true); // one of the two developments
  });

  it('intro-like sections carry no motif', () => {
    const p = BASE();
    p.sections = [
      { id: 'i', name: 'Intro', startBar: 1, lengthBars: 4 },
      { id: 'v', name: 'Verse', startBar: 5, lengthBars: 12 },
    ];
    expect(motif(p).every((n) => n.startTick >= 4 * BT)).toBe(true);
  });
});

describe('counterline (4d): stepwise, contrary, consonant, under the lead', () => {
  const setup = (take = 1) => {
    const p = BASE();
    const lead = motif(p, take);
    const counter = counterlineLine({ project: p, spans: chordSpans(p), counterBars: allBars(), lead, comfortable: VLN2, take });
    return { p, lead, counter };
  };

  it('same take → identical; a new take re-rolls it', () => {
    const a = counterlineLine({ project: BASE(), spans: chordSpans(BASE()), counterBars: allBars(), lead: motif(BASE(), 3), comfortable: VLN2, take: 3 });
    const b = counterlineLine({ project: BASE(), spans: chordSpans(BASE()), counterBars: allBars(), lead: motif(BASE(), 3), comfortable: VLN2, take: 3 });
    expect(a.length).toBeGreaterThan(4);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const other = counterlineLine({ project: BASE(), spans: chordSpans(BASE()), counterBars: allBars(), lead: motif(BASE(), 4), comfortable: VLN2, take: 4 });
    expect(JSON.stringify(other)).not.toBe(JSON.stringify(a));
  });

  it('stays under the lead and consonant with it on strong beats', () => {
    const { lead, counter } = setup();
    expect(counter.length).toBeGreaterThan(4);
    const leadAt = (tick: number) => lead.find((n) => n.startTick <= tick && tick < n.startTick + n.durationTicks) ?? null;
    for (const n of counter) {
      expect(n.pitch).toBeGreaterThanOrEqual(VLN2[0]);
      expect(n.pitch).toBeLessThanOrEqual(VLN2[1]);
      const l = leadAt(n.startTick);
      if (l) expect(n.pitch).toBeLessThanOrEqual(l.pitch - 2);
      if (l && isStrongOnset(n.startTick)) {
        expect([3, 4, 8, 9]).toContain((((l.pitch - n.pitch) % 12) + 12) % 12); // 3rd/6th (10th reduces)
      }
    }
  });

  it('moves stepwise and mostly contrary to the lead', () => {
    const { lead, counter } = setup();
    const sorted = [...counter].sort((a, b) => a.startTick - b.startTick);
    const leadAt = (tick: number) => lead.find((n) => n.startTick <= tick && tick < n.startTick + n.durationTicks) ?? null;
    let comparable = 0;
    let contrary = 0;
    let steps = 0;
    let smallSteps = 0;
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1], b = sorted[i];
      const dc = Math.sign(b.pitch - a.pitch);
      if (Math.abs(b.pitch - a.pitch) <= 4) smallSteps++;
      steps++;
      const la = leadAt(a.startTick);
      const lb = leadAt(b.startTick);
      if (!la || !lb) continue;
      const dl = Math.sign(lb.pitch - la.pitch);
      if (dl === 0 || dc === 0) continue;
      comparable++;
      if (dc === -dl) contrary++;
    }
    expect(smallSteps / steps).toBeGreaterThanOrEqual(0.75); // stepwise
    expect(contrary / comparable).toBeGreaterThanOrEqual(0.6); // mostly contrary
  });
});
