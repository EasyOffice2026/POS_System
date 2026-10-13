# Spec 012: Ingredients and stock

**Status:** Built, API and web. This is the first epic of Phase 3 (inventory and recipes). Recipes, the automatic stock deduction on sales, transfers between branches and stock counts are the next epics; this one gives them the ingredients and the stock they work on.

## Goal

A brand keeps one list of the ingredients it buys: flour, mozzarella, cola cans, boxes. Each branch has a stock of them. Goods received, corrections and waste are recorded with a reason, so the stock on the screen is the stock in the store, and a manager sees what is running low.

## Who can do what

| Action                                         | Group Admin | Brand Manager | Branch Manager (own branches) | Purchaser (own branches) |
| ---------------------------------------------- | :---------: | :-----------: | :---------------------------: | :----------------------: |
| See the ingredients and the stock              |      x      |       x       |               x               |            x             |
| Add and change ingredients                     |      x      |       x       |                               |                          |
| Receive goods, correct the stock, record waste |      x      |       x       |               x               |            x             |

Two new permissions: `inventory:read` and `inventory:write` (the stock), and `ingredients:write` (the list). The purchaser role gets `inventory:read` and `inventory:write`. A cashier and the kitchen see nothing of it.

## What is stored

- **Ingredient** (`ingredients`): the brand, the name in both languages, the unit it is counted in (`g`, `kg`, `ml`, `l` or `piece`), the cost of one unit (for the value of the stock and, later, the cost of a dish), the stock below which it is low (the brand's default), active or not, and a search text as for menu items.
- **Branch stock** (`branch_stock`): one row per ingredient per branch: the quantity, and the low level when the branch has its own.
- **Stock movement** (`stock_movements`): every change of a branch's stock: the ingredient, the kind (`received`, `adjustment`, `waste`; later `sold`, `transfer_in`, `transfer_out`, `count`), the quantity (negative when it leaves), the quantity after, a note, what it refers to (an order or a transfer, later), who, when.

## Rules

1. **An ingredient belongs to a brand** and is never deleted, only made inactive; its stock and its movements stay. The name must be given in both languages. The unit cannot change once the ingredient has a movement, so old movements keep their meaning (`UNIT_LOCKED`).
2. **Quantities** have 3 decimals and are never below zero (`STOCK_NEGATIVE`). A kilogram is counted as `kg` and typed as 2.500, not as grams.
3. **Receiving goods** adds the quantity (above 0). **Waste** takes it off (above 0), with a note that says why. **A correction** sets the stock to what was counted; the movement is the difference, and a note is required.
4. **Every change is a movement**, written in the same transaction as the new quantity; the quantity of a branch's stock row is always the sum of its movements. The row is created on the first movement.
5. **Low stock.** An ingredient is low at a branch when its quantity is at or below the branch's level, or the brand's default when the branch has none. The stock screen shows it first and marks it. `GET /inventory/stock?branchId&low=true` lists only those, for the alerts and the purchaser.
6. **Cost.** The value of the stock of a branch is the sum of quantity times the ingredient's cost. The cost is the brand's current cost; a history of costs is not kept in this version.
7. **The audit log** records a new or changed ingredient (`ingredient.created`, `ingredient.updated`); movements are their own record and are not written twice.
8. **Search** finds ingredients by their name in either language, as the menu does.

## API

| Method and path                                         | What it does                                                                        | Needs               |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------- |
| `GET /inventory/ingredients?brandId&q&status`           | The ingredients of a brand, by name                                                 | `inventory:read`    |
| `POST /inventory/ingredients`                           | `{ brandId?, name, unit, costPerUnit, lowLevel, isActive? }`                        | `ingredients:write` |
| `PATCH /inventory/ingredients/:id`                      | Changes to an ingredient                                                            | `ingredients:write` |
| `GET /inventory/stock?branchId&low`                     | The stock of a branch: each active ingredient with its quantity, level and value    | `inventory:read`    |
| `PUT /inventory/stock/:branchId/:ingredientId/level`    | `{ lowLevel }`: the branch's own low level, or null for the brand's                 | `inventory:write`   |
| `POST /inventory/movements`                             | `{ branchId, ingredientId, kind, quantity, note? }` (rule 3). Answers the stock row | `inventory:write`   |
| `GET /inventory/movements?branchId&ingredientId&cursor` | The history, newest first                                                           | `inventory:read`    |

## Screens

- **Inventory** in the admin menu, with three tabs like the menu area: **Ingredients** (the brand's list, add and change, search), **Stock** (a branch: the table of ingredients with quantity, low level, value and a low badge; buttons to receive, correct and record waste), **Movements** (the history of a branch, filtered by ingredient).

## Acceptance criteria

1. **Given** flour in kg with a low level of 5, **when** the Mall receives 20 and records 2.5 waste, **then** its stock is 17.500 and the history shows the two movements with who did them.
2. **Given** a stock of 17.500, **when** a correction sets it to 17, **then** the movement is −0.500 with its note.
3. **Given** a stock of 4, **then** the ingredient is low at that branch, listed first, and `low=true` lists it.
4. **Given** waste of 30 on a stock of 17.500, **then** the answer is `STOCK_NEGATIVE` and nothing changes.
5. **Given** an ingredient with a movement, **when** its unit is changed, **then** the answer is `UNIT_LOCKED`.
6. **Given** a purchaser of the Mall, **then** they can receive goods at the Mall, not at Downtown, and cannot add an ingredient.
7. **Given** Burger Hub's manager, **then** they never see Pizza Palace's ingredients or stock.

## Not in this version

- Recipes and the stock taken off by sales (the next epic).
- Transfers between branches, stock counts and purchase orders (later epics; suppliers are Phase 4).
- A history of costs, and the cost of a dish.
- Alerts sent by email or on the terminal; the low list is on the screen.

## Open questions

1. Should the low level be a number of days of use rather than a quantity, once sales take stock off?
2. Who should get the low-stock alert: the branch manager, the purchaser, both?
