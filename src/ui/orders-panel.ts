import type { EchelonLevel, FormationKind, UnitKind } from '../sim/balance';

/** One row of the chain of command: an echelon, or a tabur under its tugay. */
export interface EchelonRow {
  /** The echelon's id, or the tabur's. */
  id: number;
  level: EchelonLevel | 'tabur';
  name: string;
  /** The kind of all its taburs, or 'karma' when they are of several. */
  kind: UnitKind | 'karma';
  taburs: number;
  men: number;
  /** Of its taburs, how many are chosen. */
  chosen: number;
  /** Where it is, in a word or two, or nothing when it is all in the barracks. */
  state: string;
  children: EchelonRow[];
}

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
  /** The echelon the choice is exactly, by name, if it is one. */
  echelon: string | null;
  /** Whether the choice can widen to the echelon one up. */
  canClimb: boolean;
  /** New echelons the choice could be gathered into, and why not. */
  forms: Array<{ level: EchelonLevel; name: string; hint: string; problem: string | null }>;
  /** The ordus, each with its kolordus, tugays and taburs. */
  tree: EchelonRow[];
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
  | { kind: 'selectEchelon'; id: number; add: boolean }
  | { kind: 'selectTabur'; id: number; add: boolean }
  | { kind: 'climb' }
  | { kind: 'form'; level: EchelonLevel }
  | { kind: 'clear' };

/** What a flag stands for: a tabur, or an echelon. */
export interface FlagKey {
  echelon: boolean;
  id: number;
}

/** A flag on the map, over a tabur or an echelon, where the camera sees it this frame. */
export interface CompanyPlace {
  key: FlagKey;
  x: number;
  y: number;
  kind: UnitKind | 'karma';
  level: EchelonLevel | 'tabur';
  /** An echelon's number and letters ("3. Tug"); a tabur's flag shows its kind's. */
  short: string;
  label: string;
  title: string;
  /** Whether its taburs are chosen: none, some or all of them. */
  selected: 'none' | 'some' | 'all';
  moving: boolean;
}

export interface OrdersCallbacks {
  onCommand(cmd: ArmyCommand): void;
  /** A flag was clicked; `add` keeps the others chosen. */
  onPick(key: FlagKey, add: boolean): void;
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
 * Commanding the army: the panel of the chosen companies and their orders, the chain of
 * command to choose whole echelons from, the flags of the taburs (or their echelons) out
 * on the map, and the box dragged to choose several at once.
 */
export class OrdersPanel {
  private readonly panel: HTMLElement;
  private readonly box: HTMLElement;
  private readonly layer: HTMLElement;
  private readonly flags = new Map<string, HTMLButtonElement>();
  private shown = '';
  private last: OrdersView | null = null;
  /** Rows of the chain of command the player opened, or closed though partly chosen. */
  private readonly opened = new Set<string>();
  private readonly closed = new Set<string>();

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
    this.last = v;
    this.render();
  }

  private render(): void {
    const v = this.last;
    this.panel.hidden = v === null;
    if (v === null) return;
    const p = this.panel;
    const scroll = p.scrollTop;
    const treeScroll = p.querySelector('.tree')?.scrollTop ?? 0;
    p.innerHTML = '';
    p.appendChild(el('h3', '', 'Ordu komutası'));
    if (v.total === 0) {
      p.appendChild(el('div', 'dim', 'Ordu yok: önce kışla kur, tabur topla.'));
      return;
    }
    const head =
      v.companies === 0
        ? 'Seçili tabur yok'
        : (v.echelon !== null
            ? `<b>${v.echelon}</b> · ${fmt(v.companies)} tabur`
            : `<b>${fmt(v.companies)} tabur</b>`) +
          ` · ${fmt(v.men)} er` +
          (v.out > 0 ? ` · ${fmt(v.out)} sahada` : '') +
          (v.moving > 0 ? ` · ${fmt(v.moving)} yürüyüşte` : '');
    p.appendChild(el('div', 'head', head));
    const kinds = el('div', 'kinds');
    for (const k of v.kinds) {
      const b = el(
        'button',
        'btn kind',
        `<b>${k.name}</b><small>${fmt(k.units)} tabur · ${fmt(k.men)} er</small>`,
      );
      b.title = 'Yalnız bu türü seç';
      b.addEventListener('click', () => this.cb.onCommand({ kind: 'selectKind', unit: k.kind }));
      kinds.appendChild(b);
    }
    p.appendChild(kinds);
    if (v.drilling > 0) {
      p.appendChild(el('small', 'bad', `${fmt(v.drilling)} tabur talimde: kışladan çıkamaz`));
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
        b.title = `${f.hint}${v.out === 0 ? ' (sahadaki taburlara)' : ''}`;
        b.disabled = v.out === 0;
        b.addEventListener('click', () => this.cb.onCommand({ kind: 'formation', formation: f.kind }));
        forms.appendChild(b);
      }
      p.appendChild(forms);
    }
    const pick = el('div', 'buttons');
    const all = el('button', 'btn', 'Hepsini seç');
    all.title = 'Bütün taburları seç (Ctrl+A)';
    all.addEventListener('click', () => this.cb.onCommand({ kind: 'selectAll' }));
    pick.appendChild(all);
    if (v.companies > 0) {
      const upBtn = el('button', 'btn climb', '▲ Üst birlik');
      upBtn.title = 'Seçimi bir üst birliğe genişlet: taburdan tugaya, tugaydan kolorduya (U)';
      upBtn.disabled = !v.canClimb;
      upBtn.addEventListener('click', () => this.cb.onCommand({ kind: 'climb' }));
      pick.appendChild(upBtn);
      const none = el('button', 'btn', 'Seçimi bırak');
      none.title = 'Esc';
      none.addEventListener('click', () => this.cb.onCommand({ kind: 'clear' }));
      pick.appendChild(none);
    }
    p.appendChild(pick);

