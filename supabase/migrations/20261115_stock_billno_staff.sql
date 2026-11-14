-- =====================================================================
-- Hardware-POS: sell only the stock you have · running bill numbers ·
-- removing staff removes their login
-- Paste this whole file into Supabase -> SQL Editor and click Run.
-- One transaction (all or nothing); safe to run again.
-- =====================================================================
begin;

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'pos_process_sale' and pronamespace = 'public'::regnamespace) then
    raise exception 'Run 20261111_atomic_actions.sql and 20261111_audit_completeness.sql first. Nothing was changed.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Running bill numbers per shop (1, 2, 3, ...)
-- ---------------------------------------------------------------------
alter table public.bills add column if not exists bill_no bigint;

create table if not exists public.pos_bill_counters (
  shop_id uuid primary key,
  last_no bigint not null default 0
);
alter table public.pos_bill_counters enable row level security;
revoke all on public.pos_bill_counters from public, anon, authenticated;

-- Number existing sales once, oldest first, so new bills continue the sequence
-- (fully returned bills keep their number, as an invoice series should).
with numbered as (
  select id, shop_id,
         coalesce((select max(bill_no) from public.bills x where x.shop_id = b.shop_id), 0)
           + row_number() over (partition by shop_id order by created_at, id) as n
    from public.bills b
   where bill_no is null
     and location = 'Store'
     and coalesce(payment_method, '') <> 'SHOWROOM'
     and coalesce(status, '') not in ('showroom', 'showroom_pending')
)
update public.bills b set bill_no = numbered.n
  from numbered where b.id = numbered.id;

insert into public.pos_bill_counters (shop_id, last_no)
select shop_id, max(bill_no) from public.bills where bill_no is not null and shop_id is not null group by shop_id
on conflict (shop_id) do update set last_no = greatest(public.pos_bill_counters.last_no, excluded.last_no);

create unique index if not exists bills_shop_bill_no_key on public.bills (shop_id, bill_no) where bill_no is not null;

