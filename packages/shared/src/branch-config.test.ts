import { describe, expect, it } from 'vitest';
import {
  offeredOrderTypes,
  DEFAULT_PRINTER_PORT,
  MAX_PRINTERS,
  MAX_RANGES_PER_DAY,
  branchConfigChangeSchema,
  businessDateOn,
  closedWeek,
  hoursOnDate,
  isBranchOpenAt,
  isOpenAt,
  isOpenAtInstant,
  isPrinterHost,
  isTimeZone,
  localTimeIn,
  openingHoursSchema,
  overlappingDays,
  parseBranchConfig,
  printsKitchenSlip,
  printerInputListSchema,
  printerInputSchema,
  printerListSchema,
  specialHoursSchema,
  type DayHours,
  type OpeningHours,
} from './branch-config';

// A week with every day closed, and the given days changed.
function week(days: Partial<OpeningHours>): OpeningHours {
  return { ...closedWeek(), ...days };
}

const ranges = (...pairs: [string, string][]) => ({
  kind: 'ranges' as const,
  ranges: pairs.map(([open, close]) => ({ open, close })),
});

// The problems of a failed parse as "path:code", so a test says where and what in one line.
function problems(result: { success: boolean; error?: { issues: unknown[] } }): string[] {
  const issues = (result.error?.issues ?? []) as { path: PropertyKey[]; message: string }[];
  return issues.map((issue) => `${issue.path.map(String).join('.')}:${issue.message}`);
}

describe('isTimeZone', () => {
  it.each(['Asia/Riyadh', 'Asia/Dubai', 'UTC', 'Africa/Cairo', 'America/Argentina/Buenos_Aires'])(
    'accepts %s',
    (name) => {
      expect(isTimeZone(name)).toBe(true);
    },
  );

  it.each([
    '+03:00',
    '-05:00',
    'asia/riyadh',
    'Mars/Base',
    'Riyadh',
    '',
    ' Asia/Riyadh',
    'Asia//X',
  ])('refuses "%s"', (name) => {
    expect(isTimeZone(name)).toBe(false);
  });
});

describe('opening hours', () => {
  it('accepts a week that is closed', () => {
    expect(openingHoursSchema.safeParse(closedWeek()).success).toBe(true);
  });

  it('accepts closed days, a day open all day, and days with ranges', () => {
    const hours = week({
      sunday: { kind: 'all_day' },
      monday: ranges(['09:00', '14:00'], ['17:00', '23:30']),
      friday: ranges(['14:00', '23:00']),
    });

    expect(openingHoursSchema.parse(hours)).toEqual(hours);
  });

  it('lets a range end after midnight, and keeps it with the day it started on', () => {
    const hours = week({ friday: ranges(['18:00', '02:00']) });

    expect(openingHoursSchema.parse(hours).friday).toEqual(ranges(['18:00', '02:00']));
  });

  it('puts the ranges of a day in the order of the clock', () => {
    const parsed = openingHoursSchema.parse(
      week({ monday: ranges(['17:00', '23:00'], ['09:00', '14:00']) }),
    );

    expect(parsed.monday).toEqual(ranges(['09:00', '14:00'], ['17:00', '23:00']));
  });

  it.each(['9:00', '24:00', '12:60', 'noon', '', '09:00:00', '٠٩:٠٠'])(
    'refuses the time "%s"',
    (time) => {
      const result = openingHoursSchema.safeParse(week({ monday: ranges([time, '23:00']) }));

      expect(problems(result)).toContain('monday.ranges.0.open:HOURS_TIME_FORMAT');
    },
  );

  it('refuses a range that opens and closes at the same time', () => {
    const result = openingHoursSchema.safeParse(week({ monday: ranges(['09:00', '09:00']) }));

    expect(problems(result)).toEqual(['monday.ranges.0.close:HOURS_RANGE_EMPTY']);
  });

  it('refuses a day with the ranges kind but no range', () => {
    const result = openingHoursSchema.safeParse(week({ monday: { kind: 'ranges', ranges: [] } }));

    expect(problems(result)).toEqual(['monday.ranges:HOURS_RANGES_REQUIRED']);
  });

  it('refuses more ranges in a day than the limit', () => {
    const many = Array.from({ length: MAX_RANGES_PER_DAY + 1 }, (_, index): [string, string] => [
      `${String(index * 3).padStart(2, '0')}:00`,
      `${String(index * 3 + 1).padStart(2, '0')}:00`,
    ]);

    const result = openingHoursSchema.safeParse(week({ monday: ranges(...many) }));

    expect(problems(result)).toEqual(['monday.ranges:HOURS_TOO_MANY_RANGES']);
  });

  it('refuses a week with a missing day, an unknown day or an unknown kind', () => {
    const { monday: _removed, ...missing } = closedWeek();

    expect(openingHoursSchema.safeParse(missing).success).toBe(false);
    expect(
      openingHoursSchema.safeParse({ ...closedWeek(), someday: { kind: 'closed' } }).success,
    ).toBe(false);
    expect(
      openingHoursSchema.safeParse(week({ monday: { kind: 'always' } as never })).success,
    ).toBe(false);
  });

  it('refuses extra fields on a day or a range', () => {
    expect(
      openingHoursSchema.safeParse(week({ monday: { kind: 'closed', note: 'x' } as never }))
        .success,
    ).toBe(false);
    expect(
      openingHoursSchema.safeParse(
        week({
          monday: { kind: 'ranges', ranges: [{ open: '09:00', close: '10:00', x: 1 }] } as never,
        }),
      ).success,
    ).toBe(false);
  });
});

