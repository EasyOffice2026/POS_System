import { describe, expect, it } from 'vitest';
import { type Permission, systemRoles } from './access';
import {
  applyPromotions,
  createPromotionRequestSchema,
  type PricedLine,
  type PricingContext,
  type Promotion,
  putPromoCodeRequestSchema,
} from './promotions';

const ids = {
  brand: '01990000-0000-7000-8000-000000000001',
  mall: '01990000-0000-7000-8000-000000000011',
  downtown: '01990000-0000-7000-8000-000000000012',
  drinks: '01990000-0000-7000-8000-000000000302',
  pizzas: '01990000-0000-7000-8000-000000000301',
  cola: '01990000-0000-7000-8000-000000000403',
};

const codesOf = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) => (result.error?.issues ?? []).map((issue) => `${issue.path.join('.')}: ${issue.message}`);

function promotion(overrides: Partial<Promotion>): Promotion {
  return {
    id: '01990000-0000-7000-8000-00000000f001',
    brandId: ids.brand,
    name: { en: 'Promotion', ar: 'عرض' },
    kind: 'percent_off',
    value: '20.00',
    buyQuantity: null,
    getQuantity: null,
    appliesTo: 'all',
    categoryIds: [],
    itemIds: [],
    branchIds: [],
    startsOn: null,
    endsOn: null,
    days: [],
    startTime: null,
    endTime: null,
    code: null,
    sortOrder: 0,
    isActive: true,
    ...overrides,
  };
}

let lineNumber = 0;
// A dish line: Kuwait is UTC+3, so 13:00Z is 16:00 at the branch, on Wednesday 14 October 2026.
function line(price: number, overrides: Partial<PricedLine> = {}): PricedLine {
  lineNumber += 1;
  return {
    id: `line-${lineNumber}`,
    kind: 'item',
    itemId: ids.cola,
    categoryId: ids.drinks,
    quantity: 1,
    unitPrice: price,
    status: 'pending',
    addedAt: new Date('2026-10-14T13:00:00Z'),
    ...overrides,
  };
}

const context: PricingContext = {
  businessDate: '2026-10-14',
  branchId: ids.mall,
  timeZone: 'Asia/Kuwait',
  promoCode: null,
};

const amounts = (lines: PricedLine[], promotions: Promotion[], at = context) =>
  applyPromotions(lines, promotions, at).map((row) => [row.promotion.name.en, row.amount]);

describe('a promotion', () => {
  it('needs the numbers of its kind, and keeps only those', () => {
    const parsed = createPromotionRequestSchema.parse({
      name: { en: 'Happy hour', ar: 'ساعة سعيدة' },
      kind: 'percent_off',
      value: '20',
      buyQuantity: 2,
      appliesTo: 'categories',
      categoryIds: [ids.drinks],
      itemIds: [ids.cola],
      days: [5, 1],
      startTime: '15:00',
      endTime: '18:00',
      code: ' welcome10 ',
    });
    expect(parsed).toMatchObject({
      value: '20.00',
      buyQuantity: null,
      categoryIds: [ids.drinks],
      itemIds: [],
      days: [1, 5],
      code: 'WELCOME10',
      isActive: true,
    });
    expect(
      codesOf(
        createPromotionRequestSchema.safeParse({
          name: { en: 'X', ar: 'س' },
          kind: 'buy_get',
          appliesTo: 'items',
          startTime: '15:00',
          startsOn: '2026-10-20',
          endsOn: '2026-10-10',
        }),
      ),
    ).toEqual([
      'buyQuantity: QUANTITY_INVALID',
      'getQuantity: QUANTITY_INVALID',
      'itemIds: ITEM_REQUIRED',
      'endsOn: RANGE_INVALID',
      'endTime: TIME_INVALID',
    ]);
    expect(
      codesOf(
        createPromotionRequestSchema.safeParse({
          name: { en: 'X', ar: 'س' },
          kind: 'percent_off',
          value: '120',
        }),
      ),
    ).toEqual(['value: PERCENT_INVALID']);
    expect(codesOf(putPromoCodeRequestSchema.safeParse({ code: 'no' }))).toEqual([
      'code: PROMO_CODE_INVALID',
    ]);
  });

  it('is set up by the group admin, the brand manager and marketing', () => {
    const has = (key: string, permission: Permission) =>
      systemRoles.find((role) => role.key === key)?.permissions.includes(permission);
    expect(has('group_admin', 'promotions:write')).toBe(true);
    expect(has('brand_manager', 'promotions:write')).toBe(true);
    expect(has('marketing', 'promotions:write')).toBe(true);
    expect(has('branch_manager', 'promotions:write')).toBe(false);
    expect(has('cashier', 'promotions:write')).toBe(false);
  });
});

