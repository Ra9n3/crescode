/**
 * Section context analysis (Phase 2).
 *
 * Two responsibilities, both purely descriptive:
 *
 * 1. resolveSectionIdentity — recognize the musical identity of a freely
 *    named section ("Final Chorus", "Verse 2", "pre-chorus", "Bridge A"…)
 *    through normalized keyword matching. Unknown names resolve to a neutral
 *    'unknown' identity with confidence 0 and remain fully supported; no
 *    naming convention is imposed.
 *
 * 2. analyzeSectionContext — place one section inside the whole arrangement:
 *    neighbors, energy deltas, normalized position, repetition group,
 *    structural boundaries. Facts only; the harmonic interpretation happens
 *    in profiles.ts.
 *
 * No React, no store, no randomness; identical inputs always produce
 * identical outputs. Sections are read in chronological order (stable sort
 * by startBar); the project's single time signature and the shared meter
 * utilities are used, so non-4/4 meters work as-is.
 */
import { DEFAULT_SECTION_ENERGY, type Project, type Section } from '../../shared/schema/types';
import { barTicks } from '../../shared/schema/meter';
import type {
  NeighborSummary, ResolvedSectionIdentity, SectionContext,
  SectionFamily, SectionIdentity,
} from './types';

/* --------------------------------------------------------------------------
 * Name normalization + identity recognition
 * ----------------------------------------------------------------------- */

/** Lowercase, strip diacritics, turn punctuation/symbols into spaces,
 *  collapse whitespace: "Pre-Chorus!" → "pre chorus". */
export function normalizeSectionName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A token plus its plural-stripped variants ("choruses" → choruses/chorus). */
function tokenVariants(token: string): string[] {
  if (token.endsWith('es')) return [token, token.slice(0, -2), token.slice(0, -1)];
  if (token.endsWith('s')) return [token, token.slice(0, -1)];
  return [token];
}

/** Recognized families, in deterministic scan priority order. Phrases are
 *  matched against the whole normalized name; tokens against plural-stripped
 *  name tokens. Deliberately conservative: no synonyms that could misfire. */
const FAMILY_KEYWORDS: ReadonlyArray<{ family: SectionFamily; tokens: string[]; phrases: string[] }> = [
  { family: 'intro', tokens: ['intro', 'introduction'], phrases: [] },
  { family: 'verse', tokens: ['verse'], phrases: [] },
  { family: 'prechorus', tokens: ['prechorus'], phrases: ['pre chorus'] },
  { family: 'chorus', tokens: ['chorus', 'refrain'], phrases: [] },
  { family: 'build', tokens: ['build', 'buildup'], phrases: ['build up'] },
  { family: 'bridge', tokens: ['bridge'], phrases: ['middle 8', 'middle eight'] },
  { family: 'breakdown', tokens: ['breakdown', 'break'], phrases: ['break down'] },
  { family: 'outro', tokens: ['outro', 'ending'], phrases: [] },
  { family: 'instrumental', tokens: ['instrumental'], phrases: [] },
  { family: 'interlude', tokens: ['interlude'], phrases: [] },
  { family: 'solo', tokens: ['solo'], phrases: [] },
  { family: 'transition', tokens: ['transition'], phrases: [] },
];

const FAMILY_TO_IDENTITY: Record<SectionFamily, SectionIdentity> = {
  intro: 'intro', verse: 'verse', prechorus: 'prechorus', chorus: 'chorus',
  build: 'build', bridge: 'bridge', breakdown: 'breakdown', outro: 'outro',
  instrumental: 'instrumental', interlude: 'interlude', solo: 'solo',
  transition: 'transition', reprise: 'reprise', unknown: 'unknown',
};

/**
 * Resolve a free-form section name to a normalized identity.
 *
 * - "Final Chorus" → chorus family + 'final' qualifier.
 * - "Verse 2"      → verse + explicitOccurrence 2.
 * - "Chorus Reprise" → identity 'reprise' inside the chorus family.
 * - "Coda"         → identity 'coda' inside the outro family.
 * - "Section A"    → unknown (neutral, confidence 0) — never guessed at.
 */
export function resolveSectionIdentity(name: string): ResolvedSectionIdentity {
  const normalized = normalizeSectionName(name);
  const tokens = normalized.length === 0 ? [] : normalized.split(' ');

  // Pass 1 — phrases (priority order). A matched phrase CONSUMES its words so
  // "Pre-Chorus" cannot also register a stray "chorus" token.
  const matched: SectionFamily[] = [];
  let remainingTokens = tokens;
  for (const entry of FAMILY_KEYWORDS) {
    for (const phrase of entry.phrases) {
      const pad = ` ${remainingTokens.join(' ')} `;
      if (pad.includes(` ${phrase} `)) {
        matched.push(entry.family);
        remainingTokens = pad.replace(` ${phrase} `, ' ').trim().split(/\s+/).filter(Boolean);
      }
    }
  }
  // Pass 2 — single tokens (plural-stripped) on whatever is left.
  const variants = remainingTokens.flatMap(tokenVariants);
  for (const entry of FAMILY_KEYWORDS) {
    if (entry.tokens.some((t) => variants.includes(t))) matched.push(entry.family);
  }

  const isReprise = variants.includes('reprise');
  const isCoda = variants.includes('coda');

  let identity: SectionIdentity;
  let family: SectionFamily;
  if (isReprise) {
    // "Chorus Reprise" reprises the chorus; a bare "Reprise" stands alone.
    identity = 'reprise';
    family = matched[0] ?? 'reprise';
  } else if (matched.length > 0) {
    family = matched[0];
    identity = FAMILY_TO_IDENTITY[family];
  } else if (isCoda) {
    identity = 'coda';
    family = 'outro';
  } else {
    identity = 'unknown';
    family = 'unknown';
  }

  const qualifier: 'final' | null = variants.includes('final') || variants.includes('last')
    ? 'final' : null;
  const numeric = remainingTokens.find((t) => /^[0-9]{1,2}$/.test(t));
  const explicitOccurrence = numeric ? parseInt(numeric, 10) : null;

  // Confidence counts CONFLICTING families; reprise/coda are modifiers (like
  // 'final'), not conflicts — "Chorus Reprise" is as clear as "Chorus".
  const distinctFamilies = new Set(matched);
  const confidence = distinctFamilies.size === 0
    ? (isReprise || isCoda ? 0.95 : 0)
    : distinctFamilies.size === 1 ? 0.95 : 0.7;

  return { identity, family, qualifier, explicitOccurrence, confidence };
}

