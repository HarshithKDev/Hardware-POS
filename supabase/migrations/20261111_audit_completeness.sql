-- =====================================================================
-- Hardware-POS: complete audit trail for sales and showroom dispatches
-- Paste this whole file into Supabase -> SQL Editor and click Run.
-- One transaction (all or nothing). Safe to run again.
--
-- 1. Showroom dispatches are logged as SHOWROOM (they were logged as SALE,
--    so they looked like ordinary sales in Audit Logs).
-- 2. Every bill / dispatch also gets one summary line: total, payment method
--    (with the UPI/cash split), discount given, number of items, customer.
-- 3. Past showroom dispatches already in the log are relabelled SHOWROOM.
-- The sale itself works exactly as before; only the audit lines change.
-- =====================================================================
begin;

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'pos_process_sale' and pronamespace = 'public'::regnamespace) then
    raise exception 'Run 20261111_atomic_actions.sql first. Nothing was changed.';
  end if;
end $$;

-- Same function as in 20261111_atomic_actions.sql; only the SALE audit line's action changed
CREATE OR REPLACE FUNCTION public.process_pos_transaction_unsafe(p_action text, p_location text, p_cashier_name text, p_items jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_bill_id UUID;
    v_item JSONB;
    v_total_amount NUMERIC := 0;
    v_total_profit NUMERIC := 0;
    v_batch_cost NUMERIC := 0;
    v_item_profit NUMERIC := 0;
    v_actual_qty NUMERIC := 0;
    v_billable_qty NUMERIC := 0;
    v_final_price NUMERIC := 0;
    v_system_price NUMERIC := 0;
    v_discount NUMERIC := 0;
    v_target_batch UUID;

    v_rolls INTEGER;
    v_seq INTEGER;
    v_inst_barcode TEXT;
    v_seq_str TEXT;
    v_cut_length NUMERIC;
    v_new_length NUMERIC;

    v_shop_id UUID := get_current_shop_id();
    v_to_store BOOLEAN := (p_location = 'Store');
BEGIN
    IF v_shop_id IS NULL THEN
        RAISE EXCEPTION 'Unable to determine shop_id. Are you logged in?';
    END IF;

    v_bill_id := gen_random_uuid();

    INSERT INTO public.bills (id, location, cashier_name, total_amount, total_profit, created_at, shop_id)
    VALUES (v_bill_id, p_location, p_cashier_name, 0, 0, now(), v_shop_id);

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_actual_qty := COALESCE((v_item->>'actual_quantity')::numeric, 0);
        v_billable_qty := COALESCE((v_item->>'billable_quantity')::numeric, 0);
        v_final_price := COALESCE((v_item->>'final_price')::numeric, 0);
        v_system_price := COALESCE((v_item->>'system_price')::numeric, 0);
        v_discount := COALESCE((v_item->>'negotiated_discount')::numeric, 0);

        IF p_action = 'SALE' THEN
            UPDATE public.inventory_batches
            SET stock_store = stock_store - v_actual_qty
            WHERE shop_id = v_shop_id AND batch_id = (v_item->>'batch_id')::uuid
            RETURNING purchase_cost INTO v_batch_cost;

            v_item_profit := (v_final_price * v_billable_qty) - (COALESCE(v_batch_cost, 0) * v_actual_qty);
            v_total_amount := v_total_amount + (v_final_price * v_billable_qty);
            v_total_profit := v_total_profit + v_item_profit;

            INSERT INTO public.bill_items (
                bill_id, barcode, name, quantity, unit, price_at_sale,
                batch_id, actual_quantity, billable_quantity, system_price,
                negotiated_discount, cost_allocated, profit, shop_id
            ) VALUES (
                v_bill_id, v_item->>'barcode', v_item->>'name', v_billable_qty, v_item->>'unit', v_final_price,
                NULLIF(v_item->>'batch_id', '')::uuid, v_actual_qty, v_billable_qty, v_system_price,
                v_discount, (COALESCE(v_batch_cost, 0) * v_actual_qty), v_item_profit, v_shop_id
            );

            IF (v_item->>'instance_barcode') IS NOT NULL AND (v_item->>'instance_barcode') != '' THEN
                v_cut_length := COALESCE((v_item->>'cut_length')::numeric, v_actual_qty);
                SELECT current_length - v_cut_length INTO v_new_length
                FROM public.stock_instances
                WHERE shop_id = v_shop_id AND instance_barcode = v_item->>'instance_barcode';
                UPDATE public.stock_instances
                SET
                    current_length = CASE WHEN (v_item->>'discard_scrap')::boolean = true THEN 0 ELSE current_length - v_cut_length END,
                    is_active = CASE WHEN (v_item->>'discard_scrap')::boolean = true OR v_new_length <= 0 THEN false ELSE true END
                WHERE shop_id = v_shop_id AND instance_barcode = v_item->>'instance_barcode';
            END IF;

            INSERT INTO public.audit_logs (action_type, barcode, item_name, changes, performed_by, shop_id)
            VALUES (
                -- 'SHOWROOM' when pos_process_sale is recording a showroom dispatch
                coalesce(nullif(current_setting('pos.audit_sale_action', true), ''), 'SALE'),
                v_item->>'barcode', v_item->>'name',
                json_build_object('quantity', v_actual_qty, 'price', v_final_price)::text,
                p_cashier_name, v_shop_id
            );

        ELSIF p_action = 'RECEIVE' THEN
            PERFORM 1 FROM public.product_master WHERE shop_id = v_shop_id AND barcode = v_item->>'barcode' FOR UPDATE;

            v_target_batch := NULLIF(v_item->>'batch_id', '')::uuid;
            IF v_target_batch IS NULL THEN
                SELECT batch_id INTO v_target_batch
                FROM public.inventory_batches
                WHERE shop_id = v_shop_id AND barcode = v_item->>'barcode'
                  AND is_active = true
                ORDER BY created_at DESC LIMIT 1;
            END IF;

            IF v_target_batch IS NOT NULL THEN
                -- Warehouse disabled ('Store'): stock goes straight to the store
                UPDATE public.inventory_batches
                SET stock_store     = stock_store     + CASE WHEN v_to_store THEN v_actual_qty ELSE 0 END,
                    stock_warehouse = stock_warehouse + CASE WHEN v_to_store THEN 0 ELSE v_actual_qty END
                WHERE shop_id = v_shop_id AND batch_id = v_target_batch;
            END IF;

            IF (v_item->>'instance_barcode') IS NOT NULL AND (v_item->>'instance_barcode') != '' THEN
                IF NOT EXISTS (SELECT 1 FROM public.stock_instances WHERE shop_id = v_shop_id AND instance_barcode = v_item->>'instance_barcode') THEN
                    INSERT INTO public.stock_instances (
                        instance_barcode, parent_barcode,
                        original_length, current_length,
                        location, is_active, batch_id, shop_id
                    ) VALUES (
                        v_item->>'instance_barcode', v_item->>'barcode',
                        (v_item->>'default_length')::numeric, (v_item->>'default_length')::numeric,
                        'Warehouse', true, v_target_batch, v_shop_id
                    );
                END IF;
            END IF;

            INSERT INTO public.audit_logs (action_type, barcode, item_name, changes, performed_by, shop_id)
            VALUES (
                'RECEIVE', v_item->>'barcode', v_item->>'name',
                json_build_object('quantity', v_actual_qty, 'purchase_cost', v_item->>'purchase_cost', 'selling_price', v_item->>'selling_price')::text,
                p_cashier_name, v_shop_id
            );

        ELSIF p_action = 'TRANSFER' THEN
            v_target_batch := NULLIF(v_item->>'batch_id', '')::uuid;
            IF v_target_batch IS NULL THEN
                RAISE EXCEPTION 'A specific batch must be selected when transferring stock from Warehouse to Store.';
            END IF;

            UPDATE public.inventory_batches
            SET stock_warehouse = stock_warehouse - v_actual_qty,
                stock_store = stock_store + v_actual_qty
            WHERE shop_id = v_shop_id AND batch_id = v_target_batch;

            IF (v_item->>'instance_barcode') IS NOT NULL AND (v_item->>'instance_barcode') != '' THEN
                UPDATE public.stock_instances
                SET location = 'Store'
                WHERE shop_id = v_shop_id AND instance_barcode = v_item->>'instance_barcode';
            END IF;

            INSERT INTO public.audit_logs (action_type, barcode, item_name, changes, performed_by, shop_id)
            VALUES (
                'TRANSFER', v_item->>'barcode', v_item->>'name',
                json_build_object('quantity', v_actual_qty, 'location', 'Store', 'instance', v_item->>'instance_barcode')::text,
                p_cashier_name, v_shop_id
            );
        END IF;
    END LOOP;

    UPDATE public.bills
    SET total_amount = v_total_amount, total_profit = v_total_profit
    WHERE shop_id = v_shop_id AND id = v_bill_id;

    RETURN json_build_object('success', true, 'bill_id', v_bill_id);
END;
$function$;

-- Same function as in 20261111_atomic_actions.sql, plus the showroom label and the summary line
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
      return json_build_object('success', true, 'bill_id', v_existing, 'duplicate', true);
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
      case when v_is_showroom then 'Showroom dispatch #' else 'Bill #' end || left(v_bill::text, 8),
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

  return json_build_object('success', true, 'bill_id', v_bill);
end;
$$;

-- 3. Relabel past showroom dispatch lines: the item lines were written in the same
--    transaction as the dispatch bill, by the same person, for items on that bill.
do $$
declare v_n int;
begin
with relabelled as (
  update public.audit_logs a
     set action_type = 'SHOWROOM'
    from public.bills b
   where a.action_type = 'SALE'
     and a.shop_id = b.shop_id
     and (b.payment_method = 'SHOWROOM' or b.status in ('showroom', 'showroom_pending'))
     and abs(extract(epoch from (a.created_at - b.created_at))) < 2
     and coalesce(a.performed_by, '') = coalesce(b.cashier_name, '')
     and exists (select 1 from public.bill_items bi where bi.bill_id = b.id and bi.barcode = a.barcode)
  returning a.id
)
select count(*) into v_n from relabelled;
raise notice '% past showroom line(s) relabelled', v_n;
end $$;

commit;

-- Result (read-only): showroom and bill lines now in the audit log
select action_type as action, count(*) as lines
from public.audit_logs
where action_type in ('SHOWROOM', 'BILL', 'SALE')
group by action_type
order by action_type;
