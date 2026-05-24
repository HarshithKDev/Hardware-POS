-- Supabase Setup SQL
-- Run this in your Supabase SQL Editor to enable atomic POS transactions.

-- Define the custom type for items array
DO $$ BEGIN
    CREATE TYPE pos_item AS (
        barcode text,
        name text,
        quantity numeric,
        price numeric,
        discountPct numeric,
        unit text
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE OR REPLACE FUNCTION process_pos_transaction(
    p_action text,
    p_location text,
    p_cashier_name text,
    p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    new_bill_id text;
    item_record record;
    item_json jsonb;
    total_amount numeric := 0;
    profit_amount numeric := 0;
    current_time timestamp with time zone := now();
    live_stock numeric;
    item_msp numeric;
BEGIN
    -- Generate unique bill ID based on action
    IF p_action = 'SALE' THEN
        new_bill_id := 'INV-' || to_char(current_time, 'YYMMDDHH24MISS') || '-' || substring(md5(random()::text) from 1 for 4);
    ELSIF p_action = 'RECEIVE' THEN
        new_bill_id := 'REC-' || to_char(current_time, 'YYMMDDHH24MISS') || '-' || substring(md5(random()::text) from 1 for 4);
    ELSE
        new_bill_id := 'TRN-' || to_char(current_time, 'YYMMDDHH24MISS') || '-' || substring(md5(random()::text) from 1 for 4);
    END IF;

    -- Process each item
    FOR item_json IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        -- Get the current stock lock for the item
        SELECT stock_store, stock_warehouse, msp 
        INTO item_record 
        FROM inventory 
        WHERE barcode = (item_json->>'barcode')::text 
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Item not found in inventory: %', item_json->>'name';
        END IF;

        item_msp := COALESCE(item_record.msp, 0);
        total_amount := total_amount + ((item_json->>'quantity')::numeric * (item_json->>'price')::numeric);
        profit_amount := profit_amount + ((item_json->>'quantity')::numeric * ((item_json->>'price')::numeric - item_msp));

        -- Update Inventory based on action
        IF p_action = 'SALE' THEN
            IF item_record.stock_store < (item_json->>'quantity')::numeric THEN
                RAISE EXCEPTION 'Insufficient stock for %', item_json->>'name';
            END IF;
            
            UPDATE inventory 
            SET stock_store = stock_store - (item_json->>'quantity')::numeric,
                last_updated = current_time
            WHERE barcode = (item_json->>'barcode')::text;

        ELSIF p_action = 'RECEIVE' THEN
            UPDATE inventory 
            SET stock_warehouse = COALESCE(stock_warehouse, 0) + (item_json->>'quantity')::numeric,
                last_updated = current_time
            WHERE barcode = (item_json->>'barcode')::text;

        ELSIF p_action = 'TRANSFER' THEN
            IF item_record.stock_warehouse < (item_json->>'quantity')::numeric THEN
                RAISE EXCEPTION 'Insufficient warehouse stock for %', item_json->>'name';
            END IF;

            UPDATE inventory 
            SET stock_warehouse = stock_warehouse - (item_json->>'quantity')::numeric,
                stock_store = COALESCE(stock_store, 0) + (item_json->>'quantity')::numeric,
                last_updated = current_time
            WHERE barcode = (item_json->>'barcode')::text;
        END IF;

        -- Insert Ledger Entry
        INSERT INTO sales_ledger (
            transaction_id, 
            action, 
            location, 
            cashier_name, 
            item_barcode, 
            item_name, 
            quantity, 
            unit_price, 
            total_price, 
            created_at
        ) VALUES (
            new_bill_id,
            p_action,
            p_location,
            p_cashier_name,
            (item_json->>'barcode')::text,
            (item_json->>'name')::text,
            (item_json->>'quantity')::numeric,
            (item_json->>'price')::numeric,
            ((item_json->>'quantity')::numeric * (item_json->>'price')::numeric),
            current_time
        );
    END LOOP;

    RETURN jsonb_build_object('bill_id', new_bill_id, 'total', total_amount, 'profit', profit_amount, 'status', 'success');
END;
$$;
