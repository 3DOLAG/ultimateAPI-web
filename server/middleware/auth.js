import { dbHelper } from '../db.js';
import { config } from '../config.js';

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

  const user = dbHelper.getUserBySession(token);
  if (!user || user.status !== 'active') {
    return res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_SESSION',
        message: 'Your session has expired or is invalid. Please sign in again.'
      }
    });
  }

  req.user = user;
  next();
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
