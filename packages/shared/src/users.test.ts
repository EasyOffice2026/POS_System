import { describe, expect, it } from 'vitest';
import { createUserRequestSchema, updateUserRequestSchema, userListQuerySchema } from './users';

const brandId = '01990000-0000-7000-8000-000000000001';
const branchId = '01990000-0000-7000-8000-000000000011';

function messages(result: { error?: { issues: { path: PropertyKey[]; message: string }[] } }) {
  return (result.error?.issues ?? []).map((issue) => `${issue.path.join('.')}:${issue.message}`);
}

describe('createUserRequestSchema', () => {
  it('accepts a cashier with a staff code, a PIN and a branch', () => {
    const result = createUserRequestSchema.safeParse({
      name: 'Sara',
      staffCode: '1001',
      pin: '4829',
      roleKey: 'cashier',
      branchIds: [branchId],
    });

    expect(result.success).toBe(true);
    expect(result.data?.preferredLang).toBe('en');
  });

  it('trims the name and lowercases the email', () => {
    const result = createUserRequestSchema.parse({
      name: '  Sara  ',
      email: ' Sara@POS.local ',
      roleKey: 'brand_manager',
      brandId,
    });

    expect(result.name).toBe('Sara');
    expect(result.email).toBe('sara@pos.local');
    expect(result.branchIds).toEqual([]);
  });

  it('needs an email or a staff code, or the person could never sign in', () => {
    const result = createUserRequestSchema.safeParse({ name: 'Sara', roleKey: 'cashier' });

    expect(messages(result)).toContain('email:EMAIL_OR_STAFF_CODE_REQUIRED');
  });

  it('needs an email for a password and a staff code for a PIN', () => {
    const result = createUserRequestSchema.safeParse({
      name: 'Sara',
      staffCode: '1001',
      email: undefined,
      password: 'a long enough password',
      roleKey: 'cashier',
    });

    expect(messages(result)).toContain('password:PASSWORD_NEEDS_EMAIL');
    expect(
      messages(
        createUserRequestSchema.safeParse({
          name: 'Sara',
          email: 'sara@pos.local',
          pin: '4829',
          roleKey: 'cashier',
        }),
      ),
    ).toContain('pin:PIN_NEEDS_STAFF_CODE');
  });

  it('refuses an easy PIN and a short password with a code', () => {
    const result = createUserRequestSchema.safeParse({
      name: 'Sara',
      email: 'sara@pos.local',
      staffCode: '1',
      pin: '1234',
      password: 'short',
      roleKey: 'cashier',
    });

    expect(messages(result)).toEqual(
      expect.arrayContaining(['pin:PIN_SEQUENCE', 'password:PASSWORD_TOO_SHORT']),
    );
  });

  it('refuses fields it does not know, so nothing can be slipped in', () => {
    const result = createUserRequestSchema.safeParse({
      name: 'Sara',
      email: 'sara@pos.local',
      roleKey: 'cashier',
      isActive: false,
      passwordHash: 'x',
    });

    expect(result.success).toBe(false);
  });

  it('refuses an empty name and an unknown role', () => {
    expect(
      createUserRequestSchema.safeParse({ name: ' ', email: 'a@b.io', roleKey: 'cashier' }).success,
    ).toBe(false);
    expect(
      createUserRequestSchema.safeParse({ name: 'x', email: 'a@b.io', roleKey: 'owner' }).success,
    ).toBe(false);
  });
});

describe('updateUserRequestSchema', () => {
  it('accepts a change of one field', () => {
    expect(updateUserRequestSchema.safeParse({ name: 'New name' }).success).toBe(true);
    expect(updateUserRequestSchema.safeParse({ isActive: false }).success).toBe(true);
  });

  it('lets the email and staff code be cleared with null', () => {
    expect(updateUserRequestSchema.safeParse({ email: null, staffCode: null }).success).toBe(true);
  });

  it('needs at least one field', () => {
    expect(messages(updateUserRequestSchema.safeParse({}))).toContain(':NOTHING_TO_UPDATE');
  });

  it('refuses fields that cannot be changed this way', () => {
    expect(updateUserRequestSchema.safeParse({ brandId }).success).toBe(false);
    expect(updateUserRequestSchema.safeParse({ pin: '4829' }).success).toBe(false);
  });
});

describe('userListQuerySchema', () => {
  it('has the cursor defaults and no filters', () => {
    expect(userListQuerySchema.parse({})).toEqual({ limit: 50 });
  });

  it('reads filters from a query string', () => {
    const query = userListQuerySchema.parse({
      role: 'cashier',
      status: 'locked',
      q: ' sara ',
      branchId,
      limit: '20',
    });

    expect(query).toMatchObject({ role: 'cashier', status: 'locked', q: 'sara', limit: 20 });
  });

  it.each([{ role: 'owner' }, { status: 'gone' }, { q: '' }, { branchId: 'x' }])(
    'refuses %j',
    (query) => {
      expect(userListQuerySchema.safeParse(query).success).toBe(false);
    },
  );
});
