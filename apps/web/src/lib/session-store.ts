import type { SessionResponse } from '@pos/shared';

// The signed-in session lives in memory only. The access token is never written to storage,
// so a script injected into the page cannot read it later. A page reload gets a new one
// from the refresh cookie.
type Listener = () => void;

let session: SessionResponse | null = null;
const listeners = new Set<Listener>();

export const sessionStore = {
  get: (): SessionResponse | null => session,

  set: (next: SessionResponse | null): void => {
    session = next;
    for (const listener of listeners) listener();
  },

  subscribe: (listener: Listener): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
