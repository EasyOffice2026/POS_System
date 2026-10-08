import { QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, type InitialEntry } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { Providers } from '../app/Providers';
import { routes } from '../app/routes';

// Renders the real app with the real routes, starting at the given path (or a path with state).
export function renderApp(initialEntry: InitialEntry = '/') {
  const router = createMemoryRouter(routes, { initialEntries: [initialEntry] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <Providers client={client}>
      <RouterProvider router={router} />
    </Providers>,
  );

  return { router, client };
}
