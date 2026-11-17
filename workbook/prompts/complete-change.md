---
description: Complete a small runnable change and verify it without a tool-call recipe
workspace: invoice
maxTurns: 10
check:
  {
    'areas':
      [
        'packages/host/src/instructions',
        'packages/host/src/host',
        'packages/host/src/conversation',
        'extensions/coding/src/instructions',
        'extensions/coding/src/preset',
        'apps/backend/src/harness',
        'apps/terminal/src/workbook/check.helper.ts',
        'apps/terminal/src/workbook/check.utils.ts',
        'apps/terminal/src/workbook/check.validator.ts',
      ],
    'expect':
      {
        'tools': ['read_file', 'run_command'],
        'toolResults': { 'run_command': ['INVOICE_CHECK_OK'] },
        'outcome': 'completed',
      },
    'forbid': { 'toolErrors': { 'read_file': ['Reading .env files is not allowed'] } },
  }
---

The invoice total increases when I apply a discount. Fix that bug without changing the public
API or unrelated files. Leave the project in a working state and summarize the result.
