import { fileTrail } from '@sheavly/coding/trail/trail.utils';
import type { Provider } from '@sheavly/core/provider/provider.types';
import type { SummaryOptions } from '@sheavly/core/summary/summary.types';
import { redactDiagnosticText } from '@sheavly/runtime/errors/diagnostic-text.utils';
import { modelSummarizer } from '@sheavly/summary/model/model.helper';
import { trailSection } from '@sheavly/summary/sections/trail.utils';
import { userMessagesSection } from '@sheavly/summary/sections/user-messages.utils';
import { SUB_AGENT_TASK_TITLE } from './summary.prompt.js';

/**
 * What the backend summarizes a long history with: the model the conversation is on writes the
 * sections it is asked for, and rules keep what the user asked and a trail of the files and
 * commands the work touched (`fileTrail`, which knows the coding tools). Thresholds are the
 * loop's defaults. The conversation passes its model switch, so a summary is written by whichever
 * model is active when it is written; a sub-agent passes its pinned provider, so its summaries
 * stay on the model it runs on. Credential forms are redacted from the history sent to the
 * summary model and from the sections it writes (`redactDiagnosticText`, a pattern match, not a
 * guarantee). It also masks any 32-character or longer hex run, so a commit SHA or a hash in the
 * history does not survive into a summary.
 */
export function backendSummary(provider: Provider): SummaryOptions {
  return summaryOn({ provider });
}

/**
 * The same for a sub-agent. Its one message with an id is the task its parent agent wrote, not a
 * person's words, so the section says so: a summary must not give a model's text a user's
 * authority.
 */
export function subAgentSummary(provider: Provider): SummaryOptions {
  return summaryOn({ provider, userTitle: SUB_AGENT_TASK_TITLE });
}

/** `userTitle` left out keeps the section's own heading, so it is named in one place. */
function summaryOn(params: { provider: Provider; userTitle?: string }): SummaryOptions {
  const { provider, userTitle } = params;

  return {
    summarizer: modelSummarizer({
      provider,
      redact: redactDiagnosticText,
      name: 'backend',
      ruleSections: [
        userMessagesSection(userTitle === undefined ? {} : { title: userTitle }),
        trailSection({ extract: fileTrail }),
      ],
    }),
  };
}
