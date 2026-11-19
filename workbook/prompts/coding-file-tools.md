---
description: Dedicated glob/grep discovery and safe creation/read/deletion without shell commands
workspace: basic
maxTurns: 12
check:
  {
    'areas':
      [
        'apps/backend/src/harness/harness.helper.ts',
        'extensions/coding/src/glob',
        'extensions/coding/src/grep',
        'extensions/coding/src/read-file',
        'extensions/coding/src/write-file',
        'extensions/coding/src/delete-file',
        'extensions/coding/src/file-reads',
        'packages/core/src/tool',
        'packages/host/src/instructions',
      ],
    'expect':
      {
        'tools': ['glob', 'grep', 'read_file', 'write_file', 'delete_file'],
        'toolResults':
          {
            'glob': ['src/greet.ts'],
            'grep': ['greeting'],
            'read_file': ['FILE_TOOL_DISPOSABLE'],
            'write_file': ['/Created/i'],
            'delete_file': ['/Deleted/i'],
          },
        'reply': ['FILE_TOOL_INTEGRATION_OK'],
        'outcome': 'completed',
      },
    'forbid':
      {
        'tools': ['run_command', 'edit_file'],
        'toolErrors':
          {
            'glob': ['/./s'],
            'grep': ['/./s'],
            'read_file': ['/./s'],
            'write_file': ['/./s'],
            'delete_file': ['/./s'],
          },
      },
  }
---

Use the dedicated file tools, not commands, for this small integration check. First use glob to
find the TypeScript files under src, then grep to find the greeting declaration, and read its file.
Do not change that file or any other existing file.

Create src/workbook-disposable.txt with write_file, containing the text FILE_TOOL_DISPOSABLE.
Read it back with read_file, then delete only that disposable file with delete_file. The read and
deletion depend on the creation, so do them in order. Do not request or execute shell commands.
Report the greeting declaration and which tools succeeded, then end with FILE_TOOL_INTEGRATION_OK.
