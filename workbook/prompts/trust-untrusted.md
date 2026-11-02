---
description: workspace trust: a workspace nobody trusted loads none of its .sheavly hooks
workspace: basic
check: {
    "areas": ["src/runtime/trust", "src/runtime/project-hooks", "src/host", "src/workbook/run.helper.ts"],
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
