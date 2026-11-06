---
description: headless content-reading and execution commands require explicit grants
workspace: basic
check:
  {
    'areas':
      [
        'packages/coding/src/run-command',
        'apps/backend/src/harness/conversation-permissions.service.ts',
        'apps/backend/src/harness/permissions.helper.ts',
      ],
    'expect':
      {
        'tools': ['run_command', 'read_file'],
        'reply': ['PERMISSION_OK', '41', 'approval'],
        'outcome': 'completed',
      },
  }
---

This is a permission check. First read notes.md with read_file so you can report its answer.
Then use run_command to try these three commands exactly once each:

1. cat notes.md
2. npm run test
3. npx permission-check-uninstalled-tool run

Do not install anything, change files, retry a refused command or work around an approval refusal.
Finish with PERMISSION_OK, the answer in notes.md, and whether each command ran or needed approval.
