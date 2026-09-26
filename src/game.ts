import * as THREE from 'three';
import type { BuildingKind, TaxRate } from './sim/balance';
import {
  buildBuilding,
  demolishBuilding,
  demolishRefund,
  kindName,
  proposeBuilding,
  upgradeBuilding,
  type BuildingProposal,
} from './sim/buildings';
import { dateOf, formatDate, type Speed } from './sim/calendar';
import type { CityState } from './sim/city';
import { sellProduct, stepTime, updateStats } from './sim/economy';
import { inspectTile, priceText } from './sim/inspect';
import type { PreviewTile } from './render/cursor-view';
import { World } from './render/world';
import { Hud, type Tool } from './ui/hud';

type TilePos = { x: number; z: number };

type Drag =
  | { kind: 'pan'; lastX: number; lastY: number; startX: number; startY: number }
  | { kind: 'rotate'; lastX: number };

/** A press that moves less than this (CSS pixels) is a click, not a drag. */
const CLICK_SLOP = 6;

const PREVIEW = { ok: '#a9c76a', costly: '#e6b872', blocked: '#c8312a' } as const;

/**
 * Wires the city, the world view and the HUD together and turns input into actions.
 * This is the only place that knows about all three.
 *
 * Every tool pans on a drag; a click inspects, places the chosen building, or pulls one
 * down, depending on the tool in hand.
 */
