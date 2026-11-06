# Research: building a great terminal UI for coding agents

Goal: find what makes agent TUIs good, to inform `apps/terminal` in this repo.

Method: no general web search is available (DuckDuckGo and Google block curl with bot
challenges). Sources are the GitHub API and raw.githubusercontent.com via curl.

Confidence key: **[secondary]** = third-party write-up, not checked against source;
**[verified]** = read in the project's own source or docs.

---

## Decisions so far

_Updated in round 9. Facts are in the sections below; this is where choices are kept._

- **Scope (user):** no mouse support, side panels or diff pane soon. React is liked.
- **Therefore (analysis, not yet proven):** build the React UI on **native scrollback**
  (committed history printed once, a small live region), not the alternate screen. That drops
  from the shortlist: mouse, in-app selection and search, virtualized transcript, side panels and
  the `/diff` pane. _Inline diffs inside a tool result are a different thing from a diff pane;
  not yet confirmed whether those are wanted._
- **Library:** upstream **Ink 8** (Node `>=22`, so fine on this repo's Node 24; peer React
  `>=19.3`). OpenTUI is parked: it declares Node `>=26.4`, is pre-1.0 and its strength (own
  screen, mouse, panels) is what was just ruled out.
- **Keep:** a plain/line mode (`SHEAVLY_PLAIN=1` exists) and the current `pi-tui` screen as the
  fallback until the Ink screen has parity (Claude Code kept its classic renderer the same way).
