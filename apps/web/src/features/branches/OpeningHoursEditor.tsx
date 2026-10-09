import { type BranchDetail, type OpeningHours, openingHoursSchema } from '@pos/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { primaryButtonClass } from '../../components/form';
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
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [formProblem, setFormProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: (hours: OpeningHours) =>
      updateBranch(branch.id, { config: { openingHours: hours } }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(['branch', updated.id], updated);
      await queryClient.invalidateQueries({ queryKey: ['branches'] });
      setWeek(toWeekState(updated.config.openingHours));
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

    const hours = toOpeningHours(week);
    const result = openingHoursSchema.safeParse(hours);
    const found = result.success ? {} : fieldsFromIssues(result.error.issues);
    setProblems(found);
    if (Object.keys(found).length > 0) return;

    save.mutate(hours);
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
