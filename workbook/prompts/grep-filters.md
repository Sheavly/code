---
description: grep include filters are not secret-file operands, even when an unlisted command needs approval
workspace: basic
check:
  {
    'areas':
      [
        'packages/coding/src/run-command/command-base.utils.ts',
        'packages/coding/src/run-command/command-approval.helper.ts',
        'packages/coding/src/run-command/allow-entry.utils.ts',
        'packages/coding/src/run-command/run-command.utils.ts',
      ],
    'expect': { 'tools': ['run_command'], 'reply': ['GREP_FILTERS_OK'], 'outcome': 'completed' },
    'forbid': { 'reply': ['GREP_FILTERS_FAILED'] },
  }
---

Use run_command to try exactly this command once:

```sh
grep -rli greeting src --include=*.ts --include=*.tsx --include=*.md --exclude-dir=node_modules
```

Do not retry, install anything or work around an approval refusal. If the command runs, or is
refused only because grep is not allowlisted, finish with GREP_FILTERS_OK and explain which
happened. If the refusal calls an include/exclude filter a potential .env file, finish with
GREP_FILTERS_FAILED and quote that concern instead. Do not search for secrets.
