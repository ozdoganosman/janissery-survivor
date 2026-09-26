import * as THREE from 'three';
import type { CityState } from '../sim/city';
import { roadDistance } from '../sim/distance';
import { miniMaterial, setInkClass } from './materials';
import { INK_CLASS, PAL } from './palette';

/**
 * Zoned lots still waiting for a house: pale parcels, each with its own inked outline, the
 * way a miniature marks out a plot.
 */
export class ZonesView {
  readonly group = new THREE.Group();
  private key = '';
  private readonly plate = new THREE.PlaneGeometry(0.82, 0.82).rotateX(-Math.PI / 2);

  constructor(private readonly city: CityState) {
    setInkClass(this.group, INK_CLASS.zone);
    this.sync();
  }

  sync(): boolean {
    const { revision } = this.city;
    const key = `${revision.zones}:${revision.houses}:${revision.roads}`;
    if (key === this.key) return false;
    this.key = key;
    for (const child of this.group.children.slice()) {
      this.group.remove(child);
      if (child instanceof THREE.InstancedMesh) child.dispose();
    }
    const { grid, terrain, zone, house, balance } = this.city;
    const reach = balance.zoning.roadReach;
    const dist = roadDistance(this.city, reach);
    const near: number[] = [];
    const far: number[] = [];
    for (let i = 0; i < zone.length; i++) {
      if (zone[i] === 1 && house[i] === 0) (dist[i] <= reach ? near : far).push(i);
    }
    // Lots no road reaches yet are drawn fainter: they wait for a road, not for settlers.
    for (const [lots, color] of [
      [near, PAL.lot],
      [far, PAL.lotFar],
    ] as const) {
      if (lots.length === 0) continue;
      const mesh = new THREE.InstancedMesh(this.plate, miniMaterial({ color }), lots.length);
      const m = new THREE.Matrix4();
      lots.forEach((i, k) => {
        const x = i % grid.size;
        const z = Math.floor(i / grid.size);
        m.makeTranslation(grid.centre(x), terrain.height[i] + 0.035, grid.centre(z));
        mesh.setMatrixAt(k, m);
      });
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    return true;
  }
}
