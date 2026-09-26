import * as THREE from 'three';
import { smoothstep } from '../core/geom';
import { hash2 } from '../core/rng';
import type { EnemyDef } from '../sim/balance';
import type { CityState } from '../sim/city';
import { axes, formationCols, slotOf } from '../sim/field';
import { sampleHeight } from '../sim/terrain';
import type { Foe, War } from '../sim/war';
import { SoldierCrowd, type Anim, type Soldier } from './soldiers';

/** Seconds the fallen raiders lie on the field after the battle, and the most kept. */
const CORPSES_STAY = 60;
const MOST_CORPSES = 4000;

/** A raider tabur as the crowd draws it: its first man and how many were drawn. */
interface Band {
  foe: Foe;
  def: EnemyDef;
  start: number;
  drawn: number;
}

/**
 * The raiders, man for man. Each tabur is a block in its formation, standing wherever the
 * rules have it this moment: riding in, drawn up to shoot, at blows, pillaging, running.
 * Those who fall drop where they stood and lie there until the battle is long over.
 */
export class EnemyView {
  readonly group = new THREE.Group();
  private crowd: SoldierCrowd | null = null;
  private bands: Band[] = [];
  private war: War | null = null;
  private roster = '';
  private dead = new Uint8Array(0);
  private corpses: Soldier[] = [];
  private corpseCrowd: SoldierCrowd | null = null;
  private peace = 0;
  private scale = 1;
  private readonly aims: Array<THREE.Vector3 | undefined> = [];

  constructor(
    private readonly city: CityState,
    /** Where one of our taburs is now, to shoot at it. */
    private readonly anchorOf: (id: number) => { x: number; z: number } | null,
  ) {}

  /** Raiders drawn, for the smoke test. */
  get count(): number {
    return this.crowd?.count ?? 0;
  }

  /** Draws the raiders anew when the raid, or who is in it, has changed. */
  sync(): void {
    const war = this.city.war;
    const roster = war === null ? '' : war.foes.map((f) => f.id).join(',');
    if (war === this.war && roster === this.roster) return;
    this.dropCrowd(war);
    this.war = war;
    this.roster = roster;
    if (war === null || war.foes.length === 0) return;
    const soldiers: Soldier[] = [];
    this.bands = [];
    for (const foe of war.foes) {
      const def = this.city.balance.army.war.enemies[foe.kind];
      const band: Band = { foe, def, start: soldiers.length, drawn: foe.men };
      for (let k = 0; k < foe.men; k++) {
        soldiers.push({
          kind: foe.kind,
          x: foe.x,
          y: 0,
          z: foe.z,
          heading: foe.heading,
          anim: def.horse ? 'stand' : 'idle',
          t: hash2(foe.id, k, 23) * 20,
          aim: null,
          seed: hash2(foe.id, k, 29),
        });
      }
      this.bands.push(band);
    }
    this.crowd = new SoldierCrowd(soldiers);
    this.dead = new Uint8Array(soldiers.length);
    this.aims.length = 0;
    this.group.add(this.crowd.group);
    this.place(0);
    this.crowd.update(this.scale);
  }

  update(dt: number, zoom: number, pace: number): void {
    if (this.city.war !== null) this.peace = 0;
    else if (this.corpses.length > 0 && (this.peace += dt) > CORPSES_STAY) {
      this.corpses = [];
      this.layCorpses();
    }
    this.group.visible = zoom < 48;
    const crowd = this.crowd;
    const scale = 1 + 0.3 * smoothstep(10, 34, zoom);
    if (Math.abs(scale - this.scale) > 1e-3) {
      this.scale = scale;
      this.corpseCrowd?.update(scale);
    }
    if (crowd === null || !this.group.visible) return;
    crowd.setDetail(zoom < 12 ? 0 : zoom < 24 ? 1 : 2);
    const step = Math.min(dt, 0.1) * pace;
    for (const s of crowd.soldiers) s.t += step;
    this.place(step);
    crowd.update(scale);
  }

