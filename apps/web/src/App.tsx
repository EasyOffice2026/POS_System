import { healthResponseSchema } from '@pos/shared';
import { useEffect, useState } from 'react';

type ApiStatus = 'checking' | 'ok' | 'unreachable';

async function checkApi(): Promise<ApiStatus> {
  try {
    const res = await fetch('/api/v1/health');
    healthResponseSchema.parse(await res.json());
    return 'ok';
  } catch {
    return 'unreachable';
  }
}

// Placeholder page. Routing and the Arabic/English switch arrive with the web shell.
export function App() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking');

  useEffect(() => {
    void checkApi().then(setApiStatus);
  }, []);

  return (
    <main>
      <h1>POS System</h1>
      <p>API: {apiStatus}</p>
    </main>
  );
}
