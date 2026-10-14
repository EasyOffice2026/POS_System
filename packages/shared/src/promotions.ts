import { z } from 'zod';
import { localizedNameSchema, localizedTextSchema } from './localized';
import { menuStatusSchema } from './menu';
import { formatMoney, priceSchema, toMils } from './money';

// Discounts a brand sets up once and the POS applies by itself. See docs/specs/021-promotions.md.

export const promotionKinds = ['percent_off', 'buy_get', 'amount_off'] as const;
export const promotionKindSchema = z.enum(promotionKinds, { error: 'PROMOTION_KIND_INVALID' });
export type PromotionKind = z.infer<typeof promotionKindSchema>;

export const promotionScopes = ['all', 'categories', 'items'] as const;
export const promotionScopeSchema = z.enum(promotionScopes, { error: 'PROMOTION_SCOPE_INVALID' });
export type PromotionScope = z.infer<typeof promotionScopeSchema>;

const timeSchema = z
  .string({ error: 'TIME_INVALID' })
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'TIME_INVALID');

// ---------------------------------------------------------------------------------------------
// What the API answers

export const promotionSchema = z.object({
  id: z.uuid(),
  brandId: z.uuid(),
  name: localizedTextSchema,
  kind: promotionKindSchema,
  // percent_off: "20.00"; amount_off: "1.000"; buy_get: null.
  value: z.string().nullable(),
  buyQuantity: z.number().int().nullable(),
  getQuantity: z.number().int().nullable(),
  appliesTo: promotionScopeSchema,
  categoryIds: z.array(z.uuid()),
  itemIds: z.array(z.uuid()),
  // None means every branch.
  branchIds: z.array(z.uuid()),
  startsOn: z.iso.date().nullable(),
  endsOn: z.iso.date().nullable(),
  // 0 is Sunday, 6 is Saturday; none means every day.
  days: z.array(z.number().int().min(0).max(6)),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  code: z.string().nullable(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
});
export type Promotion = z.infer<typeof promotionSchema>;

// A promotion as an order shows it, with what it took off.
export const appliedPromotionSchema = z.object({
  id: z.uuid(),
  name: localizedTextSchema,
  amount: z.string(),
});
export type AppliedPromotion = z.infer<typeof appliedPromotionSchema>;

// ---------------------------------------------------------------------------------------------
// Requests

export const promotionListQuerySchema = z.object({
  brandId: z.uuid().optional(),
  status: menuStatusSchema.optional(),
});
export type PromotionListQuery = z.infer<typeof promotionListQuerySchema>;

export const promoCodeSchema = z
  .string({ error: 'PROMO_CODE_INVALID' })
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{3,20}$/, 'PROMO_CODE_INVALID');

const percentSchema = z
  .string({ error: 'PERCENT_INVALID' })
  .trim()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, 'PERCENT_INVALID')
  .refine((text) => Number(text) > 0 && Number(text) <= 100, 'PERCENT_INVALID')
  .transform((text) => Number(text).toFixed(2));

const promotionFields = z.object({
  name: localizedNameSchema,
  kind: promotionKindSchema,
  value: z.string().nullable().optional(),
  buyQuantity: z.number({ error: 'QUANTITY_INVALID' }).int().min(1).max(20).nullable().optional(),
  getQuantity: z.number({ error: 'QUANTITY_INVALID' }).int().min(1).max(20).nullable().optional(),
  appliesTo: promotionScopeSchema.default('all'),
  categoryIds: z.array(z.uuid()).max(100).default([]),
  itemIds: z.array(z.uuid()).max(500).default([]),
  branchIds: z.array(z.uuid()).max(100).default([]),
  startsOn: z.iso.date({ error: 'DATE_INVALID' }).nullable().default(null),
  endsOn: z.iso.date({ error: 'DATE_INVALID' }).nullable().default(null),
  days: z
    .array(z.number().int().min(0).max(6), { error: 'DAYS_INVALID' })
    .max(7)
    .refine((days) => new Set(days).size === days.length, 'DAYS_INVALID')
    .default([]),
  startTime: timeSchema.nullable().default(null),
  endTime: timeSchema.nullable().default(null),
  code: promoCodeSchema.nullable().default(null),
  sortOrder: z.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
});

