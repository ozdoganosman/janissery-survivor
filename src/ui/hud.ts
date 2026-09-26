import type { Balance, BuildingKind, TaxRate } from '../sim/balance';
import { BUILDING_KINDS, TAX_RATES } from '../sim/balance';
import { kindName, slots } from '../sim/buildings';
import type { ExpansionOffer } from '../sim/growth';
import type { Speed } from '../sim/calendar';
import type { CityState, Notice } from '../sim/city';
import { ORDER_NAMES, orderState } from '../sim/economy';
import { effectText, priceText, type BuildingSummary, type Readiness, type TileInfo } from '../sim/inspect';

export type Tool = 'incele' | 'insa' | 'yik';

export interface HudCallbacks {
  onTool(tool: Tool): void;
  onSpeed(speed: Speed): void;
  onBuildKind(kind: BuildingKind): void;
  onTax(rate: TaxRate): void;
  onSell(): void;
  onUpgrade(buildingId: number): void;
  onDemolish(buildingId: number): void;
  onCloseInfo(): void;
  onSave(): void;
  onLoad(slot: SaveSlot): void;
  onNewGame(): void;
  onExport(): void;
  onImport(file: File): void;
  onSound(on: boolean): void;
  onMusic(on: boolean): void;
  /** Points the view at a building and opens its panel. */
  onFocus(buildingId: number): void;
  /** Begins the next ring of walls. */
  onExpand(): void;
}

/** The next ring of walls as the roster shows it. */
export interface ExpansionView {
  offer: ExpansionOffer;
  /** Share of the work done, while the walls are going up. */
  progress: number | null;
  monthsLeft: number;
}

/** A building's badge on the map, where the camera sees it this frame. */
export interface MarkerPlace {
  summary: BuildingSummary;
  x: number;
  y: number;
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

/** What each state of a building says in the list. */
const READINESS_NAMES: Record<Readiness, string> = {
  ready: 'Yükseltilebilir',
  waiting: 'Bekliyor',
  locked: 'Kilitli',
  building: 'İnşaatta',
  top: 'En yüksek seviye',
};

/** The player's own save, and the one the game keeps each month. */
export type SaveSlot = 'kayit' | 'oto';

/** What the menu says about each save slot: the game date it holds, or nothing. */
export type SlotLabels = Record<SaveSlot, string | null>;

const ICONS = {
  incele: '<circle cx="10" cy="10" r="6"/><path d="M14.5 14.5 20 20"/>',
  insa: '<path d="M3 20h18M5 20v-8h14v8M9 20v-4h6v4"/><path d="M7 12a5 5 0 0 1 10 0"/><path d="M12 7V4"/>',
  yik: '<path d="M4 20 14 10M9 5c3-2 7-2 10 1-3-1-5 0-7 2M14 10l-2-2"/>',
  pause: '<rect x="3" y="2" width="4" height="12"/><rect x="9" y="2" width="4" height="12"/>',
  play1: '<path d="M4 2l9 6-9 6z"/>',
  play2: '<path d="M1 2l7 6-7 6zM8 2l7 6-7 6z"/>',
  play3: '<path d="M0 2l5.5 6L0 14zM5 2l5.5 6L5 14zM10 2l5.5 6L10 14z"/>',
  sound:
    '<path d="M2 6h3l4-3v10l-4-3H2z"/><path class="s" d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.5a6 6 0 0 1 0 9"/>',
  muted: '<path d="M2 6h3l4-3v10l-4-3H2z"/><path class="s" d="m11 6 4 4M15 6l-4 4"/>',
  menu: '<path class="s" d="M2 4h12M2 8h12M2 12h12"/>',
  yapilar: '<path d="M4 20V9l4-3 4 3v11M12 20v-7l4-3 4 3v7M3 20h18"/><path d="M8 3v3M16 7v3"/>',
} as const;

const svg = (body: string, viewBox = '0 0 24 24'): string =>
  `<svg viewBox="${viewBox}" aria-hidden="true">${body}</svg>`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  e.innerHTML = html;
  return e;
}

const fmt = (n: number): string => Math.round(n).toLocaleString('tr-TR');
const signed = (n: number): string => (Math.round(n) > 0 ? `+${fmt(n)}` : fmt(n));

/** How long a notice stays on screen, in milliseconds. */
const NOTICE_MS = 7000;

