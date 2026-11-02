import { INSTRUMENTS } from './ranges';
import type { EnsembleTemplate } from './ensembleTemplate';
import type { ProjectEnsemble } from './types';

/**
 * Band membership (ensemble templates). A band decides which of the app's
 * existing instrument tracks take part in the current composition — it never
 * creates or deletes tracks. Precedence: project-settings pins beat
 * track-header overrides, overrides beat the template's default roster.
 * No template (templateId null, or a template that could not be resolved)
 * means every instrument track is in. Pure and deterministic — no I/O,
 * never throws.
 */

/** A fresh, fully-owned band state (no shared references with anything else). */
export const freshEnsemble = (): ProjectEnsemble => ({ templateId: null, overrides: {}, pins: {} });

/** Roles the band can manage: real instrument tracks (Strings/Brass/Woodwinds/Percussion/Keys). */
export const BAND_ROLES: ReadonlySet<string> = new Set(
  INSTRUMENTS.filter((d) => d.family !== 'Structure' && d.family !== 'Audio').map((d) => d.role),
);

/** The template's default band: its roster roles (empty when there is no template). */
export const templateBandRoles = (template: EnsembleTemplate | null): ReadonlySet<string> =>
  new Set(template ? template.roster.map((r) => r.role) : []);

/** Effective membership for one instrument role. */
export function isInBand(role: string, ensemble: ProjectEnsemble, template: EnsembleTemplate | null): boolean {
  const pin = ensemble.pins[role];
  if (pin) return pin === 'in';
  const override = ensemble.overrides[role];
  if (override) return override === 'in';
  if (!template) return true; // no band chosen: everyone is in
  return templateBandRoles(template).has(role);
}

/**
 * Template switch: the composition starts fresh. Overrides clear (they were
 * per-composition), pins stay (they are project-wide), templateId is replaced
 * by the caller.
 */
export const clearOverrides = (ensemble: ProjectEnsemble): ProjectEnsemble => ({
  ...ensemble,
  overrides: {},
});
