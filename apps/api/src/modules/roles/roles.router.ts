import { permissionSchema, type RoleInfo, roleKeys, roleKeySchema } from '@pos/shared';
import { Router } from 'express';
import { requestContext } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import { canAssignScope } from '../users/users.service';

const order = new Map<string, number>(roleKeys.map((key, index) => [key, index]));

// The built-in roles with their permissions: the permission matrix. "assignable" says whether
// the person asking may give a role to somebody.
export function createRolesRouter(): Router {
  const router = Router();

  router.get('/', requirePermission('roles:read'), async (req, res) => {
    const { auth, db } = requestContext(req);
    const rows = await db.role.findMany();

    const data: RoleInfo[] = rows
      .map((row) => ({
        key: roleKeySchema.parse(row.key),
        name: row.name,
        scope: row.scope,
        permissions: (Array.isArray(row.permissions) ? row.permissions : []).filter(
          (value): value is RoleInfo['permissions'][number] =>
            permissionSchema.safeParse(value).success,
        ),
        assignable: canAssignScope(auth.scope, row.scope),
      }))
      .sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));

    res.json({ data });
  });

  return router;
}