/** The manuscript-style frame and every on-screen control. Plain DOM over the canvas. */
export class Hud {
  private readonly date: HTMLElement;
  private readonly amount: HTMLElement;
  private readonly income: HTMLElement;
  private readonly product: HTMLElement;
  private readonly productRate: HTMLElement;
  private readonly sellButton: HTMLButtonElement;
  private readonly population: HTMLElement;
  private readonly growth: HTMLElement;
  private readonly orderBar: HTMLElement;
  private readonly orderName: HTMLElement;
  private readonly rank: HTMLElement;
  private readonly works: HTMLElement;
  private readonly food: HTMLElement;
  private readonly foodShare: HTMLElement;
  private readonly accounts: HTMLElement;
  private readonly accountsToggle: HTMLButtonElement;
  private readonly taxButtons = new Map<TaxRate, HTMLButtonElement>();
  private readonly buildBar: HTMLElement;
  private readonly buildButtons = new Map<BuildingKind, HTMLButtonElement>();
  private readonly info: HTMLElement;
  private readonly tip: HTMLElement;
  private readonly notices: HTMLElement;
  private readonly toolButtons = new Map<Tool, HTMLButtonElement>();
  private readonly speedButtons: HTMLButtonElement[] = [];
  private readonly soundButton: HTMLButtonElement;
  private readonly menu: HTMLElement;
  private readonly menuButton: HTMLButtonElement;
  private readonly slotButtons = new Map<SaveSlot, HTMLButtonElement>();
  private readonly musicButton: HTMLButtonElement;
  private newGameArmed = false;
  private readonly roster: HTMLElement;
  private readonly rosterList: HTMLElement;
  private readonly rosterSummary: HTMLElement;
  private readonly rosterButton: HTMLButtonElement;
  private readonly rosterCount: HTMLElement;
  private rosterKey = '';
  private readonly markerLayer: HTMLElement;
  private readonly markers = new Map<number, HTMLButtonElement>();
  private statsKey = '';
  private affordKey = '';

