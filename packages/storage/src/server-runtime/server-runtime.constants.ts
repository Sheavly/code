/** The folder made under `$XDG_RUNTIME_DIR` for the server's lock socket and discovery file. */
export const RUNTIME_SUBFOLDER = 'sheavly';

/** How many hex characters of the home's hash name the server's socket or pipe. */
export const SERVER_HASH_LENGTH = 12;

/** The suffix of the lock socket file: `<hash>.sock`. */
export const SOCKET_SUFFIX = '.sock';

/** The start of a Windows named pipe's name; the hash follows. */
export const WINDOWS_PIPE_PREFIX = '\\\\.\\pipe\\sheavly-';

/** The highest pid Linux gives out; a number above it, or below 1, is no process to ask about. */
export const MAX_PROCESS_ID = 4_194_304;

/** The permission bits of a file mode, without its type and special bits. */
export const ALL_PERMISSION_BITS = 0o777;

/** The mode of the lock socket: the owner alone, whatever the umask of the process. */
export const SOCKET_MODE = 0o600;

/** The environment variable that names the per-user runtime folder (Linux). */
export const XDG_RUNTIME_VARIABLE = 'XDG_RUNTIME_DIR';
