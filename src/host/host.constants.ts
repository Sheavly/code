/** Model calls per session (main and each sub-agent): room for multi-step sub-agent work. */
export const HOST_MAX_TURNS = 20;

/** The trust store's file under the user's config folder (`$XDG_CONFIG_HOME` or `~/.config`). */
export const TRUST_STORE_PATH = ['sheavly', 'trusted-workspaces.json'];
