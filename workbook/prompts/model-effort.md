---
description: A remembered model selection reaches a real tool-use conversation with reported usage
workspace: basic
check:
  {
    'areas':
      [
        'apps/backend/src/profiles/models.helper.ts',
        'apps/backend/src/profiles/profiles.service.ts',
        'apps/backend/src/harness/served.helper.ts',
        'apps/terminal/src/client',
        'apps/terminal/src/usage',
        'apps/terminal/src/errors/backend.errors.ts',
        'apps/terminal/src/tui/screen-chat.helper.ts',
        'apps/terminal/src/tui/tui.types.ts',
        'apps/terminal/src/tui/view.utils.ts',
        'apps/terminal/src/react-screen/activity.component.tsx',
        'packages/storage/src/profile-registry',
        'packages/host/src/conversations',
        'packages/runtime/src/sessions',
        'packages/providers/src/switch',
        'packages/providers/src/anthropic-messages',
        'packages/providers/src/responses',
        'packages/loop/src/stream-agent/sample.helper.ts',
        'packages/runtime/src/usage',
        'apps/backend/src/usage',
      ],
    'expect':
      {
        'tools': ['read_file'],
        'reply': ['EFFORT_OK'],
        'events': ['usage'],
        'outcome': 'completed',
      },
  }
---

Read src/greet.ts with read_file. Then reply with EFFORT_OK followed by the exported function's name. Do not edit any files or run commands.
