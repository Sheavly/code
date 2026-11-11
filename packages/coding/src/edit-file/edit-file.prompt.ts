export const EDIT_FILE_PROMPTS = {
  description:
    'Replace exact text in an existing file. `oldText` must match the file exactly ' +
    '(including whitespace) and occur once, unless `replaceAll` is true. You must read the ' +
    'file with read_file first; to create a file, use write_file.',
  path: 'File path, relative to the workspace root',
  oldText: 'The exact text to replace',
  newText: 'The text to put in its place',
  replaceAll: 'Replace every occurrence (default: only one)',
};
