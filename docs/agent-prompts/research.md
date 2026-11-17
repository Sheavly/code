# Agent prompt research

Status: research in progress, not an approved design. Reviewed sources below were accessed on
2026-11-07. No runtime prompt has been changed and no real-model evaluation has been run.

This is a cross-workspace investigation of instructions, providers, coding composition and
sub-agents. The companion [evaluation plan](evaluation.md) defines how proposed
changes can be compared without treating provider recommendations as measured results.

## Current instruction flow

Source baseline: `bcd841965efa7f900719b306b084ca4865b256c3`.

| Boundary            | Observed behavior                                                                                                                                              | Source                                                                                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Generic host        | Creates registries and wraps the supplied provider for model-call observation; returns no instructions.                                                        | [host.helper.ts](../../packages/host/src/host/host.helper.ts)                                                                                                  |
| Conversation        | Passes its optional `instructions` to each run; does not obtain any from the harness.                                                                          | [conversation.helper.ts](../../packages/host/src/conversation/conversation.helper.ts)                                                                          |
| Coding backend      | Composes tools and hooks; does not supply main-agent or sub-agent extras.                                                                                      | [harness.helper.ts](../../apps/backend/src/harness/harness.helper.ts), [conversation.helper.ts](../../apps/backend/src/harness/conversation.helper.ts)         |
| Loop                | Runs before-turn hooks and joins run instructions before the hooks' system-instruction additions.                                                              | [turn.helper.ts](../../packages/loop/src/stream-agent/turn.helper.ts)                                                                                          |
| AGENTS.md           | Reads applicable files before each turn and appends changed instructions to conversation history.                                                              | [agents-md.helper.ts](../../extensions/coding/src/agents-md/agents-md.helper.ts)                                                                               |
| Instruction context | Deduplicates the latest instruction context and appends changes rather than editing earlier messages.                                                          | [instruction-context.helper.ts](../../packages/core/src/instruction-context/instruction-context.helper.ts)                                                     |
| Sub-agent           | Starts with its own built-in rules, followed by explicitly supplied extras; it does not inherit the parent's conversation.                                     | [sub-agent.tool.ts](../../packages/tools/src/sub-agent/sub-agent.tool.ts), [sub-agent.constants.ts](../../packages/tools/src/sub-agent/sub-agent.constants.ts) |
| Model switching     | Selects the active provider at the next call; an existing stream stays with its original provider. Pinned providers support a separately selected child model. | [switch.service.ts](../../packages/providers/src/switch/switch.service.ts)                                                                                     |

The backend gives children file tools, skills and optional web fetching, but not the command
tool or project hooks. Nested children receive additional orchestration tools below the depth
cap. A shared prompt must not promise tools that a particular child does not have.

The terminal workbook starts a backend for each run. Its recorded model calls include the
instructions sent to main and child sessions. See [the workbook](../../apps/terminal/docs/workbook.md).

### Design constraints established by the code

- The host is generic. A coding identity, workspace rules and command policy cannot silently
  become requirements for all consumers. Decide the generic core versus coding extension explicitly.
- AGENTS.md and skills are conversation context today, not suffixes of `request.instructions`.
  Preserve that distinction in both the design and ordering tests.
- The [provider contract](../../packages/core/src/provider/provider.types.ts) exposes `stream`
  only, and the [adapter contract](../../packages/core/src/adapter/adapter.types.ts) has no family
  field. Family selection is a design question, not an existing capability.
- A protocol or backend is not a model family. An Azure Responses adapter can serve more than
  one family, so tagging that adapter as GPT would be incorrect.
- Select any family instructions consistently with the provider used for that call. A prompt
  chosen only when the conversation starts can become stale after a switch.
- Keep model reasoning provenance intact. Existing Messages providers replay signed thinking
  only when its request prefix still matches; see the [providers README](../../packages/providers/README.md).
- Prompt wording is not a security boundary. Workspace confinement, permissions and approvals
  must continue to be enforced by tools and services.

## Target models and identity checks

| Requested target  | Public documentation identity                        | Research status                                                                                                  |
| ----------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| GPT-6.1 Sol       | `gpt-6.1-sol`                                        | Family guidance and individual specification reviewed; deployment and tokenizer counts unverified.               |
| Astra 6           | `gpt-6-astra`                                        | Astra-specific family guidance and individual specification reviewed; deployment/counts unverified.              |
| Luna 6            | `gpt-6-luna`                                         | Individual specification reviewed; Astra observations are not measured Luna results.                             |
| Opus 5.5          | `claude-opus-5-5`                                    | Dedicated prompting guide reviewed. Azure deployment equivalence needs confirmation.                             |
| Sonnet 5.5        | `claude-sonnet-5-5`                                  | Dedicated prompting guide reviewed. Azure deployment equivalence needs confirmation.                             |
| DeepSeek V4 Flash | Current `deepseek-flash` is DeepSeek-V4.1-Flash-1017 | Provider says legacy V4 Flash names route to V4.1 Flash. Exact evaluation endpoint/version remains to be agreed. |

DeepSeek is a material identity mismatch, not a seventh model added to the scope. Do not label
a run on a redirected alias as an evaluation of the retired V4 Flash weights. Research the
requested generation's historical guidance separately from current API behavior where available.
Evaluate the agreed available Flash version with thinking enabled and disabled.

The alias retirement statement applies to DeepSeek's hosted API, not proof that an Azure
deployment serves the same replacement. Confirm the configured platform and model version
before substituting the requested target or marking historical V4 Flash unavailable.

Public model IDs do not establish which deployments the local profile can access. Deployment
IDs, API versions and effective modes must be recorded before paid runs. The initial public
research used no private profiles. Later counting-only access was explicitly authorized in
conversation; credential values were used only in memory and never printed or recorded here.

## Provider findings

These are provider claims and recommendations, not results from this harness.

### GPT

