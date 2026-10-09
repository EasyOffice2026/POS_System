import {
  type AdminUser,
  type AuditLog,
  type AuthUser,
  type Branch,
  type BranchDetail,
  type Brand,
  closedWeek,
  permissions,
  type Printer,
  type RoleInfo,
  type SessionResponse,
  systemRoles,
} from '@pos/shared';

export const ids = {
  pizza: '01990000-0000-7000-8000-000000000001',
  burger: '01990000-0000-7000-8000-000000000002',
  pizzaMall: '01990000-0000-7000-8000-000000000011',
  pizzaDowntown: '01990000-0000-7000-8000-000000000012',
  burgerAirport: '01990000-0000-7000-8000-000000000021',
};

export const groupAdmin: AuthUser = {
  id: '01990000-0000-7000-8000-000000000101',
  name: 'Group Admin',
  email: 'admin@pos.local',
  role: { key: 'group_admin', name: 'Group Admin' },
  scope: 'GROUP',
  brandId: null,
  branchIds: [],
  permissions: [...permissions],
  preferredLang: 'en',
};

export const brandManager: AuthUser = {
  id: '01990000-0000-7000-8000-000000000102',
  name: 'Pizza Palace Manager',
  email: 'pizza.manager@pos.local',
  role: { key: 'brand_manager', name: 'Brand Manager' },
  scope: 'BRAND',
  brandId: ids.pizza,
  branchIds: [],
  permissions: ['brands:read', 'branches:read', 'menu:read'],
  preferredLang: 'en',
};

export const branchManager: AuthUser = {
  id: '01990000-0000-7000-8000-000000000105',
  name: 'Mall Branch Manager',
  email: 'pizza.mall.manager@pos.local',
  role: { key: 'branch_manager', name: 'Branch Manager' },
  scope: 'BRANCH',
  brandId: ids.pizza,
  branchIds: [ids.pizzaMall],
  permissions: ['branches:read', 'users:read', 'menu:read'],
  preferredLang: 'en',
};

export const cashier: AuthUser = {
  id: '01990000-0000-7000-8000-000000000107',
  name: 'Mall Branch Cashier',
  email: null,
  role: { key: 'cashier', name: 'Cashier' },
  scope: 'BRANCH',
  brandId: ids.pizza,
  branchIds: [ids.pizzaMall],
  permissions: ['menu:read'],
  preferredLang: 'en',
};

export function sessionFor(user: AuthUser, accessToken = 'access-token-1'): SessionResponse {
  return { accessToken, expiresIn: 900, user };
}

export const pizzaBrand: Brand = {
  id: ids.pizza,
  name: { en: 'Pizza Palace', ar: 'بيتزا بالاس' },
  logoUrl: null,
  isActive: true,
  createdAt: '2026-10-01T00:00:00.000Z',
};

export const burgerBrand: Brand = {
  id: ids.burger,
  name: { en: 'Burger Hub', ar: 'برجر هب' },
  logoUrl: null,
  isActive: true,
  createdAt: '2026-10-01T00:00:00.000Z',
};

export const pizzaMall: Branch = {
  id: ids.pizzaMall,
  brandId: ids.pizza,
  name: { en: 'Pizza Palace - Mall Branch', ar: 'بيتزا بالاس - فرع المول' },
  address: null,
  timezone: 'Asia/Riyadh',
  isActive: true,
};

export const pizzaDowntown: Branch = {
  id: ids.pizzaDowntown,
  brandId: ids.pizza,
  name: { en: 'Pizza Palace - Downtown Branch', ar: 'بيتزا بالاس - فرع وسط المدينة' },
  address: null,
  timezone: 'Asia/Riyadh',
  isActive: true,
};

export const burgerAirport: Branch = {
  id: ids.burgerAirport,
  brandId: ids.burger,
  name: { en: 'Burger Hub - Airport Branch', ar: 'برجر هب - فرع المطار' },
  address: null,
  timezone: 'Asia/Riyadh',
  isActive: true,
};

