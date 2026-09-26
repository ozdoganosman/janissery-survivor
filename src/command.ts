import * as THREE from 'three';
import {
  ECHELON_LEVELS,
  FORMATION_KINDS,
  TEST_RAIDS,
  UNIT_KINDS,
  type EchelonLevel,
  type FormationKind,
  type TestRaid,
  type UnitKind,
} from './sim/balance';
import type { Unit } from './sim/army';
import type { CityState, Notice } from './sim/city';
import {
  echelonKind,
  echelonName,
  echelonOf,
  exactEchelon,
  formEchelon,
  formProblem,
  orderByEchelon,
  taburs,
  widen,
  type Echelon,
} from './sim/echelons';
import { axes, faceOrder, formationOrder, haltOrder, marchOrder, planMarch, returnOrder } from './sim/field';
import { sampleHeight } from './sim/terrain';
import {
  attackOrder,
  dropAttack,
  foeAt,
  foeGroundOf,
  moraleShare,
  sendRaid,
  type Fighter,
  type FoeState,
} from './sim/war';
import type { Cue } from './audio/sound';
import type { Footprint } from './render/army-view';
import type { Lead } from './render/selection-view';
import type { World } from './render/world';
import type {
  ArmyCommand,
  CompanyPlace,
  EchelonRow,
  FlagKey,
  OrdersPanel,
  OrdersView,
  WarView,
} from './ui/orders-panel';

/** A right drag shorter than this (tiles) is a click; the front is redrawn this often (ms). */
const MIN_FRONT = 0.8;
const FRONT_EVERY = 60;

/** Two clicks on a company this close together (ms) choose its whole tugay. */
const DOUBLE_CLICK = 350;
/** Flags stand this high over the companies in the field. */
const FLAG_HEIGHT = 1.1;
/**
 * Flags cover about this much of the screen (px). When too many of them would overlap, the
 * flags of the taburs give way to those of their tugays, and those to their kolordus' and
 * ordus'; they part again when the camera comes closer. The level is looked at this often.
 */
const FLAG_W = 52;
const ECHELON_FLAG_W = 104;
const FLAG_H = 18;
const FLAG_EVERY = 200;
/** Flags, from the finest: the taburs', then each echelon's. */
type FlagLevel = 'tabur' | EchelonLevel;
const FLAG_LEVELS: readonly FlagLevel[] = ['tabur', ...ECHELON_LEVELS];

/** What a raider tabur is about, in words for its flag. */
const FOE_DOING: Record<FoeState, string> = {
  advance: 'ilerliyor',
  engage: 'saldırıya geçiyor',
  shoot: 'ok atıyor',
  kite: 'geri çekilip ok atıyor',
  fight: 'çarpışıyor',
  pillage: 'yağmalıyor',
  withdraw: 'yağmayla çekiliyor',
  rout: 'bozgunda',
};

/** What one of our taburs is about in battle, in words for its flag. */
const OUR_DOING: Record<Fighter['state'], string> = {
  idle: 'bekliyor',
  move: 'yürüyor',
  shoot: 'ok atıyor',
  fight: 'çarpışıyor',
  rout: 'bozgunda',
};

/**
 * The commander: which taburs are chosen, and the orders given to them. Choosing is done
 * on the map (a click on a man picks his tabur, a second click his tugay, a box picks all
 * inside it, a flag picks its tabur or echelon) or from the panel; orders go to the rules
 * in `sim/field`, and the army view marches the men.
 */
export class Commander {
  readonly selection = new Set<number>();
  private lastClick = { id: -1, time: 0 };
  /** The front being drawn with a right drag, as the companies would stand on it. */
  private preview: Footprint[] = [];
  private lead: Lead | null = null;
  private previewAt = { time: 0, x: NaN, z: NaN };
  private flagLevel = 0;
  private foeFlagLevel = 0;
  private flagAt = 0;
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

  /** Chooses every tabur of an echelon, or adds them (or takes them away, if all were chosen). */
  selectEchelon(id: number, add: boolean): void {
    const under = taburs(this.city, id).map((u) => u.id);
    if (under.length === 0) return;
    if (add && under.every((t) => this.selection.has(t))) {
      for (const t of under) this.selection.delete(t);
    } else {
      if (!add) this.selection.clear();
      for (const t of under) this.selection.add(t);
    }
    this.play('click');
  }

