import * as THREE from 'three';

/**
 * Floating damage numbers.
 *
 * The one piece of feedback that turns a wall of enemies into a readable fight: the
 * flash says *something* connected, the number says how much, and the difference
 * between a weapon doing 8 and doing 80 is otherwise invisible behind hundreds of
 * overlapping bodies.
 *
 * ## No font file
 *
 * The strict content policy on the published page blocks every external request, so a
 * webfont is not an option and bundling one would cost more than the rest of the game
 * put together. Instead ten digits are drawn once into a canvas with whatever
 * monospace face the system provides, and that canvas becomes the atlas. Self
 * contained, a few kilobytes of runtime work, and crisp because it is drawn at the
 * size it is used.
 *
 * ## One instance per digit
 *
 * A number is not one sprite but one sprite per digit, sharing an origin and offset
 * along the row. That keeps the atlas to ten cells instead of needing a texture per
 * possible total, and the vertex shader picks the cell from a per-instance attribute.
 */

const CAPACITY = 384;
const ATLAS_CELL = 64;
const DIGITS = 10;

/** How long a number stays up. Long enough to read, short enough not to pile up. */
const LIFETIME = 0.75;

/** World units a number rises over its life. */
const RISE = 1.5;

/** World width of one digit's quad. Sized to stay legible at the play camera's scale. */
const DIGIT_WIDTH = 0.78;

/**
 * Horizontal step between digits.
 *
 * Less than the quad width, because each atlas cell carries padding around its glyph:
 * stepping by the full width leaves gaps that make "11" read as two separate hits.
 */
const DIGIT_ADVANCE = DIGIT_WIDTH * 0.62;

export interface DamageNumberField {
  readonly object: THREE.Object3D;
  /** Queues a number above a point. Silently drops it when the pool is full. */
  push(x: number, z: number, amount: number, critical: boolean): void;
  advance(stepSeconds: number): void;
  render(): void;
  get count(): number;
  dispose(): void;
}

