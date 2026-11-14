/**
 * Writes tests/strings-classic-fingerprints.json from the CLASSIC string
 * output (Strings V1 Stage 1). Run only to establish the baseline:
 *
 *   npx vite-node scripts/strings-classic-fingerprint.ts
 *
 * The option `stringsComposition` is never passed here, so the fingerprints
 * always describe the default classic path. The matching test
 * (tests/strings-classic-fingerprint.test.ts) only reads the file.
 */
import { writeFileSync } from 'node:fs';
import { FINGERPRINT_FILE, composeStringCell, fingerprintCells, fingerprintResult, stringCellId, type CellFingerprint, type FingerprintDocument } from '../tests/strings-v1-support';

const cells: Record<string, CellFingerprint> = {};
const started = Date.now();
for (const cell of fingerprintCells()) {
  const { project, result } = composeStringCell(cell, undefined);
  cells[stringCellId(cell)] = fingerprintResult(project, result);
}
const document: FingerprintDocument = {
  description: 'Classic string output fingerprints: six templates x three fixtures x takes 1 and 4 (seed 1, engine defaults), plus four configurations per template on dorian-16bars (seed 7 take 2, density 0.9, humanize off, moments off). Written by scripts/strings-classic-fingerprint.ts from the default (classic) path.',
  stringsComposition: 'classic',
  cells,
};
writeFileSync(FINGERPRINT_FILE, `${JSON.stringify(document, null, 1)}\n`);
console.log(`wrote ${Object.keys(cells).length} cells to ${FINGERPRINT_FILE} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
