/**
 * The shipped export profiles. The registry holds NO library or product
 * names — every display name and patch name comes from the profile JSON
 * itself. A profile that fails its validator throws at import time (shipped
 * data must validate).
 */
import uviOrchestralSuite from './uvi-orchestral-suite.json';
import { parseExportProfile, type ExportProfile } from '../profile';

export interface ExportProfileEntry {
  id: string;
  /** Display name — from the JSON, never hardcoded. */
  name: string;
  profile: ExportProfile;
}

const entry = (doc: unknown): ExportProfileEntry => {
  const profile = parseExportProfile(doc);
  return { id: profile.id, name: profile.name, profile };
};

export const EXPORT_PROFILES: ExportProfileEntry[] = [
  entry(uviOrchestralSuite),
];
