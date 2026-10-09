import {
  createCategoryRequestSchema,
  type MenuCategory,
  type UpdateCategoryRequest,
  updateCategoryRequestSchema,
} from '@pos/shared';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActiveBadge } from '../../components/ActiveBadge';
import { BilingualNameFields } from '../../components/BilingualNameFields';
import { primaryButtonClass, secondaryButtonClass } from '../../components/form';
import { localize } from '../../i18n/localize';
import { fieldsFromIssues, messageFor, problemsFrom } from '../../lib/error-messages';
import {
  createCategory,
  listCategories,
  menuKeys,
  reorderCategories,
  updateCategory,
} from './menu-api';
import { useMenuContext } from './menu-context';

type Notice =
  | { kind: 'status'; key: 'created' | 'saved' | 'deactivated' | 'activated' | 'reordered' }
  | { kind: 'problem'; code: string };

const smallButtonClass =
  'rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 focus:ring-2 focus:ring-slate-400 focus:outline-none disabled:opacity-40';

function replaceInList(queryClient: QueryClient, brandId: string, saved: MenuCategory) {
  queryClient.setQueryData<MenuCategory[]>(menuKeys.categories(brandId), (list) =>
    list?.map((category) => (category.id === saved.id ? saved : category)),
  );
}

// Adds a category at the end of the list, which is where the server puts it.
function NewCategoryForm({ onNotice }: { onNotice: (notice: Notice) => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { brandId } = useMenuContext();

  const [name, setName] = useState({ en: '', ar: '' });
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [formProblem, setFormProblem] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => createCategory({ brandId, name }),
    onSuccess: (created) => {
      queryClient.setQueryData<MenuCategory[]>(menuKeys.categories(brandId), (list) => [
        ...(list ?? []),
        created,
      ]);
      setName({ en: '', ar: '' });
      setProblems({});
      onNotice({ kind: 'status', key: 'created' });
    },
    onError: (error) => {
      const found = problemsFrom(error);
      setProblems(found.fields);
      setFormProblem(found.form);
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormProblem(null);

    const result = createCategoryRequestSchema.safeParse({ brandId, name });
    const found = result.success ? {} : fieldsFromIssues(result.error.issues);
    setProblems(found);
    if (Object.keys(found).length > 0) return;

    create.mutate();
  }

  const error = (field: string) => (problems[field] ? messageFor(problems[field], t) : undefined);

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2 className="text-base font-semibold">{t('menu.categories.addTitle')}</h2>
      <BilingualNameFields
        idPrefix="new-category"
        value={name}
        onChange={setName}
        errors={{ en: error('name.en'), ar: error('name.ar') }}
      />
      {formProblem && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {messageFor(formProblem, t)}
        </p>
      )}
      <button type="submit" disabled={create.isPending} className={primaryButtonClass}>
        {create.isPending ? t('common.saving') : t('menu.categories.addButton')}
      </button>
    </form>
  );
}

