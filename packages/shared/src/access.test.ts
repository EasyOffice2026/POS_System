import { describe, expect, it } from 'vitest';
import { permissions, roleKeys, systemRoles } from './access';

describe('systemRoles', () => {
  it('defines every role key exactly once', () => {
    expect(systemRoles.map((role) => role.key).sort()).toEqual([...roleKeys].sort());
  });

  it('gives the group admin every permission', () => {
    const admin = systemRoles.find((role) => role.key === 'group_admin');

    expect([...(admin?.permissions ?? [])].sort()).toEqual([...permissions].sort());
  });

  it('only the group admin can write brands', () => {
    const writers = systemRoles.filter((role) => role.permissions.includes('brands:write'));

    expect(writers.map((role) => role.key)).toEqual(['group_admin']);
  });

  it('scopes cashiers, kitchen staff and purchasers to a branch', () => {
    for (const key of ['cashier', 'kitchen', 'purchaser', 'branch_manager']) {
      expect(systemRoles.find((role) => role.key === key)?.scope).toBe('BRANCH');
    }
  });
});
