// The entry file Vercel runs for the "api" service (vercel.json). Vercel asks for this file
// before it builds, so it must be in the repository; the real code is the bundle that
// `npm run build:vercel` makes from src/vercel.ts.
//
// The bundle is loaded on the first request rather than at start-up, so that when it cannot
// start (a setting is missing or wrong), the reason is logged and shown as a JSON error
// instead of Vercel's bare FUNCTION_INVOCATION_FAILED page.
let loading = null;

function load() {
  loading ??= import('./dist/vercel.js')
    .then((module) => module.default)
    .catch((error) => {
      loading = null;
      console.error('The API could not start:', error);
      throw error;
    });
  return loading;
}

export default async function handler(req, res) {
  let app;
  try {
    app = await load();
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error: {
          code: 'STARTUP_FAILED',
          message: error instanceof Error ? error.message : String(error),
        },
      }),
    );
    return;
  }
  await app(req, res);
}
