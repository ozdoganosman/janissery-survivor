import { UNIT_KINDS, type UnitDef, type UnitKind } from './balance';
import type { Building } from './buildings';
import { DAYS_PER_MONTH } from './calendar';
import type { CityState } from './city';
import type { FieldPost } from './field';
import { notify } from './notices';

/**
 * The city's soldiers. The barracks raises them a company (bölük) at a time from the
 * townspeople: each company costs akçe to arm, drills for some months, and is paid every
 * month after. The men live in the barracks, so the barracks' size bounds the army, and
 * the town can spare only so many of its people. Soldiers still eat from the city's bread.
 */

export interface Unit {
  id: number;
  kind: UnitKind;
  men: number;
  /** Drill still to do; null when the company is ready to march. */
  drill: { days: number; daysLeft: number } | null;
  /** Where it stands out in the field; null while it is in the barracks. */
  field: FieldPost | null;
}

export interface Army {
  units: Unit[];
  nextId: number;
}

const fmt = (n: number): string => Math.round(n).toLocaleString('tr-TR');

export function createArmy(): Army {
  return { units: [], nextId: 1 };
}

/** The city's barracks, if it has one. */
export function barracksOf(city: CityState): Building | undefined {
  for (const b of city.buildings.values()) if (b.kind === 'kisla') return b;
  return undefined;
}

/** Men the barracks can quarter at the level it stands at now. */
export function armyCapacity(city: CityState): number {
  const b = barracksOf(city);
  if (b === undefined || b.level === 0) return 0;
  return city.balance.buildings.kisla.levels[b.level - 1].capacity ?? 0;
}

/** Men under arms, drilling or ready. */
export function armyMen(city: CityState, readyOnly = false): number {
  let n = 0;
  for (const u of city.army.units) if (!readyOnly || u.drill === null) n += u.men;
  return n;
}

/** Most men the town can have under arms: a share of everyone, soldiers included. */
export function levyLimit(city: CityState): number {
  return Math.floor((city.population + armyMen(city)) * city.balance.army.levy);
}

/** Akçe a month for every company, drilling or ready. */
export function armyPay(city: CityState): number {
  let n = 0;
  for (const u of city.army.units) n += city.balance.army.units[u.kind].pay;
  return n;
}

export type RecruitBlocker = 'barracks' | 'level' | 'room' | 'levy' | 'akce';

export interface RecruitOffer {
  kind: UnitKind;
  def: UnitDef;
  problem?: string;
  blockedBy?: RecruitBlocker;
}

/** What raising a company of `kind` takes, and what stops it now. */
export function recruitOffer(city: CityState, kind: UnitKind): RecruitOffer {
  const def = city.balance.army.units[kind];
  const offer: RecruitOffer = { kind, def };
  const block = (by: RecruitBlocker, problem: string): RecruitOffer => ({ ...offer, blockedBy: by, problem });
  const b = barracksOf(city);
  if (b === undefined || b.level === 0) return block('barracks', 'Önce kışla kurulmalı');
  if (b.level < def.barracks) return block('level', `Kışla ${def.barracks}. seviye olunca`);
  const men = armyMen(city);
  const room = armyCapacity(city);
  if (men + def.men > room) return block('room', `Kışla dolu (${fmt(men)}/${fmt(room)})`);
  const levy = levyLimit(city);
  if (men + def.men > levy) return block('levy', `Halk yetmiyor: en çok ${fmt(levy)} asker`);
  if (city.treasury < def.cost) return block('akce', 'Akçe yetmiyor');
  return offer;
}

/** Raises a company: pays, takes the men from the town and sets them drilling. */
export function recruit(city: CityState, kind: UnitKind): Unit | null {
  const offer = recruitOffer(city, kind);
  if (offer.problem !== undefined) return null;
  const { def } = offer;
  city.treasury -= def.cost;
  city.population -= def.men;
  const days = def.months * DAYS_PER_MONTH;
  const unit: Unit = {
    id: city.army.nextId++,
    kind,
    men: def.men,
    drill: { days, daysLeft: days },
    field: null,
  };
  city.army.units.push(unit);
  city.revision.army++;
  return unit;
}

