import { parseNoteName } from './modes';
import { INSTRUMENTS } from './ranges';
import type { TrackFamily } from './types';
import type { ValidationError } from './validate';

/**
 * Ensemble templates: data-only descriptions of "which band is on stage" —
 * roster, budget and conductor rules. Pure score logic:
 * templates describe the arrangement, never the sound (no effects, no mixing,
 * no production concerns). Fully deterministic — validation never throws,
 * never mutates its input and reports every problem found.
 *
 * The documentation contract lives in specs/ensemble-templates/ensemble-template.schema.json.
 */

export const ENSEMBLE_FAMILIES: readonly TrackFamily[] = [
  'Structure', 'Audio', 'Strings', 'Brass', 'Woodwinds', 'Percussion', 'Keys',
];

export const RULE_TYPES: readonly string[] = [
  'overlapAvoid', 'octaveDoubling', 'fillGating', 'unisonOrnament',
];

export const RULE_MODES: readonly string[] = ['validate', 'generate', 'both'];

export const ORNAMENT_TRANSFORMS: readonly string[] = ['graceNote', 'slide', 'turn'];

export const OCTAVE_DOUBLING_POLICIES: readonly string[] = ['allowed', 'climaxOnly', 'forbidden'];

/** role -> family from the app instrument table, for cross-checking roster entries. */
const KNOWN_ROLE_FAMILY: Map<string, TrackFamily> = new Map(INSTRUMENTS.map((d) => [d.role, d.family]));

