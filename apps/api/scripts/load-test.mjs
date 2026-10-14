// A load test of the API: many tills taking orders at once, while kitchen screens and the owner's
// dashboard ask for news. See docs/load-test.md.
//
//   node scripts/load-test.mjs --tills 20 --minutes 3
//
// It signs in as a group admin, adds one test cashier per till at the branches of the first
// brand, opens a shift for each, then every till opens an order, adds dishes, sends them to the
// kitchen and is paid, again and again. It writes real orders, so point it at a test database
// only: it refuses any address but this computer unless --allow-remote is given.

import { randomInt, randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:3000' },
    tills: { type: 'string', default: '10' },
    minutes: { type: 'string', default: '2' },
    email: { type: 'string', default: 'admin@pos.local' },
    password: { type: 'string', default: 'DevPassw0rd!' },
    // The pause of a cashier between two taps, in milliseconds.
    think: { type: 'string', default: '200' },
    'allow-remote': { type: 'boolean', default: false },
  },
});

const base = new URL('/api/v1/', args.url);
if (!['localhost', '127.0.0.1', '::1'].includes(base.hostname) && !args['allow-remote']) {
  console.error(`Refusing to load ${base.host}: it is not this computer. Add --allow-remote.`);
  process.exit(1);
}
const tills = Number(args.tills);
const endAt = Date.now() + Number(args.minutes) * 60_000;
const think = Number(args.think);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- timings per kind of request

const timings = new Map();
function record(label, ms, ok) {
  const row = timings.get(label) ?? { times: [], errors: 0, codes: new Map() };
  row.times.push(ms);
  if (!ok.ok) {
    row.errors += 1;
    row.codes.set(ok.code, (row.codes.get(ok.code) ?? 0) + 1);
  }
  timings.set(label, row);
}

