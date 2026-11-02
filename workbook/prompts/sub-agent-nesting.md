---
description: three levels of sub-agents; the third must not have start_agent
workspace: basic
check:
  {
    'areas': ['src/tools/sub-agent', 'src/runtime/sessions', 'src/host'],
    'expect': { 'tools': ['start_agent'], 'reply': ['start_agent'], 'outcome': 'completed' },
  }
---

Use start_agent to start one sub-agent titled "Level 2" with exactly this task: Use start_agent to start one sub-agent titled "Level 3" with exactly this task: List the names of every tool you have, and say clearly whether one of them is named start_agent. Then finish. -- Wait for Level 3's reply and pass it on word for word. -- Then wait for Level 2's reply and tell me exactly what Level 3 said about its tools.