export class Game {
  readonly world: World;
  private readonly hud: Hud;
  private tool: Tool = 'incele';
  private drag: Drag | null = null;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; angle: number; midX: number; midY: number } | null = null;
  private readonly keys = new Set<string>();
  private hoverTile: TilePos | null = null;
  /** Tile whose panel is pinned open by a click, if any. */
  private selected: TilePos | null = null;
  private buildKind: BuildingKind = 'carsi';
  private lastDateText = '';
  private sinceInfo = 0;
  private elapsed = 0;
  private last = performance.now();
  frames = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    uiRoot: HTMLElement,
    readonly city: CityState,
  ) {
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.world = new World(renderer, city);
    this.hud = new Hud(uiRoot, city, {
      onTool: (t) => this.setTool(t),
      onSpeed: (s) => this.setSpeed(s),
      onBuildKind: (k) => this.setBuildKind(k),
      onTax: (rate) => this.setTax(rate),
      onSell: () => this.sell(),
      onUpgrade: (id) => this.upgrade(id),
      onDemolish: (id) => this.demolish(id),
      onCloseInfo: () => this.select(null),
    });
    this.hud.setTool(this.tool);
    this.hud.setBuildKind(this.buildKind);
    this.hud.setSpeed(city.calendar.speed);
    this.world.rig.setView(4, 6, 30);
    this.world.rig.snap();
    this.resize();
    this.bindInput();
  }

  start(): void {
    const loop = (now: number): void => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      this.step(dt);
    };
    requestAnimationFrame(loop);
  }

  /** One frame: input, time, drawing. */
  step(dt: number): void {
    this.elapsed += dt;
    this.applyKeys(dt);
    const days = stepTime(this.city, dt);
    const date = dateOf(this.city.calendar);
    const text = `${formatDate(date)} · ${date.season}`;
    if (text !== this.lastDateText) {
      this.lastDateText = text;
      this.hud.setDate(text);
    }
    this.hud.setStats();
    for (const n of this.city.notices.splice(0)) this.hud.notify(n);
    // The open panel follows its building as the work moves on.
    this.sinceInfo += dt;
    if (days > 0 && this.sinceInfo > 0.5) {
      this.sinceInfo = 0;
      this.refreshInfo();
    }
    this.world.frame(dt, this.elapsed);
    this.frames++;
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    this.drag = null;
    this.world.cursor.setPreview([]);
    this.hud.hideTip();
    this.hud.setTool(tool);
    this.world.showSites(tool === 'insa' && this.buildKind === 'ocak');
    this.canvas.style.cursor = tool === 'incele' ? 'grab' : 'crosshair';
  }

  setBuildKind(kind: BuildingKind): void {
    this.buildKind = kind;
    this.hud.setBuildKind(kind);
    this.world.cursor.setPreview([]);
    this.world.showSites(this.tool === 'insa' && kind === 'ocak');
  }

  setSpeed(speed: Speed): void {
    this.city.calendar.speed = speed;
    this.hud.setSpeed(speed);
  }

  setTax(rate: TaxRate): void {
    this.city.policy.tax = rate;
    this.changed();
  }

  sell(): boolean {
    const ok = sellProduct(this.city);
    this.changed();
    return ok;
  }

  upgrade(id: number): boolean {
    const ok = upgradeBuilding(this.city, id);
    this.changed();
    return ok;
  }

  demolish(id: number): boolean {
    const ok = demolishBuilding(this.city, id) >= 0;
    if (ok) this.select(null);
    this.changed();
    return ok;
  }

  /** Recomputes the month's figures after an order, so the ledger answers at once. */
  private changed(): void {
    updateStats(this.city);
    this.hud.setStats();
    this.refreshInfo();
  }

  /** Pins the info panel to a tile, or unpins it. */
  select(tile: TilePos | null): void {
    this.selected = tile;
    this.world.cursor.setHover(tile ?? this.hoverTile);
    this.refreshInfo();
  }

  private refreshInfo(): void {
    if (this.selected !== null) {
      this.hud.showInfo(inspectTile(this.city, this.selected.x, this.selected.z), true);
    } else if (this.hoverTile !== null && this.tool === 'incele') {
      this.hud.showInfo(inspectTile(this.city, this.hoverTile.x, this.hoverTile.z));
    } else {
      this.hud.showInfo(null);
    }
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.world.resize(w, h, Math.min(window.devicePixelRatio || 1, 2));
  }

  /** The tile under a point on the canvas, in CSS pixels. */
  tileAt(clientX: number, clientY: number): TilePos | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
    const hit = this.world.rig.pickGround(ndcX, ndcY);
    if (hit === null) return null;
    const { grid } = this.city;
    const x = grid.tileOf(hit.x);
    const z = grid.tileOf(hit.z);
    return grid.inBounds(x, z) ? { x, z } : null;
  }

  /** Shows where the chosen building would stand and what it would cost; returns the plan. */
  previewPlacement(tile: TilePos, cx: number, cy: number): BuildingProposal {
    const { city } = this;
    const plan = proposeBuilding(city, this.buildKind, tile.x, tile.z);
    const blocked = plan.tiles.some((t) => !t.ok);
    const color = plan.problem === undefined ? PREVIEW.ok : blocked ? PREVIEW.blocked : PREVIEW.costly;
    const preview: PreviewTile[] = plan.tiles.map((t) => ({
      x: t.x,
      z: t.z,
      color: t.ok ? color : PREVIEW.blocked,
    }));
    this.world.cursor.setPreview(preview);
    const name = kindName(city, this.buildKind);
    const moving = plan.clears > 0 ? ` · ${plan.clears} hane taşınır` : '';
    this.hud.showTip(
      plan.problem !== undefined
        ? `${name} · ${plan.problem}`
        : `${name} · ${priceText(city, plan.cost, plan.material)} · ${plan.months} ay${moving}`,
      cx,
      cy,
      plan.problem !== undefined,
    );
    return plan;
  }

  /** Places the chosen building at a tile, if it may go there. */
  place(tile: TilePos): boolean {
    const plan = proposeBuilding(this.city, this.buildKind, tile.x, tile.z);
    const b = buildBuilding(this.city, plan);
    if (b === null) return false;
    this.world.cursor.setPreview([]);
    this.hud.hideTip();
    this.setTool('incele');
    this.select({ x: b.x0 + Math.floor(b.w / 2), z: b.z0 + Math.floor(b.d / 2) });
    this.changed();
    return true;
  }

  // ---------------------------------------------------------------- input

  private bindInput(): void {
    const c = this.canvas;
    window.addEventListener('resize', () => this.resize());
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    c.addEventListener('pointermove', (e) => this.onPointerMove(e));
    c.addEventListener('pointerup', (e) => this.onPointerUp(e));
    c.addEventListener('pointercancel', (e) => this.onPointerUp(e, true));
    c.addEventListener('pointerleave', () => {
      if (this.drag !== null) return;
      this.setHover(null);
      this.world.cursor.setPreview([]);
      this.hud.hideTip();
    });
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const anchor = this.groundAt(e.clientX, e.clientY);
        this.world.rig.zoomBy(Math.exp(e.deltaY * 0.0015), anchor ?? undefined);
      },
      { passive: false },
    );
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private groundAt(clientX: number, clientY: number): { x: number; z: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    return this.world.rig.pickGround(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  private onPointerDown(e: PointerEvent): void {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      // A second finger turns whatever the first was doing into a pinch.
      this.drag = null;
      this.pinch = this.pinchState();
      return;
    }
    if (this.pointers.size > 2) return;
    if (e.button === 2) {
      this.drag = { kind: 'rotate', lastX: e.clientX };
      return;
    }
    this.drag = { kind: 'pan', lastX: e.clientX, lastY: e.clientY, startX: e.clientX, startY: e.clientY };
    if (this.tool === 'incele') this.canvas.style.cursor = 'grabbing';
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch !== null && this.pointers.size >= 2) {
      const now = this.pinchState();
      const rig = this.world.rig;
      rig.zoomBy(this.pinch.dist / Math.max(1, now.dist));
      rig.rotate(now.angle - this.pinch.angle);
      rig.panPixels(now.midX - this.pinch.midX, now.midY - this.pinch.midY, this.canvas.clientHeight);
      this.pinch = now;
      return;
    }
    const drag = this.drag;
    if (drag?.kind === 'pan') {
      this.world.rig.panPixels(e.clientX - drag.lastX, e.clientY - drag.lastY, this.canvas.clientHeight);
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      return;
    }
    if (drag?.kind === 'rotate') {
      this.world.rig.rotate(-(e.clientX - drag.lastX) * 0.008);
      drag.lastX = e.clientX;
      return;
    }
    const tile = this.tileAt(e.clientX, e.clientY);
    if (e.pointerType === 'mouse') this.setHover(tile);
    if (tile === null || e.pointerType !== 'mouse') return;
    if (this.tool === 'insa') this.previewPlacement(tile, e.clientX, e.clientY);
    else if (this.tool === 'yik') this.previewDemolish(tile, e.clientX, e.clientY);
  }

  private onPointerUp(e: PointerEvent, cancelled = false): void {
    this.pointers.delete(e.pointerId);
    if (this.pinch !== null) {
      if (this.pointers.size < 2) this.pinch = null;
      return;
    }
    const drag = this.drag;
    this.drag = null;
    if (this.tool === 'incele') this.canvas.style.cursor = 'grab';
    if (drag?.kind !== 'pan' || cancelled) return;
    // A press that barely moved is a click.
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) >= CLICK_SLOP) return;
    const tile = this.tileAt(e.clientX, e.clientY);
    if (tile === null) return;
    if (this.tool === 'insa') {
      if (!this.place(tile)) this.previewPlacement(tile, e.clientX, e.clientY);
    } else if (this.tool === 'yik') {
      const id = this.city.building[this.city.grid.index(tile.x, tile.z)];
      if (id >= 0) this.demolish(id);
      this.previewDemolish(tile, e.clientX, e.clientY);
    } else {
      const same = this.selected?.x === tile.x && this.selected.z === tile.z;
      this.select(same ? null : tile);
    }
  }

  /** Marks the building under the pointer and what pulling it down would give back. */
  private previewDemolish(tile: TilePos, cx: number, cy: number): void {
    const { city } = this;
    const b = city.buildings.get(city.building[city.grid.index(tile.x, tile.z)]);
    if (b === undefined) {
      this.world.cursor.setPreview([]);
      this.hud.showTip('Yıkılacak yapı yok', cx, cy, true);
      return;
    }
    const preview: PreviewTile[] = b.tiles.map((i) => ({
      x: i % city.grid.size,
      z: Math.floor(i / city.grid.size),
      color: PREVIEW.blocked,
    }));
    this.world.cursor.setPreview(preview);
    this.hud.showTip(
      `${b.name} yıkılsın · +${demolishRefund(city, b).toLocaleString('tr-TR')} akçe`,
      cx,
      cy,
      false,
    );
  }

  private pinchState(): { dist: number; angle: number; midX: number; midY: number } {
    const [a, b] = [...this.pointers.values()];
    return {
      dist: Math.hypot(b.x - a.x, b.y - a.y),
      angle: Math.atan2(b.y - a.y, b.x - a.x),
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
    };
  }

  private setHover(tile: TilePos | null): void {
    const same =
      tile !== null && this.hoverTile !== null && tile.x === this.hoverTile.x && tile.z === this.hoverTile.z;
    if (same) return;
    this.hoverTile = tile;
    // While a panel is pinned, hovering does not replace it.
    if (this.selected !== null) return;
    this.world.cursor.setHover(tile);
    this.refreshInfo();
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (e.target instanceof HTMLInputElement) return;
    const k = e.key.toLowerCase();
    if (down) this.keys.add(k);
    else this.keys.delete(k);
    if (!down) return;
    switch (k) {
      case ' ':
        e.preventDefault();
        this.setSpeed(this.city.calendar.speed === 0 ? 1 : 0);
        break;
      case '1':
      case '2':
      case '3':
        this.setSpeed(Number(k) as Speed);
        break;
      case 'escape':
        if (this.selected !== null) this.select(null);
        else this.setTool('incele');
        break;
      case 'y':
        this.setTool('insa');
        break;
      case 'b':
        this.setTool('yik');
        break;
    }
  }

  private applyKeys(dt: number): void {
    const rig = this.world.rig;
    const speed = rig.zoom * 1.4 * dt;
    let right = 0;
    let forward = 0;
    if (this.keys.has('a') || this.keys.has('arrowleft')) right -= speed;
    if (this.keys.has('d') || this.keys.has('arrowright')) right += speed;
    if (this.keys.has('w') || this.keys.has('arrowup')) forward += speed;
    if (this.keys.has('s') || this.keys.has('arrowdown')) forward -= speed;
    if (right !== 0 || forward !== 0) rig.panWorld(right, forward);
    if (this.keys.has('q')) rig.rotate(1.6 * dt);
    if (this.keys.has('e')) rig.rotate(-1.6 * dt);
    if (this.keys.has('z') || this.keys.has('+') || this.keys.has('=')) rig.zoomBy(Math.exp(-1.8 * dt));
    if (this.keys.has('x') || this.keys.has('-')) rig.zoomBy(Math.exp(1.8 * dt));
  }
}
