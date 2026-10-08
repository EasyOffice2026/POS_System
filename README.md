# Multi-Brand F&B POS System

A web-based point of sale and operations platform for restaurant groups that run several brands across many branches. It covers orders, kitchen display, inventory, recipes, purchasing, customer loyalty and reporting, in Arabic (RTL) and English (LTR).

**Status:** Phase 1 is under way. Sign-in, tenant isolation between brands and branches, the database schema, the web shell (login, dashboard, Arabic/English) and user administration (users, roles, audit log) are built. Brand and branch screens, menus, orders and the other product features are not built yet.

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

### Demo accounts

`npm run db:setup` creates two brands (Pizza Palace and Burger Hub) with two branches each, and one account per role. These are for development only. The seed refuses to run when `NODE_ENV` is `production`.

| Email                            | Role           | Sees                      |
| -------------------------------- | -------------- | ------------------------- |
| `admin@pos.local`                | Group Admin    | Every brand and branch    |
| `pizza.manager@pos.local`        | Brand Manager  | Pizza Palace              |
| `burger.manager@pos.local`       | Brand Manager  | Burger Hub                |
| `pizza.marketing@pos.local`      | Marketing      | Pizza Palace              |
| `pizza.mall.manager@pos.local`   | Branch Manager | Pizza Palace, Mall branch |
| `pizza.mall.purchaser@pos.local` | Purchaser      | Pizza Palace, Mall branch |

The password for all of them is `DevPassw0rd!`. Cashiers and kitchen staff sign in at a terminal with a branch, a staff code and a PIN instead (the PIN screen comes with the POS terminal in Phase 2). The API already accepts them, for example staff code `1001` with PIN `1234` at the Mall branch (`01990000-0000-7000-8000-000000000011`).

### What you can try

Sign in as `admin@pos.local` and use the menu under the header. Each link shows only when the person has its permission.

| Screen    | What it does                                                                             | Needs                                  |
| --------- | ---------------------------------------------------------------------------------------- | -------------------------------------- |
| Dashboard | The brands and branches the person can see                                               | Any signed-in person                   |
| Users     | Search and filter people, add and change them, deactivate, unlock, set a password or PIN | `users:read` (changing: `users:write`) |
| Roles     | What each built-in role may do                                                           | `roles:read`                           |
| Audit log | Who did what, newest first, filtered by action, days or person                           | `audit:read`                           |

Sign in as `pizza.manager@pos.local` to see that only Pizza Palace people and events appear, and that a brand manager cannot create a group admin. Sign in as `pizza.mall.manager@pos.local` to see a branch manager's view: the people at their own branch, with no way to change them. Switch the language with the button in the header to see the screens in Arabic, mirrored right to left.

### Commands

| Command                                                | What it does                                                          |
| ------------------------------------------------------ | --------------------------------------------------------------------- |
| `npm run dev`                                          | Start the API and web app together                                    |
| `npm run dev:api`, `dev:web`, `dev:print-bridge`       | Start one service                                                     |
| `npm run infra:up`, `infra:down`, `infra:logs`         | Start, stop or follow PostgreSQL and Redis                            |
| `npm run db:setup`                                     | Apply the migrations and add the demo data                            |
| `npm run db:migrate`                                   | Create a new migration after changing `apps/api/prisma/schema.prisma` |
| `npm run db:deploy`, `db:seed`, `db:reset`             | Apply migrations, add demo data, or wipe the database and start again |
| `npm run check`                                        | Run everything CI runs: format check, lint, typecheck, tests, build   |
| `npm run format`, `lint`, `typecheck`, `test`, `build` | Run a single step                                                     |

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
│   ├── web/            # React app: login, dashboard, users, roles, audit log (POS, KDS to come)
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

| File                                                                   | Description                                                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [docs/specs/](docs/specs/)                                             | Module specs: sign-in and tenant scoping, brands and branches, users and roles, menu                   |
| [POS_System_Proposal_1.html](docs/proposal/POS_System_Proposal_1.html) | Technical Proposal v1.1: modules, database schema, API, architecture, security                         |
| [POS_System_Proposal_1.docx](docs/proposal/POS_System_Proposal_1.docx) | The same proposal as a Word document                                                                   |
| [POS_Terminal.html](docs/prototype/POS_Terminal.html)                  | Clickable prototype of the cashier screen. Open it in a browser; it uses mock data and needs no server |

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
