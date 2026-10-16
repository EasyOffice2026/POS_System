import {
  type BrandSettings,
  type BrandSettingsRequest,
  brandSettingsRequestSchema,
  MAX_KITCHEN_STATIONS,
  MAX_PAYMENT_METHODS,
  type StockDeductAt,
  type TicketDoneBy,
  type VoidRule,
} from '@pos/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { BilingualNameFields } from '../../components/BilingualNameFields';
import {
  fieldAttributes,
  fieldClass,
  FormField,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../components/form';
import { localize } from '../../i18n/localize';
import { fieldsFromIssues, messageFor, problemsFrom } from '../../lib/error-messages';
import { normalizeNumberInput } from '../../lib/numbers';
import { useAuth } from '../auth/auth-context';
import { useMenuBrand } from '../menu/use-menu-brand';
import { settingsKeys, updateBrandSettings, useBrandSettings } from './settings-api';

interface MethodRow {
  key: string;
  name: { en: string; ar: string };
  isActive: boolean;
  // A method that was saved keeps its key: payments point at it.
  saved: boolean;
}

interface StationRow {
  id?: string;
  name: { en: string; ar: string };
}

interface FormState {
  methods: MethodRow[];
  // The discount buttons as typed: "5, 10, 15".
  presets: string;
  cashierLimit: string;
  voidRule: VoidRule;
  doneBy: TicketDoneBy;
  deductAt: StockDeductAt;
  stations: StationRow[];
  // The loyalty rules as typed (spec 022).
  // Who is told about voids, one address per line or comma (docs/client-decisions.md).
  voidEmails: string;
  loyaltyOn: boolean;
  pointsPerKwd: string;
  pointValue: string;
  minRedeem: string;
}

// A whole number as typed; anything else is left for the rules to refuse.
const wholeNumber = (text: string) => {
  const typed = normalizeNumberInput(text).trim();
  return /^\d+$/.test(typed) ? Number(typed) : Number.NaN;
};

function toForm(settings: BrandSettings): FormState {
  return {
    methods: settings.paymentMethods.map((method) => ({ ...method, saved: true })),
    presets: settings.discountPresets.map((preset) => Number(preset).toString()).join(', '),
    cashierLimit: Number(settings.cashierDiscountLimit).toString(),
    voidRule: settings.voidNeedsManager,
    doneBy: settings.ticketDoneBy,
    deductAt: settings.stockDeductAt,
    stations: settings.kitchenStations.map((station) => ({ ...station })),
    voidEmails: settings.alerts.voidEmails.join('\n'),
    loyaltyOn: settings.loyalty.enabled,
    pointsPerKwd: String(settings.loyalty.pointsPerKwd),
    pointValue: settings.loyalty.pointValue,
    minRedeem: String(settings.loyalty.minRedeem),
  };
}

function toRequest(form: FormState): BrandSettingsRequest {
  return {
    paymentMethods: form.methods.map(({ key, name, isActive }) => ({ key, name, isActive })),
    discountPresets: form.presets
      .split(/[,،\s]+/)
      .map((preset) => normalizeNumberInput(preset).trim())
      .filter((preset) => preset !== ''),
    cashierDiscountLimit: normalizeNumberInput(form.cashierLimit).trim(),
    voidNeedsManager: form.voidRule,
    ticketDoneBy: form.doneBy,
    stockDeductAt: form.deductAt,
    kitchenStations: form.stations.map((station) =>
      station.id ? { id: station.id, name: station.name } : { name: station.name },
    ),
    alerts: {
      voidEmails: form.voidEmails
        .split(/[\n,،;\s]+/)
        .map((email) => email.trim())
        .filter((email) => email !== ''),
    },
    loyalty: {
      enabled: form.loyaltyOn,
      pointsPerKwd: wholeNumber(form.pointsPerKwd),
      pointValue: normalizeNumberInput(form.pointValue).trim(),
      minRedeem: wholeNumber(form.minRedeem),
    },
  };
}

const sectionClass = 'space-y-3 rounded-lg border border-slate-200 bg-white p-4';

function SettingsForm({ brandId, settings }: { brandId: string; settings: BrandSettings }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(() => toForm(settings));
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [formProblem, setFormProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: (body: BrandSettingsRequest) => updateBrandSettings(brandId, body),
    onSuccess: (next) => {
      queryClient.setQueryData(settingsKeys.brand(brandId), next);
      setForm(toForm(next));
      setProblems({});
      setSaved(true);
    },
    onError: (error) => {
      const found = problemsFrom(error);
      setProblems(found.fields);
      setFormProblem(found.form);
    },
  });

  const change = (next: Partial<FormState>) => {
    setForm((current) => ({ ...current, ...next }));
    setSaved(false);
  };
  const error = (field: string) => (problems[field] ? messageFor(problems[field], t) : undefined);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormProblem(null);
    setSaved(false);
    const body = toRequest(form);
    const result = brandSettingsRequestSchema.safeParse(body);
    const found = result.success ? {} : fieldsFromIssues(result.error.issues);
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    save.mutate(body);
  }

  const radio = <T extends string>(
    name: string,
    value: T,
    current: T,
    onPick: (value: T) => void,
    label: string,
  ) => (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="radio"
        name={name}
        value={value}
        checked={current === value}
        onChange={() => onPick(value)}
        className="mt-1"
      />
      <span>{label}</span>
    </label>
  );

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <section className={sectionClass} aria-labelledby="settings-payment">
        <h2 id="settings-payment" className="text-lg font-semibold">
          {t('settings.payment.title')}
        </h2>
        <p className="text-sm text-slate-600">{t('settings.payment.intro')}</p>
        {error('paymentMethods') && (
          <p role="alert" className="text-sm text-red-700">
            {error('paymentMethods')}
          </p>
        )}
        <ul className="space-y-3">
          {form.methods.map((method, index) => (
            <li key={index} className="space-y-2 rounded-md border border-slate-200 p-3">
              <div className="flex flex-wrap items-end gap-3">
                <FormField
                  id={`method-${index}-key`}
                  label={t('settings.payment.key')}
                  hint={method.saved ? undefined : t('settings.payment.keyHint')}
                  error={error(`paymentMethods.${index}.key`)}
                >
                  <input
                    id={`method-${index}-key`}
                    type="text"
                    dir="ltr"
                    disabled={method.saved}
                    value={method.key}
                    onChange={(event) =>
                      change({
                        methods: form.methods.map((row, i) =>
                          i === index ? { ...row, key: event.target.value } : row,
                        ),
                      })
                    }
                    className={fieldClass}
                  />
                </FormField>
                <label className="flex items-center gap-2 pb-2 text-sm">
                  <input
                    type="checkbox"
                    checked={method.isActive}
                    onChange={(event) =>
                      change({
                        methods: form.methods.map((row, i) =>
                          i === index ? { ...row, isActive: event.target.checked } : row,
                        ),
                      })
                    }
                  />
                  {t('settings.payment.active')}
                </label>
                <button
                  type="button"
                  onClick={() => change({ methods: form.methods.filter((_, i) => i !== index) })}
                  className={secondaryButtonClass}
                >
                  {t('settings.remove')}
                </button>
              </div>
              <BilingualNameFields
                idPrefix={`method-${index}`}
                value={method.name}
                onChange={(name) =>
                  change({
                    methods: form.methods.map((row, i) => (i === index ? { ...row, name } : row)),
                  })
                }
                errors={{
                  en: error(`paymentMethods.${index}.name.en`),
                  ar: error(`paymentMethods.${index}.name.ar`),
                }}
              />
            </li>
          ))}
        </ul>
        <button
          type="button"
          disabled={form.methods.length >= MAX_PAYMENT_METHODS}
          onClick={() =>
            change({
              methods: [
                ...form.methods,
                { key: '', name: { en: '', ar: '' }, isActive: true, saved: false },
              ],
            })
          }
          className={secondaryButtonClass}
        >
          {t('settings.payment.add')}
        </button>
      </section>

      <section className={sectionClass} aria-labelledby="settings-discounts">
        <h2 id="settings-discounts" className="text-lg font-semibold">
          {t('settings.discounts.title')}
        </h2>
        <FormField
          id="discount-presets"
          label={t('settings.discounts.presets')}
          hint={t('settings.discounts.presetsHint')}
          error={error('discountPresets')}
        >
          <input
            id="discount-presets"
            type="text"
            dir="ltr"
            value={form.presets}
            onChange={(event) => change({ presets: event.target.value })}
            className={fieldClass}
          />
        </FormField>
        <FormField
          id="cashier-limit"
          label={t('settings.discounts.limit')}
          hint={t('settings.discounts.limitHint')}
          error={error('cashierDiscountLimit')}
        >
          <input
            id="cashier-limit"
            type="text"
            inputMode="decimal"
            dir="ltr"
            value={form.cashierLimit}
            onChange={(event) => change({ cashierLimit: event.target.value })}
            className={`${fieldClass} max-w-xs`}
          />
        </FormField>
      </section>

      <section className={sectionClass} aria-labelledby="settings-voids">
        <h2 id="settings-voids" className="text-lg font-semibold">
          {t('settings.voids.title')}
        </h2>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-700">{t('settings.voids.rule')}</legend>
          {radio(
            'voidRule',
            'never',
            form.voidRule,
            (voidRule) => change({ voidRule }),
            t('settings.voids.never'),
          )}
          {radio(
            'voidRule',
            'after_send',
            form.voidRule,
            (voidRule) => change({ voidRule }),
            t('settings.voids.afterSend'),
          )}
          {radio(
            'voidRule',
            'always',
            form.voidRule,
            (voidRule) => change({ voidRule }),
            t('settings.voids.always'),
          )}
        </fieldset>
      </section>

      <section className={sectionClass} aria-labelledby="settings-kitchen">
        <h2 id="settings-kitchen" className="text-lg font-semibold">
          {t('settings.kitchen.title')}
        </h2>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-700">
            {t('settings.kitchen.doneBy')}
          </legend>
          {radio(
            'doneBy',
            'kitchen',
            form.doneBy,
            (doneBy) => change({ doneBy }),
            t('settings.kitchen.doneByKitchen'),
          )}
          {radio(
            'doneBy',
            'cashier',
            form.doneBy,
            (doneBy) => change({ doneBy }),
            t('settings.kitchen.doneByCashier'),
          )}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-700">
            {t('settings.kitchen.deductAt')}
          </legend>
          {radio(
            'deductAt',
            'paid',
            form.deductAt,
            (deductAt) => change({ deductAt }),
            t('settings.kitchen.deductAtPaid'),
          )}
          {radio(
            'deductAt',
            'preparing',
            form.deductAt,
            (deductAt) => change({ deductAt }),
            t('settings.kitchen.deductAtPreparing'),
          )}
        </fieldset>

        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">{t('settings.kitchen.stations')}</p>
          <p className="text-xs text-slate-500">{t('settings.kitchen.stationsHint')}</p>
          {error('kitchenStations') && (
            <p role="alert" className="text-sm text-red-700">
              {error('kitchenStations')}
            </p>
          )}
          <ul className="space-y-3">
            {form.stations.map((station, index) => (
              <li
                key={station.id ?? `new-${index}`}
                className="flex flex-wrap items-end gap-3 rounded-md border border-slate-200 p-3"
              >
                <div className="min-w-0 flex-1">
                  <BilingualNameFields
                    idPrefix={`station-${index}`}
                    value={station.name}
                    onChange={(name) =>
                      change({
                        stations: form.stations.map((row, i) =>
                          i === index ? { ...row, name } : row,
                        ),
                      })
                    }
                    errors={{
                      en: error(`kitchenStations.${index}.name.en`),
                      ar: error(`kitchenStations.${index}.name.ar`),
                    }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => change({ stations: form.stations.filter((_, i) => i !== index) })}
                  className={secondaryButtonClass}
                >
                  {t('settings.remove')}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={form.stations.length >= MAX_KITCHEN_STATIONS}
            onClick={() => change({ stations: [...form.stations, { name: { en: '', ar: '' } }] })}
            className={secondaryButtonClass}
          >
            {t('settings.kitchen.addStation')}
          </button>
        </div>
      </section>

      <section className={sectionClass} aria-labelledby="settings-loyalty">
        <h2 id="settings-loyalty" className="text-lg font-semibold">
          {t('settings.loyalty.title')}
        </h2>
        <p className="text-sm text-slate-600">{t('settings.loyalty.intro')}</p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.loyaltyOn}
            onChange={(event) => change({ loyaltyOn: event.target.checked })}
          />
          {t('settings.loyalty.enabled')}
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField
            id="loyalty-rate"
            label={t('settings.loyalty.pointsPerKwd')}
            hint={t('settings.loyalty.pointsPerKwdHint')}
            error={error('loyalty.pointsPerKwd')}
          >
            <input
              {...fieldAttributes('loyalty-rate', {
                hint: true,
                error: Boolean(error('loyalty.pointsPerKwd')),
              })}
              type="text"
              inputMode="numeric"
              dir="ltr"
              value={form.pointsPerKwd}
              onChange={(event) => change({ pointsPerKwd: event.target.value })}
              className={fieldClass}
            />
          </FormField>
          <FormField
            id="loyalty-value"
            label={t('settings.loyalty.pointValue')}
            hint={t('settings.loyalty.pointValueHint')}
            error={error('loyalty.pointValue')}
          >
            <input
              {...fieldAttributes('loyalty-value', {
                hint: true,
                error: Boolean(error('loyalty.pointValue')),
              })}
              type="text"
              inputMode="decimal"
              dir="ltr"
              value={form.pointValue}
              onChange={(event) => change({ pointValue: event.target.value })}
              className={fieldClass}
            />
          </FormField>
          <FormField
            id="loyalty-min"
            label={t('settings.loyalty.minRedeem')}
            hint={t('settings.loyalty.minRedeemHint')}
            error={error('loyalty.minRedeem')}
          >
            <input
              {...fieldAttributes('loyalty-min', {
                hint: true,
                error: Boolean(error('loyalty.minRedeem')),
              })}
              type="text"
              inputMode="numeric"
              dir="ltr"
              value={form.minRedeem}
              onChange={(event) => change({ minRedeem: event.target.value })}
              className={fieldClass}
            />
          </FormField>
        </div>
      </section>

      <section className={sectionClass} aria-labelledby="settings-alerts">
        <h2 id="settings-alerts" className="text-lg font-semibold">
          {t('settings.alerts.title')}
        </h2>
        <p className="text-sm text-slate-600">{t('settings.alerts.intro')}</p>
        <FormField
          id="void-emails"
          label={t('settings.alerts.voidEmails')}
          hint={t('settings.alerts.voidEmailsHint')}
          error={error('alerts.voidEmails') ?? error('alerts.voidEmails.0')}
        >
          <textarea
            {...fieldAttributes('void-emails', {
              hint: true,
              error: Boolean(error('alerts.voidEmails') ?? error('alerts.voidEmails.0')),
            })}
            dir="ltr"
            rows={3}
            value={form.voidEmails}
            onChange={(event) => change({ voidEmails: event.target.value })}
            className={fieldClass}
          />
        </FormField>
      </section>

      {formProblem && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {messageFor(formProblem, t)}
        </p>
      )}
      {saved && (
        <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
          {t('settings.saved')}
        </p>
      )}
      <button type="submit" disabled={save.isPending} className={primaryButtonClass}>
        {save.isPending ? t('common.saving') : t('common.save')}
      </button>
    </form>
  );
}