-- ---------------------------------------------------------------------
-- 2. Sale function: only sell what the batch has (locked, so two counters can't both
--    sell the last pieces) + bill number
-- ---------------------------------------------------------------------
create or replace function public.pos_process_sale(
  p_action text,
  p_location text,
  p_cashier_name text,
  p_items jsonb,
  p_payment_method text default null,
  p_cash_amount numeric default 0,
  p_upi_amount numeric default 0,
  p_total_amount numeric default null,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_screw_price numeric default null,
  p_client_ref text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop uuid := get_current_shop_id();
  v_existing uuid;
  v_result json;
  v_bill uuid;
  v_item jsonb;
  v_msp numeric;
  v_price numeric;
  v_is_showroom boolean := (p_payment_method = 'SHOWROOM');
  v_total numeric;
  v_listed numeric;
  v_lines int;
  v_disc numeric;
  v_pay text;
  v_need record;
  v_batch public.inventory_batches%rowtype;
  v_no_warehouse boolean;
  v_move numeric;
  v_bill_no bigint;
begin
  if v_shop is null then
    raise exception 'Unable to determine shop_id. Are you logged in?';
  end if;

  -- Non-billable (helper) staff cannot bill customers
  if p_action = 'SALE' and exists (
    select 1 from public.workers where id = auth.uid() and password like '%NON_BILLABLE%'
  ) then
    raise exception 'This staff account is not allowed to bill customers.';
  end if;

  -- Same checkout sent twice (retry after a dropped connection): return the first bill
  if p_client_ref is not null then
    perform pg_advisory_xact_lock(hashtext(v_shop::text || ':' || p_client_ref));
    select id into v_existing from public.bills where shop_id = v_shop and client_ref = p_client_ref limit 1;
    if v_existing is not null then
      select bill_no into v_bill_no from public.bills where id = v_existing;
      return json_build_object('success', true, 'bill_id', v_existing, 'bill_no', v_bill_no, 'duplicate', true);
    end if;
  end if;

  -- Never sell below the batch MSP (showroom dispatch is not a sale)
  if p_action = 'SALE' and not v_is_showroom then
    for v_item in select * from jsonb_array_elements(p_items) loop
      v_msp := null;
      select msp into v_msp from public.inventory_batches
       where shop_id = v_shop and batch_id = nullif(v_item->>'batch_id', '')::uuid;
      v_price := coalesce((v_item->>'final_price')::numeric, 0);
      if coalesce(v_msp, 0) > 0 and v_price < v_msp - 0.01 then
        raise exception 'Cannot sell % below MSP (price %, MSP %).', v_item->>'name', v_price, v_msp;
      end if;
    end loop;
  end if;

  -- Only sell stock the store has. Each batch is locked, so two counters can never sell the
  -- same last pieces. Shops without a warehouse count any stock left on a batch's warehouse
  -- side as store stock (it is moved across first, as the app's self-repair does).
  if p_action = 'SALE' then
    select coalesce((to_jsonb(s) ->> 'disable_warehouse')::boolean, false) into v_no_warehouse
      from public.shop_settings s where s.id = v_shop;
    for v_need in
      select nullif(it->>'batch_id', '')::uuid as batch_id,
             max(it->>'name') as name,
             sum(coalesce((it->>'actual_quantity')::numeric, 0)) as qty
        from jsonb_array_elements(p_items) it
       where nullif(it->>'batch_id', '') is not null
       group by 1
    loop
      select * into v_batch from public.inventory_batches
       where shop_id = v_shop and batch_id = v_need.batch_id
       for update;
      if not found then
        raise exception 'Not enough stock: % is no longer available. Refresh and try again.', v_need.name;
      end if;
      if coalesce(v_no_warehouse, false) and v_batch.stock_store < v_need.qty and v_batch.stock_warehouse > 0 then
        v_move := least(v_batch.stock_warehouse, v_need.qty - v_batch.stock_store);
        update public.inventory_batches
           set stock_store = stock_store + v_move, stock_warehouse = stock_warehouse - v_move
         where shop_id = v_shop and batch_id = v_need.batch_id;
        v_batch.stock_store := v_batch.stock_store + v_move;
      end if;
      if v_batch.stock_store < v_need.qty - 0.0001 then
        raise exception 'Not enough stock: only % of % left. Reduce the quantity and try again.',
          trim(to_char(greatest(v_batch.stock_store, 0), 'FM999999990.##')), v_need.name;
      end if;
    end loop;
  end if;

  -- item lines of a showroom dispatch are logged as SHOWROOM, not SALE
  perform set_config('pos.audit_sale_action', case when v_is_showroom then 'SHOWROOM' else 'SALE' end, true);
  v_result := public.process_pos_transaction_unsafe(p_action, p_location, p_cashier_name, p_items);
  perform set_config('pos.audit_sale_action', '', true);
  v_bill := (v_result->>'bill_id')::uuid;

  update public.bills set
    client_ref     = p_client_ref,
    payment_method = case when p_action = 'SALE' then p_payment_method else null end,
    cash_amount    = coalesce(p_cash_amount, 0),
    upi_amount     = coalesce(p_upi_amount, 0),
    total_amount   = case when p_action = 'SALE' and p_total_amount is not null then p_total_amount else total_amount end,
    customer_name  = coalesce(p_customer_name, customer_name),
    customer_phone = coalesce(p_customer_phone, customer_phone),
    status         = case when v_is_showroom then 'showroom_pending' else status end,
    location       = case when p_action = 'RECEIVE' and p_location = 'Store' then 'Warehouse-Inbound' else location end
  where id = v_bill and shop_id = v_shop;

  if p_action = 'SALE' and p_screw_price is not null then
    insert into public.bill_items (
      bill_id, shop_id, barcode, name, quantity, billable_quantity, actual_quantity,
      price_at_sale, system_price, profit, unit
    ) values (
      v_bill, v_shop, 'SCREWS', 'Screws', 1, 1, 1,
      p_screw_price, p_screw_price, p_screw_price, 'SET'
    );
  end if;

  -- Running bill number per shop for sales (not showroom dispatches). Same transaction as the
  -- sale, so a failed sale never uses up a number: no gaps.
  if p_action = 'SALE' and not v_is_showroom then
    insert into public.pos_bill_counters as c (shop_id, last_no) values (v_shop, 1)
    on conflict (shop_id) do update set last_no = c.last_no + 1
    returning last_no into v_bill_no;
    update public.bills set bill_no = v_bill_no where id = v_bill and shop_id = v_shop;
  end if;

  -- One summary line per bill / dispatch in the audit log: total, payment, discount, customer
  if p_action = 'SALE' then
    select total_amount into v_total from public.bills where id = v_bill and shop_id = v_shop;
    select coalesce(sum(coalesce(system_price, price_at_sale, 0) * coalesce(billable_quantity, quantity, 0)), 0),
           count(*) filter (where barcode is distinct from 'SCREWS')
      into v_listed, v_lines
      from public.bill_items where bill_id = v_bill and shop_id = v_shop;
    v_disc := greatest(0, round(coalesce(v_listed, 0) - coalesce(v_total, 0), 2));
    v_pay := case
      when v_is_showroom then 'not a sale'
      when p_payment_method = 'SPLIT' then format('UPI ₹%s + Cash ₹%s', to_char(coalesce(p_upi_amount, 0), 'FM99,99,99,990.00'), to_char(coalesce(p_cash_amount, 0), 'FM99,99,99,990.00'))
      else coalesce(p_payment_method, '—') end;
    insert into public.audit_logs (shop_id, action_type, barcode, item_name, changes, performed_by)
    values (
      v_shop,
      case when v_is_showroom then 'SHOWROOM' else 'BILL' end,
      '---',
      case when v_is_showroom then 'Showroom dispatch #' else 'Bill #' end || coalesce(v_bill_no::text, left(v_bill::text, 8)),
      case when v_is_showroom
        then format('Sent %s item(s) to the showroom · value ₹%s%s',
                    v_lines, to_char(coalesce(v_total, 0), 'FM99,99,99,990.00'),
                    case when coalesce(p_customer_name, p_customer_phone) is not null
                         then ' · ' || concat_ws(' ', p_customer_name, p_customer_phone) else '' end)
        else format('Bill ₹%s · %s · %s item(s)%s%s',
                    to_char(coalesce(v_total, 0), 'FM99,99,99,990.00'), v_pay, v_lines,
                    case when v_disc > 0.009 then format(' · discount ₹%s', to_char(v_disc, 'FM99,99,99,990.00')) else '' end,
                    case when coalesce(p_customer_name, p_customer_phone) is not null
                         then ' · customer ' || concat_ws(' ', p_customer_name, p_customer_phone) else '' end)
      end,
      p_cashier_name
    );
  end if;

  return json_build_object('success', true, 'bill_id', v_bill, 'bill_no', v_bill_no);
end;
$$;

grant execute on function public.pos_process_sale(text, text, text, jsonb, text, numeric, numeric, numeric, text, text, numeric, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Removing a staff member also deletes their login (owner only)
-- ---------------------------------------------------------------------
create or replace function public.pos_remove_worker(p_worker_id uuid)
returns json
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_shop uuid := public.get_current_shop_id();
  v_name text;
begin
  if v_shop is null or not coalesce(public.pos_is_shop_owner(), false) then
    raise exception 'Only the shop owner can remove staff.';
  end if;
  select name into v_name from public.workers where id = p_worker_id and shop_id = v_shop;
  if not found then
    raise exception 'This staff member was not found in your shop.';
  end if;
  delete from public.workers where id = p_worker_id and shop_id = v_shop;
  -- their sign-in account (sessions and identities go with it)
  delete from auth.users where id = p_worker_id;
  return json_build_object('success', true, 'name', v_name);
end;
$$;
revoke execute on function public.pos_remove_worker(uuid) from public, anon;
grant execute on function public.pos_remove_worker(uuid) to authenticated;

commit;
