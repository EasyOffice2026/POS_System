import { randomUUID } from 'node:crypto';
import express, { Router } from 'express';
import { z } from 'zod';
import { errors } from '../../lib/http-errors';
import type { Storage } from '../../lib/storage';
import { parseWith } from '../../lib/validate';
import { requestContext } from '../../middleware/authenticate';

// A photo for a dish or a brand's logo, sent as the body of the request with its own content type
// (image/jpeg, image/png or image/webp, at most 5 MB). The answer is the address to keep in the
// item's or the brand's link. See docs/deployment.md, "Images".
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const kinds = { item: 'menu:write', logo: 'brands:write' } as const;
const querySchema = z.object({
  kind: z.enum(['item', 'logo']),
  // A group admin names the brand; everybody else uploads for their own.
  brandId: z.uuid().optional(),
});

// What the first bytes of a real image look like; the content type alone is not trusted.
const signatures: { type: string; ext: string; starts: number[]; at?: number }[] = [
  { type: 'image/jpeg', ext: 'jpg', starts: [0xff, 0xd8, 0xff] },
  { type: 'image/png', ext: 'png', starts: [0x89, 0x50, 0x4e, 0x47] },
  { type: 'image/webp', ext: 'webp', starts: [0x57, 0x45, 0x42, 0x50], at: 8 },
];

export function imageTypeOf(bytes: Uint8Array): { type: string; ext: string } | null {
  for (const signature of signatures) {
    const at = signature.at ?? 0;
    if (signature.starts.every((byte, index) => bytes[at + index] === byte)) {
      return { type: signature.type, ext: signature.ext };
    }
  }
  return null;
}

export function createUploadsRouter({ storage }: { storage: Storage }): Router {
  const router = Router();

  router.post(
    '/images',
    express.raw({ type: 'image/*', limit: MAX_IMAGE_BYTES }),
    async (req, res) => {
      const { auth } = requestContext(req);
      // Nobody without one of the two rights gets as far as the query check.
      if (!Object.values(kinds).some((right) => auth.permissions.includes(right))) {
        throw errors.forbidden();
      }
      const query = parseWith(querySchema, req.query);
      if (!auth.permissions.includes(kinds[query.kind])) throw errors.forbidden();
      const brandId = auth.brandId ?? query.brandId;
      if (!brandId) throw errors.validation([{ path: 'brandId', message: 'BRAND_REQUIRED' }]);
      if (!storage.enabled) {
        throw errors.conflict('STORAGE_NOT_SET_UP', 'Photo storage is not set up on this server');
      }
      const bytes = Buffer.isBuffer(req.body) ? new Uint8Array(req.body) : new Uint8Array();
      const image = imageTypeOf(bytes);
      if (bytes.length === 0 || !image) {
        throw errors.validation([{ path: 'file', message: 'IMAGE_INVALID' }]);
      }
      const stored = await storage.put(
        `${brandId}/${query.kind}/${randomUUID()}.${image.ext}`,
        bytes,
        image.type,
      );
      res.status(201).json({ url: stored.url });
    },
  );

  return router;
}