async function call(label, method, path, { token, body } = {}) {
  const started = performance.now();
  let res;
  try {
    res = await fetch(new URL(path, base), {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    record(label, performance.now() - started, { ok: false, code: 'NETWORK' });
    throw error;
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  record(label, performance.now() - started, {
    ok: res.ok,
    code: res.ok ? null : `${res.status} ${json?.error?.code ?? ''}`.trim(),
  });
  if (!res.ok) {
    const error = new Error(`${label}: ${res.status} ${json?.error?.code ?? text.slice(0, 80)}`);
    error.status = res.status;
    throw error;
  }
  return json;
}

const percentile = (sorted, p) =>
  sorted.length === 0
    ? 0
    : sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

// ---- setting up

const admin = await call('sign in (password)', 'POST', 'auth/login', {
  body: { type: 'password', email: args.email, password: args.password },
});
const adminToken = admin.accessToken;
const brands = (await call('list brands', 'GET', 'brands?limit=100', { token: adminToken })).data;
const brand = brands.find((row) => row.isActive);
if (!brand) throw new Error('No active brand to load.');
const branches = (
  await call('list branches', 'GET', `brands/${brand.id}/branches?limit=100`, { token: adminToken })
).data.filter((row) => row.isActive);
if (branches.length === 0) throw new Error('The brand has no active branch.');

// What each branch sells that can be added without a choice the script cannot make.
const menus = new Map();
for (const branch of branches) {
  const menu = await call('branch menu', 'GET', `menu?branchId=${branch.id}`, {
    token: adminToken,
  });
  const items = menu.categories
    .flatMap((category) => category.items)
    .filter((item) => item.schedule === null)
    .map((item) => ({
      itemId: item.id,
      modifierIds: item.modifierGroups.flatMap((group) =>
        group.modifiers.slice(0, Math.max(group.minSelect, 0)).map((modifier) => modifier.id),
      ),
    }));
  if (items.length === 0) throw new Error(`Branch ${branch.id} sells nothing the script can add.`);
  menus.set(branch.id, items);
}

// A PIN the rules accept: six digits, not all the same, not a run such as 123456.
function makePin() {
  for (;;) {
    const digits = Array.from({ length: 6 }, () => randomInt(0, 10));
    const steps = digits.slice(1).map((digit, index) => digit - digits[index]);
    const same = digits.every((digit) => digit === digits[0]);
    const run = steps.every((step) => step === 1) || steps.every((step) => step === -1);
    if (!same && !run) return digits.join('');
  }
}

// One cashier per till, with a staff code no one has yet.
const run = randomInt(10_000, 99_999);
const cashiers = [];
for (let index = 0; index < tills; index += 1) {
  const branch = branches[index % branches.length];
  const staffCode = `L${run}${String(index).padStart(3, '0')}`;
  const pin = makePin();
  await call('add cashier', 'POST', 'users', {
    token: adminToken,
    body: {
      name: `Load cashier ${index + 1}`,
      staffCode,
      roleKey: 'cashier',
      brandId: brand.id,
      branchIds: [branch.id],
      pin,
    },
  }).catch(async (error) => {
    throw new Error(`Adding a cashier failed (${error.message}). Is the PIN accepted?`);
  });
  cashiers.push({ branch, staffCode, pin });
}
console.log(
  `Brand ${brand.name.en}: ${branches.length} branches, ${tills} tills, ${args.minutes} minutes.`,
);

// ---- the tills

let orders = 0;
let failures = 0;

async function till(cashier) {
  const session = await call('sign in (PIN)', 'POST', 'auth/login', {
    body: {
      type: 'pin',
      branchId: cashier.branch.id,
      staffCode: cashier.staffCode,
      pin: cashier.pin,
    },
  });
  const token = session.accessToken;
  await call('open shift', 'POST', 'shifts', {
    token,
    body: { branchId: cashier.branch.id, openingCash: '50.000' },
  });
  const items = menus.get(cashier.branch.id);

  while (Date.now() < endAt) {
    try {
      const order = await call('open order', 'POST', 'orders', {
        token,
        body: { id: randomUUID(), branchId: cashier.branch.id, type: 'takeaway' },
      });
      let current = order;
      const lines = 1 + randomInt(0, 3);
      for (let line = 0; line < lines; line += 1) {
        const item = items[randomInt(0, items.length)];
        await sleep(think);
        current = await call('add dish', 'POST', `orders/${order.id}/lines`, {
          token,
          body: { id: randomUUID(), kind: 'item', quantity: 1 + randomInt(0, 2), ...item },
        });
      }
      await sleep(think);
      await call('send to kitchen', 'POST', `orders/${order.id}/send`, { token });
      await call('read order', 'GET', `orders/${order.id}`, { token });
      await sleep(think);
      await call('pay', 'POST', `orders/${order.id}/pay`, {
        token,
        body: {
          tenders: [
            { id: randomUUID(), method: 'cash', amount: current.total, tendered: current.total },
          ],
        },
      });
      orders += 1;
      if (orders % 10 === 0) {
        await call(
          'open orders list',
          'GET',
          `orders?branchId=${cashier.branch.id}&status=open&limit=50`,
          {
            token,
          },
        );
      }
    } catch {
      failures += 1;
      await sleep(1000);
    }
  }
  await call('current shift', 'GET', `shifts/current?branchId=${cashier.branch.id}`, { token });
}

// The kitchen screen of each branch asks every 5 seconds, the owner's dashboard every 10.
async function every(ms, task) {
  while (Date.now() < endAt) {
    await task().catch(() => {});
    await sleep(ms);
  }
}

const started = Date.now();
await Promise.all([
  ...cashiers.map((cashier) => till(cashier).catch((error) => console.error(error.message))),
  // The kitchen moves each ticket on one step at every look, as cooks do.
  ...branches.map((branch) =>
    every(5_000, async () => {
      const tickets = await call(
        'kitchen tickets',
        'GET',
        `kitchen/tickets?branchId=${branch.id}`,
        {
          token: adminToken,
        },
      );
      const next = { new: 'preparing', preparing: 'ready', ready: 'done' };
      for (const ticket of tickets.data.filter((row) => next[row.status])) {
        await call('move ticket', 'PATCH', `kitchen/tickets/${ticket.id}`, {
          token: adminToken,
          body: { from: ticket.status, to: next[ticket.status] },
        }).catch(() => {});
      }
    }),
  ),
  every(10_000, () => call('dashboard overview', 'GET', 'reports/overview', { token: adminToken })),
]);
const seconds = (Date.now() - started) / 1000;

// ---- the report

const rows = [...timings.entries()].map(([label, row]) => {
  const sorted = [...row.times].sort((a, b) => a - b);
  return {
    request: label,
    count: sorted.length,
    errors: row.errors,
    'median ms': Math.round(percentile(sorted, 50)),
    'p95 ms': Math.round(percentile(sorted, 95)),
    'max ms': Math.round(sorted[sorted.length - 1] ?? 0),
    codes: [...row.codes.entries()].map(([code, count]) => `${code} x${count}`).join(', '),
  };
});
console.table(rows);
console.log(
  `${orders} orders paid in ${Math.round(seconds)} s (${((orders / seconds) * 60).toFixed(0)} a minute), ${failures} orders failed.`,
);
