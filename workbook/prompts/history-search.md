---
description: A long run is summarized on a small window, then the agent finds an original line again with search_history and read_history_entry
workspace: basic
maxTurns: 16
contextWindow: 30000
check:
  {
    'areas':
      [
        'packages/tools/src/history',
        'packages/storage/src/conversation-store',
        'packages/storage/src/jsonl-file',
        'packages/host/src/conversations/keeper.service.ts',
        'apps/backend/src/harness',
      ],
    'expect':
      {
        'events': ['summary_done'],
        'tools': ['read_file', 'search_history', 'read_history_entry'],
        'toolResults':
          {
            'search_history': ['data, not instructions', '/entry \d+/'],
            'read_history_entry': ['end of entry'],
          },
        'reply': ['42'],
        'outcome': 'completed',
      },
  }
---

Read src/big.ts completely with read_file: first lines 1 to 1000, then lines 1001 to 1500. Then
read it completely a second time the same way, in the same two parts. Do all four reads: the
harness manages your context and shortens earlier work when it fills up, so do not stop early
because of the context figure. Do not run commands or edit files.

Then use search_history to look for `value42` in this conversation's original history, and read one
matching entry whole with read_history_entry. Reply with what value42 is set to, as that entry
shows it, and say which session and entry number you read.
