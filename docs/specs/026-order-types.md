# Spec 026: Order types per branch, and delivery

**Status:** Built, API and web. Asked by the client on 20 October 2026. It adds a third order type to [spec 005](005-orders.md) and lets each branch choose which types its till offers.

## Goal

A kiosk branch has no seats, so its cashier should not see Dine-in or the table step. A branch that sends its own drivers takes orders by phone and needs the customer's phone and address on the order, the kitchen ticket and the receipt. The owner sets this per branch, on the Settings screen.

## Who can do what

| Action                         | Who                                                |
| ------------------------------ | -------------------------------------------------- |
| Switch order types of a branch | `settings:write` and `branches:write`, on Settings |
| Take a delivery order          | `orders:write`, as for any order                   |

No new permission.

## Rules

1. **Three types:** Dine-in (at a table, [spec 023](023-floor-plan.md)), Takeaway, and Delivery: a phone order taken to the customer by the branch's own driver. Talabat, Keeta and Jahez orders stay Takeaway paid with that platform ([spec 025](025-platform-commission.md)).
2. **Each branch switches each type on or off.** A branch starts with Dine-in and Takeaway on and Delivery off, as before. At least one type stays on (`ORDER_TYPES_NONE`).
3. **The till offers only the types that are on**, the first of them chosen for a new order. With Dine-in off, the Tables button and the "Choose a table" step disappear.
4. **The API refuses a type that is off** for the branch, when an order is opened or its type changed (`ORDER_TYPE_NOT_OFFERED`). Orders opened before a type was switched off keep their type.
5. **A delivery order carries the delivery details:** the customer's phone (required), name (optional) and address (required), and a note for the driver (optional). They can be changed while the order is open. The order is not sent to the kitchen nor paid without them (`DELIVERY_DETAILS_REQUIRED`).
6. **The kitchen ticket shows "Delivery"** like the other types, and **the receipt** prints the name, phone, address and note.
7. Changing a delivery order to another type keeps no delivery details.

## API

| Route                               | Change                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------- |
| `PATCH /branches/:id`               | `config.orderTypes`: `{ dine_in, takeaway, delivery }`, each true or false                  |
| `GET /menu?branchId=`               | Answers `orderTypes`, the types the branch offers, in the till's order                      |
| `POST /orders`, `PATCH /orders/:id` | `type` may be `delivery`; `delivery: { name?, phone, address, note? }`, or null to clear it |
| Order                               | `delivery`: the details, or null                                                            |

## Data

Order type `delivery`; `orders.delivery` (JSON, null when none). Branch configuration `orderTypes`. Migration `20261020120000_delivery_orders`.

## Acceptance criteria

1. A branch with Dine-in off: the till shows Takeaway only (and Delivery when on), no Tables button; opening a dine-in order there is refused.
2. A branch with Delivery on: the cashier chooses Delivery, types the phone and the address, adds dishes, sends and pays; the receipt shows the address.
3. A delivery order without an address cannot be sent to the kitchen.
4. Switching a type off leaves open orders of that type as they are.
