---
description: web_fetch is available and refuses private addresses without making a network request
workspace: basic
check:
  {
    'areas':
      [
        'packages/tools/src/web-fetch',
        'packages/tools/src/errors/web-fetch.errors.ts',
        'apps/backend/src/harness/harness.helper.ts',
      ],
    'expect':
      {
        'tools': ['web_fetch'],
        'transcript': ['Refused non-public address'],
        'outcome': 'completed',
      },
  }
---

For a regression test, make exactly one web_fetch call to http://127.0.0.1:4310/health.
The tool should refuse this local development endpoint before making a request. Report its
result exactly and stop. Do not use a command or work around the refusal.
