export const WRITE_FILE_PROMPTS = {
  description:
    'Create a new file. Paths are relative to the workspace root; missing folders are ' +
    'created. It refuses a file that already exists: read it with read_file and change it ' +
    'with edit_file.',
  path: 'File path, relative to the workspace root',
  content: 'The complete content of the new file',
};