describe('overlapping opening hours', () => {
  it('names the day with two ranges that overlap', () => {
    const result = openingHoursSchema.safeParse(
      week({ tuesday: ranges(['09:00', '14:00'], ['13:00', '18:00']) }),
    );

    expect(problems(result)).toEqual(['tuesday:HOURS_OVERLAP']);
  });

  it('finds the overlap whatever the order of the ranges', () => {
    const result = openingHoursSchema.safeParse(
      week({ tuesday: ranges(['13:00', '18:00'], ['09:00', '14:00']) }),
    );

    expect(problems(result)).toEqual(['tuesday:HOURS_OVERLAP']);
  });

  it('allows ranges that touch, and ranges apart', () => {
    expect(
      openingHoursSchema.safeParse(
        week({ tuesday: ranges(['09:00', '14:00'], ['14:00', '18:00']) }),
      ).success,
    ).toBe(true);
    expect(
      openingHoursSchema.safeParse(
        week({ tuesday: ranges(['09:00', '12:00'], ['15:00', '18:00']) }),
      ).success,
    ).toBe(true);
  });

  it('finds a range that runs past midnight into a range of the next day', () => {
    const hours = week({ monday: ranges(['18:00', '02:00']), tuesday: ranges(['01:00', '10:00']) });

    expect(overlappingDays(hours)).toEqual(['tuesday']);
  });

  it('allows a range that runs past midnight into a day that opens later', () => {
    const hours = week({ monday: ranges(['18:00', '02:00']), tuesday: ranges(['02:00', '10:00']) });

    expect(overlappingDays(hours)).toEqual([]);
  });

  it('allows a range that runs past midnight into a closed day', () => {
    expect(overlappingDays(week({ monday: ranges(['18:00', '02:00']) }))).toEqual([]);
  });

  it('finds Saturday night meeting Sunday morning, across the end of the week', () => {
    const hours = week({
      saturday: ranges(['22:00', '03:00']),
      sunday: ranges(['02:00', '09:00']),
    });

    expect(overlappingDays(hours)).toEqual(['sunday']);
  });

  it('finds a day open all day that meets the end of the night before', () => {
    const hours = week({ sunday: ranges(['20:00', '02:00']), monday: { kind: 'all_day' } });

    expect(overlappingDays(hours)).toEqual(['monday']);
  });

  it('allows two days open all day in a row', () => {
    expect(
      overlappingDays(week({ sunday: { kind: 'all_day' }, monday: { kind: 'all_day' } })),
    ).toEqual([]);
  });

  it('names each day with a problem once, in the order of the week', () => {
    const hours = week({
      thursday: ranges(['09:00', '14:00'], ['10:00', '12:00'], ['11:00', '13:00']),
      monday: ranges(['09:00', '14:00'], ['13:00', '18:00']),
    });

    expect(overlappingDays(hours)).toEqual(['monday', 'thursday']);
  });

  it('does not count a range with a broken time, which has its own problem', () => {
    const result = openingHoursSchema.safeParse(
      week({ monday: ranges(['09:00', '14:00'], ['nine', '18:00']) }),
    );

    expect(problems(result)).toEqual(['monday.ranges.1.open:HOURS_TIME_FORMAT']);
  });
});