  constructor(
    root: HTMLElement,
    private readonly city: CityState,
    private readonly cb: HudCallbacks,
  ) {
    const balance: Balance = city.balance;
    root.appendChild(el('div', 'frame'));
    const ui = el('div', 'ui');
    root.appendChild(ui);
    // Building badges ride on the map, under every panel.
    this.markerLayer = el('div', 'markers');
    ui.appendChild(this.markerLayer);

    const cartouche = el('div', 'cartouche panel');
    cartouche.appendChild(el('div', 'title', city.def.title));
    this.date = el('div', 'date');
    cartouche.appendChild(this.date);
    ui.appendChild(cartouche);

    this.notices = el('div', 'notices');
    ui.appendChild(this.notices);

    // The ledger, top right. `.treasury .amount` is what the smoke test reads.
    const ledger = el('div', 'ledger treasury panel');
    const row = (label: string): [HTMLElement, HTMLElement, HTMLElement] => {
      const r = el('div', 'row');
      r.appendChild(el('span', 'label', label));
      const main = el('span', 'value');
      const sub = el('span', 'sub');
      r.append(main, sub);
      ledger.appendChild(r);
      return [main, sub, r];
    };
    [this.amount, this.income] = row('Akçe');
    this.amount.classList.add('amount');
    const [product, productRate, productRow] = row(city.def.resource.good);
    this.product = product;
    this.productRate = productRate;
    this.product.classList.add('product');
    const { sellLot, price } = balance.product;
    this.sellButton = el('button', 'btn sell', 'Sat');
    this.sellButton.title =
      `${fmt(sellLot)} ${city.def.resource.unit} ${city.def.resource.good.toLocaleLowerCase('tr-TR')} ` +
      `sat: +${fmt(sellLot * price)} akçe`;
    this.sellButton.addEventListener('click', () => cb.onSell());
    productRow.appendChild(this.sellButton);
    [this.population, this.growth] = row('Nüfus');
    const order = el('div', 'row order');
    order.appendChild(el('span', 'label', 'Huzur'));
    const track = el('span', 'track');
    this.orderBar = el('i', '');
    track.appendChild(this.orderBar);
    this.orderName = el('span', 'sub');
    order.append(track, this.orderName);
    ledger.appendChild(order);
    [this.food, this.foodShare] = row('Erzak');
    this.food.title = 'Tarlaların ve ambarların doyurabileceği nüfus';
    [this.rank, this.works] = row('Şehir');

    const tax = el('div', 'policy', '<span class="label">Vergi</span>');
    for (const rate of TAX_RATES) {
      const def = balance.tax.rates[rate];
      const b = el('button', 'btn', def.name);
      b.title = `Kişi başı ${def.perHead.toLocaleString('tr-TR')} akçe · huzur ${signed(def.order)}`;
      b.addEventListener('click', () => cb.onTax(rate));
      this.taxButtons.set(rate, b);
      tax.appendChild(b);
    }
    ledger.appendChild(tax);

    this.accountsToggle = el('button', 'btn goods-toggle', 'Hesap ▾');
    this.accountsToggle.title = 'Gelirin, ürünün ve huzurun dökümü';
    this.accountsToggle.setAttribute('aria-expanded', 'false');
    this.accounts = el('div', 'sheet accounts');
    this.accounts.hidden = true;
    this.accountsToggle.addEventListener('click', () => {
      this.accounts.hidden = !this.accounts.hidden;
      this.accountsToggle.textContent = `Hesap ${this.accounts.hidden ? '▾' : '▴'}`;
      this.accountsToggle.setAttribute('aria-expanded', String(!this.accounts.hidden));
      this.statsKey = '';
    });
    const toggles = el('div', 'toggles');
    toggles.appendChild(this.accountsToggle);
    ledger.append(toggles, this.accounts);
    ui.appendChild(ledger);

    const speed = el('div', 'speed panel');
    const speedIcons = [ICONS.pause, ICONS.play1, ICONS.play2, ICONS.play3];
    const speedNames = ['Duraklat', 'Normal hız', 'Hızlı', 'Çok hızlı'];
    speedIcons.forEach((icon, s) => {
      const b = el('button', 'btn', svg(icon, '0 0 16 16'));
      b.title = `${speedNames[s]} (${s === 0 ? 'Boşluk' : s})`;
      b.setAttribute('aria-label', speedNames[s]);
      b.addEventListener('click', () => cb.onSpeed(s as Speed));
      this.speedButtons.push(b);
      speed.appendChild(b);
    });
    speed.appendChild(el('span', 'sep'));
    this.soundButton = el('button', 'btn', svg(ICONS.sound, '0 0 16 16'));
    this.soundButton.title = 'Ses';
    this.soundButton.setAttribute('aria-label', 'Ses');
    this.soundButton.addEventListener('click', () => cb.onSound(this.soundButton.dataset.on !== '1'));
    const menuButton = el('button', 'btn', svg(ICONS.menu, '0 0 16 16'));
    this.menuButton = menuButton;
    menuButton.title = 'Menü: kayıt, yükleme, müzik';
    menuButton.setAttribute('aria-label', 'Menü');
    speed.append(this.soundButton, menuButton);
    ui.appendChild(speed);

    // The menu: saves, a new game, music.
    this.menu = el('div', 'menu panel');
    this.menu.hidden = true;
    menuButton.addEventListener('click', () => {
      this.menu.hidden = !this.menu.hidden;
      menuButton.classList.toggle('on', !this.menu.hidden);
      this.newGameArmed = false;
      this.renderNewGame();
    });
    const save = el('button', 'btn', '<b>Kaydet</b>');
    save.dataset.action = 'kaydet';
    save.addEventListener('click', () => cb.onSave());
    this.menu.appendChild(save);
    for (const [slot, label] of [
      ['kayit', 'Kaydı yükle'],
      ['oto', 'Otomatik kaydı yükle'],
    ] as const) {
      const b = el('button', 'btn', `<b>${label}</b><small></small>`);
      b.dataset.action = slot === 'kayit' ? 'yukle' : 'oto';
      b.addEventListener('click', () => cb.onLoad(slot));
      this.slotButtons.set(slot, b);
      this.menu.appendChild(b);
    }
    const exportButton = el('button', 'btn', 'Dosyaya indir');
    exportButton.addEventListener('click', () => cb.onExport());
    const importInput = el('input', '');
    importInput.type = 'file';
    importInput.accept = 'application/json,.json';
    importInput.hidden = true;
    importInput.addEventListener('change', () => {
      const file = importInput.files?.[0];
      if (file !== undefined) cb.onImport(file);
      importInput.value = '';
    });
    const importButton = el('button', 'btn', 'Dosyadan yükle');
    importButton.addEventListener('click', () => importInput.click());
    const files = el('div', 'pair');
    files.append(exportButton, importButton, importInput);
    this.menu.appendChild(files);
    this.musicButton = el('button', 'btn', 'Müzik');
    this.musicButton.addEventListener('click', () => cb.onMusic(this.musicButton.dataset.on !== '1'));
    this.menu.appendChild(this.musicButton);
    const newGame = el('button', 'btn new-game', 'Yeni oyun');
    newGame.addEventListener('click', () => {
      // A new game throws the city away, so it takes a second click to be sure.
      if (this.newGameArmed) {
        this.newGameArmed = false;
        cb.onNewGame();
      } else {
        this.newGameArmed = true;
      }
      this.renderNewGame();
    });
    this.menu.appendChild(newGame);
    ui.appendChild(this.menu);

    // The build bar: one card per building, with its price, time and first-level gift.
    this.buildBar = el('div', 'cropbar buildbar panel');
    this.buildBar.hidden = true;
    const items = el('div', 'items');
    for (const kind of BUILDING_KINDS) {
      const def = balance.buildings[kind];
      const first = def.levels[0];
      const b = el(
        'button',
        'btn',
        `<b>${kindName(city, kind)}</b><small>${priceText(city, first.cost, first.material)} · ${first.months} ay</small>` +
          `<small>${effectText(city, first)}</small>`,
      );
      b.title = def.hint;
      b.dataset.kind = kind;
      b.addEventListener('click', () => cb.onBuildKind(kind));
      this.buildButtons.set(kind, b);
      items.appendChild(b);
    }
    this.buildBar.appendChild(items);
    ui.appendChild(this.buildBar);

    const toolbar = el('div', 'toolbar panel');
    const tools: Array<[Tool, string, string, string]> = [
      ['incele', 'İncele', ICONS.incele, 'Esc'],
      ['insa', 'İnşa', ICONS.insa, 'Y'],
      ['yik', 'Yık', ICONS.yik, 'B'],
    ];
    for (const [tool, label, icon, key] of tools) {
      const b = el('button', 'btn', `${svg(icon)}<span>${label}</span>`);
      b.title = `${label} (${key})`;
      b.dataset.tool = tool;
      b.addEventListener('click', () => cb.onTool(tool));
      this.toolButtons.set(tool, b);
      toolbar.appendChild(b);
    }
    toolbar.appendChild(el('div', 'sep'));
    this.rosterButton = el('button', 'btn roster-toggle', `${svg(ICONS.yapilar)}<span>Yapılar</span>`);
    this.rosterButton.title = 'Yapılar ve yükseltmeler (L)';
    this.rosterCount = el('i', 'count');
    this.rosterCount.hidden = true;
    this.rosterButton.appendChild(this.rosterCount);
    this.rosterButton.addEventListener('click', () => this.toggleRoster());
    toolbar.appendChild(this.rosterButton);
    ui.appendChild(toolbar);

    // The roster: every building, how far it has come and what its next level takes.
    this.roster = el('div', 'roster panel');
    this.roster.hidden = true;
    const head = el('div', 'head');
    head.appendChild(el('h3', '', 'Yapılar'));
    const closeRoster = el('button', 'close btn', '×');
    closeRoster.title = 'Kapat (L)';
    closeRoster.addEventListener('click', () => this.toggleRoster(false));
    head.appendChild(closeRoster);
    this.rosterSummary = el('div', 'summary');
    this.rosterList = el('div', 'list');
    this.roster.append(head, this.rosterSummary, this.rosterList);
    ui.appendChild(this.roster);

    this.info = el('div', 'info panel');
    this.info.hidden = true;
    ui.appendChild(this.info);

    ui.appendChild(
      el(
        'div',
        'hint',
        'Sürükle: kaydır · Sağ tık: döndür<br>Tekerlek: yakınlaş · Q/E, WASD<br>Tıkla: incele',
      ),
    );

    this.tip = el('div', 'tip panel');
    this.tip.hidden = true;
    root.appendChild(this.tip);
  }

