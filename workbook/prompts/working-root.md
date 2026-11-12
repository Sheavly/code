---
description: set_working_root makes relative paths start in a git work tree, and clearing it undoes that
workspace: basic
maxTurns: 14
check:
  {
    'areas':
      [
        'packages/coding/src/working-root',
        'packages/coding/src/files',
        'packages/coding/src/ripgrep',
        'packages/workspace/src/working-root',
        'packages/host/src/instructions',
        'apps/backend/src/harness/harness.helper.ts',
      ],
    'expect':
      {
        'tools': ['run_command', 'set_working_root', 'write_file', 'read_file'],
        'toolResults':
          {
            'set_working_root': ['/Working root set to .*wt/', '/Working root cleared/'],
            'write_file': ['/Created hello\.txt/'],
            'read_file': ['WORKING_ROOT_NOTE'],
          },
        'reply': ['WORKING_ROOT_OK'],
        'outcome': 'completed',
        'adapter': 'azure-chat',
      },
    'forbid':
      {
        'tools': ['edit_file', 'delete_file'],
        'toolErrors':
          { 'set_working_root': ['/./s'], 'write_file': ['/./s'], 'read_file': ['/./s'] },
      },
  }
---

Make a new git repository in a folder named wt inside the workspace (run_command: git init wt). Then
call set_working_root with wt. Create hello.txt with write_file, using exactly that relative path
and the text WORKING_ROOT_NOTE. Next call set_working_root with no path to go back to the workspace
root, and read wt/hello.txt with read_file to confirm the file landed in the work tree. Do not edit
or delete any other file. Report which tools you used and end with WORKING_ROOT_OK.
