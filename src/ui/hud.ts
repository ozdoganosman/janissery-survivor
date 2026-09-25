import type { TileInfo } from '../sim/inspect';
import type { Speed } from '../sim/calendar';

export type Tool = 'incele' | 'yol' | 'yik';

export interface HudCallbacks {
  onTool(tool: Tool): void;
  onSpeed(speed: Speed): void;
  onFertility(visible: boolean): void;
}

const ICONS = {
  incele: '<circle cx="10" cy="10" r="6"/><path d="M14.5 14.5 20 20"/>',
  yol: '<path d="M8 21 10.5 3M16 21 13.5 3M12 18v-2M12 12v-2M12 6V5"/>',
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

/** The manuscript-style frame and every on-screen control. Plain DOM over the canvas. */
export class Hud {
  private readonly date: HTMLElement;
  private readonly amount: HTMLElement;
  private readonly info: HTMLElement;
  private readonly tip: HTMLElement;
  private readonly toolButtons = new Map<Tool, HTMLButtonElement>();
  private readonly speedButtons: HTMLButtonElement[] = [];
  private readonly fertilityButton: HTMLButtonElement;

  constructor(root: HTMLElement, title: string, cb: HudCallbacks) {
    root.appendChild(el('div', 'frame'));
    const ui = el('div', 'ui');
    root.appendChild(ui);

    const cartouche = el('div', 'cartouche panel');
    cartouche.appendChild(el('div', 'title', title));
    this.date = el('div', 'date');
    cartouche.appendChild(this.date);
    ui.appendChild(cartouche);

    const treasury = el('div', 'treasury panel', '<span>Hazine</span>');
    this.amount = el('span', 'amount');
    treasury.appendChild(this.amount);
    treasury.appendChild(el('span', '', 'dirhem'));
    ui.appendChild(treasury);

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

    const toolbar = el('div', 'toolbar panel');
    const tools: Array<[Tool, string, string, string]> = [
      ['incele', 'İncele', ICONS.incele, 'Esc'],
      ['yol', 'Yol', ICONS.yol, 'R'],
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

    ui.appendChild(el('div', 'hint', 'Sürükle: kaydır · Sağ tık: döndür<br>Tekerlek: yakınlaş · Q/E, WASD'));

    this.tip = el('div', 'tip panel');
    this.tip.hidden = true;
    root.appendChild(this.tip);
  }

  setDate(text: string): void {
    this.date.textContent = text;
  }

  setTreasury(amount: number): void {
    this.amount.textContent = Math.round(amount).toLocaleString('tr-TR');
  }

  setSpeed(speed: Speed): void {
    this.speedButtons.forEach((b, s) => b.classList.toggle('on', s === speed));
  }

  setTool(tool: Tool): void {
    for (const [t, b] of this.toolButtons) b.classList.toggle('on', t === tool);
  }

  setFertility(on: boolean): void {
    this.fertilityButton.classList.toggle('on', on);
  }

  showInfo(info: TileInfo | null): void {
    if (info === null) {
      this.info.hidden = true;
      return;
    }
    const rows: string[] = [`<dt>Arazi</dt><dd>${info.land}</dd>`];
    if (info.fertility !== null) {
      const pct = Math.round(info.fertility * 100);
      rows.push(`<dt>Verim</dt><dd><span class="meter"><i style="width:${pct}%"></i></span>%${pct}</dd>`);
    }
    this.info.innerHTML = `<h3>${info.feature}</h3><dl>${rows.join('')}</dl>`;
    this.info.hidden = false;
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
