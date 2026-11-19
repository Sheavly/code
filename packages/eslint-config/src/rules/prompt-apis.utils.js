// The harness APIs that take model instructions as an option, which `harness/prompt-location`
// checks at each call. The list is hand-written because the rule reads a call's callee, not the
// callee's types. `prompt-apis.test.js` holds it to the code with `findInstructionApis`
// (`testing/instruction-apis.fake.js`): it fails when an exported function takes instructions and
// is not listed here, or a listed one no longer exists.

// These are API bindings, not prose keywords or names of prompt variables. Relative and
// namespace aliases resolve to the same imported binding; typed contracts cover routed options.
export const OPTION_APIS = new Set([
  'createHarness',
  'createConversation',
  'createSubAgentTool',
  'runAgent',
  'streamAgent',
  'runSession',
  'sample',
  'buildContributions',
  'composeInstructions',
  'composeSystemPrompt',
  'appendInstructionContext',
]);
