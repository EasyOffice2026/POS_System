// Demo data for local development: two brands, their branches and one account per role.
// Safe to run again: it updates the same rows and clears any sign-in lockout.
import { loadConfig } from '../src/config';
import { createPasswordHasher, hashProfiles } from '../src/lib/password';
import { createPrismaClient } from '../src/lib/prisma';
import { syncSystemRoles } from '../src/lib/roles';

if (process.env.NODE_ENV === 'production') {
  throw new Error('The demo seed must not run in production.');
}

const DEV_PASSWORD = 'DevPassw0rd!';

const brandIds = {
  pizza: '01990000-0000-7000-8000-000000000001',
  burger: '01990000-0000-7000-8000-000000000002',
};

const branchIds = {
  pizzaMall: '01990000-0000-7000-8000-000000000011',
  pizzaDowntown: '01990000-0000-7000-8000-000000000012',
  burgerAirport: '01990000-0000-7000-8000-000000000021',
  burgerCorniche: '01990000-0000-7000-8000-000000000022',
};

const brands = [
  { id: brandIds.pizza, name: { en: 'Pizza Palace', ar: 'بيتزا بالاس' } },
  { id: brandIds.burger, name: { en: 'Burger Hub', ar: 'برجر هب' } },
];

const branches = [
  {
    id: branchIds.pizzaMall,
    brandId: brandIds.pizza,
    name: { en: 'Pizza Palace - Mall Branch', ar: 'بيتزا بالاس - فرع المول' },
  },
  {
    id: branchIds.pizzaDowntown,
    brandId: brandIds.pizza,
    name: { en: 'Pizza Palace - Downtown Branch', ar: 'بيتزا بالاس - فرع وسط المدينة' },
  },
  {
    id: branchIds.burgerAirport,
    brandId: brandIds.burger,
    name: { en: 'Burger Hub - Airport Branch', ar: 'برجر هب - فرع المطار' },
  },
  {
    id: branchIds.burgerCorniche,
    brandId: brandIds.burger,
    name: { en: 'Burger Hub - Corniche Branch', ar: 'برجر هب - فرع الكورنيش' },
  },
];

interface DemoUser {
  id: string;
  name: string;
  roleKey: string;
  brandId: string | null;
  branchIds: string[];
  email?: string;
  staffCode?: string;
  pin?: string;
}

const users: DemoUser[] = [
  {
    id: '01990000-0000-7000-8000-000000000101',
    name: 'Group Admin',
    roleKey: 'group_admin',
    brandId: null,
    branchIds: [],
    email: 'admin@pos.local',
  },
  {
    id: '01990000-0000-7000-8000-000000000102',
    name: 'Pizza Palace Manager',
    roleKey: 'brand_manager',
    brandId: brandIds.pizza,
    branchIds: [],
    email: 'pizza.manager@pos.local',
  },
  {
    id: '01990000-0000-7000-8000-000000000103',
    name: 'Burger Hub Manager',
    roleKey: 'brand_manager',
    brandId: brandIds.burger,
    branchIds: [],
    email: 'burger.manager@pos.local',
  },
  {
    id: '01990000-0000-7000-8000-000000000104',
    name: 'Pizza Palace Marketing',
    roleKey: 'marketing',
    brandId: brandIds.pizza,
    branchIds: [],
    email: 'pizza.marketing@pos.local',
  },
  {
    id: '01990000-0000-7000-8000-000000000105',
    name: 'Mall Branch Manager',
    roleKey: 'branch_manager',
    brandId: brandIds.pizza,
    branchIds: [branchIds.pizzaMall],
    email: 'pizza.mall.manager@pos.local',
  },
  {
    id: '01990000-0000-7000-8000-000000000106',
    name: 'Mall Branch Purchaser',
    roleKey: 'purchaser',
    brandId: brandIds.pizza,
    branchIds: [branchIds.pizzaMall],
    email: 'pizza.mall.purchaser@pos.local',
  },
  {
    id: '01990000-0000-7000-8000-000000000107',
    name: 'Mall Branch Cashier',
    roleKey: 'cashier',
    brandId: brandIds.pizza,
    branchIds: [branchIds.pizzaMall],
    staffCode: '1001',
    pin: '1234',
  },
  {
    id: '01990000-0000-7000-8000-000000000108',
    name: 'Mall Branch Kitchen',
    roleKey: 'kitchen',
    brandId: brandIds.pizza,
    branchIds: [branchIds.pizzaMall],
    staffCode: '1002',
    pin: '2222',
  },
  {
    id: '01990000-0000-7000-8000-000000000109',
    name: 'Airport Branch Cashier',
    roleKey: 'cashier',
    brandId: brandIds.burger,
    branchIds: [branchIds.burgerAirport],
    staffCode: '2001',
    pin: '4321',
  },
];

const config = loadConfig();
const prisma = createPrismaClient(config.databaseUrl);
const hasher = createPasswordHasher(hashProfiles[config.passwordHashProfile]);

try {
  await syncSystemRoles(prisma);

  for (const brand of brands) {
    await prisma.brand.upsert({
      where: { id: brand.id },
      update: { name: brand.name },
      create: brand,
    });
  }

  for (const branch of branches) {
    await prisma.branch.upsert({
      where: { id: branch.id },
      update: { name: branch.name, brandId: branch.brandId },
      create: branch,
    });
  }

  for (const user of users) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: user.roleKey } });
    const data = {
      brandId: user.brandId,
      roleId: role.id,
      name: user.name,
      email: user.email ?? null,
      staffCode: user.staffCode ?? null,
      passwordHash: user.email ? await hasher.hash(DEV_PASSWORD) : null,
      pinHash: user.pin ? await hasher.hash(user.pin) : null,
      isActive: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
    };

    await prisma.user.upsert({
      where: { id: user.id },
      update: data,
      create: { id: user.id, ...data },
    });

    await prisma.userBranch.deleteMany({ where: { userId: user.id } });
    if (user.branchIds.length > 0 && user.brandId) {
      const brandId = user.brandId;
      await prisma.userBranch.createMany({
        data: user.branchIds.map((branchId) => ({ userId: user.id, branchId, brandId })),
      });
    }
  }

  console.log('Demo data is ready (development only).');
  console.log(`\nEmail accounts, password "${DEV_PASSWORD}":`);
  for (const user of users.filter((u) => u.email)) {
    console.log(`  ${user.email?.padEnd(32)} ${user.roleKey}`);
  }
  console.log('\nPIN accounts (sign in with a branch id, staff code and PIN):');
  for (const user of users.filter((u) => u.pin)) {
    console.log(
      `  staff code ${user.staffCode}, PIN ${user.pin}, branch ${user.branchIds[0]} (${user.roleKey})`,
    );
  }
} finally {
  await prisma.$disconnect();
}
