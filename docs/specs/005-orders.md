# Spec 005: Orders

**Status:** Built, API only. This is the first epic of Phase 2 (POS and kitchen). The POS terminal screen (the next epic) is where a cashier uses it. Payments, tax, the kitchen screen, tables and offline mode are later epics; this spec says where they will plug in.

## Goal

A cashier opens an order for a guest at the branch, adds dishes and combos from the menu of that branch, sends them to the kitchen, and can give a discount or cancel something with a manager's approval. The price of every line is copied onto the order when it is added, so a later change to the menu never changes an order.

## Who can do what

| Action                                           | Group Admin | Brand Manager | Branch Manager | Cashier | Kitchen |
| ------------------------------------------------ | :---------: | :-----------: | :------------: | :-----: | :-----: |
| See orders (`orders:read`)                       |      x      |       x       |       x        |    x    |    x    |
| Open orders, add and send lines (`orders:write`) |      x      |       x       |       x        |    x    |         |
| Void an order or a line (`orders:void`)          |      x      |       x       |       x        |         |         |
| Give a discount (`orders:discount`)              |      x      |       x       |       x        |         |         |

A person sees and changes only the orders of their own brand, and a branch person only those of their own branches, through the same scoped database client as everything else. A cashier who needs a void or a discount asks a manager, who approves it on the same terminal with their staff code and PIN (rule 8).

## What is stored

| Thing         | Main fields                                                                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Order         | Branch, business date, number, type (dine-in or takeaway), status, note, subtotal, discount, total, who opened it, void details                                                 |
| Order line    | A dish or a combo, its names in both languages, unit price, quantity, line total, the chosen modifiers and combo choices with their prices, note, status, sent and void details |
| Order counter | The last order number given out per branch and business date                                                                                                                    |

## Rules

1. **Types.** An order is `dine_in` or `takeaway`. Delivery comes with the delivery integrations (Phase 4).
2. **Numbers.** Each branch numbers its orders from 1 every business day: `#1`, `#2`, and so on. The business date is the date on the branch's clock (its time zone) when the order is opened. Two orders opened at the same moment never get the same number.
3. **Lifecycle.** An order is `open` until it is paid (payments, a later epic, adds `completed`) or `voided`. A line is `pending` until it is sent to the kitchen, then `sent`, and it can be `voided`. Only an open order changes.
4. **Adding a line.** A line is a dish or a combo that the branch sells right now: it must be in the menu of that branch (spec 004, rule 8) and, if it has times, the branch must be inside them on its own clock. Every modifier group's fewest and most choices are checked. A combo needs exactly one choice for each of its slots, from the items allowed there, and each choice follows the modifier rules of its dish. Quantity is a whole number from 1 to 99. An order holds at most 200 lines.
5. **Prices are copied.** The unit price of a dish line is the branch price of the dish plus the price changes of its modifiers. The unit price of a combo line is the combo price plus the extra charge of each choice and of its modifiers. A unit price below zero counts as zero. The names in both languages and every price are stored on the line, so receipts and reports keep them after the menu changes.
6. **Changing lines.** A pending line can have its quantity or note changed, or be removed. A sent line cannot: it was made in the kitchen, so it can only be voided (rule 7). Sending sends all pending lines at once.
7. **Voids.** A whole open order, or a sent line, can be voided with a reason (1 to 200 characters). A void needs `orders:void`, or a manager's approval (rule 8), except voiding an order of which nothing was sent yet: that is a cashier cancelling their own unsent order. Nothing is deleted: a voided order or line keeps its lines, prices and who voided it.
8. **Approval.** A manager approves by typing their staff code and PIN on the terminal. The approver must be active, have the needed permission, and work at the order's branch, which is the same check as a PIN sign-in there. A wrong PIN counts against the approver like a failed sign-in, and five in a row lock them out (spec 001). The approver is stored on the order or line and in the audit log.
9. **Discounts.** An order has at most one discount: a percentage (more than 0, up to 100, two decimals) or an amount, with a reason. It needs `orders:discount` or a manager's approval. It is worked out again whenever the lines change: a percentage of the new subtotal, an amount never more than the subtotal. Removing the discount needs the same right.
10. **Totals.** The subtotal is the sum of the line totals that are not voided. The total is the subtotal less the discount. All money is text with 3 decimals, as in the menu, and the sums are done in whole thousandths, so no rounding error can creep in. A percentage discount is rounded to the nearest thousandth. Tax is not added yet: it waits for the tax decision.
11. **Two terminals, one order.** Every change to an order first takes a lock on that order's row, so changes from two terminals happen one after the other and the totals always match the lines.
12. **Ids made on the device.** An order or a line may come with an id the terminal made (a UUID). Sending the same order or line again gives back what is already there instead of a copy. This is for offline mode, which sends what it kept when the connection returns.
13. **Inactive branches.** A deactivated branch, or a branch of a deactivated brand, cannot open orders or change them (`403 BRANCH_INACTIVE`).
14. **Audit.** Voids and discounts are written to the audit log: `order.voided`, `order.line_voided`, `order.discount_set`, `order.discount_removed`, with the reason and the approver. Opening orders and adding lines are not: the order itself is the record.
15. Requests refuse fields the API does not know, as everywhere.

