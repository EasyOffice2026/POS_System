import {
  type AccessTokenClaims,
  type ChangePasswordRequest,
  type AuthUser,
  type LoginRequest,
  type Permission,
  permissionSchema,
  roleKeySchema,
  type SessionResponse,
} from '@pos/shared';
import { randomUUID } from 'node:crypto';
import type { Config } from '../../config';
import type { Prisma } from '../../generated/prisma/client';
import { type AuditEvent, writeAudit } from '../../lib/audit';
import { errors } from '../../lib/http-errors';
import type { PasswordHasher } from '../../lib/password';
import type { PrismaClient } from '../../lib/prisma';
import type { RequestMeta } from '../../lib/request-meta';
import { generateRefreshToken, hashRefreshToken, type TokenService } from '../../lib/tokens';

// Lockout rules (see docs/specs/001-auth-and-tenancy.md): every 5th failure in a row locks the
// account, for twice as long as the last lock, from 15 minutes up to 24 hours.
export const LOCK_THRESHOLD = 5;
const BASE_LOCK_SECONDS = 15 * 60;
const MAX_LOCK_SECONDS = 24 * 60 * 60;

export function lockSeconds(failedAttempts: number): number {
  const locks = failedAttempts / LOCK_THRESHOLD;
  return Math.min(BASE_LOCK_SECONDS * 2 ** (locks - 1), MAX_LOCK_SECONDS);
}

const withAccess = { role: true, branches: true } as const satisfies Prisma.UserInclude;
type UserWithAccess = Prisma.UserGetPayload<{ include: typeof withAccess }>;

export interface AuthDeps {
  prisma: PrismaClient;
  hasher: PasswordHasher;
  tokens: TokenService;
  config: Config;
}

export interface IssuedSession {
  session: SessionResponse;
  refreshToken: string;
  refreshExpiresAt: Date;
}

interface Candidate {
  user: UserWithAccess;
  storedHash: string | null;
  // Set for PIN sign-in: the session is limited to the terminal's branch.
  sessionBranchId: string | null;
}

function buildClaims(user: UserWithAccess, sessionBranchId: string | null): AccessTokenClaims {
  const stored = Array.isArray(user.role.permissions) ? user.role.permissions : [];
  const permissions = stored.filter(
    (value): value is Permission => permissionSchema.safeParse(value).success,
  );

  let branchIds: string[] = [];
  if (user.role.scope === 'BRANCH') {
    branchIds = sessionBranchId ? [sessionBranchId] : user.branches.map((row) => row.branchId);
  }

  return {
    sub: user.id,
    role: roleKeySchema.parse(user.role.key),
    scope: user.role.scope,
    brandId: user.brandId,
    branchIds,
    permissions,
  };
}

function toAuthUser(user: UserWithAccess, claims: AccessTokenClaims): AuthUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: { key: claims.role, name: user.role.name },
    scope: claims.scope,
    brandId: claims.brandId,
    branchIds: claims.branchIds,
    permissions: claims.permissions,
    preferredLang: user.preferredLang,
    mustChangePassword: user.mustChangePassword,
  };
}

