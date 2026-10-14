# Spec 024: Group dashboard

**Status:** Built, API and web. This is the fifth and last epic of Phase 5. It puts today's figures of every brand and branch on the dashboard, read live from the orders of [spec 005](005-orders.md), the payments of [spec 007](007-payments.md), the shifts of [spec 010](010-shifts.md), the refunds of [spec 011](011-refunds.md) and the tables of [spec 023](023-floor-plan.md).

## Goal

The owner opens the dashboard at 9 in the evening. In one look they see what the group sold today and how that compares with last Thursday at the same time, which branch is busy and which is quiet, the busy hours, the dishes that sell, and what needs a manager: a shift left open since yesterday, a branch with many voids or refunds today.

## Who can do what

| Action               | Who                                                                             |
| -------------------- | ------------------------------------------------------------------------------- |
| See today's overview | `reports:read` with group or brand scope: the group admin and the brand manager |

No new permission. A group admin sees every brand, or picks one; a brand manager sees their brand. A branch manager keeps the dashboard they have.

## Rules

1. **Today is each branch's business day** (spec 009, rule 7): the date on the branch's clock, which ends at the hour the branch's day ends. Branches and brands that are not active are left out.
2. **Sales** are the totals of the orders paid on today's business day, after every discount; **orders** are how many; **the average order** is sales divided by orders; **discounts** are what promotions, manual discounts and points took off those orders.
3. **Last week** is the same branch's business day seven days before, counting only what was paid up to the same moment of that day, so a day half done is compared with a day half done.
4. **Refunds** are the money given back today, whenever the order was paid; **voids** are the orders of today's business day that were voided, with their totals.
5. **Each branch** shows its sales, orders and last week's sales, the orders open now and their total, its tables in use out of its tables, and its open shifts.
6. **By hour**: today's sales and orders by the hour of payment on each branch's clock.
7. **Top dishes**: the ten dishes and combos sold most today across the branches shown, by quantity, with their sales before the order's discount.
8. **Needs attention**: a shift still open that was opened on an earlier business day, and a branch with voids or refunds today, the largest first.
9. The figures are read when asked; nothing is stored. The screen asks again every minute.

## API

| Method and path                 | What it does                                     | Needs          |
| ------------------------------- | ------------------------------------------------ | -------------- |
| `GET /reports/overview?brandId` | Today's overview of the brands and branches seen | `reports:read` |

A branch manager is answered `403`: the overview is for the group and the brands.

## Screens

- **Dashboard** for the group admin and the brand manager: a brand picker (group admin), the figures of today with the change against last week, the branches in a table, a bar chart of sales by hour, the top dishes, and the list of what needs attention. Low-stock warnings stay below, as before.

## Acceptance criteria

1. **Given** two paid orders today at the Mall (10.000 and 20.000) and one at Downtown (5.000), **then** the overview shows sales 35.000, 3 orders and an average of 11.667, and the Mall 30.000 with 2 orders.
2. **Given** an order paid last week on the same weekday before the same time, and another paid later that day, **then** last week's sales count only the first.
3. **Given** an open order of 8.000 at a table, **then** the Mall shows 1 open order of 8.000 and 1 table in use.
4. **Given** a shift opened yesterday and still open, a voided order and a refund today, **then** they are listed under what needs attention.
5. **Given** today's orders paid at 12:10 and 19:45 on the branch clock, **then** hours 12 and 19 show them.
6. **Given** Burger Hub's brand manager, **then** they see only Burger Hub; a branch manager is refused.

## Not in this version

- Other days than today, and charts over weeks (the sales reports of spec 020 cover periods).
- Targets per branch, and messages sent to managers.
- Labour cost and food cost on the dashboard.

## Open questions

1. Which figures does the owner want first on the phone screen?
2. Should a big refund or void (above an amount the client chooses) send a message to the owner?
