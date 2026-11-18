import { createAgentsExtension } from '@sheavly/agents/agents/agents.helper';
import { createCodingExtension } from '@sheavly/coding/extension/coding-extension.helper';
import { CODING_RUN } from '@sheavly/coding/extension/coding-extension.utils';
import { createCodingHarness } from '@sheavly/coding/preset/coding.helper';
import { ExtensionHost } from '@sheavly/extension/host/extension-host.service';
import { runServices } from '@sheavly/host/run-services/run-services.helper';
import { runSession } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { createWebExtension } from '@sheavly/web/web/web.helper';
import { createTavilySearchBackend } from '@sheavly/tools/web-search-backends/tavily-search.helper';
import { memoryShellStore } from '@sheavly/workspace/working-root/memory-shell.helper';
import { routeEmission } from './extension-emit.helper.js';
import { safeProblemReporter } from './extension-problems.helper.js';
import type { BackendHarness, BackendHarnessOptions } from './harness.types.js';

/**
 * What a backend run includes, chosen here and nowhere else: three extensions, composed by an
 * `ExtensionHost`. `web` adds `web_fetch` and `web_search` (if enabled);
 * `agents` adds the task tools, `read_output`/`search_output` (with `outputs`), `start_agent` with
 * `message_agent` and the history tools (with `logOf`); `coding` adds the file tools,
 * `read_skill`, `run_command`, the AGENTS.md, skills, scratch and working-root hooks, then the
 * workspace's `.sheavly/` hooks if it is trusted. `coding` and `web` share their tools (and
 * `coding` its hooks) with sub-agents through `agents`. The packages provide the pieces and the
 * shared services, never the choice. Skills are instructions, like AGENTS.md, so workspace trust
 * doesn't gate them.
 *
 * An embedding app adds its own with `extensions`, after these, without editing any of them. Every
 * extension, built-in or not, reads the run's provider, instructions, sessions, main session,
 * tasks, approvals (to request only) and outputs from the run services (`runServices`); the user's values for
 * the settings extensions declare are `extensionSettings`.
 *
 * An extension that fails to activate stops the run here with its own error (a broken `.sheavly`
 * hook names its file and the reason), after the ones that activated before it are deactivated.
 * The extensions are deactivated when the main session ends. An untrusted `project` extension is
 * left out and named in `skippedExtensions`, as is one whose manifest requires a service the run
 * lacks (with the missing names); this backend declares no trust for `project` extensions yet.
 * An extension is held to its `sheavly.json`: a service it reads, or a tool, hook or work kind
 * it contributes, that the manifest does not declare fails that extension and not the others.
 * What an extension emits (`context.emit`) reaches its session through the host's sink wired
 * here: an event is published to the stream, a notice queued for the model's next turn.
 */
export async function createBackendHarness(
  options: BackendHarnessOptions,
): Promise<BackendHarness> {
  const {
    trustStore,
    trustWorkspace = false,
    permissions,
    home,
    subAgentProvider,
    webFetch = {},
    webSearch = { backend: createTavilySearchBackend() },
    summarizeWith,
    keepAgentHistory,
    logOf,
    shell = memoryShellStore(),
    outputs,
    onFileReadsProblem,
    onExtensionProblem,
    extensions = [],
    extensionSettings,
    ...coding
  } = options;
  const harness = await createCodingHarness(coding);
  const { sessions } = harness;
  const host = new ExtensionHost({
    extensions: [
      createWebExtension({ webFetch, webSearch }),
      createAgentsExtension({ subAgentProvider, summarizeWith, keepAgentHistory, logOf }),
      createCodingExtension({
        harness,
        env: options.env,
        permissions,
        home,
        trustStore,
        trustWorkspace,
        shell,
        onFileReadsProblem,
      }),
      ...extensions,
    ],
    services: runServices({ harness, outputs, runSession }),
    settings: extensionSettings,
    // The sink is the host's option, not a run service, and no scoped service hands out `publish`,
    // `queueNotice` or `publishTask`, so an extension emits only through its own declared capability,
    // never under another's name.
    emit: (emission) => routeEmission({ sessions, main: harness.mainSession.id, emission }),
  });
  const lifetime = new AbortController();
  // The run goes on without what a problem concerns, so a UI hears of it, never the run.
  const onProblem = safeProblemReporter(onExtensionProblem);

  // Before activating: a session that ends while the extensions activate closes them too.
  sessions.subscribe((update) => {
    if (update.type !== 'session_ended' || update.session.id !== harness.mainSession.id) return;

    lifetime.abort();
    closeExtensions({ host, onProblem }).catch(onProblem);
  });

  const { contributions, settings, failed, skipped, lateDeactivationErrors } = await host
    .activate({ signal: lifetime.signal })
    .catch(async (caughtError: unknown) => {
      // The host stopped what had activated; its deactivate errors are told, the cause is thrown.
      lifetime.abort(caughtError);
      await closeExtensions({ host, onProblem });
      throw caughtError;
    });

  for (const lateError of lateDeactivationErrors) onProblem(lateError);

  if (failed[0]) {
    // What activated before the failure is stopped now: nothing else will, the run never starts.
    lifetime.abort(failed[0]);
    await closeExtensions({ host, onProblem });

    // Any further failure is told; the first is the run's own error, not a wrapper around it:
    // what failed is what the user must fix.
    for (const further of failed.slice(1)) onProblem(further);
    throw failed[0].cause;
  }

  const { workingRoots, skills, projectHooks, projectTrust } = host.service(CODING_RUN);

  return {
    ...harness,
    workingRoots,
    tools: [...contributions.tools],
    hooks: [...contributions.hooks],
    workKinds: [...contributions.workKinds],
    settings: [...settings],
    skippedExtensions: [...skipped],
    skills,
    projectHooks: [...projectHooks],
    projectTrust,
  };
}

/** Deactivates the run's extensions (once) and tells `onProblem` of each `deactivate` that threw. */
async function closeExtensions(params: {
  host: ExtensionHost;
  onProblem: (caughtError: unknown) => void;
}): Promise<void> {
  const { host, onProblem } = params;

  for (const caughtError of await host.deactivate()) onProblem(caughtError);
}
