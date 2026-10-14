import type { RoleScope } from '@pos/shared';
import { Prisma } from '../generated/prisma/client';
import type { PrismaClient } from '../lib/prisma';

// A database client limited to the brand and branches of one signed-in person.
// See docs/specs/001-auth-and-tenancy.md ("Tenant scoping") for the rules.

export interface TenantContext {
  scope: RoleScope;
  brandId: string | null;
  // Branch-scoped users only. Empty for brand and group scope.
  branchIds: readonly string[];
}

// Thrown when code tries to write data that belongs to another brand or branch.
export class TenantViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantViolationError';
  }
}

// Which columns of a model hold its brand and branch. Brand uses its own id as the brand.
interface ModelRule {
  brand?: string;
  branch?: string;
  // For rows with no branch column of their own: a branch-scoped person only sees rows that are
  // linked to one of their branches through this to-many relation (users, through assignments).
  branchesThrough?: { relation: string; field: string };
  // Rows that belong to the whole brand, such as the menu. A branch-scoped person may read them
  // and can never change them.
  brandWide?: boolean;
  // Rows that belong to two branches at once (a transfer from one to another): a branch-scoped
  // person sees those where any of these columns is one of their branches, and creates only
  // those where at least one is.
  anyBranch?: string[];
}

// Every table that holds tenant data needs an entry here. A model without one is refused.
const tenantModels: Record<string, ModelRule> = {
  Brand: { brand: 'id' },
  Branch: { brand: 'brandId', branch: 'id' },
  User: { brand: 'brandId', branchesThrough: { relation: 'branches', field: 'branchId' } },
  AuditLog: { brand: 'brandId', branch: 'branchId' },
  UserBranch: { brand: 'brandId', branch: 'branchId' },
  // The menu belongs to the brand. What a branch changes about it has a branch of its own.
  MenuCategory: { brand: 'brandId', brandWide: true },
  MenuItem: { brand: 'brandId', brandWide: true },
  ModifierGroup: { brand: 'brandId', brandWide: true },
  Modifier: { brand: 'brandId', brandWide: true },
  Combo: { brand: 'brandId', brandWide: true },
  ComboSlot: { brand: 'brandId', brandWide: true },
  ComboSlotOption: { brand: 'brandId', brandWide: true },
  BranchMenuItem: { brand: 'brandId', branch: 'branchId' },
  // Orders belong to a branch.
  Order: { brand: 'brandId', branch: 'branchId' },
  OrderLine: { brand: 'brandId', branch: 'branchId' },
  OrderCounter: { brand: 'brandId', branch: 'branchId' },
  Payment: { brand: 'brandId', branch: 'branchId' },
  KitchenTicket: { brand: 'brandId', branch: 'branchId' },
  Shift: { brand: 'brandId', branch: 'branchId' },
  Refund: { brand: 'brandId', branch: 'branchId' },
  Ingredient: { brand: 'brandId', brandWide: true },
  RecipeLine: { brand: 'brandId', brandWide: true },
  BranchStock: { brand: 'brandId', branch: 'branchId' },
  StockMovement: { brand: 'brandId', branch: 'branchId' },
  StockTransfer: { brand: 'brandId', anyBranch: ['fromBranchId', 'toBranchId'] },
  StockTransferLine: { brand: 'brandId', anyBranch: ['fromBranchId', 'toBranchId'] },
  StockCount: { brand: 'brandId', branch: 'branchId' },
  StockCountLine: { brand: 'brandId', branch: 'branchId' },
  Supplier: { brand: 'brandId', brandWide: true },
  SupplierPrice: { brand: 'brandId', brandWide: true },
  PurchaseOrder: { brand: 'brandId', branch: 'branchId' },
  PurchaseOrderLine: { brand: 'brandId', branch: 'branchId' },
  Promotion: { brand: 'brandId', brandWide: true },
  // A customer belongs to the brand and is the same at every branch; a cashier adds them too.
  Customer: { brand: 'brandId' },
  LoyaltyEntry: { brand: 'brandId' },
};

// Reference data every signed-in person may read. Never writable through this client.
const readOnlyModels = new Set(['Role']);

type Args = Record<string, unknown>;