  setDate(text: string): void {
    this.date.textContent = text;
  }

  /** The ledger, redrawn only when a figure it shows has changed. */
  setStats(): void {
    const city = this.city;
    const s = city.stats;
    const key = [
      Math.round(city.treasury),
      Math.round(city.product),
      Math.round(city.population),
      s.income.total,
      s.product,
      Math.round(s.growth),
      Math.round(s.order),
      s.level,
      s.works,
      s.food,
      city.buildings.size,
      city.expansion.built,
      city.policy.tax,
      this.accounts.hidden ? '' : `${s.last.income}|${s.last.product}`,
    ].join('|');
    this.refreshAffordable();
    if (key === this.statsKey) return;
    this.statsKey = key;
    const unit = city.def.resource.unit;
    this.amount.textContent = fmt(city.treasury);
    this.amount.classList.toggle('bad', city.treasury < 0);
    this.income.textContent = `${signed(s.income.total)}/ay`;
    this.product.textContent = `${fmt(city.product)} ${unit}`;
    this.productRate.textContent = `${signed(s.product)}/ay`;
    this.sellButton.disabled = city.product < city.balance.product.sellLot;
    this.population.textContent = fmt(city.population);
    this.growth.textContent = `${signed(s.growth)}/ay`;
    this.growth.classList.toggle('bad', s.growth < 0);
    const state = orderState(city);
    this.orderBar.style.width = `${Math.round(s.order)}%`;
    this.orderBar.className = state;
    this.orderName.textContent = `${ORDER_NAMES[state]} · ${Math.round(s.order)}`;
    this.orderName.classList.toggle('bad', state === 'huzursuz' || state === 'isyan');
    const levels = city.balance.levels;
    this.rank.textContent = levels[s.level].name;
    const room = slots(city);
    this.works.textContent = `yapı ${room.used}/${room.max}`;
    this.works.classList.toggle('bad', room.used >= room.max);
    this.food.textContent = `${fmt(s.food)} kişi`;
    const full = city.population / Math.max(1, s.food);
    this.foodShare.textContent = full > 1 ? 'kıtlık' : `%${Math.round(full * 100)} dolu`;
    this.foodShare.classList.toggle('bad', full > 0.95);
    for (const [rate, b] of this.taxButtons) b.classList.toggle('on', rate === city.policy.tax);
    if (!this.accounts.hidden) this.renderAccounts();
  }

