import {
  type BranchDetail,
  DEFAULT_PRINTER_PORT,
  MAX_PRINTERS,
  type Printer,
  type PrinterInput,
  type PrinterKind,
  printerInputListSchema,
  printerKinds,
} from '@pos/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FormField,
  fieldAttributes,
  fieldClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../components/form';
import { fieldsFromIssues, fieldsUnder, messageFor, problemsFrom } from '../../lib/error-messages';
import { updateBranch } from './branches-api';
import { BridgeKeySection } from './BridgeKeySection';

// A printer as it is edited. The port is text while it is typed. The key tells the rows apart on
// the screen, and the id (which the server made) stays the same when the printer is saved again.
interface PrinterState {
  key: number;
  id?: string;
  name: string;
  kind: PrinterKind;
  host: string;
  port: string;
}

function toState(printers: Printer[]): PrinterState[] {
  return printers.map((printer, key) => ({
    key,
    id: printer.id,
    name: printer.name,
    kind: printer.kind,
    host: printer.host,
    port: String(printer.port),
  }));
}

// An empty port means the usual one. Text that is not a number is sent as it is, to be refused.
function toRequest(printers: PrinterState[]): PrinterInput[] {
  return printers.map((printer) => ({
    ...(printer.id ? { id: printer.id } : {}),
    name: printer.name,
    kind: printer.kind,
    host: printer.host,
    ...(printer.port.trim() === '' ? {} : { port: Number(printer.port) }),
  }));
}

// The network printers of a branch: receipts and kitchen tickets, as many of each as it needs.
export function PrintersEditor({ branch, readOnly }: { branch: BranchDetail; readOnly: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [printers, setPrinters] = useState<PrinterState[]>(() => toState(branch.config.printers));
  const [nextKey, setNextKey] = useState(branch.config.printers.length);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [formProblem, setFormProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const change = (key: number, update: Partial<PrinterState>) => {
    setPrinters((current) =>
      current.map((printer) => (printer.key === key ? { ...printer, ...update } : printer)),
    );
    setSaved(false);
  };

  const save = useMutation({
    mutationFn: (request: PrinterInput[]) =>
      updateBranch(branch.id, { config: { printers: request } }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(['branch', updated.id], updated);
      await queryClient.invalidateQueries({ queryKey: ['branches'] });
      setPrinters(toState(updated.config.printers));
      setNextKey(updated.config.printers.length);
      setProblems({});
      setSaved(true);
    },
    onError: (error) => {
      const found = problemsFrom(error, { notFound: 'ITEM_NOT_FOUND' });
      setProblems(fieldsUnder(found.fields, 'config.printers'));
      setFormProblem(found.form);
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    setFormProblem(null);

    const request = toRequest(printers);
    const result = printerInputListSchema.safeParse(request);
    const found = result.success ? {} : fieldsFromIssues(result.error.issues);
    setProblems(found);
    if (Object.keys(found).length > 0) return;

    save.mutate(request);
  }

  const message = (path: string) => (problems[path] ? messageFor(problems[path], t) : undefined);

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <p className="text-sm text-slate-600">{t('printers.intro')}</p>

      {printers.length === 0 && <p className="text-sm text-slate-500">{t('printers.empty')}</p>}

      <div className="space-y-3">
        {printers.map((printer, index) => {
          const id = `printer-${printer.key}`;
          const label = t('printers.item', { n: index + 1 });

          return (
            <fieldset
              key={printer.key}
              className="space-y-3 rounded-lg border border-slate-200 bg-white p-3"
            >
              <legend className="px-1 text-sm font-semibold text-slate-900">{label}</legend>

              <div className="grid gap-3 sm:grid-cols-2">
                <FormField
                  id={`${id}-name`}
                  label={t('printers.name')}
                  error={message(`${index}.name`)}
                >
                  <input
                    {...fieldAttributes(`${id}-name`, {
                      error: Boolean(problems[`${index}.name`]),
                    })}
                    type="text"
                    dir="auto"
                    autoComplete="off"
                    value={printer.name}
                    disabled={readOnly}
                    onChange={(event) => change(printer.key, { name: event.target.value })}
                    className={fieldClass}
                  />
                </FormField>

                <FormField id={`${id}-kind`} label={t('printers.kind')}>
                  <select
                    {...fieldAttributes(`${id}-kind`, {})}
                    value={printer.kind}
                    disabled={readOnly}
                    onChange={(event) =>
                      change(printer.key, { kind: event.target.value as PrinterKind })
                    }
                    className={fieldClass}
                  >
                    {printerKinds.map((kind) => (
                      <option key={kind} value={kind}>
                        {t(`printers.kinds.${kind}`)}
                      </option>
                    ))}
                  </select>
                </FormField>

                <FormField
                  id={`${id}-host`}
                  label={t('printers.host')}
                  hint={t('printers.hostHint')}
                  error={message(`${index}.host`)}
                >
                  <input
                    {...fieldAttributes(`${id}-host`, {
                      hint: true,
                      error: Boolean(problems[`${index}.host`]),
                    })}
                    type="text"
                    dir="ltr"
                    autoComplete="off"
                    value={printer.host}
                    disabled={readOnly}
                    onChange={(event) => change(printer.key, { host: event.target.value })}
                    className={fieldClass}
                  />
                </FormField>

                <FormField
                  id={`${id}-port`}
                  label={t('printers.port')}
                  hint={t('printers.portHint')}
                  error={message(`${index}.port`)}
                >
                  <input
                    {...fieldAttributes(`${id}-port`, {
                      hint: true,
                      error: Boolean(problems[`${index}.port`]),
                    })}
                    type="text"
                    dir="ltr"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder={String(DEFAULT_PRINTER_PORT)}
                    value={printer.port}
                    disabled={readOnly}
                    onChange={(event) => change(printer.key, { port: event.target.value })}
                    className={fieldClass}
                  />
                </FormField>
              </div>

              {!readOnly && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    aria-label={t('printers.remove', { n: index + 1 })}
                    onClick={() => {
                      setPrinters((current) => current.filter((item) => item.key !== printer.key));
                      setSaved(false);
                    }}
                    className="rounded px-2 py-1 text-sm text-red-700 hover:bg-red-50"
                  >
                    <span aria-hidden="true">✕</span>
                  </button>
                </div>
              )}
            </fieldset>
          );
        })}
      </div>

      {message('') && <p className="text-sm text-red-700">{message('')}</p>}

      {!readOnly && printers.length < MAX_PRINTERS && (
        <button
          type="button"
          onClick={() => {
            setPrinters((current) => [
              ...current,
              {
                key: nextKey,
                name: '',
                kind: 'receipt',
                host: '',
                port: String(DEFAULT_PRINTER_PORT),
              },
            ]);
            setNextKey(nextKey + 1);
            setSaved(false);
          }}
          className={secondaryButtonClass}
        >
          {t('printers.add')}
        </button>
      )}

      {formProblem && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {messageFor(formProblem, t)}
        </p>
      )}
      {saved && (
        <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
          {t('printers.saved')}
        </p>
      )}

      {!readOnly && (
        <div>
          <button type="submit" disabled={save.isPending} className={primaryButtonClass}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </button>
        </div>
      )}

      <BridgeKeySection branchId={branch.id} readOnly={readOnly} />
    </form>
  );
}
