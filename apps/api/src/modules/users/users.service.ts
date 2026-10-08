import {
  type AccessTokenClaims,
  type AdminUser,
  type CreateUserRequest,
  type CredentialsResult,
  type Page,
  roleKeySchema,
  type RoleScope,
  type SetCredentialsRequest,
  type UpdateUserRequest,
  type UserListQuery,
} from '@pos/shared';
import { Prisma, type Role as RoleRow, type User as UserRow } from '../../generated/prisma/client';
import { type AuditEvent, writeAudit } from '../../lib/audit';
import { generatePassword, generatePin } from '../../lib/generate-credentials';
import { errors } from '../../lib/http-errors';
import { cursorPageArgs, splitPage } from '../../lib/pagination';
import type { PasswordHasher } from '../../lib/password';
import type { PrismaClient } from '../../lib/prisma';
import type { RequestMeta } from '../../lib/request-meta';
import type { ScopedClient } from '../../tenancy/scoped-client';

// Who may give which role. A group admin can give any role, a brand manager any role except
// group admin, and everybody else none. See docs/specs/003-users-and-roles.md.
export function canAssignScope(actor: RoleScope, role: RoleScope): boolean {
  if (actor === 'GROUP') return true;
  if (actor === 'BRAND') return role !== 'GROUP';
  return false;
}

// The person asking, and a database client limited to what they may see.
export interface ActorContext {
  auth: AccessTokenClaims;
  db: ScopedClient;
}

export interface UsersDeps {
  prisma: PrismaClient;
  hasher: PasswordHasher;
  revokeAllSessions: (userId: string) => Promise<void>;
}

const invalid = (path: string, message: string) => errors.validation([{ path, message }]);

