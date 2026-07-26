/**
 * Frame-timing overlay.
 *
 * Hand-rolled rather than pulled from `stats.js` for two reasons: it is a few dozen
 * lines, and it reports the number that actually matters for this project — the
 * *worst* frame in the last second, not the average. A 60 FPS average hides a
 * periodic 40 ms hitch, and periodic hitches are exactly what a bad allocation
 * pattern in the hot loop produces.
 */

/** Frame time above which a frame counts as dropped at 60 Hz, in milliseconds. */
const FRAME_BUDGET_MS = 1000 / 60;

const REPORT_INTERVAL_MS = 500;

export interface PerfOverlay {
  /** Call once per rendered frame. */
  sample(frameMs: number): void;
  /** Adds a caller-owned line, e.g. entity counts. */
  setDetail(text: string): void;
  dispose(): void;
}

export function createPerfOverlay(parent: HTMLElement = document.body): PerfOverlay {
  const element = document.createElement('div');
  // A stable handle so tests and screenshots can find the readout without relying on
  // DOM order, which shifts whenever another overlay is added.
  element.id = 'perf-overlay';
  element.style.cssText = [
    'position:fixed',
    'top:8px',
    'left:8px',
    'padding:6px 9px',
    'font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace',
    'color:#d8f0c0',
    'background:rgba(12,10,8,0.72)',
    'border:1px solid rgba(216,240,192,0.22)',
    'border-radius:4px',
    'white-space:pre',
    'pointer-events:none',
    'z-index:100',
  ].join(';');
  parent.appendChild(element);

  let frames = 0;
  let accumulatedMs = 0;
  let worstMs = 0;
  let droppedFrames = 0;
  let sinceReportMs = 0;
  let detail = '';
  let summary = 'measuring…';

  const repaint = (): void => {
    element.textContent = detail === '' ? summary : `${summary}\n${detail}`;
  };

  repaint();

  return {
    sample(frameMs: number): void {
      if (!Number.isFinite(frameMs) || frameMs <= 0) return;

      frames++;
      accumulatedMs += frameMs;
      sinceReportMs += frameMs;
      if (frameMs > worstMs) worstMs = frameMs;
      // 1.5x rather than 1.0x: frames land slightly over budget constantly due to
      // vsync jitter, and counting those would make the number meaningless.
      if (frameMs > FRAME_BUDGET_MS * 1.5) droppedFrames++;

      if (sinceReportMs < REPORT_INTERVAL_MS) return;

      const averageMs = accumulatedMs / frames;
      summary =
        `${(1000 / averageMs).toFixed(0)} fps  avg ${averageMs.toFixed(1)}ms\n` +
        `worst ${worstMs.toFixed(1)}ms  dropped ${droppedFrames}`;
      repaint();

      frames = 0;
      accumulatedMs = 0;
      worstMs = 0;
      droppedFrames = 0;
      sinceReportMs = 0;
    },

    setDetail(text: string): void {
      detail = text;
      repaint();
    },

    dispose(): void {
      element.remove();
    },
  };
}