describe('isPrinterHost', () => {
  it.each([
    '192.168.1.50',
    '10.0.0.7',
    '::1',
    'fe80::1',
    'printer-1.local',
    'kitchen',
    'localhost',
  ])('accepts %s', (host) => {
    expect(isPrinterHost(host)).toBe(true);
  });

  it.each([
    '',
    '999.1.1.1',
    '192.168.1',
    '123',
    'http://192.168.1.50',
    '192.168.1.50:9100',
    'printer 1',
    'printer_1',
    '-printer.local',
    `${'a'.repeat(64)}.local`,
    'a'.repeat(254),
    '/path',
    'fe80::1%eth0',
  ])('refuses "%s"', (host) => {
    expect(isPrinterHost(host)).toBe(false);
  });
});

describe('printers', () => {
  const receipt = {
    id: '01990000-0000-7000-8000-0000000000a1',
    name: 'Cash desk',
    kind: 'receipt' as const,
    host: '192.168.1.50',
    port: 9100,
  };

  it('accepts a stored printer', () => {
    expect(printerListSchema.parse([receipt])).toEqual([receipt]);
  });

  it('needs an id on a stored printer but not on one that is sent', () => {
    const { id: _id, ...sent } = receipt;

    expect(printerListSchema.safeParse([sent]).success).toBe(false);
    expect(printerInputListSchema.safeParse([sent]).success).toBe(true);
  });

  it('gives a printer that is sent without a port the usual one', () => {
    const { port: _port, ...sent } = receipt;

    expect(printerInputSchema.parse(sent).port).toBe(DEFAULT_PRINTER_PORT);
  });

  it.each([0, 65536, -1, 9100.5, '9100', null])('refuses the port %j', (port) => {
    const result = printerInputSchema.safeParse({ ...receipt, port });

    expect(problems(result)).toEqual(['port:PRINTER_PORT_INVALID']);
  });

  it('refuses a printer with no name, a kind that does not exist or a bad address', () => {
    expect(problems(printerInputSchema.safeParse({ ...receipt, name: '  ' }))).toEqual([
      'name:PRINTER_NAME_REQUIRED',
    ]);
    expect(printerInputSchema.safeParse({ ...receipt, kind: 'label' }).success).toBe(false);
    expect(problems(printerInputSchema.safeParse({ ...receipt, host: 'http://printer' }))).toEqual([
      'host:PRINTER_HOST_INVALID',
    ]);
  });

  it('trims the name and the address', () => {
    const parsed = printerInputSchema.parse({ ...receipt, name: '  Bar  ', host: ' 10.0.0.9 ' });

    expect(parsed).toMatchObject({ name: 'Bar', host: '10.0.0.9' });
  });

  it('refuses extra fields', () => {
    expect(printerInputSchema.safeParse({ ...receipt, brandId: 'x' }).success).toBe(false);
  });

  it('keeps names apart whatever the capital letters, and names the later printer', () => {
    const result = printerInputListSchema.safeParse([
      { ...receipt, id: undefined },
      { ...receipt, id: undefined, name: 'CASH DESK', host: '192.168.1.51' },
    ]);

    expect(problems(result)).toEqual(['1.name:PRINTER_NAME_TAKEN']);
  });

  it('allows the same address for two printers with different names', () => {
    const result = printerInputListSchema.safeParse([
      { ...receipt, id: undefined },
      { ...receipt, id: undefined, name: 'Second desk' },
    ]);

    expect(result.success).toBe(true);
  });

  it('refuses two printers with the same id', () => {
    const result = printerListSchema.safeParse([receipt, { ...receipt, name: 'Other' }]);

    expect(problems(result)).toEqual(['1.id:PRINTER_ID_DUPLICATE']);
  });

  it('allows several receipt printers and several kitchen printers', () => {
    const list = Array.from({ length: 4 }, (_, index) => ({
      name: `Printer ${index}`,
      kind: index % 2 === 0 ? 'receipt' : 'kitchen',
      host: `192.168.1.${50 + index}`,
    }));

    expect(printerInputListSchema.safeParse(list).success).toBe(true);
  });

  it('refuses more printers than the limit', () => {
    const list = Array.from({ length: MAX_PRINTERS + 1 }, (_, index) => ({
      name: `Printer ${index}`,
      kind: 'receipt',
      host: '10.0.0.1',
    }));

    expect(problems(printerInputListSchema.safeParse(list))).toEqual([':PRINTERS_TOO_MANY']);
  });
});

