# Acceptance tests

**For:** the people at Easy Office / Nexera who will test the system before it goes live: the owner, brand and branch managers, cashiers, kitchen staff, marketing and purchasing.

**What this is:** a list of things to try, role by role, each with what should happen. Mark each one **Pass**, **Fail** or **Skip**, and write a note for anything that fails or feels wrong. When every role has signed at the end, the system is accepted for its first branch.

## Before you start

**Where:** the test address (staging) given by the development team. It has its own database with demonstration data, so nothing you do there reaches real customers or money. It can be reset to the starting state at any time.

**Devices:** a computer for the back office; a tablet or touch screen for the till (POS); another screen for the kitchen. Use Chrome or Edge.

**The demonstration data:** two brands, Pizza Palace (Mall branch and Downtown branch) and Burger Hub (Airport branch and Corniche branch), with menus, prices in KWD, the payment methods of Kuwait, kitchen stations, and tables at the Mall. Pizza Palace also has six ingredients in stock at both branches (pizza dough, mozzarella, tomato sauce, pepperoni, chicken, cola cans), recipes for its pizzas and cola, and two suppliers (Gulf Dairy and Kuwait Food Supply).

**Order:** do part 2 before part 4, as part 2 switches loyalty points and the promotions on.

**Accounts** (password for all email accounts: `DevPassw0rd!`):

| Role                          | Sign in with                                               | Where                                  |
| ----------------------------- | ---------------------------------------------------------- | -------------------------------------- |
| Owner (group admin)           | `admin@pos.local`                                          | Back office                            |
| Brand manager, Pizza Palace   | `pizza.manager@pos.local`                                  | Back office                            |
| Brand manager, Burger Hub     | `burger.manager@pos.local`                                 | Back office                            |
| Marketing, Pizza Palace       | `pizza.marketing@pos.local`                                | Back office                            |
| Branch manager, Mall          | `pizza.mall.manager@pos.local` (staff code 1003, PIN 5824) | Back office, and approvals on the till |
| Purchaser, Mall               | `pizza.mall.purchaser@pos.local`                           | Back office                            |
| Cashier, Mall                 | staff code 1001, PIN 1234                                  | Till                                   |
| Kitchen, Mall                 | staff code 1002, PIN 2222                                  | Kitchen screen                         |
| Cashier, Airport (Burger Hub) | staff code 2001, PIN 4321                                  | Till                                   |

**When something fails,** write down: the test number, what you did, what you expected, what happened, the time, and the account. A screenshot helps. Send it to the development team the same day.

**Language:** every screen can be used in Arabic or English with the language button at the top. Test at least one role fully in Arabic.

---

## 1. Owner (group admin)

| #    | Try this                                                                             | What should happen                                                                                                                                                  | Result | Note |
| ---- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---- |
| 1.1  | Sign in as the owner.                                                                | The dashboard opens with **Today**: sales, orders, average order, discounts and refunds, each brand's branches, sales by hour, top dishes and what needs attention. |        |      |
| 1.2  | On the dashboard, pick **Burger Hub** in the brand list.                             | Only Burger Hub's branches and figures are shown.                                                                                                                   |        |      |
| 1.3  | Open **Brands**, add a brand with an English and an Arabic name.                     | It is listed; switching it off shows it as inactive.                                                                                                                |        |      |
| 1.4  | Open **Branches**, open the Mall branch, change its opening hours and add a printer. | The changes are saved and shown again after a reload.                                                                                                               |        |      |
| 1.5  | Open **Users**, add a cashier for the Mall with a staff code and a PIN.              | The PIN is shown once. The new cashier can sign in on the Mall till.                                                                                                |        |      |
| 1.6  | Switch that cashier off.                                                             | They can no longer sign in on the till.                                                                                                                             |        |      |
| 1.7  | Open **Roles**.                                                                      | Every role and what it may do is listed.                                                                                                                            |        |      |
| 1.8  | Open **Reports**, pick a brand and this week, download the CSV.                      | Sales, discounts, refunds, by day, by payment method, by dish (with food cost) and by category. The CSV opens in Excel with Arabic names readable.                  |        |      |
| 1.9  | Open **Audit log**.                                                                  | Sign-ins, voids, discounts, refunds and changes of the other tests are listed with who and when.                                                                    |        |      |
| 1.10 | Sign in with a wrong password five times.                                            | The account is locked for 15 minutes; the message says so.                                                                                                          |        |      |

## 2. Brand manager (Pizza Palace)

