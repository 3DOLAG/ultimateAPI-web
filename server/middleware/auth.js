import crypto from 'crypto';
import { dbHelper } from '../db.js';
import { config } from '../config.js';

/**
 * Sign a stateless session payload with HMAC-SHA256 (for serverless persistence)
 */
export function signToken(payload) {
  const secret = config.admin.sessionSecret || 'fallback_secret_key_change_me';
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${signature}`;
}

/**
 * Verify and decode a stateless HMAC-SHA256 signed session token
 */
export function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, signature] = parts;
  if (!data || !signature) return null;

  const secret = config.admin.sessionSecret || 'fallback_secret_key_change_me';
  const expectedSignature = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  
  try {
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSignature);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Date.now()) {
      return null; // Expired token
    }
    return payload;
  } catch {
    return null;
  }
}

export function requireAuth(req, res, next) {
  // 1. Check API Key Header (for programmatic/automated testing access)
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (apiKey && apiKey === config.admin.apiKey) {
    req.user = {
      id: 'usr_admin_key',
      name: 'System Admin API',
      email: 'admin@aurastore.eg',
      role: 'OWNER',
      permissions: ['*']
    };
    return next();
  }

  // 2. Check Session Cookie or Bearer Token
  const token = req.cookies?.auth_token || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required.'
      }
    });
  }

  // A. Verify Stateless Cryptographic Token (Permanent across Vercel Lambdas)
  const signedUser = verifyToken(token);
  if (signedUser && signedUser.role) {
    req.user = signedUser;
    return next();
  }

  // B. Fallback to SQLite DB Session lookup (Local environment)
  const user = dbHelper.getUserBySession(token);
  if (user && user.status === 'active') {
    req.user = user;
    return next();
  }

  return res.status(401).json({
    success: false,
    error: {
      code: 'INVALID_SESSION',
      message: 'Your session has expired or is invalid. Please sign in again.'
    }
  });
}

/**
 * Reusable Strict Server-Side Authorization for Admin Routes & APIs
 * Requires valid authenticated session with role 'OWNER' or 'ADMIN'
 */
export function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!req.user || (req.user.role !== 'OWNER' && req.user.role !== 'ADMIN')) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN_NOT_ADMIN',
          message: 'Access restricted to authorized Admin accounts only.'
        }
      });
    }
    next();
  });
}

export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }

    if (req.user.role === 'OWNER' || allowedRoles.includes(req.user.role)) {
      return next();
    }

    return res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: `Your role (${req.user.role}) is not authorized to perform this operation.`
      }
    });
  };
}

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }

    if (req.user.role === 'OWNER' || req.user.permissions?.includes('*') || req.user.permissions?.includes(permission)) {
      return next();
    }

    return res.status(403).json({
      success: false,
      error: {
        code: 'INSUFFICIENT_PERMISSIONS',
        message: `Missing required permission: ${permission}`
      }
    });
  };
}
