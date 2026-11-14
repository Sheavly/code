export function startServicePrompts(params: { outputsEnabled?: boolean }): {
  description: string;
} {
  const { outputsEnabled = false } = params;

  return {
    description:
      'Start a persistent server or watcher in the background and return its task id at once. ' +
      'It never keeps the prompt alive and runs until it exits or you stop it with cancel_task. ' +
      'The command rules, approval and `cwd` are those of run_command; use run_command with background: true for finite work (builds, tests, CI waits). ' +
      'Do not poll background work.' +
      (outputsEnabled
        ? ' The result gives an output_ref whose log grows while the service runs; read it with read_output or search_output.'
        : ''),
  };
}
