/**
 * The mode of every file and folder the user's data is kept in, where the system has file modes:
 * readable by the user alone, since their conversations and model setup are personal and the
 * credentials file sits in the same tree. Windows has no such modes and ignores these; there the
 * protection is the permissions of the user's profile folder (the user, SYSTEM and administrators),
 * where `~/.sheavly` lives.
 */
export const PRIVATE_FILE_MODE = 0o600;
export const PRIVATE_FOLDER_MODE = 0o700;

/** The character code of the byte-order mark some Windows editors put at the start of a file. */
export const BYTE_ORDER_MARK = 0xfeff;

/** The mode bits that let anyone but the owner read, write or run a file: `0o077`. */
export const GROUP_AND_OTHERS = 0o077;

/**
 * The errors a rename gives while another program briefly holds a file (Windows, with a virus
 * scanner or an indexer): worth another try, unlike every other error.
 */
export const BUSY_FILE_CODES: readonly string[] = ['EPERM', 'EBUSY', 'EACCES'];

/** How often a rename is tried, and how long it waits after the first failure (then twice, ...). */
export const RENAME_ATTEMPTS = 5;
export const RENAME_RETRY_DELAY_MS = 20;
