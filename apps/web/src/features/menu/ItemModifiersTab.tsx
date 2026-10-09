import {
  createModifierGroupRequestSchema,
  createModifierRequestSchema,
  type MenuItemDetail,
  type Modifier,
  type ModifierGroup,
  priceChangeSchema,
  type UpdateModifierGroupRequest,
  type UpdateModifierRequest,
  updateModifierGroupRequestSchema,
  updateModifierRequestSchema,
} from '@pos/shared';
import { type QueryClient, useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActiveBadge } from '../../components/ActiveBadge';
import { BilingualNameFields } from '../../components/BilingualNameFields';
import {
  FormField,
  fieldAttributes,
  fieldClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../components/form';
import { Price, PriceInput } from '../../components/Price';
import { localize } from '../../i18n/localize';
import { fieldsFromIssues, messageFor, problemsFrom } from '../../lib/error-messages';
import { normalizeNumberInput } from '../../lib/numbers';
import {
  createModifier,
  createModifierGroup,
  menuKeys,
  updateModifier,
  updateModifierGroup,
} from './menu-api';
import { describeChoices } from './modifier-rule';

type Notice = { kind: 'saved' } | { kind: 'problem'; code: string };

const smallButtonClass =
  'rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 focus:ring-2 focus:ring-slate-400 focus:outline-none disabled:opacity-40';

// What comes back from the server goes straight into the item that is on the screen.
function changeItem(
  queryClient: QueryClient,
  itemId: string,
  change: (item: MenuItemDetail) => MenuItemDetail,
) {
  queryClient.setQueryData<MenuItemDetail>(menuKeys.item(itemId), (item) =>
    item ? change(item) : item,
  );
}

const withGroup = (item: MenuItemDetail, group: ModifierGroup): MenuItemDetail => ({
  ...item,
  modifierGroups: item.modifierGroups.some((entry) => entry.id === group.id)
    ? item.modifierGroups.map((entry) => (entry.id === group.id ? group : entry))
    : [...item.modifierGroups, group],
});

const withModifier = (item: MenuItemDetail, modifier: Modifier): MenuItemDetail => ({
  ...item,
  modifierGroups: item.modifierGroups.map((group) =>
    group.id !== modifier.groupId
      ? group
      : {
          ...group,
          modifiers: group.modifiers.some((entry) => entry.id === modifier.id)
            ? group.modifiers.map((entry) => (entry.id === modifier.id ? modifier : entry))
            : [...group.modifiers, modifier],
        },
  ),
});

// ---- a group

interface GroupFormProps {
  item: MenuItemDetail;
  // The group being changed, or null to add one.
  existing: ModifierGroup | null;
  onDone: (saved: boolean) => void;
}

function GroupForm({ item, existing, onDone }: GroupFormProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [name, setName] = useState({ en: existing?.name.en ?? '', ar: existing?.name.ar ?? '' });
  const [minSelect, setMinSelect] = useState(String(existing?.minSelect ?? 0));
  const [maxSelect, setMaxSelect] = useState(String(existing?.maxSelect ?? 1));
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [formProblem, setFormProblem] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (changes: UpdateModifierGroupRequest | null) =>
      existing
        ? updateModifierGroup(existing.id, changes ?? {})
        : createModifierGroup(item.id, {
            name,
            minSelect: Number(minSelect),
            maxSelect: Number(maxSelect),
          }),
    onSuccess: (group) => {
      changeItem(queryClient, item.id, (current) => withGroup(current, group));
      if (!existing) {
        setName({ en: '', ar: '' });
        setMinSelect('0');
        setMaxSelect('1');
        setProblems({});
      }
      onDone(true);
    },
    onError: (error) => {
      const found = problemsFrom(error, { notFound: 'ITEM_NOT_FOUND' });
      setProblems(found.fields);
      setFormProblem(found.form);
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormProblem(null);

    const min = Number(minSelect);
    const max = Number(maxSelect);

    if (!existing) {
      const result = createModifierGroupRequestSchema.safeParse({
        name,
        minSelect: min,
        maxSelect: max,
      });
      const found = result.success ? {} : fieldsFromIssues(result.error.issues);
      setProblems(found);
      if (Object.keys(found).length === 0) save.mutate(null);
      return;
    }

    // Both numbers are sent when either changed, so the range is checked here as well.
    const changes: UpdateModifierGroupRequest = {};
    if (name.en.trim() !== existing.name.en || name.ar.trim() !== existing.name.ar) {
      changes.name = name;
    }
    if (min !== existing.minSelect || max !== existing.maxSelect) {
      changes.minSelect = min;
      changes.maxSelect = max;
    }
    if (Object.keys(changes).length === 0) {
      onDone(false);
      return;
    }
    const result = updateModifierGroupRequestSchema.safeParse(changes);
    const found = result.success ? {} : fieldsFromIssues(result.error.issues);
    setProblems(found);
    if (Object.keys(found).length === 0) save.mutate(changes);
  }

  const prefix = existing ? `group-${existing.id}` : 'new-group';
  const error = (field: string) => (problems[field] ? messageFor(problems[field], t) : undefined);

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
    >
      <BilingualNameFields
        idPrefix={prefix}
        value={name}
        onChange={setName}
        errors={{ en: error('name.en'), ar: error('name.ar') }}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id={`${prefix}-min`}
          label={t('menu.modifiers.group.minSelect')}
          hint={t('menu.modifiers.group.minSelectHint')}
          error={error('minSelect')}
        >
          <input
            {...fieldAttributes(`${prefix}-min`, {
              hint: true,
              error: Boolean(problems.minSelect),
            })}
            type="text"
            inputMode="numeric"
            dir="ltr"
            autoComplete="off"
            value={minSelect}
            onChange={(event) => setMinSelect(normalizeNumberInput(event.target.value))}
            className={fieldClass}
          />
        </FormField>
        <FormField
          id={`${prefix}-max`}
          label={t('menu.modifiers.group.maxSelect')}
          hint={t('menu.modifiers.group.maxSelectHint')}
          error={error('maxSelect')}
        >
          <input
            {...fieldAttributes(`${prefix}-max`, {
              hint: true,
              error: Boolean(problems.maxSelect),
            })}
            type="text"
            inputMode="numeric"
            dir="ltr"
            autoComplete="off"
            value={maxSelect}
            onChange={(event) => setMaxSelect(normalizeNumberInput(event.target.value))}
            className={fieldClass}
          />
        </FormField>
      </div>
      {formProblem && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {messageFor(formProblem, t)}
        </p>
      )}
      <div className="flex gap-3">
        <button type="submit" disabled={save.isPending} className={primaryButtonClass}>
          {save.isPending
            ? t('common.saving')
            : existing
              ? t('common.save')
              : t('menu.modifiers.addGroupButton')}
        </button>
        {existing && (
          <button type="button" onClick={() => onDone(false)} className={secondaryButtonClass}>
            {t('common.cancel')}
          </button>
        )}
      </div>
    </form>
  );
}

