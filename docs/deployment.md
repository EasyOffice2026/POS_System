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

| Setting                                                                                              | Where      | Value                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                                       | API, tools | The Session pooler address of Supabase with `?schema=pos&sslmode=require&uselibpqcompat=true` (see the README), and `&connection_limit=<n>` below the plan's limit. A secret.                      |
| `JWT_ACCESS_SECRET`                                                                                  | API        | A long random value of your own: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. The API refuses the development one. Changing it signs everybody out. A secret. |
| `NODE_ENV`                                                                                           | API        | `production`: secure cookie, strict hashing, HTTPS header.                                                                                                                                         |
| `TRUST_PROXY`                                                                                        | API        | How many proxies stand between the browser and the API, for the right addresses in the audit log: 2 with a proxy in front of the web container.                                                    |
| `API_URL`                                                                                            | Web        | Where nginx finds the API: `http://api:3000` with the example below.                                                                                                                               |
| `PASSWORD_HASH_PROFILE`, `ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_DAYS`, `AUTH_RATE_LIMIT_MAX` | API        | Leave the defaults unless there is a reason.                                                                                                                                                       |

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

## Still to decide

1. **Where it runs:** a server with Docker (the example above), or a service that runs containers (Google Cloud Run, AWS App Runner, Azure Container Apps, Fly.io and the like). Both use the same images.
2. **The address** (for example `pos.nexerakw.com`) and who manages its HTTPS certificate.
3. **The Supabase plan:** connections, storage, daily backups and point-in-time recovery.
4. **Where the logs go and who gets the alerts.**
5. **A staging copy** for the acceptance tests of step 5, with its own database.
