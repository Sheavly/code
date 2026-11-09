---
description: Editing AGENTS.md does not invalidate signed thinking on later tool calls
workspace: basic
check:
  {
    'areas':
      [
        'packages/core/src/provider',
        'packages/loop/src/stream-agent/sample.helper.ts',
        'packages/providers/src/anthropic-messages',
        'packages/workspace/src/agents-md',
        'packages/workspace/src/instruction-context',
        'packages/workspace/src/skills',
        'packages/host/src/conversation',
      ],
    'expect':
      { 'tools': ['read_file', 'edit_file'], 'reply': ['PREFIX_OK'], 'outcome': 'completed' },
  }
---

Read AGENTS.md, then use edit_file to append this line without changing the existing rules:
`<!-- signed-prefix check -->`
After that edit completes, read notes.md in a separate tool call. Reply with PREFIX_OK and the
answer from notes.md, following the project's instructions. Do not run commands.
