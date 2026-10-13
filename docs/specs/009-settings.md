# Spec 009: Settings and the client's answers

**Status:** Built, API and web. This spec records the client's answers of 13 October 2026 to the open questions of specs 005 to 008, and the settings built for them. Where an answer was "give an option", the option is a setting a manager changes on the Settings screen, so nothing is fixed in the code.

## The answers

| Question                            | Answer                                                            | What was built                                                                 |
| ----------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Card provider                       | Several ways to pay: cash, KNET, Link, Talabat, Keeta, Jahez, ... | Payment methods are a list in the settings of each brand (rule 2)              |
| VAT                                 | No VAT in Kuwait                                                  | The currency is the Kuwaiti dinar, KWD, with 3 decimals. No tax anywhere       |
| Printers                            | Keep open; the system adjusts to the printer there                | Stays with the printing epic. The kitchen screen works on the cashier's device |
| Hosting                             | nexerakw.com                                                      | The deployment notes                                                           |
| Cashier discounts without a manager | Set by the manager, used on every POS                             | Discount buttons and the cashier's limit are settings (rule 3)                 |
| End of the business day             | An option; each shop keeps its own time                           | Each branch has the hour its day ends (rule 4)                                 |
| Voids without a manager             | By the cashier, but it varies                                     | A setting: never, after sending to the kitchen, or always (rule 5)             |
| Void reasons                        | Fine as they are                                                  | Unchanged                                                                      |
| Paying in parts                     | One payment, but mixed (KNET and cash)                            | Already so (spec 007); now with any method                                     |
| Several kitchen screens             | An option                                                         | Kitchen stations in the settings, one per screen (rule 6)                      |
| Warning times 10 and 20 minutes     | Fine                                                              | Unchanged                                                                      |
| Who marks an order done             | An option                                                         | A setting: the kitchen or the cashier (rule 7)                                 |
| Screen lock                         | Fine as it is                                                     | Unchanged                                                                      |

## Who can do what

| Action                           | Who                                                               |
| -------------------------------- | ----------------------------------------------------------------- |
| See the settings of a brand      | Everybody of the brand who is signed in (the terminals need them) |
| Change the settings of a brand   | The group admin and the brand manager (`settings:write`)          |
| Set the hour a branch's day ends | Whoever can change the branch (`branches:write`)                  |

## What is stored

- **Brand settings** (`brands.settings`, JSON): the payment methods, the discount buttons and the cashier's limit, the void rule, who marks tickets done, and the kitchen stations. A brand that was never set up has the defaults below.
- **Branch**: `dayEndsAt` in its configuration (`HH:MM`, default `00:00`).
- **Menu category**: the kitchen station it goes to, or none.
- **Payment**: the method as a key (`cash`, `knet`, ...) and its name as it was at the time.
- **Kitchen ticket**: its station, or none.

## Rules

