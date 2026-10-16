# Rollout

**For:** the project lead at Easy Office / Nexera, and the person who sets up each branch. **What it covers:** what to collect from each brand and branch, how to set a branch up in the back office, how to train each role, the go-live checklist for the first branch, what to do if something goes wrong, and how to add the next branches.

The system goes live one branch at a time. The first branch runs alone for two weeks before the next ones start, so problems are found where they cost least.

## 1. What to collect first

Ask each brand and branch for these a week before its setup. A spreadsheet per brand is fine.

| What                                                                                                                                                                                                                 | From            | Used for                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------- |
| Brand name in English and Arabic, logo link                                                                                                                                                                          | Brand manager   | Brands                    |
| Branch name in English and Arabic, address, opening hours, the hour the business day ends (for example 04:00 for a late-night branch)                                                                                | Branch manager  | Branches                  |
| Payment methods taken (KNET, Link, Talabat, Keeta, Jahez, ...), discount buttons, the most a cashier may discount alone, whether a void needs a manager                                                              | Brand manager   | Settings                  |
| Kitchen stations (for example Pizza, Grill, Drinks) and which menu categories go to each                                                                                                                             | Kitchen lead    | Settings, menu categories |
| The menu: categories; dishes with English and Arabic names, description, price, photo link; sizes and extras with their prices; combos; dishes sold only at some hours or some branches; different prices per branch | Brand manager   | Menu                      |
| Staff of the branch: name, role, email (managers) or staff code (cashiers and kitchen)                                                                                                                               | Branch manager  | Users                     |
| Tables, by area, with seats (dine-in branches)                                                                                                                                                                       | Branch manager  | Floor plan                |
| Ingredients with unit and cost, recipes per dish, suppliers with prices, low levels                                                                                                                                  | Purchaser, chef | Inventory                 |
| The stock on the shelves on the evening before go-live                                                                                                                                                               | Branch manager  | Opening stock count       |
| Loyalty rules: on or off, points per KWD, value of a point, fewest points to spend                                                                                                                                   | Marketing       | Settings                  |

## 2. Setting up a branch

Sign in to the back office as the group admin or the brand manager. Do the steps in this order; each one uses what the one before made.

