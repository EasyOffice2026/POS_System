# Spec 020: Sales reports

**Status:** Built, API and web. This is the first epic of Phase 5 (reports, promotions and loyalty). It reads the orders, payments and refunds of Phase 2 and the recipes of [spec 013](013-recipes.md); it stores nothing new.

## Goal

At the end of the week the brand manager wants to know how each branch did: how much was sold, how it was paid, which dishes sold best, what they cost to make, and how much was given back. One screen answers it for any period and any branch, and a table can be taken to a spreadsheet.

## Who can do what

| Action               | Who                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| See the sales report | `reports:read`: the group admin, the brand manager, and the branch manager for their own branches |

One new permission, `reports:read`. A cashier, the kitchen, marketing and the purchaser do not see it.

## Rules

1. **The period** is a range of business days (`from` and `to`, both included), at most 92 days (`RANGE_TOO_LONG`); `to` is not before `from` (`RANGE_INVALID`). An order belongs to the business day it was opened on (spec 009).
2. **Where.** One branch, or every branch the person sees in a brand. A group admin names the brand (`BRAND_REQUIRED`) or a branch.
3. **Sales are paid orders.** Gross sales are the sum of the order subtotals (before discounts), discounts their discounts, net sales their totals. Refunds are what was refunded on those orders, whenever it was refunded; net after refunds is net sales minus refunds. The average order is net sales divided by the number of paid orders. Voided orders are counted apart and add no money.
4. **By day:** the paid orders, net sales and refunds of each business day of the period, the days without sales included.
5. **By payment method:** the number of payments and the amount of each way of paying (cash, KNET, ...), named as at the time of payment, with the refunds given back that way.
6. **By item:** for each dish and combo sold, the quantity and the sales of its lines that were not voided, before the order's discount. For a dish with a recipe, the food cost is the recipe's cost (at today's ingredient costs, without modifiers) times the quantity, and the food cost percentage is that over the sales. Highest sales first.
7. **By category:** the dishes' quantities and sales added up by menu category; combos are a line of their own.
8. Money has three decimals (KWD), as everywhere.

## API

| Method and path                               | What it does                                               | Needs          |
| --------------------------------------------- | ---------------------------------------------------------- | -------------- |
| `GET /reports/sales?from&to&brandId&branchId` | `{ from, to, summary, days, payments, items, categories }` | `reports:read` |

## Screens

- **Reports** in the admin menu: the brand (for a group admin), the branch or all branches, the period with quick choices (today, yesterday, the last 7 days, this month), then the summary as figures, and tables by day, by payment method, by item (with food cost and food cost %) and by category. **Download CSV** takes the items table to a spreadsheet.

## Acceptance criteria

1. **Given** two paid orders at the Mall on 14 October (20.000, and 30.000 with a 3.000 discount) and one voided, **then** the report for that day shows 2 orders, gross 50.000, discounts 3.000, net 47.000, average 23.500 and 1 voided.
2. **Given** a refund of 5.000 on one of them, **then** refunds are 5.000 and net after refunds 42.000, and cash shows the refund if it was given in cash.
3. **Given** 3 Margheritas sold at 20.000 with a recipe costing 2.400 each, **then** the item line shows 3, 60.000, food cost 7.200 and 12%.
4. **Given** a period of 100 days, **then** the answer is `RANGE_TOO_LONG`.
5. **Given** the Mall's manager, **then** the report has only the Mall, even for all branches; a cashier cannot see reports.

## Not in this version

- Sales by hour, by cashier and by order type.
- Comparing two periods, and charts.
- Reports sent by email on a schedule.
- Food cost from the cost at the time of sale, and modifiers' recipes in the food cost.

## Open questions

1. Which reports does the client need every day, and which only at the end of the month?
2. Should a refund count on the day it was given rather than on the day of the sale?
