import { type OpeningHours, weekdays } from '@pos/shared';
import type { TFunction } from 'i18next';

// A short text for the times in a schedule, for lists: "Sun-Thu: 11:00-16:00; Fri: all day".
// Days that are not available are left out, and days in a row with the same times are joined.
export function describeSchedule(hours: OpeningHours, t: TFunction): string {
  const times = weekdays.map((day) => {
    const value = hours[day];
    if (value.kind === 'closed') return null;
    if (value.kind === 'all_day') return t('menu.schedule.allDay');
    return value.ranges.map((range) => `${range.open}–${range.close}`).join(', ');
  });

  if (times.every((text) => text === null)) return t('menu.schedule.never');
  if (times.every((text) => text === times[0])) {
    return `${t('menu.schedule.everyDay')}: ${times[0]}`;
  }

  const parts: string[] = [];
  let start = 0;
  while (start < weekdays.length) {
    let end = start;
    while (end + 1 < weekdays.length && times[end + 1] === times[start]) end += 1;

    const text = times[start];
    const first = weekdays[start];
    const last = weekdays[end];
    if (text !== null && text !== undefined && first && last) {
      const firstName = t(`weekdaysShort.${first}`);
      const days = start === end ? firstName : `${firstName}–${t(`weekdaysShort.${last}`)}`;
      parts.push(`${days}: ${text}`);
    }
    start = end + 1;
  }
  return parts.join('; ');
}