const ROLE_RE = /^[a-z][A-Za-z0-9]*$/;
const TEMPLATE_ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*(\.[a-z0-9]+)*$/;
const NOTE_NAME_RE = /^[A-G](#|b)?(-1|[0-9])$/;

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

export interface EnsembleRosterEntry {
  role: string;
  family: TrackFamily;
  /** Optional range hint for instruments not yet in the app instrument table. */
  low?: string;
  high?: string;
}

export interface EnsembleBudget {
  /** [min, max]. Max is a hard constraint; min is a soft directive. */
  energyClamp: [number, number];
  maxLayers: number;
}

export interface EnsembleRule {
  type: string;
  /** Intended use; default 'validate'. */
  mode?: string;
  params: Record<string, unknown>;
}

export interface EnsembleTemplate {
  id: string;
  name: string;
  description?: string;
  roster: EnsembleRosterEntry[];
  budget: EnsembleBudget;
  rules: EnsembleRule[];
}

export type EnsembleValidationResult =
  | { ok: true; template: EnsembleTemplate; errors: [] }
  | { ok: false; template: null; errors: ValidationError[] };

/** Validates an ensemble template document. Never throws; returns every problem found with a readable message. */
export function validateEnsembleTemplate(input: unknown): EnsembleValidationResult {
  const errors: ValidationError[] = [];
  const err = (path: string, message: string) => errors.push({ path, message });

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, template: null, errors: [{ path: '', message: 'Ensemble template must be a JSON object' }] };
  }
  const t = input as EnsembleTemplate;

  if (!isStr(t.id) || !TEMPLATE_ID_RE.test(t.id)) {
    err('id', `id must be a stable identifier like "ensemble.symphony" (got ${JSON.stringify(t.id)})`);
  }
  if (!isStr(t.name) || t.name.length < 1) err('name', 'name is required');
  if (t.description !== undefined && !isStr(t.description)) err('description', 'description must be text');

  // --- roster -------------------------------------------------------------
  if (!Array.isArray(t.roster) || t.roster.length < 1) {
    err('roster', 'roster must be a non-empty array of track entries');
  } else {
    if (t.roster.length > 64) err('roster', `roster must hold at most 64 tracks (got ${t.roster.length})`);
    const roles = new Set<string>();
    t.roster.forEach((e, i) => {
      const at = `roster[${i}]`;
      if (!e || typeof e !== 'object' || Array.isArray(e)) { err(at, 'roster entry must be an object'); return; }
      if (!isStr(e.role) || !ROLE_RE.test(e.role)) {
        err(`${at}.role`, `role must be lowerCamelCase like "violins1" (got ${JSON.stringify(e.role)})`);
      } else {
        if (roles.has(e.role)) err(at, `duplicate roster role "${e.role}" — one entry per track`);
        roles.add(e.role);
        const known = KNOWN_ROLE_FAMILY.get(e.role);
        if (known && e.family !== known) {
          err(`${at}.family`, `role "${e.role}" is family "${known}" in the app instrument table, not "${e.family}"`);
        }
      }
      if (!ENSEMBLE_FAMILIES.includes(e.family)) {
        err(`${at}.family`, `unknown family ${JSON.stringify(e.family)} (expected one of ${ENSEMBLE_FAMILIES.join(', ')})`);
      }
      const hasLow = e.low !== undefined;
      const hasHigh = e.high !== undefined;
      if (hasLow || hasHigh) {
        if (!hasLow || !hasHigh) {
          err(`${at}.range`, 'low and high must be provided together');
        } else if (!isStr(e.low) || !isStr(e.high) || !NOTE_NAME_RE.test(e.low) || !NOTE_NAME_RE.test(e.high)) {
          err(`${at}.range`, `range notes must be scientific pitch like "Bb3" or "C7" (got "${e.low}"–"${e.high}")`);
        } else {
          const lo = parseNoteName(e.low);
          const hi = parseNoteName(e.high);
          if (lo === null) err(`${at}.low`, `"${e.low}" is not a valid note name`);
          if (hi === null) err(`${at}.high`, `"${e.high}" is not a valid note name`);
          if (lo !== null && hi !== null && lo > hi) {
            err(`${at}.range`, `low must not exceed high (${e.low} = ${lo} > ${hi} = ${e.high})`);
          }
        }
      }
    });

    // --- budget -----------------------------------------------------------
    const b = t.budget as EnsembleBudget | undefined;
    if (!b || typeof b !== 'object' || Array.isArray(b)) {
      err('budget', 'budget is required (energyClamp + maxLayers)');
    } else {
      const clamp = b.energyClamp;
      if (!Array.isArray(clamp) || clamp.length !== 2 || !clamp.every(isNum) || clamp.some((v) => v < 0 || v > 1)) {
        err('budget.energyClamp', 'energyClamp must be [min, max] with both values in 0–1');
      } else if (clamp[0] > clamp[1]) {
        err('budget.energyClamp', `energyClamp min must not exceed max (got [${clamp[0]}, ${clamp[1]}])`);
      }
      if (!isInt(b.maxLayers) || b.maxLayers < 1 || b.maxLayers > 32) {
        err('budget.maxLayers', `maxLayers must be an integer 1–32 (got ${JSON.stringify(b.maxLayers)})`);
      } else if (Array.isArray(t.roster) && b.maxLayers > t.roster.length) {
        err('budget.maxLayers', `cannot run ${b.maxLayers} concurrent layers with only ${t.roster.length} roster tracks`);
      }
    }

    // --- rules --------------------------------------------------------------
    if (!Array.isArray(t.rules)) {
      err('rules', 'rules must be an array (possibly empty)');
    } else {
      t.rules.forEach((r, i) => {
        const at = `rules[${i}]`;
        if (!r || typeof r !== 'object' || Array.isArray(r)) { err(at, 'rule must be an object'); return; }
        if (!isStr(r.type) || !RULE_TYPES.includes(r.type)) {
          err(`${at}.type`, `unknown rule type ${JSON.stringify(r.type)} (expected one of ${RULE_TYPES.join(', ')})`);
          return;
        }
        if (r.mode !== undefined && !RULE_MODES.includes(r.mode)) {
          err(`${at}.mode`, `mode must be one of ${RULE_MODES.join(', ')} (got ${JSON.stringify(r.mode)})`);
        }
        const p = r.params;
        if (!p || typeof p !== 'object' || Array.isArray(p)) { err(`${at}.params`, 'params must be an object'); return; }

        const resolveTarget = (v: unknown, path: string): void => {
          if (!isStr(v)) { err(path, `must name a family or a roster role (got ${JSON.stringify(v)})`); return; }
          if (!ENSEMBLE_FAMILIES.includes(v as TrackFamily) && !roles.has(v)) {
            err(path, `"${v}" is neither a family (${ENSEMBLE_FAMILIES.join(', ')}) nor a roster role`);
          }
        };

        switch (r.type) {
          case 'overlapAvoid': {
            resolveTarget(p.actor, `${at}.params.actor`);
            resolveTarget(p.against, `${at}.params.against`);
            if (!isInt(p.windowTicks) || p.windowTicks < 1 || p.windowTicks > 7680) {
              err(`${at}.params.windowTicks`, `windowTicks must be an integer 1–7680 ticks (up to 8 beats at 960 PPQ, got ${JSON.stringify(p.windowTicks)})`);
            }
            break;
          }
          case 'octaveDoubling': {
            const policy = p.policy;
            if (!isStr(policy) || !OCTAVE_DOUBLING_POLICIES.includes(policy)) {
              err(`${at}.params.policy`, `policy must be one of ${OCTAVE_DOUBLING_POLICIES.join(', ')} (got ${JSON.stringify(policy)})`);
            } else if (policy === 'climaxOnly') {
              if (!isNum(p.energyThreshold) || p.energyThreshold <= 0 || p.energyThreshold > 1) {
                err(`${at}.params.energyThreshold`, `policy "climaxOnly" requires energyThreshold between 0 and 1 (got ${JSON.stringify(p.energyThreshold)})`);
              }
            } else if ('energyThreshold' in p) {
              err(`${at}.params.energyThreshold`, 'energyThreshold is only valid with policy "climaxOnly"');
            }
            break;
          }
          case 'fillGating': {
            resolveTarget(p.fills, `${at}.params.fills`);
            resolveTarget(p.duringRestsOf, `${at}.params.duringRestsOf`);
            if (!isInt(p.minGapTicks) || p.minGapTicks < 1 || p.minGapTicks > 7680) {
              err(`${at}.params.minGapTicks`, `minGapTicks must be an integer 1–7680 ticks (got ${JSON.stringify(p.minGapTicks)})`);
            }
            break;
          }
          case 'unisonOrnament': {
            const tracks = p.tracks;
            if (!Array.isArray(tracks) || tracks.length < 1 || tracks.length > 64 || !tracks.every(isStr)) {
              err(`${at}.params.tracks`, 'tracks must be an array of 1–64 roster roles');
            } else {
              tracks.forEach((role, j) => {
                if (!roles.has(role)) err(`${at}.params.tracks[${j}]`, `"${role}" is not in the roster`);
              });
            }
            const transforms = p.transforms;
            if (!Array.isArray(transforms) || transforms.length < 1 || !transforms.every((x) => isStr(x) && ORNAMENT_TRANSFORMS.includes(x))) {
              err(`${at}.params.transforms`, `transforms must be a non-empty array drawn from ${ORNAMENT_TRANSFORMS.join(', ')}`);
            }
            if (p.divergence !== undefined && p.divergence !== 'perInstrument') {
              err(`${at}.params.divergence`, `divergence must be "perInstrument" (got ${JSON.stringify(p.divergence)})`);
            }
            break;
          }
        }
      });
    }
  }

  return errors.length ? { ok: false, template: null, errors } : { ok: true, template: t, errors: [] };
}
