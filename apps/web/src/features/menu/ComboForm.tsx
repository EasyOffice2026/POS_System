import {
  type Combo,
  createComboRequestSchema,
  type MenuCategory,
  type MenuItem,
  MAX_COMBO_SLOTS,
  MAX_SLOT_OPTIONS,
  priceChangeSchema,
  priceSchema,
  type UpdateComboRequest,
  updateComboRequestSchema,
} from '@pos/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { BilingualNameFields } from '../../components/BilingualNameFields';
import {
  compactFieldClass,
  FormField,
  fieldAttributes,
  fieldClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../components/form';
import { PriceInput } from '../../components/Price';
import { localize } from '../../i18n/localize';
import { fieldsFromIssues, messageFor, problemsFrom } from '../../lib/error-messages';
import { type CreateComboInput, createCombo, menuKeys, updateCombo } from './menu-api';

interface OptionState {
  itemId: string;
  priceDelta: string;
}

interface SlotState {
  en: string;
  ar: string;
  options: OptionState[];
}

interface FormState {
  en: string;
  ar: string;
  price: string;
  isActive: boolean;
  slots: SlotState[];
}

const emptyOption = (): OptionState => ({ itemId: '', priceDelta: '' });
const emptySlot = (): SlotState => ({ en: '', ar: '', options: [emptyOption()] });

function initialState(existing: Combo | null): FormState {
  if (!existing) return { en: '', ar: '', price: '', isActive: true, slots: [emptySlot()] };
  return {
    en: existing.name.en,
    ar: existing.name.ar,
    price: existing.price,
    isActive: existing.isActive,
    slots: existing.slots.map((slot) => ({
      en: slot.name.en,
      ar: slot.name.ar,
      options: slot.options.map((option) => ({
        itemId: option.itemId,
        priceDelta: option.priceDelta,
      })),
    })),
  };
}

// An extra charge left empty is no extra charge.
const deltaOf = (text: string) => (text.trim() === '' ? '0.000' : text);

function slotsBody(form: FormState) {
  return form.slots.map((slot) => ({
    name: { en: slot.en, ar: slot.ar },
    options: slot.options.map((option) => ({
      itemId: option.itemId,
      priceDelta: deltaOf(option.priceDelta),
    })),
  }));
}

function newComboBody(form: FormState, brandId: string): CreateComboInput {
  return {
    brandId,
    name: { en: form.en, ar: form.ar },
    price: form.price,
    slots: slotsBody(form),
    isActive: form.isActive,
  };
}

// The slots as they are compared with the saved ones: the same prices written the same way.
function comparableSlots(
  slots: { en: string; ar: string; options: { itemId: string; priceDelta: string }[] }[],
) {
  return JSON.stringify(
    slots.map((slot) => ({
      en: slot.en.trim(),
      ar: slot.ar.trim(),
      options: slot.options.map((option) => {
        const delta = priceChangeSchema.safeParse(deltaOf(option.priceDelta));
        return {
          itemId: option.itemId,
          priceDelta: delta.success ? delta.data : option.priceDelta,
        };
      }),
    })),
  );
}

// Only what the person changed. When the choices changed they are all sent, because they replace
// the choices of the combo.
function changesFrom(form: FormState, existing: Combo): UpdateComboRequest {
  const changes: UpdateComboRequest = {};

  if (form.en.trim() !== existing.name.en || form.ar.trim() !== existing.name.ar) {
    changes.name = { en: form.en, ar: form.ar };
  }
  const price = priceSchema.safeParse(form.price);
  if (!price.success || price.data !== existing.price) changes.price = form.price;
  if (form.isActive !== existing.isActive) changes.isActive = form.isActive;

  const saved = initialState(existing).slots;
  if (comparableSlots(form.slots) !== comparableSlots(saved)) changes.slots = slotsBody(form);
  return changes;
}

interface ComboFormProps {
  // The combo being changed, or null to create one.
  existing: Combo | null;
  brandId: string;
  items: MenuItem[];
  categories: MenuCategory[];
  readOnly: boolean;
}

// The names, price and choices of a combo. Each choice is one place in the combo, filled by one
// of the items allowed for it. The server checks everything again.
export function ComboForm({ existing, brandId, items, categories, readOnly }: ComboFormProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<FormState>(() => initialState(existing));
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [formProblem, setFormProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const change = (next: (current: FormState) => FormState) => {
    setForm(next);
    setSaved(false);
  };
  const changeSlot = (index: number, next: (slot: SlotState) => SlotState) =>
    change((current) => ({
      ...current,
      slots: current.slots.map((slot, at) => (at === index ? next(slot) : slot)),
    }));

  const save = useMutation({
    mutationFn: () =>
      existing
        ? updateCombo(existing.id, changesFrom(form, existing))
        : createCombo(newComboBody(form, brandId)),
    onSuccess: async (combo) => {
      queryClient.setQueryData(menuKeys.combo(combo.id), combo);
      await queryClient.invalidateQueries({ queryKey: menuKeys.combos(combo.brandId) });
      if (existing) setSaved(true);
      else void navigate(`/admin/menu/combos/${combo.id}`, { state: { notice: 'created' } });
    },
    onError: (error) => {
      const found = problemsFrom(error, { notFound: 'ITEM_NOT_FOUND' });
      setProblems(found.fields);
      setFormProblem(found.form);
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    setFormProblem(null);

    if (existing && Object.keys(changesFrom(form, existing)).length === 0) {
      setProblems({});
      setSaved(true);
      return;
    }

    const result = existing
      ? updateComboRequestSchema.safeParse(changesFrom(form, existing))
      : createComboRequestSchema.safeParse(newComboBody(form, brandId));
    const found = result.success ? {} : fieldsFromIssues(result.error.issues);
    // An item that was not chosen is not a valid id, but the sentence should say what to do.
    form.slots.forEach((slot, index) =>
      slot.options.forEach((option, at) => {
        if (!option.itemId) found[`slots.${index}.options.${at}.itemId`] = 'ITEM_REQUIRED';
      }),
    );
    setProblems(found);
    if (Object.keys(found).length > 0) return;

    save.mutate();
  }

  const error = (field: string) => (problems[field] ? messageFor(problems[field], t) : undefined);
  const language = i18n.language;

  // The items to choose from, by category. An item that is not active can only stay where it is.
  const chosen = new Set(form.slots.flatMap((slot) => slot.options.map((option) => option.itemId)));
  const groups = categories
    .map((category) => ({
      category,
      items: items.filter(
        (item) => item.categoryId === category.id && (item.isActive || chosen.has(item.id)),
      ),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-4"
    >
      <BilingualNameFields
        idPrefix="combo"
        value={{ en: form.en, ar: form.ar }}
        onChange={(name) => change((current) => ({ ...current, ...name }))}
        errors={{ en: error('name.en'), ar: error('name.ar') }}
        disabled={readOnly}
      />

      <FormField
        id="combo-price"
        label={t('menu.combo.form.price')}
        hint={t('menu.combo.form.priceHint')}
        error={error('price')}
      >
        <PriceInput
          {...fieldAttributes('combo-price', { hint: true, error: Boolean(problems.price) })}
          value={form.price}
          disabled={readOnly}
          onChange={(price) => change((current) => ({ ...current, price }))}
          className={`${fieldClass} max-w-xs`}
        />
      </FormField>

      <div className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{t('menu.combo.slots.title')}</h2>
          <p className="text-sm text-slate-600">{t('menu.combo.slots.hint')}</p>
          {error('slots') && <p className="mt-1 text-sm text-red-700">{error('slots')}</p>}
        </div>

        {form.slots.map((slot, index) => (
          <fieldset
            key={index}
            className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
          >
            <legend className="px-1 text-sm font-semibold text-slate-900">
              {t('menu.combo.slots.slotTitle', { n: index + 1 })}
            </legend>

            <BilingualNameFields
              idPrefix={`combo-slot-${index}`}
              value={{ en: slot.en, ar: slot.ar }}
              onChange={(name) => changeSlot(index, (current) => ({ ...current, ...name }))}
              errors={{
                en: error(`slots.${index}.name.en`),
                ar: error(`slots.${index}.name.ar`),
              }}
              disabled={readOnly}
            />

            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-700">{t('menu.combo.slots.options')}</p>
              <p className="text-xs text-slate-500">{t('menu.combo.slots.optionsHint')}</p>
              {error(`slots.${index}.options`) && (
                <p className="text-sm text-red-700">{error(`slots.${index}.options`)}</p>
              )}

              <ul className="space-y-2">
                {slot.options.map((option, at) => {
                  const itemProblem = error(`slots.${index}.options.${at}.itemId`);
                  const deltaProblem = error(`slots.${index}.options.${at}.priceDelta`);
                  const itemId = `combo-slot-${index}-option-${at}`;
                  const takenHere = new Set(
                    slot.options.filter((_, other) => other !== at).map((other) => other.itemId),
                  );

                  return (
                    <li key={at}>
                      <div className="flex flex-wrap items-start gap-2">
                        <select
                          id={itemId}
                          aria-label={t('menu.combo.slots.itemLabel', {
                            slot: index + 1,
                            n: at + 1,
                          })}
                          aria-invalid={itemProblem ? true : undefined}
                          aria-describedby={itemProblem ? `${itemId}-error` : undefined}
                          value={option.itemId}
                          disabled={readOnly}
                          onChange={(event) =>
                            changeSlot(index, (current) => ({
                              ...current,
                              options: current.options.map((entry, other) =>
                                other === at ? { ...entry, itemId: event.target.value } : entry,
                              ),
                            }))
                          }
                          className={`${compactFieldClass} min-w-0 flex-1 basis-56`}
                        >
                          <option value="">{t('menu.combo.slots.chooseItem')}</option>
                          {groups.map((group) => (
                            <optgroup
                              key={group.category.id}
                              label={
                                localize(group.category.name, language) +
                                (group.category.isActive ? '' : ` ${t('common.inactiveSuffix')}`)
                              }
                            >
                              {group.items
                                .filter((item) => !takenHere.has(item.id))
                                .map((item) => (
                                  <option key={item.id} value={item.id}>
                                    {localize(item.name, language) +
                                      (item.isActive ? '' : ` ${t('common.inactiveSuffix')}`)}
                                  </option>
                                ))}
                            </optgroup>
                          ))}
                        </select>

                        <PriceInput
                          aria-label={t('menu.combo.slots.deltaLabel', {
                            slot: index + 1,
                            n: at + 1,
                          })}
                          aria-invalid={deltaProblem ? true : undefined}
                          aria-describedby={deltaProblem ? `${itemId}-delta-error` : undefined}
                          placeholder="0.000"
                          value={option.priceDelta}
                          disabled={readOnly}
                          onChange={(priceDelta) =>
                            changeSlot(index, (current) => ({
                              ...current,
                              options: current.options.map((entry, other) =>
                                other === at ? { ...entry, priceDelta } : entry,
                              ),
                            }))
                          }
                          className={`${compactFieldClass} w-32`}
                        />

                        {!readOnly && (
                          <button
                            type="button"
                            aria-label={t('menu.combo.slots.removeOption', {
                              slot: index + 1,
                              n: at + 1,
                            })}
                            onClick={() =>
                              changeSlot(index, (current) => ({
                                ...current,
                                options: current.options.filter((_, other) => other !== at),
                              }))
                            }
                            className="rounded px-2 py-2 text-sm text-red-700 hover:bg-red-50"
                          >
                            <span aria-hidden="true">✕</span>
                          </button>
                        )}
                      </div>
                      {itemProblem && (
                        <p id={`${itemId}-error`} className="mt-1 text-sm text-red-700">
                          {itemProblem}
                        </p>
                      )}
                      {deltaProblem && (
                        <p id={`${itemId}-delta-error`} className="mt-1 text-sm text-red-700">
                          {deltaProblem}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>

              {!readOnly && slot.options.length < MAX_SLOT_OPTIONS && (
                <button
                  type="button"
                  aria-label={t('menu.combo.slots.addOptionTo', { n: index + 1 })}
                  onClick={() =>
                    changeSlot(index, (current) => ({
                      ...current,
                      options: [...current.options, emptyOption()],
                    }))
                  }
                  className="text-sm underline"
                >
                  {t('menu.combo.slots.addOption')}
                </button>
              )}
            </div>

            {!readOnly && form.slots.length > 1 && (
              <button
                type="button"
                onClick={() =>
                  change((current) => ({
                    ...current,
                    slots: current.slots.filter((_, at) => at !== index),
                  }))
                }
                className="text-sm text-red-700 underline"
              >
                {t('menu.combo.slots.removeSlot', { n: index + 1 })}
              </button>
            )}
          </fieldset>
        ))}

        {!readOnly && form.slots.length < MAX_COMBO_SLOTS && (
          <button
            type="button"
            onClick={() =>
              change((current) => ({ ...current, slots: [...current.slots, emptySlot()] }))
            }
            className={secondaryButtonClass}
          >
            {t('menu.combo.slots.addSlot')}
          </button>
        )}
      </div>

      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={form.isActive}
            disabled={readOnly}
            onChange={(event) =>
              change((current) => ({ ...current, isActive: event.target.checked }))
            }
          />
          {t('menu.combo.form.active')}
        </label>
        <p className="mt-1 text-xs text-slate-500">{t('menu.combo.form.activeHint')}</p>
      </div>

      {formProblem && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {messageFor(formProblem, t)}
        </p>
      )}
      {saved && (
        <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
          {t('menu.combo.saved')}
        </p>
      )}

      {!readOnly && (
        <div className="flex gap-3">
          <button type="submit" disabled={save.isPending} className={primaryButtonClass}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </button>
          {!existing && (
            <Link to={`/admin/menu/combos?brandId=${brandId}`} className={secondaryButtonClass}>
              {t('common.cancel')}
            </Link>
          )}
        </div>
      )}
    </form>
  );
}
