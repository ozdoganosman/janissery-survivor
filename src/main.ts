import * as THREE from 'three';
import { startFixedStepLoop, TICK_SECONDS } from './core/loop';
import { createRng, seedFromString } from './core/rng';
import { createWorldView, type WorldView } from './render/scene';
import { createPerfOverlay } from './dev/perf-overlay';

/**
 * Phase 0 bootstrap.
 *
 * There is no game yet. What this file proves is that the foundation works
 * end-to-end: a fixed 60 Hz simulation, a render pass that interpolates between
 * simulation states, an orthographic top-down view, and a frame-timing readout. The
 * spinning placeholder exists specifically to make interpolation visible — a
 * constant-rate rotation is the easiest thing in which to spot the stutter that
 * appears when a 60 Hz simulation is drawn on a 144 Hz display without blending.
 */

const params = new URLSearchParams(window.location.search);
const showOverlay = params.get('debug') === '1' || import.meta.env.DEV;

const seedParam = params.get('seed');
const seed = seedParam === null ? 0x5eed1234 : seedFromString(seedParam);
const rng = createRng(seed);

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

let view: WorldView;
try {
  view = createWorldView(canvas);
} catch (cause) {
  reportFatal('Bu tarayıcı WebGL desteklemiyor ya da donanım hızlandırma kapalı.');
  throw cause;
}

const overlay = showOverlay ? createPerfOverlay() : null;

/** Placeholder stand-in for the player, replaced by a real voxel model in phase 1. */
const placeholder = new THREE.Group();
{
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 1.6, 0.8),
    new THREE.MeshLambertMaterial({ color: 0xb03a2e }),
  );
  body.position.y = 1.4;

  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.9, 0.9),
    new THREE.MeshLambertMaterial({ color: 0xe8d8b8 }),
  );
  head.position.y = 2.65;

  // The tall white cap is the single most recognisable part of a janissary
  // silhouette, so even the throwaway placeholder wears one.
  const cap = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 1.1, 0.8),
    new THREE.MeshLambertMaterial({ color: 0xf2efe6 }),
  );
  cap.position.y = 3.65;

  placeholder.add(body, head, cap);
  view.scene.add(placeholder);
}

/**
 * Simulation state.
 *
 * Two copies of every visible quantity: the state as of the last completed step, and
 * as of the one before it. The renderer blends between them. This shape is the one
 * the real entity buffers will follow in later phases.
 */
const sim = {
  spinRadians: 0,
  previousSpinRadians: 0,
  bobPhase: rng.next() * Math.PI * 2,
  previousBobPhase: 0,
};

const SPIN_PER_SECOND = Math.PI / 3;
const BOB_PER_SECOND = 2.2;

function update(stepSeconds: number): void {
  sim.previousSpinRadians = sim.spinRadians;
  sim.previousBobPhase = sim.bobPhase;
  sim.spinRadians += SPIN_PER_SECOND * stepSeconds;
  sim.bobPhase += BOB_PER_SECOND * stepSeconds;
}

function render(alpha: number): void {
  placeholder.rotation.y = THREE.MathUtils.lerp(sim.previousSpinRadians, sim.spinRadians, alpha);
  const bob = THREE.MathUtils.lerp(sim.previousBobPhase, sim.bobPhase, alpha);
  placeholder.position.y = Math.sin(bob) * 0.12;
  view.render();
}

let lastFrameMs = performance.now();
let bootCleared = false;
const loop = startFixedStepLoop({
  update,
  render(alpha) {
    render(alpha);

    if (!bootCleared) {
      // Only now is there something on screen worth revealing.
      bootCleared = true;
      bootMessage?.remove();
    }

    if (overlay !== null) {
      const now = performance.now();
      overlay.sample(now - lastFrameMs);
      lastFrameMs = now;
    }
  },
});

if (overlay !== null) {
  overlay.setDetail(`tick ${(TICK_SECONDS * 1000).toFixed(2)}ms  seed ${seed}`);
}

window.addEventListener('resize', () => {
  view.resize();
});

// Vite replaces the module on edit without reloading the page; without this the old
// loop keeps running and rendering into a canvas the new module no longer owns.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    loop.stop();
    overlay?.dispose();
    view.dispose();
  });
}
