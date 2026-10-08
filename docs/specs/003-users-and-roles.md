# Spec 003: Users and roles

**Status:** Draft for review. This is module 02 of the technical proposal. Signing in and the built-in roles already work (spec 001). This spec covers managing the people.

## Goal

A manager adds staff, gives them a role and branches, sets their password or PIN, unlocks them when they are locked out, and can see who did what.

## Who can do what

| Action                           | Group Admin | Brand Manager (own brand) | Branch Manager (own branches) |
| -------------------------------- | :---------: | :-----------------------: | :---------------------------: |
| See users                        |      x      |             x             |               x               |
| Create, change, deactivate users |      x      |             x             |                               |
| Set or reset a password or PIN   |      x      |             x             |                               |
| Unlock a locked account          |      x      |             x             |                               |
| See the audit log                |      x      |             x             |                               |

A brand manager can only create users inside their own brand, with a brand-level or branch-level role. Nobody below the group admin can create a group admin. A person cannot change their own role.

## Rules

1. **Email** is optional. It is stored in lower case and must be unique across the system.
2. **Staff code** is unique inside a brand. It is how branch staff identify themselves at a terminal.
3. **Password:** at least 10 characters, at most 128. **PIN:** 4 to 6 digits, and not all the same digit or a straight run such as 1234. A user may have a password, a PIN or both.
4. Setting or resetting a password or PIN does not show the old value. The new value is shown once to the manager who set it, and is never stored in readable form.
5. A branch-scoped user needs at least one branch. A brand-scoped user has none. A group admin has no brand.
6. **Deactivating** a user ends all of their sessions at once and keeps their history. Users are never deleted.
7. **Unlocking** clears the failed-attempt count and the lock. Only the lock is lifted: a new password or PIN is not required.
8. Every create, change, reset, unlock and deactivation is written to the audit log.

## Screens

- **Users:** a list with filters for role, branch and status (active, inactive, locked), and search by name, email or staff code.
- **User form:** name, email, staff code, role, branches, language, active.
- **Reset password or PIN:** a dialog that sets a new value.
- **Audit log:** a table of events with filters for user, branch, action and date range.

## API

| Method | Path                            | Permission    | Description                                    |
| ------ | ------------------------------- | ------------- | ---------------------------------------------- |
| GET    | `/api/v1/users`                 | `users:read`  | List users the person can see                  |
| POST   | `/api/v1/users`                 | `users:write` | Create a user                                  |
| PATCH  | `/api/v1/users/:id`             | `users:write` | Change a user, or deactivate them              |
| POST   | `/api/v1/users/:id/credentials` | `users:write` | Set a new password or PIN                      |
| POST   | `/api/v1/users/:id/unlock`      | `users:write` | Unlock an account                              |
| GET    | `/api/v1/roles`                 | `roles:read`  | List the built-in roles and their scopes       |
| GET    | `/api/v1/audit-logs`            | `audit:read`  | Audit events the person can see (cursor pages) |

## Acceptance criteria

1. **Given** a brand manager, **when** they create a cashier with a staff code already used in their brand, **then** the answer is a conflict error and nothing is created.
2. **Given** a brand manager, **when** they try to create a group admin, **then** the answer is `FORBIDDEN`.
3. **Given** a PIN of `1234` or `1111`, **when** it is set, **then** it is refused.
4. **Given** a locked cashier, **when** a manager unlocks them, **then** the cashier can sign in straight away and the unlock is in the audit log.
5. **Given** a signed-in cashier, **when** a manager deactivates them, **then** their next token refresh fails and they are signed out within 15 minutes.
6. **Given** a branch manager, **when** they list users, **then** they see users but have no create or edit actions.
7. **Given** a brand manager of Pizza Palace, **when** they open the audit log, **then** they see no events of Burger Hub.

## Open questions

1. Should people be able to change their own password, and should there be a "forgot password" email? That needs an email provider, which is not chosen yet.
2. Should group admins and brand managers use a second factor?
3. Should a new password or PIN have to be changed at the first sign-in?
4. The proposal mentions a permission matrix. Should brands be able to create their own roles and edit permissions, or are the seven built-in roles enough for launch?
5. A branch manager can see users today. Should they only see users who share one of their branches?
