import { branchSchema, brandSchema, pageSchema } from '@pos/shared';
import type { z } from 'zod';
import { request } from '../../lib/api';

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
