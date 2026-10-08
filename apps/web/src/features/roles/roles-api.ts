import { roleInfoSchema } from '@pos/shared';
import { z } from 'zod';
import { request } from '../../lib/api';

const roleList = z.object({ data: z.array(roleInfoSchema) });

export const listRoles = async () => (await request('/roles', { schema: roleList })).data;
