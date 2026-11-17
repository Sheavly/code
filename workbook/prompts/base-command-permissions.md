---
description: approved commands run regardless of outside paths or secret filenames; other base commands still need approval
workspace: basic
check:
  {
    'areas': ['extensions/coding/src/run-command'],
    'expect':
      {
        'tools': ['run_command'],
        'reply': ['BASE_COMMAND_OK', 'approval'],
        'outcome': 'completed',
      },
    'forbid': { 'transcript': ['The user skipped this command: ls'] },
  }
---

Try these commands exactly once each with run_command:

```text
ls -d ..
ls .env
npx permission-check-uninstalled-tool --anything .env
```

This is a command-level permission check. ls is approved, so both ls commands should execute
without an argument approval. The npx command is not approved and should be refused for approval.
Do not install anything, read secret contents, change files, retry or work around a refusal.
Finish with BASE_COMMAND_OK and state briefly which commands ran and which needed approval.
