import * as THREE from 'three';
import { smoothstep } from '../core/geom';
import { hash2 } from '../core/rng';
import type { EnemyDef } from '../sim/balance';
import type { CityState } from '../sim/city';
import { axes, companySize, formationCols, slotOf } from '../sim/field';
import { sampleHeight } from '../sim/terrain';
import { gapTo, type Block, type Foe, type War } from '../sim/war';
import { SoldierCrowd, type Anim, type Soldier } from './soldiers';

/** Seconds the fallen raiders lie on the field after the battle. */
const CORPSES_STAY = 60;

/** A raider tabur as the crowd draws it: its first man and how many were drawn. */
interface Band {
  foe: Foe;
  def: EnemyDef;
  start: number;
  drawn: number;
  /** Struck off the roster: fallen to the last man, or got away. */
  gone: 'fell' | 'fled' | null;
}

/**
 * The raiders, man for man. Each tabur is a block in its formation about wherever the rules
 * have it this moment, and each man makes for his place in it at his own pace, so the block
 * bends and ripples as it rides and closes up when it halts. At blows the men nearest the
 * foe press into it. Those who fall drop where they stood and lie there until the battle is
 * long over. The crowd is drawn once for a raid, and never again while it lasts.
 */
export class EnemyView {
  readonly group = new THREE.Group();
  private crowd: SoldierCrowd | null = null;
  private bands: Band[] = [];
  private war: War | null = null;
  private roster = '';
  private dead = new Uint8Array(0);
  private peace = 0;
  private scale = 1;
  private clock = 0;
  private readonly aims: Array<THREE.Vector3 | undefined> = [];

  constructor(
    private readonly city: CityState,
    /** Where one of our taburs is now, and the way it faces, to meet or shoot at it. */
    private readonly anchorOf: (id: number) => { x: number; z: number; heading: number } | null,
  ) {}

  /** Raiders drawn, for the smoke test. */
  get count(): number {
    return this.crowd?.count ?? 0;
  }

  /** Draws a new raid; marks the raiders struck off the roster of the one being fought. */
  sync(): void {
    const war = this.city.war;
    const roster = war === null ? '' : war.foes.map((f) => f.id).join(',');
    if (war === this.war && roster === this.roster) return;
    this.roster = roster;
    if (war === this.war || (war === null && this.war !== null)) {
      // The same raid, or its end: those no longer in it fell or got away.
      const keep = new Set(war?.foes.map((f) => f.id) ?? []);
      for (const band of this.bands) {
        if (band.gone !== null || keep.has(band.foe.id)) continue;
        const fled = band.foe.state === 'withdraw' || band.foe.state === 'rout';
        band.gone = fled && band.foe.men > this.city.balance.army.war.combat.destroyed ? 'fled' : 'fell';
      }
      this.war = war;
      return;
    }
    // A new raid: its men drawn afresh; the fallen of the last one are cleared away.
    this.dropCrowd();
    this.war = war;
    if (war === null || war.foes.length === 0) return;
    const soldiers: Soldier[] = [];
    for (const foe of war.foes) {
      const def = this.city.balance.army.war.enemies[foe.kind];
      this.bands.push({ foe, def, start: soldiers.length, drawn: foe.men, gone: null });
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
    }
    this.crowd = new SoldierCrowd(soldiers);
    this.dead = new Uint8Array(soldiers.length);
    this.aims.length = 0;
    this.group.add(this.crowd.group);
    // Every man straight to his place to begin with.
    this.place(1e3);
    this.crowd.update(this.scale);
  }

  update(dt: number, zoom: number, pace: number): void {
    const step = Math.min(dt, 0.1) * pace;
    this.clock += step;
    // The fallen are taken off the field a while after the battle.
    if (this.city.war !== null) this.peace = 0;
    else if (this.crowd !== null && (this.peace += dt) > CORPSES_STAY) this.dropCrowd();
    this.group.visible = zoom < 48;
    const crowd = this.crowd;
    const scale = 1 + 0.3 * smoothstep(10, 34, zoom);
    if (crowd === null || !this.group.visible) return;
    crowd.setDetail(zoom < 12 ? 0 : zoom < 24 ? 1 : 2);
    for (const s of crowd.soldiers) s.t += step;
    this.scale = scale;
    this.place(step);
    crowd.update(scale);
  }

