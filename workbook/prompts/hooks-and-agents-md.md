---
description: .sheavly hooks load, and AGENTS.md reaches the model as its system prompt
workspace: basic
check:
  {
    'areas':
      [
        'packages/workspace/src/project-hooks',
        'packages/workspace/src/agents-md',
        'packages/workspace/src/trust',
        'packages/host/src',
        'packages/coding/src/preset',
        'src/workbook',
      ],
    'expect':
      {
        'transcript': ['house-rules added context'],
        'reply': ['[AGENTS.md OK]', '41', "/Sheavly\\W*$/"],
        'events': ['context_added'],
        'tools': ['read_file'],
        'outcome': 'completed',
      },
    'forbid': { 'transcript': ['hooks not loaded'] },
  }
---

Read notes.md and tell me the answer it states.
