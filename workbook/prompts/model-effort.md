---
description: A remembered model selection reaches a real tool-use conversation
workspace: basic
check:
  {
    'areas':
      [
        'apps/backend/src/profiles/models.helper.ts',
        'apps/backend/src/profiles/profiles.service.ts',
        'apps/backend/src/harness/served.helper.ts',
        'apps/terminal/src/client',
        'packages/storage/src/profile-registry',
        'packages/host/src/conversations',
        'packages/runtime/src/sessions',
        'packages/providers/src/switch',
        'packages/providers/src/anthropic-messages',
        'packages/providers/src/responses',
      ],
    'expect': { 'tools': ['read_file'], 'reply': ['EFFORT_OK'], 'outcome': 'completed' },
  }
---

Read src/greet.ts with read_file. Then reply with EFFORT_OK followed by the exported function's name. Do not edit any files or run commands.
