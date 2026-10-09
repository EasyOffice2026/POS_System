import { closedWeek, type OpeningHours } from '@pos/shared';
import i18n from 'i18next';
import { describe, expect, it } from 'vitest';
import { describeSchedule } from './schedule-summary';

const t = i18n.t.bind(i18n);

type Day = OpeningHours['sunday'];

const lunch: Day = { kind: 'ranges', ranges: [{ open: '11:00', close: '16:00' }] };
const allDay: Day = { kind: 'all_day' };

const week = (days: Partial<OpeningHours>): OpeningHours => ({ ...closedWeek(), ...days });

describe('describeSchedule', () => {
  it('joins the days in a row that have the same times, and leaves out the days that are closed', () => {
    const hours = week({
      sunday: lunch,
      monday: lunch,
      tuesday: lunch,
      wednesday: lunch,
      thursday: lunch,
    });

    expect(describeSchedule(hours, t)).toBe('Sun–Thu: 11:00–16:00');
  });

  it('says every day when all seven days have the same times', () => {
    const every = Object.fromEntries(
      Object.keys(closedWeek()).map((day) => [
        day,
        { kind: 'ranges', ranges: [{ open: '14:00', close: '02:00' }] },
      ]),
    ) as OpeningHours;

    expect(describeSchedule(every, t)).toBe('Every day: 14:00–02:00');
  });

  it('says all day for a day that has no limit', () => {
    expect(describeSchedule(week({ friday: allDay }), t)).toBe('Fri: all day');
    const everyDay = Object.fromEntries(
      Object.keys(closedWeek()).map((day) => [day, allDay]),
    ) as OpeningHours;
    expect(describeSchedule(everyDay, t)).toBe('Every day: all day');
  });

  it('lists the ranges of a day, and each group of days on its own', () => {
    const hours = week({
      monday: {
        kind: 'ranges',
        ranges: [
          { open: '09:00', close: '12:00' },
          { open: '13:00', close: '17:00' },
        ],
      },
      tuesday: allDay,
      wednesday: allDay,
    });

    expect(describeSchedule(hours, t)).toBe('Mon: 09:00–12:00, 13:00–17:00; Tue–Wed: all day');
  });

  it('does not join days that are not next to each other', () => {
    expect(describeSchedule(week({ sunday: lunch, tuesday: lunch }), t)).toBe(
      'Sun: 11:00–16:00; Tue: 11:00–16:00',
    );
  });

  it('says never when no day is available', () => {
    expect(describeSchedule(closedWeek(), t)).toBe('Never');
  });

  it('writes the days in Arabic when the language is Arabic', async () => {
    await i18n.changeLanguage('ar');

    expect(describeSchedule(week({ sunday: lunch, monday: lunch, tuesday: lunch }), t)).toBe(
      'الأحد–الثلاثاء: 11:00–16:00',
    );
    expect(describeSchedule(week({ friday: allDay }), t)).toBe('الجمعة: طوال اليوم');
    expect(describeSchedule(closedWeek(), t)).toBe('أبداً');
  });
});
