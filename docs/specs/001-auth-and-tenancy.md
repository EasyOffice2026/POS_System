# Spec 001: Sign-in and tenant scoping

**Status:** Draft for review. Covers the Week 2 build: database schema, sign-in, tokens and data isolation between brands and branches.

## Goal

Staff sign in with an email and password, or with a staff code and PIN at a branch terminal. After that, every request is limited to the brand and branches the person may see. The limit is enforced in the API and in the database client, not only in the screens.

## Roles and scopes

Each role has one scope. The scope decides which data a person can see.

| Role           | Scope  | Sees                               |
| -------------- | ------ | ---------------------------------- |
| Group Admin    | Group  | Every brand and every branch       |
| Brand Manager  | Brand  | One brand and all of its branches  |
| Marketing      | Brand  | One brand and all of its branches  |
| Branch Manager | Branch | Only the branches assigned to them |
| Cashier        | Branch | Only the branches assigned to them |
| Kitchen        | Branch | Only the branches assigned to them |
| Purchaser      | Branch | Only the branches assigned to them |

A Group Admin has no brand. Every other user belongs to exactly one brand. Branch-scoped users also have one or more branch assignments.

## Permissions

Permissions are strings in the form `module:action`. The API checks them on every route. This is the starting set; later phases add their own.

| Permission       | Group Admin | Brand Manager | Marketing | Branch Manager | Cashier | Kitchen | Purchaser |
| ---------------- | :---------: | :-----------: | :-------: | :------------: | :-----: | :-----: | :-------: |
| `brands:read`    |      x      |       x       |     x     |                |         |         |           |
| `brands:write`   |      x      |               |           |                |         |         |           |
| `branches:read`  |      x      |       x       |     x     |       x        |         |         |     x     |
| `branches:write` |      x      |       x       |           |                |         |         |           |
| `users:read`     |      x      |       x       |           |       x        |         |         |           |
| `users:write`    |      x      |       x       |           |                |         |         |           |
| `roles:read`     |      x      |       x       |           |                |         |         |           |
| `menu:read`      |      x      |       x       |     x     |       x        |    x    |    x    |     x     |
| `menu:write`     |      x      |       x       |           |                |         |         |           |
| `audit:read`     |      x      |       x       |           |                |         |         |           |

This matrix is a draft default. The product owner confirms it before the Users and roles module is built.

## Signing in

One endpoint, two methods: `POST /api/v1/auth/login`.

- **Password:** `{ "type": "password", "email": "...", "password": "..." }`
- **PIN:** `{ "type": "pin", "branchId": "...", "staffCode": "...", "pin": "1234" }`

The terminal knows its own branch. The cashier enters a staff code and a PIN of 4 to 6 digits. Only branch-scoped roles that are assigned to that branch can use a PIN. A PIN session is limited to that one branch. At a branch that is not active, or whose brand is not active, the answer is `403 BRANCH_INACTIVE` before any PIN is looked at, so the terminal can show a message and no failed attempt is counted. A PIN session also ends at its next token refresh when its branch or brand is deactivated. People who sign in with a password are not affected.

Wrong credentials always return the same `INVALID_CREDENTIALS` error. This holds whether the account exists or not, and the response takes about the same time in both cases, so nobody can use it to find out which accounts exist.

Passwords and PINs are stored as scrypt hashes with a random salt each, using Node's built-in implementation (N=2^15, r=8, p=3, the OWASP recommendation). The technical proposal says bcrypt. scrypt was chosen instead because it needs no native package, runs off the main thread, and is memory-hard. The parameters are stored inside each hash, so they can be raised later without breaking old hashes.

A PIN has few possible values, so anyone who steals a copy of the database could guess PINs offline whatever the hash. Lockout protects against online guessing only. A server-side secret mixed into PIN hashes would close this gap and can be added later.

## Tokens

- **Access token:** a signed JWT (HS256) that expires after 15 minutes. It is sent as `Authorization: Bearer ...` and kept in memory by the web app. Claims: user id, role, scope, brand id, branch ids and permissions.
- **Refresh token:** a random 256-bit value in an `httpOnly` cookie named `pos_refresh`. It is `SameSite=Strict`, `Secure` in production, limited to the path `/api/v1/auth`, and valid for 7 days. Only its SHA-256 hash is stored in the database.
- **Rotation:** every refresh invalidates the old token and issues a new one in the same family.
- **Reuse detection:** if an already-used token is presented again, the whole family is revoked and the person has to sign in again.
- **Sign out** revokes the family and clears the cookie.
- Claims are rebuilt from the database at every refresh, so a role change reaches the person within 15 minutes.

The cookie design assumes the web app and the API share one site (the same domain). Hosting is still undecided, so this is an assumption to confirm.

## Lockout and rate limits

