// In local dev, Vite's proxy (vite.config.ts) forwards "/api" to the
// backend, so a relative path works. In production there's no dev-server
// proxy and no working platform-level rewrite either (Render static sites
// don't parse a Netlify-style _redirects file, and the dashboard's
// Redirects/Rewrites UI wasn't surfacing for this account) — so the built
// app calls the deployed backend's real URL directly instead. The backend
// enables CORS for exactly this.
export const API_BASE = import.meta.env.DEV ? '/api' : 'https://mantra-verify-ngab.onrender.com/api';
