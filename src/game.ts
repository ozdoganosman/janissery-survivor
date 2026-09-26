import * as THREE from 'three';
import type { BuildingKind, TaxRate } from './sim/balance';
import {
  buildBuilding,
  builders,
  demolishBuilding,
  demolishRefund,
  kindName,
  proposeBuilding,
  slots,
  upgradeBuilding,
  type BuildingProposal,
} from './sim/buildings';
import { Sound, type Cue } from './audio/sound';
import { dateOf, DAYS_PER_MONTH, formatDate, type Speed } from './sim/calendar';
import { createCity, type CityState, type Notice } from './sim/city';
import { sellProduct, simulateDays, stepTime, updateStats } from './sim/economy';
import { buildingRoster, inspectTile, priceText, type BuildingSummary } from './sim/inspect';
import { expansionOffer, startExpansion } from './sim/growth';
import { sampleHeight } from './sim/terrain';
import { replaceCity, restoreGame, saveGame, SaveError, type SaveGame } from './sim/save';
import type { PreviewTile } from './render/cursor-view';
import { World } from './render/world';
import { offerFile } from './host';
import { readJson, removeKey, writeJson } from './storage';
import { Hud, type MarkerPlace, type SaveSlot, type SlotLabels, type Tool } from './ui/hud';

type TilePos = { x: number; z: number };

type Drag =
  | { kind: 'pan'; lastX: number; lastY: number; startX: number; startY: number }
  | { kind: 'rotate'; lastX: number };

/** A press that moves less than this (CSS pixels) is a click, not a drag. */
const CLICK_SLOP = 6;

const PREVIEW = { ok: '#a9c76a', costly: '#e6b872', blocked: '#c8312a' } as const;

/** A save as it sits in the browser: the game date it was made on, and the save itself. */
interface StoredSave {
  label: string;
  data: SaveGame;
}

interface Settings {
  sound: boolean;
  music: boolean;
}

const SETTINGS_KEY = 'darulmulk.ayar';

