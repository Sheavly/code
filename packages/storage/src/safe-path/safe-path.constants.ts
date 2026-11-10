/**
 * Deleting a folder is retried while another program holds a file in it (Windows, with a virus
 * scanner or an indexer): Node tries again after a pause that grows with each attempt.
 */
export const RM_RETRIES = 5;
export const RM_RETRY_DELAY_MS = 50;

/** The suffix of a file a store names: a dot and a few lowercase letters (`.json`, `.jsonl`). */
export const PLAIN_EXTENSION = /^\.[a-z]{1,8}$/;
