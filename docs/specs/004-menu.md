# Spec 004: Menu management

**Status:** Built, API and web, with one change from the plan: the cache of the branch menu is kept in the memory of the API, not in Redis (rule 8 and the open questions). This is module 03 of the technical proposal. It needed the brand and branch screens (spec 002) first. Where building it meant a decision, the decision is in the rules below.

## Goal

A brand manager builds the menu of a brand once, in English and Arabic. Each branch can then change the price of an item, switch it off, or limit it to certain times, without copying the menu. The POS terminal loads the menu of its branch in under a second.

## Who can do what

| Action                                       | Group Admin | Brand Manager (own brand) | Everybody else with `menu:read` |
| -------------------------------------------- | :---------: | :-----------------------: | :-----------------------------: |
| See the menu of a brand                      |      x      |             x             |            own brand            |
| Change the menu                              |      x      |             x             |                                 |
| Load the menu of a branch (what a POS loads) |      x      |             x             |          own branches           |

This follows the permission matrix in spec 001: `menu:read` for every role, `menu:write` for the group admin and the brand manager. A person who belongs to a branch (branch manager, cashier, kitchen, purchaser) reads the menu of their brand and loads the menu of their own branches, and can change nothing: the database client refuses any change from them, whatever the route does.

## What is stored

The menu belongs to a **brand**. A **branch** only stores differences.

| Thing           | Belongs to      | Main fields                                                                          |
| --------------- | --------------- | ------------------------------------------------------------------------------------ |
| Category        | Brand           | Name (English and Arabic), sort order, active                                        |
| Item            | Brand           | Name and description (English and Arabic), category, base price, image link, active  |
| Modifier group  | Item            | Name, fewest and most choices (a fewest of 1 or more makes it required), active      |
| Modifier        | Group           | Name, price change (can be 0 or negative), active                                    |
| Combo           | Brand           | Name, price, active, and its choices                                                 |
| Combo choice    | Combo           | Name, and the items that can fill it, each with an optional extra charge             |
| Branch override | Item and branch | Price for this branch, available or not, days and times it is available (a schedule) |

**Prices** have exactly 3 decimal places and are sent as text (`"12.500"`), never as floating-point numbers. The database column is `numeric(10,3)`. `12` and `12.5` are accepted and written as `"12.000"` and `"12.500"`. Currency is SAR for now. A price that includes tax versus one that does not is a later decision.

**Search text.** Each item keeps both names written plainly in one column (English first), which is what a search looks in, and which also gives the order of the items.

**Schedule.** A schedule has the shape of opening hours (spec 002): each day is `closed` (not available), `all_day` or `ranges`, and a range may pass midnight. It is read on the clock of the branch. No schedule means the item is available at all times.

**Tenancy in the database.** Every menu table has a `brand_id`, and a child points at its parent with both ids (the foreign key is `(parent_id, brand_id)`), so the database itself refuses a row that mixes two brands.

## Rules

