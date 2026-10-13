# Spec 018: Purchase orders

**Status:** Built, API and web. This is the second epic of Phase 4 (purchasing). It orders ingredients for a branch from a supplier of [spec 017](017-suppliers.md), at the supplier's prices. Receiving the goods into stock is the next epic.

## Goal

The Mall is low on mozzarella (spec 016). Its purchaser opens a purchase order to Gulf Dairy, picks the ingredients and quantities, and the prices come from the dairy's price list. While it is a draft it can be changed; once sent it is fixed, printed or shared with the supplier, and waits for the delivery.

## Who can do what

| Action                                   | Who                                                      |
| ---------------------------------------- | -------------------------------------------------------- |
| See the purchase orders of a branch      | `inventory:read` at the branch                           |
| Create, change, send and cancel an order | `inventory:write` at the branch (its manager, purchaser) |

A brand manager and the group admin can do all of it at every branch of the brand. No new permission.

## What is stored

- **Purchase order** (`purchase_orders`): a number; the brand, the branch and the supplier; the status (`draft`, `sent`, `received`, `cancelled`; `received` is set by the next epic); the expected delivery date; a note; the total; who created it and when; who sent it and when; who cancelled it, when and why.
- **Order line** (`purchase_order_lines`): the ingredient, the quantity in the ingredient's unit, the price of one unit, and the line total.

## Rules

1. **An order is for one branch and one supplier** of the same brand. The branch must be active and the supplier active (`SUPPLIER_NOT_FOUND`). The supplier does not change; to order from another one, cancel and start again.
2. **Lines.** One to 200 lines, each an active ingredient of the brand, once (`INGREDIENT_DUPLICATE`), with a quantity above 0 and a unit price of 0 or more, both with three decimals. A line sent without a price takes the supplier's price for that ingredient; without one the answer is `PRICE_REQUIRED` on that line.
3. **The total** is the sum of the lines, each quantity times price rounded to the fils.
4. **A draft** can be changed as a whole (lines, expected date, note) as often as needed. Anything but a draft answers `ORDER_NOT_DRAFT`.
5. **Sending** fixes the order: from then on it can only be cancelled or received. It changes no stock.
6. **Cancelling** a draft or a sent order needs a reason; a received or cancelled order cannot be cancelled (`ORDER_CLOSED`).
7. **The expected date** is a day (`YYYY-MM-DD`), optional.
8. **Who sees what.** A branch-scoped person sees and writes the orders of their own branches; a brand manager those of every branch.
9. **The audit log** records `inventory.purchase_order.created`, `.updated`, `.sent` and `.cancelled`.

## API

| Method and path                                  | What it does                                                                                             | Needs             |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ----------------- |
| `GET /inventory/purchase-orders?branchId&status` | The orders of a branch, newest first (cursor page)                                                       | `inventory:read`  |
| `GET /inventory/purchase-orders/:id`             | One order with its lines, the supplier's contact details and the branch                                  | `inventory:read`  |
| `POST /inventory/purchase-orders`                | `{ branchId, supplierId, expectedOn?, note?, lines: [{ ingredientId, quantity, unitPrice? }] }`. A draft | `inventory:write` |
| `PUT /inventory/purchase-orders/:id`             | `{ expectedOn?, note?, lines }`. Replaces a draft                                                        | `inventory:write` |
| `POST /inventory/purchase-orders/:id/send`       | Sends a draft                                                                                            | `inventory:write` |
| `POST /inventory/purchase-orders/:id/cancel`     | `{ reason }`                                                                                             | `inventory:write` |

## Screens

- **Inventory**, a new **Purchase orders** tab: the orders of the chosen branch with their number, supplier, status, total and expected date, and **New order**.
- **An order** opens on its own page. A new order first asks for the supplier. A draft shows the lines (ingredient, quantity, unit price filled in from the supplier, line total), the expected date and the note, with **Save draft**, **Send** and **Cancel order**. A sent order is read only, with **Print**, which prints the order as a page to give or send to the supplier, and **Cancel order**.

## Acceptance criteria

1. **Given** Gulf Dairy selling mozzarella at 2.800, **when** the Mall's purchaser orders 10 kg without a price, **then** the draft has the line at 2.800 and a total of 28.000.
2. **Given** a draft, **when** it is changed to 12 kg and an expected date, **then** the total is 33.600; **when** it is sent, **then** changing it answers `ORDER_NOT_DRAFT`.
3. **Given** an ingredient the supplier has no price for and no price on the line, **then** the answer is `PRICE_REQUIRED` on that line.
4. **Given** a sent order, **when** it is cancelled with a reason, **then** it is `cancelled` with who and why, and cancelling it again answers `ORDER_CLOSED`.
5. **Given** an inactive supplier, **then** a new order to it answers `SUPPLIER_NOT_FOUND`.
6. **Given** the Mall's purchaser, **then** they see and write the Mall's orders, not Downtown's; Burger Hub's manager sees none of Pizza Palace's.

## Not in this version

- Sending the order to the supplier by email or WhatsApp from the system (it is printed or shared by hand).
- Approval of large orders by a manager before they are sent.
- Suggested orders from the low stock and the sales.

## Open questions

1. Should an order above some amount need a brand manager's approval before it is sent?
2. Should the system send the order to the supplier's email itself?