  /** Where the month's akçe, product and order come from. */
  private renderAccounts(): void {
    const city = this.city;
    const s = city.stats;
    const good = city.def.resource.good;
    const line = (label: string, n: number, cls = ''): string =>
      `<span class="${cls}">${label}</span><span class="n ${cls} ${n < 0 ? 'down' : n > 0 ? 'up' : ''}">${signed(n)}</span>`;
    const next = city.balance.levels[s.level + 1];
    this.accounts.innerHTML =
      '<div class="lines">' +
      '<span class="head">Bu ay</span><span class="head n">akçe</span>' +
      line('Hane vergisi', s.income.tax) +
      line('Yapılar', s.income.buildings) +
      line('Bakım', -s.income.upkeep) +
      line('Toplam', s.income.total, 'total') +
      `<span class="head">${good}</span><span class="head n">${city.def.resource.unit}</span>` +
      line('Şehir ve ocaklar', s.product, 'total') +
      '<span class="head">Huzur</span><span class="head n"></span>' +
      line('Temel', s.orderParts.base) +
      line('Vergi', s.orderParts.tax) +
      line('Yapılar', s.orderParts.buildings) +
      (s.orderParts.walls !== 0 ? line('Surlar', s.orderParts.walls) : '') +
      line('Kalabalık', s.orderParts.crowding) +
      (s.orderParts.food !== 0 ? line('Kıtlık', s.orderParts.food) : '') +
      (s.orderParts.debt !== 0 ? line('Borç', s.orderParts.debt) : '') +
      `<span class="wide dim">Geçen ay: ${signed(s.last.income)} akçe · ` +
      `${signed(s.last.product)} ${good.toLocaleLowerCase('tr-TR')} · ${signed(s.last.growth)} kişi</span>` +
      (next !== undefined
        ? `<span class="wide dim">${next.name}: ${fmt(next.population)} nüfusta</span>`
        : '') +
      '</div>';
  }

  /** Greys the build cards the treasury or the store cannot pay for. */
  private refreshAffordable(): void {
    if (this.buildBar.hidden) return;
    const city = this.city;
    const key = `${Math.round(city.treasury)}|${Math.round(city.product)}`;
    if (key === this.affordKey) return;
    this.affordKey = key;
    for (const [kind, b] of this.buildButtons) {
      const first = city.balance.buildings[kind].levels[0];
      b.classList.toggle('poor', city.treasury < first.cost || city.product < first.material);
    }
  }