| #    | Try this                                                                                                        | What should happen                                                                            | Result | Note |
| ---- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------ | ---- |
| 2.1  | Sign in. Open **Brands** and **Branches**.                                                                      | Only Pizza Palace and its branches; nothing of Burger Hub anywhere.                           |        |      |
| 2.2  | **Menu → Items:** add a dish with English and Arabic names, a price, a category and a photo link.               | It is listed and appears on the till's menu.                                                  |        |      |
| 2.3  | Give the dish a modifier group "Size" (choose 1) and "Extras" (choose up to 3, each with a price).              | On the till, the dish asks for a size and allows up to three extras, with their prices added. |        |      |
| 2.4  | Set a different price for the dish at the Downtown branch only.                                                 | The Downtown till shows the new price; the Mall till keeps the old one.                       |        |      |
| 2.5  | Make a dish lunch-only (12:00–15:00).                                                                           | Outside those hours the till shows it as not available now.                                   |        |      |
| 2.6  | **Menu → Combos:** make a combo of a pizza and a drink.                                                         | The till offers the combo and asks for the pizza and the drink.                               |        |      |
| 2.7  | **Menu → Promotions:** 20% off drinks, every day; and a code WELCOME for 10% off.                               | On the till, drinks are 20% cheaper on their own; typing WELCOME takes 10% more off.          |        |      |
| 2.8  | **Settings:** add a payment method, change the discount buttons, set the cashier limit to 10%, turn loyalty on. | The till shows the new method and buttons at once (or within three minutes).                  |        |      |
| 2.9  | **Customers:** open a customer, give 50 points with a reason.                                                   | Their balance goes up by 50 and the history shows the reason.                                 |        |      |
| 2.10 | **Branches → Mall → Floor plan:** add a table on the terrace and move it.                                       | The till's floor shows the new table where it was put.                                        |        |      |

## 3. Branch manager (Mall)

