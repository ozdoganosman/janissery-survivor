import { nextRandom } from '../core/rng';
import type { Balance, Good } from './balance';
import { dateOf, DAYS_PER_MONTH, formatDate } from './calendar';
import type { CityState } from './city';
import { DIRS4 } from './grid';
import { notify } from './notices';
import { coverage } from './services';

/**
 * What happens to the city that nobody planned: fires, plague, hunger, earthquakes,
 * visitors, unrest, and the Mongols. Every event stops the clock and asks the governor
 * to choose; the choice and what came of it go into the chronicle.
 *
 * Everything draws from the city's own random stream, so a city lives the same history
 * given the same choices.
 */

export type EventKind =
  'yangin' | 'salgin' | 'kitlik' | 'deprem' | 'mevlana' | 'ahi' | 'kervan' | 'elci' | 'kosedag';

export interface EventChoice {
  id: string;
  label: string;
  /** What the choice will do, in a few words. */
  hint: string;
  /** Dirhems it takes; the choice cannot be made without them. */
  cost: number;
  /** False when the choice makes no sense now, such as selling from an empty depot. */
  available?: boolean;
}

export interface CityEvent {
  kind: EventKind;
  title: string;
  text: string;
  choices: EventChoice[];
  day: number;
  /** Tiles the event is about: the first house on fire, the houses an earthquake cracked. */
  tiles: number[];
}

export interface ChronicleEntry {
  day: number;
  title: string;
  /** What the governor chose and how it turned out. */
  outcome: string;
}

export interface Plague {
  daysLeft: number;
  severity: number;
  quarantine: boolean;
}

/** A passing effect: a larger tribute for a year, a lift in the city's spirits, a penalty. */
export interface Modifier {
  kind: 'tribute' | 'demand' | 'prosperity';
  amount: number;
  untilDay: number;
}

export type KosedagOutcome = 'bekliyor' | 'teslim' | 'direndi' | 'yagma';

export interface Defense {
  /** Condition of the walls, 0..1. */
  walls: number;
  /** How close the Mongol storm is, 0..1. */
  threat: number;
  /** Share of the month's income the Ilkhans take, from `ilkhanFrom` on. */
  ilkhanShare: number;
  ilkhanFrom: number;
  kosedag: KosedagOutcome;
}

/** Everything the event system keeps in the city state. */
export interface EventState {
  pendingEvent: CityEvent | null;
  chronicle: ChronicleEntry[];
  cooldown: Partial<Record<EventKind, number>>;
  /** Days each tile has left to burn, and days until its ashes are cleared. */
  fire: Uint8Array;
  ash: Uint16Array;
  /** The fire now burning: houses lost so far and how fast it spreads. */
  blaze: { active: boolean; burned: number; factor: number };
  plague: Plague | null;
  modifiers: Modifier[];
  defense: Defense;
  flags: { mevlana: boolean; mevlanaHonoured: boolean };
  /** Months in a row of heavy tax, and of low prosperity. */
  grievance: { heavyTax: number; lowProsperity: number };
}

export function initialEvents(tiles: number, balance: Balance): EventState {
  const d = balance.defense;
  return {
    pendingEvent: null,
    chronicle: [],
    cooldown: {},
    fire: new Uint8Array(tiles),
    ash: new Uint16Array(tiles),
    blaze: { active: false, burned: 0, factor: 1 },
    plague: null,
    modifiers: [],
    defense: { walls: d.startWalls, threat: 0, ilkhanShare: 0, ilkhanFrom: 0, kosedag: 'bekliyor' },
    flags: { mevlana: false, mevlanaHonoured: false },
    grievance: { heavyTax: 0, lowProsperity: 0 },
  };
}

// ------------------------------------------------------------------ modifiers

export function modifierSum(city: CityState, kind: Modifier['kind']): number {
  let sum = 0;
  for (const m of city.events.modifiers)
    if (m.kind === kind && m.untilDay > city.calendar.day) sum += m.amount;
  if (kind === 'demand' && city.events.flags.mevlanaHonoured) sum += city.balance.events.mevlana.demandBonus;
  if (kind === 'prosperity' && city.events.flags.mevlanaHonoured)
    sum += city.balance.events.mevlana.prosperityBonus;
  if (kind === 'demand' && city.events.plague !== null) sum -= city.balance.events.salgin.demandPenalty;
  return sum;
}

function addModifier(city: CityState, kind: Modifier['kind'], amount: number, days: number): void {
  city.events.modifiers = city.events.modifiers.filter((m) => m.untilDay > city.calendar.day);
  city.events.modifiers.push({ kind, amount, untilDay: city.calendar.day + days });
}

