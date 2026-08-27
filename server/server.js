import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { dbHelper } from './db.js';
import { syncEngine } from './services/syncEngine.js';

// Routers
import { storeRouter } from './routes/store.js';
import { ordersRouter } from './routes/orders.js';
import { paymentMethodsRouter } from './routes/paymentMethods.js';
import { authRouter } from './routes/auth.js';
import { dashboardRouter } from './routes/dashboard.js';
import { webhooksRouter } from './routes/webhooks.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '../public');

const app = express();

// Enable CORS & Cookie Parser
app.use(cors());
app.use(cookieParser(config.admin.sessionSecret));

// JSON Parser with Raw Body verification support
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true }));

// Serve Public Static Files (CSS, JS, Assets)
app.use(express.static(publicDir));
app.use('/uploads', express.static(path.resolve(__dirname, '../uploads')));

// Mount REST API Routers
app.use(['/api', '/api/v1'], storeRouter);
app.use(['/api/payment-methods', '/api/v1/payment-methods', '/payment-methods'], paymentMethodsRouter);
app.use(['/api/orders', '/api/v1/orders', '/orders'], ordersRouter);
app.use(['/api/auth', '/api/v1/auth', '/auth'], authRouter);
app.use(['/api/dashboard', '/api/admin', '/api/v1/dashboard', '/api/v1/admin'], dashboardRouter);
app.use(['/api/v1/webhooks', '/api/webhooks', '/webhooks'], webhooksRouter);

// Aliases for compatibility
app.get('/api/v1/products', (req, res) => {
  try {
    const products = dbHelper.getProducts(req.query);
    res.json({ success: true, data: products });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/v1/items/:id/availability', async (req, res) => {
  try {
    const item = dbHelper.getItemById(req.params.id);
    res.json({ success: true, data: { valid: Boolean(item?.is_available), item } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin Login Page Route
app.get(['/admin/login', '/admin/login/'], (req, res) => {
  const token = req.cookies?.auth_token || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const user = token ? dbHelper.getUserBySession(token) : null;

  if (user && user.status === 'active' && (user.role === 'OWNER' || user.role === 'ADMIN')) {
    return res.redirect('/admin');
  }

  const loginHtmlPath = path.join(publicDir, 'admin-login.html');
  if (fs.existsSync(loginHtmlPath)) {
    return res.sendFile(loginHtmlPath);
  }
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Admin Logout Route
app.get(['/admin/logout', '/admin/logout/'], (req, res) => {
  const token = req.cookies?.auth_token || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (token) {
    dbHelper.deleteSession(token);
  }
  res.clearCookie('auth_token');
  return res.redirect('/admin/login');
});

// Protected Admin / Dashboard HTML Routes
app.get(['/admin', '/admin/*', '/dashboard', '/dashboard/*'], (req, res) => {
  const token = req.cookies?.auth_token || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const user = token ? dbHelper.getUserBySession(token) : null;

  if (!user || user.status !== 'active' || (user.role !== 'OWNER' && user.role !== 'ADMIN')) {
    return res.redirect('/admin/login');
  }

  const dashboardHtmlPath = path.join(publicDir, 'dashboard.html');
  if (fs.existsSync(dashboardHtmlPath)) {
    return res.sendFile(dashboardHtmlPath);
  }
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Clean Public Storefront SPA Routes
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Start Server when run directly / locally (not inside Vercel Serverless Function)
const isDirectRun = Boolean(process.argv[1] && (path.resolve(process.argv[1]) === path.resolve(__filename)));

if (isDirectRun && !process.env.VERCEL) {
  app.listen(config.port, () => {
    console.log('\n======================================================');
    console.log(`✨ RESELLER E-COMMERCE PLATFORM RUNNING ON PORT ${config.port}`);
    console.log(`🛍️ Storefront: http://localhost:${config.port}`);
    console.log(`🔒 Admin Login: http://localhost:${config.port}/admin/login`);
    console.log(`👑 Private Dashboard: http://localhost:${config.port}/admin`);
    
    if (config.discordAuth.isConfigured()) {
      console.log(`🛡️ Discord Admin Auth: ENABLED (Target Discord ID: ${config.discordAuth.adminDiscordId})`);
    } else {
      console.log(`⚠️ Discord Admin Auth: INCOMPLETE (Set DISCORD_* and ADMIN_DISCORD_ID in .env)`);
    }
    
    console.log(`🔗 Supplier API Gateway: ${config.supplier.apiUrl}`);
    console.log('======================================================\n');

    // Initialize Background Sync Engine
    syncEngine.init();
  });
}

export { app };
export default app;
