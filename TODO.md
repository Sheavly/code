# TODO

The goal: "a typescript loop with the possibility of UI in the future that runs a coding agent and
handles everything from tool calls, reading agents.md files, handling sub agents, background tasks."

Done so far: tool calls (run in parallel), background tasks, sub-agents, interrupting the agent, AGENTS.md, and model
backends that can be swapped while running.

## Next

- [x] **AGENTS.md support:** read AGENTS.md files and give them to the model.
  - [x] `ProviderRequest.instructions` in `@sheavly/core`, sent by the Responses client as the
        API's `instructions` field. Runs take an `instructions` option; `beforeTurn` hooks add
        to it with `addInstructions` (per turn, never in history).
  - [x] Find AGENTS.md files from the workspace root down to the working directory, root first,
        re-read every turn: `createAgentsMdHook` in `src/runtime/agents-md/`.
- [x] **Write / edit file tool:** `write_file` and `edit_file`, shaped like `tools/read-file/`.
  - [x] Build on `Workspace.resolveWrite`: both go through the write-path check, and refuse .env
        files.
  - [x] Results carry a `FileChange` (path, before, after) on the `tool_result` event, for a UI to
        render the diff. The model only sees a one-line summary.
- [x] **Sub-agents:** "handling sub agents." (`start_agent`, `src/tools/sub-agent/`; see
      `docs/sessions.md`)
  - [x] A tool that runs a nested agent loop as a background task in `TaskRegistry`, so the
        parent can wait for it or cancel it like any other task.
  - [x] Three layers of nesting: "the main session can start the sub-agent, and then that
        sub-agent can also start sub-agents" (main session → sub-agent → sub-agent, and no deeper).
  - [x] Every session has an id; each sub-agent is linked to its parent (and the main session),
        so none floats on its own. `SessionRegistry` in `src/runtime/sessions/`.
  - [x] Status reporting: each sub-agent has a tool it is responsible for calling itself to report
        its live status, so the main session (and the UI) always knows what every sub-agent is
        doing. E.g. "reading files, reading core package" → "editing core package" → "updating
        ESLint rules".
    - [x] An explicit tool the sub-agent must call (`report_status`), not automatic observation of
          what it saw, did or which tools it called.
    - [x] Stream status updates to the UI over SSE (server-sent events), not polling:
          `sessions.stream()` is a `text/event-stream` body.
    - [ ] Serve it over HTTP from a host (the demo is a CLI and prints the updates instead).
  - [x] Talk to a running sub-agent (send it a message, steer it): `message_agent`, addressed by
        session id, delivered at the sub-agent's next model call without cancelling it. A session
        can message only its own sub-agents.
  - [ ] One combined ordering of every session's events (a sub-agent's text and tool calls stay
        in its own stream today; the parent sees only its start and final reply).
- [ ] **Hook system:** "a very extensible hook system for the harness, so users can customize how
      it works and when to insert context."
  - [x] First hook points: `beforeTurn` (add context) and `aroundToolCall` (block, change input
        or result), in `@sheavly/core/hook` and `loop/hooks/`.
  - [ ] More hook points: see "More hooks" below.
  - [x] `.sheavly/` project hooks: `hooks.json` + `hooks/`, JS or TS, ESM or CommonJS.
  - [ ] User-level `~/.sheavly/` (same layout), and `.sheavly/skills/`.
  - [ ] Workspace trust before loading `.sheavly/` (it runs code from the repo).
  - [x] AGENTS.md loading as a built-in `beforeTurn` hook, not a fixed step.
  - [x] "This also builds into the sub-agent stuff": hooks apply inside nested agent loops too,
        and a parent can choose which hooks its sub-agents get (`start_agent`'s `hooks` option).

## More hooks

"We're missing a bunch." A draft list, as a starting point to add to or trim:

- [x] **`sessionStart`:** once, when a run starts: set up state, add opening context. Each
      sub-agent run has its own.
- [x] **`afterTurn`:** after each model call, once its reply and tool results are in history:
      observe, record, or fail the run.
- [x] **`onError`:** when the run fails (a provider error, a hook throwing): log or report it.
      The error still reaches the caller.
  - [ ] Recovering instead: retry the turn, or turn the error into a message for the model.
- [ ] **Context compaction:** around shortening long histories: choose what to keep, summarize,
      or add context back after compacting.
  - [ ] Blocked: the loop doesn't compact yet. Build compaction first (when, and how much to
        keep), then add `beforeCompact` / `afterCompact` hooks around it.

## Later

- [ ] **Wait for user mid-run:** the loop should "wait for tools, wait for agent, wait for user",
      not just take one prompt per run as `demo.ts` does.
- [ ] **User queuing messages:** the user can send messages while the agent is working; they are
      held and given to the model at the next turn.
  - [x] The queue: each session's inbox in `SessionRegistry` (`sessions.send`), delivered at the
        next model call. Hosts still need to feed user input into it (the demo takes one prompt).
  - [ ] Queued items should always be able to be deleted and edited.
- [ ] **User steering the agent:** the user can redirect the agent mid-run without stopping it.
  - [x] Harness side: `sessions.send({ id: main, from: 'user' })` steers the main session without
        aborting; the main session can pass it on to sub-agents with `message_agent`.
  - [ ] A host that takes user input while a run is going (the demo doesn't).
- [ ] **Message branching / history rewind:** "revert to messages": go back to an earlier user
      message, edit it, and "have the history be deleted" from that point (every later message
      and response is dropped).
- [ ] **UI:** "the possibility of UI in the future."
  - [ ] Move the event types (`AgentEvent`, `Sequenced`, `TaskInfo`) into `@sheavly/core`, so a UI
        can be written against them.
