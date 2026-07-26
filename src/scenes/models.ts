import { createRng } from '../core/rng';
import { ANIMATION_KINDS, type AnimationKind } from '../render/voxel/animator';
import { createVoxelArmy, type VoxelArmy } from '../render/voxel/instanced';
import { WORLD_Y_TO_SCREEN_Y, WORLD_Z_TO_SCREEN_Y } from '../render/scene';
import { getVoxelModel, MODEL_IDS } from '../render/voxel/models';
import { createVoxelRig, type VoxelRig } from '../render/voxel/rig';
import { createStaticGround } from '../render/world/ground';
import type { GameScene, SceneFactory } from './types';

/**
 * Developer scene: `?scene=models`
 *
 * Two jobs. In front, one rigged figure per model cycling through every animation, so
 * a bad pivot or an inverted swing is visible at a glance instead of being discovered
 * on a 40-pixel-tall enemy. Behind them, a block of instanced figures, so the phase-1
 * performance target can be *measured* rather than asserted — the overlay reports draw
 * calls and triangles next to the frame time.
 *
 * The showcase figures turn slowly on the spot. A fixed viewing angle always hides
 * something: at one angle the janissary's sabre sat directly behind his torso and
 * looked as though it had never been built at all.
 *
 * `?count=N` sets the army size, `?zoom=N` overrides the auto-fitted view height.
 * Number keys switch the animation on the rigged figures.
 */

const DEFAULT_ARMY = 1000;
const SHOWCASE_SPACING = 4.2;
/** Where the showcase row stands, in world units toward the camera from the origin. */
const SHOWCASE_Z = 2.5;
/** Gap between the showcase row and the front of the army block. */
const ARMY_GAP = 2.5;
/** Roughly the crowding a real run produces, so the stress test resembles gameplay. */
const ARMY_SPACING = 0.8;
const SHOWCASE_TURNS_PER_SECOND = 0.08;

interface Showcase {
  readonly id: string;
  readonly rig: VoxelRig;
}

export const createModelsScene: SceneFactory = (view, params): GameScene => {
  const armySize = readPositiveInt(params.get('count'), DEFAULT_ARMY);

  const columns = Math.max(1, Math.ceil(Math.sqrt(armySize)));
  const rows = Math.ceil(armySize / columns);
  const armyFrontZ = -ARMY_GAP;
  const armyBackZ = armyFrontZ - (rows - 1) * ARMY_SPACING;

  // Fit the view to what is actually on screen instead of hard-coding a zoom, so
  // ?count=20 and ?count=4000 are both framed sensibly. Ground depth and figure
  // height project onto the screen by different factors, and both have to be counted:
  // leaving the height term out cropped the heads off the front row.
  const depth = SHOWCASE_Z - armyBackZ;
  const tallest = Math.max(...MODEL_IDS.map((id) => getVoxelModel(id).height));
  const fitted = Math.max(14, depth * WORLD_Z_TO_SCREEN_Y + tallest * WORLD_Y_TO_SCREEN_Y + 3);
  const zoom = readPositiveInt(params.get('zoom'), Math.round(fitted));
  view.setViewSpan(zoom);
  view.cameraTarget.set(0, 0, (SHOWCASE_Z + armyBackZ) / 2);

  // The shared view no longer ships a floor, since the play world needs one that
  // follows the player. A developer scene just wants something to stand on.
  const ground = createStaticGround();
  for (const object of ground.objects) view.scene.add(object);

  const showcases: Showcase[] = MODEL_IDS.map((id, index) => {
    const rig = createVoxelRig(getVoxelModel(id));
    const offset = (index - (MODEL_IDS.length - 1) / 2) * SHOWCASE_SPACING;
    rig.root.position.set(offset, 0, SHOWCASE_Z);
    view.scene.add(rig.root);
    return { id, rig };
  });

  let animation: AnimationKind = 'walk';
  for (const { rig } of showcases) rig.play(animation);

  // One army per model, split evenly, so both models are exercised under load.
  const armies: VoxelArmy[] = [];
  const rng = createRng(0x5eeded);
  const perModel = Math.max(1, Math.floor(armySize / MODEL_IDS.length));

  let placed = 0;
  for (const id of MODEL_IDS) {
    const remaining = armySize - placed;
    const isLast = id === MODEL_IDS[MODEL_IDS.length - 1];
    const share = isLast ? remaining : Math.min(perModel, remaining);
    if (share <= 0) break;

    const army = createVoxelArmy(getVoxelModel(id), { capacity: share });
    for (const mesh of army.meshes) view.scene.add(mesh);
    army.setCount(share);

    for (let i = 0; i < share; i++) {
      const slot = placed + i;
      const column = slot % columns;
      const row = Math.floor(slot / columns);
      const x = (column - (columns - 1) / 2) * ARMY_SPACING;
      const z = armyFrontZ - row * ARMY_SPACING;
      // Facing the camera, walking at slightly varied cadence with a random phase, so
      // the block reads as a crowd rather than a parade.
      army.setInstance(i, x, 0, z, Math.PI, 1.35 + rng.range(-0.25, 0.25), rng.next());
      const shade = rng.range(0.85, 1.08);
      army.setTint(i, shade, shade, shade);
    }
    army.flush();
    armies.push(army);
    placed += share;
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    const index = Number.parseInt(event.key, 10) - 1;
    if (Number.isNaN(index) || index < 0 || index >= ANIMATION_KINDS.length) return;
    animation = ANIMATION_KINDS[index];
    for (const { rig } of showcases) rig.play(animation);
  };
  window.addEventListener('keydown', onKeyDown);

  const geometryStats = MODEL_IDS.map((id) => {
    const model = getVoxelModel(id);
    const total = model.faceCount + model.culledFaceCount;
    const percent = total === 0 ? 0 : Math.round((model.culledFaceCount / total) * 100);
    return `${id} ${model.faceCount}f -${percent}% hidden  h=${model.height.toFixed(2)}`;
  });

  let spin = 0;

  return {
    update(stepSeconds: number): void {
      spin = (spin + stepSeconds * SHOWCASE_TURNS_PER_SECOND) % 1;
      for (const { rig } of showcases) {
        rig.update(stepSeconds);
        // One-shot animations hold their final frame, which makes "finished" and
        // "stuck" look identical. Replay them so the strike can actually be watched.
        if (rig.finished) rig.play(animation);
      }
      for (const army of armies) army.advance(stepSeconds);
    },

    render(): void {
      for (const { rig } of showcases) rig.root.rotation.y = spin * Math.PI * 2;
      view.render();
    },

    detail(): string {
      const info = view.renderer.info.render;
      const instances = armies.reduce((sum, army) => sum + army.count, 0);
      return [
        `anim ${animation}  (1-${String(ANIMATION_KINDS.length)} to switch)`,
        `instances ${instances}  draw calls ${info.calls}`,
        `tris ${info.triangles}`,
        ...geometryStats,
      ].join('\n');
    },

    dispose(): void {
      window.removeEventListener('keydown', onKeyDown);
      for (const { rig } of showcases) rig.dispose();
      for (const army of armies) army.dispose();
      ground.dispose();
    },
  };
};

function readPositiveInt(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