    // The chain of command: a click chooses an echelon's taburs, the arrow opens it.
    p.appendChild(el('div', 'sub', 'Birlikler'));
    const tree = el('div', 'tree');
    for (const row of v.tree) this.row(tree, row, 0);
    p.appendChild(tree);
    if (v.companies > 0) {
      const form = el('div', 'buttons form');
      form.appendChild(el('span', 'dim', 'Seçiliden kur:'));
      for (const f of v.forms) {
        const b = el('button', 'btn', f.name);
        b.title =
          f.problem ?? `Seçili taburlardan yeni bir ${f.name.toLocaleLowerCase('tr-TR')} kur: ${f.hint}`;
        b.disabled = f.problem !== null;
        b.addEventListener('click', () => this.cb.onCommand({ kind: 'form', level: f.level }));
        form.appendChild(b);
      }
      p.appendChild(form);
    }
    p.appendChild(
      el(
        'small',
        'tips',
        v.touch
          ? 'Tabura dokun: seç · Boş yere dokun: oraya yürü'
          : 'Tıkla ya da sürükle: seç · Shift: ekle · Çift tık: tugayını seç · U: üst birlik<br>Sağ tık: oraya yürü · Sağ tuşla sürükle: cepheyi çiz (hiza, genişlik ve yön)',
      ),
    );
    p.scrollTop = scroll;
    tree.scrollTop = treeScroll;
  }

  /** One row of the chain of command, and the rows under it if it is open. */
  private row(into: HTMLElement, r: EchelonRow, depth: number): void {
    const key = `${r.level}:${r.id}`;
    const some = r.chosen > 0 && r.chosen < r.taburs;
    const open = r.children.length > 0 && (this.opened.has(key) || (some && !this.closed.has(key)));
    const line = el('div', `row ${r.level} ${r.kind}${r.chosen === 0 ? '' : some ? ' some' : ' on'}`);
    line.style.paddingLeft = `${depth * 12}px`;
    const fold = el('button', 'fold', r.children.length === 0 ? '' : open ? '▾' : '▸');
    fold.disabled = r.children.length === 0;
    fold.title = open ? 'Kapat' : 'Aç';
    fold.addEventListener('click', () => {
      if (open) {
        this.opened.delete(key);
        this.closed.add(key);
      } else {
        this.closed.delete(key);
        this.opened.add(key);
      }
      this.render();
    });
    const what = r.level === 'tabur' ? `${fmt(r.men)} er` : `${fmt(r.taburs)} tabur · ${fmt(r.men)} er`;
    const pick = el(
      'button',
      'pick',
      `<i class="swatch"></i><b>${r.name}</b><small>${what}${r.state !== '' ? ` · ${r.state}` : ''}</small>`,
    );
    pick.title =
      r.level === 'tabur'
        ? 'Bu taburu seç (Shift: ekle ya da çıkar)'
        : `${r.name} birliğinin bütün taburlarını seç (Shift: ekle ya da çıkar)`;
    pick.addEventListener('click', (e) => {
      const add = e.shiftKey || e.ctrlKey || e.metaKey;
      this.cb.onCommand(
        r.level === 'tabur'
          ? { kind: 'selectTabur', id: r.id, add }
          : { kind: 'selectEchelon', id: r.id, add },
      );
    });
    line.append(fold, pick);
    into.appendChild(line);
    if (open) for (const c of r.children) this.row(into, c, depth + 1);
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

  /** Puts a flag over each tabur, or echelon, out on the map. */
  placeCompanies(places: CompanyPlace[], visible: boolean): void {
    this.layer.hidden = !visible;
    if (!visible) return;
    const seen = new Set<string>();
    for (const p of places) {
      const id = `${p.key.echelon ? 'e' : 't'}${p.key.id}`;
      seen.add(id);
      let f = this.flags.get(id);
      if (f === undefined) {
        f = el('button', 'company');
        const key = p.key;
        f.addEventListener('click', (e) => this.cb.onPick(key, e.shiftKey || e.ctrlKey || e.metaKey));
        this.flags.set(id, f);
        this.layer.appendChild(f);
      }
      const state = `${p.kind}|${p.short}|${p.label}|${p.selected}|${p.moving}|${p.title}`;
      if (f.dataset.state !== state) {
        f.dataset.state = state;
        f.className =
          `company ${p.kind} ${p.level}` +
          (p.selected === 'all' ? ' on' : p.selected === 'some' ? ' some' : '') +
          (p.moving ? ' moving' : '');
        const short = p.kind === 'karma' || p.level !== 'tabur' ? p.short : SHORT[p.kind];
        f.innerHTML = `<b>${short}</b>${p.label}`;
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
