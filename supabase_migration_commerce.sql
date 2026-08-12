-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: NIF Commerce (products, orders, order items + a real server-side
-- re-pricing RPC)
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THIS EXISTS:
-- js/modules/commerce.js's cart UI had zero backend — no product table, no
-- order table, nothing persisted anywhere. A real backend (products/orders
-- CRUD, server-side re-pricing) was already built in
-- engine-next/backend-api/routes/commerce.js, but that requires deploying a
-- separate Express server before it does anything — a real, meaningful
-- barrier, and until that's deployed it's not reachable from the live app at
-- all (see engine-next/ROADMAP.md: "nothing in engine-next is wired into the
-- live app yet").
--
-- This migration gets the SAME real guarantee — never trust a price the
-- browser sends, always re-price from the products table server-side —
-- without needing any server. create_order_from_cart() below is a Postgres
-- function (SECURITY DEFINER, same pattern as handle_new_user() already in
-- your schema and increment_embed_view() in supabase_migration_embeds.sql),
-- callable directly via supabase.rpc(...) from the browser — exactly how
-- js/modules/embed-manager.js already calls increment_embed_view. No Express,
-- no backend-api deployment, no separate service to keep running.
--
-- The engine-next/backend-api Express route still exists and still works if
-- you do deploy it later — this doesn't replace it, it gives you a path to
-- "live today" without waiting on that deployment.
--
-- Run this against your Supabase project (SQL Editor, or `supabase db push`
-- if you're using the CLI with migrations/).
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Products — a shoppable hotspot's durable backing record.
create table if not exists public.nif_products (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references auth.users(id) on delete cascade not null,
  nif_id            uuid references public.nif_files(id) on delete cascade not null,
  hotspot_id        text,

  title             text not null default 'Untitled product',
  description       text,
  price_cents       int  not null default 0,
  currency          text not null default 'ZAR',
  image_url         text,
  external_url      text,
  variants          jsonb not null default '[]',   -- [{label, priceDeltaCents, sku, stock}]
  sku               text,
  stock             int,
  active            boolean not null default true,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_nif_products_user on public.nif_products(user_id);
create index if not exists idx_nif_products_nif  on public.nif_products(nif_id);

alter table public.nif_products enable row level security;

drop policy if exists "own products"    on public.nif_products;
drop policy if exists "public products" on public.nif_products;

create policy "own products"
  on public.nif_products for all
  using (auth.uid() = user_id);

-- Anyone viewing a NIF can read its active products — needed for the public
-- viewer's product card, which has no auth token in embed mode.
create policy "public products"
  on public.nif_products for select
  using (active = true);

-- 2. Orders — one per checkout. buyer_id is nullable: embed-mode checkout can
--    happen without a Fumoca account.
create table if not exists public.nif_orders (
  id             uuid primary key default gen_random_uuid(),
  merchant_id    uuid references auth.users(id) not null,
  buyer_id       uuid references auth.users(id),
  buyer_email    text,
  nif_id         uuid references public.nif_files(id) on delete set null,

  status         text not null default 'pending_payment',  -- pending_payment | paid | fulfilled | cancelled | refunded
  currency       text not null default 'ZAR',
  subtotal_cents int  not null default 0,
  total_cents    int  not null default 0,

  payment_provider    text,
  payment_reference   text,

  meta           jsonb not null default '{}',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_nif_orders_merchant on public.nif_orders(merchant_id);
create index if not exists idx_nif_orders_buyer     on public.nif_orders(buyer_id);
create index if not exists idx_nif_orders_nif       on public.nif_orders(nif_id);

alter table public.nif_orders enable row level security;

drop policy if exists "merchant reads own orders" on public.nif_orders;
drop policy if exists "buyer reads own orders"     on public.nif_orders;

create policy "merchant reads own orders"
  on public.nif_orders for all
  using (auth.uid() = merchant_id);

create policy "buyer reads own orders"
  on public.nif_orders for select
  using (auth.uid() = buyer_id);

-- 3. Order line items.
create table if not exists public.nif_order_items (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid references public.nif_orders(id) on delete cascade not null,
  product_id    uuid references public.nif_products(id) on delete set null,

  title_snapshot text not null,
  price_cents_snapshot int not null,
  variant_label text,
  qty           int not null default 1,

  created_at    timestamptz not null default now()
);

create index if not exists idx_nif_order_items_order on public.nif_order_items(order_id);

alter table public.nif_order_items enable row level security;

drop policy if exists "order items via parent order" on public.nif_order_items;
create policy "order items via parent order"
  on public.nif_order_items for select
  using (
    exists (
      select 1 from public.nif_orders o
      where o.id = order_id
        and (o.merchant_id = auth.uid() or o.buyer_id = auth.uid())
    )
  );

-- 4. create_order_from_cart RPC — the real re-pricing guarantee. Takes a
--    cart shape ([{productId, qty, variantLabel}]), looks up every price
--    from nif_products itself (never trusts a price the caller sends), and
--    inserts the order + line items atomically. SECURITY DEFINER so it can
--    write nif_orders/nif_order_items on the caller's behalf while RLS still
--    protects direct table access for everything else.
create or replace function public.create_order_from_cart(
  p_nif_id uuid,
  p_items jsonb,
  p_buyer_email text default null
)
returns table (order_id uuid, subtotal_cents int, currency text)
language plpgsql
security definer
as $function$
declare
  v_merchant_id uuid;
  v_buyer_id    uuid := auth.uid();
  v_order_id    uuid := gen_random_uuid();
  v_subtotal    int  := 0;
  v_currency    text := 'ZAR';
  v_item        jsonb;
  v_product     record;
  v_price       int;
  v_qty         int;
  v_delta       int;
begin
  select user_id into v_merchant_id from public.nif_files where id = p_nif_id;
  if v_merchant_id is null then
    raise exception 'NIF not found';
  end if;

  insert into public.nif_orders (id, merchant_id, buyer_id, buyer_email, nif_id, status, currency, subtotal_cents, total_cents)
  values (v_order_id, v_merchant_id, v_buyer_id, p_buyer_email, p_nif_id, 'pending_payment', v_currency, 0, 0);

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select * into v_product from public.nif_products
      where id = (v_item->>'productId')::uuid and active = true;
    if v_product.id is null then
      continue; -- skip unknown/inactive — one stale cart line shouldn't fail the whole order
    end if;

    v_qty := coalesce((v_item->>'qty')::int, 1);
    if v_qty < 1 then v_qty := 1; end if;

    v_price := v_product.price_cents;
    if v_item->>'variantLabel' is not null then
      select coalesce((variant->>'priceDeltaCents')::int, 0) into v_delta
        from jsonb_array_elements(v_product.variants) variant
        where variant->>'label' = v_item->>'variantLabel'
        limit 1;
      v_price := v_product.price_cents + coalesce(v_delta, 0);
    end if;

    insert into public.nif_order_items (order_id, product_id, title_snapshot, price_cents_snapshot, variant_label, qty)
    values (v_order_id, v_product.id, v_product.title, v_price, v_item->>'variantLabel', v_qty);

    v_subtotal := v_subtotal + (v_price * v_qty);
    v_currency := v_product.currency;
  end loop;

  if v_subtotal = 0 then
    delete from public.nif_orders where id = v_order_id;
    raise exception 'No valid, active products in cart';
  end if;

  update public.nif_orders set subtotal_cents = v_subtotal, total_cents = v_subtotal, currency = v_currency
    where id = v_order_id;

  return query select v_order_id, v_subtotal, v_currency;
end;
$function$;

-- Must be callable by anonymous visitors too — embed-mode checkout on a
-- third-party site may have no Fumoca account at all, same reasoning as
-- increment_embed_view's grant in supabase_migration_embeds.sql.
grant execute on function public.create_order_from_cart(uuid, jsonb, text) to anon, authenticated;
