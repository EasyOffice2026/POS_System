# Spec 002: Brands and branches

**Status:** Built, API and web. This is module 01 of the technical proposal. Reading brands and branches came with spec 001. This spec covers creating and changing them. Where building it meant a decision, the decision is in the rules below.

## Goal

A group admin sets up the brands of the group. A brand manager sets up the branches of their brand: address, opening hours, printers and time zone. Everything else in the system (menus, staff, orders) hangs off a brand and a branch, so this is the first thing to configure.

## Who can do what

| Action                                   | Group Admin | Brand Manager (own brand) | Branch Manager (own branch) |
| ---------------------------------------- | :---------: | :-----------------------: | :-------------------------: |
| See brands and branches                  |      x      |             x             |         own branch          |
| Create or change a brand                 |      x      |                           |                             |
| Create or change a branch                |      x      |             x             |                             |
| Change branch opening hours and printers |      x      |             x             |                             |

This follows the permission matrix in spec 001: `brands:write` for the group admin only, `branches:write` for group admin and brand manager. A branch manager sees the settings of their own branch, with nothing to change.

## What is stored

**Brand:** name in English and Arabic (both required), a logo link, settings, active or not. Settings stay empty for now: the first ones (such as the currency) come with the module that needs them.

**Branch:** name in English and Arabic (both required), address, IANA time zone (default `Asia/Riyadh`), active or not, and a configuration with opening hours and printers.

The configuration is checked against one shared Zod schema (`packages/shared/src/branch-config.ts`), so the API and the screens agree on its shape:

```json
{
  "openingHours": {
    "sunday": { "kind": "ranges", "ranges": [{ "open": "10:00", "close": "23:00" }] },
    "monday": { "kind": "closed" },
    "tuesday": { "kind": "all_day" },
    "friday": { "kind": "ranges", "ranges": [{ "open": "14:00", "close": "01:00" }] }
  },
  "printers": [
    { "id": "…", "name": "Cash desk", "kind": "receipt", "host": "192.168.10.50", "port": 9100 }
  ]
}
```

All seven days are always there (the example shows four). A day is `closed`, `all_day` or `ranges`. A branch that was never set up reads as closed all week with no printers.

## Rules

1. A brand or branch is never deleted. It is **deactivated**, and everything stays: people, history and audit rows. A brand or branch can also be created inactive, to be set up before it opens.
2. At a deactivated branch, or a branch of a deactivated brand, a PIN sign-in answers `403 BRANCH_INACTIVE` before any PIN is looked at, so the terminal can show a message and nobody collects failed attempts. A PIN session there ends at its next token refresh, within 15 minutes. People who sign in with a password are not affected, so a manager can still reach an inactive brand and activate it again.
3. Both language names are required. A blank name counts as missing. A name has at most 100 characters. A request that changes a name sends both.
4. The time zone must be a real IANA name such as `Asia/Riyadh` or `UTC`. An offset such as `+03:00` is refused.
5. **Opening hours.** Times are `HH:MM` on a 24-hour clock. A range ends after it starts, but it may end after midnight: `18:00` to `02:00` is eight hours and belongs to the day it started on. The same time twice is refused (a whole day has its own setting, `all_day`). A day has at most 6 ranges. Ranges must not overlap, also across midnight and from Saturday night into Sunday morning. The problem names the day, and when ranges of two days meet it names the day that starts later. The server keeps the ranges of a day in the order of the clock.
6. **Printers.** A name (1 to 60 characters, unique in the branch whatever the capital letters), a kind (`receipt` or `kitchen`), a network address and a port (1 to 65535, `9100` when left out). The address is an IPv4 or IPv6 address or a host name, never a link and never with a port. A branch has at most 20 printers and may have several of each kind, for example one receipt printer per cash desk. A printer gets an id when it is added, and keeps it when it is sent back, so later modules can point at it.
7. A **logo** is a web link (`http` or `https`, at most 2048 characters, no user name or password in it) until files can be stored.
8. A change that leaves out a part of the configuration leaves that part as it is, and a part of the configuration that this module does not know about is kept. A change that changes nothing writes nothing, not even an audit row.
9. Every create, change and deactivation is written to the audit log: `brand.created`, `brand.updated`, `branch.created` and `branch.updated`, with the names of what changed and, for a change of state, the new state.
10. Requests refuse fields the API does not know. A branch cannot be moved to another brand, and its brand is the one in the address.

