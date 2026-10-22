import { z } from 'zod';

// What a branch stores in its configuration: opening hours and printers. The API and the screens
// check against these schemas, so both agree on the shape. A problem is a code (for example
// HOURS_OVERLAP) that the web app turns into a sentence in the current language.

export const DEFAULT_TIMEZONE = 'Asia/Kuwait';

// IANA names are spelled like Area/Location, or are one word such as UTC. Intl also accepts
// offsets such as +03:00 and other spellings, which are not names, so the shape is checked first.
export function isTimeZone(value: string): boolean {
  if (!/^[A-Z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const timezoneSchema = z.string().trim().refine(isTimeZone, 'TIMEZONE_INVALID');

// ---------------------------------------------------------------------------------------------
// Opening hours

// The week starts on Sunday, as it does in the region this system is built for.
export const weekdays = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;
export const weekdaySchema = z.enum(weekdays);
export type Weekday = z.infer<typeof weekdaySchema>;

export const MAX_RANGES_PER_DAY = 6;

const MINUTES_PER_DAY = 24 * 60;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;

const timeField = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HOURS_TIME_FORMAT');

// A range ends after it starts, but it may end after midnight: 18:00 to 02:00 is eight hours and
// belongs to the day it started on. The same time twice would be empty (or a whole day, which has
// its own setting), so it is refused.
export const hoursRangeSchema = z
  .strictObject({ open: timeField, close: timeField })
  .refine((range) => range.open !== range.close, { path: ['close'], message: 'HOURS_RANGE_EMPTY' });

export const dayHoursSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('closed') }),
  z.strictObject({ kind: z.literal('all_day') }),
  z.strictObject({
    kind: z.literal('ranges'),
    ranges: z
      .array(hoursRangeSchema)
      .min(1, 'HOURS_RANGES_REQUIRED')
      .max(MAX_RANGES_PER_DAY, 'HOURS_TOO_MANY_RANGES'),
  }),
]);

export type DayHours = z.infer<typeof dayHoursSchema>;
export type OpeningHours = Record<Weekday, DayHours>;

export function closedWeek(): OpeningHours {
  return Object.fromEntries(weekdays.map((day) => [day, { kind: 'closed' }])) as OpeningHours;
}

