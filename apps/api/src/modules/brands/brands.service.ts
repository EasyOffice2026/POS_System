import {
  type Branch,
  type BranchDetail,
  type Brand,
  type BrandSettings,
  type brandSettingsRequestSchema,
  closedWeek,
  type CreateBranchRequest,
  type CreateBrandRequest,
  type CursorQuery,
  localizedTextSchema,
  type Page,
  parseBranchConfig,
  parseBrandSettings,
  type Printer,
  type UpdateBranchRequest,
  type UpdateBrandRequest,
} from '@pos/shared';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { z } from 'zod';
import type { Branch as BranchRow, Brand as BrandRow, Prisma } from '../../generated/prisma/client';
import { type AuditEvent, writeAudit } from '../../lib/audit';
import { errors } from '../../lib/http-errors';
import { cursorPageArgs, toPage } from '../../lib/pagination';
import type { MenuCache } from '../../lib/menu-cache';
import type { PrismaClient } from '../../lib/prisma';
import type { RequestMeta } from '../../lib/request-meta';
import type { ActorContext } from '../../middleware/authenticate';

type PrintersRequest = NonNullable<NonNullable<CreateBranchRequest['config']>['printers']>;

function toBrand(row: BrandRow): Brand {
  return {
    id: row.id,
    name: localizedTextSchema.parse(row.name),
    logoUrl: row.logoUrl,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}

function toBranch(row: BranchRow): Branch {
  return {
    id: row.id,
    brandId: row.brandId,
    name: localizedTextSchema.parse(row.name),
    address: row.address,
    timezone: row.timezone,
    isActive: row.isActive,
  };
}

function toBranchDetail(row: BranchRow): BranchDetail {
  return { ...toBranch(row), config: parseBranchConfig(row.config) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// A printer that was just added has no id yet. One that is sent back with its id keeps it, so a
// later module can point at the printer.
function withIds(printers: PrintersRequest): Printer[] {
  return printers.map((printer) => ({
    id: printer.id ?? randomUUID(),
    name: printer.name,
    kind: printer.kind,
    host: printer.host,
    port: printer.port,
  }));
}

// See docs/specs/002-brands-and-branches.md for who may do what and for the rules.
export function createBrandsService({
  prisma,
  menuCache,
}: {
  prisma: PrismaClient;
  // The tills read the kitchen switches with the branch menu, so a change clears it (spec 027).
  menuCache?: MenuCache;
}) {
  const audit = (event: AuditEvent, meta: RequestMeta) =>
    writeAudit(prisma, { ...event, ip: meta.ip, userAgent: meta.userAgent });

  // A brand the actor cannot see is answered like one that does not exist.
  async function loadBrand({ db }: ActorContext, id: string): Promise<BrandRow> {
    const brand = await db.brand.findUnique({ where: { id } });
    if (!brand) throw errors.notFound('Brand');
    return brand;
  }

  async function loadBranch({ db }: ActorContext, id: string): Promise<BranchRow> {
    const branch = await db.branch.findUnique({ where: { id } });
    if (!branch) throw errors.notFound('Branch');
    return branch;
  }

  return {
    async listBrands({ db }: ActorContext, { limit, cursor }: CursorQuery): Promise<Page<Brand>> {
      const rows = await db.brand.findMany(cursorPageArgs(limit, cursor));
      return toPage(rows, limit, toBrand);
    },

    async getBrand(ctx: ActorContext, id: string): Promise<Brand> {
      return toBrand(await loadBrand(ctx, id));
    },

    // The settings of a brand, with the defaults filled in. See docs/specs/009-settings.md.
    async getSettings(ctx: ActorContext, id: string): Promise<BrandSettings> {
      return parseBrandSettings((await loadBrand(ctx, id)).settings);
    },

    // Replaces the settings. A new kitchen station gets its id here, so categories and kitchen
    // screens can point at it.
    async updateSettings(
      ctx: ActorContext,
      id: string,
      input: z.output<typeof brandSettingsRequestSchema>,
      meta: RequestMeta,
    ): Promise<BrandSettings> {
      const { auth, db } = ctx;
      const before = parseBrandSettings((await loadBrand(ctx, id)).settings);
      const settings: BrandSettings = {
        ...input,
        kitchenStations: input.kitchenStations.map((station) => ({
          id: station.id ?? randomUUID(),
          name: station.name,
        })),
      };
      const changed = (Object.keys(settings) as (keyof BrandSettings)[]).filter(
        (key) => !isDeepStrictEqual(settings[key], before[key]),
      );
      if (changed.length === 0) return before;

      const updated = await db.brand.update({
        where: { id },
        data: { settings: settings as unknown as Prisma.InputJsonObject },
      });
      await audit(
        {
          action: 'brand.settings_updated',
          userId: auth.sub,
          brandId: id,
          entityType: 'brand',
          entityId: id,
          metadata: { changed },
        },
        meta,
      );
      return parseBrandSettings(updated.settings);
    },

    async createBrand(
      { auth, db }: ActorContext,
      input: CreateBrandRequest,
      meta: RequestMeta,
    ): Promise<Brand> {
      const brand = await db.brand.create({
        data: { name: input.name, logoUrl: input.logoUrl ?? null, isActive: input.isActive },
      });

      await audit(
        {
          action: 'brand.created',
          userId: auth.sub,
          brandId: brand.id,
          entityType: 'brand',
          entityId: brand.id,
          metadata: { name: input.name, isActive: brand.isActive },
        },
        meta,
      );
      return toBrand(brand);
    },

    async updateBrand(
      ctx: ActorContext,
      id: string,
      input: UpdateBrandRequest,
      meta: RequestMeta,
    ): Promise<Brand> {
      const { auth, db } = ctx;
      const target = await loadBrand(ctx, id);

      const data: Prisma.BrandUpdateInput = {};
      const changed: string[] = [];

      if (input.name !== undefined && !isDeepStrictEqual(input.name, toBrand(target).name)) {
        data.name = input.name;
        changed.push('name');
      }
      if (input.logoUrl !== undefined && input.logoUrl !== target.logoUrl) {
        data.logoUrl = input.logoUrl;
        changed.push('logoUrl');
      }
      if (input.isActive !== undefined && input.isActive !== target.isActive) {
        data.isActive = input.isActive;
        changed.push('isActive');
      }
      if (changed.length === 0) return toBrand(target);

      const updated = await db.brand.update({ where: { id }, data });

      // A brand that is made inactive is not signed out here. Its terminals are refused at the
      // next sign-in or token refresh, within 15 minutes.
      await audit(
        {
          action: 'brand.updated',
          userId: auth.sub,
          brandId: id,
          entityType: 'brand',
          entityId: id,
          metadata: {
            changed,
            ...(changed.includes('isActive') ? { isActive: updated.isActive } : {}),
          },
        },
        meta,
      );
      return toBrand(updated);
    },

    async listBranches(
      ctx: ActorContext,
      brandId: string,
      { limit, cursor }: CursorQuery,
    ): Promise<Page<Branch>> {
      await loadBrand(ctx, brandId);

      const rows = await ctx.db.branch.findMany({
        where: { brandId },
        ...cursorPageArgs(limit, cursor),
      });
      return toPage(rows, limit, toBranch);
    },

    async getBranch(ctx: ActorContext, id: string): Promise<BranchDetail> {
      return toBranchDetail(await loadBranch(ctx, id));
    },

    async createBranch(
      ctx: ActorContext,
      brandId: string,
      input: CreateBranchRequest,
      meta: RequestMeta,
    ): Promise<BranchDetail> {
      const { auth, db } = ctx;
      // Only for a brand the actor can see. For any other the answer is "not found".
      const brand = await loadBrand(ctx, brandId);

      const config = {
        openingHours: input.config?.openingHours ?? closedWeek(),
        printers: withIds(input.config?.printers ?? []),
      };
      const branch = await db.branch.create({
        data: {
          brandId: brand.id,
          name: input.name,
          address: input.address ?? null,
          timezone: input.timezone,
          isActive: input.isActive,
          config,
        },
      });

      await audit(
        {
          action: 'branch.created',
          userId: auth.sub,
          brandId: brand.id,
          branchId: branch.id,
          entityType: 'branch',
          entityId: branch.id,
          metadata: { name: input.name, isActive: branch.isActive },
        },
        meta,
      );
      return toBranchDetail(branch);
    },

    async updateBranch(
      ctx: ActorContext,
      id: string,
      input: UpdateBranchRequest,
      meta: RequestMeta,
    ): Promise<BranchDetail> {
      const { auth, db } = ctx;
      const target = await loadBranch(ctx, id);
      const current = parseBranchConfig(target.config);

      const data: Prisma.BranchUpdateInput = {};
      const changed: string[] = [];

      if (input.name !== undefined && !isDeepStrictEqual(input.name, toBranch(target).name)) {
        data.name = input.name;
        changed.push('name');
      }
      if (input.address !== undefined && input.address !== target.address) {
        data.address = input.address;
        changed.push('address');
      }
      if (input.timezone !== undefined && input.timezone !== target.timezone) {
        data.timezone = input.timezone;
        changed.push('timezone');
      }
      if (input.isActive !== undefined && input.isActive !== target.isActive) {
        data.isActive = input.isActive;
        changed.push('isActive');
      }

      const openingHours = input.config?.openingHours ?? current.openingHours;
      const printers = input.config?.printers ? withIds(input.config.printers) : current.printers;
      // Ramadan and holiday hours (docs/client-decisions.md); a new period gets its id here.
      const specialHours = input.config?.specialHours
        ? input.config.specialHours.map((period) => ({ ...period, id: period.id ?? randomUUID() }))
        : current.specialHours;
      const hoursChanged = !isDeepStrictEqual(openingHours, current.openingHours);
      const printersChanged = !isDeepStrictEqual(printers, current.printers);
      const specialChanged = !isDeepStrictEqual(specialHours, current.specialHours);
      const kitchen = input.config?.kitchen ?? current.kitchen;
      const kitchenChanged = !isDeepStrictEqual(kitchen, current.kitchen);
      if (hoursChanged) changed.push('openingHours');
      if (printersChanged) changed.push('printers');
      if (specialChanged) changed.push('specialHours');
      if (kitchenChanged) changed.push('kitchen');

      if (hoursChanged || printersChanged || specialChanged || kitchenChanged) {
        // Keep any part of the configuration that this module does not know about.
        const stored = isRecord(target.config) ? target.config : {};
        data.config = { ...stored, openingHours, printers, specialHours, kitchen };
      }
      if (changed.length === 0) return toBranchDetail(target);

      const updated = await db.branch.update({ where: { id }, data });

      // A branch that is made inactive keeps its history. Its terminals are refused at the next
      // sign-in or token refresh, within 15 minutes.
      await audit(
        {
          action: 'branch.updated',
          userId: auth.sub,
          brandId: target.brandId,
          branchId: id,
          entityType: 'branch',
          entityId: id,
          metadata: {
            changed,
            ...(changed.includes('isActive') ? { isActive: updated.isActive } : {}),
            ...(kitchenChanged ? { kitchen } : {}),
          },
        },
        meta,
      );
      if (kitchenChanged) await menuCache?.invalidate(target.brandId, id);
      return toBranchDetail(updated);
    },
  };
}

export type BrandsService = ReturnType<typeof createBrandsService>;
