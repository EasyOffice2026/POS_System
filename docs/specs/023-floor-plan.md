# Spec 023: Floor plan and tables

**Status:** Built, API and web. This is the fourth epic of Phase 5. It gives each branch its tables, drawn on a floor plan, and puts a dine-in order of [spec 005](005-orders.md) at a table.

## Goal

At the Mall, a family sits at table 7 on the terrace. The cashier taps **Tables**, sees which tables are free, taken or waiting to pay, taps table 7 and takes the order. Later the cashier taps table 7 again to add desserts, prints the bill when the family asks for it, and takes the payment, which frees the table. If the family moves inside, the order moves with them.

## Who can do what

| Action                                           | Who                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| See a branch's floor plan to change it           | `branches:read`                                                           |
| Change the floor plan                            | `tables:write`: the group admin, the brand manager and the branch manager |
| See the tables with their orders on the POS      | `orders:read`                                                             |
| Put an order at a table, move it, print the bill | `orders:write` (the cashier)                                              |

One new permission, `tables:write`.

## What is stored

- **Table** (`dining_tables`): the branch; a short name, unique in the branch whatever the capitals ("7", "T7", "Bar 2"); the area it is in ("Inside", "Terrace"), typed by the manager; the seats; square or round; its place on the area's grid (column and row from the top left) and its size in cells; whether it is in use.
- **Order**: the table, and when its bill was printed.

## Rules

1. **Areas and grid.** Each area of a branch is a grid of 24 columns and 16 rows. A table is 1 to 4 cells wide and high and lies inside the grid (`TABLE_OUTSIDE`). Two tables in use in the same area never overlap (`TABLE_OVERLAP`). A branch has at most 200 tables (`TABLES_TOO_MANY`), each with 1 to 50 seats (`SEATS_INVALID`), a name of 1 to 10 characters (`TABLE_NAME_REQUIRED`, `TABLE_NAME_TOO_LONG`, `TABLE_NAME_TAKEN`) and an area of 1 to 40 characters (`AREA_REQUIRED`, `AREA_TOO_LONG`).
2. **The plan is saved as a whole.** A table left out of the plan is removed; one that ever had an order is kept, out of use, so old orders still show its name. A table with an open order cannot be removed or put out of use (`TABLE_IN_USE`).
3. **An order at a table.** Only a dine-in order has a table. Putting an order at a table makes it dine-in; making it takeaway takes it off its table. The table must be in use, at the order's branch (`TABLE_NOT_FOUND`).
4. **One open order per table.** A table holds at most one open order (`TABLE_TAKEN`); the database refuses a second one even when two terminals try at the same moment. The cashier opens the order already at the table instead.
5. **Moving.** An open order moves to another free table of its branch, or leaves its table.
6. **The bill.** The cashier prints the bill of an open order that has something on it (`ORDER_EMPTY`). The table then shows as waiting to pay. Any change of the order's total after that clears it, since the bill is out of date.
7. **Paid or voided** orders free their table; they keep its name for the receipt and the history.
8. **The POS floor** shows every table in use with its order: the order's number, total and when it was opened, and whether its bill was printed.
9. **Kitchen and receipt.** The kitchen ticket, the receipt, the bill and the list of open orders show the table's name.
10. **The audit log** records `branch.tables_updated`.

## API

| Method and path               | What it does                                                                                     | Needs           |
| ----------------------------- | ------------------------------------------------------------------------------------------------ | --------------- |
| `GET /branches/:id/tables`    | The branch's tables, in use or not                                                               | `branches:read` |
| `PUT /branches/:id/tables`    | `{ tables: [{ id?, name, area, seats, shape, x, y, width, height, isActive }] }`: the whole plan | `tables:write`  |
| `GET /branches/:id/floor`     | The tables in use, each with its open order or null                                              | `orders:read`   |
| `POST /orders` with `tableId` | Opens a dine-in order at a table                                                                 | `orders:write`  |
| `PUT /orders/:id/table`       | `{ tableId }`: puts or moves the order at a table                                                | `orders:write`  |
| `DELETE /orders/:id/table`    | Takes the order off its table                                                                    | `orders:write`  |
| `POST /orders/:id/bill`       | Records that the bill was printed                                                                | `orders:write`  |

An order in every answer now has `table` (`{ id, name, area }` or null) and `billPrintedAt`. A kitchen ticket has `tableName`.

## Screens

- **Branch → Floor plan** in the admin: a tab per area, the grid with its tables, and for the table picked its name, seats, shape, size, place and area. A table is placed by picking it and tapping an empty spot, or with the arrow keys. **Add table**, **Add area**, **Remove** and **Save**. Problems are shown before saving.
- **POS → Tables**: the floor of the branch by area. A free table starts a new dine-in order there; a taken one opens its order. Taken tables show the order's number and total; a table whose bill was printed is marked **Bill**.
- **POS order**: a dine-in order shows its table with **Change**, or **Choose a table**. **Print bill** prints the bill.
- **Kitchen screen** and **receipt**: the table's name.

## Acceptance criteria

1. **Given** a branch manager, **when** they save tables 1 and 2 in "Inside" and 7 on the "Terrace", **then** the floor of the branch shows the three, free.
2. **Given** two tables in use that overlap in one area, a table outside the grid, or two tables named "t1" and "T1", **then** saving answers `TABLE_OVERLAP`, `TABLE_OUTSIDE` or `TABLE_NAME_TAKEN` and nothing changes.
3. **Given** the cashier opens an order at table 7, **then** it is dine-in, the floor shows table 7 taken with its number, and a second order at table 7 answers `TABLE_TAKEN`.
4. **Given** that order, **when** it moves to table 2, **then** table 7 is free and table 2 taken; **when** it becomes takeaway, it has no table.
5. **Given** the bill was printed, **then** the floor marks the table; **when** a dish is added, the mark is gone; **when** the order is paid, the table is free and the receipt still names it.
6. **Given** a table with an open order, **when** the plan leaves it out or puts it out of use, **then** the answer is `TABLE_IN_USE`; a table with only paid orders is kept out of use instead of removed.
7. **Given** the Mall's cashier, **then** they see the Mall's floor but cannot change the plan, and Burger Hub's people never see it.

## Not in this version

- Joining two tables into one order, and splitting one table's bill into several.
- Guests per order, reservations, waiting lists and table timers.
- Waiters who own tables, and ordering from a tablet at the table.
- Free drawing of walls and shapes other than square and round.

## Open questions

1. Does the client want the bill split between guests, or joined tables, in a later version?
2. Should a waiter role take orders at the table on a tablet?
