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

/**
 * World units guaranteed visible along the *narrower* screen axis.
 *
 * Not simply the vertical extent. Holding the vertical extent fixed and letting the
 * width follow the aspect ratio works on a widescreen monitor and fails badly on a
 * phone held upright: a 390x844 window would show 26 units tall but only 12 wide, so
 * an enemy closing in from the side would be on top of the player in half the time it
 * takes on a desktop. Since this is a game about being surrounded, sight distance has
 * to be the same in every direction, whatever the screen.
 */
const DEFAULT_VIEW_SPAN_UNITS = 26;

/**
 * Narrowest aspect ratio the view will stretch for.
 *
 * Beyond this the long axis stops growing, so an extremely tall window does not end
 * up showing so much world that the figures become specks.
 */
const MIN_ASPECT = 0.55;

/** Ortho cameras do not scale with distance, so this only needs to clear the geometry. */
const CAMERA_DISTANCE = 80;

export interface WorldView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  /** Point the camera orbits, on the ground plane. Later driven by the player. */
  readonly cameraTarget: THREE.Vector3;
  /**
   * World units visible along the narrower screen axis.
   *
   * Not a player-facing zoom — the play view keeps a fixed span so that nobody can
   * gain an information advantage by zooming out. It exists for developer scenes that
   * need to fit far more on screen than a run ever shows.
   */
  setViewSpan(units: number): void;
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

  // No ground here. A fixed plane cannot serve a world the player walks thousands of
  // units across, so the ground belongs to `world/ground.ts`, which follows the
  // player. Scenes that want a floor ask for one.

  let viewSpanUnits = DEFAULT_VIEW_SPAN_UNITS;

  const resize = (): void => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;

    renderer.setSize(width, height, false);

    // Size the frustum so the *shorter* axis always spans `viewSpanUnits`, giving
    // every player the same reaction distance whatever the screen shape. On a
    // widescreen monitor that is the height, exactly as before; held upright it
    // becomes the width, and the view grows taller rather than pinching inwards.
    const aspect = width / height;
    const effectiveAspect = Math.max(aspect, MIN_ASPECT);
    const halfHeight = viewSpanUnits / 2 / Math.min(effectiveAspect, 1);
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
    setViewSpan(units: number): void {
      if (!(units > 0)) {
        throw new RangeError(`view span must be positive, got ${units}`);
      }
      viewSpanUnits = units;
      resize();
    },
    resize,
    render() {
      placeCamera();
      renderer.render(scene, camera);
    },
    dispose() {
      renderer.dispose();
    },
  };
}
