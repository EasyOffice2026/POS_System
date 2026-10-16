import {
  type BranchDetail,
  dayEndSchema,
  MAX_SPECIAL_PERIODS,
  type OpeningHours,
  openingHoursSchema,
  type SpecialPeriodInput,
  specialHoursInputSchema,
} from '@pos/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  compactFieldClass,
  fieldAttributes,
  fieldClass,
  FormField,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../components/form';
import { normalizeNumberInput } from '../../lib/numbers';
import {
  toOpeningHours,
  toWeekState,
  type WeekState,
  WeekHoursFields,
} from '../../components/WeekHoursFields';
import { fieldsFromIssues, fieldsUnder, messageFor, problemsFrom } from '../../lib/error-messages';
import { updateBranch } from './branches-api';

// A special period as it is edited: Ramadan, Eid, a holiday. Its hours are closed, all day, or
// one range of the clock (docs/client-decisions.md).
interface PeriodState {
  key: string;
  id?: string;
  name: string;
  from: string;
  to: string;
  kind: 'closed' | 'all_day' | 'ranges';
  open: string;
  close: string;
}

function toPeriodStates(periods: BranchDetail['config']['specialHours']): PeriodState[] {
  return periods.map((period) => ({
    key: period.id,
    id: period.id,
    name: period.name,
    from: period.from,
    to: period.to,
    kind: period.hours.kind,
    open: period.hours.kind === 'ranges' ? (period.hours.ranges[0]?.open ?? '09:00') : '09:00',
    close: period.hours.kind === 'ranges' ? (period.hours.ranges[0]?.close ?? '17:00') : '17:00',
  }));
}

function toPeriodInputs(periods: PeriodState[]): SpecialPeriodInput[] {
  return periods.map(({ id, name, from, to, kind, open, close }) => ({
    ...(id ? { id } : {}),
    name,
    from,
    to,
    hours: kind === 'ranges' ? { kind, ranges: [{ open, close }] } : { kind },
  }));
}

