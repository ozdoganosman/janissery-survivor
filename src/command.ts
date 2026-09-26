import * as THREE from 'three';
import { FORMATION_KINDS, UNIT_KINDS, type FormationKind, type UnitKind } from './sim/balance';
import type { CityState, Notice } from './sim/city';
import { axes, faceOrder, formationOrder, haltOrder, marchOrder, returnOrder } from './sim/field';
import { sampleHeight } from './sim/terrain';
import type { Cue } from './audio/sound';
import type { World } from './render/world';
import type { ArmyCommand, CompanyPlace, OrdersPanel, OrdersView } from './ui/orders-panel';

/** Two clicks on a company this close together (ms) choose every company of its kind. */
const DOUBLE_CLICK = 350;
/** Flags over the companies in the field show this close in, and this high over them. */
const FLAG_ZOOM = 70;
const FLAG_HEIGHT = 1.1;

/**
 * The commander: which companies are chosen, and the orders given to them. Choosing is
 * done on the map (a click on a man picks his company, a box picks all inside it) or from
 * the panel; orders go to the rules in `sim/field`, and the army view marches the men.
 */
export class Commander {
  readonly selection = new Set<number>();
  private lastClick = { id: -1, time: 0 };
  private readonly v = new THREE.Vector3();

  constructor(
    private readonly city: CityState,
    private readonly world: World,
    private readonly panel: OrdersPanel,
    private readonly canvas: HTMLCanvasElement,
    private readonly say: (text: string, kind: Notice['kind']) => void,
    private readonly play: (cue: Cue) => void,
  ) {}

  // ---------------------------------------------------------------- choosing

  /** Chooses one company, or adds it to (or takes it from) those chosen. */
  pick(id: number, add: boolean): void {
    if (add) {
      if (this.selection.has(id)) this.selection.delete(id);
      else this.selection.add(id);
    } else {
      this.selection.clear();
      this.selection.add(id);
    }
    this.play('click');
  }

  selectAll(): void {
    for (const u of this.city.army.units) this.selection.add(u.id);
  }

  /** Chooses every company of a kind, and no others. */
  selectKind(kind: UnitKind): void {
    this.selection.clear();
    for (const u of this.city.army.units) if (u.kind === kind) this.selection.add(u.id);
  }

  clear(): void {
    this.selection.clear();
  }

  /**
   * A click on the ground: the company of the man nearest it, chosen (or added, or taken
   * away); a second click on it at once chooses its whole kind. False when no man is near.
   */
  clickAt(x: number, z: number, add: boolean): boolean {
    const reach = 0.25 + this.world.rig.zoom * 0.012;
    const id = this.world.army.companyAt(x, z, reach);
    if (id === null) {
      if (!add) this.selection.clear();
      return false;
    }
    const now = performance.now();
    if (this.lastClick.id === id && now - this.lastClick.time < DOUBLE_CLICK) {
      const kind = this.city.army.units.find((u) => u.id === id)?.kind;
      if (kind !== undefined) this.selectKind(kind);
      this.lastClick = { id: -1, time: 0 };
      return true;
    }
    this.lastClick = { id, time: now };
    this.pick(id, add);
    return true;
  }

