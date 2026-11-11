import type { RunRequest } from './workbook.types.js';

/**
 * What a run's backend reads, over `env`: the run's workspace, limits and files. A stored
 * prompt's `maxTurns` and `contextWindow` become `MAX_TURNS` and `CONTEXT_WINDOW`, so a check
 * can reach a limit (the summary trigger) with a short run instead of a long one.
 */
export function runEnv(params: {
  env: NodeJS.ProcessEnv;
  request: RunRequest;
  workspaceRoot: string;
  modelCalls: string;
  trustFile: string | undefined;
}): NodeJS.ProcessEnv {
  const { env, request, workspaceRoot, modelCalls, trustFile } = params;
  const { maxTurns, contextWindow } = request.stored ?? {};

  return {
    ...env,
    WORKSPACE_ROOT: workspaceRoot,
    MODEL_CALLS_FILE: modelCalls,
    SHOW_MODEL_CALLS: request.showModelCalls ? 'true' : 'false',
    ...(maxTurns !== undefined && { MAX_TURNS: String(maxTurns) }),
    ...(contextWindow !== undefined && { CONTEXT_WINDOW: String(contextWindow) }),
    ...(trustFile && { SHEAVLY_TRUST_FILE: trustFile }),
  };
}