  /** Every raider making for his place about where his tabur stands, doing what it does. */
  private place(step: number): void {
    const crowd = this.crowd;
    if (crowd === null) return;
    const { terrain } = this.city;
    for (const band of this.bands) {
      const { foe, def } = band;
      const alive = band.gone === 'fell' ? 0 : Math.min(foe.men, band.drawn);
      for (let k = alive; k < band.drawn; k++) {
        const i = band.start + k;
        if (this.dead[i] === 1) continue;
        this.dead[i] = 1;
        const s = crowd.soldiers[i];
        s.anim = 'fall';
        s.t = 0;
        s.aim = null;
        // Those who got away are gone from the field.
        if (band.gone === 'fled') s.y = -50;
      }
      if (band.gone === 'fled') {
        for (let k = 0; k < alive; k++) crowd.soldiers[band.start + k].y = -50;
        continue;
      }
      const cols = formationCols(this.city, def.formation, band.drawn);
      const a = axes(foe.heading);
      const target = foe.target === null ? null : this.anchorOf(foe.target);
      const fighting = foe.state === 'fight' && target !== null;
      const shooting = foe.state === 'shoot' && target !== null;
      const ours = fighting ? this.ourGround(foe.target!, target) : null;
      const moving = foe.state !== 'fight' && foe.state !== 'shoot' && foe.state !== 'pillage';
      const walk = walkOf(def, foe);
      const blow = animOf(def, foe, target !== null);
      const most = def.march * 2.6 * step;
      for (let k = 0; k < alive; k++) {
        const i = band.start + k;
        const s = crowd.soldiers[i];
        const [r, f] = slotOf(def, band.drawn, cols, k);
        // Raiders keep looser ranks than the city's drilled men.
        const jr = (s.seed - 0.5) * def.file * 0.8;
        const jf = (hash2(i, 7, 31) - 0.5) * def.rank * 0.5;
        let tx = foe.x + a.rx * (r + jr) + a.fx * (f + jf);
        let tz = foe.z + a.rz * (r + jr) + a.fz * (f + jf);
        if (ours !== null && target !== null) {
          const gap = gapTo(ours, tx, tz);
          if (gap < 1.4) {
            const dx = target.x - tx;
            const dz = target.z - tz;
            const len = Math.hypot(dx, dz) || 1;
            const press =
              (0.25 + 0.25 * s.seed) * (1 - gap / 1.4) + Math.sin(this.clock * 2.4 + s.seed * 6.28) * 0.08;
            tx += (dx / len) * press;
            tz += (dz / len) * press;
          }
        }
        const dx = tx - s.x;
        const dz = tz - s.z;
        const d = Math.hypot(dx, dz);
        const reach = most * (0.8 + 0.4 * hash2(i, 11, 47));
        if (d > reach) {
          s.x += (dx / d) * reach;
          s.z += (dz / d) * reach;
        } else {
          s.x = tx;
          s.z = tz;
        }
        s.y = sampleHeight(terrain, s.x, s.z) + 0.045;
        if ((fighting || shooting) && target !== null) {
          s.anim = d > 0.35 ? walk : blow;
          s.heading = Math.atan2(target.x - s.x, target.z - s.z) + (s.seed - 0.5) * 0.35;
        } else if (moving || d > 0.08) {
          s.anim = d > 0.08 || moving ? walk : blow;
          s.heading = d > 0.08 ? turn(s.heading, Math.atan2(dx, dz), 0.35) : foe.heading;
        } else {
          s.anim = blow;
          s.heading = turn(s.heading, foe.heading, 0.25);
        }
        if (shooting && target !== null) {
          const aim = (this.aims[i] ??= new THREE.Vector3());
          const jx = (hash2(i, 3, 41) - 0.5) * 1.6;
          const jz = (hash2(i, 5, 43) - 0.5) * 1.6;
          aim.set(target.x + jx, sampleHeight(terrain, target.x + jx, target.z + jz) + 0.1, target.z + jz);
          s.aim = aim;
        } else s.aim = null;
      }
    }
  }

  /** The ground one of our taburs covers, about where it is now. */
  private ourGround(id: number, at: { x: number; z: number; heading: number }): Block | null {
    const u = this.city.army.units.find((x) => x.id === id);
    if (u === undefined) return null;
    const def = this.city.balance.army.units[u.kind];
    const size = companySize(def, u.men, formationCols(this.city, u.field?.formation ?? 'kare', u.men));
    return { x: at.x, z: at.z, heading: at.heading, ...size };
  }

  private dropCrowd(): void {
    if (this.crowd !== null) {
      this.group.remove(this.crowd.group);
      this.crowd.dispose();
      this.crowd = null;
    }
    this.bands = [];
  }
}

function turn(from: number, to: number, share: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return from + d * share;
}

/** How a raider tabur's men go: riding, galloping in, marching, running. */
function walkOf(def: EnemyDef, foe: Foe): Anim {
  const fast = foe.state === 'engage' || foe.state === 'kite' || foe.state === 'rout';
  if (def.horse) return fast ? 'gallop' : 'ride';
  return fast ? 'charge' : 'march';
}

/** What a raider tabur's men do where they stand, by what the tabur is about. */
function animOf(def: EnemyDef, foe: Foe, hasTarget: boolean): Anim {
  switch (foe.state) {
    case 'shoot':
      return def.horse ? 'rideShoot' : 'shoot';
    case 'fight':
      if (!hasTarget) return def.horse ? 'stand' : 'idle';
      if (def.weapon === 'lance') return 'couch';
      if (def.weapon === 'bow') return def.horse ? 'rideShoot' : 'slash';
      return def.weapon === 'spear' ? 'thrust' : 'slash';
    default:
      return def.horse ? 'stand' : 'idle';
  }
}
