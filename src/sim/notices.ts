import type { CityState, NoticeKind } from './city';

export function notify(city: CityState, text: string, kind: NoticeKind = 'info'): void {
  city.notices.push({ text, kind, day: city.calendar.day });
  if (city.notices.length > 20) city.notices.shift();
}
