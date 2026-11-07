-- ==============================================================================
-- HARDWARE POS: MERGE STRANDED WAREHOUSE STOCK INTO STORE STOCK
-- Run this in your Supabase SQL Editor (https://supabase.com/dashboard)
-- 
-- Fixes:
-- 1. Merges all stranded stock sitting in stock_warehouse into stock_store
--    for batch 1308-01 (Test Mesh) and all products in single-store mode.
-- 2. Updates process_pos_transaction_unsafe so that:
--    a) 'RECEIVE' with location 'Store' directly increments stock_store
--    b) 'SALE' automatically draws from stock_warehouse if stock_store is low
-- ==============================================================================

-- 1. Move stranded warehouse stock to store stock for Test Mesh (barcode 1308) and all other products
UPDATE public.inventory_batches
SET stock_store = stock_store + stock_warehouse,
    stock_warehouse = 0
WHERE stock_warehouse > 0;

UPDATE public.product_master
SET stock_store = stock_store + stock_warehouse,
    stock_warehouse = 0
WHERE stock_warehouse > 0;

-- 2. Update process_pos_transaction_unsafe with bulletproof single-store handling
CREATE OR REPLACE FUNCTION public.process_pos_transaction_unsafe(
    p_action TEXT, -- 'SALE', 'RECEIVE', 'TRANSFER'
    p_location TEXT, -- 'Store', 'Warehouse-Inbound', 'Warehouse-Transfer'
    p_cashier_name TEXT,
    p_items JSONB -- [{barcode, name, batch_id, actual_quantity, billable_quantity, system_price, final_price, unit, ...}]
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
    v_target_batch UUID;
BEGIN
    -- Generate Bill ID
    v_bill_id := gen_random_uuid();

    -- Insert Bill Header
    INSERT INTO public.bills (id, location, cashier_name, total_amount, total_profit, created_at)
    VALUES (v_bill_id, p_location, p_cashier_name, 0, 0, now());

    -- Loop through items
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_actual_qty := COALESCE((v_item->>'actual_quantity')::numeric, (v_item->>'quantity')::numeric, 0);
        v_billable_qty := COALESCE((v_item->>'billable_quantity')::numeric, v_actual_qty);
        v_final_price := COALESCE((v_item->>'final_price')::numeric, 0);
        v_system_price := COALESCE((v_item->>'system_price')::numeric, 0);
        v_discount := COALESCE((v_item->>'negotiated_discount')::numeric, 0);
        v_target_batch := NULLIF(v_item->>'batch_id', '')::uuid;
        
        IF p_action = 'SALE' THEN
            -- Deduct dimensional or standard stock directly from the specific batch
            IF v_target_batch IS NOT NULL THEN
                -- If stock_store is less than needed, merge any stranded warehouse stock on this batch
                UPDATE public.inventory_batches
                SET stock_store = stock_store + stock_warehouse,
                    stock_warehouse = 0
                WHERE batch_id = v_target_batch AND stock_store < v_actual_qty AND stock_warehouse > 0;

                UPDATE public.inventory_batches
                SET stock_store = GREATEST(0, stock_store - v_actual_qty)
                WHERE batch_id = v_target_batch
                RETURNING purchase_cost INTO v_batch_cost;
            ELSE
                -- Fallback to active batch if batch_id was not explicitly passed
                SELECT batch_id INTO v_target_batch
                FROM public.inventory_batches 
                WHERE barcode = v_item->>'barcode' AND is_active = true 
                ORDER BY created_at DESC LIMIT 1;

                IF v_target_batch IS NOT NULL THEN
                    UPDATE public.inventory_batches
                    SET stock_store = stock_store + stock_warehouse,
                        stock_warehouse = 0
                    WHERE batch_id = v_target_batch AND stock_store < v_actual_qty AND stock_warehouse > 0;

                    UPDATE public.inventory_batches
                    SET stock_store = GREATEST(0, stock_store - v_actual_qty)
                    WHERE batch_id = v_target_batch
                    RETURNING purchase_cost INTO v_batch_cost;
                END IF;
            END IF;

            -- Calculate Profit
            v_item_profit := (v_final_price * v_billable_qty) - (COALESCE(v_batch_cost, 0) * v_actual_qty);
            
            v_total_amount := v_total_amount + (v_final_price * v_billable_qty);
            v_total_profit := v_total_profit + v_item_profit;

            -- Insert Bill Item record
            INSERT INTO public.bill_items (
                bill_id, barcode, name, quantity, unit, price_at_sale, 
                batch_id, actual_quantity, billable_quantity, system_price, 
                negotiated_discount, cost_allocated, profit
            ) VALUES (
                v_bill_id, v_item->>'barcode', v_item->>'name', v_billable_qty, v_item->>'unit', v_final_price,
                v_target_batch, v_actual_qty, v_billable_qty, v_system_price,
                v_discount, (COALESCE(v_batch_cost, 0) * v_actual_qty), v_item_profit
            );

            -- Log to Audit Logs
            INSERT INTO public.audit_logs (action_type, barcode, item_name, changes, performed_by)
            VALUES (
                'SALE', v_item->>'barcode', v_item->>'name', 
                json_build_object('quantity', v_actual_qty, 'billable_qty', v_billable_qty, 'price', v_final_price)::text, 
                p_cashier_name
            );

        ELSIF p_action = 'RECEIVE' THEN
            -- Lock the parent row in product_master to prevent concurrent batch generation race conditions
            PERFORM 1 FROM public.product_master WHERE barcode = v_item->>'barcode' FOR UPDATE;

            IF v_target_batch IS NOT NULL THEN
                -- If receiving directly into Store (single-tier mode), add to stock_store
                IF p_location = 'Store' THEN
                    UPDATE public.inventory_batches
                    SET stock_store = stock_store + v_actual_qty
                    WHERE batch_id = v_target_batch;
                ELSE
                    UPDATE public.inventory_batches
                    SET stock_warehouse = stock_warehouse + v_actual_qty
                    WHERE batch_id = v_target_batch;
                END IF;
            ELSE
                -- Fallback to latest active batch
                SELECT batch_id INTO v_target_batch
                FROM public.inventory_batches
                WHERE barcode = v_item->>'barcode' 
                  AND is_active = true
                ORDER BY created_at DESC LIMIT 1;
                
                IF v_target_batch IS NOT NULL THEN
                    IF p_location = 'Store' THEN
                        UPDATE public.inventory_batches
                        SET stock_store = stock_store + v_actual_qty
                        WHERE batch_id = v_target_batch;
                    ELSE
                        UPDATE public.inventory_batches
                        SET stock_warehouse = stock_warehouse + v_actual_qty
                        WHERE batch_id = v_target_batch;
                    END IF;
                END IF;
            END IF;

            -- Log to Audit Logs
            INSERT INTO public.audit_logs (action_type, barcode, item_name, changes, performed_by)
            VALUES (
                'RECEIVE', v_item->>'barcode', v_item->>'name', 
                json_build_object('quantity', v_actual_qty, 'purchase_cost', v_item->>'purchase_cost', 'selling_price', v_item->>'selling_price')::text, 
                p_cashier_name
            );

        ELSIF p_action = 'TRANSFER' THEN
            IF v_target_batch IS NULL THEN
                RAISE EXCEPTION 'A specific batch must be selected when transferring stock from Warehouse to Store.';
            END IF;

            -- Atomically move stock from Warehouse to Store in batch
            UPDATE public.inventory_batches
            SET stock_warehouse = GREATEST(0, stock_warehouse - v_actual_qty),
                stock_store = stock_store + v_actual_qty
            WHERE batch_id = v_target_batch;
            
            -- Log to Audit Logs
            INSERT INTO public.audit_logs (action_type, barcode, item_name, changes, performed_by)
            VALUES (
                'TRANSFER', v_item->>'barcode', v_item->>'name', 
                json_build_object('quantity', v_actual_qty, 'location', 'Store')::text, 
                p_cashier_name
            );

        END IF;

    END LOOP;

    -- Update Bill Totals
    UPDATE public.bills 
    SET total_amount = v_total_amount, total_profit = v_total_profit
    WHERE id = v_bill_id;

    RETURN json_build_object('success', true, 'bill_id', v_bill_id);
END;
$$ LANGUAGE plpgsql;

-- Verify updated stock
SELECT barcode, batch_number, stock_store, stock_warehouse 
FROM public.inventory_batches 
WHERE barcode = '1308';

