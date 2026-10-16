// The entry file Vercel runs for the "api" service (vercel.json). Vercel asks for this file
// before it builds, so it must be in the repository; the real code is the bundle that
// `npm run build:vercel` makes from src/vercel.ts.
export { default } from './dist/vercel.js';
