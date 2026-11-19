---
description: workspace trust: a workspace nobody trusted loads none of its .sheavly hooks
workspace: basic
check: {
    "areas": ["extensions/coding/src/trust", "extensions/coding/src/project-hooks", "packages/host/src", "extensions/coding/src/extension", "apps/backend/src/harness", "apps/terminal/src/workbook/run.helper.ts", "apps/terminal/src/workbook/check.helper.ts", "apps/terminal/src/workbook/check.utils.ts", "apps/terminal/src/workbook/check.validator.ts"],
    "steps": [
      { "run": {},
        "expect": { "transcript": ["house-rules added context"], "contextHooks": ["house-rules"], "outcome": "completed" } },
      { "untrust": true },
      { "run": { "keep": true },
        "expect": { "transcript": ["this workspace is not trusted"], "outcome": "completed" },
        "forbid": { "transcript": ["house-rules added context"], "contextHooks": ["house-rules"], "reply": ["/Sheavly\\W*$/"] } }
    ]
  }
---

Read notes.md and tell me the answer it states.
