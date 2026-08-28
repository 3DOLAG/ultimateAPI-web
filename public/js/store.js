/**
 * Gaming COMMERCE STOREFRONT CLIENT CONTROLLER & SPA ROUTER
 */

const StoreApp = {
  state: {
    storeInfo: null,
    categories: [],
    categoryTree: [],
    products: [],
    currentCategory: null,
    currentProduct: null,
    selectedVariant: null,
    selectedPaymentMethod: null,
    selectedProofFile: null,
    user: null,
    activeRoute: '/',
    checkoutItem: null
  },

  async init() {
    this.bindGlobalEvents();
    await this.loadInitialData();
    this.handleRoute();

    window.addEventListener('popstate', () => this.handleRoute());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.toggleMobileDrawer(false);
        this.toggleMobileSearch(false);
      }
    });
  },

  bindGlobalEvents() {
    const searchInput = document.getElementById('globalSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const q = e.target.value.trim().toLowerCase();
        this.filterProductsSearch(q);
      });
    }

    const sortSelect = document.getElementById('homeSortSelect');
    if (sortSelect) {
      sortSelect.addEventListener('change', (e) => {
        this.loadProducts({ sort: e.target.value });
      });
    }
  },

  async loadInitialData() {
    await Promise.allSettled([
      this.loadStoreInfo(),
      this.loadCategoryTree(),
      this.loadProducts(),
      this.checkAuthSession()
    ]);
  },

  // -------------------------------------------------------------
  // Router Engine
  // -------------------------------------------------------------
  navigate(path) {
    this.toggleMobileDrawer(false);
    this.toggleMobileSearch(false);
    window.history.pushState({}, '', path);
    this.handleRoute();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  toggleMobileDrawer(open) {
    const drawer = document.getElementById('mobileNavDrawer');
    const overlay = document.getElementById('mobileDrawerOverlay');
    const isOpen = open !== undefined ? Boolean(open) : !drawer?.classList.contains('active');
    if (drawer) drawer.classList.toggle('active', isOpen);
    if (overlay) overlay.classList.toggle('active', isOpen);
    document.body.style.overflow = isOpen ? 'hidden' : '';
  },

  toggleMobileSearch(open) {
    const searchBox = document.getElementById('headerSearchBox');
    const searchInput = document.getElementById('globalSearchInput');
    const shouldOpen = open !== undefined ? Boolean(open) : !searchBox?.classList.contains('mobile-open');

    if (searchBox) {
      searchBox.classList.toggle('mobile-open', shouldOpen);
      if (shouldOpen && searchInput) {
        setTimeout(() => searchInput.focus(), 60);
      } else if (!shouldOpen && searchInput) {
        searchInput.value = '';
        this.filterProductsSearch('');
      }
    }
  },

  handleRoute() {
    const path = window.location.pathname;
    this.state.activeRoute = path;
    this.toggleMobileDrawer(false);
    this.toggleMobileSearch(false);

    // Update bottom nav active classes
    const bHome = document.getElementById('bottomNavHome');
    if (bHome) bHome.classList.toggle('active', path === '/' || path === '');

    // Hide all views
    document.querySelectorAll('.page-view').forEach(el => el.style.display = 'none');

    if (path === '/' || path === '') {
      this.renderHomeView();
    } else if (path.startsWith('/category/')) {
      const slug = path.replace('/category/', '').replace(/\/$/, '');
      this.renderCategoryView(slug);
    } else if (path.startsWith('/product/')) {
      const slug = path.replace('/product/', '').replace(/\/$/, '');
      this.renderProductView(slug);
    } else if (path === '/checkout') {
      this.renderCheckoutView();
    } else if (path.startsWith('/payment/')) {
      const orderId = path.replace('/payment/', '').replace(/\/$/, '');
      this.renderPaymentView(orderId);
    } else if (path.startsWith('/success/')) {
      const orderId = path.replace('/success/', '').replace(/\/$/, '');
      this.renderSuccessView(orderId);
    } else if (path === '/login') {
      this.renderLoginView();
    } else if (path === '/register') {
      this.renderRegisterView();
    } else {
      this.renderHomeView();
    }
  },

  // -------------------------------------------------------------
  // 1. Store Info, Home View & Dynamic Category Navigation
  // -------------------------------------------------------------
  updateDocumentTitle(pageTitle = '') {
    const info = this.state.storeInfo;
    const storeName = info?.name || 'Gaming Store';
    const tagline = info?.tagline ? ` — ${info.tagline}` : '';
    if (!pageTitle) {
      document.title = `${storeName}${tagline}`;
    } else {
      document.title = `${pageTitle} | ${storeName}`;
    }
  },

  renderHomeView() {
    const homeView = document.getElementById('view-home');
    if (homeView) homeView.style.display = 'block';
    this.updateDocumentTitle();
    if (this.state.products && this.state.products.length > 0) {
      this.renderProductsGrid(this.state.products, 'homeProductsGrid');
    } else {
      this.loadProducts();
    }
  },

  async loadStoreInfo() {
    try {
      const res = await fetch('/api/store/info');
      const json = await res.json();
      if (json.success && json.data) {
        this.state.storeInfo = json.data;
        if (json.data.name) {
          document.querySelectorAll('.store-name-text').forEach(el => el.textContent = json.data.name);
        }
        if (json.data.tagline) {
          const heroSub = document.getElementById('heroMainSubtitle');
          if (heroSub) heroSub.textContent = json.data.tagline;
        }

        // Dynamic Browser Tab Title Sync
        this.updateDocumentTitle();

        // Dynamic Theme Colors Application
        if (json.data.theme) {
          const t = json.data.theme;
          const root = document.documentElement;
          if (t.primary) {
            root.style.setProperty('--accent-primary', t.primary);
            root.style.setProperty('--accent-hover', t.hover);
            root.style.setProperty('--accent-light', t.accent);
            root.style.setProperty('--accent-subtle', t.subtle);
            root.style.setProperty('--border-accent', t.border);
            root.style.setProperty('--shadow-glow', `0 0 24px -2px ${t.shadow}`);
          }
          if (t.bgPrimary) root.style.setProperty('--bg-primary', t.bgPrimary);
          if (t.bgSurface) root.style.setProperty('--bg-surface', t.bgSurface);
        }

        // Store Logo Image & Favicon Dynamic Update
        if (json.data.logo_url && json.data.logo_url.trim()) {
          document.querySelectorAll('.brand-mark').forEach(el => el.style.display = 'none');
          document.querySelectorAll('.brand-logo-img').forEach(el => {
            el.src = json.data.logo_url;
            el.alt = json.data.name || 'Store Logo';
            el.style.display = 'inline-block';
          });
          const favicon = document.querySelector("link[rel*='icon']");
          if (favicon) {
            favicon.href = json.data.logo_url;
          }
        } else {
          document.querySelectorAll('.brand-mark').forEach(el => el.style.display = 'flex');
          document.querySelectorAll('.brand-logo-img').forEach(el => el.style.display = 'none');
        }

        // Support Channels (WhatsApp, Discord, TikTok) - Dynamic Handles & Visibility
        // 1. WhatsApp
        const waContainer = document.getElementById('footerSupportWhatsapp');
        const waText = document.getElementById('footerWhatsappText');
        const isWaActive = json.data.whatsapp_enabled !== false && Boolean(json.data.support_whatsapp);
        if (isWaActive) {
          if (waContainer) {
            waContainer.style.display = 'flex';
            waContainer.href = json.data.whatsapp_url || `https://wa.me/${json.data.support_whatsapp.replace(/[^0-9]/g, '')}`;
          }
          if (waText) waText.textContent = json.data.support_whatsapp;

          ['drawerSupportWhatsapp', 'bottomNavWhatsapp', 'topSupportWhatsappLink', 'btnSuccessWhatsApp'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
              el.style.display = '';
              el.href = json.data.whatsapp_url || `https://wa.me/${json.data.support_whatsapp.replace(/[^0-9]/g, '')}`;
            }
          });
        } else {
          if (waContainer) waContainer.style.display = 'none';
          ['drawerSupportWhatsapp', 'bottomNavWhatsapp', 'topSupportWhatsappLink', 'btnSuccessWhatsApp'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
          });
        }

        // 2. Discord
        const discordContainer = document.getElementById('footerSupportDiscord');
        const discordText = document.getElementById('footerDiscordText');
        const isDiscordActive = json.data.discord_enabled !== false && Boolean(json.data.support_discord);
        if (isDiscordActive) {
          if (discordContainer) {
            discordContainer.style.display = 'flex';
            discordContainer.href = json.data.support_discord;
          }
          if (discordText) {
            discordText.textContent = json.data.discord_code ? `discord.gg/${json.data.discord_code}` : 'سيرفر الدعم الرسمي';
          }
        } else {
          if (discordContainer) discordContainer.style.display = 'none';
        }

        // 3. TikTok
        const tiktokContainer = document.getElementById('footerSupportTiktok');
        const tiktokText = document.getElementById('footerTiktokText');
        const isTiktokActive = json.data.tiktok_enabled !== false && Boolean(json.data.support_tiktok);
        if (isTiktokActive) {
          if (tiktokContainer) {
            tiktokContainer.style.display = 'flex';
            tiktokContainer.href = json.data.support_tiktok;
          }
          if (tiktokText) {
            tiktokText.textContent = json.data.tiktok_username || (json.data.support_tiktok.includes('@') ? `@${json.data.support_tiktok.split('@')[1]}` : '@tiktok');
          }
        } else {
          if (tiktokContainer) tiktokContainer.style.display = 'none';
        }
      }
    } catch (e) {
      console.warn('Store info notice:', e.message);
    }
  },

  async loadCategoryTree() {
    try {
      const res = await fetch('/api/categories/tree');
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        this.state.categoryTree = json.data;
        this.renderCategoryNav(json.data);
        this.renderCategoryPills(json.data);
      }
    } catch (e) {
      console.warn('Category tree load error:', e.message);
    }
  },

  renderCategoryNav(tree) {
    const nav = document.getElementById('mainCategoryNav');
    const drawerNav = document.getElementById('mobileDrawerNav');

    const activeTree = (tree || []).filter(cat => {
      const hasProducts = cat.product_count === undefined || cat.product_count > 0;
      const hasChildren = Array.isArray(cat.children) && cat.children.some(c => c.product_count === undefined || c.product_count > 0);
      return hasProducts || hasChildren;
    });

    if (nav) {
      nav.innerHTML = `
        <a href="/" onclick="event.preventDefault(); StoreApp.navigate('/');" class="nav-link ${this.state.activeRoute === '/' ? 'active' : ''}">الرئيسية</a>
        ${activeTree.map(cat => {
        const validChildren = (cat.children || []).filter(c => c.product_count === undefined || c.product_count > 0);
        const hasChildren = validChildren.length > 0;
        if (hasChildren) {
          return `
              <div class="nav-dropdown">
                <a href="/category/${cat.slug}" onclick="event.preventDefault(); StoreApp.navigate('/category/${cat.slug}');" class="nav-link">
                  ${cat.name_ar || cat.name} ▾
                </a>
                <div class="nav-dropdown-menu">
                  <a href="/category/${cat.slug}" onclick="event.preventDefault(); StoreApp.navigate('/category/${cat.slug}');" class="dropdown-item" style="font-weight: 700;">
                    عرض الكل في ${cat.name_ar || cat.name}
                  </a>
                  ${validChildren.map(child => `
                    <a href="/category/${child.slug}" onclick="event.preventDefault(); StoreApp.navigate('/category/${child.slug}');" class="dropdown-item">
                      ${child.name_ar || child.name}
                    </a>
                  `).join('')}
                </div>
              </div>
            `;
        }
        return `
            <a href="/category/${cat.slug}" onclick="event.preventDefault(); StoreApp.navigate('/category/${cat.slug}');" class="nav-link">
              ${cat.name_ar || cat.name}
            </a>
          `;
      }).join('')}
      `;
    }

    if (drawerNav) {
      drawerNav.innerHTML = `
        <a href="/" onclick="event.preventDefault(); StoreApp.navigate('/');" class="drawer-nav-item ${this.state.activeRoute === '/' ? 'active' : ''}">
          <span>🏠</span> <span>الرئيسية</span>
        </a>
        <div class="drawer-divider"></div>
        <div class="drawer-heading">الأقسام والتصنيفات</div>
        ${activeTree.map(cat => {
        const validChildren = (cat.children || []).filter(c => c.product_count === undefined || c.product_count > 0);
        const hasChildren = validChildren.length > 0;
        return `
            <div class="drawer-category-group">
              <div style="display: flex; align-items: center; justify-content: space-between;">
                <a href="/category/${cat.slug}" onclick="event.preventDefault(); StoreApp.navigate('/category/${cat.slug}');" class="drawer-nav-item" style="flex: 1;">
                  <span>🎮</span> <span>${cat.name_ar || cat.name}</span>
                </a>
                ${hasChildren ? `
                  <button class="drawer-expand-btn" onclick="StoreApp.toggleDrawerSubcats(this, event)" aria-label="عرض الفروع">
                    ▾
                  </button>
                ` : ''}
              </div>
              ${hasChildren ? `
                <div class="drawer-subcats" style="display: none; padding-right: 28px; flex-direction: column; gap: 2px;">
                  <a href="/category/${cat.slug}" onclick="event.preventDefault(); StoreApp.navigate('/category/${cat.slug}');" class="drawer-subcat-item" style="font-weight: 700;">
                    • عرض الكل في ${cat.name_ar || cat.name}
                  </a>
                  ${validChildren.map(child => `
                    <a href="/category/${child.slug}" onclick="event.preventDefault(); StoreApp.navigate('/category/${child.slug}');" class="drawer-subcat-item">
                      • ${child.name_ar || child.name}
                    </a>
                  `).join('')}
                </div>
              ` : ''}
            </div>
          `;
      }).join('')}
      `;
    }
  },

  toggleDrawerSubcats(btn, e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const group = btn.closest('.drawer-category-group');
    if (!group) return;
    const subcats = group.querySelector('.drawer-subcats');
    if (!subcats) return;

    const isHidden = subcats.style.display === 'none' || !subcats.style.display;
    subcats.style.display = isHidden ? 'flex' : 'none';
    btn.textContent = isHidden ? '▴' : '▾';
    btn.style.color = isHidden ? 'var(--accent-light)' : 'var(--text-tertiary)';
  },

  renderCategoryPills(tree) {
    const container = document.getElementById('homeCategoryPills');
    if (!container) return;

    const activeTree = (tree || []).filter(c => {
      const hasProducts = c.product_count === undefined || c.product_count > 0;
      const hasChildren = Array.isArray(c.children) && c.children.some(ch => ch.product_count === undefined || ch.product_count > 0);
      return hasProducts || hasChildren;
    });

    container.innerHTML = `
      <button class="cat-pill active" onclick="StoreApp.filterCategory('all', this)">كل الأقسام</button>
      ${activeTree.map(c => `
        <button class="cat-pill" onclick="StoreApp.filterCategory('${c.slug || c.supplier_category_id}', this)">
          ${c.name_ar || c.name}
        </button>
      `).join('')}
    `;
  },

  filterCategory(catSlug, btn) {
    document.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    this.loadProducts({ category: catSlug });
  },

  // -------------------------------------------------------------
  // 2. Catalog & Products Loader
  // -------------------------------------------------------------
  async loadProducts(params = {}) {
    const grid = document.getElementById('homeProductsGrid');
    if (grid) grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-tertiary);">جاري تحميل المنتجات...</div>`;

    try {
      const q = new URLSearchParams(params).toString();
      const res = await fetch(`/api/products${q ? `?${q}` : ''}`);
      const json = await res.json();

      if (json.success && Array.isArray(json.data)) {
        this.state.products = json.data;
        this.renderProductsGrid(json.data, 'homeProductsGrid');
      }
    } catch (e) {
      if (grid) grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--danger);">فشل تحميل المنتجات. يرجى المحاولة لاحقاً.</div>`;
    }
  },

  resolveImageUrl(img) {
    if (!img || typeof img !== 'string') return 'https://images.unsplash.com/photo-1612287233261-26c71c4c1a2f?w=600&q=80';
    img = img.trim();
    if (!img) return 'https://images.unsplash.com/photo-1612287233261-26c71c4c1a2f?w=600&q=80';
    if (img.startsWith('http://') || img.startsWith('https://') || img.startsWith('data:')) {
      return img;
    }
    const leadingSlash = img.startsWith('/') ? '' : '/';
    return `https://utimate-eg.com${leadingSlash}${img}`;
  },

  renderProductsGrid(products, gridId) {
    const grid = document.getElementById(gridId);
    if (!grid) return;

    if (products.length === 0) {
      grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-tertiary);">لا توجد منتجات مطابقة حالياً.</div>`;
      return;
    }

    grid.innerHTML = products.map(p => {
      const rawImg = Array.isArray(p.images) && p.images.length > 0 ? p.images[0] : (p.image || p.cover_image || p.thumbnail);
      const imgUrl = this.resolveImageUrl(rawImg);
      const inStock = p.is_available !== false;
      const currency = p.currency || 'EGP';

      return `
        <div class="product-card" onclick="StoreApp.navigate('/product/${p.slug || p.id}')">
          <div class="product-img-wrap">
            <img src="${imgUrl}" alt="${p.name}" class="product-img" loading="lazy" onerror="this.onerror=null; this.src='https://images.unsplash.com/photo-1612287233261-26c71c4c1a2f?w=600&q=80';">
            <span class="badge ${inStock ? 'badge-success' : 'badge-danger'}" style="position: absolute; top: 10px; right: 10px;">
              ${inStock ? 'متوفر' : 'غير متوفر'}
            </span>
          </div>

          <div class="product-card-body">
            <span class="product-card-cat">${p.category_id || 'ألعاب واشتراكات'}</span>
            <h3 class="product-card-title">${p.name_ar || p.name}</h3>

            <div class="product-card-footer">
              <div>
                <span style="font-size: 0.75rem; color: var(--text-tertiary); display: block;">يبدأ من:</span>
                <span class="product-price-val">${p.price?.toLocaleString()} ${currency}</span>
              </div>
              <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); StoreApp.navigate('/product/${p.slug || p.id}')">
                عرض وشراء
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  filterProductsSearch(query) {
    if (!query) {
      this.renderProductsGrid(this.state.products, 'homeProductsGrid');
      return;
    }
    const filtered = this.state.products.filter(p =>
      (p.name && p.name.toLowerCase().includes(query)) ||
      (p.name_ar && p.name_ar.toLowerCase().includes(query)) ||
      (p.description && p.description.toLowerCase().includes(query))
    );
    this.renderProductsGrid(filtered, 'homeProductsGrid');
  },

  // -------------------------------------------------------------
  // 3. Category Page View (/category/:slug)
  // -------------------------------------------------------------
  async renderCategoryView(slug) {
    document.getElementById('view-category').style.display = 'block';
    const titleEl = document.getElementById('categoryPageTitle');
    const descEl = document.getElementById('categoryPageDesc');
    const subChips = document.getElementById('categorySubcategoriesChips');

    titleEl.textContent = 'جاري التحميل...';
    descEl.textContent = '';
    subChips.innerHTML = '';

    try {
      const res = await fetch(`/api/categories/${slug}`);
      const json = await res.json();

      if (json.success && json.data) {
        const { category, subcategories, products } = json.data;
        titleEl.textContent = category.name_ar || category.name;
        descEl.textContent = category.description || '';
        this.updateDocumentTitle(category.name_ar || category.name);

        if (Array.isArray(subcategories) && subcategories.length > 0) {
          subChips.innerHTML = subcategories.map(sub => `
            <a href="/category/${sub.slug}" onclick="event.preventDefault(); StoreApp.navigate('/category/${sub.slug}');" class="cat-pill">
              ${sub.name_ar || sub.name}
            </a>
          `).join('');
        }

        this.renderProductsGrid(products, 'categoryProductsGrid');
      }
    } catch (e) {
      titleEl.textContent = 'خطأ في تحميل القسم';
    }
  },

  // -------------------------------------------------------------
  // 4. Product Details & Variant Picker View (/product/:slug)
  // -------------------------------------------------------------
  async renderProductView(slug) {
    document.getElementById('view-product').style.display = 'block';

    try {
      const res = await fetch(`/api/products/${slug}`);
      const json = await res.json();

      if (json.success && json.data) {
        const p = json.data;
        this.state.currentProduct = p;
        this.updateDocumentTitle(p.name_ar || p.name);

        const imgEl = document.getElementById('productDetailImg');
        const rawImg = Array.isArray(p.images) && p.images.length > 0 ? p.images[0] : (p.image || p.cover_image || p.thumbnail);
        const imgUrl = this.resolveImageUrl(rawImg);
        imgEl.src = imgUrl;
        imgEl.onerror = () => { imgEl.src = 'https://images.unsplash.com/photo-1612287233261-26c71c4c1a2f?w=800&q=80'; };

        document.getElementById('productDetailCat').textContent = p.category_id || 'ألعاب واشتراكات';
        document.getElementById('productDetailTitle').textContent = p.name_ar || p.name;
        document.getElementById('productDetailDesc').textContent = p.description_ar || p.description || 'اشتراك رقمي موثوق مع تسليم مباشر وتفعيل رسمي.';

        const variantsGrid = document.getElementById('productVariantsGrid');
        const items = Array.isArray(p.items) && p.items.length > 0 ? p.items : [
          { id: p.id, name: 'النسخة القياسية', price: p.price, is_available: p.is_available }
        ];

        // Select first available variant with price > 0 by default
        this.state.selectedVariant = items.find(i => i.is_available && Number(i.price) > 0) || items[0];

        variantsGrid.innerHTML = items.map((it, idx) => {
          const isSelected = this.state.selectedVariant && (this.state.selectedVariant.id === it.id);
          const isPriced = Number(it.price) > 0;
          const isAvailable = isPriced && it.is_available !== false;
          const displayName = it.display_name || it.edition_label || it.name;

          return `
            <div class="variant-card ${isSelected ? 'selected' : ''}" 
                 id="variant-card-${it.id}"
                 data-item-id="${it.id}"
                 onclick="StoreApp.selectProductVariant('${it.id}')"
                 style="${!isAvailable ? 'opacity: 0.55; border-color: rgba(239, 68, 68, 0.35);' : ''}">
              <div class="variant-name">${displayName}</div>
              <div class="variant-price" style="${!isAvailable ? 'color: var(--text-tertiary);' : ''}">
                ${isPriced ? `${it.price?.toLocaleString()} ${it.currency || 'EGP'}` : 'غير متاح'}
              </div>
              <div style="font-size: 0.72rem; color: ${isAvailable ? 'var(--success)' : 'var(--danger)'}; margin-top: 4px; font-weight: 600;">
                ${isAvailable ? '● متوفر' : '● غير متوفر (Out of Stock)'}
              </div>
            </div>
          `;
        }).join('');

        this.updateProductDetailPriceDisplay();
        this.updateProductDynamicFields();
      }
    } catch (e) {
      this.showToast('تعذر تحميل تفاصيل المنتج', 'error');
    }
  },

  selectProductVariant(itemId) {
    if (!this.state.currentProduct) return;
    const it = (this.state.currentProduct.items || []).find(i => i.id === itemId);
    if (!it) return;

    this.state.selectedVariant = it;

    // Remove selected class from all cards
    document.querySelectorAll('.variant-card').forEach(el => el.classList.remove('selected'));

    // Highlight ONLY the specifically clicked card by ID or data-item-id
    const targetCard = document.getElementById(`variant-card-${it.id}`) || document.querySelector(`.variant-card[data-item-id="${it.id}"]`);
    if (targetCard) {
      targetCard.classList.add('selected');
    }

    this.updateProductDetailPriceDisplay();
    this.updateProductDynamicFields();
  },

  updateProductDetailPriceDisplay() {
    const v = this.state.selectedVariant;
    if (!v) return;

    const priceEl = document.getElementById('productDetailPrice');
    const stockEl = document.getElementById('productDetailStockBadge');
    const btnBuy = document.getElementById('btnProceedToCheckout');

    const isPriced = Number(v.price) > 0;
    const isAvail = isPriced && v.is_available !== false;

    priceEl.textContent = isPriced ? `${v.price?.toLocaleString()} ${v.currency || 'EGP'}` : 'غير متاح';

    if (isAvail) {
      stockEl.className = 'badge badge-success';
      stockEl.textContent = 'متوفر في المخزون';
      btnBuy.disabled = false;
      btnBuy.textContent = 'متابعة للدفع والشراء الفوري ←';
    } else {
      stockEl.className = 'badge badge-danger';
      stockEl.textContent = 'نفدت الكمية حالياً (Out of Stock)';
      btnBuy.disabled = true;
      btnBuy.textContent = 'هذا النوع غير متوفر حالياً';
    }
  },

  updateProductDynamicFields() {
    const p = this.state.currentProduct;
    const v = this.state.selectedVariant;
    const sec = document.getElementById('productDynamicFieldsSection');
    const list = document.getElementById('productDynamicFieldsList');
    if (!sec || !list) return;

    const fields = this.getProductCustomFields(p, v);
    if (fields.length > 0) {
      sec.style.display = 'block';
      list.innerHTML = fields.map(f => `
        <div class="form-group" style="margin-bottom: 0;">
          <label class="form-label" style="display: flex; align-items: center; justify-content: space-between; font-size: 0.82rem;">
            <span style="display: flex; align-items: center; gap: 6px;">
              <span>${f.icon || '📌'}</span>
              <span>${f.label}</span>
              ${f.required ? '<span style="color: var(--danger); font-weight: 800;">*</span>' : '<span style="color: var(--text-tertiary); font-size: 0.72rem;">(اختياري)</span>'}
            </span>
          </label>
          <input type="${f.type || 'text'}" 
                 id="prod_custom_field_${f.id}" 
                 name="prod_custom_field_${f.id}" 
                 class="form-input custom-product-input" 
                 placeholder="${f.placeholder || ''}"
                 value="${(this.state.customFieldValues && this.state.customFieldValues[f.id]) || ''}"
                 oninput="StoreApp.handleProductFieldInput('${f.id}', this.value)"
                 style="background: var(--bg-surface-elevated);">
          ${f.help ? `<div style="font-size: 0.74rem; color: var(--text-tertiary); margin-top: 4px;">${f.help}</div>` : ''}
        </div>
      `).join('');
    } else {
      sec.style.display = 'none';
      list.innerHTML = '';
    }
  },

  handleProductFieldInput(fieldId, value) {
    this.state.customFieldValues = this.state.customFieldValues || {};
    this.state.customFieldValues[fieldId] = value;
  },

  getProductCustomFields(product, variant) {
    const fields = [];
    const seenKeys = new Set();

    // 1. If the product has custom_fields returned directly from the supplier API, use them!
    if (product && Array.isArray(product.custom_fields) && product.custom_fields.length > 0) {
      for (const f of product.custom_fields) {
        if (!f) continue;
        const fid = f.id || `field_${Math.random().toString(36).slice(2, 7)}`;
        const labelAr = (typeof f.label === 'object' ? (f.label.ar || f.label.en) : f.label) || 'البيان المطلوب';
        const placeholderAr = (typeof f.placeholder === 'object' ? (f.placeholder.ar || f.placeholder.en) : f.placeholder) || '';

        let icon = '📝';
        let inputType = f.type || 'text';
        const lowerLabel = String(labelAr).toLowerCase();

        if (lowerLabel.includes('uid') || lowerLabel.includes('معرف') || lowerLabel.includes('player')) icon = '🎮';
        else if (lowerLabel.includes('email') || lowerLabel.includes('بريد') || inputType === 'email') icon = '📧';
        else if (lowerLabel.includes('pass') || lowerLabel.includes('كلمة') || lowerLabel.includes('رمز')) { icon = '🔒'; inputType = 'password'; }
        else if (lowerLabel.includes('num') || lowerLabel.includes('رقم') || lowerLabel.includes('هاتف') || inputType === 'tel') { icon = '📱'; inputType = 'tel'; }

        fields.push({
          id: fid,
          label: labelAr,
          placeholder: placeholderAr || (inputType === 'password' ? '••••••••' : (inputType === 'email' ? 'name@example.com' : (inputType === 'tel' ? 'مثال: 01012345678' : 'أدخل القيمة المطلوبة'))),
          type: inputType,
          required: f.required !== false,
          icon,
          help: f.help || ''
        });
        seenKeys.add(fid);
        seenKeys.add(lowerLabel);
      }
    }

    const pName = (product?.name || '').toLowerCase();
    const pNameAr = (product?.name_ar || '').toLowerCase();
    const pSlug = (product?.slug || '').toLowerCase();
    const catId = (product?.category_id || '').toLowerCase();
    const vName = (variant?.name || variant?.edition_label || '').toLowerCase();
    const vSel = variant?.selection || {};
    const vSelStr = JSON.stringify(vSel).toLowerCase();

    // 2. If API did not define custom_fields, use smart category/slug mapping
    if (fields.length === 0) {
      if (pSlug.includes('pubg') || pName.includes('pubg') || pNameAr.includes('ببجي')) {
        fields.push({
          id: 'player_id',
          label: 'معرف اللاعب في اللعبة (Player ID / UID)',
          placeholder: 'مثال: 5123456789',
          type: 'text',
          required: true,
          icon: '🎮',
          help: 'المعرف الرقمي الخاص بحسابك في لعبة ببجي موبايل لتنفيذ الشحن فوراً.'
        });
        fields.push({
          id: 'player_name',
          label: 'اسم اللاعب داخل اللعبة (اختياري للتأكيد)',
          placeholder: 'مثال: Hunter_99',
          type: 'text',
          required: false,
          icon: '👤'
        });
        return fields;
      }

      if (pSlug.includes('freefire') || pName.includes('free fire') || pNameAr.includes('فري فاير') || pName.includes('garena')) {
        fields.push({
          id: 'player_id',
          label: 'معرف اللاعب (Player ID / UID)',
          placeholder: 'مثال: 1029384756',
          type: 'text',
          required: true,
          icon: '🔥',
          help: 'معرف الحساب الخاص بك في فري فاير لإرسال الجواهر فوراً.'
        });
        return fields;
      }

      if (pSlug.includes('valorant') || pName.includes('valorant') || pNameAr.includes('فالورانت') || pSlug.includes('league') || pName.includes('league of legends')) {
        fields.push({
          id: 'riot_id',
          label: 'معرف رايوت (Riot ID + Tagline)',
          placeholder: 'مثال: PlayerName#EGY',
          type: 'text',
          required: true,
          icon: '🎯',
          help: 'اسم المستخدم متبوعاً بعلامة # والتاج (مثال: Name#EGY).'
        });
        return fields;
      }

      if (pSlug.includes('efootball') || pName.includes('efootball') || pNameAr.includes('بيس') || pName.includes('pes')) {
        fields.push({
          id: 'player_id',
          label: 'معرف المستخدم أو Konami ID',
          placeholder: 'مثال: 123-456-789 أو بريدك المسجل',
          type: 'text',
          required: true,
          icon: '⚽',
          help: 'الـ User ID أو بريد Konami ID الخاص بحسابك لإضافة الكوينز.'
        });
        return fields;
      }

      if (pSlug.includes('ea-sports-fc-mobile') || pName.includes('fc mobile') || pName.includes('fifa') || pNameAr.includes('فيفا')) {
        fields.push({
          id: 'player_id',
          label: 'معرف الحساب (UID في FC Mobile)',
          placeholder: 'مثال: 1002345678',
          type: 'text',
          required: true,
          icon: '🏆',
          help: 'المعرف الرقمي لحسابك في لعبة FC Mobile لتزويد النقاط.'
        });
        return fields;
      }

      if (pSlug.includes('fortnite') || pName.includes('fortnite') || pNameAr.includes('فورتنايت')) {
        fields.push({
          id: 'epic_email',
          label: 'البريد الإلكتروني لحساب إيبك (Epic Games Email)',
          placeholder: 'example@gmail.com',
          type: 'email',
          required: true,
          icon: '📧',
          help: 'البريد الإلكتروني المرتبط بحساب إيبك جيمز.'
        });
        fields.push({
          id: 'epic_password',
          label: 'كلمة مرور الحساب (Epic Games Password)',
          placeholder: '••••••••',
          type: 'password',
          required: true,
          icon: '🔒',
          help: 'كلمة المرور لتسجيل الدخول وتنفيذ الطلب.'
        });
        return fields;
      }

      if (pSlug.includes('roblox') || pName.includes('roblox') || pNameAr.includes('روبلوكس')) {
        fields.push({
          id: 'roblox_username',
          label: 'اسم المستخدم في روبلوكس (Roblox Username)',
          placeholder: 'مثال: RobloxPlayer99',
          type: 'text',
          required: true,
          icon: '🧱'
        });
        return fields;
      }

      if (pSlug.includes('fivem') || pName.includes('fivem')) {
        fields.push({
          id: 'discord_or_steam',
          label: 'معرف الديسكورد أو Steam Hex ID',
          placeholder: 'مثال: discord_user أو steam:1100001...',
          type: 'text',
          required: true,
          icon: '🚗'
        });
        return fields;
      }

      if (pSlug.includes('discord') || pName.includes('discord') || pNameAr.includes('ديسكورد')) {
        if (vName.includes('boost') || vName.includes('بوست') || vSelStr.includes('boost')) {
          fields.push({
            id: 'server_invite',
            label: 'رابط دعوة سيرفر الديسكورد (Server Invite Link)',
            placeholder: 'https://discord.gg/yourserver',
            type: 'url',
            required: true,
            icon: '🚀',
            help: 'رابط دعوة غير منتهي لسيرفرك لتزويد البوستات عليه فوراً.'
          });
        } else {
          fields.push({
            id: 'discord_username',
            label: 'اسم مستخدم ديسكورد (Discord Username / ID)',
            placeholder: 'مثال: username أو 123456789012345',
            type: 'text',
            required: true,
            icon: '💬',
            help: 'يوزر أو معرف حسابك لإرسال النيترو أو الهدية.'
          });
        }
        return fields;
      }

      if (pSlug.includes('snapchat') || pName.includes('snapchat') || pNameAr.includes('سناب')) {
        fields.push({
          id: 'snapchat_username',
          label: 'يوزر حساب سناب شات (Snapchat Username)',
          placeholder: 'مثال: my_snapchat_user',
          type: 'text',
          required: true,
          icon: '👻',
          help: 'اسم المستخدم لحسابك في سناب شات لإرسال اشتراك البلس كهدية.'
        });
        return fields;
      }

      if (pSlug.includes('etisalat') || pSlug.includes('we-gold') || pName.includes('etisalat') || pName.includes('we gold') || pNameAr.includes('اتصالات') || pNameAr.includes('وي')) {
        fields.push({
          id: 'recharge_phone',
          label: 'رقم خط الهاتف للتعبئة والشحن',
          placeholder: 'مثال: 01012345678 / 01112345678 / 01512345678',
          type: 'tel',
          required: true,
          icon: '📱',
          help: 'رقم الموبايل المراد شحن الرصيد / الباقة عليه مباشرة.'
        });
        return fields;
      }

      if (pSlug.includes('playstation-plus') || pName.includes('playstation plus') || pNameAr.includes('بلايستيشن بلس')) {
        fields.push({
          id: 'psn_email',
          label: 'البريد الإلكتروني لحساب بلايستيشن (PSN Email)',
          placeholder: 'your_psn_email@gmail.com',
          type: 'email',
          required: true,
          icon: '🎮',
          help: 'الإيميل المراد تفعيل اشتراك البلس عليه.'
        });
        return fields;
      }

      if (catId === 'subscriptions' || pSlug.includes('netflix') || pSlug.includes('prime-video') || pSlug.includes('nord-vpn') || pName.includes('netflix') || pName.includes('prime video')) {
        fields.push({
          id: 'target_email',
          label: 'البريد الإلكتروني للتفعيل (اختياري)',
          placeholder: 'name@example.com (إذا كنت ترغب بالتفعيل على إيميلك الخاص)',
          type: 'email',
          required: false,
          icon: '📧',
          help: 'اتركه فارغاً إذا كنت تريد استلام حساب جاهز مفعل مسبقاً.'
        });
        return fields;
      }
    }

    // 3. Variant-specific gift fields (for games/gift-editions)
    const isGift = vName.includes('gift') || vName.includes('هدية') || vSelStr.includes('gift');
    const isPc = vName.includes('pc') || vSelStr.includes('pc') || pSlug.includes('-pc');
    const isXbox = vName.includes('xbox') || vName.includes('إكس بوكس') || vSelStr.includes('xbox');

    if (isGift && isPc && !seenKeys.has('steam_profile') && !seenKeys.has('steam')) {
      fields.push({
        id: 'steam_profile',
        label: 'رابط بروفايل ستيم أو كود الصداقة (Steam Profile / Friend Code)',
        placeholder: 'https://steamcommunity.com/id/... أو كود الصداقة (مثال: 123456789)',
        type: 'text',
        required: true,
        icon: '🎁',
        help: 'يرجى وضع رابط حساب ستيم أو كود الصداقة لإضافتك وإرسال اللعبة كهدية فوراً.'
      });
    }

    if (isGift && isXbox && !seenKeys.has('xbox_gamertag') && !seenKeys.has('xbox')) {
      fields.push({
        id: 'xbox_gamertag',
        label: 'الجيمرتاج أو إيميل مايكروسوفت (Xbox Gamertag / Email)',
        placeholder: 'مثال: GamerTag99 أو email@outlook.com',
        type: 'text',
        required: true,
        icon: '🎮',
        help: 'اسم حساب إكس بوكس لإرسال الهدية إليه مباشرة.'
      });
    }

    if (fields.length === 0 && (catId === 'top-up' || catId === 'gift-cards')) {
      fields.push({
        id: 'account_or_player_id',
        label: 'معرف الحساب أو اللاعب في اللعبة / التطبيق (Player / Account ID)',
        placeholder: 'أدخل المعرف أو اسم الحساب لتنفيذ الشحن',
        type: 'text',
        required: true,
        icon: '🆔',
        help: 'المعرف المطلوب لإتمام عملية الشحن والتسليم.'
      });
    }

    return fields;
  },

  proceedToCheckoutFromProduct() {
    if (!this.state.currentProduct || !this.state.selectedVariant) {
      this.showToast('يرجى اختيار نوع أو باقة المنتج', 'error');
      return;
    }

    const v = this.state.selectedVariant;
    if (!v.is_available || Number(v.price) <= 0) {
      this.showToast('هذا النوع غير متاح حالياً للشراء (نفدت الكمية)', 'error');
      return;
    }

    // Capture dynamic inputs from the product page if filled
    this.state.customFieldValues = this.state.customFieldValues || {};
    const fields = this.getProductCustomFields(this.state.currentProduct, this.state.selectedVariant);
    for (const f of fields) {
      const input = document.getElementById(`prod_custom_field_${f.id}`);
      if (input && input.value.trim()) {
        this.state.customFieldValues[f.id] = input.value.trim();
      }
    }

    const itemPrice = Number(this.state.selectedVariant.price || 0);

    this.state.checkoutItem = {
      product: this.state.currentProduct,
      product_id: this.state.currentProduct.id,
      product_name: this.state.currentProduct.name_ar || this.state.currentProduct.name,
      product_slug: this.state.currentProduct.slug,
      category_id: this.state.currentProduct.category_id,
      item_id: this.state.selectedVariant.id,
      supplier_item_id: this.state.selectedVariant.supplier_item_id,
      name: displayName,
      edition_label: this.state.selectedVariant.edition_label,
      selection: this.state.selectedVariant.selection,
      price: itemPrice,
      customer_price: itemPrice,
      unit_customer_price: itemPrice,
      currency: this.state.selectedVariant.currency || 'EGP',
      quantity: 1
    };

    this.navigate('/checkout');
  },

  // -------------------------------------------------------------
  // 5. Checkout View (/checkout)
  // -------------------------------------------------------------
  renderCheckoutView() {
    document.getElementById('view-checkout').style.display = 'block';
    this.updateDocumentTitle('تأكيد بيانات الطلب');
    const item = this.state.checkoutItem;

    if (!item) {
      this.navigate('/');
      return;
    }

    document.getElementById('checkoutItemName').textContent = item.product_name;
    document.getElementById('checkoutItemVariant').textContent = `النوع المختار: ${item.name}`;
    document.getElementById('checkoutItemPrice').textContent = `${item.price?.toLocaleString()} ${item.currency}`;

    // Render Dynamic Product-Specific Fields (Player ID, Steam link, etc.)
    const customFields = this.getProductCustomFields(item.product || this.state.currentProduct, item);
    const dynSection = document.getElementById('checkoutDynamicFieldsSection');
    const dynList = document.getElementById('checkoutDynamicFieldsList');

    if (dynSection && dynList) {
      if (customFields.length > 0) {
        dynSection.style.display = 'block';
        dynList.innerHTML = customFields.map(f => {
          const preVal = (this.state.customFieldValues && this.state.customFieldValues[f.id]) || '';
          return `
            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label" style="display: flex; align-items: center; justify-content: space-between;">
                <span style="display: flex; align-items: center; gap: 6px;">
                  <span>${f.icon || '📌'}</span>
                  <span>${f.label}</span>
                  ${f.required ? '<span style="color: var(--danger); font-weight: 800;">*</span>' : '<span style="color: var(--text-tertiary); font-size: 0.72rem;">(اختياري)</span>'}
                </span>
              </label>
              <input type="${f.type || 'text'}" 
                     id="custom_field_${f.id}" 
                     name="custom_field_${f.id}" 
                     class="form-input custom-product-input" 
                     placeholder="${f.placeholder || ''}"
                     value="${preVal}"
                     ${f.required ? 'required' : ''}
                     style="background: var(--bg-surface-elevated);">
              ${f.help ? `<div style="font-size: 0.74rem; color: var(--text-tertiary); margin-top: 4px;">${f.help}</div>` : ''}
            </div>
          `;
        }).join('');
      } else {
        dynSection.style.display = 'none';
        dynList.innerHTML = '';
      }
    }

    // Autofill user profile if logged in
    if (this.state.user) {
      if (document.getElementById('checkoutCustName')) document.getElementById('checkoutCustName').value = this.state.user.name || '';
      if (document.getElementById('checkoutCustEmail')) document.getElementById('checkoutCustEmail').value = this.state.user.email || '';
    }
  },

  async submitCheckout(e) {
    e.preventDefault();
    const item = this.state.checkoutItem;
    if (!item) return;

    const btn = document.getElementById('btnConfirmOrder');
    btn.disabled = true;
    btn.textContent = 'جاري التحقق من التوفر وتجهيز الطلب...';

    // Collect and validate custom fields
    const customFieldsObj = {};
    const customFieldDefs = this.getProductCustomFields(item.product || this.state.currentProduct, item);
    for (const f of customFieldDefs) {
      const inputEl = document.getElementById(`custom_field_${f.id}`);
      const val = inputEl ? inputEl.value.trim() : '';
      if (f.required && !val) {
        this.showToast(`يرجى إدخال: ${f.label.replace(/\*/g, '').trim()}`, 'error');
        if (inputEl) {
          inputEl.focus();
          inputEl.style.borderColor = 'var(--danger)';
        }
        btn.disabled = false;
        btn.textContent = 'تأكيد الطلب والانتقال للدفع 💳';
        return;
      }
      if (val) {
        customFieldsObj[f.id] = val;
      }
    }

    const notesEl = document.getElementById('checkoutCustNotes');
    const notes = notesEl ? notesEl.value.trim() : '';

    const customer = {
      name: document.getElementById('checkoutCustName').value.trim(),
      phone: document.getElementById('checkoutCustPhone').value.trim(),
      email: document.getElementById('checkoutCustEmail').value.trim(),
      custom_fields: customFieldsObj,
      notes
    };

    try {
      const res = await fetch('/api/orders/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer,
          items: [item]
        })
      });

      let json = null;
      try {
        json = await res.json();
      } catch (parseErr) {
        throw new Error('تعذر معالجة استجابة الخادم، يرجى المحاولة مرة أخرى.');
      }

      if (json.success && json.data) {
        this.showToast('تم تسجيل طلبك بنجاح! يرجى إتمام التحويل.', 'success');
        this.navigate(`/payment/${json.data.reseller_order_id}`);
      } else {
        const msg = (typeof json.error === 'object' ? json.error?.message : json.error) || 'تعذر تأكيد الطلب';
        this.showToast(msg, 'error');
      }
    } catch (err) {
      this.showToast(`خطأ: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'تأكيد الطلب والانتقال للدفع 💳';
    }
  },

  // -------------------------------------------------------------
  // 6. Payment & Transfer Proof Upload View (/payment/{orderId})
  // -------------------------------------------------------------
  async renderPaymentView(orderId) {
    document.getElementById('view-payment').style.display = 'block';
    this.updateDocumentTitle(`إتمام الدفع - طلب #${orderId}`);

    try {
      const [orderRes, pmRes] = await Promise.all([
        fetch(`/api/orders/${orderId}`),
        fetch('/api/payment-methods')
      ]);

      const orderJson = await orderRes.json();
      const pmJson = await pmRes.json();

      if (orderJson.success && orderJson.data) {
        const ord = orderJson.data;
        document.getElementById('payOrderIdText').textContent = ord.reseller_order_id;
        document.getElementById('payOrderTotalText').textContent = `${ord.total?.toLocaleString()} ${ord.currency}`;

        const badge = document.getElementById('payOrderStatusBadge');
        if (ord.payment_status === 'payment_submitted') {
          badge.className = 'badge badge-primary';
          badge.textContent = 'تم إرسال إشعار التحويل وجاري المراجعة';
        } else if (ord.payment_status === 'paid') {
          badge.className = 'badge badge-success';
          badge.textContent = 'تم تأكيد الدفع بنجاح';
        }

        // Render payment methods
        const methods = pmJson.data || [];
        const container = document.getElementById('paymentMethodsList');

        if (methods.length > 0) {
          this.state.selectedPaymentMethod = methods[0];
          container.innerHTML = methods.map((m, idx) => `
            <div class="payment-card ${idx === 0 ? 'selected' : ''}" onclick="StoreApp.selectPaymentMethod('${m.id}')">
              <div style="font-size: 1.6rem; margin-bottom: 6px;">${m.logo_icon || '💳'}</div>
              <div style="font-weight: 700; font-size: 0.95rem;">${m.name_ar || m.name}</div>
              <div style="font-size: 0.78rem; color: var(--text-tertiary);">${m.type}</div>
            </div>
          `).join('');

          this.updateSelectedPaymentMethodBox();
        }
      }
    } catch (e) {
      this.showToast('تعذر تحميل بيانات الدفع', 'error');
    }
  },

  selectPaymentMethod(pmId) {
    fetch('/api/payment-methods').then(r => r.json()).then(json => {
      const method = (json.data || []).find(m => m.id === pmId);
      if (method) {
        this.state.selectedPaymentMethod = method;
        document.querySelectorAll('.payment-card').forEach(el => el.classList.remove('selected'));
        const cards = document.querySelectorAll('.payment-card');
        cards.forEach(c => {
          if (c.innerHTML.includes(method.name_ar) || c.innerHTML.includes(method.name)) {
            c.classList.add('selected');
          }
        });
        this.updateSelectedPaymentMethodBox();
      }
    });
  },

  updateSelectedPaymentMethodBox() {
    const pm = this.state.selectedPaymentMethod;
    if (!pm) return;

    document.getElementById('pmSelectedName').textContent = pm.name_ar || pm.name;
    document.getElementById('pmSelectedInstructions').textContent = pm.instructions_ar || pm.instructions;
    document.getElementById('pmSelectedAccount').textContent = pm.account_number;
  },

  copyPaymentAccount() {
    const acc = document.getElementById('pmSelectedAccount').textContent;
    navigator.clipboard.writeText(acc).then(() => {
      this.showToast('تم نسخ رقم الحساب بنجاح 📋', 'success');
    });
  },

  handleProofFileSelect(e) {
    const file = e.target.files ? e.target.files[0] : (e.dataTransfer ? e.dataTransfer.files[0] : null);
    if (!file) return;

    // Validate type and size
    if (!file.type.match(/image\/(jpeg|jpg|png|webp)/i)) {
      this.showToast('صيغة الملف غير مدعومة. يرجى اختيار صورة JPG أو PNG أو WEBP.', 'error');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      this.showToast('حجم الصورة كبير جداً (الحد الأقصى 10 ميجابايت).', 'error');
      return;
    }

    this.state.selectedProofFile = file;
    const previewContainer = document.getElementById('proofPreviewContainer');
    const previewImg = document.getElementById('proofPreviewImg');
    const fileNameText = document.getElementById('proofFileNameText');

    if (fileNameText) {
      fileNameText.textContent = `${file.name} (${(file.size / 1024).toFixed(0)} KB)`;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      previewImg.src = event.target.result;
      previewContainer.style.display = 'block';
    };
    reader.readAsDataURL(file);
  },

  removeSelectedProofFile() {
    this.state.selectedProofFile = null;
    const input = document.getElementById('proofFileInput');
    if (input) input.value = '';
    const previewContainer = document.getElementById('proofPreviewContainer');
    if (previewContainer) previewContainer.style.display = 'none';
    const previewImg = document.getElementById('proofPreviewImg');
    if (previewImg) previewImg.src = '';
  },

  async submitPaymentProof(e) {
    e.preventDefault();
    const orderId = document.getElementById('payOrderIdText').textContent;
    const file = this.state.selectedProofFile;

    if (!file) {
      this.showToast('يرجى إرفاق صورة إيصال التحويل أولاً', 'error');
      return;
    }

    const btn = document.getElementById('btnSubmitProof');
    btn.disabled = true;
    btn.textContent = 'جاري إرسال إشعار التحويل...';

    const formData = new FormData();
    formData.append('proof_image', file);
    formData.append('payment_method_id', this.state.selectedPaymentMethod?.id || 'manual');
    formData.append('payment_method_name', this.state.selectedPaymentMethod?.name_ar || this.state.selectedPaymentMethod?.name || 'Manual Transfer');
    formData.append('reference', document.getElementById('proofReferenceInput')?.value || '');

    try {
      const res = await fetch(`/api/orders/${orderId}/payment-proof`, {
        method: 'POST',
        body: formData
      });

      const json = await res.json();
      if (json.success) {
        this.showToast('تم إرسال إشعار التحويل بنجاح! جاري مراجعة وتأكيد طلبك.', 'success');
        this.removeSelectedProofFile();
        this.navigate(`/success/${orderId}`);
      } else {
        this.showToast(json.error?.message || 'تعذر إرسال الإشعار', 'error');
      }
    } catch (err) {
      this.showToast(`خطأ: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'إرسال إشعار التحويل وتأكيد الدفع 🚀';
    }
  },

  // -------------------------------------------------------------
  // 7. Order Confirmation & Success View (/success/{orderId})
  // -------------------------------------------------------------
  renderSuccessView(orderId) {
    const successView = document.getElementById('view-success');
    if (successView) successView.style.display = 'block';
    this.updateDocumentTitle(`تم إرسال الطلب #${orderId}`);

    const idEl = document.getElementById('successOrderIdText');
    if (idEl) idEl.textContent = orderId || 'RSL-00000';

    const waBtn = document.getElementById('btnSuccessWhatsApp');
    if (waBtn) {
      const phone = (this.state.storeInfo?.support_whatsapp || '+201001234567').replace(/[^0-9]/g, '');
      const msg = encodeURIComponent(`مرحباً، قمت بتحويل المبلغ وإرسال الإشعار لطلبي رقم ${orderId || ''}`);
      waBtn.href = `https://wa.me/${phone}?text=${msg}`;
    }
  },

  // -------------------------------------------------------------
  // 8. Auth Controls
  // -------------------------------------------------------------
  renderLoginView() {
    document.getElementById('view-login').style.display = 'block';
    this.updateDocumentTitle('تسجيل الدخول');
  },

  renderRegisterView() {
    document.getElementById('view-register').style.display = 'block';
    this.updateDocumentTitle('إنشاء حساب جديد');
  },

  async handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail')?.value.trim();
    const password = document.getElementById('loginPass')?.value;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const json = await res.json();
      if (json.success) {
        this.state.user = json.data;
        this.showToast(`مرحباً بك مجدداً ${json.data.name}`, 'success');
        this.navigate('/');
      } else {
        this.showToast(json.error?.message || 'فشل تسجيل الدخول', 'error');
      }
    } catch (err) {
      this.showToast(`خطأ: ${err.message}`, 'error');
    }
  },

  async handleRegister(e) {
    e.preventDefault();
    const name = document.getElementById('regName')?.value.trim();
    const email = document.getElementById('regEmail')?.value.trim();
    const password = document.getElementById('regPass')?.value;

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password })
      });

      const json = await res.json();
      if (json.success) {
        this.state.user = json.data;
        this.showToast('تم إنشاء الحساب وتسجيل الدخول بنجاح!', 'success');
        this.navigate('/');
      } else {
        this.showToast(json.error?.message || 'فشل إنشاء الحساب', 'error');
      }
    } catch (err) {
      this.showToast(`خطأ: ${err.message}`, 'error');
    }
  },

  async checkAuthSession() {
    try {
      const res = await fetch('/api/auth/me');
      const json = await res.json();
      if (json.success && json.data) {
        this.state.user = json.data;
        const link = document.getElementById('navAuthLink');
        if (link) {
          link.textContent = `مرحباً، ${json.data.name.split(' ')[0]}`;
          link.onclick = () => this.handleLogout();
        }
      }
    } catch { }
  },

  async handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    this.state.user = null;
    this.showToast('تم تسجيل الخروج', 'info');
    window.location.reload();
  },

  showToast(msg, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
      <span>${type === 'success' ? '✓' : type === 'error' ? '⚠' : 'ℹ'}</span>
      <span>${msg}</span>
    `;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 250);
    }, 3500);
  }
};

document.addEventListener('DOMContentLoaded', () => StoreApp.init());
window.StoreApp = StoreApp;
