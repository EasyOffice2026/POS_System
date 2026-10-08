import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { createQueryClient, Providers } from './app/Providers';
import { routes } from './app/routes';
import './i18n';
import './index.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Missing #root element');
}

const router = createBrowserRouter(routes);
const queryClient = createQueryClient();

createRoot(root).render(
  <StrictMode>
    <Providers client={queryClient}>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
);
