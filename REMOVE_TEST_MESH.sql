-- ==============================================================================
-- CLEANUP SCRIPT: REMOVE TEST MESH (#1308) AND ALL ITS HISTORY
-- Run this in your Supabase SQL Editor: https://supabase.com/dashboard
-- 
-- This completely purges every trace of 'Test Mesh' (#1308) across:
-- 1. Unified Audit Logs (Stock In, Create, Sale, etc.)
-- 2. Bill Items & orphaned Bills
-- 3. Inventory Batches
-- 4. Product Master
-- 5. Held / Pending Carts
-- ==============================================================================

BEGIN;

-- 1. Remove from Unified Audit Logs (CREATE, STOCK IN, SALE entries)
DELETE FROM public.audit_logs 
WHERE barcode = '1308' 
   OR item_name ILIKE '%Test Mesh%';

-- 2. Clean up any Bill Items from checkout test runs
CREATE TEMP TABLE IF NOT EXISTS temp_test_bills AS
SELECT DISTINCT bill_id 
FROM public.bill_items 
WHERE barcode = '1308' 
   OR name ILIKE '%Test Mesh%';

DELETE FROM public.bill_items 
WHERE barcode = '1308' 
   OR name ILIKE '%Test Mesh%';

-- 3. Delete any test Bills that only contained this item (leaving no empty headers)
DELETE FROM public.bills 
WHERE id IN (SELECT bill_id FROM temp_test_bills)
  AND id NOT IN (SELECT DISTINCT bill_id FROM public.bill_items);

-- 4. If any bill had both real items and Test Mesh, recalculate totals
UPDATE public.bills b
SET 
  total_amount = COALESCE(sub.new_total, 0),
  total_profit = COALESCE(sub.new_profit, 0)
FROM (
  SELECT bill_id, 
         SUM(price_at_sale * billable_quantity) AS new_total, 
         SUM(profit) AS new_profit
  FROM public.bill_items
  GROUP BY bill_id
) sub
WHERE b.id = sub.bill_id
  AND b.id IN (SELECT bill_id FROM temp_test_bills);

DROP TABLE IF EXISTS temp_test_bills;

-- 5. Delete Inventory Batches
DELETE FROM public.inventory_batches 
WHERE barcode = '1308';

-- 6. Delete the Product Master record
DELETE FROM public.product_master 
WHERE barcode = '1308'
   OR name ILIKE '%Test Mesh%';

-- 7. Remove from Held / Pending Carts if present
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'pending_carts') THEN
    DELETE FROM public.pending_carts 
    WHERE items::text LIKE '%1308%' OR items::text ILIKE '%Test Mesh%';
  END IF;
END $$;

COMMIT;

-- Verify cleanup: all counts will return 0
SELECT 'product_master' AS tbl, count(*) FROM public.product_master WHERE barcode = '1308'
UNION ALL
SELECT 'inventory_batches', count(*) FROM public.inventory_batches WHERE barcode = '1308'
UNION ALL
SELECT 'audit_logs', count(*) FROM public.audit_logs WHERE barcode = '1308' OR item_name ILIKE '%Test Mesh%'
UNION ALL
SELECT 'bill_items', count(*) FROM public.bill_items WHERE barcode = '1308' OR name ILIKE '%Test Mesh%';

