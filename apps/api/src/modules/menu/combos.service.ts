import {
  type Combo,
  type ComboListQuery,
  type CreateComboRequest,
  type UpdateComboRequest,
} from '@pos/shared';
import { isDeepStrictEqual } from 'node:util';
import type { Combo as ComboRow, Prisma } from '../../generated/prisma/client';
import { errors } from '../../lib/http-errors';
import type { RequestMeta } from '../../lib/request-meta';
import type { ActorContext } from '../../middleware/authenticate';
import type { ScopedClient } from '../../tenancy/scoped-client';
import {
  describeCombos,
  LIST_LIMIT,
  type MenuDeps,
  money,
  resolveBrandId,
  statusFilter,
} from './menu.common';

type Slots = CreateComboRequest['slots'];

// What writes the slots of a combo, whether it is the client or a transaction.
type SlotWriter = Pick<ScopedClient, 'comboSlot' | 'comboSlotOption'>;

// The slots as they are compared, to tell whether a request changes them.
const signature = (
  slots: { name: { en: string; ar: string }; options: { itemId: string; priceDelta: string }[] }[],
) =>
  slots.map((slot) => ({
    name: slot.name,
    options: slot.options.map((option) => ({
      itemId: option.itemId,
      priceDelta: option.priceDelta,
    })),
  }));

// Combos of a brand: a fixed price for a set of choices. Each slot is one choice, filled by one of
// its options. See docs/specs/004-menu.md.
export function createCombosService({ audit, cache }: MenuDeps) {
  async function load({ db }: ActorContext, id: string): Promise<ComboRow> {
    const combo = await db.combo.findUnique({ where: { id } });
    if (!combo) throw errors.notFound('Combo');
    return combo;
  }

  async function describeOne(db: ScopedClient, row: ComboRow): Promise<Combo> {
    const [combo] = await describeCombos(db, [row]);
    if (!combo) throw new Error('A combo could not be described.');
    return combo;
  }

  // Every item named in the slots has to be an item of the brand. The problem names the option.
  async function assertItems(db: ScopedClient, brandId: string, slots: Slots): Promise<void> {
    const ids = [...new Set(slots.flatMap((slot) => slot.options.map((option) => option.itemId)))];
    const found = await db.menuItem.findMany({
      where: { id: { in: ids }, brandId },
      select: { id: true },
    });
    const known = new Set(found.map((item) => item.id));

    const problems = slots.flatMap((slot, slotIndex) =>
      slot.options.flatMap((option, optionIndex) =>
        known.has(option.itemId)
          ? []
          : [
              {
                path: `slots.${slotIndex}.options.${optionIndex}.itemId`,
                message: 'ITEM_NOT_FOUND',
              },
            ],
      ),
    );
    if (problems.length > 0) throw errors.validation(problems);
  }

  // The slots and their options, in the order they were sent.
  async function writeSlots(
    tx: SlotWriter,
    brandId: string,
    comboId: string,
    slots: Slots,
  ): Promise<void> {
    for (const [index, slot] of slots.entries()) {
      const created = await tx.comboSlot.create({
        data: { brandId, comboId, name: slot.name, sortOrder: index },
      });
      await tx.comboSlotOption.createMany({
        data: slot.options.map((option, position) => ({
          slotId: created.id,
          itemId: option.itemId,
          brandId,
          priceDelta: option.priceDelta,
          sortOrder: position,
        })),
      });
    }
  }

  return {
    async list({ db }: ActorContext, query: ComboListQuery): Promise<Combo[]> {
      const rows = await db.combo.findMany({
        where: {
          ...(query.brandId ? { brandId: query.brandId } : {}),
          ...statusFilter(query.status),
        },
        orderBy: { id: 'asc' },
        take: LIST_LIMIT,
      });
      return describeCombos(db, rows);
    },

    async get(ctx: ActorContext, id: string): Promise<Combo> {
      return describeOne(ctx.db, await load(ctx, id));
    },

    async create(ctx: ActorContext, input: CreateComboRequest, meta: RequestMeta): Promise<Combo> {
      const { auth, db } = ctx;
      const brandId = await resolveBrandId(ctx, input.brandId);
      await assertItems(db, brandId, input.slots);

      const combo = await db.$transaction(async (tx) => {
        const created = await tx.combo.create({
          data: { brandId, name: input.name, price: input.price, isActive: input.isActive },
        });
        await writeSlots(tx, brandId, created.id, input.slots);
        return created;
      });

      await audit(
        {
          action: 'menu.combo.created',
          userId: auth.sub,
          brandId,
          entityType: 'combo',
          entityId: combo.id,
          metadata: { name: input.name, price: money(combo.price), slots: input.slots.length },
        },
        meta,
      );
      await cache.invalidate(brandId);
      return describeOne(db, combo);
    },

    async update(
      ctx: ActorContext,
      id: string,
      input: UpdateComboRequest,
      meta: RequestMeta,
    ): Promise<Combo> {
      const { auth, db } = ctx;
      const target = await load(ctx, id);
      const current = await describeOne(db, target);

      const data: Prisma.ComboUpdateInput = {};
      const changed: string[] = [];

      if (input.name !== undefined && !isDeepStrictEqual(input.name, current.name)) {
        data.name = input.name;
        changed.push('name');
      }
      if (input.price !== undefined && input.price !== current.price) {
        data.price = input.price;
        changed.push('price');
      }
      if (input.isActive !== undefined && input.isActive !== target.isActive) {
        data.isActive = input.isActive;
        changed.push('isActive');
      }

      const newSlots = input.slots;
      const slotsChanged =
        newSlots !== undefined && !isDeepStrictEqual(signature(newSlots), signature(current.slots));
      if (slotsChanged) {
        await assertItems(db, target.brandId, newSlots);
        changed.push('slots');
      }
      if (changed.length === 0) return current;

      await db.$transaction(async (tx) => {
        if (Object.keys(data).length > 0) await tx.combo.update({ where: { id }, data });
        if (slotsChanged) {
          // The options go with their slot.
          await tx.comboSlot.deleteMany({ where: { comboId: id } });
          await writeSlots(tx, target.brandId, id, newSlots);
        }
      });

      const updated = await load(ctx, id);
      await audit(
        {
          action: 'menu.combo.updated',
          userId: auth.sub,
          brandId: target.brandId,
          entityType: 'combo',
          entityId: id,
          metadata: {
            changed,
            ...(changed.includes('price')
              ? { price: { from: current.price, to: money(updated.price) } }
              : {}),
            ...(changed.includes('isActive') ? { isActive: updated.isActive } : {}),
          },
        },
        meta,
      );
      await cache.invalidate(target.brandId);
      return describeOne(db, updated);
    },
  };
}
