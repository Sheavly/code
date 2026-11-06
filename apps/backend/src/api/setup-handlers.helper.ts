import type { Context } from 'hono';
import type { z } from 'zod';
import { modelIdSchema } from '@sheavly/protocol/model/model.validator';
import { profileIdSchema } from '@sheavly/protocol/profile/profile.validator';
import type { ProfileSetup } from '../profiles/setup.service.js';
import { SetupError } from '../errors/setup.errors.js';
import type { ApiHandlers, SetupRouteName } from './api.types.js';

/**
 * The path param `name` as an id. One that isn't an id's shape (a lowercase UUID) can name nothing,
 * so it answers as one nothing has does: `not_found`, never a failure of the server's.
 */
function idParam<S extends z.ZodType>(params: {
  c: Context;
  name: string;
  schema: S;
  what: string;
}): z.output<S> {
  const { c, name, schema, what } = params;
  const parsed = schema.safeParse(c.req.param(name));

  if (!parsed.success) {
    throw new SetupError({
      reason: 'not_found',
      message: `No ${what} ${c.req.param(name) ?? ''}: a ${what} id is a lowercase UUID`,
    });
  }

  return parsed.data;
}

const profileOf = (c: Context) =>
  idParam({ c, name: 'profile', schema: profileIdSchema, what: 'profile' });
const modelOf = (c: Context) => idParam({ c, name: 'model', schema: modelIdSchema, what: 'model' });
const done = (c: Context) => c.body(null, 204);

/** Each setup route's handler on `setup`: one call on it and its result as the route answers it. */
export function setupHandlers(setup: ProfileSetup): Pick<ApiHandlers, SetupRouteName> {
  return {
    getSetup: async ({ c }) => c.json(await setup.setup()),
    setTerminalSettings: async ({ c, body }) => {
      await setup.setTerminalSettings(body);

      return done(c);
    },
    migrateTerminalSettings: async ({ c }) => c.json(await setup.migrateTerminalSettings()),
    listAdapters: ({ c }) => c.json({ adapters: setup.adapters() }),
    getProfile: async ({ c }) => c.json(await setup.profile(profileOf(c))),
    putProfile: async ({ c, body }) => {
      await setup.putProfile({ id: profileOf(c), ...body });

      return done(c);
    },
    deleteProfile: async ({ c }) => {
      await setup.deleteProfile(profileOf(c));

      return done(c);
    },
    queryModels: async ({ c, body }) =>
      c.json({ models: await setup.models({ profile: profileOf(c), search: body.search }) }),
    getModel: async ({ c }) =>
      c.json(await setup.model({ profile: profileOf(c), model: modelOf(c) })),
    putModel: async ({ c, body }) => {
      await setup.putModel({ profile: profileOf(c), id: modelOf(c), model: body });

      return done(c);
    },
    deleteModel: async ({ c }) => {
      await setup.deleteModel({ profile: profileOf(c), model: modelOf(c) });

      return done(c);
    },
    putCredential: async ({ c, body }) => {
      await setup.putCredential({
        profile: profileOf(c),
        model: modelOf(c),
        secrets: body.secrets,
      });

      return done(c);
    },
    deleteCredential: async ({ c }) => {
      await setup.deleteCredential({ profile: profileOf(c), model: modelOf(c) });

      return done(c);
    },
    checkCredential: async ({ c }) =>
      c.json(
        await setup.checkCredential({
          profile: profileOf(c),
          model: modelOf(c),
          signal: c.req.raw.signal,
        }),
      ),
    setDefaultProfile: async ({ c, body }) => {
      await setup.setDefaultProfile(body.profile);

      return done(c);
    },
  };
}
