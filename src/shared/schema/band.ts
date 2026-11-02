import { INSTRUMENTS } from './ranges';
import type { EnsembleTemplate } from './ensembleTemplate';
import type { Project, ProjectEnsemble } from './types';

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

/** Result of a track-header band flip. */
export type BandFlip =
  | { ok: true; role: string; nowIn: boolean; clearedTrackIds: string[]; project: Project }
  | { ok: false; reason: 'pinned' | 'notBand'; role: string };

/**
 * One click on a track header's IN/OUT button. Flips the track's instrument
 * role in or out of the band for this composition:
 *  - going OUT truly empties the piece of the instrument — every UNLOCKED
 *    track with the role loses its notes in the same undoable edit, so one
 *    Ctrl+Z brings the whole picture back;
 *  - a LOCKED track keeps its notes even when out — lock wins over OUT, so
 *    to truly silence a locked track the user unlocks it first;
 *  - a role pinned by project settings refuses the header (pins beat the
 *    button) — pins are changed in project settings, not here.
 * Pure: returns a new project, never mutates, never throws.
 */
export function flipBand(project: Project, trackId: string, template: EnsembleTemplate | null): BandFlip {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track || !BAND_ROLES.has(track.role)) return { ok: false, reason: 'notBand', role: track?.role ?? '' };
  const role = track.role;
  const ensemble = project.ensemble ?? freshEnsemble();
  if (ensemble.pins[role]) return { ok: false, reason: 'pinned', role };

  const nowIn = !isInBand(role, ensemble, template);
  const next: ProjectEnsemble = { ...ensemble, overrides: { ...ensemble.overrides, [role]: nowIn ? 'in' : 'out' } };

  // Going OUT empties the lane of every unlocked track carrying the role.
  const clearedTrackIds: string[] = [];
  const tracks = nowIn
    ? project.tracks
    : project.tracks.map((t) => {
        if (t.role !== role || t.locked || t.notes.length === 0) return t;
        clearedTrackIds.push(t.id);
        return { ...t, notes: [] };
      });

  return { ok: true, role, nowIn, clearedTrackIds, project: { ...project, ensemble: next, tracks } };
}

/** Result of changing a project-settings pin from the Settings dialog. */
export type PinChange =
  | { ok: true; role: string; pin: 'in' | 'out' | null; clearedTrackIds: string[]; project: Project }
  | { ok: false; reason: 'notBand' | 'noop'; role: string };

/**
 * Set or clear a project-settings pin for one instrument role. Pins ride over
 * EVERY band — "always in" joins even bands that do not roster the instrument,
 * "always out" removes it from every band (the band picker notes what is
 * missing). Rules:
 *  - pinning OUT truly empties the piece of the instrument — every UNLOCKED
 *    track with the role loses its notes in this same undoable edit, the same
 *    rule the track-header OUT follows; LOCK wins over pins, too;
 *  - pinning IN resurrects nothing — Compose All refills the lane;
 *  - the pin takes over the instrument: any track-header tweak beneath it is
 *    retired, so removing the pin later returns the instrument to whatever
 *    the band decides, not to a stale per-composition choice;
 *  - projects without an ensemble field gain a valid one;
 *  - asking for the pin the role already has changes nothing ('noop').
 * Pure: returns a new project, never mutates, never throws.
 */
export function setPin(project: Project, role: string, pin: 'in' | 'out' | null): PinChange {
  if (!BAND_ROLES.has(role)) return { ok: false, reason: 'notBand', role };
  const ensemble = project.ensemble ?? freshEnsemble();
  if ((ensemble.pins[role] ?? null) === pin) return { ok: false, reason: 'noop', role };

  const pins = { ...ensemble.pins };
  if (pin) pins[role] = pin;
  else delete pins[role];
  const overrides = { ...ensemble.overrides };
  delete overrides[role]; // the pin retires the header tweak beneath it
  const next: ProjectEnsemble = { ...ensemble, pins, overrides };

  // Pinning out empties the lane of every unlocked track carrying the role.
  const clearedTrackIds: string[] = [];
  let tracks = project.tracks;
  if (pin === 'out') {
    tracks = project.tracks.map((t) => {
      if (t.role !== role || t.locked || t.notes.length === 0) return t;
      clearedTrackIds.push(t.id);
      return { ...t, notes: [] };
    });
  }

  return { ok: true, role, pin, clearedTrackIds, project: { ...project, ensemble: next, tracks: clearedTrackIds.length ? tracks : project.tracks } };
}

/** Result of a template switch from the band picker. */
export interface BandApplyResult {
  project: Project;
  /** Roles playing in the new band, in roster order (every band role when template is null). */
  inRoles: string[];
  /** Lanes the switch emptied: now out of the band, unlocked, had notes. */
  sweptTrackIds: string[];
}

/**
 * Switching templates from the band picker = starting a new composition.
 * The templateId is replaced, every track-header choice resets (overrides
 * clear — they were per-composition), project-settings pins ride over, and
 * every UNLOCKED lane whose instrument is OUT of the new band is emptied —
 * the new piece truly lacks those instruments. One undoable edit restores
 * the whole previous composition. Selecting the band that is already active
 * with no header choices pending changes nothing (same project reference).
 * Pure: never mutates, never throws.
 */
export function applyTemplate(project: Project, template: EnsembleTemplate | null): BandApplyResult {
  const ensemble = project.ensemble ?? freshEnsemble();
  const roster = templateBandRoles(template);
  // Effective membership: pins ride over the roster; no template = everyone in.
  const member = (role: string) => {
    const pin = ensemble.pins[role];
    if (pin) return pin === 'in';
    return template ? roster.has(role) : true;
  };
  // Roster order first, then any pinned-in extras the roster does not name.
  const inRoles = template
    ? [...template.roster.map((r) => r.role), ...[...BAND_ROLES].filter((role) => !roster.has(role))].filter(member)
    : [...BAND_ROLES].filter(member);
  const next: ProjectEnsemble = { templateId: template?.id ?? null, overrides: {}, pins: { ...ensemble.pins } };

  const sweptTrackIds: string[] = [];
  let tracksChanged = false;
  const tracks = project.tracks.map((t) => {
    if (!BAND_ROLES.has(t.role)) return t;
    if (member(t.role) || t.locked || t.notes.length === 0) return t;
    tracksChanged = true;
    sweptTrackIds.push(t.id);
    return { ...t, notes: [] };
  });

  // Same band already on, no header choices pending, nothing to sweep → no-op.
  const sameBand = (project.ensemble?.templateId ?? null) === next.templateId;
  const noOverrides = Object.keys(ensemble.overrides).length === 0;
  if (sameBand && noOverrides && !tracksChanged) {
    return { project, inRoles, sweptTrackIds };
  }

  return { project: { ...project, ensemble: next, tracks: tracksChanged ? tracks : project.tracks }, inRoles, sweptTrackIds };
}
