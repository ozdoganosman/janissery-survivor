import kandilJson from '../../../data/models/kandil.json';
import karakoncolosJson from '../../../data/models/karakoncolos.json';
import serviJson from '../../../data/models/servi.json';
import surJson from '../../../data/models/sur.json';
import yeniceriJson from '../../../data/models/yeniceri.json';
import { buildVoxelModel, type BuiltModel } from './builder';
import { parseVoxelModel } from './schema';

/**
 * The model registry.
 *
 * Models are imported rather than fetched, so they are validated and compiled into
 * geometry at first use with no network round trip and no loading state to design
 * around. Building is cached: a model's geometry is shared by every figure using it,
 * which is what lets the instanced renderer draw an army from one buffer.
 */

/** Models with limbs, shown side by side in the model debug scene. */
export const MODEL_IDS = ['yeniceri', 'karakoncolos'] as const;

/** Single-part scenery. Kept apart so the debug scene does not parade the trees. */
export const PROP_MODEL_IDS = ['sur', 'servi', 'kandil'] as const;

export type ModelId = (typeof MODEL_IDS)[number] | (typeof PROP_MODEL_IDS)[number];

const SOURCES: Readonly<Record<ModelId, unknown>> = {
  yeniceri: yeniceriJson,
  karakoncolos: karakoncolosJson,
  sur: surJson,
  servi: serviJson,
  kandil: kandilJson,
};

const cache = new Map<ModelId, BuiltModel>();

export function getVoxelModel(id: ModelId): BuiltModel {
  const cached = cache.get(id);
  if (cached !== undefined) return cached;

  const built = buildVoxelModel(parseVoxelModel(SOURCES[id]));
  cache.set(id, built);
  return built;
}

/**
 * Frees every cached model.
 *
 * Only needed when the module is being torn down — during a hot reload, or in a test
 * that wants a clean slate. Geometry is shared, so disposing while figures are still
 * on screen would leave them referencing freed buffers.
 */
export function disposeVoxelModels(): void {
  for (const model of cache.values()) model.dispose();
  cache.clear();
}
