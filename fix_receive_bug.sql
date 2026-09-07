-- RUN THIS IN YOUR SUPABASE SQL EDITOR TO FIX THE RECEIVE BUG

-- 1. Updates process_pos_transaction to properly update the active batch and create stock instances for cuttable items

CREATE OR REPLACE FUNCTION public.process_pos_transaction(
    p_action TEXT, -- 'SALE', 'RECEIVE', 'TRANSFER'
    p_location TEXT, -- 'Store', 'Warehouse-Inbound', 'Warehouse-Transfer'
    p_cashier_name TEXT,
    p_items JSONB -- [{barcode, name, batch_id, actual_quantity, billable_quantity, system_price, final_price, unit, instance_barcode, num_rolls, default_length, ...}]
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
                UPDATE public.stock_instances
                SET current_length = current_length - v_actual_qty
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
            -- Check if we have an exact matching active batch by price
            SELECT batch_id INTO v_target_batch
            FROM public.inventory_batches
            WHERE barcode = v_item->>'barcode' 
              AND purchase_cost = (v_item->>'purchase_cost')::numeric 
              AND selling_price = (v_item->>'selling_price')::numeric
              AND is_active = true
            ORDER BY created_at DESC LIMIT 1;

            IF v_target_batch IS NOT NULL THEN
                -- Exact price match found, add stock to it
                UPDATE public.inventory_batches
                SET stock_warehouse = stock_warehouse + v_actual_qty
                WHERE batch_id = v_target_batch;
            ELSE
                -- No exact match, create a new batch
                v_target_batch := gen_random_uuid();
                INSERT INTO public.inventory_batches (
                    batch_id, barcode, purchase_cost, selling_price, msp, 
                    stock_warehouse, stock_store, is_active
                ) VALUES (
                    v_target_batch,
                    v_item->>'barcode',
                    COALESCE((v_item->>'purchase_cost')::numeric, 0),
                    COALESCE((v_item->>'selling_price')::numeric, 0),
                    COALESCE((v_item->>'msp')::numeric, 0),
                    v_actual_qty,
                    0,
                    true
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
                SELECT batch_id INTO v_target_batch
                FROM public.inventory_batches
                WHERE barcode = v_item->>'barcode' AND is_active = true
                ORDER BY created_at DESC LIMIT 1;
            END IF;

            IF v_target_batch IS NOT NULL THEN
                UPDATE public.inventory_batches
                SET stock_warehouse = stock_warehouse - v_actual_qty,
                    stock_store = stock_store + v_actual_qty
                WHERE batch_id = v_target_batch;
            END IF;
            
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