Reviewed: [Using GPT-6](https://developers.openai.com/api/docs/guides/latest-model) and
[Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).

- The family guide offers starting prompts across GPT-6, but explicitly attributes its
  behavioral observations to Astra and asks consumers to evaluate their own model/workload.
- Astra can ask clarifying questions when the user expects reasonable assumptions and continued
  work. Define completion and approval boundaries instead of blanket instructions to always ask.
- Specify desired delegation and response style. Astra can delegate less than desired and use
  detailed, heavily formatted responses by default.
- Calibrate verification: satisfy required checks without repeatedly broadening testing after
  the relevant checks pass. Persistence should not authorize unrelated work.
- Astra and Sol do not support `none` reasoning effort; Luna does. The family guide recommends
  Responses for reasoning with tools. Do not silently normalize unsupported modes.
- Caching covers the rendered prefix, including tools, instructions and relevant settings.
  A stable instruction string alone does not guarantee reuse.
- The reviewed caching guide specifies a 1,024-visible-token minimum for GPT-5.6 and later,
  default 30-minute writes at 1.25 times ordinary input, and optional 12-hour writes at 2.5 times.
  Reads are generally 0.1 times ordinary input, with Sol at 0.05 times. These are public OpenAI
  rates, not a pricing assertion for an Azure deployment.
- Top-level `instructions` cannot contain an explicit cache breakpoint. Explicit instruction
  caching uses developer-message content. Verify transport support before proposing it here.

### Claude

Reviewed: [Opus 5.5 prompting](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5),
[Sonnet 5.5 prompting](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-sonnet-5-5)
and [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

- Opus 5.5 thinking is always on; its guide recommends starting at medium effort and measuring
  rather than carrying over effort levels from older models.
- Sonnet's guide recommends medium for well-specified agentic coding and higher effort for
  harder work. Low/medium can stop to check in; low can skip meaningful verification.
- Sonnet can add unrequested supporting work and start extra review rounds at high effort.
  Define both when to persist and when to stop. A family overlay must not erase project-required
  tests or documentation just because some users prefer explicitly requested files only.
- A text-only end of turn can be a progress report, not proof of completion. Opus's unattended
  recommendations distinguish prompt changes from bounded harness continuation. Automatic
  continuation would be a separate behavior decision, not a prompt-only assumption.
- Progress notes may arrive in thinking blocks whose visible content depends on API display
  settings. Prompting for updates does not establish that the current renderer receives them.
- Do not demand disclosure of internal reasoning. Ask for useful summaries and verification
  evidence instead.
- Changes to the top-level system prompt can invalidate earlier thinking. The provider describes
  append-only mid-conversation system messages, but this requires transport support. Preserve the
  existing instruction-context behavior rather than assuming those messages already exist here.
- Messages caching is opt-in through `cache_control`, with prefixes ordered tools, system,
  messages. The reviewed guide gives Opus/Sonnet 5.5 a 512-token minimum, 5-minute writes at
  1.25 times ordinary input, 1-hour writes at 2 times, and reads at 0.05 times.
- Verify Microsoft Foundry's API/version support and actual rates separately. General Anthropic
  feature documentation does not prove a configured Azure deployment supports every feature.

### DeepSeek

Reviewed: [Models and pricing](https://api-docs.deepseek.com/quick_start/pricing/),
[Thinking mode](https://api-docs.deepseek.com/guides/thinking_mode.md) and
[Context caching](https://api-docs.deepseek.com/guides/kv_cache/).

- The current model supports thinking and non-thinking modes; thinking defaults to high effort.
  In Responses, `none` disables thinking. In Chat Completions the toggle and effort are separate.
- The current guide maps medium and xhigh to high. Record effective behavior rather than assuming
  an identically named mode is comparable across providers.
- For Chat Completions requests containing tools, the guide requires prior `reasoning_content`
  to be replayed, even from turns without tool calls. This is a transport constraint, not prompt
  text, and is not automatically applicable to the harness's Responses transport.
- Caching is enabled by default and matches persisted prefix units. Common-prefix detection may
  require several requests before reuse, so measure hits instead of promising a cached first call.
- The reviewed pricing page distinguishes peak and off-peak periods. Record the applicable rate
  and time period, rather than treating all Flash runs as identically priced.
- A model-specific guide to instruction formatting, preambles, parallel calls, verbosity and
  long-run failure modes still needs to be located. Do not substitute historical R1 advice.

## Initial prior-art source inventory

Repository metadata and recursive file inventories were inspected at the revisions below.
The preliminary samples below were read after source discovery; the full active prompt and tool
comparisons remain incomplete. Repository-level licence metadata is preliminary: check individual
files and notices before reusing any text. Prefer original prose.

This first-pass inventory records discovery questions. The follow-up below is the current
comparison and resolves several of them; first-pass gaps are not all outstanding work.

| Agent       | Pinned revision / entry point                                                                                                                                                            | What remains to verify                                                                                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex CLI   | [10cf2b9](https://github.com/openai/codex/tree/10cf2b9ea230ccad1aa6b66cb7ff45231daaf056), `codex-rs/prompts/src/model_instructions.rs`, `codex-rs/models-manager/prompt.md`              | Active model selection and composed instructions; repository metadata says Apache-2.0.                                                                                                       |
| Claude Code | [0ed9469](https://github.com/anthropics/claude-code/tree/0ed94698aa0aeee471465fc9c867c2e8434c4d68), `LICENSE.md`                                                                         | No core system-prompt implementation identified in this public tree scan; establish authoritative published material and licence.                                                            |
| Gemini CLI  | [62bab5b](https://github.com/google-gemini/gemini-cli/tree/62bab5b232c15b925d31e655ce844ab939c882b7), `packages/core/src/prompts/promptProvider.ts`, `snippets.ts`                       | Runtime composition and model variations; metadata says Apache-2.0.                                                                                                                          |
| OpenCode    | [V2 agents documentation](https://opencode.ai/v2/docs/agents)                                                                                                                            | Reviewed docs say a custom system prompt replaces the provider base while other instruction sources remain. Obtain matching V2 prompt sources; do not silently use V1 source as V2 evidence. |
| Aider       | [5dc9490](https://github.com/Aider-AI/aider/tree/5dc9490bb35f9729ef2c95d00a19ccd30c26339c), `aider/coders/base_prompts.py`, coder-specific prompts, `aider/resources/model-settings.yml` | Editing-format versus model-specific variations and reminders; metadata says Apache-2.0.                                                                                                     |
| Cline       | [94eecbb](https://github.com/cline/cline/tree/94eecbbe1a2f899c66b118d13656651b0a884e1f), `sdk/packages/shared/src/prompt/system/act.ts`, `index.ts`                                      | Active prompt modes, tool separation and model selection; metadata says Apache-2.0.                                                                                                          |
| OpenHands   | [cd1f810](https://github.com/OpenHands/OpenHands/tree/cd1f810b4f1105d756129adcb76966d1253c752b)                                                                                          | No agent system-prompt source identified in this tree scan; trace the current agent SDK instead of treating the UI repository as the prompt. Metadata says MIT.                              |
| SWE-agent   | [3ea751c](https://github.com/SWE-agent/SWE-agent/tree/3ea751c087f32b16e039a2233dd6eefecef325d5)                                                                                          | Locate authoritative release/configuration prompt sources; the filename scan did not identify them. Metadata says MIT.                                                                       |

For each accessible prompt, record headings, exact measured text length, tool/edit/command
guidance, planning, safety, tone, finishing, tool-description responsibilities and model
selection. Count the assembled prompt as well as fragments where possible. A source file's
length is not a runtime token count. Mark unavailable material as unavailable.

### Preliminary source comparison

All source sizes below are measured characters in the retrieved file, including code or template
framing. They are not assembled prompt lengths or tokenizer counts.

| Sample                                       | Measured source size                                | Observed structure and behavior                                                                                                                                                                                                                | Important limitation                                                                                                                                                           |
| -------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Codex `models-manager/prompt.md`             | 20,751 characters, 3,389 whitespace-delimited words | Coding identity, AGENTS.md scope, short grouped preambles, selective planning, persistent execution, scoped edits, validation and detailed final-answer rules.                                                                                 | Only the first 18,000 characters were inspected. Current selection renders instructions from captured model metadata; this file is not established as the active GPT-6 prompt. |
| Gemini `promptProvider.ts`                   | 11,751 characters                                   | Composes preamble, mandates, agents, skills, workflows, operational rules, sandbox, git and memory context. Selects modern versus legacy snippets from the resolved active model and conditions sections on available tools and approval mode. | This is composition code, not the rendered instruction text. Snippet text and tool descriptions still need review.                                                             |
| Aider `base_prompts.py` / `udiff_prompts.py` | 2,384 / 3,320 characters                            | Separates diligence and scope reminders from file permissions/context; the unified-diff coder adds editing syntax, an example exchange and shell-prompt references.                                                                            | Runtime reminder/model selection is not yet traced. An editing-format prompt is not evidence of a model-family prompt.                                                         |
| Cline `act.ts` / `system/index.ts`           | 3,743 / 308 characters                              | Coding identity, gather context, validate, environment block, conventions, up-front planning, independent parallel calls, persistence and final summary. Index maps ACT and YOLO modes, with ACT the default.                                  | Rules and metadata placeholders expand at runtime. The inspected mode map alone does not establish model-family variation or complete tool-description responsibilities.       |

Source links at the inventory's pinned revisions:

- [Codex sample](https://github.com/openai/codex/blob/10cf2b9ea230ccad1aa6b66cb7ff45231daaf056/codex-rs/models-manager/prompt.md)
  and [metadata renderer](https://github.com/openai/codex/blob/10cf2b9ea230ccad1aa6b66cb7ff45231daaf056/codex-rs/prompts/src/model_instructions.rs).
- [Gemini composition](https://github.com/google-gemini/gemini-cli/blob/62bab5b232c15b925d31e655ce844ab939c882b7/packages/core/src/prompts/promptProvider.ts).
- [Aider base](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/base_prompts.py)
  and [unified-diff coder](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/udiff_prompts.py).
- [Cline ACT](https://github.com/cline/cline/blob/94eecbbe1a2f899c66b118d13656651b0a884e1f/sdk/packages/shared/src/prompt/system/act.ts)
  and [mode map](https://github.com/cline/cline/blob/94eecbbe1a2f899c66b118d13656651b0a884e1f/sdk/packages/shared/src/prompt/system/index.ts).

Early implications to test, not decisions: selective planning and conditional tool guidance fit
a small shared core better than instructions that require a plan for every task. Cline places
changing environment facts before substantial static instructions; that layout is not a reason
to copy it when prefix stability is a stated requirement. Aider's diff-format protocol belongs
to its editing boundary; our equivalent syntax and schemas belong with the actual editing tools.
Codex's metadata-based selection and Gemini's resolved-model selection both illustrate why a
sample prompt alone cannot establish which instructions a switched model receives.

## Prior-art follow-up

The following representative comparison covers all nine requested agents. Source samples are
not benchmark results or exhaustive coverage of every shipped mode. Full rendered lengths
depend on enabled tools and context; source-file sizes are not runtime token costs.

| Agent       | Structure, editing and execution                                                                                                                                    | Planning, safety, tone and finishing                                                                                                                                                                | Tool-description boundary and model variation                                                                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex CLI   | Current GPT-6 instructions come from model metadata; Markdown/prose covers autonomy, authorization, communication, skills and application integrations.             | Persistent execution is bounded by request intent and authorization. Astra/Sol emphasize communication and proportionate verification; Luna explicitly defers tests unless requested.               | Captured metadata selects templates per model. Tool definitions and separate developer messages add other guidance. The older generic sample is not the current GPT-6 prompt.                                                           |
| Claude Code | Official docs describe gather-context, act, verify; CLI uses a coding preset while SDK defaults can be minimal or replaced. Project context is injected separately. | Human-in-the-loop preset includes tool/safety guidance; plan mode is non-mutating. Reminders, permissions and checkpoints complement the prompt.                                                    | Docs confirm full/short variants and model-dependent reminders, but a complete first-party preset text and exact length were not obtained. Bash descriptions include git guidance even with a custom prompt.                            |
| Gemini CLI  | Markdown sections/XML boundaries; modern/legacy snippets, context, agents, skills, workflows and operational rules are composed conditionally.                      | Distinguishes inquiry/directive and plan/execution modes; concise updates, project conventions, secrets and scoped changes. Emphasizes reproduction and comprehensive validation.                   | Prompt repeats substantial named-tool guidance. Active-model feature resolution selects modern/legacy text; enabled tools and interactive/approval mode govern sections.                                                                |
| OpenCode V2 | Short shared Markdown prompt plus generated tool guidance and separate discovered instructions. Optimization plugins replace or append model text.                  | Shared text focuses on concise communication and preserving user work. Astra replacement adds persistence, scope, verification and explicit delegation boundaries.                                  | Renderer includes guidance only for available shell/edit/write tools. Optimization hooks match model-ID substrings: GPT/Astra replaces, Claude appends a comment-density note; explicit custom agent systems skip those prompt changes. |
| Aider       | Coder-specific system text, edit-format instructions/examples, separate read-only/editable file context and end-of-history reminders.                               | Diligence/scope reminders are independently enabled; ambiguous requests can trigger questions. Shell suggestions require confirmation in the inspected execution path.                              | Patches are model text rather than tool calls, so syntax lives in prompts. Per-model settings govern coder format, system/user placement, examples, reminders, lazy/overeager corrections and caching.                                  |
| Cline       | ACT/YOLO templates plus platform/date/workspace substitution, project rules, metadata and plan/act instructions.                                                    | ACT requires context, planning, independent calls, verification, persistence and final summary. Plan mode stops for approval and has a command guard.                                               | Builder selects operating mode; provider identity gates metadata and callers can override text. No general per-family selector was established in this inspected builder. Tools define their input protocols.                           |
| OpenHands   | SDK composes guarded Python text sections into static/dynamic tiers, with default/planning presets and personas. XML role, quality, security and workflow blocks.   | Separates answering questions from fixes, favors scoped changes/verification, and includes memory, external-service and process guidance. Some defaults conflict with this repo and are not copied. | Tools supply prompt guidance. Family/variant additions use centralized name heuristics; Claude/Gemini corrections and older GPT variants are explicit. Dynamic sections put date/time last.                                             |
| SWE-agent   | YAML system/instance/observation templates, tool bundles and submission-review messages. Default system is one sentence; instance instructions carry the workflow.  | Minimal non-test fixes, reproduce, edit, rerun, consider edge cases, then submit/review. Test reversion is benchmark-specific; tone is largely unspecified.                                         | Tool schemas/bundles provide interactions. Default supports any LM; inspected Anthropic benchmark config repeats the task template with model/request settings. Config differences do not prove a universal family strategy.            |

### Follow-up sources and measured sizes

- **Codex:** [current model metadata](https://github.com/openai/codex/blob/10cf2b9ea230ccad1aa6b66cb7ff45231daaf056/codex-rs/models-manager/models.json)
  and [metadata renderer](https://github.com/openai/codex/blob/10cf2b9ea230ccad1aa6b66cb7ff45231daaf056/codex-rs/prompts/src/model_instructions.rs).
  Fully read templates: Astra 21,420 characters / 3,314 whitespace words, Sol 21,769 / 3,366,
  Luna 18,037 / 2,790. These exclude tools, separate instruction messages and framing.
- **Claude Code:** [architecture](https://code.claude.com/docs/en/how-claude-code-works) and
  [preset/custom semantics](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts.md).
  Full/short presets, separate project context and snapshot behavior are documented; no length
  estimate is substituted for unavailable preset text.
- **Gemini:** [snippet wording](https://github.com/google-gemini/gemini-cli/blob/62bab5b232c15b925d31e655ce844ab939c882b7/packages/core/src/prompts/snippets.ts)
  plus the earlier provider source. Snippet source is 70,483 characters; the first 36,000 were
  read, covering mandates, delegation, workflows, operations, safety, git and memory. Later
  conditional helper wording was not audited in full. Rendered size is unmeasured.
- **OpenCode V2:** [base text](https://github.com/anomalyco/opencode/blob/78e066c9d497077ce2f645b1e7e64da1de857a04/packages/core/src/session/runner/prompt/system.txt),
  [tool renderer](https://github.com/anomalyco/opencode/blob/78e066c9d497077ce2f645b1e7e64da1de857a04/packages/core/src/session/system-prompt.ts),
  [optimization hooks](https://github.com/anomalyco/opencode/blob/78e066c9d497077ce2f645b1e7e64da1de857a04/packages/core/src/plugin/optimize.ts)
  and [activation order](https://github.com/anomalyco/opencode/blob/78e066c9d497077ce2f645b1e7e64da1de857a04/packages/core/src/plugin/internal.ts).
  Base template: 756 characters / 111 words before substitution; Astra replacement: 3,823 / 585;
  Claude append: 300 / 49. These are template sizes, not full requests.
- **Aider:** [selection methods](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/base_coder.py)
  and [model settings](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/resources/model-settings.yml),
  alongside earlier coder texts. Relevant methods and representative settings were inspected;
  neither whole source file nor every configured model was audited.
- **Cline:** [prompt builder](https://github.com/cline/cline/blob/94eecbbe1a2f899c66b118d13656651b0a884e1f/sdk/packages/shared/src/prompt/cline.ts),
  8,742 source characters, fully read, alongside the 3,743-character ACT source. Substitution,
  mode additions and metadata make full runtime size configuration-dependent.
- **OpenHands:** the UI README identifies the SDK as the agent owner. Read
  [static sections](https://github.com/OpenHands/software-agent-sdk/blob/62d945b630a13e85a8f2efc25ef08e9730c01a1b/openhands-sdk/openhands/sdk/context/prompts/sections/static.py),
  [presets](https://github.com/OpenHands/software-agent-sdk/blob/62d945b630a13e85a8f2efc25ef08e9730c01a1b/openhands-sdk/openhands/sdk/context/prompts/presets.py)
  and [model resolution](https://github.com/OpenHands/software-agent-sdk/blob/62d945b630a13e85a8f2efc25ef08e9730c01a1b/openhands-sdk/openhands/sdk/llm/utils/model_prompt_spec.py).
  Static source is 28,461 characters, fully read; class code, alternatives and guards prevent
  treating that as a rendered length.
- **SWE-agent:** [default config](https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/config/default.yaml),
  3,242 source characters / 437 words, and [Anthropic benchmark config](https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/config/benchmarks/250526_anthropic_filemap_simple_review_sbl.yaml),
  3,945 / 494, fully read. System sentence is 77 characters; workflow text is mainly in the
  instance template. Source sizes also include tool configuration and submission review.

### Licence boundary

Licence headers were checked at pinned revisions: Codex, Gemini, Aider and Cline identify Apache-2.0;
OpenCode, OpenHands SDK and SWE-agent identify MIT. Claude Code reserves rights under Anthropic's
commercial terms.
No external text is copied into the candidate. Later substantial copying needs a full file/notice
and licence review; these header checks are not blanket reuse approval.

### Implications for this harness

1. Shared core plus a coding extension is a reasonable first experiment. Prior art varies between
   metadata templates, short appendices and capability composition; none proves family prompts
   are necessary for this harness.
2. Study prompts and tools together. Patch syntax, approval dialogs, task lists, reminders and
   compaction are harness-specific and cannot be transplanted as promises.
3. Avoid benchmark assumptions. SWE-agent's test-reversion policy and OpenHands' shell-editing
   and staging conventions do not fit this repository.
4. Family-name heuristics are observations, not the chosen architecture: custom deployments and
   mixed-family adapters make them unreliable here.
5. Calibrate verification. Luna's Codex template, Gemini's exhaustive checks and Claude guidance
   differ; compare a scoped relevant-check rule on every target instead of copying either extreme.

## Model-specific follow-up

### Prompt reduction and ablation evidence

The user reported extensive successful Sonnet 5.5 coding with no system prompt. This is useful
workload evidence, not a scored local baseline or a cross-model result.

Anthropic's [context engineering article](https://claude.com/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models),
published 2026-07-24 and reviewed 2026-11-07, reports removing over 80% of Claude Code's system
prompt for models such as Opus 5 and Fable 5 with no measurable loss on its coding evaluations.
It recommends local judgment instead of generic prescriptions, progressive disclosure, richer
tool interfaces and removing repeated guidance from system prompts when tools already supply it.
The article does not publish enough task-level results to establish equivalence in this harness,
and its named models are not the complete six-target matrix here.

This changes the comparison proposal: no added main-system instructions, a minimal boundary-only
candidate, and the current refined candidate. Do not assume the longer prompt improves coding,
or replace runtime defaults with the minimal proposal before reviewing results. Tools, project
context and executable permission guards remain present in the no-system condition.

The approved [Sonnet pilot](results.md#sonnet-three-condition-pilot) later passed all nine attempts
across those conditions on one constrained fixture. The longer prompt provided no observed
correctness or safety benefit there and used more tokens and calls. This supports investigating
ablation, not a universal instruction-length rule or acceptance for the other target models.

The [second Sonnet comparison](results.md#second-sonnet-comparison) tested no added system text
against Draft M across three cases with three repetitions each. Both passed multi-module repair
and the injected-support-data boundary 3/3, but both failed all plan-only attempts by requesting
`ls` despite an explicit ban on execution requests. The guard blocked every request and files
remained unchanged. This is a demonstrated task-boundary gap, not evidence that every coding
task needs the larger draft. A read-only capability policy or a narrowly targeted instruction
is a separate experiment; the 18-attempt authorization does not cover it.

Reviewed individual [Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol),
[Astra](https://developers.openai.com/api/docs/models/gpt-6-astra) and
[Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) specifications. Each lists a
1,050,000 context window, 922,000 maximum input and 128,000 maximum output. Sol/Astra lack none
effort; Luna supports it. Luna's Chat Completions tool calls require none effort; Responses
supports its tools with reasoning. API differences do not require different prose by themselves.

Reviewed [general Claude guidance](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices):
clear direct instructions, role framing, XML boundaries for mixed inputs, dependency-aware
parallelism and proportional verbosity. XML is useful for mixed context, not mandatory around
every static section. General advice is subordinate to dedicated model guidance; avoid instructions
demanding visible internal reasoning.

[Foundry guidance](https://platform.claude.com/docs/en/build-with-claude/claude-in-microsoft-foundry)
confirms Opus/Sonnet 5.5 availability, customizable deployment names and Azure/Anthropic hosting
options. Features differ by hosting option. Do not assume all upstream server tools or SDK
conveniences exist on the configured endpoint; client tools remain a separate concern.

Reviewed [DeepSeek Responses compatibility](https://api-docs.deepseek.com/guides/responses_api.md)
and [Codex integration](https://api-docs.deepseek.com/quick_start/agent_integrations/codex.md):
instructions become the first system message; developer input is treated as user input; parallel
tool calls are always enabled; verbosity has no effect; encrypted reasoning/include are unsupported;
plain reasoning content is supported. The integration publishes metadata and a long GPT-labelled
Codex prompt. This is compatibility scaffolding, not measured proof of a tuned Flash-family prompt.
No dedicated first-party guide covering every requested behavioral dimension was established;
those remain empirical questions.

### Transport preflight gaps

The current [Responses builder](../../packages/providers/src/responses/responses.helper.ts)
uses its reasoning flag to request/replay encrypted content, not send none effort. The
[mode schema](../../packages/protocol/src/model/model.validator.ts) permits only low, medium,
high and extreme. Flash's non-thinking condition is not selectable through the normal harness;
reasoning false alone does not establish it.

Responses also sends no explicit output-token ceiling, cache options/breakpoint or verbosity.
The [Messages builder](../../packages/providers/src/anthropic-messages/messages.helper.ts) limits
output but sends no cache_control. Stable text does not establish opt-in Claude hits or a hard
Responses evaluation budget. Review these gaps before paid runs; do not attribute transport
failures to prompt wording or quietly implement a workaround.

## Token and cost evidence

Draft wording is in [the design](design.md#candidate-wording). Count its exact blocks and joining
rules, excluding surrounding rationale.

| Target                  | Input / cached read / default write / output USD per million | Ordinary cost for 1,000 added input tokens |
| ----------------------- | ------------------------------------------------------------ | ------------------------------------------ |
| Sol                     | 2 / 0.10 / 2.50 / 10                                         | 0.002                                      |
| Astra                   | 10 / 1 / 12.50 / 50                                          | 0.010                                      |
| Luna                    | 0.10 / 0.01 / 0.125 / 0.50                                   | 0.00010                                    |
| Opus 5.5                | 4 / 0.20 / 5 / 20                                            | 0.004                                      |
| Sonnet 5.5              | 2 / 0.10 / 2.50 / 10                                         | 0.002                                      |
| Current Flash, peak     | 0.30 / 0.006 / no separately quoted write rate / 1.20        | 0.00030                                    |
| Current Flash, off-peak | 0.15 / 0.003 / no separately quoted write rate / 0.60        | 0.00015                                    |

Sources: individual public model pages, [Claude cache pricing](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
and [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing/). These are not verified
local Azure rates. GPT writes use default 30-minute pricing, Claude writes default five-minute
pricing. Longer lifetimes, processing tiers, geography and long context can change rates.
This normalized comparison is not a candidate-token measurement or paid-run budget.

- **GPT:** inspected the public [tiktoken map](https://github.com/openai/tiktoken/blob/main/tiktoken/model.py)
  on 2026-11-07; requested GPT-6 IDs are absent. Do not silently assign an older encoding.
  [Responses input counting](https://developers.openai.com/api/reference/resources/responses/subresources/input_tokens/methods/count)
  is a possible authenticated path; platform support and pricing still need confirmation.
- **Claude:** [counting](https://platform.claude.com/docs/en/build-with-claude/token-counting) is
  documented as free and available on Foundry, but returns an estimate. Newer tokenization differs
  from older Claude counts. The authorized Sonnet deployment measurements below use that endpoint.
- **DeepSeek:** downloaded the offline tokenizer linked by [token usage](https://api-docs.deepseek.com/quick_start/token_usage).
  Archive SHA-256: `e7310d1dafe0a86d8a5629fe78a7c763760f651db9b8682718a1781dcd6fe495`.
  Its demo requests remote-code trust; local counts use only tokenizer JSON, not that demo.
  Its config has a legacy-looking 16,384 maximum, so equivalence to hosted V4.1 is unverified.
  Label counts as published V4-tokenizer counts, not verified endpoint billing counts.

### Local draft text measurements

Measured the three fenced candidate blocks in design.md with tokenizers 0.22.1 and only the
published V4 tokenizer JSON. No archive Python code, remote-code loader or model endpoint was
executed. UTF-8 text excludes surrounding Markdown fences and trailing newlines; compositions
join blocks with exactly two newline characters. Added special tokens, chat templates, tools,
history, environment and host extras are excluded.

Tokenizer JSON SHA-256: `89085f12ef79460ac5f66d1119325ddfc694b4ab209d80bbd81d35f081dc9614`.

| Draft composition | Characters | Whitespace words | Published V4 tokens | UTF-8 SHA-256                                                      |
| ----------------- | ---------- | ---------------- | ------------------- | ------------------------------------------------------------------ |
| Shared core       | 2,092      | 312              | 377                 | `354faf027fe4e73f53a3eef42112119edb4a012a02bc72083706bcf6d489d268` |
| Coding section    | 1,094      | 161              | 200                 | `7f99a61e5e28df2a0dcc842696819bbc12f0ffa2363d1000e0f73fff3a0fb0fc` |
| Child role        | 596        | 88               | 109                 | `cf8db4f7051d87c08412a421cd5c5a4cdc16d6d6afe79bb4a1661f1db098f6db` |
| Coding main       | 3,188      | 473              | 577                 | `fd80e24b481ff743adaa770de499362ed889815690f33a550efbd4ae85589dc0` |
| Coding child      | 3,786      | 561              | 686                 | `824734c66e58fcd9bb073f3cbe728362d9340952d3aa13db9a9fced9e39da989` |

The baseline child role in the recorded source revision measures 146 tokens with the same
tokenizer; main static instructions are absent. Thus the proposed child composition adds 540
tokens net relative to that baseline, not 686, because it also replaces the role wording.
Changed candidate text invalidates these hashes/counts and must be recounted.

After moving Draft A into runtime constants, all three fragment hashes and both composition
hashes were recomputed and matched this table exactly. Those counts refer to the original
implementation, not the later safety refinement below, with the same tokenizer limitations.

If these counts match the deployed tokenizer, at the quoted Flash peak ordinary-input rate the
main addition costs USD 0.0001731 per call and the net child addition USD 0.000162 per child call.
Off-peak halves those figures. These conditional calculations exclude output, tool/history
input, cache effects and behavior changes; they are not observed bills or total task costs.
At this initial measurement, GPT/Opus counts and endpoint-equivalent Flash counts were unmeasured. Sonnet's provider
measurements below are request-count estimates, distinct from these offline text counts.

### Safety-refined candidate text

After a bounded smoke attempt requested the fixture's protected environment file, the user
asked to address that finding. The coding section now excludes routine secret-file investigation,
clarifies that a directory listing grants no read permission, and forbids probing or bypassing
protected-file guards. Generic core and child-role wording are unchanged. No family overlay or
tool-permission change was added.

| Refined composition | Characters | UTF-8 SHA-256                                                      |
| ------------------- | ---------- | ------------------------------------------------------------------ |
| Coding section      | 1,484      | `cb5eec211ce7f6a83ceeef700f3afcee3537518ed4d5dc938b7c96351d99de26` |
| Coding main         | 3,578      | `122a546b7396f7931f610f5bf4858cf52d5580f2f54bbd3897f9874fc74ee843` |
| Coding child        | 4,176      | `988998bcd81054d5e9e44e866c82d69a8efa3db56483d0ea320d916c0e8a0da5` |

The addition is 390 characters, not a measured token count. Earlier coding composition token
counts and their cost illustrations do not apply to this refinement; refreshed counts are recorded
below and behavioral comparison remains outstanding. One [bounded refined smoke run](results.md#refined-smoke-validation)
passed without a secret-file request. Neither that one run nor the earlier successful guard
establishes that the refined prompt reliably prevents unsafe requests.

### Authorized Sonnet counting measurements

On 2026-11-07, inspected model definitions in the current harness store with the user's consent.
Only Sonnet 5.5 was present across its profiles. The definition uses azure-anthropic with deployment
claude-sonnet-5-5, adaptive thinking and an explicit 8,192 output limit. No local price metadata
was configured. Do not infer that other models are deployed on that resource or share its credentials.

The Azure Foundry Messages counting endpoint returned HTTP 200 for five requests, using
anthropic-version 2026-10-21. Only the model, optional system text and a fixed user message,
`Count this prompt.`, were submitted. No tools, private project content, history, thinking/output
configuration or cache controls were sent. No generation, connection-check or alternate-deployment
request was made. Redirects were disabled, request timeouts were bounded, and credentials stayed
in memory. The [provider guide](https://platform.claude.com/docs/en/build-with-claude/token-counting)
documents counting as free and its results as estimates, potentially including system-added tokens.

| Condition                        | Returned input_tokens | Difference from no-system baseline | Difference from existing child role |
| -------------------------------- | --------------------- | ---------------------------------- | ----------------------------------- |
| Fixed user message, no system    | 15                    | 0                                  | Not applicable                      |
| Draft shared core                | 623                   | 608                                | Not applicable                      |
| Draft coding main                | 944                   | 929                                | Not applicable                      |
| Draft coding child               | 1,115                 | 1,100                              | 920                                 |
| Existing child-role instructions | 195                   | 180                                | 0                                   |

Candidate text hashes are unchanged from the local measurement table. Existing child-role UTF-8
SHA-256: `4879d2f968a9f486b0e982516c414a7638001a7deed0aa7dcf7bdda2e1154568`.
Baseline empty system text has the standard empty-string hash. Differences compare otherwise
identical minimal requests; they are not standalone tokenizer counts or observed inference bills.

At the quoted public Sonnet ordinary-input rate of USD 2 per million, the estimated incremental
main instruction cost is USD 0.001858 per call, and the net child instruction cost USD 0.00184
per child call. These are uncached illustrations, not confirmed Azure pricing or total run costs.
Token counting does not establish cache hits, inference availability, output limits or task quality.

At the initial counting pass, GPT-6 Sol, Astra, Luna, Opus 5.5 and Flash had no definitions in the inspected harness store.
Their counting was blocked on target configuration or a supplied measurement path, not evidence
that those models are unsupported. Do not copy Sonnet results to Opus or silently drop missing
targets from the matrix. No missing models were added or settings changed.

### Refreshed counting and minimal candidate

On 2026-11-07, submitted nine counting requests each to the configured Opus 5.5 and Sonnet 5.5
Foundry deployments. Both were measured independently; their matching counts are observations,
not transferred results. The [counting guide](https://platform.claude.com/docs/en/build-with-claude/token-counting)
was rechecked: counting is free, supported on Foundry, and returns estimates that can include
non-billable system-added tokens. Requests used version 2026-10-21, the fixed user text
`Count this prompt.`, and optional public system text only. No tools, project data, history,
generation or connection checks were submitted. Credentials stayed in memory, redirects were
disabled and requests had 20-second timeouts. Original settings and keys were not changed.

| Condition                               | Opus returned input_tokens | Sonnet returned input_tokens | Published V4 text tokens   |
| --------------------------------------- | -------------------------- | ---------------------------- | -------------------------- |
| Fixed user message, no system           | 15                         | 15                           | 0 (empty system text only) |
| Shared core                             | 623                        | 623                          | 377                        |
| Original Draft A main                   | 944                        | 944                          | 577                        |
| Safety-refined main                     | 1,054                      | 1,054                        | 648                        |
| Original Draft A child                  | 1,115                      | 1,115                        | 686                        |
| Safety-refined child                    | 1,225                      | 1,225                        | 757                        |
| Legacy child role                       | 195                        | 195                          | 146                        |
| Minimal Draft M main                    | 90                         | 90                           | 48                         |
| Minimal Draft M plus current child role | 261                        | 261                          | 157                        |

The offline counts used tokenizers 0.22.1 and the same hash-verified tokenizer JSON directly from
the archived ZIP. No archive Python code or remote-code loader ran. The refined coding section
alone counts 271 published V4 tokens. These columns use different methods: provider counts
include the fixed request, while V4 counts cover only the named static text, without special tokens
or chat/tool framing. Hosted tokenizer equivalence remains unverified.

Draft M's main text is defined once in [the design](design.md#minimal-ablation-candidate).
Its 255-character UTF-8 SHA-256 is
`ac960e3ef0144cbc79725e8389aa96c2477f7ae8a64aadaa5215b6c624c340db`.
Minimal-plus-current-child-role SHA-256 is
`3963a0a50102bd789cc9fa53d7d86a4867b08a0aafa575561076dc4aea9945cc`.
Original and refined hashes were verified against their existing tables before counting.

Subtracting the no-system request gives 1,039 added input tokens for the refined main versus
75 for Draft M, a 92.8% reduction in this added static contribution, not the complete request.
Net child changes against the legacy role are 1,030 versus 66 tokens respectively. This measures
size, not a performance improvement or evidence that any added system text is necessary.

At ordinary global Claude rates, refined/main versus minimal/main incremental input cost per
call is USD 0.004156 versus 0.000300 for Opus, and USD 0.002078 versus 0.000150 for Sonnet.
The [Foundry pricing guide](https://platform.claude.com/docs/en/about-claude/pricing#claude-in-microsoft-foundry-pricing)
confirms standard per-model/per-feature rates converted to CCUs; US Data Zone pricing adds 1.1x.
These are uncached, pre-tax illustrations, not complete run costs or observed invoices.

The public tiktoken map still lacks all requested GPT-6 IDs. A
[Microsoft support discussion](https://learn.microsoft.com/en-us/answers/questions/5889782/404-response-when-executing-getinputtokencountasyn)
reports that the Azure v1 compatibility endpoint did not expose Responses input counting in
May 2026. This is support evidence, not proof of every current deployment's behavior. No
credentialed GPT request was made and no older encoding was substituted; GPT counts remain
unresolved without a verified counting path or an approved bounded inference measurement.

All six inspected model definitions lack pricing metadata. The public
[Azure GPT](https://azure.microsoft.com/en-us/pricing/details/azure-openai/) and
[Azure DeepSeek](https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/deepseek/)
pages expose placeholders rather than usable dollar quotes in the retrieved content. Their
deployment tariffs remain a prerequisite for a credible all-target spend cap; upstream rates
can support a conditional illustration, not an attested Azure bill.

### Authorized GPT provisioning

After the initial counting pass, the user authorized adding the missing targets and copying
existing GPT keys without exposing their values. The existing OpenCode provider/model metadata
and active API-key entries supplied matching Azure Responses configurations for GPT-6.1 Sol,
GPT-6 Astra and GPT-6 Luna. Only those three matching keys were transferred, in-process, through
the harness's validated profile setup and credential APIs. No secret values were printed, placed
in model definitions or copied into this repository.

The three models are now configured in the existing harness profile. Sonnet's definition and
credential, profile settings, workspace bindings and current model selection were verified
unchanged. Credential writes retained mode 0600. No inference or connection-check requests were
made. Source credentials were not changed. Source catalogue prices have context tiers that the
harness's flat pricing metadata cannot represent; no inferred or flattened prices were stored.

GPT counting can now proceed after confirming the Azure counting endpoint's support and charges.
The user subsequently configured Opus and Flash from Azure portal details; no undeclared
deployment was guessed or new cloud deployment created. Configuration alone is not proof that
a model passes the agent evaluation.

### Azure DeepSeek transport validation

The configured Azure deployment identifies itself as `DeepSeek-V4-Flash`. This is not evidence
that it serves the newer weights behind DeepSeek's hosted aliases. Its portal endpoint uses
Chat Completions, not Responses. The initial connection failed because the Responses adapter
appended `/responses` to the Chat Completions URL.

The user approved implementing and testing a native Chat Completions transport. The `azure-chat`
adapter preserves the configured deployment and endpoint, supports explicit output limits and
thinking configuration, and replays plain `reasoning_content` with assistant tool calls.
Regression tests cover fragmented tool calls and nullable stream fields observed in live output.
The saved DeepSeek model was migrated through profile APIs without changing its identity,
credential, other model definitions or selected model.

A bounded live check passed with two model calls, one tool execution and a 512-token output
ceiling per call. The transport-specific [workbook check](../../workbook/prompts/deepseek-chat.md)
also passed as run `0605-deepseek-chat`; recorded metadata identifies `azure-chat` and
`DeepSeek-V4-Flash`. Temporary check-profile data was cleaned up. These are transport checks,
not a baseline/candidate comparison, non-thinking validation or evidence of prompt quality.

## Decisions reserved for design review

1. Generic core plus coding extension, and who owns each without introducing upward dependencies.
2. Shared core only, short family overlays, or independent family prompts. Shared core is the
   starting hypothesis; no evaluation currently establishes which option is better.
3. Host extension and replacement semantics, including whether replacement retains safety and
   project context. Describe prompt replacement separately from non-replaceable tool guards.
4. Per-call selection without model-name matching, including mixed-family backends, wrappers,
   switches, pinned child models and unknown families.
5. Static instruction ordering versus append-only project/context instructions; avoid claiming
   that all sources are system messages when they are not.
6. Completion, verification, delegation and progress guidance that matches actual tool behavior.
7. Whether provider-feature incompatibilities need separate work. Record them rather than quietly
   expanding a prompt task into transport or continuation changes.

## Remaining research checks

- Representative prior-art and model/provider comparisons are recorded above; unavailable full
  prompts and unaudited conditional sections are explicit limits, not invented findings.
- All six target definitions are configured. Opus/Sonnet counting is refreshed. Establish a verified
  GPT counting path and verify hosted Flash tokenizer equivalence; neither is inferred from another model.
- Record incremental main/child costs, including cache writes, reads and misses; evaluate actual
  run costs separately from the cost of the added static text.
- Complete the design and its section-by-section rationale, then obtain review before runtime changes.
- Agree the Flash endpoint/version and paid evaluation budget; no evaluation result is claimed here.