/** Badges float this high over a building's ground, and show only this close in. */
const MARKER_HEIGHT = 2.2;
const MARKER_ZOOM = 42;

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
  /** Months since the calendar began, to notice a month turning. */
  private month = -1;
  /** On a touch screen the first tap shows what would happen; a second tap there does it. */
  private pendingTap: { x: number; z: number; tool: Tool } | null = null;
  private settings: Settings;
  readonly sound: Sound;
  /** The buildings as the list and the badges show them, refreshed a few times a second. */
  private roster: BuildingSummary[] = [];
  private sinceRoster = Infinity;
  private readonly projected = new THREE.Vector3();
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
    const stored = readJson(SETTINGS_KEY) as Partial<Settings> | null;
    this.settings = { sound: stored?.sound ?? true, music: stored?.music ?? true };
    this.sound = new Sound(this.settings.sound, this.settings.music);
    this.hud = new Hud(uiRoot, city, {
      onTool: (t) => this.setTool(t),
      onSpeed: (s) => this.setSpeed(s),
      onBuildKind: (k) => this.setBuildKind(k),
      onTax: (rate) => this.setTax(rate),
      onSell: () => this.sell(),
      onUpgrade: (id) => this.upgrade(id),
      onDemolish: (id) => this.demolish(id),
      onCloseInfo: () => this.select(null),
      onSave: () => this.save('kayit'),
      onLoad: (slot) => this.load(slot),
      onNewGame: () => this.newGame(),
      onExport: () => void this.exportSave(),
      onImport: (file) => void this.importSave(file),
      onSound: (on) => this.setAudio({ ...this.settings, sound: on }),
      onMusic: (on) => this.setAudio({ ...this.settings, music: on }),
      onFocus: (id) => this.focusBuilding(id),
      onExpand: () => this.expand(),
    });
    this.hud.setAudio(this.settings.sound, this.settings.music);
    this.hud.setSlots(this.slotLabels());
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
    const month = Math.floor(this.city.calendar.day / DAYS_PER_MONTH);
    if (month !== this.month) {
      // A month has closed: the treasury rings, and the game keeps its own save.
      if (this.month >= 0) {
        if (this.city.stats.last.income > 0) this.sound.play('coin');
        this.save('oto', true);
      }
      this.month = month;
    }
    const date = dateOf(this.city.calendar);
    const text = `${formatDate(date)} · ${date.season}`;
    if (text !== this.lastDateText) {
      this.lastDateText = text;
      this.hud.setDate(text);
    }
    this.hud.setStats();
    for (const n of this.city.notices.splice(0)) {
      this.hud.notify(n);
      this.sound.play(cueFor(n));
    }
    this.sound.update({
      closeness: this.world.rig.closeness,
      season: date.season,
      paused: this.city.calendar.speed === 0,
      bustle: Math.min(1, this.city.population / 15000),
      works: this.city.stats.works,
    });
    // The open panel follows its building as the work moves on.
    this.sinceInfo += dt;
    if (days > 0 && this.sinceInfo > 0.5) {
      this.sinceInfo = 0;
      this.refreshInfo();
    }
    this.world.frame(dt, this.elapsed);
    this.sinceRoster += dt;
    if (this.sinceRoster > 0.25 || days > 0) {
      this.sinceRoster = 0;
      this.refreshRoster();
    }
    this.placeMarkers();
    this.frames++;
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    this.drag = null;
    this.pendingTap = null;
    this.world.cursor.setPreview([]);
    this.hud.hideTip();
    this.hud.setTool(tool);
    this.world.showSites(tool === 'insa' && this.buildKind === 'ocak');
    this.canvas.style.cursor = tool === 'incele' ? 'grab' : 'crosshair';
  }

  setBuildKind(kind: BuildingKind): void {
    this.buildKind = kind;
    this.pendingTap = null;
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
    this.sound.play('click');
    this.changed();
  }

  sell(): boolean {
    const ok = sellProduct(this.city);
    if (ok) this.sound.play('coin');
    this.changed();
    return ok;
  }

  upgrade(id: number): boolean {
    const ok = upgradeBuilding(this.city, id);
    if (ok) this.sound.play('upgrade');
    this.changed();
    return ok;
  }

  demolish(id: number): boolean {
    const ok = demolishBuilding(this.city, id) >= 0;
    if (ok) {
      this.select(null);
      this.sound.play('demolish');
    }
    this.changed();
    return ok;
  }

  // ---------------------------------------------------------------- saves and settings

  private slotKey(slot: SaveSlot): string {
    return `darulmulk.${this.city.def.id}.${slot}`;
  }

  private stored(slot: SaveSlot): StoredSave | null {
    const s = readJson(this.slotKey(slot)) as StoredSave | null;
    return s !== null && typeof s === 'object' && typeof s.label === 'string' ? s : null;
  }

  private slotLabels(): SlotLabels {
    return { kayit: this.stored('kayit')?.label ?? null, oto: this.stored('oto')?.label ?? null };
  }

  /** Keeps the city in a slot. The monthly save is made quietly. */
  save(slot: SaveSlot, quiet = false): boolean {
    const label = formatDate(dateOf(this.city.calendar));
    const ok = writeJson(this.slotKey(slot), { label, data: saveGame(this.city) } satisfies StoredSave);
    this.hud.setSlots(this.slotLabels());
    if (!quiet) {
      this.say(ok ? `Kaydedildi: ${label}` : 'Kaydedilemedi: tarayıcı kayıt tutmuyor.', ok ? 'good' : 'bad');
      if (ok) this.sound.play('click');
    }
    return ok;
  }

  load(slot: SaveSlot): boolean {
    const s = this.stored(slot);
    if (s === null) return false;
    return this.adopt(s.data, 'Kayıt yüklendi');
  }

  /** Carries on from the monthly save, if the browser has one. */
  resume(): boolean {
    const s = this.stored('oto');
    return s !== null && this.adopt(s.data, 'Kaldığın yerden devam', true);
  }

  newGame(): void {
    removeKey(this.slotKey('oto'));
    this.install(createCity(this.city.def, this.city.balance));
    this.hud.setSlots(this.slotLabels());
    this.say(`${this.city.def.name} yeniden emrinde.`, 'good');
  }

  /** Offers the save as a file to keep. */
  async exportSave(): Promise<void> {
    const date = dateOf(this.city.calendar);
    const name = `darulmulk-${this.city.def.id}-${date.year}-${date.month + 1}-${date.day}.json`;
    const result = await offerFile(name, JSON.stringify(saveGame(this.city)));
    if (result === 'failed') this.say('Dosya kaydedilemedi.', 'bad');
  }

  async importSave(file: File): Promise<boolean> {
    let data: unknown;
    try {
      data = JSON.parse(await file.text()) as unknown;
    } catch {
      this.say('Dosya okunamadı.', 'bad');
      return false;
    }
    return this.adopt(data, 'Dosyadan yüklendi');
  }

  /** Loads a save into the running game and says so with its date, or says why it cannot. */
  private adopt(data: unknown, message: string, quiet = false): boolean {
    let next: CityState;
    try {
      next = restoreGame(this.city.def, this.city.balance, data);
    } catch (err) {
      if (!quiet) this.say(err instanceof SaveError ? err.message : 'Kayıt yüklenemedi.', 'bad');
      return false;
    }
    this.install(next);
    this.say(`${message}: ${formatDate(dateOf(this.city.calendar))}`, 'good');
    return true;
  }

  /** Puts another city in the running game's place. */
  private install(next: CityState): void {
    replaceCity(this.city, next);
    this.month = Math.floor(this.city.calendar.day / DAYS_PER_MONTH);
    this.selected = null;
    this.hoverTile = null;
    this.lastDateText = '';
    this.setTool('incele');
    this.hud.closeMenu();
    this.hud.refresh();
    this.hud.setSpeed(this.city.calendar.speed);
    this.hud.showInfo(null);
    this.world.cursor.setHover(null);
    this.refreshRoster();
  }

  private setAudio(settings: Settings): void {
    this.settings = settings;
    writeJson(SETTINGS_KEY, settings);
    this.sound.unlock();
    this.sound.setSound(settings.sound);
    this.sound.setMusic(settings.music);
    this.hud.setAudio(settings.sound, settings.music);
  }

  private say(text: string, kind: Notice['kind']): void {
    this.hud.notify({ text, kind, day: this.city.calendar.day });
  }

  /** Recomputes the month's figures after an order, so the ledger answers at once. */
  private changed(): void {
    updateStats(this.city);
    this.hud.setStats();
    this.refreshInfo();
    this.refreshRoster();
  }

  private refreshRoster(): void {
    this.roster = buildingRoster(this.city);
    const offer = expansionOffer(this.city);
    const w = this.city.expansion.work;
    this.hud.setRoster(
      this.roster,
      builders(this.city),
      slots(this.city),
      offer === null
        ? null
        : {
            offer,
            progress: w === null ? null : 1 - w.daysLeft / w.days,
            monthsLeft: w === null ? 0 : Math.ceil(w.daysLeft / DAYS_PER_MONTH),
          },
    );
  }

  /** Runs whole days without drawing them: for tests, and for trying out a long game. */
  fastForward(days: number): void {
    simulateDays(this.city, days);
    for (const n of this.city.notices.splice(0)) this.hud.notify(n);
    this.changed();
  }

  /** Begins the next ring of walls, if the city can. */
  expand(): boolean {
    const ok = startExpansion(this.city);
    if (ok) this.sound.play('build');
    this.changed();
    return ok;
  }

  /** Each building's badge, over its roof wherever the camera has it this frame. */
  private placeMarkers(): void {
    const rig = this.world.rig;
    const show = rig.zoom < MARKER_ZOOM && this.roster.length > 0;
    const places: MarkerPlace[] = [];
    if (show) {
      const rect = this.canvas.getBoundingClientRect();
      const { grid, terrain } = this.city;
      for (const s of this.roster) {
        const x = grid.centre(s.tile.x);
        const z = grid.centre(s.tile.z);
        this.projected.set(x, sampleHeight(terrain, x, z) + MARKER_HEIGHT, z).project(rig.camera);
        if (Math.abs(this.projected.x) > 1.05 || Math.abs(this.projected.y) > 1.05) continue;
        places.push({
          summary: s,
          x: ((this.projected.x + 1) / 2) * rect.width,
          y: ((1 - this.projected.y) / 2) * rect.height,
        });
      }
    }
    this.hud.placeMarkers(places, show);
  }

  /** Turns the view to a building and pins its panel. */
  focusBuilding(id: number): void {
    const s = this.roster.find((b) => b.id === id);
    if (s === undefined) return;
    const { grid } = this.city;
    const rig = this.world.rig;
    rig.setView(grid.centre(s.tile.x), grid.centre(s.tile.z), Math.min(rig.zoom, 14));
    this.setTool('incele');
    this.select(s.tile);
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
    this.sound.play('build');
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
    c.addEventListener('pointerleave', (e) => {
      // A finger leaves the screen after every tap; only a mouse leaving means "away".
      if (this.drag !== null || e.pointerType !== 'mouse') return;
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
    // Sound may only start from something the player did.
    window.addEventListener('pointerdown', () => this.sound.unlock());
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
    // A tap on a touch screen first shows the footprint and the price; a second tap on the
    // same tile builds or pulls down.
    if (e.pointerType !== 'mouse' && this.tool !== 'incele') {
      const p = this.pendingTap;
      if (p === null || p.x !== tile.x || p.z !== tile.z || p.tool !== this.tool) {
        this.pendingTap = { ...tile, tool: this.tool };
        if (this.tool === 'insa') this.previewPlacement(tile, e.clientX, e.clientY);
        else this.previewDemolish(tile, e.clientX, e.clientY);
        return;
      }
      this.pendingTap = null;
    }
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
    if (down) this.sound.unlock();
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
      case 'l':
        this.hud.toggleRoster();
        this.refreshRoster();
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

/** The sound a notice makes. */
function cueFor(n: Notice): Cue {
  if (n.topic === 'rank') return n.kind === 'good' ? 'rank' : 'bad';
  if (n.topic === 'works') return 'complete';
  return n.kind === 'bad' ? 'bad' : 'complete';
}
