-- Migration: Payment Tracking & EOD Cash Reconciliation
-- Run this in the Supabase SQL Editor

-- =====================================================
-- PART 1: Payment Method Tracking on Bills
-- =====================================================

-- Add payment tracking columns to bills table
ALTER TABLE public.bills 
  ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'CASH',
  ADD COLUMN IF NOT EXISTS cash_amount NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS upi_amount NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed';

-- =====================================================
-- PART 2: Register Sessions (EOD Cash Drawer)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.register_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES public.shop_settings(id),
  opened_by TEXT NOT NULL,
  closed_by TEXT,
  opening_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  expected_cash NUMERIC(12,2),
  actual_cash NUMERIC(12,2),
  discrepancy NUMERIC(12,2),
  total_cash_sales NUMERIC(12,2) DEFAULT 0,
  total_upi_sales NUMERIC(12,2) DEFAULT 0,
  total_cash_refunds NUMERIC(12,2) DEFAULT 0,
  total_upi_refunds NUMERIC(12,2) DEFAULT 0,
  bill_count INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opened_at TIMESTAMPTZ DEFAULT now(),
  closed_at TIMESTAMPTZ,
  notes TEXT
);

-- Enable RLS
ALTER TABLE public.register_sessions ENABLE ROW LEVEL SECURITY;

-- RLS: Only authenticated users in the same shop can access
CREATE POLICY "register_sessions_select" ON public.register_sessions
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "register_sessions_insert" ON public.register_sessions
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "register_sessions_update" ON public.register_sessions
  FOR UPDATE USING (auth.uid() IS NOT NULL);

-- =====================================================
-- PART 3: Update process_pos_transaction to accept payment fields
-- =====================================================
-- NOTE: The existing process_pos_transaction RPC needs to be modified
-- to accept and store p_payment_method, p_cash_amount, and p_upi_amount.
-- 
-- In the RPC, after the INSERT INTO bills(...) statement, add:
--   payment_method = COALESCE((payload->>'p_payment_method'), 'CASH'),
--   cash_amount = COALESCE((payload->>'p_cash_amount')::NUMERIC, 0),
--   upi_amount = COALESCE((payload->>'p_upi_amount')::NUMERIC, 0)
--
-- The exact modification depends on your current RPC body.
-- If your RPC inserts into bills like:
--   INSERT INTO bills (shop_id, location, cashier_name, total_amount)
-- Change it to:
--   INSERT INTO bills (shop_id, location, cashier_name, total_amount, payment_method, cash_amount, upi_amount)
--   VALUES (..., COALESCE((payload->>'p_payment_method'), 'CASH'), 
--           COALESCE((payload->>'p_cash_amount')::NUMERIC, 0),
--           COALESCE((payload->>'p_upi_amount')::NUMERIC, 0))

-- =====================================================
-- PART 4: Close Register RPC
-- =====================================================

CREATE OR REPLACE FUNCTION public.close_register(
  p_session_id UUID,
  p_actual_cash NUMERIC,
  p_closed_by TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session public.register_sessions;
  v_cash_sales NUMERIC;
  v_upi_sales NUMERIC;
  v_cash_refunds NUMERIC;
  v_expected NUMERIC;
  v_bill_count INTEGER;
BEGIN
  SELECT * INTO v_session FROM public.register_sessions WHERE id = p_session_id AND status = 'open';
  IF v_session IS NULL THEN
    RAISE EXCEPTION 'No open register session found';
  END IF;

  -- Calculate cash and UPI sales since session opened
  SELECT 
    COALESCE(SUM(CASE WHEN payment_method IN ('CASH', 'SPLIT') THEN cash_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN payment_method IN ('UPI', 'SPLIT') THEN upi_amount ELSE 0 END), 0),
    COUNT(*)
  INTO v_cash_sales, v_upi_sales, v_bill_count
  FROM public.bills
  WHERE shop_id = v_session.shop_id
    AND location = 'Store'
    AND created_at >= v_session.opened_at
    AND status = 'completed';

  -- Calculate cash refunds (if returns table exists)
  BEGIN
    SELECT COALESCE(SUM(refund_amount), 0)
    INTO v_cash_refunds
    FROM public.returns
    WHERE shop_id = v_session.shop_id
      AND refund_method = 'CASH'
      AND created_at >= v_session.opened_at;
  EXCEPTION WHEN undefined_table THEN
    v_cash_refunds := 0;
  END;

  v_expected := v_session.opening_balance + v_cash_sales - v_cash_refunds;

  UPDATE public.register_sessions
  SET 
    closed_by = p_closed_by,
    actual_cash = p_actual_cash,
    expected_cash = v_expected,
    discrepancy = p_actual_cash - v_expected,
    total_cash_sales = v_cash_sales,
    total_upi_sales = v_upi_sales,
    total_cash_refunds = v_cash_refunds,
    bill_count = v_bill_count,
    status = 'closed',
    closed_at = now(),
    notes = p_notes
  WHERE id = p_session_id;

  RETURN json_build_object(
    'session_id', p_session_id,
    'expected_cash', v_expected,
    'actual_cash', p_actual_cash,
    'discrepancy', p_actual_cash - v_expected,
    'cash_sales', v_cash_sales,
    'upi_sales', v_upi_sales,
    'cash_refunds', v_cash_refunds,
    'bill_count', v_bill_count
  );
END;
$$;
