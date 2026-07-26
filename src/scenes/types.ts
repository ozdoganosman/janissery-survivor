import type { WorldView } from '../render/scene';

/**
 * A runnable screen.
 *
 * `main.ts` picks one by `?scene=` and drives it from the fixed-step loop. Splitting
 * this out now, rather than growing `main.ts`, is what lets the model debug screen and
 * the game share one bootstrap: identical loop, camera and instrumentation, so a
 * frame time measured in the debug scene means the same thing as one measured in play.
 */
export interface GameScene {
  /** Advance by one fixed simulation step. */
  update(stepSeconds: number): void;
  /** Draw, blending simulation states by `alpha` in [0, 1). */
  render(alpha: number): void;
  /** Extra lines for the performance overlay, or `null` for none. */
  detail?(): string | null;
  dispose(): void;
}

export type SceneFactory = (view: WorldView, params: URLSearchParams) => GameScene;
