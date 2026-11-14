/**
 * Strings composition mode (Strings V1, Stage 1).
 *
 * 'classic' is the existing string engine and stays the default: a caller
 * that omits the option, or passes anything unknown, gets classic strings.
 * 'v1' selects the Strings V1 path. It is reachable only through
 * `ComposeOptions.stringsComposition`; the app store never passes it.
 */
export type StringsCompositionMode = 'classic' | 'v1';

export const DEFAULT_STRINGS_COMPOSITION_MODE: StringsCompositionMode = 'classic';

export function resolveStringsCompositionMode(option: StringsCompositionMode | undefined | null): StringsCompositionMode {
  return option === 'v1' ? 'v1' : DEFAULT_STRINGS_COMPOSITION_MODE;
}