  /** A flag on the map was clicked: its tabur, or its echelon; a raider's is attacked. */
  pickFlag(key: FlagKey, add: boolean): void {
    if (key.foe) this.attack(key.id);
    else if (key.echelon) this.selectEchelon(key.id, add);
    else this.pick(key.id, add);
  }

  /** Widens the choice to the echelon one up: a tabur to its tugay, a tugay to its kolordu. */
  climb(): boolean {
    const now = this.chosen();
    if (now.length === 0) {
      this.say('Önce tabur seç.', 'info');
      return false;
    }
    const wider = widen(this.city, now);
    if (wider.length === now.length) return false;
    for (const id of wider) this.selection.add(id);
    this.play('click');
    return true;
  }

  /** Gathers the chosen taburs into a new echelon of `level`. */
  form(level: EchelonLevel): boolean {
    const r = formEchelon(this.city, level, this.chosen());
    if (r.problem !== undefined || r.echelon === undefined) {
      this.say(r.problem ?? 'Olmadı.', 'info');
      return false;
    }
    this.say(`${echelonName(this.city, r.echelon)} kuruldu.`, 'good');
    this.play('click');
    return true;
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
      // The second click: the tabur's whole tugay.
      if (!add) this.selection.clear();
      this.selection.add(id);
      for (const t of widen(this.city, [id])) this.selection.add(t);
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
   * left to right as they stand now, so their paths do not cross, and each echelon's
   * taburs together.
   */
  marchTo(x: number, z: number): boolean {
    const ids = this.chosen();
    if (ids.length === 0) {
      this.say('Önce tabur seç.', 'info');
      return false;
    }
    // On a raider: go for it.
    const foe = foeAt(this.city, x, z, 0.3 + this.world.rig.zoom * 0.012);
    if (foe !== null) return this.attack(foe.id);
    dropAttack(this.city, ids);
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
    const across = new Map(
      at.map((e) => [e.id, e.p === null ? 0 : (e.p.x - cx) * a.rx + (e.p.z - cz) * a.rz]),
    );
    const order = orderByEchelon(this.city, ids, (id) => across.get(id) ?? 0);
    const r = marchOrder(this.city, order, x, z, heading, { groups: this.groups(order) });
    if (r.problem !== undefined) {
      this.say(r.problem, 'bad');
      return false;
    }
    if (r.drilling > 0) this.say(`${r.drilling} tabur talimde, kışlada kaldı.`, 'info');
    this.play('click');
    return r.moved > 0;
  }

  /**
   * The front line a right drag draws, from where the button went down to where it is now:
   * the army's front rank runs along it, left to right, and it faces square to it, away
   * from whoever drew it left to right. Shown, not yet ordered.
   */
  drawFront(a: { x: number; z: number }, b: { x: number; z: number }): void {
    const now = performance.now();
    const moved = Math.hypot(b.x - this.previewAt.x, b.z - this.previewAt.z);
    // Worked out afresh as the pointer moves, but not more often than the eye can follow.
    if (now - this.previewAt.time < FRONT_EVERY && moved < 0.5) return;
    this.previewAt = { time: now, x: b.x, z: b.z };
    const f = this.frontOf(a, b);
    if (f === null) {
      this.preview = [];
      this.lead = null;
      return;
    }
    this.lead = { x: f.x, z: f.z, heading: f.heading, width: f.width };
    const r = planMarch(this.city, f.ids, f.x, f.z, f.heading, {
      width: f.width,
      groups: this.groups(f.ids),
    });
    this.preview = r.plan.map((p) => ({ x: p.x, z: p.z, heading: p.heading, w: p.w, d: p.d }));
  }

  /** Stops showing the front being drawn. */
  dropFront(): void {
    this.preview = [];
    this.lead = null;
    this.previewAt = { time: 0, x: NaN, z: NaN };
  }

  /** Sends the chosen companies to stand along the front drawn from `a` to `b`. */
  marchFront(a: { x: number; z: number }, b: { x: number; z: number }): boolean {
    this.dropFront();
    const f = this.frontOf(a, b);
    if (f === null) return this.marchTo(a.x, a.z);
    dropAttack(this.city, f.ids);
    const r = marchOrder(this.city, f.ids, f.x, f.z, f.heading, {
      width: f.width,
      groups: this.groups(f.ids),
    });
    if (r.problem !== undefined) {
      this.say(r.problem, 'bad');
      return false;
    }
    if (r.drilling > 0) this.say(`${r.drilling} tabur talimde, kışlada kaldı.`, 'info');
    this.play('click');
    return r.moved > 0;
  }

  /** The chosen companies, left to right as they stand, and the front from `a` to `b`. */
  private frontOf(
    a: { x: number; z: number },
    b: { x: number; z: number },
  ): { ids: number[]; x: number; z: number; heading: number; width: number } | null {
    const ids = this.chosen();
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (ids.length === 0 || len < MIN_FRONT) return null;
    // Along the front is the army's right hand; its heading follows from that.
    const rx = (b.x - a.x) / len;
    const rz = (b.z - a.z) / len;
    const heading = Math.atan2(rz, -rx);
    const along = (id: number): number => {
      const p = this.world.army.anchor(id);
      return p === null ? 0 : p.x * rx + p.z * rz;
    };
    const order = orderByEchelon(this.city, ids, along);
    return { ids: order, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, heading, width: len };
  }

  /** The tugay of each tabur, so a march keeps each tugay's taburs together. */
  private groups(ids: readonly number[]): Map<number, number> {
    const set = new Set(ids);
    return new Map(this.city.army.units.filter((u) => set.has(u.id)).map((u) => [u.id, u.tugay ?? -u.id]));
  }

  /** Sends the chosen companies against a raider tabur. */
  attack(foe: number): boolean {
    const ids = this.chosen();
    if (ids.length === 0) {
      this.say('Önce tabur seç.', 'info');
      return false;
    }
    const n = attackOrder(this.city, ids, foe);
    if (n === 0) {
      this.say('Bu taburlar saldıramaz.', 'info');
      return false;
    }
    this.play('click');
    return true;
  }

  /** Sends a raid to try the army against: small, middling or large. */
  raid(size: TestRaid): void {
    const kinds = this.city.balance.army.war.raids.kinds;
    const kind = Math.floor(Math.random() * kinds.length);
    const [lo, hi] = kinds[kind].from;
    const r = sendRaid(this.city, this.city.balance.army.war.raids.tests[size], {
      kind,
      bearing: lo + (hi - lo) * Math.random(),
      trial: true,
    });
    if (typeof r === 'string') this.say(r, 'info');
    else this.play('click');
  }

  /** Brings the camera to the raiders. */
  showRaid(): void {
    const war = this.city.war;
    if (war === null || war.foes.length === 0) return;
    let x = 0;
    let z = 0;
    for (const f of war.foes) {
      x += f.x;
      z += f.z;
    }
    this.world.rig.setView(x / war.foes.length, z / war.foes.length, 26);
  }

  home(): number {
    dropAttack(this.city, this.chosen());
    const n = returnOrder(this.city, this.chosen());
    if (n > 0) this.play('click');
    return n;
  }

  /** Stops the chosen companies where they are now. */
  halt(): number {
    dropAttack(this.city, this.chosen());
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
    dropAttack(this.city, this.chosen());
    const n = faceOrder(this.city, this.chosen(), by);
    if (n > 0) this.play('click');
    return n;
  }

  formation(f: FormationKind): number {
    dropAttack(this.city, this.chosen());
    const n = formationOrder(this.city, this.chosen(), f);
    if (n === 0) this.say('Önce taburları sahaya çıkar.', 'info');
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
      case 'selectEchelon':
        this.selectEchelon(cmd.id, cmd.add);
        break;
      case 'selectTabur':
        this.pick(cmd.id, cmd.add);
        break;
      case 'climb':
        this.climb();
        break;
      case 'form':
        this.form(cmd.level);
        break;
      case 'raid':
        this.raid(cmd.size);
        break;
      case 'showRaid':
        this.showRaid();
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
    const drawing = this.preview.length > 0;
    // The raiders the chosen are sent against, framed in red.
    const war = this.city.war;
    const marked: Footprint[] = [];
    if (war !== null) {
      const sent = new Set<number>();
      for (const id of this.selection) {
        const order = (war.fighters[id] as Fighter | undefined)?.order;
        if (order !== null && order !== undefined) sent.add(order.foe);
      }
      for (const foe of war.foes) {
        if (!sent.has(foe.id)) continue;
        const g = foeGroundOf(this.city, foe);
        marked.push({ x: g.x, z: g.z, heading: g.heading, w: g.w + 0.24, d: g.d + 0.24 });
      }
    }
    this.world.selection.set(
      now,
      drawing ? this.preview : to,
      this.world.rig.zoom,
      drawing ? this.lead : null,
      marked,
    );

    // Flags over the taburs out of the barracks, or on their way, or over their echelons;
    // and over the raiders.
    this.panel.placeCompanies(unstack([...this.flags(units), ...this.foeFlags()]), true);
    this.panel.show(commanding ? this.view(touch) : null);
    this.panel.showWar(this.warView());
  }

  /** The raid, as the banner over the map tells it. */
  private warView(): WarView | null {
    const war = this.city.war;
    if (war === null) return null;
    return {
      name: war.name,
      people: war.people,
      gate: war.gate,
      foes: war.foes.length,
      men: war.foes.reduce((s, f) => s + f.men, 0),
      killed: war.killed,
      lost: war.lost,
      pillaging: war.foes.some((f) => f.state === 'pillage'),
      trial: war.trial,
    };
  }

  /** A flag over each raider tabur, or one over the whole raid where they would crowd. */
  private foeFlags(): CompanyPlace[] {
    const war = this.city.war;
    if (war === null || war.foes.length === 0) return [];
    const defs = this.city.balance.army.war.enemies;
    const each = (): CompanyPlace[] => {
      const out: CompanyPlace[] = [];
      for (const foe of war.foes) {
        const p = this.screenAt(foe.x, foe.z, FLAG_HEIGHT);
        if (p === null) continue;
        const def = defs[foe.kind];
        out.push({
          key: { echelon: false, foe: true, id: foe.id },
          x: p.x,
          y: p.y,
          kind: foe.kind,
          level: 'tabur',
          short: '',
          label: `${foe.men}`,
          title: `${def.name} · ${foe.men} er · ${FOE_DOING[foe.state]} (sağ tık ya da tıkla: seçili taburlarla saldır)`,
          selected: 'none',
          moving: foe.state === 'advance' || foe.state === 'withdraw' || foe.state === 'rout',
          bar: moraleShare(this.city, foe.morale, def),
        });
      }
      return out;
    };
    const places = each();
    if (this.foeFlagLevel === 0 && crowded(places, 1)) this.foeFlagLevel = 1;
    else if (this.foeFlagLevel === 1 && !crowded(places, 1.3)) this.foeFlagLevel = 0;
    if (this.foeFlagLevel === 0) return places;
    // One flag over the middle of the raid.
    let x = 0;
    let z = 0;
    for (const f of war.foes) {
      x += f.x;
      z += f.z;
    }
    const p = this.screenAt(x / war.foes.length, z / war.foes.length, FLAG_HEIGHT * 1.8);
    if (p === null) return [];
    const men = war.foes.reduce((s, f) => s + f.men, 0);
    const first = war.foes[0];
    return [
      {
        key: { echelon: false, foe: true, id: first.id },
        x: p.x,
        y: p.y,
        kind: first.kind,
        level: 'ordu',
        short: war.people,
        label: fmt(men),
        title: `${war.name} · ${war.foes.length} tabur, ${fmt(men)} er`,
        selected: 'none',
        moving: false,
      },
    ];
  }

  /**
   * The flags for this frame: one over each tabur in the field, or, where those would
   * crowd one another, one over each tugay, kolordu or ordu with taburs in the field.
   */
  private flags(units: Unit[]): CompanyPlace[] {
    const army = this.world.army;
    const out: Array<{ u: Unit; x: number; z: number; moving: boolean }> = [];
    for (const u of units) {
      const moving = army.destination(u.id) !== null;
      if (u.field === null && !moving) continue;
      const p = army.anchor(u.id);
      if (p !== null) out.push({ u, x: p.x, z: p.z, moving });
    }
    if (out.length === 0) return [];
    const at = (level: number): CompanyPlace[] => this.flagsAt(FLAG_LEVELS[level], out);
    const now = performance.now();
    if (now - this.flagAt > FLAG_EVERY) {
      this.flagAt = now;
      // Up while the flags would crowd; down while the finer ones would stand clear.
      let level = this.flagLevel;
      while (level < FLAG_LEVELS.length - 1 && crowded(at(level), 1)) level++;
      while (level > 0 && !crowded(at(level - 1), 1.3)) level--;
      this.flagLevel = level;
    }
    return at(this.flagLevel);
  }

  private flagsAt(
    level: FlagLevel,
    out: Array<{ u: Unit; x: number; z: number; moving: boolean }>,
  ): CompanyPlace[] {
    const defs = this.city.balance.army.units;
    const places: CompanyPlace[] = [];
    if (level === 'tabur') {
      for (const { u, x, z, moving } of out) {
        const p = this.screenAt(x, z, FLAG_HEIGHT);
        if (p === null) continue;
        const fighter = this.city.war?.fighters[u.id];
        places.push({
          key: { echelon: false, id: u.id },
          x: p.x,
          y: p.y,
          kind: u.kind,
          level: 'tabur',
          short: '',
          label: `${u.men}`,
          title:
            `${defs[u.kind].name} taburu · ${u.men} er` +
            (fighter !== undefined
              ? ` · ${OUR_DOING[fighter.state]} · moral %${Math.round(moraleShare(this.city, fighter.morale, defs[u.kind]) * 100)}`
              : moving
                ? ' · yürüyüşte'
                : ''),
          selected: this.selection.has(u.id) ? 'all' : 'none',
          moving,
          ...(fighter !== undefined ? { bar: moraleShare(this.city, fighter.morale, defs[u.kind]) } : {}),
        });
      }
      return places;
    }
    // Each echelon's flag stands over the middle of its taburs in the field.
    const groups = new Map<
      number,
      { e: Echelon; x: number; z: number; n: number; men: number; moving: number }
    >();
    for (const { u, x, z, moving } of out) {
      const e = echelonOf(this.city, u, level);
      if (e === undefined) continue;
      const g = groups.get(e.id) ?? { e, x: 0, z: 0, n: 0, men: 0, moving: 0 };
      g.x += x;
      g.z += z;
      g.n++;
      g.men += u.men;
      if (moving) g.moving++;
      groups.set(e.id, g);
    }
    const def = this.city.balance.army.echelons[level];
    for (const g of groups.values()) {
      const p = this.screenAt(g.x / g.n, g.z / g.n, FLAG_HEIGHT * 1.6);
      if (p === null) continue;
      const under = taburs(this.city, g.e.id);
      const chosen = under.filter((u) => this.selection.has(u.id)).length;
      const kind = echelonKind(this.city, g.e.id);
      const home = under.length - g.n;
      places.push({
        key: { echelon: true, id: g.e.id },
        x: p.x,
        y: p.y,
        kind: kind ?? 'karma',
        level,
        short: `${g.e.no}. ${def.short}`,
        label: fmt(g.men),
        title:
          `${echelonName(this.city, g.e)}${kind !== null ? ` (${defs[kind].name})` : ''} · ` +
          `${g.n} tabur sahada · ${fmt(g.men)} er` +
          (home > 0 ? ` · ${home} tabur kışlada` : '') +
          (g.moving > 0 ? ' · yürüyüşte' : ''),
        selected: chosen === 0 ? 'none' : chosen === under.length ? 'all' : 'some',
        moving: g.moving > 0,
      });
    }
    return places;
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
    const ids = units.map((u) => u.id);
    const whole = exactEchelon(this.city, ids);
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
      echelon: whole === null ? null : echelonName(this.city, whole),
      canClimb: units.length > 0 && widen(this.city, ids).length > units.length,
      forms: ECHELON_LEVELS.map((level) => {
        const d = this.city.balance.army.echelons[level];
        return { level, name: d.name, hint: d.hint, problem: formProblem(this.city, level, ids) };
      }),
      tree: this.tree(),
      raid: this.city.war !== null,
      raids: TEST_RAIDS.map((size) => ({ size, taburs: this.city.balance.army.war.raids.tests[size] })),
      touch,
    };
  }