/* --------------------------------------------------------------------------
 * Section context within the arrangement
 * ----------------------------------------------------------------------- */

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Resolved section energy: the section's own value when finite, clamped to
 *  0..1, else the neutral default. Never throws on odd data. */
export function sectionEnergy(s: Pick<Section, 'energy'>): number {
  return typeof s.energy === 'number' && Number.isFinite(s.energy)
    ? clamp01(s.energy)
    : DEFAULT_SECTION_ENERGY;
}

/**
 * The grouping key that decides which sections count as "the same material".
 * Recognized families group by family; unrecognized names group by their
 * normalized name with pure-number tokens removed — so "Jam 1" and "Jam 2"
 * relate (numbering convention) while "Section A" and "Part B" stay apart.
 */
export function relationshipKey(name: string, family: SectionFamily): string {
  if (family !== 'unknown') return family;
  const stripped = normalizeSectionName(name)
    .split(' ')
    .filter((t) => !/^[0-9]{1,2}$/.test(t))
    .join(' ');
  return stripped.length > 0 ? stripped : normalizeSectionName(name);
}

/** Chronological order: stable sort by startBar (ties keep project order). */
export function sectionsInOrder(project: Pick<Project, 'sections'>): Section[] {
  return [...project.sections].sort((a, b) => a.startBar - b.startBar);
}

/**
 * Describe one section's place in the arrangement. Returns null when the
 * sectionId does not exist — callers decide how to handle that.
 *
 * Normalized positions use the span from the first section's start bar to
 * the last section's end bar, so leading/trailing gaps don't skew the frame;
 * a single-section song spans exactly 0→1.
 */
export function analyzeSectionContext(
  project: Pick<Project, 'sections' | 'timeSignature'>,
  sectionId: string,
): SectionContext | null {
  const ordered = sectionsInOrder(project);
  const index = ordered.findIndex((s) => s.id === sectionId);
  if (index === -1) return null;
  const section = ordered[index];
  const bt = barTicks(project.timeSignature);

  const resolved = resolveSectionIdentity(section.name);
  const key = relationshipKey(section.name, resolved.family);

  // Relationship group: chronological occurrences of the same key.
  const groupIds: string[] = [];
  for (const s of ordered) {
    if (relationshipKey(s.name, resolveSectionIdentity(s.name).family) === key) {
      groupIds.push(s.id);
    }
  }
  const occurrence = resolved.explicitOccurrence ?? (groupIds.indexOf(sectionId) + 1);
  const familyCount = groupIds.length;

  // Song frame over the sectioned span.
  const firstStart = Math.min(...ordered.map((s) => s.startBar));
  const lastEnd = Math.max(...ordered.map((s) => s.startBar - 1 + s.lengthBars));
  const spanBars = Math.max(1, lastEnd - firstStart);
  const startPos = clamp01((section.startBar - firstStart) / spanBars);
  const endPos = clamp01((section.startBar - 1 + section.lengthBars - firstStart) / spanBars);
  const center = (startPos + endPos) / 2;

  const energy = sectionEnergy(section);
  const prev = index > 0 ? ordered[index - 1] : null;
  const next = index < ordered.length - 1 ? ordered[index + 1] : null;
  const neighbor = (s: Section): NeighborSummary => {
    const r = resolveSectionIdentity(s.name);
    return { sectionId: s.id, name: s.name, identity: r.identity, family: r.family, energy: sectionEnergy(s) };
  };

  const energyDeltaFromPrevious = prev ? energy - sectionEnergy(prev) : null;
  const energyDeltaToNext = next ? sectionEnergy(next) - energy : null;
  const precedesMajorTransition = next !== null
    && (neighbor(next).family !== resolved.family || Math.abs(energyDeltaToNext ?? 0) >= 0.3);

  return {
    sectionId: section.id,
    name: section.name,
    identity: resolved.identity,
    family: resolved.family,
    qualifier: resolved.qualifier,
    confidence: resolved.confidence,
    occurrence,
    familyCount,
    isRepeated: familyCount > 1,
    startBar: section.startBar,
    lengthBars: section.lengthBars,
    endBar: section.startBar + section.lengthBars - 1,
    durationBars: section.lengthBars,
    durationTicks: section.lengthBars * bt,
    energy,
    energyExplicit: typeof section.energy === 'number' && Number.isFinite(section.energy),
    normalizedPosition: { start: startPos, center, end: endPos },
    isFirst: index === 0,
    isLast: index === ordered.length - 1,
    nearBeginning: center <= 0.2,
    nearEnd: center >= 0.8,
    previous: prev ? neighbor(prev) : null,
    next: next ? neighbor(next) : null,
    energyDeltaFromPrevious,
    energyDeltaToNext,
    precedesMajorTransition,
  };
}
