import {
  type CreateModifierGroupRequest,
  type CreateModifierRequest,
  MAX_MODIFIERS_PER_GROUP,
  type Modifier,
  type ModifierGroup,
  type UpdateModifierGroupRequest,
  type UpdateModifierRequest,
} from '@pos/shared';
import { isDeepStrictEqual } from 'node:util';
import type {
  ModifierGroup as GroupRow,
  Modifier as ModifierRow,
  Prisma,
} from '../../generated/prisma/client';
import { errors } from '../../lib/http-errors';
import type { RequestMeta } from '../../lib/request-meta';
import type { ActorContext } from '../../middleware/authenticate';
import type { ScopedClient } from '../../tenancy/scoped-client';
import { invalid, type MenuDeps, money, toModifier, toModifierGroup } from './menu.common';

// The choices of an item: groups such as "Size" or "Extras", each with its modifiers. A group with
// a smallest choice of 1 or more is required. See docs/specs/004-menu.md.
export function createModifiersService({ audit, cache }: MenuDeps) {
  async function loadGroup({ db }: ActorContext, id: string): Promise<GroupRow> {
    const group = await db.modifierGroup.findUnique({ where: { id } });
    if (!group) throw errors.notFound('Modifier group');
    return group;
  }

  async function loadModifier({ db }: ActorContext, id: string): Promise<ModifierRow> {
    const modifier = await db.modifier.findUnique({ where: { id } });
    if (!modifier) throw errors.notFound('Modifier');
    return modifier;
  }

  async function describeGroup(db: ScopedClient, row: GroupRow): Promise<ModifierGroup> {
    const modifiers = await db.modifier.findMany({
      where: { groupId: row.id },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return toModifierGroup(row, modifiers);
  }

  return {
    async createGroup(
      ctx: ActorContext,
      itemId: string,
      input: CreateModifierGroupRequest,
      meta: RequestMeta,
    ): Promise<ModifierGroup> {
      const { auth, db } = ctx;
      const item = await db.menuItem.findUnique({ where: { id: itemId } });
      if (!item) throw errors.notFound('Menu item');

      const last = await db.modifierGroup.aggregate({
        where: { itemId },
        _max: { sortOrder: true },
      });

      const group = await db.$transaction(async (tx) => {
        const created = await tx.modifierGroup.create({
          data: {
            brandId: item.brandId,
            itemId,
            name: input.name,
            minSelect: input.minSelect,
            maxSelect: input.maxSelect,
            isActive: input.isActive,
            sortOrder: (last._max.sortOrder ?? -1) + 1,
          },
        });
        if (input.modifiers.length > 0) {
          await tx.modifier.createMany({
            data: input.modifiers.map((modifier, index) => ({
              brandId: item.brandId,
              groupId: created.id,
              name: modifier.name,
              priceDelta: modifier.priceDelta,
              isActive: modifier.isActive,
              sortOrder: index,
            })),
          });
        }
        return created;
      });

      await audit(
        {
          action: 'menu.modifier_group.created',
          userId: auth.sub,
          brandId: item.brandId,
          entityType: 'modifier_group',
          entityId: group.id,
          metadata: {
            itemId,
            name: input.name,
            minSelect: input.minSelect,
            maxSelect: input.maxSelect,
            modifiers: input.modifiers.length,
          },
        },
        meta,
      );
      await cache.invalidate(item.brandId);
      return describeGroup(db, group);
    },

    async updateGroup(
      ctx: ActorContext,
      id: string,
      input: UpdateModifierGroupRequest,
      meta: RequestMeta,
    ): Promise<ModifierGroup> {
      const { auth, db } = ctx;
      const target = await loadGroup(ctx, id);

      // The two limits are checked together, one of them may be the stored one.
      const minSelect = input.minSelect ?? target.minSelect;
      const maxSelect = input.maxSelect ?? target.maxSelect;
      if (minSelect > maxSelect) throw invalid('maxSelect', 'SELECT_RANGE_INVALID');

      const data: Prisma.ModifierGroupUpdateInput = {};
      const changed: string[] = [];

      if (
        input.name !== undefined &&
        !isDeepStrictEqual(input.name, toModifierGroup(target, []).name)
      ) {
        data.name = input.name;
        changed.push('name');
      }
      if (input.minSelect !== undefined && input.minSelect !== target.minSelect) {
        data.minSelect = input.minSelect;
        changed.push('minSelect');
      }
      if (input.maxSelect !== undefined && input.maxSelect !== target.maxSelect) {
        data.maxSelect = input.maxSelect;
        changed.push('maxSelect');
      }
      if (input.isActive !== undefined && input.isActive !== target.isActive) {
        data.isActive = input.isActive;
        changed.push('isActive');
      }
      if (changed.length === 0) return describeGroup(db, target);

      const updated = await db.modifierGroup.update({ where: { id }, data });

      await audit(
        {
          action: 'menu.modifier_group.updated',
          userId: auth.sub,
          brandId: target.brandId,
          entityType: 'modifier_group',
          entityId: id,
          metadata: {
            itemId: target.itemId,
            changed,
            ...(changed.includes('isActive') ? { isActive: updated.isActive } : {}),
          },
        },
        meta,
      );
      await cache.invalidate(target.brandId);
      return describeGroup(db, updated);
    },

    async createModifier(
      ctx: ActorContext,
      groupId: string,
      input: CreateModifierRequest,
      meta: RequestMeta,
    ): Promise<Modifier> {
      const { auth, db } = ctx;
      const group = await loadGroup(ctx, groupId);

      const existing = await db.modifier.aggregate({
        where: { groupId },
        _count: { _all: true },
        _max: { sortOrder: true },
      });
      if (existing._count._all >= MAX_MODIFIERS_PER_GROUP) {
        throw errors.conflict(
          'MODIFIER_LIMIT',
          `A group can have at most ${MAX_MODIFIERS_PER_GROUP} modifiers`,
        );
      }

      const modifier = await db.modifier.create({
        data: {
          brandId: group.brandId,
          groupId,
          name: input.name,
          priceDelta: input.priceDelta,
          isActive: input.isActive,
          sortOrder: (existing._max.sortOrder ?? -1) + 1,
        },
      });

      await audit(
        {
          action: 'menu.modifier.created',
          userId: auth.sub,
          brandId: group.brandId,
          entityType: 'modifier',
          entityId: modifier.id,
          metadata: {
            groupId,
            itemId: group.itemId,
            name: input.name,
            priceDelta: money(modifier.priceDelta),
          },
        },
        meta,
      );
      await cache.invalidate(group.brandId);
      return toModifier(modifier);
    },

    async updateModifier(
      ctx: ActorContext,
      id: string,
      input: UpdateModifierRequest,
      meta: RequestMeta,
    ): Promise<Modifier> {
      const { auth, db } = ctx;
      const target = await loadModifier(ctx, id);
      const current = toModifier(target);

      const data: Prisma.ModifierUpdateInput = {};
      const changed: string[] = [];

      if (input.name !== undefined && !isDeepStrictEqual(input.name, current.name)) {
        data.name = input.name;
        changed.push('name');
      }
      if (input.priceDelta !== undefined && input.priceDelta !== current.priceDelta) {
        data.priceDelta = input.priceDelta;
        changed.push('priceDelta');
      }
      if (input.isActive !== undefined && input.isActive !== target.isActive) {
        data.isActive = input.isActive;
        changed.push('isActive');
      }
      if (changed.length === 0) return current;

      const updated = await db.modifier.update({ where: { id }, data });

      await audit(
        {
          action: 'menu.modifier.updated',
          userId: auth.sub,
          brandId: target.brandId,
          entityType: 'modifier',
          entityId: id,
          metadata: {
            groupId: target.groupId,
            changed,
            ...(changed.includes('priceDelta')
              ? { priceDelta: { from: current.priceDelta, to: money(updated.priceDelta) } }
              : {}),
            ...(changed.includes('isActive') ? { isActive: updated.isActive } : {}),
          },
        },
        meta,
      );
      await cache.invalidate(target.brandId);
      return toModifier(updated);
    },
  };
}
