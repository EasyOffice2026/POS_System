import { pageSchema, brandSchema } from '@pos/shared';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { burgerBrand, groupAdmin, page, pizzaBrand, sessionFor } from '../test/fixtures';
import { errorResponse, json, mockApi } from '../test/mock-api';
import { ApiError, refreshSession, request, requestNoContent } from './api';
import { sessionStore } from './session-store';

const brandsPage = pageSchema(brandSchema);

describe('request', () => {
  it('sends the access token as a bearer token and checks the answer', async () => {
    sessionStore.set(sessionFor(groupAdmin, 'token-a'));
    const api = mockApi({ 'GET /api/v1/brands': () => json(page([pizzaBrand, burgerBrand])) });

    const result = await request('/brands', { schema: brandsPage });

    expect(result.data).toHaveLength(2);
    expect(api.calls[0]?.authorization).toBe('Bearer token-a');
  });

  it('turns an error answer into an ApiError with its code, status and details', async () => {
    sessionStore.set(sessionFor(groupAdmin));
    mockApi({ 'GET /api/v1/brands': () => errorResponse(403, 'FORBIDDEN', { why: 'test' }) });

    const failure = request('/brands', { schema: brandsPage });

    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
      details: { why: 'test' },
    });
  });

  it('still gives an ApiError when the answer is not in the API error format', async () => {
    sessionStore.set(sessionFor(groupAdmin));
    mockApi({ 'GET /api/v1/brands': () => new Response('Bad gateway', { status: 502 }) });

    await expect(request('/brands', { schema: brandsPage })).rejects.toMatchObject({
      status: 502,
      code: 'UNKNOWN',
    });
  });

  it('refuses an answer that does not match the schema', async () => {
    sessionStore.set(sessionFor(groupAdmin));
    mockApi({ 'GET /api/v1/brands': () => json({ unexpected: true }) });

    await expect(request('/brands', { schema: brandsPage })).rejects.toThrow();
  });

  it('gives up on a request that gets no answer', async () => {
    sessionStore.set(sessionFor(groupAdmin));
    const api = mockApi({ 'GET /api/v1/brands': () => json(page([])) });

    await request('/brands', { schema: brandsPage });

    const init = api.fetchMock.mock.calls[0]?.[1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('posts a JSON body', async () => {
    const api = mockApi({ 'POST /api/v1/things': () => json({ ok: true }) });

    await request('/things', {
      method: 'POST',
      body: { a: 1 },
      schema: z.object({ ok: z.boolean() }),
      authenticated: false,
    });

    expect(api.calls[0]?.body).toEqual({ a: 1 });
    expect(api.calls[0]?.authorization).toBeNull();
  });
});

describe('an expired access token', () => {
  it('is replaced through the refresh cookie, and the request is repeated once', async () => {
    sessionStore.set(sessionFor(groupAdmin, 'old-token'));
    const api = mockApi({
      'GET /api/v1/brands': ({ authorization }) =>
        authorization === 'Bearer new-token'
          ? json(page([pizzaBrand]))
          : errorResponse(401, 'TOKEN_EXPIRED'),
      'POST /api/v1/auth/refresh': () => json(sessionFor(groupAdmin, 'new-token')),
    });

    const result = await request('/brands', { schema: brandsPage });

    expect(result.data).toHaveLength(1);
    expect(api.count('GET /api/v1/brands')).toBe(2);
    expect(api.count('POST /api/v1/auth/refresh')).toBe(1);
    expect(sessionStore.get()?.accessToken).toBe('new-token');
  });

  it('is refreshed only once when several requests fail at the same moment', async () => {
    sessionStore.set(sessionFor(groupAdmin, 'old-token'));
    const api = mockApi({
      'GET /api/v1/brands': ({ authorization }) =>
        authorization === 'Bearer new-token'
          ? json(page([pizzaBrand]))
          : errorResponse(401, 'TOKEN_EXPIRED'),
      'POST /api/v1/auth/refresh': () => json(sessionFor(groupAdmin, 'new-token')),
    });

    await Promise.all([
      request('/brands', { schema: brandsPage }),
      request('/brands', { schema: brandsPage }),
      request('/brands', { schema: brandsPage }),
    ]);

    expect(api.count('POST /api/v1/auth/refresh')).toBe(1);
  });

  it('ends the session when the refresh is refused', async () => {
    sessionStore.set(sessionFor(groupAdmin, 'old-token'));
    mockApi({
      'GET /api/v1/brands': () => errorResponse(401, 'TOKEN_EXPIRED'),
      'POST /api/v1/auth/refresh': () => errorResponse(401, 'INVALID_REFRESH_TOKEN'),
    });

    await expect(request('/brands', { schema: brandsPage })).rejects.toMatchObject({ status: 401 });

    expect(sessionStore.get()).toBeNull();
  });

  it('keeps the session when the refresh could not reach the server', async () => {
    sessionStore.set(sessionFor(groupAdmin, 'old-token'));
    mockApi({
      'GET /api/v1/brands': () => errorResponse(401, 'TOKEN_EXPIRED'),
      'POST /api/v1/auth/refresh': () => {
        throw new TypeError('Failed to fetch');
      },
    });

    await expect(request('/brands', { schema: brandsPage })).rejects.toMatchObject({ status: 401 });

    expect(sessionStore.get()?.accessToken).toBe('old-token');
  });

  it('is not repeated more than once', async () => {
    sessionStore.set(sessionFor(groupAdmin, 'old-token'));
    const api = mockApi({
      'GET /api/v1/brands': () => errorResponse(401, 'UNAUTHENTICATED'),
      'POST /api/v1/auth/refresh': () => json(sessionFor(groupAdmin, 'new-token')),
    });

    await expect(request('/brands', { schema: brandsPage })).rejects.toMatchObject({ status: 401 });

    expect(api.count('GET /api/v1/brands')).toBe(2);
    expect(api.count('POST /api/v1/auth/refresh')).toBe(1);
  });

  it('does not try to refresh after a failed sign-in', async () => {
    const api = mockApi({
      'POST /api/v1/auth/login': () => errorResponse(401, 'INVALID_CREDENTIALS'),
      'POST /api/v1/auth/refresh': () => json(sessionFor(groupAdmin)),
    });

    await expect(
      request('/auth/login', {
        method: 'POST',
        body: {},
        schema: z.unknown(),
        authenticated: false,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });

    expect(api.count('POST /api/v1/auth/refresh')).toBe(0);
  });
});

describe('refreshSession', () => {
  it('does not end a session that started while the refresh was running', async () => {
    let answer: (response: Response) => void = () => undefined;
    mockApi({
      'POST /api/v1/auth/refresh': () => new Promise<Response>((resolve) => (answer = resolve)),
    });

    const pending = refreshSession();
    sessionStore.set(sessionFor(groupAdmin, 'signed-in-meanwhile'));
    answer(errorResponse(401, 'INVALID_REFRESH_TOKEN'));
    await pending;

    expect(sessionStore.get()?.accessToken).toBe('signed-in-meanwhile');
  });

  it('makes browser tabs take turns when the Web Locks API exists', async () => {
    const lock = vi.fn((_name: string, callback: () => Promise<unknown>) => callback());
    vi.stubGlobal('navigator', { ...navigator, locks: { request: lock } });
    mockApi({ 'POST /api/v1/auth/refresh': () => json(sessionFor(groupAdmin, 'fresh')) });

    await refreshSession();

    expect(lock).toHaveBeenCalledWith('pos-auth-refresh', expect.any(Function));
    expect(sessionStore.get()?.accessToken).toBe('fresh');
  });
});

describe('requestNoContent', () => {
  it('accepts an empty answer', async () => {
    mockApi({ 'POST /api/v1/auth/logout': () => new Response(null, { status: 204 }) });

    await expect(requestNoContent('/auth/logout')).resolves.toBeUndefined();
  });

  it('throws an ApiError on failure', async () => {
    mockApi({ 'POST /api/v1/auth/logout': () => errorResponse(500, 'INTERNAL_ERROR') });

    await expect(requestNoContent('/auth/logout')).rejects.toMatchObject({ status: 500 });
  });
});
