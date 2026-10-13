import { vi } from 'vitest';

export interface MockRequest {
  url: URL;
  method: string;
  body: unknown;
  authorization: string | null;
}

export type MockHandler = (request: MockRequest) => Response | Promise<Response>;

// Replaces fetch. Handlers are keyed like "POST /api/v1/auth/login". A request without a
// handler fails the test, so the app cannot quietly call something the test did not expect.
export function mockApi(handlers: Record<string, MockHandler>) {
  const calls: (MockRequest & { key: string })[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, 'http://localhost');
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    const request: MockRequest = { url, method, body, authorization: headers.get('Authorization') };
    const key = `${method} ${url.pathname}`;

    calls.push({ ...request, key });
    const handler = handlers[key];
    if (!handler) throw new Error(`Unexpected request: ${key}`);
    return handler(request);
  });
  vi.stubGlobal('fetch', fetchMock);

  return {
    calls,
    fetchMock,
    count: (key: string) => calls.filter((call) => call.key === key).length,
  };
}

export const json = (body: unknown, status = 200) => Response.json(body, { status });

export const errorResponse = (status: number, code: string, details?: unknown) =>
  json({ error: { code, message: code, details } }, status);