1. Every name needs both languages. A blank one counts as missing, and a name has at most 100 characters. A description is optional, but when there is one it is in both languages (at most 500 characters each).
2. An item is in exactly one category.
3. A branch override can change the price, switch the item off, or set when it is available. It never changes the name or the modifiers. A branch stores only differences: a request that puts everything back to the brand's values removes the override, and leaving a field out puts it back to the brand's value.
4. **Nothing in the menu is deleted.** A category, item, modifier group, modifier or combo that is no longer sold is made **inactive**, so old orders keep its name and its price. Prices are copied onto an order when it is placed, so a later price change never alters it (that copy is the job of the orders module, which does not exist yet). An inactive category hides all of its items from the terminals.
5. Searching works in both languages: typing in Arabic finds Arabic names and typing in English finds English names. The text is made plain before it is compared: diacritics and the stretching mark are removed, the different forms of alef (أ إ آ ٱ) become one, Arabic-Indic and Persian digits become plain digits, capitals are ignored. Every word typed has to be found in the names, in any order. `%`, `_` and `\` are letters like the others.
6. **Prices.** A price is not negative and has at most 7 digits before the point and 3 after. A price change (a modifier, the extra charge of a combo item) can be negative. A value that is not a price is reported as `PRICE_INVALID`, also when it was sent as a JSON number.
7. **Limits.** A brand has at most 500 categories (`409 CATEGORY_LIMIT`). A modifier group has at most 50 modifiers (`409 MODIFIER_LIMIT`), and its fewest choices (0 to 20) cannot be more than its most choices (1 to 20). A combo has 1 to 10 choices, each with 1 to 30 items, and an item is at most once in a choice.
8. **The menu of a branch and its cache.** The terminal loads it with one request: `GET /api/v1/menu?branchId=`. It has only what can be sold there: active categories with an active category and item, the items that are not switched off for the branch, at the price of the branch (the base price when the branch changes nothing), with the schedule of the item if the branch gave one, the active modifier groups with their active modifiers, and the active combos. A category with nothing to sell is left out. A combo keeps only the items that can be sold at the branch, and is left out when one of its choices has none. The answer also says the branch, the brand, the currency and the time zone, so a terminal can read schedules on the branch's clock (`isOpenAtInstant` in `packages/shared`). The answer is kept per branch for `MENU_CACHE_TTL_SECONDS` (300 by default) and is cleared at once when anything in it changes: a change to a category, item, modifier or combo clears every branch of the brand, a change to one branch's override clears only that branch. A menu that was being built while a change happened is not kept. The answer has an `ETag`, so a terminal that asks again with it gets a short `304`. **The cache lives in the memory of the API**, behind a small interface (`MenuCache`), because Redis cannot be run here or in CI yet. It is right for one API process; with several, each has its own copy and a change would reach the others only when their copy expires. A Redis version of the same interface is the fix (see the open questions).
9. A person who cannot see a branch gets the same answer as for one that does not exist, and the access check is made before the cache is read.
10. A change that changes nothing writes nothing: no audit row, no cache clearing.
11. Every create and change is written to the audit log: `menu.category.created`, `.updated`, `.reordered`; `menu.item.created`, `.updated`, `.branch_override_set`; `menu.modifier_group.created`, `.updated`; `menu.modifier.created`, `.updated`; `menu.combo.created`, `.updated`. A deactivation is an update with the new state.
12. A group admin names the brand when creating something (`BRAND_REQUIRED`). A brand manager who names another brand gets `403`, and the id of a thing of another brand is answered `404`, the same as one that does not exist.
13. An **image** is a web link (`http` or `https`, at most 2048 characters, no user name or password in it) until files can be stored.
14. Requests refuse fields the API does not know.

## Screens

The **Menu** link opens the menu area. A group admin chooses the brand at the top (kept in the address, `?brandId=`); everybody else works on their own brand's. Four sections:

- **Items:** a list with a search in both languages, filters by category and status, the name in the other language under each name, and more pages on request. A new item starts in the category the list is filtered by.
- **Item form:** the item opens in three tabs that the address remembers (`?tab=pricing`): **Details** (category, names, description, price, image link, and deactivate or activate), **Branch prices** (one card per branch with its price, whether the item is on, and its times; editing a branch sets all three, and "Use the brand settings" puts it back) and **Modifiers** (the groups of the item with what the guest has to choose, and adding or changing groups and modifiers in place).
- **Categories:** a list that is re-ordered by dragging a category or with its arrows. The new order of all the categories is saved at once and shown at once, and put back if the save fails. Names change in place.
- **Combos:** a list, and a builder with the names, the price and up to 10 choices, each filled by up to 30 of the active items of the brand, shown by category, with an optional extra charge. An item already used in a choice is not offered again there.
- **Branch menu:** shows the menu of one branch exactly as its terminal loads it, with the modifiers, the combos and the times of the items. An item with times that cannot be sold at this moment, on the clock of the branch, says so.

A person without `menu:write` sees the same screens with every field switched off. Prices in lists are written left to right in both languages, and a price typed with Arabic digits is accepted.

## API

All paths start with `/api/v1/menu`.

| Method | Path                             | Permission   | Description                                                      |
| ------ | -------------------------------- | ------------ | ---------------------------------------------------------------- |
| GET    | `?branchId=`                     | `menu:read`  | The full menu of one branch, as the POS loads it                 |
| GET    | `/categories`                    | `menu:read`  | Categories with bilingual names (`?brandId=` for a group admin)  |
| POST   | `/categories`                    | `menu:write` | Create a category                                                |
| PUT    | `/categories/order`              | `menu:write` | Set the order of all the categories of a brand                   |
| PATCH  | `/categories/:id`                | `menu:write` | Change a category, or deactivate or activate it                  |
| GET    | `/items`                         | `menu:read`  | Items, a page at a time (`brandId`, `categoryId`, `status`, `q`) |
| POST   | `/items`                         | `menu:write` | Create an item with English and Arabic names                     |
| GET    | `/items/:id`                     | `menu:read`  | One item with its modifier groups                                |
| PATCH  | `/items/:id`                     | `menu:write` | Change an item, or deactivate or activate it                     |
| GET    | `/items/:id/branch-overrides`    | `menu:read`  | What each branch changes about the item                          |
| PUT    | `/items/:id/branch-override`     | `menu:write` | Set a branch price, availability or schedule                     |
| POST   | `/items/:id/modifier-groups`     | `menu:write` | Add a modifier group, with its modifiers if wanted               |
| PATCH  | `/modifier-groups/:id`           | `menu:write` | Change a modifier group, or deactivate or activate it            |
| POST   | `/modifier-groups/:id/modifiers` | `menu:write` | Add a modifier                                                   |
| PATCH  | `/modifiers/:id`                 | `menu:write` | Change a modifier, or deactivate or activate it                  |
| GET    | `/combos`                        | `menu:read`  | Combos with their choices                                        |
| POST   | `/combos`                        | `menu:write` | Create a combo                                                   |
| GET    | `/combos/:id`                    | `menu:read`  | One combo                                                        |
| PATCH  | `/combos/:id`                    | `menu:write` | Change a combo; choices that are sent replace all its choices    |

- Lists of items use cursor pages (`{ data, nextCursor }`). The other lists are short and have no pages.
- A problem is a code in `details[].message` and the path of the field in `details[].path`, for example `name.ar` with `NAME_REQUIRED`, `basePrice` with `PRICE_INVALID` or `slots.0.options.1.itemId` with `OPTION_DUPLICATE`. The screens turn the code into a sentence in the current language.

## Acceptance criteria

1. **Given** an item with only an English name, **when** it is saved, **then** the answer is `VALIDATION_ERROR`.
2. **Given** a base price of 20.000 and a branch price of 22.500, **when** the terminal of that branch loads the menu, **then** it shows 22.500, and other branches show 20.000.
3. **Given** an item switched off for one branch, **when** that branch loads the menu, **then** the item is not in it, and it is still in the other branches.
4. **Given** an item that has been ordered, **when** a manager removes it, **then** it is deactivated and old orders still show its name and price. _Today:_ there is no way to delete, only to deactivate, and the row keeps its name and price. Copying the name and price onto an order is for the orders module.
5. **Given** a modifier group with a minimum of 1, **when** the cashier adds the item without a choice, **then** the POS asks for one. _Today:_ the menu carries `minSelect` and `maxSelect` for every group. The asking is for the POS terminal (Phase 2).
6. **Given** the Arabic search "بيتزا", **when** items are searched, **then** items with that word in the Arabic name are found.
7. **Given** a menu with 500 items, **when** a terminal loads it a second time, **then** it is answered from the cache in under one second.

Criteria 1, 2, 3, 6 and 7 are covered by automated tests in `apps/api/src/modules/menu`, and the rules for prices, search, schedules and requests in `packages/shared`. The demo menus are loaded through the real endpoint by `apps/api/test/demo-menu.test.ts`. What a person sees is covered by tests in `apps/web/src/features/menu`, and was checked in a real browser in both languages, at desktop and phone width.

## Demo data

`npm run db:seed` gives each demo brand a menu: Pizza Palace has 10 dishes in 4 categories and 2 combos, and Burger Hub has 9 dishes in 3 categories and 1 combo. Dishes have sizes and extras (a required size with a price change below zero for the small one, up to three toppings), the Mall and Downtown branches price pizzas differently, Downtown does not sell the dessert (so its category is not in the menu there), the salad at the Mall is for lunch from Sunday to Thursday, the Airport branch has higher prices, and the milkshake at the Corniche branch is sold from 14:00 until 02:00.

## Not in this version

- Uploading images (see the questions). An item has an image link.
- A Redis cache. The cache is in memory (rule 8).
- A price of a combo per branch. A combo has one price for the brand, and a branch cannot switch a combo off.
- A manual order of the items inside a category. They are in the order of their English names. Categories, modifier groups and modifiers have an order (categories can be dragged; groups and modifiers keep the order they were added in).
- Allergens, calories, a barcode or a SKU.
- Importing a menu from a spreadsheet.

## Open questions

1. Image upload needs object storage, which is not chosen yet.
2. Do items need allergens, calories or a barcode or SKU?
3. Should one item be allowed in several categories?
4. The client probably has menus in spreadsheets today. Should we build an import from CSV or Excel, and what is the format?
5. Is tax shown as part of the price, or added at checkout? This decides the receipt layout.
6. The first version of this spec asked for Redis. Is a cache in the memory of one API process enough for now, or should the Redis version be built before the staging environment? It needs Redis in CI and in the developers' Docker setup.
7. Should a combo be switchable, or priced differently, per branch?
8. Should the items of a category have an order that a manager sets, instead of the order of their English names?
9. A cashier or a kitchen account can open the menu area of the web app, because they have `menu:read`. Should the Menu link be only for people who manage the menu?