  /** What each save slot holds, for the menu. */
  setSlots(labels: SlotLabels): void {
    for (const [slot, b] of this.slotButtons) {
      const label = labels[slot];
      b.disabled = label === null;
      const small = b.querySelector('small');
      if (small !== null) small.textContent = label ?? 'boş';
    }
  }

  setAudio(sound: boolean, music: boolean): void {
    this.soundButton.dataset.on = sound ? '1' : '0';
    this.soundButton.innerHTML = svg(sound ? ICONS.sound : ICONS.muted, '0 0 16 16');
    this.soundButton.title = sound ? 'Sesi kapat' : 'Sesi aç';
    this.musicButton.dataset.on = music ? '1' : '0';
    this.musicButton.textContent = music ? 'Müzik: açık' : 'Müzik: kapalı';
    this.musicButton.classList.toggle('on', music);
  }

  closeMenu(): void {
    this.menu.hidden = true;
    this.menuButton.classList.remove('on');
    this.newGameArmed = false;
  }

  private renderNewGame(): void {
    const b = this.menu.querySelector<HTMLButtonElement>('.new-game');
    if (b === null) return;
    b.textContent = this.newGameArmed ? 'Emin misin? Şehir baştan kurulur' : 'Yeni oyun';
    b.classList.toggle('armed', this.newGameArmed);
  }

  /** Forgets what the ledger last showed, so it redraws for a city just loaded. */
  refresh(): void {
    this.statsKey = '';
    this.affordKey = '';
  }

  setSpeed(speed: Speed): void {
    this.speedButtons.forEach((b, k) => b.classList.toggle('on', k === speed));
  }

  setTool(tool: Tool): void {
    for (const [t, b] of this.toolButtons) b.classList.toggle('on', t === tool);
    this.buildBar.hidden = tool !== 'insa';
    this.affordKey = '';
    this.refreshAffordable();
  }

  setBuildKind(kind: BuildingKind): void {
    for (const [k, b] of this.buildButtons) b.classList.toggle('on', k === kind);
  }

