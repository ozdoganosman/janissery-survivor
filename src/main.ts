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

/** True once a frame has actually been drawn. Until then, any failure is fatal. */
let bootCleared = false;

/**
 * Replaces the loading text with an explanation.
 *
 * A blank dark page is the worst possible failure mode: a player whose browser or
 * driver refuses WebGL has no way to tell a broken game from a slow one.
 */
function reportFatal(message: string, detail = ''): void {
  if (bootMessage === null) return;
  bootMessage.replaceChildren();
  bootMessage.style.zIndex = '400';
  bootMessage.style.background = '#12100c';
  bootMessage.style.padding = '20px';

  const headline = document.createElement('p');
  headline.textContent = message;
  bootMessage.appendChild(headline);

  if (detail !== '') {
    // Selectable, wrapping, and on screen rather than in a console — a phone has no
    // console, and "it shows a grey screen" is a report nobody can act on.
    const technical = document.createElement('pre');
    technical.textContent = detail;
    technical.style.cssText =
      'margin-top:14px;max-width:min(560px,90vw);white-space:pre-wrap;word-break:break-word;' +
      'font-size:11px;line-height:1.5;color:#b9ad9c;text-align:left;user-select:text';
    bootMessage.appendChild(technical);
  }
}

/** What the device will admit about itself. Included in any failure report. */
function environmentReport(): string {
  const lines = [`ua: ${navigator.userAgent}`];
  lines.push(
    `screen: ${String(window.innerWidth)}x${String(window.innerHeight)} @${String(window.devicePixelRatio)}`,
  );
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') ?? probe.getContext('webgl');
    if (gl === null) {
      lines.push('webgl: yok');
    } else {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer =
        info === null ? '(bilinmiyor)' : String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
      lines.push(`webgl: var (${renderer})`);
      lines.push(`max texture: ${String(gl.getParameter(gl.MAX_TEXTURE_SIZE))}`);
    }
  } catch (cause) {
    lines.push(
      `webgl sorgusu hata verdi: ${cause instanceof Error ? cause.message : 'bilinmiyor'}`,
    );
  }
  return lines.join('\n');
}

/**
 * Anything thrown after setup, and anything that leaves the game not drawing.
 *
 * Both funnel to the same place because from the player's side they are the same
 * event: the screen never becomes a game. A phone has no console, so a failure that
 * only logs is a failure nobody can report.
 */
window.addEventListener('error', (event) => {
  if (bootCleared) return;
  reportFatal(
    'Oyun başlatılamadı.',
    `${event.message}\n${event.filename}:${String(event.lineno)}\n\n${environmentReport()}`,
  );
});
window.addEventListener('unhandledrejection', (event) => {
  if (bootCleared) return;
  const reason: unknown = event.reason;
  reportFatal(
    'Oyun başlatılamadı.',
    `${reason instanceof Error ? reason.message : String(reason)}\n\n${environmentReport()}`,
  );
});

/** Seconds of no drawn frame after which the game is assumed stuck rather than slow. */
const WATCHDOG_SECONDS = 12;

window.setTimeout(() => {
  if (bootCleared) return;
  reportFatal(
    'Oyun açılmadı. Bu bilgiyi bildirebilirsin:',
    `ilk kare ${String(WATCHDOG_SECONDS)} saniyede çizilmedi\n\n${environmentReport()}`,
  );
}, WATCHDOG_SECONDS * 1000);

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

/**
 * Context loss, reported rather than swallowed.
 *
 * A lost WebGL context is not an exception: three.js logs a warning and every draw
 * quietly becomes a no-op, so the game keeps running against a canvas that shows
 * nothing. On a phone that is indistinguishable from a hang, and it is the failure a
 * page holding too many contexts actually produces.
 */
canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  reportFatal(
    'Grafik bağlamı kayboldu. Sekmeyi yenilemek genelde çözer.',
    `webglcontextlost\n\n${environmentReport()}`,
  );
});

let view: WorldView;
try {
  view = createWorldView(canvas);
} catch (cause) {
  reportFatal(
    'Bu tarayıcı WebGL desteklemiyor ya da donanım hızlandırma kapalı.',
    `${cause instanceof Error ? cause.message : String(cause)}\n\n${environmentReport()}`,
  );
  throw cause;
}

let scene: GameScene;
try {
  scene = sceneFactory(view, params);
} catch (cause) {
  // Most likely a malformed model: `parseVoxelModel` throws with the offending path,
  // which is far more useful on screen than in a console nobody opened.
  reportFatal(
    'Sahne kurulamadı.',
    `${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}\n\n${environmentReport()}`,
  );
  throw cause;
}

const overlay = showOverlay ? createPerfOverlay() : null;

let lastFrameMs = performance.now();
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
