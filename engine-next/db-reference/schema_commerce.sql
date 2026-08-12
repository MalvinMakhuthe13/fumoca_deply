-- NIF Commerce Schema
-- Append to scripts/schema.sql or run separately in Supabase SQL Editor
-- fumoca.co.za · © Fumoca Technologies
--
-- Backs engine-next/backend-api/routes/commerce.js. Until this migration is
-- run, every route in that file will fail with a real Postgres "relation
-- does not exist" error — which is correct: per index.js's own rule
-- ("Every route is real... No fake data anywhere"), the API must not pretend
-- to persist products/orders against tables that don't exist yet.

-- ─── Products ──────────────────────────────────────────────────────────────────
-- A product is a shoppable hotspot's durable backing record. The hotspot
-- itself (position, label, productId) still lives in the NIF's hotspots —
-- this table is what makes price/stock/variants queryable and editable
-- without re-encoding the .nif, and what an order can safely reference by id
-- even after a hotspot is moved or deleted.

create table if not exists public.nif_products (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid references auth.users(id) on delete cascade not null,
  nif_id            uuid references public.nif_files(id) on delete cascade not null,
  hotspot_id        text,                                   -- matches the hotspot's own id in nif meta/hotspots, if any

  title             text not null default 'Untitled product',
  description       text,
  price_cents       int  not null default 0,
  currency          text not null default 'ZAR',
  image_url         text,
  external_url      text,                                   -- optional "buy on our store" link
  variants          jsonb not null default '[]',             -- [{label, priceDeltaCents, sku, stock}]
  sku               text,
  stock             int,                                     -- null = unlimited/untracked
  active            boolean not null default true,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists nif_products_user_idx on public.nif_products(user_id);
create index if not exists nif_products_nif_idx  on public.nif_products(nif_id);

drop trigger if exists nif_products_updated_at on public.nif_products;
create trigger nif_products_updated_at
  before update on public.nif_products
  for each row execute function public.set_updated_at();  -- reuses the fn from schema_presentations.sql

alter table public.nif_products enable row level security;

drop policy if exists "own products"    on public.nif_products;
drop policy if exists "public products" on public.nif_products;

create policy "own products"
  on public.nif_products for all
  using (auth.uid() = user_id);

-- Anyone viewing a NIF can read its active products (needed for the public
-- viewer's product card — it has no auth token in embed mode)
create policy "public products"
  on public.nif_products for select
  using (active = true);

-- ─── Orders ─────────────────────────────────────────────────────────────────────
-- One order per checkout. buyer_id is nullable — embed-mode checkout can
-- happen without a Fumoca account; merchant_id is the NIF owner who gets paid.

create table if not exists public.nif_orders (
  id             uuid primary key default uuid_generate_v4(),
  merchant_id    uuid references auth.users(id) not null,
  buyer_id       uuid references auth.users(id),
  buyer_email    text,
  nif_id         uuid references public.nif_files(id) on delete set null,

  status         text not null default 'pending_payment',  -- pending_payment | paid | fulfilled | cancelled | refunded
  currency       text not null default 'ZAR',
  subtotal_cents int  not null default 0,
  total_cents    int  not null default 0,

  -- Populated once a payment gateway is actually wired up (see commerce.js's
  -- POST /:id/capture — currently returns 501, not faked as success).
  payment_provider    text,
  payment_reference   text,

  meta           jsonb not null default '{}',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists nif_orders_merchant_idx on public.nif_orders(merchant_id);
create index if not exists nif_orders_buyer_idx     on public.nif_orders(buyer_id);
create index if not exists nif_orders_nif_idx       on public.nif_orders(nif_id);

drop trigger if exists nif_orders_updated_at on public.nif_orders;
create trigger nif_orders_updated_at
  before update on public.nif_orders
  for each row execute function public.set_updated_at();

alter table public.nif_orders enable row level security;

drop policy if exists "merchant reads own orders" on public.nif_orders;
drop policy if exists "buyer reads own orders"     on public.nif_orders;

create policy "merchant reads own orders"
  on public.nif_orders for all
  using (auth.uid() = merchant_id);

create policy "buyer reads own orders"
  on public.nif_orders for select
  using (auth.uid() = buyer_id);

-- ─── Order line items ────────────────────────────────────────────────────────────

create table if not exists public.nif_order_items (
  id            uuid primary key default uuid_generate_v4(),
  order_id      uuid references public.nif_orders(id) on delete cascade not null,
  product_id    uuid references public.nif_products(id) on delete set null,

  title_snapshot text not null,               -- product title at time of order (survives product edits/deletes)
  price_cents_snapshot int not null,
  variant_label text,
  qty           int not null default 1,

  created_at    timestamptz not null default now()
);

create index if not exists nif_order_items_order_idx on public.nif_order_items(order_id);

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

-- Inserts/updates to order_items are done by the API using supabaseAdmin
-- (service role, bypasses RLS) inside a single order-creation call — buyers
-- and merchants never write line items directly.