| #   | Try this                                                                                             | What should happen                                                                              | Result | Note |
| --- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------ | ---- |
| 3.1 | Sign in to the back office.                                                                          | Only the Mall branch; no brands, no other branch.                                               |        |      |
| 3.2 | Open **POS terminal**, choose the Mall branch.                                                       | The till is set up; it now asks for a staff code and PIN.                                       |        |      |
| 3.3 | On the till, when a cashier voids a dish that was sent to the kitchen, type your staff code and PIN. | The void goes through with your approval and is in the audit log.                               |        |      |
| 3.4 | Approve a 25% discount (above the cashier's limit) the same way.                                     | The discount is applied; the receipt shows it.                                                  |        |      |
| 3.5 | Refund part of a paid order in cash.                                                                 | The order shows the refund; the shift's expected cash goes down by it.                          |        |      |
| 3.6 | Open **Shifts**.                                                                                     | The cashier's shift is listed with sales by payment method, refunds, expected and counted cash. |        |      |
| 3.7 | Open **Reports** for the Mall, today.                                                                | Today's sales of the Mall only.                                                                 |        |      |
| 3.8 | Open **Customers**.                                                                                  | The customers are listed; you can read them but not change points.                              |        |      |

## 4. Cashier (till)

| #    | Try this                                                                               | What should happen                                                                              | Result | Note |
| ---- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------ | ---- |
| 4.1  | Sign in with staff code 1001 and PIN 1234.                                             | The till asks for the cash in the drawer to open the shift.                                     |        |      |
| 4.2  | Open the shift with 50.000.                                                            | The menu and an empty order appear.                                                             |        |      |
| 4.3  | Tap a pizza, choose its size and two extras, add a drink.                              | The order shows both with the right prices and total.                                           |        |      |
| 4.4  | Tap **+** and **−** on a line, then remove a line not yet sent.                        | The quantity and total change; the line disappears.                                             |        |      |
| 4.5  | Tap **Send to kitchen**.                                                               | The kitchen screen shows a ticket within 5 seconds.                                             |        |      |
| 4.6  | Void a sent dish with a reason.                                                        | A manager's approval is asked if the brand's settings say so; the dish is struck through.       |        |      |
| 4.7  | Give a 10% discount with the discount button.                                          | No manager needed (within the limit); the total drops by 10%.                                   |        |      |
| 4.8  | Tap **Promo code**, type `welcome`.                                                    | The code is taken and the order shows what it took off. A wrong code is refused with a message. |        |      |
| 4.9  | Tap **Customer**, type a new phone (8 digits) and a name.                              | The customer is added to the order.                                                             |        |      |
| 4.10 | Pay part with KNET (with slip number) and the rest in cash, giving 20.000.             | The change is shown and printed on the receipt. The customer earns points.                      |        |      |
| 4.11 | On the next order, find the same customer by phone and tap **Use points**.             | Their points take money off the bill; the receipt shows points spent and the new balance.       |        |      |
| 4.12 | Tap **Tables**, choose a free table, take an order there.                              | The order is dine-in at that table; the floor shows the table taken.                            |        |      |
| 4.13 | Move the order to another table, then tap **Print bill**.                              | The table shows "Bill printed"; the bill says "Not paid".                                       |        |      |
| 4.14 | Pay the table's order.                                                                 | The table is free again; the receipt names the table.                                           |        |      |
| 4.15 | Open **Open orders**, open an earlier order, continue it.                              | The order comes back as it was.                                                                 |        |      |
| 4.16 | **Close shift**: count the drawer, type the counted cash.                              | The shift report shows expected and counted cash and the difference.                            |        |      |
| 4.17 | Use the till in Arabic.                                                                | Every text is Arabic, the screen reads right to left, numbers and prices are readable.          |        |      |
| 4.18 | Settings → Order types at the branches: switch Dine-in off at one branch, Delivery on. | That branch's till has no **Tables** button and no Dine-in; it offers Takeaway and Delivery.    |        |      |
| 4.19 | Choose **Delivery**, tap **Add delivery details**, type a phone and an address.        | The address shows on the order. Without an address, **Send to kitchen** and **Pay** ask for it. |        |      |
| 4.20 | Pay the delivery order.                                                                | The receipt prints the name, phone, address and note under "Deliver to".                        |        |      |

## 5. Kitchen

| #   | Try this                                                            | What should happen                                                                       | Result | Note |
| --- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------ | ---- |
| 5.1 | Open the kitchen screen, sign in with staff code 1002 and PIN 2222. | The tickets of the Mall are shown, oldest first, with the table name for dine-in orders. |        |      |
| 5.2 | Pick a station (for example Pizza).                                 | Only that station's dishes are shown.                                                    |        |      |
| 5.3 | Move a ticket from new to preparing, to ready, to done.             | The till shows the dishes as ready; a done ticket moves to the finished list.            |        |      |
| 5.4 | A cashier voids a dish on a ticket.                                 | The dish is struck through on the ticket.                                                |        |      |

## 6. Purchaser and stock (Mall)

| #   | Try this                                                                             | What should happen                                                                                                     | Result | Note |
| --- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------ | ---- |
| 6.1 | **Inventory → Stock:** record a delivery of 5 kg of Mozzarella.                      | The stock goes up; **Movements** shows it.                                                                             |        |      |
| 6.2 | Sell three Margherita pizzas on the till.                                            | Pizza dough goes down by 3, mozzarella by 0.450 kg and tomato sauce by 0.300 l.                                        |        |      |
| 6.3 | **Transfers:** send 10 pizza dough to Downtown.                                      | The Mall's stock goes down; Downtown confirms and its stock goes up.                                                   |        |      |
| 6.4 | **Counts:** count three ingredients, type what is on the shelf, finish.              | The stock is set to the count; the loss or gain is shown in KWD.                                                       |        |      |
| 6.5 | Record waste of 3 kg of Pepperoni (stock 4, low level 2).                            | The dashboard's stock alerts show pepperoni as low.                                                                    |        |      |
| 6.6 | **Purchase orders:** order dough and pepperoni from Kuwait Food Supply, send, print. | Their prices fill in by themselves; the order prints with the supplier, the ingredients, the quantities and the total. |        |      |
| 6.7 | Receive that order, with one item short.                                             | The stock goes up by what arrived; the order shows ordered and received side by side.                                  |        |      |

## 7. Marketing (Pizza Palace)

| #   | Try this                                                           | What should happen                                                                                        | Result | Note |
| --- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------ | ---- |
| 7.1 | Sign in.                                                           | Menu promotions and customers are open to you; users, settings and stock are not.                         |        |      |
| 7.2 | Make a "buy 2 pizzas, get 1 free" promotion for Thursday evenings. | On a Thursday evening the till takes one pizza off by itself for every three; at other times it does not. |        |      |
| 7.3 | Look up the customers who came most.                               | The customer list shows visits, points and what each spent.                                               |        |      |

## 8. Everyone

| #   | Try this                                                      | What should happen                                           | Result | Note |
| --- | ------------------------------------------------------------- | ------------------------------------------------------------ | ------ | ---- |
| 8.1 | Use the back office on a phone.                               | Every page fits the screen without scrolling sideways.       |        |      |
| 8.2 | Leave the till for 30 minutes, then use it.                   | It still works, or asks for the PIN again; no order is lost. |        |      |
| 8.3 | Two tills take an order at the same table at the same moment. | One gets the table; the other is told the table is taken.    |        |      |
| 8.4 | Is anything missing, unclear or slower than you expect?       | Write it in the notes of the role.                           |        |      |

---

## Sign-off

| Role           | Name | Date | Accepted (yes / with notes / no) | Signature |
| -------------- | ---- | ---- | -------------------------------- | --------- |
| Owner          |      |      |                                  |           |
| Brand manager  |      |      |                                  |           |
| Branch manager |      |      |                                  |           |
| Cashier        |      |      |                                  |           |
| Kitchen        |      |      |                                  |           |
| Purchaser      |      |      |                                  |           |
| Marketing      |      |      |                                  |           |

## For the development team: preparing the test site

1. Start a staging copy as in `docs/deployment.md`, with its own Supabase project (never the live one).
2. Apply the migrations, then load the demonstration data once:
   ```
   SEED_ALLOW_REMOTE=1 npm run db:seed
   ```
   (from `apps/api`, with `DATABASE_URL` set to the staging database). The demo accounts have a public password, so the staging address must not be shared beyond the testers.
3. To reset it between rounds, empty the staging database (or make a new project), apply the migrations and load the demonstration data again.
4. Keep the testers' results with the release they tested.
