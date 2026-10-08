import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

export function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-4">
      <h1 className="text-xl font-semibold text-slate-900">{t('notFound.title')}</h1>
      <Link to="/admin" className="text-slate-700 underline">
        {t('notFound.back')}
      </Link>
    </main>
  );
}
