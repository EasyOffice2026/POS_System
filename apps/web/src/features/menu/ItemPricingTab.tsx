import {
  type Branch,
  type BranchOverride,
  type MenuItemDetail,
  putBranchOverrideRequestSchema,
} from '@pos/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActiveBadge } from '../../components/ActiveBadge';
import {
  FormField,
  fieldAttributes,
  fieldClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../components/form';
import { Price, PriceInput } from '../../components/Price';
import {
  allDayWeek,
  toOpeningHours,
  toWeekState,
  WeekHoursFields,
  type WeekState,
} from '../../components/WeekHoursFields';
import { localize } from '../../i18n/localize';
import { fieldsFromIssues, fieldsUnder, messageFor, problemsFrom } from '../../lib/error-messages';
import { listOverrides, menuKeys, type PutBranchOverrideInput, putOverride } from './menu-api';
import { describeSchedule } from './schedule-summary';

// What the branch changes nothing about is the same as having no override.
const isDefault = (override: Pick<BranchOverride, 'price' | 'isAvailable' | 'schedule'>) =>
  override.price === null && override.isAvailable && override.schedule === null;

interface OverrideFormProps {
  item: MenuItemDetail;
  branch: Branch;
  override: BranchOverride | undefined;
  onDone: (result: 'saved' | 'reset' | null) => void;
}

// All that one branch changes about the item: its price, whether it is on, and when it can be
// sold. The server keeps only the differences, so putting everything back removes the override.
function OverrideForm({ item, branch, override, onDone }: OverrideFormProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [price, setPrice] = useState(override?.price ?? '');
  const [isAvailable, setIsAvailable] = useState(override?.isAvailable ?? true);
  const [limited, setLimited] = useState(override?.schedule != null);
  const [week, setWeek] = useState<WeekState>(() =>
    override?.schedule ? toWeekState(override.schedule) : allDayWeek(),
  );
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [formProblem, setFormProblem] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: PutBranchOverrideInput) => putOverride(item.id, body),
    onSuccess: (saved) => {
      queryClient.setQueryData<BranchOverride[]>(menuKeys.overrides(item.id), (list) => {
        const others = (list ?? []).filter((entry) => entry.branchId !== saved.branchId);
        return isDefault(saved) ? others : [...others, saved];
      });
      void queryClient.invalidateQueries({ queryKey: menuKeys.branchMenu(saved.branchId) });
      onDone(isDefault(saved) ? 'reset' : 'saved');
    },
    onError: (error) => {
      const found = problemsFrom(error, { notFound: 'ITEM_NOT_FOUND' });
      setProblems(found.fields);
      setFormProblem(found.form ?? found.fields.branchId ?? null);
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormProblem(null);

    const body: PutBranchOverrideInput = {
      branchId: branch.id,
      price: price.trim() === '' ? null : price,
      isAvailable,
      schedule: limited ? toOpeningHours(week) : null,
    };
    const result = putBranchOverrideRequestSchema.safeParse(body);
    const found = result.success ? {} : fieldsFromIssues(result.error.issues);
    setProblems(found);
    if (Object.keys(found).length > 0) return;

    save.mutate(body);
  }

  const priceId = `override-price-${branch.id}`;
  const whenId = `override-when-${branch.id}`;

  return (
    <form onSubmit={onSubmit} noValidate className="mt-4 space-y-4 border-t border-slate-200 pt-4">
      <FormField
        id={priceId}
        label={t('menu.pricing.form.price')}
        hint={t('menu.pricing.form.priceHint', { price: item.basePrice })}
        error={problems.price ? messageFor(problems.price, t) : undefined}
      >
        <PriceInput
          {...fieldAttributes(priceId, { hint: true, error: Boolean(problems.price) })}
          value={price}
          onChange={setPrice}
          className={`${fieldClass} max-w-xs`}
        />
      </FormField>

      <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <input
          type="checkbox"
          checked={isAvailable}
          onChange={(event) => setIsAvailable(event.target.checked)}
        />
        {t('menu.pricing.form.available')}
      </label>

      <FormField id={whenId} label={t('menu.pricing.form.when')}>
        <select
          id={whenId}
          value={limited ? 'times' : 'always'}
          onChange={(event) => setLimited(event.target.value === 'times')}
          className={`${fieldClass} max-w-xs`}
        >
          <option value="always">{t('menu.pricing.form.always')}</option>
          <option value="times">{t('menu.pricing.form.certainTimes')}</option>
        </select>
      </FormField>

      {limited && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">{t('menu.pricing.form.scheduleHint')}</p>
          <WeekHoursFields
            week={week}
            onChange={setWeek}
            errors={fieldsUnder(problems, 'schedule')}
            disabled={false}
            variant="availability"
          />
        </div>
      )}

      {formProblem && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {messageFor(formProblem, t)}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={save.isPending} className={primaryButtonClass}>
          {save.isPending ? t('common.saving') : t('common.save')}
        </button>
        <button type="button" onClick={() => onDone(null)} className={secondaryButtonClass}>
          {t('common.cancel')}
        </button>
        {override && (
          <button
            type="button"
            disabled={save.isPending}
            onClick={() =>
              save.mutate({ branchId: branch.id, price: null, isAvailable: true, schedule: null })
            }
            className={secondaryButtonClass}
          >
            {t('menu.pricing.form.reset')}
          </button>
        )}
      </div>
    </form>
  );
}

