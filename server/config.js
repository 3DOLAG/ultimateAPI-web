import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  store: {
    name: process.env.RESELLER_STORE_NAME || 'AURA Game & Digital Store',
    tagline: process.env.RESELLER_TAGLINE || 'Digital Cards, Subscriptions & Game Licenses',
    currency: process.env.RESELLER_CURRENCY || 'EGP',
    currencySymbol: process.env.RESELLER_CURRENCY_SYMBOL || 'EGP',
    whatsapp: process.env.SUPPORT_WHATSAPP || '+201001234567',
    discord: process.env.SUPPORT_DISCORD || 'https://discord.gg/aurastore',
    tiktok: process.env.SUPPORT_TIKTOK || 'https://tiktok.com/@aurastore',
    logoUrl: process.env.RESELLER_LOGO_URL || '',
    // Dynamic Theme Customization
    themePreset: (process.env.THEME_PRESET || 'indigo').toLowerCase().trim(),
    themePrimaryColor: (process.env.THEME_PRIMARY_COLOR || '').trim(),
    themePrimaryHover: (process.env.THEME_PRIMARY_HOVER || '').trim(),
    themeAccentColor: (process.env.THEME_ACCENT_COLOR || '').trim(),
    themeBgColor: (process.env.THEME_BG_COLOR || '').trim(),
    themeSurfaceColor: (process.env.THEME_SURFACE_COLOR || '').trim()
  },
  admin: {
    apiKey: process.env.ADMIN_API_KEY || '',
    sessionSecret: process.env.SESSION_SECRET || 'dev_session_secret_change_in_production',
    defaultMarginPercent: parseFloat(process.env.DEFAULT_PROFIT_MARGIN || '15')
  },
  discordAuth: {
    clientId: (process.env.DISCORD_CLIENT_ID || '').trim(),
    clientSecret: (process.env.DISCORD_CLIENT_SECRET || '').trim(),
    redirectUri: (process.env.DISCORD_REDIRECT_URI || '').trim(),
    adminDiscordId: (process.env.ADMIN_DISCORD_ID || '').trim(),
    isConfigured() {
      return Boolean(this.clientId && this.clientSecret && this.redirectUri && this.adminDiscordId);
    }
  },
  supplier: {
    apiUrl: process.env.SUPPLIER_API_URL || 'https://utimate-eg.com/api/v1',
    apiKey: process.env.SUPPLIER_API_KEY || '',
    apiSecret: process.env.SUPPLIER_API_SECRET || '',
    webhookSecret: process.env.SUPPLIER_WEBHOOK_SECRET || '',
    timeoutMs: 30000
  },
  sync: {
    cronSchedule: process.env.SYNC_CRON_SCHEDULE || '*/5 * * * *',
    syncOnStartup: process.env.SYNC_ON_STARTUP !== 'false'
  },
  discordWebhookUrl: process.env.DISCORD_ORDER_WEBHOOK_URL || '',
  databasePath: path.resolve(process.cwd(), process.env.DATABASE_PATH || './data/reseller_store.db'),
  uploadDir: path.resolve(process.cwd(), process.env.UPLOAD_DIR || './uploads/proofs')
};