// ---- a modifier

interface ModifierFormProps {
  item: MenuItemDetail;
  group: ModifierGroup;
  // The modifier being changed, or null to add one.
  existing: Modifier | null;
  onDone: (saved: boolean) => void;
}

function ModifierForm({ item, group, existing, onDone }: ModifierFormProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [name, setName] = useState({ en: existing?.name.en ?? '', ar: existing?.name.ar ?? '' });
  const [priceDelta, setPriceDelta] = useState(existing?.priceDelta ?? '');
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [formProblem, setFormProblem] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (changes: UpdateModifierRequest | null) =>
      existing
        ? updateModifier(existing.id, changes ?? {})
        : createModifier(group.id, {
            name,
            ...(priceDelta.trim() ? { priceDelta } : {}),
          }),
    onSuccess: (modifier) => {
      changeItem(queryClient, item.id, (current) => withModifier(current, modifier));
      if (!existing) {
        setName({ en: '', ar: '' });
        setPriceDelta('');
        setProblems({});
      }
      onDone(true);
    },
    onError: (error) => {
      const found = problemsFrom(error, { notFound: 'ITEM_NOT_FOUND' });
      setProblems(found.fields);
      setFormProblem(found.form);
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormProblem(null);

    if (!existing) {
      const result = createModifierRequestSchema.safeParse({
        name,
        ...(priceDelta.trim() ? { priceDelta } : {}),
      });
      const found = result.success ? {} : fieldsFromIssues(result.error.issues);
      setProblems(found);
      if (Object.keys(found).length === 0) save.mutate(null);
      return;
    }

    const changes: UpdateModifierRequest = {};
    if (name.en.trim() !== existing.name.en || name.ar.trim() !== existing.name.ar) {
      changes.name = name;
    }
    // "3" and "3.000" are the same. A value the rules refuse is sent, so the problem is shown.
    const delta = priceChangeSchema.safeParse(priceDelta);
    if (!delta.success || delta.data !== existing.priceDelta) changes.priceDelta = priceDelta;
    if (Object.keys(changes).length === 0) {
      onDone(false);
      return;
    }
    const result = updateModifierRequestSchema.safeParse(changes);
    const found = result.success ? {} : fieldsFromIssues(result.error.issues);
    setProblems(found);
    if (Object.keys(found).length === 0) save.mutate(changes);
  }

  const prefix = existing ? `modifier-${existing.id}` : `new-modifier-${group.id}`;
  const error = (field: string) => (problems[field] ? messageFor(problems[field], t) : undefined);

  // Adding a modifier is a single row, so a group with many of them stays short.
  if (!existing) {
    const deltaId = `${prefix}-delta`;
    return (
      <form onSubmit={onSubmit} noValidate className="space-y-2">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_9rem_auto]">
          <BilingualNameFields
            idPrefix={prefix}
            value={name}
            onChange={setName}
            errors={{ en: error('name.en'), ar: error('name.ar') }}
            className="contents"
          />
          <FormField
            id={deltaId}
            label={t('menu.modifiers.modifier.priceDelta')}
            error={error('priceDelta')}
          >
            <PriceInput
              {...fieldAttributes(deltaId, { hint: true, error: Boolean(problems.priceDelta) })}
              value={priceDelta}
              onChange={setPriceDelta}
            />
          </FormField>
          <div className="sm:mt-6">
            <button type="submit" disabled={save.isPending} className={primaryButtonClass}>
              {save.isPending ? t('common.saving') : t('menu.modifiers.addModifierButton')}
            </button>
          </div>
        </div>
        <p id={`${deltaId}-hint`} className="text-xs text-slate-500">
          {t('menu.modifiers.modifier.priceDeltaHint')}
        </p>
        {formProblem && (
          <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            {messageFor(formProblem, t)}
          </p>
        )}
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-3">
      <BilingualNameFields
        idPrefix={prefix}
        value={name}
        onChange={setName}
        errors={{ en: error('name.en'), ar: error('name.ar') }}
      />
      <FormField
        id={`${prefix}-delta`}
        label={t('menu.modifiers.modifier.priceDelta')}
        hint={t('menu.modifiers.modifier.priceDeltaHint')}
        error={error('priceDelta')}
      >
        <PriceInput
          {...fieldAttributes(`${prefix}-delta`, {
            hint: true,
            error: Boolean(problems.priceDelta),
          })}
          value={priceDelta}
          onChange={setPriceDelta}
          className={`${fieldClass} max-w-xs`}
        />
      </FormField>
      {formProblem && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {messageFor(formProblem, t)}
        </p>
      )}
      <div className="flex gap-3">
        <button type="submit" disabled={save.isPending} className={primaryButtonClass}>
          {save.isPending ? t('common.saving') : t('common.save')}
        </button>
        <button type="button" onClick={() => onDone(false)} className={secondaryButtonClass}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}

