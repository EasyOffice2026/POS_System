# Spec 002: Brands and branches

**Status:** Draft for review. This is module 01 of the technical proposal. Reading brands and branches already works (spec 001). This spec covers creating and changing them.

## Goal

A group admin sets up the brands of the group. A brand manager sets up the branches of their brand: address, opening hours, printers and time zone. Everything else in the system (menus, staff, orders) hangs off a brand and a branch, so this is the first thing to configure.

## Who can do what

| Action                                   | Group Admin | Brand Manager (own brand) | Branch Manager (own branch) |
| ---------------------------------------- | :---------: | :-----------------------: | :-------------------------: |
| See brands and branches                  |      x      |             x             |         own branch          |
| Create or change a brand                 |      x      |                           |                             |
| Create or change a branch                |      x      |             x             |                             |
| Change branch opening hours and printers |      x      |             x             |                             |

This follows the draft permission matrix in spec 001: `brands:write` for the group admin only, `branches:write` for group admin and brand manager.

## What is stored

**Brand:** name in English and Arabic (both required), logo, settings, active or not.

**Branch:** name in English and Arabic (both required), address, IANA time zone (default `Asia/Riyadh`), active or not, and a configuration with:

- **Opening hours** for each day of the week. A day can be closed, open all day, or have one or more time ranges.
- **Printers:** a name, what it prints (receipts or kitchen tickets), and its network address and port.

The configuration is checked against one shared Zod schema, so the API and the screens agree on its shape.

## Rules

1. A brand or branch is never deleted once it has any data. It is **deactivated**. A deactivated branch cannot be used to sign in with a PIN, and its terminals show a message.
2. Both language names are required. Saving with only one is refused.
3. The time zone must be a real IANA zone name.
4. Opening-hour ranges must not overlap and must end after they start. A range that ends after midnight belongs to the day it started on.
5. Every create, change and deactivation is written to the audit log.

## Screens

- **Brands** (group admin): list, create, edit, deactivate.
- **Branches** (brand manager and group admin): list for a brand, create, edit, deactivate.
- **Branch settings:** tabs for details, opening hours and printers. Names are edited in English and Arabic side by side.

## API

New routes, in addition to the two read routes from spec 001:

| Method | Path                          | Permission       | Description                             |
| ------ | ----------------------------- | ---------------- | --------------------------------------- |
| POST   | `/api/v1/brands`              | `brands:write`   | Create a brand                          |
| PATCH  | `/api/v1/brands/:id`          | `brands:write`   | Change a brand, or deactivate it        |
| POST   | `/api/v1/brands/:id/branches` | `branches:write` | Create a branch                         |
| PATCH  | `/api/v1/branches/:id`        | `branches:write` | Change a branch, its hours and printers |

## Acceptance criteria

1. **Given** a group admin, **when** they create a brand with both names, **then** it appears in the brand list and in the audit log.
2. **Given** a brand name with only an English value, **when** it is saved, **then** the answer is `VALIDATION_ERROR`.
3. **Given** a brand manager of Pizza Palace, **when** they create a branch for Burger Hub, **then** the answer is `NOT_FOUND`.
4. **Given** a brand manager, **when** they create a brand, **then** the answer is `FORBIDDEN`.
5. **Given** a branch with opening hours that overlap, **when** they are saved, **then** the answer is `VALIDATION_ERROR` and names the day.
6. **Given** a branch with staff and orders, **when** a manager deactivates it, **then** all history stays and PIN sign-in at that branch is refused.

## Open questions

1. Logo upload needs object storage, which is not chosen yet. Until then a logo can only be a link.
2. Is the currency a setting of the brand or of the branch? The proposal assumes SAR.
3. Does a branch need opening-hour exceptions such as holidays and Ramadan hours?
4. Can one branch have several receipt printers (for example one per cash desk)?
