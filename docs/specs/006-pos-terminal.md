# Spec 006: POS terminal screen

**Status:** Built, web only. This is the second epic of Phase 2. It is the screen a cashier uses all day, built on the orders API of [spec 005](005-orders.md). Payments, receipts, the kitchen screen, tables and offline mode are later epics; the screen leaves room for them.

## Goal

A cashier walks up to the terminal of their branch, signs in with their staff code and PIN, takes an order by tapping dishes, and sends it to the kitchen. A manager approves a void or a discount on the same terminal with their own staff code and PIN, without signing the cashier out.

## Who can do what

| Action                                          | Who                                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Set up a terminal for a branch                  | Anybody who can see branches (`branches:read`) signed in with email and password: a manager, the admin |
| Sign in at a terminal with a staff code and PIN | People of that branch with a PIN (cashiers, kitchen, branch managers)                                  |
| Use the order screen                            | People with `orders:write` who belong to the terminal's branch (or its brand, or the group)            |
| Void a sent line, void an order, give discounts | As spec 005: the right itself, or a manager's staff code and PIN typed on the terminal                 |

## Rules

1. **A terminal belongs to one branch.** A manager opens `/pos/setup` once, signed in with email and password, and picks the branch. The terminal keeps the branch (its id and names, and the brand's names) in the browser's storage, so the PIN screen can show and send it before anybody is signed in. Nothing secret is kept there. The manager is signed out when the setup is saved.
2. **The PIN screen.** `/pos` shows the branch name, a staff code field, a PIN field and a number pad. The pad types into the field that has the focus. The answers of a PIN sign-in are shown in words: wrong code or PIN, locked (with the minutes), too many tries, branch switched off, no connection.
3. **Who may use the screen.** A person without `orders:write` (kitchen staff, for example) sees a message and a sign-out button. So does a person who does not belong to the terminal's branch.
4. **The menu** is the menu of the branch (spec 004) with its categories as tabs and a search over the names in both languages. A dish with times is shown greyed out outside its times and cannot be added. Combos have their own tab.
5. **Adding a dish.** A dish without modifier groups is added at once. A dish with groups, and every combo, opens a dialog that shows the groups with their fewest and most choices and the price as it changes; "Add" works only when every group is complete.
6. **The order is created with its first dish.** Before that the screen shows an empty order with the type (dine-in or takeaway) the cashier chose. The terminal makes the ids of the order and its lines (spec 005, rule 12), so a request sent twice adds nothing twice.
7. **Lines.** A line that was not sent can be made more or less (down to removing it). A sent line shows "Sent" and can only be voided. A voided line stays on the screen, crossed out.
8. **Send to kitchen** sends every line that was not sent. It is offered only when there is one.
9. **Approval.** When the API answers `APPROVAL_REQUIRED`, the screen asks for a manager's staff code and PIN and sends the same request again with them. A wrong PIN, a locked manager or a manager without the right is said in words, and the dialog stays open.
10. **Void.** Voiding a line or the whole order asks for a reason: a choice of common reasons, or "Other" with a text.
11. **Discount** on the order: a percentage (with buttons for 5, 10, 15, 20, 25 and 50) or an amount, and a reason. The dialog shows what the discount comes to before it is given. An order with a discount can have it removed in the same dialog.
12. **Open orders.** The orders still open at the branch, newest first, can be listed and picked up again. "New order" starts an empty order; the one before stays open (until payments, an order cannot be closed).
13. **Problems from the API** are shown in words in the order panel: a dish switched off since the menu was loaded, an order voided on another terminal, no connection. When the menu changed, the screen loads it again.
14. **Language.** Every text is in English and Arabic. In Arabic the screen is mirrored; prices are written left to right.
15. **Size.** The screen is built for a tablet or a touch screen in landscape. On a narrow screen (a phone) the order panel goes under the menu, with no sideways scrolling.

## Screens

| Path         | What it shows                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------------- |
| `/pos/setup` | Pick the brand and branch of this terminal (needs a password sign-in and `branches:read`)       |
| `/pos`       | Not set up: how to set it up. Not signed in: the PIN screen. Signed in: the order screen        |
| `/admin`     | A "POS terminal" link in the menu for people with `orders:write`, which opens `/pos` in the tab |

## Acceptance criteria

1. **Given** a terminal that is not set up, **when** `/pos` is opened, **then** it says so and links to the setup.
2. **Given** a terminal set up for Pizza Mall, **when** a cashier types staff code 1001 and PIN 1234, **then** the order screen opens with the menu of Pizza Mall.
3. **Given** a wrong PIN, **when** it is sent, **then** the screen says that the staff code or PIN is not correct, and the PIN field is emptied.
4. **Given** an empty order, **when** the cashier taps Cola, **then** an order is created and the line Cola 5.000 appears with the total 5.000.
5. **Given** a dish with a required size, **when** it is tapped, **then** a dialog asks for the size and "Add" works only after one is chosen.
6. **Given** a sent line, **when** the cashier voids it, **then** the screen asks for a reason, then for a manager's code and PIN, and the line is crossed out.
7. **Given** a 10% discount chosen on an order of 50.000, **then** the dialog shows 5.000 before it is given.
8. **Given** a kitchen account, **when** it signs in at the terminal, **then** it is told it cannot take orders.

## Demo data

The Mall branch manager now has staff code `1003` and PIN `5824`, so approvals can be tried on the terminal with the demo cashier (`1001`, PIN `1234`).

## Not in this version

- Payments, change, receipts and printing (the Payments epic).
- Tables and the floor plan, delivery orders, customer names and loyalty.
- Locking the screen after a time without use, and switching cashiers without signing out.
- Working without a connection (the offline epic). Every tap waits for the server.
- Notes on a line or an order (the API takes them; the screen will get a field later).

## Open questions

1. Should the screen lock itself after some minutes without use? After how long?
2. Which void reasons should the list offer? The list here is a first guess: customer changed mind, wrong item, too long to wait, quality problem, other.
3. Should the discount buttons be the same at every brand, or set per brand?
