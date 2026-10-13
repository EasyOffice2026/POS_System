import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  burgerBrand,
  groupAdmin,
  page,
  pizzaBrand,
  pizzaMall,
  sessionFor,
} from '../../test/fixtures';
import { errorResponse, json, mockApi, type MockHandler } from '../../test/mock-api';
import { renderApp } from '../../test/render-app';
import { sessionStore } from '../../lib/session-store';

const REFRESH = 'POST /api/v1/auth/refresh';
const LOGIN = 'POST /api/v1/auth/login';
const LOGOUT = 'POST /api/v1/auth/logout';

// What the dashboard asks for once somebody is signed in.
const dashboard: Record<string, MockHandler> = {
  'GET /api/v1/inventory/alerts': () => json({ data: [] }),
  'GET /api/v1/brands': () => json(page([pizzaBrand, burgerBrand])),
  [`GET /api/v1/brands/${pizzaBrand.id}/branches`]: () => json(page([pizzaMall])),
  [`GET /api/v1/brands/${burgerBrand.id}/branches`]: () => json(page([])),
};

const noSession: MockHandler = () => errorResponse(401, 'INVALID_REFRESH_TOKEN');

async function signIn(user: ReturnType<typeof userEvent.setup>, email = 'admin@pos.local') {
  await user.type(await screen.findByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), 'secret-password');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('protected pages', () => {
  it('send a signed-out visitor to the login page', async () => {
    mockApi({ [REFRESH]: noSession });

    const { router } = renderApp('/admin');

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('show a loading message while the session is being restored', async () => {
    let finish: (response: Response) => void = () => undefined;
    mockApi({ [REFRESH]: () => new Promise<Response>((resolve) => (finish = resolve)) });

    renderApp('/admin');

    expect(await screen.findByText('Loading…')).toBeInTheDocument();
    // Let the check end, so it cannot leak into the next test.
    finish(errorResponse(401, 'INVALID_REFRESH_TOKEN'));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('let somebody in whose refresh cookie is still good', async () => {
    mockApi({ [REFRESH]: () => json(sessionFor(groupAdmin)), ...dashboard });

    const { router } = renderApp('/admin');

    expect(await screen.findByText('Welcome, Group Admin')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/admin');
  });

  it('send the home page to the dashboard', async () => {
    mockApi({ [REFRESH]: () => json(sessionFor(groupAdmin)), ...dashboard });

    const { router } = renderApp('/');

    await screen.findByText('Welcome, Group Admin');
    expect(router.state.location.pathname).toBe('/admin');
  });

  it('show a not-found page for an unknown address', async () => {
    mockApi({ [REFRESH]: noSession });

    renderApp('/nowhere');

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the dashboard' })).toHaveAttribute(
      'href',
      '/admin',
    );
  });
});

describe('signing in', () => {
  it('opens the dashboard and sends the email and password', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      [REFRESH]: noSession,
      [LOGIN]: () => json(sessionFor(groupAdmin)),
      ...dashboard,
    });
    const { router } = renderApp('/login');

    await signIn(user, 'admin@pos.local');

    expect(await screen.findByText('Welcome, Group Admin')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/admin');
    expect(api.calls.find((call) => call.key === LOGIN)?.body).toEqual({
      type: 'password',
      email: 'admin@pos.local',
      password: 'secret-password',
    });
  });

  it('takes the person back to the page they asked for', async () => {
    const user = userEvent.setup();
    mockApi({ [REFRESH]: noSession, [LOGIN]: () => json(sessionFor(groupAdmin)), ...dashboard });
    const { router } = renderApp('/admin');

    await signIn(user);

    await screen.findByText('Welcome, Group Admin');
    expect(router.state.location.pathname).toBe('/admin');
  });

  it('sends somebody who is already signed in away from the login page', async () => {
    mockApi({ [REFRESH]: () => json(sessionFor(groupAdmin)), ...dashboard });

    const { router } = renderApp('/login');

    await screen.findByText('Welcome, Group Admin');
    expect(router.state.location.pathname).toBe('/admin');
  });

  it('keeps the form busy while the request is running', async () => {
    const user = userEvent.setup();
    mockApi({ [REFRESH]: noSession, [LOGIN]: () => new Promise<Response>(() => undefined) });
    renderApp('/login');

    await signIn(user);

    const button = await screen.findByRole('button', { name: 'Signing in…' });
    expect(button).toBeDisabled();
  });

  it('does not start a second request while the first is running', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      [REFRESH]: noSession,
      [LOGIN]: () => new Promise<Response>(() => undefined),
    });
    renderApp('/login');

    await signIn(user);
    await user.click(await screen.findByRole('button', { name: 'Signing in…' }));

    expect(api.count(LOGIN)).toBe(1);
  });

  it('does not lose a login to a slow session check that fails afterwards', async () => {
    const user = userEvent.setup();
    let failRefresh: () => void = () => undefined;
    mockApi({
      [REFRESH]: () =>
        new Promise<Response>((resolve) => {
          failRefresh = () => resolve(errorResponse(401, 'INVALID_REFRESH_TOKEN'));
        }),
      [LOGIN]: () => json(sessionFor(groupAdmin)),
      ...dashboard,
    });
    renderApp('/login');
    // The page is already usable while the check is still running; the person signs in quickly.
    await user.type(await screen.findByLabelText('Email'), 'admin@pos.local');
    await user.type(screen.getByLabelText('Password'), 'secret-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText('Welcome, Group Admin');

    failRefresh();

    await waitFor(() => expect(sessionStore.get()).not.toBeNull());
    expect(screen.getByText('Welcome, Group Admin')).toBeInTheDocument();
  });
});