describe('the kitchen switches (spec 027)', () => {
  it('keep a stored choice, fall back to the screen without a slip, and print a slip when the screen is off', () => {
    expect(
      parseBranchConfig({ kitchen: { screen: false, slip: false, lateAfterMinutes: 8 } }).kitchen,
    ).toEqual({ screen: false, slip: false, lateAfterMinutes: 8 });
    // Saved before the late limit existed: 12 minutes.
    expect(parseBranchConfig({ kitchen: { screen: false, slip: true } }).kitchen).toEqual({
      screen: false,
      slip: true,
      lateAfterMinutes: 12,
    });
    expect(parseBranchConfig({ kitchen: { screen: 'yes' } }).kitchen).toEqual({
      screen: true,
      slip: false,
      lateAfterMinutes: 12,
    });
    expect(
      parseBranchConfig({ kitchen: { screen: true, slip: false, lateAfterMinutes: 0 } }).kitchen
        .lateAfterMinutes,
    ).toBe(12);
    expect(printsKitchenSlip({ screen: true, slip: false })).toBe(false);
    expect(printsKitchenSlip({ screen: true, slip: true })).toBe(true);
    expect(printsKitchenSlip({ screen: false, slip: false })).toBe(true);
  });
});

describe('parseBranchConfig', () => {
  it('gives a branch that was never set up closed days and no printers', () => {
    const expected = {
      openingHours: closedWeek(),
      printers: [],
      dayEndsAt: '00:00',
      specialHours: [],
      kitchen: { screen: true, slip: false, lateAfterMinutes: 12 },
      orderTypes: { dine_in: true, takeaway: true, delivery: false },
    };

    expect(parseBranchConfig({})).toEqual(expected);
    expect(parseBranchConfig(null)).toEqual(expected);
    expect(parseBranchConfig('nonsense')).toEqual(expected);
    expect(parseBranchConfig([])).toEqual(expected);
  });

  it('reads what is stored', () => {
    const stored = {
      openingHours: week({ monday: ranges(['09:00', '22:00']) }),
      printers: [
        {
          id: '01990000-0000-7000-8000-0000000000a1',
          name: 'Bar',
          kind: 'kitchen',
          host: '10.0.0.4',
          port: 9100,
        },
      ],
    };

    expect(parseBranchConfig(stored)).toEqual({
      ...stored,
      dayEndsAt: '00:00',
      specialHours: [],
      kitchen: { screen: true, slip: false, lateAfterMinutes: 12 },
      orderTypes: { dine_in: true, takeaway: true, delivery: false },
    });
  });

  it('falls back to the default for a part that cannot be read, and keeps the other part', () => {
    const printers = [
      {
        id: '01990000-0000-7000-8000-0000000000a1',
        name: 'Bar',
        kind: 'kitchen',
        host: '10.0.0.4',
        port: 9100,
      },
    ];

    expect(parseBranchConfig({ openingHours: { monday: 'open' }, printers })).toEqual({
      openingHours: closedWeek(),
      printers,
      dayEndsAt: '00:00',
      specialHours: [],
      kitchen: { screen: true, slip: false, lateAfterMinutes: 12 },
      orderTypes: { dine_in: true, takeaway: true, delivery: false },
    });
  });

  it('ignores keys that a later module may add', () => {
    expect(parseBranchConfig({ receiptFooter: 'Thank you' })).toEqual({
      openingHours: closedWeek(),
      printers: [],
      dayEndsAt: '00:00',
      specialHours: [],
      kitchen: { screen: true, slip: false, lateAfterMinutes: 12 },
      orderTypes: { dine_in: true, takeaway: true, delivery: false },
    });
  });
});

