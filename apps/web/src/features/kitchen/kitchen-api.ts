import { kitchenTicketListSchema, kitchenTicketSchema, type TicketStatus } from '@pos/shared';
import { request } from '../../lib/api';
import { queryString } from '../../lib/query-string';

export const kitchenKeys = {
  tickets: (branchId: string, stationId: string | null = null) =>
    ['kitchen', branchId, 'tickets', stationId] as const,
};

// The open tickets of the branch, oldest first, then the last ones that were done. With a station,
// only that station's (spec 009, rule 6).
export async function listTickets(branchId: string, stationId: string | null = null) {
  const { data } = await request(
    `/kitchen/tickets${queryString({ branchId, stationId: stationId ?? undefined })}`,
    { schema: kitchenTicketListSchema },
  );
  return data;
}

// Moves a ticket from the status this screen saw (spec 008, rule 3).
export const moveTicket = (id: string, from: TicketStatus, to: TicketStatus) =>
  request(`/kitchen/tickets/${id}`, {
    method: 'PATCH',
    body: { from, to },
    schema: kitchenTicketSchema,
  });