  /** Chooses the companies whose middle is inside a box on the screen (client pixels). */
  selectBox(r: { x0: number; y0: number; x1: number; y1: number }, add: boolean): number {
    if (!add) this.selection.clear();
    const x0 = Math.min(r.x0, r.x1);
    const x1 = Math.max(r.x0, r.x1);
    const y0 = Math.min(r.y0, r.y1);
    const y1 = Math.max(r.y0, r.y1);
    let n = 0;
    for (const id of this.world.army.ids()) {
      const p = this.screenOf(id, 0);
      if (p === null || p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
      this.selection.add(id);
      n++;
    }
    if (n > 0) this.play('click');
    return n;
  }

  /** The box being dragged on the screen, in client pixels, or none. */
  showBox(r: { x0: number; y0: number; x1: number; y1: number } | null): void {
    this.panel.setBox(r);
  }

  // ---------------------------------------------------------------- orders

  /**
   * Sends the chosen companies to a point, drawn up side by side facing the way they came:
   * left to right as they stand now, so their paths do not cross.
   */
  marchTo(x: number, z: number): boolean {
    const ids = this.chosen();
    if (ids.length === 0) {
      this.say('Önce bölük seç.', 'info');
      return false;
    }
    const at = ids.map((id) => ({ id, p: this.world.army.anchor(id) }));
    let cx = 0;
    let cz = 0;
    let n = 0;
    for (const { p } of at) {
      if (p === null) continue;
      cx += p.x;
      cz += p.z;
      n++;
    }
    cx /= Math.max(1, n);
    cz /= Math.max(1, n);
    const far = Math.hypot(x - cx, z - cz) > 1;
    const heading = far ? Math.atan2(x - cx, z - cz) : (at[0].p?.heading ?? 0);
    const a = axes(heading);
    at.sort((p, q) => {
      const pr = p.p === null ? 0 : (p.p.x - cx) * a.rx + (p.p.z - cz) * a.rz;
      const qr = q.p === null ? 0 : (q.p.x - cx) * a.rx + (q.p.z - cz) * a.rz;
      return pr - qr;
    });
    const r = marchOrder(
      this.city,
      at.map((e) => e.id),
      x,
      z,
      heading,
    );
    if (r.problem !== undefined) {
      this.say(r.problem, 'bad');
      return false;
    }
    if (r.drilling > 0) this.say(`${r.drilling} bölük talimde, kışlada kaldı.`, 'info');
    this.play('click');
    return r.moved > 0;
  }

  home(): number {
    const n = returnOrder(this.city, this.chosen());
    if (n > 0) this.play('click');
    return n;
  }

  /** Stops the chosen companies where they are now. */
  halt(): number {
    const where = new Map<number, { x: number; z: number; heading: number }>();
    for (const id of this.chosen()) {
      if (this.world.army.destination(id) === null) continue;
      const p = this.world.army.anchor(id);
      if (p !== null) where.set(id, p);
    }
    const n = haltOrder(this.city, where);
    if (n > 0) this.play('click');
    return n;
  }

  turn(by: number): number {
    const n = faceOrder(this.city, this.chosen(), by);
    if (n > 0) this.play('click');
    return n;
  }

  formation(f: FormationKind): number {
    const n = formationOrder(this.city, this.chosen(), f);
    if (n === 0) this.say('Önce bölükleri sahaya çıkar.', 'info');
    else this.play('click');
    return n;
  }

  command(cmd: ArmyCommand): void {
    switch (cmd.kind) {
      case 'home':
        this.home();
        break;
      case 'halt':
        this.halt();
        break;
      case 'turn':
        this.turn(cmd.by);
        break;
      case 'formation':
        this.formation(cmd.formation);
        break;
      case 'selectAll':
        this.selectAll();
        break;
      case 'selectKind':
        this.selectKind(cmd.unit);
        break;
      case 'clear':
        this.clear();
        break;
    }
  }

  // ---------------------------------------------------------------- every frame

  /** Keeps the choice to companies that exist, and draws it: frames, flags and the panel. */
  update(commanding: boolean, touch: boolean): void {
    const units = this.city.army.units;
    const exists = new Set(units.map((u) => u.id));
    for (const id of this.selection) if (!exists.has(id)) this.selection.delete(id);
    const army = this.world.army;
    const now = [];
    const to = [];
    for (const id of this.selection) {
      const f = army.footprint(id);
      if (f !== null) now.push(f);
      const d = army.destination(id);
      if (d !== null) to.push(d);
    }
    this.world.selection.set(now, to, this.world.rig.zoom);

    // Flags over every company out of the barracks, or on its way.
    const rig = this.world.rig;
    const places: CompanyPlace[] = [];
    const show = rig.zoom < FLAG_ZOOM;
    if (show) {
      for (const u of units) {
        const moving = army.destination(u.id) !== null;
        if (u.field === null && !moving) continue;
        const p = this.screenOf(u.id, FLAG_HEIGHT);
        if (p === null) continue;
        const def = this.city.balance.army.units[u.kind];
        places.push({
          id: u.id,
          x: p.x,
          y: p.y,
          kind: u.kind,
          label: `${u.men}`,
          title: `${def.name} · ${u.men} er${moving ? ' · yürüyüşte' : ''}`,
          selected: this.selection.has(u.id),
          moving,
        });
      }
    }
    this.panel.placeCompanies(places, show);
    this.panel.show(commanding ? this.view(touch) : null);
  }

  private view(touch: boolean): OrdersView {
    const units = this.city.army.units.filter((u) => this.selection.has(u.id));
    const defs = this.city.balance.army.units;
    const kinds = UNIT_KINDS.map((kind) => {
      const of = units.filter((u) => u.kind === kind);
      return { kind, name: defs[kind].name, units: of.length, men: of.reduce((n, u) => n + u.men, 0) };
    }).filter((k) => k.units > 0);
    const out = units.filter((u) => u.field !== null);
    const forms = new Set(out.map((u) => u.field!.formation));
    return {
      companies: units.length,
      men: units.reduce((n, u) => n + u.men, 0),
      out: out.length,
      moving: units.filter((u) => this.world.army.destination(u.id) !== null).length,
      drilling: units.filter((u) => u.drill !== null).length,
      total: this.city.army.units.length,
      kinds,
      formation: forms.size === 1 ? [...forms][0] : null,
      formations: FORMATION_KINDS.map((f) => ({
        kind: f,
        name: this.city.balance.army.formations[f].name,
        hint: this.city.balance.army.formations[f].hint,
      })),
      touch,
    };
  }

  /** The chosen companies that still exist. */
  private chosen(): number[] {
    return this.city.army.units.filter((u) => this.selection.has(u.id)).map((u) => u.id);
  }

  /** Where a company's middle is on the screen, in client pixels, or null off screen. */
  private screenOf(id: number, lift: number): { x: number; y: number } | null {
    const p = this.world.army.anchor(id);
    if (p === null) return null;
    const rig = this.world.rig;
    this.v.set(p.x, sampleHeight(this.city.terrain, p.x, p.z) + lift, p.z).project(rig.camera);
    if (Math.abs(this.v.x) > 1.05 || Math.abs(this.v.y) > 1.05) return null;
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: rect.left + ((this.v.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - this.v.y) / 2) * rect.height,
    };
  }
}
