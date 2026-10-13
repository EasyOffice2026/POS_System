# Spec 010: Shifts and the cash drawer

**Status:** Built, API and web. This is the sixth epic of Phase 2. It gives every payment of [spec 007](007-payments.md) a shift, so the cash in the drawer can be counted against what was sold.

## Goal

A cashier starts work by opening a shift with the cash that is in the drawer. Every payment they take is counted in that shift. At the end they count the drawer and close the shift; the system shows what the drawer should hold and the difference. A manager sees the shifts of a branch and an end-of-shift report: sales by way of payment, discounts and voids.

## Who can do what

| Action                                     | Who                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| Open and close their own shift             | Everybody who takes payments (`orders:write`) at the branch               |
| See their own open shift and its report    | The same person                                                           |
| See every shift of a branch and its report | The group admin, the brand manager and the branch manager (`shifts:read`) |

## What is stored

- **Shift** (`shifts`): the branch and the brand; who opened it and when, with the opening cash; `open` or `closed`; who closed it and when, with the cash counted, the cash expected, the difference and a note. The totals of the report are worked out from the payments when the report is asked for, never stored twice.
- **Payment**: the shift it was taken in.

## Rules

1. **One open shift per person per branch.** Opening a second one is refused (`SHIFT_ALREADY_OPEN`). Two people at the same branch each have their own shift and their own drawer.
2. **A payment needs an open shift** of the person taking it, at the order's branch; otherwise `409 SHIFT_REQUIRED`. The POS asks for the opening cash before the order screen, so the cashier never meets this answer.
3. **The opening cash** is what is in the drawer when the shift opens: 0 or more, with 3 decimals.
4. **The expected cash** at closing is the opening cash plus the cash of the shift's payments (what was handed over minus the change given). Other ways to pay do not touch the drawer.
5. **Closing** takes the cash counted and an optional note (up to 200 characters). The difference is counted minus expected: below zero when cash is missing. A shift that is closed cannot be opened again or closed twice (`SHIFT_NOT_OPEN`). Closing is recorded in the audit log with the difference (`shift.closed`), opening with the opening cash (`shift.opened`).
6. **A person who signs out** keeps their open shift; it is there when they sign in again, on any terminal of the branch. A shift is never closed by the system on its own, so a manager sees a shift that was forgotten and can close it (rule 7).
7. **A manager may close another person's shift** (`shifts:read` and `orders:write`), for example when the cashier went home. The audit log names both.
8. **The report** of a shift has: when it opened and closed and by whom; the number of orders paid; the sales (the totals of the orders paid in the shift), the discounts given on them; the amounts by way of payment; the cash expected, counted and the difference; the orders and the lines voided by the person during the shift, with their value. Orders paid partly by two ways count once in the number of orders and in each way's amount.
9. **Listing** gives the shifts of a branch newest first, open ones first, with the same figures as the report but without the voids, so a manager sees the differences at a glance.

## API

| Method and path                      | What it does                                                                  | Needs                                        |
| ------------------------------------ | ----------------------------------------------------------------------------- | -------------------------------------------- |
| `POST /shifts`                       | `{ branchId, openingCash }`. Opens a shift for the person. 201 with the shift | `orders:write`                               |
| `GET /shifts/current?branchId`       | The person's open shift at the branch, or `null`                              | `orders:write`                               |
| `GET /shifts?branchId&status&cursor` | The shifts of the branch (rule 9)                                             | `shifts:read`                                |
| `GET /shifts/:id`                    | The shift with its report (rule 8)                                            | `shifts:read`, or the person's own           |
| `POST /shifts/:id/close`             | `{ countedCash, note? }`. Closes it and answers the report                    | `orders:write`; another's: `shifts:read` too |

## Screens

- **POS**: after the PIN, if the person has no open shift at the branch, a dialog asks for the opening cash. The header shows "Shift since 09:12" and a **Close shift** button. Closing asks for the counted cash and shows the report, with the difference in red when cash is missing. After closing, the opening dialog comes back.
- **Shifts** (`/admin/shifts`): the shifts of a branch, newest first, with opened/closed, by whom, sales, cash expected and counted, difference. A shift opens its report. A manager can close an open shift from there.

## Acceptance criteria

1. **Given** a shift opened with 50.000, **when** an order of 7.500 is paid with 10.000 in cash, **then** the expected cash is 57.500.
2. **Given** that shift, **when** it is closed with 57.000 counted, **then** the difference is −0.500 and the audit log has it.
3. **Given** a person with no open shift, **when** they take a payment, **then** the answer is `409 SHIFT_REQUIRED`.
4. **Given** an open shift, **when** the same person opens another at the same branch, **then** the answer is `409 SHIFT_ALREADY_OPEN`.
5. **Given** two orders paid in a shift, one by KNET 20.000 and one 5.000 by KNET and 2.500 in cash, **then** the report says 2 orders, KNET 25.000, cash 2.500.
6. **Given** a cashier's open shift, **when** the branch manager closes it, **then** it is closed and the audit log names both.
7. **Given** a shift of Pizza Mall, **then** the manager of Burger Hub cannot see it.

## Not in this version

- Cash in and out during a shift (paying a supplier from the drawer, taking cash to the safe).
- Refunds, which will reduce the expected cash (the refunds epic).
- A shift per terminal or per drawer, rather than per person.
- Printing the report; it is on the screen and can be printed with the browser.

## Open questions

1. Should the shop set a limit for the difference above which the manager is told at once?
2. Should a shift close by itself at the end of the business day, with a note that nobody counted it?
