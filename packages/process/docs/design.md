# Design

How the process runner works inside and why. The package is generic: it knows nothing about files,
workspaces or code, only how to start a command and make sure it ends.

## One group per command

`ProcessRunner.run` spawns `file` with `args`, detached, so the command leads its own process
group. Aborting stops the whole group with `SIGKILL` (`process.kill(-pid)`), including anything the
command started. A group that already exited (`ESRCH`) is not an error; any other failure (such as
`EPERM`) rejects the run with `ProcessKillError`, because the command may still be running.
`shell: true` runs `file` through `/bin/sh`, for a caller that already holds a trusted line.

## Scripts without a shell

`runScript` takes steps joined by `|`, `&&`, `||` and `;` and runs them the way a shell would,
with no shell: every word of a step is an argument as it is, so nothing expands or starts a second
command. Steps joined by `|` start together and are wired with streams: a reader that closes early
stops its writer (what SIGPIPE does), and the exit code is the last stage's, as without
`pipefail`. If any stage fails to start, the rest are stopped and waited for before the error is
thrown. A pipeline skipped by `&&` or `||` leaves the status as it was, as in a shell. A script
whose caller aborted has no exit code (`null`).

## Deadlines

`withDeadline` is the one definition of "timed out": the signal combines the caller's signal with
`AbortSignal.timeout`, and `timedOut()` is true only if the timer fired and the caller did not
abort, so a cancel is never reported as a timeout. `run` uses it per process and `runScript` once
for the whole script: past it the running commands are killed, nothing more starts and the result
says it timed out. Lint rejects a hand-written command timeout elsewhere
(`harness/no-adhoc-command-deadline`).

## Secrets

The runner is built from an `Environment` the host passes in; it never reads `process.env` itself.
Variables whose names match `SECRET_ENV` (`KEY`, `SECRET`, `TOKEN`, `PASSWORD`, `CREDENTIAL`) are
dropped once, in the constructor. Per-run `env` is added on top and can override what was
inherited.

## Output

A result keeps a bounded preview (`MAX_OUTPUT_CHARS`, first and last lines, with the middle
summarised) through `OutputBuffer`. The complete stream still goes to `onOutput` and to any pipe.
Each stream has its own UTF-8 decoder, so a character split across chunks is not corrupted.

## Shutdown

The runner tracks the groups it started. While at least one runs, it holds a `process` `exit`
listener that kills them, so a forced exit does not orphan commands; the listener is removed when
the last one ends. If a group cannot be killed at exit, the exit fails loudly. Each runner has its
own set and listener, so tests build their own with `testProcesses()`
(`@sheavly/process/testing/process-runner.fake`).
