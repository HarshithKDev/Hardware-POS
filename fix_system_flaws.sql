-- RUN THIS IN YOUR SUPABASE SQL EDITOR TO FIX SYSTEM FLAWS

-- 0. Clean up existing corrupted data (caused by the SQFT bug)
UPDATE public.inventory_batches SET stock_store = 0 WHERE stock_store < 0;
UPDATE public.inventory_batches SET stock_warehouse = 0 WHERE stock_warehouse < 0;
UPDATE public.stock_instances SET current_length = 0, is_active = false WHERE current_length <= 0;

-- 1. Add CHECK constraints to prevent negative inventory values
ALTER TABLE public.inventory_batches
  ADD CONSTRAINT chk_stock_store_nonnegative CHECK (stock_store >= 0),
  ADD CONSTRAINT chk_stock_warehouse_nonnegative CHECK (stock_warehouse >= 0);

ALTER TABLE public.stock_instances
  ADD CONSTRAINT chk_current_length_nonnegative CHECK (current_length >= 0);

-- 2. Update process_pos_transaction with Scrap handling, auto-deactivation, and concurrency locks
CREATE OR REPLACE FUNCTION public.process_pos_transaction(
    p_action TEXT, -- 'SALE', 'RECEIVE', 'TRANSFER'
    p_location TEXT, -- 'Store', 'Warehouse-Inbound', 'Warehouse-Transfer'
    p_cashier_name TEXT,
    p_items JSONB -- [{barcode, name, batch_id, actual_quantity, billable_quantity, system_price, final_price, unit, instance_barcode, num_rolls, default_length, cut_length, discard_scrap...}]
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
    
    v_rolls INTEGER;
    v_seq INTEGER;
    v_inst_barcode TEXT;
    v_cut_length NUMERIC;
    v_new_length NUMERIC;
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
                v_cut_length := COALESCE((v_item->>'cut_length')::numeric, v_actual_qty);
                
                -- Get new length to determine if it should remain active
                SELECT current_length - v_cut_length INTO v_new_length 
                FROM public.stock_instances 
                WHERE instance_barcode = v_item->>'instance_barcode';

                UPDATE public.stock_instances
                SET 
                    current_length = CASE WHEN (v_item->>'discard_scrap')::boolean = true THEN 0 ELSE current_length - v_cut_length END,
                    is_active = CASE WHEN (v_item->>'discard_scrap')::boolean = true OR v_new_length <= 0 THEN false ELSE true END
                WHERE instance_barcode = v_item->>'instance_barcode';
            END IF;

            -- Log to Audit Logs
            INSERT INTO public.audit_logs (action_type, barcode, item_name, changes, performed_by)
            VALUES (
                'SALE', v_item->>'barcode', v_item->>'name', 
                json_build_object('quantity', v_actual_qty, 'price', v_final_price)::text, 
                p_cashier_name
            );

        ELSIF p_action = 'RECEIVE' THEN
            -- Lock the parent row in product_master to prevent concurrent batch/instance generation race conditions
            PERFORM 1 FROM public.product_master WHERE barcode = v_item->>'barcode' FOR UPDATE;

            -- Check if we have an exact matching active batch by price
            SELECT batch_id INTO v_target_batch
            FROM public.inventory_batches
            WHERE barcode = v_item->>'barcode' 
              AND purchase_cost = (v_item->>'purchase_cost')::numeric 
              AND selling_price = (v_item->>'selling_price')::numeric
              AND is_active = true
            ORDER BY created_at DESC LIMIT 1;

            IF v_target_batch IS NOT NULL THEN
                -- Exact price match found, add stock to it and update MSP if needed
                UPDATE public.inventory_batches
                SET stock_warehouse = stock_warehouse + v_actual_qty,
                    msp = COALESCE((v_item->>'msp')::numeric, msp)
                WHERE batch_id = v_target_batch;
            ELSE
                -- No exact match, create a new batch
                v_target_batch := gen_random_uuid();
                INSERT INTO public.inventory_batches (
                    batch_id, barcode, purchase_cost, selling_price, msp, 
                    stock_warehouse, stock_store, is_active, batch_number
                ) VALUES (
                    v_target_batch,
                    v_item->>'barcode',
                    COALESCE((v_item->>'purchase_cost')::numeric, 0),
                    COALESCE((v_item->>'selling_price')::numeric, 0),
                    COALESCE((v_item->>'msp')::numeric, 0),
                    v_actual_qty,
                    0,
                    true,
                    (SELECT COALESCE(MAX(batch_number), 0) + 1 FROM public.inventory_batches WHERE barcode = v_item->>'barcode')
                );
            END IF;
            
            -- If it is cuttable, we must generate new stock instances
            IF (v_item->>'num_rolls') IS NOT NULL AND (v_item->>'num_rolls')::numeric > 0 THEN
                v_rolls := (v_item->>'num_rolls')::integer;
                
                -- Find max sequence
                SELECT COALESCE(MAX(RIGHT(instance_barcode, 6)::integer), 1000) INTO v_seq
                FROM public.stock_instances
                WHERE parent_barcode = v_item->>'barcode';
                
                FOR i_roll IN 1..v_rolls LOOP
                    v_seq := v_seq + 1;
                    v_inst_barcode := (v_item->>'barcode') || LPAD(v_seq::text, 6, '0');
                    
                    INSERT INTO public.stock_instances (
                        instance_barcode, parent_barcode, 
                        original_length, current_length,
                        location, is_active
                    ) VALUES (
                        v_inst_barcode, v_item->>'barcode',
                        (v_item->>'default_length')::numeric, (v_item->>'default_length')::numeric,
                        'Warehouse', true
                    );
                END LOOP;
            END IF;

            -- Log to Audit Logs
            INSERT INTO public.audit_logs (action_type, barcode, item_name, changes, performed_by)
            VALUES (
                'RECEIVE', v_item->>'barcode', v_item->>'name', 
                json_build_object('quantity', v_actual_qty, 'purchase_cost', v_item->>'purchase_cost', 'selling_price', v_item->>'selling_price')::text, 
                p_cashier_name
            );

        ELSIF p_action = 'TRANSFER' THEN
            -- Find the correct batch to update
            v_target_batch := NULLIF(v_item->>'batch_id', '')::uuid;
            
            IF v_target_batch IS NULL THEN
                -- If no specific batch was provided, raise an exception to prevent blind deductions
                RAISE EXCEPTION 'A specific batch must be selected when transferring stock from Warehouse to Store.';
            END IF;

            UPDATE public.inventory_batches
            SET stock_warehouse = stock_warehouse - v_actual_qty,
                stock_store = stock_store + v_actual_qty
            WHERE batch_id = v_target_batch;
            
            IF (v_item->>'instance_barcode') IS NOT NULL AND (v_item->>'instance_barcode') != '' THEN
                UPDATE public.stock_instances
                SET location = 'Store'
                WHERE instance_barcode = v_item->>'instance_barcode';
            END IF;
            
            -- Log to Audit Logs
            INSERT INTO public.audit_logs (action_type, barcode, item_name, changes, performed_by)
            VALUES (
                'TRANSFER', v_item->>'barcode', v_item->>'name', 
                json_build_object('quantity', v_actual_qty, 'location', 'Store', 'instance', v_item->>'instance_barcode')::text, 
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
