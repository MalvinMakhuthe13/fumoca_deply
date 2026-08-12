/**
 * NIF Commerce API Routes
 * fumoca.co.za · © Fumoca Technologies
 *
 * Backs js/modules/commerce.js's product card / cart UI with a real,
 * persisted backend. Requires engine-next/db-reference/schema_commerce.sql
 * to have been run against the target Supabase project — every route below
 * will 500 with a genuine Postgres error until then, which is correct: we
 * don't fake success against tables that don't exist.
 *
 * Mount into the main API with:
 *   import commerceRoutes from './routes/commerce.js';
 *   app.use(commerceRoutes);
 *
 * Routes:
 *   GET    /api/commerce/products              list products (?nifId=, mine-only unless ?nifId is public)
 *   POST   /api/commerce/products               create a product on one of your own NIFs
 *   PATCH  /api/commerce/products/:id           update your own product
 *   DELETE /api/commerce/products/:id           delete your own product
 *
 *   POST   /api/commerce/orders                 create an order from a cart (status: pending_payment)
 *   GET    /api/commerce/orders                 list orders you're the merchant OR buyer on
 *   GET    /api/commerce/orders/:id              get one order + its line items
 *   POST   /api/commerce/orders/:id/capture      501 — no payment gateway wired up yet, see note below
 *
 * What this deliberately does NOT do:
 *   Actually charge a card. There is no Stripe/PayFast/Paystack integration
 *   in this codebase yet. An order is a real, persisted row with a real id —
 *   useful today for "merchant sees a lead / manual-invoice workflow" — but
 *   /capture returns 501 rather than pretending a payment succeeded. Wiring
 *   a real gateway is a separate, scoped piece of work (webhook signature
 *   verification, idempotency keys, currency-specific fee handling) that
 *   deserves its own pass, not a stub bolted on here.
 */

import express from 'express';
import { supabaseAdmin, Auth } from '../supabase.js';

const router = express.Router();

// ── Auth middleware (same pattern as presentations.js/index.js) ──────────────
async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authorization required' });
  const { data: { user }, error } = await Auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid token' });
  req.user = user;
  next();
}

// Optional auth — embed-mode checkout / public product listing has no token
async function optionalAuth(req, _res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    const { data: { user } } = await Auth.getUser(token);
    if (user) req.user = user;
  }
  next();
}

// ── Products ──────────────────────────────────────────────────────────────────

// List products. If ?nifId is given and the caller isn't its owner, only
// active products are returned (this is what the public viewer's product
// card uses — RLS backs this up too, this check just gives a clean 403
// instead of a confusing empty list for a private/inactive NIF).
router.get('/api/commerce/products', optionalAuth, async (req, res) => {
  const { nifId } = req.query;
  if (!nifId) return res.status(400).json({ error: 'nifId query param required' });

  let q = supabaseAdmin.from('nif_products').select('*').eq('nif_id', nifId);
  const { data: file } = await supabaseAdmin.from('nif_files').select('user_id').eq('id', nifId).single();
  const isOwner = file && req.user && file.user_id === req.user.id;
  if (!isOwner) q = q.eq('active', true);

  const { data, error } = await q.order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ products: data });
});

router.post('/api/commerce/products', requireAuth, async (req, res) => {
  const { nifId, title, description, priceCents, currency, imageUrl, externalUrl, variants, sku, stock, hotspotId } = req.body;
  if (!nifId || !title) return res.status(400).json({ error: 'nifId and title are required' });

  // Confirm the caller actually owns the NIF they're attaching a product to
  const { data: file, error: fileErr } = await supabaseAdmin
    .from('nif_files').select('id, user_id').eq('id', nifId).single();
  if (fileErr || !file) return res.status(404).json({ error: 'NIF not found' });
  if (file.user_id !== req.user.id) return res.status(403).json({ error: 'You do not own this NIF' });

  const { data, error } = await supabaseAdmin.from('nif_products').insert({
    user_id:      req.user.id,
    nif_id:       nifId,
    hotspot_id:   hotspotId ?? null,
    title,
    description:  description ?? null,
    price_cents:  Number.isFinite(priceCents) ? priceCents : 0,
    currency:     currency ?? 'ZAR',
    image_url:    imageUrl ?? null,
    external_url: externalUrl ?? null,
    variants:     Array.isArray(variants) ? variants : [],
    sku:          sku ?? null,
    stock:        Number.isFinite(stock) ? stock : null,
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ product: data });
});

router.patch('/api/commerce/products/:id', requireAuth, async (req, res) => {
  const allowed = ['title', 'description', 'priceCents', 'currency', 'imageUrl', 'externalUrl', 'variants', 'sku', 'stock', 'active'];
  const toColumn = { priceCents: 'price_cents', imageUrl: 'image_url', externalUrl: 'external_url' };
  const patch = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) patch[toColumn[key] ?? key] = req.body[key];
  }
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No updatable fields provided' });

  const { data, error } = await supabaseAdmin
    .from('nif_products').update(patch)
    .eq('id', req.params.id).eq('user_id', req.user.id) // RLS backs this up; explicit filter gives a clean 404 vs opaque empty result
    .select().single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Product not found or not yours' });
  res.json({ product: data });
});

