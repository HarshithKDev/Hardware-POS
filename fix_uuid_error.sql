-- RUN THIS IN YOUR SUPABASE SQL EDITOR TO FIX THE UUID ERROR

-- 1. We must generate a real UUID for bills.id instead of a 'BILL-...' string.
-- We also add a receipt_no column to bills if it doesn't exist to store the human-readable string, 
-- but just to be safe without altering tables, we will just use a real UUID.

CREATE OR REPLACE FUNCTION public.process_pos_transaction(
    p_action TEXT, -- 'SALE', 'RECEIVE', 'TRANSFER'
    p_location TEXT, -- 'Store', 'Warehouse-Inbound', 'Warehouse-Transfer'
    p_cashier_name TEXT,
    p_items JSONB -- [{barcode, name, batch_id, actual_quantity, billable_quantity, system_price, final_price, unit, instance_barcode, ...}]
) RETURNS json AS $$
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
BEGIN
    -- Generate Bill ID as a proper UUID
    v_bill_id := gen_random_uuid();

    -- Insert Bill Header
    INSERT INTO public.bills (id, location, cashier_name, total_amount, total_profit, created_at)
    VALUES (v_bill_id, p_location, p_cashier_name, 0, 0, now());

    -- Loop through items
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_actual_qty := COALESCE((v_item->>'actual_quantity')::numeric, 0);
        v_billable_qty := COALESCE((v_item->>'billable_quantity')::numeric, 0);
        v_final_price := COALESCE((v_item->>'final_price')::numeric, 0);
        v_system_price := COALESCE((v_item->>'system_price')::numeric, 0);
        v_discount := COALESCE((v_item->>'negotiated_discount')::numeric, 0);
        
        IF p_action = 'SALE' THEN
            -- Deduct stock from the specific batch
            UPDATE public.inventory_batches
            SET stock_store = stock_store - v_actual_qty
            WHERE batch_id = (v_item->>'batch_id')::uuid
            RETURNING purchase_cost INTO v_batch_cost;

            -- Calculate Profit
            -- Profit = Final Amount Paid - (Batch Cost * Actual Physical Quantity)
            v_item_profit := (v_final_price * v_billable_qty) - (COALESCE(v_batch_cost, 0) * v_actual_qty);
            
            v_total_amount := v_total_amount + (v_final_price * v_billable_qty);
            v_total_profit := v_total_profit + v_item_profit;

            -- Insert Bill Item
            INSERT INTO public.bill_items (
                bill_id, barcode, name, quantity, unit, price_at_sale, 
                batch_id, actual_quantity, billable_quantity, system_price, 
                negotiated_discount, cost_allocated, profit
            ) VALUES (
                v_bill_id, v_item->>'barcode', v_item->>'name', v_billable_qty, v_item->>'unit', v_final_price,
                NULLIF(v_item->>'batch_id', '')::uuid, v_actual_qty, v_billable_qty, v_system_price,
                v_discount, (COALESCE(v_batch_cost, 0) * v_actual_qty), v_item_profit
            );

            -- Deduct from stock instances if cuttable
            IF (v_item->>'instance_barcode') IS NOT NULL AND (v_item->>'instance_barcode') != '' THEN
                UPDATE public.stock_instances
                SET current_length = current_length - v_actual_qty
                WHERE instance_barcode = v_item->>'instance_barcode';
            END IF;

        ELSIF p_action = 'RECEIVE' THEN
            -- Update warehouse stock
            UPDATE public.inventory_batches
            SET stock_warehouse = stock_warehouse + v_actual_qty
            WHERE batch_id = NULLIF(v_item->>'batch_id', '')::uuid;

        ELSIF p_action = 'TRANSFER' THEN
            -- Transfer from warehouse to store
            UPDATE public.inventory_batches
            SET stock_warehouse = stock_warehouse - v_actual_qty,
                stock_store = stock_store + v_actual_qty
            WHERE batch_id = NULLIF(v_item->>'batch_id', '')::uuid;
            
            IF (v_item->>'instance_barcode') IS NOT NULL AND (v_item->>'instance_barcode') != '' THEN
                UPDATE public.stock_instances
                SET location = 'Store'
                WHERE instance_barcode = v_item->>'instance_barcode';
            END IF;
        END IF;
    END LOOP;

    -- Update Bill Totals
    IF p_action = 'SALE' THEN
        UPDATE public.bills
        SET total_amount = v_total_amount,
            total_profit = v_total_profit
        WHERE id = v_bill_id;
    END IF;

    -- Return the short bill ID format for the UI receipt number
    RETURN json_build_object('bill_id', 'BILL-' || upper(substr(md5(v_bill_id::text), 1, 6)), 'status', 'SUCCESS', 'uuid', v_bill_id);
END;
$$ LANGUAGE plpgsql;
