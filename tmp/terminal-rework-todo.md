# Terminal rework: todo

Branch: `139-react-tui-research`. Background and sources: `tmp/tui-research.md`.
Implementation is committed in package/build order. The full quality gate passes.
Remaining visual checks and deferred work are listed below.

## Implemented

- [x] `ink`, `react`, `@types/react` in `apps/terminal`; `jsx: react-jsx`; `dev:terminal` tsconfig flag
- [x] Vitest includes `.tsx` tests
- [x] eslint-config: `component` kind (`.tsx`, 150 lines), React-hooks rules, coverage test
- [x] `react-screen/`: `<Static>` history, bounded live footer, layout budgeting
- [x] Working indicator: spinner, elapsed time, `Ctrl+C to stop`
- [x] `ChatView` interface; classic `pi-tui` screen kept (`SHEAVLY_TUI=classic`)
- [x] Shared editor, completion, paste folding, queue and approval state machine
- [x] Approval that doesn't fit the footer can't be confirmed
- [x] `NO_COLOR` support in the React screen
- [x] Hardware caret follows typed text (wide characters, wrapped input)
- [x] `--resume <conversation-id>`; failed prompt keeps tool work and the user's message
- [x] README and `docs/chat.md` updated

## 1. Delivery

- [x] User chose to include all current changes, not isolate the terminal-only work.
- [x] Commit changes by package scope in build order, preserving earlier foundation commits.
- [x] Link delivery to the existing issue #139.
- Stacked PRs are deferred by that delivery choice; delivery targets one draft PR on this branch.

## 2. Verify by hand (needs a real terminal)

Automated native PTY smoke checks pass for React and classic: streaming during resize,
startup history present, cancellation and skip, no clipboard sequence, no alternate screen and
no erase-scrollback sequence. React refuses a clipped approval. These are not visual checks in
tmux, VS Code or a user's light-background terminal.

