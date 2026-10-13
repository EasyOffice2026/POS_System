# Spec 014: Stock transfers

**Status:** Built, API and web. This is the third epic of Phase 3. It moves the stock of [spec 012](012-ingredients-and-stock.md) from one branch of a brand to another, with the movement kinds that spec reserved (`transfer_out`, `transfer_in`).

## Goal

The Mall runs out of mozzarella and Downtown has plenty. Downtown sends some: its stock goes down the moment the goods leave, the Mall's goes up when they arrive, and both branches see the transfer in their history with who sent it and who received it. Nothing is counted twice and nothing is lost in between.

## Who can do what

| Action                                   | Who                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| Send a transfer from a branch            | `inventory:write` at the sending branch (its manager, its purchaser, ...) |
| Receive a transfer at a branch           | `inventory:write` at the receiving branch                                 |
| Cancel a transfer that was not received  | `inventory:write` at the sending branch                                   |
| See the transfers of a branch, in or out | `inventory:read` at that branch                                           |

A brand manager and the group admin can do all of it at every branch of the brand. No new permission.

## What is stored

- **Transfer** (`stock_transfers`): a number, the brand, the sending branch and the receiving branch; the status (`sent`, `received`, `cancelled`); a note; who sent it and when; who received it and when; who cancelled it, when and why.
- **Transfer line** (`stock_transfer_lines`): the ingredient and the quantity, in the ingredient's unit. One line per ingredient. The lines carry both branches too, so each branch sees its own transfers.
- **Stock movements** (spec 012): a `transfer_out` at the sender when it is sent, a `transfer_in` at the receiver when it is received, and a `transfer_in` at the sender when it is cancelled, each referring to the transfer.

## Rules

1. **Between two branches of one brand**, and not the same one (`TRANSFER_SAME_BRANCH`). The receiving branch must be active. Each line names an active ingredient of the brand, once (`INGREDIENT_DUPLICATE`), with a quantity above 0; at least one line, at most 50.
2. **Sending takes the stock off the sender** in the same transaction (`transfer_out`, negative). The sender needs that much in stock (`STOCK_NEGATIVE`, on the line); a transfer cannot send what is not there, as waste cannot.
3. **Receiving adds the stock at the receiver** (`transfer_in`), as sent: this version has no short deliveries; a difference is recorded afterwards as a correction at the receiver. Only a `sent` transfer can be received (`TRANSFER_NOT_SENT`).
4. **Cancelling puts the stock back at the sender** (`transfer_in` with the reason as note). Only a `sent` transfer can be cancelled (`TRANSFER_NOT_SENT`); a received one cannot, the receiver sends it back instead. A reason is required.
5. **Each movement refers to the transfer** (`referenceId`) and its note says `Transfer N` so the history reads well.
6. **Who sees what.** A transfer is visible at both of its branches. A branch-scoped person sees the transfers where one of their branches sends or receives; they send only from their own branches and receive only at their own. The receiving branch is chosen from the other active branches of the brand, which `GET /inventory/transfers/destinations` lists even for a person who sees only their own branch.
7. **The audit log** records `stock_transfer.sent`, `stock_transfer.received` and `stock_transfer.cancelled`.

## API

| Method and path                                  | What it does                                                                      | Needs                                     |
| ------------------------------------------------ | --------------------------------------------------------------------------------- | ----------------------------------------- |
| `GET /inventory/transfers?branchId&status`       | The transfers in and out of a branch, newest first (cursor page)                  | `inventory:read` at the branch            |
| `GET /inventory/transfers/destinations?branchId` | The other active branches of the branch's brand: `{ id, name }`                   | `inventory:write` at the branch           |
| `GET /inventory/transfers/:id`                   | One transfer with its lines                                                       | `inventory:read` at one of its branches   |
| `POST /inventory/transfers`                      | `{ fromBranchId, toBranchId, note?, lines: [{ ingredientId, quantity }] }`. Sends | `inventory:write` at the sending branch   |
| `POST /inventory/transfers/:id/receive`          | Receives it at the receiving branch                                               | `inventory:write` at the receiving branch |
| `POST /inventory/transfers/:id/cancel`           | `{ reason }`. Puts the stock back at the sender                                   | `inventory:write` at the sending branch   |

A transfer in every answer: `id, number, brandId, fromBranch { id, name }, toBranch { id, name }, status, note, lines [{ ingredient, quantity }], sentById, sentByName, sentAt, receivedById, receivedByName, receivedAt, cancelledById, cancelledByName, cancelledAt, cancelReason`.

## Screens

- **Inventory**, a new **Transfers** tab: the transfers of the chosen branch, newest first, each with its number, the other branch and the direction, its status, who sent it and when. **New transfer** opens a dialog: the receiving branch, lines (ingredient and quantity, with the stock the sender has), a note. A transfer opens in a dialog with its lines and, when the person may, **Receive** or **Cancel** (with a reason).
- **Movements**: the `transfer_out` and `transfer_in` movements name the transfer.

## Acceptance criteria

1. **Given** Downtown with 5 kg of mozzarella, **when** its manager sends 2 kg to the Mall, **then** Downtown has 3 kg with a `transfer_out` movement naming the transfer, the Mall's stock is unchanged, and the transfer is `sent`.
2. **Given** that transfer, **when** the Mall's manager receives it, **then** the Mall's mozzarella goes up by 2 kg with a `transfer_in` movement, and the transfer is `received` with who and when.
3. **Given** a sent transfer, **when** the sender cancels it with a reason, **then** the 2 kg are back at Downtown and the transfer is `cancelled`; receiving it afterwards answers `TRANSFER_NOT_SENT`.
4. **Given** Downtown with 1 kg, **when** 2 kg are sent, **then** the answer is `STOCK_NEGATIVE` on that line and nothing is written.
5. **Given** the Mall's manager, **then** they see the transfer in their list, can receive it, cannot cancel it, and cannot send from Downtown.
6. **Given** Burger Hub's manager, **then** they never see Pizza Palace's transfers, and cannot send to a Burger Hub branch from a Pizza Palace one.

## Not in this version

- Receiving less than was sent (short deliveries) and the difference as loss.
- A transfer request made by the receiving branch (asking for stock), and approvals.
- Printing a delivery note.

## Open questions

1. Should the stock in transit be shown somewhere, so a brand manager sees what is on the road?
2. Should a transfer be received automatically after some time, for shops that never confirm?
