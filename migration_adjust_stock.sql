-- Migration: Atomic Stock Adjustment RPC
-- Ensures no race conditions when manually adjusting stock

CREATE OR REPLACE FUNCTION public.adjust_batch_stock(
    p_batch_id UUID,
    p_new_store_stock NUMERIC,
    p_new_whse_stock NUMERIC,
    p_user_id UUID
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_batch public.inventory_batches%ROWTYPE;
    v_item_name TEXT;
    v_changes TEXT := '';
BEGIN
    -- Verify the user is an owner or billable worker (simplified, checking if worker exists)
    IF NOT EXISTS (SELECT 1 FROM public.workers WHERE id = p_user_id) THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    -- Lock the row for update to prevent race conditions
    SELECT * INTO v_batch 
    FROM public.inventory_batches 
    WHERE batch_id = p_batch_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Batch not found';
    END IF;

    -- Get item name for audit log
    SELECT name INTO v_item_name FROM public.product_master WHERE barcode = v_batch.barcode LIMIT 1;

    -- Calculate changes and append to log string
    IF v_batch.stock_store != p_new_store_stock THEN
        v_changes := v_changes || 'Store Stock: ' || v_batch.stock_store || ' -> ' || p_new_store_stock || '. ';
    END IF;

    IF v_batch.stock_warehouse != p_new_whse_stock THEN
        v_changes := v_changes || 'Whse Stock: ' || v_batch.stock_warehouse || ' -> ' || p_new_whse_stock || '. ';
    END IF;

    -- Update the batch
    IF v_changes != '' THEN
        UPDATE public.inventory_batches
        SET stock_store = p_new_store_stock,
            stock_warehouse = p_new_whse_stock
        WHERE batch_id = p_batch_id;

        -- Insert audit log atomically
        INSERT INTO public.audit_logs (shop_id, action_type, barcode, item_name, changes, performed_by)
        VALUES (
            v_batch.shop_id,
            'UPDATE',
            v_batch.barcode,
            v_item_name,
            v_changes,
            'Owner via API'
        );
    END IF;

    RETURN json_build_object('success', true);
END;
$$;