describe('branchConfigChangeSchema', () => {
  it('accepts either part, both or none', () => {
    expect(branchConfigChangeSchema.safeParse({}).success).toBe(true);
    expect(branchConfigChangeSchema.safeParse({ openingHours: closedWeek() }).success).toBe(true);
    expect(branchConfigChangeSchema.safeParse({ printers: [] }).success).toBe(true);
  });

  it('refuses a part it does not know', () => {
    expect(branchConfigChangeSchema.safeParse({ taxes: [] }).success).toBe(false);
  });

  it('reports a problem with the path inside the configuration', () => {
    const result = branchConfigChangeSchema.safeParse({
      openingHours: week({ monday: ranges(['09:00', '14:00'], ['13:00', '18:00']) }),
      printers: [{ name: 'A', kind: 'receipt', host: 'x y' }],
    });

    expect(problems(result)).toEqual([
      'openingHours.monday:HOURS_OVERLAP',
      'printers.0.host:PRINTER_HOST_INVALID',
    ]);
  });
});

describe('isOpenAt', () => {
  const minutes = (hour: number, minute = 0) => hour * 60 + minute;

  it('is closed on a closed day and open all day on a day open all day', () => {
    const hours = week({ monday: { kind: 'all_day' } });

    expect(isOpenAt(hours, 'tuesday', minutes(12))).toBe(false);
    expect(isOpenAt(hours, 'monday', 0)).toBe(true);
    expect(isOpenAt(hours, 'monday', minutes(23, 59))).toBe(true);
  });

  it('is open from the opening minute up to, but not at, the closing minute', () => {
    const hours = week({ monday: ranges(['09:00', '17:00']) });

    expect(isOpenAt(hours, 'monday', minutes(8, 59))).toBe(false);
    expect(isOpenAt(hours, 'monday', minutes(9))).toBe(true);
    expect(isOpenAt(hours, 'monday', minutes(16, 59))).toBe(true);
    expect(isOpenAt(hours, 'monday', minutes(17))).toBe(false);
  });

  it('knows the break between two ranges of a day', () => {
    const hours = week({ monday: ranges(['09:00', '14:00'], ['17:00', '23:00']) });

    expect(isOpenAt(hours, 'monday', minutes(13))).toBe(true);
    expect(isOpenAt(hours, 'monday', minutes(15))).toBe(false);
    expect(isOpenAt(hours, 'monday', minutes(18))).toBe(true);
  });

  it('stays open after midnight for a range that runs past it, then closes', () => {
    const hours = week({ friday: ranges(['14:00', '01:00']) });

    expect(isOpenAt(hours, 'friday', minutes(23))).toBe(true);
    expect(isOpenAt(hours, 'saturday', minutes(0, 30))).toBe(true);
    expect(isOpenAt(hours, 'saturday', minutes(1))).toBe(false);
    expect(isOpenAt(hours, 'friday', minutes(1))).toBe(false);
  });

  it('is open on Sunday morning for a range that runs past the end of Saturday', () => {
    const hours = week({ saturday: ranges(['22:00', '03:00']) });

    expect(isOpenAt(hours, 'saturday', minutes(23))).toBe(true);
    expect(isOpenAt(hours, 'sunday', minutes(2, 59))).toBe(true);
    expect(isOpenAt(hours, 'sunday', minutes(3))).toBe(false);
  });
});

