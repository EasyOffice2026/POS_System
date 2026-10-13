import { z } from 'zod';

// List endpoints use cursor pages: ?limit=50&cursor=<id of the last item>.
export const cursorQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.uuid().optional(),
});

export type CursorQuery = z.infer<typeof cursorQuerySchema>;

export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    nextCursor: z.uuid().nullable(),
  });
}

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}
