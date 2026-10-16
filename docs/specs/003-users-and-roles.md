# Spec 003: Users and roles

**Status:** Built, API and web. This is module 02 of the technical proposal. Signing in and the built-in roles came with spec 001. This spec covers managing the people. Where building it meant a decision, the decision is in the rules below.

## Goal

A manager adds staff, gives them a role and branches, sets their password or PIN, unlocks them when they are locked out, and can see who did what.

## Who can do what

| Action                           | Group Admin | Brand Manager (own brand) | Branch Manager (own branches) |
| -------------------------------- | :---------: | :-----------------------: | :---------------------------: |
| See users                        |      x      |             x             |               x               |
| Create, change, deactivate users |      x      |             x             |                               |
| Set or reset a password or PIN   |      x      |             x             |                               |
| Unlock a locked account          |      x      |             x             |                               |
| See the roles                    |      x      |             x             |                               |
| See the audit log                |      x      |             x             |                               |

A brand manager can only create users inside their own brand, with a brand-level or branch-level role. Nobody below the group admin can create a group admin. A person cannot change their own role or deactivate themselves.

A branch manager sees only the people who work at one of their own branches. They have no create or edit actions.

## Rules

1. **Email** is optional. It is stored in lower case and must be unique across the system.
2. **Staff code** is unique inside a brand. It is how branch staff identify themselves at a terminal.
3. **Password:** at least 10 characters, at most 128. **PIN:** 4 to 6 digits, and not all the same digit or a straight run such as 1234. A user may have a password, a PIN or both.
4. Setting or resetting a password or PIN does not show the old value. If the manager types the new value, nothing is sent back. If they leave it empty, the server makes one and returns it once: a PIN of 6 digits that follows the PIN rules, or a password of 16 letters and digits without look-alike characters such as 0 and O. Values are never stored in readable form.
5. A branch-scoped user needs at least one branch, and every branch must belong to the person's brand. A brand-scoped user has none. A group admin has no brand.
6. **Deactivating** a user, or giving them a new password or PIN, ends all of their sessions at once. Their history is kept. Users are never deleted.
7. **Unlocking** clears the failed-attempt count and the lock. Only the lock is lifted: a new password or PIN is not required.
8. Every create, change, reset, unlock and deactivation is written to the audit log. A secret is never written to it.
9. A password can only be set for a person with an email. A PIN can only be set for a person with a staff code and a branch-level role.
10. Create and change requests refuse any field the API does not know, so nothing can be slipped in.

## Screens

- **Users:** a list with filters for role and status (active, inactive, locked), and search by name, email or staff code. Names open the user form for people who may change users. The list loads more with a button, not all at once.
- **User form:** name, email, staff code, role, branches, language. A group admin who creates someone also chooses the brand; for everybody else the brand is fixed. A first password or PIN can be given when creating, and is optional.
- **On the edit page:** the state of the account (active, inactive, or locked until a time), buttons to deactivate or activate and to unlock, a link to that person's activity in the audit log, and a panel to set a password or PIN. The panel shows a value the server made once, with a copy button.
- **Roles:** the permission matrix. Each role is a column and each permission is a row. The built-in roles are fixed.
- **Audit log:** events newest first, with filters for action and a range of days. A link from the user page filters it to one person. The person shown is the one who did the action; who it was done to is in the details, which stay folded until asked.

All screens are in English and Arabic. The menu shows a link only when the person has its permission, and a page opened without the permission says so and asks the server for nothing.

## API

| Method | Path                            | Permission    | Description                                          |
| ------ | ------------------------------- | ------------- | ---------------------------------------------------- |
| GET    | `/api/v1/users`                 | `users:read`  | List users the person can see (cursor pages)         |
| GET    | `/api/v1/users/:id`             | `users:read`  | One user                                             |
| POST   | `/api/v1/users`                 | `users:write` | Create a user                                        |
| PATCH  | `/api/v1/users/:id`             | `users:write` | Change a user, or deactivate or activate them        |
| POST   | `/api/v1/users/:id/credentials` | `users:write` | Set a new password or PIN, or make one and return it |
| POST   | `/api/v1/users/:id/unlock`      | `users:write` | Unlock an account                                    |
| GET    | `/api/v1/roles`                 | `roles:read`  | The built-in roles with permissions and `assignable` |
| GET    | `/api/v1/audit-logs`            | `audit:read`  | Audit events the person can see (cursor pages)       |

- The users list takes `role`, `status`, `q` (search), `branchId`, and for a group admin `brandId`, plus `cursor` and `limit`. The audit log takes `userId`, `branchId`, `action`, `from`, `to`, plus `cursor` and `limit`.
- Pages are `{ data, nextCursor }`. The roles list is `{ data }`. `assignable` says whether the person asking may give that role.
- A user is shown without a password, a PIN or their hashes. It has `hasPassword` and `hasPin` instead.
- Problems use the standard error body. A field problem is a code in `details[].message` that the web app turns into a sentence in the current language. Taken emails and staff codes are `409` with `EMAIL_TAKEN` and `STAFF_CODE_TAKEN`.

## Acceptance criteria

1. **Given** a brand manager, **when** they create a cashier with a staff code already used in their brand, **then** the answer is a conflict error and nothing is created.
2. **Given** a brand manager, **when** they try to create a group admin, **then** the answer is `FORBIDDEN`.
3. **Given** a PIN of `1234` or `1111`, **when** it is set, **then** it is refused.
4. **Given** a locked cashier, **when** a manager unlocks them, **then** the cashier can sign in straight away and the unlock is in the audit log.
5. **Given** a signed-in cashier, **when** a manager deactivates them, **then** their next token refresh fails and they are signed out within 15 minutes.
6. **Given** a branch manager, **when** they list users, **then** they see only users at their branches and have no create or edit actions.
7. **Given** a brand manager of Pizza Palace, **when** they open the audit log, **then** they see no events of Burger Hub.

Each one is covered by an automated test: the API tests in `apps/api/src/modules` (users, roles and audit) and the PIN rules in `packages/shared`. What a person sees is covered by tests in `apps/web/src/features`, and was checked in a real browser in both languages, at desktop and phone width.

## Not in this version

- A branch filter on the users list and on the audit log screen. The API already supports it.
- A column in the audit table for who an event was about.
- Changing your own password.

## Open questions

1. ~~Should people be able to change their own password, and should there be a "forgot password" email?~~ Answered 16 October 2026: a person changes their own password at any time (`POST /auth/password`, the "Change password" link); every other session of theirs ends. A "forgot password" email waits for the email setup.
2. Should group admins and brand managers use a second factor?
3. ~~Should a new password or PIN have to be changed at the first sign-in?~~ Answered 16 October 2026: a password a manager gave (at creation or at a reset) must be changed at the first sign-in, except for the owner (group admin); PINs are not changed by the cashier.
4. The proposal mentions a permission matrix. Should brands be able to create their own roles and edit permissions, or are the seven built-in roles enough for launch?
