---
description: workspace trust: a fresh fixture loads its .sheavly hooks; changed since trusted, they're skipped
workspace: basic
check: {
    "areas": ["src/runtime/trust", "src/runtime/project-hooks", "src/host", "src/workbook/run.helper.ts"],
    "steps": [
      { "run": {},
        "expect": { "transcript": ["house-rules added context"], "reply": ["/Sheavly\\W*$/"], "events": ["context_added"], "outcome": "completed" },
        "forbid": { "transcript": ["hooks not loaded"] } },
      { "append": { "file": ".sheavly/hooks/house-rules.mjs", "text": "\n// edited after it was trusted\n" } },
      { "run": { "keep": true },
        "expect": { "transcript": ["changed since you trusted this workspace"], "outcome": "completed" },
        "forbid": { "transcript": ["house-rules added context"], "events": ["context_added"], "reply": ["/Sheavly\\W*$/"] } },
      { "run": { "keep": true, "trust": true },
        "expect": { "transcript": ["house-rules added context"], "reply": ["/Sheavly\\W*$/"], "outcome": "completed" },
        "forbid": { "transcript": ["hooks not loaded"] } }
    ]
  }
---

Read notes.md and tell me the answer it states.
