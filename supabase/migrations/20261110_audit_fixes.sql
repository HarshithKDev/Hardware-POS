-- =====================================================================
-- Hardware-POS: database fixes from the audit
-- Paste this whole file into Supabase -> SQL Editor and click Run.
-- It runs as one transaction (all or nothing) and is safe to run again.
-- =====================================================================
begin;

-- 1. Expenses belong to a shop (previously all shops shared one pool)
alter table public.expenses
  add column if not exists shop_id uuid references public.shop_settings(id);

-- fill shop_id for existing expenses from the note the app wrote ('shop:<id>')
update public.expenses e
set shop_id = substring(e.notes from 6)::uuid
where e.shop_id is null
  and e.notes ~ '^shop:[0-9a-fA-F-]{36}$';

-- ...or from the staff member the expense was paid to
update public.expenses e
set shop_id = w.shop_id
from public.workers w
where e.shop_id is null
  and e.worker_id = w.id;

-- new expenses get the logged-in user's shop automatically
alter table public.expenses
  alter column shop_id set default get_current_shop_id();

create index if not exists expenses_shop_id_created_at_idx
  on public.expenses (shop_id, created_at desc);

-- 2. Each shop sees only its own expenses.
--    Only added if the expenses table has no access rules yet, so existing
--    rules are never changed.
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'expenses'
  ) then
    alter table public.expenses enable row level security;
    create policy "expenses_own_shop" on public.expenses
      for all to authenticated
      using (shop_id = get_current_shop_id())
      with check (shop_id = get_current_shop_id());
  else
    raise notice 'expenses already has access rules - left unchanged';
  end if;
end $$;

-- 3. Remove stored owner passwords (not used by the app; login uses Supabase Auth,
--    and staff devices can read this table). The column itself is kept.
update public.shop_settings
set owner_password = null
where owner_password is not null;

-- 4. Old stock receipts saved as 'Store' bills -> mark them as receipts so they
--    never count as sales
update public.bills
set location = 'Warehouse-Inbound'
where location = 'Store'
  and payment_method is null
  and total_amount = 0
  and status <> 'voided';

-- 5. Save the sound on/off setting for the whole shop
alter table public.shop_settings
  add column if not exists sound_enabled boolean default true;

commit;

-- =====================================================================
-- Not included (needs your existing access rules and functions first):
-- server-side price/MSP checks, staff vs owner permissions, sequential bill
-- numbers, revoking removed staff logins.
-- =====================================================================
