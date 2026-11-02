/** Model calls per session (main and each sub-agent): room for multi-step sub-agent work. */
export const HOST_MAX_TURNS = 20;

/**
 * The backend and model the hosts use when the env names none. The providers have no defaults of
 * their own: whoever uses them picks the model.
 */
export const DEFAULT_ADAPTER = 'openai';
export const DEFAULT_MODEL = 'gpt-6.1-sol';

/** The trust store's file under the user's config folder (`$XDG_CONFIG_HOME` or `~/.config`). */
export const TRUST_STORE_PATH = ['sheavly', 'trusted-workspaces.json'];