export function createAuthService({ prisma, hasher, tokens, config }: AuthDeps) {
  const audit = (event: AuditEvent, meta: RequestMeta) =>
    writeAudit(prisma, { ...event, ip: meta.ip, userAgent: meta.userAgent });

  async function findCandidate(input: LoginRequest, meta: RequestMeta): Promise<Candidate | null> {
    if (input.type === 'password') {
      const user = await prisma.user.findUnique({
        where: { email: input.email },
        include: withAccess,
      });
      return user ? { user, storedHash: user.passwordHash, sessionBranchId: null } : null;
    }

    // PIN: the staff code is only unique inside a brand, so find the brand through the branch.
    const branch = await prisma.branch.findUnique({
      where: { id: input.branchId },
      include: { brand: { select: { isActive: true } } },
    });
    if (!branch) return null;

    // A terminal at a deactivated branch, or at a branch of a deactivated brand, is told so before
    // any PIN is looked at, so it can show a message instead of "wrong PIN". No attempt is counted
    // against anybody. The attempt is in the audit log, for the managers of that brand.
    if (!branch.isActive || !branch.brand.isActive) {
      await audit(
        {
          action: 'auth.login.failed',
          brandId: branch.brandId,
          branchId: branch.id,
          metadata: {
            type: input.type,
            branchId: input.branchId,
            staffCode: input.staffCode,
            reason: 'branch_inactive',
          },
        },
        meta,
      );
      throw errors.branchInactive();
    }

    const user = await prisma.user.findFirst({
      where: { brandId: branch.brandId, staffCode: input.staffCode },
      include: withAccess,
    });
    const worksHere = user?.branches.some((row) => row.branchId === branch.id);
    if (!user || user.role.scope !== 'BRANCH' || !worksHere) return null;

    return { user, storedHash: user.pinHash, sessionBranchId: branch.id };
  }

  // A PIN session belongs to one branch. It cannot be refreshed once that branch, or its brand,
  // has been deactivated.
  async function branchIsOpen(branchId: string): Promise<boolean> {
    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      select: { isActive: true, brand: { select: { isActive: true } } },
    });
    return Boolean(branch?.isActive && branch.brand.isActive);
  }

  // A PIN session on a till ends a set time after it began, however often it is refreshed, so a
  // till that nobody signed out asks for the PIN again (the client: once a day). A password
  // session is extended at every refresh.
  const pinSessionEnd = (from: Date) =>
    new Date(from.getTime() + config.refreshToken.pinSessionHours * 60 * 60 * 1000);

  async function issueRefreshToken(
    userId: string,
    familyId: string,
    branchId: string | null,
    meta: RequestMeta,
    endsAt?: Date,
  ) {
    const { token, hash } = generateRefreshToken();
    const expiresAt =
      endsAt ?? new Date(Date.now() + config.refreshToken.ttlDays * 24 * 60 * 60 * 1000);
    await prisma.refreshToken.create({
      data: { userId, familyId, tokenHash: hash, branchId, expiresAt, ...meta },
    });
    return { token, expiresAt };
  }

  async function buildSession(
    user: UserWithAccess,
    sessionBranchId: string | null,
  ): Promise<SessionResponse> {
    const claims = buildClaims(user, sessionBranchId);
    return {
      accessToken: await tokens.signAccessToken(claims),
      expiresIn: config.accessToken.ttlSeconds,
      user: toAuthUser(user, claims),
    };
  }

  function revokeFamily(familyId: string) {
    return prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async function registerFailure(user: UserWithAccess, input: LoginRequest, meta: RequestMeta) {
    const { failedLoginAttempts } = await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    });
    const who = { userId: user.id, brandId: user.brandId };

    await audit(
      {
        action: 'auth.login.failed',
        ...who,
        metadata: { type: input.type, attempts: failedLoginAttempts },
      },
      meta,
    );

    if (failedLoginAttempts % LOCK_THRESHOLD === 0) {
      const seconds = lockSeconds(failedLoginAttempts);
      await prisma.user.update({
        where: { id: user.id },
        data: { lockedUntil: new Date(Date.now() + seconds * 1000) },
      });
      await audit(
        {
          action: 'auth.login.locked',
          ...who,
          metadata: { seconds, attempts: failedLoginAttempts },
        },
        meta,
      );
    }
  }

  return {
    async login(input: LoginRequest, meta: RequestMeta): Promise<IssuedSession> {
      const secret = input.type === 'password' ? input.password : input.pin;
      const attempted =
        input.type === 'password'
          ? { type: input.type, email: input.email }
          : { type: input.type, branchId: input.branchId, staffCode: input.staffCode };

      const candidate = await findCandidate(input, meta);

      if (!candidate?.user.isActive || !candidate.storedHash) {
        // Unknown, inactive or incomplete account: spend the same time as a real check.
        await hasher.verifyDummy(secret);
        await audit({ action: 'auth.login.failed', metadata: attempted }, meta);
        throw errors.invalidCredentials();
      }

      const { user, storedHash, sessionBranchId } = candidate;
      const now = new Date();
      const who = { userId: user.id, brandId: user.brandId };

      if (user.lockedUntil && user.lockedUntil > now) {
        await audit({ action: 'auth.login.blocked', ...who, metadata: { type: input.type } }, meta);
        throw errors.accountLocked(Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 1000));
      }

      if (!(await hasher.verify(secret, storedHash))) {
        await registerFailure(user, input, meta);
        throw errors.invalidCredentials();
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: now },
      });
      const issued = await issueRefreshToken(
        user.id,
        randomUUID(),
        sessionBranchId,
        meta,
        sessionBranchId ? pinSessionEnd(now) : undefined,
      );
      await audit({ action: 'auth.login.success', ...who, metadata: { type: input.type } }, meta);

      return {
        session: await buildSession(user, sessionBranchId),
        refreshToken: issued.token,
        refreshExpiresAt: issued.expiresAt,
      };
    },

    async refresh(token: string | undefined, meta: RequestMeta): Promise<IssuedSession> {
      if (!token) throw errors.invalidRefreshToken();

      const record = await prisma.refreshToken.findUnique({
        where: { tokenHash: hashRefreshToken(token) },
        include: { user: { include: withAccess } },
      });
      if (!record) throw errors.invalidRefreshToken();

      const reuse = async () => {
        await revokeFamily(record.familyId);
        await audit(
          {
            action: 'auth.refresh.reuse_detected',
            userId: record.userId,
            brandId: record.user.brandId,
            metadata: { familyId: record.familyId },
          },
          meta,
        );
        throw errors.invalidRefreshToken();
      };

      // A token that was already used is a sign it was copied: end the whole session.
      if (record.revokedAt) return reuse();

      const stale = record.expiresAt <= new Date() || !record.user.isActive;
      if (stale || (record.branchId !== null && !(await branchIsOpen(record.branchId)))) {
        await revokeFamily(record.familyId);
        throw errors.invalidRefreshToken();
      }

      // Only one request can retire the token. A second one at the same moment counts as reuse.
      const retired = await prisma.refreshToken.updateMany({
        where: { id: record.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (retired.count !== 1) return reuse();

      const next = await issueRefreshToken(
        record.userId,
        record.familyId,
        record.branchId,
        meta,
        record.branchId ? record.expiresAt : undefined,
      );
      return {
        session: await buildSession(record.user, record.branchId),
        refreshToken: next.token,
        refreshExpiresAt: next.expiresAt,
      };
    },

    // A person changes their own password. Every session of theirs ends, in case somebody else
    // had one, and a fresh session comes back for the device they did it on.
    async changePassword(
      auth: AccessTokenClaims,
      input: ChangePasswordRequest,
      meta: RequestMeta,
    ): Promise<IssuedSession> {
      const user = await prisma.user.findUnique({ where: { id: auth.sub }, include: withAccess });
      if (!user?.isActive) throw errors.unauthenticated();
      const wrong = () =>
        errors.validation([{ path: 'currentPassword', message: 'PASSWORD_WRONG' }]);
      if (!user.passwordHash) throw wrong();
      if (!(await hasher.verify(input.currentPassword, user.passwordHash))) throw wrong();

      const passwordHash = await hasher.hash(input.newPassword);
      const updated = await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: false },
        include: withAccess,
      });
      await prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await audit(
        { action: 'auth.password_changed', userId: user.id, brandId: user.brandId },
        meta,
      );
      const issued = await issueRefreshToken(user.id, randomUUID(), null, meta);
      return {
        session: await buildSession(updated, null),
        refreshToken: issued.token,
        refreshExpiresAt: issued.expiresAt,
      };
    },

    async logout(token: string | undefined, meta: RequestMeta): Promise<void> {
      if (!token) return;

      const record = await prisma.refreshToken.findUnique({
        where: { tokenHash: hashRefreshToken(token) },
        include: { user: { select: { brandId: true } } },
      });
      if (!record) return;

      await revokeFamily(record.familyId);
      await audit(
        { action: 'auth.logout', userId: record.userId, brandId: record.user.brandId },
        meta,
      );
    },

    // Ends every session of a person, for example when they are deactivated or get a new password.
    // Their access token stays valid until it expires (15 minutes) but cannot be refreshed.
    async revokeAllSessions(userId: string): Promise<void> {
      await prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    },

    async me(claims: AccessTokenClaims): Promise<AuthUser> {
      const user = await prisma.user.findUnique({ where: { id: claims.sub }, include: withAccess });
      if (!user?.isActive) throw errors.unauthenticated();
      return toAuthUser(user, claims);
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