describe('localTimeIn', () => {
  it('gives the day and the minute of the day on the clocks of a time zone', () => {
    const moment = new Date('2026-10-09T09:30:00Z');

    expect(localTimeIn(moment, 'Asia/Riyadh')).toEqual({ weekday: 'friday', minuteOfDay: 750 });
    expect(localTimeIn(moment, 'UTC')).toEqual({ weekday: 'friday', minuteOfDay: 570 });
  });

  it('moves to the next day when the clocks are ahead', () => {
    expect(localTimeIn(new Date('2026-10-09T22:30:00Z'), 'Asia/Riyadh')).toEqual({
      weekday: 'saturday',
      minuteOfDay: 90,
    });
  });

  it('writes midnight as minute 0, not as 24:00', () => {
    expect(localTimeIn(new Date('2026-10-08T21:00:00Z'), 'Asia/Riyadh')).toEqual({
      weekday: 'friday',
      minuteOfDay: 0,
    });
  });
});

describe('isOpenAtInstant', () => {
  const hours = week({ friday: ranges(['14:00', '01:00']) });

  it('reads the hours on the clocks of the time zone', () => {
    // 15:00 on Friday in Riyadh.
    expect(isOpenAtInstant(hours, new Date('2026-10-09T12:00:00Z'), 'Asia/Riyadh')).toBe(true);
    // The same moment is 12:00 in UTC, before the branch opens that day.
    expect(isOpenAtInstant(hours, new Date('2026-10-09T12:00:00Z'), 'UTC')).toBe(false);
  });

  it('is still open just after midnight, and closed at one', () => {
    expect(isOpenAtInstant(hours, new Date('2026-10-09T21:30:00Z'), 'Asia/Riyadh')).toBe(true);
    expect(isOpenAtInstant(hours, new Date('2026-10-09T22:00:00Z'), 'Asia/Riyadh')).toBe(false);
  });
});

describe('businessDateOn', () => {
  it('is the day on the clock of the branch, which may be the day before in UTC', () => {
    // 01:30 on Tuesday 13 October in Kuwait is still Monday in UTC.
    expect(businessDateOn(new Date('2026-10-12T22:30:00Z'), 'Asia/Kuwait')).toBe('2026-10-13');
    expect(businessDateOn(new Date('2026-10-12T22:30:00Z'), 'UTC')).toBe('2026-10-12');
  });

  it('counts an order before the end of the day for the day before', () => {
    const at = new Date('2026-10-12T22:30:00Z'); // 01:30 on Tuesday in Kuwait
    expect(businessDateOn(at, 'Asia/Kuwait', '04:00')).toBe('2026-10-12');
    expect(businessDateOn(at, 'Asia/Kuwait', '01:30')).toBe('2026-10-13');
    // The first of the month steps back into the month before.
    expect(businessDateOn(new Date('2026-10-31T23:00:00Z'), 'Asia/Kuwait', '04:00')).toBe(
      '2026-10-31',
    );
  });

  it('reads the end of the day from a stored configuration, or takes midnight', () => {
    expect(parseBranchConfig({ dayEndsAt: '04:00' }).dayEndsAt).toBe('04:00');
    expect(parseBranchConfig({ dayEndsAt: '4am' }).dayEndsAt).toBe('00:00');
    expect(parseBranchConfig(null).dayEndsAt).toBe('00:00');
  });
});

