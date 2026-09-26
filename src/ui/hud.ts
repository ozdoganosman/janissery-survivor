import type {
  Balance,
  BuildingCategory,
  BuildingKind,
  FieldChoice,
  FieldPlan,
  TaxRate,
} from '../sim/balance';
import { BUILDING_KINDS, GOODS, TAX_RATES } from '../sim/balance';
import type { Speed } from '../sim/calendar';
import type { CityState, Notice } from '../sim/city';
import {
  LEVEL_NAMES,
  SERVICE_NAMES,
  STAGE_NAMES,
  STATUS_NAMES,
  type OutputInfo,
  type TileInfo,
} from '../sim/inspect';
import { LAYER_NAMES, LAYERS, type Layer } from '../render/layers';

export type Tool = 'incele' | 'yol' | 'konut' | 'tarla' | 'yapi' | 'yik';

export interface HudCallbacks {
  onTool(tool: Tool): void;
  onSpeed(speed: Speed): void;
  onLayer(layer: Layer | null): void;
  onCrop(crop: FieldChoice): void;
  onBuildKind(kind: BuildingKind): void;
  onVakif(on: boolean): void;
  onTax(rate: TaxRate): void;
  onNarh(on: boolean): void;
  onFieldPlan(fieldId: number, plan: FieldPlan): void;
  onCloseInfo(): void;
}

