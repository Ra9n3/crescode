/**
 * Chord symbol parser. Never throws — invalid input returns { ok: false, error }.
 * Returns pitch classes in order: slash bass first (if any), then the chord
 * tones stacked from the root.
 */
export interface ParsedChord {
  symbol: string;
  root: number;
  rootName: string;
  quality: string;
  extensions: string[];
  bass: number | null;
  bassName: string | null;
  /** Intervals above root (may exceed 12) in stacking order. */
  intervals: number[];
  pitchClasses: number[];
}

export type ChordParseResult = { ok: true; chord: ParsedChord } | { ok: false; error: string };

const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Base quality table. Keys are matched longest-first, case-sensitive. */
const QUALITIES: Record<string, { name: string; iv: number[] }> = {
  '': { name: 'major', iv: [0, 4, 7] },
  maj: { name: 'major', iv: [0, 4, 7] },
  M: { name: 'major', iv: [0, 4, 7] },
  m: { name: 'minor', iv: [0, 3, 7] },
  min: { name: 'minor', iv: [0, 3, 7] },
  '-': { name: 'minor', iv: [0, 3, 7] },
  dim: { name: 'diminished', iv: [0, 3, 6] },
  '°': { name: 'diminished', iv: [0, 3, 6] },
  o: { name: 'diminished', iv: [0, 3, 6] },
  aug: { name: 'augmented', iv: [0, 4, 8] },
  '+': { name: 'augmented', iv: [0, 4, 8] },
  sus2: { name: 'sus2', iv: [0, 2, 7] },
  sus4: { name: 'sus4', iv: [0, 5, 7] },
  sus: { name: 'sus4', iv: [0, 5, 7] },
  '5': { name: 'power', iv: [0, 7] },
  '6': { name: '6', iv: [0, 4, 7, 9] },
  m6: { name: 'm6', iv: [0, 3, 7, 9] },
  '6/9': { name: '6/9', iv: [0, 4, 7, 9, 14] },
  '69': { name: '6/9', iv: [0, 4, 7, 9, 14] },
  'm6/9': { name: 'm6/9', iv: [0, 3, 7, 9, 14] },
  '7': { name: '7', iv: [0, 4, 7, 10] },
  maj7: { name: 'maj7', iv: [0, 4, 7, 11] },
  ma7: { name: 'maj7', iv: [0, 4, 7, 11] },
  M7: { name: 'maj7', iv: [0, 4, 7, 11] },
  'Δ': { name: 'maj7', iv: [0, 4, 7, 11] },
  'Δ7': { name: 'maj7', iv: [0, 4, 7, 11] },
  m7: { name: 'm7', iv: [0, 3, 7, 10] },
  min7: { name: 'm7', iv: [0, 3, 7, 10] },
  '-7': { name: 'm7', iv: [0, 3, 7, 10] },
  m7b5: { name: 'm7b5', iv: [0, 3, 6, 10] },
  'ø': { name: 'm7b5', iv: [0, 3, 6, 10] },
  'ø7': { name: 'm7b5', iv: [0, 3, 6, 10] },
  dim7: { name: 'dim7', iv: [0, 3, 6, 9] },
  '°7': { name: 'dim7', iv: [0, 3, 6, 9] },
  o7: { name: 'dim7', iv: [0, 3, 6, 9] },
  mMaj7: { name: 'mMaj7', iv: [0, 3, 7, 11] },
  mM7: { name: 'mMaj7', iv: [0, 3, 7, 11] },
  'm(maj7)': { name: 'mMaj7', iv: [0, 3, 7, 11] },
  minmaj7: { name: 'mMaj7', iv: [0, 3, 7, 11] },
  aug7: { name: 'aug7', iv: [0, 4, 8, 10] },
  '+7': { name: 'aug7', iv: [0, 4, 8, 10] },
  augmaj7: { name: 'augMaj7', iv: [0, 4, 8, 11] },
  '7sus4': { name: '7sus4', iv: [0, 5, 7, 10] },
  '7sus': { name: '7sus4', iv: [0, 5, 7, 10] },
  '7sus2': { name: '7sus2', iv: [0, 2, 7, 10] },
  '9': { name: '9', iv: [0, 4, 7, 10, 14] },
  maj9: { name: 'maj9', iv: [0, 4, 7, 11, 14] },
  M9: { name: 'maj9', iv: [0, 4, 7, 11, 14] },
  m9: { name: 'm9', iv: [0, 3, 7, 10, 14] },
  '9sus4': { name: '9sus4', iv: [0, 5, 7, 10, 14] },
  '11': { name: '11', iv: [0, 4, 7, 10, 14, 17] },
  m11: { name: 'm11', iv: [0, 3, 7, 10, 14, 17] },
  maj11: { name: 'maj11', iv: [0, 4, 7, 11, 14, 17] },
  '13': { name: '13', iv: [0, 4, 7, 10, 14, 21] },
  m13: { name: 'm13', iv: [0, 3, 7, 10, 14, 21] },
  maj13: { name: 'maj13', iv: [0, 4, 7, 11, 14, 21] },
  add9: { name: 'add9', iv: [0, 4, 7, 14] },
  add2: { name: 'add2', iv: [0, 2, 4, 7] },
  madd9: { name: 'madd9', iv: [0, 3, 7, 14] },
  add11: { name: 'add11', iv: [0, 4, 7, 17] },
  add4: { name: 'add4', iv: [0, 4, 5, 7] },
};
const QUALITY_KEYS = Object.keys(QUALITIES).sort((a, b) => b.length - a.length);

