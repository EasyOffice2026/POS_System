# Multi-Brand F&B POS System

A web-based point of sale and operations platform for restaurant groups that run several brands across many branches. It covers orders, kitchen display, inventory, recipes, purchasing, customer loyalty and reporting, in Arabic (RTL) and English (LTR).

**Status:** Phase 1 is under way. Sign-in, tenant isolation between brands and branches, the database schema, the web shell (login, dashboard, Arabic/English), user administration (users, roles, audit log), the setup of brands and branches (opening hours, printers) and the bilingual menu (categories, items with modifiers, prices and times per branch, combos, and the menu a branch terminal loads) are built. Phase 2 has started: the orders API is built ([spec 005](docs/specs/005-orders.md)): open an order, add dishes and combos at the branch price, send them to the kitchen, and void lines or give a discount with a manager's staff code and PIN. The POS terminal screen is built too ([spec 006](docs/specs/006-pos-terminal.md)): a manager sets up a terminal for a branch once, cashiers sign in there with a staff code and PIN, take orders on a touch screen, send them to the kitchen, and a manager approves voids and discounts on the same screen. Payments and the other product features are not built yet.

## What the system will do

- **Multi-brand and multi-branch:** central control for the group, with each branch configured on its own.
- **Order types:** dine-in, takeaway and delivery. Delivery orders sync from Talabat, Deliveroo and Jahez.
- **Kitchen display (KDS):** orders routed to each kitchen station in real time.
- **Inventory and recipes:** stock is deducted automatically when a sale is paid, and food cost is shown per portion.
- **Purchasing:** suppliers, purchase orders, goods received notes and invoice matching.
- **Customer loyalty:** points work across all brands, with Bronze, Silver and Gold tiers and redemption confirmed by an SMS code.
- **Reports:** sales, food cost, stock variance and staff, viewable per branch, per brand or for the whole group.
- **Offline mode:** the POS keeps taking orders and cash payments when the internet is down.

## Getting started

**You need:** Node.js 24 (the version in `.nvmrc`, which comes with npm 11) and Docker for the database.

```
npm install
npm run infra:up      # PostgreSQL and Redis in Docker, on localhost only
npm run db:setup      # apply the migrations and add the demo data
npm run dev           # API and web app together
```

