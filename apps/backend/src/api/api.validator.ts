import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { ZodType } from 'zod';

/**
 * A route's JSON body, parsed with its protocol schema. A body that doesn't parse throws (answered
 * as `bad_request` in one place, `onError`), so a handler only ever sees a valid body.
 */
export function validJson<T extends ZodType>(schema: T) {
  return zValidator('json', schema, (result) => {
    if (!result.success) {
      throw new HTTPException(400, {
        message: result.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; '),
      });
    }
  });
}