const EXT_DEGREE: Record<string, number> = { '2': 2, '4': 5, '5': 7, '6': 9, '7': 10, '9': 14, '11': 17, '13': 21 };

function parseNote(s: string): { pc: number; name: string; len: number } | null {
  const m = /^([A-G])(#|b|♯|♭)?/.exec(s);
  if (!m) return null;
  let pc = LETTER[m[1]];
  if (m[2] === '#' || m[2] === '♯') pc += 1;
  if (m[2] === 'b' || m[2] === '♭') pc -= 1;
  return { pc: (pc + 12) % 12, name: m[0], len: m[0].length };
}

export function parseChord(input: string): ChordParseResult {
  if (typeof input !== 'string') return { ok: false, error: 'Chord symbol must be text' };
  const symbol = input.trim();
  if (!symbol) return { ok: false, error: 'Empty chord symbol' };
  const root = parseNote(symbol);
  if (!root) return { ok: false, error: `"${symbol}": must start with a note letter A–G` };
  let rest = symbol.slice(root.len);

  // Slash bass: trailing /X where X is a note name (so "6/9" is not a slash chord).
  let bass: { pc: number; name: string } | null = null;
  const slash = /\/([A-G](?:#|b|♯|♭)?)$/.exec(rest);
  if (slash) {
    const b = parseNote(slash[1]);
    if (!b) return { ok: false, error: `"${symbol}": invalid bass note` };
    bass = b;
    rest = rest.slice(0, slash.index);
  }

  const qKey = QUALITY_KEYS.find((k) => rest.startsWith(k)) ?? '';
  const q = QUALITIES[qKey];
  const iv = [...q.iv];
  rest = rest.slice(qKey.length);
  const extensions: string[] = [];
  if (/\d$/.test(qKey) && /^\d/.test(rest)) return { ok: false, error: `"${symbol}": unexpected "${rest}"` };

  // Extensions/alterations: b5 #5 b9 #9 #11 b13 add9 9 11 13 sus2 sus4 no3 no5, optionally in parens/commas.
  let guard = 0;
  while (rest.length && guard++ < 20) {
    rest = rest.replace(/^[(),\s]+/, '');
    if (!rest.length) break;
    const m = /^(sus2|sus4|sus|no3|no5|add(?:b|#)?\d{1,2}|(?:b|#|♭|♯)\d{1,2}|maj7|\d{1,2})/.exec(rest);
    if (!m) return { ok: false, error: `"${symbol}": unrecognised "${rest}"` };
    const tok = m[0];
    rest = rest.slice(tok.length);
    extensions.push(tok);
    const third = iv.findIndex((x) => x === 3 || x === 4);
    if (tok === 'sus2' || tok === 'sus4' || tok === 'sus') {
      const v = tok === 'sus2' ? 2 : 5;
      if (third >= 0) iv[third] = v; else iv.push(v);
      continue;
    }
    if (tok === 'no3') { if (third >= 0) iv.splice(third, 1); continue; }
    if (tok === 'no5') { const i = iv.indexOf(7); if (i >= 0) iv.splice(i, 1); continue; }
    if (tok === 'maj7') { const i = iv.indexOf(10); if (i >= 0) iv[i] = 11; else iv.push(11); continue; }
    const am = /^(add)?(b|#|♭|♯)?(\d{1,2})$/.exec(tok)!;
    const deg = EXT_DEGREE[am[3]];
    if (deg === undefined) return { ok: false, error: `"${symbol}": unknown degree ${am[3]}` };
    const acc = am[2] === 'b' || am[2] === '♭' ? -1 : am[2] === '#' || am[2] === '♯' ? 1 : 0;
    const val = deg + acc;
    if (am[3] === '5' && acc !== 0) {
      const i = iv.indexOf(7);
      if (i >= 0) iv[i] = val; else iv.push(val);
      continue;
    }
    if (!am[1] && acc === 0 && deg > 10 && !iv.includes(10) && !iv.includes(11)) iv.push(10);
    if (!iv.includes(val)) iv.push(val);
  }
  if (rest.trim().length) return { ok: false, error: `"${symbol}": could not parse "${rest}"` };

  const sorted = [...iv].sort((a, b) => a - b);
  const pcs: number[] = [];
  if (bass) pcs.push(bass.pc);
  for (const i of sorted) {
    const pc = (root.pc + i) % 12;
    if (!pcs.includes(pc)) pcs.push(pc);
  }
  return {
    ok: true,
    chord: {
      symbol, root: root.pc, rootName: root.name, quality: q.name, extensions,
      bass: bass ? bass.pc : null, bassName: bass ? bass.name : null,
      intervals: sorted, pitchClasses: pcs,
    },
  };
}
