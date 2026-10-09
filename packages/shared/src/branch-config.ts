import { z } from 'zod';

// What a branch stores in its configuration: opening hours and printers. The API and the screens
// check against these schemas, so both agree on the shape. A problem is a code (for example
// HOURS_OVERLAP) that the web app turns into a sentence in the current language.

export const DEFAULT_TIMEZONE = 'Asia/Riyadh';

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

export const branchConfigSchema = z.object({
  openingHours: openingHoursSchema,
  printers: printerListSchema,
});

export type BranchConfig = z.infer<typeof branchConfigSchema>;

// What a request may change. A key that is left out stays as it is.
export const branchConfigChangeSchema = z.strictObject({
  openingHours: openingHoursSchema.optional(),
  printers: printerInputListSchema.optional(),
});

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

  return {
    openingHours: hours.success ? hours.data : closedWeek(),
    printers: printers.success ? printers.data : [],
  };
}
