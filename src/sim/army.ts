import { UNIT_KINDS, type UnitDef, type UnitKind } from './balance';
import type { Building } from './buildings';
import { DAYS_PER_MONTH } from './calendar';
import type { CityState } from './city';
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
}

export interface Army {
  units: Unit[];
  nextId: number;
}

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
  if (men + def.men > room) return block('room', `Kışla dolu (${men}/${room})`);
  const levy = levyLimit(city);
  if (men + def.men > levy) return block('levy', `Halk yetmiyor: en çok ${levy} asker`);
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
  const unit: Unit = { id: city.army.nextId++, kind, men: def.men, drill: { days, daysLeft: days } };
  city.army.units.push(unit);
  city.revision.army++;
  return unit;
}

/** Sends a company home: the men go back to their households. False when there is none. */
export function disband(city: CityState, id: number): boolean {
  const k = city.army.units.findIndex((u) => u.id === id);
  if (k < 0) return false;
  const [u] = city.army.units.splice(k, 1);
  city.population += u.men;
  city.revision.army++;
  notify(city, `${city.balance.army.units[u.kind].name} bölüğü terhis edildi; ${u.men} kişi evine döndü.`);
  return true;
}

/** With the barracks gone, every company goes home. */
export function disbandAll(city: CityState): void {
  if (city.army.units.length === 0) return;
  const men = armyMen(city);
  city.population += men;
  city.army.units = [];
  city.revision.army++;
  notify(city, `Kışla yıkıldı; ${men} asker evine döndü.`, 'bad');
}

/** A day of drill for every company still at it. */
export function armyDay(city: CityState): void {
  for (const u of city.army.units) {
    const d = u.drill;
    if (d === null) continue;
    d.daysLeft--;
    if (d.daysLeft > 0) continue;
    u.drill = null;
    city.revision.army++;
    notify(
      city,
      `${city.balance.army.units[u.kind].name} bölüğü talimini bitirdi (${u.men} er).`,
      'good',
      'works',
    );
  }
}

/** Men of each kind, for the ledger and the barracks panel. */
export function armyByKind(city: CityState): Record<UnitKind, { men: number; ready: number; units: number }> {
  const out = Object.fromEntries(UNIT_KINDS.map((k) => [k, { men: 0, ready: 0, units: 0 }])) as Record<
    UnitKind,
    { men: number; ready: number; units: number }
  >;
  for (const u of city.army.units) {
    const row = out[u.kind];
    row.men += u.men;
    row.units++;
    if (u.drill === null) row.ready += u.men;
  }
  return out;
}
