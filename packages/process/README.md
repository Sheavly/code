# @sheavly/process

The process runner: spawns a command or script without a shell, scrubs secret env, enforces deadlines, and stops what it started when the host exits. Nothing about files or code.

Each command runs in its own process group, without a shell, from the environment the host passes
in with anything that looks like a secret removed. A script (`a | b && c || d ; e`) is run the way
a shell would run it, but every word stays a word. Results keep a bounded preview (30,000
characters, first and last lines); every original chunk still reaches pipes and `onOutput`.

```ts
import { ProcessRunner } from '@sheavly/process/process/process.service';

const runner = new ProcessRunner({ env: process.env });
const { exitCode, output, timedOut } = await runner.run({
  file: 'git',
  args: ['status', '--short'],
  cwd: root,
  shell: false,
  signal,
  timeoutMs: 30_000,
});
```

| Module     | What it holds                                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| `process/` | `ProcessRunner`, `runScript`, `withDeadline`, the param and result types, `MAX_OUTPUT_CHARS` and `SECRET_ENV`          |
| `errors/`  | `ProcessKillError` (a group that could not be stopped), `ProcessInterruptedError` (aborted before the command started) |
| `testing/` | Fakes for tests: `testProcesses`                                                                                       |

## Docs

- [Design](docs/design.md): how it works, and how to extend it.