/** Share of the month's income the Ilkhans take now. */
export function ilkhanShare(city: CityState): number {
  const d = city.events.defense;
  return city.calendar.day >= d.ilkhanFrom ? d.ilkhanShare : 0;
}

// ------------------------------------------------------------------ defence

/** Soldiers the city can raise: a share of its people. */
export function maxGarrison(city: CityState): number {
  const d = city.balance.defense;
  return Math.floor((city.stats.population * d.maxGarrisonShare) / d.garrisonStep) * d.garrisonStep;
}

export function setGarrison(city: CityState, soldiers: number): void {
  const step = city.balance.defense.garrisonStep;
  const n = Math.round(soldiers / step) * step;
  city.policy.garrison = Math.max(0, Math.min(maxGarrison(city), n));
}

/** What mending the walls to full strength would cost now. */
export function wallRepairCost(city: CityState): number {
  return Math.ceil((1 - city.events.defense.walls) * city.balance.defense.repairCostFull);
}

export function repairWalls(city: CityState): boolean {
  const cost = wallRepairCost(city);
  if (cost <= 0 || cost > city.treasury) return false;
  city.treasury -= cost;
  city.events.defense.walls = 1;
  notify(city, 'Surlar onarıldı.', 'good');
  return true;
}

/** Soldiers needed to hold Konya against the Mongols at today's threat. */
export function soldiersNeeded(city: CityState): number {
  const d = city.balance.defense;
  return Math.round(d.requiredBase + d.requiredPerThreat * city.events.defense.threat);
}

/** How well the city would stand a siege, 0..1: walls times manning. */
export function defenceStrength(city: CityState): number {
  const manned = Math.min(1, city.policy.garrison / Math.max(1, soldiersNeeded(city)));
  return city.events.defense.walls * manned;
}

/** The slow changes of every day: walls weather, the Mongol threat gathers. */
function defenceDay(city: CityState): void {
  const d = city.balance.defense;
  const def = city.events.defense;
  def.walls = Math.max(0, def.walls - d.wallDecayPerYear / (DAYS_PER_MONTH * 12));
  if (dateOf(city.calendar).year >= d.threatFromYear && def.kosedag === 'bekliyor') {
    def.threat = Math.min(1, def.threat + d.threatPerYear / (DAYS_PER_MONTH * 12));
  }
}

// ------------------------------------------------------------------ the daily round

/**
 * The events' part of a day: fires burn, plague takes its toll, walls weather, and, if
 * nothing is waiting for the governor already, perhaps something new happens.
 */
export function eventsDay(city: CityState): void {
  fireDay(city);
  plagueDay(city);
  defenceDay(city);
  clearAshes(city);
  if (city.events.pendingEvent === null) rollEvents(city);
}

/** Monthly bookkeeping of grievances, for the ahis. */
export function eventsMonth(city: CityState): void {
  const g = city.events.grievance;
  g.heavyTax = city.policy.tax === 'agir' ? g.heavyTax + 1 : 0;
  const ev = city.balance.events;
  g.lowProsperity = city.stats.prosperity < ev.ahi.lowProsperity ? g.lowProsperity + 1 : 0;
}

function ready(city: CityState, kind: EventKind): boolean {
  return (city.events.cooldown[kind] ?? 0) <= city.calendar.day;
}

function chance(city: CityState, p: number): boolean {
  return nextRandom(city) < p;
}

