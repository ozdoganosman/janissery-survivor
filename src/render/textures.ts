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

export type FieldLook = 'yesil' | 'bugday' | 'arpa' | 'aniz' | 'kis' | 'surulmus' | 'nadas' | 'mera';

/** World units covered by one repeat of a field texture. */
export const FIELD_TEXTURE_UNITS = 2.4;

/**
 * Field motifs, one per stage of the farming year. Furrows run along the texture's v axis;
 * the field mesh turns them to follow the long side of the field.
 */
export function fieldTexture(look: FieldLook): THREE.CanvasTexture {
  const rng = createRng(101);
  return canvasTexture(256, (g, s) => {
    const base: Record<FieldLook, string> = {
      yesil: '#94b85c',
      bugday: '#e6bb52',
      arpa: '#e9d487',
      aniz: '#e8d8a0',
      kis: '#d3c2a3',
      surulmus: '#c9a071',
      nadas: '#d7bf8e',
      mera: '#b4c77a',
    };
    g.fillStyle = base[look];
    g.fillRect(0, 0, s, s);
    const furrows = (color: string, width: number, count: number, wave = 2): void => {
      for (let i = 0; i < count; i++) {
        const x = (i + 0.5) * (s / count);
        const pts: Array<[number, number]> = [];
        for (let y = 0; y <= s; y += 8) pts.push([x + Math.sin((y / s) * Math.PI * 4 + i) * wave, y]);
        stroke(g, pts, color, width);
      }
    };
    switch (look) {
      case 'yesil':
        furrows('rgba(95,138,58,0.55)', 2, 8, 1);
        for (let i = 0; i < 16; i++) {
          flower(g, rng.next() * s, rng.next() * s, 2.6, rng.chance(0.5) ? '#fbf3e3' : '#d9483e');
        }
        break;
      case 'bugday':
      case 'arpa': {
        const ink = look === 'bugday' ? '#a9772a' : '#b3934a';
        for (let row = 0; row < 8; row++) {
          for (let col = 0; col < 8; col++) {
            const x = (col + 0.5 + (row % 2) * 0.5) * (s / 8);
            const y = (row + 0.5) * (s / 8);
            stroke(
              g,
              [
                [x - 6, y + 7],
                [x, y - 7],
                [x + 6, y + 7],
              ],
              ink,
              2.6,
            );
            stroke(
              g,
              [
                [x, y + 9],
                [x, y - 7],
              ],
              ink,
              2.2,
            );
            if (look === 'arpa')
              stroke(
                g,
                [
                  [x, y - 7],
                  [x + 4, y - 14],
                ],
                ink,
                1.4,
              );
          }
        }
        break;
      }
      case 'aniz':
        for (let row = 0; row < 10; row++) {
          for (let col = 0; col < 12; col++) {
            const x = (col + 0.5) * (s / 12) + (row % 2) * 6;
            const y = (row + 0.5) * (s / 10);
            stroke(
              g,
              [
                [x, y + 4],
                [x, y - 4],
              ],
              '#b99d5a',
              2,
            );
          }
        }
        break;
      case 'kis':
        furrows('#a8906e', 3, 9);
        for (let i = 0; i < 60; i++) {
          g.fillStyle = 'rgba(255,255,255,0.85)';
          g.beginPath();
          g.arc(rng.next() * s, rng.next() * s, 1.8, 0, Math.PI * 2);
          g.fill();
        }
        break;
      case 'surulmus':
        furrows('#9c6f45', 3.2, 10);
        break;
      case 'mera':
        // Grazed turf: short tufts and clover, no furrows.
        for (let i = 0; i < 70; i++) {
          const x = rng.next() * s;
          const y = rng.next() * s;
          for (let k = -1; k <= 1; k++) {
            stroke(
              g,
              [
                [x + k * 3, y + 4],
                [x + k * 4, y - 4],
              ],
              'rgba(96,128,52,0.75)',
              1.8,
            );
          }
        }
        for (let i = 0; i < 12; i++) flower(g, rng.next() * s, rng.next() * s, 2.2, '#fbf3e3');
        break;
      case 'nadas':
        furrows('rgba(160,120,80,0.5)', 2, 6, 3);
        for (let i = 0; i < 26; i++) {
          const x = rng.next() * s;
          const y = rng.next() * s;
          stroke(
            g,
            [
              [x - 4, y + 5],
              [x, y - 4],
            ],
            '#7f944a',
            2.2,
          );
          stroke(
            g,
            [
              [x + 4, y + 5],
              [x, y - 4],
            ],
            '#7f944a',
            2.2,
          );
        }
        for (let i = 0; i < 8; i++) flower(g, rng.next() * s, rng.next() * s, 2.4, '#e9c43c');
        break;
    }
  });
}
