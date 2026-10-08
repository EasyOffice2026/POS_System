import {
  createUserRequestSchema,
  setCredentialsRequestSchema,
  updateUserRequestSchema,
  userListQuerySchema,
} from '@pos/shared';
import { Router } from 'express';
import { z } from 'zod';
import { requestMeta } from '../../lib/request-meta';
import { parseWith } from '../../lib/validate';
import { requestContext } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import type { UsersService } from './users.service';

const idParamsSchema = z.object({ id: z.uuid() });

// Every route reads and writes through the scoped client, so a manager only ever reaches
// the people of their own brand (and a branch manager only the people at their branches).
export function createUsersRouter({ service }: { service: UsersService }): Router {
  const router = Router();

  router.get('/', requirePermission('users:read'), async (req, res) => {
    const query = parseWith(userListQuerySchema, req.query);
    res.json(await service.list(requestContext(req), query));
  });

  router.get('/:id', requirePermission('users:read'), async (req, res) => {
    const { id } = parseWith(idParamsSchema, req.params);
    res.json(await service.get(requestContext(req), id));
  });

  router.post('/', requirePermission('users:write'), async (req, res) => {
    const input = parseWith(createUserRequestSchema, req.body);
    res.status(201).json(await service.create(requestContext(req), input, requestMeta(req)));
  });

  router.patch('/:id', requirePermission('users:write'), async (req, res) => {
    const { id } = parseWith(idParamsSchema, req.params);
    const input = parseWith(updateUserRequestSchema, req.body);
    res.json(await service.update(requestContext(req), id, input, requestMeta(req)));
  });

  router.post('/:id/credentials', requirePermission('users:write'), async (req, res) => {
    const { id } = parseWith(idParamsSchema, req.params);
    const input = parseWith(setCredentialsRequestSchema, req.body);
    res.json(await service.setCredentials(requestContext(req), id, input, requestMeta(req)));
  });

  router.post('/:id/unlock', requirePermission('users:write'), async (req, res) => {
    const { id } = parseWith(idParamsSchema, req.params);
    res.json(await service.unlock(requestContext(req), id, requestMeta(req)));
  });

  return router;
}