  /** The chain of command, ordus first, with how many of each echelon's taburs are chosen. */
  private tree(): EchelonRow[] {
    const city = this.city;
    const defs = city.balance.army.units;
    const all = city.army.echelons;
    const rowOf = (e: Echelon): EchelonRow => {
      const under = taburs(city, e.id);
      const kind = echelonKind(city, e.id);
      const children: EchelonRow[] =
        e.level === 'tugay'
          ? under.map((u) => ({
              id: u.id,
              level: 'tabur',
              name: defs[u.kind].name,
              kind: u.kind,
              taburs: 1,
              men: u.men,
              chosen: this.selection.has(u.id) ? 1 : 0,
              state: u.drill !== null ? 'talimde' : u.field !== null ? 'sahada' : 'kışlada',
              children: [],
            }))
          : all
              .filter((c) => c.parent === e.id)
              .sort((p, q) => p.no - q.no)
              .map(rowOf);
      const out = under.filter((u) => u.field !== null).length;
      return {
        id: e.id,
        level: e.level,
        name: echelonName(city, e),
        kind: kind ?? 'karma',
        taburs: under.length,
        men: under.reduce((n, u) => n + u.men, 0),
        chosen: under.filter((u) => this.selection.has(u.id)).length,
        state: out === 0 ? '' : out === under.length ? 'sahada' : `${out} sahada`,
        children,
      };
    };
    return all
      .filter((e) => e.level === 'ordu')
      .sort((p, q) => p.no - q.no)
      .map(rowOf);
  }