## Screens

- **Brands:** a list with each name, the name in the other language under it, and the state; a form with both names side by side, a logo link and (when creating) a choice to start inactive; deactivate and activate. Only a group admin sees the form. A brand manager sees their own brand in the list.
- **Branches:** a list for one brand or all, with a brand filter for people who manage several; add a branch; open one. A group admin who adds a branch chooses the brand; for others it is their own.
- **Branch settings:** three tabs that the address remembers (`?tab=hours`): **Details** (names in English and Arabic side by side, address, time zone, and the state), **Opening hours** (each day closed, open 24 hours or specific ranges, with a way to copy a day to all days) and **Printers**. Every problem shows on the day, the range or the printer that has it. A person without `branches:write` sees the same tabs with every field switched off.

Brands and branches that are not active are marked in the lists, the dashboard and the user form.

## API

New routes, in addition to the two read routes from spec 001:

| Method | Path                          | Permission       | Description                                  |
| ------ | ----------------------------- | ---------------- | -------------------------------------------- |
| GET    | `/api/v1/brands/:id`          | `brands:read`    | One brand                                    |
| POST   | `/api/v1/brands`              | `brands:write`   | Create a brand                               |
| PATCH  | `/api/v1/brands/:id`          | `brands:write`   | Change a brand, or deactivate or activate it |
| POST   | `/api/v1/brands/:id/branches` | `branches:write` | Create a branch, with its configuration      |
| GET    | `/api/v1/branches/:id`        | `branches:read`  | One branch with its configuration            |
| PATCH  | `/api/v1/branches/:id`        | `branches:write` | Change a branch, its hours and its printers  |

- A brand or branch that the person cannot see is answered like one that does not exist (`NOT_FOUND`).
- The list of branches stays light and has no configuration. One branch has it.
- A problem is a code in `details[].message` and the path of the field in `details[].path`, for example `config.openingHours.monday` with `HOURS_OVERLAP`, or `name.ar` with `NAME_REQUIRED`.

## Acceptance criteria

1. **Given** a group admin, **when** they create a brand with both names, **then** it appears in the brand list and in the audit log.
2. **Given** a brand name with only an English value, **when** it is saved, **then** the answer is `VALIDATION_ERROR`.
3. **Given** a brand manager of Pizza Palace, **when** they create a branch for Burger Hub, **then** the answer is `NOT_FOUND`.
4. **Given** a brand manager, **when** they create a brand, **then** the answer is `FORBIDDEN`.
5. **Given** a branch with opening hours that overlap, **when** they are saved, **then** the answer is `VALIDATION_ERROR` and names the day.
6. **Given** a branch with staff and orders, **when** a manager deactivates it, **then** all history stays and PIN sign-in at that branch is refused.
7. **Given** a brand that is deactivated, **when** staff sign in with a PIN at one of its branches, **then** it is refused in the same way.

Each one is covered by an automated test: the API tests in `apps/api/src/modules/brands` and `apps/api/src/modules/auth`, and the rules for hours, printers and names in `packages/shared`. What a person sees is covered by tests in `apps/web/src/features`, and was checked in a real browser in both languages, at desktop and phone width.

## Not in this version

- Opening-hour exceptions such as holidays and Ramadan hours (see the questions).
- Uploading a logo.
- Brand settings. Nothing needs one yet.
- Branch overrides. The plan lists them for this module. What the proposal describes, independent menu prices and availability per branch, belongs to the Menu module (spec 004). A brand setting that a branch could override does not exist yet.

## Open questions

1. Logo upload needs object storage, which is not chosen yet. Until then a logo can only be a link.
2. Is the currency a setting of the brand or of the branch? The proposal assumes SAR.
3. Does a branch need opening-hour exceptions such as holidays and Ramadan hours?
4. Should people of a deactivated brand still be able to sign in with a password? Today they can, so a manager can reach the brand and activate it again. Only PIN sign-in at its branches stops.
5. The plan lists "branch overrides" for this module. Is anything meant besides per-branch menu prices and availability?
