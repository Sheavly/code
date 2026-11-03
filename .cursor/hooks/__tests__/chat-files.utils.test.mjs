import { describe, expect, it } from 'vitest';
import { chatEditedFiles, editedFilesFields } from '../chat-files.utils.mjs';

describe('the files a chat edited', () => {
  it('records each file with when it was edited, and lists them', () => {
    const first = editedFilesFields({ state: null, files: ['a.ts'], now: 1 });
    const second = editedFilesFields({ state: first, files: ['b.ts'], now: 2 });

    expect(second).toEqual({
      editedProjectSource: true,
      editedFiles: { 'a.ts': 1, 'b.ts': 2 },
      editedFilesComplete: true,
    });
    expect(chatEditedFiles(second)).toEqual(['a.ts', 'b.ts']);
  });

  it('lists none for a chat that edited before files were recorded, so its gate stays whole', () => {
    const legacy = { editedProjectSource: true };
    const later = editedFilesFields({ state: legacy, files: ['a.ts'], now: 1 });

    expect(later.editedFilesComplete).toBe(false);
    expect(chatEditedFiles(later)).toBeNull();
    expect(chatEditedFiles(legacy)).toBeNull();
  });
});
