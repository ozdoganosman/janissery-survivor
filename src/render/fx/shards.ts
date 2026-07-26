import * as THREE from 'three';

/**
 * The burst of voxels a dying enemy comes apart into.
 *
 * Purely visual, so it lives in the render layer and never touches the simulation.
 * It matters more than it sounds: with hundreds of enemies dying, a kill that simply
 * makes a figure vanish leaves the player unsure whether anything happened. A short
 * scatter of cubes in the creature's own colours is the confirmation.
 *
 * One `InstancedMesh` and a fixed pool, like everything else here — a particle system
 * that allocates per death would fire dozens of times a second at the run's peak.
 */

const SHARD_CAPACITY = 900;
const SHARDS_PER_DEATH = 7;
const SHARD_LIFETIME = 0.55;
const GRAVITY = 14;

export interface ShardField {
  readonly object: THREE.Object3D;
  /** Scatters a burst at a point. Silently does nothing when the pool is full. */
  burst(x: number, z: number, rng: () => number): void;
  advance(stepSeconds: number): void;
  /** Rebuilds the instance matrices. `alpha` blends between simulation steps. */
  render(alpha: number): void;
  get count(): number;
  dispose(): void;
}

export function createShardField(color: number): ShardField {
  const geometry = new THREE.BoxGeometry(0.19, 0.19, 0.19);
  const material = new THREE.MeshLambertMaterial({ color });
  const mesh = new THREE.InstancedMesh(geometry, material, SHARD_CAPACITY);
  mesh.count = 0;
  mesh.frustumCulled = false;

  const x = new Float32Array(SHARD_CAPACITY);
  const y = new Float32Array(SHARD_CAPACITY);
  const z = new Float32Array(SHARD_CAPACITY);
  const previousX = new Float32Array(SHARD_CAPACITY);
  const previousY = new Float32Array(SHARD_CAPACITY);
  const previousZ = new Float32Array(SHARD_CAPACITY);
  const velocityX = new Float32Array(SHARD_CAPACITY);
  const velocityY = new Float32Array(SHARD_CAPACITY);
  const velocityZ = new Float32Array(SHARD_CAPACITY);
  const life = new Float32Array(SHARD_CAPACITY);
  const spin = new Float32Array(SHARD_CAPACITY);
  let count = 0;

  const scratch = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scale = new THREE.Vector3();

  const remove = (index: number): void => {
    const last = --count;
    if (index !== last) {
      x[index] = x[last];
      y[index] = y[last];
      z[index] = z[last];
      previousX[index] = previousX[last];
      previousY[index] = previousY[last];
      previousZ[index] = previousZ[last];
      velocityX[index] = velocityX[last];
      velocityY[index] = velocityY[last];
      velocityZ[index] = velocityZ[last];
      life[index] = life[last];
      spin[index] = spin[last];
    }
  };

  return {
    object: mesh,

    get count() {
      return count;
    },

    burst(originX: number, originZ: number, rng: () => number): void {
      for (let i = 0; i < SHARDS_PER_DEATH; i++) {
        if (count >= SHARD_CAPACITY) return;
        const index = count++;
        const angle = rng() * Math.PI * 2;
        const outward = 1.6 + rng() * 2.6;
        x[index] = originX;
        y[index] = 0.5 + rng() * 1.2;
        z[index] = originZ;
        previousX[index] = x[index];
        previousY[index] = y[index];
        previousZ[index] = z[index];
        velocityX[index] = Math.sin(angle) * outward;
        velocityY[index] = 3.2 + rng() * 3.4;
        velocityZ[index] = Math.cos(angle) * outward;
        life[index] = SHARD_LIFETIME;
        spin[index] = rng() * Math.PI * 2;
      }
    },

    advance(stepSeconds: number): void {
      for (let i = 0; i < count;) {
        life[i] -= stepSeconds;
        if (life[i] <= 0) {
          remove(i);
          // No increment: `remove` moved a different shard into this slot.
          continue;
        }

        previousX[i] = x[i];
        previousY[i] = y[i];
        previousZ[i] = z[i];

        velocityY[i] -= GRAVITY * stepSeconds;
        x[i] += velocityX[i] * stepSeconds;
        y[i] += velocityY[i] * stepSeconds;
        z[i] += velocityZ[i] * stepSeconds;

        if (y[i] < 0.1) {
          y[i] = 0.1;
          // Damped bounce, then the horizontal drag that stops shards sliding away.
          velocityY[i] = -velocityY[i] * 0.32;
          velocityX[i] *= 0.6;
          velocityZ[i] *= 0.6;
        }

        spin[i] += stepSeconds * 9;
        i++;
      }
    },

    render(alpha: number): void {
      mesh.count = count;
      for (let i = 0; i < count; i++) {
        position.set(
          previousX[i] + (x[i] - previousX[i]) * alpha,
          previousY[i] + (y[i] - previousY[i]) * alpha,
          previousZ[i] + (z[i] - previousZ[i]) * alpha,
        );
        euler.set(spin[i], spin[i] * 0.7, 0);
        quaternion.setFromEuler(euler);
        // Shrink as the shard expires, so it leaves rather than blinking out.
        const shrink = Math.min(1, life[i] / (SHARD_LIFETIME * 0.55));
        scale.set(shrink, shrink, shrink);
        scratch.compose(position, quaternion, scale);
        mesh.setMatrixAt(i, scratch);
      }
      if (count > 0) mesh.instanceMatrix.needsUpdate = true;
    },

    dispose(): void {
      mesh.removeFromParent();
      mesh.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
