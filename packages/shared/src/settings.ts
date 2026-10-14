import { z } from 'zod';
import { localizedNameSchema, localizedTextSchema } from './localized';

// The settings of a brand, from the client's answers. Each one is an option a manager changes on
// the Settings screen. See docs/specs/009-settings.md.

export const MAX_PAYMENT_METHODS = 20;
export const MAX_DISCOUNT_PRESETS = 10;
export const MAX_KITCHEN_STATIONS = 10;

// Cash is always there and is the only way to pay that gives change. It is not in the list.
export const CASH = 'cash';
export const CASH_NAME = { en: 'Cash', ar: 'نقدًا' } as const;

// A key names a way to pay in the database: "knet", "talabat". It never changes once used.
export const paymentMethodKeySchema = z
  .string({ error: 'PAYMENT_METHOD_KEY_INVALID' })
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{1,32}$/, 'PAYMENT_METHOD_KEY_INVALID')
  .refine((key) => key !== CASH, 'PAYMENT_METHOD_KEY_INVALID');

export const paymentMethodSettingSchema = z.strictObject({
  key: paymentMethodKeySchema,
  name: localizedTextSchema,
  isActive: z.boolean(),
});
export type PaymentMethodSetting = z.infer<typeof paymentMethodSettingSchema>;

const paymentMethodInputSchema = z.strictObject({
  key: paymentMethodKeySchema,
  name: localizedNameSchema,
  isActive: z.boolean().default(true),
});

// When a void needs a manager: never (the cashier voids with a reason), once the line or the
// order went to the kitchen, or always (rule 5).
export const voidRules = ['never', 'after_send', 'always'] as const;
export const voidRuleSchema = z.enum(voidRules, { error: 'VOID_RULE_INVALID' });
export type VoidRule = z.infer<typeof voidRuleSchema>;

// Who marks a kitchen ticket done: the kitchen screen, or the cashier when the food is handed
// over (rule 7).
export const ticketDoneBySchema = z.enum(['kitchen', 'cashier'], {
  error: 'TICKET_DONE_BY_INVALID',
});
export type TicketDoneBy = z.infer<typeof ticketDoneBySchema>;

export const kitchenStationSchema = z.strictObject({ id: z.uuid(), name: localizedTextSchema });
export type KitchenStation = z.infer<typeof kitchenStationSchema>;

const kitchenStationInputSchema = z.strictObject({
  // A new station has no id yet; the API gives it one.
  id: z.uuid().optional(),
  name: localizedNameSchema,
});

// A percentage with up to 2 decimals, 0 to 100, written as "10.00".
const percentText = /^\d{1,3}(\.\d{1,2})?$/;
const percentSchema = z
  .string({ error: 'PERCENT_INVALID' })
  .trim()
  .regex(percentText, 'PERCENT_INVALID')
  .refine((value) => Number(value) <= 100, 'PERCENT_INVALID')
  .transform((value) => Number(value).toFixed(2));

// The loyalty rules of a brand (docs/specs/022-loyalty.md): points earned per KWD paid, what a
// point is worth when spent, and the fewest that can be spent at once.
export const loyaltySettingsSchema = z.strictObject({
  enabled: z.boolean(),
  pointsPerKwd: z
    .number({ error: 'POINTS_RATE_INVALID' })
    .int('POINTS_RATE_INVALID')
    .min(0, 'POINTS_RATE_INVALID')
    .max(1000, 'POINTS_RATE_INVALID'),
  pointValue: z
    .string({ error: 'PRICE_INVALID' })
    .trim()
    .regex(/^\d{1,3}(\.\d{1,3})?$/, 'PRICE_INVALID')
    .refine((text) => Number(text) > 0, 'PRICE_INVALID')
    .transform((text) => Number(text).toFixed(3)),
  minRedeem: z
    .number({ error: 'POINTS_MIN_INVALID' })
    .int('POINTS_MIN_INVALID')
    .min(1, 'POINTS_MIN_INVALID')
    .max(1_000_000, 'POINTS_MIN_INVALID'),
});
export type LoyaltySettings = z.infer<typeof loyaltySettingsSchema>;

export const defaultLoyaltySettings: LoyaltySettings = {
  enabled: false,
  pointsPerKwd: 1,
  pointValue: '0.010',
  minRedeem: 100,
};

export const brandSettingsSchema = z.object({
  paymentMethods: z.array(paymentMethodSettingSchema),
  // The discount buttons on the POS, as percentages.
  discountPresets: z.array(percentSchema),
  // The percentage a cashier may give without a manager. "0.00" means never.
  cashierDiscountLimit: percentSchema,
  voidNeedsManager: voidRuleSchema,
  ticketDoneBy: ticketDoneBySchema,
  kitchenStations: z.array(kitchenStationSchema),
  loyalty: loyaltySettingsSchema,
});
export type BrandSettings = z.infer<typeof brandSettingsSchema>;

