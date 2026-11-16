import type { ApprovalId } from '@sheavly/protocol/approval/approval.types';
import { APPROVAL_TABLE, SETTLED_KEPT } from './approvals.constants.js';
import type { ApprovalState } from './approvals.types.js';

/**
 * Owns the state of every approval, by `APPROVAL_TABLE`: the registry asks here before it acts,
 * so a second answer, or an answer after a cancel, is refused in one place. Settled approvals
 * are remembered for `SETTLED_KEPT` entries, oldest first, so memory stays bounded.
 */
export class ApprovalStates {
  readonly #states = new Map<ApprovalId, ApprovalState>();
  #settled = 0;

  /** Records a new request as `requested`. */
  begin(id: ApprovalId): void {
    this.#states.set(id, 'requested');
  }

  /** The state of `id`, or undefined for one never begun or forgotten. */
  get(id: ApprovalId): ApprovalState | undefined {
    return this.#states.get(id);
  }

  /** Moves `id` to `to` and returns true, or returns false (changing nothing) if the table refuses. */
  move(params: { id: ApprovalId; to: ApprovalState }): boolean {
    const { id, to } = params;
    const from = this.#states.get(id);

    if (from === undefined) return false;
    if (!(APPROVAL_TABLE[from] as readonly ApprovalState[]).includes(to)) return false;

    this.#states.set(id, to);
    this.#settled += 1;
    this.#forgetOldest();

    return true;
  }

  #forgetOldest(): void {
    for (const [id, state] of this.#states) {
      if (this.#settled <= SETTLED_KEPT) return;

      if (state !== 'requested') {
        this.#states.delete(id);
        this.#settled -= 1;
      }
    }
  }
}