- After 5 failed attempts in a row the account is locked. Every further 5 failures lock it again for twice as long: 15 minutes, 30 minutes, 1 hour, and so on up to 24 hours. A successful sign-in resets the count.
- A locked account returns `429 ACCOUNT_LOCKED` with a `Retry-After` header. The password is not checked while the account is locked.
- The escalation matters because a PIN has only 10,000 to 1,000,000 possible values. A fixed 15-minute lock would still allow hundreds of guesses a day.
- Sign-in endpoints also limit each IP address to 30 failed requests per 15 minutes.

## Audit log

These events are written to the audit log with the user, brand, branch, IP address and browser: `auth.login.success`, `auth.login.failed`, `auth.login.locked` (the moment an account is locked), `auth.login.blocked` (an attempt refused because the account is locked), `auth.logout`, `auth.refresh.reuse_detected`. Passwords and PINs are never written to the log. Audit rows are never updated or deleted.

## Tenant scoping

All data access in request handlers goes through a scoped database client built from the person's access token.

- A **Brand** user only sees rows with their `brandId`. A **Branch** user also only sees rows for their assigned branches. A **Group** user is not filtered.
- The filter is combined with the query by `AND`, so a request cannot override it by passing a different `brandId`.
- Creating a row for another brand is refused.
- A model that has not been given scoping rules is refused. A new table cannot be reached by accident.
- Loading related rows (`include`, nested `select`) and nested writes are refused on the scoped client. Handlers query each model separately.
- Raw SQL is refused on the scoped client.
- The unscoped client is only used for sign-in, token handling and audit writes.

## API

| Method | Path                          | Permission      | Description                                         |
| ------ | ----------------------------- | --------------- | --------------------------------------------------- |
| POST   | `/api/v1/auth/login`          | none            | Sign in, returns an access token and the user       |
| POST   | `/api/v1/auth/refresh`        | refresh cookie  | Rotate the refresh token, return a new access token |
| POST   | `/api/v1/auth/logout`         | refresh cookie  | Revoke the session                                  |
| GET    | `/api/v1/auth/me`             | signed in       | The current user with role and permissions          |
| GET    | `/api/v1/brands`              | `brands:read`   | Brands the person can see (cursor pages)            |
| GET    | `/api/v1/brands/:id/branches` | `branches:read` | Branches of a brand (cursor pages)                  |

List endpoints take `?limit=` (1 to 100, default 50) and `?cursor=` and return `{ "data": [...], "nextCursor": "..." | null }`.

Errors use the standard body `{ "error": { "code", "message", "details" } }`. Codes: `VALIDATION_ERROR` (400), `INVALID_JSON` (400), `INVALID_CREDENTIALS` (401), `UNAUTHENTICATED` (401), `TOKEN_EXPIRED` (401), `INVALID_REFRESH_TOKEN` (401), `FORBIDDEN` (403), `BRANCH_INACTIVE` (403), `NOT_FOUND` (404), `PAYLOAD_TOO_LARGE` (413), `ACCOUNT_LOCKED` (429), `RATE_LIMITED` (429), `INTERNAL_ERROR` (500).

## Acceptance criteria

1. **Given** a Cashier at Pizza Palace, **when** they sign in with the right staff code and PIN at their branch, **then** they get an access token limited to that branch.
2. **Given** a wrong PIN, **when** the cashier tries 5 times in a row, **then** the sixth attempt returns `ACCOUNT_LOCKED` even with the right PIN.
3. **Given** an email that does not exist, **when** someone signs in, **then** the answer is the same `INVALID_CREDENTIALS` as for a wrong password.
4. **Given** a refresh token that was already used, **when** it is sent again, **then** the request is refused and the newer token from the same session stops working too.
5. **Given** a Brand Manager of Pizza Palace, **when** they list brands, **then** they see only Pizza Palace.
6. **Given** a Brand Manager of Pizza Palace, **when** they ask for the branches of Burger Hub, **then** the answer is `NOT_FOUND`.
7. **Given** a Group Admin, **when** they list brands, **then** they see every brand.
8. **Given** a Cashier, **when** they call a route that needs `brands:read`, **then** the answer is `FORBIDDEN`.
9. **Given** a scoped database client for one brand, **when** code tries to read, change, delete or create rows of another brand, **then** it gets nothing and nothing changes.

## Open questions

1. Is a time-boxed lock with escalation acceptable, or should a locked PIN stay locked until a manager unlocks it? An unlock action arrives with the Users and roles module.
2. Should Marketing be a group-level role, since loyalty points are shared across brands?
3. Confirm the permission matrix above.
4. Should a POS terminal keep a session for 7 days, or end it with the shift?
5. How does a terminal learn its branch? Device pairing is designed in Phase 2. Until then the branch id is entered during setup.
6. If sign-out cannot reach the server, the person is signed out on that device but their refresh cookie stays valid until it expires, and a reload could sign them back in. Is that acceptable on shared terminals, or should a terminal refuse to sign out while offline?
