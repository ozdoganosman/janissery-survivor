import * as THREE from 'three';
import type { Crop, FieldPlan } from './sim/balance';
import { dateOf, formatDate, type Speed } from './sim/calendar';
import type { CityState } from './sim/city';
import { stepTime } from './sim/economy';
import { buildField, proposeField, setFieldPlan, type FieldProposal } from './sim/fields';
import { inspectTile } from './sim/inspect';
import { buildRoad, planRoad, type RoadPlan } from './sim/roads';
import { applyZone, clearArea, proposeZone, surveyClear, type ZoneProposal } from './sim/zoning';
import type { PreviewTile } from './render/cursor-view';
import { World } from './render/world';
import { Hud, type Tool } from './ui/hud';

const PREVIEW_COLORS = {
  new: '#e2b84a',
  bridge: '#5f97c6',
  existing: '#f4e8c8',
  blocked: '#c8312a',
} as const;

type TilePos = { x: number; z: number };

type Drag =
  | { kind: 'pan'; lastX: number; lastY: number; startX: number; startY: number }
  | { kind: 'rotate'; lastX: number }
  | { kind: 'road'; from: TilePos; plan: RoadPlan | null }
  | { kind: 'zone'; from: TilePos; plan: ZoneProposal | null }
  | { kind: 'field'; from: TilePos; plan: FieldProposal | null }
  | { kind: 'clear'; from: TilePos; to: TilePos };

/** A press that moves less than this (CSS pixels) is a click, not a drag. */
const CLICK_SLOP = 6;

