---
description: read_file's 1000-line cap, a line range, and paging on
workspace: basic
check:
  {
    'areas': ['src/tools/read-file'],
    'expect':
      {
        'reply': ['42', '1500'],
        'tools': ['read_file'],
        'transcript': ['lines 40–45'],
        'outcome': 'completed',
      },
  }
---

Read only lines 40 to 45 of src/big.ts and tell me what value42 is set to. Then read all of src/big.ts and tell me the value of the last export.
