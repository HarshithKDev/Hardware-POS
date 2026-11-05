-- ============================================================================
-- Enable Supabase Realtime for instant multi-device syncing across terminals
-- ============================================================================
-- Run this in your Supabase SQL Editor once so that any item or batch created
-- on one device is pushed instantly in real-time to all other open screens/terminals.

-- 1. Ensure the publication exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

-- 2. Add product_master to realtime replication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'product_master'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.product_master;
  END IF;
END $$;

-- 3. Add inventory_batches to realtime replication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'inventory_batches'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_batches;
  END IF;
END $$;

