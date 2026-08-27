import { app } from '../server/server.js';

export default function handler(req, res) {
  try {
    const host = req.headers.host || 'localhost';
    const parsed = new URL(req.url, `http://${host}`);
    const vpath = parsed.searchParams.get('__vpath');
    if (vpath) {
      parsed.searchParams.delete('__vpath');
      const qs = parsed.searchParams.toString();
      req.url = vpath + (qs ? `?${qs}` : '');
    } else {
      const orig = req.headers['x-matched-path'] || req.headers['x-forwarded-uri'] || req.headers['x-now-route-matches'];
      if (orig && (req.url === '/api/index.js' || req.url.startsWith('/api/index.js?'))) {
        req.url = orig;
      }
    }
  } catch (err) {
    console.warn('[Vercel Entrypoint] URL rewrite parsing warning:', err.message);
  }
  return app(req, res);
}
