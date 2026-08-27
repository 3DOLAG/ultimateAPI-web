/**
 * AURA RESELLER PRIVATE DASHBOARD CONTROLLER
 */

const DashboardApp = {
  state: {
    activeTab: 'pricing',
    metrics: null,
    orders: [],
    pricing: [],
    paymentMethods: [],
    products: [],
    users: [],
    logs: [],
    settings: {},
    currentUser: null
  },

  async init() {
    this.bindEvents();
    await this.checkAuth();
    this.loadStoreBranding();
    this.switchTab('pricing');
  },

  bindEvents() {
    document.querySelectorAll('.sidebar-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        if (tab) this.switchTab(tab);
      });
    });
  },

  async checkAuth() {
    try {
      const res = await fetch('/api/auth/me');
      const json = await res.json();
      if (json.success && json.data && (json.data.role === 'OWNER' || json.data.role === 'ADMIN')) {
        this.state.currentUser = json.data;
        const nameLabel = document.getElementById('currentUserLabel');
        const roleBadge = document.getElementById('currentUserRoleBadge');
        if (nameLabel) nameLabel.textContent = json.data.name;
        if (roleBadge) roleBadge.textContent = json.data.role === 'OWNER' ? '👑 Owner' : '🛡️ Admin';
      } else {
        window.location.href = '/admin/login';
      }
    } catch {
      window.location.href = '/admin/login';
    }
  },

  switchTab(tabName) {
    this.state.activeTab = tabName;
    document.querySelectorAll('.sidebar-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-tab') === tabName));
    document.querySelectorAll('.dashboard-tab-content').forEach(el => el.classList.toggle('active', el.id === `tab-${tabName}`));

    switch (tabName) {
      case 'pricing':
        this.loadPricing();
        break;
      case 'payment-methods':
        this.loadPaymentMethods();
        break;
      case 'catalog':
        this.loadCatalog();
        break;
      case 'theme-colors':
      case 'users':
        this.loadThemeColors();
        break;
      case 'logs':
        this.loadLogs();
        break;
      case 'settings':
        this.loadSettings();
        break;
    }
  },

  // -------------------------------------------------------------
  // 1. Overview Metrics
  // -------------------------------------------------------------
  async loadOverviewMetrics() {
    try {
      const res = await fetch('/api/dashboard/overview');
      const json = await res.json();
      if (json.success && json.data) {
        const m = json.data;
        document.getElementById('metricRevenue').textContent = `${m.revenue?.toLocaleString()} EGP`;
        document.getElementById('metricProfit').textContent = `${m.profit?.toLocaleString()} EGP`;
        document.getElementById('metricPendingProofs').textContent = m.pendingPayments || 0;
        document.getElementById('metricTotalOrders').textContent = m.totalOrders || 0;
        document.getElementById('metricProducts').textContent = m.totalProducts || 0;

        const healthEl = document.getElementById('topSupplierHealth');
        if (healthEl) {
          if (m.supplierConnection?.healthy) {
            healthEl.textContent = `Online (${m.supplierConnection.latencyMs}ms)`;
            healthEl.style.color = 'var(--success)';
          } else {
            healthEl.textContent = 'Degraded / Offline';
            healthEl.style.color = 'var(--danger)';
          }
        }
      }
    } catch (e) {
      console.warn('Overview metrics load error:', e.message);
    }
  },

  // -------------------------------------------------------------
  // 2. Orders Pipeline & Payment Proof Review
  // -------------------------------------------------------------
  async loadOrders() {
    const tbody = document.getElementById('ordersTableBody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 24px;">Loading orders...</td></tr>`;

    try {
      const filter = document.getElementById('orderStatusFilter')?.value || 'all';
      const q = filter !== 'all' ? `?payment_status=${filter}` : '';
      const res = await fetch(`/api/dashboard/orders${q}`);
      const json = await res.json();

      if (json.success && Array.isArray(json.data)) {
        this.state.orders = json.data;
        this.renderOrdersTable(json.data);
      }
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--danger);">Failed to query orders.</td></tr>`;
    }
  },

  renderOrdersTable(orders) {
    const tbody = document.getElementById('ordersTableBody');
    if (!tbody) return;

    if (orders.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 24px; color: var(--text-tertiary);">No orders found.</td></tr>`;
      return;
    }

    tbody.innerHTML = orders.map(ord => {
      let pBadge = `<span class="badge badge-warning">Awaiting Proof</span>`;
      if (ord.payment_status === 'payment_submitted') pBadge = `<span class="badge badge-primary">Submitted (Review)</span>`;
      if (ord.payment_status === 'paid') pBadge = `<span class="badge badge-success">Paid & Verified</span>`;
      if (ord.payment_status === 'rejected') pBadge = `<span class="badge badge-danger">Rejected</span>`;

      let proofBadge = `<span style="color: var(--text-tertiary); font-size: 0.78rem;">—</span>`;
      if (ord.payment_proof_sent_to_discord || ord.discord_delivery_status === 'delivered' || ord.discord_delivery_status === 'simulated') {
        proofBadge = `<span class="badge badge-success" style="font-size: 0.74rem;">Sent to Discord ✓</span>`;
      } else if (ord.discord_delivery_status === 'failed') {
        proofBadge = `<span class="badge badge-danger" style="font-size: 0.74rem;">Delivery Failed</span>`;
      } else if (ord.payment_proof_submitted) {
        proofBadge = `<span class="badge badge-primary" style="font-size: 0.74rem;">Uploaded</span>`;
      }

      let hookBadge = `<span style="color: var(--text-tertiary); font-size: 0.78rem;">—</span>`;
      if (ord.discord_delivery_status === 'delivered' || ord.discord_delivery_status === 'simulated') {
        hookBadge = `<span class="discord-status-badge discord-status-delivered">Delivered ✓</span>`;
      } else if (ord.discord_delivery_status === 'failed') {
        hookBadge = `<button class="btn btn-danger btn-sm" style="padding: 2px 8px; font-size: 0.72rem;" onclick="event.stopPropagation(); DashboardApp.retryDiscordWebhook('${ord.id}')">Retry 🔄</button>`;
      }

      return `
        <tr>
          <td><strong style="font-family: var(--font-mono); color: var(--accent-light);">${ord.reseller_order_id}</strong></td>
          <td style="font-family: var(--font-mono); font-size: 0.78rem; color: var(--text-tertiary);">${ord.supplier_order_id || '—'}</td>
          <td>
            <div><strong>${ord.customer_name}</strong></div>
            <div style="font-size: 0.75rem; color: var(--text-tertiary);">${ord.customer_phone || ord.customer_email}</div>
          </td>
          <td><strong style="color: var(--text-primary);">${ord.total?.toLocaleString()} ${ord.currency}</strong></td>
          <td>${proofBadge}</td>
          <td>${hookBadge}</td>
          <td>${pBadge}</td>
          <td><span class="badge badge-neutral">${ord.local_status}</span></td>
          <td style="font-size: 0.75rem; color: var(--text-tertiary);">${new Date(ord.created_at).toLocaleDateString()}</td>
          <td>
            <button class="btn btn-primary btn-sm" onclick="DashboardApp.inspectOrder('${ord.id}')">Inspect</button>
          </td>
        </tr>
      `;
    }).join('');
  },

  inspectOrder(orderId) {
    const ord = this.state.orders.find(o => o.id === orderId || o.reseller_order_id === orderId);
    if (!ord) return;

    const modal = document.getElementById('orderInspectModal');
    const content = document.getElementById('orderInspectModalContent');

    const isDelivered = ord.payment_proof_sent_to_discord || ord.discord_delivery_status === 'delivered' || ord.discord_delivery_status === 'simulated';
    const isFailed = ord.discord_delivery_status === 'failed';

    content.innerHTML = `
      <div style="border-bottom: 1px solid var(--border-subtle); padding-bottom: 14px; margin-bottom: 16px;">
        <h3 style="font-size: 1.2rem; font-weight: 800;">Order: ${ord.reseller_order_id}</h3>
        <div style="font-size: 0.813rem; color: var(--text-tertiary); font-family: var(--font-mono);">Supplier Reference: ${ord.supplier_order_id || 'Pending'}</div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 16px;">
        <div style="background: var(--bg-surface-elevated); padding: 12px; border-radius: var(--radius-xs);">
          <div style="font-size: 0.72rem; color: var(--text-tertiary); font-weight: 700;">CUSTOMER INFO</div>
          <div style="font-weight: 600;">${ord.customer_name}</div>
          <div style="font-size: 0.813rem; color: var(--text-secondary);">${ord.customer_phone}</div>
          <div style="font-size: 0.813rem; color: var(--text-secondary);">${ord.customer_email}</div>
        </div>

        <div style="background: var(--bg-surface-elevated); padding: 12px; border-radius: var(--radius-xs);">
          <div style="font-size: 0.72rem; color: var(--text-tertiary); font-weight: 700;">FINANCIAL BREAKDOWN</div>
          <div>Total Customer Price: <strong>${Number(ord.total || 0).toLocaleString()} ${ord.currency}</strong></div>
          <div style="font-size: 0.813rem; color: var(--success);">Reseller Profit: +${Number(ord.reseller_profit || 0).toLocaleString()} ${ord.currency}</div>
          <div style="font-size: 0.813rem; color: var(--text-tertiary);">Supplier Cost: ${Number(ord.supplier_cost || 0).toLocaleString()} ${ord.currency}</div>
        </div>
      </div>

      <div style="margin-bottom: 16px;">
        <div style="font-size: 0.78rem; font-weight: 700; color: var(--text-tertiary); margin-bottom: 6px;">ORDERED ITEMS:</div>
        <div style="background: var(--bg-surface-elevated); padding: 10px; border-radius: var(--radius-xs);">
          ${(ord.items || []).map(it => {
            const mainName = it.item_name || it.name || 'Product';
            const varLabel = it.variant_label && it.variant_label !== mainName && it.variant_label !== 'Standard License' && it.variant_label !== 'Standard Edition' ? ` (${it.variant_label})` : '';
            return `
            <div style="display: flex; justify-content: space-between; font-size: 0.84rem; padding: 4px 0;">
              <span>${mainName}${varLabel} × ${it.quantity || 1}</span>
              <strong>${Number(it.total_price || it.unit_customer_price || it.price || 0).toLocaleString()} ${ord.currency}</strong>
            </div>
            `;
          }).join('')}
        </div>
      </div>

      <!-- Customer Activation / Custom Data (Player ID, Steam Link, etc.) -->
      ${(() => {
        const cData = ord.customer_data || ord.custom_fields || {};
        const cNotes = ord.customer_notes || ord.notes;
        const entries = Object.entries(cData).filter(([k, v]) => v !== undefined && v !== null && String(v).trim().length > 0);
        if (entries.length === 0 && !cNotes) return '';

        const labelMap = {
          player_id: 'Player ID / UID (معرف اللاعب)',
          player_name: 'In-Game Name (اسم الحساب)',
          riot_id: 'Riot ID + Tagline',
          roblox_username: 'Roblox Username',
          epic_username: 'Epic Games Username',
          steam_profile: 'Steam Profile / Friend Code',
          xbox_gamertag: 'Xbox Gamertag / Email',
          discord_username: 'Discord Username',
          discord_or_steam: 'Discord ID / Steam Hex',
          server_invite: 'Discord Server Invite',
          snapchat_username: 'Snapchat Username',
          recharge_phone: 'Recharge Mobile Number',
          psn_email: 'PSN Email',
          target_email: 'Activation Email',
          account_or_player_id: 'Account / Player ID'
        };

        return `
          <div style="margin-bottom: 16px; background: rgba(99, 102, 241, 0.08); border: 1px solid var(--border-accent); border-radius: var(--radius-xs); padding: 14px;">
            <div style="font-size: 0.78rem; font-weight: 800; color: var(--accent-light); margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
              <span>🎮</span> <span>CUSTOMER ACTIVATION & PLAYER DATA:</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 8px;">
              ${entries.map(([k, v]) => `
                <div style="display: flex; justify-content: space-between; align-items: center; background: var(--bg-surface); padding: 8px 12px; border-radius: var(--radius-xs); font-size: 0.84rem;">
                  <div>
                    <span style="color: var(--text-tertiary); font-size: 0.74rem; display: block;">${labelMap[k] || k}</span>
                    <strong style="color: var(--text-primary); font-family: var(--font-mono);">${v}</strong>
                  </div>
                  <button class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText('${v}').then(() => DashboardApp.showToast('Copied to clipboard! ✓', 'info'))">نسخ 📋</button>
                </div>
              `).join('')}
              ${cNotes ? `
                <div style="background: var(--bg-surface); padding: 8px 12px; border-radius: var(--radius-xs); font-size: 0.84rem; margin-top: 4px;">
                  <span style="color: var(--text-tertiary); font-size: 0.74rem; display: block;">Customer Notes:</span>
                  <span style="color: var(--text-secondary);">${cNotes}</span>
                </div>
              ` : ''}
            </div>
          </div>
        `;
      })()}

      <!-- Secure Discord Webhook Verification Status (Zero Disk Storage) -->
      <div style="margin-bottom: 20px; background: var(--bg-surface-elevated); padding: 14px; border-radius: var(--radius-xs); border: 1px solid var(--border-subtle);">
        <div style="font-size: 0.78rem; font-weight: 700; color: var(--text-tertiary); margin-bottom: 8px;">PAYMENT PROOF & WEBHOOK STATUS:</div>
        
        ${isDelivered ? `
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
            <div>
              <div style="color: var(--success); font-weight: 700; font-size: 0.9rem; display: flex; align-items: center; gap: 6px;">
                <span>✓</span> <span>Payment Proof: Sent to Discord</span>
              </div>
              <div style="font-size: 0.76rem; color: var(--text-secondary); margin-top: 2px;">
                Webhook Delivered • ${ord.payment_proof_sent_at ? new Date(ord.payment_proof_sent_at).toLocaleString() : 'Recently'}
              </div>
              ${ord.payment_reference ? `<div style="font-size: 0.78rem; color: var(--accent-light); margin-top: 4px;">Reference: ${ord.payment_reference}</div>` : ''}
            </div>
            <button class="btn btn-secondary btn-sm" onclick="DashboardApp.retryDiscordWebhook('${ord.id}')">Resend Notification 🔄</button>
          </div>
        ` : (isFailed ? `
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
            <div>
              <div style="color: var(--danger); font-weight: 700; font-size: 0.9rem; display: flex; align-items: center; gap: 6px;">
                <span>⚠️</span> <span>Payment Proof: Delivery Failed</span>
              </div>
              <div style="font-size: 0.76rem; color: var(--text-tertiary); margin-top: 2px;">
                Discord webhook was unreachable or returned an error.
              </div>
            </div>
            <button class="btn btn-danger btn-sm" onclick="DashboardApp.retryDiscordWebhook('${ord.id}')">Retry Delivery 🔄</button>
          </div>
        ` : `
          <div style="color: var(--text-tertiary); font-size: 0.84rem;">
            Customer has not submitted a transfer receipt for this order yet.
          </div>
        `)}
      </div>

      <div style="display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid var(--border-subtle); padding-top: 16px;">
        <button class="btn btn-secondary" onclick="DashboardApp.closeInspectModal()">Close</button>
        ${ord.payment_status !== 'paid' ? `
          <button class="btn btn-danger" onclick="DashboardApp.rejectPaymentPrompt('${ord.id}')">Reject Payment</button>
          <button class="btn btn-success" onclick="DashboardApp.approvePaymentAction('${ord.id}')">✓ Approve Payment</button>
        ` : `<span class="badge badge-success" style="padding: 8px 16px;">Payment Already Approved</span>`}
      </div>
    `;

    modal.classList.add('open');
  },

  async retryDiscordWebhook(orderId) {
    this.showToast('Retrying Discord webhook delivery...', 'info');
    try {
      const res = await fetch(`/api/dashboard/orders/${orderId}/retry-discord-webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const json = await res.json();
      if (json.success) {
        this.showToast('Discord webhook delivered successfully! ✓', 'success');
        await this.loadOrders();
        if (document.getElementById('orderInspectModal')?.classList.contains('open')) {
          this.inspectOrder(orderId);
        }
      } else {
        this.showToast(json.error?.message || 'Failed to deliver webhook', 'error');
      }
    } catch (e) {
      this.showToast(`Error: ${e.message}`, 'error');
    }
  },

  closeInspectModal() {
    const modal = document.getElementById('orderInspectModal');
    if (modal) modal.classList.remove('open');
  },

  async approvePaymentAction(orderId) {
    if (!confirm('Are you sure you want to approve this payment receipt? Order will be marked as Paid.')) return;

    try {
      const res = await fetch(`/api/dashboard/orders/${orderId}/approve-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: 'Verified by Dashboard Admin' })
      });

      const json = await res.json();
      if (json.success) {
        this.showToast('Payment verified and approved! Order marked as Paid.', 'success');
        this.closeInspectModal();
        this.loadOrders();
        this.loadOverviewMetrics();
      } else {
        this.showToast(json.error?.message || 'Action failed', 'error');
      }
    } catch (err) {
      this.showToast(`Error: ${err.message}`, 'error');
    }
  },

  async rejectPaymentPrompt(orderId) {
    const reason = prompt('Please enter rejection reason for the customer (e.g. Unreadable screenshot, incorrect amount):');
    if (!reason) return;

    try {
      const res = await fetch(`/api/dashboard/orders/${orderId}/reject-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      });

      const json = await res.json();
      if (json.success) {
        this.showToast('Payment rejected. Customer notified.', 'info');
        this.closeInspectModal();
        this.loadOrders();
      } else {
        this.showToast(json.error?.message || 'Action failed', 'error');
      }
    } catch (err) {
      this.showToast(`Error: ${err.message}`, 'error');
    }
  },

  // -------------------------------------------------------------
  // 3. Category Profit Margins (Pricing Engine)
  // -------------------------------------------------------------
  async loadPricing() {
    const tbody = document.getElementById('pricingTableBody');
    if (!tbody) return;

    try {
      const res = await fetch('/api/dashboard/pricing');
      const json = await res.json();

      if (json.success && Array.isArray(json.data)) {
        this.state.pricing = json.data;
        tbody.innerHTML = json.data.map(cat => `
          <tr>
            <td><strong>${cat.name}</strong> ${cat.name_ar ? `(${cat.name_ar})` : ''}</td>
            <td style="font-family: var(--font-mono); font-size: 0.78rem; color: var(--text-tertiary);">${cat.slug || cat.category_id}</td>
            <td>
              <div style="display: flex; align-items: center; gap: 6px; max-width: 140px;">
                <input type="number" step="0.5" class="form-input" id="marginInput_${cat.category_id}" value="${cat.margin_percent}" style="padding: 6px 10px; font-weight: 700;">
                <span>%</span>
              </div>
            </td>
            <td>
              <span class="badge ${cat.is_active ? 'badge-success' : 'badge-neutral'}">
                ${cat.is_active ? 'Active' : 'Disabled'}
              </span>
            </td>
            <td>
              <button class="btn btn-primary btn-sm" onclick="DashboardApp.saveCategoryMargin('${cat.category_id}')">
                Save Margin
              </button>
            </td>
          </tr>
        `).join('');
      }
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="5">Failed to load margins.</td></tr>`;
    }
  },

  async saveCategoryMargin(catId) {
    const input = document.getElementById(`marginInput_${catId}`);
    if (!input) return;
    const margin = parseFloat(input.value);

    try {
      const res = await fetch('/api/dashboard/pricing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category_id: catId,
          margin_percent: margin,
          is_active: true
        })
      });

      const json = await res.json();
      if (json.success) {
        this.showToast(`Margin for ${catId} updated to ${margin}%. All customer prices recalculated!`, 'success');
      } else {
        this.showToast(json.error?.message || 'Save failed', 'error');
      }
    } catch (err) {
      this.showToast(`Error: ${err.message}`, 'error');
    }
  },

  // -------------------------------------------------------------
  // 4. Payment Methods
  // -------------------------------------------------------------
  async loadPaymentMethods() {
    const tbody = document.getElementById('paymentMethodsTableBody');
    if (!tbody) return;

    try {
      const res = await fetch('/api/dashboard/payment-methods');
      const json = await res.json();

      if (json.success && Array.isArray(json.data)) {
        this.state.paymentMethods = json.data;
        tbody.innerHTML = json.data.map(pm => `
          <tr>
            <td><strong>${pm.name}</strong> ${pm.name_ar ? `(${pm.name_ar})` : ''}</td>
            <td><span class="badge badge-primary">${pm.type}</span></td>
            <td><span style="font-family: var(--font-mono);">${pm.account_number}</span></td>
            <td><span class="badge ${pm.is_active ? 'badge-success' : 'badge-neutral'}">${pm.is_active ? 'Active' : 'Disabled'}</span></td>
            <td>
              <button class="btn btn-secondary btn-sm" onclick="DashboardApp.deletePaymentMethod('${pm.id}')">Delete</button>
            </td>
          </tr>
        `).join('');
      }
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="5">Failed to load methods.</td></tr>`;
    }
  },

  openNewPaymentMethodModal() {
    document.getElementById('paymentMethodModal').classList.add('open');
  },

  closePaymentMethodModal() {
    document.getElementById('paymentMethodModal').classList.remove('open');
  },

  async savePaymentMethod(e) {
    e.preventDefault();
    const payload = {
      name: document.getElementById('pmName').value.trim(),
      name_ar: document.getElementById('pmNameAr').value.trim(),
      type: document.getElementById('pmType').value,
      account_number: document.getElementById('pmAccount').value.trim(),
      instructions_ar: document.getElementById('pmInstructionsAr').value.trim()
    };

    try {
      const res = await fetch('/api/dashboard/payment-methods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (json.success) {
        this.showToast('Payment method saved!', 'success');
        this.closePaymentMethodModal();
        this.loadPaymentMethods();
      }
    } catch (err) {
      this.showToast(`Error: ${err.message}`, 'error');
    }
  },

  async deletePaymentMethod(id) {
    if (!confirm('Delete this payment method?')) return;
    await fetch(`/api/dashboard/payment-methods/${id}`, { method: 'DELETE' });
    this.showToast('Payment method removed', 'info');
    this.loadPaymentMethods();
  },

  // -------------------------------------------------------------
  // 5. Catalog View & Sync
  // -------------------------------------------------------------
  async loadCatalog() {
    const tbody = document.getElementById('catalogTableBody');
    if (!tbody) return;

    try {
      const res = await fetch('/api/products?limit=100');
      const json = await res.json();

      if (json.success && Array.isArray(json.data)) {
        this.state.products = json.data;
        tbody.innerHTML = json.data.map(p => `
          <tr>
            <td><strong>${p.name}</strong></td>
            <td>${p.category_id}</td>
            <td>${(p.items || []).length} options</td>
            <td style="color: var(--text-tertiary);">${p.price_base || 0} ${p.currency}</td>
            <td><strong style="color: var(--accent-light);">${p.price} ${p.currency}</strong></td>
            <td><span class="badge ${p.is_available ? 'badge-success' : 'badge-danger'}">${p.is_available ? 'In Stock' : 'Out of Stock'}</span></td>
          </tr>
        `).join('');
      }
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="6">Failed to load catalog cache.</td></tr>`;
    }
  },

  async triggerFullSync() {
    this.showToast('Triggering full catalog synchronization...', 'info');
    try {
      const res = await fetch('/api/dashboard/sync/full', { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        this.showToast(`Sync complete: ${json.data.products_synced} products refreshed`, 'success');
        this.loadCatalog();
        this.loadOverviewMetrics();
      }
    } catch (err) {
      this.showToast(`Sync error: ${err.message}`, 'error');
    }
  },

  async triggerDeltaSync() {
    this.showToast('Synchronizing delta changes...', 'info');
    try {
      const res = await fetch('/api/dashboard/sync/delta', { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        this.showToast('Delta sync complete!', 'success');
        this.loadOverviewMetrics();
      }
    } catch (err) {
      this.showToast(`Sync error: ${err.message}`, 'error');
    }
  },

  // -------------------------------------------------------------
  // 6. Theme Color System Customization
  // -------------------------------------------------------------
  async loadThemeColors() {
    try {
      const res = await fetch('/api/dashboard/settings');
      const json = await res.json();
      if (json.success && json.data) {
        const d = json.data;
        const bg = d.theme_bg_color || (d.theme?.bgPrimary) || '#06080D';
        const surface = d.theme_surface_color || (d.theme?.bgSurface) || '#101622';
        const accent = d.theme_accent_color || (d.theme?.accent) || (d.theme?.primary) || '#6366F1';
        const hover = d.theme_primary_hover || (d.theme?.hover) || '#4F46E5';

        this.setThemeColorValue('themeBgColor', bg);
        this.setThemeColorValue('themeSurfaceColor', surface);
        this.setThemeColorValue('themeAccentColor', accent);
        this.setThemeColorValue('themePrimaryHover', hover);

        this.updateThemeLivePreview();
      }
    } catch (err) {
      console.warn('Failed to load theme colors:', err);
    }
  },

  setThemeColorValue(prefix, hex) {
    if (!hex) return;
    let formattedHex = hex.trim();
    if (!formattedHex.startsWith('#')) formattedHex = '#' + formattedHex;
    
    const input = document.getElementById(`${prefix}Input`);
    const picker = document.getElementById(`${prefix}Picker`);
    const swatch = document.getElementById(`${prefix}Swatch`);

    if (input) input.value = formattedHex.toUpperCase();
    if (picker) {
      if (/^#[0-9A-Fa-f]{6}$/.test(formattedHex)) {
        picker.value = formattedHex;
      }
    }
    if (swatch) swatch.style.background = formattedHex;
  },

  onThemeColorChange(inputId, hexValue) {
    const input = document.getElementById(inputId);
    if (input) input.value = hexValue.toUpperCase();
    
    const swatchId = inputId.replace('Input', 'Swatch');
    const swatch = document.getElementById(swatchId);
    if (swatch) swatch.style.background = hexValue;

    this.updateThemeLivePreview();
  },

  onThemeHexChange(swatchId, pickerId, hexValue) {
    let val = hexValue.trim();
    if (!val.startsWith('#') && val.length > 0) val = '#' + val;

    const swatch = document.getElementById(swatchId);
    const picker = document.getElementById(pickerId);

    if (swatch) swatch.style.background = val;
    if (picker && /^#[0-9A-Fa-f]{6}$/.test(val)) {
      picker.value = val;
    }

    this.updateThemeLivePreview();
  },

  updateThemeLivePreview() {
    const bg = document.getElementById('themeBgColorInput')?.value || '#06080D';
    const surface = document.getElementById('themeSurfaceColorInput')?.value || '#101622';
    const accent = document.getElementById('themeAccentColorInput')?.value || '#6366F1';
    const hover = document.getElementById('themePrimaryHoverInput')?.value || '#4F46E5';

    const container = document.getElementById('themeLivePreviewContainer');
    const card = document.getElementById('themeLivePreviewCard');
    const btn = document.getElementById('themeLivePreviewBtn');
    const badge = document.getElementById('themeLivePreviewBadge');

    if (container) container.style.background = bg;
    if (card) {
      card.style.background = surface;
      card.style.borderColor = accent + '44';
    }
    if (btn) {
      btn.style.background = accent;
      btn.style.boxShadow = `0 0 16px -2px ${accent}66`;
    }
    if (badge) {
      badge.style.background = accent + '22';
      badge.style.color = accent;
      badge.style.borderColor = accent + '55';
    }
  },

  async saveThemeColors() {
    const payload = {
      theme_bg_color: document.getElementById('themeBgColorInput')?.value.trim() || '#06080D',
      theme_surface_color: document.getElementById('themeSurfaceColorInput')?.value.trim() || '#101622',
      theme_accent_color: document.getElementById('themeAccentColorInput')?.value.trim() || '#6366F1',
      theme_primary_color: document.getElementById('themeAccentColorInput')?.value.trim() || '#6366F1',
      theme_primary_hover: document.getElementById('themePrimaryHoverInput')?.value.trim() || '#4F46E5'
    };

    try {
      const res = await fetch('/api/dashboard/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (json.success) {
        this.showToast('تم حفظ وتطبيق ألوان وهوية المتجر بنجاح 🎨', 'success');
      } else {
        const msg = (typeof json.error === 'object' ? json.error?.message : json.error) || 'فشل حفظ ألوان المتجر';
        throw new Error(msg);
      }
    } catch (err) {
      this.showToast(`خطأ: ${err.message}`, 'error');
    }
  },

  resetThemeColors() {
    this.setThemeColorValue('themeBgColor', '#06080D');
    this.setThemeColorValue('themeSurfaceColor', '#101622');
    this.setThemeColorValue('themeAccentColor', '#6366F1');
    this.setThemeColorValue('themePrimaryHover', '#4F46E5');
    this.updateThemeLivePreview();
    this.showToast('تمت استعادة الألوان الافتراضية (اضغط حفظ لتطبيقها)', 'info');
  },

  // -------------------------------------------------------------
  // 7. Logs & Settings
  // -------------------------------------------------------------
  async loadLogs() {
    const tbody = document.getElementById('apiLogsTableBody');
    if (!tbody) return;

    try {
      const res = await fetch('/api/dashboard/logs');
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        tbody.innerHTML = json.data.map(l => `
          <tr>
            <td style="font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-tertiary);">${l.request_id}</td>
            <td><strong>${l.method}</strong></td>
            <td style="font-family: var(--font-mono); font-size: 0.813rem;">${l.endpoint}</td>
            <td><span class="badge ${l.is_error ? 'badge-danger' : 'badge-success'}">${l.status_code}</span></td>
            <td>${l.duration_ms}ms</td>
            <td style="font-size: 0.75rem; color: var(--text-tertiary);">${new Date(l.created_at).toLocaleTimeString()}</td>
          </tr>
        `).join('');
      }
    } catch {}
  },

  async loadStoreBranding() {
    try {
      const res = await fetch('/api/dashboard/settings');
      const json = await res.json();
      if (json.success && json.data) {
        this.applySidebarBranding(json.data);
      }
    } catch {}
  },

  applySidebarBranding(data) {
    const mark = document.getElementById('dashSidebarMark');
    const img = document.getElementById('dashSidebarLogoImg');
    const nameEl = document.getElementById('dashSidebarStoreName');

    if (nameEl && data.store_name) {
      nameEl.textContent = data.store_name;
    }

    if (img && mark) {
      if (data.logo_url && data.logo_url.trim()) {
        img.src = data.logo_url;
        img.style.display = 'block';
        mark.style.display = 'none';
      } else {
        img.style.display = 'none';
        mark.style.display = 'flex';
      }
    }
  },

  updateLogoPreview(url) {
    const previewImg = document.getElementById('dashLogoPreviewImg');
    const placeholder = document.getElementById('dashLogoPlaceholderIcon');
    const removeBtn = document.getElementById('btnRemoveLogo');

    if (!previewImg || !placeholder) return;

    if (url && url.trim()) {
      previewImg.src = url.trim();
      previewImg.style.display = 'block';
      placeholder.style.display = 'none';
      if (removeBtn) removeBtn.style.display = 'inline-flex';
    } else {
      previewImg.src = '';
      previewImg.style.display = 'none';
      placeholder.style.display = 'block';
      if (removeBtn) removeBtn.style.display = 'none';
    }
  },

  async handleLogoUpload(input) {
    if (!input.files || !input.files[0]) return;

    const file = input.files[0];
    if (file.size > 5 * 1024 * 1024) {
      this.showToast('حجم الصورة كبير جداً. الحد الأقصى 5 ميجابايت.', 'error');
      input.value = '';
      return;
    }

    const formData = new FormData();
    formData.append('logo', file);

    try {
      this.showToast('جاري رفع لوجو المتجر...', 'info');
      const res = await fetch('/api/dashboard/upload-logo', {
        method: 'POST',
        body: formData
      });
      const json = await res.json();

      if (json.success && json.data && json.data.logo_url) {
        const logoUrlInput = document.getElementById('settingLogoUrl');
        if (logoUrlInput) logoUrlInput.value = json.data.logo_url;
        
        this.updateLogoPreview(json.data.logo_url);
        this.applySidebarBranding({ logo_url: json.data.logo_url });
        this.showToast('تم رفع وتعيين لوجو المتجر بنجاح 🚀', 'success');
      } else {
        throw new Error(json.error || 'فشل رفع الشعار');
      }
    } catch (err) {
      this.showToast(`خطأ أثناء الرفع: ${err.message}`, 'error');
    } finally {
      input.value = '';
    }
  },

  async removeLogo() {
    const logoUrlInput = document.getElementById('settingLogoUrl');
    const fileInput = document.getElementById('dashLogoFileInput');
    if (logoUrlInput) logoUrlInput.value = '';
    if (fileInput) fileInput.value = '';
    
    this.updateLogoPreview('');
    this.applySidebarBranding({ logo_url: '' });

    try {
      await fetch('/api/dashboard/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logo_url: '' })
      });
      this.showToast('تم حذف اللوجو واستعادة الرمز الافتراضي', 'info');
    } catch (err) {
      console.warn('Failed to persist removed logo:', err);
    }
  },

  async loadSettings() {
    try {
      const res = await fetch('/api/dashboard/settings');
      const json = await res.json();
      if (json.success && json.data) {
        if (document.getElementById('settingStoreName')) document.getElementById('settingStoreName').value = json.data.store_name || '';
        if (document.getElementById('settingTagline')) document.getElementById('settingTagline').value = json.data.tagline || '';
        if (document.getElementById('settingLogoUrl')) document.getElementById('settingLogoUrl').value = json.data.logo_url || '';
        if (document.getElementById('settingSupportWhatsapp')) document.getElementById('settingSupportWhatsapp').value = json.data.support_whatsapp || '';
        if (document.getElementById('settingSupportDiscord')) document.getElementById('settingSupportDiscord').value = json.data.support_discord || '';
        if (document.getElementById('settingSupportTiktok')) document.getElementById('settingSupportTiktok').value = json.data.support_tiktok || '';
        
        this.updateLogoPreview(json.data.logo_url || '');
        this.applySidebarBranding(json.data);
      }
    } catch (err) {
      console.warn('Settings load error:', err);
    }
  },

  async saveSettings(e) {
    e.preventDefault();
    const payload = {
      store_name: document.getElementById('settingStoreName').value.trim(),
      tagline: document.getElementById('settingTagline').value.trim(),
      logo_url: document.getElementById('settingLogoUrl') ? document.getElementById('settingLogoUrl').value.trim() : '',
      support_whatsapp: document.getElementById('settingSupportWhatsapp').value.trim(),
      support_discord: document.getElementById('settingSupportDiscord').value.trim(),
      support_tiktok: document.getElementById('settingSupportTiktok').value.trim()
    };

    try {
      const res = await fetch('/api/dashboard/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (json.success) {
        this.showToast('تم حفظ كافة إعدادات وهيكل المتجر بنجاح', 'success');
        this.applySidebarBranding(payload);
      } else {
        const msg = (typeof json.error === 'object' ? json.error?.message : json.error) || 'فشل حفظ الإعدادات';
        throw new Error(msg);
      }
    } catch (err) {
      this.showToast(`خطأ: ${err.message}`, 'error');
    }
  },

  async logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {}
    window.location.href = '/admin/login';
  },

  showToast(msg, type = 'info') {
    const stack = document.getElementById('dashboardToastStack');
    if (!stack) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
      <span>${type === 'success' ? '✓' : type === 'error' ? '⚠' : 'ℹ'}</span>
      <span>${msg}</span>
    `;

    stack.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 250);
    }, 3500);
  }
};

document.addEventListener('DOMContentLoaded', () => DashboardApp.init());
window.DashboardApp = DashboardApp;