// The numbers each kind needs, and nothing else (rule 3).
function checkPromotion(
  promotion: z.infer<typeof promotionFields>,
  ctx: z.RefinementCtx,
): z.infer<typeof promotionFields> {
  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: 'custom', path: [path], message });
  let value: string | null = null;
  if (promotion.kind === 'percent_off') {
    const parsed = percentSchema.safeParse(promotion.value ?? '');
    if (parsed.success) value = parsed.data;
    else issue('value', 'PERCENT_INVALID');
  } else if (promotion.kind === 'amount_off') {
    const parsed = priceSchema.safeParse(promotion.value ?? '');
    if (parsed.success && toMils(parsed.data) > 0) value = parsed.data;
    else issue('value', 'PRICE_INVALID');
  } else {
    if (!promotion.buyQuantity) issue('buyQuantity', 'QUANTITY_INVALID');
    if (!promotion.getQuantity) issue('getQuantity', 'QUANTITY_INVALID');
  }
  if (promotion.appliesTo === 'categories' && promotion.categoryIds.length === 0) {
    issue('categoryIds', 'CATEGORY_REQUIRED');
  }
  if (promotion.appliesTo === 'items' && promotion.itemIds.length === 0) {
    issue('itemIds', 'ITEM_REQUIRED');
  }
  if (promotion.startsOn && promotion.endsOn && promotion.endsOn < promotion.startsOn) {
    issue('endsOn', 'RANGE_INVALID');
  }
  if ((promotion.startTime === null) !== (promotion.endTime === null)) {
    issue(promotion.startTime === null ? 'startTime' : 'endTime', 'TIME_INVALID');
  } else if (promotion.startTime && promotion.startTime === promotion.endTime) {
    issue('endTime', 'TIME_INVALID');
  }
  const buy = promotion.kind === 'buy_get';
  return {
    ...promotion,
    value,
    buyQuantity: buy ? (promotion.buyQuantity ?? null) : null,
    getQuantity: buy ? (promotion.getQuantity ?? null) : null,
    categoryIds: promotion.appliesTo === 'categories' ? promotion.categoryIds : [],
    itemIds: promotion.appliesTo === 'items' ? promotion.itemIds : [],
    days: [...promotion.days].sort((a, b) => a - b),
  };
}

export const createPromotionRequestSchema = promotionFields
  .extend({ brandId: z.uuid().optional() })
  .strict()
  .transform((promotion, ctx) => ({
    ...checkPromotion(promotion, ctx),
    brandId: promotion.brandId,
  }));
export type CreatePromotionRequest = z.output<typeof createPromotionRequestSchema>;

// A change sends the whole promotion again, so the rules between its fields can be checked.
export const updatePromotionRequestSchema = promotionFields
  .strict()
  .transform((promotion, ctx) => checkPromotion(promotion, ctx));
export type UpdatePromotionRequest = z.output<typeof updatePromotionRequestSchema>;

export const putPromoCodeRequestSchema = z.strictObject({ code: promoCodeSchema });
export type PutPromoCodeRequest = z.infer<typeof putPromoCodeRequestSchema>;

// ---------------------------------------------------------------------------------------------
// Working out what promotions take off an order (rules 1 to 4)

export interface PricedLine {
  id: string;
  kind: 'item' | 'combo';
  itemId: string | null;
  // The category of the dish, for promotions on categories.
  categoryId: string | null;
  quantity: number;
  // One unit with its modifiers, in fils (mils).
  unitPrice: number;
  status: 'pending' | 'sent' | 'voided';
  // When the line was added: what the days and hours of a promotion are checked against.
  addedAt: Date;
}

export interface PricingContext {
  businessDate: string;
  branchId: string;
  timeZone: string;
  // The code typed on the order, in capitals, or null.
  promoCode: string | null;
}

export interface AppliedAmount {
  promotion: Promotion;
  // In fils (mils).
  amount: number;
}

// The day of the week (0 is Sunday) and the minute of the day on the branch's clock.
function localTime(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    weekday: weekdays.indexOf(part('weekday')),
    minute: (Number(part('hour')) % 24) * 60 + Number(part('minute')),
  };
}

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

