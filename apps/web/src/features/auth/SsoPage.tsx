import { sessionResponseSchema } from '@pos/shared';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { request } from '../../lib/api';
import { sessionStore } from '../../lib/session-store';

// Single sign-on from the ERP (docs/specs/029-erp-link.md): the ERP opens /sso#ticket=…, and the
// ticket, kept out of the server logs in the fragment, is traded for a session.
export function SsoPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [ticket] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('ticket'));
  const [failed, setFailed] = useState(!ticket);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !ticket) return;
    started.current = true;
    window.history.replaceState(null, '', window.location.pathname);
    request('/auth/sso', {
      method: 'POST',
      body: { ticket },
      schema: sessionResponseSchema,
      authenticated: false,
    })
      .then((session) => {
        sessionStore.set(session);
        void navigate('/', { replace: true });
      })
      .catch(() => setFailed(true));
  }, [navigate, ticket]);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      {failed ? (
        <div className="max-w-md space-y-4 text-center">
          <p role="alert">{t('sso.failed')}</p>
          <Link className="underline" to="/login">
            {t('sso.toLogin')}
          </Link>
        </div>
      ) : (
        <p>{t('sso.signingIn')}</p>
      )}
    </main>
  );
}