router.delete('/api/commerce/products/:id', requireAuth, async (req, res) => {
  const { error, count } = await supabaseAdmin
    .from('nif_products').delete({ count: 'exact' })
    .eq('id', req.params.id).eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  if (!count) return res.status(404).json({ error: 'Product not found or not yours' });
  res.status(204).end();
});

// ── Orders ────────────────────────────────────────────────────────────────────

// Create an order from a cart (mirrors js/modules/commerce.js's cart shape:
// [{productId, qty}]). Re-prices server-side from nif_products — never
// trusts a price the client sends, since that client is an embed on a
// third-party site.
router.post('/api/commerce/orders', optionalAuth, async (req, res) => {
  const { nifId, items, buyerEmail } = req.body;
  if (!nifId || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'nifId and a non-empty items array are required' });
  }

  const { data: file, error: fileErr } = await supabaseAdmin
    .from('nif_files').select('id, user_id').eq('id', nifId).single();
  if (fileErr || !file) return res.status(404).json({ error: 'NIF not found' });

  const productIds = items.map(i => i.productId).filter(Boolean);
  const { data: products, error: prodErr } = await supabaseAdmin
    .from('nif_products').select('*').in('id', productIds).eq('active', true);
  if (prodErr) return res.status(500).json({ error: prodErr.message });

  const byId = new Map(products.map(p => [p.id, p]));
  const lineItems = [];
  let subtotalCents = 0;

  for (const item of items) {
    const product = byId.get(item.productId);
    if (!product) continue; // silently skip unknown/inactive — don't fail the whole order over one stale cart line
    const qty = Math.max(1, parseInt(item.qty, 10) || 1);
    const variant = (product.variants || []).find(v => v.label === item.variantLabel);
    const priceCents = product.price_cents + (variant?.priceDeltaCents ?? 0);
    subtotalCents += priceCents * qty;
    lineItems.push({
      product_id: product.id,
      title_snapshot: product.title,
      price_cents_snapshot: priceCents,
      variant_label: item.variantLabel ?? null,
      qty,
    });
  }

  if (lineItems.length === 0) return res.status(400).json({ error: 'No valid, active products in cart' });

  const { data: order, error: orderErr } = await supabaseAdmin.from('nif_orders').insert({
    merchant_id: file.user_id,
    buyer_id: req.user?.id ?? null,
    buyer_email: buyerEmail ?? req.user?.email ?? null,
    nif_id: nifId,
    subtotal_cents: subtotalCents,
    total_cents: subtotalCents, // no tax/shipping model yet — flagged, not hidden
    currency: products[0]?.currency ?? 'ZAR',
  }).select().single();
  if (orderErr) return res.status(500).json({ error: orderErr.message });

  const { error: itemsErr } = await supabaseAdmin
    .from('nif_order_items').insert(lineItems.map(li => ({ ...li, order_id: order.id })));
  if (itemsErr) {
    // Best-effort cleanup so we don't leave an empty order row behind
    await supabaseAdmin.from('nif_orders').delete().eq('id', order.id);
    return res.status(500).json({ error: itemsErr.message });
  }

  res.status(201).json({ order, items: lineItems });
});

router.get('/api/commerce/orders', requireAuth, async (req, res) => {
  const { role = 'merchant', limit = 20, page = 0 } = req.query;
  const col = role === 'buyer' ? 'buyer_id' : 'merchant_id';
  const { data, error } = await supabaseAdmin
    .from('nif_orders').select('*').eq(col, req.user.id)
    .order('created_at', { ascending: false })
    .range(page * limit, page * limit + parseInt(limit) - 1);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ orders: data });
});

router.get('/api/commerce/orders/:id', requireAuth, async (req, res) => {
  const { data: order, error } = await supabaseAdmin
    .from('nif_orders').select('*').eq('id', req.params.id).single();
  if (error || !order) return res.status(404).json({ error: 'Order not found' });
  if (order.merchant_id !== req.user.id && order.buyer_id !== req.user.id) {
    return res.status(403).json({ error: 'Not your order' });
  }
  const { data: items } = await supabaseAdmin
    .from('nif_order_items').select('*').eq('order_id', order.id);
  res.json({ order, items: items ?? [] });
});

// Honest 501 — see file header note. Returning 200 here without a real
// gateway would be the exact "fake data" this API's index.js explicitly
// says never to ship.
router.post('/api/commerce/orders/:id/capture', requireAuth, async (_req, res) => {
  res.status(501).json({
    error: 'Payment capture is not implemented yet — no payment gateway (Stripe/PayFast/Paystack) is wired up. ' +
           'The order was created and is visible to the merchant as pending_payment; capture it manually for now.',
  });
});

export default router;
