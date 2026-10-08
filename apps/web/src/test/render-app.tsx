import { QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { Providers } from '../app/Providers';
import { routes } from '../app/routes';

// Renders the real app with the real routes, starting at the given path.
export function renderApp(initialPath = '/') {
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <Providers client={client}>
      <RouterProvider router={router} />
    </Providers>,
  );

  return { router, client };
}