function toMinutes(time: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

// A stretch of the week in minutes from Sunday 00:00. It can run past the end of the week.
interface Span {
  day: Weekday;
  start: number;
  end: number;
}

function spansOf(hours: OpeningHours): Span[] {
  const spans: Span[] = [];

  for (const [index, day] of weekdays.entries()) {
    const base = index * MINUTES_PER_DAY;
    const value = hours[day];

    if (value.kind === 'all_day') {
      spans.push({ day, start: base, end: base + MINUTES_PER_DAY });
    } else if (value.kind === 'ranges') {
      for (const range of value.ranges) {
        const open = toMinutes(range.open);
        const close = toMinutes(range.close);
        if (open === null || close === null || open === close) continue;

        const length = (close - open + MINUTES_PER_DAY) % MINUTES_PER_DAY;
        spans.push({ day, start: base + open, end: base + open + length });
      }
    }
  }
  return spans;
}

// The days where a range starts inside another one. This looks at the whole week, so Saturday
// night running past midnight meets Sunday morning. The day named is the one that starts later.
export function overlappingDays(hours: OpeningHours): Weekday[] {
  const spans = spansOf(hours);
  const flagged = new Set<Weekday>();

  for (const [index, first] of spans.entries()) {
    for (const second of spans.slice(index + 1)) {
      for (const shift of [-MINUTES_PER_WEEK, 0, MINUTES_PER_WEEK]) {
        const start = second.start + shift;
        const end = second.end + shift;
        if (first.start < end && start < first.end) {
          flagged.add(start >= first.start ? second.day : first.day);
        }
      }
    }
  }
  return weekdays.filter((day) => flagged.has(day));
}

// Whether the hours are open at a moment of the week, given as the day and the minute of that day
// (0 to 1439). A range that runs past midnight is still open after it, and one that runs past the
// end of Saturday is open on Sunday morning.
export function isOpenAt(hours: OpeningHours, weekday: Weekday, minuteOfDay: number): boolean {
  const point = weekdays.indexOf(weekday) * MINUTES_PER_DAY + minuteOfDay;

  return spansOf(hours).some(
    (span) =>
      (span.start <= point && point < span.end) ||
      (span.start <= point + MINUTES_PER_WEEK && point + MINUTES_PER_WEEK < span.end),
  );
}

// The day and the minute of the day that a moment has on the clocks of a time zone.
export function localTimeIn(at: Date, timeZone: string): { weekday: Weekday; minuteOfDay: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';

  const weekday = weekdaySchema.parse(part('weekday').toLowerCase());
  return { weekday, minuteOfDay: (Number(part('hour')) % 24) * 60 + Number(part('minute')) };
}

// Whether the hours are open at a moment, on the clocks of a time zone. This is how a terminal
// decides whether an item is available now.
export function isOpenAtInstant(hours: OpeningHours, at: Date, timeZone: string): boolean {
  const { weekday, minuteOfDay } = localTimeIn(at, timeZone);
  return isOpenAt(hours, weekday, minuteOfDay);
}

// Ranges in the order of the clock, so a day always reads the same.
function sortRanges(hours: OpeningHours): OpeningHours {
  const sorted = { ...hours };
  for (const day of weekdays) {
    const value = hours[day];
    if (value.kind === 'ranges') {
      sorted[day] = {
        kind: 'ranges',
        ranges: [...value.ranges].sort((a, b) => a.open.localeCompare(b.open)),
      };
    }
  }
  return sorted;
}

const weekShape = Object.fromEntries(weekdays.map((day) => [day, dayHoursSchema])) as Record<
  Weekday,
  typeof dayHoursSchema
>;

// The whole week, every day given. A problem with the hours as a whole is reported on the day.
export const openingHoursSchema = z
  .strictObject(weekShape)
  .superRefine((hours, ctx) => {
    for (const day of overlappingDays(hours)) {
      ctx.addIssue({ code: 'custom', path: [day], message: 'HOURS_OVERLAP' });
    }
  })
  .transform(sortRanges);

// ---------------------------------------------------------------------------------------------
// Special hours: Ramadan, Eid and other days when the branch opens differently
// (docs/client-decisions.md). A period names a run of dates and the hours of each of them.

export const MAX_SPECIAL_PERIODS = 20;

const dateField = z.iso.date({ error: 'DATE_INVALID' });

const specialPeriodFields = {
  name: z
    .string({ error: 'SPECIAL_NAME_REQUIRED' })
    .trim()
    .min(1, 'SPECIAL_NAME_REQUIRED')
    .max(40, 'SPECIAL_NAME_TOO_LONG'),
  from: dateField,
  to: dateField,
  hours: dayHoursSchema,
};

export const specialPeriodSchema = z.strictObject({ id: z.uuid(), ...specialPeriodFields });
export type SpecialPeriod = z.infer<typeof specialPeriodSchema>;

export const specialPeriodInputSchema = z.strictObject({
  id: z.uuid().optional(),
  ...specialPeriodFields,
});
export type SpecialPeriodInput = z.input<typeof specialPeriodInputSchema>;

// Two periods are never on the same date, each ends on or after its first day, and the ranges of
// a period's day do not overlap. Periods come out in the order of the calendar.
function checkPeriods<T extends { from: string; to: string; hours: DayHours }>(
  periods: T[],
  ctx: z.RefinementCtx,
) {
  periods.forEach((period, index) => {
    if (period.to < period.from) {
      ctx.addIssue({ code: 'custom', path: [index, 'to'], message: 'DATE_RANGE_INVALID' });
    }
    if (overlappingDays({ ...closedWeek(), sunday: period.hours }).length > 0) {
      ctx.addIssue({ code: 'custom', path: [index, 'hours'], message: 'HOURS_OVERLAP' });
    }
    const clash = periods
      .slice(0, index)
      .some((other) => period.from <= other.to && other.from <= period.to);
    if (clash) ctx.addIssue({ code: 'custom', path: [index], message: 'SPECIAL_OVERLAP' });
  });
}

const sortPeriods = <T extends { from: string; hours: DayHours }>(periods: T[]) =>
  [...periods]
    .map((period) => ({
      ...period,
      hours: sortRanges({ ...closedWeek(), sunday: period.hours }).sunday,
    }))
    .sort((a, b) => a.from.localeCompare(b.from));

export const specialHoursSchema = z
  .array(specialPeriodSchema)
  .max(MAX_SPECIAL_PERIODS, 'SPECIAL_TOO_MANY')
  .superRefine(checkPeriods)
  .transform(sortPeriods);
export type SpecialHours = z.infer<typeof specialHoursSchema>;

export const specialHoursInputSchema = z
  .array(specialPeriodInputSchema)
  .max(MAX_SPECIAL_PERIODS, 'SPECIAL_TOO_MANY')
  .superRefine(checkPeriods)
  .transform(sortPeriods);

// The hours of a branch on a date: a special period's if one covers it, else the weekday's.
export function hoursOnDate(
  config: Pick<BranchConfig, 'openingHours' | 'specialHours'>,
  date: string,
  weekday: Weekday,
): DayHours {
  const special = config.specialHours.find((period) => period.from <= date && date <= period.to);
  return special ? special.hours : config.openingHours[weekday];
}

// Whether the branch is open at a moment, on its own clock.
export function isBranchOpenAt(
  config: Pick<BranchConfig, 'openingHours' | 'specialHours'>,
  at: Date,
  timeZone: string,
): boolean {
  const date = businessDateOn(at, timeZone, '00:00');
  const { weekday, minuteOfDay } = localTimeIn(at, timeZone);
  const hours = hoursOnDate(config, date, weekday);
  return isOpenAt({ ...closedWeek(), [weekday]: hours }, weekday, minuteOfDay);
}

// ---------------------------------------------------------------------------------------------
// Printers

export const MAX_PRINTERS = 20;
// The port most network receipt printers listen on for raw ESC/POS data.
export const DEFAULT_PRINTER_PORT = 9100;

export const printerKinds = ['receipt', 'kitchen'] as const;
export const printerKindSchema = z.enum(printerKinds);
export type PrinterKind = z.infer<typeof printerKindSchema>;

const ipv4 = z.ipv4();
const ipv6 = z.ipv6();
const hostname = z.hostname();

// The network address of a printer: an IPv4 or IPv6 address, or a host name. No scheme, no path
// and no port, because the port is a field of its own.
export function isPrinterHost(value: string): boolean {
  if (value.length === 0 || value.length > 253) return false;
  // Digits and dots alone can only be an IPv4 address. "999.1.1.1" is a typo, not a name.
  if (/^[\d.]+$/.test(value)) return ipv4.safeParse(value).success;
  return ipv6.safeParse(value).success || hostname.safeParse(value).success;
}

const printerFields = {
  name: z.string().trim().min(1, 'PRINTER_NAME_REQUIRED').max(60, 'PRINTER_NAME_TOO_LONG'),
  kind: printerKindSchema,
  host: z.string().trim().refine(isPrinterHost, 'PRINTER_HOST_INVALID'),
  port: z
    .number({ error: 'PRINTER_PORT_INVALID' })
    .int('PRINTER_PORT_INVALID')
    .min(1, 'PRINTER_PORT_INVALID')
    .max(65535, 'PRINTER_PORT_INVALID'),
};

// A printer as stored. The id stays the same when the printer is edited, so later modules can
// point at it (a kitchen station that prints to this printer, for example).
export const printerSchema = z.strictObject({ id: z.uuid(), ...printerFields });
export type Printer = z.infer<typeof printerSchema>;

// A printer as sent. A new one has no id yet (the server makes it) and may leave out the port.
export const printerInputSchema = z.strictObject({
  id: z.uuid().optional(),
  ...printerFields,
  port: printerFields.port.default(DEFAULT_PRINTER_PORT),
});
export type PrinterInput = z.input<typeof printerInputSchema>;

interface Named {
  id?: string | undefined;
  name: string;
}

// Names are unique inside a branch, whatever the capital letters, so a printer can be told apart
// on a screen. A problem is reported on the later printer.
function checkPrinterList(printers: Named[], ctx: z.RefinementCtx): void {
  const names = new Set<string>();
  const ids = new Set<string>();

  for (const [index, printer] of printers.entries()) {
    const name = printer.name.toLowerCase();
    if (names.has(name)) {
      ctx.addIssue({ code: 'custom', path: [index, 'name'], message: 'PRINTER_NAME_TAKEN' });
    }
    names.add(name);

    if (printer.id !== undefined) {
      if (ids.has(printer.id)) {
        ctx.addIssue({ code: 'custom', path: [index, 'id'], message: 'PRINTER_ID_DUPLICATE' });
      }
      ids.add(printer.id);
    }
  }
}

export const printerListSchema = z
  .array(printerSchema)
  .max(MAX_PRINTERS, 'PRINTERS_TOO_MANY')
  .superRefine(checkPrinterList);

export const printerInputListSchema = z
  .array(printerInputSchema)
  .max(MAX_PRINTERS, 'PRINTERS_TOO_MANY')
  .superRefine(checkPrinterList);

// ---------------------------------------------------------------------------------------------
// The configuration as a whole

// The hour the business day of a branch ends, on its own clock. Orders before it count for the
// day before: with "04:00", an order at 01:30 on Tuesday belongs to Monday
// (docs/specs/009-settings.md, rule 4). "00:00" is midnight.
export const DEFAULT_DAY_END = '00:00';
export const dayEndSchema = timeField;

// Whether the branch's orders go to the kitchen screen, and whether the till prints a kitchen
// slip when it sends them. With the screen off the slip always prints
// (docs/specs/027-kitchen-screen-and-slip.md).
export const kitchenSettingsSchema = z.strictObject({
  screen: z.boolean({ error: 'KITCHEN_SETTING_INVALID' }),
  slip: z.boolean({ error: 'KITCHEN_SETTING_INVALID' }),
  // After this many minutes a ticket on the kitchen screen turns red (the redesign, step 3).
  lateAfterMinutes: z
    .number({ error: 'LATE_AFTER_INVALID' })
    .int('LATE_AFTER_INVALID')
    .min(1, 'LATE_AFTER_INVALID')
    .max(120, 'LATE_AFTER_INVALID')
    .default(12),
});
export type KitchenSettings = z.infer<typeof kitchenSettingsSchema>;
export const defaultKitchenSettings: KitchenSettings = {
  screen: true,
  slip: false,
  lateAfterMinutes: 12,
};

// Whether the till prints a slip when it sends dishes to the kitchen.
export const printsKitchenSlip = (kitchen: Pick<KitchenSettings, 'screen' | 'slip'>) =>
  kitchen.slip || !kitchen.screen;

export const branchConfigSchema = z.object({
  openingHours: openingHoursSchema,
  printers: printerListSchema,
  dayEndsAt: dayEndSchema.default(DEFAULT_DAY_END),
  specialHours: specialHoursSchema.default([]),
  kitchen: kitchenSettingsSchema.default(defaultKitchenSettings),
});

export type BranchConfig = z.infer<typeof branchConfigSchema>;

// What a request may change. A key that is left out stays as it is.
export const branchConfigChangeSchema = z.strictObject({
  openingHours: openingHoursSchema.optional(),
  printers: printerInputListSchema.optional(),
  dayEndsAt: dayEndSchema.optional(),
  specialHours: specialHoursInputSchema.optional(),
  kitchen: kitchenSettingsSchema.optional(),
});

// The day on the clock of a time zone, as YYYY-MM-DD, with the day ending at the hour given.
export function businessDateOn(at: Date, timeZone: string, dayEndsAt = DEFAULT_DAY_END): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value ?? 0);

  const minuteOfDay = (part('hour') % 24) * 60 + part('minute');
  const dayEnd = toMinutes(dayEndsAt) ?? 0;
  // Before the end of the day: still the day before, counted in UTC to step over month ends.
  const shift = minuteOfDay < dayEnd ? -1 : 0;
  return new Date(Date.UTC(part('year'), part('month') - 1, part('day') + shift))
    .toISOString()
    .slice(0, 10);
}

export type BranchConfigChange = z.input<typeof branchConfigChangeSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Reads a stored configuration. A branch that was never set up has none, so each part falls back
// to its default (every day closed, no printers), and a part that cannot be read does too. The
// next save then writes a clean one.
export function parseBranchConfig(stored: unknown): BranchConfig {
  const source = isRecord(stored) ? stored : {};
  const hours = openingHoursSchema.safeParse(source.openingHours);
  const printers = printerListSchema.safeParse(source.printers);
  const dayEnd = dayEndSchema.safeParse(source.dayEndsAt);
  const special = specialHoursSchema.safeParse(source.specialHours);
  const kitchen = kitchenSettingsSchema.safeParse(source.kitchen);

  return {
    openingHours: hours.success ? hours.data : closedWeek(),
    printers: printers.success ? printers.data : [],
    dayEndsAt: dayEnd.success ? dayEnd.data : DEFAULT_DAY_END,
    specialHours: special.success ? special.data : [],
    kitchen: kitchen.success ? kitchen.data : defaultKitchenSettings,
  };
}