const readOperations = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);
const updateOperations = new Set(['update', 'updateMany', 'updateManyAndReturn']);
const deleteOperations = new Set(['delete', 'deleteMany']);
const createOperations = new Set(['create', 'createMany', 'createManyAndReturn']);

function isRecord(value: unknown): value is Args {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scalarFields(model: string): ReadonlySet<string> {
  const fields = (Prisma as unknown as Record<string, unknown>)[`${model}ScalarFieldEnum`];
  if (!isRecord(fields)) {
    throw new Error(`Unknown model "${model}".`);
  }
  return new Set(Object.values(fields).map(String));
}

function assertNoRelationLoading(model: string, args: Args): void {
  if (args.include !== undefined) {
    throw new Error(
      `"include" is not allowed on a tenant-scoped client (${model}). Query each model separately.`,
    );
  }
  if (isRecord(args.select) && Object.values(args.select).some((value) => isRecord(value))) {
    throw new Error(
      `Selecting related rows is not allowed on a tenant-scoped client (${model}). Query each model separately.`,
    );
  }
}

function assertScalarOnly(model: string, data: unknown): asserts data is Args {
  if (!isRecord(data)) {
    throw new Error(`Expected an object of values for ${model}.`);
  }
  const allowed = scalarFields(model);
  const nested = Object.keys(data).filter((key) => !allowed.has(key));
  if (nested.length > 0) {
    throw new Error(
      `Nested writes are not allowed on a tenant-scoped client (${model}: ${nested.join(', ')}).`,
    );
  }
}

// The condition every query must also satisfy. Null means no limit (group scope).
function tenantFilter(rule: ModelRule, ctx: TenantContext): Args | null {
  if (ctx.scope === 'GROUP') return null;

  const conditions: Args[] = [];
  if (rule.brand) conditions.push({ [rule.brand]: ctx.brandId });
  if (ctx.scope === 'BRANCH' && rule.branch) {
    conditions.push({ [rule.branch]: { in: ctx.branchIds } });
  }
  if (ctx.scope === 'BRANCH' && rule.branchesThrough) {
    const { relation, field } = rule.branchesThrough;
    conditions.push({ [relation]: { some: { [field]: { in: ctx.branchIds } } } });
  }
  if (ctx.scope === 'BRANCH' && rule.anyBranch) {
    conditions.push({
      OR: rule.anyBranch.map((column) => ({ [column]: { in: ctx.branchIds } })),
    });
  }
  return { AND: conditions };
}

// Adds the filter next to the caller's own conditions with AND, so the caller can narrow
// the result but never widen it. Unique fields stay at the top level for findUnique.
function withFilter(where: unknown, filter: Args | null): Args {
  const original = isRecord(where) ? where : {};
  if (!filter) return original;

  const existing = original.AND;
  const list: unknown[] =
    existing === undefined ? [] : Array.isArray(existing) ? (existing as unknown[]) : [existing];
  return { ...original, AND: [...list, filter] };
}

// The plain value of a column in an update, which may be written as { set: value }.
function plainValue(value: unknown): unknown {
  return isRecord(value) && 'set' in value ? value.set : value;
}

function scopeCreateData(model: string, rule: ModelRule, data: unknown, ctx: TenantContext): Args {
  assertScalarOnly(model, data);
  if (ctx.scope === 'GROUP') return data;

  const result = { ...data };

  if (rule.brand === 'id') {
    throw new TenantViolationError('Only a group user can create brands.');
  }
  if (rule.brand) {
    const given = result[rule.brand];
    if (given !== undefined && given !== ctx.brandId) {
      throw new TenantViolationError(`Cannot create ${model} rows for another brand.`);
    }
    result[rule.brand] = ctx.brandId;
  }

  if (rule.branch === 'id') {
    if (ctx.scope === 'BRANCH') {
      throw new TenantViolationError('A branch-scoped user cannot create branches.');
    }
  } else if (rule.branch && ctx.scope === 'BRANCH') {
    const given = result[rule.branch];
    if (typeof given !== 'string' || !ctx.branchIds.includes(given)) {
      throw new TenantViolationError(`Cannot create ${model} rows for another branch.`);
    }
  }

  // A new row of this kind is linked to a branch afterwards, so a branch-scoped person could
  // never see what they just made.
  if (rule.branchesThrough && ctx.scope === 'BRANCH') {
    throw new TenantViolationError(`A branch-scoped user cannot create ${model} rows.`);
  }

  if (rule.anyBranch && ctx.scope === 'BRANCH') {
    const own = rule.anyBranch.some((column) => {
      const given = result[column];
      return typeof given === 'string' && ctx.branchIds.includes(given);
    });
    if (!own) {
      throw new TenantViolationError(`Cannot create ${model} rows between other branches.`);
    }
  }

  return result;
}

function scopeUpdateData(model: string, rule: ModelRule, data: unknown, ctx: TenantContext): Args {
  assertScalarOnly(model, data);
  if (ctx.scope === 'GROUP') return data;

  if (rule.brand && data[rule.brand] !== undefined) {
    if (plainValue(data[rule.brand]) !== ctx.brandId) {
      throw new TenantViolationError(`Cannot move ${model} rows to another brand.`);
    }
  }
  if (rule.branch && ctx.scope === 'BRANCH' && data[rule.branch] !== undefined) {
    const value = plainValue(data[rule.branch]);
    if (typeof value !== 'string' || !ctx.branchIds.includes(value)) {
      throw new TenantViolationError(`Cannot move ${model} rows to another branch.`);
    }
  }
  if (rule.anyBranch && ctx.scope === 'BRANCH') {
    for (const column of rule.anyBranch) {
      if (data[column] !== undefined) {
        throw new TenantViolationError(`Cannot move ${model} rows to other branches.`);
      }
    }
  }
  return data;
}

// Rewrites one database operation so it can only touch the person's own data.
// Exported for tests; the Prisma extension below calls it for every operation.
export function applyScope(
  model: string,
  operation: string,
  rawArgs: Args,
  ctx: TenantContext,
): Args {
  assertNoRelationLoading(model, rawArgs);

  if (readOnlyModels.has(model)) {
    if (!readOperations.has(operation)) {
      throw new Error(`${model} is read-only on a tenant-scoped client.`);
    }
    return rawArgs;
  }

  const rule = tenantModels[model];
  if (!rule) {
    throw new Error(
      `Model "${model}" has no tenant rules. Add it to tenantModels, or use the unscoped client on purpose.`,
    );
  }

  if (rule.brandWide && ctx.scope === 'BRANCH' && !readOperations.has(operation)) {
    throw new TenantViolationError(`A branch-scoped user cannot change ${model} rows.`);
  }

  const filter = tenantFilter(rule, ctx);
  const args = { ...rawArgs };

  if (readOperations.has(operation) || deleteOperations.has(operation)) {
    args.where = withFilter(args.where, filter);
  } else if (updateOperations.has(operation)) {
    args.where = withFilter(args.where, filter);
    args.data = scopeUpdateData(model, rule, args.data, ctx);
  } else if (createOperations.has(operation)) {
    args.data = Array.isArray(args.data)
      ? args.data.map((row: unknown) => scopeCreateData(model, rule, row, ctx))
      : scopeCreateData(model, rule, args.data, ctx);
  } else if (operation === 'upsert') {
    args.where = withFilter(args.where, filter);
    args.create = scopeCreateData(model, rule, args.create, ctx);
    args.update = scopeUpdateData(model, rule, args.update, ctx);
  } else {
    throw new Error(`Operation "${operation}" is not supported on a tenant-scoped client.`);
  }

  return args;
}

function assertValidContext(ctx: TenantContext): void {
  if (ctx.scope !== 'GROUP' && !ctx.brandId) {
    throw new Error(`A ${ctx.scope}-scoped context needs a brand id.`);
  }
}

export function createScopedClient(prisma: PrismaClient, ctx: TenantContext) {
  assertValidContext(ctx);

  return prisma.$extends({
    name: 'tenantScope',
    query: {
      $allOperations({ model, operation, args, query }) {
        if (model === undefined) {
          throw new Error(`Raw queries are not allowed on a tenant-scoped client (${operation}).`);
        }
        return query(applyScope(model, operation, args as Args, ctx));
      },
    },
  });
}

export type ScopedClient = ReturnType<typeof createScopedClient>;
