import * as THREE from 'three';
import { dateOf } from '../sim/calendar';
import type { CityState } from '../sim/city';
import { sampleHeight } from '../sim/terrain';
import { BuildingsView } from './buildings-view';
import { CameraRig } from './camera-rig';
import { CursorView } from './cursor-view';
import { FieldsView } from './fields-view';
import { HousesView } from './houses-view';
import { shading } from './materials';
import { PeopleView } from './people-view';
import { MiniPipeline } from './pipeline';
import { RoadsView } from './roads-view';
import { TerrainView } from './terrain-view';
import { TreesView } from './trees-view';
import { WorksView } from './works-view';

/** Sun direction, from the ground towards the light: low from the south-west. */
const SUN = new THREE.Vector3(-0.55, 0.9, 0.5).normalize();

/**
 * Everything drawn: the scene, its views of the city, the camera and the miniature
 * pipeline. Knows nothing about input or rules; it draws whatever state it is given.
 */
export class World {
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  readonly terrain: TerrainView;
  readonly cursor: CursorView;
  private readonly roads: RoadsView;
  private readonly houses: HousesView;
  private readonly trees: TreesView;
  private readonly fields: FieldsView;
  private readonly works: WorksView;
  readonly people: PeopleView;
  private readonly pipeline: MiniPipeline;
  /** Seconds since the city layers were last compared with the simulation. */
  private sinceSync = Infinity;
  private readonly sun = new THREE.DirectionalLight('#ffffff', Math.PI);
  private shadowDirty = true;

  constructor(
    readonly renderer: THREE.WebGLRenderer,
    readonly city: CityState,
  ) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    // Shadows are redrawn only when the view or the city changes, not every frame. The
    // first frame must still draw the map once: every material samples it, and sampling a
    // shadow map that was never rendered is a WebGL error that silently drops the draw.
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.rig = new CameraRig(city.grid.half, (x, z) => sampleHeight(city.terrain, x, z));
    this.terrain = new TerrainView(city);
    this.roads = new RoadsView(city);
    this.houses = new HousesView(city);
    this.trees = new TreesView(city);
    this.fields = new FieldsView(city);
    this.works = new WorksView(city);
    this.people = new PeopleView(city);
    this.cursor = new CursorView(city);
    this.scene.add(
      this.terrain.group,
      this.fields.group,
      this.roads.group,
      this.houses.group,
      this.trees.group,
      new BuildingsView(city).group,
      this.works.group,
      this.people.group,
      this.cursor.group,
    );

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);

    this.pipeline = new MiniPipeline(renderer, this.scene, this.rig.camera);
  }

  /** Marks the resource sites on the ground, while a quarry is being placed. */
  showSites(on: boolean): void {
    if (this.terrain.sitesVisible !== on) this.terrain.setSitesVisible(on);
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.pipeline.setSize(width, height, pixelRatio);
    this.rig.setAspect(width / height);
    this.shadowDirty = true;
  }

  /** Advances animation and redraws. */
  frame(dt: number, elapsed: number): void {
    const moved = this.rig.update(dt);
    // Each view compares the revisions it depends on; houses and trees also follow roads.
    // At the fastest speed houses rise every few frames, so rebuilds are batched a little.
    this.sinceSync += dt;
    let changed = false;
    if (this.sinceSync >= 0.2) {
      this.sinceSync = 0;
      // The year turns: the ground, the roofs and the trees take the month's colours.
      const month = dateOf(this.city.calendar).month;
      this.houses.setMonth(month);
      this.trees.setMonth(month);
      const results = [
        this.terrain.setMonth(month),
        this.roads.sync(),
        this.houses.sync(),
        this.trees.sync(),
        this.fields.sync(),
        this.works.sync(),
      ];
      this.people.sync();
      changed = results.some((r) => r);
    }
    this.terrain.update(elapsed);
    this.works.update(elapsed);
    this.people.update(dt, this.rig.zoom);
    this.applyCloseness(moved || changed);
    this.pipeline.render();
  }

  /** Blends from flat page to lit model as the camera comes close. */
  private applyCloseness(viewChanged: boolean): void {
    const k = this.rig.closeness;
    shading.uAmbient.value = 0.8 - 0.2 * k;
    shading.uDirect.value = 0.2 + 0.26 * k;
    shading.uShadow.value = k;
    if (k <= 0) return;
    if (viewChanged) this.shadowDirty = true;
    if (!this.shadowDirty) return;
    // The shadow camera covers just the visible area, so shadows stay sharp.
    const t = this.rig.target;
    const extent = this.rig.zoom * 1.9;
    const cam = this.sun.shadow.camera;
    cam.left = -extent;
    cam.right = extent;
    cam.top = extent;
    cam.bottom = -extent;
    cam.near = 1;
    cam.far = 160;
    cam.updateProjectionMatrix();
    this.sun.target.position.copy(t);
    this.sun.position.copy(t).addScaledVector(SUN, 80);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
    this.renderer.shadowMap.needsUpdate = true;
    this.shadowDirty = false;
  }
}