// The opening hours of a branch, a day at a time, and its special periods. Saving checks them
// against the shared rules first, so a problem shows on the day, the range or the period that
// has it.
export function OpeningHoursEditor({
  branch,
  readOnly,
}: {
  branch: BranchDetail;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [week, setWeek] = useState<WeekState>(() => toWeekState(branch.config.openingHours));
  // The hour the business day ends (spec 009, rule 4), saved with the hours.
  const [dayEndsAt, setDayEndsAt] = useState(branch.config.dayEndsAt);
  const [periods, setPeriods] = useState<PeriodState[]>(() =>
    toPeriodStates(branch.config.specialHours),
  );
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [formProblem, setFormProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: (config: {
      openingHours: OpeningHours;
      dayEndsAt: string;
      specialHours: SpecialPeriodInput[];
    }) => updateBranch(branch.id, { config }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(['branch', updated.id], updated);
      await queryClient.invalidateQueries({ queryKey: ['branches'] });
      setWeek(toWeekState(updated.config.openingHours));
      setDayEndsAt(updated.config.dayEndsAt);
      setPeriods(toPeriodStates(updated.config.specialHours));
      setProblems({});
      setSaved(true);
    },
    onError: (error) => {
      const found = problemsFrom(error, { notFound: 'ITEM_NOT_FOUND' });
      const config = fieldsUnder(found.fields, 'config');
      setProblems({
        ...fieldsUnder(config, 'openingHours'),
        ...(config.dayEndsAt ? { dayEndsAt: config.dayEndsAt } : {}),
        ...Object.fromEntries(
          Object.entries(fieldsUnder(config, 'specialHours')).map(([key, code]) => [
            `special.${key}`,
            code,
          ]),
        ),
      });
      setFormProblem(found.form);
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    setFormProblem(null);

    const hours = toOpeningHours(week);
    const result = openingHoursSchema.safeParse(hours);
    const found = result.success ? {} : fieldsFromIssues(result.error.issues);
    const end = dayEndSchema.safeParse(dayEndsAt);
    if (!end.success) found.dayEndsAt = 'HOURS_TIME_FORMAT';
    const special = toPeriodInputs(periods);
    const specialResult = specialHoursInputSchema.safeParse(special);
    if (!specialResult.success) {
      for (const [key, code] of Object.entries(fieldsFromIssues(specialResult.error.issues))) {
        found[`special.${key}`] = code;
      }
    }
    setProblems(found);
    if (Object.keys(found).length > 0) return;

    save.mutate({
      openingHours: hours,
      dayEndsAt: end.success ? end.data : dayEndsAt,
      specialHours: special,
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <p className="text-sm text-slate-600">{t('hours.intro')}</p>

      <WeekHoursFields
        week={week}
        onChange={(next) => {
          setWeek(next);
          setSaved(false);
        }}
        errors={problems}
        disabled={readOnly}
        variant="opening"
      />

      <FormField
        id="day-ends-at"
        label={t('hours.dayEndsAt')}
        hint={t('hours.dayEndsAtHint')}
        error={problems.dayEndsAt ? messageFor(problems.dayEndsAt, t) : undefined}
      >
        <input
          id="day-ends-at"
          type="text"
          inputMode="numeric"
          dir="ltr"
          placeholder="00:00"
          maxLength={5}
          disabled={readOnly}
          value={dayEndsAt}
          onChange={(event) => {
            setDayEndsAt(normalizeNumberInput(event.target.value));
            setSaved(false);
          }}
          className={`${fieldClass} max-w-32`}
        />
      </FormField>

      <section
        aria-labelledby="special-hours-title"
        className="space-y-3 rounded-lg border border-slate-200 p-4"
      >
        <h3 id="special-hours-title" className="text-sm font-semibold">
          {t('hours.special.title')}
        </h3>
        <p className="text-sm text-slate-600">{t('hours.special.intro')}</p>
        {periods.length === 0 && (
          <p className="text-sm text-slate-500">{t('hours.special.none')}</p>
        )}
        <ul className="space-y-3">
          {periods.map((period, index) => {
            const problem = (field: string) =>
              problems[`special.${index}${field ? `.${field}` : ''}`];
            const message = (field: string) => {
              const code = problem(field);
              return code ? messageFor(code, t) : undefined;
            };
            const change = (next: Partial<PeriodState>) => {
              setPeriods((current) =>
                current.map((row) => (row.key === period.key ? { ...row, ...next } : row)),
              );
              setSaved(false);
            };
            return (
              <li
                key={period.key}
                className="space-y-2 rounded-md border border-slate-200 p-3"
                aria-label={period.name || t('hours.special.period')}
              >
                <div className="grid gap-3 sm:grid-cols-3">
                  <FormField
                    id={`special-${index}-name`}
                    label={t('hours.special.name')}
                    error={message('name')}
                  >
                    <input
                      {...fieldAttributes(`special-${index}-name`, {
                        error: Boolean(message('name')),
                      })}
                      type="text"
                      dir="auto"
                      maxLength={40}
                      disabled={readOnly}
                      value={period.name}
                      onChange={(event) => change({ name: event.target.value })}
                      className={fieldClass}
                    />
                  </FormField>
                  <FormField
                    id={`special-${index}-from`}
                    label={t('hours.special.from')}
                    error={message('from')}
                  >
                    <input
                      {...fieldAttributes(`special-${index}-from`, {
                        error: Boolean(message('from')),
                      })}
                      type="date"
                      dir="ltr"
                      disabled={readOnly}
                      value={period.from}
                      onChange={(event) => change({ from: event.target.value })}
                      className={fieldClass}
                    />
                  </FormField>
                  <FormField
                    id={`special-${index}-to`}
                    label={t('hours.special.to')}
                    error={message('to')}
                  >
                    <input
                      {...fieldAttributes(`special-${index}-to`, {
                        error: Boolean(message('to')),
                      })}
                      type="date"
                      dir="ltr"
                      disabled={readOnly}
                      value={period.to}
                      onChange={(event) => change({ to: event.target.value })}
                      className={fieldClass}
                    />
                  </FormField>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="block text-sm font-medium text-slate-700">
                    {t('hours.special.hours')}
                    <select
                      disabled={readOnly}
                      value={period.kind}
                      onChange={(event) =>
                        change({ kind: event.target.value as PeriodState['kind'] })
                      }
                      className={fieldClass}
                    >
                      <option value="closed">{t('hours.modes.closed')}</option>
                      <option value="all_day">{t('hours.modes.all_day')}</option>
                      <option value="ranges">{t('hours.modes.ranges')}</option>
                    </select>
                  </label>
                  {period.kind === 'ranges' && (
                    <>
                      <label className="block text-sm font-medium text-slate-700">
                        {t('hours.special.opens')}
                        <input
                          type="text"
                          inputMode="numeric"
                          dir="ltr"
                          maxLength={5}
                          disabled={readOnly}
                          value={period.open}
                          onChange={(event) =>
                            change({ open: normalizeNumberInput(event.target.value) })
                          }
                          className={`${compactFieldClass} ms-2 w-24`}
                        />
                      </label>
                      <label className="block text-sm font-medium text-slate-700">
                        {t('hours.special.closes')}
                        <input
                          type="text"
                          inputMode="numeric"
                          dir="ltr"
                          maxLength={5}
                          disabled={readOnly}
                          value={period.close}
                          onChange={(event) =>
                            change({ close: normalizeNumberInput(event.target.value) })
                          }
                          className={`${compactFieldClass} ms-2 w-24`}
                        />
                      </label>
                    </>
                  )}
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => {
                        setPeriods((current) => current.filter((row) => row.key !== period.key));
                        setSaved(false);
                      }}
                      className={secondaryButtonClass}
                    >
                      {t('hours.special.remove')}
                    </button>
                  )}
                </div>
                {(message('') ?? message('hours') ?? message('hours.ranges.0.close')) && (
                  <p role="alert" className="text-sm text-red-700">
                    {message('') ?? message('hours') ?? message('hours.ranges.0.close')}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        {!readOnly && (
          <button
            type="button"
            disabled={periods.length >= MAX_SPECIAL_PERIODS}
            onClick={() => {
              setPeriods((current) => [
                ...current,
                {
                  key: crypto.randomUUID(),
                  name: '',
                  from: '',
                  to: '',
                  kind: 'closed',
                  open: '09:00',
                  close: '17:00',
                },
              ]);
              setSaved(false);
            }}
            className={secondaryButtonClass}
          >
            {t('hours.special.add')}
          </button>
        )}
      </section>

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
