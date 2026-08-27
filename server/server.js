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
import { storeRouter, getMergedSettings } from './routes/store.js';
import { ordersRouter } from './routes/orders.js';
import { paymentMethodsRouter } from './routes/paymentMethods.js';
import { authRouter } from './routes/auth.js';
import { dashboardRouter } from './routes/dashboard.js';
import { webhooksRouter } from './routes/webhooks.js';
import { verifyToken } from './middleware/auth.js';

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

// Serve Public Static Files (CSS, JS, Assets) - without auto-serving static index.html
app.use(express.static(publicDir, { index: false }));
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
  const user = token ? (verifyToken(token) || dbHelper.getUserBySession(token)) : null;

  if (user && (user.role === 'OWNER' || user.role === 'ADMIN')) {
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
    try { dbHelper.deleteSession(token); } catch {}
  }
  res.clearCookie('auth_token');
  return res.redirect('/admin/login');
});

// Protected Admin / Dashboard HTML Routes
app.get(['/admin', '/admin/*', '/dashboard', '/dashboard/*'], (req, res) => {
  const token = req.cookies?.auth_token || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const user = token ? (verifyToken(token) || dbHelper.getUserBySession(token)) : null;

  if (!user || (user.role !== 'OWNER' && user.role !== 'ADMIN')) {
    return res.redirect('/admin/login');
  }

  const dashboardHtmlPath = path.join(publicDir, 'dashboard.html');
  if (fs.existsSync(dashboardHtmlPath)) {
    return res.sendFile(dashboardHtmlPath);
  }
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Helper to escape HTML characters for safe meta tag rendering
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Server-Side Open Graph & Meta Tag Injector for Discord / WhatsApp / Social previews
 */
async function sendDynamicStoreHtml(req, res) {
  const htmlPath = path.join(publicDir, 'index.html');
  if (!fs.existsSync(htmlPath)) {
    return res.status(404).send('Not Found');
  }

  let html = fs.readFileSync(htmlPath, 'utf8');

  try {
    const settings = await getMergedSettings();
    const storeName = settings.store_name || config.store.name || 'AURA Game & Digital Store';
    const tagline = settings.tagline || config.store.tagline || 'متجر معتمد للبطاقات الرقمية واشتراكات الألعاب والحسابات الرسمية مع استلام فوري ودفع آمن.';
    const logoUrl = settings.logo_url || config.store.logoUrl || '';

    // Check if visiting a specific product e.g. /product/fortnite
    const url = req.originalUrl || req.url || '';
    let ogTitle = storeName;
    let docTitle = `${storeName} — ${tagline}`;
    let pageDesc = tagline;
    let pageImage = logoUrl || 'https://images.unsplash.com/photo-1612287233261-26c71c4c1a2f?w=1200&q=80';

    const prodMatch = url.match(/\/product\/([^\/?#]+)/);
    if (prodMatch) {
      const slug = decodeURIComponent(prodMatch[1]);
      const product = dbHelper.getProductByIdOrSlug(slug);
      if (product) {
        ogTitle = product.name_ar || product.name;
        docTitle = `${ogTitle} | ${storeName}`;
        pageDesc = product.description_ar || product.description || tagline;
        if (Array.isArray(product.images) && product.images.length > 0) {
          pageImage = product.images[0];
        }
      }
    }

    const ogTags = `
  <title>${escapeHtml(docTitle)}</title>
  <meta name="description" content="${escapeHtml(pageDesc)}">
  <!-- Open Graph / Discord / Facebook / WhatsApp -->
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${escapeHtml(storeName)}">
  <meta property="og:title" content="${escapeHtml(ogTitle)}">
  <meta property="og:description" content="${escapeHtml(pageDesc)}">
  <meta property="og:image" content="${escapeHtml(pageImage)}">
  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(ogTitle)}">
  <meta name="twitter:description" content="${escapeHtml(pageDesc)}">
  <meta name="twitter:image" content="${escapeHtml(pageImage)}">
    `.trim();

    // Strip static title and description tags
    html = html.replace(/<title>.*?<\/title>/is, '');
    html = html.replace(/<meta\s+name=["']description["'][^>]*>/is, '');
    html = html.replace(/<meta\s+property=["']og:[^"']+["'][^>]*>/gis, '');
    html = html.replace(/<meta\s+name=["']twitter:[^"']+["'][^>]*>/gis, '');

    // Inject dynamic Open Graph tags into <head>
    html = html.replace('<head>', `<head>\n  ${ogTags}`);
    
    // Inject dynamic brand text into placeholders
    html = html.replace(/<span class="store-name-text">.*?<\/span>/g, `<span class="store-name-text">${escapeHtml(storeName)}</span>`);
  } catch (err) {
    console.warn('[HTML Render] Dynamic meta injection warning:', err.message);
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  return res.send(html);
}

// Clean Public Storefront SPA Routes with Real-Time Meta Tags
app.get('*', (req, res) => {
  return sendDynamicStoreHtml(req, res);
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
