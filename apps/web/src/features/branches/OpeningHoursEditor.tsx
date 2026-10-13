import {
  type BranchDetail,
  dayEndSchema,
  type OpeningHours,
  openingHoursSchema,
} from '@pos/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fieldClass, FormField, primaryButtonClass } from '../../components/form';
import { normalizeNumberInput } from '../../lib/numbers';
import {
  toOpeningHours,
  toWeekState,
  type WeekState,
  WeekHoursFields,
} from '../../components/WeekHoursFields';
import { fieldsFromIssues, fieldsUnder, messageFor, problemsFrom } from '../../lib/error-messages';
import { updateBranch } from './branches-api';

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

  const [week, setWeek] = useState<WeekState>(() => toWeekState(branch.config.openingHours));
  // The hour the business day ends (spec 009, rule 4), saved with the hours.
  const [dayEndsAt, setDayEndsAt] = useState(branch.config.dayEndsAt);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [formProblem, setFormProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: (config: { openingHours: OpeningHours; dayEndsAt: string }) =>
      updateBranch(branch.id, { config }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(['branch', updated.id], updated);
      await queryClient.invalidateQueries({ queryKey: ['branches'] });
      setWeek(toWeekState(updated.config.openingHours));
      setDayEndsAt(updated.config.dayEndsAt);
      setProblems({});
      setSaved(true);
    },
    onError: (error) => {
      const found = problemsFrom(error, { notFound: 'ITEM_NOT_FOUND' });
      const config = fieldsUnder(found.fields, 'config');
      setProblems({
        ...fieldsUnder(config, 'openingHours'),
        ...(config.dayEndsAt ? { dayEndsAt: config.dayEndsAt } : {}),
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
    setProblems(found);
    if (Object.keys(found).length > 0) return;

    save.mutate({ openingHours: hours, dayEndsAt: end.success ? end.data : dayEndsAt });
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
