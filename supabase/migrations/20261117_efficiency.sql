-- =====================================================================
-- Hardware-POS: fewer and smaller database requests
-- Paste this whole file into Supabase -> SQL Editor and click Run.
-- One transaction; safe to run again. No business data is changed.
--
-- 1. pos_active_days(): the list of days that have sales / audit entries (for the day-by-day
--    Sales History and Audit Logs screens). Those screens downloaded the latest 1,000 raw
--    timestamps on every open (and after every sale) just to work out a handful of dates.
-- 2. Indexes for lookups that grow with the shop's history, each created only if no index
--    with the same leading columns exists already.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. Days with activity, newest first, in the shop's time zone
-- ---------------------------------------------------------------------
create or replace function public.pos_active_days(
  p_kind text,                      -- 'sales' or 'audit'
  p_tz text default 'Asia/Kolkata', -- the device's time zone, so days match the screen
  p_before timestamptz default null,
  p_limit int default 60
)
returns table (day date)
language plpgsql
stable
security invoker                    -- the caller's own access rules apply
set search_path = public
as $$
declare
  v_shop uuid := public.get_current_shop_id();
  v_tz text := coalesce(nullif(p_tz, ''), 'UTC');
  v_limit int := greatest(1, least(coalesce(p_limit, 60), 400));
begin
  begin
    perform now() at time zone v_tz;
  exception when others then
    v_tz := 'UTC';
  end;

  if p_kind = 'audit' then
    return query
      select distinct (a.created_at at time zone v_tz)::date as d
        from public.audit_logs a
       where a.shop_id = v_shop
         and (p_before is null or a.created_at < p_before)
       order by 1 desc
       limit v_limit;
  elsif p_kind = 'sales' then
    -- same bills as the Sales History list; staff read the cost-free view
    if coalesce(public.pos_is_shop_owner(), false) then
      return query
        select distinct (b.created_at at time zone v_tz)::date as d
          from public.bills b
         where b.shop_id = v_shop
           and b.location = 'Store'
           and b.status <> 'showroom_pending' and b.status <> 'showroom'
           and b.payment_method <> 'SHOWROOM'
           and (p_before is null or b.created_at < p_before)
         order by 1 desc
         limit v_limit;
    else
      return query
        select distinct (b.created_at at time zone v_tz)::date as d
          from public.bills_public b
         where b.shop_id = v_shop
           and b.location = 'Store'
           and b.status <> 'showroom_pending' and b.status <> 'showroom'
           and b.payment_method <> 'SHOWROOM'
           and (p_before is null or b.created_at < p_before)
         order by 1 desc
         limit v_limit;
    end if;
  else
    raise exception 'Unknown kind %', p_kind;
  end if;
end;
$$;

revoke execute on function public.pos_active_days(text, text, timestamptz, int) from public, anon;
grant execute on function public.pos_active_days(text, text, timestamptz, int) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Indexes (skipped when an index with the same leading columns already exists)
-- ---------------------------------------------------------------------
create or replace function pg_temp.pos_ensure_index(p_table regclass, p_cols text[], p_name text)
returns void
language plpgsql
as $$
begin
  if exists (
    select 1
      from pg_index i
     where i.indrelid = p_table
       and (select array_agg(a.attname::text order by k.ord)
              from unnest(i.indkey::int2[]) with ordinality as k(attnum, ord)
              join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
             where k.ord <= array_length(p_cols, 1)) = p_cols
  ) then
    return;
  end if;
  execute format('create index %I on %s (%s)', p_name, p_table,
                 (select string_agg(quote_ident(c), ', ') from unnest(p_cols) as c));
end;
$$;

-- Audit Logs: one shop, one day, newest first (the fastest-growing table)
select pg_temp.pos_ensure_index('public.audit_logs', array['shop_id', 'created_at'], 'audit_logs_shop_created_idx');
-- Stock checks at checkout and batch lookups during sync
select pg_temp.pos_ensure_index('public.inventory_batches', array['shop_id', 'barcode'], 'inventory_batches_shop_barcode_idx');
-- "Which products changed since the last sync?" (every device, every minute)
select pg_temp.pos_ensure_index('public.product_master', array['shop_id', 'updated_at'], 'product_master_shop_updated_idx');

commit;