describe('what promotions take off', () => {
  it('takes a percentage off what was added in the hours of a happy hour (criterion 1)', () => {
    const happyHour = promotion({
      name: { en: 'Happy hour', ar: 'ساعة سعيدة' },
      appliesTo: 'categories',
      categoryIds: [ids.drinks],
      startTime: '15:00',
      endTime: '18:00',
    });
    const inside = line(5000);
    const after = line(5000, { addedAt: new Date('2026-10-14T15:30:00Z') });
    const pizza = line(20_000, { categoryId: ids.pizzas });
    expect(amounts([inside, after, pizza], [happyHour])).toEqual([['Happy hour', 1000]]);
  });

  it('runs past midnight when the end is before the start, and keeps to its days', () => {
    const lateNight = promotion({ startTime: '22:00', endTime: '02:00', days: [3] });
    // 23:30 on Wednesday and 01:00 on Thursday at the branch.
    const wednesday = line(5000, { addedAt: new Date('2026-10-14T20:30:00Z') });
    const thursday = line(5000, { addedAt: new Date('2026-10-14T22:00:00Z') });
    expect(amounts([wednesday], [lateNight])).toEqual([['Promotion', 1000]]);
    expect(amounts([thursday], [lateNight])).toEqual([]);
  });

  it('gives the cheapest of each full group free, the dearest first (criterion 2)', () => {
    const buyTwo = promotion({
      name: { en: 'Buy 2 get 1', ar: '2 + 1' },
      kind: 'buy_get',
      value: null,
      buyQuantity: 2,
      getQuantity: 1,
    });
    const lines = [line(24_000), line(20_000, { quantity: 2 }), line(18_000)];
    expect(amounts(lines, [buyTwo])).toEqual([['Buy 2 get 1', 20_000]]);
  });

  it('takes an amount off once, at most what the dishes cost', () => {
    const off = promotion({ kind: 'amount_off', value: '3.000' });
    expect(amounts([line(1500), line(1000)], [off])).toEqual([['Promotion', 2500]]);
    expect(amounts([line(5000), line(5000)], [off])).toEqual([['Promotion', 3000]]);
  });

  it('gives each unit one promotion, in their order', () => {
    const first = promotion({
      name: { en: 'First', ar: 'أول' },
      sortOrder: 0,
      value: '10.00',
      itemIds: [ids.cola],
      appliesTo: 'items',
    });
    const second = promotion({ name: { en: 'Second', ar: 'ثاني' }, sortOrder: 1, value: '50.00' });
    const cola = line(5000, { quantity: 2 });
    const pizza = line(20_000, { itemId: ids.pizzas, categoryId: ids.pizzas });
    expect(amounts([cola, pizza], [second, first])).toEqual([
      ['First', 1000],
      ['Second', 10_000],
    ]);
  });

  it('applies a coded promotion only with its code (criterion 3)', () => {
    const welcome = promotion({
      name: { en: 'Welcome', ar: 'أهلًا' },
      value: '10.00',
      code: 'WELCOME',
    });
    const lines = [line(30_000), line(20_000)];
    expect(amounts(lines, [welcome])).toEqual([]);
    expect(amounts(lines, [welcome], { ...context, promoCode: 'WELCOME' })).toEqual([
      ['Welcome', 5000],
    ]);
  });

  it('keeps to its branches, its dates, and leaves combos, voided lines and inactive ones out (criterion 5)', () => {
    const mallOnly = promotion({ branchIds: [ids.mall] });
    expect(amounts([line(5000)], [mallOnly], { ...context, branchId: ids.downtown })).toEqual([]);
    expect(amounts([line(5000)], [promotion({ startsOn: '2026-10-15' })])).toEqual([]);
    expect(amounts([line(5000)], [promotion({ endsOn: '2026-10-13' })])).toEqual([]);
    expect(amounts([line(5000)], [promotion({ isActive: false })])).toEqual([]);
    expect(
      amounts(
        [line(5000, { kind: 'combo', itemId: null }), line(5000, { status: 'voided' })],
        [promotion({})],
      ),
    ).toEqual([]);
  });
});