describe('special hours', () => {
  const closed: DayHours = { kind: 'closed' };
  const evening: DayHours = { kind: 'ranges', ranges: [{ open: '19:00', close: '02:00' }] };
  const ramadan = {
    id: '01990000-0000-7000-8000-00000000a001',
    name: 'Ramadan',
    from: '2027-02-08',
    to: '2027-03-09',
    hours: evening,
  };
  const eid = {
    id: '01990000-0000-7000-8000-00000000a002',
    name: 'Eid',
    from: '2027-03-10',
    to: '2027-03-12',
    hours: closed,
  };

  it('keep the periods in calendar order and refuse dates that overlap or run backwards', () => {
    expect(specialHoursSchema.parse([eid, ramadan]).map((period) => period.name)).toEqual([
      'Ramadan',
      'Eid',
    ]);
    const result = specialHoursSchema.safeParse([
      ramadan,
      { ...eid, from: '2027-03-09' },
      { ...eid, id: '01990000-0000-7000-8000-00000000a003', from: '2027-04-02', to: '2027-04-01' },
    ]);
    expect(result.success).toBe(false);
    expect(
      result.error?.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    ).toEqual(['1: SPECIAL_OVERLAP', '2.to: DATE_RANGE_INVALID']);
  });

  it('decide the hours of a date: the period that covers it, else the weekday', () => {
    const config = {
      openingHours: { ...closedWeek(), monday: { kind: 'all_day' as const } },
      specialHours: [ramadan, eid],
    };
    expect(hoursOnDate(config, '2027-02-15', 'monday')).toEqual(evening);
    expect(hoursOnDate(config, '2027-03-11', 'thursday')).toEqual(closed);
    expect(hoursOnDate(config, '2027-03-15', 'monday')).toEqual({ kind: 'all_day' });
    // Monday 15 February 2027 at 20:00 in Kuwait is in Ramadan: open by the evening hours.
    expect(isBranchOpenAt(config, new Date('2027-02-15T17:00:00Z'), 'Asia/Kuwait')).toBe(true);
    expect(isBranchOpenAt(config, new Date('2027-02-15T07:00:00Z'), 'Asia/Kuwait')).toBe(false);
    expect(isBranchOpenAt(config, new Date('2027-03-15T07:00:00Z'), 'Asia/Kuwait')).toBe(true);
  });

  it('come back empty from a configuration that has none', () => {
    expect(parseBranchConfig({}).specialHours).toEqual([]);
  });
});

describe('the order types of a branch (spec 026)', () => {
  it('start with Dine-in and Takeaway, keep a stored choice, and list the types that are on', () => {
    expect(parseBranchConfig({}).orderTypes).toEqual({
      dine_in: true,
      takeaway: true,
      delivery: false,
    });
    const kiosk = { dine_in: false, takeaway: true, delivery: true };
    expect(parseBranchConfig({ orderTypes: kiosk }).orderTypes).toEqual(kiosk);
    expect(offeredOrderTypes(kiosk)).toEqual(['takeaway', 'delivery']);
    // A stored choice with nothing on is not trusted.
    expect(
      parseBranchConfig({ orderTypes: { dine_in: false, takeaway: false, delivery: false } })
        .orderTypes,
    ).toEqual({ dine_in: true, takeaway: true, delivery: false });
  });

  it('refuses a change that switches every type off', () => {
    const off = { dine_in: false, takeaway: false, delivery: false };
    const result = branchConfigChangeSchema.safeParse({ orderTypes: off });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('ORDER_TYPES_NONE');
  });
});
