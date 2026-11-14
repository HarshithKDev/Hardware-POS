-- =====================================================================
-- Hardware-POS: correct profit after partial returns
-- Paste this whole file into Supabase -> SQL Editor and click Run.
-- One transaction (all or nothing); safe to run again.
--
-- Problem: returning PART of a bill line (e.g. 2 of 5 pipes) reduced the line's
-- quantity but kept its full cost and profit, so the dashboard's Profit (and the
-- bill's total profit) still included the returned items.
--
-- 1. pos_return_items now shrinks the line's cost and profit with its quantity and
--    takes the returned profit off the bill.
-- 2. Lines already affected are corrected once. A line is only changed when its
--    numbers prove it: its stored profit must equal exactly what the ORIGINAL
--    quantity (current + returned) would give, and it must be the only line of
--    that item on the bill. Everything else is left untouched.
-- =====================================================================
begin;

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'pos_return_items' and pronamespace = 'public'::regnamespace) then
    raise exception 'Run 20261111_atomic_actions.sql first. Nothing was changed.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Returns: cost and profit follow the quantity
-- ---------------------------------------------------------------------
create or replace function public.pos_return_items(
  p_bill_id uuid,
  p_items jsonb,
  p_void_all boolean default false,
  p_performed_by text default 'Staff'
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop uuid := get_current_shop_id();
  v_bill public.bills%rowtype;
  v_it jsonb;
  v_bi public.bill_items%rowtype;
  v_qty numeric;
  v_line_qty numeric;
  v_batch uuid;
  v_refund numeric := 0;
  v_new_total numeric;
  v_cash numeric;
  v_upi numeric;
  v_cash_refund numeric;
  v_return_id uuid;
  v_old_actual numeric;
  v_new_cost numeric;
  v_new_profit numeric;
  v_profit_removed numeric := 0;
  v_short text := split_part(p_bill_id::text, '-', 1);
begin
  if v_shop is null then
    raise exception 'Unable to determine shop_id. Are you logged in?';
  end if;

  select * into v_bill from public.bills where id = p_bill_id and shop_id = v_shop for update;
  if not found then raise exception 'Bill not found.'; end if;
  if v_bill.status = 'voided' then raise exception 'This bill has already been fully returned.'; end if;

  insert into public.returns (shop_id, original_bill_id, cashier_name, authorized_by, reason, refund_method, refund_amount)
  values (v_shop, p_bill_id, coalesce(p_performed_by, 'Staff'), coalesce(p_performed_by, 'Staff'),
          case when p_void_all then 'Full bill void' else 'Item return' end,
          case when v_bill.payment_method = 'UPI' then 'UPI' else 'CASH' end, 0)
  returning id into v_return_id;

  for v_it in select * from jsonb_array_elements(p_items) loop
    select * into v_bi from public.bill_items
     where id = (v_it->>'bill_item_id')::uuid and bill_id = p_bill_id
     for update;
    if not found then raise exception 'A bill line was not found (it may already be returned).'; end if;

    v_qty := coalesce((v_it->>'quantity')::numeric, 0);
    v_line_qty := coalesce(nullif(v_bi.billable_quantity, 0), v_bi.quantity);
    if v_qty <= 0 or v_qty > v_line_qty + 0.0001 then
      raise exception 'Invalid return quantity for %.', v_bi.name;
    end if;

    -- Stock back to the store (same batch it was sold from)
    v_batch := v_bi.batch_id;
    if v_batch is null then
      select batch_id into v_batch from public.inventory_batches
       where shop_id = v_shop and barcode = v_bi.barcode
       order by created_at limit 1;
    end if;
    if v_batch is not null then
      update public.inventory_batches set stock_store = stock_store + v_qty
       where shop_id = v_shop and batch_id = v_batch;
    end if;

    v_refund := v_refund + coalesce(v_bi.price_at_sale, 0) * v_qty;

    insert into public.return_items (return_id, barcode, batch_id, name, quantity, price_at_sale, unit)
    values (v_return_id, v_bi.barcode, v_batch, v_bi.name, v_qty, coalesce(v_bi.price_at_sale, 0), coalesce(v_bi.unit, 'PCS'));

    if not p_void_all then
      if v_qty >= v_line_qty - 0.0001 then
        v_profit_removed := v_profit_removed + coalesce(v_bi.profit, 0);
        delete from public.bill_items where id = v_bi.id;
      else
        -- The line's cost and profit shrink with its quantity (they used to stay at the
        -- full-line amounts, so profit reports kept the profit of returned items)
        v_old_actual := coalesce(nullif(v_bi.actual_quantity, 0), v_bi.quantity);
        v_new_cost := case
          when v_bi.cost_allocated is null then null
          when v_old_actual > 0 then v_bi.cost_allocated * greatest(v_old_actual - v_qty, 0) / v_old_actual
          else v_bi.cost_allocated end;
        v_new_profit := case
          when v_bi.profit is null then null
          else coalesce(v_bi.price_at_sale, 0) * (v_line_qty - v_qty) - coalesce(v_new_cost, 0) end;
        v_profit_removed := v_profit_removed + coalesce(v_bi.profit, 0) - coalesce(v_new_profit, 0);
        update public.bill_items set
          quantity = v_line_qty - v_qty,
          billable_quantity = v_line_qty - v_qty,
          actual_quantity = v_old_actual - v_qty,
          cost_allocated = v_new_cost,
          profit = v_new_profit
        where id = v_bi.id;
      end if;
    end if;

    insert into public.audit_logs (shop_id, action_type, barcode, item_name, changes, performed_by)
    values (v_shop, case when p_void_all then 'VOID' else 'RETURN' end, v_bi.barcode, v_bi.name,
            case when p_void_all
                 then format('Restored %s %s (Bill #%s)', v_qty, coalesce(v_bi.unit, ''), v_short)
                 else format('Returned %s %s of %s from Bill #%s', v_qty, coalesce(v_bi.unit, ''), v_bi.name, v_short) end,
            coalesce(p_performed_by, 'Staff'));
  end loop;

  update public.returns set refund_amount = v_refund where id = v_return_id;

  if p_void_all then
    update public.bills set status = 'voided' where id = p_bill_id;
  else
    v_new_total := greatest(0, coalesce(v_bill.total_amount, 0) - v_refund);
    v_cash := coalesce(v_bill.cash_amount, 0);
    v_upi := coalesce(v_bill.upi_amount, 0);
    if v_bill.payment_method = 'CASH' then
      v_cash := v_new_total;
    elsif v_bill.payment_method = 'UPI' then
      v_upi := v_new_total;
    elsif v_bill.payment_method = 'SPLIT' then
      v_cash_refund := least(v_cash, v_refund);
      v_cash := v_cash - v_cash_refund;
      v_upi := greatest(0, v_upi - (v_refund - v_cash_refund));
    end if;
    update public.bills set
      total_amount = v_new_total,
      cash_amount = round(v_cash, 2),
      upi_amount = round(v_upi, 2),
      total_profit = coalesce(total_profit, 0) - v_profit_removed,
      status = case when v_new_total <= 0.001 then 'voided' else status end
    where id = p_bill_id;
  end if;

  return json_build_object('success', true, 'refund_amount', v_refund, 'new_total', v_new_total);
