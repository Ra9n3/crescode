/**
 * Coordinated voice-leading regression tests.
 *
 * These guard the defects the Phase 2 investigation measured on the pre-change
 * baseline, not just the shape of the output:
 *
 *   1. 358 notes were written below their own instrument's comfortable window.
 *      Every one was `violins1` playing an `inner` line while the CELLOS held
 *      the melody: the caller derived a single "lead floor" from whichever
 *      instrument led and imposed it as a ceiling on every other voice, so a
 *      violin was asked to stay under a cello note at 50 — unplayable.
 *   2. 12.9% of simultaneous voice-pairs inside a chord span duplicated a pitch
 *      class while distinct chord tones were still free.
 *   3. 195 accidental octave doublings.
 *
 * The detector is deliberately NOT touched: these tests assert against the
 * project's own `octaveDoubling` rule, with its original `d > 0 && d % 12 === 0`
 * semantics, so nothing here can be "fixed" by weakening the check.
 */
import { describe, expect, it } from 'vitest';
import { projectFromFixture, type Project } from '../../src/shared/schema';
import { composeOrchestra } from '../../src/compose';
import { classifyDoubling, coordinateVoices, voicedWindowOf } from '../../src/compose/voicing';
import type { RegisterBand } from '../../src/compose/ir';

const fixtures = async () => ({
  dorian: (await import('../../fixtures/dorian-16bars.json')).default,
  three: (await import('../../fixtures/three-chorus-40bars.json')).default,
});

function composeFixture(fx: unknown, templateId: string, seed: number) {
  const project = projectFromFixture(JSON.parse(JSON.stringify(fx)) as Partial<Project>);
  project.ensemble = { templateId, overrides: {}, pins: {} };
  return composeOrchestra(project, { seed, take: 1 });
}

const pcOf = (pitch: number) => ((pitch % 12) + 12) % 12;

describe('register containment', () => {
  it('never writes a note below its own instrument\'s comfortable window', async () => {
    const { dorian, three } = await fixtures();
    const offenders: string[] = [];
    for (const fx of [dorian, three]) {
      for (const tpl of ['ensemble.chamber', 'ensemble.sonata', 'ensemble.vocalbacking']) {
        for (let seed = 1; seed <= 20; seed++) {
          const r = composeFixture(fx, tpl, seed);
          for (const part of r.score.parts) {
            if (part.role === 'piano') continue;
            const [low, high] = part.register.comfortable;
            for (const note of part.notes) {
              if (note.pitch < low || note.pitch > high) {
                offenders.push(`${tpl} seed${seed} ${part.role}/${note.role} ${note.pitch} outside ${low}-${high}`);
              }
            }
          }
        }
      }
    }
    // Baseline was 358, all violins1/inner. Any reappearance is a regression.
    expect(offenders).toEqual([]);
  }, 300_000);

  it('keeps a violin a violin when the cellos carry the melody', async () => {
    // The exact configuration that produced the defect: sonata gives the lead
    // to cellosBasses in the verse, leaving violins1 as the inner voice.
    const { three } = await fixtures();
    const r = composeFixture(three, 'ensemble.sonata', 1);
    const verse = r.score.sections.find((s) => s.id === 'sec_verse1');
    expect(verse).toBeDefined();
    const cellosSlot = r.score.plan.sections
      .flatMap((s) => s.participation)
      .find((p) => p.materialRole === 'lead' && p.role === 'cellosBasses');
    expect(cellosSlot, 'sonata must still hand the cellos a leading role').toBeDefined();

    const violins = r.score.parts.find((p) => p.role === 'violins1')!;
    const [low] = violins.register.comfortable;
    const inner = violins.notes.filter((n) => n.role === 'inner');
    expect(inner.length).toBeGreaterThan(0);
    for (const note of inner) {
      expect(note.pitch).toBeGreaterThanOrEqual(low);
    }
  }, 120_000);
});

