import { apiErrorSchema, type SessionResponse, sessionResponseSchema } from '@pos/shared';
import type { z } from 'zod';
import { sessionStore } from './session-store';

const BASE_URL = '/api/v1';

// A request that gets no answer for this long fails, so a stalled connection cannot leave the
// app waiting for ever.
const REQUEST_TIMEOUT_MS = 15_000;

// An error answer from the API, with the error code from the spec (for example ACCOUNT_LOCKED).
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function readError(res: Response): Promise<ApiError> {
  try {
    const { error } = apiErrorSchema.parse(await res.json());
    return new ApiError(res.status, error.code, error.message, error.details);
  } catch {
    return new ApiError(res.status, 'UNKNOWN', res.statusText || 'The request failed');
  }
}

interface SendOptions {
  method?: string;
  body?: unknown;
  token?: string | null;
}

function send(path: string, { method = 'GET', body, token }: SendOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  return fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function performRefresh(): Promise<SessionResponse | null> {
  const before = sessionStore.get();
  try {
    const res = await send('/auth/refresh', { method: 'POST' });
    if (res.ok) {
      const session = sessionResponseSchema.parse(await res.json());
      sessionStore.set(session);
      return session;
    }
    // The session is really over. Other failures (server down, offline) keep it for a retry.
    // If someone signed in while this refresh was running, that new session stays.
    if (res.status === 401 && sessionStore.get() === before) sessionStore.set(null);
  } catch {
    // No connection: keep the current session.
  }
  return null;
}

let refreshing: Promise<SessionResponse | null> | null = null;

// Gets a new access token from the refresh cookie. Requests that fail at the same moment share
// one refresh, and the Web Locks API makes browser tabs take turns, because every refresh
// replaces the cookie and a second tab would otherwise send a token that was just used.
export function refreshSession(): Promise<SessionResponse | null> {
  refreshing ??= (
    typeof navigator.locks === 'object'
      ? navigator.locks.request('pos-auth-refresh', performRefresh)
      : performRefresh()
  ).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

interface RequestOptions<Schema extends z.ZodType> {
  method?: string;
  body?: unknown;
  schema: Schema;
  // Sign-in itself has no token to send.
  authenticated?: boolean;
}

// Sends a request and checks the answer against its schema. If the access token has expired,
// it refreshes the session once and tries again.
export async function request<Schema extends z.ZodType>(
  path: string,
  { method, body, schema, authenticated = true }: RequestOptions<Schema>,
): Promise<z.output<Schema>> {
  const call = (token: string | null) => send(path, { method, body, token });

  let res = await call(authenticated ? (sessionStore.get()?.accessToken ?? null) : null);

  if (res.status === 401 && authenticated) {
    const refreshed = await refreshSession();
    if (refreshed) res = await call(refreshed.accessToken);
  }

  if (!res.ok) throw await readError(res);
  return schema.parse(await res.json());
}

// For routes that answer 204 No Content.
export async function requestNoContent(path: string, method = 'POST'): Promise<void> {
  const res = await send(path, { method });
  if (!res.ok) throw await readError(res);
}
