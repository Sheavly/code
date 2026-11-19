---
description: .sheavly hooks load, and AGENTS.md reaches the model as instruction context
workspace: basic
check:
  {
    'areas':
      [
        'extensions/coding/src/project-hooks',
        'extensions/coding/src/agents-md',
        'extensions/coding/src/trust',
        'packages/host/src',
        'extensions/coding/src/extension',
        'apps/backend/src/harness',
        'apps/terminal/src/workbook',
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
