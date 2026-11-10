-- =====================================================================
-- Hardware-POS: database fixes from the audit (AUDIT_FINDINGS.md)
--
-- HOW TO USE
--   * Nothing here runs automatically. Review, then run ONE STEP AT A TIME
--     in Supabase -> SQL Editor.
--   * Take a backup first (Database -> Backups, or export the tables).
--   * Steps marked "SAFE" only add things / fix data. Steps marked "REVIEW"
--     change security rules or remove data — read the notes first.
--   * The app already works with or without these changes (it falls back),
--     so they can be applied at a quiet time.
-- =====================================================================


-- ---------------------------------------------------------------------
-- STEP 1 (SAFE) — S1: give each expense a shop_id
-- The expenses table had no shop_id, so every shop's expenses were in one
-- pool and the app filtered them by a text note. The app now writes
-- shop_id automatically once this column exists.
-- ---------------------------------------------------------------------
alter table public.expenses
  add column if not exists shop_id uuid references public.shop_settings(id);

-- Backfill from the note the app used to write: 'shop:<shop id>'
update public.expenses e
set shop_id = substring(e.notes from 6)::uuid
where e.shop_id is null
  and e.notes ~ '^shop:[0-9a-fA-F-]{36}$';

-- Backfill from the staff member the expense was paid to
update public.expenses e
set shop_id = w.shop_id
from public.workers w
where e.shop_id is null
  and e.worker_id = w.id;

-- New rows get the current user's shop automatically (same as other tables)
alter table public.expenses
  alter column shop_id set default get_current_shop_id();

create index if not exists expenses_shop_id_created_at_idx
  on public.expenses (shop_id, created_at desc);

-- Check: expenses that still have no shop (should be 0 or very few)
-- select count(*) from public.expenses where shop_id is null;


-- ---------------------------------------------------------------------
-- STEP 2 (REVIEW) — S1: only let a shop see its own expenses
-- First check what rules exist today:
--   select policyname, cmd, qual, with_check from pg_policies
--   where schemaname = 'public' and tablename = 'expenses';
-- If there is no shop restriction, run the block below. Rows with no
-- shop_id (see the check in step 1) become invisible, so fix those first.
-- ---------------------------------------------------------------------
-- alter table public.expenses enable row level security;
--
-- create policy "expenses: own shop only"
--   on public.expenses
--   for all
--   using (shop_id = get_current_shop_id())
--   with check (shop_id = get_current_shop_id());


-- ---------------------------------------------------------------------
-- STEP 3 (REVIEW) — S2: remove stored owner passwords
-- shop_settings.owner_password is not used by the app (login uses Supabase
-- Auth). Staff devices load the shop_settings row, so anything stored here
-- is readable by staff. First see if it holds anything:
--   select id, shop_name, owner_password is not null as has_password
--   from public.shop_settings;
-- Then clear it, and drop the column once you're happy:
-- ---------------------------------------------------------------------
-- update public.shop_settings set owner_password = null where owner_password is not null;
-- alter table public.shop_settings drop column owner_password;


-- ---------------------------------------------------------------------
-- STEP 4 (SAFE) — tag old stock receipts so they never count as sales
-- Receipts made while the warehouse was disabled were saved with location
-- 'Store'. The app now tags new ones 'Warehouse-Inbound' when saving; this
-- fixes the old ones (it used to happen as a side effect of opening the
-- ledger). Preview first:
--   select count(*) from public.bills
--   where location = 'Store' and payment_method is null and total_amount = 0
--     and status <> 'voided';
-- ---------------------------------------------------------------------
update public.bills
set location = 'Warehouse-Inbound'
where location = 'Store'
  and payment_method is null
  and total_amount = 0
  and status <> 'voided';


-- ---------------------------------------------------------------------
-- STEP 5 (SAFE) — S7: save the "sound" setting for the whole shop
-- The Settings page saves sound on/off, but the column didn't exist, so it
-- only applied to one device and every Settings save failed once.
-- ---------------------------------------------------------------------
alter table public.shop_settings
  add column if not exists sound_enabled boolean default true;


-- ---------------------------------------------------------------------
-- NOT INCLUDED (need the function / policy definitions first)
--   A3  enforce prices and MSP inside process_pos_transaction_unsafe
--   C1/C2  staff vs owner permissions (RLS) and non-billable staff
--   C9  replace process_pos_transaction_unsafe
--   A2  save payment details in the same transaction as the bill
--   A11 sequential bill numbers
--   S3  link workers to auth.users so removed staff lose login access
-- Send the output of these queries to get those written:
--   select tablename, policyname, cmd, roles, qual, with_check
--     from pg_policies where schemaname = 'public';
--   select p.proname, pg_get_functiondef(p.oid)
--     from pg_proc p where p.pronamespace = 'public'::regnamespace;
-- =====================================================================
