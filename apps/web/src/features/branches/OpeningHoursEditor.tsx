import {
  type BranchDetail,
  MAX_RANGES_PER_DAY,
  type OpeningHours,
  openingHoursSchema,
  type Weekday,
  weekdays,
} from '@pos/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { compactFieldClass, primaryButtonClass } from '../../components/form';
import { fieldsFromIssues, fieldsUnder, messageFor, problemsFrom } from '../../lib/error-messages';
import { updateBranch } from './branches-api';

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

type WeekState = Record<Weekday, DayState>;

const NEW_RANGE: RangeState = { open: '09:00', close: '17:00' };

function toState(hours: OpeningHours): WeekState {
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

function toRequest(week: WeekState): OpeningHours {
  return Object.fromEntries(
    weekdays.map((day) => {
      const { kind, ranges } = week[day];
      return [day, kind === 'ranges' ? { kind, ranges } : { kind }];
    }),
  ) as OpeningHours;
}

interface DayEditorProps {
  day: Weekday;
  value: DayState;
  // The problems of the whole week, as messages by path, for example monday.ranges.0.close.
  errors: Record<string, string>;
  disabled: boolean;
  onChange: (next: DayState) => void;
  onCopyToAll: () => void;
}

function DayEditor({ day, value, errors, disabled, onChange, onCopyToAll }: DayEditorProps) {
  const { t } = useTranslation();
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
        <div className="sm:w-52 sm:shrink-0">
          <select
            aria-label={t('hours.modeLabel', { day: name })}
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
            <option value="closed">{t('hours.modes.closed')}</option>
            <option value="all_day">{t('hours.modes.all_day')}</option>
            <option value="ranges">{t('hours.modes.ranges')}</option>
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
                        aria-label={t('hours.opensLabel', { day: name, n: index + 1 })}
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
                        aria-label={t('hours.closesLabel', { day: name, n: index + 1 })}
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

// The opening hours of a branch, a day at a time. Saving checks them against the shared rules
// first, so a problem shows on the day or the range that has it.
export function OpeningHoursEditor({
  branch,
  readOnly,
}: {
  branch: BranchDetail;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [week, setWeek] = useState<WeekState>(() => toState(branch.config.openingHours));
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [formProblem, setFormProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const change = (day: Weekday, next: DayState) => {
    setWeek((current) => ({ ...current, [day]: next }));
    setSaved(false);
  };

  const copyToAll = (day: Weekday) => {
    const source = week[day];
    setWeek(
      Object.fromEntries(
        weekdays.map((name) => [
          name,
          { kind: source.kind, ranges: source.ranges.map((range) => ({ ...range })) },
        ]),
      ) as WeekState,
    );
    setSaved(false);
  };

  const save = useMutation({
    mutationFn: (hours: OpeningHours) =>
      updateBranch(branch.id, { config: { openingHours: hours } }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(['branch', updated.id], updated);
      await queryClient.invalidateQueries({ queryKey: ['branches'] });
      setWeek(toState(updated.config.openingHours));
      setProblems({});
      setSaved(true);
    },
    onError: (error) => {
      const found = problemsFrom(error, { notFound: 'ITEM_NOT_FOUND' });
      setProblems(fieldsUnder(found.fields, 'config.openingHours'));
      setFormProblem(found.form);
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    setFormProblem(null);

    const hours = toRequest(week);
    const result = openingHoursSchema.safeParse(hours);
    const found = result.success ? {} : fieldsFromIssues(result.error.issues);
    setProblems(found);
    if (Object.keys(found).length > 0) return;

    save.mutate(hours);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <p className="text-sm text-slate-600">{t('hours.intro')}</p>

      <div className="space-y-3">
        {weekdays.map((day) => (
          <DayEditor
            key={day}
            day={day}
            value={week[day]}
            errors={problems}
            disabled={readOnly}
            onChange={(next) => change(day, next)}
            onCopyToAll={() => copyToAll(day)}
          />
        ))}
      </div>

      {formProblem && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {messageFor(formProblem, t)}
        </p>
      )}
      {saved && (
        <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
          {t('hours.saved')}
        </p>
      )}

      {!readOnly && (
        <button type="submit" disabled={save.isPending} className={primaryButtonClass}>
          {save.isPending ? t('common.saving') : t('common.save')}
        </button>
      )}
    </form>
  );
}