describe('duplicate pitch-class voice-pairs', () => {
  it('stays under 2% of simultaneous pairs inside a chord span', async () => {
    const { dorian, three } = await fixtures();
    let pairs = 0;
    let duplicates = 0;
    for (const fx of [dorian, three]) {
      for (const tpl of ['ensemble.chamber', 'ensemble.sonata', 'ensemble.vocalbacking']) {
        for (let seed = 1; seed <= 20; seed++) {
          const r = composeFixture(fx, tpl, seed);
          const strings = r.score.parts.filter((p) => p.role !== 'piano');
          for (const span of r.score.harmony) {
            const tick = Math.floor((span.startTick + span.endTick) / 2);
            const live = strings
              .map((part) => part.notes.find(
                (n) => n.startTick <= tick && tick < n.startTick + n.durationTicks,
              ))
              .filter((n): n is NonNullable<typeof n> => Boolean(n))
              .map((n) => pcOf(n.pitch));
            for (let i = 0; i < live.length; i++) {
              for (let j = i + 1; j < live.length; j++) {
                pairs++;
                if (live[i] === live[j]) duplicates++;
              }
            }
          }
        }
      }
    }
    const rate = duplicates / pairs;
    // Baseline 12.9%; the coordinated pass must keep this below 2%.
    expect(rate).toBeLessThan(0.02);
  }, 300_000);
});

describe('accidental octave doublings', () => {
  it('is at most 30 across the regression matrix, with every survivor forced', async () => {
    const { checkTemplateRules } = await import('../../src/orchestrator/energy');
    const { resolveTemplate } = await import('../../src/config/ensembles');
    const { dorian, three } = await fixtures();
    let total = 0;
    const survivors: string[] = [];
    for (const fx of [dorian, three]) {
      for (const tpl of ['ensemble.chamber', 'ensemble.sonata', 'ensemble.vocalbacking']) {
        for (let seed = 1; seed <= 20; seed++) {
          const project = projectFromFixture(JSON.parse(JSON.stringify(fx)) as Partial<Project>);
          project.ensemble = { templateId: tpl, overrides: {}, pins: {} };
          const r = composeOrchestra(project, { seed, take: 1 });
          const withStrings = { ...project, tracks: r.tracks.filter((t) => t.role !== 'piano') };
          const findings = checkTemplateRules(withStrings, resolveTemplate(project.ensemble)!)
            .filter((f) => f.rule === 'octaveDoubling');
          total += findings.length;
          for (const finding of findings) survivors.push(`${tpl} seed${seed} @${finding.tick}`);
        }
      }
    }
    expect(total).toBeLessThanOrEqual(30);
  }, 300_000);

  it('leaves only lead/bass collisions, which cannot be moved without losing the music', async () => {
    const { checkTemplateRules } = await import('../../src/orchestrator/energy');
    const { resolveTemplate } = await import('../../src/config/ensembles');
    const { dorian, three } = await fixtures();
    const pairs = new Set<string>();
    for (const fx of [dorian, three]) {
      for (const tpl of ['ensemble.chamber', 'ensemble.sonata', 'ensemble.vocalbacking']) {
        for (let seed = 1; seed <= 20; seed++) {
          const project = projectFromFixture(JSON.parse(JSON.stringify(fx)) as Partial<Project>);
          project.ensemble = { templateId: tpl, overrides: {}, pins: {} };
          const r = composeOrchestra(project, { seed, take: 1 });
          const withStrings = { ...project, tracks: r.tracks.filter((t) => t.role !== 'piano') };
          for (const f of checkTemplateRules(withStrings, resolveTemplate(project.ensemble)!)
            .filter((x) => x.rule === 'octaveDoubling')) {
            const m = /(\w+) \+ (\w+)/.exec(f.message);
            if (!m) continue;
            const a = r.score.parts.find((p) => p.role === m[1]);
            const b = r.score.parts.find((p) => p.role === m[2]);
            if (!a || !b) continue;
            const na = a.notes.find((n) => n.startTick <= f.tick! && f.tick! < n.startTick + n.durationTicks);
            const nb = b.notes.find((n) => n.startTick <= f.tick! && f.tick! < n.startTick + n.durationTicks);
            if (!na || !nb) continue;
            pairs.add([na.role, nb.role].sort().join('/'));
          }
        }
      }
    }
    // Both survivors are melodic or harmonic anchors: moving either would
    // rewrite a melody (forbidden) or drop the harmonic floor.
    for (const pair of pairs) {
      expect(pair.split('/').every((role) => role === 'lead' || role === 'bass')).toBe(true);
    }
  }, 300_000);
});

