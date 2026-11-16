/**
 * Quick manual check: one prompt, a real model, every tool, printed as it happens.
 *
 *   npm run demo -- "Read package.json and tell me the project name"
 *
 * It starts its own backend with this environment's settings, on the models in the user's profile
 * (~/.sheavly), and stops it after.
 * WORKSPACE_ROOT confines file tools to a directory (default: current directory).
 * What commands run_command may run is the user's call per folder, asked in the conversation.
 * SHOW_MODEL_CALLS=true prints every model call (main session and sub-agents): its task, tools
 *   and system instructions.
 * SESSIONS_SSE_LOG=<file> writes the conversation's stream, as a UI reads it, to a file.
 * --trust trusts the workspace's .sheavly/ hooks (they run repo code); without it, an untrusted
 *   workspace runs none. SHEAVLY_TRUST_FILE moves the trust store (default ~/.sheavly/).
 * The prompt waits for its background tasks before it ends (Ctrl+C stops waiting).
 * This calls the real API and costs money (a fraction of a cent for a short prompt).
 *
 * For stored prompts, saved runs and inspecting what happened, use the workbook instead
 * (`npm run workbook`, see apps/terminal/docs/workbook.md).
 */
import { runDemo } from './demo/demo.helper.js';

process.exitCode = await runDemo({
  env: process.env,
  args: process.argv.slice(2),
  write: (text) => void process.stdout.write(text),
});
