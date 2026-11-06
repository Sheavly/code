---
description: Git grep regex patterns are not mistaken for secret-file pathspecs
workspace: basic
check:
  {
    'areas': ['packages/coding/src/run-command'],
    'expect':
      { 'tools': ['run_command'], 'reply': ['GIT_GREP_PATTERN_OK'], 'outcome': 'completed' },
    'forbid': { 'transcript': ['foo.*: can name a .env file'] },
  }
---

Try this command exactly once using run_command:

```text
git grep -n 'foo.*' src
```

Do not edit files, retry or work around a refused command. It is acceptable for Git grep to
require an operation approval, or for the command to exit without a match. Its regex pattern
is not a file path and must not be called a potential secret file. Finish with
GIT_GREP_PATTERN_OK and explain whether it ran or needed approval. If the regex was incorrectly
classified as a secret-file path, instead finish with GIT_GREP_PATTERN_FAILED and quote that concern.
