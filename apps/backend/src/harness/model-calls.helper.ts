import { appendFileSync } from 'node:fs';
import type { ProviderRequest } from '@sheavly/core/provider/provider.types';
import { now } from '@sheavly/core/clock/clock.helper';
import type { ServedSettings } from './harness.types.js';
import { describeModelCall, modelCallLine } from './model-calls.utils.js';

/**
 * Where each model call goes: the file (`MODEL_CALLS_FILE`), and the log with `SHOW_MODEL_CALLS`.
 * Undefined for neither. This is a developer's debugging aid, not the user's data, so it is the one
 * file the backend appends to by hand.
 */
export function modelCallsTo(params: { settings: ServedSettings; log: (text: string) => void }) {
  const { settings, log } = params;
  const { modelCallsFile: file, showModelCalls: show } = settings;

  if (!file && !show) return undefined;

  return (request: ProviderRequest) => {
    // Appended as it happens, so a run that dies mid-way still has every call up to there.
    if (file) appendFileSync(file, modelCallLine({ request, at: now() }));
    if (show) log(describeModelCall(request));
  };
}
