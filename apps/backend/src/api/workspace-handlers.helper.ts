import type { WorkspaceSetup } from '../profiles/workspace-setup.service.js';
import type { ApiHandlers, WorkspaceRouteName } from './api.types.js';

const done = (c: { body: (data: null, status: 204) => Response }) => c.body(null, 204);

/**
 * Each folder route's handler on `workspaces`: one call on it and its result as the route answers
 * it. The folder is named in the body, as a path, since a UI knows the path and not the hash the
 * config keeps.
 */
export function workspaceHandlers(
  workspaces: WorkspaceSetup,
): Pick<ApiHandlers, WorkspaceRouteName> {
  return {
    queryWorkspaceProfile: async ({ c, body }) =>
      c.json(await workspaces.profileOf(body.workspace)),
    bindWorkspace: async ({ c, body }) => {
      await workspaces.bind({ workspace: body.workspace, profile: body.profile });

      return done(c);
    },
    unbindWorkspace: async ({ c, body }) => {
      await workspaces.unbind(body.workspace);

      return done(c);
    },
    queryTrustedWorkspaces: async ({ c, body }) =>
      c.json({ workspaces: await workspaces.trusted(body.search) }),
    trustWorkspace: async ({ c, body }) => {
      await workspaces.trust(body.workspace);

      return done(c);
    },
    revokeWorkspace: async ({ c, body }) => {
      await workspaces.revoke(body.workspace);

      return done(c);
    },
  };
}
