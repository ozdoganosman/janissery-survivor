import * as THREE from 'three';
import type { BuiltModel } from './builder';
import type { LimbRole } from './schema';
import { WALK_ARM_SWING, WALK_BOB, WALK_LEG_SWING } from './animator';

/**
 * Hundreds of voxel figures sharing one model.
 *
 * ## Why the animation runs on the GPU
 *
 * The obvious approach is one `InstancedMesh` per part with a CPU-computed matrix per
 * instance. At the project's target of 800 enemies that means recomputing and
 * uploading 800 x 6 matrices every frame — thousands of matrix composes plus 76 000
 * floats of traffic, purely to make limbs swing. That is a large slice of a 16.7 ms
 * budget spent on something the vertex shader can derive for free.
 *
 * So instead of `instanceMatrix`, each figure's state lives in six small instance
 * attributes — position, facing, phase offset, speed, scale, tint — and the vertex shader
 * builds the transform: rotate the limb about its pivot, squash and bob the body,
 * turn the figure to face its heading, translate into the world. Walking then costs
 * *zero* per-frame CPU work; only a single shared `uTime` uniform advances. Moving a
 * figure writes four floats once, not six matrices.
 *
 * The attributes are shared objects reused by every part geometry, so a write reaches
 * all six parts at once and the GPU upload happens once per attribute rather than
 * once per part.
 *
 * ## Consequences to know about
 *
 * - The meshes must stay at the origin with an identity transform. World placement
 *   happens inside the shader, so moving the mesh would double-apply it.
 * - `frustumCulled` is off. Three.js culls using the geometry's bounding sphere,
 *   which describes one figure at the origin and knows nothing about where the
 *   shader scatters the instances; leaving culling on makes the whole army vanish
 *   when the origin leaves the view.
 * - Only the walk cycle is implemented here, with `speed = 0` giving a neutral
 *   standing pose. One-shot animations belong to `VoxelRig`, which the few
 *   individually important figures use.
 */

/** Instance capacity is fixed at construction, since the buffers are preallocated. */
export interface VoxelArmyOptions {
  readonly capacity: number;
}

export interface VoxelArmy {
  /** Add these to the scene. One `InstancedMesh` per model part. */
  readonly meshes: readonly THREE.InstancedMesh[];
  readonly capacity: number;
  /** How many instances are drawn. */
  get count(): number;
  setCount(count: number): void;
  /**
   * Positions and animates one instance.
   *
   * @param facing Rotation about Y in radians; 0 faces +Z.
   * @param speed Walk cycles per second. 0 stands the figure still.
   * @param phaseOffset Cycles, to stop every figure stepping in unison.
   */
  setInstance(
    index: number,
    x: number,
    y: number,
    z: number,
    facing: number,
    speed: number,
    phaseOffset: number,
  ): void;
  /** Multiplied into the figure's colours. Use for elites and hit flashes. */
  setTint(index: number, r: number, g: number, b: number): void;
  /** Uniform size multiplier about the figure's feet. Defaults to 1. */
  setScale(index: number, scale: number): void;
  /**
   * Pushes buffered writes to the GPU. Call once per frame after all edits.
   *
   * Only the live prefix `[0, count)` is uploaded. With a 2000-slot pool holding 800
   * enemies, uploading the whole buffer would push 60% dead bytes across the bus
   * every frame for nothing.
   */
  flush(): void;
  /** Advances the shared animation clock. */
  advance(elapsedSeconds: number): void;
  dispose(): void;
}

/** Swing amplitude and phase offset per limb, kept in step with the CPU walk cycle. */
function swingFor(role: LimbRole): { amplitude: number; phaseShift: number } {
  switch (role) {
    // Legs lead the cycle; the right leg is half a cycle behind the left, which is
    // how `poseFor` negates the sine for the opposite limb.
    case 'legLeft':
      return { amplitude: WALK_LEG_SWING, phaseShift: 0 };
    case 'legRight':
      return { amplitude: WALK_LEG_SWING, phaseShift: 0.5 };
    // Arms counter the legs, so the left arm shares the right leg's phase.
    case 'armLeft':
      return { amplitude: WALK_ARM_SWING, phaseShift: 0.5 };
    case 'armRight':
      return { amplitude: WALK_ARM_SWING, phaseShift: 0 };
    case 'head':
      // Matches the small lag `poseFor` gives the head: -0.6 rad is -0.0955 cycles.
      return { amplitude: 0.05, phaseShift: -0.0955 };
    case 'static':
      return { amplitude: 0, phaseShift: 0 };
  }
}

