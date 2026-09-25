import * as THREE from 'three';
import { createRng } from '../core/rng';
import { FERTILITY_RAMP } from './palette';
import type { Terrain } from '../sim/terrain';

function canvasTexture(
  size: number,
  draw: (g: CanvasRenderingContext2D, s: number) => void,
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (g === null) throw new Error('2D canvas unavailable');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function stroke(
  g: CanvasRenderingContext2D,
  pts: Array<[number, number]>,
  color: string,
  width: number,
): void {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = 'round';
  g.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
  g.stroke();
}

function flower(g: CanvasRenderingContext2D, x: number, y: number, r: number, petal: string): void {
  g.fillStyle = petal;
  for (let k = 0; k < 5; k++) {
    const a = (k * Math.PI * 2) / 5;
    g.beginPath();
    g.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, r * 0.72, 0, Math.PI * 2);
    g.fill();
  }
}

/** World units covered by one repeat of the ground texture. */
export const GROUND_TEXTURE_UNITS = 7;

/**
 * Ground motifs: sparse grass tufts and little flowers, drawn on white so the terrain's
 * vertex colour tints them. Motifs, not noise, are what make a miniature meadow.
 */
export function groundTexture(): THREE.CanvasTexture {
  const rng = createRng(77);
  return canvasTexture(512, (g, s) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 70; i++) {
      const x = rng.next() * s;
      const y = rng.next() * s;
      for (let k = -1; k <= 1; k++) {
        stroke(
          g,
          [
            [x + k * 4, y + 6],
            [x + k * 6, y - 6],
          ],
          'rgba(95,110,40,0.7)',
          2.4,
        );
      }
    }
    for (let i = 0; i < 18; i++) {
      flower(g, rng.next() * s, rng.next() * s, 3.4, rng.chance(0.6) ? '#d25a4a' : '#8fb0d8');
    }
  });
}

/** Water: wavy lines running with the current, light and dark in turn. */
export function waterTexture(color: string): THREE.CanvasTexture {
  return canvasTexture(256, (g, s) => {
    g.fillStyle = color;
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 6; i++) {
      const x0 = (i + 0.5) * (s / 6);
      const pts: Array<[number, number]> = [];
      for (let y = 0; y <= s; y += 4) pts.push([x0 + Math.sin((y / s) * Math.PI * 6 + i) * 7, y]);
      stroke(g, pts, i % 2 === 0 ? '#d9ecf8' : '#3b6ea3', i % 2 === 0 ? 3.2 : 2.4);
    }
  });
}

/** One texel per tile: the fertility layer the player reads before drawing fields. */
export function fertilityTexture(terrain: Terrain): THREE.DataTexture {
  const n = terrain.grid.size;
  const data = new Uint8Array(n * n * 4);
  const ramp = FERTILITY_RAMP.map((c) => new THREE.Color(c));
  const tmp = new THREE.Color();
  const srgb = { r: 0, g: 0, b: 0 };
  for (let i = 0; i < n * n; i++) {
    const f = terrain.fertility[i];
    const farmable = terrain.water[i] === 0 && f > 0;
    const t = f * (ramp.length - 1);
    const k = Math.min(ramp.length - 2, Math.floor(t));
    tmp.copy(ramp[k]).lerp(ramp[k + 1], t - k);
    // Stored as sRGB bytes, matching the texture's colour space below.
    tmp.getRGB(srgb, THREE.SRGBColorSpace);
    data[i * 4] = Math.round(srgb.r * 255);
    data[i * 4 + 1] = Math.round(srgb.g * 255);
    data[i * 4 + 2] = Math.round(srgb.b * 255);
    data[i * 4 + 3] = farmable ? 190 : 0;
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
