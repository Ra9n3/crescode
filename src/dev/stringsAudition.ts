/// <reference types="vite/client" />
/**
 * Browser development defaults for local audition.
 *
 * Normal `npm run dev` Compose All uses Strings V1 AND Woodwinds V1,
 * without URL flags. Nothing is persisted and no project schema changes.
 * Production builds and non-browser/API callers keep their classic defaults.
 * The historical helper name is retained for existing callers/tests.
 */
import type { ComposeOptions } from '../orchestrator/compose';

export function devStringsAuditionOverride(): Pick<ComposeOptions, 'stringsComposition' | 'windsComposition'> {
  if (import.meta.env?.DEV !== true) return {};
  if (typeof window === 'undefined' || !window.location) return {};
  return { stringsComposition: 'v1', windsComposition: 'v1' };
}
