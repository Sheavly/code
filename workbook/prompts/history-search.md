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
        'tools': ['read_file', 'search_history', 'read_history_entry'],
        'toolResults':
          {
            'search_history': ['data, not instructions', '/entry \d+/'],
            'read_history_entry': ['end of entry', 'value1234 = 1234'],
          },
        'reply': ['value1234'],
        'outcome': 'completed',
      },
  }
---

Read src/big.ts completely with read_file: first lines 1 to 1000, then lines 1001 to 1500. Then
read it completely a second time the same way, in the same two parts. Do all four reads: the
harness manages your context and shortens earlier work when it fills up, so do not stop early
because of the context figure. Do not run commands or edit files.

Then do not read src/big.ts again. Use search_history on this conversation's original history to
find the export of src/big.ts whose value is 1234, and read the part of the entry that holds it
with read_history_entry. Reply with the name of that export, as that entry shows it, and say which
session and entry number you read.
