import { expectTypeOf, it } from 'vitest';
import type { ProviderRequest } from '../../provider/provider.types.js';
import type { AgentEvent } from '@sheavly/protocol/event/event.types';
import type { HarnessNotice } from '@sheavly/protocol/notice/notice.types';

it('uses exactly the same protocol notice type for model requests and UI events', () => {
  expectTypeOf<NonNullable<ProviderRequest['notice']>>().toEqualTypeOf<HarnessNotice>();
  expectTypeOf<
    Extract<AgentEvent, { type: 'harness_notice' }>['notice']
  >().toEqualTypeOf<HarnessNotice>();
});
