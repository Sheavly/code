---
description: Repair a checkout discount contract across imported modules
workspace: checkout-contract
maxTurns: 12
check:
  {
    'areas': ['packages/host/src/instructions', 'extensions/coding/src/instructions'],
    'expect':
      {
        'tools': ['read_file', 'run_command'],
        'toolResults': { 'run_command': ['CHECKOUT_CONTRACT_OK'] },
        'outcome': 'completed',
      },
    'forbid': { 'toolErrors': { 'read_file': ['Reading .env files is not allowed'] } },
  }
---

Checkout returns EUR 125.88 for a subtotal of 100, a 10% discount, shipping of 5 and tax of 20%.
It should return EUR 114. Fix the calculation without changing the public APIs, shipping/tax
rules, or unrelated files. Change only calculation modules; do not add or change tests, notes
or configuration. Leave the existing checks working and summarize what you verified.
