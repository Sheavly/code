---
description: The model picks a skill from its description and reads it and its linked file with read_skill
workspace: skills
check:
  {
    'areas':
      [
        'packages/workspace/src/skills',
        'packages/workspace/skills',
        'packages/coding/src/read-skill',
        'apps/backend/src/harness',
      ],
    'expect': { 'reply': ['Codename: Bluefin'], 'tools': ['read_skill'], 'outcome': 'completed' },
    'forbid': { 'transcript': ['team-greeting', 'skill not loaded'] },
  }
---

What is the next release called?
