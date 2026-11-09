# @sheavly/summary

Built-in summarizers: rules-only sections and a model-based writer, written against the core Summarizer contract

A summarizer writes the sections of a checkpoint the loop appends when the context nears the
window. This package holds the ones a UI can pick, built on `@sheavly/core` and
`@sheavly/protocol` only, so a consumer without the loop can use them. It never learns what a
file is: what a tool call means is passed in by the app.

```ts
import { rulesSummarizer } from '@sheavly/summary/rules/rules.utils';
import { userMessagesSection } from '@sheavly/summary/sections/user-messages.utils';
import { windowSection } from '@sheavly/summary/sections/window.utils';

// A sliding window with no model and no cost, passed to the loop as `summary: { summarizer }`.
const summarizer = rulesSummarizer({ sections: [userMessagesSection(), windowSection] });
```

| Module      | What it holds                                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `rules/`    | `rulesSummarizer`: a summarizer whose sections are written by rules, merging each into the previous checkpoint's                        |
| `sections/` | `RuleSection` and `TrailExtractor`; the rules sections `userMessagesSection`, `trailSection` and `windowSection`; entry merging helpers |
| `errors/`   | `SummaryDefinitionError`: a summarizer defined with no sections or a repeated section id                                                |

## Docs

- [Design](docs/design.md): how it works, and how to extend it.