## API

All paths start with `/api/v1/orders`.

| Method | Path                               | Permission              | Description                                   |
| ------ | ---------------------------------- | ----------------------- | --------------------------------------------- |
| GET    | `?branchId=&status=&businessDate=` | `orders:read`           | Orders, newest first, a page at a time        |
| POST   | `/`                                | `orders:write`          | Open an order at a branch                     |
| GET    | `/:id`                             | `orders:read`           | One order with its lines                      |
| PATCH  | `/:id`                             | `orders:write`          | Change the type or the note of an open order  |
| POST   | `/:id/lines`                       | `orders:write`          | Add a dish or a combo                         |
| PATCH  | `/:id/lines/:lineId`               | `orders:write`          | Change the quantity or note of a pending line |
| DELETE | `/:id/lines/:lineId`               | `orders:write`          | Remove a pending line                         |
| POST   | `/:id/send`                        | `orders:write`          | Send the pending lines to the kitchen         |
| POST   | `/:id/lines/:lineId/void`          | `orders:write` + rule 7 | Void a sent line                              |
| POST   | `/:id/void`                        | `orders:write` + rule 7 | Void the order                                |
| PUT    | `/:id/discount`                    | `orders:write` + rule 9 | Set the discount                              |
| DELETE | `/:id/discount`                    | `orders:write` + rule 9 | Remove the discount                           |

Every change answers with the whole order, so a terminal always shows what is stored. A problem is a code, as in the other modules: `ITEM_NOT_AVAILABLE`, `MODIFIER_CHOICE_MISSING`, `APPROVAL_REQUIRED`, `ORDER_NOT_OPEN` (409), `LINE_ALREADY_SENT` (409) and so on.

## Acceptance criteria

1. **Given** a dish priced 20.000 with a branch price of 22.500, **when** it is added to an order at that branch, **then** the line costs 22.500, and it still costs 22.500 after the menu price changes.
2. **Given** a dish with a required size, **when** it is added without a size, **then** the answer is `VALIDATION_ERROR` with `MODIFIER_CHOICE_MISSING`.
3. **Given** two orders opened at the same branch at the same moment, **when** both are saved, **then** they get two different numbers.
4. **Given** a sent line, **when** a cashier voids it without approval, **then** it is refused; with a manager's staff code and PIN it is voided, and the audit log names the manager.
5. **Given** a 10% discount on an order of 50.000, **when** a 30.000 line is added, **then** the discount becomes 8.000 and the total 72.000.
6. **Given** a dish that is switched off at a branch, **when** a cashier there adds it, **then** the answer is `ITEM_NOT_AVAILABLE`.
7. **Given** an order sent twice with the same id, **when** the second one arrives, **then** the first order comes back and no copy is made.

## Not in this version

- Payments, closing an order, change, refunds (the Payments epic).
- Tax on lines and receipts (waits for the tax decision).
- A discount on a single line, and free items ("comps").
- Tables: a dine-in order has no table yet (the Tables epic).
- Kitchen routing: "send" marks lines as sent. The kitchen screen will receive them.

## Open questions

1. Should a cashier be allowed small discounts without a manager, for example up to 10%?
2. Should the business day end at a set hour (for example 4 in the morning) instead of midnight, so late-night orders count for the day before?
3. Does a voided order need a manager even when nothing was sent, at some brands?