function rollEvents(city: CityState): void {
  const ev = city.balance.events;
  const date = dateOf(city.calendar);
  const s = city.stats;
  // The storm breaks on its date whatever else happens.
  const k = ev.kosedag;
  if (
    city.events.defense.kosedag === 'bekliyor' &&
    (date.year > k.year || (date.year === k.year && date.month >= k.month))
  ) {
    open(city, kosedagEvent(city));
    return;
  }
  if (!ev.enabled || city.calendar.day < city.startDay + ev.graceDays) return;

  if (ready(city, 'kitlik') && s.foodMonths < ev.kitlik.belowMonths && s.population > 0) {
    open(city, famineEvent(city));
    return;
  }
  const summer = date.month >= 4 && date.month <= 7;
  const housesShare = Math.min(2, s.households / 500);
  if (ready(city, 'yangin') && !city.events.blaze.active) {
    const p = ev.yangin.chancePerDay * (summer ? ev.yangin.summerFactor : 1) * housesShare;
    if (chance(city, p)) {
      const tile = ignitionTile(city);
      if (tile >= 0) {
        open(city, fireEvent(city, tile));
        return;
      }
    }
  }
  if (ready(city, 'salgin') && city.events.plague === null) {
    const cov = coverage(city);
    let cared = 0;
    let houses = 0;
    for (let i = 0; i < city.house.length; i++) {
      if (city.house[i] === 0) continue;
      houses++;
      if (cov.saglik[i] === 1) cared++;
    }
    const crowd = Math.min(2, s.population / ev.salgin.crowdPop);
    const p = ev.salgin.chancePerDay * crowd * (1 - 0.6 * (houses > 0 ? cared / houses : 0));
    if (chance(city, p)) {
      open(city, plagueEvent(city));
      return;
    }
  }
  if (ready(city, 'deprem') && chance(city, ev.deprem.chancePerDay)) {
    open(city, quakeEvent(city));
    return;
  }
  if (
    !city.events.flags.mevlana &&
    date.year >= ev.mevlana.fromYear &&
    [...city.buildings.values()].some((b) => b.kind === 'medrese') &&
    chance(city, ev.mevlana.chancePerDay)
  ) {
    open(city, mevlanaEvent(city));
    return;
  }
  const g = city.events.grievance;
  const aggrieved = g.heavyTax >= ev.ahi.heavyTaxMonths || g.lowProsperity >= ev.ahi.lowMonths;
  const bazaars = [...city.buildings.values()].some((b) => b.kind === 'arasta');
  if (ready(city, 'ahi') && aggrieved && bazaars && chance(city, ev.ahi.chancePerDay)) {
    open(city, ahiEvent(city));
    return;
  }
  if (ready(city, 'elci') && date.year >= ev.elci.fromYear && city.events.defense.kosedag === 'bekliyor') {
    if (chance(city, ev.elci.chancePerDay)) {
      open(city, envoyEvent(city));
      return;
    }
  }
  if (ready(city, 'kervan') && chance(city, ev.kervan.chancePerDay)) {
    open(city, caravanEvent(city));
  }
}

function open(city: CityState, event: CityEvent): void {
  city.events.pendingEvent = event;
  notify(city, event.title, event.kind === 'mevlana' || event.kind === 'kervan' ? 'good' : 'bad');
}

/** Days before an event of each kind can come again. */
function cooldownOf(city: CityState, kind: EventKind): number | undefined {
  const ev = city.balance.events;
  const days: Partial<Record<EventKind, number>> = {
    yangin: ev.yangin.cooldownDays,
    salgin: ev.salgin.cooldownDays,
    kitlik: ev.kitlik.cooldownDays,
    deprem: ev.deprem.cooldownDays,
    ahi: ev.ahi.cooldownDays,
    kervan: ev.kervan.cooldownDays,
    elci: ev.elci.cooldownDays,
  };
  return days[kind];
}

/** The road tiles through the gate facing east, where the Mongols come from. */
export function eastGate(city: CityState): number[] {
  if (city.gates.length === 0) return [];
  return city.gates.reduce((best, g) => (Math.cos(g.angle) > Math.cos(best.angle) ? g : best)).tiles;
}

/** Starts an event of a kind at once, if it can happen now. For tests and the smoke test. */
export function triggerEvent(city: CityState, kind: EventKind): boolean {
  if (city.events.pendingEvent !== null) return false;
  let event: CityEvent | null = null;
  switch (kind) {
    case 'yangin': {
      const tile = ignitionTile(city);
      if (tile >= 0) event = fireEvent(city, tile);
      break;
    }
    case 'salgin':
      event = plagueEvent(city);
      break;
    case 'kitlik':
      event = famineEvent(city);
      break;
    case 'deprem':
      event = quakeEvent(city);
      break;
    case 'mevlana':
      event = mevlanaEvent(city);
      break;
    case 'ahi':
      event = ahiEvent(city);
      break;
    case 'kervan':
      event = caravanEvent(city);
      break;
    case 'elci':
      event = envoyEvent(city);
      break;
    case 'kosedag':
      event = kosedagEvent(city);
      break;
  }
  if (event === null) return false;
  open(city, event);
  return true;
}

/**
 * The governor's answer. Applies the choice, writes the chronicle and lets time run on.
 * Returns false, changing nothing, for an unknown or unaffordable choice.
 */
export function resolveEvent(city: CityState, choiceId: string): boolean {
  const event = city.events.pendingEvent;
  if (event === null) return false;
  const choice = event.choices.find((c) => c.id === choiceId);
  if (choice === undefined || choice.cost > city.treasury || choice.available === false) return false;
  city.treasury -= choice.cost;
  const outcome = apply(city, event, choice);
  city.events.pendingEvent = null;
  const cool = cooldownOf(city, event.kind);
  if (cool !== undefined) city.events.cooldown[event.kind] = city.calendar.day + cool;
  city.events.chronicle.push({ day: event.day, title: event.title, outcome });
  if (city.events.chronicle.length > 60) city.events.chronicle.shift();
  if (outcome !== choice.label) notify(city, outcome, 'info');
  return true;
}

