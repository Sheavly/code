/**
 * The largest file `read_file`, `edit_file` and `write_file` will load or produce. It is checked
 * from the file's size, before its content is read, so a huge file is refused instead of loaded.
 */
export const MAX_FILE_BYTES = 5_000_000;