describe('sign-in errors', () => {
  async function failWith(response: MockHandler) {
    const user = userEvent.setup();
    mockApi({ [REFRESH]: noSession, [LOGIN]: response });
    renderApp('/login');
    await signIn(user);
    return user;
  }

  it('say when the email or password is wrong', async () => {
    await failWith(() => errorResponse(401, 'INVALID_CREDENTIALS'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The email or password is not correct.',
    );
  });

  it('say how long a locked account has to wait', async () => {
    await failWith(() => errorResponse(429, 'ACCOUNT_LOCKED', { retryAfterSeconds: 900 }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This account is locked after too many failed attempts. Try again in 15 minutes.',
    );
  });

  it('use the singular for one minute', async () => {
    await failWith(() => errorResponse(429, 'ACCOUNT_LOCKED', { retryAfterSeconds: 30 }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Try again in 1 minute.');
  });

  it('say when there were too many requests', async () => {
    await failWith(() => errorResponse(429, 'RATE_LIMITED'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts.');
  });

  it('say when the server cannot be reached', async () => {
    await failWith(() => {
      throw new TypeError('Failed to fetch');
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach the server.');
  });

  it('say when the server did not answer in time', async () => {
    await failWith(() => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach the server.');
  });

  it('say that something went wrong for anything else', async () => {
    await failWith(() => errorResponse(500, 'INTERNAL_ERROR'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong.');
  });

  it('follow the language when it is switched after the error appears', async () => {
    const user = await failWith(() => errorResponse(401, 'INVALID_CREDENTIALS'));
    await screen.findByRole('alert');

    await user.click(screen.getByRole('button', { name: 'Switch language' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    );
  });

  it.each([
    [60, 'حاول مرة أخرى بعد دقيقة واحدة.'],
    [120, 'حاول مرة أخرى بعد دقيقتين.'],
    [180, 'حاول مرة أخرى بعد 3 دقائق.'],
    [900, 'حاول مرة أخرى بعد 15 دقيقة.'],
  ])('use the right Arabic plural for a lock of %i seconds', async (seconds, expected) => {
    const user = await failWith(() =>
      errorResponse(429, 'ACCOUNT_LOCKED', { retryAfterSeconds: seconds }),
    );
    await screen.findByRole('alert');

    await user.click(screen.getByRole('button', { name: 'Switch language' }));

    expect(screen.getByRole('alert')).toHaveTextContent(expected);
  });
});

describe('signing out', () => {
  it('ends the session, returns to the login page and clears the cached data', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      [REFRESH]: () => json(sessionFor(groupAdmin)),
      [LOGOUT]: () => new Response(null, { status: 204 }),
      ...dashboard,
    });
    const { router, client } = renderApp('/admin');
    await screen.findByText('Welcome, Group Admin');
    expect(client.getQueryCache().getAll().length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(api.count(LOGOUT)).toBe(1);
    expect(sessionStore.get()).toBeNull();
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });

  it('signs out on this device even when the server cannot be reached', async () => {
    const user = userEvent.setup();
    mockApi({
      [REFRESH]: () => json(sessionFor(groupAdmin)),
      [LOGOUT]: () => {
        throw new TypeError('Failed to fetch');
      },
      ...dashboard,
    });
    renderApp('/admin');
    await screen.findByText('Welcome, Group Admin');

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(sessionStore.get()).toBeNull());
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});
