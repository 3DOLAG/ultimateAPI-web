import crypto from 'crypto';
import { config } from '../config.js';
import { dbHelper } from '../db.js';

/**
 * File signature & magic bytes validator
 * Only allows real JPEG, PNG, and WEBP images
 */
export function validateImageBuffer(buffer, originalname = '', mimetype = '') {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { valid: false, reason: 'Empty or invalid file payload.' };
  }

  const maxSizeBytes = 10 * 1024 * 1024; // 10MB limit
  if (buffer.length > maxSizeBytes) {
    return { valid: false, reason: 'File size exceeds maximum limit of 10MB.' };
  }

  // Magic byte checks
  // JPEG: FF D8 FF
  const isJpeg = buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const isPng = buffer.length >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 &&
    buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A;
  // WEBP: RIFF .... WEBP
  const isWebp = buffer.length >= 12 &&
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;

  if (!isJpeg && !isPng && !isWebp) {
    return {
      valid: false,
      reason: 'Invalid file signature. Only authentic JPG, PNG, and WEBP image files are allowed.'
    };
  }

  const ext = isPng ? 'png' : (isWebp ? 'webp' : 'jpg');
  const safeMime = isPng ? 'image/png' : (isWebp ? 'image/webp' : 'image/jpeg');

  return {
    valid: true,
    extension: ext,
    mimeType: safeMime,
    fileName: `payment_proof_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`
  };
}

/**
 * Production Discord Order Webhook Service
 * Sends order details & ephemeral payment proof image directly to Discord
 * with zero permanent storage on the reseller store.
 */
export class DiscordWebhookService {
  constructor() {
    this.processedEvents = new Set();
  }

  /**
   * Send Order Payment Proof to Discord Webhook
   * @param {Object} order - Full order record from database
   * @param {Buffer} fileBuffer - Ephemeral in-memory image buffer
   * @param {String} originalName - Original filename
   * @param {String} mimeType - MIME type
   * @param {Object} options - Additional metadata (e.g. reference)
   */
  async sendOrderPaymentProof(order, fileBuffer, originalName, mimeType, options = {}) {
    const eventId = `evt_ORD_${order.reseller_order_id || order.id}_PAYMENT_PROOF`;

    // 1. Deduplication Protection
    if (this.processedEvents.has(eventId) || order.payment_proof_sent_to_discord) {
      console.log(`[DiscordWebhook] ℹ️ Skipping duplicate webhook dispatch for Event: ${eventId}`);
      return {
        success: true,
        eventId,
        deduplicated: true,
        deliveredAt: order.payment_proof_sent_at || new Date().toISOString()
      };
    }

    // 2. Validate Image Buffer Signature
    const validation = validateImageBuffer(fileBuffer, originalName, mimeType);
    if (!validation.valid) {
      throw new Error(`Payment proof validation failed: ${validation.reason}`);
    }

    const webhookUrl = config.discordWebhookUrl;
    const nowIso = new Date().toISOString();

    // If webhook URL is not configured in .env, simulate safe delivery for local development
    if (!webhookUrl || webhookUrl.trim() === '' || webhookUrl.includes('YOUR_DISCORD_WEBHOOK_URL')) {
      console.warn(`[DiscordWebhook] ⚠️ DISCORD_ORDER_WEBHOOK_URL not configured. Simulating delivery for order ${order.reseller_order_id}.`);
      this.processedEvents.add(eventId);
      return {
        success: true,
        eventId,
        simulated: true,
        deliveredAt: nowIso
      };
    }

    // 3. Build Formatted Discord Embed Payload
    const fileName = validation.fileName;
    const items = Array.isArray(order.items) ? order.items : [];
    const itemsFormatted = items.length > 0
      ? items.map((it, idx) => {
          const mainName = it.item_name || it.name || 'Product';
          const varLabel = it.variant_label && it.variant_label !== mainName ? ` — ${it.variant_label}` : '';
          return `**${it.quantity || 1}×** ${mainName}${varLabel} (${(it.total_price || it.price || 0).toLocaleString()} ${order.currency || 'EGP'})`;
        }).join('\n')
      : `1× General Item — ${(order.total || 0).toLocaleString()} ${order.currency || 'EGP'}`;

    const fields = [
      {
        name: '👤 العميل (Customer)',
        value: `**${order.customer_name}**\n📧 \`${order.customer_email}\`\n📱 \`${order.customer_phone}\``,
        inline: true
      },
      {
        name: '💳 طريقة الدفع (Payment Method)',
        value: `**${order.payment_method_name || 'تحويل مباشر'}**\nالحالة: \`إشعار دفع مرفق\``,
        inline: true
      },
      {
        name: '💰 الإجمالي (Total Amount)',
        value: `**${Number(order.total || 0).toLocaleString()} ${order.currency || 'EGP'}**`,
        inline: true
      },
      {
        name: '📦 المنتجات المطلوبة (Ordered Items)',
        value: itemsFormatted,
        inline: false
      }
    ];

    // Optional Customer Notes (without sensitive custom input fields)
    if (order.customer_notes && String(order.customer_notes).trim().length > 0) {
      fields.push({
        name: '📝 ملاحظات العميل (Customer Notes)',
        value: `\`${order.customer_notes}\``,
        inline: false
      });
    }

    if (options.reference || order.payment_reference) {
      fields.push({
        name: '📝 رقم المرجع / الملاحظة (Reference)',
        value: `\`${options.reference || order.payment_reference}\``,
        inline: true
      });
    }

    fields.push({
      name: '🔗 كود المورد (Supplier Reference)',
      value: `\`${order.supplier_order_id || 'Pending'}\``,
      inline: true
    });

    fields.push({
      name: '🕒 توقيت الطلب (Timestamp)',
      value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
      inline: true
    });

    const payloadJson = {
      content: `🔔 **إشعار دفع جديد تم استلامه** — طلب **#${order.reseller_order_id}**`,
      embeds: [
        {
          title: `⚡ إيصال تحويل لطلب: #${order.reseller_order_id}`,
          description: `قام العميل برفع لقطة شاشة لإيصال التحويل. يرجى مراجعة المبلغ وتأكيد الطلب من لوحة الإدارة.`,
          color: 0x6366f1, // Indigo Violet
          fields,
          image: {
            url: `attachment://${fileName}`
          },
          footer: {
            text: `AURA Store Webhook Engine • Event ID: ${eventId}`
          },
          timestamp: nowIso
        }
      ]
    };

    // 4. Construct Multipart FormData with In-Memory Attachment
    const formData = new FormData();
    const fileBlob = new Blob([fileBuffer], { type: validation.mimeType });
    formData.append('files[0]', fileBlob, fileName);
    formData.append('payload_json', JSON.stringify(payloadJson));

    // 5. Execute Dispatch with Exponential Backoff Retries
    const maxRetries = 3;
    let attempt = 0;
    let lastError = null;

    while (attempt < maxRetries) {
      attempt++;
      const startTime = Date.now();

      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          body: formData
        });

