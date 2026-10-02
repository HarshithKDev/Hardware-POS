-- Migration: Secure Checkout RPC (Backend Role Verification)

-- Since we do not want to overwrite the entire complex logic of process_pos_transaction,
-- we will rename it and wrap it with a strict role verification function.

-- 1. Rename the existing insecure RPC (assuming standard unpacked arguments)
ALTER FUNCTION public.process_pos_transaction(text, text, text, jsonb) RENAME TO process_pos_transaction_unsafe;

-- 2. Create the secure wrapper
CREATE OR REPLACE FUNCTION public.process_pos_transaction(
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
    v_is_billable BOOLEAN;
BEGIN
    -- Look up the executing user's UUID in the workers table and verify is_billable
    SELECT is_billable INTO v_is_billable 
    FROM public.workers 
    WHERE id = auth.uid();
    
    -- If the user is a worker (found in the table) and is NOT billable, abort immediately
    IF v_is_billable IS FALSE THEN
        RAISE EXCEPTION 'Unauthorized: Only billable workers or owners can process transactions';
    END IF;

    -- If authorized, execute the original logic
    RETURN public.process_pos_transaction_unsafe(p_action, p_location, p_cashier_name, p_items);
END;
$$;
