import { z } from 'zod';

const webUrl = z.url({ protocol: /^https?$/ });

// A link to something on the web, such as a picture, until files can be stored. Only web links
// are accepted, and not ones that carry a user name and password. The code is what a problem is
// called, so each field can have its own sentence (LOGO_URL_INVALID, IMAGE_URL_INVALID).
export function webLinkSchema(code: string) {
  return z
    .string()
    .trim()
    .max(2048, code)
    .refine(
      (value) => webUrl.safeParse(value).success && !/^https?:\/\/[^/?#]*@/i.test(value),
      code,
    );
}
