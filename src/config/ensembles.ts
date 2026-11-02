import chamber from '../../specs/ensemble-templates/templates/chamber.json';
import cinematic from '../../specs/ensemble-templates/templates/cinematic.json';
import hybridStudio from '../../specs/ensemble-templates/templates/hybridstudio.json';
import sonata from '../../specs/ensemble-templates/templates/sonata.json';
import symphony from '../../specs/ensemble-templates/templates/symphony.json';
import vocalBacking from '../../specs/ensemble-templates/templates/vocalbacking.json';
import { validateEnsembleTemplate, type EnsembleTemplate } from '../shared/schema/ensembleTemplate';

/**
 * The shipped ensemble library, bundled for the app. Source of truth stays in
 * specs/ensemble-templates/templates/*.json; this loader validates every file
 * at module load, so a corrupt template fails fast instead of shipping.
 * Display order = the agreed lineup order.
 */

const RAW = [symphony, chamber, cinematic, sonata, vocalBacking, hybridStudio];

const validated = RAW.map((doc) => {
  const r = validateEnsembleTemplate(doc);
  if (!r.ok) {
    throw new Error(
      'Shipped ensemble template is invalid: '
      + r.errors.map((e) => `${e.path}: ${e.message}`).join('; '),
    );
  }
  return r.template;
});

export const ENSEMBLES: readonly EnsembleTemplate[] = validated;

export const ENSEMBLE_BY_ID: ReadonlyMap<string, EnsembleTemplate> = new Map(validated.map((t) => [t.id, t]));

export const ENSEMBLE_IDS: ReadonlySet<string> = new Set(ENSEMBLE_BY_ID.keys());
