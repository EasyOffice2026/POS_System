# Deployment

How to run the system for real: what it is made of, what it needs, how to put a new version live, and what to watch. It does not depend on a hosting company; any server or service that runs Docker images will do. The decisions still open are at the end.

## What runs

| Part     | Image                                 | What it does                                                                                                                                                        |
| -------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API      | `apps/api/Dockerfile`                 | The Node API on port 3000, as an unprivileged user. Checks: `GET /api/v1/health` (the process is up) and `GET /api/v1/health/ready` (it also reaches the database). |
| Tools    | `apps/api/Dockerfile`, target `tools` | Applies the database migrations (its default command), and makes the first group admin. Runs, then stops.                                                           |
| Web      | `apps/web/Dockerfile`                 | nginx on port 8080: the built web app, the security headers, and `/api` passed on to the API at `API_URL`. Check: `GET /healthz`.                                   |
| Database | Hosted PostgreSQL (Supabase)          | Everything the system keeps. Not in an image.                                                                                                                       |

HTTPS is ended in front of the web container, by the host's load balancer or a proxy on the server (Caddy, nginx, a cloud load balancer). Browsers only ever talk to that address; the API is not reachable from outside.

```
browser --HTTPS--> proxy or load balancer --> web (nginx :8080) --/api--> api (:3000) --> PostgreSQL
```

CI builds the three images on every pull request, applies the migrations to a real PostgreSQL, starts them and checks the answers and headers (job "Build and try the images" in `.github/workflows/ci.yml`).

## Settings

| Setting                                                                                                                   | Where      | Value                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                                                                                                            | API, tools | The Session pooler address of Supabase with `?schema=pos&sslmode=require&uselibpqcompat=true` (see the README), and `&connection_limit=<n>` below the plan's limit. A secret.                                                                                      |
| `JWT_ACCESS_SECRET`                                                                                                       | API        | A long random value of your own: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. The API refuses the development one. Changing it signs everybody out. A secret.                                                                 |
| `NODE_ENV`                                                                                                                | API        | `production`: secure cookie, strict hashing, HTTPS header.                                                                                                                                                                                                         |
| `TRUST_PROXY`                                                                                                             | API        | How many proxies stand between the browser and the API, for the right addresses in the audit log: 2 with a proxy in front of the web container.                                                                                                                    |
| `SMTP_URL`                                                                                                                | API        | The email account alerts go out from, as `smtp://user:password@host:587` or `smtps://user:password@host:465` (for a Gmail account: an app password, host `smtp.gmail.com`, port 465 with `smtps`). Left out, alerts are only logged. A secret.                     |
| `ALERT_FROM`                                                                                                              | API        | The sender shown on alerts, for example `POS <owner@example.com>`; the account's address when left out.                                                                                                                                                            |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`                                                                               | API        | Where photos of dishes and brand logos are kept: the project address (`https://<ref>.supabase.co`) and its service role key (Supabase → Project Settings → API Keys), both for the API only. Without them, photos can only be given as links. The key is a secret. |
| `STORAGE_BUCKET`                                                                                                          | API        | The public bucket the photos go in; `pos-images` when left out. The API makes it the first time a photo is uploaded.                                                                                                                                               |
| `API_URL`                                                                                                                 | Web        | Where nginx finds the API: `http://api:3000` with the example below.                                                                                                                                                                                               |
| `PASSWORD_HASH_PROFILE`, `ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_DAYS`, `PIN_SESSION_HOURS`, `AUTH_RATE_LIMIT_MAX` | API        | Leave the defaults unless there is a reason (a till asks for the PIN again after `PIN_SESSION_HOURS`, 24).                                                                                                                                                         |

Secrets live in the host's secret settings or in `deploy/.env.production` on the server, never in the repository (`.env.*` files are ignored by git).

## First time

1. Create the Supabase project, take its Session pooler address, and check that the `pos` schema is **not** in Settings, Data API, exposed schemas.
2. Put the settings above in place.
3. Apply the migrations: run the tools image once.
4. Make the first group admin with the tools image:
   ```
   docker run --rm -e DATABASE_URL pos-api-tools npm run admin:create -w @pos/api -- --email owner@example.com --name "Owner"
   ```
   The password is printed once. Never run the demo seed against this database; it refuses anyway.
   If the owner ever loses the password, `npm run admin:reset -w @pos/api -- --email owner@example.com` prints a new one, the same way.
