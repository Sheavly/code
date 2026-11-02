import type { StreamEvent } from '@sheavly/core/message/message.types';
import type { ProviderRequest } from '@sheavly/core/provider/provider.types';

/** One model reply for `routedProvider`, computed from the request it answers. */
export type Script = (request: ProviderRequest) => StreamEvent[];
