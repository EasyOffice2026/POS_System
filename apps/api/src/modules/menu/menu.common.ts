import {
  type BranchOverride,
  type Combo,
  localizedTextSchema,
  type MenuCategory,
  type MenuItem,
  type MenuStatus,
  type Modifier,
  type ModifierGroup,
  openingHoursSchema,
} from '@pos/shared';
import type {
  BranchMenuItem as OverrideRow,
  Combo as ComboRow,
  ComboSlot as SlotRow,
  ComboSlotOption as OptionRow,
  MenuCategory as CategoryRow,
  MenuItem as ItemRow,
  Modifier as ModifierRow,
  ModifierGroup as GroupRow,
  Prisma,
} from '../../generated/prisma/client';
import type { AuditEvent } from '../../lib/audit';
import { errors } from '../../lib/http-errors';
import type { MenuCache } from '../../lib/menu-cache';
import type { PrismaClient } from '../../lib/prisma';
import type { RequestMeta } from '../../lib/request-meta';
import type { ActorContext } from '../../middleware/authenticate';
import type { ScopedClient } from '../../tenancy/scoped-client';

// What every part of the menu needs: the plain client (for the audit log), the cache to clear when
// something changes, and a way to write an audit row.
export interface MenuDeps {
  prisma: PrismaClient;
  cache: MenuCache;
  audit: (event: AuditEvent, meta: RequestMeta) => Promise<unknown>;
}

// The most rows a list that is not paged returns. A brand has far fewer categories and combos.
export const LIST_LIMIT = 1000;

// A problem with one field of a request, as the other modules report it.
export const invalid = (path: string, code: string) => errors.validation([{ path, message: code }]);

export const money = (value: Prisma.Decimal): string => value.toFixed(3);

export const statusFilter = (status: MenuStatus | undefined) =>
  status === 'active' ? { isActive: true } : status === 'inactive' ? { isActive: false } : {};

// The brand a new thing in the menu belongs to. A group admin names it, and everybody else works
// in their own brand.
export async function resolveBrandId(
  { auth, db }: ActorContext,
  requested: string | undefined,
): Promise<string> {
  if (auth.scope === 'GROUP') {
    if (!requested) throw invalid('brandId', 'BRAND_REQUIRED');
    const brand = await db.brand.findUnique({ where: { id: requested } });
    if (!brand) throw invalid('brandId', 'BRAND_NOT_FOUND');
    return brand.id;
  }

  if (!auth.brandId) throw errors.forbidden();
  if (requested && requested !== auth.brandId) throw errors.forbidden();
  return auth.brandId;
}

export function toMenuCategory(row: CategoryRow): MenuCategory {
  return {
    id: row.id,
    brandId: row.brandId,
    name: localizedTextSchema.parse(row.name),
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    stationId: row.stationId,
  };
}

export function toMenuItem(row: ItemRow): MenuItem {
  return {
    id: row.id,
    brandId: row.brandId,
    categoryId: row.categoryId,
    name: localizedTextSchema.parse(row.name),
    description: row.description === null ? null : localizedTextSchema.parse(row.description),
    basePrice: money(row.basePrice),
    imageUrl: row.imageUrl,
    isActive: row.isActive,
  };
}

export function toModifier(row: ModifierRow): Modifier {
  return {
    id: row.id,
    groupId: row.groupId,
    name: localizedTextSchema.parse(row.name),
    priceDelta: money(row.priceDelta),
    isActive: row.isActive,
  };
}

export function toModifierGroup(row: GroupRow, modifiers: ModifierRow[]): ModifierGroup {
  return {
    id: row.id,
    itemId: row.itemId,
    name: localizedTextSchema.parse(row.name),
    minSelect: row.minSelect,
    maxSelect: row.maxSelect,
    isActive: row.isActive,
    modifiers: modifiers.map(toModifier),
  };
}

export function toBranchOverride(row: OverrideRow): BranchOverride {
  return {
    itemId: row.itemId,
    branchId: row.branchId,
    price: row.priceOverride === null ? null : money(row.priceOverride),
    isAvailable: row.isAvailable,
    schedule: row.schedule === null ? null : openingHoursSchema.parse(row.schedule),
  };
}

export function toCombo(row: ComboRow, slots: { slot: SlotRow; options: OptionRow[] }[]): Combo {
  return {
    id: row.id,
    brandId: row.brandId,
    name: localizedTextSchema.parse(row.name),
    price: money(row.price),
    isActive: row.isActive,
    slots: slots.map(({ slot, options }) => ({
      id: slot.id,
      name: localizedTextSchema.parse(slot.name),
      options: options.map((option) => ({
        itemId: option.itemId,
        priceDelta: money(option.priceDelta),
      })),
    })),
  };
}

// The modifier groups of some items, each with its modifiers, in the order they were made. Two
// queries however many items there are.
export async function loadGroups(
  db: ScopedClient,
  itemIds: string[],
): Promise<Map<string, ModifierGroup[]>> {
  const result = new Map<string, ModifierGroup[]>();
  if (itemIds.length === 0) return result;

  const groups = await db.modifierGroup.findMany({
    where: { itemId: { in: itemIds } },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
  const modifiers =
    groups.length === 0
      ? []
      : await db.modifier.findMany({
          where: { groupId: { in: groups.map((group) => group.id) } },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        });

  const byGroup = new Map<string, ModifierRow[]>();
  for (const modifier of modifiers) {
    byGroup.set(modifier.groupId, [...(byGroup.get(modifier.groupId) ?? []), modifier]);
  }
  for (const group of groups) {
    result.set(group.itemId, [
      ...(result.get(group.itemId) ?? []),
      toModifierGroup(group, byGroup.get(group.id) ?? []),
    ]);
  }
  return result;
}

// The combos given, each with its slots and their options. Three queries however many combos.
export async function describeCombos(db: ScopedClient, rows: ComboRow[]): Promise<Combo[]> {
  if (rows.length === 0) return [];

  const slots = await db.comboSlot.findMany({
    where: { comboId: { in: rows.map((row) => row.id) } },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
  const options =
    slots.length === 0
      ? []
      : await db.comboSlotOption.findMany({
          where: { slotId: { in: slots.map((slot) => slot.id) } },
          orderBy: [{ sortOrder: 'asc' }, { itemId: 'asc' }],
        });

  const optionsBySlot = new Map<string, OptionRow[]>();
  for (const option of options) {
    optionsBySlot.set(option.slotId, [...(optionsBySlot.get(option.slotId) ?? []), option]);
  }
  const slotsByCombo = new Map<string, { slot: SlotRow; options: OptionRow[] }[]>();
  for (const slot of slots) {
    slotsByCombo.set(slot.comboId, [
      ...(slotsByCombo.get(slot.comboId) ?? []),
      { slot, options: optionsBySlot.get(slot.id) ?? [] },
    ]);
  }
  return rows.map((row) => toCombo(row, slotsByCombo.get(row.id) ?? []));
}
