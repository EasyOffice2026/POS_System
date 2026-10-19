import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAuth } from '../features/auth/auth-context';

interface BackOfficeLinkProps {
  className: string;
}

// A way back to the dashboard from the till or the kitchen screen, for the owner and the
// managers who look in on them. Cashiers and kitchen staff have no back office, so it is hidden:
// the right is the one that also sets up a terminal (branches:read). The terminal stays set up.
export function BackOfficeLink({ className }: BackOfficeLinkProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  if (!user?.permissions.includes('branches:read')) return null;
  return (
    <Link to="/admin" className={className}>
      {t('auth.backOffice')}
    </Link>
  );
}
