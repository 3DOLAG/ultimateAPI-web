/**
 * Lightweight, high-performance in-memory Rate Limiting Middleware
 * Protects auth and OAuth endpoints from abuse / brute force
 */
export function createRateLimiter({
  windowMs = 60 * 1000, // 1 minute
  maxRequests = 15,
  message = 'Too many requests. Please try again later.'
} = {}) {
  const requests = new Map();

  // Periodically clean up stale IP entries every 2 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [ip, timestamps] of requests.entries()) {
      const valid = timestamps.filter(t => now - t < windowMs);
      if (valid.length === 0) {
        requests.delete(ip);
      } else {
        requests.set(ip, valid);
      }
    }
  }, 2 * 60 * 1000).unref();

  return (req, res, next) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    const clientTimestamps = requests.get(ip) || [];
    const recentRequests = clientTimestamps.filter(t => now - t < windowMs);

    if (recentRequests.length >= maxRequests) {
      const retryAfter = Math.ceil((recentRequests[0] + windowMs - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      return res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message,
          retryAfter
        }
      });
    }

    recentRequests.push(now);
    requests.set(ip, recentRequests);
    next();
  };
}
