---
description: Context telemetry stays silent while the agent completes a multi-call task
workspace: basic
maxTurns: 4
check:
  {
    'areas':
      [
        'packages/core/src/notice',
        'packages/protocol/src/notice',
        'packages/core/src/provider',
        'packages/loop/src/context',
        'packages/loop/src/stream-agent/sample.helper.ts',
        'packages/providers/src/anthropic-messages/input.utils.ts',
        'packages/providers/src/responses/responses.helper.ts',
        'packages/providers/src/chat-completions/request.utils.ts',
      ],
    'expect':
      {
        'outcome': 'completed',
        'events': ['usage', 'harness_notice'],
        'tools': ['read_file'],
        'reply': ['/^\[AGENTS\.md OK\]\s+NOTICE_OK greeting 41\s+Sheavly\s*$/'],
      },
    'forbid':
      {
        'transcript':
          [
            '/harness[ -]telemetry/i',
            '/context (window|usage|line|notice)/i',
            '/tokens used/i',
            '<harness-notice',
          ],
        'tools': ['write_file', 'edit_file', 'run_command'],
      },
  }
---

Read src/greet.ts with read_file. After receiving its result, read notes.md in a separate call.
Then reply with NOTICE_OK, the exported constant's name, and the answer from notes.md, separated
by spaces and following the project's final-answer rules. Do not edit files or run commands.
