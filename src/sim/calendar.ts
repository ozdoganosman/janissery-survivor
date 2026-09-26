/**
 * Game time. A simplified year of twelve 30-day months keeps seasons exactly 90 days long,
 * which makes planting, harvest and winter easy to schedule and to balance.
 *
 * Month names follow the Rumi calendar, the Syriac-derived names used in Anatolia.
 */
export const MONTHS = [
  'Kânunusani',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Teşrinievvel',
  'Teşrinisani',
  'Kânunuevvel',
] as const;

export type Season = 'Bahar' | 'Yaz' | 'Güz' | 'Kış';

export const DAYS_PER_MONTH = 30;
export const DAYS_PER_YEAR = DAYS_PER_MONTH * 12;

/** Game days that pass per real second at each speed. Speed 0 is paused. */
export const DAYS_PER_SECOND = [0, 1.5, 5, 15] as const;
export type Speed = 0 | 1 | 2 | 3;

export interface Calendar {
  startYear: number;
  /** Whole days elapsed since 1 Kânunusani of `startYear`. */
  day: number;
  /** Fraction of the current day already elapsed, in [0, 1). */
  fraction: number;
  speed: Speed;
}

export interface GameDate {
  year: number;
  /** 0-based, 0 = Kânunusani. */
  month: number;
  /** 1-based day of the month. */
  day: number;
  season: Season;
}

export function createCalendar(start: { year: number; month: number; day: number }): Calendar {
  return {
    startYear: start.year,
    day: start.month * DAYS_PER_MONTH + (start.day - 1),
    fraction: 0,
    speed: 1,
  };
}

export function seasonOfMonth(month: number): Season {
  if (month >= 2 && month <= 4) return 'Bahar';
  if (month >= 5 && month <= 7) return 'Yaz';
  if (month >= 8 && month <= 10) return 'Güz';
  return 'Kış';
}

export function dateOf(cal: Calendar): GameDate {
  const year = cal.startYear + Math.floor(cal.day / DAYS_PER_YEAR);
  const dayOfYear = cal.day % DAYS_PER_YEAR;
  const month = Math.floor(dayOfYear / DAYS_PER_MONTH);
  return { year, month, day: (dayOfYear % DAYS_PER_MONTH) + 1, season: seasonOfMonth(month) };
}

export function formatDate(d: GameDate): string {
  return `${d.day} ${MONTHS[d.month] ?? ''} ${d.year}`;
}

/**
 * Advances time by a slice of real time and returns how many whole days began.
 * Negative or non-finite input (a misbehaving clock) is ignored rather than rewinding time.
 */
export function advanceCalendar(cal: Calendar, realSeconds: number): number {
  if (!Number.isFinite(realSeconds) || realSeconds <= 0) return 0;
  const total = cal.fraction + realSeconds * DAYS_PER_SECOND[cal.speed];
  const whole = Math.floor(total);
  cal.fraction = total - whole;
  cal.day += whole;
  return whole;
}