function apply(city: CityState, event: CityEvent, choice: EventChoice): string {
  const ev = city.balance.events;
  const s = city.stats;
  switch (event.kind) {
    case 'yangin':
      if (choice.id === 'subasi') city.events.blaze.factor = ev.yangin.sendFactor;
      if (choice.id === 'yik') return `${choice.label}: ${firebreak(city)} ev yıkıldı, ateş kesildi.`;
      return choice.label;
    case 'salgin': {
      const p = city.events.plague;
      if (p === null) return choice.label;
      if (choice.id === 'karantina') {
        p.severity *= ev.salgin.quarantineFactor;
        p.quarantine = true;
      } else if (choice.id === 'hekim') {
        p.severity *= ev.salgin.physicianFactor;
      }
      return choice.label;
    }
    case 'kitlik': {
      const monthly = s.population * city.balance.food.perPersonPerMonth;
      if (choice.id === 'sultan') {
        const grain = Math.round(monthly * ev.kitlik.sultanMonths);
        city.granary += grain;
        addModifier(city, 'tribute', ev.kitlik.sultanTributeExtra, ev.kitlik.sultanDays);
        return `Sultan ${grain.toLocaleString('tr-TR')} kile zahire gönderdi; bir yıl sultan payı artacak.`;
      }
      if (choice.id === 'satin') {
        const want = monthly * ev.kitlik.buyMonths;
        const grain = Math.floor(Math.min(want, Math.max(0, city.treasury) / ev.kitlik.grainPrice));
        city.treasury -= grain * ev.kitlik.grainPrice;
        city.granary += grain;
        return `Eşraftan ${grain.toLocaleString('tr-TR')} kile zahire alındı.`;
      }
      return choice.label;
    }
    case 'deprem':
      if (choice.id === 'onar') {
        for (const i of event.tiles) city.house[i] = Math.min(3, city.house[i] + 1);
        city.revision.houses++;
        return `Yıkılan ${event.tiles.length} ev hazineden onarıldı.`;
      }
      return choice.label;
    case 'mevlana':
      city.events.flags.mevlana = true;
      if (choice.id === 'vakfet') {
        city.events.flags.mevlanaHonoured = true;
        return "Mevlânâ için bir medrese vakfedildi; Konya'nın ünü yayılıyor.";
      }
      addModifier(city, 'demand', ev.mevlana.demandBonus, ev.mevlana.listenDays);
      addModifier(city, 'prosperity', ev.mevlana.prosperityBonus, ev.mevlana.listenDays);
      return choice.label;
    case 'ahi':
      city.events.grievance = { heavyTax: 0, lowProsperity: 0 };
      if (choice.id === 'hafiflet') {
        city.policy.tax = 'hafif';
        return choice.label;
      }
      if (choice.id === 'bastir') {
        if (city.policy.garrison >= ev.ahi.garrisonNeeded) {
          addModifier(city, 'prosperity', -ev.ahi.prosperityPenalty, ev.ahi.penaltyDays);
          return 'Subaşı ahileri dağıttı; çarşıda küskünlük var.';
        }
        const closed = closeShops(city, ev.ahi.shopsClosed);
        return `Garnizon yetmedi: ahiler ${closed} dükkânı kapattı.`;
      }
      return choice.label;
    case 'kervan':
      if (choice.id === 'sat') {
        const [good, amount, value] = caravanOffer(city);
        if (good === null) return 'Kervana satacak mal bulunamadı.';
        city.goods[good] -= amount;
        city.flows.current.used[good] += amount;
        city.treasury += value;
        return `Kervana ${Math.round(amount).toLocaleString('tr-TR')} ${city.balance.goods[good].unit} ${city.balance.goods[good].name.toLocaleLowerCase('tr-TR')} ${Math.round(value).toLocaleString('tr-TR')} dirheme satıldı.`;
      }
      if (choice.id === 'ipek') {
        addModifier(city, 'prosperity', ev.kervan.silkBonus, ev.kervan.silkDays);
        return choice.label;
      }
      city.treasury += ev.kervan.toll;
      return `Kervandan ${ev.kervan.toll} dirhem gümrük alındı.`;
    case 'elci': {
      const d = city.events.defense;
      const delta =
        choice.id === 'hediye'
          ? ev.elci.giftThreat
          : choice.id === 'oyala'
            ? ev.elci.stallThreat
            : ev.elci.expelThreat;
      d.threat = Math.max(0, Math.min(1, d.threat + delta));
      if (choice.id === 'kov') addModifier(city, 'demand', 0.05, 180);
      return choice.label;
    }
    case 'kosedag':
      return kosedagOutcome(city, choice.id);
  }
}