  /** Shows a tile. A pinned panel stays until closed and offers what can be done there. */
  showInfo(info: TileInfo | null, pinned = false): void {
    if (info === null) {
      this.info.hidden = true;
      return;
    }
    const rows = info.rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`);
    this.info.innerHTML = `<h3>${info.title}</h3><dl>${rows.join('')}</dl>`;
    const b = info.building;
    if (b !== undefined) this.info.appendChild(this.ladder(b, pinned));
    if (pinned) {
      const close = el('button', 'close btn', '×');
      close.title = 'Kapat (Esc)';
      close.addEventListener('click', () => this.cb.onCloseInfo());
      this.info.prepend(close);
      if (b !== undefined) {
        const down = el('button', 'btn demolish', `Yık · +${fmt(b.refund)} akçe`);
        down.addEventListener('click', () => this.cb.onDemolish(b.id));
        const bar = el('div', 'actions');
        bar.appendChild(down);
        this.info.appendChild(bar);
      }
    }
    this.info.classList.toggle('pinned', pinned);
    this.info.hidden = false;
  }

  /**
   * A building's three levels as a ladder: those built ticked, the one being built with its
   * progress, the next with its price and, when the panel is pinned, the button to raise it;
   * a level the city is not great enough for yet says which rank it waits for.
   */
  private ladder(b: BuildingSummary, pinned: boolean): HTMLElement {
    const box = el('div', 'ladder');
    for (const r of b.rungs) {
      const row = el('div', `rung ${r.state}`);
      row.appendChild(el('span', 'lv', ROMAN[r.level]));
      const body = el('div', 'body');
      body.appendChild(el('span', 'fx', r.effect));
      if (r.state === 'done') {
        body.appendChild(el('small', 'ok', 'kuruldu'));
      } else if (r.state === 'work' && b.work !== null) {
        body.appendChild(el('small', '', `inşaatta · ${b.work.monthsLeft} ay kaldı`));
        body.appendChild(
          el('span', 'progress', `<i style="width:${Math.round(b.work.progress * 100)}%"></i>`),
        );
      } else {
        body.appendChild(el('small', 'price', `${r.price} · ${r.months} ay`));
        if (r.need !== undefined) body.appendChild(el('small', 'need', `🔒 Şehir ${r.need} olunca`));
        const o = b.offer;
        if (r.state === 'next' && o !== null && r.need === undefined) {
          if (pinned) {
            const up = el('button', 'btn upgrade', `▲ ${ROMAN[r.level]}. seviyeye yükselt`);
            up.disabled = o.problem !== undefined;
            up.addEventListener('click', () => this.cb.onUpgrade(b.id));
            body.appendChild(up);
          }
          if (o.problem !== undefined && o.blockedBy !== 'work')
            body.appendChild(el('small', 'bad', o.problem));
        }
      }
      row.appendChild(body);
      box.appendChild(row);
    }
    return box;
  }

  toggleRoster(open = !this.rosterOpen): void {
    this.roster.hidden = !open;
    this.rosterButton.classList.toggle('on', open);
    this.rosterKey = '';
  }

  get rosterOpen(): boolean {
    return !this.roster.hidden;
  }

  /**
   * The buildings list with the next ring of walls at its head, and the count on its button
   * of what can be begun now.
   */
  setRoster(
    list: BuildingSummary[],
    works: { busy: number; max: number },
    room: { used: number; max: number },
    expansion: ExpansionView | null,
  ): void {
    const ready = list.filter((b) => b.readiness === 'ready').length;
    const wallsReady = expansion !== null && expansion.offer.problem === undefined ? 1 : 0;
    this.rosterCount.hidden = ready + wallsReady === 0;
    this.rosterCount.textContent = String(ready + wallsReady);
    this.rosterButton.title =
      ready + wallsReady > 0
        ? `Yapılar: ${ready + wallsReady} iş başlatılabilir (L)`
        : 'Yapılar ve yükseltmeler (L)';
    if (this.roster.hidden) return;
    const key = JSON.stringify([list, works, room, expansion]);
    if (key === this.rosterKey) return;
    this.rosterKey = key;
    this.rosterSummary.textContent =
      `${ready > 0 ? `${ready} yapı yükseltilebilir` : 'Şu an yükseltilebilecek yapı yok'}` +
      ` · yapı hakkı ${room.used}/${room.max} · inşaat ${works.busy}/${works.max}`;
    this.rosterList.innerHTML = '';
    if (expansion !== null) this.rosterList.appendChild(this.expansionCard(expansion));
    if (list.length === 0) this.rosterList.appendChild(el('div', 'dim', 'Henüz yapı yok: İnşa ile kur.'));
    for (const b of list) this.rosterList.appendChild(this.rosterEntry(b));
  }

  /** The next ring of walls: what it gives, what it costs, and the button to begin it. */
  private expansionCard(x: ExpansionView): HTMLElement {
    const o = x.offer;
    const state =
      x.progress !== null
        ? 'building'
        : o.problem === undefined
          ? 'ready'
          : o.blockedBy === 'rank'
            ? 'locked'
            : 'waiting';
    const card = el('div', `entry walls ${state}`);
    card.appendChild(el('div', 'top', `<b>${o.def.name}</b><small>şehri çeviren yeni sur</small>`));
    card.appendChild(
      el(
        'div',
        'now',
        `+${o.def.slots} yapı hakkı · +${o.def.order} huzur · yeni kapılar, sokaklar ve mahalleler`,
      ),
    );
    const next = el('div', 'next');
    const price = `${priceText(this.city, o.def.cost, o.def.material)} · ${o.def.months} ay`;
    if (x.progress !== null) {
      next.appendChild(el('span', 'progress', `<i style="width:${Math.round(x.progress * 100)}%"></i>`));
      next.appendChild(el('small', '', `sur yükseliyor · ${x.monthsLeft} ay kaldı`));
    } else if (o.problem === undefined) {
      const go = el('button', 'btn upgrade', `▲ Surları yükselt · ${price}`);
      go.addEventListener('click', () => this.cb.onExpand());
      next.appendChild(go);
    } else {
      next.appendChild(el('small', 'price', price));
      next.appendChild(
        el(
          'small',
          o.blockedBy === 'rank' ? 'need' : 'bad',
          o.blockedBy === 'rank' ? `🔒 ${o.problem}` : o.problem,
        ),
      );
    }
    card.appendChild(next);
    return card;
  }

  private rosterEntry(b: BuildingSummary): HTMLElement {
    const entry = el('div', `entry ${b.readiness}`);
    const name = el('button', 'name', `<b>${b.name}</b>${b.kind !== '' ? `<small>${b.kind}</small>` : ''}`);
    name.title = 'Haritada göster';
    name.addEventListener('click', () => this.cb.onFocus(b.id));
    const pips = el('span', 'pips');
    pips.title = `${b.level}. seviye`;
    for (let k = 1; k <= b.levels; k++) {
      const done = k <= b.level;
      const work = b.work !== null && k === b.work.toLevel;
      pips.appendChild(el('i', done ? 'done' : work ? 'work' : ''));
    }
    const top = el('div', 'top');
    top.append(name, pips);
    entry.appendChild(top);
    entry.appendChild(el('div', 'now', b.effect ?? 'ilk seviyesi kuruluyor'));
    const next = el('div', 'next');
    const o = b.offer;
    if (b.work !== null) {
      next.appendChild(el('span', 'progress', `<i style="width:${Math.round(b.work.progress * 100)}%"></i>`));
      next.appendChild(el('small', '', `${ROMAN[b.work.toLevel]} · ${b.work.monthsLeft} ay kaldı`));
    } else if (o === null) {
      next.appendChild(el('small', 'dim', READINESS_NAMES.top));
    } else {
      const rung = b.rungs[o.toLevel - 1];
      if (b.readiness === 'ready') {
        const up = el('button', 'btn upgrade', `▲ ${ROMAN[o.toLevel]} · ${rung.price} · ${rung.months} ay`);
        up.addEventListener('click', () => this.cb.onUpgrade(b.id));
        next.appendChild(up);
      } else {
        next.appendChild(el('small', 'price', `▲ ${ROMAN[o.toLevel]} · ${rung.price} · ${rung.months} ay`));
        next.appendChild(el('small', 'bad', o.problem ?? READINESS_NAMES[b.readiness]));
      }
      next.appendChild(el('small', 'gain', `olunca: ${rung.effect}`));
    }
    entry.appendChild(next);
    return entry;
  }

  /** Moves each building's badge over it; badges of buildings off the screen are hidden. */
  placeMarkers(places: MarkerPlace[], visible: boolean): void {
    this.markerLayer.hidden = !visible;
    if (!visible) return;
    const seen = new Set<number>();
    for (const p of places) {
      const s = p.summary;
      seen.add(s.id);
      let m = this.markers.get(s.id);
      if (m === undefined) {
        m = el('button', 'marker');
        const id = s.id;
        m.addEventListener('click', () => this.cb.onFocus(id));
        this.markers.set(s.id, m);
        this.markerLayer.appendChild(m);
      }
      const state = `${s.readiness}|${s.level}|${s.work === null ? '' : Math.round(s.work.progress * 20)}`;
      if (m.dataset.state !== state) {
        m.dataset.state = state;
        m.className = `marker ${s.readiness}`;
        m.title = `${s.name}: ${s.level > 0 ? `${s.level}. seviye` : 'inşaatta'} · ${
          s.readiness === 'building'
            ? `${s.work?.monthsLeft ?? 0} ay kaldı`
            : (s.offer?.problem ?? READINESS_NAMES[s.readiness])
        }`;
        const arrow = s.readiness === 'ready' || s.readiness === 'waiting' ? '<i class="up">▲</i>' : '';
        const bar =
          s.work !== null
            ? `<span class="bar"><i style="width:${Math.round(s.work.progress * 100)}%"></i></span>`
            : '';
        m.innerHTML = `<b>${s.level > 0 ? ROMAN[s.level] : '⚒'}</b>${arrow}${bar}`;
      }
      m.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`;
    }
    for (const [id, m] of this.markers) {
      if (seen.has(id)) continue;
      m.remove();
      this.markers.delete(id);
    }
  }

  notify(n: Notice): void {
    const item = el('div', `notice panel ${n.kind}`);
    item.textContent = n.text;
    this.notices.appendChild(item);
    while (this.notices.children.length > 3) this.notices.firstElementChild?.remove();
    window.setTimeout(() => item.remove(), NOTICE_MS);
  }

  showTip(text: string, x: number, y: number, bad: boolean): void {
    this.tip.textContent = text;
    this.tip.classList.toggle('bad', bad);
    this.tip.style.left = `${x}px`;
    this.tip.style.top = `${y}px`;
    this.tip.hidden = false;
  }

  hideTip(): void {
    this.tip.hidden = true;
  }
}
