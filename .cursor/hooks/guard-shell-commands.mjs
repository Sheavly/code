// beforeShellExecution: the edit tools' hooks are pointless if a shell command can edit a file
// past them. Denies what shell-guard.utils.mjs knows to edit project files from the shell (in-place
// editors: `sed -i`, `perl -pi`, scripted vim), whose edits are never formatted, linted or checked
// on stop, and show no diff in the editor. A command it allows is snapshotted first, so
// record-shell-writes.mjs can tell which files it changed and catch the workarounds it missed.
import { changeChatState } from './chat-state.utils.mjs';
import { PROJECT_ROOT, readHookInput, runGuard } from './hooks.utils.mjs';
import { findShellViolation } from './shell-guard.utils.mjs';
import { liveSnapshots, withoutSnapshot } from './shell-snapshots.utils.mjs';
import { snapshotProject } from './shell-writes.utils.mjs';
import { predictFormatterChanges } from './formatter-attribution.utils.mjs';

/** Drops an earlier run's snapshot of `command`: with none taken now, it would be read as this run's. */
function forgetSnapshot(params) {
  const { conversationId, command } = params;

  changeChatState({
    conversationId,
    change: ({ shellSnapshots }) => ({
      shellSnapshots: withoutSnapshot({ snapshots: shellSnapshots, command }),
    }),
  });
}

/** Keeps the project's state before `command` runs, keyed by the command (its after-hook's key). */
async function rememberSnapshot(params) {
  const { conversationId, command } = params;
  const snapshot = snapshotProject(PROJECT_ROOT);

  if (!conversationId) return;

  if (!snapshot) {
    forgetSnapshot({ conversationId, command });

    return;
  }

  const formattedFiles = await predictFormatterChanges({
    command,
    cwd: params.cwd,
    projectRoot: PROJECT_ROOT,
    before: snapshot,
  });

  // The other commands' entries are read with the lock held: a command running together with this
  // one keeps its own snapshot.
  changeChatState({
    conversationId,
    change: ({ shellSnapshots }) => ({
      shellSnapshots: {
        ...liveSnapshots({ snapshots: shellSnapshots }),
        [command]: {
          ...snapshot,
          ...(Object.keys(formattedFiles).length > 0 && { formattedFiles }),
        },
      },
    }),
  });
}

await runGuard({
  guard: 'shell command',
  check: async () => {
    const input = await readHookInput();
    const command = input.command ?? '';
    const violation = findShellViolation({
      command,
      cwd: input.cwd || PROJECT_ROOT,
      projectRoot: PROJECT_ROOT,
    });

    if (violation) return { permission: 'deny', ...violation };
    await rememberSnapshot({
      conversationId: input.conversation_id,
      command,
      cwd: input.cwd || PROJECT_ROOT,
    });

    return { permission: 'allow' };
  },
  deny: (reason) => ({ permission: 'deny', user_message: reason, agent_message: reason }),
});
