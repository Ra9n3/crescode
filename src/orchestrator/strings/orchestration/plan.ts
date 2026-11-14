/** Piece-level orchestration intentions. No MIDI or note writing.
 * All preference functions depend on musical facts, not a seed-indexed menu.
 * The V2 identity remains solely responsible for thematic decisions. */
import type { StringsV1VoiceInput } from '../composition';
import type { TonalFrame } from '../material/line';
import type { Theme } from '../material/theme';
import type { PhrasePlan } from '../phrases/plan';
import { STRING_INSTRUMENT_IDS, STRING_INSTRUMENT_SOURCES, buildInstrumentCapabilities, triggerableArticulations } from '../characters/capabilities';

export const DESKS = ['violins1', 'violins2', 'violas', 'cellosBasses', 'basses'] as const;
export type Desk = typeof DESKS[number];
export type Duty = 'foreground' | 'answer' | 'support' | 'foundation' | 'motion';
export interface DeskCapability {
  readonly role: Desk;
  readonly trackId: string;
  readonly range: readonly [number, number];
  readonly triggerable: readonly string[];
}
export interface Contribution {
  readonly index: number;
  readonly phrase: number;
  readonly startTick: number;
  readonly endTick: number;
  readonly role: Desk;
  readonly duty: Duty;
  readonly target: number;
  readonly tessitura: readonly [number, number];
  readonly reason: string;
}
export interface OrchestrationPlan {
  readonly version: 'ensemble-v1';
  readonly facts: { readonly brightness: number; readonly openness: number; readonly density: number; readonly slope: number; readonly harmonicMotion: number; readonly chromaticShare: number };
  readonly capabilities: readonly DeskCapability[];
  readonly unavailable: readonly { readonly role: Desk; readonly reason: string }[];
  readonly opening: { readonly foreground: Desk | null; readonly untilTick: number; readonly reason: string };
  readonly contributions: readonly Contribution[];
  readonly withheld: readonly { readonly phrase: number; readonly role: Desk; readonly reason: string }[];
}
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const mean = (a: readonly number[]) => a.reduce((s, n) => s + n, 0) / Math.max(1, a.length);
const RANGES: Record<Desk, readonly [number, number]> = { violins1: [55, 88], violins2: [55, 86], violas: [48, 79], cellosBasses: [36, 69], basses: [28, 48] };
const CENTRES: Record<Desk, number> = { violins1: 78, violins2: 70, violas: 62, cellosBasses: 55, basses: 38 };

