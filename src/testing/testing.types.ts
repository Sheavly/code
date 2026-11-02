import type { StreamEvent } from '@sheavly/core/message/message.types';
import type { ProviderRequest } from '@sheavly/core/provider/provider.types';
import type { Workspace } from '../runtime/workspace/workspace.service.js';

/** A temp workspace from `useTempWorkspace`; readable only while its tests run. */
export type TempWorkspace = {
  /** The temp dir; holds the workspace and the files outside it. */
  readonly base: string;
  /** The workspace root, `base/workspace`. */
  readonly root: string;
  readonly workspace: Workspace;
};

/** One model reply for `routedProvider`, computed from the request it answers. */
export type Script = (request: ProviderRequest) => StreamEvent[];
