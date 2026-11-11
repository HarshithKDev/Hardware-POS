-- =====================================================================
-- Hardware-POS: all-or-nothing database actions
-- Paste this whole file into Supabase -> SQL Editor and click Run.
-- One transaction (all or nothing); safe to run again.
-- The app works before and after this runs (it detects the new functions).
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. Product stock / prices are always calculated from its batches by the
--    database (function already exists; make sure it is attached).
-- ---------------------------------------------------------------------
drop trigger if exists pos_sync_product_from_batches on public.inventory_batches;
create trigger pos_sync_product_from_batches
  after insert or update or delete on public.inventory_batches
  for each row execute function public.sync_product_master_stock();

-- The product is updated by the trigger above, which also refreshes its
-- "last changed" time, so the separate bump trigger is no longer needed.
drop trigger if exists pos_batch_bumps_product on public.inventory_batches;

-- ---------------------------------------------------------------------
-- 2. Receiving with location 'Store' (warehouse disabled) adds to store stock.
--    (Same function as before; only the RECEIVE stock lines changed.)
-- ---------------------------------------------------------------------
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
                'SALE', v_item->>'barcode', v_item->>'name',
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

-- ---------------------------------------------------------------------
-- 3. One-call sale / receive / transfer: stock + bill + payment + customer +
--    screws line + showroom status, all or nothing. A client reference makes
--    retries safe: the same checkout can never create two bills.
-- ---------------------------------------------------------------------
alter table public.bills add column if not exists client_ref text;
create unique index if not exists bills_shop_client_ref_uidx
  on public.bills (shop_id, client_ref) where client_ref is not null;

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

  v_result := public.process_pos_transaction_unsafe(p_action, p_location, p_cashier_name, p_items);
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

  return json_build_object('success', true, 'bill_id', v_bill);
end;
$$;

-- ---------------------------------------------------------------------
-- 4. One-call return / void: stock back, bill lines, bill total, Cash/UPI split,
--    return record and audit log, all or nothing.
--    p_items: [{ "bill_item_id": "...", "quantity": 2 }, ...]
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
        delete from public.bill_items where id = v_bi.id;
      else
        update public.bill_items set
          quantity = v_line_qty - v_qty,
          billable_quantity = v_line_qty - v_qty,
          actual_quantity = coalesce(nullif(actual_quantity, 0), quantity) - v_qty
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
      status = case when v_new_total <= 0.001 then 'voided' else status end
    where id = p_bill_id;
  end if;

  return json_build_object('success', true, 'refund_amount', v_refund, 'new_total', v_new_total);
end;
$$;

-- ---------------------------------------------------------------------
-- 5. One-call stock write-off: Scrap (cut-length offcuts, owner only) and
--    Open Screw Box (owner and billable staff). Stock + audit log together.
-- ---------------------------------------------------------------------
create or replace function public.pos_remove_stock(
  p_batch_id uuid,
  p_qty numeric,
  p_location text,
  p_allow_other boolean,
  p_action_type text,
  p_note text,
  p_performed_by text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop uuid := get_current_shop_id();
  v_batch public.inventory_batches%rowtype;
  v_name text;
  v_primary numeric;
  v_secondary numeric;
  v_available numeric;
  v_from_primary numeric;
  v_from_store numeric;
  v_from_whse numeric;
  v_is_worker boolean;
  v_non_billable boolean;
begin
  if v_shop is null then
    raise exception 'Unable to determine shop_id. Are you logged in?';
  end if;
  if p_action_type not in ('SCRAP', 'BOX_OPENED') then
    raise exception 'Unknown stock action.';
  end if;
  if not (coalesce(p_qty, 0) > 0) then
    raise exception 'Enter a quantity greater than 0.';
  end if;

  select exists (select 1 from public.workers where id = auth.uid()),
         exists (select 1 from public.workers where id = auth.uid() and password like '%NON_BILLABLE%')
    into v_is_worker, v_non_billable;
  if p_action_type = 'SCRAP' and v_is_worker then
    raise exception 'Only the owner can scrap stock.';
  end if;
  if p_action_type = 'BOX_OPENED' and v_non_billable then
    raise exception 'This staff account is not allowed to open boxes.';
  end if;

  select * into v_batch from public.inventory_batches
   where shop_id = v_shop and batch_id = p_batch_id
   for update;
  if not found then raise exception 'This batch no longer exists. Refresh and try again.'; end if;

  v_primary   := case when p_location = 'warehouse' then v_batch.stock_warehouse else v_batch.stock_store end;
  v_secondary := case when p_location = 'warehouse' then v_batch.stock_store else v_batch.stock_warehouse end;
  v_available := v_primary + case when p_allow_other then v_secondary else 0 end;
  if p_qty > v_available + 0.000001 then
    raise exception 'Only % available in this batch; cannot remove %.', round(v_available, 2), p_qty;
  end if;

  v_from_primary := least(v_primary, p_qty);
  v_from_store := case when p_location = 'warehouse' then p_qty - v_from_primary else v_from_primary end;
  v_from_whse  := case when p_location = 'warehouse' then v_from_primary else p_qty - v_from_primary end;

  update public.inventory_batches set
    stock_store = stock_store - v_from_store,
    stock_warehouse = stock_warehouse - v_from_whse
  where shop_id = v_shop and batch_id = p_batch_id;

  select name into v_name from public.product_master where shop_id = v_shop and barcode = v_batch.barcode;

  insert into public.audit_logs (shop_id, action_type, barcode, item_name, changes, performed_by)
  values (v_shop, p_action_type, v_batch.barcode, coalesce(v_name, v_batch.barcode),
          coalesce(p_note, p_action_type), coalesce(p_performed_by, 'Staff'));

  return json_build_object('from_store', v_from_store, 'from_warehouse', v_from_whse);
end;
$$;

grant execute on function public.pos_process_sale(text, text, text, jsonb, text, numeric, numeric, numeric, text, text, numeric, text) to authenticated;
grant execute on function public.pos_return_items(uuid, jsonb, boolean, text) to authenticated;
grant execute on function public.pos_remove_stock(uuid, numeric, text, boolean, text, text, text) to authenticated;

commit;