// ------------------------------------------------------------------ events

function place(city: CityState, tile: number): string {
  const { grid, def } = city;
  const x = grid.centre(tile % grid.size) - def.tepe.x;
  const z = grid.centre(Math.floor(tile / grid.size)) - def.tepe.z;
  const inside = Math.hypot(x, z) < def.walls.radius;
  const side =
    Math.abs(x) > Math.abs(z) ? (x > 0 ? 'doğusunda' : 'batısında') : z > 0 ? 'güneyinde' : 'kuzeyinde';
  return `${inside ? 'Sur içinde' : 'Sur dışında'}, şehrin ${side}`;
}

function ignitionTile(city: CityState): number {
  const houses: number[] = [];
  for (let i = 0; i < city.house.length; i++)
    if (city.house[i] > 0 && city.events.fire[i] === 0) houses.push(i);
  if (houses.length === 0) return -1;
  // Fires start where houses crowd together, and less often under a subaşı's eye.
  const guard = coverage(city).asayis;
  for (let tries = 0; tries < 6; tries++) {
    const i = houses[Math.floor(nextRandom(city) * houses.length)];
    if (guard[i] === 1 && nextRandom(city) < 0.5) continue;
    return i;
  }
  return -1;
}

function fireEvent(city: CityState, tile: number): CityEvent {
  const ev = city.balance.events.yangin;
  city.events.fire[tile] = ev.burnDays;
  city.events.blaze = { active: true, burned: 0, factor: 1 };
  city.revision.fire++;
  return {
    kind: 'yangin',
    title: 'Yangın!',
    text: `${place(city, tile)} bir ev tutuştu. Ateş komşu evlere sıçrıyor; ahşap tavanlar birbirine yaslanmış.`,
    choices: [
      { id: 'subasi', label: 'Subaşının adamlarını gönder', hint: 'Ateş yavaşlar', cost: ev.sendCost },
      {
        id: 'yik',
        label: 'Çevredeki evleri yıkıp ateşi kes',
        hint: 'Ateş hemen durur, yakın evler gider',
        cost: 0,
      },
      { id: 'birak', label: 'Kendi hâline bırak', hint: 'Belki kendiliğinden söner', cost: 0 },
    ],
    day: city.calendar.day,
    tiles: [tile],
  };
}

function plagueEvent(city: CityState): CityEvent {
  const ev = city.balance.events.salgin;
  const days = ev.minDays + Math.floor(nextRandom(city) * (ev.maxDays - ev.minDays));
  city.events.plague = { daysLeft: days, severity: 1, quarantine: false };
  return {
    kind: 'salgin',
    title: 'Salgın!',
    text: 'Kervansaraydan inen yolcularla birlikte bir hastalık geldi. Mahallelerde ateşli hastalar var; hekimler telaşlı.',
    choices: [
      {
        id: 'karantina',
        label: 'Kapıları kapat, karantina',
        hint: 'Salgın yarılanır, çarşı durgunlaşır',
        cost: 0,
      },
      { id: 'hekim', label: 'Hekim ve ilaç gönder', hint: 'Salgın hafifler', cost: ev.physicianCost },
      { id: 'dua', label: 'Dua et, bekle', hint: 'Hiçbir şey yapılmaz', cost: 0 },
    ],
    day: city.calendar.day,
    tiles: [],
  };
}

function famineEvent(city: CityState): CityEvent {
  const ev = city.balance.events.kitlik;
  const monthly = city.stats.population * city.balance.food.perPersonPerMonth;
  const buy = Math.round(monthly * ev.buyMonths * ev.grainPrice);
  return {
    kind: 'kitlik',
    title: 'Kıtlık kapıda',
    text: `Ambarda ${Math.max(0, Math.floor(city.stats.foodMonths))} aylık zahire kaldı. Fırınlarda ekmek küçüldü, fiyatlar artıyor.`,
    choices: [
      { id: 'sultan', label: 'Sultandan zahire iste', hint: 'Bir yıl sultan payı artar', cost: 0 },
      {
        id: 'satin',
        label: 'Eşraftan zahire satın al',
        hint: `Üç aylık zahire, en çok ${buy.toLocaleString('tr-TR')} dirhem`,
        cost: 0,
      },
      {
        id: 'birak',
        label: 'Halk kendi başının çaresine baksın',
        hint: 'İmaret olmayan mahalleler göç eder',
        cost: 0,
      },
    ],
    day: city.calendar.day,
    tiles: [],
  };
}

