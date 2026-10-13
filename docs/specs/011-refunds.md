# Spec 011: Refunds

**Status:** Built, API and web. This is the seventh epic of Phase 2. It gives money back for an order paid under [spec 007](007-payments.md), with a manager's approval as in [spec 005](005-orders.md), and counts it in the cashier's shift of [spec 010](010-shifts.md).

## Goal

A customer brings food back, or was charged too much. The cashier refunds the whole order or part of it, in cash or by the way it was paid, with a manager's staff code and PIN. The refund is on the shift report and reduces the cash expected in the drawer.

## Who can do what

| Action                      | Who                                                                                                |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| Refund a paid order         | People with `orders:refund` (the managers), or a cashier with a manager's staff code and PIN typed |
| See the refunds of an order | Everybody who sees the order (`orders:read`)                                                       |

The permission `orders:refund` goes to the group admin, the brand manager and the branch manager. A cashier asks for a manager's approval on the terminal, as for a void (spec 005, rule 8).

## What is stored

- **Refund** (`refunds`): its id (made on the terminal), the order, the brand and the branch; the amount; the way it was given back (`cash` or a method key, with the name of the time); the reason; who gave it, who approved it, and the shift it was given in; when.
- **Order**: the amount refunded so far.

## Rules

1. **Only a paid order** can be refunded (`ORDER_NOT_PAID`). A voided or open order cannot.
2. **An amount above 0**, with 3 decimals, and at most what is left: the total minus what was refunded already (`REFUND_TOO_MUCH`). Several refunds may follow one another until the order is refunded in full. An order refunded in full stays `paid`; its `refunded` amount says so.
3. **The way back** is `cash`, or one of the ways the order was paid with. A method the order was not paid with is refused (`REFUND_METHOD_INVALID`): money goes back the way it came, or in cash.
4. **A reason** is required (up to 200 characters), as for a void.
5. **Approval** follows spec 005, rule 8, with the permission `orders:refund`: a person without it needs a manager of the branch to type their staff code and PIN; a wrong PIN counts against the manager's lockout.
6. **The shift.** A refund needs the open shift of the person giving it, at the order's branch (`SHIFT_REQUIRED`), and is counted there: the report shows the refunds in all and by way of payment, and a cash refund reduces the cash expected (spec 010, rule 4).
7. **A refund sent twice** with the same id answers the order as it is, so a lost answer never refunds twice. An id used on another order answers `REFUND_ID_TAKEN`.
8. **The audit log** records every refund (`order.refunded`) with the amount, the way, the reason, who gave it and who approved it.

## API

| Method and path            | What it does                                                                    |
| -------------------------- | ------------------------------------------------------------------------------- |
| `POST /orders/:id/refunds` | `{ id, amount, method, reason, approval? }`. Answers the order with its refunds |

The order in every answer now has `refunds` and `refunded` (the amount refunded in all). `GET /orders?status=paid` lists the paid orders of a branch for the terminal, newest first, with `refunded`.

## Screens

- **POS**: the Open orders dialog gets a second tab, **Paid**, with the orders paid at the branch today. Opening one shows it with its payments and refunds and a **Refund** button. The refund dialog asks for the amount (the rest of the order is offered), the way back (cash, or the ways it was paid with), and the reason; then a manager's staff code and PIN when needed.
- **Shift report**: a **Refunds** part, by way of payment; the cash expected takes cash refunds off.

## Acceptance criteria

1. **Given** an order of 7.500 paid in cash, **when** the branch manager refunds 7.500 in cash with a reason, **then** the order shows `refunded: 7.500`, and the shift's cash expected is 7.500 less.
2. **Given** an order of 7.500, **when** 8.000 is refunded, **then** the answer is `REFUND_TOO_MUCH`.
3. **Given** an order paid by KNET, **when** a refund by Link is asked, **then** the answer is `REFUND_METHOD_INVALID`; by KNET or in cash it works.
4. **Given** a cashier, **when** they refund without a manager, **then** `APPROVAL_REQUIRED`; with the manager's PIN it works and the audit log names the manager.
5. **Given** a refund sent twice with the same id, **then** the second answer is the same order and nothing is refunded twice.
6. **Given** two refunds on a shift, 2.000 in cash and 3.000 by KNET, **then** the shift report shows refunds 5.000, cash 2.000 and KNET 3.000, and the cash expected is 2.000 less.

## Not in this version

- Refunding single dishes by line, and putting the stock back (the inventory phase).
- A refund without the order (a goodwill payment).
- Sending the refund to the KNET machine; it is given back on the machine by hand, as payments are taken.

## Open questions

1. Should a refund after a set number of days need the brand manager rather than the branch manager?
2. Should the receipt of a refund be printed for the customer?
