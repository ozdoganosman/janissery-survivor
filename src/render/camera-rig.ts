import * as THREE from 'three';
import { smoothstep } from '../core/geom';

export const ZOOM_MIN = 2.5;
export const ZOOM_MAX = 80;
/** Camera elevation. Steep enough to read the plan like a miniature, low enough to see façades. */
const PITCH = (55 * Math.PI) / 180;
const DISTANCE = 300;

/**
 * An orthographic camera orbiting a point on the ground. Orthographic because a miniature
 * has no vanishing point: a house at the edge of the page is drawn the same size as one
 * in the middle.
 *
 * Inputs set goals; `update` eases the camera towards them, so wheel steps and key taps
 * turn into smooth motion.
 */
export class CameraRig {
  readonly camera: THREE.OrthographicCamera;
  /** Half the visible height, in world units. Smaller is closer. */
  zoom = 34;
  yaw = Math.PI * 0.18;
  readonly target = new THREE.Vector3(0, 0, 4);
  private goalZoom = this.zoom;
  private goalYaw = this.yaw;
  private readonly goalTarget = this.target.clone();
  private aspect = 1;
  private readonly bounds: number;

  constructor(
    mapHalfSize: number,
    private readonly heightAt: (x: number, z: number) => number,
  ) {
    this.bounds = mapHalfSize - 4;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, DISTANCE * 2);
    this.apply();
  }

  setAspect(aspect: number): void {
    this.aspect = aspect;
    this.apply();
  }

  /** How much the scene should look like a lit model rather than a flat page, 0..1. */
  get closeness(): number {
    return smoothstep(26, 11, this.zoom);
  }

  /** Moves the goal by a screen-space drag, in CSS pixels. */
  panPixels(dx: number, dy: number, viewHeight: number): void {
    const unitsPerPixel = (2 * this.zoom) / viewHeight;
    // Screen up is the camera's forward direction flattened onto the ground, and it is
    // foreshortened by the pitch.
    const fx = -Math.sin(this.goalYaw);
    const fz = -Math.cos(this.goalYaw);
    const rx = Math.cos(this.goalYaw);
    const rz = -Math.sin(this.goalYaw);
    const up = dy / Math.sin(PITCH);
    this.goalTarget.x += (-dx * rx + up * fx) * unitsPerPixel;
    this.goalTarget.z += (-dx * rz + up * fz) * unitsPerPixel;
    this.clampGoal();
  }

  /** Moves the goal in world units along the view's own axes (keyboard panning). */
  panWorld(right: number, forward: number): void {
    this.goalTarget.x += right * Math.cos(this.goalYaw) - forward * Math.sin(this.goalYaw);
    this.goalTarget.z += -right * Math.sin(this.goalYaw) - forward * Math.cos(this.goalYaw);
    this.clampGoal();
  }

  rotate(delta: number): void {
    this.goalYaw += delta;
  }

  /**
   * Zooms by a factor while keeping the ground point `anchor` (if given) under the cursor.
   */
  zoomBy(factor: number, anchor?: { x: number; z: number }): void {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.goalZoom * factor));
    const applied = next / this.goalZoom;
    if (anchor !== undefined) {
      this.goalTarget.x = anchor.x + (this.goalTarget.x - anchor.x) * applied;
      this.goalTarget.z = anchor.z + (this.goalTarget.z - anchor.z) * applied;
      this.clampGoal();
    }
    this.goalZoom = next;
  }

  /** Eases towards the goals. Returns true if anything moved, so the caller can redraw. */
  update(dt: number): boolean {
    const k = 1 - Math.exp(-dt * 14);
    const before = this.zoom + this.yaw + this.target.x + this.target.z;
    this.zoom += (this.goalZoom - this.zoom) * k;
    this.yaw += (this.goalYaw - this.yaw) * k;
    this.target.x += (this.goalTarget.x - this.target.x) * k;
    this.target.z += (this.goalTarget.z - this.target.z) * k;
    this.apply();
    return Math.abs(this.zoom + this.yaw + this.target.x + this.target.z - before) > 1e-5;
  }

  /** Jumps straight to the goals, skipping the easing (first frame, tests). */
  snap(): void {
    this.zoom = this.goalZoom;
    this.yaw = this.goalYaw;
    this.target.copy(this.goalTarget);
    this.apply();
  }

  setView(x: number, z: number, zoom: number, yaw = this.goalYaw): void {
    this.goalTarget.set(x, 0, z);
    this.goalZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
    this.goalYaw = yaw;
    this.clampGoal();
  }

  /**
   * The ground point under a screen position (normalised device coordinates), found by
   * marching the view ray down onto the height field.
   */
  pickGround(ndcX: number, ndcY: number): { x: number; z: number } | null {
    const origin = new THREE.Vector3(ndcX, ndcY, -1).unproject(this.camera);
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    // Start where the ray crosses a height above anything on the map.
    const top = 12;
    let t = (origin.y - top) / -dir.y;
    let prevT = t;
    const at = (tt: number): number =>
      origin.y + dir.y * tt - this.heightAt(origin.x + dir.x * tt, origin.z + dir.z * tt);
    for (let i = 0; i < 400; i++) {
      if (at(t) <= 0) {
        // Refine between the last point above ground and this one.
        let lo = prevT;
        let hi = t;
        for (let k = 0; k < 16; k++) {
          const mid = (lo + hi) / 2;
          if (at(mid) > 0) lo = mid;
          else hi = mid;
        }
        return { x: origin.x + dir.x * hi, z: origin.z + dir.z * hi };
      }
      prevT = t;
      t += 0.2;
    }
    return null;
  }

  private clampGoal(): void {
    this.goalTarget.x = Math.min(this.bounds, Math.max(-this.bounds, this.goalTarget.x));
    this.goalTarget.z = Math.min(this.bounds, Math.max(-this.bounds, this.goalTarget.z));
  }

  private apply(): void {
    const c = this.camera;
    c.left = -this.zoom * this.aspect;
    c.right = this.zoom * this.aspect;
    c.top = this.zoom;
    c.bottom = -this.zoom;
    const ground = this.heightAt(this.target.x, this.target.z);
    this.target.y = ground;
    c.position.set(
      this.target.x + Math.sin(this.yaw) * Math.cos(PITCH) * DISTANCE,
      ground + Math.sin(PITCH) * DISTANCE,
      this.target.z + Math.cos(this.yaw) * Math.cos(PITCH) * DISTANCE,
    );
    c.lookAt(this.target);
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
  }
}
