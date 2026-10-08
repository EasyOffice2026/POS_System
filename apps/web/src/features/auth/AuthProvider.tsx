import { type LoginRequest, sessionResponseSchema } from '@pos/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { refreshSession, request, requestNoContent } from '../../lib/api';
import { sessionStore } from '../../lib/session-store';
import { AuthContext, type AuthContextValue, type AuthStatus } from './auth-context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const session = useSyncExternalStore(sessionStore.subscribe, sessionStore.get);
  const [restored, setRestored] = useState(false);
  const queryClient = useQueryClient();

  // On page load the access token is gone, but the refresh cookie may still be good.
  useEffect(() => {
    let active = true;
    void refreshSession().finally(() => {
      if (active) setRestored(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (input: LoginRequest) => {
    const next = await request('/auth/login', {
      method: 'POST',
      body: input,
      schema: sessionResponseSchema,
      authenticated: false,
    });
    sessionStore.set(next);
  }, []);

  const logout = useCallback(async () => {
    try {
      await requestNoContent('/auth/logout');
    } catch {
      // The server could not be told. The person is still signed out on this device, but their
      // refresh cookie stays valid until it expires (see the open questions in spec 001).
    } finally {
      // Leave no data of the last person in the cache.
      sessionStore.set(null);
      queryClient.clear();
    }
  }, [queryClient]);

  const status: AuthStatus = session ? 'authenticated' : restored ? 'anonymous' : 'loading';
  const value = useMemo<AuthContextValue>(
    () => ({ status, user: session?.user ?? null, login, logout }),
    [status, session, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
