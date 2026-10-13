import { describe, expect, it } from 'vitest';
import { systemRoles } from './access';
import { canMoveTicket, moveTicketRequestSchema, nextTicketStatus } from './kitchen';

const permissionsOf = (key: string) => systemRoles.find((role) => role.key === key)?.permissions;

describe('kitchen tickets', () => {
  it('move forward, may skip preparing, and come back from done to ready', () => {
    expect(canMoveTicket('new', 'preparing')).toBe(true);
    expect(canMoveTicket('new', 'ready')).toBe(true);
    expect(canMoveTicket('preparing', 'ready')).toBe(true);
    expect(canMoveTicket('ready', 'done')).toBe(true);
    expect(canMoveTicket('done', 'ready')).toBe(true);

    expect(canMoveTicket('new', 'done')).toBe(false);
    expect(canMoveTicket('ready', 'preparing')).toBe(false);
    expect(canMoveTicket('done', 'new')).toBe(false);
  });

  it('have one usual next step for the big button', () => {
    expect(nextTicketStatus).toEqual({
      new: 'preparing',
      preparing: 'ready',
      ready: 'done',
      done: 'ready',
    });
  });

  it('refuse a move that is not allowed', () => {
    const result = moveTicketRequestSchema.safeParse({ from: 'new', to: 'done' });
    expect(result.error?.issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([
      ['to', 'TICKET_STATUS_INVALID'],
    ]);
    expect(moveTicketRequestSchema.safeParse({ from: 'new', to: 'cooked' }).success).toBe(false);
  });

  it('can be worked by the kitchen and the managers, not by a cashier', () => {
    expect(permissionsOf('kitchen')).toContain('kitchen:write');
    expect(permissionsOf('branch_manager')).toContain('kitchen:write');
    expect(permissionsOf('brand_manager')).toContain('kitchen:write');
    expect(permissionsOf('cashier')).not.toContain('kitchen:write');
  });
});
