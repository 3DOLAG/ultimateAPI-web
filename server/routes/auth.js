import express from 'express';
import crypto from 'crypto';
import { dbHelper } from '../db.js';
import { config } from '../config.js';
import { createRateLimiter } from '../middleware/rateLimit.js';

export const authRouter = express.Router();

// Rate limiters for authentication endpoints
const authRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 15,
  message: 'Too many authentication attempts. Please wait 1 minute.'
});

const oauthRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 20,
  message: 'Too many OAuth requests. Please wait 1 minute.'
});

/**
 * ===================================================================
 * 1. DISCORD OAUTH2 ADMIN AUTHENTICATION FLOW
 * ===================================================================
 */

/**
 * GET /api/auth/discord
 * Initiates the Discord OAuth2 authorization flow for Admin Login
 */
authRouter.get('/discord', oauthRateLimiter, (req, res) => {
  try {
    if (!config.discordAuth.isConfigured()) {
      console.error('[Discord OAuth] Admin Discord OAuth2 environment variables are missing or incomplete.');
      return res.redirect('/admin/login?error=missing_config');
    }

    // Generate cryptographically secure random state to protect against CSRF
    const state = crypto.randomBytes(32).toString('hex');

    // Store state in a secure, HttpOnly cookie with 10 minutes expiry
    res.cookie('discord_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 10 * 60 * 1000 // 10 minutes
    });

    const discordAuthUrl = new URL('https://discord.com/api/oauth2/authorize');
    discordAuthUrl.searchParams.set('client_id', config.discordAuth.clientId);
    discordAuthUrl.searchParams.set('redirect_uri', config.discordAuth.redirectUri);
    discordAuthUrl.searchParams.set('response_type', 'code');
    discordAuthUrl.searchParams.set('scope', 'identify');
    discordAuthUrl.searchParams.set('state', state);
    discordAuthUrl.searchParams.set('prompt', 'consent');

    res.redirect(discordAuthUrl.toString());
  } catch (err) {
    console.error('[Discord OAuth] Error initiating OAuth flow:', err);
    res.redirect('/admin/login?error=oauth_init_failed');
  }
});

/**
 * GET /api/auth/discord/callback
 * Discord OAuth2 Callback: exchanges code for token, fetches user, validates ADMIN_DISCORD_ID
 */
authRouter.get('/discord/callback', oauthRateLimiter, async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;

    // Handle user cancellation or Discord OAuth errors
    if (error) {
      console.warn('[Discord OAuth] Access denied by user or Discord:', error, error_description);
      return res.redirect('/admin/login?error=access_denied');
    }

    if (!code) {
      return res.redirect('/admin/login?error=missing_code');
    }

    // CSRF State validation
    const savedState = req.cookies?.discord_oauth_state;
    res.clearCookie('discord_oauth_state');

    if (!savedState || !state || state !== savedState) {
      console.warn('[Discord OAuth Security] CSRF state mismatch detected.');
      return res.redirect('/admin/login?error=csrf_detected');
    }

    if (!config.discordAuth.isConfigured()) {
      return res.redirect('/admin/login?error=missing_config');
    }

    // 1. Exchange authorization code for Discord access token
    const tokenParams = new URLSearchParams({
      client_id: config.discordAuth.clientId,
      client_secret: config.discordAuth.clientSecret,
      grant_type: 'authorization_code',
      code: String(code),
      redirect_uri: config.discordAuth.redirectUri
    });

    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'ResellerStore-DiscordAuth/2.0'
      },
      body: tokenParams.toString()
    });

    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) {
      console.error('[Discord OAuth] Token exchange failed:', tokenData);
      return res.redirect('/admin/login?error=token_exchange_failed');
    }

    // 2. Retrieve authenticated Discord user identity
    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        'User-Agent': 'ResellerStore-DiscordAuth/2.0'
      }
    });

    const discordUser = await userResponse.json();
    if (!userResponse.ok || !discordUser.id) {
      console.error('[Discord OAuth] Failed to fetch Discord user profile:', discordUser);
      return res.redirect('/admin/login?error=fetch_user_failed');
    }

    // 3. Strict Server-Side Comparison against ADMIN_DISCORD_ID
    const configuredAdminDiscordId = config.discordAuth.adminDiscordId?.trim();
    if (!configuredAdminDiscordId || discordUser.id !== configuredAdminDiscordId) {
      console.warn(
        `[SECURITY ALERT] Unauthorized Discord User attempted Admin access: ID=${discordUser.id}, Username=${discordUser.username} (${discordUser.global_name || 'No global name'})`
      );
      // DO NOT create an Admin session, account, or grant any permissions
      return res.redirect('/admin/login?error=unauthorized');
    }

    // 4. Authorized Admin: Upsert user record safely and create secure session
    const adminUser = dbHelper.upsertDiscordAdmin({
      discordId: discordUser.id,
      username: discordUser.username,
      globalName: discordUser.global_name,
      avatar: discordUser.avatar
    });

    // Session rotation: create cryptographically secure session
    const sessionToken = dbHelper.createSession(adminUser.id, 7);

    // Set secure authentication cookie
    res.cookie('auth_token', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    console.log(`[Security Audit] ✅ Admin authenticated successfully via Discord: ${adminUser.name} (${discordUser.id})`);
    return res.redirect('/admin');
  } catch (err) {
    console.error('[Discord OAuth] Unexpected error in callback:', err);
    return res.redirect('/admin/login?error=server_error');
  }
});

