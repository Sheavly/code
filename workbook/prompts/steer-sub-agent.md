---
description: steer a running sub-agent with message_agent ("puppies"), without cancelling it
workspace: basic
check:
  {
    'areas': ['packages/tools/src/sub-agent', 'packages/runtime/src/sessions'],
    'expect':
      { 'tools': ['start_agent', 'message_agent'], 'reply': ['/pupp/i'], 'outcome': 'completed' },
  }
---

Use start_agent to start one sub-agent titled "Dog research" with exactly this task: Research dogs, in steps, calling report_status before each step: 1) create notes/dogs.md with a "# Dogs" heading, 2) add three facts with edit_file, one fact per call, 3) read the file back, 4) reply with a short summary. -- Right after it has started, use message_agent to send it exactly: I specifically care about puppies. -- Then wait for its final reply and tell me what it found.
