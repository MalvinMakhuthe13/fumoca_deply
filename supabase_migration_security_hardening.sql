-- Migration: security hardening found during the 2026-11-25 QA/QC pass.
-- Safe to run more than once. Apply in the Supabase SQL editor.
--
-- 1. claim_next_job() is SECURITY DEFINER and picks the oldest queued job of
--    ANY user, marks it 'running' and returns its video path. It was granted to
--    every signed-in user, so any account could steal other users' jobs (and
--    read their private video paths) or stall the reconstruction queue.
--    Only the Kaggle/worker backend (service_role key) calls it.
revoke execute on function public.claim_next_job() from public;
revoke execute on function public.claim_next_job() from anon;
revoke execute on function public.claim_next_job() from authenticated;
grant execute on function public.claim_next_job() to service_role;

-- 2. Legacy public.orders: buyers could insert their own rows with any
--    status/amount (e.g. status = 'paid', amount_zar = 0). New rows created by
--    a buyer must start as an unpaid 'pending' order with no payment reference;
--    paid/fulfilled/refunded is set server-side only.
drop policy if exists "Users create orders" on public.orders;
create policy "Users create orders" on public.orders
  for insert
  with check (
    auth.uid() = buyer_id
    and status = 'pending'
    and payment_ref is null
    and amount_zar > 0
  );
