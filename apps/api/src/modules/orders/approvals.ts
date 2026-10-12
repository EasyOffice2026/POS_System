import type { Approval, Permission } from '@pos/shared';
import { permissionSchema } from '@pos/shared';
import type { AuditEvent } from '../../lib/audit';
import { errors } from '../../lib/http-errors';
import type { PasswordHasher } from '../../lib/password';
import type { PrismaClient } from '../../lib/prisma';
import type { RequestMeta } from '../../lib/request-meta';
import type { ActorContext } from '../../middleware/authenticate';
import { LOCK_THRESHOLD, lockSeconds } from '../auth/auth.service';

export interface ApprovalDeps {
  prisma: PrismaClient;
  hasher: PasswordHasher;
  audit: (event: AuditEvent, meta: RequestMeta) => Promise<unknown>;
}

const refuse = (message: string) => errors.validation([{ path: 'approval', message }]);

// Who allowed a void or a discount. The person asking may have the right themselves; otherwise a
// manager at the same branch types their staff code and PIN on the terminal. The check is the one
// a PIN sign-in at that branch gets, with the same lockout. See docs/specs/005-orders.md, rule 8.
export function createApprovals({ prisma, hasher, audit }: ApprovalDeps) {
  async function registerFailure(userId: string, brandId: string | null, meta: RequestMeta) {
    const { failedLoginAttempts } = await prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    });
    await audit(
      {
        action: 'auth.login.failed',
        userId,
        brandId,
        metadata: { type: 'approval', attempts: failedLoginAttempts },
      },
      meta,
    );
    if (failedLoginAttempts % LOCK_THRESHOLD === 0) {
      const seconds = lockSeconds(failedLoginAttempts);
      await prisma.user.update({
        where: { id: userId },
        data: { lockedUntil: new Date(Date.now() + seconds * 1000) },
      });
      await audit(
        {
          action: 'auth.login.locked',
          userId,
          brandId,
          metadata: { seconds, attempts: failedLoginAttempts },
        },
        meta,
      );
    }
  }

  return {
    // The id of the manager who approved, or null when the person asking has the right.
    async authorize(
      { auth }: ActorContext,
      where: { brandId: string; branchId: string },
      permission: Permission,
      approval: Approval | undefined,
      meta: RequestMeta,
    ): Promise<string | null> {
      if (auth.permissions.includes(permission)) return null;
      if (!approval) throw refuse('APPROVAL_REQUIRED');

      const approver = await prisma.user.findFirst({
        where: { brandId: where.brandId, staffCode: approval.staffCode },
        include: { role: true, branches: true },
      });
      const worksHere = approver?.branches.some((row) => row.branchId === where.branchId);
      if (
        !approver?.isActive ||
        !approver.pinHash ||
        approver.role.scope !== 'BRANCH' ||
        !worksHere
      ) {
        // Spend the time of a real check, so an unknown staff code cannot be told apart.
        await hasher.verifyDummy(approval.pin);
        throw refuse('APPROVAL_INVALID');
      }

      if (approver.lockedUntil && approver.lockedUntil > new Date())
        throw refuse('APPROVAL_LOCKED');

      if (!(await hasher.verify(approval.pin, approver.pinHash))) {
        await registerFailure(approver.id, approver.brandId, meta);
        throw refuse('APPROVAL_INVALID');
      }
      if (approver.failedLoginAttempts > 0) {
        await prisma.user.update({
          where: { id: approver.id },
          data: { failedLoginAttempts: 0, lockedUntil: null },
        });
      }

      // The right is checked only after the PIN, so nobody learns who is a manager without it.
      const granted = Array.isArray(approver.role.permissions) ? approver.role.permissions : [];
      const allowed = granted.some(
        (value) => permissionSchema.safeParse(value).success && value === permission,
      );
      if (!allowed) throw refuse('APPROVAL_NOT_ALLOWED');

      return approver.id;
    },
  };
}

export type Approvals = ReturnType<typeof createApprovals>;
