import { kitchenTicketListSchema, kitchenTicketSchema, type TicketStatus } from '@pos/shared';
import { request } from '../../lib/api';
import { queryString } from '../../lib/query-string';

export const kitchenKeys = {
  tickets: (branchId: string) => ['kitchen', branchId, 'tickets'] as const,
};

// The open tickets of the branch, oldest first, then the last ones that were done.
export async function listTickets(branchId: string) {
  const { data } = await request(`/kitchen/tickets${queryString({ branchId })}`, {
    schema: kitchenTicketListSchema,
  });
  return data;
}

// Moves a ticket from the status this screen saw (spec 008, rule 3).
export const moveTicket = (id: string, from: TicketStatus, to: TicketStatus) =>
  request(`/kitchen/tickets/${id}`, {
    method: 'PATCH',
    body: { from, to },
    schema: kitchenTicketSchema,
  });
