/**
 * Development-only audition switch for Strings V1.
 *
 * Opening the DEV server with `?strings=v1` in the address makes Compose All
 * request the V1 string composition for that page load. Nothing is stored:
 * no setting, no project field, no UI control. Without the query parameter,
 * and in every production build, this returns no override and Compose All
 * runs exactly as before (classic strings).
 */
import type { ComposeOptions } from '../orchestrator/compose';

export function devStringsAuditionOverride(): Pick<ComposeOptions, 'stringsComposition'> {
  const env = (import.meta as unknown as { env?: { DEV?: boolean } }).env;
  if (!env || env.DEV !== true) return {};
  if (typeof window === 'undefined' || !window.location) return {};
  return new URLSearchParams(window.location.search).get('strings') === 'v1' ? { stringsComposition: 'v1' } : {};
}
