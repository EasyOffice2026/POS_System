# Spec 017: Suppliers

**Status:** Built, API and web. This is the first epic of Phase 4 (purchasing). It gives the purchase orders of the next epic someone to order from, and the price to order at.

## Goal

A brand buys its ingredients from a few suppliers: a dairy for the cheese, a mill for the flour, a cash-and-carry for the rest. Each supplier is kept once for the brand with how to reach them and how long they give to pay, and with the price of each ingredient they sell, so a purchase order is filled in with the right price and a manager can compare suppliers.

## Who can do what

| Action                                    | Who                                                       |
| ----------------------------------------- | --------------------------------------------------------- |
| See the suppliers and their prices        | `inventory:read` (managers, the purchaser)                |
| Add and change suppliers and their prices | `suppliers:write` (the group admin and the brand manager) |

One new permission, `suppliers:write`. A supplier belongs to the whole brand, like an ingredient, so a branch-scoped person reads them and never changes them.

## What is stored

- **Supplier** (`suppliers`): the brand; the name as it is written on the invoices; a contact person, a phone, an email and an address, all optional; the days given to pay (0 for cash on delivery); notes; active or not; a search text.
- **Supplier price** (`supplier_prices`): one per supplier and ingredient: the price of one unit of the ingredient (the unit of spec 012), and when it was last changed.

## Rules

1. **A supplier belongs to a brand** and is never deleted, only made inactive; an inactive supplier is not offered for new orders. Its name is required, at most 100 characters, and unique in the brand whatever the capital letters (`SUPPLIER_NAME_TAKEN`).
2. **Contact details** are optional. A phone has digits, spaces, `+`, `-` and brackets, up to 30 characters (`PHONE_INVALID`); an email must look like one (`EMAIL_INVALID`). The days to pay are a whole number from 0 to 365.
3. **Prices.** A supplier's price list is replaced as a whole: each line names an active ingredient of the brand, once (`INGREDIENT_DUPLICATE`), with a price of 0 or more with three decimals, per unit of the ingredient. At most 500 lines. A price keeps the time it was last changed; a line whose price did not change keeps its time.
4. **Comparing.** The price list of a supplier shows, next to each price, the ingredient's cost (spec 012) so a manager sees a supplier that is dearer than usual.
5. **Search** finds suppliers by their name, as the menu does.
6. **The audit log** records `inventory.supplier.created`, `inventory.supplier.updated` (with what changed) and `inventory.supplier.prices_updated` (with how many lines).

## API

| Method and path                             | What it does                                                                       | Needs             |
| ------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------- |
| `GET /inventory/suppliers?brandId&q&status` | The suppliers of a brand by name, with how many prices each has                    | `inventory:read`  |
| `GET /inventory/suppliers/:id`              | One supplier with its price list                                                   | `inventory:read`  |
| `POST /inventory/suppliers`                 | `{ brandId?, name, contactName?, phone?, email?, address?, paymentDays?, notes? }` | `suppliers:write` |
| `PATCH /inventory/suppliers/:id`            | Changes to a supplier, `isActive` too                                              | `suppliers:write` |
| `PUT /inventory/suppliers/:id/prices`       | `{ prices: [{ ingredientId, price }] }`. Replaces the price list                   | `suppliers:write` |

## Screens

- **Inventory**, a new **Suppliers** tab: the brand's suppliers with search, their phone and days to pay, how many prices each has, and **Add a supplier**.
- **A supplier** opens on its own page: the details (changed with **Edit**), **Deactivate**, and the price list: ingredient, unit, the supplier's price, the ingredient's cost, add and remove lines, **Save prices**.

## Acceptance criteria

1. **Given** the brand manager of Pizza Palace, **when** they add "Gulf Dairy" with a phone and 30 days to pay, **then** it is listed, and adding "gulf dairy" again answers `SUPPLIER_NAME_TAKEN`.
2. **Given** Gulf Dairy, **when** its prices are set to mozzarella at 2.800 per kg, **then** the supplier shows that price next to the mozzarella's cost of 3.000, and the list shows one price.
3. **Given** a price list with the same ingredient twice, **then** the answer is `INGREDIENT_DUPLICATE`.
4. **Given** the Mall's purchaser, **then** they see the suppliers and their prices and cannot add or change one.
5. **Given** Burger Hub's manager, **then** they never see Pizza Palace's suppliers.

## Not in this version

- Prices in another unit than the ingredient's (a box of 12, a sack of 25 kg) and the conversion.
- A history of prices, and price lists valid from a date.
- Supplier documents (trade licence, contracts) and their expiry.

## Open questions

1. Do suppliers sell in packs (a box, a sack) that should be ordered as such, rather than in kg and pieces?
2. Should the cost of an ingredient follow the last price it was received at, once goods are received against orders?
