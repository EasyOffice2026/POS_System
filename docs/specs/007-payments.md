# Spec 007: Payments

**Status:** Built, API and web. This is the third epic of Phase 2. It closes an order of [spec 005](005-orders.md) on the terminal of [spec 006](006-pos-terminal.md). Two decisions are still open and shape this version: no card provider is chosen, so a card payment is recorded by hand; and the VAT and ZATCA rules are not decided, so no tax is worked out yet.

## Goal

The cashier takes the money for an order in cash, by card, or both, sees the change to give back, and the order is closed. The terminal shows a receipt that can be printed on any printer the browser knows.

## Who can do what

| Action                 | Who                                                      |
| ---------------------- | -------------------------------------------------------- |
| Take the payment       | People with `orders:write` at the branch (as spec 005)   |
| See payments of orders | People with `orders:read` (they come with the order)     |
| Refund a paid order    | Nobody yet (the refunds epic, with a manager's approval) |

## What is stored

- **Payment** (`payments`): one row per way the order was paid. Its id is made on the terminal. It has the order, the brand and the branch (from the order); the method (`cash` or `card`); the amount it pays of the order; for cash, what the customer handed over and the change; for a card, the slip number if the cashier typed one; who took it, and when.
- **Order**: a new status `paid`, with when it was paid and who took the payment.

## Rules

1. **One payment closes the order.** The cashier sends the whole payment at once: one or more parts ("tenders") that together pay the total exactly. An order is never half paid. This keeps the books simple until shifts and refunds exist.
2. **Cash** may be more than its part: the customer hands over 100.000 for 72.000 and gets 28.000 back. At most one part is cash, so the change is never in doubt. What was handed over must be at least the part it pays.
3. **Card** pays exactly its part, never more. The slip number is optional (up to 40 characters). There is no link to a card machine until a provider is chosen.
4. **What can be paid.** An open order with at least one line that is not voided. An order whose total is 0 (a 100% discount) is paid with no parts.
5. **Lines not sent yet are sent** when the order is paid, at the same moment, so the kitchen gets everything that was sold.
6. **After payment** nothing about the order can change: no lines, no discount, no void (`ORDER_NOT_OPEN`). Taking money back is the refunds epic.
7. **A payment sent twice** (a lost answer, a double tap) is recognised by the ids of its parts: the paid order comes back and nothing is taken twice. Ids already used by another order answer `PAYMENT_ID_TAKEN`.
8. **Amounts** are text with 3 decimals, like every price. The parts must add up to the total to the last decimal, otherwise `PAYMENT_TOTAL_MISMATCH`, so a total that changed on another terminal is never paid at the old amount.
9. **The receipt** shows the branch, the order number and date, the lines with their prices, the discount, the total, how it was paid and the change. It is printed with the browser's print dialog. It shows no tax until the VAT decision is made, and says nothing it cannot back up.

## Problems the API names

| Code                      | When                                                             |
| ------------------------- | ---------------------------------------------------------------- |
| `PAYMENT_TOTAL_MISMATCH`  | The parts do not add up to the total of the order as it is now   |
| `PAYMENT_TENDERED_SHORT`  | Cash handed over is less than the part it pays                   |
| `PAYMENT_TOO_MANY_CASH`   | More than one cash part                                          |
| `PAYMENT_AMOUNT_INVALID`  | A part of 0 or below, or not a price                             |
| `PAYMENT_TENDERS_INVALID` | No part for an order that costs something, or more than 10 parts |
| `ORDER_EMPTY`             | Every line is voided, or there is none                           |
| `PAYMENT_ID_TAKEN`        | A part's id belongs to another order (409)                       |

## API

| Method and path        | What it does                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `POST /orders/:id/pay` | `{ tenders: [{ id, method, amount, tendered?, reference? }] }`. Answers the paid order |

The order in every answer now has `payments` (each with its method, amount, what was handed over, change and slip number), `change` (the total change given), `paidAt` and `paidById`. `GET /orders?status=paid` lists paid orders.

## Screens

- **Pay** on the order screen (when the order has lines and nothing stops it) opens the payment dialog: the amount due; **Cash** with a number pad and buttons for the exact amount and common notes (10, 50, 100, 200, 500), showing the change; **Card** with an optional slip number; **Split** to pay part by card and the rest in cash.
- After payment the **receipt** opens, with **Print** and **New order**.

## Acceptance criteria

1. **Given** an order of 72.000, **when** it is paid with 100.000 in cash, **then** the order is paid, the change is 28.000, and the receipt shows both.
2. **Given** an order of 72.000, **when** 50.000 is paid by card and 22.000 in cash, **then** the order is paid with two payments.
3. **Given** a paid order, **when** a line is added or the order is voided, **then** the answer is `409 ORDER_NOT_OPEN`.
4. **Given** a payment of 70.000 for an order of 72.000, **then** the answer is `PAYMENT_TOTAL_MISMATCH` and nothing is stored.
5. **Given** a payment sent twice with the same ids, **then** the second answer is the paid order and there are still two payments, not four.
6. **Given** an order with lines not sent, **when** it is paid, **then** those lines are sent.

## Not in this version

- Tax (VAT 15%) on lines and receipts, and ZATCA e-invoices with their QR code: they wait for the tax decision.
- A link to a card machine: waits for the card provider.
- Refunds, and voiding a paid order.
- Shifts, opening and closing the cash drawer, and counting cash: the shifts epic.
- Printing on the receipt printer of the branch through the print bridge: the receipt goes through the browser for now.
- Wallets (Apple Pay, STC Pay), gift cards and loyalty points.
- Rounding cash to the nearest coin.

## Open questions

1. Which card provider (Geidea, Network, HyperPay, …)? It decides how the terminal talks to the card machine.
2. Are menu prices with VAT included (the usual way in Saudi Arabia) or without? This decides how the receipt and the ZATCA invoice show tax.
3. Should a cashier be able to pay part of an order now and the rest later (for example a table that pays in turns)?