end;
$$;

grant execute on function public.pos_return_items(uuid, jsonb, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. One-time correction of lines that were partly returned before this fix
-- ---------------------------------------------------------------------
with returned as (
  select r.original_bill_id as bill_id, ri.barcode, sum(ri.quantity) as qty
    from public.return_items ri
    join public.returns r on r.id = ri.return_id
   group by r.original_bill_id, ri.barcode
),
single_lines as (
  select bill_id, barcode
    from public.bill_items
   group by bill_id, barcode
  having count(*) = 1
),
stale as (
  select bi.id, bi.bill_id,
         bi.profit as old_profit,
         coalesce(nullif(bi.actual_quantity, 0), bi.quantity) as cur_actual,
         coalesce(nullif(bi.actual_quantity, 0), bi.quantity) + rt.qty as orig_actual,
         bi.cost_allocated,
         coalesce(bi.price_at_sale, 0) as price,
         coalesce(nullif(bi.billable_quantity, 0), bi.quantity) as cur_billable
    from public.bill_items bi
    join returned rt on rt.bill_id = bi.bill_id and rt.barcode = bi.barcode
    join single_lines sl on sl.bill_id = bi.bill_id and sl.barcode = bi.barcode
   where bi.profit is not null
     and bi.cost_allocated is not null
     and rt.qty > 0
     -- still holds the full-line profit (proves it was never corrected) ...
     and abs(bi.profit - (coalesce(bi.price_at_sale, 0) * (coalesce(nullif(bi.billable_quantity, 0), bi.quantity) + rt.qty) - bi.cost_allocated)) < 0.01
     -- ... and differs from the profit of what is left (otherwise nothing to fix)
     and abs(bi.profit - (coalesce(bi.price_at_sale, 0) * coalesce(nullif(bi.billable_quantity, 0), bi.quantity) - bi.cost_allocated)) >= 0.01
),
fixed as (
  update public.bill_items bi set
    cost_allocated = s.cost_allocated * s.cur_actual / s.orig_actual,
    profit = s.price * s.cur_billable - s.cost_allocated * s.cur_actual / s.orig_actual
    from stale s
   where bi.id = s.id and s.orig_actual > 0
  returning bi.bill_id, s.old_profit - bi.profit as removed
)
update public.bills b set total_profit = coalesce(b.total_profit, 0) - f.removed
  from (select bill_id, sum(removed) as removed from fixed group by bill_id) f
 where b.id = f.bill_id;

commit;