- **Open:** whether Ink's streaming + `<Static>` + resize behaves in the terminals you use
  (needs a hand test: I can't drag a window), and how to add `.tsx` to this repo's lint rules.

## Log

- Round 1: GitHub repo search, then the design docs in `cola-runner/awesome-tui-design`.
- Round 2: Gemini CLI source (`packages/cli/src/ui/components/MainContent.tsx`,
  `LoadingIndicator.tsx`), read from `google-gemini/gemini-cli@main`.
- Round 3: Gemini CLI `hooks/useStaticHistoryStartIndex.ts`, `themes/semantic-tokens.ts`,
  `components/messages/ToolShared.tsx`.
- Round 4: Gemini CLI `ToolGroupMessage.tsx`, `ToolResultDisplay.tsx`, `ToolConfirmationMessage.tsx`,
  `utils/borderStyles.ts`, `utils/toolLayoutUtils.ts`, `constants.ts`.
- Round 5: this repo. `apps/terminal` (`README.md`, `docs/chat.md`, `src/tui/*`, `src/render/*`),
  and the installed `@earendil-works/pi-tui@1.5.0` it is built on (`dist/index.d.ts`,
  `dist/tui-main-screen.js`, `dist/components/`).
- Round 6: Codex CLI source, `openai/codex@main`, `codex-rs/tui/` (Rust, ratatui):
  `app/resize_reflow.rs`, `transcript_reflow.rs`, `resize_reflow_cap.rs`, `streaming/*`,
  `history_cell/mod.rs`, `exec_cell/live_output.rs`, `status_indicator_widget.rs`,
  `shimmer.rs`, `bottom_pane/approval_overlay.rs`, `styles.md`. Read as excerpts (module docs,
  constants, signatures), not whole files: the crate is very large.
- Round 7: React renderers. Upstream **Ink** `vadimdemedes/ink@master` (v8.0.0: `src/ink.tsx`,
  `components/Static.tsx`, `write-synchronized.ts`, `readme.md`, issues #907 #942 #973 #990),
  Gemini's `package.json` (which Ink it uses), and **OpenTUI** `anomalyco/opentui@main`
  (`README.md`, `packages/core/{package.json,src/renderer.ts}`, `packages/react/README.md`).
  Registry facts via `npm view` (read-only, nothing installed).
- Round 8: **Claude Code**. Closed source: only first-party _behaviour_ is readable.
  `anthropics/claude-code` (README, `CHANGELOG.md`, a public repo with no app source) and
  Anthropic's docs: `code.claude.com/docs/en/fullscreen.md`, `accessibility.md`, the page index
  `llms.txt` (names of `terminal-config`, `statusline`, `keybindings`, `plugins/mods/*`).
  Not read: terminal-config, statusline, keybindings and the mods pages in full.
- Round 9: **repo fit for React/Ink.** The `working-in-sheavly-harness` skill,
  `tsconfig.base.json`, `apps/terminal/tsconfig*.json`, `packages/eslint-config/src/{base.js,
file-kinds.js,rules/file-kind.js}`, root `package.json` workspaces, `knip.json`, and a search
  for installed React/Ink. Nothing installed or changed.

---

## Candidate sources (GitHub search, round 1)

| Repo                             | Why it matters                                                                |
| -------------------------------- | ----------------------------------------------------------------------------- |
| `cola-runner/awesome-tui-design` | DESIGN.md write-ups of Claude Code, Codex CLI, Gemini CLI, Lazygit, k9s, btop |
| `crittylabs/critty` (Go)         | TUI for code reviews, choices and approvals with coding agents                |
| `WrongStack/WrongStack` (TS)     | Agent with REPL, full-screen TUI and browser UI, per-permission control       |
| `dsh-tui/dsh-tui` (TS)           | Claude Code-style TUI as a plugin bundle                                      |
| `Aploide/spettro` (Go)           | Terminal coding assistant, multi-agent workflows                              |

Primary sources worth reading directly: `openai/codex` (Rust, ratatui),
`google-gemini/gemini-cli` (TypeScript, React Ink).

---

## Findings: patterns shared by Claude Code, Codex CLI and Gemini CLI [secondary]

Source: `awesome-tui-design/designs/{claude-code,codex,gemini-cli}/DESIGN.md`.

1. **Minimal chrome, content first.** AI response text is plain: no border, no prefix. Only
   tool calls, diffs and permission prompts are framed. Codex goes furthest and uses a
   `▌ │ └` gutter instead of boxes, with rounded borders only for dialogs.
2. **State shown by color and border.** Gemini colors a tool block's border by state
   (blue running, yellow pending, green focused, gray done) and uses a fixed icon set:
   `✓ x ⊷ ? o -`.
3. **Live working indicator with elapsed time and a cancel hint.** Gemini:
   `⠹ Thinking... (3.2s) (esc to cancel)`. Claude Code: spinner `· ✢ ✳ ✶ ✻ ✽` at 120ms plus a
   rotating verb. Codex: cosine-wave shimmer across "Working...".
4. **Permission prompt is its own component.** Command preview plus `[Y]es [N]o [A]lways`,
   distinct border color.
5. **Diffs use tinted backgrounds** (green/red) plus `+`/`-` prefixes, so they still read
   without color.
6. **Semantic color tokens, not raw hex.** Gemini maps tokens (`ui.active`, `status.warning`,
   `border.default`, `text.primary`) to colors, which gives it 15+ themes cheaply.
7. **Terminal adaptation.** Codex queries the terminal background with OSC 11 and blends to
   it. All three assume TrueColor, with 256-color or ASCII fallback.
8. **Persistent status line**: model, tokens, cost, elapsed time (Claude Code).
9. **ASCII fallback for every icon.**

### Doubts about the source

- The Claude Code doc says the input box is dashed ASCII, not Unicode box-drawing. This does
  not match my memory of the product. Verify before copying.
- Hex colors and frame counts are quoted as "traceable to source" but no file paths are given.

---

## Findings: Gemini CLI source (React Ink) [verified]

Files: `MainContent.tsx`, `LoadingIndicator.tsx` in `packages/cli/src/ui/components/`.

### Streaming without flicker: split history into "static" and "pending"

- Finished items go into Ink's `<Static>`: printed once into the terminal's own scrollback and
  never redrawn. Only the **pending** group (what the model is producing now, plus tool calls
  still running or awaiting approval) is re-rendered on each update.
- Which item types may be static is an explicit allow-list (`STATIC_HISTORY_ITEM_TYPES`:
  `user`, `gemini`, `info`, `warning`, `error`, `thinking`, ...). `tool_group` is **not** on
  it, because a tool block changes state after it is first drawn. A static item can't change.
- Pending items get a fake negative id (`-(i + 1)`) and are keyed `pending-${i}`, so they never
  collide with real history ids.
- History items are wrapped in `React.memo`, and the derived "augmented" history and element
  list are `useMemo`'d, so a streaming token doesn't re-render old messages.

### Three render modes, one component

1. **Normal**: `<Static>` plus the pending group. Real terminal scrollback and native
   selection/copy work.
2. **Alternate buffer**: a virtualized, scrollable list (`ScrollableList`) with an optional
   scrollbar and mouse mode. The app owns scrolling.
3. **Terminal buffer**: the same virtualized list, with `renderStatic` and
   `overflowToBackbuffer`, so finished items still end up in scrollback.
   Chosen by config (`getUseAlternateBuffer`, `getUseTerminalBuffer`).

### Resize

- A width change bumps `historyRemountKey`, which remounts `<Static>`. After a remount only
  the **latest** history is re-printed, from `useStaticHistoryStartIndex`; earlier items stay
  in scrollback. The header is re-printed only when that start index is 0. A code comment
  admits the trade-off: clearing scrollback when its size changes is imperfect, and a TODO
  notes it "sometimes triggers adding more white space than it should".

### Height budgeting (the unglamorous part that matters)

- Every item receives `availableTerminalHeight`, so a long tool output is cut to fit instead of
  pushing the screen into scrollback.
- Older items get `staticAreaMaxItemHeight`; items after the last user prompt are "expandable"
  (`isExpandable: i > lastUserPromptIndex`), so only the current turn can be expanded.
- With several pending items, the budget is split with the **Largest Remainder Method**, so all
  space is used with no overflow, min height 1.
- When a tool is waiting for approval (the confirmation queue), pending items are cut to 40%
  of the height and the queue gets the rest, again min 1. In alternate-buffer mode this split
  is skipped, because the list scrolls.
- A hard cap on message length, `MAX_GEMINI_MESSAGE_LINES`, is "very high" and only exists as a
  guard against pathological output.
- Header/banner remount keys include state (`bannerVisible`, `updateInfo.isUpdating`,
  `renderMarkdown`), so they re-render only when those change.

### Scroll behaviour

- When a confirmation appears and the user was already at the bottom (`<= 1` row from it),
  the list scrolls to the end; if they had scrolled up, it leaves them alone.
- An `AppEvent.ScrollToBottom` event lets other parts of the UI force it.

### Working indicator (`LoadingIndicator`)

- Driven by a streaming state: `Idle`, `Responding`, `WaitingForConfirmation`. Idle with no
  phrase renders nothing.
- **Priority of the primary text**: operational status (e.g. a retry) > interactive-shell
  waiting phrase > the model's thought subject > a loading phrase > `Thinking...`. Cosmetic
  witty phrases are shown only when nothing more informative is.
- Cancel hint and timer: `(esc to cancel, 12s)`. Whole seconds under 60, then a formatted
  duration. The secondary doc's `(3.2s)` was slightly off.
- Waiting for approval shows a static `⠏` instead of an animated spinner.
- Interactive shell: `(press tab to focus)`.
- **Narrow terminals get a different layout**: row on wide terminals, column when narrow, and
  the timer, witty text and right-hand content move to their own lines. Text truncates with
  `wrap="truncate-end"`.
- Colors come from `theme.text.primary`, `theme.text.secondary`, `theme.ui.active` (semantic
  tokens, confirming the secondary doc).

---

## Findings: resize refresh, in detail [verified]

Source: `hooks/useStaticHistoryStartIndex.ts`. This is the worst problem of the inline
(`<Static>`) approach, so it is worth reading closely.

- **Problem**: after a width change the terminal re-wraps what is already in scrollback, so the
  visible part looks broken. The fix is to remount `<Static>` and re-print.
- **Bounded re-print**: only the newest history is re-printed. Budget
  `RESIZE_REFRESH_MAX_HISTORY_CHARS = 1000` characters, **but never less than one screen**
  (`minRows = terminalHeight`), so everything that was visible is redrawn. Older items are not
  lost; they stay in native scrollback. No item is truncated, only the _number_ of items.
- **Walks backwards** from the newest item, adding items while under the char budget or while
  the window is shorter than a screen. The newest item is always included.
- **Row estimate is deliberately low** (one row per `width` chars of non-empty text, one row per
  tool call, no margins/borders/tool output). Erring low makes the window _taller_, which is the
  safe direction.
- **Cheap counting**: both counters stop at a `limit`, so a huge tool output isn't scanned in
  full. The tool-result counter even re-checks the shape at runtime because resumed sessions
  restore `resultDisplay` from unvalidated JSON.
- **Only for plain resizes**: the window is used when the width changed at any point since the
  last remount (even if it returned to the same value, e.g. a quick drag out and back) **and**
  the history is an append-only continuation of what was printed. It checks item references
  and ids. Anything else (theme change, Markdown toggle, `/clear`, session resume) prints the
  full history.
- **No intermediate frame**: it adjusts state during render, so the remounted `<Static>` gets the
  new window in the same commit and never shows a full-history frame first.
- Lesson: "resize" is really several cases (width changed, width changed and came back,
  history replaced). Each needs its own answer, and the append-only check is what makes the
  cheap answer safe.

## Findings: semantic color tokens [verified]

Source: `themes/semantic-tokens.ts`. `SemanticColors` has exactly these groups:

| Group        | Tokens                                                                     |
| ------------ | -------------------------------------------------------------------------- |
| `text`       | `primary`, `secondary`, `link`, `accent`, `response`                       |
| `background` | `primary`, `message`, `input`, `focus`, `diff.added`, `diff.removed`       |
| `border`     | `default`                                                                  |
| `ui`         | `comment`, `symbol`, `active`, `dark`, `focus`, `gradient` (optional list) |
| `status`     | `error`, `success`, `warning`                                              |

- Tokens are built from a small **palette** per theme (`Foreground`, `Gray`, `DarkGray`,
  `AccentBlue/Purple/Green/Red/Yellow`, `DiffAdded/Removed`, `GradientColors`, ...). A theme
  supplies the palette and the mapping is shared. Light and dark each get one mapping.
- Mapping examples: `ui.active` = blue accent, `ui.focus` = green accent,
  `text.secondary` = gray, `border.default` = dark gray.
- Message text has its own `text.response` token, separate from `text.primary`, so responses
  can be styled apart from UI chrome.
- Built-in themes (files under `themes/builtin/`): ansi, atom-one, ayu, default, dracula,
  github, **github colorblind**, holiday, shades-of-purple, solarized, tokyonight, googlecode,
  xcode, in dark and light, plus a **`no-color`** theme. Accessibility and no-color are themes,
  not special cases in the components.

## Findings: tool status indicator [verified]

Source: `components/messages/ToolShared.tsx`.

- **Core status is mapped to a display status** (`mapCoreStatusToDisplayStatus`), so the UI
  has its own smaller vocabulary: Pending, Executing, Success, Confirming, Canceled, Error.
- **Fixed-width gutter** (`STATUS_INDICATOR_WIDTH = 3`) for the status icon, so tool names
  line up whatever the icon.
- **Executing** shows a spinner (`CliSpinner type="toggle"`). Its color: focused shell is
  `ui.focus`, other shell is `ui.active`, non-shell is `status.warning`.
- **Canceled and Error are bold**, and the tool name of a canceled call is **struck through**.
  Icons carry `aria-label` ("Success:", "Error:", ...), i.e. a screen-reader path.
- **Name and description on one line**: name bold, description in `text.secondary`, truncated
  to a single row (`height 1`, `overflow hidden`) unless the item is expanded. An
  `emphasis` prop (`high | medium | low`) maps to primary or secondary color.
- **Redirection** is shown inline: `(redirection from <original name>)` in italic.
- **Completed ask-user tools hide the description**, because the result already says it.
- **Focus hint appears late**: for an interactive shell, `(<key> to focus)` shows only after
  an inactivity timer (`SHELL_FOCUS_HINT_DELAY_MS`) that resets when output grows, or once
  the user has focused it. Key names come from the keybinding registry
  (`formatCommand(Command.FOCUS_SHELL_INPUT)`), not hard-coded text.
- **Progress** for MCP tools: `█░` bar with a percentage when the total is known, otherwise
  an indeterminate wrap-around. The bar width is sanitised (finite, clamped).
- Correction to the secondary doc: it says a pending tool has a yellow border. Here the
  _icon_ colors follow the table above; I have not yet read where the **border** color is
  chosen (`ToolGroupMessage.tsx`).

---

## Findings: tool-block border color [verified]

Source: `utils/borderStyles.ts` (`getToolGroupBorderAppearance`).

- One border per **tool group** (all calls of a turn), not per call. Its color is derived from
  the whole group.
- "Pending" = any call whose status is not success, error or cancelled.
- Priority: focused interactive shell → `ui.focus` (green); shell and pending → `ui.active`
  (blue); other pending → `status.warning` (yellow); otherwise `border.default` (gray).
- **Dimming**: `borderDimColor = pending && (!shell || !focused)`. So a pending non-shell
  group is _dim yellow_; only a focused shell is bright. The secondary doc missed this.
- **An error does not turn the border red.** Error counts as "not pending", so the border goes
  back to gray; the error is shown by the call's `x` icon and bold text. Color is a property of
  _activity_, the icon is a property of _outcome_.
- Hidden calls: in-progress ask-user calls, plan-mode operations and (at low error verbosity)
  internal errors are filtered out before drawing. If nothing is visible the group renders
  `null`, so no stray border fragments are printed.

## Findings: a box built from segments [verified]

Source: `ToolGroupMessage.tsx`. This is how a bordered block coexists with `<Static>`.

- The "box" is not one bordered element. Each tool call renders with **left and right borders
  only**; the top border is drawn by the first call (`isFirst`) and the bottom by a separate
  empty **closing slice** with `borderBottom` only. Segments stack into a box.
- Because segments are independent, finished calls can be committed to scrollback while later
  ones are still pending. An explicit "closing slice" (`tools: []`) bridges the static and
  pending sections and takes its color from the last pending group.
- The group container has a **fixed width** with a comment: without it Ink can draw the border
  across multiple lines and tear when the group changes state often. A known Ink bug, worked
  around.
- Other layout rules: calls of kind `Agent` are merged into one sub-agent group; a **compact
  mode** (setting `compactToolOutput`) shows read-like tools (edit, glob, grep, read, ls,
  web fetch...) on a single dense line, never while confirming; "topic" calls render as plain
  text with no border.
- Per-call height: `(availableHeight - staticHeight) / callsWithResults`, min 1.
  `staticHeight` is computed by a long walk over the group that mirrors the render logic line
  by line. The code itself notes the constants "MUST be kept in sync" between the group
  (overflow detection) and the result display (real truncation). **Duplicated knowledge: a
  maintenance risk to avoid.**
- Output over a limit is saved to a file and the block says
  `Output too long and was saved to: <path>`.

## Findings: long output, diffs and limits [verified]

Sources: `ToolResultDisplay.tsx`, `utils/toolLayoutUtils.ts`, `constants.ts`.

- **Content height** = `max(available - 1 (header) - reserved, MIN_LINES_SHOWN + 1)`, with
  `reserved` = 4 inline and 6 in alternate-buffer mode. Never below 3 lines.
- **Shell output caps**: 15 lines for active and for completed shells, minus a 5-line overhead,
  so ~10 visible lines. Sub-agent results also collapse at 15.
- **Expansion**: the user can lift the cap (`Show More Lines`, Ctrl+O) but only for the current
  turn (`isExpandable`).
- **Truncation keeps the tail** by default (`overflowDirection: 'top'`) and reports a
  hidden-lines count. Data is sliced _before_ rendering (`SlicingMaxSizedBox`), so huge output
  isn't laid out and then clipped.
- **Dispatch by result type**: JSON is pretty-printed; sub-agent progress has its own view;
  strings render as Markdown or plain text; structured results show their summary; file diffs
  go to `DiffRenderer`; ANSI line arrays (shell output with colors) go to a line renderer;
  anything else falls back to JSON. Todo results render nothing inline (a separate tray).
- **Build files are never truncated in diffs** (lock files are). The approval dialog explains
  why: build config changes can add hooks that run arbitrary code later.
- **Output buffer is bounded**: 10 MB per background task, and truncation only triggers
  after an extra 1 MB so the string copy is amortised instead of per chunk.
- **Timers**: focus hint 5 s, warning prompt 3 s, expand hint 5 s, "action required" and
  "silent working" terminal-title delays 30 s and 120 s.
- **Backgrounds are blended**: opacity constants (0.16 message, 0.24 input, 0.2 selection,
  0.4 border) suggest tints derived from the terminal background rather than fixed hex.

## Findings: approval dialog [verified]

Source: `ToolConfirmationMessage.tsx`. Differs from the secondary doc's `[Y]es [N]o [A]lways`.

- **A radio list**, not letter keys. Outcomes are a small enum: `ProceedOnce`,
  `ProceedAlways` (this session), `ProceedAlwaysAndSave` (all future sessions),
  `ProceedAlwaysTool` and `ProceedAlwaysServer` (MCP), `ModifyWithEditor`, `Cancel`.
- Labels: "Allow once", "Allow for this session", "Allow for all future sessions",
  **"No, suggest changes (esc)"**. Declining is phrased as feedback to the model, not a dead
  end. Esc is the shortcut.
- **Options depend on the request type** (edit, exec, info, mcp, ask-user, exit-plan-mode).
  Permanent options are removed when the setting is off, when "always allow" is disabled, or
  when the folder is untrusted. "Modify with external editor" is hidden in IDE mode and while
  already modifying.
- **Security work done in the UI**:
  - warns on _deceptive URLs_ found in commands (shows the original and the punycode host);
  - sanitises tool arguments and descriptions before display (`stripUnsafeCharacters`,
    `sanitizeForDisplay`), so a malicious tool can't inject terminal escapes into the prompt;
  - detects shell redirection (`hasRedirection`);
  - build-file edits get an extra warning.
- **Height-aware**: it measures the security-warning box with a `ResizeObserver` and gives the
  rest of the space to the diff or command preview.
- Cancel goes through a state flag plus an effect, with a comment about why.
- MCP tool details (arguments, description, schema) are collapsed and toggled with the same
  Show-More-Lines key.

---

## Findings: Codex CLI source (Rust, ratatui) [verified, excerpts]

Codex is not React, but it solves the same problems (streaming, scrollback, resize) in a
different way, and documents its reasoning well.

### Model: history as source objects, scrollback as a render product

- The unit is a **`HistoryCell`** (trait). A cell renders itself for a width
  (`display_lines(width)`), but also exposes `raw_lines` (copy-friendly), `copy_source`
  (the **original Markdown**, independent of presentation), `transcript_lines` (for the
  Ctrl+T overlay), `desired_height(width)`, hyperlink metadata and `is_stream_continuation`.
- Finished cells are written into the terminal's **native scrollback**. Codex states the key
  fact: _"Terminal scrollback is not a retained widget tree: once Codex writes wrapped lines
  into the terminal, the terminal owns those rows."_ So the cells in memory, not the screen,
  are the source of truth.
- An in-flight **active cell** can mutate in place while streaming. Cells that change with time
  expose an animation tick; code that mutates the active cell bumps a revision, so caches
  (like the transcript overlay's live tail) know when to refresh.
- **Activity groups**: reasoning is kept inside a group; call positions stay fixed while calls
  complete; details are expandable ("disclosure") and collapsed rendering doesn't build the
  hidden content.
- A **raw output mode** switches from pre-wrapping lines to letting the terminal wrap
  (`HistoryLineWrapPolicy::Terminal` vs `PreWrap`), so copy/paste doesn't break at hard wraps.

### Resize: rebuild from source, debounced and capped

- On a width change, clear **only the history Codex owns** and re-emit every cell at the new
  width. A height _increase_ also schedules a rebuild, to restore rows exposed above the
  inline viewport.
- **Debounce 75 ms** (`TRANSCRIPT_REFLOW_DEBOUNCE`) so a drag doesn't rebuild per pixel.
- **Row cap** per terminal, because replaying more rows than the terminal keeps "wastes work
  and can make interactive resize feel worse": VS Code 1,000; WezTerm 3,500; Windows Terminal
  9,001; Alacritty 10,000; other terminals a configured fallback. Configurable, `0` disables.
  The terminal is identified by detection (plus a VS Code probe, since shells can report the
  host shell's name).
- The cap is applied to **rendered display rows**, not to source cells. A comment explains why:
  trimming source would make copy, transcript overlay and replay disagree about history.
  Oldest rows are dropped first.
- The same cap applies to **resuming a large session**: rows are buffered and only the newest
  are written, so startup costs no more than a later resize would.
- **Resize during streaming** is the fragile case. Stream output first appears as transient
  stream cells, then _consolidates_ into finalized source-backed cells. A resize before that is
  marked, and consolidation then forces **one final rebuild** from the finalized source.
- There is also an **owned screen** mode (own fullscreen viewport) that lays out while drawing
  and ignores scrollback work.

### Streaming: newline-gated, queued, paced

- Streamed Markdown is collected **by newline**; only completed lines are committed.
  Committed render lines go into a FIFO queue with an arrival timestamp.
- A **commit tick** drains the queue. Adaptive chunking has two gears: _Smooth_ (one line per
  tick) and _CatchUp_ (drain everything queued), with hysteresis so it doesn't flap:
  enter catch-up at queue depth >= 8 lines or oldest age >= 120 ms; leave at depth <= 2 and age
  <= 40 ms, held for 250 ms; no re-entry for 250 ms unless severe (depth >= 64 or age >= 300 ms).
  The policy looks only at queue depth and age, never at the source of the text.
- **Tables are held back.** An active pipe table stays in the mutable tail, so a new row can
  reflow the rows above it; committing early would leave a stale layout in scrollback. The
  scanner needs only a header row followed by a delimiter row, ignores fenced code, and treats
  quoted tables as tables. Code fences have their own handling (`code_fence.rs`, unread).
- Design notes in the repo: `docs/tui-stream-chunking-{review,tuning,validation}.md`.

### Working indicator and live output

- **Status row above the composer**: header (default "Working", animated), a separately owned
  elapsed clock in compact form (`59s`, `1m 00s`, `2h 03m 09s`), the interrupt hint (Esc),
  short inline context (e.g. a background-process summary), up to **3 lines of details** under
  it prefixed ` └`. One line, so the bottom pane doesn't change height. Hook activity gets
  the remaining space or its own line on overflow, but never displaces background-process
  controls.
- **Motion preferences**: animations can be switched off and have a reduced-motion indicator.
- **Shimmer** (corrects the secondary doc): a 2-second sweep, band half-width 5 chars, padding
  10, cosine falloff, blending from the terminal's default **foreground** toward its default
  **background**. Without 24-bit color it falls back to per-character **dim / normal / bold**,
  not the `•`/`◦` blink the write-up claimed. It reads the terminal's own palette.
- **Live command output is bounded**: all output kept until 1 MiB; after that, the first 50
  and last 50 completed lines plus the in-progress line. Each line keeps a head and a tail
  (about 10 KB cap), so a command that never prints a newline can't grow without bound. Split
  CRLF and lone CR across chunk boundaries are handled.

### Approval prompt

- A list selection with action-specific options and shortcuts; the module _"does not evaluate
  whether an action is safe to run; it only presents choices and routes user decisions"_.
- Labels: "Yes, proceed"; "Yes, and don't ask again for these files / for this session";
  "No, continue without running it"; **"No, and tell Codex what to do differently"**. Different
  option sets for exec, patches, permissions and MCP elicitation.
- Shortcuts come from a keymap. For elicitation, **Esc is always Cancel, even with custom
  bindings**, so dismissing never silently becomes "continue without info". Every selection
  emits an explicit decision event.
- Same shape as this repo's four choices, including "tell it what to do instead".

### Style rules (`styles.md`) and corrections to the secondary doc

- Use the terminal's **default foreground** most of the time; headers bold; secondary text via
  one helper that picks a readable muted color and clears dim/bold.
- Semantic colors are **ANSI**: green for success/additions, red for errors/deletions,
  magenta for Codex itself, plus an accent helper. **Avoid blue and yellow, and black/white
  foregrounds** (lint rules enforce this).
- Never use an unchecked custom foreground: `readable_color_on(color, background)` checks
  contrast against the background actually painted behind the text.
- Keyboard hints via one helper (bold labels, readable descriptions), separated with `·`.
- **Correction:** the secondary doc listed hex colors for Codex (`#22c55e`, ...). The real
  guide uses terminal-owned ANSI colors on purpose, so themes stay the user's.

---

## Implications of choosing React [analysis; first written in round 6, see round 7 below]

_Round 7 read Ink and OpenTUI directly; the options below are re-assessed in the two sections
after this one ("Ink (upstream)" and "OpenTUI") and in the comparison table._ Original text:

The decision you mentioned changes which of the above applies. What I can say from what I read:

- **What carries over unchanged**, whatever renders it:
  - a **source-of-truth history** of immutable entries, each able to render at a width, with
    its original text kept for copy;
  - a **streaming controller outside the UI** (newline gate, queue, commit tick, holdback for
    tables and code fences) that feeds committed lines and a mutable tail into state;
  - bounded output buffers, debounced resize, a row cap, one status row, an Esc-is-cancel rule.
- **Where Ink differs** (from how Gemini uses it): `<Static>` prints once and cannot reprint,
  so after a resize the only repair is to remount it and print a window (Gemini's approach). It
  can't do Codex's "clear what we own and rebuild from source" _unless_ the app clears the
  screen itself. Gemini avoids the problem in its alternate-buffer mode with a virtualized list
  that owns scrolling.
- **So the real choice** (inference, to be tested):
  1. Ink inline + `<Static>` (Gemini default): native scrollback, selection and search; resize
     is a patch.
  2. Ink with its own virtualized, scrollable list (Gemini's alternate-buffer mode): resize is
     easy, but you give up native scrollback and selection unless you add copy support.
  3. React on top of a renderer that owns scrollback writes (Codex-like): best resize, but it
     is not what Ink does today and needs checking (see open questions).
- This repo's `pi-tui` is already closest to Codex: it owns all text and re-renders
  everything, which is why wrapping reflows. Moving to Ink would trade that for React's
  component model and lose it unless the above is solved.

---

## Findings: Ink (upstream) [verified: source, README, registry, issues]

**Health.** `vadimdemedes/ink`: MIT, about 40k stars, v8.0.0 (2026-10-03), last push
2026-10-31, 34 open issues. `npm view`: Node `>=22`; **peer React `>=19.3.0`**. Its README lists
Claude Code, Gemini CLI, GitHub Copilot CLI, Qodo Command, Nanocoder and Neovate Code among its
users (as listed there; I did not check how each uses it).

**Important correction to rounds 2-4: Gemini does not run upstream Ink.** Its
`packages/cli/package.json` has `"ink": "npm:@jrichman/ink@6.6.9"` (a fork, React 19.2.4).
Gemini's `ToolConfirmationMessage.tsx` imports `ResizeObserver` from `'ink'`, which upstream's
`src/index.ts` does not export. So Gemini's `ScrollableList`/terminal-buffer modes and its
`ResizeObserver` use rely on a fork or its own components. Treat those findings as _Gemini's
design_, not as things Ink gives you. (I did not verify who maintains the fork.)

### How it renders

- Each update erases the previous **frame** (the live block) and writes the new one. Output is
  throttled, `maxFps` default **30**.
- `<Static>` (read in full, ~50 lines): it keeps an index; a layout effect sets the index to
  `items.length`; only items past the index are rendered, in an absolutely positioned box. The
  new static text is written **once, ahead of the frame**. Nothing in it can change.
- **Synchronized output**: when stdout is a TTY and not CI, a full-clear write is wrapped in
  `ESC[?2026h` ... `ESC[?2026l` (begin/end synchronized update), so the terminal shows the frame
  atomically. This is the mechanism against tearing, where the older Gemini comment
  worked around a bug by fixing the width. (Whether that bug still exists upstream: not tested.)
- **If the live frame is as tall as the viewport** (`outputHeight >= rows`) Ink takes a different,
  full-clear path. So the live region must stay shorter than the screen, which is what
  Gemini's height budgeting is for.

### Options and hooks (README, v8)

- `render(tree, options)`: `exitOnCtrlC`, `patchConsole` (console output is cleared around and
  re-drawn, so it doesn't overlap), `onRender` (metrics), `isScreenReaderEnabled`, `debug`,
  `maxFps`, **`incrementalRendering`** (only changed lines; fewer flickers), `concurrent`
  (React Suspense/transitions), `interactive` (auto-detected; off in CI and pipes: no erase
  codes, no resize handling), **`alternateScreen`**, `kittyKeyboard` (Ctrl+I vs Tab,
  Shift+Enter vs Enter, key release events).
- Hooks: `useInput`, `usePaste`, `useApp` (`exit`, `waitUntilRenderFlush`, `suspendTerminal`),
  `useStdin/Stdout/Stderr`, `useBoxMetrics`, `useWindowSize`, `useFocus*`, `useCursor`,
  `useIsScreenReaderEnabled` (plus `aria-*` props) and **`useAnimation`** (one shared timer for
  all animations; returns `frame`, `time`, `delta`).
- `renderToString` exists: useful for testing output without a terminal.

### Resize and scrollback: what upstream does now

- On a **width decrease** it erases its own live frame and re-renders; on a height decrease
  with a cursor shown it does likewise. `<Static>` output that is already in scrollback is **not
  repainted**: the terminal wraps it however it wants. The `useWindowSize` docs warn that
  "ghost lines may briefly appear depending on the terminal emulator's reflow behavior".
- **Scrollback used to be wiped, and was fixed.** Issues #935 and #990 (closed 2026-08-25): in
  7.x a frame taller than the viewport sent `ESC[3J` (clear scrollback) on every render; the
  reporter measured 12 wipes in 4 seconds, and a resize turned 102 lines of shell history into 0. Current `src/ink.tsx` says that on the primary screen it now erases **only the previous
  frame** and leaves everything above, _because replaying static output used to stamp a copy of
  every line into history on each full clear_. Alternate-screen mode keeps a copy of all static
  output to replay, as there is no scrollback there.
- **Still open or recently fixed edge cases** (the area to be careful in):
  - #942 _(open)_: after narrow-then-wide, earlier `<Static>` output stays "squished"; "no
    workaround, the only option is to restart" (asks for a full-redraw API).
  - #973 _(open)_: a single `<Static>` item **taller than the viewport** overwrites its own last
    line when a small live region sits below it.
  - #907, #1023, #1011 _(closed)_: ghost lines when wrapping changes the row count; incremental
    rendering not repainting after a height shrink; alternate-screen resume dropping `<Static>`.
- **Practical rule these suggest** (my inference): commit history in **small pieces** (a line
  or block at a time, as Codex does), never as one huge item, and keep the live region well
  below the screen height.

## Findings: OpenTUI [verified: README, package.json, renderer.ts excerpts, registry]

**Health.** `anomalyco/opentui`: MIT, about 13.7k stars, **v0.8.2 (pre-1.0)** released
2026-11-03, 155 open issues. README: written in **Zig**, used from TypeScript "directly or
through React and Solid"; flexbox layout; "OpenCode uses OpenTUI in production for millions of
users" (the project's claim; not checked).

**Packages**: `core` (native library + TS bindings), `react` (`@opentui/react`), `solid`,
`keymap`, `qrcode`, `three`, `ssh`. React API: `createRoot(renderer).render(<App />)`;
components `<text>`, `<box>`, `<scrollbox>`, `<input>`, `<textarea>`, `<select>`, `<code>`,
`<line-number>`, **`<diff>`**, ASCII font; core also has `Markdown` and `Image` renderables.
Hooks: `useKeyboard`, `usePaste`, `useFocus`, `useBlur`, `useSelectionHandler`, `useOnResize`,
`useTerminalDimensions`, `useTimeline`. `jsxImportSource: "@opentui/react"` (own JSX types).

### Screen modes: the Codex-like option exists

`screenMode`: `"alternate-screen"` (default), `"main-screen"` or **`"split-footer"`** ("keep the
renderer in a reserved footer on the main screen", default footer height 12). With
`externalOutputMode: "capture-stdout"`, anything written to stdout is queued and replayed
**above** the footer. A **`ScrollbackSurface`** API renders a `Renderable` tree into a snapshot
(`width`, `height`, `rowColumns`, `startOnNewLine`, `trailingNewline`) and
`commitRows(start, end)` writes those rows into the terminal's native scrollback. That is the
shape of Codex's design: the renderer owns scrollback writes, and a React/Solid tree decides
what is committed. A test (`renderer.scrollback-surface.test.ts`) exercises it with Box, Code,
Image, Markdown and Text. A "replay reset" option (`clearSavedLines`) hints at rebuild support.
**Not checked:** what split-footer does on resize, or how committed rows are re-wrapped.

### Constraints that matter here

- **Runtime.** `@opentui/core@0.8.2` declares `engines: { bun: ">=1.3.14", node: ">=26.4.0" }`
  (registry and repo agree). **This repo is `node >=24` and runs 24.22.1.** Whether it works on
  24 despite the field is unknown; it is a hard question to settle before anything else. Native
  code ships as per-platform optional packages (linux/macOS/Windows, x64 and arm64, musl).
  Building it from source needs Bun and Zig.
- Peer deps: `web-tree-sitter 0.25.10` (core); `react >=19.2.0`, `react-devtools-core ^7`
  and `ws` (react package). Ink wants React `>=19.3.0`: **React is a new dependency either way.**
- Pre-1.0 means the API may still move.
- A related component library, `shadcn-labs/termcn` (1.2k stars), says it is "built on Ink and
  OpenTUI". Not examined.
- A search for other React terminal reconcilers found nothing else relevant (one 2-star repo).

## Findings: Claude Code [verified: first-party docs and changelog; behaviour only]

**What I could and could not read.** `anthropics/claude-code` has about 155k stars and 16k open
issues but no application source (only plugins, examples, scripts and a changelog). Everything
below is what Anthropic documents or lists as fixed. I have **no view of its code**, so how it is
built (for example whether its fullscreen path still uses Ink) is unknown to me; Ink's README
lists Claude Code among its users, nothing more.

### Two renderers, and the direction of travel

- **Classic**: inline in the terminal, native scrollback, as Gemini's default.
- **Fullscreen** (a "research preview"): draws on the **alternate screen**, "like vim or htop",
  and "only renders messages that are currently visible", so memory stays flat in long
  conversations and the input box doesn't move. Switch with `/tui fullscreen` / `/tui default`,
  the `tui` setting, or `CLAUDE_CODE_NO_FLICKER=1` (`CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1`
  forces classic). **It is now the default** for many setups (a table in the doc: for example
  first use on or after 2026-05-06 when feature flags are fetched).
- **The changelog shows how they got there.** Years of entries are about flicker in the inline
  renderer ("Avoid flickering in /model selector", "Reduced terminal flickering", "terminal
  flicker caused by animated elements at the scrollback boundary", "flicker in non-fullscreen
  mode when content above the visible area changed", "terminal scrollback being wiped during long
  sessions in non-fullscreen mode"). Then `CLAUDE_CODE_NO_FLICKER=1` appears: "opt into
  flicker-free alt-screen rendering with **virtualized scrollback**". Same two problems as
  Ink's #935/#990 and Gemini's height budgets, solved by owning the whole screen.
- **Costs they document** for leaving native scrollback: terminal Cmd+F and tmux search no longer
  see the conversation; native click-drag selection is replaced by in-app selection; it doesn't
  work in iTerm2's `tmux -CC` mode or over SSH to Windows (those start classic).
- **The classic renderer is kept**, and is forced in screen reader mode.

### What they built to make up for the lost scrollback

- **In-app scrolling**: PgUp/PgDn (half screen), Ctrl+Home/End, mouse wheel with a speed setting
  (`CLAUDE_CODE_SCROLL_SPEED`, `/scroll-speed`) and optional acceleration, rebindable `scroll:*`
  actions.
- **Auto-follow**: scrolling up pauses it; a floating **"Jump to bottom"** button shows a count
  ("3 new messages"); the view stays put when a reply finishes; the button's hint adapts to keys
  the keyboard can send, and shortens on narrow terminals instead of wrapping. A dim header row
  shows the latest prompt that scrolled out of view (click to jump back to it).
- **Transcript mode** (Ctrl+O): `less`-style keys and `/` search with `n`/`N`, `{`/`}` between
  prompts. **`[` writes the whole conversation, fully expanded, into native scrollback**; `v`
  opens it in `$EDITOR`. So the escape hatch back to native tools is explicit.
- **In-app selection** that copies on mouse release, with several clipboard paths: `pbcopy`,
  `wl-copy`/`xclip`/`xsel` (clipboard and PRIMARY), PowerShell `Set-Clipboard`, the tmux buffer,
  **OSC 52 over SSH**, and special handling inside GNU screen; a toast says which path was used.
  Double-click selects a word with iTerm2's boundaries so a path is one unit.
- **Mouse as an option, not a requirement**: `CLAUDE_CODE_DISABLE_MOUSE=1` keeps the flicker-free
  rendering and flat memory but gives selection back to the terminal;
  `CLAUDE_CODE_DISABLE_MOUSE_CLICKS=1` keeps only the wheel.
- **Click to expand** collapsed tool results (and live `!` command output); "N more" rows at list
  edges; scrollbars that appear on hover with arrows; hover tint instead of a second pointer.
- Side features: a **`/diff` panel beside the conversation**; **`/focus`** view (last prompt, a
  one-line tool summary with diffstats, the final response); thinking collapsed to "Thought
  for 4s"; Ctrl+L redraws without losing state.

### Rendering internals they state

- Fullscreen **sends only the cells that changed between frames**. Some terminals (Windows
  Terminal, ConPTY) coalesce those positioned writes wrongly and leave stale fragments, so there
  is `CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT=1` (and it is on automatically for some Windows
  sessions).
- It **probes the terminal at startup for synchronized output (DEC 2026)** and uses it when
  reported. tmux up to 3.6 doesn't implement it, so more flicker there; the doc says so and
  suggests upgrading or leaving tmux.
- **Safe fallback**: if a fullscreen session crashes before it "started successfully" (first frame,
  then 10 seconds up or a clean exit), the next start uses classic; after two failures it stays
  classic until update or `/tui fullscreen`, and `/tui` explains why.
- **Switching renderers relaunches** with the conversation, permission mode, effort, model and
  chosen flags carried over; it refuses if a restriction can't be passed on.

### Accessibility, taken seriously

- **Screen reader mode** replaces the interface with **plain linear text**: no box drawing, no
  colour-only cues, no in-place redraws (spinners become static text), tables read as
  `Header: value`, diffs as `+`/`-` lines. Every message starts with a **searchable label**:
  `you:`, `claude:`, `thinking:`, `tool:`, `tool error:`, `error:`, `warning:`,
  `Permission Required:`, `Cost:`.
- Menus become **numbered lists** ("Select with numbers"), yes/no becomes typed `y`/`n`.
- The cursor **stays on the input caret**, and only the changed characters are written while
  typing, so a screen reader doesn't re-read the line; deleted text and permission-mode changes
  are **announced**.
- **OSC 133 markers** at turn boundaries let the terminal jump between prompts.
- A **terminal bell** when a reply ends, a prompt needs an answer, or a tool that ran more than
  5 seconds finishes (outside screen reader mode: `preferredNotifChannel: terminal_bell`).
- Other settings: `prefersReducedMotion`; themes including `dark-daltonized` and
  `light-daltonized`; `CLAUDE_CODE_ACCESSIBILITY` keeps a visible cursor for magnifiers.
- **Security-minded detail**: **project** settings cannot turn screen reader mode on (only the
  flag, the environment or user settings), and the CLI says so when a project tries.
- Honest limits listed: it doesn't auto-detect a screen reader; some mode changes aren't announced.

### Details from the changelog worth copying

- Hyperlinks (OSC 8) with a `FORCE_HYPERLINK` switch; a URL that wraps is **one link across
  rows**; copying a wrapped URL no longer inserts spaces; wide characters (CJK, emoji) at a
  wrap edge needed several fixes; dim text was unreadable on 16-colour and dark ANSI themes
  until fixed (secondary text must stay distinguishable); a queued message shows its
  "to send now" hint; the spinner names the effort level actually in force; spinner verbs are a
  setting; images draw in kitty/Ghostty/iTerm2 even through tmux passthrough.
- **A real extension surface, "mods"**: panes, a band above the prompt, buttons, text fields,
  Markdown, code and diff elements, `Image`, prompt decorations (`virtualText`), selection access
  (`$.ui.selection()`), and **a test harness that fires events and presses buttons without a
  session**. Plugins can ship custom colour themes. Keybindings and the status line are
  configurable. (Names only; I did not read these pages.)

### The cost of owning the screen (also from the changelog)

Many fixes are the long tail of a custom renderer: "unrecoverable interface error" exits (on slow
machines, holding a scroll key, typing fast with a dropdown open, a malformed cached message list),
freezes when scrolling past a large diff, blank rows after resize, a blank flash before the first
frame, stale background colours, stale cursor blocks in rxvt-unicode, artefacts in zellij,
slow wheel scrolling in Windows Terminal, garbled copied Korean/Japanese text on Windows, a
memory leak from stale streaming state after API retries, and one release that filled iTerm2's
scrollback with stale pages on every resize. Even the classic renderer needed fixes ("garbled,
misplaced rows ... after the screen got shorter while still taller than the terminal").

## Where the three leaders landed [analysis]

|                    | Codex CLI                             | Gemini CLI                            | Claude Code                                         |
| ------------------ | ------------------------------------- | ------------------------------------- | --------------------------------------------------- |
| Default screen     | Main screen, native scrollback        | Main screen (inline)                  | **Alternate screen** (for many users), classic kept |
| Scrollback         | Native; rebuilt from source on resize | Native; `<Static>` + bounded re-print | Own virtualized transcript; `[` exports to native   |
| Selection / search | Terminal's own                        | Terminal's own                        | In-app (mouse), transcript search; can opt out      |
| Stack              | Rust, ratatui                         | TypeScript, Ink **fork**              | Unknown (closed)                                    |
| Escape hatch       | raw output mode                       | alternate-buffer modes                | classic renderer, `/tui default`, mouse off         |
| Accessibility      | motion setting                        | `aria-*` on icons                     | full screen-reader mode, daltonized themes          |

Reading this (inference): the three best-known agent CLIs **disagree** on the core choice. Native
scrollback is simpler and keeps the terminal's tools working, but resize and tall frames stay hard.
Owning the screen fixes flicker, resize and memory and allows mouse, search and panels, but you
rebuild scrolling, selection, search and clipboard yourself and inherit a long tail of per-terminal
bugs. Claude Code did the second and still ships the first as a fallback, with a crash-detection
switch back. Whichever you pick, **keep the other available as a mode**, and have a plain linear
mode for screen readers and pipes; `apps/terminal` already has the latter (`SHEAVLY_PLAIN=1`).

## Findings: what adopting Ink means in this repo [verified: config and skill read]

**State today.** No `react`, `ink` or `@types/react` in `node_modules` or any `package.json`.
`tsconfig.base.json`: `module/moduleResolution: nodenext`, `lib: ["es2024"]` (no DOM),
`types: ["node"]`, `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`verbatimModuleSyntax`, **no `jsx` option**. Workspaces are `packages/*` and `apps/*`.

**Lint is `.ts`-only, end to end.** In `packages/eslint-config`: `TYPED_FILES = ['**/*.ts']`,
`SOURCE_FILES = ['src/**/*.ts']`, and the file-name rule's pattern ends in `\.ts$`
(`<name>.<kind>.ts`). So a `.tsx` component would be **outside every typed lint rule** and has
**no kind that fits** (`types`, `constants`, `utils`, `validator`, `helper`, `service`, `errors`,
`tool`, `adapter`, `routes`, `fake`, `test`). The file says a new kind "is added here, never
worked around with an odd file name", and the skill says to add the check in the same change.

**Consequences (what a React change would touch):**

1. _Tooling, shared:_ `tsconfig.base.json` gets `jsx` (`react-jsx`); the eslint config's file
   globs and the kind regex accept `.tsx`; a new kind (for example `component`) gets a policy in
   `FILE_KIND_POLICIES` (exports code, a line cap, classes forbidden). Props types already have to
   live in `*.types.ts` (a code file may not export types). Vitest's `include`, knip and jscpd
   must see `.tsx`; **not checked** which of those need a change. Prettier handles `.tsx`.
2. _Naming clash:_ in this repo "hook" already means an agent hook (`defineHook`). Pick another
   word for React hooks' files.
3. _Dependencies:_ `react`, `ink` and `@types/react` go in `apps/terminal` only, with
   `npm install`, never by hand-editing `package.json`. Only apps may do terminal I/O, so the UI
   belongs in `apps/terminal` and nothing below changes.
4. _Typing risk (unverified):_ `exactOptionalPropertyTypes` and `lib: es2024` without DOM can
   clash with React's types; it is a "try it and see" item.
5. _Runner:_ `tsx` (already used) runs `.tsx`; `tsc -b` needs the `jsx` option to build.

**Existing seams that already suit React** (read in round 5):

- `ChatSession` (queue, stop, commands) talks to the screen through callbacks, so it doesn't
  care what draws.
- `ApprovalPrompt` is a **pure state machine** (queue, picked choice, phase): reusable as is.
- `LineBuffer` is the newline gate (like Codex's), also pure.
- `ChatScreen` + `view.utils.ts` are the part that would be replaced.

**The one real gap:** `Renderer` + `Look` turn events into **pre-styled strings**. A React UI wants
**data**. A `HistoryEntry` model between them (user message, reply block, tool step with its
result, background task, sub-agent line, notice) would let `<Static>` commit entries and the
live region show the in-flight one; `chatLook` and `logLook` remain for the demo, workbook and
plain mode. This is the "source-of-truth history" idea from Codex, in this repo's terms.

## Proposed plan [proposal, nothing started]

Shaped to the repo's rule of one issue, one branch, small stacked PRs:

1. **Spike (throwaway):** Ink 8 + React in a scratch folder: stream text line by line into
   `<Static>` with a small live region and `useAnimation`; resize the terminal, run inside tmux,
   VS Code's terminal and whatever you use. Answers the two risks (flicker, tall items). Needs
   your eyes; I can build it and run the non-interactive parts only.
2. **Tooling PR:** `.tsx` support, a `component` kind and its checks, `jsx` option, deps in
   `apps/terminal`, one tiny component with a test (Ink has `renderToString`).
3. **Model PR (no React):** `HistoryEntry` and the stream-to-entries step, with tests.
4. **Ink screen PR:** history in `<Static>`, a live region, the status row, the editor and
   the approval prompt on `ApprovalPrompt`; behind a flag so `pi-tui` stays the default.
5. **Features** from the shortlist, in order: working indicator, colour tokens and `NO_COLOR`,
   fuller failure detail, bell, reduced motion.
6. **Parity, then remove `pi-tui`;** keep the plain mode.

Open choices inside the plan: the name of the new kind; whether Ink's own `TextInput`-style
editing is enough or the multiline editor (history, paste folding, `/` and `@`-style completion
that `pi-tui`'s `Editor` gives today) must be rebuilt: **this is probably the biggest cost of
leaving `pi-tui`**, since Ink ships `useInput`/`usePaste` but no editor component.

## Comparison: the four ways to build the screen [partly inference]

|                                   | `pi-tui` (today)                      | Ink (upstream v8)                                         | Ink fork (Gemini)                  | OpenTUI + React                                                     |
| --------------------------------- | ------------------------------------- | --------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------- |
| Component model                   | Imperative classes                    | **React**                                                 | React                              | **React** (or Solid)                                                |
| Scrollback                        | Native, re-rendered                   | Native (`<Static>`); alt-screen option                    | Native, plus own scroll list       | Native via `split-footer` + `ScrollbackSurface`; alt-screen default |
| Resize                            | Full re-render, **clears scrollback** | Redraws live frame; static not repainted; edge cases open | Remount `<Static>`, bounded window | Unknown (not read)                                                  |
| Who owns wrapping                 | Library                               | Terminal (for static text)                                | Terminal / own list                | Library, for committed rows                                         |
| Native code                       | None                                  | None                                                      | None                               | **Zig** (prebuilt per platform)                                     |
| Node                              | repo's `>=24`                         | `>=22`                                                    | (as Gemini)                        | **declares `>=26.4`**                                               |
| Maturity                          | 1.5.0                                 | 8.0.0, 40k stars                                          | fork, Gemini-specific              | **0.8.2**, 13.7k stars                                              |
| Diff, Markdown, textarea built in | Markdown, Editor                      | none built in (own code)                                  | own components                     | `diff`, `code`, `markdown`, `textarea`                              |
| Risk for this repo                | Gaps listed above                     | Tall-item and resize edge cases                           | Fork upkeep                        | Node 26 requirement, pre-1.0                                        |

## What this means for the React decision [analysis]

1. **Upstream Ink is the low-risk React path on Node 24** (`>=22`, no native code, widely used),
   with the Gemini-style design: committed history in `<Static>` in small pieces, a short live
   region, height budgets. Accept that resize cannot repaint old output; Codex's rebuild-from-
   source is not available there.
2. **OpenTUI is the closest to Codex's model** (own scrollback writes, real diff/markdown/
   textarea components) but, as published, **declares Node >= 26.4**, ships native binaries and
   is pre-1.0. It is worth a throwaway spike only if the Node question has an answer.
3. **Staying on `pi-tui`** keeps its good resize wrapping but is not React, and clears
   scrollback on resize; fixing that is a smaller job than a rewrite.
4. Whatever you pick, the architecture from rounds 2-6 holds: source-of-truth history entries,
   a streaming controller outside the UI, small commits, capped live output, one status row.
   Build those so the renderer can be swapped.
5. **The bigger decision is who owns the screen** (round 8): native scrollback (Codex, Gemini
   default) or alternate screen with your own scrolling (Claude Code's default). React works
   with both: Ink has `alternateScreen`, OpenTUI defaults to it. But the alternate-screen route
   means you build scrolling, auto-follow, selection, search and clipboard yourself; neither
   Ink nor `pi-tui` gives you those (OpenTUI has `scrollbox` and selection hooks, unverified).
   For a first React version, **native scrollback with a plain-text fallback is the smaller job**;
   keep alternate screen as a later mode, as Claude Code kept classic.

---

## This repo: `apps/terminal` today [verified from code]

Not Ink. A custom screen on `@earendil-works/pi-tui` (`TuiMainScreen`: the terminal's main
screen and scrollback, not the alternate screen).

Parts: `Renderer` turns backend stream events into text through a **look** (`chatLook` for a
person, `logLook` for the complete plain log); `LineBuffer` splits streamed text into finished
lines and a tail; `ChatScreen` owns the components (history, live tail, approval, queue,
status, editor) and the keys; `ApprovalPrompt` is a small state machine; the TUI talks to the
backend only over HTTP.

### Already matches the research (some of it better)

- **Committed vs live.** `LineBuffer` prints a finished line once into scrollback and redraws
  only the unfinished tail. It is the same rule as Gemini's static/pending split. Its comment
  says why: a long conversation isn't redrawn on every token.
- **Minimal chrome.** Reply is plain text; a step is one dim line `⏺ desc  $ cmd` with the
  result under it `⎿ ✓ … · 0.3s` (red on failure). Loop bookkeeping is hidden; only problems
  (token limit, turn limit, stopped run) are said. Close to Codex's restraint.
- **Approval prompt, and in places better than Gemini's:**
  - nothing is picked when it appears, so a stray Enter never runs a command; once you type,
    every key is the editor's and the question waits;
  - skip-with-message is a first-class choice (like Gemini's "No, suggest changes");
  - several questions queue, with `+N more waiting`;
  - "Always allow" prints **the exact entries it will save** (`npm run test *`), where Gemini
    only has generic labels like "Allow for this session";
  - Ctrl+C stops the run and skips what it waited on.
- **Editor**: multiline, history, `/` and skill completion, large pastes folded; type-ahead
  queue shown as `⏳ N queued`.
- **Quit safety**: Ctrl+C with nothing running needs a second press within 1.5 s.
- **Status line**: state (`ready`, `working`, `waiting for you`), model, effort, permission
  mode (`allow all` in red), background tasks.
- **Fallbacks**: plain line mode without a terminal or with `SHEAVLY_PLAIN=1`.
- **Details done right**: escape codes are stripped _before_ cutting a line (a cut through an
  escape would leave a style on); `\r\n` normalised; a blank line is a `Spacer` because `Text`
  draws nothing for it.

### What `pi-tui` already offers that the app does not use [verified: `dist/index.d.ts`]

`Loader` / `CancellableLoader` (animated indicator with custom frames), `Markdown`, `Box`,
`ScrollView`, `VStack`/`HStack`, `TruncatedText`, `SettingsList`, color tools
(`mixColors`, okhsl/oklch, `getTerminalColorMode`, a terminal color-scheme report parser),
OSC 8 `hyperlink`, `TuiAltScreen`, keybinding manager (`KeybindingsManager`), kitty/iTerm
images. The app imports only `Container`, `Editor`, `Text`, `Spacer`, `SelectList`, `Input`,
`matchesKey`, `CombinedAutocompleteProvider`, `TuiMainScreen`, `ProcessTerminal`.

### How `pi-tui` renders (differs from Ink) [verified: `tui-main-screen.js`]

- Re-renders **all** components each time, compares the new lines to the previous ones, and
  writes only `firstChanged..lastChanged`. Output is small; CPU grows with history length.
  _Not measured._
- **A width or height change triggers `fullRender(true)`**, which sends
  `\x1b[2J\x1b[H\x1b[3J`: clear screen, home, **clear scrollback**, then re-print everything.
  Same if a change lands on a line that has already scrolled above the viewport.
- Good: because the library owns all text, wrapped lines reflow correctly after a resize.
  Gemini's inline mode can only re-print a window.
- Risk: whatever was printed **outside** the component tree is lost on resize. The chat prints
  startup lines (and the caller's notices) _before_ the screen starts "so they stay above the
  screen in the scrollback". A resize would erase them, and the user's earlier terminal
  history with them. **Inferred from the code; to confirm by trying it.**

## Gap analysis: Gemini CLI vs `apps/terminal` [verified by reading both]

| Area                    | Gemini CLI                                                   | apps/terminal                                                                                  | Gap                                                                             |
| ----------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Working indicator       | Animated spinner, real status text, `(esc to cancel, 12s)`   | Static `● working` in the status line                                                          | **Big.** No motion, no elapsed time, no cancel hint. `pi-tui` has `Loader`.     |
| Tool step while running | Per-call state icon (executing/pending/confirming/…)         | `⏺ …` printed at start; result printed after the model's turn                                  | **Medium.** A long `run_command` shows nothing live.                            |
| File changes            | `DiffRenderer`, tinted lines                                 | `N chars`; code comment says a real UI would draw `before`/`after`                             | **Big.** The data exists in the artifacts.                                      |
| Long output             | Height budget, tail kept, hidden-lines count, Ctrl+O expands | First line only (100 chars); no expand                                                         | **Medium.** Failures lose detail.                                               |
| Reply text              | Markdown rendering                                           | Plain text                                                                                     | **Medium.** `pi-tui` has `Markdown`; streaming is the hard part.                |
| Color                   | Semantic tokens, 15+ themes, `no-color`, colorblind          | Fixed named colors, "always style"; no `NO_COLOR` handling found in `tui/`, `render/`, `chat/` | **Medium.**                                                                     |
| Resize                  | Re-print a bounded window, scrollback kept                   | Full re-render, scrollback cleared (see above)                                                 | **Unknown impact** until tested.                                                |
| Status footer           | Model, context usage, quota, approval mode                   | Model, effort, mode, tasks                                                                     | **Small.** No tokens, cost or elapsed.                                          |
| Approval                | Radio list, security checks, diff preview                    | Command-only prompt, safe-Enter rule, exact "always" entries                                   | **Ahead in safety; behind in context** (no diff preview, no URL/escape checks). |
| Accessibility           | `aria-label` on icons                                        | None                                                                                           | **Low** for a terminal app, but free.                                           |
| Hyperlinks              | Not seen                                                     | Not used (`hyperlink` exists)                                                                  | Optional.                                                                       |

---

## Ideas for this repo (draft)

- Gutter or no frame for routine tool output; boxes only for permission prompts.
- Build a semantic color layer first (`status.*`, `border.*`, `text.*`), so theming and the
  no-color case come for free.
- Always show elapsed time and a cancel hint while a run is going. The loop already has
  interrupts and a `max_turns` outcome, so there is real state to show.

---

- From Gemini: model the UI as **committed history** (immutable, printed once) plus a small
  **pending region** (redrawn). A tool call should stay pending until it settles, then commit.
- Pass every block a height budget; never let one tool output decide the screen height.
- Rank the indicator's text by usefulness (real status over cosmetic phrases).
- Give narrow terminals their own layout instead of letting a wide one wrap badly.
- Have the UI own a small display-status vocabulary mapped from the core's status, so the
  loop's events can change without the renderer changing.
- Treat themes as data: one palette per theme, one shared palette→token mapping, and
  `no-color` plus a colorblind theme from day one.
- Resize and "history replaced" are different cases; only re-print a window when history is
  append-only, otherwise re-print everything.
- Reserve a fixed-width status gutter so names line up.
- Delay hints that are only useful after a pause (focus hint) and build key names from the
  keybinding registry.
- Keep an accessibility label next to every icon.
- Border color = _activity_ (running, waiting, done); icon and text = _outcome_ (error).
- Build tool blocks from independent segments so each call can be committed on its own.
- Compute heights in **one place**. Gemini's duplicated "keep in sync" constants are the
  anti-pattern.
- Slice output _before_ rendering; show a hidden-lines count; keep the tail by default.
- Bound output buffers and amortise truncation.
- Approval prompt: a short enum of outcomes (once / session / always / decline-with-feedback),
  options derived from the request type and trust state, and display-side sanitising of
  anything the model or a tool supplied.
- Show build/config diffs in full; truncating the part that matters is a security hole.
- Save over-long output to a file and show the path.

### Prioritised shortlist (after round 5)

Ordered by value for effort, given what exists. Each is a _proposal_, nothing is decided.

1. **Working indicator** with elapsed time and `Esc/Ctrl+C to stop`. Use `pi-tui`'s `Loader`
   in the live area; status text from real state (running tool, waiting for approval, waiting
   for N tasks), not a random phrase. Small change, large feel.
2. **Diffs for file changes** in the step result, with a line cap and a hidden-lines count.
   The `before`/`after` artifacts already arrive. Cap by terminal height, not a constant.
3. **Semantic color layer** (`text.*`, `status.*`, `ui.*`) replacing the named colors in
   `style.utils.ts`, with `NO_COLOR` support first. Themes can come later.
4. **Failure detail**: show more than the first line of an error, expandable.
5. **Live state for long tool calls** (elapsed time on the `⏺` line, or a one-line update).
6. **Check the resize behaviour** by hand before deciding anything (see open questions).
7. Markdown for replies, only after the above; streaming Markdown needs care.

Keep what is already good: safe-Enter approval, exact "always allow" entries, the committed
vs live split, restrained chrome.

### Added from Codex (round 6)

- **Keep the history as source entries** (with their original Markdown), not as formatted
  strings. `ChatScreen.#history` holds already-styled lines today; a source model is what
  makes resize, copy, export and a later expandable view possible.
- **Debounce resize (~75 ms) and cap rebuilt rows** per terminal, applied to display rows,
  not to the stored entries. `pi-tui` has no cap that I saw: a full re-render of a long
  conversation on every resize event is the risk.
- **One-line status row**: header, compact elapsed (`1m 00s`), `Esc to interrupt`, short inline
  context, optional detail lines with a `└` prefix, kept to one line so the layout doesn't jump.
- **Motion preference**: a setting for reduced or no animation from day one.
- **Cap live command output** (first/last N lines, per-line head/tail) and handle CR/CRLF
  split across chunks.
- **When Markdown arrives**: gate by newline and hold back tables and code fences in the mutable
  tail, instead of committing a render that later rows would invalidate.
- **Styling rules written down and linted**: mostly default foreground, few semantic colors,
  an explicit contrast check. Prefer ANSI colors the user's theme controls over fixed hex.
- **Esc is always cancel** in prompts, whatever else is rebound.

### Added from Claude Code (round 8)

- **A real screen-reader / plain mode**, not just a fallback for pipes: labelled lines (`you:`,
  `claude:`, `tool:`, `tool error:`, `Permission Required:`), numbered menus, typed y/n, static
  spinner text, diffs as `+`/`-` lines, cursor kept on the input. `SHEAVLY_PLAIN=1` exists; this
  is what it could grow into. Opt in from user-level config only, never from project settings.
- **Terminal bell** (opt-in) when a reply ends, an approval is waiting, or a tool ran over ~5 s.
- **Reduced-motion setting** and a **colourblind-safe theme** from the start.
- **OSC 133 turn markers** so terminals can jump between prompts; **OSC 8 hyperlinks** with a
  switch, and a wrapped URL kept as one link.
- **Clipboard that works over SSH and tmux** (OSC 52, tmux buffer) if you ever add selection.
- **Probe for synchronized output (DEC 2026)** at startup and use it when supported; Ink does a
  version of this already.
- **Crash-detection fallback** to the simpler renderer after repeated failed starts, with a
  command that says why (`/tui`).
- **Secondary text must stay readable** on 16-colour terminals; test it.
- **Switching renderers by relaunching with the conversation intact** is a clean pattern.
- **Test harness for UI elements** (fire events, press buttons, no session): `apps/terminal`
  already has `terminal.fake.ts`; extend that idea to any new components.

---

## Open questions

- How does `apps/terminal/src/render` handle the points above today?
- ~~How do Codex and Gemini CLI handle streaming re-render and flicker?~~ Gemini answered in
  round 2. Codex (ratatui) still open.
- ~~Resize in Gemini~~ answered in round 3. What does Codex do?
- How do they do input: multiline, history, slash commands, file mentions? (`InputPrompt.tsx`,
  `Composer.tsx` in Gemini.)
- ~~Border color, approval dialog, long output~~ answered in round 4.
- How are diffs drawn (`DiffRenderer.tsx`): line numbers, intra-line highlight, syntax color?
- Input: `InputPrompt.tsx`, `Composer.tsx`, keybinding system (`key/`), paste handling.
- Markdown rendering of streaming text (`MarkdownDisplay.tsx`): how is an unfinished code
  block or table handled while streaming?
- ~~How does `apps/terminal` compare?~~ Answered in round 5 (gap table).
- **Resize in `apps/terminal`:** does a resize really erase the startup lines and earlier
  terminal history? Try it: run the chat, print something before, drag the window.
- Does `TuiMainScreen` get slow on a long conversation (it re-renders every component per
  frame)? Measure with a few thousand lines.
- Does the status line wrap badly on a narrow terminal (`Text` wraps)?
- Does the backend send enough in `tool_result` artifacts for a diff (path, `before`, `after`)
  and for a live tool state, or does the protocol need a new event?
- Does `NO_COLOR` or a light background make the current gray/cyan unreadable? Test.
- How does `Loader` from `pi-tui` behave in `TuiMainScreen` (animation frames trigger renders;
  any flicker or scrollback cost)?
- Gemini's `MarkdownDisplay` (streaming Markdown) and `DiffRenderer` are still unread.
- ~~Codex CLI~~ read in round 6 (excerpts). Still unread there: `code_fence.rs`,
  `prose_preview.rs`, `diff_render.rs`, `exec_cell/render.rs` (how a command cell looks),
  `docs/tui-stream-chunking-*.md`.
- ~~Ink itself~~ and ~~other React renderers~~ answered in round 7 (Ink upstream, Gemini's fork,
  OpenTUI).
- **Does `@opentui/core` 0.8.2 actually run on Node 24?** The `engines` field says 26.4+. Try in
  a scratch folder (outside the workspace packages) before deciding. Also: what does
  `split-footer` do on resize and when rows were committed at another width?
- **Why does Gemini fork Ink** (`@jrichman/ink`), and which of its features (virtualized list,
  `ResizeObserver`, terminal buffer) are in upstream v8 now? Read the fork's README/diff.
- **Ink spike:** does a streaming reply committed line by line into `<Static>` with a small live
  region and `incrementalRendering` stay flicker-free on resize in the terminals you use? (Needs
  a hand test; issue #973 says tall items are the trap.)
- How do Claude Code, Copilot CLI or Qodo use Ink (their repos, if open)? Only the README list
  was read. OpenCode's use of OpenTUI would be a good real-world example.
- React 19.3 is required by Ink 8; does this repo have React today, and which version?
- **Claude Code** (closed source): only behaviour is known. Unread pages: `terminal-config`
  (bell, tmux, themes, Vim mode), `statusline`, `keybindings`, `interactive-mode`, `plugins/mods/*`
  (how its UI elements are described and tested), `settings-reference#tui`. Anthropic's
  engineering blog posts on the renderer, if any, were not searched.
- Does its fullscreen path use Ink or something custom? Not answerable from public material I
  read; don't assume.
- ~~Native scrollback or own-the-screen?~~ Decided in round 9: native scrollback (no mouse,
  panels or diff pane soon). Confirm whether _inline_ diffs in tool results are wanted.
- **The editor.** Ink has `useInput` and `usePaste` but no multiline editor component. Does an
  existing Ink input library handle multiline, history, paste folding and completion well enough
  on Ink 8 / React 19.3, or is it a build-it-ourselves job? Search GitHub and read two.
- Which of Vitest's `include`, knip and jscpd settings need `.tsx` added? Read
  `vitest.config.ts` (only partly seen) and `.jscpd.json`.
- Does `exactOptionalPropertyTypes` + `lib: es2024` (no DOM) compile with `@types/react` 19.3?
  Try it in the spike.
- For `pi-tui`: it also has `TuiAltScreen`, `ScrollView` and `MouseRegion`. Is it closer to
  Claude Code's model than I assumed? Check what they cover (selection, search, copy).
- Does `pi-tui` debounce resize? Does a full re-render of 5,000+ lines feel slow?
- What would a `HistoryEntry` look like for this protocol (message, tool step, approval,
  notice) so it can render at a width and keep its source? Check what the stream events carry.
