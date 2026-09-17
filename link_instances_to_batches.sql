-- RUN THIS IN YOUR SUPABASE SQL EDITOR TO FIX THE ARCHITECTURAL FLAW

-- 1. Add batch_id column to stock_instances
ALTER TABLE public.stock_instances 
ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES public.inventory_batches(batch_id);

-- 2. Backfill existing stock instances with the most recent active batch for their parent barcode
WITH latest_batches AS (
    SELECT DISTINCT ON (barcode) barcode, batch_id
    FROM public.inventory_batches
    WHERE is_active = true
    ORDER BY barcode, created_at DESC
)
UPDATE public.stock_instances si
SET batch_id = lb.batch_id
FROM latest_batches lb
WHERE si.parent_barcode = lb.barcode
  AND si.batch_id IS NULL;
