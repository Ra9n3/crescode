/**
 * Scorch design tokens — the single source of every color used by the UI.
 * Components reference these via CSS variables (see applyThemeVars) or directly
 * for canvas drawing. Do not hard-code colors elsewhere.
 *
 * Palette direction: "vintage analog hardware" — graphite control panels,
 * brushed aluminium plates, cream silkscreen print, chrome toggles and
 * coloured knob caps. Family colors are the channel colour coding of a desk.
 */
import type { TrackFamily } from '../shared/schema/types';

/** Channel colour coding — the coloured knob caps of a vintage desk. */
export const FAMILY_COLORS: Record<TrackFamily, string> = {
  Structure: '#b9b3aa',
  Audio: '#6fb7c8',
  Strings: '#e04b34',
  Brass: '#e8c86a',
  Woodwinds: '#8fc26a',
  Percussion: '#b58fd0',
  Keys: '#7fa8d9',
};

export const tokens = {
  /* graphite panels */
  bg0: '#171719',
  bg1: '#232326',
  bg2: '#2b2b2e',
  bg3: '#333336',
  bg4: '#414146',
  /* silkscreen rules */
  line: '#3d3d42',
  lineSoft: '#2a2a2e',
  lineStrong: '#55555c',
  /* cream print */
  text: '#e9e6e0',
  textDim: '#b3b0aa',
  textMute: '#7c7a76',
  /* lamp accents */
  accent: '#e2a04a',
  accentHi: '#f0be78',
  accentText: '#241a0c',
  danger: '#e04b34',
  success: '#8fc26a',
  warn: '#e8c86a',
  info: '#6fb7c8',
  mute: '#e2a04a',
  solo: '#c8d64f',
  lock: '#8fb8d9',
  freeze: '#79cfe0',
  playhead: '#e04b34',
  loop: 'rgba(111,183,200,0.16)',
  /* printed grid on graphite */
  barLine: 'rgba(233,230,224,0.11)',
  beatLine: 'rgba(233,230,224,0.045)',
  meterLow: '#8fc26a',
  meterMid: '#e8c86a',
  meterHigh: '#e04b34',
  waveform: '#6fb7c8',
  pianoWhite: '#2f2f33',
  pianoBlack: '#1c1c1f',
  overlay: 'rgba(10,10,11,0.72)',
  /* hardware surfaces */
  knobBody: '#3a3a3e',
  knobEdge: '#101012',
  capLight: '#c9c7c2',
  capDark: '#8b8985',
  slot: '#141416',
  plate: '#a3a19c',
  plateInk: '#26262a',
} as const;

export type TokenName = keyof typeof tokens;

/** Exposes tokens as CSS variables (--c-bg0 ...) and family colors (--fam-Strings ...). */
export function applyThemeVars(root: HTMLElement = document.documentElement) {
  for (const [k, v] of Object.entries(tokens)) root.style.setProperty(`--c-${k}`, v);
  for (const [k, v] of Object.entries(FAMILY_COLORS)) root.style.setProperty(`--fam-${k}`, v);
}

/** Mix a hex color with alpha. */
export function withAlpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/** Velocity → brightness for note rendering. */
export function velocityColor(hex: string, velocity: number): string {
  return withAlpha(hex, 0.35 + 0.65 * (velocity / 127));
}

/** Vertical shading for a channel's colour strip: lit at the top, deep at the foot. */
export function metalStrip(hex: string): string {
  return `linear-gradient(180deg, ${withAlpha(hex, 1)} 0%, ${withAlpha(hex, 0.8)} 38%, ${withAlpha(hex, 0.5)} 100%)`;
}
