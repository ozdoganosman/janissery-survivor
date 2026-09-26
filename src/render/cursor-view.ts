import * as THREE from 'three';
import type { CityState } from '../sim/city';
import { markOverlay } from './materials';

export interface PreviewTile {
  x: number;
  z: number;
  color: string;
}

const MAX_PREVIEW = 4096;

/**
 * What the player is pointing at: a gilt frame on the hovered tile and tinted squares for
 * a road or clearance being dragged. Drawn over everything and never inked.
 */
export class CursorView {
  readonly group = new THREE.Group();
  private readonly hover: THREE.Mesh;
  private readonly preview: THREE.InstancedMesh;

  constructor(private readonly city: CityState) {
    markOverlay(this.group);
    const frameTex = frameTexture();
    this.hover = new THREE.Mesh(
      new THREE.PlaneGeometry(1.08, 1.08).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: frameTex, transparent: true, depthTest: false, depthWrite: false }),
    );
    this.hover.renderOrder = 10;
    this.hover.visible = false;
    this.group.add(this.hover);

    this.preview = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.6, depthTest: false, depthWrite: false }),
      MAX_PREVIEW,
    );
    this.preview.count = 0;
    this.preview.renderOrder = 9;
    this.preview.frustumCulled = false;
    this.group.add(this.preview);
  }

  setHover(tile: { x: number; z: number } | null): void {
    if (tile === null || !this.city.grid.inBounds(tile.x, tile.z)) {
      this.hover.visible = false;
      return;
    }
    const { grid, terrain } = this.city;
    const i = grid.index(tile.x, tile.z);
    this.hover.position.set(grid.centre(tile.x), terrain.height[i] + 0.05, grid.centre(tile.z));
    this.hover.visible = true;
  }

  setPreview(tiles: readonly PreviewTile[]): void {
    const { grid, terrain } = this.city;
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const n = Math.min(MAX_PREVIEW, tiles.length);
    for (let k = 0; k < n; k++) {
      const t = tiles[k];
      if (!grid.inBounds(t.x, t.z)) continue;
      const h = Math.max(terrain.height[grid.index(t.x, t.z)], terrain.waterLevel + 0.1);
      m.makeTranslation(grid.centre(t.x), h + 0.06, grid.centre(t.z));
      this.preview.setMatrixAt(k, m);
      this.preview.setColorAt(k, c.set(t.color));
    }
    this.preview.count = n;
    this.preview.instanceMatrix.needsUpdate = true;
    if (this.preview.instanceColor !== null) this.preview.instanceColor.needsUpdate = true;
  }
}

function frameTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (g !== null) {
    g.strokeStyle = '#4a2c18';
    g.lineWidth = 7;
    g.strokeRect(5, 5, 54, 54);
    g.strokeStyle = '#e2b84a';
    g.lineWidth = 3.5;
    g.strokeRect(5, 5, 54, 54);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
