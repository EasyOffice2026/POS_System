import {
  type AuthUser,
  type Branch,
  type Brand,
  permissions,
  type SessionResponse,
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
  permissions: ['branches:read', 'menu:read'],
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
  createdAt: '2026-10-01T00:00:00.000Z',
};

export const burgerBrand: Brand = {
  id: ids.burger,
  name: { en: 'Burger Hub', ar: 'برجر هب' },
  logoUrl: null,
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
