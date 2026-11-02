---
description: write_file + edit_file, then read both back
workspace: basic
check:
  {
    'areas':
      [
        'src/tools/write-file',
        'src/tools/edit-file',
        'src/tools/files',
        'src/runtime/file-locks',
        'src/runtime/workspace',
      ],
    'expect':
      {
        'reply': ['hej', 'a + b'],
        'tools': ['write_file', 'edit_file', 'read_file'],
        'outcome': 'completed',
      },
  }
---

Create src/math.ts exporting a function add(a: number, b: number) that returns a + b. Then edit src/greet.ts so the greeting is "hej" instead of "hello". Then read both files back and show me their contents.
