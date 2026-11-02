/** Test-only: Responses API output items, as a backend streams them with store=false + include. */

/** A reasoning output item with encrypted content (what makes it resendable statelessly). */
export const reasoningItem = (n: number) => ({
  type: 'reasoning',
  id: `rs_${n}`,
  summary: [],
  encrypted_content: `encrypted-${n}`,
});

/** A `function_call` output item asking for the `lookup` tool with `{ key: 'x' }`. */
export const lookupCall = () => ({
  type: 'function_call',
  call_id: 'c1',
  name: 'lookup',
  arguments: '{"description":"looking it up","key":"x"}',
});