const ICONS = {
  incele: '<circle cx="10" cy="10" r="6"/><path d="M14.5 14.5 20 20"/>',
  yol: '<path d="M8 21 10.5 3M16 21 13.5 3M12 18v-2M12 12v-2M12 6V5"/>',
  konut: '<path d="M4 20V11l8-6 8 6v9z"/><path d="M10 20v-5h4v5"/><path d="M4 11h16"/>',
  tarla: '<path d="M3 19 9 7h6l6 12z"/><path d="M6 13h12M12 7v12"/>',
  yapi: '<path d="M3 20h18M5 20v-8h14v8M9 20v-4h6v4"/><path d="M7 12a5 5 0 0 1 10 0"/><path d="M12 7V4"/>',
  yik: '<path d="M4 20 14 10M9 5c3-2 7-2 10 1-3-1-5 0-7 2M14 10l-2-2"/>',
  katman: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 12 9 5 9-5"/><path d="m3 16 9 5 9-5"/>',
  bereket:
    '<path d="M12 21V9M12 13c-3 0-4-2-4-4 3 0 4 2 4 4Zm0 0c3 0 4-2 4-4-3 0-4 2-4 4Zm0-4c-2.5 0-3.5-2-3.5-3.5 2.5 0 3.5 1.5 3.5 3.5Zm0 0c2.5 0 3.5-2 3.5-3.5-2.5 0-3.5 1.5-3.5 3.5Zm0 8c-3 0-4-2-4-4 3 0 4 2 4 4Zm0 0c3 0 4-2 4-4-3 0-4 2-4 4Z"/>',
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
const pct = (n: number): string => `%${Math.round(n * 100)}`;
const signed = (n: number): string => (Math.round(n) > 0 ? `+${fmt(n)}` : fmt(n));

/** "540 / 600 kile un": made last month against what full staff would make. */
function outputText(o: OutputInfo): string {
  return `${fmt(o.made)} / ${fmt(o.capacity)} ${o.unit} ${o.name.toLocaleLowerCase('tr-TR')}`;
}

/** How long a notice stays on screen, in milliseconds. */
const NOTICE_MS = 7000;

/** The manuscript-style frame and every on-screen control. Plain DOM over the canvas. */
export class Hud {
  private readonly date: HTMLElement;
  private readonly amount: HTMLElement;
  private readonly income: HTMLElement;
  private readonly population: HTMLElement;
  private readonly jobless: HTMLElement;
  private readonly granary: HTMLElement;
  private readonly months: HTMLElement;
  private readonly demandBar: HTMLElement;
  private readonly demandHint: HTMLElement;
  private readonly prosperity: HTMLElement;
  private readonly needsLine: HTMLElement;
  private readonly goodsTable: HTMLElement;
  private readonly goodsToggle: HTMLButtonElement;
  private readonly buildBar: HTMLElement;
  private readonly buildButtons = new Map<BuildingKind, HTMLButtonElement>();
  private readonly categoryTabs = new Map<BuildingCategory, HTMLButtonElement>();
  private readonly vakifButton: HTMLButtonElement;
  private readonly budget: HTMLElement;
  private readonly budgetToggle: HTMLButtonElement;
  private readonly budgetLines: HTMLElement;
  private readonly taxButtons = new Map<TaxRate, HTMLButtonElement>();
  private readonly narhButton: HTMLButtonElement;
  private readonly layerBar: HTMLElement;
  private readonly layerButtons = new Map<Layer, HTMLButtonElement>();
  private readonly layerToggle: HTMLButtonElement;
  private buildKind: BuildingKind = 'arasta';
  private vakif = false;
  private founders = 0;
  private readonly info: HTMLElement;
  private readonly tip: HTMLElement;
  private readonly notices: HTMLElement;
  private readonly cropBar: HTMLElement;
  private readonly toolButtons = new Map<Tool, HTMLButtonElement>();
  private readonly cropButtons = new Map<FieldChoice, HTMLButtonElement>();
  private readonly speedButtons: HTMLButtonElement[] = [];
  private statsKey = '';

  constructor(
    root: HTMLElement,
    title: string,
    private readonly balance: Balance,
    private readonly cb: HudCallbacks,
  ) {
    root.appendChild(el('div', 'frame'));
    const ui = el('div', 'ui');
    root.appendChild(ui);

    const cartouche = el('div', 'cartouche panel');
    cartouche.appendChild(el('div', 'title', title));
    this.date = el('div', 'date');
    cartouche.appendChild(this.date);
    ui.appendChild(cartouche);

    this.notices = el('div', 'notices');
    ui.appendChild(this.notices);

    // Stats ledger, top right. `.treasury .amount` is what the smoke test reads.
    const ledger = el('div', 'ledger treasury panel');
    const row = (label: string): [HTMLElement, HTMLElement] => {
      const r = el('div', 'row');
      r.appendChild(el('span', 'label', label));
      const main = el('span', 'value');
      const sub = el('span', 'sub');
      r.append(main, sub);
      ledger.appendChild(r);
      return [main, sub];
    };
    [this.amount, this.income] = row('Hazine');
    this.amount.classList.add('amount');
    [this.population, this.jobless] = row('Nüfus');
    [this.granary, this.months] = row('Ambar');
    [this.prosperity, this.needsLine] = row('Refah');
    const demand = el('div', 'row demand');
    demand.appendChild(el('span', 'label', 'Konut talebi'));
    const track = el('span', 'track');
    this.demandBar = el('i', '');
    track.appendChild(this.demandBar);
    demand.appendChild(track);
    this.demandHint = el('span', 'hint-line');
    ledger.append(demand, this.demandHint);
    // The depot's goods fold away under the ledger; the header says why it is there.
    this.goodsToggle = el('button', 'btn goods-toggle', 'Mallar ▾');
    this.goodsToggle.title = 'Depodaki mallar';
    this.goodsToggle.setAttribute('aria-expanded', 'false');
    this.goodsTable = el('div', 'goods');
    this.goodsTable.hidden = true;
    this.goodsToggle.addEventListener('click', () => {
      this.goodsTable.hidden = !this.goodsTable.hidden;
      this.goodsToggle.textContent = this.goodsTable.hidden ? 'Mallar ▾' : 'Mallar ▴';
      this.goodsToggle.setAttribute('aria-expanded', String(!this.goodsTable.hidden));
      this.statsKey = '';
    });
    this.budgetToggle = el('button', 'btn goods-toggle', 'Bütçe ▾');
    this.budgetToggle.title = 'Gelir, gider, vergi ve narh';
    this.budgetToggle.setAttribute('aria-expanded', 'false');
    this.budget = el('div', 'budget');
    this.budget.hidden = true;
    this.budgetLines = el('div', 'lines');
    const tax = el('div', 'policy', '<span class="label">Vergi</span>');
    const rateNames: Record<TaxRate, string> = { hafif: 'Hafif', orta: 'Orta', agir: 'Ağır' };
    for (const rate of TAX_RATES) {
      const b = el('button', 'btn', rateNames[rate]);
      b.title = `Hane başına ayda ${balance.tax.rates[rate]} dirhem`;
      b.addEventListener('click', () => cb.onTax(rate));
      this.taxButtons.set(rate, b);
      tax.appendChild(b);
    }
    const narh = el('div', 'policy', '<span class="label">Narh</span>');
    this.narhButton = el('button', 'btn', 'Yok');
    this.narhButton.title = 'Ekmek ve kumaşa fiyat tavanı: refah artar, çarşı vergisi düşer';
    this.narhButton.addEventListener('click', () => cb.onNarh(!this.narhButton.classList.contains('on')));
    narh.appendChild(this.narhButton);
    this.budget.append(this.budgetLines, tax, narh);
    this.budgetToggle.addEventListener('click', () => {
      this.budget.hidden = !this.budget.hidden;
      this.budgetToggle.textContent = this.budget.hidden ? 'Bütçe ▾' : 'Bütçe ▴';
      this.budgetToggle.setAttribute('aria-expanded', String(!this.budget.hidden));
      this.statsKey = '';
    });
    const toggles = el('div', 'toggles');
    toggles.append(this.budgetToggle, this.goodsToggle);
    ledger.append(toggles, this.budget, this.goodsTable);
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

    this.cropBar = el('div', 'cropbar panel');
    this.cropBar.hidden = true;
    const crops: Array<[FieldChoice, string, string]> = [
      ['bugday', 'Buğday', 'Verimli toprakta bol ürün'],
      ['arpa', 'Arpa', 'Zayıf toprakta dayanıklı'],
      ['mera', 'Mera', 'Koyunlar otlar; Mayıs’ta yün'],
    ];
    for (const [crop, label, hint] of crops) {
      const b = el('button', 'btn', `<b>${label}</b><small>${hint}</small>`);
      b.addEventListener('click', () => cb.onCrop(crop));
      this.cropButtons.set(crop, b);
      this.cropBar.appendChild(b);
    }
    ui.appendChild(this.cropBar);

    this.buildBar = el('div', 'cropbar buildbar panel');
    this.buildBar.hidden = true;
    const tabs = el('div', 'tabs');
    const categories: Array<[BuildingCategory, string]> = [
      ['imalat', 'İmalathane'],
      ['carsi', 'Çarşı'],
      ['hizmet', 'Hizmet'],
      ['tarim', 'Tarım'],
    ];
    for (const [cat, label] of categories) {
      const t = el('button', 'btn tab', label);
      t.addEventListener('click', () => {
        const first = BUILDING_KINDS.find((k) => balance.works[k].category === cat);
        if (first !== undefined) cb.onBuildKind(first);
      });
      this.categoryTabs.set(cat, t);
      tabs.appendChild(t);
    }
    const items = el('div', 'items');
    for (const kind of BUILDING_KINDS) {
      const w = balance.works[kind];
      const b = el(
        'button',
        'btn',
        `<b>${w.name}</b><small>${fmt(w.cost)} dirhem</small><small>${w.hint}</small>`,
      );
      b.title = `${w.hint} · bakım ${fmt(w.upkeep)} dirhem/ay`;
      b.addEventListener('click', () => cb.onBuildKind(kind));
      this.buildButtons.set(kind, b);
      items.appendChild(b);
    }
    this.vakifButton = el('button', 'btn vakif', 'Vakıf olarak yaptır');
    this.vakifButton.title = 'Hazineden para çıkmaz; vakıf her ay yapının değerinin bir payını alır';
    this.vakifButton.addEventListener('click', () => cb.onVakif(!this.vakif));
    this.buildBar.append(tabs, items, this.vakifButton);
    ui.appendChild(this.buildBar);

    this.layerBar = el('div', 'layerbar panel');
    this.layerBar.hidden = true;
    for (const layer of LAYERS) {
      const b = el('button', 'btn', LAYER_NAMES[layer]);
      b.dataset.layer = layer;
      b.addEventListener('click', () => cb.onLayer(b.classList.contains('on') ? null : layer));
      this.layerButtons.set(layer, b);
      this.layerBar.appendChild(b);
    }
    ui.appendChild(this.layerBar);

    const toolbar = el('div', 'toolbar panel');
    const tools: Array<[Tool, string, string, string]> = [
      ['incele', 'İncele', ICONS.incele, 'Esc'],
      ['yol', 'Yol', ICONS.yol, 'R'],
      ['konut', 'Konut', ICONS.konut, 'K'],
      ['tarla', 'Tarla', ICONS.tarla, 'T'],
      ['yapi', 'Yapı', ICONS.yapi, 'Y'],
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
    this.layerToggle = el('button', 'btn', `${svg(ICONS.katman)}<span>Katman</span>`);
    this.layerToggle.title = 'Bilgi katmanları: verimlilik, hizmetler, duman, konut (F: verimlilik)';
    this.layerToggle.addEventListener('click', () => {
      this.layerBar.hidden = !this.layerBar.hidden;
      this.layerToggle.classList.toggle('open', !this.layerBar.hidden);
    });
    toolbar.appendChild(this.layerToggle);
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

  setStats(city: CityState): void {
    const s = city.stats;
    const treasury = city.treasury;
    const granary = city.granary;
    const goodsKey = this.goodsTable.hidden ? '' : GOODS.map((g) => Math.round(city.goods[g])).join(',');
    const policy = `${city.policy.tax}|${city.policy.narh}|${s.founders}|${city.unpaid}|${Math.round(s.netLastMonth)}`;
    const key = `${Math.round(treasury)}|${Math.round(granary)}|${Math.round(s.population)}|${Math.round(s.unemployed)}|${s.demand.toFixed(2)}|${s.freeLots}|${s.incomeLastMonth}|${s.prosperity.toFixed(2)}|${goodsKey}|${policy}`;
    if (key === this.statsKey) return;
    this.statsKey = key;
    this.amount.textContent = fmt(treasury);
    this.amount.classList.toggle('bad', treasury < 0);
    // Last month's result after every expense: what the treasury really gained or lost.
    const net = s.netLastMonth;
    this.income.textContent = s.incomeLastMonth > 0 ? `${signed(net)}/ay` : 'dirhem';
    this.income.classList.toggle('bad', net < 0);
    this.income.title = s.incomeLastMonth > 0 ? 'Geçen ayın gelirinden giderler düşüldükten sonra kalan' : '';
    if (!this.budget.hidden) this.renderBudget(city);
    for (const [rate, b] of this.taxButtons) b.classList.toggle('on', rate === city.policy.tax);
    this.narhButton.classList.toggle('on', city.policy.narh);
    this.narhButton.textContent = city.policy.narh ? 'Konuldu' : 'Yok';
    if (this.founders !== s.founders) {
      this.founders = s.founders;
      this.renderVakif();
    }
    this.population.textContent = fmt(s.population);
    const jobless = s.labor > 0 ? Math.round((s.unemployed / s.labor) * 100) : 0;
    this.jobless.textContent = `işsiz %${jobless}`;
    this.jobless.classList.toggle('bad', jobless > 12);
    this.granary.textContent = `${fmt(granary)} kile`;
    const months = Math.floor(s.foodMonths);
    this.months.textContent = city.hungry ? 'kıtlık' : months >= 24 ? 'bol' : `${months} ay`;
    this.months.classList.toggle('bad', s.foodMonths < 2);
    this.prosperity.textContent = pct(s.prosperity);
    this.needsLine.textContent = `ekmek ${pct(city.needs.ekmek)} · kumaş ${pct(city.needs.kumas)}`;
    // Demand bar grows from the middle: right and green for "people want to come", left and
    // red for "people are leaving".
    const d = Math.max(-1, Math.min(1, s.demand));
    this.demandBar.style.left = d >= 0 ? '50%' : `${50 + d * 50}%`;
    this.demandBar.style.width = `${Math.abs(d) * 50}%`;
    this.demandBar.className = d >= 0 ? 'up' : 'down';
    let hint = '';
    if (d > 0.05 && s.freeLots === 0) hint = 'Yeni evler için konut arsası ayırın';
    else if (d < -0.2 && s.foodMonths < 3) hint = 'Zahire azaldı, halk huzursuz';
    else if (d < -0.2) hint = 'İş yok, halk göç ediyor';
    this.demandHint.textContent = hint;
    this.demandHint.hidden = hint === '';
    if (!this.goodsTable.hidden) this.renderGoods(city);
  }

  /** Last month's accounts, line by line. */
  private renderBudget(city: CityState): void {
    const s = city.stats;
    const line = (label: string, n: number, cls = ''): string =>
      `<span class="${cls}">${label}</span><span class="n ${cls} ${n < 0 ? 'down' : n > 0 ? 'up' : ''}">${signed(n)}</span>`;
    this.budgetLines.innerHTML =
      '<span class="head">Geçen ay</span><span class="head n">dirhem</span>' +
      line('Hane vergisi', s.income.tax) +
      line('Esnafa satış', s.income.sales) +
      line('Çarşı vergisi', s.income.market) +
      line('Bakım', -s.expenses.upkeep) +
      (s.expenses.vakif > 0 ? line('Vakıf payları', -s.expenses.vakif) : '') +
      line('Sultan payı', -s.expenses.tribute) +
      line('Kalan', s.netLastMonth, 'total') +
      (city.unpaid ? '<span class="bad wide">Hazine borçta: kamu görevlileri maaş alamıyor</span>' : '') +
      `<span class="wide dim">Vakıf yaptıracak eşraf: ${s.founders}</span>`;
  }

  /** Stock of every good, and last month's balance of made against used. */
  private renderGoods(city: CityState): void {
    const flows =
      city.flows.last.made.zahire + city.flows.last.used.zahire > 0 ? city.flows.last : city.flows.current;
    const rows = GOODS.map((g) => {
      const def = city.balance.goods[g];
      const net = flows.made[g] - flows.used[g];
      return (
        `<span class="name">${def.name}</span><span class="stock">${fmt(city.goods[g])} <small>${def.unit}</small></span>` +
        `<span class="net ${net < -0.5 ? 'down' : net > 0.5 ? 'up' : ''}">${signed(net)}</span>`
      );
    });
    this.goodsTable.innerHTML = `<span class="head">Mal</span><span class="head">Depoda</span><span class="head">Aylık</span>${rows.join('')}`;
  }

  setSpeed(speed: Speed): void {
    this.speedButtons.forEach((b, s) => b.classList.toggle('on', s === speed));
  }

  setTool(tool: Tool): void {
    for (const [t, b] of this.toolButtons) b.classList.toggle('on', t === tool);
    this.cropBar.hidden = tool !== 'tarla';
    this.buildBar.hidden = tool !== 'yapi';
  }

  setCrop(crop: FieldChoice): void {
    for (const [c, b] of this.cropButtons) b.classList.toggle('on', c === crop);
  }

  setBuildKind(kind: BuildingKind): void {
    this.buildKind = kind;
    const cat = this.balance.works[kind].category;
    for (const [k, b] of this.buildButtons) {
      b.classList.toggle('on', k === kind);
      b.hidden = this.balance.works[k].category !== cat;
    }
    for (const [c, t] of this.categoryTabs) t.classList.toggle('on', c === cat);
    this.renderVakif();
  }

  setVakif(on: boolean): void {
    this.vakif = on;
    this.renderVakif();
  }

  /** The vakıf switch shows only for public buildings, with the notables ready. */
  private renderVakif(): void {
    const w = this.balance.works[this.buildKind];
    this.vakifButton.hidden = w.service === undefined;
    this.vakifButton.classList.toggle('on', this.vakif);
    this.vakifButton.textContent = `Vakıf olarak yaptır · ${this.founders} eşraf hazır`;
    this.vakifButton.disabled = this.founders === 0 && !this.vakif;
  }

  setLayer(layer: Layer | null): void {
    for (const [l, b] of this.layerButtons) b.classList.toggle('on', l === layer);
    this.layerToggle.classList.toggle('on', layer !== null);
    if (layer !== null) this.layerBar.hidden = false;
    this.layerToggle.classList.toggle('open', !this.layerBar.hidden);
  }

  /** Shows a tile. A pinned panel stays until closed and offers the field actions. */
  showInfo(info: TileInfo | null, pinned = false): void {
    if (info === null) {
      this.info.hidden = true;
      return;
    }
    const rows: string[] = [`<dt>Arazi</dt><dd>${info.land}</dd>`];
    if (info.residents > 0) rows.push(`<dt>Hane</dt><dd>${info.residents} kişi</dd>`);
    const f = info.field;
    if (f !== null && f.kind === 'mera') {
      rows.push(`<dt>Durum</dt><dd>${STAGE_NAMES[f.stage]}</dd>`);
      rows.push(`<dt>Büyüklük</dt><dd>${f.tiles} karo · ${f.sheep} koyun</dd>`);
      rows.push(`<dt>Çoban</dt><dd>${f.workers}</dd>`);
      rows.push(`<dt>Kırkımda</dt><dd>${fmt(f.expected)} batman yün</dd>`);
      if (f.lastYield > 0) rows.push(`<dt>Son kırkım</dt><dd>${fmt(f.lastYield)} batman</dd>`);
      if (!f.roadAccess) rows.push(`<dt></dt><dd class="bad">Yola bağlı değil: çoban gitmiyor</dd>`);
    } else if (f !== null) {
      rows.push(`<dt>Durum</dt><dd>${STAGE_NAMES[f.stage]}</dd>`);
      rows.push(`<dt>Büyüklük</dt><dd>${f.tiles} karo</dd>`);
      rows.push(`<dt>Toprak gücü</dt><dd>%${Math.round(f.soil * 100)}</dd>`);
      rows.push(`<dt>İşçi</dt><dd>${f.workers}</dd>`);
      if (f.stage === 'ekili') rows.push(`<dt>Beklenen</dt><dd>${fmt(f.expected)} kile</dd>`);
      if (f.lastYield > 0) rows.push(`<dt>Son hasat</dt><dd>${fmt(f.lastYield)} kile</dd>`);
      if (!f.roadAccess) rows.push(`<dt></dt><dd class="bad">Yola bağlı değil: işlenemiyor</dd>`);
    }
    const hs = info.house;
    if (hs !== null) {
      const names = info.services.map((sv) => SERVICE_NAMES[sv]);
      rows.push(
        `<dt>Hizmet</dt><dd>${names.length > 0 ? names.join(', ') : '<span class="bad">yok</span>'}</dd>`,
      );
      if (hs.supported < hs.level) {
        rows.push(`<dt></dt><dd class="bad">Küçülecek: ${hs.missing.join(', ')} yok</dd>`);
      } else if (hs.supported > hs.level) {
        rows.push(`<dt></dt><dd class="good">${LEVEL_NAMES[hs.level + 1]} olabilir</dd>`);
      } else if (hs.level < 3 && hs.missing.length > 0) {
        rows.push(`<dt>${LEVEL_NAMES[hs.level + 1]}</dt><dd>için ${hs.missing.join(', ')} gerekir</dd>`);
      }
    }
    const b = info.building;
    if (b !== null) {
      const bad = b.status !== 'calisiyor';
      if (b.kind !== 'arasta') {
        rows.push(`<dt>Durum</dt><dd class="${bad ? 'bad' : ''}">${STATUS_NAMES[b.status]}</dd>`);
      } else if (b.status === 'yolsuz') {
        rows.push(`<dt>Durum</dt><dd class="bad">${STATUS_NAMES.yolsuz}</dd>`);
      }
      if (b.jobs > 0) rows.push(`<dt>İşçi</dt><dd>${b.workers} / ${b.jobs}</dd>`);
      if (b.service !== null)
        rows.push(`<dt>Hizmet</dt><dd>${SERVICE_NAMES[b.service]} · ${b.radius} karo</dd>`);
      rows.push(
        b.vakif !== null
          ? `<dt>Vakıf</dt><dd>${b.vakif} vakfı · bakımı vakıftan</dd>`
          : `<dt>Bakım</dt><dd>${fmt(b.upkeep)} dirhem/ay</dd>`,
      );
      if (b.inputs.length > 0) rows.push(`<dt>Girdi</dt><dd>${b.inputs.join(', ')}</dd>`);
      if (b.output !== null) rows.push(`<dt>Üretim</dt><dd>${outputText(b.output)}</dd>`);
      for (const shop of b.shops) {
        const detail =
          shop.trade === null
            ? '<span class="dim">Esnaf bekliyor</span>'
            : `${STATUS_NAMES[shop.status]}${shop.output !== null ? ` · ${outputText(shop.output)}` : ''}`;
        rows.push(`<dt>${shop.trade === null ? 'Boş' : shop.name}</dt><dd>${detail}</dd>`);
      }
    }
    if (info.ore !== null && b === null) rows.push(`<dt>Maden</dt><dd>Demir damarı: maden kurulabilir</dd>`);
    if (info.smoke) rows.push(`<dt>Duman</dt><dd class="bad">Evler kat çıkmaz</dd>`);
    if (info.fertility !== null && b === null) {
      const p = Math.round((f?.fertility ?? info.fertility) * 100);
      rows.push(`<dt>Verim</dt><dd><span class="meter"><i style="width:${p}%"></i></span>%${p}</dd>`);
    }
    this.info.innerHTML = `<h3>${info.feature}</h3><dl>${rows.join('')}</dl>`;
    if (pinned) {
      const close = el('button', 'close btn', '×');
      close.title = 'Kapat (Esc)';
      close.addEventListener('click', () => this.cb.onCloseInfo());
      this.info.prepend(close);
      if (f !== null && f.kind === 'tarla') {
        const plans: Array<[FieldPlan, string]> = [
          ['bugday', 'Buğday'],
          ['arpa', 'Arpa'],
          ['nadas', 'Nadas'],
        ];
        const bar = el('div', 'plan');
        bar.appendChild(el('span', 'label', 'Gelecek ekim:'));
        for (const [plan, label] of plans) {
          const btn = el('button', `btn${plan === f.plan ? ' on' : ''}`, label);
          btn.addEventListener('click', () => this.cb.onFieldPlan(f.id, plan));
          bar.appendChild(btn);
        }
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