export const defaultBrandSettings: BrandSettings = {
  paymentMethods: [{ key: 'knet', name: { en: 'KNET', ar: 'كي نت' }, isActive: true }],
  discountPresets: ['5.00', '10.00', '15.00', '20.00', '25.00', '50.00'],
  cashierDiscountLimit: '0.00',
  voidNeedsManager: 'never',
  ticketDoneBy: 'kitchen',
  kitchenStations: [],
  loyalty: defaultLoyaltySettings,
};

// The whole settings as a request. Unknown fields are refused.
export const brandSettingsRequestSchema = z
  .strictObject({
    paymentMethods: z
      .array(paymentMethodInputSchema)
      .max(MAX_PAYMENT_METHODS, 'PAYMENT_METHODS_TOO_MANY')
      .refine(
        (methods) => new Set(methods.map((method) => method.key)).size === methods.length,
        'PAYMENT_METHOD_KEY_TAKEN',
      ),
    discountPresets: z
      .array(percentSchema)
      .max(MAX_DISCOUNT_PRESETS, 'DISCOUNT_PRESETS_TOO_MANY')
      .refine(
        (presets) =>
          new Set(presets).size === presets.length && presets.every((p) => Number(p) > 0),
        'DISCOUNT_PRESET_INVALID',
      ),
    cashierDiscountLimit: percentSchema,
    voidNeedsManager: voidRuleSchema,
    ticketDoneBy: ticketDoneBySchema,
    kitchenStations: z
      .array(kitchenStationInputSchema)
      .max(MAX_KITCHEN_STATIONS, 'KITCHEN_STATIONS_TOO_MANY'),
    // Left out by an older screen, it keeps the default.
    loyalty: loyaltySettingsSchema.default(defaultLoyaltySettings),
  })
  .transform((settings) => ({
    ...settings,
    // The buttons in order of size, so 5 is before 50 whatever was typed.
    discountPresets: [...settings.discountPresets].sort((a, b) => Number(a) - Number(b)),
  }));
export type BrandSettingsRequest = z.input<typeof brandSettingsRequestSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Reads stored settings. A brand that was never set up has none, so each part falls back to its
// default, and a part that cannot be read does too.
export function parseBrandSettings(stored: unknown): BrandSettings {
  const source = isRecord(stored) ? stored : {};
  const pick = <T>(schema: z.ZodType<T>, value: unknown, fallback: T): T => {
    const result = schema.safeParse(value);
    return result.success ? result.data : fallback;
  };
  return {
    paymentMethods: pick(
      brandSettingsSchema.shape.paymentMethods,
      source.paymentMethods,
      defaultBrandSettings.paymentMethods,
    ),
    discountPresets: pick(
      brandSettingsSchema.shape.discountPresets,
      source.discountPresets,
      defaultBrandSettings.discountPresets,
    ),
    cashierDiscountLimit: pick(
      brandSettingsSchema.shape.cashierDiscountLimit,
      source.cashierDiscountLimit,
      defaultBrandSettings.cashierDiscountLimit,
    ),
    voidNeedsManager: pick(
      brandSettingsSchema.shape.voidNeedsManager,
      source.voidNeedsManager,
      defaultBrandSettings.voidNeedsManager,
    ),
    ticketDoneBy: pick(
      brandSettingsSchema.shape.ticketDoneBy,
      source.ticketDoneBy,
      defaultBrandSettings.ticketDoneBy,
    ),
    kitchenStations: pick(
      brandSettingsSchema.shape.kitchenStations,
      source.kitchenStations,
      defaultBrandSettings.kitchenStations,
    ),
    loyalty: pick(brandSettingsSchema.shape.loyalty, source.loyalty, defaultLoyaltySettings),
  };
}

// The active ways to pay other than cash.
export const activePaymentMethods = (settings: BrandSettings) =>
  settings.paymentMethods.filter((method) => method.isActive);

// Whether a cashier may give this discount alone: a percentage within the limit (rule 3).
export function withinCashierLimit(
  settings: BrandSettings,
  discount: { kind: 'percent' | 'amount'; value: string },
): boolean {
  return (
    discount.kind === 'percent' &&
    Number(settings.cashierDiscountLimit) > 0 &&
    Number(discount.value) <= Number(settings.cashierDiscountLimit)
  );
}

// Whether a void needs a manager, given whether what is voided went to the kitchen (rule 5).
export function voidNeedsApproval(settings: BrandSettings, sent: boolean): boolean {
  switch (settings.voidNeedsManager) {
    case 'never':
      return false;
    case 'after_send':
      return sent;
    case 'always':
      return true;
  }
}
