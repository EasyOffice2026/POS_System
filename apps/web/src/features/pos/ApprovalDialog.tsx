import type { Order } from '@pos/shared';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../../components/Dialog';
import { primaryButtonClass, secondaryButtonClass } from '../../components/form';
import { type Problem, problemOf } from './pos-errors';
import { emptyStaffPin, type StaffPin, StaffPinFields } from './StaffPinFields';
import type { ApprovedChange } from './use-terminal-order';

// The answers that keep the dialog open: the manager can try again, or another one can.
const approvalProblems = new Set<Problem>([
  'APPROVAL_INVALID',
  'APPROVAL_LOCKED',
  'APPROVAL_NOT_ALLOWED',
]);

interface ApprovalDialogProps {
  change: ApprovedChange;
  onDone: (order: Order) => void;
  onFailed: (error: unknown) => void;
  onCancel: () => void;
}

// A manager types their staff code and PIN on the cashier's terminal, and the change is sent
// again with them. See docs/specs/006-pos-terminal.md, rule 9.
export function ApprovalDialog({ change, onDone, onFailed, onCancel }: ApprovalDialogProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState<StaffPin>(emptyStaffPin);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [sending, setSending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSending(true);
    setProblem(null);
    try {
      onDone(await change(value));
    } catch (error) {
      const code = problemOf(error);
      if (!approvalProblems.has(code)) {
        onFailed(error);
        return;
      }
      setProblem(code);
      setValue((current) => ({ ...current, pin: '' }));
      setSending(false);
    }
  }

  return (
    <Dialog title={t('pos.approval.title')} onClose={onCancel}>
      <form onSubmit={(event) => void onSubmit(event)} className="space-y-4">
        <p className="text-sm text-slate-600">{t('pos.approval.intro')}</p>
        <StaffPinFields value={value} onChange={setValue} disabled={sending} />
        {problem && (
          <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            {t(`pos.errors.${problem}`)}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={secondaryButtonClass}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={sending || !value.staffCode || value.pin.length < 4}
            className={primaryButtonClass}
          >
            {t('pos.approval.approve')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
