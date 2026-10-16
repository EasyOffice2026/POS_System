# Spec 022: Customers and loyalty points

**Status:** Built, API and web. This is the third epic of Phase 5 (reports, promotions and loyalty). It puts a customer on an order of [spec 005](005-orders.md), gives them points when it is paid, and lets them spend the points on a later order.

## Goal

A regular at the Mall gives her phone number at the counter. The cashier finds her in a second, or adds her. Every dinar she spends earns points; when she has enough, the cashier takes them off her bill. The brand sees its customers, how often they come and what they spend, and can give points by hand to make up for a bad experience.

## Who can do what

| Action                                                             | Who                                                                                    |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Find a customer by phone, add one, put one on an order, use points | `orders:write` (the cashier)                                                           |
| See the customers and their points history                         | `customers:read`: the group admin, the brand manager, the branch manager and marketing |
| Change a customer, and give or take points by hand                 | `customers:write`: the group admin, the brand manager and marketing                    |
| Set the loyalty rules                                              | `settings:write`                                                                       |

Two new permissions, `customers:read` and `customers:write`.

## What is stored

- **Customer** (`customers`): the brand; the phone, as `+` and digits; a name, an email and notes, optional; the points; how many paid orders, what they spent in all, and when they came last.
- **Points entry** (`loyalty_entries`): every change of a customer's points: earned on an order, spent on an order, or given or taken by hand with a reason; the points (negative when they go), the balance after, the order, who and when.
- **Order**: the customer, the points spent on it and what they took off, and the points it earned once paid.
- **Brand settings** (spec 009): loyalty on or off, points earned per KWD, the value of a point, and the fewest points that can be spent at once.

## Rules

1. **A customer belongs to a brand** and is the same at every branch. The phone identifies them: unique in the brand (`PHONE_TAKEN`), typed with or without spaces and dashes; eight digits are a Kuwaiti number and get `+965`; `00` at the start is `+`; 8 to 15 digits in all (`PHONE_INVALID`). A customer is never deleted.
2. **On an order.** While an order is open, the cashier puts a customer on it by phone (adding them, with an optional name, when the phone is new) or takes them off. Taking the customer off takes off the points spent too.
3. **Earning.** When an order with a customer is paid and loyalty is on, the customer earns the order's total (after every discount, points included) times the points per KWD, rounded down; the order keeps what it earned. The paid order also counts as a visit and adds its total to what they spent.
4. **Spending.** While the order is open and loyalty is on, the cashier spends a number of the customer's points on it: at least the brand's least (`POINTS_TOO_FEW`), at most what they have (`POINTS_NOT_ENOUGH`), and no more than it takes to pay what is left (`POINTS_TOO_MANY`). Their value is taken off after the promotions and the manual discount. The points leave the customer's balance only when the order is paid, in the same transaction; if the balance is short by then, the payment is refused (`POINTS_NOT_ENOUGH`).
5. **By hand.** A manager gives or takes points with a reason; the balance never goes below zero (`POINTS_NOT_ENOUGH`).
6. **Every change of points is an entry** written with the new balance, in the same transaction.
7. **Reports and shifts** count the points spent as a discount.
8. **The audit log** records `customer.created`, `customer.updated` and `customer.points_adjusted`.

## API

| Method and path                   | What it does                                                           | Needs             |
| --------------------------------- | ---------------------------------------------------------------------- | ----------------- |
| `GET /customers?brandId&q&cursor` | The brand's customers, by phone or name                                | `customers:read`  |
| `GET /customers/lookup?phone`     | One customer by phone, or 404                                          | `orders:write`    |
| `GET /customers/:id`              | One customer with their points history                                 | `customers:read`  |
| `PATCH /customers/:id`            | `{ name?, email?, notes? }`                                            | `customers:write` |
| `POST /customers/:id/points`      | `{ points, reason }`: points given (positive) or taken                 | `customers:write` |
| `PUT /orders/:id/customer`        | `{ phone, name? }`: puts the customer on the order, adding them if new | `orders:write`    |
| `DELETE /orders/:id/customer`     | Takes the customer off                                                 | `orders:write`    |
| `PUT /orders/:id/points`          | `{ points }`: spends points on the order                               | `orders:write`    |
| `DELETE /orders/:id/points`       | Spends none                                                            | `orders:write`    |

An order in every answer now has `customer` (`{ id, name, phone, points }` or null), `pointsRedeemed`, `pointsDiscount` and `pointsEarned`.

## Screens

- **POS**: **Customer** opens a box for the phone: a customer found is put on the order; a new phone asks for a name (optional) and adds them. The order shows the customer and their points, with **Use points** (how many, and what they are worth) and a way to take either off. The receipt shows the customer, the points spent and the points earned.
- **Customers** in the admin menu: the brand's customers with search, their points, visits, what they spent and their last visit; a customer's page with their details, their points history and **Give or take points**.
- **Settings**: a **Loyalty** part: on or off, points per KWD, the value of a point, the fewest points to spend.

## Acceptance criteria

1. **Given** loyalty on at 1 point per KWD, **when** a new phone 9999 1234 is put on an order of 28.300 and it is paid, **then** a customer +96599991234 exists with 28 points, 1 visit and 28.300 spent, and an `earn` entry names the order.
2. **Given** that customer with 300 points and a point worth 0.010, **when** 200 points are spent on an order of 10.000, **then** the order's total is 8.000; when it is paid the customer has 100 points plus what the order earned (8).
3. **Given** a minimum of 100 points, **when** 50 are spent, **then** the answer is `POINTS_TOO_FEW`; **when** more than they have, `POINTS_NOT_ENOUGH`; **when** more than the order needs, `POINTS_TOO_MANY`.
4. **Given** loyalty off, **then** nothing is earned and points cannot be spent (`LOYALTY_OFF`); a customer can still be put on an order.
5. **Given** a manager taking 500 points from a customer with 100, **then** the answer is `POINTS_NOT_ENOUGH`; giving 50 with a reason adds an `adjust` entry.
6. **Given** the Mall's cashier, **then** they can find and add customers but not open the customers list; Burger Hub never sees Pizza Palace's customers.

## Not in this version

- Points given back when an order is refunded or voided after payment.
- Points that expire, Bronze, Silver and Gold tiers, birthday rewards, and messages to customers.
- A code sent by SMS to confirm that the customer agrees to spend their points.
- Points shared by all the brands of the group (README, "Customer loyalty"): here each brand has its own customers and points.
- A customer app or a QR code to identify the customer.

## Open questions

1. ~~How many points per KWD, what is a point worth, and from how many can they be spent, for each brand?~~ Answered 16 October 2026: 1 point per KWD paid, a point worth 75 fils; these are the defaults, and each brand can still change them in Settings. The fewest points to spend stays 100 until the client says otherwise.
2. Should the customer agree, at the counter, to their phone being kept, and should they be able to ask for it to be removed?
3. Should points be shared by all the brands of the group, with tiers and an SMS code, as the first plan says? That needs an SMS provider in Kuwait.
