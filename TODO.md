# TODO

The goal: "a typescript loop with the possibility of UI in the future that runs a coding agent and
handles everything from tool calls, reading agents.md files, handling sub agents, background tasks."

Done so far: tool calls (run in parallel), background tasks, interrupting the agent, and model
backends that can be swapped while running.

## Next

- [ ] **AGENTS.md support:** read AGENTS.md files and give them to the model.
  - [ ] Add a system-instructions field to `ProviderRequest` in `@sheavly/core` (there is none yet),
        and send it in the Responses client.
  - [ ] Find AGENTS.md files in the workspace and merge them, from the root down.
- [ ] **Write / edit file tool:** `write_file` and/or `edit_file`, shaped like `tools/read-file/`.
  - [ ] Build on `Workspace.resolveWrite`: the write-path check exists, but nothing uses it yet.
- [ ] **Sub-agents:** "handling sub agents."
  - [ ] A tool that runs a nested `streamAgent` as a background task in `TaskRegistry`, so the
        parent can wait for it or cancel it like any other task.
  - [ ] Three layers of nesting: "the main session can start the sub-agent, and then that
        sub-agent can also start sub-agents" (main session → sub-agent → sub-agent, and no deeper).
  - [ ] Status reporting: each sub-agent has a tool it is responsible for calling itself to report
        its live status, so the main session (and the UI) always knows what every sub-agent is
        doing. E.g. "reading files, reading core package" → "editing core package" → "updating
        ESLint rules".
    - [ ] An explicit tool the sub-agent must call, not automatic observation of what it saw, did
          or which tools it called.
    - [ ] Stream status updates to the UI over SSE (server-sent events), not polling: they are
          small, live text updates, like the status line under a sub-agent card.
- [ ] **Hook system:** "a very extensible hook system for the harness, so users can customize how
      it works and when to insert context."
  - [x] First hook points: `beforeTurn` (add context) and `aroundToolCall` (block, change input
        or result), in `@sheavly/core/hook` and `loop/hooks/`.
  - [ ] More hook points: see "More hooks" below.
  - [x] `.sheavly/` project hooks: `hooks.json` + `hooks/`, JS or TS, ESM or CommonJS.
  - [ ] User-level `~/.sheavly/` (same layout), and `.sheavly/skills/`.
  - [ ] Workspace trust before loading `.sheavly/` (it runs code from the repo).
  - [ ] AGENTS.md loading as a built-in `beforeTurn` hook, not a fixed step.
  - [ ] "This also builds into the sub-agent stuff": hooks apply inside nested agent loops too,
        and a parent can choose which hooks its sub-agents get.

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
  - [ ] Queued items should always be able to be deleted.
- [ ] **User steering the agent:** the user can redirect the agent mid-run without stopping it.
- [ ] **Message branching / history rewind:** "revert to messages": go back to an earlier user
      message, edit it, and "have the history be deleted" from that point (every later message
      and response is dropped).
- [ ] **UI:** "the possibility of UI in the future."
  - [ ] Move the event types (`AgentEvent`, `Sequenced`, `TaskInfo`) into `@sheavly/core`, so a UI
        can be written against them.
