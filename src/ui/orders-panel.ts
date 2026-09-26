import type { FormationKind, UnitKind } from '../sim/balance';

/** The chosen companies as the orders panel shows them. */
export interface OrdersView {
  /** Companies chosen, and the men in them. */
  companies: number;
  men: number;
  /** Of those: out in the field, on the march, and still at drill. */
  out: number;
  moving: number;
  drilling: number;
  /** Companies in the whole army. */
  total: number;
  kinds: Array<{ kind: UnitKind; name: string; units: number; men: number }>;
  /** The formation all the chosen companies in the field share, if they share one. */
  formation: FormationKind | null;
  formations: Array<{ kind: FormationKind; name: string; hint: string }>;
  /** Touch screen: the hints speak of taps. */
  touch: boolean;
}

/** An order from the panel's buttons. */
export type ArmyCommand =
  | { kind: 'home' }
  | { kind: 'halt' }
  | { kind: 'turn'; by: number }
  | { kind: 'formation'; formation: FormationKind }
  | { kind: 'selectAll' }
  | { kind: 'selectKind'; unit: UnitKind }
  | { kind: 'clear' };

/** A company's flag on the map, where the camera sees it this frame. */
export interface CompanyPlace {
  id: number;
  x: number;
  y: number;
  kind: UnitKind;
  label: string;
  title: string;
  selected: boolean;
  moving: boolean;
}

export interface OrdersCallbacks {
  onCommand(cmd: ArmyCommand): void;
  /** A company's flag was clicked; `add` keeps the others chosen. */
  onPick(id: number, add: boolean): void;
}

/** The first letters of each kind, on its flag. */
const SHORT: Record<UnitKind, string> = { mizrakci: 'Mz', okcu: 'Ok', atli_okcu: 'Ao', gulam: 'Gu' };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls !== '') e.className = cls;
  if (html !== '') e.innerHTML = html;
  return e;
}

const fmt = (n: number): string => Math.round(n).toLocaleString('tr-TR');

/**
 * Commanding the army: the panel of the chosen companies and their orders, the flags of
 * the companies out on the map, and the box dragged to choose several at once.
 */
export class OrdersPanel {
  private readonly panel: HTMLElement;
  private readonly box: HTMLElement;
  private readonly layer: HTMLElement;
  private readonly flags = new Map<number, HTMLButtonElement>();
  private shown = '';

  constructor(
    ui: HTMLElement,
    private readonly cb: OrdersCallbacks,
  ) {
    this.layer = el('div', 'companies');
    // Under the building badges' layer's panels, over the map.
    ui.prepend(this.layer);
    this.panel = el('div', 'orders panel');
    this.panel.hidden = true;
    ui.appendChild(this.panel);
    this.box = el('div', 'selbox');
    this.box.hidden = true;
    ui.appendChild(this.box);
  }

