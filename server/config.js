import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const config = {
  get port() { return parseInt(process.env.PORT || '3000', 10); },
  get nodeEnv() { return process.env.NODE_ENV || 'development'; },
  store: {
    get name() { return process.env.RESELLER_STORE_NAME || 'AURA Game & Digital Store'; },
    get tagline() { return process.env.RESELLER_TAGLINE || 'Digital Cards, Subscriptions & Game Licenses'; },
    get currency() { return process.env.RESELLER_CURRENCY || 'EGP'; },
    get currencySymbol() { return process.env.RESELLER_CURRENCY_SYMBOL || 'EGP'; },
    get whatsapp() { return process.env.SUPPORT_WHATSAPP || '+201001234567'; },
    get discord() { return process.env.SUPPORT_DISCORD || 'https://discord.gg/aurastore'; },
    get tiktok() { return process.env.SUPPORT_TIKTOK || 'https://tiktok.com/@aurastore'; },
    get logoUrl() { return process.env.RESELLER_LOGO_URL || ''; },
    // Dynamic Theme Customization
    get themePreset() { return (process.env.THEME_PRESET || 'indigo').toLowerCase().trim(); },
    get themePrimaryColor() { return (process.env.THEME_PRIMARY_COLOR || '').trim(); },
    get themePrimaryHover() { return (process.env.THEME_PRIMARY_HOVER || '').trim(); },
    get themeAccentColor() { return (process.env.THEME_ACCENT_COLOR || '').trim(); },
    get themeBgColor() { return (process.env.THEME_BG_COLOR || '').trim(); },
    get themeSurfaceColor() { return (process.env.THEME_SURFACE_COLOR || '').trim(); }
  },
  admin: {
    get apiKey() { return process.env.ADMIN_API_KEY || ''; },
    get sessionSecret() { return process.env.SESSION_SECRET || 'dev_session_secret_change_in_production'; },
    get defaultMarginPercent() { return parseFloat(process.env.DEFAULT_PROFIT_MARGIN || '15'); }
  },
  discordAuth: {
    get clientId() { return (process.env.DISCORD_CLIENT_ID || '').trim(); },
    get clientSecret() { return (process.env.DISCORD_CLIENT_SECRET || '').trim(); },
    get redirectUri() { return (process.env.DISCORD_REDIRECT_URI || '').trim(); },
    get adminDiscordId() { return (process.env.ADMIN_DISCORD_ID || '').trim(); },
    isConfigured() {
      return Boolean(this.clientId && this.clientSecret && this.redirectUri && this.adminDiscordId);
    }
  },
  supplier: {
    get apiUrl() { return process.env.SUPPLIER_API_URL || 'https://utimate-eg.com/api/v1'; },
    get apiKey() { return process.env.SUPPLIER_API_KEY || ''; },
    get apiSecret() { return process.env.SUPPLIER_API_SECRET || ''; },
    get webhookSecret() { return process.env.SUPPLIER_WEBHOOK_SECRET || ''; },
    timeoutMs: 30000
  },
  sync: {
    get cronSchedule() { return process.env.SYNC_CRON_SCHEDULE || '*/5 * * * *'; },
    get syncOnStartup() { return process.env.SYNC_ON_STARTUP !== 'false'; }
  },
  get discordWebhookUrl() { return process.env.DISCORD_ORDER_WEBHOOK_URL || ''; },
  get databasePath() { return Boolean(process.env.VERCEL) ? '/tmp/reseller_store.db' : path.resolve(process.cwd(), './data/reseller_store.db'); },
  get uploadDir() { return Boolean(process.env.VERCEL) ? '/tmp/proofs' : path.resolve(process.cwd(), './uploads/proofs'); },
  blob: {
    get token() { return process.env.BLOB_READ_WRITE_TOKEN || ''; }
  }
};
