import type { Balance, BuildingKind, TaxRate } from '../sim/balance';
import { BUILDING_KINDS, TAX_RATES } from '../sim/balance';
import { kindName } from '../sim/buildings';
import type { Speed } from '../sim/calendar';
import type { CityState, Notice } from '../sim/city';
import { ORDER_NAMES, orderState } from '../sim/economy';
import { effectText, priceText, type TileInfo } from '../sim/inspect';

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
}

const ICONS = {
  incele: '<circle cx="10" cy="10" r="6"/><path d="M14.5 14.5 20 20"/>',
  insa: '<path d="M3 20h18M5 20v-8h14v8M9 20v-4h6v4"/><path d="M7 12a5 5 0 0 1 10 0"/><path d="M12 7V4"/>',
  yik: '<path d="M4 20 14 10M9 5c3-2 7-2 10 1-3-1-5 0-7 2M14 10l-2-2"/>',
  pause: '<rect x="3" y="2" width="4" height="12"/><rect x="9" y="2" width="4" height="12"/>',
  play1: '<path d="M4 2l9 6-9 6z"/>',
  play2: '<path d="M1 2l7 6-7 6zM8 2l7 6-7 6z"/>',
  play3: '<path d="M0 2l5.5 6L0 14zM5 2l5.5 6L5 14zM10 2l5.5 6L10 14z"/>',
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
    ui.appendChild(speed);

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
    ui.appendChild(toolbar);

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
    this.works.textContent = `inşaat ${s.works}/${levels[s.level].builders}`;
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
      line('Toplam', s.income.total, 'total') +
      `<span class="head">${good}</span><span class="head n">${city.def.resource.unit}</span>` +
      line('Şehir ve ocaklar', s.product, 'total') +
      '<span class="head">Huzur</span><span class="head n"></span>' +
      line('Temel', s.orderParts.base) +
      line('Vergi', s.orderParts.tax) +
      line('Yapılar', s.orderParts.buildings) +
      line('Kalabalık', s.orderParts.crowding) +
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

  setSpeed(speed: Speed): void {
    this.speedButtons.forEach((b, s) => b.classList.toggle('on', s === speed));
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
    if (b !== undefined && b.progress !== null) {
      this.info.insertAdjacentHTML(
        'beforeend',
        `<div class="progress" title="İnşaat"><i style="width:${Math.round(b.progress * 100)}%"></i></div>`,
      );
    }
    if (pinned) {
      const close = el('button', 'close btn', '×');
      close.title = 'Kapat (Esc)';
      close.addEventListener('click', () => this.cb.onCloseInfo());
      this.info.prepend(close);
      if (b !== undefined) {
        const bar = el('div', 'actions');
        const o = b.offer;
        if (o !== null) {
          const up = el(
            'button',
            'btn upgrade',
            `<b>${o.toLevel}. seviyeye yükselt</b>` +
              `<small>${priceText(this.city, o.cost, o.material)} · ${o.months} ay</small>`,
          );
          up.disabled = o.problem !== undefined;
          if (o.problem !== undefined)
            up.insertAdjacentHTML('beforeend', `<small class="bad">${o.problem}</small>`);
          up.addEventListener('click', () => this.cb.onUpgrade(b.id));
          bar.appendChild(up);
        }
        const down = el('button', 'btn demolish', `Yık · +${fmt(b.refund)} akçe`);
        down.addEventListener('click', () => this.cb.onDemolish(b.id));
        bar.appendChild(down);
        this.info.appendChild(bar);
      }
    }
    this.info.classList.toggle('pinned', pinned);
    this.info.hidden = false;
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
