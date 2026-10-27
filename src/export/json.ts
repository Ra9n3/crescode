import { validateProject, type ValidationError } from '../shared/schema/validate';
import type { Project } from '../shared/schema/types';

export function exportProjectJson(p: Project): string {
  return JSON.stringify({ ...p, exportedAt: new Date().toISOString() }, null, 2);
}

export type ImportResult = { ok: true; project: Project } | { ok: false; errors: ValidationError[] };

/** Parses and validates a project JSON (.scorch or export). Strips exportedAt. */
export function importProjectJson(text: string): ImportResult {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [{ path: '', message: `Not valid JSON: ${(e as Error).message}` }] };
  }
  const v = validateProject(doc);
  if (!v.ok) return { ok: false, errors: v.errors };
  const { exportedAt, ...rest } = doc as Project & { exportedAt?: string };
  void exportedAt;
  return { ok: true, project: rest as Project };
}