function buildDigitAtlas(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_CELL * DIGITS;
  canvas.height = ATLAS_CELL;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('2D canvas context unavailable for the digit atlas');

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = `bold ${String(ATLAS_CELL * 0.78)}px ui-monospace, Menlo, Consolas, monospace`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  for (let digit = 0; digit < DIGITS; digit++) {
    const centreX = digit * ATLAS_CELL + ATLAS_CELL / 2;
    // Outline first, fill over it. Against a mid-green ground and dark enemies, plain
    // white text loses its edges exactly where the fighting is thickest.
    context.lineWidth = ATLAS_CELL * 0.16;
    context.strokeStyle = '#140f0a';
    context.strokeText(String(digit), centreX, ATLAS_CELL / 2);
    context.fillStyle = '#ffffff';
    context.fillText(String(digit), centreX, ATLAS_CELL / 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Clamped so a digit never bleeds into its neighbour at the cell edge.
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

const VERTEX_SHADER = /* glsl */ `
attribute vec3 aOrigin;
attribute float aDigit;
attribute float aColumn;
attribute float aAge;
attribute float aCritical;

uniform float uRise;
uniform float uDigitWidth;
uniform float uLifetime;
uniform float uDigits;

varying vec2 vUv;
varying float vFade;
varying float vCritical;

void main() {
  float t = clamp(aAge / uLifetime, 0.0, 1.0);

  // Criticals are larger, and pop before settling, so a lucky hit is legible at a
  // glance without having to read the number.
  float scale = mix(1.0, 1.45, aCritical) * (1.0 + 0.35 * exp(-t * 9.0) * aCritical);

  vec3 local = position * scale;
  local.x += aColumn * uDigitWidth * scale;

  vec3 world = aOrigin;
  // Decelerating rise: fast off the corpse, drifting by the time it fades.
  world.y += uRise * (1.0 - pow(1.0 - t, 2.0));

  // The camera never rotates, so billboarding is a fixed tilt rather than a
  // per-frame look-at: stand the quad up and lean it back to match the pitch.
  vec4 mvPosition = modelViewMatrix * vec4(world, 1.0);
  mvPosition.xy += local.xy;

  // Pick this digit's cell out of the atlas row.
  vUv = vec2((aDigit + uv.x) / uDigits, uv.y);
  vFade = 1.0 - smoothstep(0.55, 1.0, t);
  vCritical = aCritical;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D uAtlas;

varying vec2 vUv;
varying float vFade;
varying float vCritical;

void main() {
  vec4 texel = texture2D(uAtlas, vUv);
  if (texel.a < 0.02) discard;

  // Ordinary hits read as parchment, criticals as the kaftan's gold, so the two are
  // distinguishable at a glance without reading either number.
  vec3 tint = mix(vec3(0.94, 0.93, 0.88), vec3(1.0, 0.78, 0.28), vCritical);
  gl_FragColor = vec4(texel.rgb * tint, texel.a * vFade);
}
`;

export function createDamageNumbers(): DamageNumberField {
  const atlas = buildDigitAtlas();

  const geometry = new THREE.InstancedBufferGeometry();

  // The quad is built by hand rather than borrowed from a `PlaneGeometry`. Taking the
  // attributes and then disposing the source geometry would ask the renderer to free
  // buffers this geometry still points at — harmless only by luck of timing.
  const half = DIGIT_WIDTH / 2;
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [-half, -half, 0, half, -half, 0, half, half, 0, -half, half, 0],
      3,
    ),
  );
  geometry.setAttribute(
    'uv',
    // Bottom vertices take v = 0, matching what `PlaneGeometry` produces. Three.js
    // already uploads canvas textures with `flipY`, so "correcting" for the canvas's
    // downward rows here flips them a second time and renders every digit upside
    // down — a 5 becomes an S, a 9 becomes an e, and the numbers look like letters.
    new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);

  const originData = new Float32Array(CAPACITY * 3);
  const digitData = new Float32Array(CAPACITY);
  const columnData = new Float32Array(CAPACITY);
  const ageData = new Float32Array(CAPACITY);
  const criticalData = new Float32Array(CAPACITY);

  const aOrigin = new THREE.InstancedBufferAttribute(originData, 3);
  const aDigit = new THREE.InstancedBufferAttribute(digitData, 1);
  const aColumn = new THREE.InstancedBufferAttribute(columnData, 1);
  const aAge = new THREE.InstancedBufferAttribute(ageData, 1);
  const aCritical = new THREE.InstancedBufferAttribute(criticalData, 1);
  const attributes = [aOrigin, aDigit, aColumn, aAge, aCritical];
  for (const attribute of attributes) attribute.setUsage(THREE.DynamicDrawUsage);

  geometry.setAttribute('aOrigin', aOrigin);
  geometry.setAttribute('aDigit', aDigit);
  geometry.setAttribute('aColumn', aColumn);
  geometry.setAttribute('aAge', aAge);
  geometry.setAttribute('aCritical', aCritical);
  geometry.instanceCount = 0;

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      uAtlas: { value: atlas },
      uDigits: { value: DIGITS },
      uRise: { value: RISE },
      uDigitWidth: { value: DIGIT_ADVANCE },
      uLifetime: { value: LIFETIME },
    },
    transparent: true,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  // Drawn last, over the crowd: a number hidden behind the enemy it describes is
  // worse than no number, because the player looks for it and does not find it.
  mesh.renderOrder = 10;

  let count = 0;

  const remove = (index: number): void => {
    const last = --count;
    if (index === last) return;
    originData[index * 3] = originData[last * 3];
    originData[index * 3 + 1] = originData[last * 3 + 1];
    originData[index * 3 + 2] = originData[last * 3 + 2];
    digitData[index] = digitData[last];
    columnData[index] = columnData[last];
    ageData[index] = ageData[last];
    criticalData[index] = criticalData[last];
  };

  return {
    object: mesh,

    get count() {
      return count;
    },

    push(x: number, z: number, amount: number, critical: boolean): void {
      const rounded = Math.max(1, Math.round(amount));
      const text = String(rounded);
      if (count + text.length > CAPACITY) return;

      // Centre the row on the hit rather than starting there, so a three-digit number
      // does not appear to belong to the enemy to its right.
      const start = -((text.length - 1) / 2);
      for (let i = 0; i < text.length; i++) {
        const index = count++;
        originData[index * 3] = x;
        originData[index * 3 + 1] = 1.5;
        originData[index * 3 + 2] = z;
        digitData[index] = text.charCodeAt(i) - 48;
        columnData[index] = start + i;
        ageData[index] = 0;
        criticalData[index] = critical ? 1 : 0;
      }
    },

    advance(stepSeconds: number): void {
      for (let i = 0; i < count;) {
        ageData[i] += stepSeconds;
        if (ageData[i] >= LIFETIME) {
          remove(i);
          // No increment: `remove` moved a different digit into this slot.
          continue;
        }
        i++;
      }
    },

    render(): void {
      geometry.instanceCount = count;
      if (count === 0) return;
      for (const attribute of attributes) {
        attribute.clearUpdateRanges();
        attribute.addUpdateRange(0, count * attribute.itemSize);
        attribute.needsUpdate = true;
      }
    },

    dispose(): void {
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
      atlas.dispose();
    },
  };
}
