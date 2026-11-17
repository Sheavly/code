---
description: workspace trust: a fresh fixture loads its .sheavly hooks; changed since trusted, they're skipped
workspace: basic
check: {
    "areas": ["extensions/coding/src/trust", "extensions/coding/src/project-hooks", "packages/host/src", "extensions/coding/src/preset", "apps/backend/src/harness", "apps/terminal/src/workbook/run.helper.ts", "apps/terminal/src/workbook/check.helper.ts", "apps/terminal/src/workbook/check.utils.ts", "apps/terminal/src/workbook/check.validator.ts"],
    "steps": [
      { "run": {},
        "expect": { "transcript": ["house-rules added context"], "reply": ["/Sheavly\\W*$/"], "contextHooks": ["house-rules"], "outcome": "completed" },
        "forbid": { "transcript": ["hooks not loaded"] } },
      { "append": { "file": ".sheavly/hooks/house-rules.mjs", "text": "\n// edited after it was trusted\n" } },
      { "run": { "keep": true },
        "expect": { "transcript": ["changed since you trusted this workspace"], "outcome": "completed" },
        "forbid": { "transcript": ["house-rules added context"], "contextHooks": ["house-rules"], "reply": ["/Sheavly\\W*$/"] } },
      { "run": { "keep": true, "trust": true },
        "expect": { "transcript": ["house-rules added context"], "reply": ["/Sheavly\\W*$/"], "contextHooks": ["house-rules"], "outcome": "completed" },
        "forbid": { "transcript": ["hooks not loaded"] } }
    ]
  }
---

Read notes.md and tell me the answer it states.
