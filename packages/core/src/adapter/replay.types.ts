/**
 * Why a stored reasoning item was not sent back to the model.
 * `replay_off`: the provider keeps no reasoning. `source_mismatch`: another protocol, endpoint or
 * model made it. `invalid_state`: its payload is not what this protocol stored. `message_edited`:
 * the message changed after the item was stored. `prefix_changed`: the signed thinking no longer
 * matches what precedes it, so the text and tool calls were kept and the thinking left out.
 */
export type ReplayDropReason =
  'replay_off' | 'source_mismatch' | 'invalid_state' | 'message_edited' | 'prefix_changed';

/** One reasoning item left out of a request. Carries no reasoning content and no credentials. */
export type ReplayDrop = {
  reason: ReplayDropReason;
  /** The `source` stored on the item, when the drop concerns one. */
  source?: string;
};

/** Told of every dropped replay, so a silent loss of reasoning is visible to the host. */
export type ReplayDropHandler = (drop: ReplayDrop) => void;