5. Start the API and the web app, and point the HTTPS address at the web container.
6. Sign in, set up the brands, branches, menus and settings, then set up each till at `/pos/setup`.

On one server with Docker, `deploy/compose.production.yml` does steps 3 and 5 in order:

```
docker compose -f deploy/compose.production.yml --env-file deploy/.env.production up -d --build
```

## A new version

1. Merge to `main` with a green CI.
2. Build the three images from that commit (on the server, or in a registry).
3. Run the tools image: the migrations of the new version are applied. Migrations only add or change in ways the running version still works with; when one cannot, the release notes say so and the API is stopped first.
4. Replace the API, then the web container. A till that is open keeps working; at its next request it talks to the new API, and the web app is fetched again on the next page load (`index.html` is never kept; the built files are, for a year, under new names).
5. Check `GET /api/v1/health/ready` and sign in once.

To go back, start the images of the previous version. Migrations are not undone automatically; a release that needs that says how.

## Watching it

- **Logs.** The API writes one line of JSON per request to standard output: time, level, `requestId`, method, path (without its query), status, milliseconds and address. No token, password, body or query is written. Each answer carries the same id in `X-Request-Id`, and an unexpected error is logged with it, so a cashier's "it failed at 12:04" can be found. Keep the logs 30 days in the host's log viewer.
- **Health.** Point the host's checks at `/api/v1/health/ready` (API) and `/healthz` (web). The images also declare Docker health checks.
- **Alerts.** Alert on: the readiness check failing, answers with status 500 or more in the log (`"level":"error"`), and the database's connections or storage near the plan's limits. An error tracker (Sentry or similar) can be added once the client chooses one.
- **Load.** Before launch and after big changes, run the load test of `docs/load-test.md` against a copy, never the live database.

## Backups

The database is the only thing to back up; the images can be built again from git. Supabase backs up every day on its paid plans, and point-in-time recovery (to any second of the last days) is an add-on. Before launch, decide the plan, and try one restore into a spare project, so it is known to work and how long it takes.

## Vercel

The system can also run on Vercel instead of a server, with the database still on Supabase. `vercel.json` at the root sets it up as two services: the API as a Node function and the web app as a static site, with `/api/...` sent to the API and everything else to the web app (inside the web service, every path that is not a file falls back to `index.html`, so `/pos`, `/kds` and `/admin/...` open directly). The print bridge is not deployed there; it runs on the shop computer next to the printer.

**How it differs from a server.** Vercel runs the API as copies that start on demand and may run side by side, with no shared memory between them. Three things follow:

- **Database connections.** Each copy opens its own. Use Supabase's **transaction pooler** address (port 6543, "Transaction" in the Connect dialog), not the session pooler, and add `&connection_limit=1`. The migrations keep using the session pooler address from a developer's machine, as before.
- **Menu changes** reach a copy within `MENU_CACHE_TTL_SECONDS`; set it to `30` instead of the default 300.
- **The limit on failed sign-ins** is counted per copy, so it is weaker than on one server. The lock of an account after five wrong tries is in the database and works the same.

**Settings** (Vercel → Project → Settings → Environment Variables, for Production and Preview):

| Name                        | Value                                                                                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`              | `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?schema=pos&sslmode=require&uselibpqcompat=true&connection_limit=1` |
| `JWT_ACCESS_SECRET`         | A long random value of your own (see Settings above)                                                                                                        |
| `TRUST_PROXY`               | `1`                                                                                                                                                         |
| `MENU_CACHE_TTL_SECONDS`    | `30`                                                                                                                                                        |
| `SUPABASE_URL`              | `https://<ref>.supabase.co` (Supabase → Project Settings → API Keys)                                                                                        |
| `SUPABASE_SERVICE_ROLE_KEY` | The service role key of the same page, for photo uploads (see Settings above). A secret.                                                                    |

Vercel sets `NODE_ENV=production` itself. The region is `fra1` (Frankfurt) in `vercel.json`, next to Supabase's eu-central-1; check it also under Settings → Functions → Region, since the dashboard wins. The plan must be Pro: the Hobby plan is for personal use only.

