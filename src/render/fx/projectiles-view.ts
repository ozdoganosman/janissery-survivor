import * as THREE from 'three';
import { MOTION, type ProjectilePool } from '../../sim/projectiles';

/**
 * Draws what the weapons put on the field.
 *
 * Two shapes cover all six. Anything with an area — the sabre's arc, the drum's
 * shockwave, the lantern's flame — is a flat disc lying on the ground, because a
 * volume seen from above tells the player nothing about its reach while a disc tells
 * them exactly where it ends. Anything that travels is a small solid.
 *
 * The discs are deliberately faint and unlit. A weapon effect that competes with the
 * enemies for attention makes a crowded screen unreadable, and reading the crowd is
 * the entire skill of the genre.
 */

/** Palette by weapon, matching the fiction: steel, wood, brass, glass, iron, flame. */
const SOURCE_COLORS = [
  0xc8ccd4, // yatagan
  0xd8c8a0, // tirkes
  0xe0b34a, // mehter
  0x5a8ae8, // nazar
  0x8a8a94, // sahi
  0xff9a3c, // kandil
];

export interface ProjectileView {
  readonly objects: readonly THREE.Object3D[];
  render(pool: ProjectilePool, alpha: number): void;
  dispose(): void;
}

export function createProjectileView(capacity: number): ProjectileView {
  const discGeometry = new THREE.CircleGeometry(1, 20);
  discGeometry.rotateX(-Math.PI / 2);
  const discMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    side: THREE.DoubleSide,
    // Additive, not alpha. Blending translucent orange over green grass produces a
    // muddy tan that reads as a patch of dirt; adding light reads as fire.
    blending: THREE.AdditiveBlending,
  });
  const discs = new THREE.InstancedMesh(discGeometry, discMaterial, capacity);
  discs.count = 0;
  discs.frustumCulled = false;
  discs.renderOrder = 2;
  // Instance colours let one mesh serve every weapon; without them each would need
  // its own material and its own draw call.
  discs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);

  const boltGeometry = new THREE.BoxGeometry(0.22, 0.22, 0.62);
  const boltMaterial = new THREE.MeshLambertMaterial({});
  const bolts = new THREE.InstancedMesh(boltGeometry, boltMaterial, capacity);
  bolts.count = 0;
  bolts.frustumCulled = false;
  bolts.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);

  // Reused every frame; a Matrix4 per projectile per frame is the allocation pattern
  // the whole simulation was written to avoid.
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scale = new THREE.Vector3();
  const colour = new THREE.Color();

  const isArea = (motion: number): boolean =>
    motion === MOTION.sweep || motion === MOTION.ring || motion === MOTION.aura;

  return {
    objects: [discs, bolts],

    render(pool: ProjectilePool, alpha: number): void {
      let discCount = 0;
      let boltCount = 0;

      for (let i = 0; i < pool.count; i++) {
        const x = pool.previousX[i] + (pool.x[i] - pool.previousX[i]) * alpha;
        const z = pool.previousZ[i] + (pool.z[i] - pool.previousZ[i]) * alpha;
        colour.setHex(SOURCE_COLORS[pool.source[i]] ?? 0xffffff);

        if (isArea(pool.motion[i])) {
          if (discCount >= capacity) continue;
          position.set(x, 0.06, z);
          quaternion.identity();
          const radius = Math.max(0.05, pool.radius[i]);
          scale.set(radius, 1, radius);
          matrix.compose(position, quaternion, scale);
          discs.setMatrixAt(discCount, matrix);
          discs.setColorAt(discCount, colour);
          discCount++;
        } else {
          if (boltCount >= capacity) continue;
          position.set(x, 0.75, z);
          // Point along travel so an arrow looks like an arrow rather than a cube.
          euler.set(0, Math.atan2(pool.velocityX[i], pool.velocityZ[i]), 0);
          quaternion.setFromEuler(euler);
          const size = Math.max(0.5, pool.radius[i] * 2.2);
          scale.set(size, size, size);
          matrix.compose(position, quaternion, scale);
          bolts.setMatrixAt(boltCount, matrix);
          bolts.setColorAt(boltCount, colour);
          boltCount++;
        }
      }

      discs.count = discCount;
      bolts.count = boltCount;
      if (discCount > 0) {
        discs.instanceMatrix.needsUpdate = true;
        if (discs.instanceColor !== null) discs.instanceColor.needsUpdate = true;
      }
      if (boltCount > 0) {
        bolts.instanceMatrix.needsUpdate = true;
        if (bolts.instanceColor !== null) bolts.instanceColor.needsUpdate = true;
      }
    },

    dispose(): void {
      for (const mesh of [discs, bolts]) {
        mesh.removeFromParent();
        mesh.dispose();
      }
      discGeometry.dispose();
      discMaterial.dispose();
      boltGeometry.dispose();
      boltMaterial.dispose();
    },
  };
}