        const durationMs = Date.now() - startTime;

        if (response.ok || response.status === 204) {
          console.log(`[DiscordWebhook] ✅ Webhook delivered successfully for Order #${order.reseller_order_id} (Attempt: ${attempt}, Status: ${response.status}, Time: ${durationMs}ms)`);
          this.processedEvents.add(eventId);

          return {
            success: true,
            eventId,
            httpStatus: response.status,
            durationMs,
            deliveredAt: nowIso
          };
        }

        const errorText = await response.text().catch(() => 'No response body');
        console.warn(`[DiscordWebhook] ⚠️ Discord returned HTTP ${response.status} on attempt ${attempt}: ${errorText.slice(0, 150)}`);

        // If client error (4xx except 429), retrying won't help
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          throw new Error(`Discord rejected webhook payload with status ${response.status}: ${errorText.slice(0, 100)}`);
        }

        lastError = new Error(`Discord webhook returned HTTP ${response.status}`);
      } catch (netErr) {
        lastError = netErr;
        console.warn(`[DiscordWebhook] ⚠️ Network error on attempt ${attempt}: ${netErr.message}`);
      }

      if (attempt < maxRetries) {
        const backoffMs = attempt * 1200;
        console.log(`[DiscordWebhook] ⏳ Retrying in ${backoffMs}ms (Attempt ${attempt + 1}/${maxRetries})...`);
        await new Promise(r => setTimeout(r, backoffMs));
      }
    }

    console.error(`[DiscordWebhook] ❌ All ${maxRetries} webhook attempts failed for Order #${order.reseller_order_id}: ${lastError?.message}`);
    throw new Error(`Failed to deliver payment proof to Discord after ${maxRetries} attempts: ${lastError?.message}`);
  }
}

export const discordWebhook = new DiscordWebhookService();
