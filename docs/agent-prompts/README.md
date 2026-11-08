# Agent prompts

Cross-workspace research and design for the instructions main agents and sub-agents receive.
Minimal shared defaults are implemented: a domain-neutral core, a short coding extension and
a compact child role. Host extras, explicit core replacement and conversation overrides retain
their existing semantics. Runtime wording is original and defined once in the owning packages.

The user chose this small default to move forward rather than extend the comparison program.
Earlier drafts, two Sonnet comparisons, token measurements and limitations remain recorded in
[research](research.md) and [results](results.md). Those measurements describe their exact older
text, not the new default. No universal performance or safety claim is made from them.

All six target models are configured. Broader comparisons, unresolved GPT measurements and
provider-pricing/output-control gaps are deferred, not silently marked complete. No family
overlay, new planning mode or expanded evaluation suite is part of the minimal implementation.
One final bounded Sonnet smoke case passed with the implemented default and no conversation
override; its result and limits are recorded in [results](results.md#minimal-default-decision).

The branch also implements [model-first setup](../../apps/terminal/docs/chat.md#model-first-setup).
Its app-owned catalogue separates chosen model identity from hosting routes and credentials;
this does not select family-specific agent prompts or add unimplemented provider adapters.

## Reading order

| Document                    | Purpose                                                                                   | Status                                       |
| --------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------- |
| [Research](research.md)     | Current instruction flow, provider evidence, pinned prior-art sources and comparison gaps | In progress                                  |
| [Design](design.md)         | Prompt storage, ownership, assembly and remaining research decisions                      | Minimal default implemented                  |
| [Evaluation](evaluation.md) | Behavioral cases, comparison conditions, scoring, artifacts and cost controls             | Two stages recorded; further work deferred   |
| [Results](results.md)       | Bounded smoke and comparative outcomes, with their limitations                            | Repair/boundary passed; plan requests failed |

Research describes observed evidence and its limitations. Design describes proposed decisions
and alternatives. Evaluation describes how those proposals can be measured. Keep those roles
separate so a provider recommendation or a design preference cannot be mistaken for a result.

## Storage boundaries

- This folder holds the cross-workspace investigation and rationale, not runtime prompt assets.
- Runtime text belongs in the owning workspace's instruction module, following the proposed
  [source layout](design.md#runtime-source-layout). Docs link to those single maintained definitions.
- Workbook task prompts and disposable fixture projects stay in [the workbook](../../workbook/README.md).
- Raw captured runs stay in the workbook's ignored run directories. They are not research docs
  and may contain private request data.
- Add `results.md` only when measurements exist. Record sanitized results, prompt/source hashes,
  tokenizer versions, model identities, rates and run references. Do not create empty results
  tables that look like a completed experiment.

## Next review checkpoint

For a new model or family, use the [adding-models skill](../../.agents/skills/adding-models/SKILL.md).
It separates target coverage, local setup and backend work, and keeps research, prompt changes
and paid evaluation decisions explicit.

The user approved shipping minimal shared wording with the existing domain split and host
option semantics. Keep later changes tied to demonstrated gaps rather than adding speculative
rules. Further paid comparisons require an explicit request and agreed spend cap.

Paid runs require a separately agreed model/version matrix and spend limit. Implementation and
evaluation results should update the relevant workspace docs and the [overview](../overview.md)
when the behavior actually changes; this folder does not replace those API and architecture docs.
