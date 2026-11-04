/**
 * Deleting a folder is retried while another program holds a file in it (Windows, with a virus
 * scanner or an indexer): Node tries again after a pause that grows with each attempt.
 */
export const RM_RETRIES = 5;
export const RM_RETRY_DELAY_MS = 50;