export function planOrchestration(input: StringsV1VoiceInput, frame: TonalFrame, theme: Theme, phrases: readonly PhrasePlan[]): OrchestrationPlan {
  const reserved = new Set(input.reservedTrackIds.map((r) => r.trackId));
  const tracks = input.orchestrationTracks ?? input.voiceTracks;
  const eligible = new Set(input.voiceTracks.map((t) => t.id));
  const capabilities: DeskCapability[] = [], unavailable: { role: Desk; reason: string }[] = [];
  for (const role of DESKS) {
    const track = tracks.find((t) => t.role === role && !t.locked && (eligible.has(t.id) || role === 'basses'));
    const instrument = STRING_INSTRUMENT_IDS.find((id) => STRING_INSTRUMENT_SOURCES[id].role === role);
    // The coordinated path runs AFTER the classic split has finished. Its
    // cello no longer feeds a later split. Legacy callers retain reservations.
    if (!track || !instrument || (!input.orchestrationTracks && reserved.has(track.id))) { unavailable.push({ role, reason: 'no eligible unlocked/exportable desk (or reserved by classic split)' }); continue; }
    const caps = buildInstrumentCapabilities(instrument);
    const triggerable = triggerableArticulations(caps);
    if (!triggerable.includes('legato') && !triggerable.includes('sustain')) { unavailable.push({ role, reason: 'no connected sound the profile can trigger' }); continue; }
    const range: readonly [number, number] = [Math.max(RANGES[role][0], caps.playableLow ?? 0, (caps.keyswitchZone?.high ?? -1) + 1, track.lowestNote), Math.min(RANGES[role][1], track.highestNote)];
    if (range[1] - range[0] < 6) { unavailable.push({ role, reason: 'configured track range leaves less than a fifth inside the physical/export window' }); continue; }
    capabilities.push({ role, trackId: track.id, range, triggerable });
  }
  const steps = theme.notes.map((n) => n.step), head = steps.slice(0, theme.headCount), tail = steps.slice(theme.headCount);
  const density = theme.notes.length / (theme.lengthTicks / frame.beatTicks);
  const chords = frame.harmony.chords;
  const chromaticShare = mean(chords.map((c) => c.reading.pitchClassesOutsideScale.length / Math.max(1, c.fact.pitchClasses.length)));
  const harmonicMotion = chords.slice(1).filter((c, i) => c.fact.rootPc !== chords[i].fact.rootPc).length / Math.max(1, chords.length - 1);
  const brightness = clamp((mean(steps) + 3) / 13 + (frame.scale[2] === 4 ? 0.08 : -0.04), 0, 1);
  const openness = clamp((Math.max(...steps) - Math.min(...steps) - 2) / 10 + chromaticShare * 0.3, 0, 1);
  const slope = clamp((mean(tail) - mean(head)) / 6, -1, 1);
  const available = (r: Desk) => capabilities.some((c) => c.role === r);
  const contributions: Contribution[] = [];
  const withheld: { phrase: number; role: Desk; reason: string }[] = [];
  const firstTwoTicks = theme.notes.length >= 2 ? theme.notes[1].tick + theme.notes[1].duration - theme.notes[0].tick : Infinity;
  const add = (phrase: number, a: number, b: number, role: Desk, duty: Duty, target: number, reason: string) => {
    const cap = capabilities.find((c) => c.role === role);
    if (!cap || b - a < frame.beatTicks) return;
    const centre = clamp(target, cap.range[0] + 3, cap.range[1] - 3);
    const half = duty === 'foreground' ? 10 : role === 'basses' ? 5 : 7;
    contributions.push({ index: contributions.length, phrase, startTick: a, endTick: b, role, duty, target: centre,
      tessitura: [Math.max(cap.range[0], Math.floor(centre - half)), Math.min(cap.range[1], Math.ceil(centre + half))], reason });
  };
  let opening: OrchestrationPlan['opening'] = { foreground: null, untilTick: 0, reason: 'no safe thematic window' };
  for (const [pi, phrase] of phrases.entries()) {
    const energy = mean(input.arc.filter((a) => a.bar >= Math.floor(phrase.startTick / frame.barTicks) + 1 && a.bar <= Math.ceil(phrase.endTick / frame.barTicks)).map((a) => a.target));
    const progress = pi / Math.max(1, phrases.length - 1);
    const desired = 58 + 2 * mean(steps) + 5 * (density - 1) + 4 * energy + slope * progress * 9;
    const rank = capabilities.filter((c) => c.role !== 'basses').map((c) => ({ role: c.role,
      cost: Math.abs(CENTRES[c.role] - desired) + (c.role === 'cellosBasses' && density > 1.15 ? 6 : 0) }));
    rank.sort((a, b) => a.cost - b.cost || DESKS.indexOf(a.role) - DESKS.indexOf(b.role));
    const leader = rank[0]?.role;
    if (!leader) continue;
    const intro = pi === 0 && (input.identity?.intent.patience ?? 0) > 0.8 && density < 1 && phrase.segments.length > 1;
    const cut = intro ? phrase.segments[0].endTick : phrase.startTick;
    if (pi === 0) opening = { foreground: intro ? null : leader, untilTick: intro ? cut : phrase.segments[0].endTick,
      reason: intro ? 'spacious patient subject: lower harmony prepares the later thematic continuation' : `theme centroid ${mean(steps).toFixed(2)}, density ${density.toFixed(2)}, register direction ${slope.toFixed(2)}: ${leader} can establish the idea` };
    if (cut < phrase.endTick) add(pi, cut, phrase.endTick, leader, 'foreground', CENTRES[leader] + (brightness - 0.5) * 5 + slope * progress * 7, `remembered ${phrase.development?.strategy ?? 'theme'}; tessitura follows energy and head-to-tail direction`);
    const foundation = available('basses') && (leader === 'cellosBasses' || openness > 0.45 || progress > 0.4 && energy > 0.55 && brightness > 0.35) ? 'basses'
      : available('cellosBasses') && leader !== 'cellosBasses' ? 'cellosBasses' : available('basses') ? 'basses' : undefined;
    const exposed = pi === 0 && brightness > 0.66 && density > 1.1 && (input.identity?.intent.patience ?? 1) < 0.4;
    const baseTarget = (r: Desk) => r === 'basses' ? 30 + 12 * brightness - 3 * openness + slope * progress * 5
      : r === 'cellosBasses' ? 43 + 14 * brightness + slope * progress * 6 : 53 + 10 * brightness;
    if (foundation && !exposed) add(pi, phrase.startTick, phrase.endTick, foundation, harmonicMotion > 0.7 && density < 1.1 ? 'motion' : 'foundation', baseTarget(foundation), 'a coordinated floor, not a copy of a provisional classic lower part');
    if (intro) {
      const lower = available('violas') ? 'violas' : available('cellosBasses') && foundation !== 'cellosBasses' ? 'cellosBasses' : undefined;
      if (lower) add(pi, phrase.startTick, cut, lower, 'support', baseTarget(lower), 'harmonic preparation; thematic entrance deliberately withheld');
    }
    // An independent middle layer is earned by available space/energy, not a
    // compulsory five-voice stack. Its target may lie ABOVE a low foreground.
    const inner = capabilities.filter((c) => c.role !== leader && c.role !== foundation && c.role !== 'basses')
      .sort((a, b) => Math.abs(CENTRES[a.role] - (desired - 9 + 7 * (1 - openness))) - Math.abs(CENTRES[b.role] - (desired - 9 + 7 * (1 - openness))));
    if (!exposed && !intro && inner[0] && (energy > 0.35 || density < 1)) {
      const r = inner[0].role;
      const target = r === 'cellosBasses' && foundation === 'basses'
        ? 55 + brightness * 10 + slope * progress * 5
        : CENTRES[r] - 6 + brightness * 5 + slope * progress * 5;
      add(pi, phrase.startTick, phrase.endTick, r, 'support', target,
        r === 'cellosBasses' && foundation === 'basses' ? 'Bass carries the floor: Cello is freed into a tenor counter-layer rather than recentered on D3' : 'complementary harmonic layer; centre allocated before foreground placement');
    }
    if (available('basses') && foundation === 'cellosBasses' && !exposed && !intro && progress > 0 && energy > 0.5 && density >= 1 && openness < 0.5)
      add(pi, phrase.startTick + frame.beatTicks, phrase.endTick, 'basses', 'support', 41 + 5 * brightness,
        'Cello owns the root floor; a delayed higher bass chord-tone layer reinforces the developed harmony without another root-only line');
    // The breath is an opportunity for another desk, not an assumption that
    // every lower writer needs two literal statements before thematic entry.
    const room = phrase.window.endTick - phrase.endTick;
    const answerer = capabilities.filter((c) => c.role !== leader && c.role !== foundation && c.role !== 'basses')
      .sort((a, b) => Math.abs(CENTRES[a.role] - (desired - 16)) - Math.abs(CENTRES[b.role] - (desired - 16)))[0];
    if (answerer && room >= Math.max(2 * frame.beatTicks, firstTwoTicks)) add(pi, phrase.endTick, phrase.window.endTick, answerer.role, 'answer', CENTRES[answerer.role] - 3 + slope * progress * 5, 'answer in the written breath; theme fragment must still fit its new harmony');
    else if (answerer) withheld.push({ phrase: pi, role: answerer.role, reason: 'breath cannot hold two unsqueezed head notes: planned silence, not a successful answer' });
    // Bass can state an augmented head when the other bass-register voice
    // carries the floor elsewhere. This is an opportunity, not a quota.
    if (available('basses') && foundation !== 'basses' && pi > 0) {
      if (room >= Math.max(2 * frame.beatTicks, firstTwoTicks * 2)) add(pi, phrase.endTick, phrase.window.endTick, 'basses', 'answer', 39 + 5 * brightness, 'low thematic reply after the foreground releases; no simultaneous bass duplication');
      else withheld.push({ phrase: pi, role: 'basses', reason: 'no room for an augmented head: silence instead of a token bass entry' });
    }
  }
  return { version: 'ensemble-v1', facts: { brightness, openness, density, slope, harmonicMotion, chromaticShare }, capabilities, unavailable, opening, contributions, withheld };
}
