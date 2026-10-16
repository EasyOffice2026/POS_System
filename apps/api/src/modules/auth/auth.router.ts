import { apiError, changePasswordRequestSchema, loginRequestSchema } from '@pos/shared';
import { parseCookie } from 'cookie';
import { type CookieOptions, type Request, type RequestHandler, Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Config } from '../../config';
import { errors } from '../../lib/http-errors';
import { requestMeta } from '../../lib/request-meta';
import { parseWith } from '../../lib/validate';
import type { AuthService } from './auth.service';

// The refresh cookie is only sent to the auth routes.
const COOKIE_PATH = '/api/v1/auth';

export function createAuthRouter(deps: {
  service: AuthService;
  authenticate: RequestHandler;
  config: Config;
}): Router {
  const { service, authenticate, config } = deps;
  const cookie = config.refreshToken;
  const router = Router();

  // Only failed requests count, so a branch behind one IP address can still sign in all day.
  const limiter = rateLimit({
    windowMs: config.authRateLimit.windowMs,
    limit: config.authRateLimit.max,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json(apiError('RATE_LIMITED', 'Too many requests. Try again later'));
    },
  });

  const cookieOptions = (): CookieOptions => ({
    httpOnly: true,
    secure: cookie.cookieSecure,
    sameSite: 'strict',
    path: COOKIE_PATH,
  });
  const readToken = (req: Request) => parseCookie(req.headers.cookie ?? '')[cookie.cookieName];

  router.post('/login', limiter, async (req, res) => {
    const input = parseWith(loginRequestSchema, req.body);
    const result = await service.login(input, requestMeta(req));

    res.cookie(cookie.cookieName, result.refreshToken, {
      ...cookieOptions(),
      expires: result.refreshExpiresAt,
    });
    res.json(result.session);
  });

  router.post('/refresh', limiter, async (req, res) => {
    try {
      const result = await service.refresh(readToken(req), requestMeta(req));
      res.cookie(cookie.cookieName, result.refreshToken, {
        ...cookieOptions(),
        expires: result.refreshExpiresAt,
      });
      res.json(result.session);
    } catch (error) {
      res.clearCookie(cookie.cookieName, cookieOptions());
      throw error;
    }
  });

  router.post('/logout', async (req, res) => {
    await service.logout(readToken(req), requestMeta(req));
    res.clearCookie(cookie.cookieName, cookieOptions());
    res.status(204).end();
  });

  // A person changes their own password; the device gets a fresh session.
  router.post('/password', authenticate, async (req, res) => {
    if (!req.auth) throw errors.unauthenticated();
    const input = parseWith(changePasswordRequestSchema, req.body);
    const result = await service.changePassword(req.auth, input, requestMeta(req));
    res.cookie(cookie.cookieName, result.refreshToken, {
      ...cookieOptions(),
      expires: result.refreshExpiresAt,
    });
    res.json(result.session);
  });

  router.get('/me', authenticate, async (req, res) => {
    if (!req.auth) throw errors.unauthenticated();
    res.json(await service.me(req.auth));
  });

  return router;
}