export const page = <T>(data: T[], nextCursor: string | null = null) => ({ data, nextCursor });

// --- people, roles and audit rows, for the user management screens ---

export const userIds = {
  sara: '01990000-0000-7000-8000-000000000201',
  dana: '01990000-0000-7000-8000-000000000202',
  maha: '01990000-0000-7000-8000-000000000203',
  locked: '01990000-0000-7000-8000-000000000204',
};

export function adminUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: userIds.sara,
    brandId: ids.pizza,
    name: 'Sara Cashier',
    email: 'sara@pos.local',
    staffCode: '1001',
    role: { key: 'cashier', name: 'Cashier', scope: 'BRANCH' },
    branchIds: [ids.pizzaMall],
    preferredLang: 'en',
    isActive: true,
    lockedUntil: null,
    hasPassword: true,
    hasPin: true,
    lastLoginAt: '2026-10-08T09:30:00.000Z',
    createdAt: '2026-10-01T08:00:00.000Z',
    ...overrides,
  };
}

export const sara = adminUser();

export const dana = adminUser({
  id: userIds.dana,
  name: 'Dana Downtown',
  email: null,
  staffCode: '1002',
  branchIds: [ids.pizzaDowntown],
  hasPassword: false,
  lastLoginAt: null,
  isActive: false,
});

export const lockedUser = adminUser({
  id: userIds.locked,
  name: 'Locked Larry',
  email: 'larry@pos.local',
  staffCode: '1003',
  lockedUntil: '2026-10-09T12:00:00.000Z',
});

export const mahaManager = adminUser({
  id: userIds.maha,
  name: 'Maha Mall Manager',
  email: 'maha@pos.local',
  staffCode: null,
  role: { key: 'branch_manager', name: 'Branch Manager', scope: 'BRANCH' },
  hasPin: false,
});

// The built-in roles as the API returns them. "assignable" depends on who is asking.
export function rolesFor(actor: 'group' | 'brand'): RoleInfo[] {
  return systemRoles.map((role) => ({
    key: role.key,
    name: role.name,
    scope: role.scope,
    permissions: [...role.permissions],
    assignable: actor === 'group' || role.key !== 'group_admin',
  }));
}

export function auditRow(overrides: Partial<AuditLog> = {}): AuditLog {
  return {
    id: '01990000-0000-7000-8000-000000000301',
    action: 'user.created',
    userId: groupAdmin.id,
    userName: 'Group Admin',
    brandId: ids.pizza,
    branchId: null,
    entityType: 'user',
    entityId: userIds.sara,
    metadata: { role: 'cashier', branches: 1 },
    ip: '10.0.0.5',
    userAgent: 'TestBrowser/1.0',
    createdAt: '2026-10-08T10:15:00.000Z',
    ...overrides,
  };
}

// --- brands and branches, for the setup screens ---

const brandManagerRole = systemRoles.find((role) => role.key === 'brand_manager');

// A brand manager with every permission the role has, as the API gives it.
export const fullBrandManager: AuthUser = {
  ...brandManager,
  permissions: [...(brandManagerRole?.permissions ?? [])],
};

// A branch as one branch is read, with its configuration. Closed all week and no printers, as a
// branch that was never set up.
export function branchDetail(overrides: Partial<BranchDetail> = {}): BranchDetail {
  return {
    ...pizzaMall,
    config: { openingHours: closedWeek(), printers: [] },
    ...overrides,
  };
}

export function printer(n: number, overrides: Partial<Printer> = {}): Printer {
  return {
    id: `01990000-0000-7000-8000-0000000004${String(n).padStart(2, '0')}`,
    name: `Printer ${n}`,
    kind: 'receipt',
    host: `192.168.1.${50 + n}`,
    port: 9100,
    ...overrides,
  };
}
