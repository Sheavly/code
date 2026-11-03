/**
 * A tool call's arguments as the model sent them (a JSON string), parsed. Invalid JSON is kept as
 * the raw string: the tool's zod schema rejects it and tells the model, rather than the run failing.
 */
export function parseToolArguments(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch (caughtError) {
    if (!(caughtError instanceof SyntaxError)) throw caughtError;

    return json;
  }
}
