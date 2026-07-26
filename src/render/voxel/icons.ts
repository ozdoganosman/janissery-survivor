import * as THREE from 'three';
import itemModels from '../../../data/models/items.json';
import { buildVoxelModel, type BuiltModel } from './builder';
import { parseVoxelModel } from './schema';

/**
 * Item icons, rendered from the voxel models rather than drawn.
 *
 * The roadmap's rule was that icons come from the models and not from a separate art
 * pipeline, and the reason is maintenance: a weapon whose icon is a PNG drifts away
 * from the weapon the moment either changes, and nobody notices until someone
 * complains that the Yatağan card shows the old blade.
 *
 * Rendered once at startup, into data URIs, and then the renderer is thrown away. The
 * alternative — keeping fourteen live canvases in the HUD — costs a WebGL context and
 * a draw call each for pictures that never change.
 */

export const ITEM_ICON_IDS = Object.keys(itemModels) as ItemIconId[];
export type ItemIconId = keyof typeof itemModels;

/** Rendered size in device pixels. Small: these sit at 26 CSS px in the HUD. */
const ICON_SIZE = 96;

/**
 * How much of the frame the item fills.
 *
 * Under 1 so the silhouette has air around it — an icon cropped to its own edges
 * reads as a texture rather than an object.
 */
const FILL = 0.82;

const cache = new Map<ItemIconId, string>();
let built: Map<ItemIconId, BuiltModel> | null = null;

function models(): Map<ItemIconId, BuiltModel> {
  if (built !== null) return built;
  built = new Map();
  for (const id of ITEM_ICON_IDS) {
    built.set(id, buildVoxelModel(parseVoxelModel((itemModels as Record<string, unknown>)[id])));
  }
  return built;
}

/**
 * Renders every icon and returns them as data URIs.
 *
 * One renderer for all fourteen, disposed before returning. Creating a WebGL context
 * per icon is how a phone runs out of contexts and the whole HUD goes blank.
 */
export function renderItemIcons(): ReadonlyMap<ItemIconId, string> {
  if (cache.size > 0) return cache;

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  } catch {
    // A browser that refuses a second context still gets a playable game; the HUD
    // falls back to text labels.
    return cache;
  }

  renderer.setSize(ICON_SIZE, ICON_SIZE, false);
  renderer.setClearAlpha(0);

  const scene = new THREE.Scene();
  // Brighter than the world lighting, and deliberately. The roster's palettes are dark
  // browns and greys that read fine at world scale against grass; on a 26-pixel tile
  // over a dark HUD they collapse into identical black lumps. The fill from below is
  // what keeps the underside of a drum or a boot from going solid.
  const key = new THREE.DirectionalLight(0xfff4e0, 4.2);
  key.position.set(-0.7, 1, 1.1);
  const rim = new THREE.DirectionalLight(0xffd9a0, 2.4);
  rim.position.set(1, 0.4, -0.8);
  scene.add(key, rim, new THREE.AmbientLight(0xcfd8e4, 3.4));

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -200, 200);
  // Three-quarter view: a flat-on shot of a shield and a flat-on shot of a drum are
  // the same rectangle.
  camera.position.set(1, 0.72, 1.35);
  camera.lookAt(0, 0, 0);

  const group = new THREE.Group();
  scene.add(group);

  const box = new THREE.Box3();
  const centre = new THREE.Vector3();
  const corner = new THREE.Vector3();
  // The camera never moves, so world-to-camera rotation is computed once.
  const intoCamera = camera.quaternion.clone().invert();

  for (const [id, model] of models()) {
    group.clear();
    const meshes = model.parts.map(
      (part) =>
        new THREE.Mesh(
          part.geometry,
          new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.FrontSide }),
        ),
    );
    for (const mesh of meshes) group.add(mesh);

    // Framed from the item's own bounds rather than a shared constant, so a long
    // cannon and a small bead both end up filling the tile.
    box.setFromObject(group);
    box.getCenter(centre);
    group.position.set(-centre.x, -centre.y, -centre.z);
    group.updateMatrixWorld(true);

    // Measured in the camera's own space rather than guessed from the world-space
    // size. A tilted view projects part of an item's height onto the screen's
    // horizontal axis and part of its depth onto the vertical one, so any estimate
    // from the world extents alone under-frames some shapes and clips them — which is
    // exactly what a shield and a talisman did. Eight corners is the whole cost.
    let halfWidth = 0;
    let halfHeight = 0;
    for (let c = 0; c < 8; c++) {
      corner.set(
        (c & 1) === 0 ? box.min.x : box.max.x,
        (c & 2) === 0 ? box.min.y : box.max.y,
        (c & 4) === 0 ? box.min.z : box.max.z,
      );
      corner.sub(centre).applyQuaternion(intoCamera);
      halfWidth = Math.max(halfWidth, Math.abs(corner.x));
      halfHeight = Math.max(halfHeight, Math.abs(corner.y));
    }

    // Square frame from the larger axis, so every icon shares one scale of "tile" and
    // a wide item does not come out taller than a narrow one.
    const half = Math.max(halfWidth, halfHeight, 1e-3) / FILL;
    camera.left = -half;
    camera.right = half;
    camera.top = half;
    camera.bottom = -half;
    camera.updateProjectionMatrix();

    renderer.render(scene, camera);
    cache.set(id, renderer.domElement.toDataURL('image/png'));

    for (const mesh of meshes) (mesh.material as THREE.Material).dispose();
  }

  group.clear();
  renderer.dispose();
  renderer.forceContextLoss();
  return cache;
}

/** Frees the built geometry. The rendered URIs stay, since they are just strings. */
export function disposeItemIcons(): void {
  if (built === null) return;
  for (const model of built.values()) {
    for (const part of model.parts) part.geometry.dispose();
  }
  built = null;
}
