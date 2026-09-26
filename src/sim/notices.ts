import type { CityState, NoticeKind, NoticeTopic } from './city';

export function notify(city: CityState, text: string, kind: NoticeKind = 'info', topic?: NoticeTopic): void {
  city.notices.push(
    topic === undefined
      ? { text, kind, day: city.calendar.day }
      : { text, kind, day: city.calendar.day, topic },
  );
  if (city.notices.length > 20) city.notices.shift();
}
