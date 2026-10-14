# Load test

**Date:** 17 October 2026 (Phase 6, step 3). **Question:** does the system stay correct and fast when many tills take orders at once, while kitchen screens and the owner's dashboard ask for news, and as months of history pile up?

## Summary

The API stayed correct under load: no order was lost or counted twice, and after two fixes no request failed. The test found three lookups that slowed down as history grows and one setting that turned a busy moment into errors; all four are fixed. The timings on real PostgreSQL come from a GitHub Actions job that anyone with access can start (below); this machine has no real PostgreSQL, so its numbers show where time goes, not how fast the servers will be.

## How the test works

`apps/api/scripts/load-test.mjs` signs in as a group admin, adds one test cashier per till at the branches of the first brand, signs each in with a PIN and opens a shift. Then, for the time given, every till opens an order, adds one to three dishes, sends them to the kitchen, reads the order and takes the payment, again and again, with a short pause between taps. At the same time each branch's kitchen screen reads its tickets every 5 seconds and moves each ticket one step (new, preparing, ready, done), and the owner's dashboard reads today's overview every 10 seconds. It prints, for each kind of request, how many were made, how many failed and how long they took (the median, the slowest 5 percent, the slowest). It writes real orders, so it refuses any server but the local one unless `--allow-remote` is given.

```
cd apps/api
node scripts/load-test.mjs --tills 20 --minutes 3
```

**On real PostgreSQL:** in GitHub, open **Actions**, choose **Load test**, click **Run workflow**, and give the number of tills and minutes. The job starts PostgreSQL 18, applies the migrations, loads the demo data, builds and starts the API as in production, runs the test, and puts the table in the summary of the run.

## What was found and fixed

| Finding                                                                                                                                                                                                                     | Before                                         | After                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------ |
| The kitchen screen lists the last finished tickets, newest first. No index covered "finished, by time finished", so the database read and sorted every ticket the branch ever finished, every 5 seconds per kitchen screen. | 944 ms with a year of history (45,000 tickets) | 0.7 ms, whatever the history                     |
| The open orders of a branch (the POS list, the floor and the dashboard) were found among all of the branch's orders.                                                                                                        | 8 ms with 45,000 orders, growing every day     | 1 ms                                             |
| The audit log of the group admin, newest first, sorted the whole log, which grows at every sign-in.                                                                                                                         | 595 ms with 30,000 entries                     | 3.6 ms                                           |
| When every database connection was busy, a payment waited only 2 seconds to start its transaction, then failed with an error.                                                                                               | 4 failed orders in 2 minutes                   | none: it waits up to 10 seconds, and may take 15 |

The three indexes are in the migration `20261017090000_history_indexes`. Creating them takes a moment on a large table; at launch the tables are small.

The API can also be told how many database connections it may open, with `connection_limit` in `DATABASE_URL` (10 when left out). A hosted database such as Supabase allows only so many connections for the whole project, so set it below that limit.

## Timings on this machine

This machine's test database (PGlite, PostgreSQL compiled to WebAssembly) answers one query at a time, so the API was limited to one connection and every request waited for the others. The numbers below are therefore the worst case, and the useful part is that **nothing failed**.

**One till alone** (no waiting): open an order 152 ms, add a dish 272 ms, send to the kitchen 247 ms, read the order 77 ms, pay 281 ms; the kitchen screen 376 ms; the dashboard overview 831 ms. One till took 41 orders a minute.

**Ten tills at once, with the kitchen and the dashboard,** on the production build, with a year of history and the fixes: 65 orders paid in 2.5 minutes, 318 tickets moved, **0 errors**. Each request waited for the others in the single line, so the medians were 1 to 3 seconds; on PostgreSQL with its pool of connections they run side by side.

## Still to do

1. **Run the GitHub job** with 20 and then 50 tills, and record the timings here. The target: the median of every till request under 200 ms and the slowest 5 percent under 500 ms.
2. **Run it once on the client's staging server** when it exists (step 4), with `--allow-remote` against a test copy of the database, never the live one.
3. **Size the connections** for the chosen Supabase plan and set `connection_limit`.
