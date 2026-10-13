# Spec 016: Low-stock alerts

**Status:** Built, API and web. This is the fifth and last epic of Phase 3. It turns the low level of [spec 012](012-ingredients-and-stock.md) into a warning a manager sees without opening the stock of each branch.

## Goal

A manager signs in in the morning and sees at once which branches are running out of what: mozzarella is out at the Mall, flour is low at Downtown. One click opens the stock of that branch with only the low ingredients, ready to order or to send a transfer ([spec 014](014-stock-transfers.md)).

## Who sees what

Everybody with `inventory:read` sees the alerts of the branches they see: a branch manager or a purchaser their own branches, a brand manager every branch of the brand, the group admin every branch (of one brand when they choose one). No new permission.

## Rules

1. **An ingredient alerts at a branch** when its low level there (the branch's own, or the brand's default) is above 0 and its quantity is at or below it. A level of 0 means the ingredient is not watched, so an ingredient a branch never uses does not alert.
2. **Out of stock** is an alert whose quantity is 0 or below (a sale may take it below zero, spec 013). Out comes before low.
3. **Order.** Within a branch: out first, then the ingredients furthest below their level (quantity divided by level), then by name. Branches with the most out-of-stock items come first, then by name.
4. **Only active** branches and ingredients alert.
5. **Nothing is stored.** The alerts are worked out from the stock each time they are asked for, so they are never stale and need no clearing: receiving goods or a transfer makes the alert go away.

## API

| Method and path                 | What it does                                                                                         | Needs            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------- |
| `GET /inventory/alerts?brandId` | The branches with alerts: `{ data: [{ branch, items: [{ ingredient, quantity, level, status }] }] }` | `inventory:read` |

`status` is `out` or `low`; `level` is the level that applied; `branch` is `{ id, brandId, name }`. Branches without an alert are left out.

## Screens

- **Dashboard**, a new **Stock alerts** panel for people with `inventory:read`: each branch with how many ingredients are out and low, the first five with their quantity and level (out in red, low in amber), and **See all** to the branch's stock showing only what is low. "All ingredients are above their level" when there is nothing. The panel reads the alerts again every five minutes.
- **Stock**: the address can ask for only what is low (`?low=1`), which is what **See all** opens.

## Acceptance criteria

1. **Given** mozzarella with a level of 2 at the Mall and 0.5 in stock, and flour with a level of 5 and 0, **then** the Mall alerts with flour out first and mozzarella low.
2. **Given** an ingredient with a level of 0 and nothing in stock, **then** it does not alert.
3. **Given** the Mall with its own level of 10 for flour and the brand's default of 5, **when** the Mall has 8, **then** it alerts as low with a level of 10.
4. **Given** the Mall's manager, **then** they see only the Mall's alerts; Burger Hub's manager never sees Pizza Palace's.
5. **Given** an alert, **when** the branch receives enough, **then** the alert is gone.

## Not in this version

- Alerts sent by email, SMS or on the POS terminal.
- Levels worked out from what is sold (days of stock left).
- Marking a dish as unavailable on the POS when an ingredient of its recipe is out.

## Open questions

1. Who should get an alert by email or message, and how often: the branch manager, the purchaser, both, once a day?
2. Should the POS show a dish as sold out when an ingredient of its recipe is out?
