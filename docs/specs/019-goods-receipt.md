# Spec 019: Receiving goods

**Status:** Built, API and web. This is the third epic of Phase 4 (purchasing). It closes a purchase order of [spec 018](018-purchase-orders.md) when the delivery arrives, and puts what arrived into the branch's stock of [spec 012](012-ingredients-and-stock.md).

## Goal

Gulf Dairy's van arrives at the Mall with the mozzarella of order 7. The purchaser opens the order, checks the delivery against it and types what really came: 11.5 kg instead of 12, at the price on the invoice. One button puts it into stock, records the supplier's invoice number, and the order is closed with what was ordered next to what was received, so a short delivery or a changed price is seen at once.

## Who can do what

Receiving needs `inventory:write` at the order's branch (its manager, its purchaser), as for the order itself. A brand manager and the group admin can receive at every branch. No new permission.

## What is stored

On the **purchase order**: who received it and when, the supplier's invoice number, a note about the delivery, and the received total. On each **order line**: the quantity received, the price paid for one unit, and the received line total. Each received line also adds a **stock movement** of kind `received`.

## Rules

1. **Only a sent order** is received (`ORDER_NOT_SENT`), and only once: a delivery is received in one go and the order becomes `received`. What did not come is simply not received; it is ordered again if still needed.
2. **The lines received** are the lines of the order: each names an ingredient of the order, once (`INGREDIENT_DUPLICATE`; another ingredient answers `INGREDIENT_NOT_FOUND`), with a quantity of 0 or more and a price of 0 or more, with three decimals. A line of the order that is left out is received as 0. At least one line must have a quantity above 0 (`RECEIPT_EMPTY`). More than was ordered may be received.
3. **The price** of a line is the price on the order unless another is typed (the invoice may differ).
4. **The stock** of the branch goes up by each quantity above 0, with a `received` movement whose note says `Purchase order N` and which refers to the order, in the same transaction as closing the order. The ingredients' costs do not change (an open question).
5. **The invoice number** is optional, up to 50 characters; the note up to 500.
6. **The audit log** records `inventory.purchase_order.received` with the received total and how many lines differ from the order.

## API

| Method and path                               | What it does                                                                                        | Needs             |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------- |
| `POST /inventory/purchase-orders/:id/receive` | `{ invoiceNumber?, note?, lines: [{ ingredientId, quantity, unitPrice? }] }`. Receives a sent order | `inventory:write` |

The order in every answer now has `receivedByName`, `receivedAt`, `invoiceNumber`, `receiveNote` and `receivedTotal`, and each line `receivedQuantity`, `receivedPrice` and `receivedTotal` (all null until received).

## Screens

- **A sent order** has **Receive goods**: a table of the lines with what was ordered, a box for the quantity received (filled in with the quantity ordered) and one for the price (filled in with the order's), the line total, the invoice number and a note, and **Put into stock**.
- **A received order** shows ordered and received side by side; a quantity or a price that differs is marked, with the received total next to the ordered one.
- **Movements** show the `Received` movements with the order's number.

## Acceptance criteria

1. **Given** order 7 sent for 12 kg of mozzarella at 2.800, **when** 11.5 kg are received at 2.900 with invoice "INV-5521", **then** the Mall's mozzarella goes up by 11.5 with a `received` movement naming the order, the order is `received` with a received total of 33.350, and the line shows 12 ordered and 11.5 received.
2. **Given** an order with two lines, **when** only one is sent in the receipt, **then** the other is received as 0 and adds no movement.
3. **Given** a draft or a received order, **then** receiving it answers `ORDER_NOT_SENT`, and the stock does not change.
4. **Given** a receipt where every quantity is 0, **then** the answer is `RECEIPT_EMPTY`.
5. **Given** the Mall's purchaser, **then** they can receive the Mall's orders and not Downtown's.

## Not in this version

- Receiving one order over several deliveries.
- Returning goods to the supplier, and credit notes.
- Updating the ingredients' costs from the prices paid, and supplier invoices to pay.
- Receiving goods without an order.

## Open questions

1. Should an ingredient's cost follow the price paid at the last delivery, or an average, once received?
2. Should a short delivery leave the rest of the order open for a second delivery?
