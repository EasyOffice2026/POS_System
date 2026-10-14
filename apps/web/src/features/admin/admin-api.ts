import { branchSchema, brandSchema, overviewSchema, pageSchema } from '@pos/shared';
import type { z } from 'zod';
import { request } from '../../lib/api';
import { queryString } from '../../lib/query-string';

const PAGE_SIZE = 100;

// Reads every page of a list endpoint. Cursor pages are the API's list format.
async function listAll<Schema extends z.ZodType>(path: string, item: Schema) {
  const items: z.output<Schema>[] = [];
  let cursor: string | null = null;

  do {
    const query: string = cursor ? `?limit=${PAGE_SIZE}&cursor=${cursor}` : `?limit=${PAGE_SIZE}`;
    const page = await request(`${path}${query}`, { schema: pageSchema(item) });
    items.push(...(page.data as z.output<Schema>[]));
    cursor = page.nextCursor;
  } while (cursor);

  return items;
}

export const listBrands = () => listAll('/brands', brandSchema);

export const listBranches = (brandId: string) =>
  listAll(`/brands/${brandId}/branches`, branchSchema);

// Today's overview of the group, for the dashboard (docs/specs/024-group-dashboard.md).
export const overviewKeys = {
  today: (brandId: string) => ['overview', brandId] as const,
};

export const getOverview = (brandId: string) =>
  request(`/reports/overview${queryString({ brandId })}`, { schema: overviewSchema });
