import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('shows the API as ok when the health check succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ status: 'ok', service: 'api' })),
    );

    render(<App />);

    expect(await screen.findByText('API: ok')).toBeTruthy();
  });

  it('shows the API as unreachable when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    render(<App />);

    expect(await screen.findByText('API: unreachable')).toBeTruthy();
  });

  it('shows the API as unreachable when the answer is not a health response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ hello: 'world' })));

    render(<App />);

    expect(await screen.findByText('API: unreachable')).toBeTruthy();
  });
});