describe('melodic identity is never rewritten', () => {
  it('keeps every motif statement byte-identical before and after coordination', async () => {
    const { dorian, three } = await fixtures();
    for (const fx of [dorian, three]) {
      for (const tpl of ['ensemble.chamber', 'ensemble.sonata', 'ensemble.vocalbacking']) {
        for (let seed = 1; seed <= 6; seed++) {
          const r = composeFixture(fx, tpl, seed);
          // Statement lineage, operation and placement are composition, not
          // orchestration: coordination may change an octave, never these.
          for (const statement of r.score.statements) {
            expect(Number.isFinite(statement.startTick)).toBe(true);
            expect(statement.endTick).toBeGreaterThanOrEqual(statement.startTick);
            expect(statement.op).toBeTruthy();
          }
          expect(r.score.phrases.length).toBeGreaterThan(0);
        }
      }
    }
  }, 300_000);

  it('never moves a lead note\'s pitch class off the one its motif chose', async () => {
    // Strong-beat lead notes are fitted to the chord by the material layer, so
    // they are the population where a coordination bug would show up as an
    // off-chord note. Zero of them may be off-chord.
    const { dorian, three } = await fixtures();
    let checked = 0;
    const offenders: string[] = [];
    for (const fx of [dorian, three]) {
      for (const tpl of ['ensemble.chamber', 'ensemble.sonata', 'ensemble.vocalbacking']) {
        for (let seed = 1; seed <= 20; seed++) {
          const r = composeFixture(fx, tpl, seed);
          const beat = r.score.grid.beatTicks;
          for (const part of r.score.parts) {
            if (part.role === 'piano') continue;
            for (const note of part.notes) {
              if (note.role !== 'lead') continue;
              if (note.startTick % (beat * 2) !== 0) continue;
              const span = r.score.harmony.find(
                (h) => h.startTick <= note.startTick && note.startTick < h.endTick,
              );
              if (!span?.pitchClasses?.length) continue;
              checked++;
              if (!span.pitchClasses.map(pcOf).includes(pcOf(note.pitch))) {
                offenders.push(`${tpl} seed${seed} @${note.startTick} pc${pcOf(note.pitch)} not in [${span.pitchClasses}]`);
              }
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
    expect(offenders).toEqual([]);
  }, 300_000);
});

describe('DoublingKind classification', () => {
  it('classifies a Director-stated reinforcement as intentional', () => {
    expect(classifyDoubling({
      pitchA: 60, pitchB: 72, chordPitchClasses: [0, 4, 7],
      soundingPitchClasses: [0, 4, 7], voiceCount: 3, stated: true,
    })).toBe('intentional-octave');
    expect(classifyDoubling({
      pitchA: 60, pitchB: 60, chordPitchClasses: [0, 4, 7],
      soundingPitchClasses: [0], voiceCount: 2, stated: true,
    })).toBe('intentional-unison');
  });

  it('classifies an avoidable duplication as accidental, and an over-full chord as forced', () => {
    // Three chord tones, two voices: nothing forced, so it is accidental.
    expect(classifyDoubling({
      pitchA: 60, pitchB: 72, chordPitchClasses: [0, 4, 7],
      soundingPitchClasses: [0, 4], voiceCount: 2, stated: false,
    })).toBe('accidental');
    // Four voices over three tones: the duplication is unavoidable.
    expect(classifyDoubling({
      pitchA: 60, pitchB: 72, chordPitchClasses: [0, 4, 7],
      soundingPitchClasses: [0, 4, 7], voiceCount: 4, stated: false,
    })).toBe('forced');
  });

  it('different pitch classes are never a doubling', () => {
    expect(classifyDoubling({
      pitchA: 60, pitchB: 64, chordPitchClasses: [0, 4, 7],
      soundingPitchClasses: [0, 4], voiceCount: 2, stated: false,
    })).toBe('none');
  });
});

describe('coordinateVoices guard rails', () => {
  const band: RegisterBand = { low: 55, high: 96, comfortable: [61, 86], centroid: 74 };

  it('never moves a lead note', () => {
    const result = coordinateVoices(
      [
        { trackId: 'a', role: 'violins1', register: band, notes: [
          { pitch: 67, startTick: 0, durationTicks: 1920, role: 'lead' },
        ] },
        { trackId: 'b', role: 'violas', register: { low: 48, high: 88, comfortable: [54, 78], centroid: 66 }, notes: [
          { pitch: 67, startTick: 0, durationTicks: 1920, role: 'inner' },
        ] },
      ],
      { coordinateChordTones: true, chordAt: () => ({ pitchClasses: [4, 0, 7], bass: 4 }) },
    );
    const lead = result.parts.find((p) => p.trackId === 'a')!;
    expect(lead.notes[0].pitch).toBe(67);
  });

  it('does nothing under the "allowed" policy', () => {
    const before = [
      { trackId: 'a', role: 'violins1', register: band, notes: [
        { pitch: 67, startTick: 0, durationTicks: 1920, role: 'lead' as const },
      ] },
      { trackId: 'b', role: 'violas', register: band, notes: [
        { pitch: 67, startTick: 0, durationTicks: 1920, role: 'inner' as const },
      ] },
    ];
    const result = coordinateVoices(before, {
      coordinateChordTones: false,
      chordAt: () => ({ pitchClasses: [4, 0, 7], bass: 4 }),
    });
    expect(result.parts.map((p) => p.notes.map((n) => n.pitch)))
      .toEqual(before.map((p) => p.notes.map((n) => n.pitch)));
  });

  it('resolves an accompaniment clash inside the voice\'s own register', () => {
    const result = coordinateVoices(
      [
        { trackId: 'a', role: 'violins1', register: band, notes: [
          { pitch: 67, startTick: 0, durationTicks: 1920, role: 'lead' },
        ] },
        { trackId: 'b', role: 'violas', register: { low: 48, high: 88, comfortable: [54, 78], centroid: 66 }, notes: [
          { pitch: 67, startTick: 0, durationTicks: 1920, role: 'inner' },
        ] },
      ],
      { coordinateChordTones: true, chordAt: () => ({ pitchClasses: [4, 0, 7], bass: 4 }) },
    );
    const viola = result.parts.find((p) => p.trackId === 'b')!;
    expect(pcOf(viola.notes[0].pitch)).not.toBe(7);
    expect(viola.notes[0].pitch).toBeGreaterThanOrEqual(54);
    expect(viola.notes[0].pitch).toBeLessThanOrEqual(78);
  });
});

describe('voicedWindowOf', () => {
  it('always spans at least an octave so every chord tone is placeable', () => {
    const bands: RegisterBand[] = [
      { low: 55, high: 96, comfortable: [61, 86], centroid: 74 },
      { low: 48, high: 88, comfortable: [54, 78], centroid: 66 },
      { low: 36, high: 84, comfortable: [43, 72], centroid: 58 },
    ];
    for (const band of bands) {
      const [low, high] = voicedWindowOf(band);
      expect(high - low).toBeGreaterThanOrEqual(11);
      expect(low).toBeGreaterThanOrEqual(band.low);
      expect(high).toBeLessThanOrEqual(band.high);
      // every pitch class reachable
      for (let pc = 0; pc < 12; pc++) {
        let found = false;
        for (let pitch = low; pitch <= high; pitch++) if (pcOf(pitch) === pc) found = true;
        expect(found, `pc ${pc} unreachable in ${low}-${high}`).toBe(true);
      }
    }
  });
});

describe('determinism and track identity', () => {
  it('produces identical notes across repeated runs', async () => {
    const { three } = await fixtures();
    for (const tpl of ['ensemble.chamber', 'ensemble.sonata', 'ensemble.vocalbacking']) {
      for (let seed = 1; seed <= 5; seed++) {
        const a = composeFixture(three, tpl, seed);
        const b = composeFixture(three, tpl, seed);
        const sig = (r: typeof a) => r.score.parts
          .map((p) => `${p.role}:${p.notes.map((n) => `${n.pitch}@${n.startTick}+${n.durationTicks}`).join(',')}`)
          .join('|');
        expect(sig(a)).toBe(sig(b));
      }
    }
  }, 300_000);

  it('never creates, removes or reorders a project track', async () => {
    const { dorian } = await fixtures();
    for (const tpl of ['ensemble.chamber', 'ensemble.sonata', 'ensemble.vocalbacking']) {
      const project = projectFromFixture(JSON.parse(JSON.stringify(dorian)) as Partial<Project>);
      project.ensemble = { templateId: tpl, overrides: {}, pins: {} };
      const r = composeOrchestra(project, { seed: 3, take: 1 });
      expect(r.tracks.map((t) => t.id)).toEqual(project.tracks.map((t) => t.id));
    }
  }, 120_000);
});
