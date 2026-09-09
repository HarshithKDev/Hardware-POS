-- RUN THIS IN YOUR SUPABASE SQL EDITOR

-- 1. Add the batch_number column to inventory_batches
ALTER TABLE public.inventory_batches ADD COLUMN IF NOT EXISTS batch_number INTEGER DEFAULT 1;

-- 2. Populate existing batches with a sequence number based on created_at
WITH numbered_batches AS (
  SELECT 
    batch_id, 
    ROW_NUMBER() OVER(PARTITION BY barcode ORDER BY created_at ASC) as seq_num
  FROM public.inventory_batches
)
UPDATE public.inventory_batches b
SET batch_number = nb.seq_num
FROM numbered_batches nb
WHERE b.batch_id = nb.batch_id;

-- 3. Update the process_pos_transaction function to assign a batch_number if creating a new batch
-- Note: We will handle the insertion of new batches in fix_receive_bug.sql, but since
-- process_pos_transaction is often called to create batches when receiving new prices,
-- we must ensure it grabs the next max batch_number.

CREATE OR REPLACE FUNCTION public.get_next_batch_number(p_barcode TEXT)
RETURNS INTEGER AS $$
DECLARE
    v_next INTEGER;
BEGIN
    SELECT COALESCE(MAX(batch_number), 0) + 1 INTO v_next 
    FROM public.inventory_batches 
    WHERE barcode = p_barcode;
    
    RETURN v_next;
END;
$$ LANGUAGE plpgsql;
