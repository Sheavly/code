import type { SelectItem } from '@earendil-works/pi-tui';
import type { createClient } from '@sheavly/client/client/client.helper';
import type {
  AdapterDescription,
  ModelId,
  ModelIdentity,
} from '@sheavly/protocol/model/model.types';
import type { ModelOffering } from '@sheavly/protocol/setup/setup.types';
import type { ProfileId } from '@sheavly/protocol/profile/profile.types';
import type { z } from 'zod';
import type { fieldSchema } from './fields.validator.js';

export type SetupClient = ReturnType<typeof createClient>;

export type SetupText = {
  title: string;
  description?: string;
  initial?: string;
  secret?: boolean;
  validate?: (value: string) => string | undefined;
};

/** The setup workflow uses the API; this port owns only questions and notices. */
export type SetupUi = {
  signal: AbortSignal;
  text: (question: SetupText) => Promise<string>;
  choose: (question: { title: string; items: SelectItem[]; initial?: string }) => Promise<string>;
  notice: (message: string) => void;
};

export type SetupField = z.infer<typeof fieldSchema>;

export type ModelSetup = {
  client: SetupClient;
  ui: SetupUi;
  profile: ProfileId;
  model: ModelId;
  adapter: AdapterDescription;
  preset?: ModelSetupPreset;
};

export type ModelSetupPreset = {
  name: string;
  identity: ModelIdentity;
  host: ModelOffering['hosts'][number];
};
