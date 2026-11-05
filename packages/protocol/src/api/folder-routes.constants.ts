import {
  allowEntryRequestSchema,
  setPermissionModeRequestSchema,
  workspacePermissionsSchema,
} from '../permission/permission.validator.js';
import {
  bindWorkspaceRequestSchema,
  trustedWorkspacesQuerySchema,
  trustedWorkspacesResponseSchema,
  workspaceProfileSchema,
  workspaceRequestSchema,
} from '../setup/setup.validator.js';
import type { ApiRoute } from './api.types.js';

/**
 * The routes on a folder the user works in, part of `API_ROUTES`: the profile it runs on, whether
 * its `.sheavly/` hooks are trusted, and what `run_command` may do in it. Each names the folder in
 * its body, as a path, since a UI knows the path and not the hash the config keeps.
 */
export const FOLDER_ROUTES = {
  queryWorkspaceProfile: {
    effect: 'read',
    method: 'query',
    path: '/workspace-profiles',
    summary:
      'The profile a folder runs on, and whether it was chosen for the folder or is the default',
    body: workspaceRequestSchema,
    response: { status: 200, schema: workspaceProfileSchema },
  },
  bindWorkspace: {
    effect: 'change',
    method: 'put',
    path: '/workspace-profiles',
    summary: 'Always run a folder on this profile, whatever the default is',
    body: bindWorkspaceRequestSchema,
    response: { status: 204 },
  },
  unbindWorkspace: {
    effect: 'change',
    method: 'post',
    path: '/workspace-profiles/unbind',
    summary: 'Run a folder on the default profile again',
    body: workspaceRequestSchema,
    response: { status: 204 },
  },
  queryTrustedWorkspaces: {
    effect: 'read',
    method: 'query',
    path: '/trusted-workspaces',
    summary: 'The workspaces trusted to run their .sheavly hooks, or those a path search matches',
    body: trustedWorkspacesQuerySchema,
    response: { status: 200, schema: trustedWorkspacesResponseSchema },
  },
  trustWorkspace: {
    effect: 'change',
    method: 'post',
    path: '/trusted-workspaces',
    summary: 'Trust a folder’s .sheavly hooks as they are now; refused unless the backend is local',
    body: workspaceRequestSchema,
    response: { status: 204 },
  },
  revokeWorkspace: {
    effect: 'change',
    method: 'post',
    path: '/trusted-workspaces/revoke',
    summary: 'Stop trusting a folder, also one that no longer exists',
    body: workspaceRequestSchema,
    response: { status: 204 },
  },
  queryPermissions: {
    effect: 'read',
    method: 'query',
    path: '/permissions',
    summary:
      'The mode a folder is in and the commands the user allowed there, and the built-in ones',
    body: workspaceRequestSchema,
    response: { status: 200, schema: workspacePermissionsSchema },
  },
  setPermissionMode: {
    effect: 'change',
    method: 'put',
    path: '/permissions/mode',
    summary:
      'How commands are treated in a folder from now on; a looser mode needs a local backend',
    body: setPermissionModeRequestSchema,
    response: { status: 204 },
  },
  allowCommand: {
    effect: 'change',
    method: 'post',
    path: '/permissions/allow',
    summary: 'Allow a command in a folder for good; refused unless the backend is local',
    body: allowEntryRequestSchema,
    response: { status: 204 },
  },
  revokeCommand: {
    effect: 'change',
    method: 'post',
    path: '/permissions/revoke',
    summary: 'Stop allowing a command in a folder',
    body: allowEntryRequestSchema,
    response: { status: 204 },
  },
} as const satisfies Record<string, ApiRoute>;