- [ ] Resize while streaming: native terminal, tmux, VS Code terminal
- [ ] Tall static item next to a small live region (Ink issue #973)
- [ ] Narrow-then-wide resize leaves old static output squished (Ink issue #942)
- [ ] Flicker with `incrementalRendering` on a long conversation
- [ ] Startup lines and earlier terminal history survive a resize
- [ ] Narrow terminal: status line and approval layout
- [ ] `NO_COLOR` and a light background: is dim/gray text readable?
- [ ] Decide: are inline diffs in tool results wanted? (open question in the research)

## 3. Model

- [ ] `HistoryEntry` model (message, reply block, tool step, approval, notice) that keeps its
      source and renders at a width; `chatLook` and `logLook` stay for demo, workbook, plain
- [ ] Stream-to-entries step with tests (no React)
- [ ] Check what the stream events carry (path, `before`, `after`, live tool state)

## 4. Features (research shortlist order)

- [x] Diffs for file changes: collapsed line under the step, `/changes` (list, `#n`, file, `all`)
      and Ctrl+O for the latest. Not done: changes made before `--resume`, an
      expand key for a chosen change (only the latest), clicks (decided against: native scrollback)
- [x] Failure detail: a failed step with more than its first line gets a collapsed
      `▸ N more lines · /errors n` line; `/errors` lists, `/errors #n` shows it whole (first 30 and
      last 70 lines of a long one); Ctrl+O expands the newest collapsed line, change or failure.
      Not done: failed background tasks and sub-agent errors; by-hand check in a real
      terminal
- [x] Live state for long tool calls: the working indicator names the running step and counts its
      time (`⠹ working · 41s · Ctrl+C to stop · ⏺ Run the tests 12s`); several tools show a count
      and the oldest's time. The printed `⏺` line stays as is (scrollback can't be rewritten).
      Not done: classic screen and plain line chat show no step; sub-agents' tools;
      by-hand check in a real terminal (narrow width, long descriptions)
- [x] Semantic colour layer replacing named colours in `style.utils.ts`; colourblind theme:
      roles (`text.*`, `status.*`, `diff.*`, `code.*`) mapped to colours per theme in `theme/`;
      `SHEAVLY_THEME=default|colorblind`; a `Palette` is passed to the look, the views, the
      session and the markdown. Not done: a theme from the profile instead of env;
      light-background contrast check (section 2); `ui.*`/border roles; classic screen ignores
      `NO_COLOR` as before
- [x] Global reduced-motion setting (`config.json`'s `terminal.reducedMotion`), configured through `--setup`:
      static working marker, elapsed times update once per second. By-hand terminal
      check still needed. Legacy profile preferences migrate automatically; existing global choice wins.
- [x] Global opt-in terminal bell (`terminal.bell`), configured through `--setup`: completed
      replies, new approval requests and a tool reaching five seconds, once per call. React and
      classic screens; no bell in plain mode. By-hand terminal check still needed.
- [x] Markdown for replies (newline gate; hold back tables and code fences): `markdown/`,
      block by block
  - [x] Syntax colour in code blocks: own small tokenizer (`highlight-code.utils.ts`; ts/js,
        json, sh, python, go, rust), no new dependency; also `highlightCode` in the theme
  - [x] Long blocks: a code fence is drawn line by line as it arrives (`CodeFence`)
  - [x] Tables at narrow widths checked through `renderMarkdown`: cells wrap, words break below
        ~20 columns, the raw source shows below ~10 (library behaviour). Re-wrap on resize is
        the terminal's: still check by hand
  - [x] `NO_COLOR` pass: `plainMarkdownTheme` (inline code in backticks, `~~` strike-through);
        bold/italic stay unmarked, h1/h2 have no marker (the library replays heading style).
        Only the React screen is plain; the classic screen ignores `NO_COLOR`
  - [ ] Table fallback for very narrow widths (key: value rows instead of the raw source)?
  - [ ] Look at the colours on a light background (see section 2)
- [x] OSC 8 hyperlinks, OSC 133 turn markers
  - OSC 8: Markdown links (pi-tui's detection, `SHEAVLY_HYPERLINKS=1|0` overrides), file paths in
    `/changes` as `file://` links (text over SSH); `NO_COLOR` prints the address instead
  - OSC 133 (`marks/`): prompt `A`+`B` on the message row, `C` on the row under it, `D;0|1` on the
    first row after the turn. Ink drops every OSC but 8, so a mark travels as a private SGR code
    (`ESC[9701m`..) and `restoringMarks` swaps it for the real sequence on stdout
  - Not done: by-hand check in iTerm2/kitty/WezTerm/Ghostty/VS Code/tmux (jump to prompt, link
    click, wrapped link across rows); a path in a tool step's line is not a link; the last turn
    stays open until something prints; no off switch for the marks; the classic screen's marks
    are untested by hand
- [x] Status line: cumulative reported input/output tokens and estimated USD cost, including
      sub-agents and resume. Optional per-model pricing; unknown/partial usage is labelled and
      unknown cost is omitted. By-hand narrow-terminal check still needed.

## 5. Robustness

- [ ] Debounce resize (~75 ms) and cap rebuilt rows, if a rebuild is ever added
- [x] Cap process/script/task output previews: first 30 and last 70 lines, 1,000 characters per
      line with both ends, and a strict 30,000-character budget. Full output still feeds pipes.
- [ ] Crash-detection fallback to the classic renderer, with a command that says why
- [ ] Richer plain/screen-reader mode: labelled lines, numbered menus, typed y/n
- [x] Render approval commands, concerns and grant hints as safe visible literals, including
      CSI/OSC, C1 controls and direction overrides; do not alter the original request.

## 6. Finish

- [ ] Reach parity with the classic screen, then remove `pi-tui` and `SHEAVLY_TUI=classic`
- [x] Update `apps/terminal/docs/chat.md` and README to match
- [x] Run the full quality gate (Prettier, ESLint, tsc, knip, jscpd)