interface ItemPricingTabProps {
  item: MenuItemDetail;
  // The branches of the brand of the item that the person may see.
  branches: Branch[];
  readOnly: boolean;
}

// The branches of the brand, and what each one changes about this item.
export function ItemPricingTab({ item, branches, readOnly }: ItemPricingTabProps) {
  const { t, i18n } = useTranslation();
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'saved' | 'reset'; name: string } | null>(null);

  const overrides = useQuery({
    queryKey: menuKeys.overrides(item.id),
    queryFn: () => listOverrides(item.id),
  });
  const byBranch = new Map((overrides.data ?? []).map((override) => [override.branchId, override]));
  const otherLanguage = i18n.language === 'ar' ? 'en' : 'ar';

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{t('menu.pricing.intro')}</p>

      {notice && (
        <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
          {t(`menu.pricing.messages.${notice.kind}`, { name: notice.name })}
        </p>
      )}

      {overrides.isPending && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {overrides.isError && (
        <p role="alert" className="text-sm text-red-700">
          {t('common.loadError')}
        </p>
      )}
      {overrides.isSuccess && branches.length === 0 && (
        <p className="text-sm text-slate-500">{t('menu.pricing.empty')}</p>
      )}

      {overrides.isSuccess && (
        <ul className="space-y-3">
          {branches.map((branch) => {
            const override = byBranch.get(branch.id);
            const name = localize(branch.name, i18n.language);

            return (
              <li key={branch.id} className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                      {name}
                      {!branch.isActive && <ActiveBadge isActive={false} />}
                    </p>
                    <p className="text-xs text-slate-500">
                      <bdi lang={otherLanguage} dir="auto">
                        {branch.name[otherLanguage]}
                      </bdi>
                    </p>
                  </div>
                  {!readOnly && editing !== branch.id && (
                    <button
                      type="button"
                      aria-label={t('menu.pricing.editFor', { name })}
                      onClick={() => {
                        setNotice(null);
                        setEditing(branch.id);
                      }}
                      className={secondaryButtonClass}
                    >
                      {t('menu.pricing.edit')}
                    </button>
                  )}
                </div>

                <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-slate-500">{t('menu.pricing.columns.price')}</dt>
                    <dd className="text-slate-900">
                      <Price value={override?.price ?? item.basePrice} />
                      {override?.price == null && (
                        <span className="ms-2 text-xs text-slate-500">
                          {t('menu.pricing.brandPrice')}
                        </span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">
                      {t('menu.pricing.columns.availability')}
                    </dt>
                    <dd className="text-slate-900">
                      {override && !override.isAvailable
                        ? t('menu.pricing.switchedOff')
                        : t('menu.pricing.available')}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">{t('menu.pricing.columns.when')}</dt>
                    <dd className="text-slate-900">
                      {override?.schedule
                        ? describeSchedule(override.schedule, t)
                        : t('menu.pricing.always')}
                    </dd>
                  </div>
                </dl>

                {editing === branch.id && (
                  <OverrideForm
                    item={item}
                    branch={branch}
                    override={override}
                    onDone={(result) => {
                      setEditing(null);
                      setNotice(result ? { kind: result, name } : null);
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
