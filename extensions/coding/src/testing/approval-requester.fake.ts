import type { ApprovalRequester } from '@sheavly/extension/run-services/run-services.types';
import type { ApprovalRegistry } from '@sheavly/runtime/approvals/approvals.service';

/**
 * A real registry as the `ApprovalRequester` an extension gets: requests and `listening` go to the
 * registry as they are. The registry requires the asking tool, which coding's calls always name;
 * a call that does not is refused, as no default exists in production to stand in for it.
 */
export function approvalRequesterOf(registry: ApprovalRegistry): ApprovalRequester {
  return {
    request: ({ tool, options, keeps, ...rest }) => {
      if (tool === undefined) {
        throw new Error('approvalRequesterOf needs the tool coding names in its request');
      }

      return registry.request({
        ...rest,
        tool,
        ...(options !== undefined && { options }),
        ...(keeps !== undefined && { keeps }),
      });
    },
    get listening() {
      return registry.listening;
    },
  };
}
