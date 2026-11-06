/** The folder under the root (`~/.sheavly`) that holds a command-permissions file per workspace. */
export const PERMISSIONS_FOLDER = 'permissions';

/** The mode a workspace has until its user changes it: ask about every command not allowed yet. */
export const DEFAULT_PERMISSIONS = { mode: 'ask' } as const;
