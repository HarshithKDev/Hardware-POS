-- Migration: Secure Inventory Batches View
-- Hides wholesale purchase_cost and MSP from non-owners

CREATE OR REPLACE VIEW public.inventory_batches_public AS
SELECT 
    batch_id,
    shop_id,
    barcode,
    batch_number,
    -- Intentionally OMITTING purchase_cost and msp
    selling_price,
    stock_warehouse,
    stock_store,
    is_active,
    created_at
FROM public.inventory_batches;

-- Grant permissions to authenticated users to SELECT from this view
GRANT SELECT ON public.inventory_batches_public TO authenticated;