const ROTATION_GLSL = /* glsl */ `
mat3 jsAxisRotation(vec3 axis, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  float t = 1.0 - c;
  vec3 a = normalize(axis);
  // GLSL mat3 takes columns.
  return mat3(
    t * a.x * a.x + c,        t * a.x * a.y + s * a.z,  t * a.x * a.z - s * a.y,
    t * a.x * a.y - s * a.z,  t * a.y * a.y + c,        t * a.y * a.z + s * a.x,
    t * a.x * a.z + s * a.y,  t * a.y * a.z - s * a.x,  t * a.z * a.z + c
  );
}

vec3 jsFaceY(vec3 p, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}
`;

const DECLARATIONS_GLSL = /* glsl */ `
#define JS_TAU 6.283185307179586
attribute vec3 aPos;
attribute float aFacing;
attribute float aPhase;
attribute float aSpeed;
attribute float aScale;
attribute vec3 aTint;
uniform float uTime;
uniform vec3 uPivot;
uniform vec3 uSwingAxis;
uniform float uSwingAmp;
uniform float uPhaseShift;
uniform float uBobAmp;
${ROTATION_GLSL}
`;

export function createVoxelArmy(model: BuiltModel, options: VoxelArmyOptions): VoxelArmy {
  const { capacity } = options;
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new RangeError(`VoxelArmy capacity must be a positive integer, got ${capacity}`);
  }

  // One shared set of per-instance buffers. Every part geometry references these same
  // attribute objects, so one write updates the whole figure and three.js uploads
  // each buffer once rather than once per part.
  const positionData = new Float32Array(capacity * 3);
  const tintData = new Float32Array(capacity * 3).fill(1);
  const facingData = new Float32Array(capacity);
  const phaseData = new Float32Array(capacity);
  const speedData = new Float32Array(capacity);
  const scaleData = new Float32Array(capacity).fill(1);

  const aPos = new THREE.InstancedBufferAttribute(positionData, 3);
  const aTint = new THREE.InstancedBufferAttribute(tintData, 3);
  const aFacing = new THREE.InstancedBufferAttribute(facingData, 1);
  const aPhase = new THREE.InstancedBufferAttribute(phaseData, 1);
  const aSpeed = new THREE.InstancedBufferAttribute(speedData, 1);
  const aScale = new THREE.InstancedBufferAttribute(scaleData, 1);
  const attributes = [aPos, aTint, aFacing, aPhase, aSpeed, aScale];
  for (const attribute of attributes) attribute.setUsage(THREE.DynamicDrawUsage);

  // A single uniform object shared by every part material, so advancing the clock is
  // one assignment regardless of part count.
  const timeUniform = { value: 0 };

  const meshes: THREE.InstancedMesh[] = [];
  const materials: THREE.MeshLambertMaterial[] = [];
  const identity = new THREE.Matrix4();

  for (const part of model.parts) {
    const { amplitude, phaseShift } = swingFor(part.role);

    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = timeUniform;
      shader.uniforms.uPivot = { value: part.pivot };
      shader.uniforms.uSwingAxis = { value: new THREE.Vector3(1, 0, 0) };
      shader.uniforms.uSwingAmp = { value: amplitude };
      shader.uniforms.uPhaseShift = { value: phaseShift };
      shader.uniforms.uBobAmp = { value: WALK_BOB };

      shader.vertexShader = DECLARATIONS_GLSL + shader.vertexShader;

      // `moving` collapses the whole walk cycle to a neutral stand when speed is 0.
      // Without it a stopped figure would freeze wherever the sine left its limbs,
      // which reads as a broken animation rather than as standing.
      const preamble = /* glsl */ `
        float jsPhase = uTime * aSpeed + aPhase;
        float jsMoving = step(0.001, aSpeed);
        float jsAngle = uSwingAmp * sin(JS_TAU * (jsPhase + uPhaseShift)) * jsMoving;
        mat3 jsLimb = jsAxisRotation(uSwingAxis, jsAngle);
      `;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <beginnormal_vertex>',
        /* glsl */ `
        ${preamble}
        vec3 objectNormal = jsFaceY(jsLimb * normal, aFacing);
        `,
      );

      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        /* glsl */ `
        vec3 jsLocal = (jsLimb * position + uPivot) * aScale;
        // Squash about the feet, then bob; both scaled by jsMoving so a standing
        // figure is perfectly still.
        jsLocal.y *= 1.0 - 0.025 * cos(2.0 * JS_TAU * jsPhase) * jsMoving;
        jsLocal.y += uBobAmp * abs(sin(JS_TAU * jsPhase)) * jsMoving * aScale;
        vec3 transformed = jsFaceY(jsLocal, aFacing) + aPos;
        `,
      );

      shader.vertexShader = shader.vertexShader.replace(
        '#include <color_vertex>',
        /* glsl */ `
        #include <color_vertex>
        vColor.rgb *= aTint;
        `,
      );
    };

    const geometry = part.geometry;
    geometry.setAttribute('aPos', aPos);
    geometry.setAttribute('aTint', aTint);
    geometry.setAttribute('aFacing', aFacing);
    geometry.setAttribute('aPhase', aPhase);
    geometry.setAttribute('aSpeed', aSpeed);
    geometry.setAttribute('aScale', aScale);

    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    // InstancedMesh allocates its matrix buffer zero-filled, and a zero matrix
    // collapses every vertex onto the origin. The shader ignores these, but
    // <project_vertex> still multiplies by them, so they must be identity.
    for (let i = 0; i < capacity; i++) mesh.setMatrixAt(i, identity);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.count = 0;

    meshes.push(mesh);
    materials.push(material);
  }

  let count = 0;
  let dirty = false;

  const assertIndex = (index: number): void => {
    if (!Number.isInteger(index) || index < 0 || index >= capacity) {
      throw new RangeError(`instance index ${index} is outside 0..${capacity - 1}`);
    }
  };

  return {
    meshes,
    capacity,

    get count() {
      return count;
    },

    setCount(next: number): void {
      if (!Number.isInteger(next) || next < 0 || next > capacity) {
        throw new RangeError(`count ${next} is outside 0..${capacity}`);
      }
      count = next;
      for (const mesh of meshes) mesh.count = next;
    },

    setInstance(index, x, y, z, facing, speed, phaseOffset): void {
      assertIndex(index);
      const base = index * 3;
      positionData[base] = x;
      positionData[base + 1] = y;
      positionData[base + 2] = z;
      facingData[index] = facing;
      speedData[index] = speed;
      phaseData[index] = phaseOffset;
      dirty = true;
    },

    setTint(index, r, g, b): void {
      assertIndex(index);
      const base = index * 3;
      tintData[base] = r;
      tintData[base + 1] = g;
      tintData[base + 2] = b;
      dirty = true;
    },

    setScale(index, scale): void {
      assertIndex(index);
      scaleData[index] = scale;
      dirty = true;
    },

    flush(): void {
      if (!dirty) return;
      for (const attribute of attributes) {
        attribute.clearUpdateRanges();
        if (count > 0) attribute.addUpdateRange(0, count * attribute.itemSize);
        attribute.needsUpdate = true;
      }
      dirty = false;
    },

    advance(elapsedSeconds: number): void {
      // Wrapped to keep the value small: a float that has grown to thousands of
      // seconds loses the precision the sine needs and the walk visibly judders.
      timeUniform.value = (timeUniform.value + elapsedSeconds) % 3600;
    },

    dispose(): void {
      for (const mesh of meshes) {
        mesh.removeFromParent();
        mesh.dispose();
      }
      for (const material of materials) material.dispose();
    },
  };
}
