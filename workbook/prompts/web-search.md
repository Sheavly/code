---
description: discover public documentation through keyless web_search
workspace: basic
maxTurns: 4
check:
  {
    'areas':
      [
        'packages/tools/src/web-search',
        'packages/tools/src/web-search-backends',
        'packages/tools/src/errors/web-search.errors.ts',
        'apps/backend/src/harness/harness.helper.ts',
      ],
    'expect':
      {
        'tools': ['web_search'],
        'toolResults': { 'web_search': ['https://', '"results"'] },
        'reply': ['https://'],
        'outcome': 'completed',
      },
    'forbid': { 'tools': ['web_fetch', 'run_command'] },
  }
---

Use web_search to find the official Node.js documentation for AbortSignal. Make one search with
the query "Node.js official documentation AbortSignal" and report a result's title and URL.
Use the returned search evidence, not recalled URLs. Do not fetch pages or run commands. If
search is unavailable or rate-limited, report that failure rather than inventing a result.
