/**
 * The largest file `read_file`, `edit_file` and `write_file` will load or produce. It is checked
 * from the file's size, before its content is read, so a huge file is refused instead of loaded.
 */
export const MAX_FILE_BYTES = 5_000_000;

/**
 * What the model is told for the file system errors a file tool can meet, by error code. The
 * system's own text carries absolute host paths, so the model gets one fixed phrase instead.
 */
export const FS_REFUSALS: Record<string, string | undefined> = {
  EACCES: 'Permission denied',
  EPERM: 'Permission denied',
  EISDIR: 'Not a file',
  ELOOP: 'Too many symbolic links',
};
