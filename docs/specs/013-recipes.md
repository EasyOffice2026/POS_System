# Spec 013: Recipes and stock taken off by sales

**Status:** Built, API and web. This is the second epic of Phase 3. It joins the menu of [spec 004](004-menu.md) to the ingredients of [spec 012](012-ingredients-and-stock.md): what a dish uses, and the stock going down when the dish is sold.

## Goal

The brand manager writes down what each dish and each modifier uses: a Margherita takes 250 g of dough, 80 g of mozzarella, 60 ml of tomato sauce; "extra cheese" adds 40 g of mozzarella. When an order is paid, the branch's stock goes down by what was sold, without anybody typing anything. The menu shows what a dish costs to make next to its price.

## Who can do what

| Action                              | Who                                             |
| ----------------------------------- | ----------------------------------------------- |
| See a recipe and the cost of a dish | Everybody with `menu:read` and `inventory:read` |
| Write a recipe                      | Whoever changes the menu (`menu:write`)         |

The stock itself is taken off by the system, under the name of the cashier who took the payment.

## What is stored

- **Recipe line** (`recipe_lines`): the brand; the dish (menu item) or the modifier it belongs to, one of the two; the ingredient; the quantity of it in the ingredient's unit. A dish has one line per ingredient.
- **Stock movement** of kind `sold` (spec 012): one per ingredient per paid order, pointing at the order.

## Rules

1. **A recipe belongs to a dish or a modifier of the same brand**, with an ingredient of that brand (`INGREDIENT_NOT_FOUND` otherwise). Quantities are above 0, with 3 decimals, in the ingredient's unit. An ingredient appears once per recipe (`INGREDIENT_DUPLICATE`), and a recipe holds at most 50 lines. Saving a recipe replaces it as a whole.
2. **A combo has no recipe of its own.** What it uses is the recipes of the dishes chosen for its slots, with their modifiers (spec 005 keeps those choices on the line).
3. **What an order uses** is, for every line that is not voided: the dish's recipe times the quantity, plus each chosen modifier's recipe times the quantity; for a combo line, the same for each chosen dish. The same ingredient over several lines adds up to one movement.
4. **The stock goes down when the order is paid** (spec 007), in the same transaction as the payment, at the order's branch, as `sold` movements that point at the order and name it ("Order 12"). A dish without a recipe takes nothing off. A payment never fails because of the stock.
5. **A sale may take the stock below zero**: the sale happened, and the count was wrong. Waste and corrections still cannot (spec 012, rule 2). The stock screen shows a quantity below zero in red; a correction puts it right.
6. **The cost of a dish** is the sum of quantity times the ingredient's cost, for its recipe; a modifier's cost likewise. It is shown with the recipe, next to the price, as a percentage of the price. Costs are the brand's current costs (spec 012, rule 6).
7. **A refund puts nothing back**; a void before payment takes nothing off, because nothing was taken yet.
8. **The audit log** records a changed recipe (`menu.recipe.updated`) with the dish or modifier.

## API

| Method and path                  | What it does                                                   | Needs                            |
| -------------------------------- | -------------------------------------------------------------- | -------------------------------- |
| `GET /menu/items/:id/recipe`     | The lines of the dish with their ingredients, and the cost     | `menu:read` and `inventory:read` |
| `PUT /menu/items/:id/recipe`     | `{ lines: [{ ingredientId, quantity }] }`. Replaces the recipe | `menu:write`                     |
| `GET /menu/modifiers/:id/recipe` | The same for a modifier                                        | `menu:read` and `inventory:read` |
| `PUT /menu/modifiers/:id/recipe` | The same for a modifier                                        | `menu:write`                     |

## Screens

- **Item page**, a new **Recipe** tab: a table of ingredient (chosen from the brand's list) and quantity in its unit, add and remove lines, save; the cost of the dish and its share of the price.
- **Modifiers tab**: a **Recipe** button on each modifier opens the same editor in a dialog.
- **Stock**: a quantity below zero in red. **Movements**: a `sold` movement names its order.

## Acceptance criteria

1. **Given** a Margherita with 80 g of mozzarella and "extra cheese" with 40 g, **when** 2 Margheritas with extra cheese are paid at the Mall, **then** the Mall's mozzarella goes down by 240 g in one `sold` movement that names the order.
2. **Given** a combo whose pizza slot holds that Margherita, **when** the combo is paid, **then** the mozzarella goes down by 80 g.
3. **Given** mozzarella at 100 g, **when** 240 g are sold, **then** the stock is −140 g, shown in red, and the payment went through.
4. **Given** mozzarella at 3.000 KWD per kg and the recipe above, **then** the Margherita's cost shows 0.240 KWD.
5. **Given** a recipe with the same ingredient twice, **then** the answer is `INGREDIENT_DUPLICATE`.
6. **Given** a dish of Burger Hub, **then** Pizza Palace's manager cannot see or write its recipe.

## Not in this version

- Putting stock back on a refund, or on a void after payment.
- A history of what a dish cost on each day.
- Recipes with sub-recipes (a sauce made from ingredients, used by dishes).
- Taking stock off when the dish is sent to the kitchen rather than paid.

## Open questions

1. ~~Should the stock go down when the kitchen starts the dish, rather than at payment, for shops where tables pay at the end?~~ Answered 16 October 2026: each brand chooses in Settings ("When does stock go down?"): when the order is paid (the default), or when the kitchen starts the ticket, in which case paying takes nothing off and a ticket the kitchen never starts takes nothing off either.
2. Should a dish with no recipe be flagged on the menu, so nothing is forgotten?
