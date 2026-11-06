import type { PermissionSetup } from '../profiles/permission-setup.service.js';
import type { ApiHandlers, PermissionRouteName } from './api.types.js';

const done = (c: { body: (data: null, status: 204) => Response }) => c.body(null, 204);

/**
 * Each permission route's handler on `permissions`: one call on it and its result as the route
 * answers it. The folder is named in the body, as a path.
 */
export function permissionHandlers(
  permissions: PermissionSetup,
): Pick<ApiHandlers, PermissionRouteName> {
  return {
    queryPermissions: async ({ c, body }) => c.json(await permissions.read(body.workspace)),
    setPermissionMode: async ({ c, body }) => {
      await permissions.setMode({ workspace: body.workspace, mode: body.mode });

      return done(c);
    },
    allowCommand: async ({ c, body }) => {
      await permissions.allow({ workspace: body.workspace, entry: body.entry });

      return done(c);
    },
    revokeCommand: async ({ c, body }) => {
      await permissions.revoke({ workspace: body.workspace, entry: body.entry });

      return done(c);
    },
  };
}
