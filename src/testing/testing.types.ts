import type { StreamEvent } from '@sheavly/core/message/message.types';
import type { ProviderRequest } from '@sheavly/core/provider/provider.types';

/** A request seen by `fakeFetch`. */
export type RecordedRequest = {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
};

/** One model reply for `routedProvider`, computed from the request it answers. */
export type Script = (request: ProviderRequest) => StreamEvent[];
