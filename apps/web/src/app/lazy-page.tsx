import { type ComponentType, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

// Shown while the code of a page is on its way. It is not a status message, so a page's own
// "saved" status stays the only one on the screen.
function PageLoading() {
  const { t } = useTranslation();
  return <p className="p-4 text-sm text-slate-500">{t('common.loading')}</p>;
}

// A page whose code is downloaded the first time it is opened, so a till does not download the
// back office and the back office does not download the till. The rest of the screen (the
// admin menu, the header) stays while it loads.
export function lazyPage<Module, Name extends keyof Module>(
  load: () => Promise<Module>,
  name: Name,
): ComponentType {
  const Component = lazy(async () => ({ default: (await load())[name] as ComponentType }));
  function Page() {
    return (
      <Suspense fallback={<PageLoading />}>
        <Component />
      </Suspense>
    );
  }
  Page.displayName = `Lazy(${String(name)})`;
  return Page;
}
