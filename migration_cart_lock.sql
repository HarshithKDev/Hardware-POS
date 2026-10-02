-- Migration: Fix Cart State Race Condition (Pessimistic Locking)

-- 1. Add locked_by column to pending_carts
ALTER TABLE public.pending_carts 
ADD COLUMN IF NOT EXISTS locked_by UUID REFERENCES auth.users(id);

-- 2. Create RPC to lock the cart atomically
CREATE OR REPLACE FUNCTION public.lock_pending_cart(p_cart_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_locked_by UUID;
BEGIN
    -- Attempt to lock the row and get the current locked_by
    SELECT locked_by INTO v_locked_by
    FROM public.pending_carts
    WHERE id = p_cart_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    -- If it's already locked by someone else, return false
    IF v_locked_by IS NOT NULL AND v_locked_by != auth.uid() THEN
        RETURN FALSE;
    END IF;

    -- Update to lock it for this user
    UPDATE public.pending_carts
    SET locked_by = auth.uid()
    WHERE id = p_cart_id;

    RETURN TRUE;
END;
$$;