  /** The chosen companies that still exist. */
  private chosen(): number[] {
    return this.city.army.units.filter((u) => this.selection.has(u.id)).map((u) => u.id);
  }

  /** Where a company's middle is on the screen, in client pixels, or null off screen. */
  private screenOf(id: number, lift: number): { x: number; y: number } | null {
    const p = this.world.army.anchor(id);
    return p === null ? null : this.screenAt(p.x, p.z, lift);
  }

  /** Where a point `lift` over the ground is on the screen, in client pixels, or null. */
  private screenAt(x: number, z: number, lift: number): { x: number; y: number } | null {
    const rig = this.world.rig;
    this.v.set(x, sampleHeight(this.city.terrain, x, z) + lift, z).project(rig.camera);
    if (Math.abs(this.v.x) > 1.05 || Math.abs(this.v.y) > 1.05) return null;
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: rect.left + ((this.v.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - this.v.y) / 2) * rect.height,
    };
  }
}

const fmt = (n: number): string => Math.round(n).toLocaleString('tr-TR');

/** Roughly how wide a flag is on the screen (px). */
const flagWidth = (p: CompanyPlace): number => (p.level === 'tabur' ? FLAG_W : ECHELON_FLAG_W);

/** Whether flags would overlap too much: more than a few pairs, their boxes grown by `grow`. */
function crowded(places: CompanyPlace[], grow: number): boolean {
  const h = FLAG_H * grow;
  let pairs = 0;
  const allowed = Math.floor(places.length * 0.1);
  for (let i = 0; i < places.length; i++) {
    for (let j = i + 1; j < places.length; j++) {
      const w = ((flagWidth(places[i]) + flagWidth(places[j])) / 2) * grow;
      if (Math.abs(places[i].x - places[j].x) < w && Math.abs(places[i].y - places[j].y) < h) {
        if (++pairs > allowed) return true;
      }
    }
  }
  return false;
}

/** Lifts flags that would cover others, the lower ones staying put, so each can be read. */
function unstack(places: CompanyPlace[]): CompanyPlace[] {
  const done: CompanyPlace[] = [];
  for (const p of [...places].sort((a, b) => b.y - a.y)) {
    for (let tries = 0; tries < 12; tries++) {
      const over = done.find(
        (q) => Math.abs(q.x - p.x) < (flagWidth(p) + flagWidth(q)) / 2 && Math.abs(q.y - p.y) < FLAG_H + 2,
      );
      if (over === undefined) break;
      p.y = over.y - FLAG_H - 3;
    }
    done.push(p);
  }
  return places;
}