/**
 * Wires the city, the world view and the HUD together and turns input into actions.
 * This is the only place that knows about all three.
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
  private crop: Crop = 'bugday';
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
    this.hud = new Hud(uiRoot, city.def.title, {
      onTool: (t) => this.setTool(t),
      onSpeed: (s) => this.setSpeed(s),
      onFertility: (on) => this.setFertility(on),
      onCrop: (c) => this.setCrop(c),
      onFieldPlan: (id, plan) => this.setFieldPlan(id, plan),
      onCloseInfo: () => this.select(null),
    });
    this.hud.setTool(this.tool);
    this.hud.setCrop(this.crop);
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
    this.hud.setStats(this.city.treasury, this.city.granary, this.city.stats);
    for (const n of this.city.notices.splice(0)) this.hud.notify(n);
    // The open panel follows its tile as the season moves on.
    this.sinceInfo += dt;
    if (days > 0 && this.sinceInfo > 0.5) {
      this.sinceInfo = 0;
      if (this.selected !== null) this.refreshSelection();
      else if (this.hoverTile !== null && this.drag === null)
        this.hud.showInfo(inspectTile(this.city, this.hoverTile.x, this.hoverTile.z));
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
    this.canvas.style.cursor = tool === 'incele' ? 'grab' : 'crosshair';
  }

  setCrop(crop: Crop): void {
    this.crop = crop;
    this.hud.setCrop(crop);
  }

  setFieldPlan(id: number, plan: FieldPlan): void {
    setFieldPlan(this.city, id, plan);
    this.refreshSelection();
  }

  /** Pins the info panel to a tile, or unpins it. */
  select(tile: TilePos | null): void {
    this.selected = tile;
    this.world.cursor.setHover(tile ?? this.hoverTile);
    if (tile === null) {
      this.hud.showInfo(
        this.hoverTile === null ? null : inspectTile(this.city, this.hoverTile.x, this.hoverTile.z),
      );
    } else {
      this.refreshSelection();
    }
  }

  private refreshSelection(): void {
    if (this.selected === null) return;
    this.hud.showInfo(inspectTile(this.city, this.selected.x, this.selected.z), true);
  }

  setSpeed(speed: Speed): void {
    this.city.calendar.speed = speed;
    this.hud.setSpeed(speed);
  }

  setFertility(on: boolean): void {
    this.world.terrain.setFertilityVisible(on);
    this.hud.setFertility(on);
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
      if (this.drag === null) this.setHover(null);
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
      this.cancelDrag();
      this.pinch = this.pinchState();
      return;
    }
    if (this.pointers.size > 2) return;
    if (e.button === 2) {
      this.drag = { kind: 'rotate', lastX: e.clientX };
      return;
    }
    if (e.button === 1 || this.tool === 'incele') {
      this.drag = { kind: 'pan', lastX: e.clientX, lastY: e.clientY, startX: e.clientX, startY: e.clientY };
      if (this.tool === 'incele') this.canvas.style.cursor = 'grabbing';
      return;
    }
    const tile = this.tileAt(e.clientX, e.clientY);
    if (tile === null) return;
    switch (this.tool) {
      case 'yol':
        this.drag = { kind: 'road', from: tile, plan: null };
        break;
      case 'konut':
        this.drag = { kind: 'zone', from: tile, plan: null };
        break;
      case 'tarla':
        this.drag = { kind: 'field', from: tile, plan: null };
        break;
      default:
        this.drag = { kind: 'clear', from: tile, to: tile };
    }
    this.updateDrag(tile, e.clientX, e.clientY);
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
    if (tile === null || drag === null) return;
    this.updateDrag(tile, e.clientX, e.clientY);
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
    if (drag === null || cancelled) {
      this.world.cursor.setPreview([]);
      this.hud.hideTip();
      return;
    }
    if (drag.kind === 'pan') {
      // A press that barely moved is a click: pin the panel to that tile, or unpin it.
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < CLICK_SLOP) {
        const tile = this.tileAt(e.clientX, e.clientY);
        const same = tile !== null && this.selected?.x === tile.x && this.selected.z === tile.z;
        this.select(same ? null : tile);
      }
    } else if (drag.kind === 'road' && drag.plan !== null) {
      buildRoad(this.city, drag.plan);
    } else if (drag.kind === 'zone' && drag.plan !== null) {
      applyZone(this.city, drag.plan);
    } else if (drag.kind === 'field' && drag.plan !== null && drag.plan.problem === undefined) {
      const field = buildField(this.city, drag.plan, this.crop);
      if (field !== null) {
        const p = drag.plan;
        this.select({ x: p.x0 + Math.floor(p.w / 2), z: p.z0 + Math.floor(p.d / 2) });
      }
    } else if (drag.kind === 'clear') {
      clearArea(this.city, drag.from.x, drag.from.z, drag.to.x, drag.to.z);
    }
    this.world.cursor.setPreview([]);
    this.hud.hideTip();
    if (e.pointerType === 'mouse') this.setHover(this.tileAt(e.clientX, e.clientY));
  }

  private cancelDrag(): void {
    this.drag = null;
    this.world.cursor.setPreview([]);
    this.hud.hideTip();
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

  private updateDrag(tile: TilePos, cx: number, cy: number): void {
    const drag = this.drag;
    if (drag === null) return;
    const { city } = this;
    let preview: PreviewTile[] = [];
    let text: string;
    let bad: boolean;
    switch (drag.kind) {
      case 'road': {
        const plan = planRoad(city, drag.from.x, drag.from.z, tile.x, tile.z);
        drag.plan = plan;
        preview = plan.tiles.map((t) => ({ x: t.x, z: t.z, color: PREVIEW_COLORS[t.status] }));
        const count = plan.tiles.filter((t) => t.status === 'new' || t.status === 'bridge').length;
        bad = plan.problem !== undefined;
        text = plan.problem ?? `${count} karo · ${plan.cost.toLocaleString('tr-TR')} dirhem`;
        break;
      }
      case 'zone': {
        const plan = proposeZone(city, drag.from.x, drag.from.z, tile.x, tile.z);
        drag.plan = plan;
        preview = plan.tiles.map((t) => ({
          x: t.x,
          z: t.z,
          color:
            t.status === 'blocked'
              ? '#8a6a58'
              : t.status === 'existing'
                ? '#f3d7c6'
                : t.far
                  ? '#d8b4a4'
                  : '#e39a86',
        }));
        bad = plan.added === 0;
        text = plan.added > 0 ? `${plan.added} konut arsası` : 'Arsa ayrılamaz';
        if (plan.far > 0) text += ` · ${plan.far} tanesi yola uzak, yol gelene dek boş kalır`;
        break;
      }
      case 'field': {
        const plan = proposeField(city, drag.from.x, drag.from.z, tile.x, tile.z);
        drag.plan = plan;
        preview = plan.tiles.map((t) => ({
          x: t.x,
          z: t.z,
          color: t.status === 'ok' ? '#a9c76a' : '#c8312a',
        }));
        bad = plan.problem !== undefined;
        const crop = city.balance.fields.crops[this.crop].name;
        text =
          plan.problem ??
          `${crop} · ${plan.w}×${plan.d} karo · ${plan.cost.toLocaleString('tr-TR')} dirhem · verim %${Math.round(plan.fertility * 100)}`;
        if (plan.problem === undefined && !plan.roadAccess) text += ' · yola bağlı değil, işlenemez';
        break;
      }
      case 'clear': {
        drag.to = tile;
        const found = surveyClear(city, drag.from.x, drag.from.z, tile.x, tile.z);
        for (let z = Math.min(drag.from.z, tile.z); z <= Math.max(drag.from.z, tile.z); z++) {
          for (let x = Math.min(drag.from.x, tile.x); x <= Math.max(drag.from.x, tile.x); x++) {
            const i = city.grid.index(x, z);
            const hit =
              (city.road[i] === 1 && city.roadLocked[i] === 0) ||
              city.house[i] > 0 ||
              city.zone[i] === 1 ||
              city.field[i] >= 0;
            preview.push({ x, z, color: hit ? '#c8312a' : '#e6b872' });
          }
        }
        const parts = [
          found.roads > 0 ? `${found.roads} yol` : '',
          found.houses > 0 ? `${found.houses} ev` : '',
          found.zones > 0 ? `${found.zones} arsa` : '',
          found.fields > 0 ? `${found.fields} tarla` : '',
        ].filter((p) => p !== '');
        bad = parts.length === 0;
        text = bad ? 'Yıkılacak bir şey yok' : `Yıkılacak: ${parts.join(' · ')}`;
        break;
      }
      default:
        return;
    }
    this.world.cursor.setPreview(preview);
    this.hud.showTip(text, cx, cy, bad);
  }

  private setHover(tile: TilePos | null): void {
    const same =
      tile !== null && this.hoverTile !== null && tile.x === this.hoverTile.x && tile.z === this.hoverTile.z;
    if (same) return;
    this.hoverTile = tile;
    // While a panel is pinned, hovering does not replace it.
    if (this.selected !== null) return;
    this.world.cursor.setHover(tile);
    this.hud.showInfo(tile === null ? null : inspectTile(this.city, tile.x, tile.z));
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
      case 'r':
        this.setTool('yol');
        break;
      case 'k':
        this.setTool('konut');
        break;
      case 't':
        this.setTool('tarla');
        break;
      case 'b':
        this.setTool('yik');
        break;
      case 'f':
        this.setFertility(!this.world.terrain.fertilityVisible);
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