// The names of a category, changed in place. Only a name that changed is sent.
function CategoryEditor({
  category,
  onDone,
}: {
  category: MenuCategory;
  onDone: (saved: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { brandId } = useMenuContext();

  const [name, setName] = useState({ en: category.name.en, ar: category.name.ar });
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [formProblem, setFormProblem] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (changes: UpdateCategoryRequest) => updateCategory(category.id, changes),
    onSuccess: (saved) => {
      replaceInList(queryClient, brandId, saved);
      onDone(true);
    },
    onError: (error) => {
      const found = problemsFrom(error, { notFound: 'CATEGORY_NOT_FOUND' });
      setProblems(found.fields);
      setFormProblem(found.form);
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormProblem(null);

    if (name.en.trim() === category.name.en && name.ar.trim() === category.name.ar) {
      onDone(false);
      return;
    }
    const changes = { name };
    const result = updateCategoryRequestSchema.safeParse(changes);
    const found = result.success ? {} : fieldsFromIssues(result.error.issues);
    setProblems(found);
    if (Object.keys(found).length > 0) return;

    save.mutate(changes);
  }

  const error = (field: string) => (problems[field] ? messageFor(problems[field], t) : undefined);

  return (
    <form onSubmit={onSubmit} noValidate className="w-full space-y-3">
      <BilingualNameFields
        idPrefix={`category-${category.id}`}
        value={name}
        onChange={setName}
        errors={{ en: error('name.en'), ar: error('name.ar') }}
      />
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

interface CategoryRowProps {
  category: MenuCategory;
  canWrite: boolean;
  isFirst: boolean;
  isLast: boolean;
  // A new order is being saved.
  busy: boolean;
  isDragged: boolean;
  onMove: (direction: -1 | 1) => void;
  onDragStart: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
  onNotice: (notice: Notice | null) => void;
}

function CategoryRow({
  category,
  canWrite,
  isFirst,
  isLast,
  busy,
  isDragged,
  onMove,
  onDragStart,
  onDrop,
  onDragEnd,
  onNotice,
}: CategoryRowProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { brandId } = useMenuContext();
  const [editing, setEditing] = useState(false);

  const name = localize(category.name, i18n.language);
  const otherLanguage = i18n.language === 'ar' ? 'en' : 'ar';

  const toggle = useMutation({
    mutationFn: () => updateCategory(category.id, { isActive: !category.isActive }),
    onSuccess: (saved) => {
      replaceInList(queryClient, brandId, saved);
      onNotice({ kind: 'status', key: saved.isActive ? 'activated' : 'deactivated' });
    },
    onError: (error) =>
      onNotice({
        kind: 'problem',
        code: problemsFrom(error, { notFound: 'CATEGORY_NOT_FOUND' }).form ?? 'saveError',
      }),
  });

  const draggable = canWrite && !busy && !editing;

  return (
    <li
      draggable={draggable}
      onDragStart={(event) => {
        // Firefox starts a drag only when something is set.
        event.dataTransfer.setData('text/plain', category.id);
        event.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragOver={(event) => {
        // Without this the row is not a place where something can be dropped.
        if (canWrite) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
      className={`flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 p-3 ${
        category.isActive ? 'bg-white' : 'bg-slate-50'
      } ${isDragged ? 'opacity-50' : ''}`}
    >
      {editing ? (
        <CategoryEditor
          category={category}
          onDone={(saved) => {
            setEditing(false);
            onNotice(saved ? { kind: 'status', key: 'saved' } : null);
          }}
        />
      ) : (
        <>
          {canWrite && (
            <span
              aria-hidden="true"
              className="cursor-grab text-lg leading-none text-slate-400 select-none"
            >
              ⠿
            </span>
          )}

          {/* A basis, so that on a narrow screen the buttons move to the next line instead of squeezing the name. */}
          <div className="min-w-0 flex-1 basis-40">
            <p className="font-medium text-slate-900">{name}</p>
            <p className="text-xs text-slate-500">
              <bdi lang={otherLanguage} dir="auto">
                {category.name[otherLanguage]}
              </bdi>
            </p>
          </div>

          <ActiveBadge isActive={category.isActive} />

          {canWrite && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || isFirst}
                aria-label={t('menu.categories.moveUp', { name })}
                onClick={() => onMove(-1)}
                className={smallButtonClass}
              >
                <span aria-hidden="true">↑</span>
              </button>
              <button
                type="button"
                disabled={busy || isLast}
                aria-label={t('menu.categories.moveDown', { name })}
                onClick={() => onMove(1)}
                className={smallButtonClass}
              >
                <span aria-hidden="true">↓</span>
              </button>
              <button
                type="button"
                aria-label={t('menu.categories.editFor', { name })}
                onClick={() => {
                  onNotice(null);
                  setEditing(true);
                }}
                className={smallButtonClass}
              >
                {t('menu.categories.edit')}
              </button>
              <button
                type="button"
                disabled={toggle.isPending}
                aria-label={
                  category.isActive
                    ? t('menu.categories.deactivateFor', { name })
                    : t('menu.categories.activateFor', { name })
                }
                onClick={() => toggle.mutate()}
                className={smallButtonClass}
              >
                {category.isActive
                  ? t('menu.categories.deactivate')
                  : t('menu.categories.activate')}
              </button>
            </div>
          )}
        </>
      )}
    </li>
  );
}

// The categories of the brand, in the order the terminals show them. A category can be dragged to
// a new place, or moved with its arrows, and the whole new order is saved at once.
export function CategoriesPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { brandId, canWrite } = useMenuContext();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const categories = useQuery({
    queryKey: menuKeys.categories(brandId),
    queryFn: () => listCategories(brandId),
  });
  const rows = categories.data ?? [];

  const reorder = useMutation({
    mutationFn: (ids: string[]) => reorderCategories(brandId, ids),
    // The list changes at once, so a category lands where it was dropped.
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: menuKeys.categories(brandId) });
      const previous = queryClient.getQueryData<MenuCategory[]>(menuKeys.categories(brandId));
      if (previous) {
        const byId = new Map(previous.map((category) => [category.id, category]));
        queryClient.setQueryData(
          menuKeys.categories(brandId),
          ids.flatMap((id) => byId.get(id) ?? []),
        );
      }
      return { previous };
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(menuKeys.categories(brandId), saved);
      setNotice({ kind: 'status', key: 'reordered' });
    },
    onError: (error, _ids, context) => {
      if (context?.previous)
        queryClient.setQueryData(menuKeys.categories(brandId), context.previous);
      const found = problemsFrom(error);
      setNotice({
        kind: 'problem',
        code: found.form ?? Object.values(found.fields)[0] ?? 'saveError',
      });
      void queryClient.invalidateQueries({ queryKey: menuKeys.categories(brandId) });
    },
  });

  // Moves the category at one place to another, and saves the new order.
  function move(from: number, to: number) {
    if (from === to || to < 0 || to >= rows.length) return;
    const ids = rows.map((category) => category.id);
    const [moved] = ids.splice(from, 1);
    if (moved === undefined) return;
    ids.splice(to, 0, moved);
    setNotice(null);
    reorder.mutate(ids);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{t('menu.categories.intro')}</p>

      {notice?.kind === 'status' && (
        <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
          {t(`menu.categories.messages.${notice.key}`)}
        </p>
      )}
      {notice?.kind === 'problem' && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {messageFor(notice.code, t)}
        </p>
      )}

      {categories.isPending && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {categories.isError && (
        <p role="alert" className="text-sm text-red-700">
          {t('common.loadError')}
        </p>
      )}
      {categories.isSuccess && rows.length === 0 && (
        <p className="text-sm text-slate-500">{t('menu.categories.empty')}</p>
      )}

      {rows.length > 0 && (
        <ol className="space-y-2">
          {rows.map((category, index) => (
            <CategoryRow
              key={category.id}
              category={category}
              canWrite={canWrite}
              isFirst={index === 0}
              isLast={index === rows.length - 1}
              busy={reorder.isPending}
              isDragged={draggedId === category.id}
              onMove={(direction) => move(index, index + direction)}
              onDragStart={() => setDraggedId(category.id)}
              onDrop={() => {
                const from = rows.findIndex((row) => row.id === draggedId);
                setDraggedId(null);
                if (from >= 0) move(from, index);
              }}
              onDragEnd={() => setDraggedId(null)}
              onNotice={setNotice}
            />
          ))}
        </ol>
      )}

      {canWrite && (
        <>
          <NewCategoryForm onNotice={setNotice} />
          <p className="text-xs text-slate-500">{t('menu.categories.hint')}</p>
        </>
      )}
    </div>
  );
}