1. **Brand** (once per brand). **Brands → Add**: names and logo.
2. **Settings** of the brand. **Settings**: payment methods, discount buttons and the cashier's limit, the void rule, kitchen stations, loyalty.
3. **Branch.** **Branches → Add**: names, address, time zone (Asia/Kuwait). Then its tabs: **Opening hours** (with the hour the business day ends), **Printers** (names and addresses, for later), **Floor plan** (areas and tables, for dine-in).
4. **Menu.** A menu that already exists as a file is imported in one go: for Mudawara, `npm run menu:import -w @pos/api -- --brand Mudawara --file prisma/menus/mudawara.json` from the developer's machine with `DATABASE_URL` set to the live database, after the brand was added; running it again updates prices without making copies, and its photos are stock placeholders until the brand's own are linked. Otherwise, or to finish by hand: **Menu → Categories** (with the kitchen station of each), **Items** (with sizes and extras, and the branch's own price or hours where they differ), **Combos**, and **Promotions** if any. Check it with **Menu → Branch menu**, branch by branch, in both languages.
5. **People.** **Users → Add**: the branch manager (email and password, plus a staff code and PIN for approvals on the till), cashiers and kitchen staff (staff code and PIN). Each PIN is shown once: hand it to the person in private. The branch manager can then add later staff of the branch.
6. **Stock** (when the branch tracks it). **Inventory → Ingredients** (with units, costs and low levels), the recipe of each dish (**Menu → Items → Recipe**), **Suppliers** with their prices. The opening stock is entered with a count on the evening before go-live (checklist below).
7. **Devices.**
   - **Till:** a tablet or touch screen with Chrome or Edge. Open the address, go to **POS terminal**, sign in as the branch manager and choose the branch. The device is now that branch's till; cashiers sign in on it with their staff code and PIN. Add the address to the home screen and set the browser to full screen.
   - **Receipt printer:** set it as the device's default printer; receipts and bills are printed with the browser's print button. (Printing without the dialog comes with the print bridge, once the printer model is chosen.)
   - **Kitchen screen:** a screen in the kitchen, at **Kitchen screen**, set up the same way; choose a station if each station has its own screen.
8. **Try it** with the branch manager: take an order of each kind (takeaway, dine-in at a table, with a customer and points, with a promotion), send it to the kitchen, finish it on the kitchen screen, pay it in each way the branch takes, refund one, close the shift. Then void every test order, or use a test brand for this.

## 3. Training

| Who                         | How long                          | What                                                                                                                                                         | Practise on                                            |
| --------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| Cashiers                    | 1 hour, at the till               | Signing in with the PIN, opening and closing the shift, taking and changing orders, tables, customers and points, payments and change, printing, open orders | Part 4 of `docs/acceptance-tests.md`, on the test site |
| Kitchen                     | 30 minutes, at the kitchen screen | Reading tickets, stations, moving tickets, voided dishes                                                                                                     | Part 5                                                 |
| Branch manager              | 2 hours                           | Everything of the cashier, plus approvals with the PIN, refunds, shifts and their reports, stock, counts, transfers, purchase orders, the branch's reports   | Parts 3, 4 and 6                                       |
| Brand manager and marketing | 2 hours                           | Menu, prices per branch, promotions, settings, customers, reports, floor plans                                                                               | Parts 2 and 7                                          |
| Owner                       | 1 hour                            | Dashboard, reports, users and roles, audit log                                                                                                               | Part 1                                                 |

Every trainee practises on the test site, never on the live one. Hand each person a one-page note of their own steps in their language.

## 4. Go-live checklist (first branch)

**One week before**

- [ ] The acceptance tests are signed by every role (`docs/acceptance-tests.md`).
- [ ] The live site runs (`docs/deployment.md`): HTTPS address, live database, backups on, alerts going to a named person.
- [ ] The brand, settings, branch, menu and people are set up on the live site (section 2), and the menu is checked in both languages.
- [ ] The devices are set up and tried at the branch: till, receipt printer, kitchen screen, Wi-Fi.
- [ ] Every person of the branch is trained and has their PIN.
- [ ] The old system stays available, and staff know how to go back to it.

**The evening before**

- [ ] Count the stock on the shelves and enter it as a stock count (**Inventory → Counts**), so the stock starts right.
- [ ] Close the day on the old system; note its last order number and totals.
- [ ] Sign in once on each device; leave them charged and plugged in.

**Opening day**

- [ ] The development team is on call from opening until closing.
- [ ] Each cashier opens a shift with the cash in the drawer.
- [ ] After the first hour, the branch manager checks the dashboard and one kitchen ticket against the orders.
- [ ] At closing, each cashier closes the shift and counts the drawer; the branch manager checks the shift reports against the money and the card machine's totals.
- [ ] Write down every problem and question of the day, with the time.

**First week**

- [ ] Daily: shift reports against the cash and the card machine; the dashboard's "needs attention" list.
- [ ] On day 3 and day 7, a short meeting with the branch manager: problems, questions, changes wanted.
- [ ] At the end of the week, a stock count, to compare with what the system expects.

## 5. If something goes wrong

| What happens                                 | What to do                                                                                                                             |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| A till cannot reach the system (no internet) | Take orders on paper or on the old system until it is back; enter the paid orders afterwards. The system has no offline mode yet.      |
| The system is down for everyone              | Same as above; call the development team, who check the readiness check and the logs (`docs/deployment.md`).                           |
| A wrong price or dish                        | The brand manager fixes it in the menu; tills take it within a few minutes.                                                            |
| A cashier forgot their PIN or is locked out  | The branch manager resets the PIN in **Users**, or waits the 15 minutes of the lockout.                                                |
| A payment was taken wrongly                  | Refund it (branch manager's approval) and take it again; the shift report shows both.                                                  |
| A bigger problem                             | Go back to the old system for the rest of the day; the development team finds the cause with the time and the request id of the error. |

## 6. The next branches

When the first branch has run two weeks without serious problems:

1. Set up the next branch the same way (section 2). Its brand, settings and menu are already there; a branch adds only its own hours, prices, tables, people, stock and devices.
2. Train its people, then go live with the checklist of section 4.
3. Bring branches on one or two a week, so each gets the team's attention on its first days.

## Waiting on the client

These parts of the plan wait for an answer, and do not block the first branch:

- Delivery platforms (Talabat, Keeta, Jahez): partner API access.
- Printing without the browser dialog: the printer model.
- KNET card machine connected to the till: the payment provider.
- Offline mode: whether tills must keep working without internet.
- Images stored by the system (instead of links): where to store them.