interface ModifierRowProps {
  item: MenuItemDetail;
  group: ModifierGroup;
  modifier: Modifier;
  readOnly: boolean;
  onNotice: (notice: Notice | null) => void;
}

function ModifierRow({ item, group, modifier, readOnly, onNotice }: ModifierRowProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);

  const name = localize(modifier.name, i18n.language);
  const otherLanguage = i18n.language === 'ar' ? 'en' : 'ar';

  const toggle = useMutation({
    mutationFn: () => updateModifier(modifier.id, { isActive: !modifier.isActive }),
    onSuccess: (saved) => {
      changeItem(queryClient, item.id, (current) => withModifier(current, saved));
      onNotice({ kind: 'saved' });
    },
    onError: (error) =>
      onNotice({
        kind: 'problem',
        code: problemsFrom(error, { notFound: 'ITEM_NOT_FOUND' }).form ?? 'saveError',
      }),
  });

  if (editing) {
    return (
      <li className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <ModifierForm
          item={item}
          group={group}
          existing={modifier}
          onDone={(saved) => {
            setEditing(false);
            onNotice(saved ? { kind: 'saved' } : null);
          }}
        />
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center gap-3 py-2">
      <div className="min-w-0 flex-1 basis-32">
        <p className="text-sm font-medium text-slate-900">{name}</p>
        <p className="text-xs text-slate-500">
          <bdi lang={otherLanguage} dir="auto">
            {modifier.name[otherLanguage]}
          </bdi>
        </p>
      </div>
      <span className="text-sm text-slate-700">
        <Price value={modifier.priceDelta} signed />
      </span>
      {!modifier.isActive && <ActiveBadge isActive={false} />}
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-label={t('menu.modifiers.editFor', { name })}
            onClick={() => {
              onNotice(null);
              setEditing(true);
            }}
            className={smallButtonClass}
          >
            {t('menu.modifiers.edit')}
          </button>
          <button
            type="button"
            disabled={toggle.isPending}
            aria-label={
              modifier.isActive
                ? t('menu.modifiers.deactivateFor', { name })
                : t('menu.modifiers.activateFor', { name })
            }
            onClick={() => toggle.mutate()}
            className={smallButtonClass}
          >
            {modifier.isActive ? t('menu.modifiers.deactivate') : t('menu.modifiers.activate')}
          </button>
        </div>
      )}
    </li>
  );
}

