import * as THREE from 'three';
import type { Service } from '../sim/balance';
import { smokeMap } from '../sim/buildings';
import type { CityState } from '../sim/city';
import { coverage, supportedLevel } from '../sim/services';

/**
 * Information layers laid over the ground: one texel per tile, like the fertility map.
 * Each reads the simulation and never changes it.
 */
export type Layer =
  'verim' | 'su' | 'ibadet' | 'temizlik' | 'egitim' | 'saglik' | 'sulama' | 'duman' | 'konut';

export const LAYERS: readonly Layer[] = [
  'verim',
  'su',
  'ibadet',
  'temizlik',
  'egitim',
  'saglik',
  'sulama',
  'duman',
  'konut',
];

export const LAYER_NAMES: Record<Layer, string> = {
  verim: 'Verimlilik',
  su: 'Su',
  ibadet: 'İbadet',
  temizlik: 'Temizlik',
  egitim: 'Eğitim',
  saglik: 'Sağlık',
  sulama: 'Sulama',
  duman: 'Duman',
  konut: 'Konut',
};

/** Tint of each service's reach; houses outside it show red. */
export const SERVICE_TINT: Record<Service, string> = {
  su: '#5f97c6',
  ibadet: '#2db6b1',
  temizlik: '#e6b872',
  egitim: '#8e5fa8',
  saglik: '#5f9a3a',
  esnaf: '#c97b4c',
  sulama: '#3b6ea3',
};

const RED = '#c8312a';
const LEVEL_TINT = ['', '#efe1bd', '#e6b872', '#d4ad4a'];

/** What a layer depends on: when this changes, the texture is redrawn. */
export function layerKey(city: CityState, layer: Layer): string {
  const r = city.revision;
  if (layer === 'duman') return String(r.buildings);
  const staffed = city.stats.industryStaffing >= city.balance.serviceEffects.minStaffing;
  return `${r.buildings}:${r.houses}:${city.unpaid}:${staffed}:${Math.round(city.stats.prosperity * 20)}`;
}

/** Writes a layer into an RGBA byte array of one texel per tile (sRGB). */
export function paintLayer(city: CityState, layer: Exclude<Layer, 'verim'>, out: Uint8Array): void {
  out.fill(0);
  const color = new THREE.Color();
  const rgb = { r: 0, g: 0, b: 0 };
  const put = (i: number, hex: string, alpha: number): void => {
    color.set(hex).getRGB(rgb, THREE.SRGBColorSpace);
    out[i * 4] = Math.round(rgb.r * 255);
    out[i * 4 + 1] = Math.round(rgb.g * 255);
    out[i * 4 + 2] = Math.round(rgb.b * 255);
    out[i * 4 + 3] = alpha;
  };
  const n = city.grid.count;
  if (layer === 'duman') {
    const smoke = smokeMap(city);
    for (let i = 0; i < n; i++) if (smoke[i] === 1) put(i, '#6f6a64', 150);
    return;
  }
  if (layer === 'konut') {
    for (let i = 0; i < n; i++) {
      const h = city.house[i];
      if (h === 0) continue;
      const can = supportedLevel(city, i);
      if (can < h) put(i, RED, 220);
      else if (can > h) put(i, '#5f9a3a', 200);
      else put(i, LEVEL_TINT[Math.min(3, h)], 200);
    }
    return;
  }
  const map = coverage(city)[layer];
  const tint = SERVICE_TINT[layer];
  for (let i = 0; i < n; i++) {
    if (map[i] === 1) put(i, tint, city.house[i] > 0 ? 190 : 120);
    else if (city.house[i] > 0 && layer !== 'sulama') put(i, RED, 200);
  }
}

/** A texture the size of the map, repainted in place when its layer changes. */
export function layerTexture(size: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array(size * size * 4), size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * How houses are coloured under a layer, since they hide the ground they stand on: served
 * or not for a service, their outlook for the housing layer, grey in smoke.
 */
export function houseTint(city: CityState, layer: Layer): ((i: number) => string | null) | null {
  if (layer === 'verim' || layer === 'sulama') return null;
  if (layer === 'duman') {
    const smoke = smokeMap(city);
    return (i) => (smoke[i] === 1 ? '#8a847c' : '#f4ecd8');
  }
  if (layer === 'konut') {
    return (i) => {
      const h = city.house[i];
      const can = supportedLevel(city, i);
      if (can < h) return RED;
      if (can > h) return '#7fb45a';
      return LEVEL_TINT[Math.min(3, h)];
    };
  }
  const map = coverage(city)[layer];
  const tint = SERVICE_TINT[layer];
  return (i) => (map[i] === 1 ? tint : RED);
}
