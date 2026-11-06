import { z } from 'zod';
import { modelSchema, adapterDescriptionSchema } from '../model/model.validator.js';
import { profileIdSchema, profileSchema } from '../profile/profile.validator.js';
import { timestampSchema } from '../time/time.validator.js';
import { terminalSettingsSchema } from '../terminal-settings/terminal-settings.validator.js';

/**
 * Whether a model has the secrets its adapter needs. `not_needed`: its adapter has none (a local
 * model). `missing`: at least one is not set. `set`: all are. Never the secrets themselves: there
 * is no way to read one back.
 */
export const credentialStateSchema = z.enum(['not_needed', 'missing', 'set']);

/**
 * A model in a profile as a setup UI shows it: the model, whether its key is set, and whether a
 * conversation can run on it now (its adapter exists, its definition is valid, its key is set).
 * `definition` never holds a secret.
 */
export const setupModelSchema = modelSchema.extend({
  credential: credentialStateSchema,
  usable: z.boolean(),
});

/** A profile with its models. `ready`: a conversation can start on it (a model is usable). */
export const profileSetupSchema = profileSchema.extend({
  models: z.array(setupModelSchema),
  ready: z.boolean(),
});

/**
 * `GET /setup`: where the user's data is, the profiles, and which is the default. `problems` says
 * in words which stored files could not be read, so a UI can show why something is missing.
 */
export const setupSchema = z.object({
  home: z.string(),
  terminal: terminalSettingsSchema.exactOptional(),
  defaultProfile: profileIdSchema.exactOptional(),
  profiles: z.array(profileSetupSchema),
  problems: z.array(z.string()),
});

/** `GET /adapters`: what each adapter needs, for a UI to build its model form from. */
export const adaptersResponseSchema = z.object({ adapters: z.array(adapterDescriptionSchema) });

/**
 * `QUERY /profiles/{profile}/models`: which of a profile's models to list. Nothing: every one.
 * `search`: those whose name, adapter or provider-side model has it, ignoring case, as a picker
 * narrows while the user types.
 */
export const modelsQuerySchema = z.object({ search: z.string().min(1).exactOptional() });

/** `QUERY /profiles/{profile}/models`: the models, by name then id. */
export const modelsResponseSchema = z.object({ models: z.array(setupModelSchema) });

/** `PUT /profiles/{profile}`: make or rename a profile. */
export const putProfileRequestSchema = profileSchema.pick({ name: true });

/** `PUT /default-profile`: the profile new conversations use where a workspace has none. */
export const setDefaultProfileRequestSchema = z.object({ profile: profileIdSchema });

/** `PUT /profiles/{profile}/models/{model}`: a model's name, adapter and fields, without secrets. */
export const putModelRequestSchema = modelSchema.omit({ id: true });

/**
 * `PUT /profiles/{profile}/credentials/{model}`: the model's secrets by field name (`apiKey`),
 * replacing the ones it had. Write-only: no route answers with a value.
 */
export const putCredentialRequestSchema = z.object({
  secrets: z.record(z.string().min(1), z.string().min(1)),
});

/** A folder named in a request: an absolute path (a UI knows the path; the config keeps a hash). */
export const workspaceRequestSchema = z.object({ workspace: z.string().min(1) });

/** `PUT /workspace-profiles`: the folder always uses this profile, whatever the default is. */
export const bindWorkspaceRequestSchema = workspaceRequestSchema.extend({
  profile: profileIdSchema,
});

/**
 * `QUERY /workspace-profiles`: the profile a folder runs on and why. `bound`: it was chosen for
 * this folder; otherwise it is the default. No `profile` when it is not bound and there is no
 * default (nothing is set up).
 */
export const workspaceProfileSchema = z.object({
  workspace: z.string(),
  profile: profileIdSchema.exactOptional(),
  bound: z.boolean(),
});

/**
 * A workspace the user trusts to run its `.sheavly/` hooks: where it is (the real path it was
 * trusted under), when, and whether that still holds. `trusted`: yes. `changed`: its `.sheavly/`
 * changed since, so its hooks don't run until it is trusted again. `gone`: the folder is no longer
 * there; revoking it clears the entry.
 */
export const trustedWorkspaceSchema = z.object({
  root: z.string(),
  trustedAt: timestampSchema,
  state: z.enum(['trusted', 'changed', 'gone']),
});

/** `QUERY /trusted-workspaces`: which to list. Nothing: every one. `search`: paths that have it. */
export const trustedWorkspacesQuerySchema = z.object({ search: z.string().min(1).exactOptional() });

/** `QUERY /trusted-workspaces`: the trusted workspaces, oldest first. */
export const trustedWorkspacesResponseSchema = z.object({
  workspaces: z.array(trustedWorkspaceSchema),
});
