---
description: write_file + edit_file, then read both back
workspace: basic
check:
  {
    'areas':
      [
        'packages/coding/src/write-file',
        'packages/coding/src/edit-file',
        'packages/coding/src/files',
        'packages/workspace/src/file-locks',
        'packages/workspace/src/file-reads',
        'packages/workspace/src/workspace',
        'packages/loop/src/stream-agent',
        'packages/loop/src/queue',
        'packages/loop/src/hooks',
        'packages/loop/src/abort',
        'packages/loop/src/events',
        'packages/providers/src/responses',
        'packages/providers/src/openai',
        'packages/providers/src/azure',
        'apps/terminal/src/render',
        'apps/terminal/src/client',
        'apps/backend/src/serve.ts',
        'packages/client/src',
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
