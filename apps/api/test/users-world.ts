import type { Express } from 'express';
import request from 'supertest';
import type { PasswordHasher } from '../src/lib/password';
import type { PrismaClient } from '../src/lib/prisma';
import { createBranch, createBrand, createUser, TEST_PASSWORD } from './factories';

// Two brands, branches, and a person in the main roles. Used by the tests of the people,
// roles and audit log routes.
//
//   Pizza:  Mall, Downtown      Burger: Airport
//   admin@x.io           group admin
//   pizza@x.io           brand manager of Pizza
//   burger@x.io          brand manager of Burger
//   mall-manager@x.io    branch manager at Pizza Mall
//   cashier@x.io         cashier at Pizza Mall, staff code 1001, PIN 4829
//   Dana Downtown        cashier at Pizza Downtown, staff code 1002, PIN 5920 (no email)
//   Omar Burger Cashier  cashier at Burger Airport, staff code 1001, PIN 3817 (no email)
export async function createUsersWorld(prisma: PrismaClient, hasher: PasswordHasher) {
  const pizza = await createBrand(prisma, 'Pizza');
  const burger = await createBrand(prisma, 'Burger');
  const mall = await createBranch(prisma, pizza.id, 'Pizza Mall');
  const downtown = await createBranch(prisma, pizza.id, 'Pizza Downtown');
  const airport = await createBranch(prisma, burger.id, 'Burger Airport');

  const admin = await createUser(prisma, hasher, {
    roleKey: 'group_admin',
    name: 'Zoe Group Admin',
    email: 'admin@x.io',
  });
  const pizzaManager = await createUser(prisma, hasher, {
    roleKey: 'brand_manager',
    name: 'Amal Pizza Manager',
    brandId: pizza.id,
    email: 'pizza@x.io',
  });
  const burgerManager = await createUser(prisma, hasher, {
    roleKey: 'brand_manager',
    name: 'Bashir Burger Manager',
    brandId: burger.id,
    email: 'burger@x.io',
  });
  const mallManager = await createUser(prisma, hasher, {
    roleKey: 'branch_manager',
    name: 'Maha Mall Manager',
    brandId: pizza.id,
    branchIds: [mall.id],
    email: 'mall-manager@x.io',
  });
  const cashier = await createUser(prisma, hasher, {
    roleKey: 'cashier',
    name: 'Sara Cashier',
    brandId: pizza.id,
    branchIds: [mall.id],
    email: 'cashier@x.io',
    staffCode: '1001',
    pin: '4829',
  });
  const downtownCashier = await createUser(prisma, hasher, {
    roleKey: 'cashier',
    name: 'Dana Downtown',
    brandId: pizza.id,
    branchIds: [downtown.id],
    staffCode: '1002',
    pin: '5920',
  });
  const burgerCashier = await createUser(prisma, hasher, {
    roleKey: 'cashier',
    name: 'Omar Burger Cashier',
    brandId: burger.id,
    branchIds: [airport.id],
    staffCode: '1001',
    pin: '3817',
  });

  return {
    pizza,
    burger,
    mall,
    downtown,
    airport,
    users: {
      admin,
      pizzaManager,
      burgerManager,
      mallManager,
      cashier,
      downtownCashier,
      burgerCashier,
    },
  };
}

export type UsersWorld = Awaited<ReturnType<typeof createUsersWorld>>;

export async function signIn(app: Express, email: string): Promise<string> {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ type: 'password', email, password: TEST_PASSWORD });
  return (res.body as { accessToken: string }).accessToken;
}

// Calls the API as a signed-in person.
export function as(app: Express, token: string) {
  const bearer = `Bearer ${token}`;
  return {
    get: (path: string) => request(app).get(path).set('Authorization', bearer),
    post: (path: string, body?: object) =>
      request(app).post(path).set('Authorization', bearer).send(body),
    patch: (path: string, body?: object) =>
      request(app).patch(path).set('Authorization', bearer).send(body),
    put: (path: string, body?: object) =>
      request(app).put(path).set('Authorization', bearer).send(body),
    delete: (path: string, body?: object) =>
      request(app).delete(path).set('Authorization', bearer).send(body),
  };
}

export function refreshCookieOf(res: request.Response): string | undefined {
  const raw: unknown = res.headers['set-cookie'];
  const lines = Array.isArray(raw) ? raw.map(String) : [];
  const line = lines.find((entry) => entry.startsWith('pos_refresh='));
  return line?.split(';')[0]?.slice('pos_refresh='.length) || undefined;
}

export function errorOf(res: request.Response) {
  return (res.body as { error: { code: string; details?: { path: string; message: string }[] } })
    .error;
}
