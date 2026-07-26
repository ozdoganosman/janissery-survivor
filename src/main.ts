import { startFixedStepLoop, TICK_SECONDS } from './core/loop';
import { createPerfOverlay } from './dev/perf-overlay';
import { createWorldView, type WorldView } from './render/scene';
import { disposeVoxelModels } from './render/voxel/models';
import { createModelsScene } from './scenes/models';
import { createPlayScene } from './scenes/play';
import type { GameScene, SceneFactory } from './scenes/types';

/**
 * Bootstrap and scene router.
 *
 * Everything scene-specific lives under `src/scenes/`; this file only wires the canvas,
 * the fixed-step loop and the instrumentation, so every scene is measured on identical
 * terms.
 */

const SCENES: Readonly<Record<string, SceneFactory>> = {
  play: createPlayScene,
  models: createModelsScene,
};

const params = new URLSearchParams(window.location.search);
const requestedScene = params.get('scene') ?? 'play';
const showOverlay = params.get('debug') === '1' || import.meta.env.DEV;

const bootMessage = document.querySelector<HTMLElement>('#boot');

/**
 * Replaces the loading text with an explanation.
 *
 * A blank dark page is the worst possible failure mode: a player whose browser or
 * driver refuses WebGL has no way to tell a broken game from a slow one.
 */
function reportFatal(message: string): void {
  if (bootMessage !== null) bootMessage.textContent = message;
}

const canvas = document.querySelector<HTMLCanvasElement>('#viewport');
if (canvas === null) {
  reportFatal('Beklenen canvas bulunamadı.');
  throw new Error('#viewport canvas is missing from index.html');
}

const sceneFactory = SCENES[requestedScene];
if (sceneFactory === undefined) {
  const known = Object.keys(SCENES).join(', ');
  reportFatal(`Bilinmeyen sahne "${requestedScene}". Seçenekler: ${known}`);
  throw new Error(`Unknown scene "${requestedScene}"; expected one of ${known}`);
}

let view: WorldView;
try {
  view = createWorldView(canvas);
} catch (cause) {
  reportFatal('Bu tarayıcı WebGL desteklemiyor ya da donanım hızlandırma kapalı.');
  throw cause;
}

let scene: GameScene;
try {
  scene = sceneFactory(view, params);
} catch (cause) {
  // Most likely a malformed model: `parseVoxelModel` throws with the offending path,
  // which is far more useful on screen than in a console nobody opened.
  reportFatal(`Sahne kurulamadı: ${cause instanceof Error ? cause.message : String(cause)}`);
  throw cause;
}

const overlay = showOverlay ? createPerfOverlay() : null;

let lastFrameMs = performance.now();
let bootCleared = false;
const loop = startFixedStepLoop({
  update(stepSeconds) {
    scene.update(stepSeconds);
  },

  render(alpha) {
    scene.render(alpha);

    if (!bootCleared) {
      // Only now is there something on screen worth revealing.
      bootCleared = true;
      bootMessage?.remove();
    }

    if (overlay !== null) {
      const now = performance.now();
      overlay.sample(now - lastFrameMs);
      lastFrameMs = now;
      const detail = scene.detail?.() ?? null;
      overlay.setDetail(detail === null ? `tick ${(TICK_SECONDS * 1000).toFixed(2)}ms` : detail);
    }
  },
});

window.addEventListener('resize', () => {
  view.resize();
});

// Vite replaces the module on edit without reloading the page; without this the old
// loop keeps running and rendering into a canvas the new module no longer owns.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    loop.stop();
    scene.dispose();
    overlay?.dispose();
    view.dispose();
    disposeVoxelModels();
  });
}
