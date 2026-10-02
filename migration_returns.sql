-- Migration: Returns & Voids Workflow
-- Run this in the Supabase SQL Editor

-- =====================================================
-- PART 1: Returns Table
-- =====================================================

CREATE TABLE IF NOT EXISTS public.returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES public.shop_settings(id),
  original_bill_id UUID NOT NULL REFERENCES public.bills(id),
  cashier_name TEXT NOT NULL,
  authorized_by TEXT NOT NULL,
  reason TEXT,
  refund_method TEXT NOT NULL CHECK (refund_method IN ('CASH', 'UPI', 'STORE_CREDIT')),
  refund_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.returns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "returns_select" ON public.returns FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "returns_insert" ON public.returns FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- =====================================================
-- PART 2: Return Items Table
-- =====================================================

CREATE TABLE IF NOT EXISTS public.return_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id UUID NOT NULL REFERENCES public.returns(id) ON DELETE CASCADE,
  barcode TEXT NOT NULL,
  batch_id UUID,
  name TEXT NOT NULL,
  quantity NUMERIC(12,4) NOT NULL,
  price_at_sale NUMERIC(12,2) NOT NULL,
  instance_barcode TEXT,
  unit TEXT DEFAULT 'PCS'
);

ALTER TABLE public.return_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "return_items_select" ON public.return_items FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "return_items_insert" ON public.return_items FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- =====================================================
-- PART 3: Process Return RPC
-- =====================================================

CREATE OR REPLACE FUNCTION public.process_return(payload json)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_return_id UUID;
  v_item json;
  v_refund_total NUMERIC(12,2) := 0;
  v_shop_id UUID;
  v_bill_status TEXT;
BEGIN
  -- Get shop_id and status from the original bill
  SELECT shop_id, status INTO v_shop_id, v_bill_status
  FROM public.bills 
  WHERE id = (payload->>'original_bill_id')::UUID;

  IF v_shop_id IS NULL THEN
    RAISE EXCEPTION 'Original bill not found';
  END IF;

  IF v_bill_status = 'voided' THEN
    RAISE EXCEPTION 'This bill has already been fully voided';
  END IF;

  -- Create return record
  INSERT INTO public.returns (shop_id, original_bill_id, cashier_name, authorized_by, reason, refund_method, refund_amount)
  VALUES (
    v_shop_id,
    (payload->>'original_bill_id')::UUID,
    payload->>'cashier_name',
    payload->>'authorized_by',
    payload->>'reason',
    COALESCE(payload->>'refund_method', 'CASH'),
    0
  )
  RETURNING id INTO v_return_id;

  -- Process each returned item
  FOR v_item IN SELECT * FROM json_array_elements(payload->'items')
  LOOP
    -- Insert return item record
    INSERT INTO public.return_items (return_id, barcode, batch_id, name, quantity, price_at_sale, instance_barcode, unit)
    VALUES (
      v_return_id,
      v_item->>'barcode',
      NULLIF(v_item->>'batch_id', '')::UUID,
      v_item->>'name',
      (v_item->>'quantity')::NUMERIC,
      (v_item->>'price_at_sale')::NUMERIC,
      NULLIF(v_item->>'instance_barcode', ''),
      COALESCE(v_item->>'unit', 'PCS')
    );

    -- Increment stock back to store
    IF NULLIF(v_item->>'batch_id', '') IS NOT NULL THEN
      UPDATE public.inventory_batches
      SET stock_store = stock_store + (v_item->>'quantity')::NUMERIC
      WHERE barcode = v_item->>'barcode'
        AND batch_id = (v_item->>'batch_id')::UUID;
    END IF;

    -- Re-activate stock instance if cuttable item returned
    IF NULLIF(v_item->>'instance_barcode', '') IS NOT NULL THEN
      UPDATE public.stock_instances
      SET is_active = true, location = 'Store'
      WHERE instance_barcode = v_item->>'instance_barcode';
    END IF;

    v_refund_total := v_refund_total + ((v_item->>'quantity')::NUMERIC * (v_item->>'price_at_sale')::NUMERIC);
  END LOOP;

  -- Update refund amount on return record
  UPDATE public.returns SET refund_amount = v_refund_total WHERE id = v_return_id;

  -- Mark original bill status
  UPDATE public.bills SET status = 'partially_returned' 
  WHERE id = (payload->>'original_bill_id')::UUID 
    AND status = 'completed';

  -- Log audit event
  INSERT INTO public.audit_logs (shop_id, action, entity_type, entity_id, changes, performed_by)
  VALUES (
    v_shop_id, 
    'RETURN', 
    'return', 
    v_return_id::TEXT, 
    payload::JSONB, 
    COALESCE(payload->>'authorized_by', 'System')
  );

  RETURN json_build_object(
    'return_id', v_return_id, 
    'refund_amount', v_refund_total,
    'refund_method', COALESCE(payload->>'refund_method', 'CASH')
  );
END;
$$;