function toAdminUser(user: UserRow, role: RoleRow, branchIds: string[], now: Date): AdminUser {
  const locked = user.lockedUntil !== null && user.lockedUntil > now;

  return {
    id: user.id,
    brandId: user.brandId,
    name: user.name,
    email: user.email,
    staffCode: user.staffCode,
    role: { key: roleKeySchema.parse(role.key), name: role.name, scope: role.scope },
    branchIds,
    preferredLang: user.preferredLang,
    isActive: user.isActive,
    lockedUntil: locked ? (user.lockedUntil?.toISOString() ?? null) : null,
    hasPassword: user.passwordHash !== null,
    hasPin: user.pinHash !== null,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export function createUsersService({ prisma, hasher, revokeAllSessions }: UsersDeps) {
  const audit = (event: AuditEvent, meta: RequestMeta) =>
    writeAudit(prisma, { ...event, ip: meta.ip, userAgent: meta.userAgent });

  // Adds each person's role and branches. Three queries for a whole page, not three per person.
  async function describeUsers(db: ScopedClient, rows: UserRow[]): Promise<AdminUser[]> {
    if (rows.length === 0) return [];

    const [roles, assignments] = await Promise.all([
      db.role.findMany(),
      db.userBranch.findMany({
        where: { userId: { in: rows.map((row) => row.id) } },
        select: { userId: true, branchId: true },
      }),
    ]);

    const roleById = new Map(roles.map((role) => [role.id, role]));
    const branchesByUser = new Map<string, string[]>();
    for (const { userId, branchId } of assignments) {
      branchesByUser.set(userId, [...(branchesByUser.get(userId) ?? []), branchId]);
    }

    const now = new Date();
    return rows.map((row) => {
      const role = roleById.get(row.roleId);
      if (!role) throw new Error(`User ${row.id} has a role that does not exist.`);
      return toAdminUser(row, role, (branchesByUser.get(row.id) ?? []).sort(), now);
    });
  }

  async function describeOne(db: ScopedClient, row: UserRow): Promise<AdminUser> {
    const [user] = await describeUsers(db, [row]);
    if (!user) throw new Error('A user could not be described.');
    return user;
  }

  // A person the actor cannot see is answered like one that does not exist.
  async function loadUser({ db }: ActorContext, id: string): Promise<UserRow> {
    const user = await db.user.findUnique({ where: { id } });
    if (!user) throw errors.notFound('User');
    return user;
  }

  async function findAssignableRole({ auth, db }: ActorContext, key: string): Promise<RoleRow> {
    const role = await db.role.findUnique({ where: { key } });
    if (!role) throw invalid('roleKey', 'ROLE_NOT_FOUND');
    if (!canAssignScope(auth.scope, role.scope)) throw errors.forbidden();
    return role;
  }

  // The brand a new person belongs to: none for a group role, the chosen one for a group admin
  // acting, and the actor's own brand for everybody else.
  async function resolveBrand(
    { auth, db }: ActorContext,
    role: RoleRow,
    requested: string | undefined,
  ): Promise<string | null> {
    if (role.scope === 'GROUP') {
      if (requested) throw invalid('brandId', 'BRAND_NOT_ALLOWED_FOR_GROUP_ROLE');
      return null;
    }

    if (auth.scope === 'GROUP') {
      if (!requested) throw invalid('brandId', 'BRAND_REQUIRED');
      const brand = await db.brand.findUnique({ where: { id: requested } });
      if (!brand) throw invalid('brandId', 'BRAND_NOT_FOUND');
      return brand.id;
    }

    if (requested && requested !== auth.brandId) throw errors.forbidden();
    if (!auth.brandId) throw errors.forbidden();
    return auth.brandId;
  }

  // Branch-scoped roles need at least one branch of the person's brand. Other roles need none.
  async function validateBranches(
    { db }: ActorContext,
    role: RoleRow,
    brandId: string | null,
    requested: string[],
  ): Promise<string[]> {
    const branchIds = [...new Set(requested)];

    if (role.scope !== 'BRANCH') {
      if (branchIds.length > 0) throw invalid('branchIds', 'BRANCHES_NOT_ALLOWED_FOR_ROLE');
      return [];
    }
    if (!brandId || branchIds.length === 0) throw invalid('branchIds', 'BRANCH_REQUIRED');

    const found = await db.branch.findMany({
      where: { id: { in: branchIds }, brandId },
      select: { id: true },
    });
    if (found.length !== branchIds.length) throw invalid('branchIds', 'BRANCH_NOT_FOUND');
    return branchIds;
  }

  // Emails are unique across the whole system and staff codes inside a brand. This looks at all
  // brands on purpose, so it uses the plain client and only asks whether a row exists.
  async function assertNotTaken(
    values: { email?: string | null; staffCode?: string | null; brandId: string | null },
    exceptUserId?: string,
  ): Promise<void> {
    const other = exceptUserId ? { id: { not: exceptUserId } } : {};

    if (values.email) {
      const found = await prisma.user.findFirst({
        where: { email: values.email, ...other },
        select: { id: true },
      });
      if (found) throw errors.conflict('EMAIL_TAKEN', 'This email is already used');
    }
    if (values.staffCode && values.brandId) {
      const found = await prisma.user.findFirst({
        where: { brandId: values.brandId, staffCode: values.staffCode, ...other },
        select: { id: true },
      });
      if (found) throw errors.conflict('STAFF_CODE_TAKEN', 'This staff code is already used');
    }
  }

  // Two people saving the same value at the same moment get past the check above. The database
  // still refuses the second one, and this finds out which value it was.
  async function explainConflict(
    values: { email?: string | null; staffCode?: string | null; brandId: string | null },
    exceptUserId?: string,
  ): Promise<never> {
    await assertNotTaken(values, exceptUserId);
    throw errors.conflict('EMAIL_TAKEN', 'This email or staff code is already used');
  }

  return {
    async list(ctx: ActorContext, query: UserListQuery): Promise<Page<AdminUser>> {
      const now = new Date();
      const filters: Prisma.UserWhereInput[] = [];

      if (query.role) filters.push({ role: { key: query.role } });
      if (query.brandId) filters.push({ brandId: query.brandId });
      if (query.branchId) filters.push({ branches: { some: { branchId: query.branchId } } });
      if (query.status === 'active') filters.push({ isActive: true });
      if (query.status === 'inactive') filters.push({ isActive: false });
      if (query.status === 'locked') filters.push({ isActive: true, lockedUntil: { gt: now } });
      if (query.q) {
        const contains = { contains: query.q, mode: 'insensitive' as const };
        filters.push({ OR: [{ name: contains }, { email: contains }, { staffCode: contains }] });
      }

      const rows = await ctx.db.user.findMany({
        ...(filters.length > 0 ? { where: { AND: filters } } : {}),
        ...cursorPageArgs(query.limit, query.cursor),
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      });

      const page = splitPage(rows, query.limit);
      return { data: await describeUsers(ctx.db, page.rows), nextCursor: page.nextCursor };
    },

    async get(ctx: ActorContext, id: string): Promise<AdminUser> {
      return describeOne(ctx.db, await loadUser(ctx, id));
    },

    async create(
      ctx: ActorContext,
      input: CreateUserRequest,
      meta: RequestMeta,
    ): Promise<AdminUser> {
      const { auth, db } = ctx;
      const role = await findAssignableRole(ctx, input.roleKey);
      const brandId = await resolveBrand(ctx, role, input.brandId);
      const branchIds = await validateBranches(ctx, role, brandId, input.branchIds);

      if (role.scope === 'GROUP' && input.staffCode) {
        throw invalid('staffCode', 'STAFF_CODE_NEEDS_BRAND');
      }
      if (input.pin && role.scope !== 'BRANCH') throw invalid('pin', 'PIN_ONLY_FOR_BRANCH_ROLES');

      await assertNotTaken({ email: input.email, staffCode: input.staffCode, brandId });

      const passwordHash = input.password ? await hasher.hash(input.password) : null;
      const pinHash = input.pin ? await hasher.hash(input.pin) : null;

      let created: UserRow;
      try {
        created = await db.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: {
              brandId,
              roleId: role.id,
              name: input.name,
              email: input.email ?? null,
              staffCode: input.staffCode ?? null,
              preferredLang: input.preferredLang,
              passwordHash,
              pinHash,
            },
          });
          if (brandId && branchIds.length > 0) {
            await tx.userBranch.createMany({
              data: branchIds.map((branchId) => ({ userId: user.id, branchId, brandId })),
            });
          }
          return user;
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return explainConflict({ email: input.email, staffCode: input.staffCode, brandId });
        }
        throw error;
      }

      await audit(
        {
          action: 'user.created',
          userId: auth.sub,
          brandId,
          entityType: 'user',
          entityId: created.id,
          metadata: { role: role.key, branches: branchIds.length },
        },
        meta,
      );
      return describeOne(db, created);
    },

    async update(
      ctx: ActorContext,
      id: string,
      input: UpdateUserRequest,
      meta: RequestMeta,
    ): Promise<AdminUser> {
      const { auth, db } = ctx;
      const target = await loadUser(ctx, id);
      const currentRole = await db.role.findUnique({ where: { id: target.roleId } });
      if (!currentRole) throw new Error(`User ${id} has a role that does not exist.`);

      const isSelf = target.id === auth.sub;
      if (isSelf && input.isActive === false) throw errors.forbidden();

      let role = currentRole;
      if (input.roleKey !== undefined && input.roleKey !== currentRole.key) {
        // Nobody changes their own role, and nobody gives a role above their own.
        if (isSelf) throw errors.forbidden();
        role = await findAssignableRole(ctx, input.roleKey);
      }

      const existing = await db.userBranch.findMany({
        where: { userId: id },
        select: { branchId: true },
      });
      const existingBranchIds = existing.map((row) => row.branchId);
      const wanted = input.branchIds ?? (role.scope === 'BRANCH' ? existingBranchIds : []);
      const branchIds = await validateBranches(ctx, role, target.brandId, wanted);

      const email = input.email === undefined ? target.email : input.email;
      const staffCode = input.staffCode === undefined ? target.staffCode : input.staffCode;
      if (role.scope === 'GROUP' && staffCode) throw invalid('staffCode', 'STAFF_CODE_NEEDS_BRAND');
      await assertNotTaken(
        {
          email: input.email === undefined ? null : input.email,
          staffCode: input.staffCode === undefined ? null : input.staffCode,
          brandId: target.brandId,
        },
        id,
      );

      const data: Prisma.UserUncheckedUpdateInput = {};
      const changed: string[] = [];
      const set = <Key extends keyof Prisma.UserUncheckedUpdateInput>(
        key: Key,
        value: Prisma.UserUncheckedUpdateInput[Key],
        label: string,
      ) => {
        data[key] = value;
        changed.push(label);
      };

      if (input.name !== undefined && input.name !== target.name) set('name', input.name, 'name');
      if (input.email !== undefined && email !== target.email) set('email', email, 'email');
      if (input.staffCode !== undefined && staffCode !== target.staffCode) {
        set('staffCode', staffCode, 'staffCode');
      }
      if (role.id !== currentRole.id) set('roleId', role.id, 'role');
      if (input.preferredLang !== undefined && input.preferredLang !== target.preferredLang) {
        set('preferredLang', input.preferredLang, 'preferredLang');
      }
      if (input.isActive !== undefined && input.isActive !== target.isActive) {
        set('isActive', input.isActive, 'isActive');
      }

      const toAdd = branchIds.filter((branchId) => !existingBranchIds.includes(branchId));
      const branchesChanged =
        toAdd.length > 0 || existingBranchIds.some((branchId) => !branchIds.includes(branchId));
      if (branchesChanged) changed.push('branches');

      if (changed.length === 0) return describeOne(db, target);

      let updated: UserRow;
      try {
        updated = await db.$transaction(async (tx) => {
          const user =
            Object.keys(data).length > 0 ? await tx.user.update({ where: { id }, data }) : target;

          if (branchesChanged && target.brandId) {
            const brandId = target.brandId;
            await tx.userBranch.deleteMany({
              where: { userId: id, branchId: { notIn: branchIds } },
            });
            if (toAdd.length > 0) {
              await tx.userBranch.createMany({
                data: toAdd.map((branchId) => ({ userId: id, branchId, brandId })),
              });
            }
          }
          return user;
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return explainConflict({ email, staffCode, brandId: target.brandId }, id);
        }
        throw error;
      }

      // A deactivated person is signed out everywhere. Other changes reach them when their
      // access token is next refreshed, within 15 minutes.
      if (changed.includes('isActive') && input.isActive === false) await revokeAllSessions(id);

      await audit(
        {
          action: 'user.updated',
          userId: auth.sub,
          brandId: target.brandId,
          entityType: 'user',
          entityId: id,
          metadata: {
            changed,
            ...(changed.includes('role') ? { role: { from: currentRole.key, to: role.key } } : {}),
            ...(changed.includes('isActive') ? { isActive: updated.isActive } : {}),
          },
        },
        meta,
      );
      return describeOne(db, updated);
    },

    async setCredentials(
      ctx: ActorContext,
      id: string,
      input: SetCredentialsRequest,
      meta: RequestMeta,
    ): Promise<CredentialsResult> {
      const { auth, db } = ctx;
      const target = await loadUser(ctx, id);
      const role = await db.role.findUnique({ where: { id: target.roleId } });

      if (input.type === 'pin') {
        if (!target.staffCode) throw invalid('type', 'PIN_NEEDS_STAFF_CODE');
        if (role?.scope !== 'BRANCH') throw invalid('type', 'PIN_ONLY_FOR_BRANCH_ROLES');
      } else if (!target.email) {
        throw invalid('type', 'PASSWORD_NEEDS_EMAIL');
      }

      const generated = input.value === undefined;
      const value = input.value ?? (input.type === 'pin' ? generatePin() : generatePassword());
      const hash = await hasher.hash(value);

      await db.user.update({
        where: { id },
        data: input.type === 'pin' ? { pinHash: hash } : { passwordHash: hash },
      });
      // A new password or PIN ends the old sessions, in case somebody else had them.
      await revokeAllSessions(id);

      await audit(
        {
          action: 'user.credentials_reset',
          userId: auth.sub,
          brandId: target.brandId,
          entityType: 'user',
          entityId: id,
          metadata: { type: input.type, generated },
        },
        meta,
      );
      return { type: input.type, generatedValue: generated ? value : null };
    },

    async unlock(ctx: ActorContext, id: string, meta: RequestMeta): Promise<AdminUser> {
      const { auth, db } = ctx;
      const target = await loadUser(ctx, id);

      const updated = await db.user.update({
        where: { id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });

      await audit(
        {
          action: 'user.unlocked',
          userId: auth.sub,
          brandId: target.brandId,
          entityType: 'user',
          entityId: id,
        },
        meta,
      );
      return describeOne(db, updated);
    },
  };
}

export type UsersService = ReturnType<typeof createUsersService>;
