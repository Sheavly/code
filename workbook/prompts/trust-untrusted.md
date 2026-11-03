---
description: workspace trust: a workspace nobody trusted loads none of its .sheavly hooks
workspace: basic
check: {
    "areas": ["packages/workspace/src/trust", "packages/workspace/src/project-hooks", "packages/host/src", "packages/coding/src/preset", "apps/terminal/src/harness", "apps/terminal/src/workbook/run.helper.ts"],
    "steps": [
      { "run": {},
        "expect": { "transcript": ["house-rules added context"], "outcome": "completed" } },
      { "untrust": true },
      { "run": { "keep": true },
        "expect": { "transcript": ["this workspace is not trusted"], "outcome": "completed" },
        "forbid": { "transcript": ["house-rules added context"], "events": ["context_added"], "reply": ["/Sheavly\\W*$/"] } }
    ]
  }
---

Read notes.md and tell me the answer it states.
