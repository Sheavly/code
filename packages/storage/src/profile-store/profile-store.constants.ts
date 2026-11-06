/** The folder under the root that holds every profile, one folder each. */
export const PROFILES_FOLDER = 'profiles';

/** A profile's own file, inside its folder: `{ id, name }`. */
export const PROFILE_FILE = 'profile.json';

/** The folder in a profile that holds its workspaces, one folder each named by a workspace key. */
export const WORKSPACES_FOLDER = 'workspaces';

/** Inside a workspace's folder: `{ root }`, the path its key is a hash of, for a person to read. */
export const WORKSPACE_FILE = 'workspace.json';
