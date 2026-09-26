import type { Crop, FieldPlan } from '../sim/balance';
import type { Speed } from '../sim/calendar';
import type { CityStats, Notice } from '../sim/city';
import { STAGE_NAMES, type TileInfo } from '../sim/inspect';

export type Tool = 'incele' | 'yol' | 'konut' | 'tarla' | 'yik';

export interface HudCallbacks {
  onTool(tool: Tool): void;
  onSpeed(speed: Speed): void;
  onFertility(visible: boolean): void;
  onCrop(crop: Crop): void;
  onFieldPlan(fieldId: number, plan: FieldPlan): void;
  onCloseInfo(): void;
}

const ICONS = {
  incele: '<circle cx="10" cy="10" r="6"/><path d="M14.5 14.5 20 20"/>',
  yol: '<path d="M8 21 10.5 3M16 21 13.5 3M12 18v-2M12 12v-2M12 6V5"/>',
  konut: '<path d="M4 20V11l8-6 8 6v9z"/><path d="M10 20v-5h4v5"/><path d="M4 11h16"/>',
  tarla: '<path d="M3 19 9 7h6l6 12z"/><path d="M6 13h12M12 7v12"/>',
  yik: '<path d="M4 20 14 10M9 5c3-2 7-2 10 1-3-1-5 0-7 2M14 10l-2-2"/>',
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
  private readonly info: HTMLElement;
  private readonly tip: HTMLElement;
  private readonly notices: HTMLElement;
  private readonly cropBar: HTMLElement;
  private readonly toolButtons = new Map<Tool, HTMLButtonElement>();
  private readonly cropButtons = new Map<Crop, HTMLButtonElement>();
  private readonly speedButtons: HTMLButtonElement[] = [];
  private readonly fertilityButton: HTMLButtonElement;
  private statsKey = '';

  constructor(
    root: HTMLElement,
    title: string,
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
    const demand = el('div', 'row demand');
    demand.appendChild(el('span', 'label', 'Konut talebi'));
    const track = el('span', 'track');
    this.demandBar = el('i', '');
    track.appendChild(this.demandBar);
    demand.appendChild(track);
    this.demandHint = el('span', 'hint-line');
    ledger.append(demand, this.demandHint);
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
    const crops: Array<[Crop, string, string]> = [
      ['bugday', 'Buğday', 'Verimli toprakta bol ürün'],
      ['arpa', 'Arpa', 'Zayıf toprakta dayanıklı'],
    ];
    for (const [crop, label, hint] of crops) {
      const b = el('button', 'btn', `<b>${label}</b><small>${hint}</small>`);
      b.addEventListener('click', () => cb.onCrop(crop));
      this.cropButtons.set(crop, b);
      this.cropBar.appendChild(b);
    }
    ui.appendChild(this.cropBar);

    const toolbar = el('div', 'toolbar panel');
    const tools: Array<[Tool, string, string, string]> = [
      ['incele', 'İncele', ICONS.incele, 'Esc'],
      ['yol', 'Yol', ICONS.yol, 'R'],
      ['konut', 'Konut', ICONS.konut, 'K'],
      ['tarla', 'Tarla', ICONS.tarla, 'T'],
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
    this.fertilityButton = el('button', 'btn', `${svg(ICONS.bereket)}<span>Verimlilik</span>`);
    this.fertilityButton.title = 'Toprak verimliliği katmanı (F)';
    this.fertilityButton.dataset.layer = 'fertility';
    this.fertilityButton.addEventListener('click', () =>
      cb.onFertility(!this.fertilityButton.classList.contains('on')),
    );
    toolbar.appendChild(this.fertilityButton);
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

  setStats(treasury: number, granary: number, s: CityStats): void {
    const key = `${Math.round(treasury)}|${Math.round(granary)}|${Math.round(s.population)}|${Math.round(s.unemployed)}|${s.demand.toFixed(2)}|${s.freeLots}|${s.incomeLastMonth}`;
    if (key === this.statsKey) return;
    this.statsKey = key;
    this.amount.textContent = fmt(treasury);
    this.income.textContent = s.incomeLastMonth > 0 ? `+${fmt(s.incomeLastMonth)}/ay` : 'dirhem';
    this.population.textContent = fmt(s.population);
    const jobless = s.labor > 0 ? Math.round((s.unemployed / s.labor) * 100) : 0;
    this.jobless.textContent = `işsiz %${jobless}`;
    this.jobless.classList.toggle('bad', jobless > 12);
    this.granary.textContent = `${fmt(granary)} kile`;
    const months = Math.floor(s.foodMonths);
    this.months.textContent = granary <= 0 ? 'kıtlık' : months >= 24 ? 'bol' : `${months} ay`;
    this.months.classList.toggle('bad', s.foodMonths < 2);
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
  }

  setSpeed(speed: Speed): void {
    this.speedButtons.forEach((b, s) => b.classList.toggle('on', s === speed));
  }

  setTool(tool: Tool): void {
    for (const [t, b] of this.toolButtons) b.classList.toggle('on', t === tool);
    this.cropBar.hidden = tool !== 'tarla';
  }

  setCrop(crop: Crop): void {
    for (const [c, b] of this.cropButtons) b.classList.toggle('on', c === crop);
  }

  setFertility(on: boolean): void {
    this.fertilityButton.classList.toggle('on', on);
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
    if (f !== null) {
      rows.push(`<dt>Durum</dt><dd>${STAGE_NAMES[f.stage]}</dd>`);
      rows.push(`<dt>Büyüklük</dt><dd>${f.tiles} karo</dd>`);
      rows.push(`<dt>Toprak gücü</dt><dd>%${Math.round(f.soil * 100)}</dd>`);
      rows.push(`<dt>İşçi</dt><dd>${f.workers}</dd>`);
      if (f.stage === 'ekili') rows.push(`<dt>Beklenen</dt><dd>${fmt(f.expected)} kile</dd>`);
      if (f.lastYield > 0) rows.push(`<dt>Son hasat</dt><dd>${fmt(f.lastYield)} kile</dd>`);
      if (!f.roadAccess) rows.push(`<dt></dt><dd class="bad">Yola bağlı değil: işlenemiyor</dd>`);
    }
    if (info.fertility !== null) {
      const pct = Math.round((f?.fertility ?? info.fertility) * 100);
      rows.push(`<dt>Verim</dt><dd><span class="meter"><i style="width:${pct}%"></i></span>%${pct}</dd>`);
    }
    this.info.innerHTML = `<h3>${info.feature}</h3><dl>${rows.join('')}</dl>`;
    if (pinned) {
      const close = el('button', 'close btn', '×');
      close.title = 'Kapat (Esc)';
      close.addEventListener('click', () => this.cb.onCloseInfo());
      this.info.prepend(close);
      if (f !== null) {
        const plans: Array<[FieldPlan, string]> = [
          ['bugday', 'Buğday'],
          ['arpa', 'Arpa'],
          ['nadas', 'Nadas'],
        ];
        const bar = el('div', 'plan');
        bar.appendChild(el('span', 'label', 'Gelecek ekim:'));
        for (const [plan, label] of plans) {
          const b = el('button', `btn${plan === f.plan ? ' on' : ''}`, label);
          b.addEventListener('click', () => this.cb.onFieldPlan(f.id, plan));
          bar.appendChild(b);
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
