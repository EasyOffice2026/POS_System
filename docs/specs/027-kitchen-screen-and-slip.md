# Spec 027: Kitchen screen on or off, and the kitchen slip

**Status:** Built, API and web. Asked by the client on 21 October 2026. It changes how [spec 008](008-kitchen-display.md) receives orders, per branch.

## Goal

Many restaurants in Kuwait have no kitchen screen: the cashier takes the order, a slip prints, and the slip is handed to the kitchen. Others use the screen, and some want a slip as well. Each branch chooses.

## Who can do what

| Action                                 | Who                                                |
| -------------------------------------- | -------------------------------------------------- |
| Switch the kitchen screen and the slip | `settings:write` and `branches:write`, on Settings |

No new permission.

## Rules

1. **Each branch has two switches:** the kitchen screen (on by default, as before) and the kitchen slip (off by default). With the screen off, the slip always prints.
2. **Screen on:** orders reach the kitchen screen as in spec 008, with its alerts and statuses.
3. **Screen off:** sending marks the dishes sent without a kitchen ticket, so nothing waits on a screen; the kitchen screen of the branch says it is switched off. When the brand takes stock off "when the kitchen starts" (Settings → Kitchen), such a branch takes it off at payment instead, since no ticket is ever started.
4. **The slip prints by itself on the till that sends the order:** after "Send to kitchen", and after a payment that sends dishes that were not sent yet. It lists only the dishes sent at that moment: quantity, name, choices, extras and notes, with the order number, type, table, time and the order's note.
5. **Printing goes through the browser**, like the receipt. A browser asks before each print; started with `--kiosk-printing` (Chrome or Edge), it prints at once on the default printer, which is how a till should run (docs/deployment.md, "Tills"). Printing straight to a network kitchen printer comes with the printer model (docs/client-decisions.md).
6. **Online orders** (Talabat, the website), once they are connected, print their slip when accepted, and with the screen off are marked ready from the till. Until then this rule has nothing to act on.

## API

| Route                 | Change                                                          |
| --------------------- | --------------------------------------------------------------- |
| `PATCH /branches/:id` | `config.kitchen`: `{ screen, slip }`, both true or false        |
| `GET /menu?branchId=` | Answers `kitchen: { screen, slip }` for the till and the screen |

No migration: the switches live in the branch configuration.

## Acceptance criteria

1. A branch with the screen off: the cashier sends an order, a slip with its dishes prints, and the kitchen screen of that branch shows that it is off and lists nothing.
2. The same branch, with stock taken off when the kitchen starts: paying the order takes the stock off.
3. A branch with the screen and the slip on: the order reaches the screen and a slip prints.
4. A branch with only the screen on: nothing prints when sending, as before.