  /** Every raider where his tabur stands now, doing what it does. */
  private place(step: number): void {
    const crowd = this.crowd;
    if (crowd === null) return;
    void step;
    const { terrain } = this.city;
    for (const band of this.bands) {
      const { foe, def } = band;
      const alive = Math.min(foe.men, band.drawn);
      for (let k = alive; k < band.drawn; k++) {
        const i = band.start + k;
        if (this.dead[i] === 1) continue;
        this.dead[i] = 1;
        const s = crowd.soldiers[i];
        s.anim = 'fall';
        s.t = 0;
        s.aim = null;
      }
      const cols = formationCols(this.city, def.formation, band.drawn);
      const a = axes(foe.heading);
      const target = foe.target === null ? null : this.anchorOf(foe.target);
      const anim = animOf(def, foe, target !== null);
      for (let k = 0; k < alive; k++) {
        const i = band.start + k;
        const s = crowd.soldiers[i];
        const [r, f] = slotOf(def, band.drawn, cols, k);
        // Raiders keep looser ranks than the city's drilled men.
        const jr = (s.seed - 0.5) * def.file * 0.8;
        const jf = (hash2(i, 7, 31) - 0.5) * def.rank * 0.5;
        s.x = foe.x + a.rx * (r + jr) + a.fx * (f + jf);
        s.z = foe.z + a.rz * (r + jr) + a.fz * (f + jf);
        s.y = sampleHeight(terrain, s.x, s.z) + 0.045;
        s.anim = anim;
        if (target !== null && (foe.state === 'shoot' || foe.state === 'fight')) {
          s.heading = Math.atan2(target.x - s.x, target.z - s.z);
        } else s.heading = foe.heading;
        if (foe.state === 'shoot' && target !== null) {
          const aim = (this.aims[i] ??= new THREE.Vector3());
          const jx = (hash2(i, 3, 41) - 0.5) * 1.6;
          const jz = (hash2(i, 5, 43) - 0.5) * 1.6;
          aim.set(target.x + jx, sampleHeight(terrain, target.x + jx, target.z + jz) + 0.1, target.z + jz);
          s.aim = aim;
        } else s.aim = null;
      }
    }
  }

  /** Takes the crowd down, laying its fallen among the corpses. */
  private dropCrowd(next: War | null): void {
    const crowd = this.crowd;
    if (crowd !== null) {
      let fell = false;
      // Raiders struck off the roster in battle fall where they stand; those who got away go.
      const keep = new Set(next?.foes.map((f) => f.id) ?? []);
      for (const band of this.bands) {
        const broken = !keep.has(band.foe.id) && band.foe.state !== 'withdraw' && band.foe.state !== 'rout';
        for (let k = 0; k < band.drawn; k++) {
          const i = band.start + k;
          if (this.dead[i] !== 1 && !(broken && k < band.foe.men)) continue;
          this.corpses.push({ ...crowd.soldiers[i], anim: 'fall', t: 5, aim: null });
          fell = true;
        }
      }
      if (fell) {
        if (this.corpses.length > MOST_CORPSES) this.corpses.splice(0, this.corpses.length - MOST_CORPSES);
        this.layCorpses();
      }
      this.group.remove(crowd.group);
      crowd.dispose();
      this.crowd = null;
    }
    this.bands = [];
  }

  private layCorpses(): void {
    if (this.corpseCrowd !== null) {
      this.group.remove(this.corpseCrowd.group);
      this.corpseCrowd.dispose();
      this.corpseCrowd = null;
    }
    if (this.corpses.length === 0) return;
    this.corpseCrowd = new SoldierCrowd(this.corpses, 0);
    this.group.add(this.corpseCrowd.group);
    this.corpseCrowd.update(this.scale);
  }
}

/** What a raider tabur's men are doing, by what the tabur is about. */
function animOf(def: EnemyDef, foe: Foe, hasTarget: boolean): Anim {
  switch (foe.state) {
    case 'shoot':
      return def.horse ? 'rideShoot' : 'shoot';
    case 'fight':
      if (!hasTarget) return def.horse ? 'stand' : 'idle';
      if (def.weapon === 'lance') return 'couch';
      if (def.weapon === 'bow') return def.horse ? 'rideShoot' : 'slash';
      return def.weapon === 'spear' ? 'thrust' : 'slash';
    case 'engage':
    case 'kite':
    case 'rout':
      return def.horse ? 'gallop' : 'charge';
    case 'advance':
    case 'withdraw':
      return def.horse ? 'ride' : 'march';
    case 'pillage':
      return def.horse ? 'stand' : 'idle';
  }
}
