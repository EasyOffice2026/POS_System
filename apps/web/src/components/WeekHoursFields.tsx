import { MAX_RANGES_PER_DAY, type OpeningHours, type Weekday, weekdays } from '@pos/shared';
import { useTranslation } from 'react-i18next';
import { messageFor } from '../lib/error-messages';
import { compactFieldClass } from './form';

type Kind = 'closed' | 'all_day' | 'ranges';

interface RangeState {
  open: string;
  close: string;
}

// A day as it is edited. The ranges are kept while the day is closed, so choosing "specific
// hours" again brings them back.
interface DayState {
  kind: Kind;
  ranges: RangeState[];
}

export type WeekState = Record<Weekday, DayState>;

const NEW_RANGE: RangeState = { open: '09:00', close: '17:00' };

export function toWeekState(hours: OpeningHours): WeekState {
  return Object.fromEntries(
    weekdays.map((day) => {
      const value = hours[day];
      const state: DayState =
        value.kind === 'ranges'
          ? { kind: 'ranges', ranges: value.ranges.map((range) => ({ ...range })) }
          : { kind: value.kind, ranges: [] };
      return [day, state];
    }),
  ) as WeekState;
}

export function toOpeningHours(week: WeekState): OpeningHours {
  return Object.fromEntries(
    weekdays.map((day) => {
      const { kind, ranges } = week[day];
      return [day, kind === 'ranges' ? { kind, ranges } : { kind }];
    }),
  ) as OpeningHours;
}

// The same week for a schedule that starts with nothing set: every day is all day.
export function allDayWeek(): WeekState {
  const allDay = (): DayState => ({ kind: 'all_day', ranges: [] });
  return Object.fromEntries(weekdays.map((day) => [day, allDay()])) as WeekState;
}

// The words of the week editor. The opening hours of a branch and the times an item can be sold
// are the same shape, so they share the editor, but each reads in its own words.
const labels = {
  opening: {
    modeLabel: 'hours.modeLabel',
    closed: 'hours.modes.closed',
    all_day: 'hours.modes.all_day',
    ranges: 'hours.modes.ranges',
    opensLabel: 'hours.opensLabel',
    closesLabel: 'hours.closesLabel',
  },
  availability: {
    modeLabel: 'menu.schedule.modeLabel',
    closed: 'menu.schedule.modes.closed',
    all_day: 'menu.schedule.modes.all_day',
    ranges: 'menu.schedule.modes.ranges',
    opensLabel: 'menu.schedule.opensLabel',
    closesLabel: 'menu.schedule.closesLabel',
  },
} as const;

export type WeekHoursVariant = keyof typeof labels;

interface DayEditorProps {
  day: Weekday;
  value: DayState;
  // The problems of the whole week, as messages by path, for example monday.ranges.0.close.
  errors: Record<string, string>;
  disabled: boolean;
  variant: WeekHoursVariant;
  onChange: (next: DayState) => void;
  onCopyToAll: () => void;
}