/**
 * ===================================================================
 * 2. CUSTOMER AUTHENTICATION (VIEWER ONLY)
 * ===================================================================
 */

/**
 * POST /api/auth/login
 * Standard Customer Login (Strictly restricted to non-admin VIEWER accounts)
 */
authRouter.post('/login', authRateLimiter, (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELDS', message: 'Email and password are required.' }
      });
    }

    const user = dbHelper.getUserByEmail(email.trim().toLowerCase());
    if (!user) {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Incorrect email or password.' }
      });
    }

    // Strict Security Rule: Admin/Owner accounts CANNOT login with password.
    // They must use Discord OAuth2 exclusively.
    if (user.role === 'OWNER' || user.role === 'ADMIN') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'DISCORD_AUTH_REQUIRED',
          message: 'Admin accounts must authenticate exclusively via Discord OAuth2 at /admin/login.'
        }
      });
    }

    const passHash = crypto.createHash('sha256').update(password).digest('hex');
    if (user.password_hash !== passHash) {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Incorrect email or password.' }
      });
    }

    if (user.status !== 'active') {
      return res.status(403).json({
        success: false,
        error: { code: 'ACCOUNT_DISABLED', message: 'This account has been disabled. Contact support.' }
      });
    }

    const sessionToken = dbHelper.createSession(user.id);

    res.cookie('auth_token', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.json({
      success: true,
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: 'VIEWER', // Customer role is always VIEWER
        permissions: user.permissions,
        token: sessionToken
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/auth/register
 * Customer Registration (Forces VIEWER role, prevents privilege escalation)
 */
authRouter.post('/register', authRateLimiter, (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELDS', message: 'Name, email, and password are required.' }
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const existing = dbHelper.getUserByEmail(cleanEmail);
    if (existing) {
      return res.status(409).json({
        success: false,
        error: { code: 'EMAIL_EXISTS', message: 'An account with this email already exists.' }
      });
    }

    const passHash = crypto.createHash('sha256').update(password).digest('hex');
    const newUser = dbHelper.createUser({
      name: name.trim(),
      email: cleanEmail,
      password_hash: passHash,
      role: 'VIEWER', // STRICT: Normal users can only ever be VIEWER
      permissions: ['view_products', 'view_orders']
    });

    const sessionToken = dbHelper.createSession(newUser.id);

    res.cookie('auth_token', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.status(201).json({
      success: true,
      message: 'Account registered successfully.',
      data: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: 'VIEWER',
        permissions: newUser.permissions,
        token: sessionToken
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/auth/me
 * Retrieves the currently authenticated user identity
 */
authRouter.get('/me', (req, res) => {
  const token = req.cookies?.auth_token || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) {
    return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED' } });
  }

  const user = dbHelper.getUserBySession(token);
  if (!user || user.status !== 'active') {
    return res.status(401).json({ success: false, error: { code: 'INVALID_SESSION' } });
  }

  res.json({
    success: true,
    data: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      permissions: user.permissions,
      discord_id: user.discord_id || null,
      avatar_url: user.avatar_url || null
    }
  });
});

/**
 * POST /api/auth/logout
 * Invalidate session token in DB and clear cookie
 */
authRouter.post('/logout', (req, res) => {
  const token = req.cookies?.auth_token || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (token) {
    dbHelper.deleteSession(token);
  }
  res.clearCookie('auth_token');
  res.json({ success: true, message: 'Logged out successfully.' });
});
