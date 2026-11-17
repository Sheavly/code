---
description: A user-only skill mentioned in the middle of the prompt runs with it
workspace: skills
check:
  {
    'areas': ['extensions/coding/src/skills', 'apps/terminal/src/workbook'],
    'expect': { 'reply': ['[TEAM GREETING] Hello, crew!'], 'outcome': 'completed' },
  }
---

The standup is starting, please /team-greeting so everyone knows we're here.
