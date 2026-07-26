import * as THREE from 'three';

/**
 * Camera, lighting and ground for the play view.
 *
 * The camera is orthographic and fixed: no rotation, no perspective, no zoom during
 * play. That is a gameplay requirement rather than an aesthetic one — with hundreds
 * of enemies converging, the player must be able to judge distance at a glance, and
 * perspective foreshortening makes an enemy at the top of the screen read as farther
 * away than an equally distant one at the bottom.
 */

/** Camera tilt measured up from the ground plane, in degrees. Reveals model silhouettes. */
const CAMERA_PITCH_DEG = 55;

/**
 * How much of the screen's vertical extent a span along world Z occupies.
 *
 * Exported so scenes can fit the view to their contents instead of copying the pitch
 * and re-deriving it — getting the sine and cosine the wrong way round silently
 * mis-frames everything, which is easy to do and slow to notice.
 */
export const WORLD_Z_TO_SCREEN_Y = Math.sin(THREE.MathUtils.degToRad(CAMERA_PITCH_DEG));

/** How much of the screen's vertical extent a world-space height occupies. */
export const WORLD_Y_TO_SCREEN_Y = Math.cos(THREE.MathUtils.degToRad(CAMERA_PITCH_DEG));

/** Default world units visible vertically. Sets the effective play area, so it is a balance knob. */
const DEFAULT_VIEW_HEIGHT_UNITS = 26;

/** Ortho cameras do not scale with distance, so this only needs to clear the geometry. */
const CAMERA_DISTANCE = 80;

const GROUND_SIZE = 400;

export interface WorldView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  /** Point the camera orbits, on the ground plane. Later driven by the player. */
  readonly cameraTarget: THREE.Vector3;
  /**
   * World units visible vertically.
   *
   * Not a player-facing zoom — the play view keeps a fixed extent so that no one can
   * gain an information advantage by zooming out. It exists for developer scenes that
   * need to fit far more on screen than a run ever shows.
   */
  setViewHeight(units: number): void;
  /** Re-reads the canvas size and rebuilds the projection. Idempotent. */
  resize(): void;
  render(): void;
  dispose(): void;
}

export function createWorldView(canvas: HTMLCanvasElement): WorldView {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  // Cap at 2: beyond that the pixel count costs far more than it visibly adds, and
  // phone displays reporting 3–4 would tank the frame rate for nothing.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1410);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, CAMERA_DISTANCE * 4);
  const cameraTarget = new THREE.Vector3(0, 0, 0);

  // Offset from target to camera. Pitch is measured from the ground plane, so a
  // larger pitch means looking more steeply down.
  const pitch = THREE.MathUtils.degToRad(CAMERA_PITCH_DEG);
  const cameraOffset = new THREE.Vector3(
    0,
    Math.sin(pitch) * CAMERA_DISTANCE,
    Math.cos(pitch) * CAMERA_DISTANCE,
  );

  const placeCamera = (): void => {
    camera.position.copy(cameraTarget).add(cameraOffset);
    camera.lookAt(cameraTarget);
  };

  // Sky/ground bounce fill. Keeps the shadowed faces of voxel models from going flat
  // black, which is what makes blocky geometry read as solid rather than as a cutout.
  const hemisphere = new THREE.HemisphereLight(0xa8c4ff, 0x4a3a28, 1.1);
  scene.add(hemisphere);

  // Single directional light, offset from the camera axis so the three visible faces
  // of every box pick up distinct brightnesses.
  const sun = new THREE.DirectionalLight(0xfff2d8, 1.5);
  sun.position.set(-30, 60, 20);
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
    new THREE.MeshLambertMaterial({ color: 0x4e6b3a }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // Faint grid. Without any reference marks a flat colour plane gives no sense of
  // motion, so movement tuning in the next phase would be guesswork.
  const grid = new THREE.GridHelper(GROUND_SIZE, GROUND_SIZE / 2, 0x3d5530, 0x445e35);
  grid.position.y = 0.01;
  scene.add(grid);

  let viewHeightUnits = DEFAULT_VIEW_HEIGHT_UNITS;

  const resize = (): void => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;

    renderer.setSize(width, height, false);

    // Hold the vertical extent fixed and let width follow the aspect ratio. The
    // alternative — fixing width — would shrink a widescreen player's vertical
    // awareness, which matters more than horizontal in a top-down game.
    const aspect = width / height;
    const halfHeight = viewHeightUnits / 2;
    const halfWidth = halfHeight * aspect;
    camera.left = -halfWidth;
    camera.right = halfWidth;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
  };

  resize();
  placeCamera();

  return {
    renderer,
    scene,
    camera,
    cameraTarget,
    setViewHeight(units: number): void {
      if (!(units > 0)) {
        throw new RangeError(`view height must be positive, got ${units}`);
      }
      viewHeightUnits = units;
      resize();
    },
    resize,
    render() {
      placeCamera();
      renderer.render(scene, camera);
    },
    dispose() {
      ground.geometry.dispose();
      ground.material.dispose();
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      renderer.dispose();
    },
  };
}
