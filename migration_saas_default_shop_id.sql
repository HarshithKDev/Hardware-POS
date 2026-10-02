-- Migration: Enforce Strict Multi-Tenancy (Remove Client-Side Trust)

-- Set the default value of shop_id on all multi-tenant tables to securely derive from JWT
ALTER TABLE public.product_master ALTER COLUMN shop_id SET DEFAULT get_current_shop_id();
ALTER TABLE public.inventory_batches ALTER COLUMN shop_id SET DEFAULT get_current_shop_id();
ALTER TABLE public.workers ALTER COLUMN shop_id SET DEFAULT get_current_shop_id();
ALTER TABLE public.categories ALTER COLUMN shop_id SET DEFAULT get_current_shop_id();
ALTER TABLE public.subcategories ALTER COLUMN shop_id SET DEFAULT get_current_shop_id();
ALTER TABLE public.bills ALTER COLUMN shop_id SET DEFAULT get_current_shop_id();
ALTER TABLE public.bill_items ALTER COLUMN shop_id SET DEFAULT get_current_shop_id();
ALTER TABLE public.audit_logs ALTER COLUMN shop_id SET DEFAULT get_current_shop_id();
ALTER TABLE public.pending_carts ALTER COLUMN shop_id SET DEFAULT get_current_shop_id();
ALTER TABLE public.stock_instances ALTER COLUMN shop_id SET DEFAULT get_current_shop_id();
