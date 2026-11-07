---
name: adding-models
description: Adds a model or model family to the agent-prompt research and evaluation workflow, and identifies whether existing adapters suffice or backend work is needed. Use when extending model coverage, researching a new model, or planning prompt support for a new family in this repository.
---

# Adding models

Extend model coverage without copying prompts or confusing configuration with backend support.
Read the [prompt index](../../../docs/agent-prompts/README.md),
[research](../../../docs/agent-prompts/research.md), [design](../../../docs/agent-prompts/design.md)
and [evaluation](../../../docs/agent-prompts/evaluation.md) before changing the target set.
Their status matters: a proposed module, API or evaluation is not an implemented capability.

## 1. Identify the requested addition

Record the display name, provider model ID, deployed version/snapshot, endpoint platform,
protocol and intended use (main agent, child agent, or both). Keep those identities separate.
Check whether an alias now points to different weights; do not report a redirected alias as
the retired model. Ask for an unavailable identity rather than inventing it.

Distinguish the user's requested scope:

- Research/evaluation coverage: update the evidence and target matrix, not private settings.
- Local setup: use the app's supported setup path only when requested; keep credentials out of
  project files and captured research. A connection check is a real model call, not an offline test.
- Backend implementation: follow the route below and the project's code and Git workflows.

Do not read credentials or private profiles just to research public model guidance. Confirm counting
endpoint pricing rather than assuming it is paid; authenticated counting still needs authorization
to use credentials. Paid model calls, including connection checks, need an agreed cost limit.

## 2. Check existing support before proposing code

Model-first setup suggestions live in `apps/backend/src/profiles/model-catalog.constants.ts`.
Add an explicitly identified model and compatible hosting policy there when extending the guided
picker; the generic provider registry does not own model defaults. The catalogue test checks
unique choices and valid presets, and registered adapters filter which hosts are advertised.
Keep the custom-model path available. Never advertise an unimplemented backend as a working route.

Read the `sheavly-packages` skill, then the relevant workspace README before implementation.
Use the [provider guide](../../../packages/providers/docs/backends.md) for adapter/protocol details.

- Existing adapter and protocol: configure the model through the app when requested. Adding a
  model does not by itself require a new adapter, a built-in model catalogue or a prompt copy.
- New endpoint/backend on an existing protocol: assess an adapter, reusing that protocol's
  provider implementation and testing the endpoint mapping with fake HTTP responses.
- New protocol: plan a separate protocol implementation with its own request/stream translation;
  do not disguise Chat Completions or another API as Responses.

Document unsupported effort levels, thinking replay, tool calling, output limits, usage or cache
features. A request option that collects encrypted reasoning is not necessarily a thinking-mode
toggle. Return to the user for genuinely separate transport work rather than silently adding it
to a research-only request. No package reads settings or chooses the user's model.

## 3. Research the model and its family

Use current first-party model specifications and prompting/API guides. Record URLs, access dates
and immutable revisions for code sources. Separate provider claims, observed behavior, proposals
and unavailable evidence. Verify platform-specific support; upstream API guidance does not prove
that an Azure deployment or compatibility gateway implements it.

Cover instruction structure, persistence, scope, tool use, independent parallel calls, progress
updates, verbosity, thinking/effort, reasoning replay, caching and long-run failure modes.
Research new-generation differences even within an existing family. Do not transfer old model
guidance or assume equally named effort levels perform equivalent work.

Reuse relevant family findings and update differences in the existing research document. Do not
create a parallel model manifest or repeat the complete prior-art survey for an ordinary variant.
Check licences before adopting prompt text; prefer original wording.

## 4. Decide the prompt impact

Start by evaluating the existing shared candidate. A new model does not justify a new family
section automatically. Explain any proposed addition and the specific failure it addresses;
compare shared-only with that addition before treating it as an improvement.

Follow the reviewed design's ownership and storage. If the design is still a draft, propose its
changes for review before runtime implementation. Do not create hypothetical instruction modules.
Keep shared text in one definition, coding guidance out of generic consumers, and child-role
text separate. Tool syntax and capability limits belong with the actual tools.

If family selection is needed, establish it explicitly at model/provider construction, not from
display names or a protocol-wide family tag. Check that provider selection and instructions refer
to the same call, wrappers preserve the necessary identity, and pinned children get their own
model's guidance. Unknown identities must not acquire guessed family instructions.

## 5. Extend evaluation and cost evidence

Update the existing research target table and evaluation matrix consistently. Record effective
effort/thinking settings, endpoint/version and output limits. Add thinking and non-thinking
configurations where supported and relevant; do not imply support where it is absent.

Use the same behavioral cases and acceptance checks for paired baseline/candidate runs. For a
new family, include instruction ordering, changed project context, tool-error recovery, switching
and cross-family children where the harness supports them. Mark missing test mechanisms explicitly.

Measure exact candidate text using a verified tokenizer/version or authorized provider counting
API. Distinguish text counts from full rendered requests and main costs from child costs. Record
cache reads/writes/misses, applicable platform rates and measurement gaps; characters are not tokens.

Recalculate attempts and the spend proposal from the expanded matrix, including repetitions,
retries and child calls. Get approval before running. Keep raw artifacts in ignored workbook
run directories and sanitized summaries with hashes/run references in the research results.
Report blocked targets without removing them or declaring coverage complete.

Run existing targets again when shared prompt text or transport behavior changes. For an isolated
model addition, retain relevant regression coverage without claiming unchanged models were rerun.
An overall average cannot hide a safety or correctness regression on one model.

## 6. Validate and hand off

For runtime changes, test the affected boundaries with scripted providers/fake HTTP, update owning
workspace docs, and run `npm run check`. Real-model workbook checks are manual and paid, not CI.
For research-only changes, validate links, formatting and the repository gate without model calls.

Report the added identity/configurations, adapter decision, evidence, prompt impact, tests and
counts/costs, paid-run authorization, and remaining gaps. Do not call a new model supported merely
because it was added to a table or one connection check succeeded.
