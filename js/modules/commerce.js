/**
 * FUMOCA Commerce Layer v1.0
 * ═══════════════════════════════════════════════════════════════════
 * Turns any Gaussian splat into a shoppable 3D product experience.
 * This is what puts Fumoca above Luma, SupaSplat and Kiri Engine —
 * none of them have native commerce built into the viewer.
 *
 * Features:
 *   - Product price tags anchored to real 3D positions on the splat
 *   - "Add to cart" / "Buy now" CTA buttons floating in 3D space
 *   - Product card panel (title, price, description, image, link)
 *   - Cart accumulator (items persist via localStorage)
 *   - Webhook / postMessage to host site cart system
 *   - Analytics: which products were viewed, clicked, added to cart
 *   - Works in embed mode — revenue flows to the brand, Fumoca meters it
 *
 * Product hotspots are stored as regular hotspots with type='product'
 * plus extended fields: productId, productLabel, productPrice,
 * productImage, productUrl, ctaLabel, variantOptions
 * ═══════════════════════════════════════════════════════════════════
 */

const FumocaCommerce = (() => {

  // ── State ─────────────────────────────────────────────────────
  let cart = [];
  let activeProductId = null;
  const CART_KEY = 'fumoca_cart';

  function emit(name, detail = {}) {
    try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch (_) {}
    // Also postMessage to parent frame (for embed → host communication)
    try {
      if (window.parent !== window) {
        window.parent.postMessage({ fumoca: true, event: name, detail }, '*');
      }
    } catch (_) {}
  }

  // ── Cart persistence ──────────────────────────────────────────
  function loadCart() {
    try { cart = JSON.parse(localStorage.getItem(CART_KEY) || '[]'); } catch (_) { cart = []; }
  }
  function saveCart() {
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (_) {}
  }
  function getCartCount() { return cart.reduce((s, i) => s + (i.qty || 1), 0); }

  function addToCart(product) {
    loadCart();
    const existing = cart.find(i => i.productId === product.productId);
    if (existing) {
      existing.qty = (existing.qty || 1) + 1;
    } else {
      cart.push({ ...product, qty: 1, addedAt: Date.now() });
    }
    saveCart();
    _updateCartBadge();
    emit('fumoca:addedToCart', { product, cart: [...cart], count: getCartCount() });
  }

  function removeFromCart(productId) {
    loadCart();
    cart = cart.filter(i => i.productId !== productId);
    saveCart();
    _updateCartBadge();
    emit('fumoca:removedFromCart', { productId, cart: [...cart] });
  }

  // ── Cart badge on topbar ──────────────────────────────────────
  function _updateCartBadge() {
    let badge = document.getElementById('fumocaCartBadge');
    const count = getCartCount();
    if (!count) {
      badge?.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('button');
      badge.id = 'fumocaCartBadge';
      badge.style.cssText = `
        background:rgba(200,255,0,.14);border:1px solid rgba(200,255,0,.3);
        color:var(--neon);font-family:var(--font-body);font-size:13px;
        font-weight:700;padding:9px 14px;border-radius:12px;cursor:pointer;
        white-space:nowrap;position:relative;
      `;
      badge.addEventListener('click', openCartPanel);
      // Insert into topbar actions
      const topActions = document.getElementById('topActions');
      if (topActions) topActions.prepend(badge);
    }
    badge.textContent = `🛒 ${count}`;
  }

  // ── Product card ──────────────────────────────────────────────
  function openProductCard(hotspot) {
    closeProductCard();
    if (!hotspot) return;
    activeProductId = hotspot.productId || hotspot.id;

    const card = document.createElement('div');
    card.id = 'fumocaProductCard';
    card.style.cssText = `
      position:fixed;right:16px;bottom:16px;z-index:20;
      width:min(380px,calc(100vw - 32px));
      background:rgba(7,10,16,.94);border:1px solid rgba(255,255,255,.12);
      border-radius:24px;backdrop-filter:blur(22px);
      box-shadow:0 20px 70px rgba(0,0,0,.45);overflow:hidden;
      animation:fumocaSlideUp .22s ease;
    `;

    const accentColor = window._fumocaWhiteLabel?.getBrandConfig?.()?.accentColor || 'var(--neon)';
    const price = hotspot.productPrice || '';
    const image = hotspot.productImage || '';
    const desc = hotspot.description || hotspot.desc || '';
    const ctaLabel = hotspot.ctaLabel || 'Buy now';
    const ctaUrl = hotspot.productUrl || hotspot.ctaLink || hotspot.link || '';
    const variants = hotspot.variantOptions || [];

    card.innerHTML = `
      <div style="height:4px;background:linear-gradient(90deg,${accentColor},var(--acid2,#00ffc8));"></div>
      ${image ? `<div style="background:center/cover no-repeat url('${image}');height:200px;position:relative;">
        <div style="position:absolute;inset:0;background:linear-gradient(180deg,transparent 50%,rgba(7,10,16,.85));"></div>
      </div>` : ''}
      <div style="padding:16px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
          <div>
            <div style="font-family:var(--font-display);font-size:26px;letter-spacing:.04em;color:#fff;line-height:1;">${_esc(hotspot.productLabel || hotspot.title || 'Product')}</div>
            ${price ? `<div style="font-size:22px;font-weight:700;color:${accentColor};margin-top:4px;">${_esc(price)}</div>` : ''}
          </div>
          <button id="fumocaProductClose" style="width:36px;height:36px;border-radius:999px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#fff;cursor:pointer;flex-shrink:0;font-size:16px;">✕</button>
        </div>
        ${desc ? `<div style="margin-top:10px;font-size:13px;line-height:1.6;color:rgba(255,255,255,.75);">${_esc(desc)}</div>` : ''}
        ${variants.length ? `
          <div style="margin-top:12px;">
            <div style="font-size:11px;font-weight:700;color:rgba(255,255,255,.5);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;">Options</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              ${variants.map((v, i) => `<button class="fumocaVariantBtn" data-idx="${i}" style="padding:7px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#fff;cursor:pointer;font-size:12px;">${_esc(v)}</button>`).join('')}
            </div>
          </div>
        ` : ''}
        <div style="display:flex;gap:8px;margin-top:14px;">
          <button id="fumocaAddToCart" style="flex:1;padding:12px;border-radius:14px;border:1px solid rgba(200,255,0,.3);background:rgba(200,255,0,.12);color:${accentColor};font-weight:700;font-size:13px;cursor:pointer;">Add to cart</button>
          ${ctaUrl ? `<a href="${_esc(ctaUrl)}" target="_blank" rel="noopener" id="fumocaBuyNow" style="flex:2;padding:12px;border-radius:14px;background:${accentColor};color:${_isDark(accentColor) ? '#fff' : '#000'};font-weight:700;font-size:13px;cursor:pointer;text-decoration:none;display:flex;align-items:center;justify-content:center;">${_esc(ctaLabel)}</a>` : ''}
        </div>
      </div>
    `;

    document.body.appendChild(card);

    // Wire close
    document.getElementById('fumocaProductClose')?.addEventListener('click', closeProductCard);

    // Wire add to cart
    document.getElementById('fumocaAddToCart')?.addEventListener('click', () => {
      addToCart({
        productId: hotspot.productId || hotspot.id,
        productLabel: hotspot.productLabel || hotspot.title,
        productPrice: hotspot.productPrice,
        productImage: hotspot.productImage,
        productUrl: ctaUrl,
        splatId: window._fumocaCurrentRecord?.id || '',
      });
      const btn = document.getElementById('fumocaAddToCart');
      if (btn) {
        btn.textContent = '✓ Added';
        btn.style.background = `rgba(0,255,200,.14)`;
        btn.style.color = 'var(--acid2,#00ffc8)';
        setTimeout(() => { if (btn) btn.textContent = 'Add to cart'; }, 1600);
      }
    });

    // Wire buy now analytics
    document.getElementById('fumocaBuyNow')?.addEventListener('click', () => {
      emit('fumoca:productBuyNow', { hotspot, splatId: window._fumocaCurrentRecord?.id });
    });

    // Variant select
    card.querySelectorAll('.fumocaVariantBtn').forEach(btn => {
      btn.addEventListener('click', () => {
        card.querySelectorAll('.fumocaVariantBtn').forEach(b => {
          b.style.borderColor = 'rgba(255,255,255,.14)';
          b.style.background = 'rgba(255,255,255,.06)';
          b.style.color = '#fff';
        });
        btn.style.borderColor = accentColor;
        btn.style.background = `${accentColor}22`;
        btn.style.color = accentColor;
      });
    });

    emit('fumoca:productCardOpened', { hotspot });
  }

  function closeProductCard() {
    document.getElementById('fumocaProductCard')?.remove();
    activeProductId = null;
  }

  // ── Cart panel ────────────────────────────────────────────────
  function openCartPanel() {
    document.getElementById('fumocaCartPanel')?.remove();
    loadCart();

    const panel = document.createElement('div');
    panel.id = 'fumocaCartPanel';
    panel.style.cssText = `
      position:fixed;right:16px;top:86px;z-index:20;
      width:min(400px,calc(100vw - 32px));max-height:calc(100vh - 110px);
      background:rgba(7,10,16,.94);border:1px solid rgba(255,255,255,.12);
      border-radius:24px;backdrop-filter:blur(22px);
      box-shadow:0 20px 70px rgba(0,0,0,.45);overflow:hidden;
      display:flex;flex-direction:column;
      animation:fumocaSlideDown .22s ease;
    `;

    const total = cart.reduce((s, i) => {
      const p = parseFloat(String(i.productPrice || '').replace(/[^0-9.]/g, ''));
      return s + (isNaN(p) ? 0 : p * (i.qty || 1));
    }, 0);

    panel.innerHTML = `
      <div style="padding:16px;border-bottom:1px solid rgba(255,255,255,.08);display:flex;justify-content:space-between;align-items:center;">
        <div style="font-family:var(--font-display);font-size:22px;color:var(--neon);letter-spacing:.05em;">CART (${getCartCount()})</div>
        <button id="fumocaCartClose" style="width:36px;height:36px;border-radius:999px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#fff;cursor:pointer;">✕</button>
      </div>
      <div id="fumocaCartItems" style="flex:1;overflow-y:auto;padding:12px 16px;">
        ${cart.length ? cart.map(item => `
          <div class="fumocaCartItem" data-id="${item.productId}" style="display:flex;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.06);">
            ${item.productImage ? `<img src="${_esc(item.productImage)}" style="width:52px;height:52px;object-fit:cover;border-radius:12px;">` : '<div style="width:52px;height:52px;border-radius:12px;background:rgba(255,255,255,.06);"></div>'}
            <div style="flex:1;min-width:0;">
              <div style="font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_esc(item.productLabel || 'Product')}</div>
              ${item.productPrice ? `<div style="font-size:12px;color:var(--neon);">${_esc(item.productPrice)}</div>` : ''}
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="font-size:12px;color:rgba(255,255,255,.55);">×${item.qty || 1}</span>
              <button class="fumocaCartRemove" data-id="${item.productId}" style="width:28px;height:28px;border-radius:999px;border:1px solid rgba(255,72,72,.28);background:rgba(255,72,72,.1);color:#ff6b6b;cursor:pointer;font-size:12px;">✕</button>
            </div>
          </div>
        `).join('') : '<div style="padding:24px 0;text-align:center;color:rgba(255,255,255,.35);font-size:13px;">No items in cart</div>'}
      </div>
      ${cart.length ? `
        <div style="padding:14px 16px;border-top:1px solid rgba(255,255,255,.08);">
          <div style="display:flex;justify-content:space-between;margin-bottom:12px;">
            <span style="font-weight:700;">Total</span>
            <span style="font-weight:700;color:var(--neon);">${total > 0 ? total.toFixed(2) : '—'}</span>
          </div>
          <button id="fumocaCheckout" style="width:100%;padding:13px;border-radius:14px;background:var(--neon);color:#000;font-weight:700;font-size:14px;cursor:pointer;border:none;">Checkout</button>
        </div>
      ` : ''}
    `;

    document.body.appendChild(panel);

    document.getElementById('fumocaCartClose')?.addEventListener('click', () => panel.remove());
    panel.querySelectorAll('.fumocaCartRemove').forEach(btn => {
      btn.addEventListener('click', () => {
        removeFromCart(btn.dataset.id);
        openCartPanel(); // re-render
      });
    });
    document.getElementById('fumocaCheckout')?.addEventListener('click', () => {
      emit('fumoca:checkout', { cart: [...cart], total });
      // If a checkout URL is configured, navigate there
      const checkoutUrl = window._fumocaWhiteLabel?.getBrandConfig?.()?.ctaUrl;
      if (checkoutUrl) window.open(checkoutUrl, '_blank', 'noopener');
    });
  }

  // ── Hook into hotspot system ──────────────────────────────────
  // When a hotspot of type 'product' or 'sponsor' is activated,
  // open our product card instead of the default info card.
  window.addEventListener('fumoca:hotspotOpened', (e) => {
    const h = e.detail;
    if (!h) return;
    if (h.type === 'product' || h.type === 'sponsor' || h.productId || h.productLabel) {
      openProductCard(h);
    }
  });

  // ── Animation keyframes ───────────────────────────────────────
  if (!document.getElementById('fumocaCommerceStyles')) {
    const style = document.createElement('style');
    style.id = 'fumocaCommerceStyles';
    style.textContent = `
      @keyframes fumocaSlideUp {
        from { transform: translateY(18px); opacity: 0; }
        to   { transform: translateY(0);    opacity: 1; }
      }
      @keyframes fumocaSlideDown {
        from { transform: translateY(-14px); opacity: 0; }
        to   { transform: translateY(0);     opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }

  // ── Utils ─────────────────────────────────────────────────────
  function _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function _isDark(color) {
    try {
      const hex = color.replace(/^var\(.*\)$/, '#c8ff00').replace('#','');
      const r = parseInt(hex.slice(0,2),16), g = parseInt(hex.slice(2,4),16), b = parseInt(hex.slice(4,6),16);
      return (r*299+g*587+b*114)/1000 < 128;
    } catch (_) { return false; }
  }

  loadCart();
  _updateCartBadge();

  return { addToCart, removeFromCart, openProductCard, closeProductCard, openCartPanel, getCart: () => [...cart] };
})();

window.FumocaCommerce = FumocaCommerce;
