-- ==============================================================================
-- HARDWARE POS: PRODUCT DESCRIPTION & BATCH WHOLESALER SCHEMA UPGRADE
-- SAFE & NON-DESTRUCTIVE: Preserves all existing shop data, columns & permissions.
-- Run this script in your Supabase SQL Editor (https://supabase.com/dashboard)
-- ==============================================================================

-- 1. Add `description` to product_master if not already present
-- (Safe: Nullable column, does not alter or erase existing product data)
ALTER TABLE public.product_master 
ADD COLUMN IF NOT EXISTS description TEXT;

-- 2. Add `supplier` (wholesaler) to inventory_batches if not already present
-- (Safe: Nullable column, does not alter or erase existing batch data)
ALTER TABLE public.inventory_batches 
ADD COLUMN IF NOT EXISTS supplier TEXT;

-- 3. Update public views by appending new columns at the end
-- (Safe: CREATE OR REPLACE preserves the view and all existing permissions without dropping)
CREATE OR REPLACE VIEW public.product_master_public AS
SELECT 
  id, 
  shop_id, 
  barcode, 
  name, 
  category, 
  sub_category, 
  unit,
  min_quantity_warehouse, 
  min_quantity_store, 
  is_loose_item,
  is_cuttable, 
  default_length, 
  default_width, 
  billing_increment,
  billing_method, 
  price, 
  msp, 
  stock_store, 
  stock_warehouse, 
  is_active,
  updated_at,
  description
FROM public.product_master;

CREATE OR REPLACE VIEW public.inventory_batches_public AS
SELECT 
  batch_id, 
  shop_id, 
  barcode, 
  batch_number, 
  msp, 
  selling_price,
  stock_warehouse, 
  stock_store, 
  is_active, 
  created_at, 
  updated_at,
  supplier
FROM public.inventory_batches;

-- 4. Ensure public view read permissions are active
GRANT SELECT ON public.product_master_public TO anon, authenticated, service_role;
GRANT SELECT ON public.inventory_batches_public TO anon, authenticated, service_role;
