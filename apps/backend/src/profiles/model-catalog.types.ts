import type { ModelOffering } from '@sheavly/protocol/setup/setup.types';
import type { z } from 'zod';
import type { azureChatAdapter } from '@sheavly/providers/azure/chat.adapter';

/** What a catalogue entry may override for a chat host; `z.input` keeps schema defaults optional. */
type ChatHostingPreset = Partial<
  Pick<
    z.input<typeof azureChatAdapter.configSchema>,
    'replayReasoning' | 'thinkingMode' | 'effortProfile'
  >
>;

/** Internal presets are merged into host defaults, never exposed as catalogue metadata. */
export type SetupModelTemplate = Pick<ModelOffering, 'name'> & {
  identity: Required<ModelOffering['identity']>;
  /** Only a host whose schema carries these fields may hold them; every other kind takes none. */
  hostingPresets?: {
    [Host in SetupHostingTemplate['adapter']]?: Host extends 'azure-chat'
      ? ChatHostingPreset
      : never;
  };
};

/**
 * App-owned hosting policy; model names and connection settings are separate choices. A `model`
 * field is fixed to the catalogue's id, a `deployment` one starts as it, and a `profile` one (a
 * Bedrock inference profile, whose prefix is the user's choice) starts empty and must name the
 * catalogue model of `profileOwner`.
 */
export type SetupHostingTemplate = {
  adapter:
    | 'azure-openai'
    | 'openai'
    | 'azure-anthropic'
    | 'azure-chat'
    | 'bedrock-anthropic'
    | 'bedrock-openai';
  name: string;
  families: string[];
  defaults: Record<string, unknown>;
} & (
  | { modelField: 'model' | 'deployment' }
  | { modelField: 'profile'; profileOwner: 'anthropic' | 'openai' }
);
