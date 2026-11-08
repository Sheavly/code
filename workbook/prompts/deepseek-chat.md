---
description: Azure DeepSeek Chat Completions completes a two-tool conversation with native history
workspace: basic
maxTurns: 6
check:
  {
    'areas':
      [
        'packages/providers/src/chat-completions',
        'packages/providers/src/chat-reply',
        'packages/providers/src/azure/chat.adapter.ts',
        'packages/providers/src/azure/endpoint.validator.ts',
      ],
    'expect':
      {
        'tools': ['read_file'],
        'events': ['usage'],
        'reply': ['DEEPSEEK_CHAT_OK'],
        'outcome': 'completed',
        'adapter': 'azure-chat',
      },
  }
---

Read src/greet.ts with read_file. After that tool returns, read notes.md in a separate tool call.
Do not edit files or run commands. Reply with DEEPSEEK_CHAT_OK, the exported function's name,
and the answer in notes.md, while following the project's instructions.