**Steps.**

1. Apply the migrations and make the first admin from a developer's machine, with `DATABASE_URL` set to the session pooler address of the live project (sections "First time", steps 3 and 4).
2. In Vercel, import the repository, keep the root directory `./`, add the settings above, and deploy. Vercel builds both services from `vercel.json`; the API's build makes `apps/api/dist/vercel.js` with `npm run build:vercel`, and `apps/api/vercel-entry.mjs` (the entry file named in `vercel.json`, which Vercel wants to see before it builds) loads it.
3. Open `https://<project>.vercel.app/api/v1/health/ready`: it must answer `{"status":"ok","service":"api"}`. Then sign in.
4. Add the client's domain under Settings → Domains; Vercel issues the certificate.

**Not yet tried on Vercel itself.** The entry file (`apps/api/src/vercel.ts`) is tested, and its bundle was run as a function on a developer's machine, but the first deploy to Vercel may still need a small change: the keys of `vercel.json` services (`runtime`, `entrypoint`, `buildCommand`) follow Vercel's import screen and documentation, and whether Vercel hands the API the full path `/api/v1/...` or strips `/api` is handled either way in the entry file. If the first deploy fails, send the build log to the development team.

## Tills

A till is a browser on the shop computer or tablet, open at `https://<address>/pos`. The receipt and the kitchen slip ([spec 027](specs/027-kitchen-screen-and-slip.md)) print through the browser on the computer's default printer. A browser normally asks before each print; to print the kitchen slip at once, start it in kiosk printing mode, for example a desktop shortcut whose target is:

```
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --kiosk-printing --app=https://pos.nexerakw.com/pos
```

Close every Edge window first, or the flag is ignored. Chrome takes the same flags. Set the kitchen or receipt printer as the computer's default printer, and its paper size to the roll (80 mm). A tablet (an iPad) cannot print this way: give the branch a network printer and run the print bridge (next section), and every till prints the same way, without a dialog.

## Print bridge

The print bridge ([spec 028](specs/028-print-bridge.md)) is a small program on one computer in the branch's network, on all day. The tills leave their receipts and kitchen slips on the server; the bridge takes them and sends them to the branch's network printers (ESC/POS over port 9100: Epson, Xprinter, Sunmi and most other 80 mm receipt printers). Nothing is installed on the tills.

1. **The printers.** Give each printer a fixed address on the shop's network (in the router, or on the printer itself), and add it under Branches → the branch → Printers, with its kind: Receipts, or Kitchen tickets. Save.
2. **The key.** On the same tab, "Make a key" under Print bridge, and copy it: it is shown once. Making a new key stops the old one.
3. **The computer.** Any Windows PC that stays on (the shop computer is fine). Install Node.js 24 (LTS) from nodejs.org. Copy the folder `apps/print-bridge/dist` from a build (`npm run build -w @pos/print-bridge` on a developer's machine) to the PC, for example to `C:\pos-print-bridge`, and next to `server.js` make a file `.env`:

   ```
   POS_API_URL=https://pos.nexerakw.com
   PRINT_BRIDGE_KEY=pb_...
   ```

4. **Start it:** `node --env-file=.env server.js` in that folder. It prints the branch and its printers, then waits for jobs. To start it with Windows, make a Task Scheduler task "At log on" running that command in that folder (or a shortcut in the Startup folder). It needs no open port: it only calls the POS.
5. **Try it:** on any till, pay an order and tap Print. The receipt comes out, and the till says "Printed on …". If the till says the bridge did not answer, the program is not running or the key is wrong; if it says the printer could not be reached, check the printer's address and that it is on the same network as the PC.

The bridge logs each job it printed, and each try that failed, to its window. `PRINTER_TIMEOUT_MS` (5000) is how long it waits for a printer.

## Still to decide

1. **Where it runs:** Vercel (chosen on 16 October 2026, section "Vercel"), with the server images above kept as the alternative.
2. **The address** (for example `pos.nexerakw.com`) and who manages its HTTPS certificate.
3. **The Supabase plan:** connections, storage, daily backups and point-in-time recovery.
4. **Where the logs go and who gets the alerts.**
5. **A staging copy** for the acceptance tests of step 5, with its own database.
