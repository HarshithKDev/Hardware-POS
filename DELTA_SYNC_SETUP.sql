-- ==============================================================================
-- HARDWARE POS: DELTA / INCREMENTAL SYNC SCHEMA UPGRADE
-- Run this script in your Supabase SQL Editor (https://supabase.com/dashboard)
-- It adds `updated_at` columns, automatic update triggers, indexes, and updates views.
-- ==============================================================================

-- 1. Add `updated_at` to product_master if not already present
ALTER TABLE public.product_master 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 2. Add `updated_at` to inventory_batches if not already present
ALTER TABLE public.inventory_batches 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 3. Backfill any existing records with current timestamp
UPDATE public.product_master 
SET updated_at = NOW() 
WHERE updated_at IS NULL;

UPDATE public.inventory_batches 
SET updated_at = NOW() 
WHERE updated_at IS NULL;

-- 4. Create high-performance composite indexes for lightning-fast delta queries
CREATE INDEX IF NOT EXISTS idx_product_master_shop_updated_at 
ON public.product_master(shop_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_batches_shop_updated_at 
ON public.inventory_batches(shop_id, updated_at DESC);

-- 5. Trigger Function: automatically updates `updated_at` whenever a row is modified
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. Attach trigger to product_master
DROP TRIGGER IF EXISTS trg_product_master_updated_at ON public.product_master;
CREATE TRIGGER trg_product_master_updated_at
BEFORE UPDATE ON public.product_master
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 7. Attach trigger to inventory_batches
DROP TRIGGER IF EXISTS trg_inventory_batches_updated_at ON public.inventory_batches;
CREATE TRIGGER trg_inventory_batches_updated_at
BEFORE UPDATE ON public.inventory_batches
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 8. Trigger to bump parent product_master.updated_at when any batch changes (sale, receiving, transfer)
CREATE OR REPLACE FUNCTION public.handle_batch_change_parent_bump()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.product_master
  SET updated_at = NOW()
  WHERE barcode = COALESCE(NEW.barcode, OLD.barcode)
    AND shop_id = COALESCE(NEW.shop_id, OLD.shop_id);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inventory_batches_parent_bump ON public.inventory_batches;
CREATE TRIGGER trg_inventory_batches_parent_bump
AFTER INSERT OR UPDATE OR DELETE ON public.inventory_batches
FOR EACH ROW EXECUTE FUNCTION public.handle_batch_change_parent_bump();

-- 9. Recreate views to expose `updated_at` to workers (safe without exposing cost_price)
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
  updated_at
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
  updated_at
FROM public.inventory_batches;

-- 10. Add `disable_warehouse` option to shop_settings (allows completely bypassing warehouse operations)
ALTER TABLE public.shop_settings 
ADD COLUMN IF NOT EXISTS disable_warehouse BOOLEAN DEFAULT FALSE;

-- ==============================================================================
-- DONE! Your Supabase database is now 100% prepared for instant Delta Sync and Warehouse Bypass.
-- ==============================================================================