function quakeEvent(city: CityState): CityEvent {
  const ev = city.balance.events.deprem;
  const houses: number[] = [];
  for (let i = 0; i < city.house.length; i++) if (city.house[i] > 0) houses.push(i);
  const hit: number[] = [];
  for (const i of houses) {
    if (nextRandom(city) < ev.houseShare) {
      city.house[i] -= 1;
      hit.push(i);
    }
  }
  city.events.defense.walls = Math.max(0, city.events.defense.walls - ev.wallDamage);
  city.revision.houses++;
  const cost = hit.length * ev.repairPerHouse;
  return {
    kind: 'deprem',
    title: 'Deprem!',
    text: `Yer sarsıldı. ${hit.length} ev hasar gördü, surlarda çatlaklar açıldı.`,
    choices: [
      { id: 'onar', label: 'Yıkılanları hazineden onar', hint: 'Evler eski hâline döner', cost },
      { id: 'birak', label: 'Halk kendisi onarsın', hint: 'Evler zamanla yeniden yükselir', cost: 0 },
    ],
    day: city.calendar.day,
    tiles: hit,
  };
}

function mevlanaEvent(city: CityState): CityEvent {
  const ev = city.balance.events.mevlana;
  return {
    kind: 'mevlana',
    title: "Mevlânâ'nın sohbetleri",
    text: "Belhli âlim Bahâeddin Veled'in oğlu Celâleddin medresede ders vermeye başladı. Sohbetlerini dinlemek için uzaklardan talebeler geliyor.",
    choices: [
      {
        id: 'vakfet',
        label: 'Ona bir medrese vakfet',
        hint: "Konya'nın ünü kalıcı olarak artar",
        cost: ev.honourCost,
      },
      { id: 'dinle', label: 'Sohbetleri halka aç', hint: 'Bir yıl talep ve refah artar', cost: 0 },
    ],
    day: city.calendar.day,
    tiles: [],
  };
}

function ahiEvent(city: CityState): CityEvent {
  const ev = city.balance.events.ahi;
  const why = city.events.grievance.heavyTax >= ev.heavyTaxMonths ? 'ağır vergiden' : 'darlıktan';
  return {
    kind: 'ahi',
    title: 'Ahiler huzursuz',
    text: `Ahi şeyhleri ${why} şikâyetçi. Çarşıda dükkânlar kepenk indirmeye başladı; esnaf kapının önünde toplanıyor.`,
    choices: [
      { id: 'hafiflet', label: 'Vergiyi hafiflet', hint: 'Vergi hafif olur', cost: 0 },
      { id: 'anlas', label: 'Şeyhlerle anlaş', hint: 'Hediye ve söz', cost: ev.dealCost },
      {
        id: 'bastir',
        label: 'Subaşıyı üstlerine gönder',
        hint: `En az ${ev.garrisonNeeded} asker gerekir`,
        cost: 0,
      },
    ],
    day: city.calendar.day,
    tiles: [],
  };
}

/** The good a caravan would take off the city's hands: the most valuable stock. */
function caravanOffer(city: CityState): [Good | null, number, number] {
  const ev = city.balance.events.kervan;
  let best: Good | null = null;
  let bestValue = 0;
  for (const g of ['kumas', 'iplik', 'demir', 'yun', 'un'] as const) {
    const value = city.goods[g] * city.balance.goods[g].price;
    if (value > bestValue) {
      best = g;
      bestValue = value;
    }
  }
  if (best === null) return [null, 0, 0];
  const amount = city.goods[best] * ev.sellShare;
  return [best, amount, amount * city.balance.goods[best].price * ev.priceFactor];
}

function caravanEvent(city: CityState): CityEvent {
  const ev = city.balance.events.kervan;
  const [good, , value] = caravanOffer(city);
  const from = nextRandom(city) < 0.5 ? 'Tebriz' : 'Antalya';
  const offer =
    good === null
      ? 'Depoda satacak malımız yok'
      : `Depodaki ${city.balance.goods[good].name.toLocaleLowerCase('tr-TR')} için ${Math.round(value).toLocaleString('tr-TR')} dirhem veriyorlar`;
  return {
    kind: 'kervan',
    title: 'Kervan geldi',
    text: `${from} yolundan yüklü bir kervan kapıya dayandı. ${offer}; ipek ve baharat da getirmişler.`,
    choices: [
      {
        id: 'sat',
        label: 'Malı sat',
        hint: good === null || value < 50 ? 'Depoda satacak mal yok' : 'Depodakinin yarısı',
        cost: 0,
        available: good !== null && value >= 50,
      },
      { id: 'ipek', label: 'İpek ve baharat al', hint: 'Altı ay refah artar', cost: ev.silkCost },
      { id: 'gumruk', label: 'Gümrüğü al, yoluna gitsin', hint: `${ev.toll} dirhem`, cost: 0 },
    ],
    day: city.calendar.day,
    tiles: [],
  };
}