/**
 * How many companies of `kind` could be raised now, one after another, before the room,
 * the men or the akçe run out.
 */
export function recruitRoom(city: CityState, kind: UnitKind): number {
  if (recruitOffer(city, kind).problem !== undefined) return 0;
  const def = city.balance.army.units[kind];
  const men = armyMen(city);
  // Raising a company only moves men from the town to the army, so the levy stays put.
  const byRoom = Math.floor((armyCapacity(city) - men) / def.men);
  const byLevy = Math.floor((levyLimit(city) - men) / def.men);
  const byAkce = Math.floor(city.treasury / def.cost);
  return Math.max(0, Math.min(byRoom, byLevy, byAkce));
}

/** Raises up to `n` companies of `kind`; returns how many were raised. */
export function recruitMany(city: CityState, kind: UnitKind, n: number): number {
  let raised = 0;
  while (raised < n && recruit(city, kind) !== null) raised++;
  return raised;
}

/** Sends a company home: the men go back to their households. False when there is none. */
export function disband(city: CityState, id: number, why?: string): boolean {
  const k = city.army.units.findIndex((u) => u.id === id);
  if (k < 0) return false;
  const [u] = city.army.units.splice(k, 1);
  city.population += u.men;
  city.revision.army++;
  if (why !== undefined) notify(city, why, 'bad');
  else
    notify(city, `${city.balance.army.units[u.kind].name} bölüğü terhis edildi; ${u.men} kişi evine döndü.`);
  return true;
}

/** Sends home the company of `kind` raised last, the least drilled. False when there is none. */
export function disbandKind(city: CityState, kind: UnitKind): boolean {
  for (let k = city.army.units.length - 1; k >= 0; k--) {
    const u = city.army.units[k];
    if (u.kind === kind) return disband(city, u.id);
  }
  return false;
}

/** With the barracks gone, every company goes home. */
export function disbandAll(city: CityState): void {
  if (city.army.units.length === 0) return;
  const men = armyMen(city);
  city.population += men;
  city.army.units = [];
  city.revision.army++;
  notify(city, `Kışla yıkıldı; ${fmt(men)} asker evine döndü.`, 'bad');
}

/**
 * A day of drill for every company still at it. Companies of a kind raised together finish
 * together, and are announced together.
 */
export function armyDay(city: CityState): void {
  const done = new Map<UnitKind, { units: number; men: number }>();
  for (const u of city.army.units) {
    const d = u.drill;
    if (d === null) continue;
    d.daysLeft--;
    if (d.daysLeft > 0) continue;
    u.drill = null;
    const row = done.get(u.kind) ?? { units: 0, men: 0 };
    row.units++;
    row.men += u.men;
    done.set(u.kind, row);
  }
  if (done.size === 0) return;
  city.revision.army++;
  for (const [kind, { units, men }] of done) {
    const name = city.balance.army.units[kind].name;
    const who = units === 1 ? `${name} bölüğü` : `${units} ${name} bölüğü`;
    notify(city, `${who} talimini bitirdi (${fmt(men)} er).`, 'good', 'works');
  }
}

/** The companies of one kind, counted together. */
export interface KindTally {
  men: number;
  ready: number;
  units: number;
  /** Companies still at drill, and the days until the first of them is done. */
  drilling: number;
  soonest: number | null;
}

/** Men of each kind, for the ledger and the barracks panel. */
export function armyByKind(city: CityState): Record<UnitKind, KindTally> {
  const out = Object.fromEntries(
    UNIT_KINDS.map((k) => [k, { men: 0, ready: 0, units: 0, drilling: 0, soonest: null }]),
  ) as Record<UnitKind, KindTally>;
  for (const u of city.army.units) {
    const row = out[u.kind];
    row.men += u.men;
    row.units++;
    if (u.drill === null) {
      row.ready += u.men;
    } else {
      row.drilling++;
      row.soonest = Math.min(row.soonest ?? Infinity, u.drill.daysLeft);
    }
  }
  return out;
}
