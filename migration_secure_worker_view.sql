-- Migration: Stop MSP Network Data Leak (Database Projections)

-- 1. Create a secure view that explicitly omits MSP and cost_price
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
    -- Intentionally OMITTING msp and cost_price!
    stock_store,
    stock_warehouse,
    is_active
FROM public.product_master;

-- 2. Grant permissions to authenticated users to SELECT from this view
GRANT SELECT ON public.product_master_public TO authenticated;
