import { app } from '../server/server.js';

export default function handler(req, res) {
  // If Vercel rewrote the URL, recover original requested path
  const originalUrl = req.headers['x-matched-path'] || req.headers['x-forwarded-uri'] || req.headers['x-now-route-matches'];
  if (originalUrl && (req.url === '/api/index.js' || req.url.startsWith('/api/index.js?'))) {
    req.url = originalUrl;
  }
  return app(req, res);
}