1. **Currency.** Every amount is in KWD with 3 decimals (the fils). The screens show "KWD" and "د.ك". The default time zone of a new branch is Asia/Kuwait.
2. **Payment methods.** Cash is always there and is the only method with change. The other methods are a list in the settings: a key (`knet`), a name in both languages, and a switch. A payment with a method that is not in the list, or switched off, is refused (`PAYMENT_METHOD_INVALID`). The name is copied onto the payment, so a method renamed later leaves old receipts as they were. Defaults: KNET.
3. **Discounts.** The settings hold the discount buttons (percentages, up to 10 of them) and the percentage a cashier may give without a manager (`0` means never). A percentage discount within the limit needs no approval; a bigger one, or an amount, does (as spec 005). Removing a discount follows the same rule as giving it. Defaults: buttons 5, 10, 15, 20, 25, 50; limit 0.
4. **The business day** of a branch ends at the hour in `dayEndsAt`. An order opened before that hour counts for the day before: with `04:00`, an order at 01:30 on Tuesday belongs to Monday and takes Monday's next number. Default `00:00`, which is midnight as before.
5. **Voids** follow the brand's rule: `never` needs no manager (the cashier voids with a reason, as the client asked), `after_send` needs one once the line or any line of the order was sent to the kitchen (as spec 005 had it), `always` needs one for every void. Default `never`. The void is always recorded in the audit log with who did it.
6. **Kitchen stations.** The settings may name stations (Pizza, Drinks, ...). Each menu category goes to one station, or to none. When a brand has stations, every send makes one ticket per station with the lines of that station; a line of a category without a station, and a combo, go to the first station. A kitchen screen is set up for one station and sees only its tickets, or for all of them. Without stations everything works as spec 008 says.
7. **Who marks a ticket done** is `kitchen` (the kitchen screen has the Done button, as spec 008) or `cashier` (the kitchen screen stops at Ready, and the cashier marks the lines done on the POS when the food is handed over). Default `kitchen`.
8. **Changing a setting** takes effect at the next action on every terminal of the brand; the terminals load the settings when they open and again every few minutes. A change is recorded in the audit log (`brand.settings_updated`).

## API

| Method and path            | What it does                                       | Needs                    |
| -------------------------- | -------------------------------------------------- | ------------------------ |
| `GET /brands/:id/settings` | The settings of the brand, with defaults filled in | Signed in, of that brand |
| `PUT /brands/:id/settings` | Replaces the settings. Answers them as stored      | `settings:write`         |

The branch configuration (spec 002) takes `dayEndsAt`. Categories (spec 004) take `stationId`. The kitchen tickets (spec 008) carry `stationId`, and `GET /kitchen/tickets` takes `stationId` to show one station. A ticket may be moved to `done` with `orders:write` when the brand's setting says the cashier does it.

## Screens

- **Settings** (`/admin/settings`): one page per brand with four parts: payment methods, discounts, voids, kitchen. A group admin picks the brand first.
- **Branch**, hours tab: "The business day ends at".
- **Categories**: a kitchen station per category, when the brand has stations.
- **Kitchen screen setup**: the station, when the brand has stations.
- **POS**: the payment dialog offers cash and every active method, alone or mixed with cash; the discount dialog shows the brand's buttons; the void dialog asks for a manager only when the rule says so; a Done button on ready lines when the cashier marks them done.

## Acceptance criteria

1. **Given** the settings list KNET and Link, **when** an order of 7.500 is paid 5.000 by KNET and 2.500 in cash, **then** it is paid and the receipt shows "KNET 5.000 KWD".
2. **Given** a method that is switched off, **when** it is used, **then** the answer is `PAYMENT_METHOD_INVALID`.
3. **Given** a cashier limit of 10%, **when** a cashier gives 10%, **then** no manager is asked; **when** they give 15%, **then** one is.
4. **Given** a branch whose day ends at 04:00, **when** an order is opened at 01:30 on Tuesday, **then** its business date is Monday.
5. **Given** the void rule `never`, **when** a cashier voids a sent line with a reason, **then** it is voided without a manager and the audit log names the cashier.
6. **Given** stations Pizza and Drinks, categories Pizzas → Pizza and Drinks → Drinks, **when** a pizza and a cola are sent, **then** two tickets are made, and the Drinks screen sees only the cola.
7. **Given** "the cashier marks done", **then** the kitchen screen has no Done button, and the cashier can mark a ready line done on the POS.

## Not in this version

- A link to the KNET machine, or to Talabat, Keeta and Jahez: the orders of the delivery platforms are typed in by the cashier and paid with that method.
- Tax, should Kuwait introduce one.
- Printing (the printing epic), with the printers found on the device.
- Settings per branch (all branches of a brand share them), except the end of the day.

## Open questions

1. Do Talabat, Keeta and Jahez orders need their own order type (with the platform's order number), or is paying with that method enough?
2. Should the delivery platforms' commission be recorded, for the reports?
