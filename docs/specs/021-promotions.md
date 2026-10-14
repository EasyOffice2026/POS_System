# Spec 021: Promotions

**Status:** Built, API and web. This is the second epic of Phase 5 (reports, promotions and loyalty). It adds discounts the brand sets up once and the POS applies by itself, on top of the menu of [spec 004](004-menu.md) and the orders of [spec 005](005-orders.md).

## Goal

Pizza Palace runs a happy hour on drinks from 3 to 6 in the afternoon, "buy 2 pizzas, get 1 free" on Tuesdays, and a code "WELCOME" for 10% off that it gives to new customers on Instagram. The marketing team sets these up in the back office; the cashier does nothing but type the code when a customer has one, and the order, the receipt and the reports show what each promotion took off.

## Who can do what

| Action                            | Who                                                                  |
| --------------------------------- | -------------------------------------------------------------------- |
| See the promotions                | `menu:read`                                                          |
| Add and change promotions         | `promotions:write`: the group admin, the brand manager and marketing |
| Type a promotion code on an order | `orders:write` (the cashier)                                         |

One new permission, `promotions:write`.

## What is stored

- **Promotion** (`promotions`): the brand; the name in both languages; the kind (`percent_off`, `buy_get`, `amount_off`) with its numbers (a percentage, buy and get quantities, or an amount); what it applies to (`all` dishes, some `categories` or some `items`); the branches (none means every branch); the first and last day, the days of the week and the hours, all optional; a code, optional; the order in which it is tried; active or not.
- **Order**: the code typed on it, what the promotions took off in all, and each promotion applied with its name and amount, as it was when worked out.

## Rules

1. **What a promotion applies to.** Only dishes (`item` lines that are not voided); a combo is already a deal and is left out. `all` means every dish of the brand, `categories` the dishes of the chosen categories, `items` the chosen dishes.
2. **When.** A promotion applies to a line when the line was added at a moment that fits it: the order's business day between the first and the last day, if set; the day of the week among the chosen days, if any; the time between the start and the end, if set, on the branch's clock (an end before the start runs past midnight). The branch must be one of the chosen branches, if any.
3. **The kinds.**
   - `percent_off`: each unit of the lines it applies to costs the percentage less (0.01 to 100, two decimals), rounded to the fils.
   - `buy_get`: of the units it applies to, the dearest first, every group of _buy + get_ units gives the _get_ cheapest of the group free. Units that do not fill a group stay at their price.
   - `amount_off`: an amount (above 0) off the units it applies to, at most what they cost, once per order.
4. **One promotion per unit.** Promotions are tried in their order (then the oldest first); a unit a promotion used is not used by another. A `buy_get` uses every unit of the groups it fills.
5. **Codes.** A promotion with a code applies only to an order on which that code was typed. A code is 3 to 20 letters and digits, kept in capitals and unique in the brand among the promotions that have one (`PROMO_CODE_TAKEN`). Typing a code that no active promotion of the brand has, for today and that branch, answers `PROMO_CODE_INVALID`. One code per order; it can be removed while the order is open.
6. **The total.** The subtotal, less what the promotions took off, less the manual discount of spec 005 (a percentage of what is left, or an amount up to what is left), is the total. The promotions are worked out again every time the order changes, from the promotions as they are then.
7. **Reports and shifts** count what the promotions took off as discounts.
8. **The audit log** records `menu.promotion.created` and `menu.promotion.updated`; a code on an order is part of the order.

## API

| Method and path                       | What it does                              | Needs              |
| ------------------------------------- | ----------------------------------------- | ------------------ |
| `GET /menu/promotions?brandId&status` | The promotions of a brand                 | `menu:read`        |
| `GET /menu/promotions/:id`            | One promotion                             | `menu:read`        |
| `POST /menu/promotions`               | A new promotion                           | `promotions:write` |
| `PATCH /menu/promotions/:id`          | Changes, `isActive` too                   | `promotions:write` |
| `PUT /orders/:id/promo-code`          | `{ code }`. Types a code on an open order | `orders:write`     |
| `DELETE /orders/:id/promo-code`       | Removes it                                | `orders:write`     |

An order in every answer now has `promoCode`, `promotionDiscount` and `promotions: [{ id, name, amount }]`.

## Screens

- **Menu**, a new **Promotions** tab: the brand's promotions with what they give and when, and a form to add or change one (kind, numbers, what it applies to, branches, days, hours, dates, code).
- **POS**: the order shows each promotion applied under the subtotal; **Promo code** opens a box for the code, and the code can be removed. The receipt shows the promotions too.

## Acceptance criteria

1. **Given** 20% off drinks from 15:00 to 18:00, **when** a cola at 5.000 is added at 16:00 and another at 18:30, **then** the order takes 1.000 off for the first one only.
2. **Given** "buy 2 get 1" on pizzas, **when** pizzas at 24, 20 and 20 are ordered with a fourth at 18, **then** 20.000 is taken off (the cheapest of the first group of three) and the 18 pays full price.
3. **Given** a code WELCOME for 10% off everything, **when** it is typed on an order of 50.000, **then** 5.000 is taken off; an unknown code answers `PROMO_CODE_INVALID`; removing the code puts the total back.
4. **Given** 20% off drinks and a manual discount of 10%, **then** the manual discount is 10% of what is left after the promotion.
5. **Given** a promotion for the Mall only, **then** an order at Downtown is not given it.
6. **Given** the marketing role, **then** it can add a promotion; a cashier cannot.

## Not in this version

- A minimum order for a promotion, a limit on how many times a code is used, and codes for one customer only.
- Free items that are not on the order, and promotions on combos or modifiers.
- Promotions shown on the menu of the POS before they apply.

## Open questions

1. Which promotions does the client run today, so they can be set up first?
2. Should a code be usable once per customer, once the loyalty epic knows the customers?
