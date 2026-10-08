# Multi-Brand F&B POS System

A web-based point of sale and operations platform for restaurant groups that run several brands across many branches. It covers orders, kitchen display, inventory, recipes, purchasing, customer loyalty and reporting, in Arabic (RTL) and English (LTR).

**Status:** Planning. Phase 1 development starts in October 2026. There is no application code in this repository yet.

## What the system will do

- **Multi-brand and multi-branch:** central control for the group, with each branch configured on its own.
- **Order types:** dine-in, takeaway and delivery. Delivery orders sync from Talabat, Deliveroo and Jahez.
- **Kitchen display (KDS):** orders routed to each kitchen station in real time.
- **Inventory and recipes:** stock is deducted automatically when a sale is paid, and food cost is shown per portion.
- **Purchasing:** suppliers, purchase orders, goods received notes and invoice matching.
- **Customer loyalty:** points work across all brands, with Bronze, Silver and Gold tiers and redemption confirmed by an SMS code.
- **Reports:** sales, food cost, stock variance and staff, viewable per branch, per brand or for the whole group.
- **Offline mode:** the POS keeps taking orders and cash payments when the internet is down.

## Repository contents

| File | Description |
| --- | --- |
| [POS_System_Proposal_1.html](docs/proposal/POS_System_Proposal_1.html) | Technical Proposal v1.1: modules, database schema, API, architecture, security |
| [POS_System_Proposal_1.docx](docs/proposal/POS_System_Proposal_1.docx) | The same proposal as a Word document |
| [POS_Terminal.html](docs/prototype/POS_Terminal.html) | Clickable prototype of the cashier screen. Open it in a browser; it uses mock data and needs no server |

## Planned tech stack

| Layer | Technology |
| --- | --- |
| Frontend | React, TypeScript, Vite, Tailwind CSS, Zustand, TanStack Query, i18next, shadcn/ui |
| Backend | Node.js 24 LTS, Express, TypeScript, Prisma, Socket.io, BullMQ |
| Data | PostgreSQL, Redis, S3 or MinIO |
| Branch hardware | Node print bridge for ESC/POS receipt and kitchen printers |
| Testing | Vitest, Playwright, k6 |
| DevOps | Docker Compose, GitHub Actions, Sentry, Grafana |

## Planned repository structure

```
pos-system/
├── apps/
│   ├── web/            # React app: POS, KDS, tables, management console
│   ├── api/            # Node.js REST API and Socket.io server
│   └── print-bridge/   # Local service that drives branch printers
├── packages/
│   └── shared/         # Shared TypeScript types and Zod schemas
├── docs/               # Proposal, prototype, module specs
├── docker-compose.yml
└── .github/workflows/  # CI and deployment
```

## Roadmap

Planning baseline: 37 weeks from 12 Oct 2026.

| Phase | Dates | Delivers |
| --- | --- | --- |
| 1. Foundation and menu | 12 Oct – 4 Dec 2026 | Monorepo, CI, auth, brands, branches, users, bilingual menus |
| 2. POS and kitchen | 7 Dec 2026 – 29 Jan 2027 | POS terminal, orders, payments, receipts, KDS, shifts, offline mode |
| 3. Inventory and recipes | 1 Feb – 12 Mar 2027 | Stock, recipes, automatic stock deduction, transfers, alerts |
| 4. Purchasing and delivery | 15 Mar – 16 Apr 2027 | Suppliers, purchase orders, goods receipt, delivery platform integrations |
| 5. Reports, promotions and loyalty | 19 Apr – 28 May 2027 | Reports, promotions, loyalty program, floor plan, group dashboard |
| 6. QA, UAT and launch | 31 May – 25 Jun 2027 | Load and security testing, user acceptance testing, rollout |

## Branches and commits

| Branch | Purpose |
| --- | --- |
| `main` | Released code. Each release is tagged `vX.Y.Z` |
| `develop` | Integration branch. All work merges here first |
| `feature/<ticket>-<short-name>` | One story or task, branched from `develop` |
| `release/vX.Y.0` | Stabilises a release before it merges to `main` |
| `hotfix/vX.Y.Z` | Urgent production fix, branched from `main` |

- Nobody pushes directly to `main` or `develop`. All changes go through a pull request with passing CI and one approval.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/), scoped by module, for example `feat(orders): split payment` or `fix(kds): recall ticket`.
- Any new text shown in the UI must be added to both the English and Arabic translation files.

## Getting started

Setup instructions will be added once the monorepo is created in Phase 1, week 1. Until then, open `docs/prototype/POS_Terminal.html` in a browser to try the cashier flow.
