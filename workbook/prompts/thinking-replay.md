---
description: A multi-read diagnosis that makes Claude think between tool calls, to see whether signed thinking is replayed or dropped when a transient notice rides every call
workspace: checkout-contract
maxTurns: 12
check:
  {
    'areas':
      [
        'packages/providers/src/anthropic-messages',
        'packages/loop/src/stream-agent/sample.helper.ts',
        'packages/core/src/provider',
      ],
    'expect': { 'tools': ['read_file'], 'reply': ['THINKING_OK'], 'outcome': 'completed' },
    'forbid': { 'tools': ['write_file', 'edit_file', 'run_command'] },
  }
---

A 10% discount on a subtotal of 100, shipping of 5 and tax of 20% gives 125.88, not 114. Find the
cause by reading one file per tool call, and decide which file to read next only after thinking
about what the previous one showed. Start at checkout.mjs and follow the calculation through its
imports. Do not edit files or run commands. Finish with THINKING_OK, then the file and the rule
that is wrong, in one sentence.
