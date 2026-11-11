import { MAX_DELETE_BYTES } from './delete-file.constants.js';

export const DELETE_FILE_PROMPTS = {
  description:
    'Delete one file. Paths are relative to the workspace root. It refuses a folder, a symlink, ' +
    `.env files, paths outside the workspace and files over ${MAX_DELETE_BYTES} bytes; to remove ` +
    'a folder or a large file, use run_command.',
  path: 'File path, relative to the workspace root',
};
