/**
 * The largest file `read_file`, `edit_file` and `write_file` will load or produce. It is checked
 * from the file's size, before its content is read, so a huge file is refused instead of loaded.
 */
export const MAX_FILE_BYTES = 5_000_000;

/**
 * What the model is told for the file system errors a file tool can meet, by error code. The
 * system's own text carries absolute host paths, so the model gets one fixed phrase instead.
 */
export const FS_REFUSALS: Record<
  string,
  { reason: 'forbidden' | 'invalid_input' | 'unavailable'; text: string } | undefined
> = {
  EACCES: { reason: 'forbidden', text: 'Permission denied' },
  EPERM: { reason: 'forbidden', text: 'Permission denied' },
  EROFS: { reason: 'forbidden', text: 'Read-only file system' },
  EISDIR: { reason: 'invalid_input', text: 'Not a file' },
  ELOOP: { reason: 'invalid_input', text: 'Too many symbolic links' },
  ENAMETOOLONG: { reason: 'invalid_input', text: 'Path too long' },
  EEXIST: { reason: 'invalid_input', text: 'Something is already there' },
  ENOTEMPTY: { reason: 'invalid_input', text: 'Folder is not empty' },
  EMFILE: { reason: 'unavailable', text: 'Too many open files' },
  ENFILE: { reason: 'unavailable', text: 'Too many open files' },
  EBUSY: { reason: 'unavailable', text: 'File is busy' },
  ENOSPC: { reason: 'unavailable', text: 'No space left on the device' },
};

/** What the model is told for any other file system error code a file tool meets. */
export const FS_FAILURE = 'The file system refused the operation';

/** The shape of a system error code: short, capitals and digits, starting with `E`. */
export const SYSTEM_ERROR_CODE = /^E[A-Z0-9]{2,15}$/;
