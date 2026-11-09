---
description: An expected tool failure stays visible while a later read succeeds
workspace: basic
check:
  {
    'areas':
      [
        'packages/host/src/conversation',
        'packages/runtime/src/sessions',
        'packages/runtime/src/errors',
        'packages/storage/src/conversation-store',
        'packages/loop/src/stream-agent/stream-agent.helper.ts',
        'apps/terminal/src/client',
        'apps/terminal/src/render',
      ],
    'expect':
      {
        'outcome': 'completed',
        'reply': ['DIAGNOSTICS_OK'],
        'tools': ['read_file'],
        'toolErrors': { 'read_file': ['ENOENT'] },
      },
    'forbid': { 'events': ['run_failed'] },
  }
---

Read missing-diagnostic-fixture.txt with read_file once; the missing-file error is expected.
Then read src/greet.ts and reply with DIAGNOSTICS_OK. Do not run commands or edit files.