Open the web address printed in the terminal (normally http://localhost:5173; Vite picks the next free port if that one is taken) and sign in with one of the demo accounts below.

Everything has a working default, so copying `.env.example` to `.env` is optional. `.env` is never committed.

### Without Docker

If Docker is not installed, you can still try the project with a small PostgreSQL that Prisma runs for you. It is slower than the Docker one and meant for trying things out, not for real work.

```
npm install
npx prisma dev --detach --name pos-dev
```

The second command prints the address of the database, for example `postgres://postgres:postgres@localhost:51214/template1?sslmode=disable`. Make a file named `.env` in the project folder with one line: that address with `&schema=demo` added at the end, so the demo data has a schema of its own.

```
DATABASE_URL=postgres://postgres:postgres@localhost:51214/template1?sslmode=disable&schema=demo
```

Then run `npm run db:setup` and `npm run dev` as above. Redis is not needed yet. `npx prisma dev ls` shows the address again, `npx prisma dev stop pos-dev` stops the database, and `npx prisma dev start pos-dev` starts it again with its data. To run the tests, set the same address in the terminal first, for example in PowerShell: `$env:DATABASE_URL = 'postgres://postgres:postgres@localhost:51214/template1?sslmode=disable'`.

### With a hosted database (Supabase)

The API connects with an ordinary PostgreSQL address, so a hosted PostgreSQL such as Supabase works. The demo seed does not run on it (see the end of this section), so a real database gets its first admin from a command instead.

1. In the Supabase dashboard, open the project and click **Connect**. Copy the **Session pooler** address. It uses port 5432 and works over IPv4. The direct address works only over IPv6 unless the project has the IPv4 add-on, and the transaction pooler (port 6543) is not for migrations.
2. Put it in `.env`, with the password filled in and `?schema=pos&sslmode=require&uselibpqcompat=true` added at the end:

   ```
   DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?schema=pos&sslmode=require&uselibpqcompat=true
   ```

   - A password with special characters must be percent-encoded (`@` is `%40`, `#` is `%23`, `/` is `%2F`). The easy way out is a password of only letters and digits, which can be set under **Project Settings, Database**.
   - `schema=pos` keeps the tables out of the `public` schema, which Supabase publishes through its REST API (the Data API) by default. Keep it, and do not add `pos` to the exposed schemas.
   - `sslmode=require&uselibpqcompat=true` encrypts the connection and does not check the certificate chain, which is how `psql` and Prisma treat `require`. Without `uselibpqcompat=true` the API stops with "self-signed certificate".

3. Create the tables with `npm run db:deploy`. Do not use `db:setup`: its second half is the demo seed.
4. Create the first admin: `npm run admin:create -- --email you@example.com --name "Your Name"`. It prints a password once. Sign in, then set a password of your own under Users.
5. Start with `npm run dev`. If anybody else can reach the API, first put your own `JWT_ACCESS_SECRET` (32 random characters or more) in `.env`.

The demo seed adds accounts with a public password, so it refuses to run against a database on another computer. To add the demo data to a hosted database on purpose, for example a throw-away project for a demonstration, set `SEED_ALLOW_REMOTE=1` for that one command.

### Demo accounts

`npm run db:setup` creates two brands (Pizza Palace and Burger Hub) with two branches each, a menu for each brand, and one account per role. These are for development only. The seed refuses to run when `NODE_ENV` is `production`, and against a database that is not on this computer.

| Email                            | Role           | Sees                      |
| -------------------------------- | -------------- | ------------------------- |
| `admin@pos.local`                | Group Admin    | Every brand and branch    |
| `pizza.manager@pos.local`        | Brand Manager  | Pizza Palace              |
| `burger.manager@pos.local`       | Brand Manager  | Burger Hub                |
| `pizza.marketing@pos.local`      | Marketing      | Pizza Palace              |
| `pizza.mall.manager@pos.local`   | Branch Manager | Pizza Palace, Mall branch |
| `pizza.mall.purchaser@pos.local` | Purchaser      | Pizza Palace, Mall branch |

The password for all of them is `DevPassw0rd!`. Cashiers and kitchen staff sign in at a terminal with a staff code and a PIN instead. To try it, open `/pos`, choose **Set up this terminal**, sign in as `pizza.mall.manager@pos.local` and pick the Mall branch. Then sign in with staff code `1001` and PIN `1234` (the cashier). When a void or a discount needs a manager, type staff code `1003` and PIN `5824` (the Mall manager).

### What you can try

Sign in as `admin@pos.local` and use the menu under the header. Each link shows only when the person has its permission.

| Screen       | What it does                                                                                                                                    | Needs                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Dashboard    | The brands and branches the person can see                                                                                                      | Any signed-in person                         |
| Brands       | The brands of the group: add one, rename it, set a logo link, deactivate or activate it                                                         | `brands:read` (changing: `brands:write`)     |
| Branches     | Branches of one brand or all. Settings in three tabs: details, opening hours, printers                                                          | `branches:read` (changing: `branches:write`) |
| Menu         | Categories (drag to re-order), items with modifiers, prices and times per branch, combos, and a preview of the menu a branch terminal loads     | `menu:read` (changing: `menu:write`)         |
| Users        | Search and filter people, add and change them, deactivate, unlock, set a password or PIN                                                        | `users:read` (changing: `users:write`)       |
| Roles        | What each built-in role may do                                                                                                                  | `roles:read`                                 |
| Audit log    | Who did what, newest first, filtered by action, days or person                                                                                  | `audit:read`                                 |
| POS terminal | The order screen of a branch terminal (`/pos`): PIN sign-in, the menu as tiles, the order with its totals, send to kitchen, voids and discounts | `orders:write`                               |

The demo branches already have opening hours and printers, so open one under Branches to see them: a branch that closes after midnight, one with a lunch break, one that is open all day, and two receipt printers at one branch. Deactivate a branch and a PIN sign-in there stops with a message for the terminal. Sign in as `pizza.manager@pos.local` to see that only Pizza Palace people, branches and events appear. A brand manager can set up the hours and printers of their branches, but cannot create a brand or a group admin. Sign in as `pizza.mall.manager@pos.local` to see a branch manager's view: the people at their own branch, with no way to change them. Open Menu to see the demo menus: Pizza Palace has sizes and extras, a lunch-only salad and a dessert that one branch does not sell; under Branch menu, choose a branch to see its prices and what it leaves out. Search the items in English or Arabic (try مارجريتا). Switch the language with the button in the header to see the screens in Arabic, mirrored right to left.

### Commands

| Command                                                | What it does                                                           |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| `npm run dev`                                          | Start the API and web app together                                     |
| `npm run dev:api`, `dev:web`, `dev:print-bridge`       | Start one service                                                      |
| `npm run infra:up`, `infra:down`, `infra:logs`         | Start, stop or follow PostgreSQL and Redis                             |
| `npm run db:setup`                                     | Apply the migrations and add the demo data                             |
| `npm run db:migrate`                                   | Create a new migration after changing `apps/api/prisma/schema.prisma`  |
| `npm run db:deploy`, `db:seed`, `db:reset`             | Apply migrations, add demo data, or wipe the database and start again  |
| `npm run admin:create -- --email … --name …`           | Create the first admin of a real database (the demo seed is for demos) |
| `npm run check`                                        | Run everything CI runs: format check, lint, typecheck, tests, build    |
| `npm run format`, `lint`, `typecheck`, `test`, `build` | Run a single step                                                      |

The API tests need PostgreSQL, so run `npm run infra:up` first. They use their own schema (`pos_test`) inside the database and apply the real migrations to it, so your development data is never touched.

### Ports

| Service      | Port | Notes                                             |
| ------------ | ---- | ------------------------------------------------- |
| Web app      | 5173 | Forwards `/api` to the API                        |
| API          | 3000 | `API_PORT`. The web app's proxy expects this port |
| Print bridge | 3100 | `PRINT_BRIDGE_PORT`. Listens on 127.0.0.1 only    |
| PostgreSQL   | 5432 | `POSTGRES_PORT`                                   |
| Redis        | 6379 | `REDIS_PORT`                                      |

## Tech stack

| Layer           | Technology                                                                             |
| --------------- | -------------------------------------------------------------------------------------- |
| Frontend        | React 19, TypeScript, Vite 8, React Router 8, TanStack Query, i18next, Tailwind CSS 4  |
| Backend         | Node.js 24 LTS, Express 5, TypeScript, Zod, Prisma 7. Planned: Socket.io, BullMQ       |
| Data            | PostgreSQL 18, Redis 8. S3-compatible object storage is still to be chosen             |
| Sign-in         | JWT access tokens (jose), rotating refresh tokens in an httpOnly cookie, scrypt hashes |
| Branch hardware | Node print bridge (skeleton) for ESC/POS receipt and kitchen printers                  |
| Testing         | Vitest, Testing Library, Supertest. Planned: Playwright, k6                            |
| DevOps          | Docker Compose, GitHub Actions. Planned: Sentry, Grafana                               |

## Repository structure

```
pos-system/
├── apps/
│   ├── web/            # React app: login, dashboard, brands, branches, menu, users, roles, audit log
│   ├── api/            # Node.js REST API (Express)
│   │   ├── prisma/     # Database schema, migrations and demo seed
│   │   └── src/        # modules/, middleware/, tenancy/, lib/
│   └── print-bridge/   # Local service that drives branch printers
├── packages/
│   └── shared/         # Shared TypeScript types and Zod schemas
├── docs/
│   ├── specs/          # Module specs, written before each module is built
│   ├── proposal/       # Technical proposal (HTML and Word)
│   └── prototype/      # Clickable cashier screen prototype
├── scripts/            # Build helpers
├── docker-compose.yml  # PostgreSQL and Redis for local development
└── .github/            # CI workflow and pull request template
```

The other packages import `@pos/shared` as TypeScript source, so there is no build step to run after changing it. The API and print bridge are bundled with esbuild for production (`npm run build`).

### How data stays separate between brands

Every request after sign-in gets a database client limited to the brand and branches of the signed-in person. It refuses to read or write anything outside them, and it refuses nested relation loading, nested writes, raw SQL and tables nobody gave rules to. Handlers must use this client, not the plain one. See [spec 001](docs/specs/001-auth-and-tenancy.md) and `apps/api/src/tenancy/`.

### Documents

| File                                                                   | Description                                                                                                |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [docs/specs/](docs/specs/)                                             | Module specs: sign-in and tenant scoping, brands and branches, users and roles, menu, orders, POS terminal |
| [POS_System_Proposal_1.html](docs/proposal/POS_System_Proposal_1.html) | Technical Proposal v1.1: modules, database schema, API, architecture, security                             |
| [POS_System_Proposal_1.docx](docs/proposal/POS_System_Proposal_1.docx) | The same proposal as a Word document                                                                       |
| [POS_Terminal.html](docs/prototype/POS_Terminal.html)                  | Clickable prototype of the cashier screen. Open it in a browser; it uses mock data and needs no server     |

## Roadmap

Planning baseline: 37 weeks from 12 Oct 2026.

| Phase                              | Dates                    | Delivers                                                                  |
| ---------------------------------- | ------------------------ | ------------------------------------------------------------------------- |
| 1. Foundation and menu             | 12 Oct – 4 Dec 2026      | Monorepo, CI, auth, brands, branches, users, bilingual menus              |
| 2. POS and kitchen                 | 7 Dec 2026 – 29 Jan 2027 | POS terminal, orders, payments, receipts, KDS, shifts, offline mode       |
| 3. Inventory and recipes           | 1 Feb – 12 Mar 2027      | Stock, recipes, automatic stock deduction, transfers, alerts              |
| 4. Purchasing and delivery         | 15 Mar – 16 Apr 2027     | Suppliers, purchase orders, goods receipt, delivery platform integrations |
| 5. Reports, promotions and loyalty | 19 Apr – 28 May 2027     | Reports, promotions, loyalty program, floor plan, group dashboard         |
| 6. QA, UAT and launch              | 31 May – 25 Jun 2027     | Load and security testing, user acceptance testing, rollout               |

## Branches and commits

| Branch                          | Purpose                                         |
| ------------------------------- | ----------------------------------------------- |
| `main`                          | Released code. Each release is tagged `vX.Y.Z`  |
| `develop`                       | Integration branch. All work merges here first  |
| `feature/<ticket>-<short-name>` | One story or task, branched from `develop`      |
| `release/vX.Y.0`                | Stabilises a release before it merges to `main` |
| `hotfix/vX.Y.Z`                 | Urgent production fix, branched from `main`     |

- Nobody pushes directly to `main` or `develop`. All changes go through a pull request with passing CI and one approval.
- CI runs the format check, lint, typecheck, tests and build on every pull request, with a PostgreSQL service for the API tests. Run `npm run check` before you push to get the same result locally.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/), scoped by module, for example `feat(orders): split payment` or `fix(kds): recall ticket`.
- Any new text shown in the UI must be added to both the English and Arabic translation files. A test fails if one is missing.
