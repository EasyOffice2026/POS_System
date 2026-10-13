# Spec 008: Kitchen display (KDS)

**Status:** Built, API and web. This is the fourth epic of Phase 2. What the cashier sends from the POS terminal ([spec 006](006-pos-terminal.md)) appears on a screen in the kitchen of the same branch, and the cook moves it from new to ready.

## Goal

The kitchen sees every order to prepare, in the order it was sent, with what is in it and how long it has waited. The cook taps a ticket when they start it and when it is ready. The cashier sees on the POS which dishes are ready.

## Who can do what

| Action                           | Group Admin | Brand Manager | Branch Manager | Cashier | Kitchen |
| -------------------------------- | :---------: | :-----------: | :------------: | :-----: | :-----: |
| See the kitchen tickets          |      x      |       x       |       x        |    x    |    x    |
| Start, finish and recall tickets |      x      |       x       |       x        |         |    x    |

Seeing tickets needs `orders:read`, which every branch role has. Working them needs the new permission `kitchen:write`, given to the kitchen role and the managers.

## What is stored

- **Kitchen ticket** (`kitchen_tickets`): what one "send" put in front of the kitchen. It has the order, the brand and the branch; a status (`new`, `preparing`, `ready`, `done`); and when it was sent, started, ready and done.
- **Order line**: the ticket it went to the kitchen on, once it was sent.

## Rules

1. **A ticket per send.** Every "Send to kitchen" makes one ticket with the lines it sent. Paying an order with lines not sent yet (spec 007, rule 5) makes a ticket for them too. An order sent three times has three tickets, so the kitchen sees what was added later as new work.
2. **The way a ticket goes:** `new` → `preparing` → `ready` → `done`. A cook can skip `preparing` (a drink is ready at once). A ticket that was finished by mistake can be **recalled** from `done` back to `ready`. Any other move is refused (`TICKET_STATUS_INVALID`).
3. **Two screens at once.** Each move says which status the ticket had on the screen. If someone else moved it first, the answer is `409 TICKET_CHANGED` and the screen loads the tickets again.
4. **What the kitchen sees:** the tickets of its branch that are `new`, `preparing` or `ready`, oldest first, and the last 10 that were `done`, to recall one. A ticket shows the order number, dine-in or takeaway, the minutes since it was sent, and its dishes with their quantity, modifiers, combo choices and notes.
5. **A void reaches the kitchen.** A line voided after it was sent stays on its ticket, crossed out with "VOID", so the cook stops making it. A ticket whose lines are all voided can be finished like any other.
6. **Waiting time.** A ticket turns amber after 10 minutes and red after 20, counted from when it was sent. The limits are fixed in this version.
7. **The screen keeps itself up to date** by asking the API every 5 seconds. A ticket nobody has started has a blue edge. The POS asks again for an open order every 10 seconds.
8. **The POS shows the kitchen's progress.** Each sent line shows "Preparing" or "Ready" from its ticket.
9. **A kitchen screen is a terminal** of its branch, set up like the POS (spec 006, rule 1), at `/kds`. Kitchen staff sign in there with their staff code and PIN.

## API

| Method and path                 | What it does                                                                  | Needs           |
| ------------------------------- | ----------------------------------------------------------------------------- | --------------- |
| `GET /kitchen/tickets?branchId` | The tickets of a branch as rule 4 says, with their order and lines            | `orders:read`   |
| `PATCH /kitchen/tickets/:id`    | `{ from, to }`: moves a ticket from the status the screen saw to the next one | `kitchen:write` |

Every order line in the orders API now has `kitchenStatus`: the status of its ticket, or null before it is sent.

## Screens

- `/kds`: the PIN screen of the terminal, then the tickets as cards in rows, oldest first. Each card has one big button for the next step (**Start**, **Ready**, **Done**). A row at the bottom holds the tickets that were done, with **Recall**.
- The POS order panel shows "Preparing" or "Ready" next to the sent lines.

## Acceptance criteria

1. **Given** an order with two dishes, **when** the cashier sends it, **then** the kitchen sees one new ticket with both dishes.
2. **Given** a ticket, **when** the cook taps Start and then Ready, **then** the POS shows the dishes as ready.
3. **Given** two kitchen screens, **when** both tap Start on the same ticket, **then** one works and the other is told the ticket changed.
4. **Given** a sent dish that is voided, **then** it shows as VOID on its ticket.
5. **Given** a ticket that is done, **when** the cook taps Recall, **then** it is back among the ready tickets.
6. **Given** a cashier signed in at `/kds`, **then** they can see the tickets but have no buttons to move them.
7. **Given** a ticket of Pizza Mall, **then** the kitchen of Pizza Downtown never sees it.

## Not in this version

- Kitchen stations (a pizza screen, a drinks screen) and routing dishes to them.
- Printing kitchen tickets on the kitchen printer (the printing epic).
- Live updates pushed by the server; the screen asks every 5 seconds.
- Waiting-time limits set per branch, sounds, and average preparing times in reports.
- Moving single dishes instead of whole tickets.

## Open questions

1. Does each brand need kitchen stations (for example pizza and drinks on two screens) from the start?
2. Are 10 and 20 minutes the right warning times?
3. Should a ticket that is ready be marked done by the kitchen, or by the cashier when the order is handed over?
