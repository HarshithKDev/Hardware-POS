ALTER TABLE stock_instances ADD COLUMN IF NOT EXISTS location text DEFAULT 'Warehouse';

CREATE OR REPLACE FUNCTION process_pos_transaction(
    p_action text,
    p_location text,
    p_cashier_name text,
    p_items jsonb
) RETURNS jsonb AS $$
DECLARE
    item RECORD;
    v_item_data RECORD;
    v_transaction_id uuid;
    v_instance_barcode text;
    v_total numeric := 0;
BEGIN
    -- Generate true UUID for Bill ID
    v_transaction_id := gen_random_uuid();

    -- Calculate total
    FOR item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(price numeric, quantity numeric) LOOP
        v_total := v_total + (item.quantity * item.price);
    END LOOP;

    INSERT INTO bills (id, location, cashier_name, total_amount)
    VALUES (v_transaction_id, p_location, p_cashier_name, v_total);

    FOR item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        barcode text, 
        name text, 
        quantity numeric, 
        price numeric, 
        discountPct numeric, 
        unit text, 
        instance_barcode text, 
        discard_scrap boolean, 
        piece_length numeric,
        num_rolls numeric,
        default_length numeric,
        default_width numeric
    ) LOOP

        SELECT * INTO v_item_data FROM inventory WHERE barcode = item.barcode;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Item not found %', item.barcode;
        END IF;

        IF p_action = 'RECEIVE' AND item.instance_barcode IS NOT NULL THEN
            IF EXISTS (
                SELECT 1 FROM audit_logs 
                WHERE action_type = 'RECEIVE' 
                AND changes LIKE '%"instance": "' || item.instance_barcode || '"%'
            ) THEN
                RAISE EXCEPTION 'Piece % has already been received into stock!', item.instance_barcode;
            END IF;
        END IF;

        -- Insert individual Bill Item
        INSERT INTO bill_items (bill_id, barcode, name, quantity, price_at_sale, cost_at_sale, unit)
        VALUES (v_transaction_id, item.barcode, item.name, item.quantity, item.price, COALESCE(v_item_data.cost_price, 0), item.unit);

        -- Log transaction to audit_logs
        INSERT INTO audit_logs (action_type, barcode, item_name, changes, performed_by)
        VALUES (p_action, item.barcode, item.name, jsonb_build_object('quantity', item.quantity, 'location', p_location, 'bill_id', v_transaction_id, 'instance', item.instance_barcode), p_cashier_name);

        IF p_action = 'RECEIVE' THEN
            IF v_item_data.is_cuttable THEN
                IF item.instance_barcode IS NOT NULL THEN
                    INSERT INTO stock_instances (instance_barcode, parent_barcode, original_length, current_length, is_active, location)
                    VALUES (item.instance_barcode, item.barcode, item.default_length, item.default_length, true, 'Warehouse')
                    ON CONFLICT (instance_barcode) DO NOTHING;
                ELSE
                    -- We are receiving `num_rolls` pieces. 
                    -- We must generate unique instances for each piece.
                    FOR i IN 1..COALESCE(item.num_rolls, 1) LOOP
                        v_instance_barcode := item.barcode || '-' || floor(random() * 1000000)::text;
                        INSERT INTO stock_instances (instance_barcode, parent_barcode, original_length, current_length, is_active, location)
                        VALUES (v_instance_barcode, item.barcode, item.default_length, item.default_length, true, 'Warehouse')
                        ON CONFLICT (instance_barcode) DO NOTHING;
                    END LOOP;
                END IF;
            END IF;
            -- For both cuttable and standard items, quantity holds the total units/SQFT/METER to add
            UPDATE inventory SET stock_warehouse = stock_warehouse + item.quantity WHERE barcode = item.barcode;

        ELSIF p_action = 'TRANSFER' THEN
            -- Update the instance location if transferring a specific piece
            IF item.instance_barcode IS NOT NULL THEN
                UPDATE stock_instances SET location = 'Store' WHERE instance_barcode = item.instance_barcode;
            END IF;
            
            -- Move aggregate stock
            UPDATE inventory SET stock_warehouse = stock_warehouse - item.quantity, stock_store = stock_store + item.quantity WHERE barcode = item.barcode;

        ELSIF p_action = 'SALE' THEN
            IF v_item_data.is_cuttable THEN
                IF item.instance_barcode IS NULL THEN
                    RAISE EXCEPTION 'Must provide unique instance barcode for cuttable sale';
                END IF;

                IF item.discard_scrap OR item.piece_length IS NULL THEN
                    -- They sold the whole piece or discarded scrap
                    UPDATE stock_instances SET is_active = false, current_length = 0 WHERE instance_barcode = item.instance_barcode;
                ELSE
                    -- They cut a piece, leaving scrap
                    UPDATE stock_instances SET current_length = current_length - item.piece_length WHERE instance_barcode = item.instance_barcode;
                END IF;
            END IF;
            -- Deduct aggregate stock from store
            UPDATE inventory SET stock_store = stock_store - item.quantity WHERE barcode = item.barcode;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'bill_id', v_transaction_id::text,
        'total_amount', v_total,
        'status', 'success'
    );
END;
$$ LANGUAGE plpgsql;