function DayEditor({
  day,
  value,
  errors,
  disabled,
  variant,
  onChange,
  onCopyToAll,
}: DayEditorProps) {
  const { t } = useTranslation();
  const words = labels[variant];
  const name = t(`weekdays.${day}`);
  const message = (path: string) => (errors[path] ? messageFor(errors[path], t) : undefined);
  const dayProblem = message(day) ?? message(`${day}.ranges`);

  const setRange = (index: number, change: Partial<RangeState>) =>
    onChange({
      ...value,
      ranges: value.ranges.map((range, at) => (at === index ? { ...range, ...change } : range)),
    });

  return (
    <fieldset className="rounded-lg border border-slate-200 bg-white p-3">
      <legend className="px-1 text-sm font-semibold text-slate-900">{name}</legend>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="sm:w-64 sm:shrink-0">
          <select
            aria-label={t(words.modeLabel, { day: name })}
            aria-invalid={dayProblem ? true : undefined}
            aria-describedby={dayProblem ? `hours-${day}-error` : undefined}
            value={value.kind}
            disabled={disabled}
            onChange={(event) => {
              const kind = event.target.value as Kind;
              onChange({
                kind,
                ranges:
                  kind === 'ranges' && value.ranges.length === 0
                    ? [{ ...NEW_RANGE }]
                    : value.ranges,
              });
            }}
            className={`${compactFieldClass} w-full`}
          >
            <option value="closed">{t(words.closed)}</option>
            <option value="all_day">{t(words.all_day)}</option>
            <option value="ranges">{t(words.ranges)}</option>
          </select>
          {!disabled && (
            <button type="button" onClick={onCopyToAll} className="mt-1 text-xs underline">
              {t('hours.copyToAll')}
            </button>
          )}
        </div>

        {value.kind === 'ranges' && (
          <div className="min-w-0 flex-1 space-y-2">
            {value.ranges.map((range, index) => {
              const opensProblem = message(`${day}.ranges.${index}.open`);
              const closesProblem = message(`${day}.ranges.${index}.close`);
              const nextDay = range.open !== '' && range.close !== '' && range.close < range.open;
              const rangeProblem = opensProblem ?? closesProblem;
              const rangeErrorId = `hours-${day}-${index}-error`;

              return (
                <div key={index}>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <span className="flex items-center gap-2">
                      <span aria-hidden="true" className="text-sm text-slate-600">
                        {t('hours.from')}
                      </span>
                      <input
                        type="time"
                        dir="ltr"
                        aria-label={t(words.opensLabel, { day: name, n: index + 1 })}
                        aria-invalid={opensProblem ? true : undefined}
                        aria-describedby={rangeProblem ? rangeErrorId : undefined}
                        value={range.open}
                        disabled={disabled}
                        onChange={(event) => setRange(index, { open: event.target.value })}
                        className={`${compactFieldClass} w-36`}
                      />
                    </span>
                    <span className="flex items-center gap-2">
                      <span aria-hidden="true" className="text-sm text-slate-600">
                        {t('hours.to')}
                      </span>
                      <input
                        type="time"
                        dir="ltr"
                        aria-label={t(words.closesLabel, { day: name, n: index + 1 })}
                        aria-invalid={closesProblem ? true : undefined}
                        aria-describedby={rangeProblem ? rangeErrorId : undefined}
                        value={range.close}
                        disabled={disabled}
                        onChange={(event) => setRange(index, { close: event.target.value })}
                        className={`${compactFieldClass} w-36`}
                      />
                      {nextDay && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                          {t('hours.nextDay')}
                        </span>
                      )}
                      {!disabled && (
                        <button
                          type="button"
                          aria-label={t('hours.removeRange', { day: name, n: index + 1 })}
                          onClick={() =>
                            onChange({
                              ...value,
                              ranges: value.ranges.filter((_, at) => at !== index),
                            })
                          }
                          className="rounded px-2 py-1 text-sm text-red-700 hover:bg-red-50"
                        >
                          <span aria-hidden="true">✕</span>
                        </button>
                      )}
                    </span>
                  </div>
                  {rangeProblem && (
                    <p id={rangeErrorId} className="mt-1 text-sm text-red-700">
                      {rangeProblem}
                    </p>
                  )}
                </div>
              );
            })}

            {!disabled && value.ranges.length < MAX_RANGES_PER_DAY && (
              <button
                type="button"
                onClick={() => onChange({ ...value, ranges: [...value.ranges, { ...NEW_RANGE }] })}
                className="text-sm underline"
              >
                {t('hours.addRange')}
              </button>
            )}
          </div>
        )}
      </div>

      {dayProblem && (
        <p id={`hours-${day}-error`} className="mt-2 text-sm text-red-700">
          {dayProblem}
        </p>
      )}
    </fieldset>
  );
}

interface WeekHoursFieldsProps {
  week: WeekState;
  onChange: (next: WeekState) => void;
  // The problems of the whole week as codes by path, for example monday.ranges.0.close.
  errors: Record<string, string>;
  disabled: boolean;
  variant: WeekHoursVariant;
}

// A week, a day at a time: closed, all day, or specific ranges that can pass midnight. Used for
// the opening hours of a branch and for the times an item can be sold.
export function WeekHoursFields({
  week,
  onChange,
  errors,
  disabled,
  variant,
}: WeekHoursFieldsProps) {
  const copyToAll = (day: Weekday) => {
    const source = week[day];
    onChange(
      Object.fromEntries(
        weekdays.map((name) => [
          name,
          { kind: source.kind, ranges: source.ranges.map((range) => ({ ...range })) },
        ]),
      ) as WeekState,
    );
  };

  return (
    <div className="space-y-3">
      {weekdays.map((day) => (
        <DayEditor
          key={day}
          day={day}
          value={week[day]}
          errors={errors}
          disabled={disabled}
          variant={variant}
          onChange={(next) => onChange({ ...week, [day]: next })}
          onCopyToAll={() => copyToAll(day)}
        />
      ))}
    </div>
  );
}