// The settings of a brand: how it is paid, discounts, voids and the kitchen. A group admin picks
// the brand; a brand manager has their own. See docs/specs/009-settings.md.
export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [, setSearchParams] = useSearchParams();
  const menuBrand = useMenuBrand();
  const { brandId } = menuBrand;
  const settings = useBrandSettings(brandId);
  const chooseBrand = user?.brandId == null && menuBrand.brands.length > 1;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t('settings.title')}</h1>
      <p className="text-sm text-slate-600">{t('settings.intro')}</p>

      {chooseBrand && (
        <div className="max-w-sm">
          <label className="block text-sm font-medium text-slate-700">
            {t('settings.brand')}
            <select
              value={brandId ?? ''}
              onChange={(event) => setSearchParams({ brandId: event.target.value })}
              className={fieldClass}
            >
              {menuBrand.brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {localize(brand.name, i18n.language)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {(menuBrand.isLoading || (brandId && settings.isPending)) && (
        <p className="text-sm text-slate-500">{t('common.loading')}</p>
      )}
      {(menuBrand.isError || settings.isError) && (
        <p role="alert" className="text-sm text-red-700">
          {t('common.loadError')}
        </p>
      )}
      {brandId && settings.data && (
        <SettingsForm key={brandId} brandId={brandId} settings={settings.data} />
      )}
    </div>
  );
}