function envoyEvent(city: CityState): CityEvent {
  const ev = city.balance.events.elci;
  return {
    kind: 'elci',
    title: 'Moğol elçileri',
    text: 'Doğudan, Moğol hanının elçileri geldi. Kürklü, atlı adamlar; sultana boyun eğmesini, şehrin de hediye göndermesini istiyorlar.',
    choices: [
      { id: 'hediye', label: 'Hediyelerle ağırla', hint: 'Moğol tehdidi azalır', cost: ev.giftCost },
      { id: 'oyala', label: 'Sultana haber ver, oyala', hint: 'Tehdit biraz artar', cost: 0 },
      { id: 'kov', label: 'Elçileri kovdur', hint: 'Halk sevinir, tehdit çok artar', cost: 0 },
    ],
    day: city.calendar.day,
    tiles: eastGate(city),
  };
}

function kosedagEvent(city: CityState): CityEvent {
  const need = soldiersNeeded(city);
  const strength = Math.round(defenceStrength(city) * 100);
  return {
    kind: 'kosedag',
    title: 'Kösedağ bozgunu',
    text:
      `Selçuklu ordusu Kösedağ'da Moğollara yenildi; sultan kaçtı. Baycu Noyan'ın ordusu Anadolu'ya giriyor. ` +
      `Surların direnme gücü %${strength}; tutmak için ${need} asker gerekir, garnizonda ${city.policy.garrison} var.`,
    choices: [
      {
        id: 'teslim',
        label: 'Anahtarları teslim et',
        hint: 'Şehir korunur, her ay İlhanlı vergisi',
        cost: 0,
      },
      { id: 'diren', label: 'Surlara güven, direnin', hint: `Başarı şansı %${strength}`, cost: 0 },
    ],
    day: city.calendar.day,
    tiles: eastGate(city),
  };
}

function kosedagOutcome(city: CityState, choice: string): string {
  const k = city.balance.events.kosedag;
  const d = city.events.defense;
  const year = DAYS_PER_MONTH * 12;
  if (choice === 'teslim') {
    d.kosedag = 'teslim';
    d.ilkhanShare = k.tributeShare;
    d.ilkhanFrom = city.calendar.day;
    return 'Konya teslim oldu. Şehir yağmadan kurtuldu; İlhanlılara vergi ödenecek.';
  }
  if (nextRandom(city) < defenceStrength(city)) {
    d.kosedag = 'direndi';
    d.ilkhanShare = k.laterShare;
    d.ilkhanFrom = city.calendar.day + k.graceYears * year;
    return `Surlar dayandı! Moğollar kuşatmayı kaldırdı; ${k.graceYears} yıl vergi yok.`;
  }
  d.kosedag = 'yagma';
  d.ilkhanShare = k.failTributeShare;
  d.ilkhanFrom = city.calendar.day;
  plunder(city);
  return 'Surlar düştü, şehir yağmalandı. Hazine ve depo yarı yarıya boşaldı; sur dibi yanıyor.';
}

function plunder(city: CityState): void {
  const k = city.balance.events.kosedag;
  if (city.treasury > 0) city.treasury *= 1 - k.plunderShare;
  city.granary *= 1 - k.plunderShare;
  for (const g of Object.keys(city.goods) as Good[]) city.goods[g] *= 1 - k.plunderShare;
  // Fires set by the raiders along the inside of the walls, beside the gates.
  const { grid, def } = city;
  const inner = def.walls.radius - 3;
  let lit = 0;
  for (const g of city.gates) {
    const gx = grid.tileOf(def.tepe.x + Math.cos(g.angle) * inner);
    const gz = grid.tileOf(def.tepe.z + Math.sin(g.angle) * inner);
    for (let dz = -k.burnRadius; dz <= k.burnRadius && lit < k.fires * city.gates.length; dz++) {
      for (let dx = -k.burnRadius; dx <= k.burnRadius; dx++) {
        if (!grid.inBounds(gx + dx, gz + dz)) continue;
        const i = grid.index(gx + dx, gz + dz);
        if (city.house[i] > 0 && nextRandom(city) < 0.3) {
          city.events.fire[i] = city.balance.events.yangin.burnDays;
          lit++;
        }
      }
    }
  }
  if (lit > 0) {
    city.events.blaze = { active: true, burned: 0, factor: 1 };
    city.revision.fire++;
  }
}

// ------------------------------------------------------------------ fire and plague

/**
 * A day of fire: every burning house may set its neighbours alight, less near water or a
 * subaşı; a house that has burned out falls to ashes.
 */