  /** Shows the chosen companies and their orders, or hides the panel. */
  show(v: OrdersView | null): void {
    const key = JSON.stringify(v);
    if (key === this.shown) return;
    this.shown = key;
    this.panel.hidden = v === null;
    if (v === null) return;
    const p = this.panel;
    p.innerHTML = '';
    p.appendChild(el('h3', '', 'Ordu komutası'));
    if (v.total === 0) {
      p.appendChild(el('div', 'dim', 'Ordu yok: önce kışla kur, bölük topla.'));
      return;
    }
    const head =
      v.companies === 0
        ? 'Seçili bölük yok'
        : `<b>${fmt(v.companies)} bölük</b> · ${fmt(v.men)} er` +
          (v.out > 0 ? ` · ${fmt(v.out)} sahada` : '') +
          (v.moving > 0 ? ` · ${fmt(v.moving)} yürüyüşte` : '');
    p.appendChild(el('div', 'head', head));
    const kinds = el('div', 'kinds');
    for (const k of v.kinds) {
      const b = el(
        'button',
        'btn kind',
        `<b>${k.name}</b><small>${fmt(k.units)} bölük · ${fmt(k.men)} er</small>`,
      );
      b.title = 'Yalnız bu türü seç';
      b.addEventListener('click', () => this.cb.onCommand({ kind: 'selectKind', unit: k.kind }));
      kinds.appendChild(b);
    }
    p.appendChild(kinds);
    if (v.drilling > 0) {
      p.appendChild(el('small', 'bad', `${fmt(v.drilling)} bölük talimde: kışladan çıkamaz`));
    }
    if (v.companies > 0) {
      const orders = el('div', 'buttons');
      const add = (label: string, title: string, cmd: ArmyCommand, disabled = false): void => {
        const b = el('button', 'btn', label);
        b.title = title;
        b.disabled = disabled;
        b.addEventListener('click', () => this.cb.onCommand(cmd));
        orders.appendChild(b);
      };
      add('⏹ Dur', 'Olduğu yerde dursun (H)', { kind: 'halt' }, v.moving === 0);
      add('⌂ Kışlaya dön', 'Kışlaya geri yürüsün (K)', { kind: 'home' }, v.out === 0);
      add('⟲', 'Sola 45° dönsün', { kind: 'turn', by: Math.PI / 4 }, v.out === 0);
      add('⟳', 'Sağa 45° dönsün', { kind: 'turn', by: -Math.PI / 4 }, v.out === 0);
      p.appendChild(orders);
      const forms = el('div', 'buttons forms');
      for (const f of v.formations) {
        const b = el('button', `btn${v.formation === f.kind ? ' on' : ''}`, f.name);
        b.title = `${f.hint}${v.out === 0 ? ' (sahadaki bölüklere)' : ''}`;
        b.disabled = v.out === 0;
        b.addEventListener('click', () => this.cb.onCommand({ kind: 'formation', formation: f.kind }));
        forms.appendChild(b);
      }
      p.appendChild(forms);
    }
    const pick = el('div', 'buttons');
    const all = el('button', 'btn', 'Hepsini seç');
    all.title = 'Bütün bölükleri seç (Ctrl+A)';
    all.addEventListener('click', () => this.cb.onCommand({ kind: 'selectAll' }));
    pick.appendChild(all);
    if (v.companies > 0) {
      const none = el('button', 'btn', 'Seçimi bırak');
      none.title = 'Esc';
      none.addEventListener('click', () => this.cb.onCommand({ kind: 'clear' }));
      pick.appendChild(none);
    }
    p.appendChild(pick);
    p.appendChild(
      el(
        'small',
        'tips',
        v.touch
          ? 'Bölüğe dokun: seç · Boş yere dokun: oraya yürü'
          : 'Tıkla ya da sürükle: seç · Shift: ekle · Çift tık: aynı türü seç<br>Sağ tık: oraya yürü',
      ),
    );
  }

  /** The box being dragged, in CSS pixels of the page, or none. */
  setBox(r: { x0: number; y0: number; x1: number; y1: number } | null): void {
    this.box.hidden = r === null;
    if (r === null) return;
    const s = this.box.style;
    s.left = `${Math.min(r.x0, r.x1)}px`;
    s.top = `${Math.min(r.y0, r.y1)}px`;
    s.width = `${Math.abs(r.x1 - r.x0)}px`;
    s.height = `${Math.abs(r.y1 - r.y0)}px`;
  }

  /** Puts a flag over each company out on the map. */
  placeCompanies(places: CompanyPlace[], visible: boolean): void {
    this.layer.hidden = !visible;
    if (!visible) return;
    const seen = new Set<number>();
    for (const p of places) {
      seen.add(p.id);
      let f = this.flags.get(p.id);
      if (f === undefined) {
        f = el('button', 'company');
        const id = p.id;
        f.addEventListener('click', (e) => this.cb.onPick(id, e.shiftKey || e.ctrlKey || e.metaKey));
        this.flags.set(p.id, f);
        this.layer.appendChild(f);
      }
      const state = `${p.kind}|${p.label}|${p.selected}|${p.moving}`;
      if (f.dataset.state !== state) {
        f.dataset.state = state;
        f.className = `company ${p.kind}${p.selected ? ' on' : ''}${p.moving ? ' moving' : ''}`;
        f.innerHTML = `<b>${SHORT[p.kind]}</b>${p.label}`;
        f.title = p.title;
      }
      f.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`;
    }
    for (const [id, f] of this.flags) {
      if (seen.has(id)) continue;
      f.remove();
      this.flags.delete(id);
    }
  }
}
