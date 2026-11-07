import { z } from 'zod';
import { domainToASCII } from 'node:url';
import { WEB_FETCH_DEFAULTS } from './web-fetch.constants.js';

const domainSchema = z
  .string()
  .trim()
  .regex(/^[^\s/:@?#[\]%]+$/, 'Use a bare domain, without wildcards')
  .transform((domain) => domainToASCII(domain.toLowerCase().replace(/\.$/, '')))
  .pipe(z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/, 'Use a bare domain, without wildcards'));

/** Domain rules apply to the named domain and its subdomains; deny takes precedence. */
export const webFetchOptionsSchema = z.object({
  timeoutMs: z.number().int().positive().max(2_147_483_647).default(WEB_FETCH_DEFAULTS.timeoutMs),
  maxBytes: z.number().int().positive().default(WEB_FETCH_DEFAULTS.maxBytes),
  maxChars: z.number().int().positive().default(WEB_FETCH_DEFAULTS.maxChars),
  maxRedirects: z.number().int().nonnegative().default(WEB_FETCH_DEFAULTS.maxRedirects),
  allowedDomains: z.array(domainSchema).optional(),
  deniedDomains: z.array(domainSchema).default([]),
});

export const webFetchUrlSchema = z.url({ protocol: /^https?$/ }).pipe(
  z.string().refine((value) => {
    const url = new URL(value);

    return !url.username && !url.password;
  }, 'URLs with credentials are not allowed'),
);