// Whether the promotion can apply to this order at all: active, the branch, the dates, the code.
function fitsOrder(promotion: Promotion, context: PricingContext): boolean {
  if (!promotion.isActive) return false;
  if (promotion.branchIds.length > 0 && !promotion.branchIds.includes(context.branchId))
    return false;
  if (promotion.startsOn && context.businessDate < promotion.startsOn) return false;
  if (promotion.endsOn && context.businessDate > promotion.endsOn) return false;
  if (promotion.code && promotion.code !== context.promoCode) return false;
  return true;
}

// Whether the promotion applies to a line: the dish, and when it was added (rules 1 and 2).
function fitsLine(promotion: Promotion, line: PricedLine, timeZone: string): boolean {
  if (line.kind !== 'item' || line.status === 'voided' || !line.itemId) return false;
  if (promotion.appliesTo === 'items' && !promotion.itemIds.includes(line.itemId)) return false;
  if (
    promotion.appliesTo === 'categories' &&
    (!line.categoryId || !promotion.categoryIds.includes(line.categoryId))
  ) {
    return false;
  }
  if (promotion.days.length === 0 && !promotion.startTime) return true;
  const at = localTime(line.addedAt, timeZone);
  if (promotion.days.length > 0 && !promotion.days.includes(at.weekday)) return false;
  if (promotion.startTime && promotion.endTime) {
    const start = minutesOf(promotion.startTime);
    const end = minutesOf(promotion.endTime);
    // An end before the start runs past midnight.
    const inside =
      start < end ? at.minute >= start && at.minute < end : at.minute >= start || at.minute < end;
    if (!inside) return false;
  }
  return true;
}

// What each promotion takes off, one promotion per unit, in their order (rules 3 and 4). It is the
// same function for the API, which stores the result, and for tests.
export function applyPromotions(
  lines: PricedLine[],
  promotions: Promotion[],
  context: PricingContext,
): AppliedAmount[] {
  const units = lines.flatMap((line) =>
    Array.from({ length: Math.max(0, line.quantity) }, (_, index) => ({
      key: `${line.id}:${index}`,
      line,
      price: line.unitPrice,
    })),
  );
  const used = new Set<string>();
  const ordered = [...promotions].sort((a, b) => a.sortOrder - b.sortOrder);
  const applied: AppliedAmount[] = [];

  for (const promotion of ordered) {
    if (!fitsOrder(promotion, context)) continue;
    const eligible = units.filter(
      (unit) => !used.has(unit.key) && fitsLine(promotion, unit.line, context.timeZone),
    );
    if (eligible.length === 0) continue;

    let amount = 0;
    if (promotion.kind === 'percent_off') {
      const percent = Math.round(Number(promotion.value ?? '0') * 100);
      for (const unit of eligible) {
        amount += Math.round((unit.price * percent) / 10_000);
        used.add(unit.key);
      }
    } else if (promotion.kind === 'amount_off') {
      const total = eligible.reduce((sum, unit) => sum + unit.price, 0);
      amount = Math.min(toMils(promotion.value ?? '0'), total);
      for (const unit of eligible) used.add(unit.key);
    } else {
      const buy = promotion.buyQuantity ?? 0;
      const get = promotion.getQuantity ?? 0;
      const group = buy + get;
      if (buy < 1 || get < 1) continue;
      const dearestFirst = [...eligible].sort(
        (a, b) => b.price - a.price || a.key.localeCompare(b.key),
      );
      const full = Math.floor(dearestFirst.length / group) * group;
      for (let start = 0; start < full; start += group) {
        const chunk = dearestFirst.slice(start, start + group);
        for (const unit of chunk.slice(buy)) amount += unit.price;
        for (const unit of chunk) used.add(unit.key);
      }
    }
    if (amount > 0) applied.push({ promotion, amount });
  }
  return applied;
}

// The words shown for a promotion's numbers, kept here so the API and the screens agree.
export const promotionValueText = (promotion: Promotion): string =>
  promotion.kind === 'percent_off'
    ? `${Number(promotion.value ?? '0')}%`
    : promotion.kind === 'amount_off'
      ? formatMoney(promotion.value ?? '0')
      : `${promotion.buyQuantity ?? 0}+${promotion.getQuantity ?? 0}`;