function fireDay(city: CityState): void {
  const e = city.events;
  if (!e.blaze.active) return;
  const ev = city.balance.events.yangin;
  const { grid } = city;
  const cov = coverage(city);
  const burning: number[] = [];
  for (let i = 0; i < e.fire.length; i++) if (e.fire[i] > 0) burning.push(i);
  for (const i of burning) {
    const x = i % grid.size;
    const z = Math.floor(i / grid.size);
    for (const [dx, dz] of DIRS4) {
      if (!grid.inBounds(x + dx, z + dz)) continue;
      const j = grid.index(x + dx, z + dz);
      if (city.house[j] === 0 || e.fire[j] > 0) continue;
      let p = ev.spread * e.blaze.factor;
      if (cov.su[j] === 1) p *= ev.waterFactor;
      if (cov.asayis[j] === 1) p *= ev.guardFactor;
      if (nextRandom(city) < p) e.fire[j] = ev.burnDays + 1;
    }
  }
  let changed = false;
  for (const i of burning) {
    e.fire[i]--;
    if (e.fire[i] === 0) {
      if (city.house[i] > 0) e.blaze.burned++;
      city.house[i] = 0;
      e.ash[i] = ev.ashDays;
      changed = true;
    }
  }
  city.revision.fire++;
  if (changed) city.revision.houses++;
  if (!e.fire.some((f) => f > 0)) {
    e.blaze.active = false;
    notify(city, `Yangın söndü: ${e.blaze.burned} ev yandı.`, e.blaze.burned > 5 ? 'bad' : 'info');
  }
}

/** Pulls down every house near the fire and puts it out: the old way to stop a blaze. */
function firebreak(city: CityState): number {
  const e = city.events;
  const { grid } = city;
  const r = city.balance.events.yangin.breakRadius;
  let pulled = 0;
  const burning: number[] = [];
  for (let i = 0; i < e.fire.length; i++) if (e.fire[i] > 0) burning.push(i);
  for (const i of burning) {
    const x = i % grid.size;
    const z = Math.floor(i / grid.size);
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (!grid.inBounds(x + dx, z + dz)) continue;
        const j = grid.index(x + dx, z + dz);
        if (city.house[j] > 0 && e.fire[j] === 0) {
          city.house[j] = 0;
          pulled++;
        }
      }
    }
    // What was burning burns out under the rubble.
    if (city.house[i] > 0) e.blaze.burned++;
    city.house[i] = 0;
    e.fire[i] = 0;
    e.ash[i] = city.balance.events.yangin.ashDays;
  }
  city.revision.houses++;
  city.revision.fire++;
  return pulled;
}

function clearAshes(city: CityState): void {
  const ash = city.events.ash;
  let cleared = false;
  for (let i = 0; i < ash.length; i++) {
    if (ash[i] === 0) continue;
    ash[i]--;
    if (ash[i] === 0) cleared = true;
  }
  if (cleared) city.revision.fire++;
}

/** A day of plague: households die or flee, fewer where a hospital or a bath looks after them. */
function plagueDay(city: CityState): void {
  const p = city.events.plague;
  if (p === null) return;
  const ev = city.balance.events.salgin;
  p.daysLeft--;
  if (p.daysLeft <= 0) {
    city.events.plague = null;
    notify(city, 'Salgın geçti.', 'good');
    return;
  }
  const houses: number[] = [];
  for (let i = 0; i < city.house.length; i++) if (city.house[i] > 0) houses.push(i);
  if (houses.length === 0) return;
  const rate = city.stats.households * ev.lossPerDay * p.severity;
  const whole = Math.floor(rate);
  const n = whole + (nextRandom(city) < rate - whole ? 1 : 0);
  const cov = coverage(city);
  let lost = 0;
  for (let k = 0; k < n; k++) {
    const i = houses[Math.floor(nextRandom(city) * houses.length)];
    const cared = cov.saglik[i] === 1 || cov.temizlik[i] === 1;
    if (cared && nextRandom(city) < ev.healthFactor) continue;
    if (city.house[i] > 0) {
      city.house[i]--;
      lost++;
    }
  }
  if (lost > 0) city.revision.houses++;
}

/** Closes a few of the bazaar's open shops. Returns how many closed. */
function closeShops(city: CityState, n: number): number {
  let closed = 0;
  for (const b of city.buildings.values()) {
    for (const shop of b.shops) {
      if (closed >= n) break;
      if (shop.trade === null) continue;
      shop.trade = null;
      shop.status = 'bos';
      closed++;
    }
  }
  if (closed > 0) city.revision.buildings++;
  return closed;
}

/** A dated line for the chronicle panel. */
export function chronicleDate(city: CityState, day: number): string {
  return formatDate(dateOf({ ...city.calendar, day }));
}