interface GroupCardProps {
  item: MenuItemDetail;
  group: ModifierGroup;
  readOnly: boolean;
  onNotice: (notice: Notice | null) => void;
}

function GroupCard({ item, group, readOnly, onNotice }: GroupCardProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);

  const name = localize(group.name, i18n.language);
  const otherLanguage = i18n.language === 'ar' ? 'en' : 'ar';

  const toggle = useMutation({
    mutationFn: () => updateModifierGroup(group.id, { isActive: !group.isActive }),
    onSuccess: (saved) => {
      changeItem(queryClient, item.id, (current) => withGroup(current, saved));
      onNotice({ kind: 'saved' });
    },
    onError: (error) =>
      onNotice({
        kind: 'problem',
        code: problemsFrom(error, { notFound: 'ITEM_NOT_FOUND' }).form ?? 'saveError',
      }),
  });

  return (
    <section
      className={`space-y-3 rounded-lg border border-slate-200 p-4 ${
        group.isActive ? 'bg-white' : 'bg-slate-50'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">{name}</h2>
          <p className="text-xs text-slate-500">
            <bdi lang={otherLanguage} dir="auto">
              {group.name[otherLanguage]}
            </bdi>
          </p>
          <p className="mt-1 text-sm text-slate-700">{describeChoices(group, t)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ActiveBadge isActive={group.isActive} />
          {!readOnly && (
            <>
              <button
                type="button"
                aria-label={t('menu.modifiers.editGroupFor', { name })}
                onClick={() => {
                  onNotice(null);
                  setEditing(true);
                }}
                className={smallButtonClass}
              >
                {t('menu.modifiers.edit')}
              </button>
              <button
                type="button"
                disabled={toggle.isPending}
                aria-label={
                  group.isActive
                    ? t('menu.modifiers.deactivateGroupFor', { name })
                    : t('menu.modifiers.activateGroupFor', { name })
                }
                onClick={() => toggle.mutate()}
                className={smallButtonClass}
              >
                {group.isActive ? t('menu.modifiers.deactivate') : t('menu.modifiers.activate')}
              </button>
            </>
          )}
        </div>
      </div>

      {editing && (
        <GroupForm
          item={item}
          existing={group}
          onDone={(saved) => {
            setEditing(false);
            onNotice(saved ? { kind: 'saved' } : null);
          }}
        />
      )}

      {group.modifiers.length === 0 ? (
        <p className="text-sm text-slate-500">{t('menu.modifiers.noModifiers')}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {group.modifiers.map((modifier) => (
            <ModifierRow
              key={modifier.id}
              item={item}
              group={group}
              modifier={modifier}
              readOnly={readOnly}
              onNotice={onNotice}
            />
          ))}
        </ul>
      )}

      {!readOnly && (
        <div className="space-y-2 border-t border-slate-100 pt-3">
          <h3 className="text-sm font-semibold text-slate-900">
            {t('menu.modifiers.addModifierTitle')}
          </h3>
          <ModifierForm
            item={item}
            group={group}
            existing={null}
            onDone={(saved) => onNotice(saved ? { kind: 'saved' } : null)}
          />
        </div>
      )}
    </section>
  );
}

interface ItemModifiersTabProps {
  item: MenuItemDetail;
  readOnly: boolean;
}

// The groups of modifiers of an item: a size to choose, extra toppings to add. Each group says how
// many modifiers a guest may or must choose. Nothing is deleted, it is made inactive.
export function ItemModifiersTab({ item, readOnly }: ItemModifiersTabProps) {
  const { t } = useTranslation();
  const [notice, setNotice] = useState<Notice | null>(null);

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{t('menu.modifiers.intro')}</p>

      {notice?.kind === 'saved' && (
        <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
          {t('menu.modifiers.messages.saved')}
        </p>
      )}
      {notice?.kind === 'problem' && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {messageFor(notice.code, t)}
        </p>
      )}

      {item.modifierGroups.length === 0 && (
        <p className="text-sm text-slate-500">{t('menu.modifiers.empty')}</p>
      )}

      {item.modifierGroups.map((group) => (
        <GroupCard
          key={group.id}
          item={item}
          group={group}
          readOnly={readOnly}
          onNotice={setNotice}
        />
      ))}

      {!readOnly && (
        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="font-semibold text-slate-900">{t('menu.modifiers.addGroupTitle')}</h2>
          <GroupForm
            item={item}
            existing={null}
            onDone={(saved) => setNotice(saved ? { kind: 'saved' } : null)}
          />
          <p className="text-xs text-slate-500">{t('menu.modifiers.hint')}</p>
        </section>
      )}
    </div>
  );
}
