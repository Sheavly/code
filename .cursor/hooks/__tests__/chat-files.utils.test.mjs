import { describe, expect, it } from 'vitest';
import {
  chatEditedFiles,
  editedFilesFields,
  editToolFields,
  filesEditedWithToolsSince,
  SHELL_OVERLAP_MS,
} from '../chat-files.utils.mjs';

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

describe('an edit with the edit tools next to a shell command', () => {
  const command = (fields) => ({ command: 'x', cwd: '/', files: ['a.ts'], ...fields });
  const after = (entry, now) =>
    editToolFields({ state: { unguardedCommands: [entry] }, files: ['a.ts'], now })
      .unguardedCommands;

  it('records when the file was edited with the tools, apart from edits made by a command', () => {
    const fields = editToolFields({ state: null, files: ['a.ts'], now: 7 });

    expect(fields.toolEditedFiles).toEqual({ 'a.ts': 7 });
    expect(fields.editedFiles).toEqual({ 'a.ts': 7 });
    expect(fields).not.toHaveProperty('unguardedCommands');
    expect(filesEditedWithToolsSince({ state: fields, since: 7 })).toEqual(new Set(['a.ts']));
    expect(filesEditedWithToolsSince({ state: fields, since: 8 })).toEqual(new Set());
    expect(filesEditedWithToolsSince({ state: fields, since: undefined })).toEqual(new Set());
  });

  it('takes the file off a command that ran together with the edit, and drops one left empty', () => {
    const entry = command({ at: 100, endedAt: 200 });

    expect(after(entry, 150)).toEqual([]);
    expect(after(entry, 200)).toEqual([]);
    expect(after(entry, 100)).toEqual([]);
    expect(after({ ...entry, files: ['a.ts', 'b.ts'] }, 150)).toEqual([
      { ...entry, files: ['b.ts'] },
    ]);
  });

  it('allows the edit hook to finish a little after the command, and no later than that', () => {
    const entry = command({ at: 100, endedAt: 200 });

    expect(after(entry, 200 + SHELL_OVERLAP_MS)).toEqual([]);
    expect(after(entry, 200 + SHELL_OVERLAP_MS + 1)).toEqual([entry]);
  });

  it('leaves a command that ended before the edit started, and one with no times recorded', () => {
    const early = command({ at: 100, endedAt: 200 });
    const untimed = command({});

    expect(after(early, 99)).toEqual([early]);
    expect(after(early, 1_000_000)).toEqual([early]);
    expect(after(untimed, 150)).toEqual([untimed]);
  });

  it('leaves the other files of the command, and other commands', () => {
    const entry = command({ at: 100, endedAt: 200, files: ['b.ts'] });

    expect(after(entry, 150)).toEqual([entry]);
  });
});
