# Spec 004: Menu management

**Status:** Draft for review. This is module 03 of the technical proposal. It needs the brand and branch screens (spec 002) first.

## Goal

A brand manager builds the menu of a brand once, in English and Arabic. Each branch can then change the price of an item, switch it off, or limit it to certain times, without copying the menu. The POS terminal loads the menu of its branch in under a second.

## What is stored

The menu belongs to a **brand**. A **branch** only stores differences.

| Thing           | Belongs to      | Main fields                                                                    |
| --------------- | --------------- | ------------------------------------------------------------------------------ |
| Category        | Brand           | Name (English and Arabic), sort order, active                                  |
| Item            | Brand           | Name and description (English and Arabic), category, base price, image, active |
| Modifier group  | Item            | Name, minimum and maximum choices (a minimum of 1 makes it required)           |
| Modifier        | Group           | Name, price change (can be 0 or negative)                                      |
| Combo           | Brand           | Name, price, the items and choices it contains                                 |
| Branch override | Item and branch | Price for this branch, available or not, days and times it is available        |

**Prices** have 3 decimal places and are sent as text (`"12.500"`), never as floating-point numbers. Currency is SAR for now. A price that includes tax versus one that does not is a later decision; the database already has the columns.

## Rules

1. Every name needs both languages.
2. An item is in exactly one category.
3. A branch override can change the price, switch the item off, or set when it is available. It never changes the name or the modifiers.
4. An item or category that has been ordered is **deactivated**, never deleted, so old orders keep their names and prices. Prices are copied onto an order when it is placed, so a later price change never alters it.
5. Searching works in both languages: typing in Arabic finds Arabic names and typing in English finds English names. Arabic search ignores diacritics and treats the different forms of alef as one.
6. The menu of a branch is cached in Redis and the cache is cleared when anything in it changes. A change shows on terminals within a few seconds.
7. Every create, change and deactivation is written to the audit log.

## Screens

- **Categories:** a list that can be re-ordered by dragging.
- **Items:** a list with search and filters by category and status. The form has three tabs: details, pricing per branch, and modifiers.
- **Combos:** a builder that picks items and fixes the combo price.
- **Branch menu preview:** shows the menu exactly as a branch terminal will load it.

## API

| Method | Path                                     | Permission   | Description                                      |
| ------ | ---------------------------------------- | ------------ | ------------------------------------------------ |
| GET    | `/api/v1/menu/categories`                | `menu:read`  | Categories with bilingual names                  |
| POST   | `/api/v1/menu/items`                     | `menu:write` | Create an item with English and Arabic names     |
| PUT    | `/api/v1/menu/items/:id/branch-override` | `menu:write` | Set a branch price, availability or schedule     |
| GET    | `/api/v1/menu?branchId=`                 | `menu:read`  | The full menu of one branch, as the POS loads it |

Create, change and deactivate routes for categories, items, modifiers and combos follow the same pattern.

## Acceptance criteria

1. **Given** an item with only an English name, **when** it is saved, **then** the answer is `VALIDATION_ERROR`.
2. **Given** a base price of 20.000 and a branch price of 22.500, **when** the terminal of that branch loads the menu, **then** it shows 22.500, and other branches show 20.000.
3. **Given** an item switched off for one branch, **when** that branch loads the menu, **then** the item is not in it, and it is still in the other branches.
4. **Given** an item that has been ordered, **when** a manager removes it, **then** it is deactivated and old orders still show its name and price.
5. **Given** a modifier group with a minimum of 1, **when** the cashier adds the item without a choice, **then** the POS asks for one.
6. **Given** the Arabic search "بيتزا", **when** items are searched, **then** items with that word in the Arabic name are found.
7. **Given** a menu with 500 items, **when** a terminal loads it a second time, **then** it is answered from the cache in under one second.

## Open questions

1. Image upload needs object storage, which is not chosen yet.
2. Do items need allergens, calories or a barcode or SKU?
3. Should one item be allowed in several categories?
4. The client probably has menus in spreadsheets today. Should we build an import from CSV or Excel, and what is the format?
5. Is tax shown as part of the price, or added at checkout? This decides the receipt layout.
