import * as THREE from 'three';
import { createVoxelArmy, type VoxelArmy } from '../voxel/instanced';
import { getVoxelModel } from '../voxel/models';
import { cellIndex, propCapacity, propsAround, type PropKind, type ScatteredProp } from './scatter';

/**
 * The Broken Walls: ground that never ends, and scenery that stays put.
 *
 * A run lasts fifteen minutes at 5.6 units per second, so the player can end up
 * thousands of units from the origin. Rather than a vast plane, one modest plane
 * follows the player — but only in whole grid squares. Sliding it continuously would
 * drag its grid lines along underneath the player and destroy the very sense of
 * motion the grid exists to provide; snapping keeps the lines pinned to world space,
 * so the ground reads as fixed while the mesh quietly moves.
 *
 * Scenery is rebuilt only when the player crosses into a new cell, which at walking
 * pace is a couple of times a second at most, and costs a few hundred float writes.
 */

/** Ground mesh size. Must comfortably exceed the diagonal of the visible area. */
const GROUND_SIZE = 220;

/** Spacing of the grid lines, and the quantum the ground snaps to. */
const GRID_STEP = 2;

/** How many scenery cells out from the player to populate. */
const PROP_RADIUS_CELLS = 3;

export interface World {
  /** Everything to add to the scene. */
  readonly objects: readonly THREE.Object3D[];
  /** Re-centres the ground and refreshes scenery. Cheap when nothing has changed. */
  update(playerX: number, playerZ: number): void;
  /** Scenery instances currently placed, for the debug overlay. */
  get propCount(): number;
  dispose(): void;
}

const PROP_KINDS: readonly PropKind[] = ['sur', 'servi', 'kandil'];

export interface StaticGround {
  readonly objects: readonly THREE.Object3D[];
  dispose(): void;
}

/**
 * A plain floor that does not move or carry scenery.
 *
 * For developer scenes, which need something under the figures but have no player to
 * follow and would only be cluttered by ruins.
 */
export function createStaticGround(size = GROUND_SIZE): StaticGround {
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshLambertMaterial({ color: 0x4e6b3a }),
  );
  plane.rotation.x = -Math.PI / 2;

  const grid = new THREE.GridHelper(size, size / GRID_STEP, 0x3d5530, 0x445e35);
  grid.position.y = 0.01;

  return {
    objects: [plane, grid],
    dispose(): void {
      plane.geometry.dispose();
      (plane.material as THREE.Material).dispose();
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      plane.removeFromParent();
      grid.removeFromParent();
    },
  };
}

export function createWorld(worldSeed: number): World {
  const objects: THREE.Object3D[] = [];

  const groundGeometry = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE);
  const ground = new THREE.Mesh(groundGeometry, new THREE.MeshLambertMaterial({ color: 0x4e6b3a }));
  ground.rotation.x = -Math.PI / 2;
  objects.push(ground);

  const grid = new THREE.GridHelper(GROUND_SIZE, GROUND_SIZE / GRID_STEP, 0x3d5530, 0x445e35);
  grid.position.y = 0.01;
  objects.push(grid);

  const capacity = propCapacity(PROP_RADIUS_CELLS);
  const armies = new Map<PropKind, VoxelArmy>();
  for (const kind of PROP_KINDS) {
    const army = createVoxelArmy(getVoxelModel(kind), { capacity });
    for (const mesh of army.meshes) objects.push(mesh);
    armies.set(kind, army);
  }

  // Start deliberately outside any real cell so the first update always populates.
  let lastCellX = Number.NaN;
  let lastCellZ = Number.NaN;
  let propCount = 0;

  const place = (props: readonly ScatteredProp[]): void => {
    const nextIndex = new Map<PropKind, number>();
    for (const kind of PROP_KINDS) nextIndex.set(kind, 0);

    for (const prop of props) {
      const army = armies.get(prop.kind);
      const index = nextIndex.get(prop.kind) ?? 0;
      if (army === undefined || index >= army.capacity) continue;
      // Speed 0 leaves the shader's walk cycle switched off, so scenery stands still
      // while sharing the enemies' renderer rather than needing one of its own.
      army.setInstance(index, prop.x, 0, prop.z, prop.facing, 0, 0);
      army.setScale(index, prop.scale);
      nextIndex.set(prop.kind, index + 1);
    }

    propCount = 0;
    for (const kind of PROP_KINDS) {
      const army = armies.get(kind);
      const used = nextIndex.get(kind) ?? 0;
      if (army === undefined) continue;
      army.setCount(used);
      army.flush();
      propCount += used;
    }
  };

  return {
    objects,

    get propCount() {
      return propCount;
    },

    update(playerX: number, playerZ: number): void {
      ground.position.x = Math.round(playerX / GRID_STEP) * GRID_STEP;
      ground.position.z = Math.round(playerZ / GRID_STEP) * GRID_STEP;
      grid.position.x = ground.position.x;
      grid.position.z = ground.position.z;

      const cellX = cellIndex(playerX);
      const cellZ = cellIndex(playerZ);
      if (cellX === lastCellX && cellZ === lastCellZ) return;
      lastCellX = cellX;
      lastCellZ = cellZ;

      place(propsAround(worldSeed, playerX, playerZ, PROP_RADIUS_CELLS));
    },

    dispose(): void {
      groundGeometry.dispose();
      (ground.material as THREE.Material).dispose();
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      for (const army of armies.values()) army.dispose();
      for (const object of objects) object.removeFromParent();
    },
  };
}
